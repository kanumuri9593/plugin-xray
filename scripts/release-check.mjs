// Every place that names the version must agree before a release ships.
import fs from 'node:fs';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const v = read('package.json').version;
const found = {
  'package.json': v,
  '.claude-plugin/plugin.json': read('.claude-plugin/plugin.json').version,
  '.codex-plugin/plugin.json': read('.codex-plugin/plugin.json').version,
  'server.json': read('server.json').version,
  'server.json packages[0]': read('server.json').packages[0].version,
};
const pinned = [...fs.readFileSync(new URL('../.codex-plugin/mcp.json', import.meta.url), 'utf8').matchAll(/plugin-xray@([\d.]+)/g)].map((m) => m[1]);
pinned.forEach((p, i) => { found[`.codex-plugin/mcp.json pin ${i + 1}`] = p; });
const bad = Object.entries(found).filter(([, x]) => x !== v);
if (bad.length) {
  console.error(`Version mismatch (package.json is ${v}):\n${bad.map(([f, x]) => `  ${f}: ${x}`).join('\n')}`);
  process.exit(1);
}
console.log(`All versions match ${v}`);
