# Changelog

## 0.1.0 (2026-10-12)

First release.

- `xray` audits plugins, skills and MCP servers across Claude Code, Claude desktop, Codex, Cursor, VS Code, Gemini CLI and Windsurf: tokens added to every turn, connectors, overlaps, findings.
- `xray scan <target>` checks a folder, npm package, GitHub repo or `plugin@marketplace` before you install it.
- `xray diff <old> <new>` lists only what a new version adds: hosts, email addresses, hooks, connectors, capabilities.
- `--tools` counts a local connector's tool list; `--deep` adds a REA static analysis for JavaScript packages.
- Claude Code plugin with SessionStart, ConfigChange and PreToolUse hooks that show a card for every new or updated plugin.
- `xray mcp` serves `xray_audit`, `xray_scan` and `xray_diff` to any MCP client.
