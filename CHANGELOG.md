# Changelog

## 0.2.4 (2026-10-12)

- `XRAY_OFFLINE=1` / `--offline`: no network and no other programs; local folders only. `XRAY_USAGE=off` / `--no-usage`: do not read session logs.
- The install check never lets an install through silently: if it cannot check the target it asks with the reason, and `XRAY_GATE=strict` refuses both red and unchecked installs. Its fetches time out after 10 seconds, and `plugin@marketplace` no longer falls back to npm.
- The snapshot file is owner-only.
- The deep scan runs on Windows (`npx.cmd`).
- SECURITY.md lists everything X-ray reads, writes, fetches and runs. docs/enterprise.md covers managed-settings rollout, proxies and internal registries, mirrors and air-gapped use, and CI gating.

## 0.2.3 (2026-10-12)

- An installed plugin with no `enabledPlugins` entry counts as off, matching Claude Code, so turned-off plugins no longer add to the per-turn total.

## 0.2.2 (2026-10-12)

- Each use is dated by its own log line, so a session resumed today no longer makes last month's calls look recent.
- Usage and history length come only from Claude Code session transcripts. Other `.jsonl` files that plugins keep under `~/.claude/projects` no longer make the history look older than it is.

## 0.2.1 (2026-10-12)

- `xray clean` saves a connector's settings before `claude mcp remove` and prints the command that restores it. `--all` covers plugins only; connectors are removed only when named.
- Says "not used since Sep 23" when the session history is shorter than 30 days, and suggests nothing until there is about a week of it.
- A plugin whose connector you use from another install says so ("you use your other playwright").
- Unused connectors get their own section; columns line up when a reason is long or an agent has no usage data.

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
