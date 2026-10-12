# Plugin X-ray in a company

Plugin X-ray is built to run on locked-down developer machines: no runtime dependencies, no telemetry, nothing executed from the plugins it reads, and an offline switch that turns off every network call. This page is for the person rolling it out.

## What it needs

- Node.js 20 or later on the developer's PATH (the hooks run `node`). Without Node the hooks fail quietly and Claude Code carries on.
- Read access to `~/.claude` and the agents' settings files. Write access to the plugin's data folder for its snapshot.
- Nothing else. No ports, no services, no accounts.

## Network: what goes out, and how to turn it off

The audit, the hooks and `xray clean` never use the network. Only these do, and only when asked:

| Feature | Goes to | Uses |
|---|---|---|
| `scan <npm package>` and the install check on `claude plugin install` / `claude mcp add` | your npm registry | `npm pack --ignore-scripts`, so your `.npmrc` registry, proxy and CA settings apply |
| `scan github:…` or a git URL | that git host | `git clone --depth 1`, so your git proxy and credentials apply |
| `--deep` | your npm registry | `npx rea-agents@6.4.0` (pin another with `XRAY_REA_VERSION`) |
| `--tools` | whatever the scanned server connects to | starts the server once |

To allow none of it, set `XRAY_OFFLINE=1` (or pass `--offline`). X-ray then scans local folders only, and the install check lets installs through without a card instead of fetching anything.

To stop X-ray reading session logs for "last used", set `XRAY_USAGE=off`. Only tool names and timestamps are ever read from them; prompts and code are not.

## Roll it out to every developer (Claude Code managed settings)

Put this in the managed settings file (`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS, `/etc/claude-code/managed-settings.json` on Linux, `C:\Program Files\ClaudeCode\managed-settings.json` on Windows, or the same keys through MDM or server-managed settings):

```json
{
  "extraKnownMarketplaces": {
    "plugin-xray": { "source": { "source": "github", "repo": "kanumuri9593/plugin-xray" } }
  },
  "enabledPlugins": { "plugin-xray@plugin-xray": true },
  "env": { "XRAY_OFFLINE": "1" }
}
```

- `enabledPlugins: true` in managed settings turns it on for everyone; users cannot turn it off.
- Drop the `env` line if developers may fetch scan targets from your registry.
- If you use `allowManagedHooksOnly`, X-ray's hooks still run, because hooks from plugins force-enabled in managed settings are trusted.
- To make X-ray hold a plugin with red findings until the developer decides, add `"XRAY_GATE": "strict"` to `env`.

Details: [Claude Code plugins for organisations](https://code.claude.com/docs/en/plugins/org) and [managed settings](https://code.claude.com/docs/en/managed-settings).

## Internal git, mirrors and air-gapped networks

The repository is its own marketplace and the plugin has no dependencies, so a copy is all you need:

1. Mirror `github.com/kanumuri9593/plugin-xray` to your git host (GitHub Enterprise, GitLab, Bitbucket), pinned to a release tag.
2. Point the marketplace at the mirror: `"source": { "source": "git", "url": "https://git.example.com/tools/plugin-xray.git" }`. Developers' own git credentials are used.
3. For the CLI and MCP server, publish the npm tarball to your internal registry (Artifactory, Nexus, Verdaccio), or run it from the mirror with `node cli/xray.mjs`.

Before adopting a new version, run `xray diff <current folder> <new folder>` on X-ray itself, and review the CHANGELOG.

## Verify a release

- `npm audit signatures` checks the npm provenance: each version links to the GitHub commit and workflow that built it.
- `npx plugin-xray scan npm:plugin-xray@<version> --fail-on attention` scans X-ray with itself; CI does this on every commit.

## Use it as a gate in CI

```yaml
- run: npx -y plugin-xray@0.2.4 scan ./our-plugin --fail-on attention --offline
```

Fails the build when a plugin your team ships gains a red finding: reading credential files, downloading and running scripts, hidden instructions, or literal keys.
