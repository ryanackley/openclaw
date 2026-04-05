/**
 * Brute-force vector search over memory files using Voyage AI embeddings.
 *
 * No vector database needed. At hundreds of documents, cosine similarity
 * over a flat array of embeddings is effectively instant (~2ms for 500 docs).
 *
 * Storage: ~/memory/.embeddings.json — a flat map of { path → { chunks } }
 * Embedding: Voyage AI API (same provider OpenClaw uses)
 * Search: cosine similarity, top-K results
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MEMORY_DIR = join(homedir(), "memory");
const EMBEDDINGS_PATH = join(MEMORY_DIR, ".embeddings.json");
const VOYAGE_MODEL = "voyage-3";
const CHUNK_SIZE = 400; // tokens (rough: 1 token ≈ 4 chars)
const CHUNK_OVERLAP = 80;
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Chunk {
  text: string;
  startLine: number;
  endLine: number;
  embedding: number[];
}

interface FileEntry {
  path: string;
  hash: string; // Quick content hash to detect changes
  chunks: Chunk[];
}

interface EmbeddingsStore {
  version: 1;
  model: string;
  updatedAt: string;
  files: Record<string, FileEntry>;
}

export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Voyage AI embedding API
// ---------------------------------------------------------------------------

async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY not set. Get one at https://dash.voyageai.com/",
    );
  }

  // Voyage AI supports batch embedding up to 128 texts
  const batchSize = 128;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: batch,
        model: VOYAGE_MODEL,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Voyage AI API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    allEmbeddings.push(...data.data.map((d) => d.embedding));
  }

  return allEmbeddings;
}

async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY not set");
  }

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [query],
      model: VOYAGE_MODEL,
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage AI API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Chunking — markdown-aware, splits on headings and paragraphs
// ---------------------------------------------------------------------------

function chunkMarkdown(
  content: string,
): Array<{ text: string; startLine: number; endLine: number }> {
  const lines = content.split("\n");
  const chunks: Array<{ text: string; startLine: number; endLine: number }> =
    [];

  const maxChars = CHUNK_SIZE * CHARS_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;

  let currentChunk: string[] = [];
  let currentStartLine = 0;
  let currentLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLen = line.length + 1; // +1 for newline

    // Start a new chunk at markdown headings if current chunk is substantial
    if (line.startsWith("#") && currentLength > overlapChars) {
      if (currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.join("\n").trim(),
          startLine: currentStartLine + 1, // 1-indexed
          endLine: i, // 1-indexed (exclusive end = last line of chunk)
        });
      }

      // Overlap: carry last few lines into next chunk
      const overlapLines: string[] = [];
      let overlapLen = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        overlapLen += currentChunk[j].length + 1;
        if (overlapLen > overlapChars) break;
        overlapLines.unshift(currentChunk[j]);
      }

      currentChunk = [...overlapLines, line];
      currentStartLine = i - overlapLines.length;
      currentLength = overlapLen + lineLen;
      continue;
    }

    currentChunk.push(line);
    currentLength += lineLen;

    // Split at max size on paragraph boundaries
    if (currentLength >= maxChars) {
      chunks.push({
        text: currentChunk.join("\n").trim(),
        startLine: currentStartLine + 1,
        endLine: i + 1,
      });

      const overlapLines: string[] = [];
      let overlapLen = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        overlapLen += currentChunk[j].length + 1;
        if (overlapLen > overlapChars) break;
        overlapLines.unshift(currentChunk[j]);
      }

      currentChunk = [...overlapLines];
      currentStartLine = i + 1 - overlapLines.length;
      currentLength = overlapLen;
    }
  }

  // Final chunk
  if (currentChunk.length > 0) {
    const text = currentChunk.join("\n").trim();
    if (text) {
      chunks.push({
        text,
        startLine: currentStartLine + 1,
        endLine: lines.length,
      });
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Content hashing (fast, not cryptographic — just for change detection)
// ---------------------------------------------------------------------------

function quickHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Store management
// ---------------------------------------------------------------------------

async function loadStore(): Promise<EmbeddingsStore> {
  try {
    const raw = await readFile(EMBEDDINGS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      version: 1,
      model: VOYAGE_MODEL,
      updatedAt: new Date().toISOString(),
      files: {},
    };
  }
}

async function saveStore(store: EmbeddingsStore): Promise<void> {
  store.updatedAt = new Date().toISOString();
  await writeFile(EMBEDDINGS_PATH, JSON.stringify(store), "utf-8");
}

// ---------------------------------------------------------------------------
// Sync: scan memory files, embed new/changed ones
// ---------------------------------------------------------------------------

export async function syncEmbeddings(): Promise<{
  added: number;
  unchanged: number;
  removed: number;
}> {
  const store = await loadStore();

  // Scan all .md files in memory dir + ~/MEMORY.md
  const memoryFiles: Array<{ path: string; content: string }> = [];

  // ~/MEMORY.md
  try {
    const content = await readFile(join(homedir(), "MEMORY.md"), "utf-8");
    if (content.trim()) {
      memoryFiles.push({ path: "MEMORY.md", content });
    }
  } catch {
    // No MEMORY.md yet
  }

  // ~/memory/*.md (not transcripts, not .embeddings)
  try {
    const entries = await readdir(MEMORY_DIR);
    for (const entry of entries) {
      if (
        entry.endsWith(".md") &&
        !entry.startsWith(".") &&
        entry !== "transcripts"
      ) {
        const fullPath = join(MEMORY_DIR, entry);
        const content = await readFile(fullPath, "utf-8");
        if (content.trim()) {
          memoryFiles.push({ path: `memory/${entry}`, content });
        }
      }
    }
  } catch {
    // No memory dir yet
  }

  // Diff against store
  const currentPaths = new Set(memoryFiles.map((f) => f.path));
  const toEmbed: Array<{
    path: string;
    content: string;
    chunks: Array<{ text: string; startLine: number; endLine: number }>;
  }> = [];

  let unchanged = 0;

  for (const file of memoryFiles) {
    const hash = quickHash(file.content);
    const existing = store.files[file.path];

    if (existing && existing.hash === hash) {
      unchanged++;
      continue;
    }

    const chunks = chunkMarkdown(file.content);
    toEmbed.push({ path: file.path, content: file.content, chunks });
  }

  // Remove deleted files
  const removedPaths = Object.keys(store.files).filter(
    (p) => !currentPaths.has(p),
  );
  for (const p of removedPaths) {
    delete store.files[p];
  }

  // Embed new/changed chunks
  if (toEmbed.length > 0) {
    const allChunkTexts = toEmbed.flatMap((f) => f.chunks.map((c) => c.text));

    if (allChunkTexts.length > 0) {
      console.log(
        `[vectors] Embedding ${allChunkTexts.length} chunks from ${toEmbed.length} files...`,
      );
      const embeddings = await embedTexts(allChunkTexts);

      let embedIdx = 0;
      for (const file of toEmbed) {
        const fileChunks: Chunk[] = [];
        for (const chunk of file.chunks) {
          fileChunks.push({
            text: chunk.text,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            embedding: embeddings[embedIdx++],
          });
        }

        store.files[file.path] = {
          path: file.path,
          hash: quickHash(file.content),
          chunks: fileChunks,
        };
      }
    }
  }

  await saveStore(store);

  return {
    added: toEmbed.length,
    unchanged,
    removed: removedPaths.length,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchMemory(
  queryText: string,
  maxResults: number = 6,
  minScore: number = 0.3,
): Promise<SearchResult[]> {
  // Sync first (only embeds new/changed files)
  await syncEmbeddings();

  const store = await loadStore();
  const queryEmbedding = await embedQuery(queryText);

  // Score every chunk
  const scored: SearchResult[] = [];

  for (const file of Object.values(store.files)) {
    for (const chunk of file.chunks) {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        scored.push({
          path: file.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          snippet: chunk.text.slice(0, 300),
          score,
        });
      }
    }
  }

  // Sort by score, return top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}
