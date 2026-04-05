/**
 * Memory MCP tools — custom tools for the agent to search and manage memory.
 *
 * Registered as an in-process MCP server so the agent can call them like
 * any other tool: mcp__memory__search, mcp__memory__sync, mcp__memory__dream
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { searchMemory, syncEmbeddings } from "./vector-search.js";
import { recordRecalls } from "./recall-tracker.js";
import { dream, curateOnly } from "./dreaming.js";

// ---------------------------------------------------------------------------
// memory_search — semantic search with recall tracking
// ---------------------------------------------------------------------------

const memorySearch = tool(
  "search",
  `Search memory files semantically using Voyage AI embeddings.
Searches ~/MEMORY.md and ~/memory/*.md for content relevant to the query.
Returns ranked results with file path, line numbers, snippet, and relevance score.
Use this when the user asks about past conversations, decisions, or context.
Every search result is tracked for the dreaming system — frequently recalled
memories get automatically promoted to MEMORY.md.`,
  {
    query: {
      type: "string",
      description: "The search query — what you're looking for in memory",
    },
    max_results: {
      type: "number",
      description: "Maximum results to return (default: 6)",
    },
    min_score: {
      type: "number",
      description: "Minimum relevance score 0-1 (default: 0.3)",
    },
  },
  async (args: { query: string; max_results?: number; min_score?: number }) => {
    try {
      const results = await searchMemory(
        args.query,
        args.max_results ?? 6,
        args.min_score ?? 0.3,
      );

      // Track every hit for the dreaming system
      await recordRecalls(args.query, results);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No relevant memories found for this query.",
            },
          ],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `### Result ${i + 1} (score: ${r.score.toFixed(3)})\n` +
            `**File:** ${r.path}:${r.startLine}-${r.endLine}\n\n` +
            `${r.snippet}`,
        )
        .join("\n\n---\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} relevant memories:\n\n${formatted}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Memory search error: ${msg}` }],
        is_error: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// memory_sync — re-index memory files
// ---------------------------------------------------------------------------

const memorySync = tool(
  "sync",
  `Re-index memory files. Scans ~/MEMORY.md and ~/memory/*.md, embeds any
new or changed files using Voyage AI, and updates the local embeddings cache.
Run this after writing new memory files to make them searchable.`,
  {},
  async () => {
    try {
      const result = await syncEmbeddings();
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Memory index synced: ${result.added} files embedded, ` +
              `${result.unchanged} unchanged, ${result.removed} removed.`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Sync error: ${msg}` }],
        is_error: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// memory_dream — run the dreaming promotion algorithm
// ---------------------------------------------------------------------------

const memoryDream = tool(
  "dream",
  `Run the dreaming promotion algorithm. Analyzes short-term recall data
(which memories have been searched for and found useful) and promotes the
most valuable entries to ~/MEMORY.md.

Ranking uses a weighted algorithm:
  - Relevance (0.30): average search score
  - Frequency (0.24): how often recalled
  - Diversity (0.15): unique queries that found it
  - Recency (0.15): exponential decay, 14-day half-life
  - Consolidation (0.10): spaced recall across different days
  - Conceptual (0.06): breadth of concept tags

Candidates must have been recalled 3+ times, with avg score >= 0.75,
from 2+ unique queries, and not already promoted.

This runs automatically every 6 hours, but you can trigger it manually.

After ranking, if ANTHROPIC_API_KEY is set, an LLM curation pass rewrites
MEMORY.md — deduplicating, consolidating, removing stale entries, and
organizing by topic. A backup is saved to MEMORY.md.bak before rewriting.
Without the API key, new entries are appended raw.`,
  {},
  async () => {
    try {
      const result = await dream();

      if (result.promoted === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "No memories ready for promotion. " +
                "Candidates need 3+ recalls with avg score >= 0.75 from 2+ unique queries. " +
                `${result.candidates} unpromoted entries in the recall store.`,
            },
          ],
        };
      }

      const promoted = result.entries
        .map(
          (e) =>
            `- ${e.snippet.slice(0, 100)}... ` +
            `(score: ${e.score.toFixed(3)}, recalls: ${e.recalls}, source: ${e.source})`,
        )
        .join("\n");

      const method = result.curated
        ? "MEMORY.md was curated and rewritten by LLM (backup at MEMORY.md.bak)"
        : "Entries appended raw (set ANTHROPIC_API_KEY for LLM curation)";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Promoted ${result.promoted} memories to ~/MEMORY.md:\n\n${promoted}\n\n` +
              `${method}\n\n` +
              `${result.candidates} unpromoted entries remain in the recall store.`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Dreaming error: ${msg}` }],
        is_error: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// memory_curate — reorganize MEMORY.md without adding new entries
// ---------------------------------------------------------------------------

const memoryCurate = tool(
  "curate",
  `Curate ~/MEMORY.md — reorganize, deduplicate, remove stale entries, and
consolidate related memories. Does NOT promote new entries; just cleans up
what's already there.

Uses Claude (via ANTHROPIC_API_KEY) to intelligently rewrite the file:
- Groups entries by topic, not by promotion date
- Merges duplicate or overlapping entries
- Removes outdated project context and resolved issues
- Preserves user preferences and hard-won lessons
- Creates a clean, readable structure

A backup is saved to ~/MEMORY.md.bak before rewriting.

Use this when MEMORY.md has grown messy or you want to tidy it up.`,
  {},
  async () => {
    try {
      const result = await curateOnly();

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Curation failed: ${result.error}`,
            },
          ],
          is_error: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              "~/MEMORY.md has been curated and rewritten. " +
              "Previous version backed up to ~/MEMORY.md.bak.",
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Curation error: ${msg}` }],
        is_error: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

export const memoryServer = createSdkMcpServer({
  name: "memory",
  version: "1.0.0",
  tools: [memorySearch, memorySync, memoryDream, memoryCurate],
});
