# Remember

Save something to today's daily memory file.

## Instructions

1. Create `~/memory/` directory if it doesn't exist.

2. Determine today's date in `YYYY-MM-DD` format.

3. Read `~/memory/YYYY-MM-DD.md` if it exists (to append, not overwrite).

4. Write the user's message or current context to `~/memory/YYYY-MM-DD.md`.

Use this format:

```markdown
# YYYY-MM-DD

## Session Notes
- [HH:MM] What happened or what to remember

## Decisions
- Chose X over Y because...

## Context
- Working on feature Z
- Blocked on issue #123

## Remember
- Key facts, preferences, or lessons
```

If the file already exists, append to the appropriate section. Don't overwrite existing entries.

If the user said "remember this" or "note this", capture exactly what they want remembered. If no specific content was given, capture the most important context from the current conversation.

5. **Re-index** — If the `memory` MCP server is connected, re-index so the new content is searchable:
   - **voyageai-cli**: The pipeline auto-indexes on next search, or call the relevant ingest tool.
   - **mcp-local-rag**: Call `ingest_data` to re-index `~/memory/`.

The MCP server indexes the markdown files directly — writing the file IS writing to the vector store.

Confirm what was saved and where.
