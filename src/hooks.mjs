// Claude Code hook handlers. Each reads the hook's JSON on stdin and prints the
// hook's JSON answer. They never block on their own; a strict gate is opt-in
// with XRAY_GATE=strict.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, readJson, fmtTokens, plural } from './util.mjs';
import { discover } from './discover.mjs';
import { analyze, describeServer } from './analyze.mjs';
import { findOverlaps, overlapsFor } from './overlap.mjs';
import { diffDigests } from './diff.mjs';
import { scan } from './index.mjs';
import { cardText } from './render.mjs';

const strict = () => process.env.XRAY_GATE === 'strict';
const stateDir = () => process.env.CLAUDE_PLUGIN_DATA || path.join(HOME, '.plugin-xray');
const snapFile = () => path.join(stateDir(), 'snapshot.json');

function loadSnap() { return readJson(snapFile()); }
function saveSnap(digests) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const slim = digests.map(({ items, ...d }) => ({ ...d, items: items.map(({ name, kind, tokens }) => ({ name, kind, tokens })) }));
  fs.writeFileSync(snapFile(), JSON.stringify({ savedAt: new Date().toISOString(), digests: slim }, null, 1), { mode: 0o600 });
  try { fs.chmodSync(snapFile(), 0o600); } catch { /* Windows */ }
}

const key = (d) => `${d.host}|${d.id}`;

// Shared by SessionStart and ConfigChange: what is new or changed since last look.
function changesSinceSnapshot() {
  const digests = discover().map(analyze);
  const snap = loadSnap();
  const before = new Map((snap?.digests || []).map((d) => [key(d), d]));
  const added = [], updated = [], enabled = [];
  for (const d of digests) {
    const old = before.get(key(d));
    if (!old) added.push(d);
    else if ((old.version && d.version && old.version !== d.version) || old.servers.length !== d.servers.length || old.hooks?.length !== d.hooks.length) updated.push({ d, diff: diffDigests({ ...old, items: old.items || [] }, d) });
    else if (!old.enabled && d.enabled) enabled.push(d);
  }
  return { digests, first: !snap, added, updated, enabled };
}

let RAW = null;
function readStdin() {
  try { return JSON.parse((RAW ?? fs.readFileSync(0, 'utf8')) || '{}'); } catch { return {}; }
}

