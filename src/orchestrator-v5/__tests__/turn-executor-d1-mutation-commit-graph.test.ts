/**
 * V5-D1-SHAPE-01 — D1 mutation turns persist the merged
 * persisted-base shape, not the stripped ingress echo.
 *
 * Defect under test (scorecard J5c: options[] → 0 after
 * set_factor_value): D1 handlers mutate the ingress echo
 * (`applyAndValidateMutation` merges structural fields back onto the
 * INGRESS top-level shape), and the DGAI wire echo carries only
 * `{nodes, edges}` — never `goal_node_id`, never `options[]` — so the
 * STEP 7 commit replaced the rich draft-persisted `scenarios.graph`
 * with a stripped shape — canonical state loss: goal_node_id gone,
 * options[] → 0, top-level metadata stripped, future turns inherit
 * the lossy merge base, and freshness/hash behaviour can spuriously
 * diverge. (run_analysis may still succeed — readiness re-derives
 * goal/options from node kinds — so this is corruption, not a
 * guaranteed analysis outage.)
 *
 * Fix under test: STEP 7 strict-reads the persisted graph
 * (`loadPersistedGraphStrict`) and commits
 * `mergeMutatedGraphForPersistence(mutated, persistedBase)` — the
 * mutation wins for nodes/edges (+ goal_constraints when written);
 * the persisted base wins for `goal_node_id`, `options[]` and every
 * other top-level field. A degraded strict read FAILS CLOSED
 * (STATE_COMMIT_FAILED, nothing persisted): the handler facts assert
 * the mutation was applied, so committing them without the graph (or
 * with a lossy graph) would corrupt canonical state. Mirror of the
 * edit_graph fix (PR #265, V5-PERSIST-FIX-01).
 *
 * Golden fixtures are the CAPTURED EXP-01 graphs (same as
 * turn-executor-non-mutating-commit-graph.test.ts):
 * `rich-persisted-graph.json` (draft-persisted shape, hashes to the
 * live run_analysis anchor) and `echo-graph-state.json` (the
 * DGAI-shaped request echo).
 */

import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { __setUseAppendV6ForTest } from '../append-v6-flag.js';

import { setTestSink } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock — mirrors the RPC's p_graph semantics
// (same pattern as turn-executor-non-mutating-commit-graph.test.ts),
// extended with a strict-read seam: `loadGraph` records the id it was
// called with (Gate 1 identifier proof) and can be armed to throw
// (degraded-read fail-closed proof).
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
  handler_facts?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;
let priorTurns: unknown[] = [];
let priorFacts: unknown[] = [];
const loadGraphCalls: unknown[] = [];
let loadGraphError: Error | null = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    loadGraph: async (scenarioId: unknown) => {
      loadGraphCalls.push(scenarioId);
      if (loadGraphError) throw loadGraphError;
      return currentPersistedGraph;
    },
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));



// ---------------------------------------------------------------------------
// Golden fixtures (captured EXP-01 graphs)
// ---------------------------------------------------------------------------





/** EXP-01 run_analysis anchor — hash of the rich persisted graph. */




// ---------------------------------------------------------------------------
// Payload / adapter helpers. Gate 1 (identifier proof): scenario_id,
// turn_id and request_id are all DISTINCT values, so a
// scenario/turn/request id confusion in the strict-read call site
// cannot pass accidentally.
// ---------------------------------------------------------------------------









/** Drive the deterministic value-update pre-route (EXP-01 J5c shape). */


type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  appendCalls.length = 0;
  loadGraphCalls.length = 0;
  loadGraphError = null;
  currentPersistedGraph = null;
  priorTurns = [];
  priorFacts = [];
});

