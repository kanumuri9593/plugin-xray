// Optional deep scan with REA (github.com/morluto/rea, MIT). REA builds a full
// semantic graph of a JavaScript package statically, with a source location for
// every program launch, network call, file write and config read. It is slower
// (~40 s) and much larger (tens of MB) than the quick scan, so X-ray boils its
// output down to the few facts a person needs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { offline } from './policy.mjs';

export const REA_VERSION = process.env.XRAY_REA_VERSION || '6.4.0';
const KINDS = { 'child-process': 'program launches', request: 'network calls', resource: 'file opens', 'config-source': 'config / env reads' };

export function deepScan(root, { timeout = 600_000 } = {}) {
  if (offline()) return { ok: false, error: 'skipped: XRAY_OFFLINE is set (the deep scan downloads REA with npx)' };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-rea-')), 'rea.json');
  const fd = fs.openSync(out, 'w');
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', `rea-agents@${REA_VERSION}`, 'analyze-javascript-application', root, '--json'], { stdio: ['ignore', fd, 'pipe'], timeout, shell: process.platform === 'win32' });
  fs.closeSync(fd);
  if (r.status !== 0) return { ok: false, error: (r.stderr || '').toString().split('\n').filter(Boolean).slice(-2).join(' ') || `exit ${r.status}` };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { return { ok: false, error: `could not read REA output: ${e.message}` }; }
  finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
  const n = doc.normalized_result || {};
  const counts = {};
  const evidence = {};
  for (const node of n.semantic_graph?.nodes || []) {
    if (!KINDS[node.kind]) continue;
    counts[node.kind] = (counts[node.kind] || 0) + 1;
    const id = node.identity || {};
    (evidence[node.kind] ||= []).length < 8 && evidence[node.kind].push(`${node.label || node.kind} ${id.module_path}:${id.source_range?.start?.line ?? '?'}`);
  }
  return {
    ok: true,
    engine: `rea-agents@${REA_VERSION}`,
    evidenceId: doc.evidence_id,
    filesParsed: n.statistics?.parsed_javascript_files,
    unresolved: n.semantic_graph?.unknowns?.length ?? null,
    counts,
    evidence,
    limitations: doc.limitations || [],
    summary: Object.entries(KINDS).map(([k, label]) => `${counts[k] || 0} ${label}`).join(' · '),
  };
}
