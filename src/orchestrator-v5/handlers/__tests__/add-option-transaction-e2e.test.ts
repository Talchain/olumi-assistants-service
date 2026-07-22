/**
 * Lane C3 — add-option compound transaction, END-TO-END over the REAL
 * hold/confirm machinery, plus the dispatch handler.
 *
 * The core pin (debit a — the interventions=null poison gap): a typed
 * add_option spec, refereed to a held proposal and then CONFIRMED through the
 * real `executeGmHeldResume`, lands the option node AND its effect values
 * ATOMICALLY in one apply. This is the whole point of the transaction — add and
 * configure fold into ONE proposal, so there is no unconfigured window.
 *
 * MUTATION-CHECK (revert → RED): drop `interventions: interventionBundle` from
 * the add_node op in `buildAddOptionTransaction` and the "interventions landed"
 * assertion here fails — the option would confirm-apply with no values (exactly
 * today's live defect). The atomicity guard (`batchFullyLanded`) is exercised
 * live: the batch executes (`status:'executed'`), not `incomplete_apply`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { buildAddOptionTransaction } from '../../routing/add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../add-option-dispatch.js';
import {
  evaluateEditGraphMutations,
  GM_HELD_HANDLER_ID,
} from '../edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import * as telemetry from '../../../utils/telemetry.js';

const GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'dec_choice', kind: 'decision', label: 'Which platform' },
    { id: 'fac_effort', kind: 'factor', label: 'Migration effort', observed_state: { value: 0.4 } },
    { id: 'fac_uplift', kind: 'factor', label: 'Capability uplift', observed_state: { value: 0.3 } },
    {
      id: 'opt_stay',
      kind: 'option',
      label: 'Stay',
      interventions: {
        fac_effort: {
          value: 0.1,
          source: 'user_specified',
          target_match: { node_id: 'fac_effort', match_type: 'exact_id', confidence: 'high' },
        },
      },
    },
  ],
  edges: [
    { from: 'fac_effort', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'dec_choice', to: 'opt_stay', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_stay', to: 'fac_effort', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const PARAMS = {
  parent_decision_id: 'dec_choice',
  label: 'Outsource to a BPO vendor',
  interventions: [
    { factor_id: 'fac_effort', value: 0.55 },
    { factor_id: 'fac_uplift', value: 0.7 },
  ],
};

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

describe('add-option transaction — end-to-end over the real hold/confirm machinery', () => {
  it('holds STRUCTURAL_APPLY_HELD, embeds the ops, and CONFIRM applies option + interventions ATOMICALLY', () => {
    const built = buildAddOptionTransaction(PARAMS, {
      nodes: GRAPH.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
      edges: GRAPH.edges.map((e) => ({ from: e.from, to: e.to })),
    });
    expect(built.matched).toBe(true);
    if (!built.matched) return;

    const hash = hashOf(GRAPH);
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: built.proposal.operations,
      currentGraph: GRAPH,
      currentGraphHash: hash,
      baseGraphHash: hash,
      freshness: 'none',
      scenarioId: 'scn-c3',
      turnId: 'turn-c3',
      requestId: 'req-c3',
      dispatchPath: 'edit_graph',
    });
    // A structural batch against a fresh/none frame is HELD (not auto-applied).
    expect(decision.governing).toBe('held');
    const pending = decision.pendingActions![0]!;
    const patch = (pending.action as { inline_patch: Record<string, unknown> }).inline_patch;
    expect(patch.handler_id).toBe(GM_HELD_HANDLER_ID);

    // The confirm resume reads the embedded ops and re-referees + applies them.
    const read = readGmHeldResume(pending);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;

    const outcome = executeGmHeldResume({
      operations: read.operations,
      currentGraph: GRAPH,
      currentGraphHash: hash,
      freshness: 'none',
      hasExistingAnalysis: false,
      scenarioId: 'scn-c3',
      turnId: 'turn-c3',
      requestId: 'req-c3',
    });
    // Atomicity guard passed — the WHOLE batch landed, not incomplete_apply.
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;

    const opt = outcome.appliedGraph.nodes.find((n) => n.id === built.proposal.optionId) as
      | { kind: string; interventions?: Record<string, { value?: number }> }
      | undefined;
    expect(opt).toBeDefined();
    expect(opt!.kind).toBe('option');
    // THE PIN: the effect values landed with the option in ONE atomic confirm —
    // no interventions=null window. Reverting the intervention-carrying in the
    // builder makes these go RED.
    expect(opt!.interventions).toBeDefined();
    expect(opt!.interventions!.fac_effort!.value).toBe(0.55);
    expect(opt!.interventions!.fac_uplift!.value).toBe(0.7);

    // Both structural edges landed too (parent + factor links).
    const edgeKeys = outcome.appliedGraph.edges.map((e) => `${e.from}->${e.to}`);
    expect(edgeKeys).toContain(`dec_choice->${built.proposal.optionId}`);
    expect(edgeKeys).toContain(`${built.proposal.optionId}->fac_effort`);
    expect(edgeKeys).toContain(`${built.proposal.optionId}->fac_uplift`);

    // Positive control that the guard can DISCRIMINATE: the pre-existing option
    // is untouched and its own interventions survive (so "landed" is not a
    // vacuous pass over an empty graph).
    const stay = outcome.appliedGraph.nodes.find((n) => n.id === 'opt_stay') as
      | { interventions?: Record<string, { value?: number }> }
      | undefined;
    expect(stay!.interventions!.fac_effort!.value).toBe(0.1);
  });
});

describe('dispatchAddOptionTransaction — held + skip classification', () => {
  const base = {
    parameters: PARAMS,
    currentGraph: GRAPH,
    currentGraphHash: hashOf(GRAPH),
    freshness: 'none' as const,
    mode: 'live' as const,
    scenarioId: 'scn-c3',
    turnId: 'turn-c3',
    requestId: 'req-c3',
    stage: 'decide' as const,
  };

  it('a valid configured spec → held, with a held_proposal block, a confirm chip, and a CONFIGURED disclosure', () => {
    const out = dispatchAddOptionTransaction(base);
    expect(out.kind).toBe('held');
    if (out.kind !== 'held') return;
    expect(out.configured).toBe(true);
    expect(out.pendingActions.length).toBe(1);
    expect(out.response.blocks.some((b) => b.type === 'held_proposal')).toBe(true);
    expect(out.response.suggested_actions.length).toBeGreaterThan(0);
    // proposal-time completeness disclosure names it as ready to analyse.
    expect(out.response.assistant_text).toContain('configured');
  });

  it('an UNCONFIGURED spec (no values) → held with the unconfigured disclosure', () => {
    const out = dispatchAddOptionTransaction({
      ...base,
      parameters: { parent_decision_id: 'dec_choice', label: 'Bare option', interventions: [] },
    });
    expect(out.kind).toBe('held');
    if (out.kind !== 'held') return;
    expect(out.configured).toBe(false);
    expect(out.response.assistant_text).toContain('effect values');
  });

  it.each([
    ['off', { mode: 'off' as const }, 'gm_not_live'],
    ['shadow', { mode: 'shadow' as const }, 'gm_not_live'],
    ['no hash', { currentGraphHash: null }, 'no_graph_hash'],
    ['unreadable graph', { currentGraph: { not: 'a graph' } }, 'unreadable_graph'],
  ])('%s → classified skip (falls through to the edit path)', (_label, override, reason) => {
    const out = dispatchAddOptionTransaction({ ...base, ...override });
    expect(out).toMatchObject({ kind: 'skip', reason });
  });

  it('propagates the pure builder skip reason (e.g. a non-decision parent)', () => {
    const out = dispatchAddOptionTransaction({
      ...base,
      parameters: { ...PARAMS, parent_decision_id: 'g_profit' },
    });
    expect(out).toMatchObject({ kind: 'skip', reason: 'parent_not_decision' });
  });

  it('a stale frame does NOT hold a structural add (skips → edit path owns it)', () => {
    const out = dispatchAddOptionTransaction({ ...base, freshness: 'stale' });
    expect(out).toMatchObject({ kind: 'skip', reason: 'not_held' });
  });
});
