# Plugin X-ray

**See what an AI agent plugin can do before you trust it.**

Every plugin, skill and MCP server you add to Claude Code, Codex, Cursor or VS Code runs with *your* permissions: your files, your shell, your keys. Each one also adds text to every request your agent makes. Most people install them without reading a line of code.

Plugin X-ray reads them for you. It answers four questions:

| | Question | How |
|---|---|---|
| 🔍 | **What can it do on my machine?** | Reads the plugin's skills, hooks, scripts and server code (without running them) and lists programs it runs, hosts it talks to, secrets it touches, with the file and line. |
| 🪙 | **What does it cost me?** | Counts the tokens each plugin adds to every turn, and with `--tools`, the size of each connector's tool list. |
| ⇄ | **Do I already have this?** | Finds the same connector installed twice, several connectors for one job, and near-duplicate skills. |
| 🆕 | **What changed in this update?** | Diffs two versions and lists only what is new: a new host, a new email address, a new hook, a new connector. |

It works three ways: a **command** (`npx plugin-xray`), a **Claude Code plugin** that checks every install automatically, and an **MCP server** any agent can call before it installs something.

## Try it

```bash
npx -y plugin-xray            # audit everything installed
npx -y plugin-xray scan baton-run   # check something before you install it
```

Real output from a workspace with two popular plugins:

```text
Plugin X-ray  3 items · ≈1.5k tokens on every turn · 22 connectors · 7 overlaps

  ● product-management    ≈736  8 skills · 1 command · 16 connectors         ok
  ● finance               ≈664  8 skills · 6 connectors                      ok
  ● user skills            ≈76  1 skill                                      ok

Overlaps
  ⇄ slack is installed 2 times  Keep it in one place; turn it off in product-management.
  ⇄ gmail is installed 2 times  Keep it in one place; turn it off in product-management.
  ⇄ 5 project tracker connectors  Most people use one project tracker. Keep the one you use …
  ⇄ finance:journal-entry ≈ finance:journal-entry-prep  Overlapping descriptions make the agent pick at random.
```

A plugin that is up to no good (a test fixture in this repo) looks like this:

```text
● productivity-boost 0.3.0  attention
  Context   ≈21 tokens every turn · 1 skill · 1 connector · 1 hook
  Can       runs a command on every UserPromptSubmit · talks to the network
  Talks to  speedy-agent.example.io, telemetry.speedy-agent.example.io
  ● speedy-agent-mcp is not pinned, so every start can fetch new code  server booster
  ● API_KEY holds a credential written in plain text  server booster
  ● contains invisible characters that can hide instructions  skills/helper/SKILL.md:5
  ● text tries to override instructions or hide actions from you  skills/helper/SKILL.md:5
  ● reads credential files (SSH keys, cloud logins)  scripts/sync.sh:2
  ● downloads a script and runs it  scripts/sync.sh:3
```

And this is the update check. In September 2025, the first malicious MCP server found in the wild was a mail connector: 15 clean versions, then one release that quietly copied every email to the attacker. A replay of that pattern:

```text
$ xray diff ./mailer-1.0.15 ./mailer-1.0.16
What changed mailer@1.0.15 → mailer@1.0.16
  + now talks to collect.giftshop-mail.example.club
  + now has the email address archive@giftshop-mail.example.club in its code
```

## What popular MCP servers cost

Measured with `xray scan npm:<package> --tools` on 2026-10-12 (each server started once, its tool list sized at ~4 characters per token):

| Server | Tools | ≈ Tokens |
|---|---:|---:|
| firecrawl-mcp | 26 | 21,164 |
| @notionhq/notion-mcp-server | 24 | 19,054 |
| chrome-devtools-mcp | 30 | 6,597 |
| @playwright/mcp | 25 | 5,072 |
| @modelcontextprotocol/server-github | 26 | 3,964 |
| @upstash/context7-mcp | 2 | 1,307 |
| exa-mcp-server | 2 | 535 |

