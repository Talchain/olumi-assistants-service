/**
 * ⭐ SLICE A6b — AN ADD THE USER REQUESTED OR APPROVED IS STAMPED `user_set`
 * (Canonical's A6 design, ratified by DL #70 5855437928).
 *
 * THE DEFECT (code-read at CEE 339ed343, re-derived at 9cfdbb35). Node
 * `provenance: 'user_set'` is the ONE node spelling for "the user put this
 * here" (`NodeV3.provenance`), and only the canvas `structural_add` wrote it.
 * Every add that reached the graph through the held/confirm seam — the chip and
 * Agent add-option (option node + `new_factors`), approved `edit_graph` adds,
 * any held structural add — landed with NO node provenance. Served: Paul's
 * Agent-minted option `6526b52c` (export `paul-08bf9a1f`, `draft_graph.nodes[13]`)
 * carries none, while every other option in the same graph does.
 *
 * THE DESIGN THIS PINS (no new vocabulary):
 *   · CEE writes `provenance: 'user_set'` on every add the USER APPROVED, at the
 *     approval seam (`executeGmHeldResume`), AFTER the strip and the re-referee —
 *     never taken from the model's payload.
 *   · J2: a model cannot self-stamp. Its own `provenance` on an add is stripped;
 *     an add no user approved (the auto-applied normal seam) stays unstamped, and
 *     no payload literal can sit where CEE's stamp goes.
 *   · Draft / repair / system adds stay unstamped.
 *   · The stamp is outside the analysis hash, and a later value write to a
 *     stamped node keeps it and passes the stored-bytes scope guards.
 *
 * HARNESS: every row mints the hold through the REAL producer (the add-option
 * dispatch, or `handleEditGraph` + the referee gate), round-trips the pending the
 * way the store does (JSONB key order, `parsePendingAction`), and confirms
 * through the REAL `executeGmHeldResume` — the loop a user's "yes" drives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { dispatchAddOptionTransaction } from '../add-option-dispatch.js';
import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';
import {
  computeAnalysisAffectingGraphHash,
  computeAnalysisAffectingGraphHashSha256,
} from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import {
  applyOptionInterventionBatch,
  factorValuesPostimageIsScoped,
  optionInterventionBatchPostimageIsScoped,
} from '../../system-events/option-intervention-edit.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { stampUserApprovedAddProvenance } from '../../../orchestrator/canonicalise-value-ops.js';
import type { ConversationContext, PatchOperation } from '../../../orchestrator/types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import * as telemetry from '../../../utils/telemetry.js';

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

type Node = Record<string, unknown> & { id: string };
type Graph = { nodes: Node[]; edges: Record<string, unknown>[] } & Record<string, unknown>;

const USER_SET = 'user_set';

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as GraphStateIngress);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

function nodeOf(graph: unknown, id: string): Node {
  const found = (graph as Graph).nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`node ${id} missing`);
  return found;
}

/** What a Postgres `jsonb` column gives back: keys shorter-first then bytewise, `undefined` dropped. */
function jsonbOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** The pending as the NEXT turn reads it back from the store. */
function throughTheStore(pending: PendingAction): PendingAction {
  const back = parsePendingAction(jsonbOrder(JSON.parse(JSON.stringify(pending))));
  if (back === null) throw new Error('the held pending must survive the store round-trip');
  return back;
}

/** The held batch's own operations (what the store keeps until the user answers). */
function heldOps(pending: PendingAction): PatchOperation[] {
  const read = readGmHeldResume(pending);
  if (read.kind !== 'ok') throw new Error(`pending must carry an executable payload (${read.kind})`);
  return [...read.operations] as PatchOperation[];
}

/** The user's "yes": re-referee + apply through the REAL confirm seam. */
function confirm(pending: PendingAction, currentGraph: unknown, tag: string) {
  const read = readGmHeldResume(pending);
  if (read.kind !== 'ok') throw new Error(`pending must carry an executable payload (${read.kind})`);
  return executeGmHeldResume({
    operations: read.operations,
    ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
    currentGraph,
    currentGraphHash: hashOf(currentGraph),
    freshness: 'none',
    hasExistingAnalysis: false,
    scenarioId: `scn-a6b-${tag}`,
    turnId: `turn-a6b-${tag}`,
    requestId: `req-a6b-${tag}`,
  });
}

