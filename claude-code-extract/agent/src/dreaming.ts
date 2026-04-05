/**
 * Dreaming — automated memory promotion.
 *
 * Replicates OpenClaw's nightly dreaming system. Ranks short-term recall
 * entries using a weighted algorithm and promotes the top candidates
 * to ~/MEMORY.md.
 *
 * Weights (matching OpenClaw):
 *   frequency:     0.24  — log(recallCount) / log(10)
 *   relevance:     0.30  — average search score
 *   diversity:     0.15  — unique queries / 5
 *   recency:       0.15  — exponential decay (14-day half-life)
 *   consolidation: 0.10  — spaced recall across days
 *   conceptual:    0.06  — concept tag breadth
 *
 * Candidates must pass:
 *   recallCount >= 3
 *   avgScore >= 0.75
 *   uniqueQueries >= 2
 *   not already promoted
 */

import { readFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadRecallStore,
  type RecallEntry,
} from "./recall-tracker.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MEMORY_PATH = join(homedir(), "MEMORY.md");
const RECALL_PATH = join(homedir(), "memory", ".dreams", "short-term-recall.json");

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
  // log(recallCount) / log(10) — reaches 1.0 at 10 recalls
  return clamp01(Math.log(entry.recallCount) / Math.log(10));
}

function scoreRelevance(entry: RecallEntry): number {
  // Average search score across all recalls
  const avg = entry.totalScore / entry.recallCount;
  return clamp01(avg);
}

function scoreDiversity(entry: RecallEntry): number {
  // Unique queries that found this / 5
  return clamp01(entry.queryHashes.length / 5);
}

function scoreRecency(entry: RecallEntry): number {
  // Exponential decay: e^(-lambda * daysSinceLastRecall)
  const lambda = Math.LN2 / HALF_LIFE_DAYS;
  const lastRecall = new Date(entry.lastRecalledAt).getTime();
  const now = Date.now();
  const daysSince = (now - lastRecall) / (1000 * 60 * 60 * 24);
  return clamp01(Math.exp(-lambda * daysSince));
}

function scoreConsolidation(entry: RecallEntry): number {
  // How spread out the recalls are across days
  const count = entry.recallDays.length;
  if (count <= 1) return 0.2;

  // Spacing: log(count) / log(5) — how many distinct days
  const spacing = clamp01(Math.log(count) / Math.log(5));

  // Span: days between first and last recall / 7
  const days = entry.recallDays.map((d) => new Date(d).getTime()).sort();
  const spanDays = (days[days.length - 1] - days[0]) / (1000 * 60 * 60 * 24);
  const span = clamp01(spanDays / 7);

  return 0.55 * spacing + 0.45 * span;
}

function scoreConceptual(entry: RecallEntry): number {
  // Concept tag breadth / 6
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
// Filter + rank candidates
// ---------------------------------------------------------------------------

export function rankCandidates(
  entries: Record<string, RecallEntry>,
): RankedCandidate[] {
  const candidates: RankedCandidate[] = [];

  for (const entry of Object.values(entries)) {
    // Skip already promoted
    if (entry.promotedAt) continue;

    // Must meet minimum thresholds
    if (entry.recallCount < THRESHOLDS.minRecallCount) continue;

    const avgScore = entry.totalScore / entry.recallCount;
    if (avgScore < THRESHOLDS.minAvgScore) continue;

    if (entry.queryHashes.length < THRESHOLDS.minUniqueQueries) continue;

    candidates.push(rankEntry(entry));
  }

  // Sort descending by composite score
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, THRESHOLDS.maxPromotionsPerRun);
}

// ---------------------------------------------------------------------------
// Apply promotions — append to MEMORY.md and mark entries
// ---------------------------------------------------------------------------

export interface DreamResult {
  promoted: number;
  candidates: number;
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
    return { promoted: 0, candidates: 0, entries: [] };
  }

  // Build the promotion block
  const date = new Date().toISOString().split("T")[0];
  const lines: string[] = [
    "",
    `## Promoted From Short-Term Memory (${date})`,
    "",
  ];

  const promotedEntries: DreamResult["entries"] = [];

  for (const candidate of candidates) {
    const { entry, score } = candidate;
    const avgScore = (entry.totalScore / entry.recallCount).toFixed(3);

    lines.push(
      `- ${entry.snippet} ` +
        `[score=${score.toFixed(3)} recalls=${entry.recallCount} ` +
        `avg=${avgScore} source=${entry.path}:${entry.startLine}-${entry.endLine}]`,
    );

    promotedEntries.push({
      snippet: entry.snippet,
      score,
      recalls: entry.recallCount,
      source: `${entry.path}:${entry.startLine}-${entry.endLine}`,
    });

    // Mark as promoted in the store
    entry.promotedAt = new Date().toISOString();
  }

  lines.push("");

  // Append to MEMORY.md
  await appendFile(MEMORY_PATH, lines.join("\n"), "utf-8");

  // Save updated store (with promotedAt markers)
  const { writeFile } = await import("node:fs/promises");
  store.updatedAt = new Date().toISOString();
  await writeFile(
    join(homedir(), "memory", ".dreams", "short-term-recall.json"),
    JSON.stringify(store, null, 2),
    "utf-8",
  );

  console.log(
    `[dreaming] Promoted ${candidates.length} memories to MEMORY.md`,
  );

  return {
    promoted: candidates.length,
    candidates: Object.values(store.entries).filter((e) => !e.promotedAt)
      .length,
    entries: promotedEntries,
  };
}

// ---------------------------------------------------------------------------
// Dreaming timer — runs on an interval (default: every 6 hours)
// ---------------------------------------------------------------------------

let dreamInterval: ReturnType<typeof setInterval> | null = null;

export function startDreamingTimer(
  intervalMs: number = 6 * 60 * 60 * 1000,
): void {
  if (dreamInterval) return;

  console.log(
    `[dreaming] Started dreaming timer (every ${(intervalMs / 3600000).toFixed(1)}h)`,
  );

  dreamInterval = setInterval(async () => {
    try {
      const result = await dream();
      if (result.promoted > 0) {
        console.log(
          `[dreaming] Promoted ${result.promoted} memories, ` +
            `${result.candidates} candidates remaining`,
        );
      }
    } catch (err) {
      console.error("[dreaming] Error:", err);
    }
  }, intervalMs);

  // Don't keep the process alive just for dreaming
  dreamInterval.unref();
}

export function stopDreamingTimer(): void {
  if (dreamInterval) {
    clearInterval(dreamInterval);
    dreamInterval = null;
  }
}