All 14 measured servers together come to ≈82k tokens when a client loads every tool list up front. Clients that defer tool loading pay less until a tool is used. Full table: [docs/token-study.md](docs/token-study.md).

## Install

### Claude Code: check every install automatically

```text
/plugin marketplace add kanumuri9593/plugin-xray
/plugin install plugin-xray@plugin-xray
```

Then run `/plugin-xray:xray` any time for the audit. The plugin also adds three hooks:

| When | What X-ray does |
|---|---|
| A session starts | Compares what is installed with last time and shows a card for anything new or updated, including what the update changed. |
| A plugin is turned on mid-session | Shows the card right away. With `XRAY_GATE=strict` it holds a plugin marked 🔴 until you decide. |
| The agent runs `claude plugin install` or `claude mcp add` | Scans the target first and asks you, with the card as the reason. |

Ordinary commands pass straight through; the install check only wakes up for install commands.

### Any agent: as an MCP server

```bash
claude mcp add plugin-xray -- npx -y plugin-xray@0.1.2 mcp     # Claude Code
codex mcp add plugin-xray -- npx -y plugin-xray@0.1.2 mcp      # Codex
```

Tools: `xray_audit`, `xray_scan` (check before installing), `xray_diff`. For Cursor, VS Code, Gemini CLI or Windsurf, add the same command to the host's MCP settings.

### In CI, for plugin authors

```yaml
- run: npx -y plugin-xray@0.1.2 scan . --fail-on attention
```

## What it reads

| Host | Plugins & skills | MCP servers |
|---|---|---|
| Claude Code | `~/.claude/plugins`, `~/.claude/skills`, project `.claude/skills` | `~/.claude.json`, project `.mcp.json`, each plugin's `.mcp.json` |
| Claude desktop | | `claude_desktop_config.json` |
| Codex | | `~/.codex/config.toml` |
| Cursor | | `~/.cursor/mcp.json` |
| VS Code | | user `mcp.json` |
| Gemini CLI | | `~/.gemini/settings.json` |
| Windsurf | | `~/.codeium/windsurf/mcp_config.json` |

Targets for `scan` and `diff`: a folder, an npm package (`name` or `npm:name@1.2.3`), `github:owner/repo`, or `plugin@marketplace` for a marketplace you have added.

## How it works

1. **Inventory.** One small adapter per host finds what is installed. Adding a new agent is one entry.
2. **Quick scan.** Reads manifests, skills, hooks and code as text. Nothing is executed and nothing leaves your machine. It takes under a second.
3. **Tool count (`--tools`, opt-in).** Starts a local connector once to read its tool list, because that is the only honest way to measure it. This runs the connector's code, so it only happens when you ask.
4. **Deep scan (`--deep`, opt-in).** Hands a JavaScript package to [REA](https://github.com/morluto/rea), an open-source static analyzer, which traces every program launch, network call, file open and config read with its source location. It takes about a minute and adds evidence that plain text matching can miss.

Every result is a small JSON digest (`--json`, schema `xray.digest/v1`). The CLI, the hooks, the MCP server and CI all read the same digest.

## What it does not do

- **It reports; it does not judge.** 🔴 means "look at this", with the file and line. Plenty of honest tools run programs or talk to the network. That is often their job.
- **Static reading has limits.** Code that builds its behaviour at runtime, or hides it in a dependency, can get past the quick scan. `--deep` narrows that gap; it does not close it.
- **Token numbers are estimates** (about 4 characters per token). Remote connectors only reveal their tool lists after you sign in.
- **It never changes your setup.** To turn something off, use `/plugin` or `claude plugin disable <name>`.

## Development

```bash
npm test          # node:test, no dependencies
node cli/xray.mjs --help
```

Plugin X-ray has no runtime dependencies and needs Node 20 or later.

## Credits

The deep scan uses [REA: Reverse Engineer Anything](https://github.com/morluto/rea) (MIT), run through `npx` at a pinned version.

## License

MIT © Yeswanth Varma Kanumuri
