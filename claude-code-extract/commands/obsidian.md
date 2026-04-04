# Obsidian Vault Operations

Work with Obsidian vaults (plain Markdown notes) and automate via obsidian-cli.

Obsidian vault = a normal folder on disk. Notes are `*.md` files.

## Find Vaults

```bash
# macOS vault config
cat ~/Library/Application\ Support/obsidian/obsidian.json

# Default vault path
obsidian-cli print-default --path-only
```

## Common Operations

```bash
# Search note names
obsidian-cli search "query"

# Search inside notes (content search with snippets)
obsidian-cli search-content "query"

# Create a note
obsidian-cli create "Folder/New note" --content "..." --open

# Move/rename (updates wikilinks across vault)
obsidian-cli move "old/path/note" "new/path/note"

# Delete
obsidian-cli delete "path/note"

# Set default vault (one-time)
obsidian-cli set-default "<vault-folder-name>"
```

Prefer direct `.md` file edits when appropriate — Obsidian picks up changes automatically.
Use `obsidian-cli move` instead of `mv` to keep wikilinks intact.
