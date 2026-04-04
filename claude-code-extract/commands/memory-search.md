# Memory Search

Search across all memory for relevant context.

## Instructions

### If the `memory` MCP server is available (preferred — semantic search):

Use the MCP memory tools to search semantically. This provides vector-based similarity search, like OpenClaw's LanceDB system.

1. Use the MCP `search_memory` (or equivalent) tool with the user's query.
2. Present results with source attribution and relevance.
3. If MCP results are sparse, fall back to file-based search below.

### File-based search (fallback):

1. **Search long-term memory first** — Read `MEMORY.md` and check for relevant content.

2. **Search daily files** — Search across all `memory/*.md` files for the query terms using grep.

3. **Read matching files** — For each match, read the surrounding context (not just the matching line).

4. **Synthesize results** — Present findings organized by relevance:
   - Most relevant matches first
   - Include the source file and approximate date
   - Quote the relevant passages

5. **If nothing found** — Say so clearly. Don't fabricate memories.

## Usage

When the user asks:
- "What did we decide about X?"
- "Do you remember when we discussed Y?"
- "What's the context on Z?"
- "Search my notes for..."

Search both MCP memory and file-based memory, then synthesize the answer.
