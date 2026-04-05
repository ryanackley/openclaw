/**
 * Dreaming — automated memory promotion and curation.
 *
 * Two-phase operation:
 *
 *   Phase 1 (rank): Score recall entries using a weighted algorithm.
 *     Select candidates that pass quality thresholds.
 *
 *   Phase 2 (curate): Send current MEMORY.md + new candidates to an LLM
 *     and ask it to produce a curated version — deduplicating, consolidating
 *     related entries, removing stale content, and organizing by topic.
 *
 * The curation pass uses Claude via the Anthropic API directly (not the agent
 * loop) — it's a focused, single-turn rewrite task.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveBaseDir, resolveMemoryDir } from "./system-prompt.js";
import {
  loadRecallStore,
  type RecallEntry,
} from "./recall-tracker.js";

// ---------------------------------------------------------------------------
// Config — paths derived from OPENCLAW_DIR
// ---------------------------------------------------------------------------

function memoryPath(): string {
  return join(resolveBaseDir(), "MEMORY.md");
}

function recallStorePath(): string {
  return join(resolveMemoryDir(), ".dreams", "short-term-recall.json");
}

const WEIGHTS = {
  frequency: 0.24,
  relevance: 0.30,
  diversity: 0.15,
  recency: 0.15,
  consolidation: 0.10,
  conceptual: 0.06,
} as const;

const THRESHOLDS = {
  minRecallCount: 3,
  minAvgScore: 0.75,
  minUniqueQueries: 2,
  maxPromotionsPerRun: 10,
} as const;

const HALF_LIFE_DAYS = 14;

// ---------------------------------------------------------------------------
// Scoring components — each returns [0, 1]
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function scoreFrequency(entry: RecallEntry): number {
  return clamp01(Math.log(entry.recallCount) / Math.log(10));
}

function scoreRelevance(entry: RecallEntry): number {
  const avg = entry.totalScore / entry.recallCount;
  return clamp01(avg);
}

function scoreDiversity(entry: RecallEntry): number {
  return clamp01(entry.queryHashes.length / 5);
}

function scoreRecency(entry: RecallEntry): number {
  const lambda = Math.LN2 / HALF_LIFE_DAYS;
  const lastRecall = new Date(entry.lastRecalledAt).getTime();
  const daysSince = (Date.now() - lastRecall) / (1000 * 60 * 60 * 24);
  return clamp01(Math.exp(-lambda * daysSince));
}

function scoreConsolidation(entry: RecallEntry): number {
  const count = entry.recallDays.length;
  if (count <= 1) return 0.2;
  const spacing = clamp01(Math.log(count) / Math.log(5));
  const days = entry.recallDays.map((d) => new Date(d).getTime()).sort();
  const spanDays = (days[days.length - 1] - days[0]) / (1000 * 60 * 60 * 24);
  const span = clamp01(spanDays / 7);
  return 0.55 * spacing + 0.45 * span;
}

function scoreConceptual(entry: RecallEntry): number {
  return clamp01(entry.conceptTags.length / 6);
}

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

export interface RankedCandidate {
  entry: RecallEntry;
  score: number;
  components: {
    frequency: number;
    relevance: number;
    diversity: number;
    recency: number;
    consolidation: number;
    conceptual: number;
  };
}

function rankEntry(entry: RecallEntry): RankedCandidate {
  const components = {
    frequency: scoreFrequency(entry),
    relevance: scoreRelevance(entry),
    diversity: scoreDiversity(entry),
    recency: scoreRecency(entry),
    consolidation: scoreConsolidation(entry),
    conceptual: scoreConceptual(entry),
  };

  const score =
    WEIGHTS.frequency * components.frequency +
    WEIGHTS.relevance * components.relevance +
    WEIGHTS.diversity * components.diversity +
    WEIGHTS.recency * components.recency +
    WEIGHTS.consolidation * components.consolidation +
    WEIGHTS.conceptual * components.conceptual;

  return { entry, score, components };
}

// ---------------------------------------------------------------------------
// Phase 1: Filter + rank candidates
// ---------------------------------------------------------------------------

export function rankCandidates(
  entries: Record<string, RecallEntry>,
): RankedCandidate[] {
  const candidates: RankedCandidate[] = [];

  for (const entry of Object.values(entries)) {
    if (entry.promotedAt) continue;
    if (entry.recallCount < THRESHOLDS.minRecallCount) continue;
    const avgScore = entry.totalScore / entry.recallCount;
    if (avgScore < THRESHOLDS.minAvgScore) continue;
    if (entry.queryHashes.length < THRESHOLDS.minUniqueQueries) continue;
    candidates.push(rankEntry(entry));
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, THRESHOLDS.maxPromotionsPerRun);
}

// ---------------------------------------------------------------------------
// Phase 2: LLM curation — rewrite MEMORY.md with new entries integrated
// ---------------------------------------------------------------------------

const CURATION_PROMPT = `You are a memory curator. You maintain a long-term memory file (MEMORY.md) for a personal AI assistant.

You will be given:
1. The current contents of MEMORY.md
2. New memory candidates that scored highly in the recall system

Your job is to produce an updated MEMORY.md that:

**Integrate new entries:**
- Merge new candidates into the appropriate sections
- Don't just append — weave them into existing structure

**Deduplicate:**
- If the same insight appears in different wordings, keep the best version
- Combine related entries into single, richer entries

**Remove stale content:**
- Remove entries that are clearly outdated (old project context, resolved bugs, deprecated preferences)
- Remove low-value entries (trivial facts, one-off context that won't matter again)

**Consolidate:**
- Group related memories under clear topic headings
- Prefer fewer, denser entries over many sparse ones
- A single well-written paragraph beats five bullet points saying the same thing

**Organize:**
- Structure by topic (About Me, Preferences, Lessons Learned, Project Context, Technical Notes, etc.)
- NOT by date promoted — that's an implementation detail, not useful structure
- Keep the most important/frequently-used info near the top

**Preserve:**
- User preferences and working style (these rarely go stale)
- Hard-won lessons and debugging insights
- Relationship context (what projects we work on, communication style)

**Format:**
- Clean markdown with ## headings for sections
- Concise bullet points or short paragraphs
- No metadata annotations (no [score=..., recalls=..., source=...])
- No "Promoted From Short-Term Memory (date)" sections

Return ONLY the new MEMORY.md content. No explanation, no preamble.`;

async function curateMemory(
  currentMemory: string,
  candidates: RankedCandidate[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — cannot run LLM curation");
  }

  const candidateText = candidates
    .map(
      (c) =>
        `- ${c.entry.snippet} (recalled ${c.entry.recallCount} times, ` +
        `avg score ${(c.entry.totalScore / c.entry.recallCount).toFixed(2)}, ` +
        `from ${c.entry.path})`,
    )
    .join("\n");

  const userMessage =
    `## Current MEMORY.md\n\n${currentMemory || "(empty — this is a fresh start)"}\n\n` +
    `## New Memory Candidates\n\n${candidateText}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: CURATION_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return text;
}

// ---------------------------------------------------------------------------
// Full dream cycle: rank → curate → write
// ---------------------------------------------------------------------------

export interface DreamResult {
  promoted: number;
  candidates: number;
  curated: boolean;
  entries: Array<{
    snippet: string;
    score: number;
    recalls: number;
    source: string;
  }>;
}

export async function dream(): Promise<DreamResult> {
  const store = await loadRecallStore();
  const candidates = rankCandidates(store.entries);

  if (candidates.length === 0) {
    return { promoted: 0, candidates: 0, curated: false, entries: [] };
  }

  // Read current MEMORY.md
  let currentMemory = "";
  try {
    currentMemory = await readFile(memoryPath(), "utf-8");
  } catch {
    // No MEMORY.md yet
  }

  // Build result metadata
  const promotedEntries: DreamResult["entries"] = candidates.map((c) => ({
    snippet: c.entry.snippet,
    score: c.score,
    recalls: c.entry.recallCount,
    source: `${c.entry.path}:${c.entry.startLine}-${c.entry.endLine}`,
  }));

  // Try LLM curation; fall back to raw append if no API key
  let curated = false;
  try {
    const newMemory = await curateMemory(currentMemory, candidates);

    // Safety: backup before overwriting
    if (currentMemory) {
      const backupPath = memoryPath() + ".bak";
      await writeFile(backupPath, currentMemory, "utf-8");
    }

    await writeFile(memoryPath(), newMemory, "utf-8");
    curated = true;
    console.log("[dreaming] MEMORY.md curated and rewritten by LLM");
  } catch (err) {
    // Fall back to raw append
    console.warn(
      "[dreaming] LLM curation failed, falling back to append:",
      err instanceof Error ? err.message : err,
    );
    const date = new Date().toISOString().split("T")[0];
    const lines = [
      "",
      `## Promoted From Short-Term Memory (${date})`,
      "",
      ...candidates.map((c) => `- ${c.entry.snippet}`),
      "",
    ];
    const { appendFile } = await import("node:fs/promises");
    await appendFile(memoryPath(), lines.join("\n"), "utf-8");
  }

  // Mark candidates as promoted
  const now = new Date().toISOString();
  for (const candidate of candidates) {
    candidate.entry.promotedAt = now;
  }

  // Save updated recall store
  store.updatedAt = now;
  await writeFile(recallStorePath(), JSON.stringify(store, null, 2), "utf-8");

  console.log(
    `[dreaming] Promoted ${candidates.length} memories to MEMORY.md` +
      (curated ? " (curated)" : " (appended)"),
  );

  return {
    promoted: candidates.length,
    candidates: Object.values(store.entries).filter((e) => !e.promotedAt)
      .length,
    curated,
    entries: promotedEntries,
  };
}

// ---------------------------------------------------------------------------
// Standalone curation — reorganize MEMORY.md without new promotions
// ---------------------------------------------------------------------------

export async function curateOnly(): Promise<{
  success: boolean;
  error?: string;
}> {
  let currentMemory: string;
  try {
    currentMemory = await readFile(memoryPath(), "utf-8");
  } catch {
    return { success: false, error: "~/MEMORY.md does not exist" };
  }

  if (!currentMemory.trim()) {
    return { success: false, error: "~/MEMORY.md is empty" };
  }

  try {
    // Curate with empty candidates — pure reorganization/cleanup
    const newMemory = await curateMemory(currentMemory, []);

    // Backup
    await writeFile(memoryPath() + ".bak", currentMemory, "utf-8");
    await writeFile(memoryPath(), newMemory, "utf-8");

    console.log("[dreaming] MEMORY.md curated (reorganization only)");
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Dreaming scheduler — targets a specific hour (default: 3 AM local time)
// ---------------------------------------------------------------------------

let dreamTimeout: ReturnType<typeof setTimeout> | null = null;

/** Calculate ms until the next occurrence of `hour:00` in local time */
function msUntilNextHour(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);

  // If that time already passed today, schedule for tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

function formatMs(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function scheduleDream(hour: number): void {
  const ms = msUntilNextHour(hour);
  console.log(
    `[dreaming] Next dream scheduled for ${hour}:00 (in ${formatMs(ms)})`,
  );

  dreamTimeout = setTimeout(async () => {
    try {
      const result = await dream();
      if (result.promoted > 0) {
        console.log(
          `[dreaming] Promoted ${result.promoted} memories` +
            (result.curated ? " (curated)" : " (appended)") +
            `, ${result.candidates} candidates remaining`,
        );
      } else {
        console.log("[dreaming] No candidates ready for promotion");
      }
    } catch (err) {
      console.error("[dreaming] Error:", err);
    }

    // Schedule the next one (tomorrow at the same hour)
    scheduleDream(hour);
  }, ms);

  dreamTimeout.unref();
}

export function startDreamingSchedule(hour: number = 3): void {
  if (dreamTimeout) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`[dreaming] Dreaming scheduled daily at ${hour}:00 (${tz})`);
  scheduleDream(hour);
}

export function stopDreamingSchedule(): void {
  if (dreamTimeout) {
    clearTimeout(dreamTimeout);
    dreamTimeout = null;
  }
}
