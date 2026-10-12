import { audit, scan, diff } from './index.mjs';
import { renderAudit, renderCard, renderDiff, cardText, renderClean } from './render.mjs';
import { runHook } from './hooks.mjs';
import { c } from './util.mjs';

const HELP = `${c.bold('Plugin X-ray')}: see what an AI agent plugin can do before you trust it.

Usage
  xray                       Audit everything installed (Claude Code, Codex, Cursor, VS Code, …)
  xray scan <target>         Check a plugin or MCP server before installing it
                             <target>: ./folder · npm-package[@ver] · github:owner/repo · plugin@marketplace
  xray diff <old> <new>      Show what a new version can do that the old one could not
  xray clean [names…]        List unused or switched-off items with the command that removes each
                             add --yes to run those commands for the names given (or --all)
  xray mcp                   Run as an MCP server (tools: xray_audit, xray_scan, xray_diff)
  xray hook <event>          Claude Code hook entry (session-start, config-change, pre-tool-use)

Options
  --json       Machine-readable digest (schema xray.digest/v1)
  --md         Markdown card (for chat)
  --tools      Start local connectors once to count their tool list (runs their code)
  --deep       Also run a full static analysis with REA (slower, JavaScript only)
  --details    Show every overlap and a card per item
  --fail-on <review|attention>   Exit 1 when anything reaches this level (for CI)
  --offline    No network and no other programs: local folders only (or XRAY_OFFLINE=1)
  --no-usage   Do not read Claude Code session logs for last-used data (or XRAY_USAGE=off)
`;

function parse(argv) {
  const flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fail-on') flags.failOn = argv[++i];
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else if (a === '-h') flags.help = true;
    else pos.push(a);
  }
  return { flags, pos };
}

const LEVELS = { ok: 0, review: 1, attention: 2 };
function exitFor(level, failOn) {
  if (failOn && LEVELS[level] >= LEVELS[failOn]) process.exitCode = 1;
}

export async function main(argv) {
  const { flags, pos } = parse(argv);
  if (flags.offline) process.env.XRAY_OFFLINE = '1';
  if (flags['no-usage']) process.env.XRAY_USAGE = 'off';
  const [cmd, ...args] = pos;
  if (flags.help || cmd === 'help') return console.log(HELP);
  if (flags.version || cmd === 'version') {
    const { createRequire } = await import('node:module');
    return console.log(createRequire(import.meta.url)('../package.json').version);
  }
  if (cmd === 'hook') return runHook(args[0]);
  if (cmd === 'mcp') return (await import('./mcp.mjs')).serve();

  if (cmd === 'clean') {
    const r = await audit();
    if (flags.json) return console.log(JSON.stringify(r.cleanup, null, 2));
    if (!flags.yes) return console.log(renderClean(r.cleanup, { md: flags.md, history: r.history }));
    // --all covers plugins only; connectors are removed when named.
    const pick = r.cleanup.filter((x) => (flags.all && x.kind === 'plugin') || args.includes(x.name) || args.includes(x.id));
    if (!pick.length) { console.log('Nothing picked. Name the items to remove, or pass --all.'); process.exitCode = 1; return; }
    const { removeItem } = await import('./clean.mjs');
    for (const x of pick) {
      const res = removeItem(x);
      console.log(`${res.ok ? '✓' : '✕'} ${x.name}: ${res.message}`);
      if (!res.ok) process.exitCode = 1;
    }
    return;
  }
  if (!cmd || cmd === 'audit') {
    const r = await audit({ tools: flags.tools });
    if (flags.json) console.log(JSON.stringify(r, null, 2));
    else if (flags.md) console.log(r.digests.map((d) => cardText(d, r.overlaps.filter((o) => o.members.some((m) => m.unit === d.name)))).join('\n\n'));
    else console.log(renderAudit(r, { details: flags.details }));
    const worst = r.totals.attention ? 'attention' : r.totals.review ? 'review' : 'ok';
    return exitFor(worst, flags.failOn);
  }
  if (cmd === 'scan') {
    if (!args[0]) throw new Error('scan needs a target, e.g. xray scan npm:some-mcp-server');
    const r = await scan(args[0], { deep: flags.deep, tools: flags.tools });
    if (flags.json) console.log(JSON.stringify(r, null, 2));
    else if (flags.md) console.log(cardText(r.digest, r.overlaps));
    else {
      console.log(renderCard(r.digest, r.overlaps));
      if (r.update) console.log('\n' + renderDiff(r.update));
      if (r.digest.deep && !r.digest.deep.ok) console.log(c.dim(`  Deep scan unavailable: ${r.digest.deep.error}`));
    }
    return exitFor(r.digest.level, flags.failOn);
  }
  if (cmd === 'diff') {
    if (args.length < 2) throw new Error('diff needs two targets, e.g. xray diff npm:pkg@1.0.0 npm:pkg@1.0.1');
    const r = await diff(args[0], args[1]);
    console.log(flags.json ? JSON.stringify(r, null, 2) : renderDiff(r));
    return exitFor(r.level, flags.failOn);
  }
  console.log(HELP);
  process.exitCode = 2;
}
