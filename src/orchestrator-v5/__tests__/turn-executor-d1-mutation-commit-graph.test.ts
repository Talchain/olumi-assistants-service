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

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

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
    storeDraftGraph: async () => undefined,
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

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Golden fixtures (captured EXP-01 graphs)
// ---------------------------------------------------------------------------

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** EXP-01 run_analysis anchor — hash of the rich persisted graph. */
const RICH_HASH = 'b3ebb23cfb03df1d';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Payload / adapter helpers. Gate 1 (identifier proof): scenario_id,
// turn_id and request_id are all DISTINCT values, so a
// scenario/turn/request id confusion in the strict-read call site
// cannot pass accidentally.
// ---------------------------------------------------------------------------

const SCENARIO_ID = '49769b89-37c7-4c98-a278-4e389fa1cfc1';

function payload(message: string, turnId: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on this path');
      }),
  };
}

function installPriorRunAnalysisFact(graphHashAtRun: string): void {
  priorTurns = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      scenario_id: SCENARIO_ID,
      user_id: null,
      turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: 'sha256:prev',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 42,
      created_at: '2026-06-11T23:33:33.796+00:00',
    },
  ];
  priorFacts = [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_hire_local',
        summary: 'Hire Two Senior Engineers Locally currently leads.',
        graph_hash_at_run: graphHashAtRun,
        computed_at: '2026-06-11T23:33:33.000Z',
        enrichment: { analysis_status: 'completed' },
        win_probabilities: { opt_hire_local: 0.76 },
      },
    },
  ];
}