// ---------------------------------------------------------------------------
// Paul's served graph, scrubbed to what these rows need (export paul-08bf9a1f,
// `payloads.cee_response.draft_graph`): the pre-add model, i.e. WITHOUT option
// `6526b52c` and its three links. Labels, ids, provenance, levels and frames are
// the served bytes; unrelated nodes (price, churn, risk) and edge reasoning are
// dropped. `mrr`'s nonlinear identity is dropped (it names the dropped price).
// ---------------------------------------------------------------------------
const topology = (from: string, to: string, source = 'cee_hypothesis') => ({
  from, to, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source },
});
const causal = (from: string, to: string, mean: number, std: number) => ({
  from, to, strength: { mean, std }, exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' },
});
const spendFactor = (id: string, label: string) => ({
  id, kind: 'factor', label, category: 'controllable', provenance: 'ai_inferred',
  observed_state: { cap: 100000, unit: 'GBP over 6 months', value: 0, source: 'cee_inference', raw_value: 0, declared_scale: 'unit_interval' },
});
const PAUL_PRE_ADD = {
  goal_node_id: 'mrr',
  nodes: [
    { id: 'decision_mrr', kind: 'decision', label: 'Decision: MRR', provenance: 'ai_inferred' },
    {
      id: 'mrr', kind: 'goal', label: 'MRR', provenance: 'from_brief', goal_threshold: 0.8,
      goal_threshold_cap: 125000, goal_threshold_raw: 100000, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level',
      observed_state: { cap: 125000, unit: 'GBP/month', value: 0.576, source: 'user_override', baseline: 0.576, raw_value: 72000 },
    },
    {
      id: 'additional_advertising', kind: 'option', label: 'Additional advertising', provenance: 'from_brief',
      interventions: { additional_advertising_spend: { value: 0.2, source: 'cee_hypothesis' } },
    },
    { id: 'carry_on_as_now', kind: 'option', label: 'Carry on as now', provenance: 'ai_inferred', is_baseline: true },
    spendFactor('feature_development_spend', 'Feature development spend'),
    spendFactor('additional_advertising_spend', 'Additional advertising spend'),
    {
      id: 'pro_paying_subscribers', kind: 'factor', label: 'Pro paying subscribers', category: 'observable', provenance: 'user_set',
      scale_frame: 10000, display_value: '1,500 subscribers',
      observed_state: { unit: 'subscribers', value: 0.15, source: 'user_assumption', raw_value: 1500 },
    },
    { id: 'six_month_decision_spend', kind: 'outcome', label: 'Six-month decision spend', provenance: 'ai_inferred' },
  ],
  edges: [
    topology('decision_mrr', 'additional_advertising'),
    topology('decision_mrr', 'carry_on_as_now'),
    topology('additional_advertising', 'additional_advertising_spend'),
    topology('carry_on_as_now', 'feature_development_spend'),
    topology('carry_on_as_now', 'additional_advertising_spend'),
    causal('feature_development_spend', 'six_month_decision_spend', 0.5, 0.125),
    causal('additional_advertising_spend', 'six_month_decision_spend', 0.5, 0.125),
    causal('additional_advertising_spend', 'pro_paying_subscribers', 0.1, 0.05),
    causal('six_month_decision_spend', 'pro_paying_subscribers', 0.5, 0.125),
    causal('pro_paying_subscribers', 'mrr', 0.5, 0.125),
  ],
};

/** The model as `scenarios.graph` holds it: the persisted form (options mirror etc.). */
function paulStored(): Graph {
  return projectGraphForPersistence(structuredClone(PAUL_PRE_ADD)) as unknown as Graph;
}

const PAUL_OPTION_ID = '6526b52c';
const PAUL_OPTION_LABEL = 'Split the extra budget: £5k features + £5k advertising';

/**
 * The chip parameters the Agent's `propose_new_option` sends for Paul's option
 * (`agent-capabilities.ts`: `{ parent_decision_id, label, option_id,
 * interventions: [{ factor_id, value, raw_value, unit }] }`): the user's £5k on a
 * 0–£100k frame is 0.05, exactly the served level.
 */
