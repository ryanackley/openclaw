# Memory Search

Search across all memory for relevant context.

## Instructions

### If the `memory` MCP server is available (preferred):

Use the MCP server's semantic search tools. Depending on which server is configured:

- **voyageai-cli**: Use `search_vectors` with the user's query. Uses Voyage AI embeddings for high-quality semantic matching.
- **mcp-local-rag**: Use `search_documents` with the user's query. Uses local LanceDB embeddings.

Both index your `~/memory/*.md` files directly.

1. Search with the user's query.
2. Results include the source file path and matched content.
3. Read the source file for surrounding context if needed.
4. Also read `~/MEMORY.md` directly — it contains curated long-term memory that may be relevant.

### Fallback (no MCP server):

1. **Read `~/MEMORY.md`** — check for relevant content.
2. **Grep daily files** — search `~/memory/*.md` for query terms.
3. **Read matching files** — get surrounding context, not just matching lines.

### Synthesize results

- Most relevant matches first
- Include source file and date
- Quote the relevant passages
- If nothing found, say so. Don't fabricate memories.

## Usage

When the user asks:
- "What did we decide about X?"
- "Do you remember when we discussed Y?"
- "What's the context on Z?"
- "Search my notes for..."
