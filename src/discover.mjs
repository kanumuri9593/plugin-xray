// Finds everything installed into AI coding agents on this machine: Claude Code
// plugins, standalone skills, and MCP servers configured for each host.
// Each host is one small adapter, so adding a new agent is one entry here.
import path from 'node:path';
import { HOME, readJson, readText, exists, isDir, listDir } from './util.mjs';

const MAC_SUPPORT = path.join(HOME, 'Library', 'Application Support');

function claudeDir() { return process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'); }

function isPluginRoot(dir) {
  return exists(path.join(dir, '.claude-plugin', 'plugin.json')) ||
    ['skills', 'commands', 'agents', 'hooks'].some((d) => isDir(path.join(dir, d))) ||
    exists(path.join(dir, '.mcp.json'));
}

function enabledMap() {
  const out = {};
  for (const f of [path.join(claudeDir(), 'settings.json'), path.join(process.cwd(), '.claude', 'settings.json'), path.join(process.cwd(), '.claude', 'settings.local.json')]) {
    const s = readJson(f);
    if (s?.enabledPlugins) Object.assign(out, s.enabledPlugins);
  }
  return out;
}

export function claudePlugins() {
  const base = path.join(claudeDir(), 'plugins');
  const enabled = enabledMap();
  // One entry per plugin id: old cached versions and per-project copies of the
  // same plugin are one install, not several.
  const seen = new Map();
  const add = (id, root, extra = {}) => {
    if (!root || !isDir(root) || seen.has(id)) return;
    const name = id.split('@')[0];
    const state = enabled[id] ?? enabled[name];
    seen.set(id, { kind: 'plugin', host: 'claude-code', id, name, root, enabled: state !== false, ...extra });
  };

  const installed = readJson(path.join(base, 'installed_plugins.json'));
  for (const [id, entry] of Object.entries(installed?.plugins || {})) {
    const entries = (Array.isArray(entry) ? entry : [entry]).filter((e) => e?.installPath && isDir(e.installPath));
    entries.sort((a, b) => String(b.lastUpdated || b.installedAt || '').localeCompare(String(a.lastUpdated || a.installedAt || '')));
    const e = entries[0];
    if (e) add(id, e.installPath, { version: e.version, scope: e.scope });
  }
  const names = () => new Set([...seen.values()].map((p) => p.name));

  // Plugins synced from claude.ai organisations live outside installed_plugins.json.
  const synced = path.join(base, 'synced');
  for (const bucket of listDir(synced)) {
    const manifest = readJson(path.join(synced, bucket, 'manifest.json'));
    for (const name of listDir(path.join(synced, bucket))) {
      const root = path.join(synced, bucket, name);
      if (!isPluginRoot(root) || names().has(name)) continue;
      const m = manifest?.plugins?.find((p) => p.name === name);
      add(`${name}@${m?.marketplaceName || 'synced'}`, root, { version: m?.version });
    }
  }

  // Fallback for older layouts: cache/<marketplace>/<plugin>/<version>.
  if (!installed) {
    const cache = path.join(base, 'cache');
    for (const mkt of listDir(cache)) for (const name of listDir(path.join(cache, mkt))) {
      const versions = listDir(path.join(cache, mkt, name)).sort();
      const root = path.join(cache, mkt, name, versions.at(-1) || '');
      if (isPluginRoot(root)) add(`${name}@${mkt}`, root, { version: versions.at(-1) });
    }
  }
  return [...seen.values()];
}

export function claudeSkills() {
  const units = [];
  for (const [label, dir] of [['user skills', path.join(claudeDir(), 'skills')], ['project skills', path.join(process.cwd(), '.claude', 'skills')]]) {
    if (!isDir(dir)) continue;
    units.push({ kind: 'skills', host: 'claude-code', id: label, name: label, root: dir });
  }
  return units;
}

function serversFrom(obj, key = 'mcpServers') {
  const s = obj?.[key];
  return s && typeof s === 'object' ? s : {};
}

// Tiny TOML reader for Codex's [mcp_servers.<name>] tables.
function codexServers(text) {
  const out = {};
  let cur = null;
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const h = line.match(/^\[mcp_servers\.("?)([^\]"]+)\1\]$/);
    if (h) { cur = out[h[2]] = {}; continue; }
    if (line.startsWith('[')) { cur = null; continue; }
    const kv = cur && line.match(/^([A-Za-z_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    try { cur[kv[1]] = JSON.parse(kv[2].replace(/'/g, '"')); } catch { cur[kv[1]] = kv[2]; }
  }
  return out;
}

// Project servers that repeat a user-level server word for word are the same
// connector, so they are left out rather than counted twice.
function projectServers() {
  const cfg = readJson(path.join(HOME, '.claude.json'));
  const user = serversFrom(cfg);
  const all = { ...serversFrom(cfg?.projects?.[process.cwd()]), ...serversFrom(readJson(path.join(process.cwd(), '.mcp.json'))) };
  return Object.fromEntries(Object.entries(all).filter(([n, s]) => JSON.stringify(user[n]) !== JSON.stringify(s)));
}

const HOSTS = [
  { host: 'claude-code', label: 'Claude Code (user)', read: () => serversFrom(readJson(path.join(HOME, '.claude.json'))) },
  { host: 'claude-code', label: 'Claude Code (this project)', read: projectServers },
  { host: 'claude-desktop', label: 'Claude desktop', read: () => serversFrom(readJson(path.join(MAC_SUPPORT, 'Claude', 'claude_desktop_config.json'))) },
  { host: 'codex', label: 'Codex', read: () => codexServers(readText(path.join(HOME, '.codex', 'config.toml'))) },
  { host: 'cursor', label: 'Cursor', read: () => serversFrom(readJson(path.join(HOME, '.cursor', 'mcp.json'))) },
  { host: 'vscode', label: 'VS Code', read: () => serversFrom(readJson(path.join(MAC_SUPPORT, 'Code', 'User', 'mcp.json')), 'servers') },
  { host: 'gemini', label: 'Gemini CLI', read: () => serversFrom(readJson(path.join(HOME, '.gemini', 'settings.json'))) },
  { host: 'windsurf', label: 'Windsurf', read: () => serversFrom(readJson(path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'))) },
];

export function hostServers() {
  const units = [];
  for (const h of HOSTS) {
    let servers = {};
    try { servers = h.read(); } catch { /* unreadable config is reported as empty */ }
    if (Object.keys(servers).length) units.push({ kind: 'mcp', host: h.host, id: h.label, name: h.label, servers });
  }
  return units;
}

export function discover() {
  return [...claudePlugins(), ...claudeSkills(), ...hostServers()];
}
