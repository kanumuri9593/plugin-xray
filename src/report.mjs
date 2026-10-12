// Reports: a short list of recommendations, a history of totals so each report
// can show the trend, and a self-contained HTML page. Used by `xray report`,
// the onboarding scan, the weekly/monthly check at session start, the MCP
// server and the in-app band, so every surface says the same thing.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, readJson, fmtTokens, plural } from './util.mjs';
import { findingText } from './render.mjs';
import { oneLiner, usageText } from './clean.mjs';
import { ago } from './usage.mjs';

const DAY = 86400000;
export const reportDir = () => path.join(process.env.XRAY_STATE_DIR || path.join(HOME, '.plugin-xray'), 'reports');
const historyFile = () => path.join(reportDir(), 'history.json');

// Weekly by default; XRAY_REPORT=monthly, daily or off.
export function reportEvery() {
  const v = (process.env.XRAY_REPORT || 'weekly').toLowerCase();
  return { off: null, daily: 1, weekly: 7, monthly: 30 }[v] ?? 7;
}

// Up to five things worth doing, most valuable first.
export function recommend(r) {
  const out = [];
  const plugins = r.cleanup.filter((x) => x.kind === 'plugin');
  const saves = plugins.reduce((a, x) => a + x.saves, 0);
  if (plugins.length) out.push({ level: 'save', title: `Remove ${plural(plugins.length, 'unused plugin')}`, detail: `${plugins.slice(0, 4).map((x) => x.name).join(', ')}${plugins.length > 4 ? '…' : ''}${saves ? `: saves ≈${fmtTokens(saves)} tokens every turn` : ''}.`, action: 'xray clean' });
  const red = r.digests.filter((d) => d.enabled && d.level === 'attention');
  for (const d of red.slice(0, 2)) {
    const f = d.findings.find((x) => x.level === 'attention');
    out.push({ level: 'attention', title: `Check ${d.name}`, detail: `${findingText(f)}${f.where?.length ? ` (${f.where[0]})` : ''}.`, action: `xray scan ${d.root ? '"' + d.root + '"' : d.name}` });
  }
  const dup = r.overlaps.filter((o) => o.type === 'duplicate-connector');
  if (dup.length) out.push({ level: 'tidy', title: `Remove ${plural(dup.length, 'duplicate connector')}`, detail: `${dup.slice(0, 3).map((o) => o.members[0].server).join(', ')} ${dup.length === 1 ? 'is' : 'are'} installed more than once.`, action: 'xray --details' });
  const unpinned = r.digests.filter((d) => d.enabled && d.findings.some((f) => f.code === 'unpinned'));
  if (unpinned.length) out.push({ level: 'tidy', title: `Pin ${plural(unpinned.length, 'connector')} to a version`, detail: 'Unpinned npx/uvx connectors can fetch new code on every start. Add @<version> to the package.', action: 'xray --details' });
  const conns = r.cleanup.filter((x) => x.kind === 'connector');
  if (conns.length) out.push({ level: 'tidy', title: `Review ${plural(conns.length, 'unused connector')}`, detail: `${conns.slice(0, 4).map((x) => x.name).join(', ')}${conns.length > 4 ? '…' : ''}.`, action: 'xray clean' });
  if (!out.length) out.push({ level: 'ok', title: 'All clear', detail: 'Nothing unused, duplicated or flagged.', action: null });
  return out.slice(0, 5);
}

export function snapshotOf(r) {
  return {
    at: new Date().toISOString(),
    tokens: r.totals.contextTokens,
    items: r.digests.filter((d) => d.enabled).length,
    connectors: r.totals.connectors,
    overlaps: r.overlaps.length,
    attention: r.digests.filter((d) => d.enabled && d.level === 'attention').length,
    unused: r.cleanup.filter((x) => x.kind === 'plugin').length,
  };
}

export function readHistory() { return readJson(historyFile())?.entries || []; }

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { mode: 0o600 });
}