afterEach(() => {
  __setUseAppendV6ForTest(true);
  setTestSink(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Gate 2 invariant — mutated_graph emitter enumeration.
//
// The STEP 7 merge-back is applied UNIFORMLY (no per-path branching)
// because the only `mutated_graph` producers are the three D1 mutation
// handlers, which all build their graph via `applyAndValidateMutation`
// over the ingress echo (the flip-proposal apply path resolves through
// the same set_factor_value handler). If this test fails, a NEW
// producer was introduced: review whether the persisted-base merge is
// correct for it (does it mutate the ingress echo? does it delete
// nodes — which would need #265-style options[] dedupe?), then update
// the allowlist below.
//
// AST-aware by design (Codex review, PR #268): a line regex on
// `mutated_graph:` missed shorthand properties (`{ mutated_graph }`),
// property assignments (`outcome.mutated_graph = g`), and computed
// string keys. The TypeScript-AST scan below catches every static
// WRITE form, and helper indirection too: a helper that builds
// `{ mutated_graph: … }` for a caller to spread contains the flagged
// construction in its own (scanned) source. Reads — property access,
// destructuring, the optional-field type declaration in registry.ts —
// are deliberately NOT flagged. A fully dynamic key
// (`obj[someVar] = g`) remains out of static reach; that is
// adversarial, not a realistic producer shape in this codebase.
// ---------------------------------------------------------------------------

/**
 * Pure scanner shared by the directory invariant and its self-test
 * matrix (Codex follow-up): parse `text` and return one entry per
 * static WRITE to a `mutated_graph` property. Reads (property access,
 * destructuring) and type declarations are deliberately not returned.
 * Both callers exercise THIS function, so the matrix test guards the
 * real invariant logic — not a copy that could drift from it.
 */
function findMutatedGraphWrites(
  text: string,
): Array<{ readonly form: string; readonly line: number }> {
  const sf = ts.createSourceFile('scan.ts', text, ts.ScriptTarget.Latest, true);
  const hits: Array<{ form: string; line: number }> = [];
  const record = (node: ts.Node, form: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ form, line: line + 1 });
  };
  const visit = (node: ts.Node): void => {
    // { mutated_graph: value } and { 'mutated_graph': value }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'mutated_graph'
    ) {
      record(node, 'property assignment');
    }
    // { ['mutated_graph']: value }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isComputedPropertyName(node.name) &&
      ts.isStringLiteralLike(node.name.expression) &&
      node.name.expression.text === 'mutated_graph'
    ) {
      record(node, 'computed property');
    }
    // { mutated_graph } shorthand
    if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === 'mutated_graph'
    ) {
      record(node, 'shorthand property');
    }
    // outcome.mutated_graph = value / outcome['mutated_graph'] = value
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ((ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === 'mutated_graph') ||
        (ts.isElementAccessExpression(node.left) &&
          ts.isStringLiteralLike(node.left.argumentExpression) &&
          node.left.argumentExpression.text === 'mutated_graph'))
    ) {
      record(node, 'assignment expression');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('Gate 2 invariant — mutated_graph emitters are exactly the three D1 handlers', () => {
  it('no new mutated_graph producer (any static write form) outside the reviewed allowlist', () => {
    const SRC_ROOT = new URL('../../', import.meta.url).pathname;
    const ALLOWED = new Set([
      'orchestrator-v5/tools/handlers/set-factor-value.ts',
      'orchestrator-v5/tools/handlers/add-constraint.ts',
      'orchestrator-v5/tools/handlers/adjust-edge-strength.ts',
    ]);

    const offenders: string[] = [];
    const scanned: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const text = readFileSync(full, 'utf8');
        // Cheap pre-filter: AST-parse only files that mention the field.
        if (!text.includes('mutated_graph')) continue;
        const rel = full.slice(SRC_ROOT.length);
        scanned.push(rel);
        if (ALLOWED.has(rel)) continue;
        for (const hit of findMutatedGraphWrites(text)) {
          offenders.push(`${rel}:${hit.line} (${hit.form})`);
        }
      }
    };
    walk(SRC_ROOT);

    // The scan must have seen all three reviewed producers — guards
    // against the walk silently skipping them (renamed dir, moved file).
    for (const allowed of ALLOWED) {
      expect(scanned, `expected to scan reviewed producer ${allowed}`).toContain(
        allowed,
      );
    }

    expect(
      offenders,
      'New HandlerOutcome.mutated_graph producer detected. The STEP 7 ' +
        'persisted-base merge-back (V5-D1-SHAPE-01) assumes every producer ' +
        'is a D1 ingress-echo mutation that never deletes nodes — review ' +
        'the new producer against that contract before extending the allowlist.',
    ).toEqual([]);
  });
});

// Self-test matrix for the scanner (Codex follow-up): locks the set of
// write forms the invariant detects and the read/type forms it must NOT,
// so a future edit that weakens detection fails here loudly rather than
// silently letting a new producer through the directory invariant.
describe('findMutatedGraphWrites — detection matrix', () => {
  it.each([
    ['property assignment', 'export const o = { ok: true, mutated_graph: g };'],
    ['quoted-key property', 'export const o = { "mutated_graph": g };'],
    ['computed string key', 'export const o = { ["mutated_graph"]: g };'],
    [
      'shorthand property',
      'const mutated_graph = g; export const o = { foo, mutated_graph };',
    ],
    ['property assignment expr', 'declare const outcome: any; outcome.mutated_graph = g;'],
    [
      'element assignment expr',
      'declare const outcome: any; outcome["mutated_graph"] = g;',
    ],
    [
      'helper literal (indirection)',
      'export function withMutatedGraph(g: unknown) { return { mutated_graph: g }; }',
    ],
  ])('FLAGS a %s', (_label, src) => {
    expect(findMutatedGraphWrites(src).length).toBeGreaterThan(0);
  });

  it.each([
    ['optional-chain read', 'declare const o: any; export const x = o?.mutated_graph;'],
    [
      'presence-check read',
      'declare const o: any; export const y = o.mutated_graph !== undefined;',
    ],
    [
      'destructuring read',
      'declare const o: any; const { mutated_graph } = o; export const z = mutated_graph;',
    ],
    [
      'type declaration',
      'export interface H { readonly mutated_graph?: unknown; }',
    ],
    ['unrelated identifier', 'export const mutated_graph_count = 3;'],
  ])('does NOT flag a %s', (_label, src) => {
    expect(findMutatedGraphWrites(src)).toEqual([]);
  });
});
