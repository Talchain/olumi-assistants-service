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

// Forbidden V4 patch/apply machinery (substrings, matched against module source).
const FORBIDDEN_V4 = [
  'patch-applier',
  'tools/edit-graph',
  'apply' + 'PatchOperations',
  'deterministic/actions/add-option',
  'deterministic/pipeline-v4',
  'handle' + 'EditGraph',
  'edit-graph-dispatch',
  'addOption' + 'Action',
];

// Forbidden live runtime write / persistence paths.
const FORBIDDEN_WRITE = [
  'commit' + 'DirectAnswer',
  'append_turn' + '_atomic',
  'supabase',
  '/commit.js',
  'route-v2',
  'turn-' + 'executor',
  '.rpc(',
];

describe('isolation guards (no-V4 / no-persistence / off-path)', () => {
  it('scans more than one module source file', () => {
    expect(moduleFiles.length).toBeGreaterThan(1);
  });

  it('no module file references V4 patch/apply machinery', () => {
    for (const f of moduleFiles) {
      const src = readFileSync(join(moduleDir, f), 'utf8');
      for (const bad of FORBIDDEN_V4) {
        expect(src.includes(bad), `${f} must not reference ${bad}`).toBe(false);
      }
    }
  });

  it('no module file references a live runtime write / persistence path', () => {
    for (const f of moduleFiles) {
      const src = readFileSync(join(moduleDir, f), 'utf8');
      for (const bad of FORBIDDEN_WRITE) {
        expect(src.includes(bad), `${f} must not reference ${bad}`).toBe(false);
      }
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
