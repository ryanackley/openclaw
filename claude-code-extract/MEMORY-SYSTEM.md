# Memory System for Claude Code

Replicate OpenClaw's two-tier memory system using Claude Code hooks, commands, and MCP servers.

## How OpenClaw Does It

OpenClaw uses a full RAG pipeline:
1. **LanceDB** vector database for semantic embedding and search
2. **Daily memory files** (`memory/YYYY-MM-DD.md`) — raw session logs
3. **Long-term memory** (`MEMORY.md`) — curated wisdom
4. **Recall tracking** — every search hit is logged with scores, frequency, concept tags
5. **Dreaming system** — auto-promotes high-signal memories at 3 AM using a weighted scoring algorithm (frequency, relevance, diversity, recency, consolidation, conceptual breadth)

## How We Replicate It

### Tier 1: Semantic Memory (MCP Server)

The `.mcp.json` configures a **mem0** MCP server that provides:
- Vector-based semantic search (like OpenClaw's LanceDB)
- Automatic memory extraction from conversations
- Persistent local storage at `~/.openclaw-memory`
- No API key needed — runs entirely locally

**Alternative MCP servers you can swap in:**

| Server | Best For | Config |
|--------|----------|--------|
| `mem0-mcp` | Easiest setup, good defaults | `npx -y mem0-mcp` |
| `mcp-server-lancedb` | Closest to OpenClaw (same DB) | `npx -y mcp-server-lancedb` |
| `rag-memory-mcp` | Knowledge graph + vector hybrid | `npx -y rag-memory-mcp` |
| `@modelcontextprotocol/server-memory` | Simple knowledge graph (no vectors) | `npx -y @modelcontextprotocol/server-memory` |

### Tier 2: File-Based Memory (Daily Notes + MEMORY.md)

Same format as OpenClaw. Works even without the MCP server.

- `memory/YYYY-MM-DD.md` — daily session notes
- `MEMORY.md` — curated long-term insights
- SessionStart hook loads recent files automatically
- Commands for manual memory operations

## Installation

### 1. Copy `.mcp.json` to your project root

```bash
cp .mcp.json ~/your-project/.mcp.json
```

The memory MCP server starts automatically when Claude Code launches.

### 2. Add memory instructions to CLAUDE.md

Append to your project's `CLAUDE.md`:

```markdown
## Memory System

You have a two-tier memory system. Use it.

### Tier 1: Semantic Memory (MCP)
When the `memory` MCP server is connected, use its tools for:
- Storing important context, decisions, and lessons
- Searching past conversations semantically
- This is your vector-backed long-term memory

### Tier 2: File-Based Memory
Additionally, maintain markdown files:
- `memory/YYYY-MM-DD.md` — daily session notes (one per day)
- `MEMORY.md` — curated long-term insights

### Session Startup
At the start of every session, silently read:
1. `MEMORY.md` (if it exists)
2. `memory/YYYY-MM-DD.md` for today and yesterday

### Writing Memories
- "Remember this" → write to daily file AND store in MCP memory
- Important decisions → both tiers
- Routine context → daily file only
- "Mental notes" don't survive sessions. WRITE IT DOWN.
```

### 3. Copy commands to `.claude/commands/`

```bash
mkdir -p ~/your-project/.claude/commands
cp commands/remember.md ~/your-project/.claude/commands/
cp commands/memory-review.md ~/your-project/.claude/commands/
cp commands/memory-promote.md ~/your-project/.claude/commands/
cp commands/memory-search.md ~/your-project/.claude/commands/
```

### 4. Add the SessionStart hook

Copy `settings.json` to `.claude/settings.json` in your project, or merge the hooks:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '---MEMORY-CONTEXT-START---'; echo '## Long-term Memory'; cat MEMORY.md 2>/dev/null || echo '(no MEMORY.md yet)'; echo ''; echo '## Today'; cat memory/$(date +%Y-%m-%d).md 2>/dev/null || echo '(no notes today)'; echo ''; echo '## Yesterday'; cat memory/$(date -d yesterday +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d 2>/dev/null).md 2>/dev/null || echo '(no notes yesterday)'; echo '---MEMORY-CONTEXT-END---'"
          }
        ]
      }
    ]
  }
}
```

## Architecture

```
your-project/
├── CLAUDE.md              (includes memory instructions)
├── MEMORY.md              (long-term curated memory)
├── .mcp.json              (mem0 MCP server for semantic search)
├── memory/
│   ├── 2026-04-01.md      (daily notes)
│   ├── 2026-04-02.md
│   └── 2026-04-03.md
└── .claude/
    ├── settings.json      (SessionStart hook)
    └── commands/
        ├── remember.md        (save to daily + MCP memory)
        ├── memory-review.md   (review and maintain files)
        ├── memory-promote.md  (daily → long-term promotion)
        └── memory-search.md   (semantic + file search)
```

## OpenClaw Feature Comparison

| OpenClaw Feature | Claude Code Implementation |
|-----------------|---------------------------|
| LanceDB vector search | mem0 MCP server (or lancedb MCP) |
| Session startup memory load | SessionStart hook + CLAUDE.md instructions |
| Daily memory files | `memory/YYYY-MM-DD.md` (same format) |
| Long-term MEMORY.md | Same file, same concept |
| `memory_search` tool | MCP memory search + file grep fallback |
| Recall tracking & scoring | MCP server handles internally |
| Heartbeat memory review | `/project:memory-review` command |
| Dreaming (auto-promotion) | `/project:memory-promote` command (manual) |
| "Remember this" behavior | CLAUDE.md instructions + `/project:remember` |
| Concurrent locking | Not needed (single-session) |

## What's NOT Replicated

- **Automatic dreaming** — OpenClaw auto-promotes at 3 AM via cron. Use `/project:memory-promote` manually or set up a system cron to trigger it.
- **Recall frequency scoring** — OpenClaw's weighted algorithm (frequency 0.24, relevance 0.30, diversity 0.15, recency 0.15, consolidation 0.10, conceptual 0.06). The MCP server handles its own relevance ranking.
- **Multi-agent memory isolation** — OpenClaw isolates memory per agent. Not applicable to single-session Claude Code.
- **Heartbeat polling** — No background process. Use commands on demand.
