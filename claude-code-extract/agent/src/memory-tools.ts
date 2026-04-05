/**
 * Memory MCP tools — custom tools for the agent to search and manage memory.
 *
 * Registered as an in-process MCP server so the agent can call them like
 * any other tool: mcp__memory__search, mcp__memory__sync
 */

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { searchMemory, syncEmbeddings } from "./vector-search.js";

// ---------------------------------------------------------------------------
// memory_search — semantic search over all memory files
// ---------------------------------------------------------------------------

const memorySearch = tool(
  "search",
  `Search memory files semantically using Voyage AI embeddings.
Searches ~/MEMORY.md and ~/memory/*.md for content relevant to the query.
Returns ranked results with file path, line numbers, snippet, and relevance score.
Use this when the user asks about past conversations, decisions, or context.`,
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
// memory_sync — re-index memory files (embed new/changed content)
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
// MCP server
// ---------------------------------------------------------------------------

export const memoryServer = createSdkMcpServer({
  name: "memory",
  version: "1.0.0",
  tools: [memorySearch, memorySync],
});
