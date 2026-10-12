// Finds things that do the same job across everything installed: the same
// connector shipped twice, several connectors for one job, and near-duplicate skills.

const STOP = new Set('a an and are as at be by can do for from have how in into is it its of on or that the this to use used using when with you your yours their them they will what which while who why also any all each such other than then via per'.split(' '));

function words(text) {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function serverKey(s) {
  if (s.host) return s.host.replace(/^(www|api|mcp)\./, '');
  if (s.package) return s.package.replace(/@[^@/]*$/, '').replace(/^@?([^@]+).*/, '$1');
  return s.name.toLowerCase();
}

export function findOverlaps(digests) {
  const out = [];
  const active = digests.filter((d) => d.enabled);

  // 1. Same connector installed more than once.
  const byKey = new Map();
  for (const d of active) for (const s of d.servers) {
    const k = serverKey(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ unit: d.name, server: s.name });
  }
  for (const [k, members] of byKey) {
    const units = [...new Set(members.map((m) => m.unit))];
    if (units.length > 1) out.push({ type: 'duplicate-connector', label: `${members[0].server} is installed ${units.length} times`, key: k, members, suggestion: `Keep it in one place; turn it off in ${units.slice(1).join(', ')}.` });
  }

  // 2. Several different connectors for one job.
  const byCat = new Map();
  for (const d of active) for (const s of d.servers) for (const cat of s.categories) {
    if (!byCat.has(cat)) byCat.set(cat, new Map());
    byCat.get(cat).set(serverKey(s), { unit: d.name, server: s.name });
  }
  for (const [cat, m] of byCat) {
    if (m.size > 2 || (m.size === 2 && cat !== 'code hosting')) {
      const members = [...m.values()];
      out.push({ type: 'same-job', label: `${m.size} ${cat} connectors`, key: cat, members, suggestion: `Most people use one ${cat}. Keep the one you use; turning off the rest shrinks every session.` });
    }
  }

  // 3. Near-duplicate skills and commands.
  const items = active.flatMap((d) => d.items.map((i) => ({ unit: d.name, item: i, w: words(`${i.name} ${i.description}`) })));
  const seen = new Set();
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const sameName = a.item.name.split(':').pop() === b.item.name.split(':').pop();
    const sim = jaccard(a.w, b.w);
    if (!(sameName || sim >= 0.45)) continue;
    const key = [a.unit + a.item.name, b.unit + b.item.name].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const heavier = a.item.tokens >= b.item.tokens ? a : b;
    out.push({
      type: 'similar-skill',
      label: `${a.unit}:${a.item.name} ≈ ${b.unit}:${b.item.name}`,
      similarity: Math.round(sim * 100),
      members: [{ unit: a.unit, item: a.item.name, tokens: a.item.tokens }, { unit: b.unit, item: b.item.name, tokens: b.item.tokens }],
      suggestion: `Overlapping descriptions make the agent pick at random. ${heavier.unit}:${heavier.item.name} costs more (≈${heavier.item.tokens} tokens).`,
    });
  }
  return out;
}

// Which installed units an incoming plugin overlaps with (used at install time).
export function overlapsFor(candidate, installed) {
  const others = installed.filter((d) => d.enabled && d.id !== candidate.id && d.root !== candidate.root);
  return findOverlaps([{ ...candidate, enabled: true }, ...others])
    .filter((o) => o.members.some((m) => m.unit === candidate.name));
}
