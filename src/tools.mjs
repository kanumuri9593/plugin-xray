// Counts what an MCP server's tool list costs in context. This starts the
// server, so it only runs when asked (--tools) and only for stdio servers.
import { spawn } from 'node:child_process';
import { estimateTokens } from './util.mjs';
import { offline } from './policy.mjs';

export function listTools(cfg, { timeout = 20_000, cwd } = {}) {
  return new Promise((resolve) => {
    if (offline()) return resolve({ ok: false, error: 'skipped: XRAY_OFFLINE is set (counting tools starts the server)' });
    if (!cfg?.command) return resolve({ ok: false, error: 'remote server: tools are listed after you sign in' });
    const env = { ...process.env, ...(cfg.env || {}) };
    let child;
    try { child = spawn(cfg.command, cfg.args || [], { env, cwd, stdio: ['pipe', 'pipe', 'ignore'] }); } catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = '';
    const done = (r) => { clearTimeout(timer); try { child.kill(); } catch { /* already gone */ } resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: 'timed out' }), timeout);
    child.on('error', (e) => done({ ok: false, error: e.message }));
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        } else if (msg.id === 2) {
          const tools = msg.result?.tools || [];
          const chars = JSON.stringify(tools).length;
          done({ ok: true, count: tools.length, tokens: estimateTokens(chars), names: tools.map((t) => t.name) });
        }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-xray', version: '0.3.3' } } }) + '\n');
  });
}