export function sessionStart() {
  const { digests, first, added, updated, enabled } = changesSinceSnapshot();
  saveSnap(digests);
  const on = digests.filter((d) => d.enabled);
  const tokens = on.reduce((a, d) => a + d.contextTokens, 0);
  const overlaps = findOverlaps(digests);
  const msgs = [];
  if (first) {
    const flagged = digests.filter((d) => d.level === 'attention').length;
    msgs.push(`Plugin X-ray: ${plural(digests.length, 'item')} installed · ≈${fmtTokens(tokens)} tokens every turn · ${plural(overlaps.length, 'overlap')}${flagged ? ` · ${flagged} need attention` : ''}. Run /plugin-xray:xray for the audit.`);
  }
  // The first run has nothing to compare against: the summary line is enough.
  if (!first) for (const d of [...added, ...enabled]) msgs.push(`New since last session:\n${cardText(d, overlapsFor(d, digests))}`);
  if (!first) for (const { d, diff } of updated) if (diff.changes.length) msgs.push(`${d.name} changed (${diff.from} → ${diff.to}):\n${diff.changes.slice(0, 6).map((c) => `- ${c.level === 'attention' ? '🔴' : '🟡'} ${c.text}`).join('\n')}`);
  if (!msgs.length) return {};
  const text = msgs.join('\n\n');
  return {
    systemMessage: text,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Plugin X-ray report (tell the user briefly if they ask about plugins or if something needs attention):\n${text}` },
  };
}

export function configChange() {
  const input = readStdin();
  if (input.source && !/settings/.test(input.source)) return {};
  const { digests, added, enabled } = changesSinceSnapshot();
  const fresh = [...added, ...enabled].filter((d) => d.kind === 'plugin');
  saveSnap(digests);
  if (!fresh.length) return {};
  const text = fresh.map((d) => cardText(d, overlapsFor(d, digests))).join('\n\n');
  const risky = fresh.filter((d) => d.level === 'attention');
  if (strict() && risky.length) return { decision: 'block', reason: `Plugin X-ray held this change:\n${text}`, systemMessage: `Plugin X-ray held ${risky.map((d) => d.name).join(', ')}. Set XRAY_GATE=off to allow.` };
  return { systemMessage: `Plugin X-ray:\n${text}` };
}

function words(cmd) {
  return (cmd.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ''));
}

// Commands that install things, as the agent would run them through Bash.
export function installIntent(cmd) {
  const w = words(cmd);
  const i = w.findIndex((x, n) => x === 'claude' && ['plugin', 'mcp'].includes(w[n + 1]));
  if (i < 0) return null;
  const [group, verb] = [w[i + 1], w[i + 2]];
  const rest = w.slice(i + 3).filter((x) => x !== '--');
  if (group === 'plugin' && ['install', 'i'].includes(verb)) {
    const spec = rest.find((x) => !x.startsWith('-'));
    return spec ? { type: 'plugin', spec } : null;
  }
  if (group === 'mcp' && verb === 'add') {
    const pos = [];
    for (let k = 0; k < rest.length; k++) {
      if (/^-(s|t|e|H)$|^--(scope|transport|env|header|client-id|callback-port)$/.test(rest[k])) { k++; continue; }
      if (rest[k].startsWith('-') && pos.length < 2) continue;
      pos.push(rest[k]);
    }
    if (pos.length < 2) return null;
    const [name, first, ...args] = pos;
    return { type: 'mcp', name, config: /^https?:\/\//.test(first) ? { url: first } : { command: first, args } };
  }
  if (group === 'mcp' && verb === 'add-json') {
    const pos = rest.filter((x) => !x.startsWith('-'));
    try { return { type: 'mcp', name: pos[0], config: JSON.parse(pos[1]) }; } catch { return null; }
  }
  return null;
}

export async function preToolUse() {
  const input = readStdin();
  const cmd = input?.tool_input?.command;
  if (input.tool_name !== 'Bash' || !cmd) return {};
  const intent = installIntent(cmd);
  if (!intent) return {};
  // At install time a slow or blocked network must not hold the agent up.
  process.env.XRAY_FETCH_TIMEOUT ||= '10000';
  let text;
  try {
    if (intent.type === 'plugin') {
      const r = await scan(intent.spec);
      text = cardText(r.digest, r.overlaps);
      if (r.update?.changes.length) text += `\nUpdate adds:\n${r.update.changes.slice(0, 5).map((c) => `- ${c.text}`).join('\n')}`;
    } else {
      const s = describeServer(intent.name, intent.config);
      const installed = discover().map(analyze);
      const pseudo = { id: `mcp:${intent.name}`, name: intent.name, kind: 'mcp', enabled: true, items: [], hooks: [], hosts: [], servers: [s], findings: s.findings, contextTokens: 0, level: s.findings.some((f) => f.level === 'attention') ? 'attention' : s.findings.length ? 'review' : 'ok' };
      let deepNote = '';
      if (s.package && s.runner === 'npx') {
        try { const r = await scan(`npm:${s.package}`, { compare: false }); pseudo.findings = [...pseudo.findings, ...r.digest.findings]; pseudo.hosts = r.digest.hosts; pseudo.level = ['ok', 'review', 'attention'][Math.max(['ok', 'review', 'attention'].indexOf(pseudo.level), ['ok', 'review', 'attention'].indexOf(r.digest.level))]; } catch { deepNote = '\n(package could not be fetched for a code scan)'; }
      }
      text = cardText(pseudo, findOverlaps([pseudo, ...installed]).filter((o) => o.members.some((m) => m.unit === intent.name))) + (pseudo.hosts.length ? `\n- talks to ${pseudo.hosts.slice(0, 6).join(', ')}` : '') + deepNote;
    }
  } catch (e) {
    // Could not check (offline, blocked, unknown marketplace). Say so rather
    // than letting it through silently; XRAY_GATE=strict refuses it.
    const why = String(e.message || e).split('\n')[0].replace(/^Command failed: /, '').slice(0, 200);
    const reason = `Plugin X-ray could not check this install: ${why}`;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: strict() ? 'deny' : 'ask', permissionDecisionReason: strict() ? `${reason}\nXRAY_GATE=strict blocks installs that cannot be checked.` : reason } };
  }
  const risky = /🔴/.test(text.split('\n')[0]);
  if (strict() && risky) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Plugin X-ray blocked this install (XRAY_GATE=strict):\n${text}` } };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `Plugin X-ray checked this install:\n${text}` } };
}

export async function runHook(name, raw = null) {
  RAW = raw;
  const fn = { 'session-start': sessionStart, 'config-change': configChange, 'pre-tool-use': preToolUse }[name];
  if (!fn) throw new Error(`unknown hook ${name}`);
  let out = {};
  try { out = await fn(); } catch (e) { out = {}; }
  process.stdout.write(JSON.stringify(out));
}
