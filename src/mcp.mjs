// A small MCP server so any agent (Codex, Cursor, VS Code, Gemini, Claude) can
// check a plugin before installing it. Same digests as the CLI.
import readline from 'node:readline';
import { audit, scan, diff } from './index.mjs';
import { cardText, findingText } from './render.mjs';
import { fmtTokens, plural } from './util.mjs';

const TOOLS = [
  {
    name: 'xray_audit',
    description: 'Audit every plugin, skill and MCP server installed for AI agents on this machine: context tokens each turn, connectors, overlaps, and anything that needs attention.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'xray_scan',
    description: 'Check a plugin or MCP server BEFORE installing it. Reads its files without running them. target: plugin@marketplace, npm:package@version, github:owner/repo, or a local folder.',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false },
  },
  {
    name: 'xray_diff',
    description: 'List what a newer version of a plugin or MCP server can do that the older one could not (new hosts, email addresses, hooks, connectors, capabilities).',
    inputSchema: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'], additionalProperties: false },
  },
];

async function call(name, args) {
  if (name === 'xray_audit') {
    const r = await audit();
    const head = `${plural(r.digests.length, 'item')} · ≈${fmtTokens(r.totals.contextTokens)} tokens every turn · ${plural(r.totals.connectors, 'connector')} · ${plural(r.overlaps.length, 'overlap')}`;
    const rows = r.digests.map((d) => cardText(d));
    const ov = r.overlaps.map((o) => `- ⇄ ${o.label}. ${o.suggestion}`);
    return [head, ...rows, ov.length ? `Overlaps:\n${ov.join('\n')}` : ''].filter(Boolean).join('\n\n');
  }
  if (name === 'xray_scan') {
    const r = await scan(args.target);
    let t = cardText(r.digest, r.overlaps);
    if (r.digest.hosts.length) t += `\n- talks to ${r.digest.hosts.slice(0, 10).join(', ')}`;
    if (r.update?.changes.length) t += `\nCompared with the installed version:\n${r.update.changes.map((c) => `- ${c.text}`).join('\n')}`;
    return t;
  }
  if (name === 'xray_diff') {
    const d = await diff(args.old, args.new);
    return `${d.from} → ${d.to}\n${d.changes.length ? d.changes.map((c) => `- ${c.text}`).join('\n') : 'No new capabilities.'}`;
  }
  throw new Error(`unknown tool ${name}`);
}

export function serve() {
  const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    if (id === undefined) return; // notification
    try {
      if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'plugin-xray', version: '0.1.1' } } });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      if (method === 'tools/call') {
        try {
          const text = await call(params.name, params.arguments || {});
          return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
        } catch (e) {
          return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `X-ray could not finish: ${e.message}` }], isError: true } });
        }
      }
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  });
}

export { findingText };
