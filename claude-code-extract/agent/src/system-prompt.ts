/**
 * System prompt construction — loads OpenClaw workspace context files
 * and assembles them into the system prompt.
 *
 * Context files loaded (in order, all optional):
 *   CLAUDE.md   — agent instructions and personality (was AGENTS.md)
 *   SOUL.md     — persona and tone
 *   IDENTITY.md — who the agent is to the user
 *   USER.md     — user profile and preferences
 *   TOOLS.md    — tool-specific guidance and notes
 *   HEARTBEAT.md — background tasks and check-in guidance
 *   MEMORY.md   — long-term curated memory
 *
 * Base directory: OPENCLAW_DIR env var, or ~/.openclaw
 * Memory directory: <baseDir>/memory/
 */

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Base directory resolution
// ---------------------------------------------------------------------------

export function resolveBaseDir(): string {
  return process.env.OPENCLAW_DIR ?? join(homedir(), ".openclaw");
}

export function resolveMemoryDir(): string {
  return join(resolveBaseDir(), "memory");
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Load a context file, return null if missing or empty */
async function loadContextFile(
  baseDir: string,
  filename: string,
): Promise<{ name: string; content: string } | null> {
  const content = await tryReadFile(join(baseDir, filename));
  if (!content?.trim()) return null;
  return { name: filename, content: content.trim() };
}

// ---------------------------------------------------------------------------
// Context files — OpenClaw workspace files
// ---------------------------------------------------------------------------

/**
 * The context files that OpenClaw loads, in prompt order.
 * Each gets its own tagged section in the system prompt.
 */
const CONTEXT_FILES = [
  { file: "CLAUDE.md", tag: "claude", label: "Agent Instructions" },
  { file: "SOUL.md", tag: "soul", label: "Persona" },
  { file: "IDENTITY.md", tag: "identity", label: "Identity" },
  { file: "USER.md", tag: "user", label: "User Profile" },
  { file: "TOOLS.md", tag: "tools", label: "Tool Guidance" },
  { file: "HEARTBEAT.md", tag: "heartbeat", label: "Heartbeat" },
] as const;

async function buildContextSections(baseDir: string): Promise<string[]> {
  const sections: string[] = [];

  for (const { file, tag, label } of CONTEXT_FILES) {
    const loaded = await loadContextFile(baseDir, file);
    if (loaded) {
      // CLAUDE.md and SOUL.md get special handling
      if (file === "SOUL.md") {
        sections.push(
          `## Persona\n\n` +
            `Embody this persona and tone. Avoid stiff, generic replies; ` +
            `follow its guidance unless higher-priority instructions override it.\n\n` +
            `<${tag}>\n${loaded.content}\n</${tag}>`,
        );
      } else if (file === "CLAUDE.md") {
        // CLAUDE.md IS the core personality — inject directly, not wrapped
        sections.push(
          `## Agent Instructions (from CLAUDE.md)\n\n` +
            `<${tag}>\n${loaded.content}\n</${tag}>`,
        );
      } else {
        sections.push(
          `## ${label} (from ${file})\n\n` +
            `<${tag}>\n${loaded.content}\n</${tag}>`,
        );
      }
      console.log(`[prompt] Loaded ${file} (${loaded.content.length} chars)`);
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Memory sections
// ---------------------------------------------------------------------------

async function buildMemoryContext(baseDir: string): Promise<string> {
  const content = await tryReadFile(join(baseDir, "MEMORY.md"));
  if (!content?.trim()) return "";

  return `## Long-Term Memory (from MEMORY.md)\n\n<memory>\n${content.trim()}\n</memory>`;
}

async function buildRecentDailyMemory(memDir: string): Promise<string> {
  const today = new Date();
  const entries: string[] = [];

  // Load last 3 days of daily memory
  for (let i = 0; i < 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const content = await tryReadFile(join(memDir, `${dateStr}.md`));
    if (content?.trim()) {
      entries.push(content.trim());
    }
  }

  if (entries.length === 0) return "";

  return (
    `## Recent Session Memory\n\n` +
    `<recent_memory>\n${entries.join("\n\n---\n\n")}\n</recent_memory>`
  );
}

// ---------------------------------------------------------------------------
// Static sections
// ---------------------------------------------------------------------------

function buildIdentity(): string {
  return `You are a personal assistant running inside OpenClaw Agent.`;
}

function buildSafety(): string {
  return `## Safety

You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.
Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.

### Filesystem boundaries
- NEVER read or write files in: ~/.ssh, ~/.gnupg, ~/.aws, ~/.docker, ~/.config/gcloud, /etc, /proc, /sys, /dev, /boot, /var/run
- NEVER execute destructive system commands (rm -rf /, mkfs, dd if=/dev/zero, fork bombs)
- NEVER set dangerous environment variables (LD_PRELOAD, DYLD_*, BASH_ENV, PYTHONSTARTUP)
- When in doubt about a path or command, ask the user first.`;
}

function buildToolStyle(): string {
  return `## Tool Call Style

Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g. deletions), or when the user explicitly asks.
Keep narration brief and value-dense; avoid repeating obvious steps.
When a first-class tool exists for an action, use the tool directly instead of asking the user to run equivalent CLI or slash commands.`;
}

function buildWorkspace(baseDir: string): string {
  const cwd = process.cwd();
  return `## Workspace

Your working directory is: ${cwd}
OpenClaw directory: ${baseDir}
You may read and write files within this directory, the OpenClaw directory, and the user's home.`;
}

function buildMemoryGuidance(baseDir: string, memDir: string): string {
  return `## Memory System

You have a two-tier memory system. All memory files live under: ${baseDir}

### Long-term memory
${baseDir}/MEMORY.md contains curated insights, preferences, and lessons learned across sessions.
Read it at the start of every session. Update it when you learn something important.

### Daily memory
${memDir}/YYYY-MM-DD.md files contain session notes, decisions, and context.
When the user says "remember this" or you encounter important context, write to today's file.

### Searching memory
Use the **mcp__memory__search** tool for semantic search over all memory files.
It uses Voyage AI embeddings to find relevant content even when exact keywords don't match.
Fall back to Grep for exact-match searches or when the memory tool is unavailable.
Always check memory before saying "I don't know" about something you might have discussed before.

After writing new memory files, call **mcp__memory__sync** to re-index them.

### Dreaming (automatic promotion)
Every memory search is tracked. When a memory chunk is recalled 3+ times with
high scores from multiple unique queries, the dreaming system automatically
promotes it to MEMORY.md. This runs at 3 AM daily.
You can trigger it manually with **mcp__memory__dream**.`;
}

function buildDateTime(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `## Current Date & Time\n\n${now.toISOString()} (${tz})`;
}

function buildContinuity(memDir: string): string {
  return `## Continuity

Each session, you start fresh. Your memory files ARE your persistence layer.
Read them. Update them. They're how you maintain continuity across sessions.
If something important happened, write it down before the session ends.

Your conversations are automatically logged to ${memDir}/transcripts/YYYY-MM-DD.jsonl.
Before context compaction, you'll be asked to flush important memories to ${memDir}/YYYY-MM-DD.md.
This is how your daily memory files get built — from real conversation transcripts.`;
}

function buildCompactionGuidance(): string {
  return `## Summary Instructions

When summarizing this conversation (during context compaction), always preserve:
- The current task objective and acceptance criteria
- File paths that have been read or modified
- Decisions made and the reasoning behind them
- Any "remember this" notes from the user
- Technical discoveries, bugs found, solutions that worked
- User preferences learned during this session`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildSystemPrompt(): Promise<string> {
  const baseDir = resolveBaseDir();
  const memDir = resolveMemoryDir();

  console.log(`[prompt] Loading context from: ${baseDir}`);

  const [contextSections, memory, recentMemory] = await Promise.all([
    buildContextSections(baseDir),
    buildMemoryContext(baseDir),
    buildRecentDailyMemory(memDir),
  ]);

  const sections = [
    buildIdentity(),
    buildSafety(),
    buildToolStyle(),
    buildWorkspace(baseDir),
    buildMemoryGuidance(baseDir, memDir),
    buildDateTime(),
    buildContinuity(memDir),
    buildCompactionGuidance(),
    // Context files: CLAUDE.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md
    ...contextSections,
    // Memory
    memory,
    recentMemory,
  ].filter(Boolean);

  return sections.join("\n\n");
}