function paulChipParameters(withNewFactor: boolean): Record<string, unknown> {
  const level = (factorId: string) => ({ factor_id: factorId, value: 0.05, raw_value: 5000, unit: 'GBP over 6 months' });
  return {
    parent_decision_id: 'decision_mrr',
    label: PAUL_OPTION_LABEL,
    option_id: PAUL_OPTION_ID,
    interventions: [
      level('feature_development_spend'),
      level('additional_advertising_spend'),
      ...(withNewFactor ? [{ factor_key: 'nf_reach', value: null }] : []),
    ],
    ...(withNewFactor
      ? { new_factors: [{ key: 'nf_reach', label: 'Launch campaign reach', affects: [{ node_id: 'pro_paying_subscribers', effect_direction: 'positive' }] }] }
      : {}),
  };
}

/** Chip → held → store round-trip → the user's "yes" → the graph the commit writes. */
function approvePaulOption(withNewFactor: boolean) {
  const stored = paulStored();
  const held = dispatchAddOptionTransaction({
    parameters: paulChipParameters(withNewFactor),
    currentGraph: stored,
    currentGraphHash: hashOf(stored),
    freshness: 'none',
    mode: 'live',
    scenarioId: 'scn-a6b-paul',
    turnId: 'turn-a6b-paul',
    requestId: 'req-a6b-paul',
    stage: 'frame',
  });
  expect(held.kind, JSON.stringify(held).slice(0, 400)).toBe('held');
  if (held.kind !== 'held') throw new Error('the add-option chip must hold');
  expect(held.pendingActions).toHaveLength(1);
  const pending = throughTheStore(held.pendingActions[0]!);
  const outcome = confirm(pending, stored, 'paul');
  expect(outcome.status, JSON.stringify(outcome).slice(0, 400)).toBe('executed');
  if (outcome.status !== 'executed') throw new Error('the approved add-option must execute');
  // The commit chokepoint projects to the persisted form (`commitDirectAnswer`).
  const persisted = projectGraphForPersistence(outcome.mutatedGraph) as unknown as Graph;
  return { stored, pending, outcome, persisted };
}

