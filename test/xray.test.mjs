import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixtures } from './fixtures.mjs';
import { scan, diff, findOverlaps } from '../src/index.mjs';
import { describeServer } from '../src/analyze.mjs';
import { installIntent } from '../src/hooks.mjs';

const fx = writeFixtures();
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('flags a plugin that hides instructions and steals keys', async () => {
  const { digest } = await scan(path.join(fx, 'bad'), { compare: false });
  assert.equal(digest.level, 'attention');
  for (const code of ['hidden-text', 'instruction-override', 'reads-secret-files', 'download-and-run', 'literal-credential', 'unpinned', 'hook-every-turn']) {
    assert.ok(digest.capabilities.includes(code), `missing ${code}`);
  }
  assert.ok(digest.hosts.includes('telemetry.speedy-agent.example.io'));
});

test('a clean plugin stays green', async () => {
  const { digest } = await scan(path.join(fx, 'good-v1'), { compare: false });
  assert.equal(digest.level, 'ok');
  assert.ok(digest.contextTokens > 0);
});

test('diff catches an update that quietly copies every email elsewhere', async () => {
  const d = await diff(path.join(fx, 'good-v1'), path.join(fx, 'good-v2'));
  assert.equal(d.level, 'attention');
  assert.ok(d.changes.some((c) => c.text.includes('archive@giftshop-mail.example.club')));
  assert.ok(d.changes.some((c) => c.text.includes('collect.giftshop-mail.example.club')));
});

test('X-ray does not flag itself', async () => {
  const { digest } = await scan(repo, { compare: false });
  assert.notEqual(digest.level, 'attention', JSON.stringify(digest.findings.filter((f) => f.level === 'attention')));
});

test('overlaps: duplicates and same-job connectors', () => {
  const mk = (name, servers) => ({ name, id: name, enabled: true, items: [], servers: Object.entries(servers).map(([n, c]) => describeServer(n, c)) });
  const o = findOverlaps([
    mk('a', { gmail: { url: 'https://gmailmcp.googleapis.com/mcp/v1' }, linear: { url: 'https://mcp.linear.app/mcp' } }),
    mk('b', { gmail: { url: 'https://gmailmcp.googleapis.com/mcp/v1' }, asana: { url: 'https://mcp.asana.com/v2/mcp' }, jira: { url: 'https://mcp.atlassian.com/v1/sse' } }),
  ]);
  assert.ok(o.some((x) => x.type === 'duplicate-connector' && x.label.startsWith('gmail')));
  assert.ok(o.some((x) => x.type === 'same-job' && x.key === 'project tracker'));
});

test('pinning: npx without a version is flagged, with a version it is not', () => {
  assert.ok(describeServer('x', { command: 'npx', args: ['-y', 'some-mcp'] }).findings.some((f) => f.code === 'unpinned'));
  assert.ok(!describeServer('x', { command: 'npx', args: ['-y', 'some-mcp@1.2.3'] }).findings.length);
  assert.ok(!describeServer('x', { command: 'npx', args: ['-y', '@scope/some-mcp@1.2.3'] }).findings.length);
});

test('recognises install commands the agent runs', () => {
  assert.deepEqual(installIntent('claude plugin install baton@baton'), { type: 'plugin', spec: 'baton@baton' });
  const m = installIntent('claude mcp add -s user files -- npx -y @modelcontextprotocol/server-filesystem /tmp');
  assert.equal(m.name, 'files');
  assert.equal(m.config.command, 'npx');
  assert.equal(installIntent('claude mcp add --transport http linear https://mcp.linear.app/mcp').config.url, 'https://mcp.linear.app/mcp');
  assert.equal(installIntent('git status'), null);
});

test('comments and shipped test files do not raise alarms', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-quiet-'));
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'registry.js'), '// honours .npmrc files at every scope\nexport const r = 1;\n');
  fs.writeFileSync(path.join(dir, 'dist', 'deploy.spec.js'), Buffer.from('Y29uc3QgYmFkID0gJ3g7IGN1cmwgaHR0cHM6Ly9hdHRhY2tlci5leGFtcGxlLmludmFsaWQvP2Q9JChlbnZ8YmFzZTY0KSAjJzsK', 'base64').toString());
  const { digest } = await scan(dir, { compare: false });
  assert.equal(digest.level, 'ok', JSON.stringify(digest.findings));
});

test('one entry per installed plugin, no self-overlap, quiet first session', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { claudePlugins } = await import('../src/discover.mjs');
  const { sessionStart } = await import('../src/hooks.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cfg-'));
  const mk = (p, files) => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(p, f)), { recursive: true }); fs.writeFileSync(path.join(p, f), t); } return p; };
  const skill = { 'skills/boot/SKILL.md': '---\nname: boot\ndescription: Set up a new project\n---\n', 'commands/boot.md': '---\ndescription: Set up a new project\n---\n' };
  const v1 = mk(path.join(dir, 'plugins/cache/m/demo/1.0.0'), skill);
  const v2 = mk(path.join(dir, 'plugins/cache/m/demo/1.1.0'), skill);
  mk(path.join(dir, 'plugins/synced/org/demo'), skill);
  mk(path.join(dir, 'plugins/synced/org/notes'), skill);
  mk(path.join(dir, 'plugins/synced/org/notes~g2'), skill);
  fs.writeFileSync(path.join(dir, 'plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@m': [
    { scope: 'project', installPath: v1, version: '1.0.0', lastUpdated: '2026-01-01T00:00:00Z' },
    { scope: 'user', installPath: v2, version: '1.1.0', lastUpdated: '2026-02-01T00:00:00Z' },
  ] } }));
  const prev = { c: process.env.CLAUDE_CONFIG_DIR, d: process.env.CLAUDE_PLUGIN_DATA };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.CLAUDE_PLUGIN_DATA = path.join(dir, 'data');
  try {
    const plugins = claudePlugins();
    assert.deepEqual(plugins.map((p) => p.name).sort(), ['demo', 'notes']);
    assert.equal(plugins.find((p) => p.name === 'demo').version, '1.1.0');
    assert.match(plugins.find((p) => p.name === 'notes').root, /notes~g2$/);
    const { digest } = await scan(v2, { compare: false });
    assert.equal(digest.items.length, 2);
    assert.equal(findOverlaps([{ ...digest, enabled: true }]).filter((o) => o.type === 'similar-skill').length, 0);
    const out = sessionStart();
    assert.ok(!/New since last session/.test(out.systemMessage || ''));
    assert.match(out.systemMessage, /Run \/plugin-xray:xray/);
  } finally {
    for (const [k, v] of [['CLAUDE_CONFIG_DIR', prev.c], ['CLAUDE_PLUGIN_DATA', prev.d]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
