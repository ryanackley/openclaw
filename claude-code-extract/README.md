# OpenClaw Features for Claude Code CLI

Extracted personality, skills, and tooling from the [OpenClaw](https://github.com/openclaw/openclaw) project for use with vanilla Claude Code CLI.

## Quick Start

```bash
# 1. Copy the CLAUDE.md to your project root (personality + coding style)
cp CLAUDE.md ~/your-project/CLAUDE.md

# 2. Optionally copy SOUL.md for the full personality system
cp SOUL.md ~/your-project/SOUL.md

# 3. Copy the MCP config for tool integrations
cp .mcp.json ~/your-project/.mcp.json

# 4. Copy skills you want as custom commands
mkdir -p ~/your-project/.claude/commands
cp commands/* ~/your-project/.claude/commands/
```

## What's Included

### 1. `CLAUDE.md` — Agent Personality & Coding Style

The core OpenClaw personality distilled into a single CLAUDE.md file:
- Anti-sycophancy rules ("never open with Great question!")
- Opinion-having ("commit to a take, don't hedge")
- Resourcefulness ("come back with answers, not questions")
- Safety boundaries
- Coding style (concise, no unnecessary abstractions)
- Memory/continuity patterns (write things to files, not "mental notes")

### 2. `SOUL.md` — Customizable Personality Template

OpenClaw's personality system uses a `SOUL.md` file that you can customize.
Drop it next to CLAUDE.md and Claude Code will read it as project context.

**Pro tip:** Use the "Molty prompt" to sharpen your personality:
```
Read your SOUL.md. Now rewrite it with these changes:
1. You have opinions now. Strong ones. Stop hedging.
2. Delete every rule that sounds corporate.
3. Add: "Never open with Great question, I'd be happy to help, or Absolutely."
4. Brevity is mandatory.
5. Humor is allowed. Not forced — just natural wit.
6. You can call things out. Charm over cruelty, but don't sugarcoat.
7. Swearing is allowed when it lands.
Save the new SOUL.md.
```

### 3. `.mcp.json` — MCP Server Integrations

Pre-configured MCP servers for common tools. Edit to match your setup.

### 4. `commands/` — Custom Slash Commands (Skills)

OpenClaw "skills" translated into Claude Code custom commands:
- `/project:weather` — Weather lookups via wttr.in
- `/project:github` — GitHub CLI operations
- `/project:obsidian` — Obsidian vault management
- `/project:remember` — Save context to daily memory
- `/project:memory-review` — Review and maintain memory files
- `/project:memory-promote` — Promote daily insights to long-term memory
- `/project:memory-search` — Search across all memory files
- `/project:molty` — Rewrite your personality to be less generic
- `/project:create-skill` — Create new custom commands

### 6. `MEMORY-SYSTEM.md` — Memory Architecture Guide

Full guide to replicating OpenClaw's two-tier memory system with hooks and commands.

### 5. `settings.json` — Claude Code Settings

Recommended Claude Code settings inspired by OpenClaw's defaults.

## OpenClaw Concepts → Claude Code Mapping

| OpenClaw | Claude Code Equivalent |
|----------|----------------------|
| `SOUL.md` | Additional file in CLAUDE.md or separate file |
| `AGENTS.md` | `CLAUDE.md` |
| `IDENTITY.md` | Personality section in CLAUDE.md |
| Skills (`SKILL.md`) | Custom commands (`.claude/commands/`) |
| MCP servers | `.mcp.json` |
| Heartbeats | SessionStart hook + manual commands |
| Cron jobs | Not available (use `/project:memory-review` manually) |
| Memory system | File-based with hooks + commands (see MEMORY-SYSTEM.md) |
| Channel routing | Not applicable |
| Hooks | Claude Code hooks in settings |

## Skills You Can Port

OpenClaw ships 53 skills. The ones most useful for Claude Code:

| Skill | What It Does | Needs |
|-------|-------------|-------|
| github | GitHub CLI operations | `gh` CLI |
| weather | Weather via wttr.in | `curl` |
| obsidian | Obsidian vault management | `obsidian-cli` |
| tmux | Terminal multiplexer | `tmux` |
| notion | Notion workspace | Notion API key |
| trello | Trello boards | Trello API key |
| spotify-player | Spotify control | `spotify_player` |
| things-mac | Things 3 tasks (macOS) | `things-cli` |
| apple-notes | Apple Notes (macOS) | AppleScript |
| apple-reminders | Apple Reminders (macOS) | AppleScript |
| 1password | 1Password lookups | `op` CLI |
| nano-pdf | PDF manipulation | `nanopdf` |
| camsnap | Camera snapshots | `camsnap` |
| openhue | Philips Hue control | `openhue` |

To port a skill, read its `SKILL.md` from the OpenClaw repo at
`skills/<name>/SKILL.md` and adapt it as a Claude Code custom command.

## The OpenClaw Personality Philosophy

From their docs:

> `SOUL.md` is where your agent's voice lives. If your agent sounds bland,
> hedgy, or weirdly corporate, this is usually the file to fix.

**Good rules sound like:**
- have a take
- skip filler
- be funny when it fits
- call out bad ideas early

**Bad rules sound like:**
- maintain professionalism at all times
- provide comprehensive and thoughtful assistance
- ensure a positive and supportive experience

The second list is how you get mush.