/** Drive the deterministic value-update pre-route (EXP-01 J5c shape). */
async function runSetFactorValueTurn(requestId: string, turnId: string) {
  return runTurnExecutor(
    payload('Set the Local Senior Hire Indicator factor to 1.0.', turnId),
    requestId,
    {
      routingAdapter: throwingRoutingAdapter(),
      graphState: clone(ECHO_GRAPH_STATE) as never,
    },
  );
}

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
  setTestSink(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D1 mutation commits the persisted-base merge (V5-D1-SHAPE-01)', () => {
  it('decisive live-faithful case (J5c): set_factor_value commits a graph that retains goal_node_id + options[] byte-for-byte AND carries the new factor value; rerun is legitimately stale', async () => {
    installPriorRunAnalysisFact(RICH_HASH);
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);

    await runSetFactorValueTurn(
      'req-d1shape-j5c',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
    );

    const mutationWrite = appendCalls.at(-1)!;
    expect(mutationWrite.handler_id).toBe('set_factor_value');
    expect(mutationWrite.graph).toBeDefined();
    const committed = mutationWrite.graph as Record<string, unknown>;

    // THE FIX — server-authoritative top-level fields survive from the
    // persisted base. Pre-fix the committed graph was the echo-shaped
    // mutated_graph: no goal_node_id, no options[] (scorecard J5c
    // options → 0; canonical state loss, not a guaranteed analysis
    // outage — readiness re-derives goal/options from node kinds).
    expect(committed.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(JSON.stringify(committed.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );

    // The intended mutation IS applied.
    const mutatedNode = (
      committed.nodes as Array<{ id: string; observed_state?: { value?: number } }>
    ).find((n) => n.id === 'fac_local_hire');
    expect(mutatedNode?.observed_state?.value).toBe(1);

    // Freshness: a real mutation makes the prior analysis LEGITIMATELY
    // stale — the committed graph's analysis-affecting hash moved off
    // the run anchor, and rerun would re-anchor on a graph that still
    // carries goal_node_id + options[] (run_analysis can execute).
    const committedHash = computeAnalysisAffectingGraphHash(committed as never);
    expect(committedHash).not.toBe(RICH_HASH);
    expect(currentPersistedGraph).toBe(committed);

    await runTurnExecutor(
      payload('what changed?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12'),
      'req-d1shape-post',
      {
        routingAdapter: {
          chatWithTools: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'The factor moved.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 20 },
            model: 'claude-sonnet-4-6',
            latencyMs: 50,
          } as unknown as ChatWithToolsResult),
        },
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );
    const freshness = events
      .filter(
        (e) =>
          e.event === 'v5.analysis_freshness.derived' &&
          e.data.dispatch_path === 'turn_executor_pre_handler',
      )
      .at(-1);
    expect(freshness!.data.freshness).toBe('stale');
    expect(freshness!.data.reason).toBe('graph_hash_diverged');
    expect(freshness!.data.current_graph_hash).toBe(committedHash);
  });

  it('Gate 1 identifier proof: the strict persisted read is keyed by the SCENARIO id — the same value the commit targets — not the turn or request id', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const turnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13';
    const requestId = 'req-d1shape-idproof';

    await runSetFactorValueTurn(requestId, turnId);

    expect(appendCalls.at(-1)!.graph).toBeDefined();
    expect(loadGraphCalls.length).toBeGreaterThan(0);
    const strictReadId = loadGraphCalls.at(-1);
    expect(strictReadId).toBe(SCENARIO_ID);
    expect(strictReadId).not.toBe(turnId);
    expect(strictReadId).not.toBe(requestId);
  });

  it('fail closed: a degraded strict read aborts the commit — STATE_COMMIT_FAILED error envelope, zero rows appended, scenarios.graph untouched', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const pristine = JSON.stringify(currentPersistedGraph);
    loadGraphError = new Error('session store unreachable');

    const { response } = await runSetFactorValueTurn(
      'req-d1shape-degraded',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14',
    );

    // Nothing persisted: no turn row, no facts, no graph. The handler
    // facts assert the mutation was applied, so committing them without
    // the graph would corrupt canonical state.
    expect(appendCalls).toHaveLength(0);
    expect(JSON.stringify(currentPersistedGraph)).toBe(pristine);
    // Pin the commit-failure envelope directly (Codex follow-up):
    // STATE_COMMIT_FAILED maps to wire error_code 'INTERNAL_ERROR'
    // (INTERNAL_TO_WIRE), is the retryable transient class
    // (details.retryable), and STEP 7's catch stamps phase:'commit' —
    // together these identify the commit-abort path, not a generic
    // internal error.
    const errorBlock = (
      response.blocks as Array<{
        type: string;
        error_code?: string;
        details?: Record<string, unknown>;
      }>
    ).find((b) => b.type === 'error');
    expect(errorBlock).toBeDefined();
    expect(errorBlock!.error_code).toBe('INTERNAL_ERROR');
    expect(errorBlock!.details).toMatchObject({ retryable: true, phase: 'commit' });
    const completed = events.find((e) => e.event === 'turn_executor.completed');
    expect(completed?.data.failure_type).toBe('INTERNAL_ERROR');
    expect(completed?.data.commit_performed).toBe(false);
  });

  it('genuinely-empty persisted graph: strict read returns null → the ingress-shaped mutated graph is the first valid write (no fail-closed, no invention)', async () => {
    currentPersistedGraph = null;

    await runSetFactorValueTurn(
      'req-d1shape-empty',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15',
    );

    const mutationWrite = appendCalls.at(-1)!;
    expect(mutationWrite.handler_id).toBe('set_factor_value');
    expect(mutationWrite.graph).toBeDefined();
    const committed = mutationWrite.graph as Record<string, unknown>;
    const mutatedNode = (
      committed.nodes as Array<{ id: string; observed_state?: { value?: number } }>
    ).find((n) => n.id === 'fac_local_hire');
    expect(mutatedNode?.observed_state?.value).toBe(1);
    // Nothing invented: the echo never carried options[], so the first
    // write doesn't either.
    expect(committed.options).toBeUndefined();
  });

  it('no-op value update (set to the current value) still commits the FULL merged shape — no strip on no-op', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);

    // fac_local_hire currently 0 in the fixture; set it to 0 again.
    await runTurnExecutor(
      payload(
        'Set the Local Senior Hire Indicator factor to 0.',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16',
      ),
      'req-d1shape-noop',
      {
        routingAdapter: throwingRoutingAdapter(),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    const write = appendCalls.at(-1)!;
    // Whether the handler treats this as a mutation or a no-op, the
    // persisted graph must NOT lose its shape.
    if (write.graph !== undefined && write.graph !== null) {
      const committed = write.graph as Record<string, unknown>;
      expect(committed.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
      expect(JSON.stringify(committed.options)).toBe(
        JSON.stringify(RICH_PERSISTED_GRAPH.options),
      );
    }
    const persisted = currentPersistedGraph as Record<string, unknown>;
    expect(persisted.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(JSON.stringify(persisted.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );
  });
});

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
      // A1 multi-edit — compound value-update chaining forwards the
      // `set_factor_value` handler's OWN mutated_graph, chained across parts.
      // The graph is therefore a D1 ingress-echo mutation that never deletes
      // nodes (the contract this guard protects) by construction — it is not a
      // novel producer. Scoped to this small, purpose-built module rather than
      // exempting the whole turn-executor. See its module doc.
      'orchestrator-v5/compound-value-update-chain.ts',
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
