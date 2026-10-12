// Public API. Every front end (CLI, Claude Code hooks, MCP, CI) calls these and
// gets back plain digest JSON, so new surfaces never touch the analysis.
import { discover } from './discover.mjs';
import { analyze, analyzePlugin, serverConfigFromPlugin } from './analyze.mjs';
import { findOverlaps, overlapsFor } from './overlap.mjs';
import { resolveTarget, cleanup } from './fetch.mjs';
import { diffDigests } from './diff.mjs';
import { deepScan } from './deep.mjs';
import { listTools } from './tools.mjs';
import { readUsage, attachUsage } from './usage.mjs';
import { cleanupList } from './clean.mjs';

export { DIGEST_VERSION } from './analyze.mjs';
export { diffDigests, findOverlaps };

function expand(cfg, root) {
  const sub = (v) => String(v).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root || '').replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? '');
  return { ...cfg, command: cfg.command && sub(cfg.command), args: (cfg.args || []).map(sub), env: Object.fromEntries(Object.entries(cfg.env || {}).map(([k, v]) => [k, sub(v)])) };
}

// Starts each local (stdio) connector once to count its tool list. Opt-in.
export async function countTools(digests, configs) {
  await Promise.all(digests.flatMap((d) => d.servers.map(async (s) => {
    const cfg = configs.get(`${d.id}|${s.name}`);
    if (!cfg || cfg.url) return;
    s.tools = await listTools(expand(cfg, d.root));
  })));
  for (const d of digests) d.toolTokens = d.servers.reduce((a, s) => a + (s.tools?.ok ? s.tools.tokens : 0), 0);
}

export async function audit({ tools = false, usage = true, days = 30 } = {}) {
  const units = discover();
  const digests = units.map(analyze);
  const used = usage ? readUsage({ days }) : null;
  if (used) attachUsage(digests, used);
  if (tools) {
    const configs = new Map();
    for (const [i, u] of units.entries()) for (const s of digests[i].servers) configs.set(`${digests[i].id}|${s.name}`, u.servers?.[s.name] || serverConfigFromPlugin(u.root, s.name));
    await countTools(digests, configs);
  }
  const overlaps = findOverlaps(digests);
  const on = digests.filter((d) => d.enabled);
  return {
    generatedAt: new Date().toISOString(),
    digests,
    overlaps,
    cleanup: cleanupList(digests),
    history: used ? { days: used.days, from: used.from, sessions: used.sessions } : null,
    totals: {
      items: digests.length,
      contextTokens: on.reduce((a, d) => a + d.contextTokens, 0),
      toolTokens: tools ? on.reduce((a, d) => a + (d.toolTokens || 0), 0) : null,
      connectors: on.reduce((a, d) => a + d.servers.length, 0),
      attention: digests.filter((d) => d.level === 'attention').length,
      review: digests.filter((d) => d.level === 'review').length,
    },
  };
}

// Scan something before it is installed. Nothing in the target is executed.
export async function scan(target, { deep = false, compare = true, tools = false } = {}) {
  const t = resolveTarget(target);
  try {
    const d = analyzePlugin({ kind: 'plugin', host: 'claude-code', id: t.label, name: t.name || t.label, root: t.root, version: t.version });
    d.source = target;
    if (deep) d.deep = deepScan(t.root);
    if (tools) {
      const configs = new Map(d.servers.map((s) => [`${d.id}|${s.name}`, serverConfigFromPlugin(t.root, s.name)]));
      if (!d.servers.length && t.label.includes('@') && !t.root.endsWith('repo')) {
        d.servers.push({ name: d.name, transport: 'stdio', package: t.label, categories: [] });
        configs.set(`${d.id}|${d.name}`, { command: 'npx', args: ['-y', t.label] });
      }
      await countTools([d], configs);
    }
    const installed = compare ? discover().map(analyze) : [];
    const same = installed.find((x) => x.name === d.name);
    return {
      digest: d,
      overlaps: compare ? overlapsFor(d, installed) : [],
      update: same ? diffDigests(same, d) : null,
    };
  } finally { cleanup(t); }
}

export async function diff(a, b) {
  const da = (await scan(a, { compare: false })).digest;
  const db = (await scan(b, { compare: false })).digest;
  return diffDigests(da, db);
}
