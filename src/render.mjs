import { c, fmtTokens, plural } from './util.mjs';

const DOT = { ok: c.green('●'), review: c.yellow('●'), attention: c.red('●') };
const WORD = { ok: c.green('ok'), review: c.yellow('review'), attention: c.red('attention') };
const PLAIN = { ok: '🟢', review: '🟡', attention: '🔴' };

const CODE_TEXT = {
  'runs-programs': 'runs programs on your machine',
  network: 'talks to the network',
  'reads-secret-files': 'reads credential files (SSH keys, cloud logins)',
  'dumps-environment': 'collects all environment variables',
  'reads-secrets-env': 'reads API keys from the environment',
  'dynamic-code': 'builds and runs code at runtime',
  'download-and-run': 'downloads a script and runs it',
  destructive: 'can delete files or use sudo',
};

export function findingText(f) {
  return f.text || CODE_TEXT[f.code] || f.code;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

export function summaryLine(d) {
  const parts = [];
  for (const kind of ['skill', 'command', 'agent']) {
    const n = d.items.filter((i) => i.kind === kind).length;
    if (n) parts.push(plural(n, kind));
  }
  if (d.servers.length) parts.push(plural(d.servers.length, 'connector'));
  if (d.hooks.length) parts.push(plural(d.hooks.length, 'hook'));
  return parts.join(' · ') || 'nothing loaded';
}

export function renderAudit(report, { details = false } = {}) {
  const { digests, overlaps, totals } = report;
  const lines = [];
  lines.push(`${c.bold('Plugin X-ray')}  ${plural(digests.length, 'item')} · ${c.bold('≈' + fmtTokens(totals.contextTokens))} tokens on every turn${totals.toolTokens != null ? ` + ≈${fmtTokens(totals.toolTokens)} in local tool lists` : ''} · ${plural(totals.connectors, 'connector')} · ${plural(overlaps.length, 'overlap')}`);
  lines.push('');
  const w = Math.min(28, Math.max(...digests.map((d) => d.name.length), 8) + 1);
  for (const d of [...digests].sort((a, b) => b.contextTokens - a.contextTokens)) {
    const off = d.enabled ? '' : c.dim(' (off)');
    lines.push(`  ${DOT[d.level]} ${pad(d.name, w)}${lpad('≈' + fmtTokens(d.contextTokens), 7)}  ${c.dim(pad(summaryLine(d), 44))} ${WORD[d.level]}${off}`);
  }
  if (overlaps.length) {
    lines.push('', c.bold('Overlaps'));
    for (const o of overlaps.slice(0, details ? 99 : 8)) lines.push(`  ${c.yellow('⇄')} ${o.label}  ${c.dim(o.suggestion)}`);
    if (!details && overlaps.length > 8) lines.push(c.dim(`  … ${overlaps.length - 8} more (--details)`));
  }
  const flagged = digests.filter((d) => d.level !== 'ok');
  if (flagged.length) {
    lines.push('', c.bold('Worth a look'));
    for (const d of flagged) for (const f of d.findings.filter((x) => x.level !== 'info')) {
      lines.push(`  ${DOT[f.level]} ${d.name}: ${findingText(f)}  ${c.dim((f.where || []).slice(0, 2).join(', '))}`);
    }
  }
  if (details) for (const d of digests) lines.push('', renderCard(d, [], { compact: true }));
  lines.push('', c.dim('Token counts are estimates (~4 chars/token) of what loads before you type. Connector tool lists add more once they connect.'));
  return lines.join('\n');
}

export function renderCard(d, overlaps = [], { compact = false } = {}) {
  const lines = [];
  lines.push(`${DOT[d.level]} ${c.bold(d.name)}${d.version ? c.dim(' ' + d.version) : ''}  ${WORD[d.level]}`);
  if (d.description && !compact) lines.push(`  ${c.dim(d.description)}`);
  lines.push(`  ${c.cyan('Context')}   ${d.items.length ? `≈${fmtTokens(d.contextTokens)} tokens every turn` : 'nothing until its tools load'} · ${summaryLine(d)}`);
  for (const s of d.servers.filter((x) => x.tools)) lines.push(`  ${c.cyan('Tools')}     ${s.name}: ${s.tools.ok ? `${s.tools.count} tools ≈${fmtTokens(s.tools.tokens)} tokens when loaded` : c.dim(s.tools.error)}`);
  const can = d.findings.filter((f) => ['runs-programs', 'network', 'reads-secrets-env', 'adds-commands', 'background-process', 'hook-every-turn', 'hook-every-tool'].includes(f.code));
  if (can.length) lines.push(`  ${c.cyan('Can')}       ${[...new Set(can.map(findingText))].join(' · ')}`);
  if (d.servers.length) lines.push(`  ${c.cyan('Connects')}  ${d.servers.map((s) => s.host || s.package || s.command || s.name).slice(0, 8).join(', ')}${d.servers.length > 8 ? ` +${d.servers.length - 8}` : ''}`);
  if (d.hosts.length) lines.push(`  ${c.cyan('Talks to')}  ${d.hosts.slice(0, 8).join(', ')}${d.hosts.length > 8 ? ` +${d.hosts.length - 8}` : ''}`);
  if (d.emails?.length) lines.push(`  ${c.cyan('Emails')}    ${d.emails.slice(0, 5).join(', ')}`);
  for (const f of d.findings.filter((x) => x.level !== 'info')) lines.push(`  ${DOT[f.level]} ${findingText(f)}  ${c.dim((f.where || []).slice(0, 2).join(', '))}`);
  for (const o of overlaps) lines.push(`  ${c.yellow('⇄')} ${o.label}  ${c.dim(o.suggestion)}`);
  if (d.deep) lines.push(`  ${c.magenta('Deep scan')} ${d.deep.summary}`);
  return lines.join('\n');
}

// Plain markdown (no ANSI) for chat surfaces and hook messages.
export function cardText(d, overlaps = []) {
  const lines = [`${PLAIN[d.level]} **${d.name}**${d.version ? ` ${d.version}` : ''}: ≈${fmtTokens(d.contextTokens)} tokens/turn · ${summaryLine(d)}`];
  for (const f of d.findings.filter((x) => x.level !== 'info')) lines.push(`- ${PLAIN[f.level]} ${findingText(f)}${f.where?.length ? ` (${f.where.slice(0, 2).join(', ')})` : ''}`);
  for (const o of overlaps.slice(0, 4)) lines.push(`- ⇄ ${o.label}. ${o.suggestion}`);
  return lines.join('\n');
}

export function renderDiff(diff) {
  const lines = [`${c.bold('What changed')} ${diff.from} → ${diff.to}`];
  if (!diff.changes.length) lines.push(c.green('  No new capabilities.'));
  for (const ch of diff.changes) lines.push(`  ${ch.level === 'attention' ? c.red('+') : c.yellow('+')} ${ch.text}`);
  if (diff.tokenDelta) lines.push(c.dim(`  Context cost ${diff.tokenDelta > 0 ? '+' : ''}${diff.tokenDelta} tokens per turn`));
  return lines.join('\n');
}
