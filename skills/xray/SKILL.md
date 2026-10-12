---
name: xray
description: Audit installed plugins, skills and MCP servers, or check one before installing it. Use when the user asks what their plugins do, what they cost in tokens, which ones overlap, which ones they never use and could remove, whether a plugin or MCP server is safe, or what changed in an update.
---

# Plugin X-ray

Run the X-ray CLI that ships with this plugin and show the result to the user.

- Audit everything installed: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" --md`
- Check something before installing it: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" scan <target> --md`
  where `<target>` is `plugin@marketplace`, an npm package (`npm:name@version`), `github:owner/repo`, or a folder.
- Find what to remove: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" clean --md`
- Compare two versions: `node "${CLAUDE_PLUGIN_ROOT}/cli/xray.mjs" diff <old> <new>`
- Add `--tools` to count a local MCP server's tool list. It starts the server, so ask the user first.
- Add `--deep` for a full static analysis of a JavaScript package with REA. It takes about a minute.

How to present it:
- Lead with the one-line totals: items, tokens every turn, overlaps, anything marked 🔴.
- For each 🔴 or 🟡 finding, say what it means in plain words and point to the file and line.
- For overlaps, suggest which one to keep: the one the user actually uses, or the lighter one.
- Findings are observations, not verdicts. Never call a plugin malicious; say what it does and let the user decide.
- Usage comes from the user's own Claude Code session logs on this machine (last 30 days). "unused 30d" means no skill, command, agent or tool from it was called in that time; hooks and always-on instructions still cost tokens.

Cleaning up:
- When the user asks what they can remove, or the audit shows a Clean up list, run `clean --md` and show the table: one line on what each item does, why it is listed, the tokens it saves every turn.
- Add your own judgement from what you know about the user's work (for example, a Vercel plugin for someone who deploys elsewhere), but keep the evidence and the advice separate.
- Ask which ones to remove, in one question listing the names. Only after the user picks, run the exact `Remove with` command for each picked item, one Bash call per item so the user approves each. Never remove anything they did not pick.
- Items synced from a claude.ai organisation have no command: tell the user to turn them off in claude.ai.
- After removing, say how to undo it (`claude plugin install <plugin>@<marketplace>`) and that new sessions pick up the change.
- Do not edit plugin files or settings files by hand.
