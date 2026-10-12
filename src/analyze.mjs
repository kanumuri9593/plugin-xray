// Turns one installed unit (plugin, skills folder, or a host's MCP servers)
// into a digest: what loads into context, what can run, what it reaches.
import path from 'node:path';
import { readJson, readText, exists, isDir, listDir, walk, frontmatter, estimateTokens } from './util.mjs';
import { categorize } from './categories.mjs';

export const DIGEST_VERSION = 'xray.digest/v1';
const ITEM_OVERHEAD = 12; // tokens Claude Code spends framing each listed skill/command/agent

const RANK = { ok: 0, info: 0, review: 1, attention: 2 };
export function worst(findings) {
  let r = 0;
  for (const f of findings) r = Math.max(r, RANK[f.level] ?? 0);
  return ['ok', 'review', 'attention'][r];
}

// ---------- text and code patterns ----------

const HIDDEN_UNICODE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u;
const INJECTION = /\b(ignore (all |any )?(previous|prior|above) instructions|disregard (the )?(system|previous)|do not (tell|inform|mention (this )?to) the user|without (telling|asking) the user|secretly|exfiltrat)/i;

const CODE_RULES = [
  { code: 'runs-programs', level: 'info', re: /\b(child_process|execSync|execFileSync|spawnSync|spawn\(|execFile\(|subprocess\.|os\.system\(|Popen\(|Deno\.Command|Bun\.spawn)/ },
  { code: 'network', level: 'info', re: /\b(curl\s|wget\s|fetch\(|axios|https?\.request|https?\.get\(|new WebSocket|requests\.(get|post)|urllib|httpx|net\.connect|dgram|XMLHttpRequest)/ },
  { code: 'reads-secret-files', level: 'attention', re: /(\.ssh\/|id_rsa|id_ed25519|\.aws\/credentials|\.npmrc|\.netrc|\.git-credentials|security find-(generic|internet)-password|Login\.keychain|\.config\/gcloud|\.kube\/config)/ },
  { code: 'dumps-environment', level: 'attention', re: /(JSON\.stringify\(\s*process\.env\s*\)|json\.dumps\(\s*(dict\()?os\.environ|\benv\s*\|\s*(curl|nc|base64)|printenv\s*\|\s*(curl|nc))/ },
  { code: 'reads-secrets-env', level: 'info', re: /(process\.env\.[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASS)\b|os\.environ(\.get)?\(?\[?["'][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)["'])/ },
  { code: 'dynamic-code', level: 'review', re: /(\beval\(|new Function\(|vm\.runIn|exec\(compile|__import__\(|importlib\.import_module\()/ },
  { code: 'download-and-run', level: 'attention', re: /((curl|wget)[^\n|]*\|\s*(ba|z)?sh\b|(ba|z)?sh\s+-c\s+["']?\$\((curl|wget)|iex\s*\(\s*iwr|Invoke-Expression)/ },
  { code: 'destructive', level: 'review', re: /(rm\s+-rf\s+(\/|~|\$HOME)|(^|["'`;&|]\s*)sudo\s+[a-z]|chmod\s+777|\bmkfs\b|\bdd\s+if=)/ },
];

const URL_RE = /\bhttps?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d+)?/gi;
const BENIGN_HOSTS = /(^|\.)(example\.(com|org)|schema\.org|json-schema\.org|w3\.org|localhost|github\.com|githubusercontent\.com|npmjs\.(com|org)|nodejs\.org|mozilla\.org|claude\.(ai|com)|anthropic\.com|modelcontextprotocol\.io|opensource\.org|spdx\.org|shields\.io)$/i;
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec|fixtures?)\/|\.(test|spec)\.[a-z]+$/i;
const CODE_EXT = /\.(m?js|cjs|ts|mts|tsx|jsx|py|sh|bash|zsh|ps1|rb|go)$/i;

// Regex literals describe patterns; they never run anything. Dropping them keeps
// scanners (including this one) from matching their own rules.
const JS_FILE = /\.(m?js|cjs|ts|mts|tsx|jsx)$/i;
function stripRegexLiterals(line) {
  return line.replace(/([=(:,[!&|?{};]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\n\\])+\/[dgimsuyv]*/g, '$1/re/');
}

function scanText(rel, text, findings, rules) {
  let lines = text.split(/\r?\n/);
  if (JS_FILE.test(rel)) lines = lines.map(stripRegexLiterals);
  for (const rule of rules) {
    const hits = [];
    for (let i = 0; i < lines.length && hits.length < 3; i++) if (rule.re.test(lines[i])) hits.push(`${rel}:${i + 1}`);
    if (hits.length) findings.push({ level: rule.level, code: rule.code, where: hits });
  }
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
const BENIGN_EMAIL = /(noreply|no-reply|users\.noreply\.github\.com|@example\.(com|org)$|@test\.|@localhost)/i;
function emailsIn(text, set) {
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (!BENIGN_EMAIL.test(e) && !/\.(png|jpe?g|svg|js|ts|json)$/.test(e)) set.add(e);
  }
}

function hostsIn(text, set) {
  for (const m of text.matchAll(URL_RE)) {
    const h = m[1].toLowerCase();
    if (!BENIGN_HOSTS.test(h)) set.add(h);
  }
}

// ---------- MCP servers ----------

export function describeServer(name, cfg = {}) {
  const s = { name, transport: cfg.url ? (cfg.type || 'http') : 'stdio', findings: [] };
  if (cfg.url) {
    try { s.host = new URL(String(cfg.url).replace(/\$\{[^}]+\}/g, 'x')).host; } catch { s.host = String(cfg.url); }
  } else {
    s.command = [cfg.command, ...(cfg.args || [])].filter(Boolean).join(' ');
    const runner = /^(npx|bunx|pnpm|uvx|pipx|docker)$/.exec(path.basename(String(cfg.command || '')));
    if (runner) {
      const args = (cfg.args || []).filter((a) => !String(a).startsWith('-') && !['dlx', 'run', 'exec'].includes(a));
      const spec = runner[1] === 'docker' ? args.find((a) => a.includes('/') || a.includes(':')) : args[0];
      if (spec) {
        s.package = String(spec);
        s.runner = runner[1];
        const pinned = runner[1] === 'docker' ? /@sha256:|:[0-9]/.test(spec) : /@\d/.test(String(spec).replace(/^@[^/]+\//, ''));
        if (!pinned) s.findings.push({ level: 'review', code: 'unpinned', text: `${s.package} is not pinned, so every start can fetch new code` });
      }
    }
  }
  for (const [k, v] of Object.entries({ ...(cfg.env || {}), ...(cfg.headers || {}) })) {
    const val = String(v);
    if (/(KEY|TOKEN|SECRET|PASSWORD|AUTH)/i.test(k) && val.length > 16 && !val.includes('${')) {
      s.findings.push({ level: 'attention', code: 'literal-credential', text: `${k} holds a credential written in plain text` });
    }
  }
  s.categories = categorize([name, s.host, s.package, s.command].filter(Boolean).join(' '));
  return s;
}

export function serverConfigFromPlugin(root, name) {
  return serverMap(root, readJson(path.join(root, '.claude-plugin', 'plugin.json')) || {})[name];
}

function serverMap(root, manifest) {
  const out = {};
  const merge = (v) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(merge);
    if (typeof v === 'string') {
      if (/\.json$/.test(v)) { const j = readJson(path.join(root, v)); Object.assign(out, j?.mcpServers || j || {}); }
      else out[path.basename(v)] = { command: '(bundle)', args: [v] };
      return;
    }
    if (typeof v === 'object') Object.assign(out, v.mcpServers || v);
  };
  const dot = readJson(path.join(root, '.mcp.json'));
  merge(dot?.mcpServers || dot);
  merge(manifest?.mcpServers);
  return out;
}

// ---------- hooks ----------

function hookList(root, manifest) {
  const events = [];
  const add = (obj) => {
    if (!obj) return;
    if (Array.isArray(obj)) return obj.forEach(add);
    if (typeof obj === 'string') { const j = readJson(path.join(root, obj)); return add(j?.hooks || j); }
    for (const [event, groups] of Object.entries(obj.hooks && !Array.isArray(obj.hooks) ? obj.hooks : obj)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of g.hooks || []) events.push({ event, matcher: g.matcher || '*', type: h.type, command: [h.command, ...(h.args || [])].filter(Boolean).join(' ') || h.url || h.prompt || '' });
      }
    }
  };
  const file = readJson(path.join(root, 'hooks', 'hooks.json'));
  add(file?.hooks || file);
  add(manifest?.hooks);
  return events;
}

const EVERY_TURN = new Set(['UserPromptSubmit', 'SessionStart', 'Stop', 'MessageDisplay']);

// ---------- context cost ----------

function listedItems(root, manifest) {
  const items = [];
  const push = (kind, file, nameFallback) => {
    const fm = frontmatter(readText(file));
    if (fm['disable-model-invocation'] === 'true') return; // not listed to the model
    const name = fm.name || nameFallback;
    const desc = [fm.description, fm.when_to_use, fm['when-to-use']].filter(Boolean).join(' ');
    items.push({ kind, name, description: desc, tokens: estimateTokens(name.length + desc.length) + ITEM_OVERHEAD, file: path.relative(root, file) });
  };
  const skillDirs = [path.join(root, 'skills'), ...[].concat(manifest?.skills || []).map((p) => path.join(root, p))];
  if (exists(path.join(root, 'SKILL.md')) && !isDir(path.join(root, 'skills'))) push('skill', path.join(root, 'SKILL.md'), path.basename(root));
  for (const dir of skillDirs) {
    if (exists(path.join(dir, 'SKILL.md')) && dir !== root) { push('skill', path.join(dir, 'SKILL.md'), path.basename(dir)); continue; }
    for (const n of listDir(dir)) if (exists(path.join(dir, n, 'SKILL.md'))) push('skill', path.join(dir, n, 'SKILL.md'), n);
  }
  const cmdDirs = typeof manifest?.commands === 'object' && !Array.isArray(manifest.commands) ? [] : [].concat(manifest?.commands || 'commands');
  for (const p of cmdDirs) {
    const abs = path.join(root, p);
    const files = isDir(abs) ? listDir(abs).filter((f) => f.endsWith('.md')).map((f) => path.join(abs, f)) : abs.endsWith('.md') ? [abs] : [];
    for (const f of files) push('command', f, path.basename(f, '.md'));
  }
  const agentFiles = [].concat(manifest?.agents || []).map((p) => path.join(root, p));
  if (!manifest?.agents) for (const f of walk(path.join(root, 'agents'))) if (f.endsWith('.md')) agentFiles.push(path.join(root, 'agents', f));
  for (const f of agentFiles) push('agent', f, path.basename(f, '.md'));
  // Dedupe (a skill dir can be listed twice through manifest + default scan)
  const seen = new Set();
  return items.filter((i) => (seen.has(i.file) ? false : seen.add(i.file)));
}

// ---------- analysis ----------

export function analyzePlugin(unit) {
  const root = unit.root;
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json')) || {};
  const findings = [];
  const hosts = new Set();
  const emails = new Set();

  const items = listedItems(root, manifest);
  const servers = Object.entries(serverMap(root, manifest)).map(([n, cfg]) => describeServer(n, cfg));
  for (const s of servers) { findings.push(...s.findings.map((f) => ({ ...f, where: [`server ${s.name}`] }))); if (s.host) hosts.add(s.host); }

  const hooks = hookList(root, manifest);
  for (const h of hooks) {
    if (h.type === 'command' && EVERY_TURN.has(h.event)) findings.push({ level: 'info', code: 'hook-every-turn', text: `runs a command on every ${h.event}`, where: [`hook ${h.event}`] });
    if (h.type === 'command' && ['PreToolUse', 'PostToolUse'].includes(h.event) && (h.matcher === '*' || h.matcher === '')) findings.push({ level: 'info', code: 'hook-every-tool', text: `runs a command around every tool call`, where: [`hook ${h.event}`] });
    if (h.type === 'http') findings.push({ level: 'review', code: 'hook-sends-data', text: `sends ${h.event} events to ${h.command}`, where: [`hook ${h.event}`] });
    scanText(`hook ${h.event}`, h.command, findings, CODE_RULES.filter((r) => r.level !== 'info'));
    hostsIn(h.command, hosts);
  }

  const files = walk(root);
  const textFiles = files.filter((f) => /\.(md|txt|json|ya?ml)$/i.test(f));
  for (const f of textFiles) {
    const t = readText(path.join(root, f)) || '';
    const lines = t.split(/\r?\n/);
    const hid = lines.findIndex((l) => HIDDEN_UNICODE.test(l));
    if (hid >= 0) findings.push({ level: 'attention', code: 'hidden-text', text: 'contains invisible characters that can hide instructions', where: [`${f}:${hid + 1}`] });
    const inj = lines.findIndex((l) => INJECTION.test(l));
    if (inj >= 0 && /\.md$/i.test(f)) findings.push({ level: 'attention', code: 'instruction-override', text: 'text tries to override instructions or hide actions from you', where: [`${f}:${inj + 1}`] });
  }
  const codeFiles = files.filter((f) => CODE_EXT.test(f) || f.startsWith('bin/'));
  for (const f of codeFiles.slice(0, 400)) {
    const t = readText(path.join(root, f));
    if (!t || t.length > 2_000_000) continue;
    scanText(f, t, findings, CODE_RULES);
    if (TEST_FILE.test(f)) continue; // addresses in tests are not where the code sends data
    hostsIn(t, hosts);
    emailsIn(t, emails);
  }
  const pkg = readJson(path.join(root, 'package.json'));
  for (const k of ['preinstall', 'install', 'postinstall']) if (pkg?.scripts?.[k]) findings.push({ level: 'review', code: 'install-script', text: `runs "${pkg.scripts[k]}" when installed`, where: ['package.json'] });
  if (exists(path.join(root, '.claude-plugin')) && files.some((f) => f.startsWith('bin/'))) findings.push({ level: 'info', code: 'adds-commands', text: 'puts its own programs on the agent\'s PATH', where: ['bin/'] });
  if (exists(path.join(root, 'monitors', 'monitors.json')) || manifest?.experimental?.monitors) findings.push({ level: 'info', code: 'background-process', text: 'starts background monitors', where: ['monitors'] });

  return digest(unit, { manifest, items, servers, hooks, hosts, emails, findings, fileCount: files.length });
}

export function analyzeSkillsFolder(unit) {
  const items = [];
  for (const n of listDir(unit.root)) {
    const f = path.join(unit.root, n, 'SKILL.md');
    if (exists(f)) {
      const fm = frontmatter(readText(f));
      const desc = fm.description || '';
      items.push({ kind: 'skill', name: fm.name || n, description: desc, tokens: estimateTokens((fm.name || n).length + desc.length) + ITEM_OVERHEAD, file: path.join(n, 'SKILL.md') });
    } else if (isDir(path.join(unit.root, n))) {
      // nested collections (e.g. synced/<bucket>/<skill>/SKILL.md)
      for (const m of listDir(path.join(unit.root, n))) {
        const g = path.join(unit.root, n, m, 'SKILL.md');
        if (!exists(g)) continue;
        const fm = frontmatter(readText(g));
        const desc = fm.description || '';
        items.push({ kind: 'skill', name: fm.name || m, description: desc, tokens: estimateTokens((fm.name || m).length + desc.length) + ITEM_OVERHEAD, file: path.join(n, m, 'SKILL.md') });
      }
    }
  }
  return digest(unit, { items, servers: [], hooks: [], hosts: new Set(), findings: [] });
}

export function analyzeServers(unit) {
  const servers = Object.entries(unit.servers).map(([n, cfg]) => describeServer(n, cfg));
  const findings = servers.flatMap((s) => s.findings.map((f) => ({ ...f, where: [`server ${s.name}`] })));
  return digest(unit, { items: [], servers, hooks: [], hosts: new Set(servers.map((s) => s.host).filter(Boolean)), findings });
}

function digest(unit, { manifest = {}, items, servers, hooks, hosts, emails = new Set(), findings, fileCount }) {
  // Collapse repeated codes so one rule hit across many files reads as one finding.
  const merged = new Map();
  for (const f of findings) {
    const key = `${f.code}|${f.text || ''}`;
    if (!merged.has(key)) merged.set(key, { ...f, where: [...(f.where || [])] });
    else { const m = merged.get(key); for (const w of f.where || []) if (m.where.length < 5 && !m.where.includes(w)) m.where.push(w); }
  }
  const all = [...merged.values()];
  return {
    schema: DIGEST_VERSION,
    id: unit.id,
    name: manifest.displayName || manifest.name || unit.name,
    kind: unit.kind,
    host: unit.host,
    version: manifest.version || unit.version || null,
    enabled: unit.enabled !== false,
    description: manifest.description || null,
    root: unit.root || null,
    contextTokens: items.reduce((a, i) => a + i.tokens, 0),
    items,
    servers: servers.map(({ findings: _f, ...s }) => s),
    hooks,
    hosts: [...hosts].sort(),
    emails: [...emails].sort(),
    capabilities: [...new Set(all.map((f) => f.code))].sort(),
    findings: all,
    level: worst(all),
    fileCount: fileCount ?? null,
  };
}

export function analyze(unit) {
  if (unit.kind === 'plugin') return analyzePlugin(unit);
  if (unit.kind === 'skills') return analyzeSkillsFolder(unit);
  return analyzeServers(unit);
}
