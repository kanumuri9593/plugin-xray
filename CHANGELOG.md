# Changelog

## 0.2.0 (2026-10-12)

- The audit shows one line on what each item does and when you last used it, read from your local Claude Code session logs (last 30 days; nothing leaves your machine).
- New `xray clean`: unused or switched-off plugins and connectors, what removing each saves, and the exact command. `--yes` runs it for the names you give; `/plugin-xray:xray` asks which ones to remove and removes only those.

## 0.1.2 (2026-10-12)

- Plugins synced from a claude.ai organisation are counted once: when a re-sync leaves `name` and `name~g2` side by side, only the newest generation is read.

## 0.1.1 (2026-10-12)

Fixes from the first real install.

- Each installed plugin is counted once. Old cached versions, per-project copies and synced copies of the same plugin were listed as separate installs.
- A plugin's command that wraps its own skill of the same name is no longer reported as an overlap.
- Project MCP servers that repeat a user-level server word for word are no longer counted twice.
- The first session after install shows only the summary line instead of a card for every installed item.

## 0.1.0 (2026-10-12)

First release.

- `xray` audits plugins, skills and MCP servers across Claude Code, Claude desktop, Codex, Cursor, VS Code, Gemini CLI and Windsurf: tokens added to every turn, connectors, overlaps, findings.
- `xray scan <target>` checks a folder, npm package, GitHub repo or `plugin@marketplace` before you install it.
- `xray diff <old> <new>` lists only what a new version adds: hosts, email addresses, hooks, connectors, capabilities.
- `--tools` counts a local connector's tool list; `--deep` adds a REA static analysis for JavaScript packages.
- Claude Code plugin with SessionStart, ConfigChange and PreToolUse hooks that show a card for every new or updated plugin.
- `xray mcp` serves `xray_audit`, `xray_scan` and `xray_diff` to any MCP client.