// ---------------------------------------------------------------------------
// (a) Agent add-option approved via the chip
// ---------------------------------------------------------------------------
describe('(a) an Agent add-option approved via the chip is the user’s', () => {
  it('CONTROL (passes at base): the fixture reproduces the served defect’s precondition — the pre-add model is a persisted fixed point and has no 6526b52c', () => {
    const stored = paulStored();
    expect(isDeepStrictEqual(projectGraphForPersistence(stored), stored), 'the stored form projects to itself').toBe(true);
    expect(stored.nodes.some((n) => n.id === PAUL_OPTION_ID)).toBe(false);
  });

  it('RED: Paul’s 6526b52c, approved → the persisted option node carries provenance user_set', () => {
    const { persisted, stored } = approvePaulOption(false);
    const option = nodeOf(persisted, PAUL_OPTION_ID);
    expect(option.kind).toBe('option');
    expect(option.label).toBe(PAUL_OPTION_LABEL);
    // The served levels landed (the fixture is the served shape, not a stand-in).
    expect((option.interventions as Record<string, { raw_value?: number; value?: number }>).feature_development_spend)
      .toEqual(expect.objectContaining({ value: 0.05, raw_value: 5000 }));
    expect(option.provenance, 'the approved option is the user’s').toBe(USER_SET);
    // NEGATIVE CONTROL, by identity: no node the user did NOT add moved its provenance.
    for (const before of stored.nodes) {
      expect(nodeOf(persisted, before.id).provenance, `pre-existing ${before.id}`).toBe(before.provenance);
    }
  });

  it('RED: with a new factor in the same approval → the option AND every new_factors node carry user_set', () => {
    const { persisted, pending, stored } = approvePaulOption(true);
    const added = persisted.nodes.filter((n) => !stored.nodes.some((b) => b.id === n.id));
    const newFactorIds = heldOps(pending)
      .filter((o) => o.op === 'add_node' && (o.value as { kind?: unknown }).kind === 'factor')
      .map((o) => o.path);
    expect(newFactorIds, 'the held batch adds the new factor').toEqual(['fac_launch_campaign_reach']);
    expect(added.map((n) => n.id).sort()).toEqual([PAUL_OPTION_ID, ...newFactorIds].sort());
    for (const node of added) {
      expect(node.provenance, `${String(node.kind)} ${node.id}`).toBe(USER_SET);
    }
    expect(nodeOf(persisted, 'fac_launch_campaign_reach').label).toBe('Launch campaign reach');
  });

  it('J2 at the hold: the stamp is written at APPROVAL, never carried in the held payload', () => {
    const { pending } = approvePaulOption(true);
    const adds = heldOps(pending).filter((o) => o.op === 'add_node');
    expect(adds.length).toBe(2);
    for (const op of adds) {
      expect(Object.prototype.hasOwnProperty.call(op.value as object, 'provenance'), `held ${op.path}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// (b) + (d) the edit_graph lane
// ---------------------------------------------------------------------------
const EDIT_GRAPH = {
  nodes: [
    { id: 'dec_x', kind: 'decision', label: 'Platform Migration' },
    { id: 'opt_a', kind: 'option', label: 'Migrate Now' },
    {
      id: 'fac_setup', kind: 'factor', label: 'Setup and Migration Complexity',
      observed_state: { value: 0.2, raw_value: 500000, unit: '£', cap: 2500000 },
    },
    { id: 'goal_g', kind: 'goal', label: 'Total Cost' },
  ],
  edges: [
    { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_setup', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_setup', to: 'goal_g', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
  ],
};

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'test-model',
      latencyMs: 1,
      stopReason: 'end_turn',
    }),
  } as unknown as LLMAdapter;
}

/** The model's own batch for "add a data quality risk", its add carrying the model's OWN provenance claim. */
function modelAddBatch(modelProvenance: unknown) {
  return {
    operations: [
      {
        op: 'add_node',
        path: '/nodes/fac_risk',
        value: { id: 'fac_risk', kind: 'factor', label: 'Data Quality Risk', provenance: modelProvenance },
        old_value: null,
        impact: 'moderate',
        rationale: 'Add the risk factor.',
      },
      {
        op: 'add_edge',
        path: '/edges/opt_a->fac_risk',
        value: { from: 'opt_a', to: 'fac_risk', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
        old_value: null,
        impact: 'moderate',
        rationale: 'Wire the option to the risk.',
      },
      {
        op: 'add_edge',
        path: '/edges/fac_risk->goal_g',
        value: { from: 'fac_risk', to: 'goal_g', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
        old_value: null,
        impact: 'moderate',
        rationale: 'Wire the risk to the goal.',
      },
    ],
    removed_edges: [],
    warnings: [],
    coaching: { summary: 'Added the data quality risk.', rerun_recommended: true },
  };
}

/** The REAL edit lane: the model's batch → strip → canonicalise → the normal seam's applied candidate. */
async function editGraphTurn(modelProvenance: unknown, tag: string) {
  const ctx = {
    graph: structuredClone(EDIT_GRAPH),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: `scn-a6b-${tag}`,
  } as unknown as ConversationContext;
  const result = await handleEditGraph(
    ctx,
    'Add a data quality risk that affects total cost',
    makeAdapter(modelAddBatch(modelProvenance)),
    `req-a6b-${tag}`,
    `turn-a6b-${tag}`,
  );
  expect(result.wasRejected, String(result.assistantText)).toBe(false);
  expect(result.operations?.length ?? 0).toBeGreaterThan(0);
  return result;
}

/** What `dispatchEditGraph` does next under the live posture: the SAME gate holds the batch. */
function holdEditBatch(operations: readonly PatchOperation[], tag: string): PendingAction {
  const hash = hashOf(EDIT_GRAPH);
  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations: [...operations],
    currentGraph: EDIT_GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none',
    scenarioId: `scn-a6b-${tag}`,
    turnId: `turn-a6b-${tag}`,
    requestId: `req-a6b-${tag}`,
    dispatchPath: 'edit_graph',
  });
  expect(decision.governing, 'a structural add is proposed first, never auto-applied under live').toBe('held');
  expect(decision.pendingActions?.length).toBe(1);
  return throughTheStore(decision.pendingActions![0]!);
}

describe('(b) an approved edit_graph add is the user’s', () => {
  it('RED: the model’s add (carrying its own ai_inferred) is stripped, held, APPROVED → the node carries user_set, written by CEE', async () => {
    const result = await editGraphTurn('ai_inferred', 'b');
    const pending = holdEditBatch(result.operations!, 'b');
    // The model's literal did not survive to the hold — whatever lands next is CEE's.
    const add = heldOps(pending).find((o) => o.op === 'add_node')!;
    expect(add.path).toBe('fac_risk');
    expect(Object.prototype.hasOwnProperty.call(add.value as object, 'provenance')).toBe(false);

    const outcome = confirm(pending, EDIT_GRAPH, 'b');
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    expect(nodeOf(outcome.mutatedGraph, 'fac_risk').provenance).toBe(USER_SET);
    // NEGATIVE CONTROL, by identity: the nodes the batch only LINKED earn nothing.
    expect(nodeOf(outcome.mutatedGraph, 'opt_a').provenance).toBeUndefined();
    expect(nodeOf(outcome.mutatedGraph, 'goal_g').provenance).toBeUndefined();
  });
});

describe('(d) J2 — a model cannot self-stamp', () => {
  it('a model add carrying provenance user_set that NO user approved (the auto-applied normal seam) lands UNSTAMPED', async () => {
    const result = await editGraphTurn('user_set', 'd1');
    // The candidate the normal seam applies — what `shadow`/`off` persist with no approval.
    const added = nodeOf(result.appliedGraph, 'fac_risk');
    expect(added.label).toBe('Data Quality Risk');
    expect(Object.prototype.hasOwnProperty.call(added, 'provenance'), 'no stamp on an unapproved add').toBe(false);
    // And the operations the gate / hold carry forward hold no self-stamp either.
    const add = result.operations!.find((o) => o.op === 'add_node')!;
    expect(Object.prototype.hasOwnProperty.call(add.value as object, 'provenance')).toBe(false);
  });

  it('POSITIVE CONTROL for the absence above: the normal seam DOES land a value the model sets on the add (the probe sees node fields)', async () => {
    const result = await editGraphTurn('user_set', 'd1c');
    expect(nodeOf(result.appliedGraph, 'fac_risk').kind).toBe('factor');
    expect(nodeOf(result.appliedGraph, 'fac_risk').label).toBe('Data Quality Risk');
  });

  it('an APPROVED add whose held payload carries another provenance literal never lands that literal (the confirm refuses it whole)', async () => {
    const result = await editGraphTurn('ai_inferred', 'd2');
    const pending = holdEditBatch(result.operations!, 'd2');
    // A payload that reached the hold carrying a literal (a row minted before the strip, or tampered).
    const forged = structuredClone(pending);
    const ops = (forged.action as { inline_patch: { operations: Array<{ op: string; value?: Record<string, unknown> }> } }).inline_patch.operations;
    ops.find((o) => o.op === 'add_node')!.value!.provenance = 'from_brief';
    const outcome = confirm(throughTheStore(forged), EDIT_GRAPH, 'd2');
    expect(outcome.status, 'a yes never overrides a forged stamp').toBe('referee_blocked');
  });

  it('RED (unit, the seam’s stamp): CEE’s literal is written LAST — no payload literal, including user_set itself, sits in its place', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'a', value: { id: 'a', kind: 'factor', label: 'A', provenance: 'from_brief' } },
      { op: 'add_node', path: 'b', value: { id: 'b', kind: 'option', label: 'B', provenance: 'ai_inferred' } },
      { op: 'add_node', path: 'c', value: { id: 'c', kind: 'risk', label: 'C' } },
    ];
    const frozen = structuredClone(ops);
    const out = stampUserApprovedAddProvenance(ops);
    expect(out.map((o) => (o.value as { provenance?: unknown }).provenance)).toEqual([USER_SET, USER_SET, USER_SET]);
    expect(ops, 'inputs are never mutated').toEqual(frozen);
  });

  it('RED (unit): only add_node is stamped — an update, an edge add and a removal are returned BY REFERENCE', () => {
    const update: PatchOperation = { op: 'update_node', path: 'f', value: { observed_state: { value: 0.4 } } };
    const edge: PatchOperation = { op: 'add_edge', path: 'a::b', value: { from: 'a', to: 'b' } };
    const removal: PatchOperation = { op: 'remove_node', path: 'z' };
    const out = stampUserApprovedAddProvenance([update, edge, removal]);
    expect(out[0]).toBe(update);
    expect(out[1]).toBe(edge);
    expect(out[2]).toBe(removal);
  });
});

// ---------------------------------------------------------------------------
// (c) a held add executed on approval
// ---------------------------------------------------------------------------
const VALUE_GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    {
      id: 'fac_setup', kind: 'factor', label: 'Setup and Migration Complexity', category: 'observable',
      observed_state: { value: 0.1, unit: 'index', raw_value: 10, cap: 100 },
    },
  ],
  edges: [
    { from: 'fac_setup', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};
const RISK_ADD: PatchOperation = { op: 'add_node', path: 'risk_dq', value: { id: 'risk_dq', kind: 'risk', label: 'Data quality' } };
const RISK_LINK: PatchOperation = {
  op: 'add_edge',
  path: 'risk_dq::g_profit',
  value: { from: 'risk_dq', to: 'g_profit', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
};

function holdValueGraph(operations: PatchOperation[], tag: string): PendingAction {
  const hash = hashOf(VALUE_GRAPH);
  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations,
    currentGraph: VALUE_GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none',
    scenarioId: `scn-a6b-${tag}`,
    turnId: `turn-a6b-${tag}`,
    requestId: `req-a6b-${tag}`,
  });
  expect(decision.governing).toBe('held');
  return throughTheStore(decision.pendingActions![0]!);
}

describe('(c) a held add executed on approval is the user’s', () => {
  it('RED: a held risk add, confirmed → user_set; the existing factor it links to earns nothing', () => {
    const outcome = confirm(holdValueGraph([RISK_ADD, RISK_LINK], 'c'), VALUE_GRAPH, 'c');
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    expect(nodeOf(outcome.mutatedGraph, 'risk_dq').provenance).toBe(USER_SET);
    expect(nodeOf(outcome.mutatedGraph, 'fac_setup').provenance).toBeUndefined();
    // The node stamp is not a VALUE claim: the value stamp's field is untouched on the add.
    expect((nodeOf(outcome.mutatedGraph, 'risk_dq').observed_state as { source?: unknown } | undefined)?.source).toBeUndefined();
  });

  it('RED: a mixed confirmed batch — the value write keeps ITS stamp and the add earns the add stamp, each on its own node', () => {
    const valueOp: PatchOperation = { op: 'update_node', path: 'fac_setup', value: { 'data/value': 0.5 }, old_value: { 'data/value': 0.1 } };
    const outcome = confirm(holdValueGraph([valueOp, RISK_ADD, RISK_LINK], 'c2'), VALUE_GRAPH, 'c2');
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    expect(nodeOf(outcome.mutatedGraph, 'risk_dq').provenance).toBe(USER_SET);
    const fac = nodeOf(outcome.mutatedGraph, 'fac_setup');
    expect(fac.provenance).toBe(USER_SET);
    expect((fac.observed_state as { source?: unknown }).source).toBe('user_override');
  });
});

// ---------------------------------------------------------------------------
// (e) CONTRAST — draft / repair adds are not stamped
// ---------------------------------------------------------------------------
describe('(e) CONTRAST — an add no user approved stays unstamped', () => {
  it('a system / repair writer’s add through the SHARED applier lands with no provenance', () => {
    const applied = applyPatchOperations(structuredClone(VALUE_GRAPH) as unknown as GraphV3T, [RISK_ADD, RISK_LINK]);
    const risk = nodeOf(applied, 'risk_dq');
    expect(risk.label, 'the add landed').toBe('Data quality');
    expect(Object.prototype.hasOwnProperty.call(risk, 'provenance')).toBe(false);
  });

  it('the Agent’s model DRAFT (admission) mints no user_set node — and the probe sees its provenance', () => {
    const d = new URL('../../agent-lane/__tests__/fixtures/', import.meta.url);
    const admitted = admitCandidateModel(
      JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel,
      JSON.parse(readFileSync(new URL('widened.json', d), 'utf8')),
    );
    const provenances = admitted.nodes.map((n) => n.provenance);
    expect(provenances.filter((p) => p === 'from_brief' || p === 'ai_inferred').length, 'positive control').toBeGreaterThan(0);
    expect(provenances.filter((p) => p === USER_SET)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) the analysis hash
// ---------------------------------------------------------------------------
describe('(f) the stamp does not enter the analysis hash', () => {
  const withoutAddedStamps = (persisted: Graph, addedIds: readonly string[]): Graph => ({
    ...structuredClone(persisted),
    nodes: persisted.nodes.map((n) => {
      if (!addedIds.includes(n.id)) return structuredClone(n);
      const { provenance: _p, ...rest } = n;
      return structuredClone(rest) as Node;
    }),
  });

  it('the approved graph hashes exactly as the same graph without the stamps (16-hex and 64-hex); the identity hash DOES move', () => {
    const { persisted } = approvePaulOption(true);
    const addedIds = [PAUL_OPTION_ID, 'fac_launch_campaign_reach'];
    const unstamped = withoutAddedStamps(persisted, addedIds);
    for (const id of addedIds) expect(nodeOf(unstamped, id).provenance).toBeUndefined();
    expect(computeAnalysisAffectingGraphHash(persisted as GraphStateIngress))
      .toBe(computeAnalysisAffectingGraphHash(unstamped as GraphStateIngress));
    expect(computeAnalysisAffectingGraphHashSha256(persisted as GraphStateIngress))
      .toBe(computeAnalysisAffectingGraphHashSha256(unstamped as GraphStateIngress));
    // Reported, not hidden: the identity hash is an EXCLUDE list over persisted fields, so the stamp moves it.
    expect(computeGraphIdentityHash(persisted as GraphStateIngress)?.value)
      .not.toBe(computeGraphIdentityHash(unstamped as GraphStateIngress)?.value);
  });

  it('POSITIVE CONTROL: the same probe DOES see an analysis-affecting change on the same node (its level)', () => {
    const { persisted } = approvePaulOption(false);
    const moved = structuredClone(persisted);
    const option = nodeOf(moved, PAUL_OPTION_ID);
    (option.interventions as Record<string, { value: number }>).feature_development_spend!.value = 0.06;
    expect(computeAnalysisAffectingGraphHash(moved as GraphStateIngress))
      .not.toBe(computeAnalysisAffectingGraphHash(persisted as GraphStateIngress));
  });
});

// ---------------------------------------------------------------------------
// (g) a later value write keeps the stamp and passes the scope guards
// ---------------------------------------------------------------------------
describe('(g) a later value write to a user_set node keeps the stamp and passes the stored-bytes guards', () => {
  it('RED: an option level written on the approved 6526b52c — the writer base is a fixed point, the batch guard passes, the stamp stays', () => {
    const { persisted } = approvePaulOption(false);
    expect(nodeOf(persisted, PAUL_OPTION_ID).provenance).toBe(USER_SET);
    expect(isDeepStrictEqual(projectGraphForPersistence(persisted), persisted), 'writer base fixed point').toBe(true);
    const target = { optionId: PAUL_OPTION_ID, factorId: 'feature_development_spend', modelValue: 0.06 };
    const written = applyOptionInterventionBatch({
      persistedGraph: persisted,
      targets: [target],
      expectedGraphHash: hashOf(persisted),
      scenarioId: 'scn-a6b-g1',
      turnId: 'turn-a6b-g1',
      requestId: 'req-a6b-g1',
      freshness: 'none',
      hasExistingAnalysis: false,
    });
    expect(written.kind, JSON.stringify(written).slice(0, 300)).toBe('candidate');
    if (written.kind !== 'candidate') return;
    expect(optionInterventionBatchPostimageIsScoped(persisted, written.graph, [target])).toBe(true);
    const option = nodeOf(written.graph, PAUL_OPTION_ID);
    expect((option.interventions as Record<string, { value: number }>).feature_development_spend!.value).toBe(0.06);
    expect(option.provenance, 'the level write keeps the stamp').toBe(USER_SET);
  });

  it('RED: a factor value written on the approved NEW factor — the value writer’s scope guard passes, the stamp stays', async () => {
    const { persisted } = approvePaulOption(true);
    const factorId = 'fac_launch_campaign_reach';
    expect(nodeOf(persisted, factorId).provenance).toBe(USER_SET);
    const event = { kind: 'factor_value_edit' as const, target_id: factorId, value: 0.4 };
    const res = await applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: 'turn-a6b-g2', scenario_id: '11111111-1111-4111-8111-111111111111', stage: 'frame', event } as never,
      event: event as never,
      requestId: 'req-a6b-g2',
      persistedGraph: structuredClone(persisted),
      priorFacts: [],
    });
    expect(res.kind, JSON.stringify(res).slice(0, 300)).toBe('mutated');
    if (res.kind !== 'mutated') return;
    const after = projectGraphForPersistence(res.mutatedGraph);
    expect(factorValuesPostimageIsScoped(persisted, after, [factorId])).toBe(true);
    expect((nodeOf(after, factorId).observed_state as { value?: unknown }).value).toBe(0.4);
    expect(nodeOf(after, factorId).provenance, 'the value write keeps the stamp').toBe(USER_SET);
    // And nothing else in the model moved with it.
    expect(nodeOf(after, PAUL_OPTION_ID).provenance).toBe(USER_SET);
  });
});
