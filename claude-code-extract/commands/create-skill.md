# Create a Custom Command (Skill)

Help the user create a new Claude Code custom command, following OpenClaw's skill design principles.

## Process

1. **Understand** — Ask what the command should do. Get concrete examples of usage.
2. **Plan** — Identify what scripts, references, or tools are needed.
3. **Create** — Write the command file at `.claude/commands/<name>.md`
4. **Test** — Verify by running `/project:<name>` in Claude Code.

## Command File Format

Create a markdown file at `.claude/commands/<name>.md`:

```markdown
# Command Name

Brief description of what this command does.

## When to Use
- Trigger condition 1
- Trigger condition 2

## Instructions
Step-by-step guidance for the AI to follow when this command is invoked.

## Example Commands
```bash
example-command --flag value
```
```

## Principles

- **Concise is key** — The context window is shared. Only add what Claude doesn't already know.
- **Progressive disclosure** — Keep the command file lean. Link to reference files for details.
- **Imperative form** — Write instructions as directives: "Run X", "Check Y", not "You should run X".
- **Set freedom levels** — Be specific for fragile operations, flexible for creative ones.

## Naming

- Use lowercase, hyphens only: `my-command`
- Prefer verb-led names: `deploy-staging`, `review-pr`, `check-deps`
- Keep under 64 characters

## File Structure (for complex commands)

```
.claude/commands/
├── my-command.md          (main command)
└── my-command/
    ├── reference.md       (detailed docs, loaded on demand)
    └── scripts/
        └── helper.sh      (reusable scripts)
```
