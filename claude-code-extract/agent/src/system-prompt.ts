/**
 * System prompt construction — modeled after OpenClaw's buildAgentSystemPrompt().
 *
 * Sections: identity, safety, tool style, workspace, persona (SOUL.md),
 * memory guidance, and project context files.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Section builders
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

function buildWorkspace(): string {
  const cwd = process.cwd();
  return `## Workspace

Your working directory is: ${cwd}
You may read and write files within this directory and the user's home directory (~/).`;
}

function buildMemoryGuidance(): string {
  return `## Memory System

You have a two-tier memory system:

### Long-term memory
~/MEMORY.md contains curated insights, preferences, and lessons learned across sessions.
Read it at the start of every session. Update it when you learn something important.

### Daily memory
~/memory/YYYY-MM-DD.md files contain session notes, decisions, and context.
When the user says "remember this" or you encounter important context, write to today's file.

### Searching memory
Use Grep to search ~/memory/ for relevant context when answering questions about past work.
Always check memory before saying "I don't know" about something you might have discussed before.`;
}

function buildDateTime(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `## Current Date & Time

${now.toISOString()} (${tz})`;
}

function buildContinuity(): string {
  return `## Continuity

Each session, you start fresh. Your memory files ARE your persistence layer.
Read them. Update them. They're how you maintain continuity across sessions.
If something important happened, write it down before the session ends.

Your conversations are automatically logged to ~/memory/transcripts/YYYY-MM-DD.jsonl.
Before context compaction, you'll be asked to flush important memories to ~/memory/YYYY-MM-DD.md.
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
// SOUL.md and MEMORY.md loading
// ---------------------------------------------------------------------------

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function buildPersonaSection(): Promise<string> {
  // Try multiple locations for SOUL.md
  const locations = [
    join(homedir(), ".claude", "SOUL.md"),
    join(homedir(), "SOUL.md"),
    join(process.cwd(), "SOUL.md"),
  ];

  for (const loc of locations) {
    const content = await tryReadFile(loc);
    if (content?.trim()) {
      return `## Persona

If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.

<soul>
${content.trim()}
</soul>`;
    }
  }
  return "";
}

async function buildMemoryContext(): Promise<string> {
  const memoryPath = join(homedir(), "MEMORY.md");
  const content = await tryReadFile(memoryPath);
  if (!content?.trim()) return "";

  return `## Long-Term Memory (from ~/MEMORY.md)

<memory>
${content.trim()}
</memory>`;
}

async function buildRecentDailyMemory(): Promise<string> {
  const memDir = join(homedir(), "memory");
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

  return `## Recent Session Memory

<recent_memory>
${entries.join("\n\n---\n\n")}
</recent_memory>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildSystemPrompt(): Promise<string> {
  const [persona, memory, recentMemory] = await Promise.all([
    buildPersonaSection(),
    buildMemoryContext(),
    buildRecentDailyMemory(),
  ]);

  const sections = [
    buildIdentity(),
    buildSafety(),
    buildToolStyle(),
    buildWorkspace(),
    buildMemoryGuidance(),
    buildDateTime(),
    buildContinuity(),
    buildCompactionGuidance(),
    persona,
    memory,
    recentMemory,
  ].filter(Boolean);

  return sections.join("\n\n");
}
