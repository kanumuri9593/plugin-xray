# What popular MCP servers cost in context

Measured 2026-10-12 with plugin-xray 0.1.0 (`xray scan npm:<pkg> --tools`): each server was started once in a cloud container, asked for its tool list over MCP, and the JSON tool list was sized at ~4 characters per token. This is what the tool definitions add to a request when a client loads them all up front. Clients that defer tool loading (Claude Code's tool search) pay less until a tool is used.

| Server | Version | Tools | ≈ Tokens |
|---|---|---:|---:|
| firecrawl-mcp | 3.29.1 | 26 | 21,164 |
| @notionhq/notion-mcp-server | 2.5.2 | 24 | 19,054 |
| chrome-devtools-mcp | 1.10.1 | 30 | 6,597 |
| mcp-server-kubernetes | 4.1.9 | 23 | 5,964 |
| @heroku/mcp-server | 1.2.11 | 33 | 5,612 |
| baton-run | 0.2.10 | 29 | 5,336 |
| @playwright/mcp | 0.0.83 | 25 | 5,072 |
| @modelcontextprotocol/server-github | 2025.4.8 | 26 | 3,964 |
| @modelcontextprotocol/server-memory | 1.0.0 | 9 | 2,767 |
| tavily-mcp | 0.2.22 | 5 | 1,924 |
| @modelcontextprotocol/server-everything | 1.0.0 | 13 | 1,914 |
| @upstash/context7-mcp | 4.3.0 | 2 | 1,307 |
| @modelcontextprotocol/server-sequential-thinking | 1.0.0 | 1 | 1,161 |
| exa-mcp-server | 3.4.2 | 2 | 535 |

Total for these 14: ≈82,371 tokens.

Not measured (needed an API key or a config to start, so the tool list never came back): @azure/mcp, @brave/brave-search-mcp-server, @browserbasehq/mcp-server-browserbase, @cloudflare/mcp-server-cloudflare, @modelcontextprotocol/server-filesystem, @sentry/mcp-server, @stripe/mcp, @supabase/mcp-server-supabase, figma-developer-mcp, @21st-dev/magic (started but listed no tools without a key).

Reproduce one row: `npx -y plugin-xray scan npm:<package> --tools`.
