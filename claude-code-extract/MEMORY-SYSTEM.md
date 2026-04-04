# Memory System for Claude Code

Replicate OpenClaw's memory system using Claude Code hooks, commands, and an MCP server.

## How OpenClaw Does It

OpenClaw uses LanceDB + Voyage AI to index markdown files directly:
1. You write to `memory/YYYY-MM-DD.md` and `MEMORY.md` (plain markdown)
2. Voyage AI generates embeddings, LanceDB stores vectors
3. `memory_search` does semantic search over the indexed files
4. Results point back to the source file + line numbers
5. A "dreaming" system auto-promotes frequently-recalled memories to `MEMORY.md`

The key insight: **the files ARE the database.** There's no separate store.

## How We Replicate It

### Primary: voyageai-cli (same embeddings as OpenClaw)

The `.mcp.json` configures `voyageai-cli` which:
- Indexes `~/memory/*.md` files using **Voyage AI embeddings** (same provider as OpenClaw)
- Markdown-aware chunking (preserves heading structure)
- Provides `search_vectors` for semantic search
- Requires a Voyage AI API key (you already have one from OpenClaw)

### Fallback: mcp-local-rag (local, no API key)

If you prefer local-only operation:
- Uses LanceDB with local embeddings (`all-MiniLM-L6-v2`)
- Lower quality than Voyage AI but zero-cost and offline
- Swap by disabling `memory` and enabling `memory-local` in `.mcp.json`

### File layout

```
~/
├── MEMORY.md              ← curated long-term memory (read on startup)
└── memory/
    ├── 2026-04-01.md      ← daily session notes
    ├── 2026-04-02.md
    └── 2026-04-03.md      ← MCP server indexes all of these
```

### Data flow

```
Write memory → ~/memory/YYYY-MM-DD.md → MCP server indexes it → search_vectors finds it
                                                                    ↑
                  ~/MEMORY.md (curated) ────────────────────────────┘
```

No dual-write. No separate database. Write the file, index it, search it.

## Installation

Run `./install.sh` for one-command setup, or manually:

### 1. Install MCP server

```bash
cp .mcp.json ~/.claude/.mcp.json
# Edit ~/.claude/.mcp.json and set your VOYAGE_API_KEY
```

### 2. Initialize the Voyage AI index

```bash
npx voyageai-cli pipeline ~/memory/*.md --db memory --collection notes --create-index
```

### 3. Install personality + memory instructions

```bash
cp CLAUDE.md ~/.claude/CLAUDE.md
```

### 4. Install commands

```bash
mkdir -p ~/.claude/commands
cp commands/remember.md ~/.claude/commands/
cp commands/memory-review.md ~/.claude/commands/
cp commands/memory-promote.md ~/.claude/commands/
cp commands/memory-search.md ~/.claude/commands/
```

### 5. Install SessionStart hook

```bash
cp settings.json ~/.claude/settings.json
```

The hook loads `~/MEMORY.md` and recent daily files at session start.

## MCP Server Options

| Server | Embeddings | Setup | Quality |
|--------|-----------|-------|---------|
| `voyageai-cli` (default) | Voyage AI (remote) | API key needed | Best (same as OpenClaw) |
| `mcp-local-rag` (fallback) | all-MiniLM-L6-v2 (local) | Zero config | Good |
| `@lishenxydlgzs/simple-files-vectorstore` | Built-in (local) | Auto-watches dirs | Good |

## OpenClaw Feature Comparison

| OpenClaw Feature | Claude Code Implementation |
|-----------------|---------------------------|
| Voyage AI embeddings | voyageai-cli MCP server (same provider) |
| LanceDB vector search | voyageai-cli or mcp-local-rag |
| Files = database | Same — MCP server indexes your markdown files directly |
| Session startup memory load | SessionStart hook reads ~/MEMORY.md + recent daily files |
| Daily memory files | `~/memory/YYYY-MM-DD.md` (same format) |
| Long-term MEMORY.md | `~/MEMORY.md` (same concept) |
| `memory_search` tool | `search_vectors` (Voyage) or `search_documents` (local) + grep fallback |
| Dreaming (auto-promotion) | `/user:memory-promote` (manual, no 3 AM cron) |
| "Remember this" | CLAUDE.md instructions + `/user:remember` |

## What's NOT Replicated

- **Automatic dreaming** — OpenClaw auto-promotes at 3 AM. Use `/user:memory-promote` manually.
- **Recall tracking** — OpenClaw logs every search hit with scores, frequency, concept tags.
- **Promotion scoring** — OpenClaw uses a weighted algorithm (frequency, relevance, diversity, recency). We rely on the LLM's judgment during `/user:memory-promote`.
- **Multi-agent isolation** — Not applicable to Claude Code.
