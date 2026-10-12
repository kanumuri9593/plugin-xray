---
name: xray
description: Audit installed plugins, skills and MCP servers, or check one before installing it. Use when the user asks what their plugins do, what they cost in tokens, which ones overlap, whether a plugin or MCP server is safe, or what changed in an update.
---

# Plugin X-ray

Run the X-ray CLI that ships with this plugin and show the result to the user.

- Audit everything installed: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" --md`
- Check something before installing it: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" scan <target> --md`
  where `<target>` is `plugin@marketplace`, an npm package (`npm:name@version`), `github:owner/repo`, or a folder.
- Compare two versions: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" diff <old> <new>`
- Add `--tools` to count a local MCP server's tool list. It starts the server, so ask the user first.
- Add `--deep` for a full static analysis of a JavaScript package with REA. It takes about a minute.

How to present it:
- Lead with the one-line totals: items, tokens every turn, overlaps, anything marked 🔴.
- For each 🔴 or 🟡 finding, say what it means in plain words and point to the file and line.
- For overlaps, suggest which one to keep: the one the user actually uses, or the lighter one.
- Findings are observations, not verdicts. Never call a plugin malicious; say what it does and let the user decide.
- To turn a plugin off, the user runs `/plugin` and disables it, or `claude plugin disable <name>`. Do not edit plugin files or settings yourself.
