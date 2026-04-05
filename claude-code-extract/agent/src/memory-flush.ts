/**
 * Memory flush — extracts important context from transcripts into daily memory.
 *
 * Modeled after OpenClaw's pre-compaction memory flush:
 *   Before context compaction, the agent writes durable memories to disk.
 *
 * We implement two triggers:
 *   1. On compaction boundary (SDK emits SystemMessage subtype "compact_boundary")
 *   2. On session end (graceful shutdown or explicit /flush)
 *
 * The flush reads today's transcript and asks Claude to extract key memories,
 * then appends them to ~/memory/YYYY-MM-DD.md.
 */

import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveBaseDir, resolveMemoryDir } from "./system-prompt.js";

// ---------------------------------------------------------------------------
// Read today's transcript
// ---------------------------------------------------------------------------

async function readTodayTranscript(): Promise<string | null> {
  const date = new Date().toISOString().split("T")[0];
  const path = join(resolveMemoryDir(), "transcripts", `${date}.jsonl`);

  try {
    const raw = await readFile(path, "utf-8");
    const lines = raw.trim().split("\n");

    // Build a readable summary of the conversation
    const summary: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const time = entry.timestamp?.slice(11, 16) ?? "??:??";
        switch (entry.role) {
          case "user":
            summary.push(`[${time}] User: ${truncate(entry.content, 300)}`);
            break;
          case "assistant":
            summary.push(
              `[${time}] Assistant: ${truncate(entry.content, 300)}`,
            );
            break;
          case "tool_use":
            summary.push(`[${time}] Tool: ${entry.content}`);
            break;
          case "system":
            summary.push(`[${time}] System: ${entry.content}`);
            break;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return summary.length > 0 ? summary.join("\n") : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build the flush prompt — sent to the agent to extract memories
// ---------------------------------------------------------------------------

export function buildFlushPrompt(transcript: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `You are performing a memory flush. Review this conversation transcript from today and extract the most important information to preserve.

Write a concise summary to ${resolveMemoryDir()}/${date}.md. Focus on:
- Decisions made and their reasoning
- New information learned about the user's preferences or workflow
- Technical discoveries, bugs found, solutions that worked
- Project context that future sessions should know about
- Anything the user explicitly asked to remember

Format as markdown with sections. APPEND to the file (don't overwrite existing content).
If there's nothing worth remembering, say so and don't write anything.

<transcript>
${transcript}
</transcript>

Write the memory file now using the Write or Edit tool.`;
}

// ---------------------------------------------------------------------------
// Check if flush is needed (avoid duplicate flushes)
// ---------------------------------------------------------------------------

let lastFlushTimestamp = 0;
const MIN_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes minimum between flushes

export async function shouldFlush(): Promise<{
  needed: boolean;
  transcript: string | null;
}> {
  const now = Date.now();
  if (now - lastFlushTimestamp < MIN_FLUSH_INTERVAL_MS) {
    return { needed: false, transcript: null };
  }

  const transcript = await readTodayTranscript();
  if (!transcript || transcript.split("\n").length < 4) {
    return { needed: false, transcript: null };
  }

  return { needed: true, transcript };
}

export function markFlushed(): void {
  lastFlushTimestamp = Date.now();
}

// ---------------------------------------------------------------------------
// Ensure memory dir exists
// ---------------------------------------------------------------------------

export async function ensureMemoryDir(): Promise<void> {
  await mkdir(resolveMemoryDir(), { recursive: true });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
