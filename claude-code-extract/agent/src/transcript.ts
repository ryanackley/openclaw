/**
 * Session transcript logger — appends every message to a daily JSONL file.
 *
 * Modeled after OpenClaw's session persistence:
 *   ~/.openclaw/sessions/{agentId}/{sessionId}.jsonl
 *
 * We simplify to a daily log file since we have one agent:
 *   ~/memory/transcripts/YYYY-MM-DD.jsonl
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TRANSCRIPT_DIR = join(homedir(), "memory", "transcripts");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  timestamp: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ensure directory exists (called once at startup)
// ---------------------------------------------------------------------------

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(TRANSCRIPT_DIR, { recursive: true });
  dirReady = true;
}

// ---------------------------------------------------------------------------
// Get today's transcript file path
// ---------------------------------------------------------------------------

function todayPath(): string {
  const date = new Date().toISOString().split("T")[0];
  return join(TRANSCRIPT_DIR, `${date}.jsonl`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function logEntry(entry: TranscriptEntry): Promise<void> {
  await ensureDir();
  const line = JSON.stringify(entry) + "\n";
  await appendFile(todayPath(), line, "utf-8");
}

export async function logUserMessage(message: string): Promise<void> {
  await logEntry({
    timestamp: new Date().toISOString(),
    role: "user",
    content: message,
  });
}

export async function logAssistantMessage(message: string): Promise<void> {
  await logEntry({
    timestamp: new Date().toISOString(),
    role: "assistant",
    content: message,
  });
}

export async function logToolUse(
  toolName: string,
  toolId: string,
  input?: Record<string, unknown>,
): Promise<void> {
  await logEntry({
    timestamp: new Date().toISOString(),
    role: "tool_use",
    content: toolName,
    metadata: { toolId, input: summarizeInput(input) },
  });
}

export async function logToolResult(
  toolId: string,
  result: string,
): Promise<void> {
  await logEntry({
    timestamp: new Date().toISOString(),
    role: "tool_result",
    content: result,
    metadata: { toolId },
  });
}

export async function logSystemEvent(event: string): Promise<void> {
  await logEntry({
    timestamp: new Date().toISOString(),
    role: "system",
    content: event,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Summarize tool input to avoid logging huge file contents */
function summarizeInput(
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!input) return undefined;

  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 500) {
      summary[key] = value.slice(0, 500) + `... (${value.length} chars)`;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}
