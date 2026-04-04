# Memory System for Claude Code

Replicate OpenClaw's memory system using Claude Code hooks, commands, and an MCP server.

## How OpenClaw Does It

OpenClaw uses LanceDB to index markdown files directly:
1. You write to `memory/YYYY-MM-DD.md` and `MEMORY.md` (plain markdown)
2. LanceDB chunks and embeds those files into vectors
3. `memory_search` does semantic search over the indexed files
4. Results point back to the source file + line numbers
5. A "dreaming" system auto-promotes frequently-recalled memories to `MEMORY.md`

The key insight: **the files ARE the database.** There's no separate store. LanceDB indexes your markdown, and you search over it.

## How We Replicate It

### mcp-local-rag (LanceDB-based, same engine as OpenClaw)

The `.mcp.json` configures `mcp-local-rag` which:
- Indexes `~/memory/*.md` files using **LanceDB** (same engine as OpenClaw)
- Provides `search_documents` for semantic search over your files
- Provides `ingest_data` to re-index after writes
- Runs locally, no API key needed

**You write markdown files. The MCP server indexes them. You search semantically. Same architecture as OpenClaw.**

### File layout

```
~/
├── MEMORY.md              ← curated long-term memory (read on startup)
└── memory/
    ├── 2026-04-01.md      ← daily session notes
    ├── 2026-04-02.md
    └── 2026-04-03.md      ← mcp-local-rag indexes all of these
```

### Data flow

```
Write memory → ~/memory/YYYY-MM-DD.md → mcp-local-rag indexes it → search_documents finds it
                                                                      ↑
                  ~/MEMORY.md (curated) ──────────────────────────────┘
```

No dual-write. No separate database. Write the file, index it, search it.

## Installation

Run `./install.sh` for one-command setup, or manually:

### 1. Install MCP server

```bash
cp .mcp.json ~/.claude/.mcp.json
```

The MCP server starts automatically when Claude Code launches and indexes `~/memory/`.

### 2. Install personality + memory instructions

```bash
cp CLAUDE.md ~/.claude/CLAUDE.md
```

### 3. Install commands

```bash
mkdir -p ~/.claude/commands
cp commands/remember.md ~/.claude/commands/
cp commands/memory-review.md ~/.claude/commands/
cp commands/memory-promote.md ~/.claude/commands/
cp commands/memory-search.md ~/.claude/commands/
```

### 4. Install SessionStart hook

```bash
cp settings.json ~/.claude/settings.json
```

The hook loads `~/MEMORY.md` and recent daily files at session start.

## Alternative MCP Servers

If `mcp-local-rag` doesn't work for you:

| Server | Engine | Approach |
|--------|--------|----------|
| `mcp-local-rag` (default) | LanceDB | Indexes files directly, semantic + keyword search |
| `@lishenxydlgzs/simple-files-vectorstore` | Built-in | Watches directories, auto-reindexes on file changes |
| `mcp-server-lancedb` | LanceDB | Lower-level LanceDB access |
| `@modelcontextprotocol/server-memory` | Knowledge graph | Separate store (not file-based), simpler but less like OpenClaw |

## OpenClaw Feature Comparison

| OpenClaw Feature | Claude Code Implementation |
|-----------------|---------------------------|
| LanceDB vector search | mcp-local-rag (same LanceDB engine) |
| Files = database | Same — mcp-local-rag indexes your markdown files directly |
| Session startup memory load | SessionStart hook reads ~/MEMORY.md + recent daily files |
| Daily memory files | `~/memory/YYYY-MM-DD.md` (same format) |
| Long-term MEMORY.md | `~/MEMORY.md` (same concept) |
| `memory_search` tool | `search_documents` via MCP + grep fallback |
| Dreaming (auto-promotion) | `/user:memory-promote` (manual, no 3 AM cron) |
| "Remember this" | CLAUDE.md instructions + `/user:remember` |

## What's NOT Replicated

- **Automatic dreaming** — OpenClaw auto-promotes at 3 AM. Use `/user:memory-promote` manually.
- **Recall tracking** — OpenClaw logs every search hit with scores, frequency, concept tags. The MCP server doesn't track recall history.
- **Promotion scoring** — OpenClaw uses a weighted algorithm (frequency, relevance, diversity, recency). We rely on the LLM's judgment during `/user:memory-promote`.
- **Multi-agent isolation** — Not applicable to Claude Code.
