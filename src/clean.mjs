import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME } from './util.mjs';
import { discover } from './discover.mjs';
import { unusedText } from './usage.mjs';

// Turns an audit into a short cleanup list: what each unused or switched-off
// item is, what removing it saves, and the exact command that removes it.
// Nothing here runs those commands; `xray clean --yes` or the agent does,
// after the user picks.

function short(text, n = 60) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  const first = s.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  return first.length > n ? first.slice(0, n - 1).trimEnd() + '…' : first;
}

// One line on what an item is for.
export function oneLiner(d) {
  if (d.description) return short(d.description);
  if (d.kind === 'skills') return short(d.items.map((i) => i.name).join(', '), 60);
  if (d.kind === 'mcp') return short(`Connectors: ${d.servers.map((s) => s.name).join(', ')}`);
  return short(d.items[0]?.description || '');
}

// How the item has been used, in a few words, or null when unknown.
export function usageText(d, ago) {
  const u = d.usage;
  if (!u) return null;
  if (!d.enabled) return 'off';
  if (!u.count) return `unused ${u.from ? Math.max(1, Math.round((Date.now() - u.from) / 86400000)) : u.days}d`;
  return `used ${ago(u.last)}`;
}

function removeCommand(d, server) {
  if (d.kind === 'plugin') {
    if (/@synced$/.test(d.id) || d.source === 'synced') return null;
    return `claude plugin uninstall ${d.id}`;
  }
  if (d.kind === 'mcp' && server) {
    const scope = /user/.test(d.id) ? 'user' : /project/.test(d.id) ? 'local' : null;
    return scope ? `claude mcp remove ${server.name} -s ${scope}` : null;
  }
  return null;
}

// Candidates, biggest saving first.
// Nothing is suggested until there is at least `minDays` of history to go on.
export function cleanupList(digests, { minDays = 7, now = Date.now() } = {}) {
  const out = [];
  for (const d of digests) {
    if (!d.usage || d.name === 'Plugin X-ray') continue;
    if (d.usage.from && now - d.usage.from < minDays * 86400000 && d.enabled) continue;
    // Free items (no per-turn text, no connectors) are left alone even when unused.
    const costs = d.contextTokens >= 100 || d.servers.length > 0;
    if (d.kind === 'plugin' && (!d.enabled || (!d.usage.count && costs))) {
      const other = d.usage.otherCopy?.length ? `; you use your other ${d.usage.otherCopy.join(', ')}` : '';
      const why = !d.enabled ? 'switched off' : unusedText(d.usage) + other;
      out.push({ kind: 'plugin', id: d.id, name: d.name, what: oneLiner(d), why, flagged: d.level === 'attention', saves: d.enabled ? d.contextTokens : 0, connectors: d.enabled ? d.servers.length : 0, command: removeCommand(d), note: removeCommand(d) ? null : 'Synced from your claude.ai organisation: remove it there.' });
    }
    if (d.kind === 'mcp') for (const s of d.servers) {
      if (s.usage?.count) continue;
      out.push({ kind: 'connector', id: `${d.id}:${s.name}`, unit: d.id, name: s.name, what: `${d.name} connector${s.package ? ` (${s.package})` : s.host ? ` (${s.host})` : ''}`, why: unusedText(s.usage), saves: 0, connectors: 1, command: removeCommand(d, s) });
    }
  }
  return out.sort((a, b) => b.saves - a.saves || b.connectors - a.connectors);
}

// Runs the removal for one picked item. A connector's settings (which can hold
// keys) are saved first, because `claude mcp remove` deletes them for good.
export function removeItem(x, { run = spawnSync } = {}) {
  if (!x.command) return { ok: false, message: x.note || 'no command to remove this' };
  let undo = x.kind === 'plugin' ? `claude plugin install ${x.id}` : null;
  if (x.kind === 'connector') {
    const unit = discover().find((u) => u.id === x.unit);
    const cfg = unit?.servers?.[x.name];
    if (!cfg) return { ok: false, message: 'could not read its settings to save them, so it was left in place' };
    const dir = path.join(process.env.CLAUDE_PLUGIN_DATA || path.join(HOME, '.plugin-xray'), 'removed');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${x.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    const scope = x.command.match(/-s (\w+)/)?.[1] || 'user';
    undo = `claude mcp add-json ${x.name} "$(cat '${file}')" -s ${scope}`;
  }
  const [bin, ...rest] = x.command.split(' ');
  const res = run(bin, rest, { stdio: 'inherit', shell: process.platform === 'win32' });
  return res.status === 0 ? { ok: true, message: `removed. Undo: ${undo}` } : { ok: false, message: `${x.command} failed` };
}
