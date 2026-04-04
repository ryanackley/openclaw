# Memory Promote

Review recent daily memory files and promote significant insights to long-term memory (MEMORY.md).

This replicates OpenClaw's "dreaming" system — where frequently recalled, high-value memories get promoted from daily notes to curated long-term memory.

## Instructions

1. **Read `~/MEMORY.md`** (or create it if it doesn't exist with a `# Long-Term Memory` header).

2. **Read recent daily files** — Scan `~/memory/` for the last 7 days of `YYYY-MM-DD.md` files.

3. **Identify promotion candidates** — Look for entries that are:
   - Decisions that affect future work
   - Lessons learned from mistakes
   - User preferences or working style notes
   - Important project context that persists beyond a single day
   - Recurring patterns or themes across multiple days

4. **Skip entries that are**:
   - Routine session logs ("started working on X")
   - Already captured in MEMORY.md
   - Stale or no longer relevant
   - One-off context with no future value

5. **Append to `~/MEMORY.md`** under a promotion section:

```markdown
## Promoted (YYYY-MM-DD)

- Insight or lesson [from: memory/YYYY-MM-DD.md]
- Another key finding [from: memory/YYYY-MM-DD.md]
```

6. **Clean up MEMORY.md** — Review existing entries and remove anything outdated or superseded by newer information.

7. **Report** — Show what was promoted and what was removed, with brief reasoning.

## Quality Bar

Think of this like a human reviewing their journal:
- Daily files = raw notes
- MEMORY.md = curated wisdom

If you wouldn't tell future-you about it, don't promote it.
