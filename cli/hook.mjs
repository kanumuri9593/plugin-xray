#!/usr/bin/env node
// Hook entry kept tiny: for the Bash pre-check it reads stdin and exits at once
// unless the command installs a plugin or MCP server, so ordinary commands pay
// only Node's startup time.
import fs from 'node:fs';

const event = process.argv[2];
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }

if (event === 'pre-tool-use' && !/\bclaude\s+(plugin\s+(install|i)\b|mcp\s+add)/.test(raw)) {
  process.stdout.write('{}');
} else {
  const { runHook } = await import('../src/hooks.mjs');
  await runHook(event, raw);
}
