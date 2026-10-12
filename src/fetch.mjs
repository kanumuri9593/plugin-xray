// Resolves what someone is about to install into a local folder we can read,
// without running any of its code: a path, an npm package, a GitHub repo, or a
// Claude Code plugin from a marketplace you already added.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME, readJson, exists, isDir, listDir } from './util.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xray-')); }

function run(cmd, args, opts = {}) {
  const win = process.platform === 'win32' && cmd === 'npm';
  return execFileSync(win ? 'npm.cmd' : cmd, args, { shell: win, stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout ?? 60_000, encoding: 'utf8', ...opts });
}

export function fromNpm(spec) {
  const dir = tmp();
  // --ignore-scripts: packing never runs lifecycle scripts, but be explicit.
  const out = run('npm', ['pack', spec, '--silent', '--ignore-scripts', '--pack-destination', dir]).trim().split('\n').pop();
  run('tar', ['xzf', path.join(dir, out), '-C', dir]);
  const root = path.join(dir, 'package');
  const pkg = readJson(path.join(root, 'package.json')) || {};
  return { root, name: pkg.name || spec, label: `${pkg.name || spec}@${pkg.version || '?'}`, version: pkg.version, cleanup: dir };
}

export function fromGit(url, ref) {
  const dir = tmp();
  const args = ['clone', '--depth', '1', '--quiet'];
  if (ref) args.push('--branch', ref);
  run('git', [...args, url, path.join(dir, 'repo')], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { root: path.join(dir, 'repo'), name: url.replace(/\.git$/, '').split('/').pop(), label: url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''), cleanup: dir };
}

function marketplaces() {
  const base = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'plugins');
  const known = readJson(path.join(base, 'known_marketplaces.json')) || {};
  const out = {};
  for (const [name, m] of Object.entries(known)) out[name] = m.installLocation || path.join(base, 'marketplaces', name);
  for (const name of listDir(path.join(base, 'marketplaces'))) out[name] ||= path.join(base, 'marketplaces', name);
  return out;
}

// "plugin@marketplace" → the plugin's folder, as Claude Code would install it.
export function fromMarketplace(spec) {
  const [plugin, mkt] = spec.split('@');
  const loc = marketplaces()[mkt];
  if (!loc) return null;
  const manifest = readJson(path.join(loc, '.claude-plugin', 'marketplace.json'));
  const entry = manifest?.plugins?.find((p) => p.name === plugin);
  if (!entry) return null;
  const src = entry.source;
  if (typeof src === 'string') {
    const root = path.resolve(loc, manifest?.metadata?.pluginRoot || '.', src);
    return { root, name: plugin, label: spec, version: entry.version };
  }
  if (src?.source === 'github') return { ...fromGit(`https://github.com/${src.repo}.git`, src.ref), name: plugin, label: spec };
  if (src?.source === 'url' || src?.source === 'git') return { ...fromGit(src.url, src.ref), name: plugin, label: spec };
  if (src?.source === 'npm') return { ...fromNpm(src.version ? `${src.package}@${src.version}` : src.package), name: plugin, label: spec };
  if (src?.source === 'git-subdir') {
    const g = fromGit(src.url.startsWith('http') ? src.url : `https://github.com/${src.url}.git`, src.ref);
    return { ...g, root: path.join(g.root, src.path || ''), name: plugin, label: spec };
  }
  return null;
}

export function resolveTarget(target) {
  if (exists(target) && isDir(target)) return { root: path.resolve(target), name: path.basename(path.resolve(target)), label: path.basename(path.resolve(target)) };
  let m;
  if ((m = target.match(/^(?:github:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#(.+))?\/?$/))) return fromGit(`https://github.com/${m[1]}.git`, m[2]);
  if (/^(https?|git):\/\//.test(target)) return fromGit(target);
  if (target.startsWith('npm:')) return fromNpm(target.slice(4));
  if (/^[\w.-]+@[\w.-]+$/.test(target) && !/@\d/.test(target)) {
    const r = fromMarketplace(target);
    if (r) return r;
  }
  return fromNpm(target);
}

export function cleanup(t) {
  if (t?.cleanup) try { fs.rmSync(t.cleanup, { recursive: true, force: true }); } catch { /* temp dir */ }
}
