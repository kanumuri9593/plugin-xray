// How often each plugin, skill and connector was actually used, read from
// Claude Code's local session logs (~/.claude/projects/*/*.jsonl). Nothing is
// sent anywhere; only tool names and timestamps are looked at.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, listDir } from './util.mjs';

const DAY = 86400000;
const MAX_FILE = 200 * 1024 * 1024;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

function claudeDir() { return process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'); }

// Claude Code turns a server name into a tool prefix by replacing anything
// outside [a-zA-Z0-9_-] with "_".
export const toolName = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

function logFiles(since, stats = {}) {
  const out = [];
  stats.oldest = null;
  const root = path.join(claudeDir(), 'projects');
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of listDir(dir)) {
      const p = path.join(dir, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) stack.push(p);
      // Session transcripts only (<uuid>.jsonl, and subagents/*.jsonl). Plugins
      // drop their own .jsonl files here too, which would skew the history.
      else if (SESSION.test(name) || (name.endsWith('.jsonl') && path.basename(dir) === 'subagents')) {
        stats.oldest = Math.min(stats.oldest ?? Infinity, st.birthtimeMs || st.mtimeMs, st.mtimeMs);
        if (st.mtimeMs >= since && st.size <= MAX_FILE) out.push({ p, mtime: st.mtimeMs });
      }
    }
  }
  return out;
}

// Returns raw hits keyed by what was used:
//   tools   mcp tool prefixes ("plugin_vercel_vercel", "context7")
//   skills  skill, command or agent names as invoked ("vercel:deploy", "pdf")
export function readUsage({ days = 30, now = Date.now() } = {}) {
  const since = now - days * DAY;
  const stats = {};
  const files = logFiles(since, stats);
  const tools = new Map(), skills = new Map();
  const hit = (m, k, t) => { const e = m.get(k) || { count: 0, last: 0 }; e.count++; e.last = Math.max(e.last, t); m.set(k, e); };
  for (const { p, mtime } of files) {
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/"type":"tool_use","id":"[^"]*","name":"mcp__([a-zA-Z0-9_-]+?)__/g)) hit(tools, m[1], mtime);
    for (const m of text.matchAll(/"name":"Skill","input":\{"skill":"([^"]+)"/g)) hit(skills, m[1], mtime);
    for (const m of text.matchAll(/"subagent_type":"([^"]+)"/g)) hit(skills, m[1], mtime);
    for (const m of text.matchAll(/<command-name>\/?([a-zA-Z0-9:_-]+)<\/command-name>/g)) hit(skills, m[1], mtime);
  }
  // When the logs are younger than the window, "not used in 30 days" would
  // overstate it; `from` is where the evidence actually starts.
  return { days, since, from: Math.max(since, stats.oldest ?? since), sessions: files.length, tools, skills };
}

function merge(entries) {
  let count = 0, last = 0;
  for (const e of entries) if (e) { count += e.count; last = Math.max(last, e.last); }
  return { count, last: last || null };
}

// Attaches `usage` to each digest it can measure. Units from other agents
// (Codex, Cursor, …) keep usage null: their logs are not read.
export function attachUsage(digests, u) {
  if (!u || !u.sessions) return digests;
  for (const d of digests) {
    if (d.host !== 'claude-code') continue;
    if (d.kind === 'plugin') {
      const name = d.id.split('@')[0];
      const prefix = `plugin_${toolName(name)}_`;
      const hits = [...u.tools].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
      hits.push(...[...u.skills].filter(([k]) => k.startsWith(`${name}:`)).map(([, v]) => v));
      d.usage = { days: u.days, since: u.since, from: u.from, ...merge(hits) };
      // The same connector used from another install (say ~/.claude.json).
      d.usage.otherCopy = d.servers.map((s) => s.name).filter((n) => u.tools.get(toolName(n))?.count);
    } else if (d.kind === 'skills') {
      d.usage = { days: u.days, since: u.since, from: u.from, ...merge(d.items.map((i) => u.skills.get(i.name))) };
    } else if (d.kind === 'mcp') {
      for (const s of d.servers) s.usage = { days: u.days, since: u.since, from: u.from, ...merge([u.tools.get(toolName(s.name))]) };
      d.usage = { days: u.days, since: u.since, from: u.from, ...merge(d.servers.map((s) => s.usage.count ? s.usage : null)) };
    }
  }
  return digests;
}

export function ago(ts, now = Date.now()) {
  if (!ts) return null;
  const d = Math.floor((now - ts) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
}

// "not used in 30 days", or "not used since Sep 23" when that is all the history there is.
export function unusedText(u) {
  if (u.from && u.from > u.since + 86400000) return `not used since ${new Date(u.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return `not used in ${u.days} days`;
}
