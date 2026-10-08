/**
 * FIX-r1 item 4, RED first at 8fb1959. Unlike the manual-node exclusion row, this approves the REAL server hold
 * through TurnExecutor → gm-held-execute → commitDirectAnswer → assignEntityRefs → stored graph → loader → Run.
 * HEAD assigns R1/ref_high_water.R:1; node removal leaves the counter on the wire and the residual becomes partial.
 * The author executes this row; no tests/typecheck are run in the fix sandbox.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { _resetConfigCache } from '../../../../config/index.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { diffRunInputs } from '../../../coaching/run-input-changes.js';
import { assignEntityRefs } from '../../../graph/entity-refs.js';
import { dispatchAddRiskTransaction } from '../../../handlers/add-risk-dispatch.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import type { PendingAction } from '../../../session/pending-action.js';
import type { SessionStore, SessionTurnWrite } from '../../../session/store.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { runTurnExecutor } from '../../../turn-executor.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { sentDigest } from '../run-input-snapshot.js';
import { withoutPreconditionRisks } from '../../../../graph/inert-risk.js';
import { runWithBoundAnalysisSnapshot } from '../../../run-analysis-snapshot-binding.js';

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-00000000ac34';
const RISK_ID = 'risk_feature_release_slips';
const OPTION_ID = '59_price';
let savedGraph: Json;
let pendingActions: readonly PendingAction[] = [];
const writes: SessionTurnWrite[] = [];
const store: SessionStore = {
  ...createNoopSessionStore(),
  append: async (write) => {
    writes.push(structuredClone(write));
    if (write.graph !== undefined && write.graph !== null) savedGraph = structuredClone(write.graph) as Json;
    pendingActions = write.pending_actions ?? [];
    return { id: `rc3-row-${writes.length}` };
  },
  loadGraph: async () => structuredClone(savedGraph),
  loadGraphAndBriefText: async () => ({ graph: structuredClone(savedGraph), briefText: M1._provenance.brief_text }),
  readMostRecentPendingActions: async () => pendingActions,
};
vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {},
}));
vi.mock('../../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => {} }));

// Each served turn binds its own snapshot; isolate every Run here as production does.
const runSaved = () => runWithBoundAnalysisSnapshot(undefined as never, runSavedOnce);
async function runSavedOnce() {
  const before = JSON.stringify(savedGraph);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'rc3-real-load', store);
  const run = vi.fn(async () => structuredClone(M1.plot_body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'rc3-real-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 'rc3-real-run', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'rc3-real-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis');
  if (fact?.fact_type !== 'run_analysis') throw new Error('Run did not produce a fact');
  expect(fact.result.input_snapshot?.residual_digest).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(savedGraph), 'Run never mutates the saved model or its allocator').toBe(before);
  return { payload: (run.mock.calls as unknown as [Json][])[0]![0], inputs: fact.result.input_snapshot as RunInputSnapshot };
}

const sortedJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

async function approveRisk(label: string, turnId: string) {
  const held = dispatchAddRiskTransaction({
    scenarioId: SCENARIO, turnId: `${turnId}-hold`, requestId: `${turnId}-hold`, params: { risk: { label }, links: [] }, reliesOn: { option_id: OPTION_ID },
    currentGraph: savedGraph, currentGraphHash: computeAnalysisAffectingGraphHash(savedGraph as never),
    freshness: 'fresh', mode: 'live', stage: 'frame',
  });
  expect(held.kind).toBe('held');
  if (held.kind !== 'held') throw new Error(`not held: ${held.reason}`);
  // The dispatcher is pure; seed its real held record into the store's pending read. Approval itself commits below.
  pendingActions = held.pendingActions;
  const routingAdapter = { chatWithTools: vi.fn(async () => { throw new Error('approval must not call the model'); }) };
  // Each served turn has its own async context; isolate the approval's snapshot binding as production does.
  const result = await runWithBoundAnalysisSnapshot(undefined as never, () => runTurnExecutor({
    kind: 'message', source: 'chip', scenario_id: SCENARIO, turn_id: turnId,
    message: held.chip.message, chip: { id: held.chip.id }, turn_class: 'decide', stage: 'analyse',
  } as MessageTurnPayload, turnId, { routingAdapter }));
  expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
  expect(result.response.assistant_text).toContain('Confirmed:');
  expect(writes.at(-1)?.handler_facts).toContainEqual(expect.objectContaining({ fact_type: 'edit_graph' }));
  expect(pendingActions.some((p) => p.chip_id === held.pendingActions[0]!.chip_id)).toBe(false);
  return held.riskId;
}

afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('RC3 FIX-r1 real approval/commit Run invariance', () => {
  it('rc3-real-commit-run-invariant: first risk gets R1, saved counters keep allocating, identical Run wire and full input coverage', async () => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
    _resetConfigCache();
    writes.length = 0;
    pendingActions = [];
    const g = structuredClone(M1.graph);
    g.nodes.find((n: Json) => n.id === OPTION_ID).label = 'Raise Pro price to £59';
    // Saved, canonical fixture with stable option references; importantly there has been no risk allocation yet.
    savedGraph = assignEntityRefs(projectGraphForPersistence(g), null).graph as Json;
    expect(savedGraph.ref_high_water?.R).toBeUndefined();
    const optionRefs = savedGraph.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => [n.id, n.ref]);
    const before = await runSaved();
    expect(await approveRisk('Feature release slips', 'rc3-real-approve-1')).toBe(RISK_ID);
    expect(writes).toHaveLength(1);
    expect(savedGraph.nodes.find((n: Json) => n.id === RISK_ID)).toMatchObject({ ref: 'R1', relies_on: { option_id: OPTION_ID } });
    expect(savedGraph.ref_high_water.R).toBe(1);
    expect(savedGraph.edges.filter((e: Json) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
    expect(savedGraph.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => [n.id, n.ref])).toEqual(optionRefs);
    const after = await runSaved();
    // Key ORDER is not content: the real commit rewrites the allocator's key order (D last); the digests below are the bar.
    expect(sortedJson(after.payload), 'RED at HEAD: real commit leaves ref_high_water.R on the outbound graph').toBe(sortedJson(before.payload));
    expect(sentDigest(after.payload)).toBe(sentDigest(before.payload));
    expect(after.inputs.residual_digest).toBe(before.inputs.residual_digest);
    expect(diffRunInputs(before.inputs, after.inputs), 'the complete wire difference is empty').toEqual({ rows: [], complete: true });
    expect(JSON.stringify(after.payload)).not.toContain(RISK_ID);

    // Compute-only stripping must not retire, reset, or reuse the real allocator: the next REAL approved risk is R2.
    const second = await approveRisk('Launch approval slips', 'rc3-real-approve-2');
    expect(savedGraph.nodes.find((n: Json) => n.id === second)?.ref).toBe('R2');
    expect(savedGraph.ref_high_water.R).toBe(2);
    const again = await runSaved();
    expect(sortedJson(again.payload)).toBe(sortedJson(before.payload));
    expect(sentDigest(again.payload)).toBe(sentDigest(before.payload));
    expect(diffRunInputs(before.inputs, again.inputs)).toEqual({ rows: [], complete: true });
  }, 120_000);

  it('rc3-compute-allocator-compat: no left-out risk → the compute copy IS the graph, allocator kept (stored Runs still compare, Codex r2 P2)', () => {
    const g: Json = {
      nodes: [{ id: 'opt_raise', kind: 'option', label: 'Raise', ref: 'O2' }, { id: 'risk_churn', kind: 'risk', label: 'Churn', ref: 'R3' }],
      edges: [{ from: 'risk_churn', to: 'opt_raise' }], ref_high_water: { O: 4, R: 7 },
    };
    const before = structuredClone(g);
    expect(withoutPreconditionRisks(g)).toBe(g);
    expect(g).toEqual(before);
  });

  it.each([
    ['top', 'R5', { O: 2, R: 5 }, { O: 2, R: 4 }],
    ['only', 'R1', { O: 2, R: 1 }, { O: 2 }],
    ['not-top', 'R2', { O: 2, R: 5 }, { O: 2, R: 5 }],
  ] as const)('rc3-compute-allocator-step-back-%s: the R counter steps back only past refs the left-out risks took at the top', (_id, ref, hw, expected) => {
    const g: Json = {
      nodes: [
        { id: 'opt_raise', kind: 'option', label: 'Raise', ref: 'O2' },
        { id: 'risk_slip', kind: 'risk', label: 'Slip', ref, relies_on: { option_id: 'opt_raise' } },
      ],
      edges: [], ref_high_water: hw,
    };
    const compute = withoutPreconditionRisks(g);
    expect(compute.ref_high_water).toEqual(expected);
    expect(compute.nodes.map((n: Json) => n.id)).toEqual(['opt_raise']);
    expect(g.ref_high_water).toEqual(hw);
  });
});
