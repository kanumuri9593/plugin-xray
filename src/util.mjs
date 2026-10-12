import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME = process.env.XRAY_HOME || os.homedir();

export function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

export function readJson(file) {
  const t = readText(file);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function listDir(p) {
  try { return fs.readdirSync(p); } catch { return []; }
}

// Walk a directory, skipping heavy or irrelevant folders. Returns relative paths.
export function walk(root, { maxFiles = 4000, skip = ['node_modules', '.git', '.mcpb-cache'] } = {}) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < maxFiles) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    for (const name of listDir(abs)) {
      if (skip.includes(name)) continue;
      const r = rel ? path.join(rel, name) : name;
      let st;
      try { st = fs.lstatSync(path.join(root, r)); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) stack.push(r);
      else if (st.isFile()) out.push(r.split(path.sep).join('/'));
    }
  }
  return out.sort();
}

// Minimal YAML frontmatter reader: top-level `key: value` pairs, including
// folded/multi-line values indented under a key.
export function frontmatter(text) {
  if (!text || !text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const body = text.slice(3, end).replace(/^\r?\n/, '');
  const out = {};
  let key = null;
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      key = m[1];
      out[key] = m[2].replace(/^["'>|-]+\s*/, '').replace(/["']$/, '');
    } else if (key && /^\s+\S/.test(line)) {
      out[key] = (out[key] ? out[key] + ' ' : '') + line.trim();
    }
  }
  return out;
}

// Claude tokenizers average close to 4 characters per token for English prose
// and JSON. Good enough for a budget view; reports always mark these as ≈.
export function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

export function sha(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'),
  yellow: wrap('33'), blue: wrap('34'), magenta: wrap('35'), cyan: wrap('36'),
};

export function plural(n, word, many = word + 's') {
  return `${n} ${n === 1 ? word : many}`;
}

export function fmtTokens(n) {
  if (n == null) return '?';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
