# Changelog

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
