# Remember

Save something to today's daily memory file.

## Instructions

1. Create `memory/` directory if it doesn't exist.

2. Determine today's date in `YYYY-MM-DD` format.

3. Read `memory/YYYY-MM-DD.md` if it exists (to append, not overwrite).

4. Write the user's message or current context to `memory/YYYY-MM-DD.md`.

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

5. **If the `memory` MCP server is connected**, also store the memory there using the MCP `add_memories` (or equivalent) tool. This gives semantic search capability on top of the file-based persistence.

Dual-write ensures:
- Files are human-readable, git-trackable, and durable
- MCP memory enables semantic/vector search across all memories

Confirm what was saved and where.
