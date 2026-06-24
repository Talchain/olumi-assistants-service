import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..'); // src/orchestrator-v5/graph-management
const moduleFiles = readdirSync(moduleDir).filter((f) => f.endsWith('.ts'));

/**
 * Import-allowlist enforcement (stronger than a forbidden-substring scan — it
 * cannot be bypassed by aliases, barrels, or unexpected new imports). Every
 * cross-boundary import in the module MUST be one of these exact specifiers;
 * everything else must be a local `./` import. Any V4 patch/apply, persistence,
 * route, or write module would fail because it is simply not on the list.
 */
const ALLOWED_CROSS_BOUNDARY = new Set([
  '../tools/handlers/d1-shared/apply-graph-mutation.js',
  '../tools/handlers/d1-shared/errors.js',
  '../tools/handlers/analysis-ready-core.js',
  '../context/graph-hash.js',
  '../../schemas/cee-v3.js',
]);

function staticImportSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const re = /\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1]);
  return specs;
}

describe('isolation guards (import allowlist / no-persistence / off-path)', () => {
  it('scans more than one module source file', () => {
    expect(moduleFiles.length).toBeGreaterThan(1);
  });

  it('every cross-boundary import is on the allowlist; everything else is local', () => {
    for (const f of moduleFiles) {
      const src = readFileSync(join(moduleDir, f), 'utf8');
      for (const spec of staticImportSpecifiers(src)) {
        const isLocal = spec.startsWith('./');
        const allowed = isLocal || ALLOWED_CROSS_BOUNDARY.has(spec);
        expect(allowed, `${f} imports disallowed module '${spec}'`).toBe(true);
      }
    }
  });

  it('no module file uses a dynamic import() or require() (no dynamic bypass)', () => {
    for (const f of moduleFiles) {
      const src = readFileSync(join(moduleDir, f), 'utf8');
      expect(/\bimport\s*\(/.test(src), `${f} must not use dynamic import()`).toBe(false);
      expect(/\brequire\s*\(/.test(src), `${f} must not use require()`).toBe(false);
    }
  });

  it('zero persistence: the input graph is never mutated and the candidate is a distinct object', () => {
    const graph = buildReadyGraph();
    const snapshot = structuredClone(graph);
    const r = classifyProposal(
      {
        kind: 'rename_node',
        base_graph_hash: currentAnalysisHash(graph),
        node_id: 'g-profit',
        new_label: 'Renamed',
      },
      graph,
    );
    expect(graph).toEqual(snapshot); // input untouched
    expect(r.candidate).toBeDefined();
    expect(r.candidate).not.toBe(graph); // candidate is a new object
  });
});
