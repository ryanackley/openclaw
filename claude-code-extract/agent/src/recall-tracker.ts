/**
 * Short-term recall tracker — records every memory search hit.
 *
 * Mirrors OpenClaw's short-term-recall.json store. Every time a memory search
 * returns results, we record: which chunk was found, the query that found it,
 * the score, and when. This data feeds the dreaming promotion algorithm.
 *
 * Storage: ~/memory/.dreams/short-term-recall.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { resolveMemoryDir } from "./system-prompt.js";
import type { SearchResult } from "./vector-search.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function dreamsDir(): string {
  return join(resolveMemoryDir(), ".dreams");
}

function recallPath(): string {
  return join(dreamsDir(), "short-term-recall.json");
}

// ---------------------------------------------------------------------------
// Types — matches OpenClaw's ShortTermRecallEntry
// ---------------------------------------------------------------------------

export interface RecallEntry {
  /** Unique key: "memory:{path}:{startLine}:{endLine}" */
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  /** How many times this chunk has been recalled */
  recallCount: number;
  /** Sum of all search scores */
  totalScore: number;
  /** Highest search score ever seen */
  maxScore: number;
  firstRecalledAt: string;
  lastRecalledAt: string;
  /** SHA-1 hashes of queries (max 32, for diversity tracking) */
  queryHashes: string[];
  /** ISO dates when recalled (max 16, for consolidation tracking) */
  recallDays: string[];
  /** Derived concept tags (max 6) */
  conceptTags: string[];
  /** Set when promoted to MEMORY.md */
  promotedAt?: string;
}

interface RecallStore {
  version: 1;
  updatedAt: string;
  entries: Record<string, RecallEntry>;
}

// ---------------------------------------------------------------------------
// Store I/O
// ---------------------------------------------------------------------------

async function ensureDir(): Promise<void> {
  await mkdir(dreamsDir(), { recursive: true });
}

export async function loadRecallStore(): Promise<RecallStore> {
  try {
    const raw = await readFile(recallPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: {},
    };
  }
}

async function saveRecallStore(store: RecallStore): Promise<void> {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await writeFile(recallPath(), JSON.stringify(store, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Query hashing (for diversity tracking)
// ---------------------------------------------------------------------------

function hashQuery(query: string): string {
  return createHash("sha1")
    .update(query.trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Extract concept tags from a snippet (simple keyword extraction)
// ---------------------------------------------------------------------------

function extractConceptTags(snippet: string): string[] {
  // Extract heading-like concepts and key terms
  const tags = new Set<string>();

  // Markdown headings
  const headings = snippet.match(/^#+\s+(.+)$/gm);
  if (headings) {
    for (const h of headings) {
      const text = h.replace(/^#+\s+/, "").trim().toLowerCase();
      if (text.length > 2 && text.length < 40) tags.add(text);
    }
  }

  // Bold terms
  const bold = snippet.match(/\*\*([^*]+)\*\*/g);
  if (bold) {
    for (const b of bold) {
      const text = b.replace(/\*\*/g, "").trim().toLowerCase();
      if (text.length > 2 && text.length < 30) tags.add(text);
    }
  }

  return Array.from(tags).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Public API: record recall hits from a search
// ---------------------------------------------------------------------------

export async function recordRecalls(
  query: string,
  results: SearchResult[],
): Promise<void> {
  if (results.length === 0) return;

  const store = await loadRecallStore();
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const qHash = hashQuery(query);

  for (const result of results) {
    const key = `memory:${result.path}:${result.startLine}:${result.endLine}`;

    const existing = store.entries[key];

    if (existing) {
      // Update existing entry
      existing.recallCount++;
      existing.totalScore += result.score;
      existing.maxScore = Math.max(existing.maxScore, result.score);
      existing.lastRecalledAt = now;

      // Add query hash if not seen (max 32)
      if (
        !existing.queryHashes.includes(qHash) &&
        existing.queryHashes.length < 32
      ) {
        existing.queryHashes.push(qHash);
      }

      // Add recall day if not seen (max 16)
      if (
        !existing.recallDays.includes(today) &&
        existing.recallDays.length < 16
      ) {
        existing.recallDays.push(today);
      }
    } else {
      // New entry
      store.entries[key] = {
        key,
        path: result.path,
        startLine: result.startLine,
        endLine: result.endLine,
        snippet: result.snippet.replace(/\n/g, " ").slice(0, 200),
        recallCount: 1,
        totalScore: result.score,
        maxScore: result.score,
        firstRecalledAt: now,
        lastRecalledAt: now,
        queryHashes: [qHash],
        recallDays: [today],
        conceptTags: extractConceptTags(result.snippet),
      };
    }
  }

  await saveRecallStore(store);
}
