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
  if (!u.count) return `unused ${u.days}d`;
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
export function cleanupList(digests) {
  const out = [];
  for (const d of digests) {
    if (!d.usage || d.name === 'Plugin X-ray') continue;
    // Free items (no per-turn text, no connectors) are left alone even when unused.
    const costs = d.contextTokens >= 100 || d.servers.length > 0;
    if (d.kind === 'plugin' && (!d.enabled || (!d.usage.count && costs))) {
      const why = !d.enabled ? 'switched off' : `not used in ${d.usage.days} days`;
      const why2 = d.level === 'attention' ? `${why}, and has findings worth a look` : why;
      out.push({ id: d.id, name: d.name, what: oneLiner(d), why: why2, saves: d.enabled ? d.contextTokens : 0, connectors: d.enabled ? d.servers.length : 0, command: removeCommand(d), note: removeCommand(d) ? null : 'Synced from your claude.ai organisation: remove it there.' });
    }
    if (d.kind === 'mcp') for (const s of d.servers) {
      if (s.usage?.count) continue;
      out.push({ id: `${d.id}:${s.name}`, name: s.name, what: `${d.name} connector${s.package ? ` (${s.package})` : s.host ? ` (${s.host})` : ''}`, why: `not used in ${s.usage.days} days`, saves: 0, connectors: 1, command: removeCommand(d, s) });
    }
  }
  return out.sort((a, b) => b.saves - a.saves || b.connectors - a.connectors);
}
