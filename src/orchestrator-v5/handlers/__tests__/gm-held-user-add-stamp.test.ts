/**
 * ⭐ SLICE A6b — A NODE THE USER SUPPLIED IS STAMPED `user_set`; AN OLUMI
 * PROPOSAL THE USER ONLY APPROVED IS NOT (Canonical's A6 design, DL #70
 * 5855437928; reworked to DL's CHANGES_REQUIRED on #2131 @ a86820f5, option (a)).
 *
 * THE DEFECT A6b FIXES (code-read at CEE 339ed343). Node `provenance: 'user_set'`
 * is the ONE node spelling for "the user put this here" (`NodeV3.provenance`),
 * and only the canvas `structural_add` wrote it: an option the user named in
 * their own words reached the model through the held/confirm seam with NO node
 * provenance.
 *
 * THE DEFECT THE FIRST HEAD INTRODUCED (DL CR). It stamped EVERY approved add —
 * including Olumi's own proposals. `user_set` is reserved for a node the USER
 * supplied (`admit-model.ts`), and its readers turn it into words:
 * `structure-origin-answer.ts` says "…because you set it yourself, not because I
 * suggested it", and `projectEntity` shows it to the Agent as the user's. So
 * Paul's Agent-minted option `6526b52c` — Olumi's suggestion, approved — would
 * have made Olumi deny its own suggestion; so would MG's A1 switch factor.
 *
 * THE RULE THIS PINS (no new vocabulary, no "approved" marker):
 *   · CEE stamps `user_set` ONLY on a node the hold records as SUPPLIED by the
 *     user (`GM_HELD_USER_STATED_NODES_KEY`) — today, an option whose label the
 *     user's own typed words name (the Agent's `propose_new_option`, carried
 *     in-process; `userStatedOptionIds` here) — at the approval seam
 *     (`executeGmHeldResume`), AFTER the strip and the re-referee.
 *   · An approved OLUMI proposal keeps its provenance: an Agent-minted option,
 *     every `new_factors` node Olumi mints (A1's switch stays `ai_inferred`), the
 *     Agent's add-risk door (#2099, no typed authorship), an `edit_graph` add.
 *   · J2: a model — or a client's chip `parameters` — can never set it.
 *   · Draft / repair / system adds stay unstamped.
 *   · The stamp is outside the analysis hash, and a later value write to a
 *     stamped node keeps it and passes the stored-bytes scope guards.
 *
 * HARNESS: every row mints the hold through the REAL producer (the add-option
 * dispatch, the add-risk door, or `handleEditGraph` + the referee gate),
 * round-trips the pending the way the store does (JSONB key order,
 * `parsePendingAction`), and confirms through the REAL `executeGmHeldResume` —
 * the loop a user's "yes" drives. The words each reader says are read from the
 * REAL readers (`tryStructureOriginAnswer`, `projectEntity`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { dispatchAddOptionTransaction } from '../add-option-dispatch.js';
import { dispatchAddRiskTransaction } from '../add-risk-dispatch.js';
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
import { stampUserStatedAddProvenance } from '../../../orchestrator/canonicalise-value-ops.js';
import { tryStructureOriginAnswer } from '../../../cee/context-integrity/structure-origin-answer.js';
import { projectEntity } from '../../agent-lane/runtime/agent-capabilities.js';
import { GM_HELD_USER_STATED_NODES_KEY } from '../../routing/add-option-transaction.js';
import { runWithUserNamedOptions, userNamedOptionIdsFor } from '../add-option-authorship-context.js';
import type { ConversationContext, PatchOperation } from '../../../orchestrator/types.js';
import type { ChatResult, LLMAdapter } from '../../../adapters/llm/types.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
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

/** A graph read back from a writer, checked at run time (never a double cast). */
function asGraph(value: unknown): Graph {
  const v = value as { nodes?: unknown; edges?: unknown } | null;
  if (v === null || typeof v !== 'object' || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) {
    throw new Error('expected a graph with nodes and edges');
  }
  return value as Graph;
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
    ...(read.switchFactorIds !== undefined ? { switchFactorIds: read.switchFactorIds } : {}),
    // Threaded exactly as turn-executor threads it.
    ...(read.userStatedNodeIds !== undefined ? { userStatedNodeIds: read.userStatedNodeIds } : {}),
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
  return asGraph(projectGraphForPersistence(structuredClone(PAUL_PRE_ADD)));
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

interface ApproveOpts {
  /** A new factor Olumi mints for the option in the same change (`new_factors`). */
  readonly withNewFactor: boolean;
  /**
   * The typed authorship signal: the option ids whose label the USER'S OWN typed words named — what route-v2 passes
   * from the Agent's in-process context (`userNamedOptionIdsFor`). Absent = the Agent proposed it (Paul's 6526b52c).
   */
  readonly userStatedOptionIds?: readonly string[];
  /** Extra members a CLIENT puts in the chip's wire `parameters` (J2 at the wire). */
  readonly wireExtras?: Record<string, unknown>;
}

/** Chip → held → store round-trip → the user's "yes" → the graph the commit writes. */
function approvePaulOption(opts: ApproveOpts) {
  const stored = paulStored();
  const held = dispatchAddOptionTransaction({
    parameters: { ...paulChipParameters(opts.withNewFactor), ...(opts.wireExtras ?? {}) },
    currentGraph: stored,
    currentGraphHash: hashOf(stored),
    freshness: 'none',
    mode: 'live',
    scenarioId: 'scn-a6b-paul',
    turnId: 'turn-a6b-paul',
    requestId: 'req-a6b-paul',
    stage: 'frame',
    ...(opts.userStatedOptionIds !== undefined ? { userStatedOptionIds: opts.userStatedOptionIds } : {}),
  });
  expect(held.kind, JSON.stringify(held).slice(0, 400)).toBe('held');
  if (held.kind !== 'held') throw new Error('the add-option chip must hold');
  expect(held.pendingActions).toHaveLength(1);
  const pending = throughTheStore(held.pendingActions[0]!);
  const outcome = confirm(pending, stored, 'paul');
  expect(outcome.status, JSON.stringify(outcome).slice(0, 400)).toBe('executed');
  if (outcome.status !== 'executed') throw new Error('the approved add-option must execute');
  // The commit chokepoint projects to the persisted form (`commitDirectAnswer`).
  const persisted = asGraph(projectGraphForPersistence(outcome.mutatedGraph));
  return { stored, pending, outcome, persisted };
}

/** The hold's CEE-written authorship member, as the next turn reads it back. */
function statedOnHold(pending: PendingAction): unknown {
  const patch = 'inline_patch' in pending.action ? pending.action.inline_patch : undefined;
  return (patch as Record<string, unknown> | null | undefined)?.[GM_HELD_USER_STATED_NODES_KEY];
}

const ORIGIN_Q = (label: string) => `Why is "${label}" in my model?`;
/** What the Agent is shown for a node (`get_canonical_state` / the given state use this one projection). */
const agentView = (node: Node) => projectEntity(node as Parameters<typeof projectEntity>[0]);
const USER_AUTHORSHIP_SENTENCE = /you set it yourself, not because I suggested it/;

const NEW_FACTOR_ID = 'fac_launch_campaign_reach';

// ---------------------------------------------------------------------------
// (a) Paul's option: Olumi's proposal vs the user's own words
// ---------------------------------------------------------------------------
describe('(a) an approved add-option: the user’s only when the user supplied it', () => {
  it('CONTROL (passes at base): the fixture reproduces the served defect’s precondition — the pre-add model is a persisted fixed point and has no 6526b52c', () => {
    const stored = paulStored();
    expect(isDeepStrictEqual(projectGraphForPersistence(stored), stored), 'the stored form projects to itself').toBe(true);
    expect(stored.nodes.some((n) => n.id === PAUL_OPTION_ID)).toBe(false);
  });

  it('⭐ RED (DL CR, required): Paul’s 6526b52c — the Agent PROPOSED it, the user APPROVED it → it keeps Olumi’s provenance; "why is it here?" never says "not because I suggested it"; the Agent’s view never shows it as the user’s', () => {
    const { persisted, pending, stored } = approvePaulOption({ withNewFactor: false });
    expect(statedOnHold(pending), 'no typed signal → nothing recorded as the user’s').toBeUndefined();
    const option = nodeOf(persisted, PAUL_OPTION_ID);
    expect(option.kind).toBe('option');
    expect(option.label).toBe(PAUL_OPTION_LABEL);
    // The served levels landed (the fixture is the served shape, not a stand-in).
    expect((option.interventions as Record<string, { raw_value?: number; value?: number }>).feature_development_spend)
      .toEqual(expect.objectContaining({ value: 0.05, raw_value: 5000 }));
    // The provenance it was proposed with: none (the held add carries none, and the approval adds none).
    expect(Object.prototype.hasOwnProperty.call(option, 'provenance'), `provenance ${String(option.provenance)}`).toBe(false);
    // The words each reader says.
    const answer = tryStructureOriginAnswer(ORIGIN_Q(PAUL_OPTION_LABEL), persisted);
    expect(answer ?? '', String(answer)).not.toMatch(/not because I suggested it/);
    expect(answer ?? '', String(answer)).not.toMatch(/you set it yourself/);
    expect(agentView(option)['provenance'], 'the Agent’s state view').not.toBe(USER_SET);
    // POSITIVE CONTROL, same graph, same question: the probe DOES resolve 6526b52c — stamped, the reader says the
    // user-authorship sentence. So the absence above is the provenance, not a probe that sees nothing.
    const stamped = structuredClone(persisted);
    nodeOf(stamped, PAUL_OPTION_ID).provenance = USER_SET;
    expect(tryStructureOriginAnswer(ORIGIN_Q(PAUL_OPTION_LABEL), stamped)).toMatch(USER_AUTHORSHIP_SENTENCE);
    expect(agentView(nodeOf(stamped, PAUL_OPTION_ID))['provenance']).toBe(USER_SET);
    // NEGATIVE CONTROL, by identity: no node the user did NOT add moved its provenance.
    for (const before of stored.nodes) {
      expect(nodeOf(persisted, before.id).provenance, `pre-existing ${before.id}`).toBe(before.provenance);
    }
  });

  it('⭐ RED (DL CR): the same Agent proposal WITH a new factor Olumi minted → neither the option nor the factor is user_set', () => {
    const { persisted, pending, stored } = approvePaulOption({ withNewFactor: true });
    const added = persisted.nodes.filter((n) => !stored.nodes.some((b) => b.id === n.id));
    expect(added.map((n) => n.id).sort()).toEqual([PAUL_OPTION_ID, NEW_FACTOR_ID].sort());
    expect(statedOnHold(pending)).toBeUndefined();
    for (const node of added) {
      expect(node.provenance, `${String(node.kind)} ${node.id}`).not.toBe(USER_SET);
    }
  });

  it('RED: the user NAMED the option in their own typed words → the hold records it by id; approved → user_set, and the answer says they set it', () => {
    const { persisted, pending, stored } = approvePaulOption({ withNewFactor: false, userStatedOptionIds: [PAUL_OPTION_ID] });
    expect(statedOnHold(pending), 'recorded by identity').toEqual([PAUL_OPTION_ID]);
    const option = nodeOf(persisted, PAUL_OPTION_ID);
    expect(option.provenance, 'the option the user supplied is theirs').toBe(USER_SET);
    expect(tryStructureOriginAnswer(ORIGIN_Q(PAUL_OPTION_LABEL), persisted)).toMatch(USER_AUTHORSHIP_SENTENCE);
    expect(agentView(option)['provenance']).toBe(USER_SET);
    for (const before of stored.nodes) {
      expect(nodeOf(persisted, before.id).provenance, `pre-existing ${before.id}`).toBe(before.provenance);
    }
  });

  it('RED (A1 class): the user named the option, Olumi minted its new factor → the option is user_set, the factor is NOT — even when the signal names the factor’s id', () => {
    const { persisted, pending } = approvePaulOption({
      withNewFactor: true,
      // A signal that (wrongly) also names the factor: only an OPTION the batch adds is ever recorded.
      userStatedOptionIds: [PAUL_OPTION_ID, NEW_FACTOR_ID],
    });
    const newFactorIds = heldOps(pending)
      .filter((o) => o.op === 'add_node' && (o.value as { kind?: unknown }).kind === 'factor')
      .map((o) => o.path);
    expect(newFactorIds, 'the held batch adds the new factor').toEqual([NEW_FACTOR_ID]);
    expect(statedOnHold(pending)).toEqual([PAUL_OPTION_ID]);
    expect(nodeOf(persisted, PAUL_OPTION_ID).provenance).toBe(USER_SET);
    expect(nodeOf(persisted, NEW_FACTOR_ID).label).toBe('Launch campaign reach');
    expect(nodeOf(persisted, NEW_FACTOR_ID).provenance, 'Olumi minted the factor').not.toBe(USER_SET);
    expect(tryStructureOriginAnswer(ORIGIN_Q('Launch campaign reach'), persisted) ?? '').not.toMatch(/you set it yourself/);
  });

  it('J2 at the WIRE: chip parameters that CLAIM the user named the option are never read — nothing recorded, never user_set', () => {
    const { persisted, pending } = approvePaulOption({
      withNewFactor: true,
      wireExtras: {
        [GM_HELD_USER_STATED_NODES_KEY]: [PAUL_OPTION_ID, NEW_FACTOR_ID],
        userStatedOptionIds: [PAUL_OPTION_ID],
        user_stated: true,
        provenance: USER_SET,
      },
    });
    expect(statedOnHold(pending)).toBeUndefined();
    expect(nodeOf(persisted, PAUL_OPTION_ID).provenance).not.toBe(USER_SET);
    expect(nodeOf(persisted, NEW_FACTOR_ID).provenance).not.toBe(USER_SET);
  });

  it('J2 at the hold: the stamp is written at APPROVAL, never carried in the held payload', () => {
    const { pending } = approvePaulOption({ withNewFactor: true, userStatedOptionIds: [PAUL_OPTION_ID] });
    const adds = heldOps(pending).filter((o) => o.op === 'add_node');
    expect(adds.length).toBe(2);
    for (const op of adds) {
      expect(Object.prototype.hasOwnProperty.call(op.value as object, 'provenance'), `held ${op.path}`).toBe(false);
    }
  });

  it('a malformed authorship member on a stored hold is read as NO signal: the batch still executes, and nothing is stamped', () => {
    const { pending, stored } = approvePaulOption({ withNewFactor: false, userStatedOptionIds: [PAUL_OPTION_ID] });
    for (const bad of [PAUL_OPTION_ID, [], [''], [7], { 0: PAUL_OPTION_ID }]) {
      const tampered = structuredClone(pending);
      const patch = 'inline_patch' in tampered.action ? tampered.action.inline_patch : undefined;
      if (patch === null || patch === undefined) throw new Error('the held pending must carry its inline_patch');
      (patch as Record<string, unknown>)[GM_HELD_USER_STATED_NODES_KEY] = bad;
      const read = readGmHeldResume(throughTheStore(tampered));
      expect(read.kind, JSON.stringify(bad)).toBe('ok');
      if (read.kind !== 'ok') continue;
      expect(read.userStatedNodeIds, JSON.stringify(bad)).toBeUndefined();
      const outcome = confirm(throughTheStore(tampered), stored, 'malformed');
      expect(outcome.status).toBe('executed');
      if (outcome.status !== 'executed') continue;
      expect(nodeOf(outcome.mutatedGraph, PAUL_OPTION_ID).provenance, JSON.stringify(bad)).not.toBe(USER_SET);
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
  const notCalled = (name: string) => () => Promise.reject(new Error(`${name} is not called by the edit lane`));
  const reply: ChatResult = {
    content: JSON.stringify(responseJson),
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'test-model',
    latencyMs: 1,
    stopReason: 'end_turn',
  };
  return {
    name: 'fixtures',
    model: 'test-model',
    draftGraph: notCalled('draftGraph'),
    suggestOptions: notCalled('suggestOptions'),
    clarifyBrief: notCalled('clarifyBrief'),
    critiqueGraph: notCalled('critiqueGraph'),
    explainDiff: notCalled('explainDiff'),
    chat: vi.fn(async () => reply),
  };
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
  const ctx: ConversationContext = {
    graph: GraphV3.parse(structuredClone(EDIT_GRAPH)),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: `scn-a6b-${tag}`,
  };
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

describe('(b) an approved edit_graph add is NOT the user’s — the model authored it, and the path has no typed authorship signal', () => {
  it('RED (DL CR): the model’s add (carrying its own ai_inferred) is stripped, held, APPROVED → never user_set; the hold records no authorship', async () => {
    const result = await editGraphTurn('ai_inferred', 'b');
    const pending = holdEditBatch(result.operations!, 'b');
    // The model's literal did not survive to the hold — whatever lands next is CEE's.
    const add = heldOps(pending).find((o) => o.op === 'add_node')!;
    expect(add.path).toBe('fac_risk');
    expect(Object.prototype.hasOwnProperty.call(add.value as object, 'provenance')).toBe(false);

    expect(statedOnHold(pending)).toBeUndefined();

    const outcome = confirm(pending, EDIT_GRAPH, 'b');
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const added = nodeOf(outcome.mutatedGraph, 'fac_risk');
    expect(added.label, 'the add landed').toBe('Data Quality Risk');
    expect(added.provenance, 'an approved model add is not the user’s').not.toBe(USER_SET);
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
    const patch = 'inline_patch' in forged.action ? forged.action.inline_patch : undefined;
    const ops: unknown = patch?.['operations'];
    if (!Array.isArray(ops)) throw new Error('the held pending must embed its operations');
    const add: unknown = ops.find((o: { op?: unknown }) => o.op === 'add_node');
    if (add === null || typeof add !== 'object') throw new Error('the held batch must carry the add');
    (add as { value: Record<string, unknown> }).value.provenance = 'from_brief';
    const outcome = confirm(throughTheStore(forged), EDIT_GRAPH, 'd2');
    expect(outcome.status, 'a yes never overrides a forged stamp').toBe('referee_blocked');
  });

  it('RED (unit, the seam’s stamp): ONLY the adds the hold names are stamped, and CEE’s literal is written LAST on them — an unnamed add keeps its own provenance, by reference', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'a', value: { id: 'a', kind: 'option', label: 'A', provenance: 'from_brief' } },
      { op: 'add_node', path: 'b', value: { id: 'b', kind: 'option', label: 'B', provenance: 'ai_inferred' } },
      { op: 'add_node', path: 'c', value: { id: 'c', kind: 'factor', label: 'C' } },
    ];
    const frozen = structuredClone(ops);
    const out = stampUserStatedAddProvenance(ops, ['a']);
    expect(out.map((o) => (o.value as { provenance?: unknown }).provenance)).toEqual([USER_SET, 'ai_inferred', undefined]);
    expect(out[1], 'an unnamed add is returned by reference').toBe(ops[1]);
    expect(out[2]).toBe(ops[2]);
    expect(ops, 'inputs are never mutated').toEqual(frozen);
  });

  it('RED (unit): no named node → nothing is stamped; an update, an edge add and a removal are returned BY REFERENCE even when named', () => {
    const add: PatchOperation = { op: 'add_node', path: 'n', value: { id: 'n', kind: 'option', label: 'N' } };
    expect(stampUserStatedAddProvenance([add], [])[0]).toBe(add);
    const update: PatchOperation = { op: 'update_node', path: 'f', value: { observed_state: { value: 0.4 } } };
    const edge: PatchOperation = { op: 'add_edge', path: 'a::b', value: { from: 'a', to: 'b' } };
    const removal: PatchOperation = { op: 'remove_node', path: 'z' };
    const out = stampUserStatedAddProvenance([update, edge, removal], ['f', 'a::b', 'z']);
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

describe('(c) a held add with no typed authorship signal, approved, keeps its own provenance', () => {
  it('RED (DL CR): a held risk add, confirmed → NOT user_set; the existing factor it links to earns nothing', () => {
    const pending = holdValueGraph([RISK_ADD, RISK_LINK], 'c');
    expect(statedOnHold(pending)).toBeUndefined();
    const outcome = confirm(pending, VALUE_GRAPH, 'c');
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    expect(nodeOf(outcome.mutatedGraph, 'risk_dq').label, 'the add landed').toBe('Data quality');
    expect(nodeOf(outcome.mutatedGraph, 'risk_dq').provenance).not.toBe(USER_SET);
    expect(nodeOf(outcome.mutatedGraph, 'fac_setup').provenance).toBeUndefined();
    expect((nodeOf(outcome.mutatedGraph, 'risk_dq').observed_state as { source?: unknown } | undefined)?.source).toBeUndefined();
  });

  it('CONTRAST: a mixed confirmed batch — the user’s VALUE write keeps its own (pre-A6b) stamp; the unsigned add earns none', () => {
    const valueOp: PatchOperation = { op: 'update_node', path: 'fac_setup', value: { 'data/value': 0.5 }, old_value: { 'data/value': 0.1 } };
    const outcome = confirm(holdValueGraph([valueOp, RISK_ADD, RISK_LINK], 'c2'), VALUE_GRAPH, 'c2');
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    expect(nodeOf(outcome.mutatedGraph, 'risk_dq').provenance).not.toBe(USER_SET);
    const fac = nodeOf(outcome.mutatedGraph, 'fac_setup');
    expect(fac.provenance, 'the value write’s own stamp (stampUserEditProvenance)').toBe(USER_SET);
    expect((fac.observed_state as { source?: unknown }).source).toBe('user_override');
  });

  it('RED (DL CR; #2099, the Agent’s held add-risk door): the door carries NO typed authorship, so the risk it holds, approved, is NOT user_set; its links stay Olumi’s placeholders', () => {
    const stored = structuredClone(VALUE_GRAPH);
    const held = dispatchAddRiskTransaction({
      params: {
        risk: { label: 'Competitive response' },
        links: [
          { from_id: 'fac_setup', effect_direction: 'positive' },
          { to_id: 'g_profit', effect_direction: 'negative' },
        ],
      },
      currentGraph: stored,
      currentGraphHash: hashOf(stored),
      freshness: 'none',
      mode: 'live',
      scenarioId: 'scn-a6b-c-risk',
      turnId: 'turn-a6b-c-risk',
      requestId: 'req-a6b-c-risk',
      stage: 'frame',
    });
    expect(held.kind, JSON.stringify(held).slice(0, 400)).toBe('held');
    if (held.kind !== 'held') throw new Error('the add-risk door must hold');
    expect(held.pendingActions).toHaveLength(1);
    const pending = throughTheStore(held.pendingActions[0]!);
    // J2 at the hold: the door's add carries no provenance — whatever lands next is CEE's, at approval.
    const add = heldOps(pending).find((o) => o.op === 'add_node')!;
    expect(add.path).toBe(held.riskId);
    expect(Object.prototype.hasOwnProperty.call(add.value as object, 'provenance'), 'held risk add').toBe(false);

    expect(statedOnHold(pending), 'the door records no authorship').toBeUndefined();

    const outcome = confirm(pending, stored, 'c-risk');
    expect(outcome.status, JSON.stringify(outcome).slice(0, 400)).toBe('executed');
    if (outcome.status !== 'executed') return;
    const after = asGraph(outcome.mutatedGraph);
    const risk = nodeOf(after, held.riskId);
    expect(risk.kind).toBe('risk');
    expect(risk.label).toBe('Competitive response');
    expect(risk.provenance, 'the approved risk keeps the provenance it was proposed with').not.toBe(USER_SET);
    expect(tryStructureOriginAnswer(ORIGIN_Q('Competitive response'), after) ?? '').not.toMatch(/you set it yourself/);
    expect(agentView(risk)['provenance']).not.toBe(USER_SET);
    // NEGATIVE CONTROL, by identity: the factor that drives it and the goal it threatens earn nothing.
    expect(nodeOf(after, 'fac_setup').provenance).toBeUndefined();
    expect(nodeOf(after, 'g_profit').provenance).toBeUndefined();
    // The NODE stamp is not an edge claim: the door's links stay Olumi's placeholder hypotheses.
    const links = after.edges.filter((e) => e.from === held.riskId || e.to === held.riskId);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect((link.provenance as { source?: unknown }).source, JSON.stringify(link)).toBe('cee_hypothesis');
    }
  });
});

// ---------------------------------------------------------------------------
// (e) CONTRAST — draft / repair adds are not stamped
// ---------------------------------------------------------------------------
describe('(e) CONTRAST — an add no user approved stays unstamped', () => {
  it('a system / repair writer’s add through the SHARED applier lands with no provenance', () => {
    const applied = applyPatchOperations(GraphV3.parse(structuredClone(VALUE_GRAPH)), [RISK_ADD, RISK_LINK]);
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

  it('the approved graph hashes exactly as the same graph without the stamp (16-hex and 64-hex); the identity hash DOES move', () => {
    const { persisted } = approvePaulOption({ withNewFactor: true, userStatedOptionIds: [PAUL_OPTION_ID] });
    expect(nodeOf(persisted, PAUL_OPTION_ID).provenance, 'the stamp under test is present').toBe(USER_SET);
    const addedIds = [PAUL_OPTION_ID];
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
    const { persisted } = approvePaulOption({ withNewFactor: false, userStatedOptionIds: [PAUL_OPTION_ID] });
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
describe('(g) a later value write keeps the stamp and passes the stored-bytes guards', () => {
  it('RED: an option level written on the user-named 6526b52c — the writer base is a fixed point, the batch guard passes, the stamp stays', () => {
    const { persisted } = approvePaulOption({ withNewFactor: false, userStatedOptionIds: [PAUL_OPTION_ID] });
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

  it('RED: a factor value the USER writes on the NEW factor Olumi minted — the value writer’s scope guard passes; that direct edit (not the approval) is what makes the factor the user’s; the option’s stamp stays', async () => {
    const { persisted } = approvePaulOption({ withNewFactor: true, userStatedOptionIds: [PAUL_OPTION_ID] });
    const factorId = NEW_FACTOR_ID;
    const factorProvenanceBefore = nodeOf(persisted, factorId).provenance;
    expect(factorProvenanceBefore, 'Olumi minted the factor').not.toBe(USER_SET);
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
    // A direct user edit IS the user's (`admit-model.ts`: "user_set is reserved for a direct user edit"): the value
    // writer marks it so. Approving the factor did not (asserted before the write, above).
    expect(nodeOf(after, factorId).provenance, 'the user’s own value write').toBe(USER_SET);
    // And the user-named option's stamp did not move with it.
    expect(nodeOf(after, PAUL_OPTION_ID).provenance).toBe(USER_SET);
  });
});

// ---------------------------------------------------------------------------
// (h) the in-process carrier (`add-option-authorship-context.ts`)
// ---------------------------------------------------------------------------
describe('(h) the in-process carrier names the user’s options only for its own scenario and turn', () => {
  it('outside the context, or for another scenario or turn, no option is the user’s', async () => {
    expect(userNamedOptionIdsFor('scn-h', 'turn-h')).toEqual([]);
    await runWithUserNamedOptions({ scenarioId: 'scn-h', turnId: 'turn-h', optionIds: ['opt-h'] }, async () => {
      await Promise.resolve();
      expect(userNamedOptionIdsFor('scn-h', 'turn-h'), 'same scenario, same turn').toEqual(['opt-h']);
      expect(userNamedOptionIdsFor('scn-other', 'turn-h')).toEqual([]);
      expect(userNamedOptionIdsFor('scn-h', 'turn-other')).toEqual([]);
    });
    expect(userNamedOptionIdsFor('scn-h', 'turn-h'), 'after the dispatch returns').toEqual([]);
  });
});