// The compact view the band and hooks read: totals, change since the last
// report, the top recommendations, and when the next report is due.
export function summarize(r, history = readHistory()) {
  const now = snapshotOf(r);
  const prev = history.at(-1) || null;
  const every = reportEvery();
  const due = every != null && (!prev || Date.now() - Date.parse(prev.at) >= every * DAY);
  return {
    ...now,
    previous: prev,
    change: prev ? now.tokens - prev.tokens : null,
    recommendations: recommend(r),
    lastReport: prev?.at || null,
    reportDue: due,
    every,
    rows: [...r.digests].sort((a, b) => b.contextTokens - a.contextTokens).map((d) => ({ name: d.name, tokens: d.contextTokens, level: d.level, enabled: d.enabled, used: usageText(d, ago), what: oneLiner(d, 70), remove: r.cleanup.some((x) => x.kind === 'plugin' && x.name === d.name) })),
    latestHtml: fs.existsSync(path.join(reportDir(), 'latest.html')) ? path.join(reportDir(), 'latest.html') : null,
  };
}

// Writes the HTML page and a history entry. Returns where it went.
export function writeReport(r) {
  const history = readHistory();
  const s = summarize(r, history);
  const html = renderHtml(r, s, history);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(reportDir(), `xray-${day}.html`);
  writePrivate(file, html);
  writePrivate(path.join(reportDir(), 'latest.html'), html);
  writePrivate(historyFile(), JSON.stringify({ entries: [...history, snapshotOf(r)].slice(-104) }, null, 1));
  return { file, latest: path.join(reportDir(), 'latest.html'), summary: { ...s, lastReport: new Date().toISOString(), reportDue: false } };
}

