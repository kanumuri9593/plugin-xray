// Compares two digests of the same thing (two versions, or before/after an
// update) and lists only what is new. This is the check that catches a
// trusted package that quietly starts doing something else.
import { findingText } from './render.mjs';

export function diffDigests(a, b) {
  const changes = [];
  const newOf = (xs, ys) => ys.filter((y) => !xs.includes(y));

  for (const h of newOf(a.hosts, b.hosts)) changes.push({ level: 'attention', kind: 'host', text: `now talks to ${h}` });
  for (const e of newOf(a.emails || [], b.emails || [])) changes.push({ level: 'attention', kind: 'email', text: `now has the email address ${e} in its code` });
  const sk = (s) => s.host || s.package || s.command || s.name;
  for (const s of newOf(a.servers.map(sk), b.servers.map(sk))) changes.push({ level: 'review', kind: 'connector', text: `adds connector ${s}` });
  const hk = (h) => `${h.event} ${h.command}`;
  for (const h of newOf(a.hooks.map(hk), b.hooks.map(hk))) changes.push({ level: 'review', kind: 'hook', text: `adds hook ${h}` });
  const fk = (f) => `${f.code}|${f.text || ''}`;
  const before = new Set(a.findings.map(fk));
  for (const f of b.findings) if (!before.has(fk(f))) changes.push({ level: f.level === 'info' ? 'review' : f.level, kind: 'capability', text: `${findingText(f)} (${(f.where || []).slice(0, 2).join(', ')})` });
  const itemNames = new Set(a.items.map((i) => i.name));
  for (const i of b.items) if (!itemNames.has(i.name)) changes.push({ level: 'review', kind: 'item', text: `adds ${i.kind} ${i.name}` });

  return {
    from: a.version ? `${a.name}@${a.version}` : a.name,
    to: b.version ? `${b.name}@${b.version}` : b.name,
    tokenDelta: b.contextTokens - a.contextTokens,
    changes,
    level: changes.some((c) => c.level === 'attention') ? 'attention' : changes.length ? 'review' : 'ok',
  };
}
