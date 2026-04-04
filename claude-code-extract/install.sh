#!/usr/bin/env bash
set -euo pipefail

# Install OpenClaw-style personality, memory system, and skills
# into Claude Code CLI at the USER level (device-wide, all projects).

CLAUDE_DIR="$HOME/.claude"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing OpenClaw features for Claude Code (device-wide)..."
echo ""

# 1. Create directories
mkdir -p "$CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR/commands"

# 2. Install user-level CLAUDE.md (personality + memory system)
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  echo "  ~/.claude/CLAUDE.md already exists — backing up to CLAUDE.md.bak"
  cp "$CLAUDE_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md.bak"
fi
cp "$SCRIPT_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
echo "  Installed ~/.claude/CLAUDE.md (personality + memory)"

# 3. Install SOUL.md
cp "$SCRIPT_DIR/SOUL.md" "$CLAUDE_DIR/SOUL.md"
echo "  Installed ~/.claude/SOUL.md (customizable personality)"

# 4. Install user-level MCP config
if [ -f "$CLAUDE_DIR/.mcp.json" ]; then
  echo "  ~/.claude/.mcp.json already exists — backing up to .mcp.json.bak"
  cp "$CLAUDE_DIR/.mcp.json" "$CLAUDE_DIR/.mcp.json.bak"
fi
cp "$SCRIPT_DIR/.mcp.json" "$CLAUDE_DIR/.mcp.json"
echo "  Installed ~/.claude/.mcp.json (Voyage AI memory + MCP servers)"

# 5. Install user-level settings (SessionStart hook)
if [ -f "$CLAUDE_DIR/settings.json" ]; then
  echo "  ~/.claude/settings.json already exists — backing up to settings.json.bak"
  cp "$CLAUDE_DIR/settings.json" "$CLAUDE_DIR/settings.json.bak"
  echo "  WARNING: You may want to merge the SessionStart hook manually."
  echo "  See $SCRIPT_DIR/settings.json for the hook config."
else
  cp "$SCRIPT_DIR/settings.json" "$CLAUDE_DIR/settings.json"
  echo "  Installed ~/.claude/settings.json (SessionStart memory hook)"
fi

# 6. Install global commands (skills)
for cmd in "$SCRIPT_DIR"/commands/*.md; do
  name="$(basename "$cmd")"
  cp "$cmd" "$CLAUDE_DIR/commands/$name"
  echo "  Installed ~/.claude/commands/$name"
done

# 7. Create memory directory
mkdir -p "$HOME/memory"
echo "  Created ~/memory/ (daily memory files)"

# 8. Create MEMORY.md if it doesn't exist
if [ ! -f "$HOME/MEMORY.md" ]; then
  cat > "$HOME/MEMORY.md" << 'MEMEOF'
# Long-Term Memory

_Curated insights and lessons. Updated by `/project:memory-promote` or manually._

## About Me
- (fill in your preferences, working style, tools you use)

## Lessons Learned
- (things you've learned across sessions)

## Preferences
- (how you like things done)
MEMEOF
  echo "  Created ~/MEMORY.md (long-term memory)"
fi

# 9. Prompt for Voyage AI setup
echo ""
echo "━━━ Voyage AI Setup ━━━"
echo ""
echo "The memory MCP server uses Voyage AI for embeddings (same as OpenClaw)."
echo "Edit ~/.claude/.mcp.json and replace <your-voyage-api-key> with your key."
echo ""
echo "Then initialize the index:"
echo "  npx voyageai-cli pipeline ~/memory/*.md --db memory --collection notes --create-index"
echo ""
echo "If you prefer local-only embeddings (no API key), edit ~/.claude/.mcp.json:"
echo "  - Disable the 'memory' server"
echo "  - Enable the 'memory-local' server"
echo ""

echo "Done! Your Claude Code CLI now has:"
echo "  - OpenClaw-style personality (anti-sycophancy, opinions, resourcefulness)"
echo "  - Two-tier memory system (daily files + semantic search via MCP)"
echo "  - SessionStart hook that loads recent memory automatically"
echo "  - Custom commands: remember, memory-search, memory-promote, memory-review,"
echo "    weather, github, obsidian, molty, create-skill"
echo ""
echo "These work across ALL projects — not just the current one."
echo ""
echo "Next steps:"
echo "  1. Edit ~/.claude/SOUL.md to customize your agent's personality"
echo "  2. Run: claude then /user:molty to sharpen the personality"
echo "  3. Say 'remember that I prefer X' to start building memory"
echo "  4. Run /user:memory-promote periodically to curate long-term memory"
echo ""
echo "Memory files:"
echo "  ~/MEMORY.md          — long-term curated memory"
echo "  ~/memory/YYYY-MM-DD.md — daily session notes"