export function summaryText(s, { title = 'Plugin X-ray' } = {}) {
  const trend = s.change == null ? '' : s.change === 0 ? ' (no change)' : ` (${s.change > 0 ? '+' : '−'}${fmtTokens(Math.abs(s.change))} since last report)`;
  const lines = [`${title}: ≈${fmtTokens(s.tokens)} tokens every turn${trend} · ${plural(s.items, 'item')} on · ${plural(s.overlaps, 'overlap')}${s.attention ? ` · ${s.attention} need attention` : ''}`];
  for (const x of s.recommendations) lines.push(`- ${x.level === 'attention' ? '🔴' : x.level === 'save' ? '💰' : x.level === 'ok' ? '🟢' : '🧹'} ${x.title}: ${x.detail}`);
  return lines.join('\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function spark(history, now) {
  const pts = [...history.map((h) => h.tokens), now.tokens].slice(-12);
  if (pts.length < 2) return '';
  const max = Math.max(...pts, 1), w = 220, h = 48;
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - (v / max) * (h - 6) - 3}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="Tokens per turn over the last ${pts.length} reports"><polyline points="${xy.join(' ')}"/></svg>`;
}

export function renderHtml(r, s, history = []) {
  const rows = [...r.digests].sort((a, b) => b.contextTokens - a.contextTokens).map((d) => {
    const use = usageText(d, ago) || '';
    const unused = /unused/.test(use);
    return `<tr class="${d.enabled ? '' : 'off'}"><td><span class="dot ${d.level}"></span>${esc(d.name)}</td><td class="num">≈${fmtTokens(d.contextTokens)}</td><td><span class="pill ${use === 'off' ? 'muted' : unused ? 'warn' : use ? 'good' : 'muted'}">${esc(use || '—')}</span></td><td class="what">${esc(oneLiner(d, 110))}</td></tr>`;
  }).join('');
  const recs = s.recommendations.map((x) => `<li class="rec ${x.level}"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span>${x.action ? `<code>${esc(x.action)}</code>` : ''}</li>`).join('');
  const clean = r.cleanup.length ? `<h2>Clean up</h2><table><thead><tr><th>Item</th><th class="num">Saves</th><th>Why</th><th>Remove with</th></tr></thead><tbody>${r.cleanup.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.saves ? '≈' + fmtTokens(x.saves) : ''}</td><td>${esc(x.why)}</td><td><code>${esc(x.command || x.note)}</code></td></tr>`).join('')}</tbody></table>` : '';
  const trend = s.change == null ? 'First report' : s.change === 0 ? 'No change since last report' : `${s.change > 0 ? '▲' : '▼'} ${fmtTokens(Math.abs(s.change))} since last report`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plugin X-ray report</title>
<style>
:root{--bg:#f7f7fb;--card:#fff;--ink:#16161d;--dim:#6b6b7b;--line:#e6e6ef;--ok:#16a34a;--review:#d97706;--attention:#dc2626;--accent:#6d28d9;--good-bg:#dcfce7;--warn-bg:#fef3c7;--muted-bg:#ececf3}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f14;--card:#181820;--ink:#ececf3;--dim:#9a9aab;--line:#2a2a36;--good-bg:#14361f;--warn-bg:#3a2b0b;--muted-bg:#24242e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:center;gap:12px;margin-bottom:20px}.logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6d28d9,#0ea5e9);display:grid;place-items:center;color:#fff;font-weight:700}
h1{font-size:22px;margin:0}h2{font-size:17px;margin:28px 0 10px}.sub{color:var(--dim);font-size:13px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}.stat b{display:block;font-size:26px}.stat span{color:var(--dim);font-size:13px}
.stat.hero{background:linear-gradient(135deg,#6d28d9,#0ea5e9);color:#fff;border:0}.stat.hero span{color:#ece9ff}
.spark polyline{fill:none;stroke:#fff;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
ul.recs{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.rec{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--accent);border-radius:12px;padding:12px 14px;display:grid;gap:4px}
.rec.attention{border-left-color:var(--attention)}.rec.save{border-left-color:var(--ok)}.rec.tidy{border-left-color:var(--review)}.rec span{color:var(--dim)}
code{justify-self:start;font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--muted-bg);padding:2px 6px;border-radius:6px;word-break:break-all}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--dim);font-weight:600}
td.num,th.num{text-align:right;white-space:nowrap}td.what{color:var(--dim)}tr.off td{opacity:.55}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px}.dot.ok{background:var(--ok)}.dot.review{background:var(--review)}.dot.attention{background:var(--attention)}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;white-space:nowrap}.pill.good{background:var(--good-bg)}.pill.warn{background:var(--warn-bg)}.pill.muted{background:var(--muted-bg);color:var(--dim)}
.wrap{overflow-x:auto}footer{color:var(--dim);font-size:12px;margin-top:28px}
</style></head><body><main>
<header><div class="logo">X</div><div><h1>Plugin X-ray report</h1><div class="sub">${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))} · read locally, nothing sent anywhere</div></div></header>
<section class="stats">
<div class="stat hero"><b>≈${fmtTokens(s.tokens)}</b><span>tokens on every turn · ${esc(trend)}</span>${spark(history, s)}</div>
<div class="stat"><b>${s.items}</b><span>plugins and skill sets on</span></div>
<div class="stat"><b>${s.connectors}</b><span>connectors</span></div>
<div class="stat"><b>${s.overlaps}</b><span>overlaps</span></div>
<div class="stat"><b style="color:${s.attention ? 'var(--attention)' : 'var(--ok)'}">${s.attention}</b><span>need attention</span></div>
</section>
<h2>Recommended</h2><ul class="recs">${recs}</ul>
<h2>Everything installed</h2><div class="wrap"><table><thead><tr><th>Item</th><th class="num">Tokens/turn</th><th>Used</th><th>What it does</th></tr></thead><tbody>${rows}</tbody></table></div>
${clean ? `<div class="wrap">${clean}</div>` : ''}
<footer>Plugin X-ray ${esc(r.version || '')} · token counts are estimates (~4 characters per token) · usage comes from your local Claude Code session logs · reports: ${esc(reportDir())}</footer>
</main></body></html>`;
}
