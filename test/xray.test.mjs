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
