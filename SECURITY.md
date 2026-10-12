# Security

## Reporting a problem

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repository. You will get a reply within a few days. Please do not open a public issue for a vulnerability.

## What Plugin X-ray does on your machine

| Action | When | Network | Runs other programs |
|---|---|---|---|
| Read plugin, skill and MCP settings files | every audit and hook | no | no |
| Read Claude Code session logs (tool names and timestamps only) | audit, `clean` | no | no |
| Write a snapshot of what is installed | SessionStart / ConfigChange hooks | no | no |
| `npm pack --ignore-scripts` / `git clone --depth 1` a scan target | `scan <npm or git target>`, and the install check when the agent runs `claude plugin install` / `claude mcp add` | yes, through your npm and git settings | `npm`, `git`, `tar` |
| Start a stdio MCP server to count its tools | only with `--tools` | depends on the server | yes, the server |
| Download and run REA for the deep scan | only with `--deep` | yes (npm) | yes, `npx rea-agents` |
| `claude plugin uninstall` / `claude mcp remove` | only `clean --yes` with names you give, or when you approve it in Claude | no | `claude` |

- No telemetry. Plugin X-ray never sends anything anywhere.
- No runtime dependencies. The npm package is plain Node.js source with no install scripts.
- Scanned code is read as text. It is never imported, required or executed, except by the opt-in `--tools`.
- Before removing a connector, its settings (which may contain keys) are saved to `~/.plugin-xray/removed/` with owner-only permissions so it can be restored.
- `XRAY_OFFLINE=1` (or `--offline`) turns off every row above that uses the network or runs another program.
- `XRAY_USAGE=off` (or `--no-usage`) stops it reading session logs.

## Releases

Releases are published from GitHub Actions with npm trusted publishing and provenance, so each version on npm links back to the commit and workflow that built it. Check it with `npm audit signatures`.
