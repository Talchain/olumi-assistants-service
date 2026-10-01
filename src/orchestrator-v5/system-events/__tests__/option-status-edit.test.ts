/**
 * ⭐ `option_status_edit` (MG F1 T6; spec §3 O1/O2; F5 I1.3) — ONE option out of the comparison, or back in, through ONE
 * writer, verified in the bytes it produces. Paul, 1 Oct: "I can't remove it with the available tools" (the baseline);
 * R3's F5 D1 replay on `29a37d18` hit the same wall ("I can't exclude it with the available controls").
 *
 * Bound by IDENTITY (trap 19): the fixture holds two options; every row addresses one by id and asserts the OTHER is
 * untouched, so a writer that moved the wrong option, or both, is RED.
 */
import { describe, it, expect } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyOptionStatusEdit, isUnadoptedOlumiSuggestion, optionStatusHolds, PARTICIPATION_FOR_STATUS, type OptionStatusEditResult } from '../option-status-edit.js';
import { userExcludedOptions } from '../../tools/handlers/user-option-status-filter.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../../graph-management/reason-codes.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';

function persistedGraph(extra: Record<string, Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schema_version: '3.0',
    goal_node_id: 'goal_revenue',
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Unit price', category: 'controllable', observed_state: { value: 0.4, raw_value: 40000, cap: 100000 } },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: { value: 0.5, raw_value: 50000 } }, ...extra.opt_launch },
      { id: 'opt_carry_on', kind: 'option', label: 'Carry on as now', is_baseline: true, interventions: {}, ...extra.opt_carry_on },
    ],
    edges: [
      { from: 'opt_launch', to: 'fac_price', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_price', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
    options: [
      { id: 'opt_launch', label: 'Launch now', status: 'ready', interventions: { fac_price: { value: 0.5, raw_value: 50000 } } },
      { id: 'opt_carry_on', label: 'Carry on as now', status: 'ready', interventions: {} },
    ],
    meta: { roots: ['opt_launch', 'opt_carry_on'], leaves: ['goal_revenue'] },
  };
}
const baseHashOf = (g: unknown): string => {
  const h = computeAnalysisAffectingGraphHash(g as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);
  if (h === null) throw new Error('fixture unhashable');
  return h;
};
function run(ev: Record<string, unknown>, graph: Record<string, unknown> = persistedGraph()): OptionStatusEditResult {
  const event = { kind: 'option_status_edit', option_node_id: 'opt_carry_on', expected_status: 'feasible', status: 'removed', base_graph_hash: baseHashOf(graph), ...ev };
  const payload = { kind: 'system_event', turn_id: TURN_ID, scenario_id: SCENARIO_ID, stage: 'frame', event } as unknown as SystemEventTurnPayload;
  return applyOptionStatusEdit({ payload, event: event as never, requestId: 'req-1', persistedGraph: graph });
}
const nodeOf = (g: unknown, id: string) => ((g as { nodes: Record<string, unknown>[] }).nodes).find((n) => n.id === id)!;

describe('option_status_edit — the writer (F1 T6)', () => {
  it('precondition: the wire event parses at the payload root (expected_status required)', () => {
    const event = { kind: 'option_status_edit', option_node_id: 'opt_carry_on', expected_status: 'feasible', status: 'removed', base_graph_hash: 'h' };
    expect(OrchestratorTurnPayloadSchema.safeParse({ kind: 'system_event', turn_id: TURN_ID, scenario_id: SCENARIO_ID, stage: 'frame', event }).success).toBe(true);
  });

  it.each(['removed', 'infeasible'] as const)('RED: the BASELINE (spec O2) is %s — status + retained_excluded, read back; the other option untouched', (status) => {
    const r = run({ status });
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(optionStatusHolds(r.mutatedGraph, 'opt_carry_on', status)).toBe(true);
    expect(nodeOf(r.mutatedGraph, 'opt_carry_on')).toMatchObject({ option_status: status, analysis_participation: 'retained_excluded', label: 'Carry on as now' });
    const other = nodeOf(r.mutatedGraph, 'opt_launch');
    expect(other.option_status).toBeUndefined();
    expect(other.analysis_participation).toBeUndefined();
    expect(r.response.assistant_text).toMatch(/Carry on as now/);
    expect(r.handlerFacts[0]).toMatchObject({ fact_type: 'edit_graph', result: { rerun_recommended: true } });
  });

  // ⛔ CODEX overflow #2467 5935234950 P1-2 (persisted-model corruption): the writer applied to the strict mirror's parse
  // and wrote it back, so every node/edge lost what the mirror does not declare. The stored graph is the authority.
  it('RED (CODEX P1-2): a one-option edit leaves EVERY other stored byte as it was — the canvas position/data of other nodes, edge extras, top-level keys', () => {
    const g = persistedGraph({
      opt_launch: { position: { x: 120, y: 40 }, data: { colour: 'teal', pinned: true } },
      opt_carry_on: { position: { x: 320, y: 40 }, data: { note: 'kept' } },
    });
    const nodes = g.nodes as Record<string, unknown>[];
    nodes.find((n) => n.id === 'fac_price')!.position = { x: 10, y: 200 };
    nodes.find((n) => n.id === 'goal_revenue')!.data = { pinned: true };
    (g.edges as Record<string, unknown>[])[0]!.ui = { bend: 0.3 };
    (g as Record<string, unknown>).layout_version = 7;
    const before = structuredClone(g);
    const r = run({ status: 'removed' }, g);
    expect(r.kind, JSON.stringify(r).slice(0, 300)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(g).toEqual(before); // the base handed in is untouched
    const after = structuredClone(r.mutatedGraph) as { nodes: Record<string, unknown>[] };
    const target = after.nodes.find((n) => n.id === 'opt_carry_on')!;
    expect(target).toMatchObject({ option_status: 'removed', analysis_participation: 'retained_excluded', position: { x: 320, y: 40 }, data: { note: 'kept' } });
    delete target.option_status;
    delete target.analysis_participation;
    expect(after).toEqual(before);
  });

  it('REFUSED: a base the persistence projection would REPAIR is never written with a bundled repair', () => {
    const g = persistedGraph();
    (g.options as Record<string, unknown>[]).splice(1, 1); // the top-level options mirror is missing an option node
    expect(run({ status: 'removed' }, g)).toMatchObject({ kind: 'refused', reason: 'canonical_graph_needs_repair' });
  });

  it('RED: putting it back → feasible + included; the analysis hash MOVES (the last Run reads stale)', () => {
    const out = persistedGraph({ opt_carry_on: { option_status: 'removed', analysis_participation: 'retained_excluded' } });
    const r = run({ expected_status: 'removed', status: 'feasible' }, out);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(optionStatusHolds(r.mutatedGraph, 'opt_carry_on', 'feasible')).toBe(true);
    expect(baseHashOf(r.mutatedGraph)).not.toBe(baseHashOf(out));
  });

  it('RED (CODEX #78 5930825929): a stale expected_status refuses — infeasible → removed moves no hash, so only the assertion sees it', () => {
    const stored = persistedGraph({ opt_carry_on: { option_status: 'infeasible', analysis_participation: 'retained_excluded' } });
    const r = run({ expected_status: 'feasible', status: 'removed' }, stored);
    expect(r).toMatchObject({ kind: 'refused', reason: 'expected_status_mismatch' });
    // CODEX overflow #2467 P2: a TYPED conflict (dispatch → 409), never an honest-refusal 200 a caller could read as its own write.
    expect(r).toMatchObject({ baseHashConflict: { conflict_category: 'option_expected_status_mismatch', recovery_action: 'refresh_and_reconfirm' } });
  });

  it('CONTROL: the matching expected_status (infeasible → removed) is applied', () => {
    const stored = persistedGraph({ opt_carry_on: { option_status: 'infeasible', analysis_participation: 'retained_excluded' } });
    expect(run({ expected_status: 'infeasible', status: 'removed' }, stored).kind).toBe('mutated');
  });

  it('RED: a stale base hash → 409 conflict, nothing written', () => {
    expect(run({ base_graph_hash: 'stale' })).toMatchObject({ kind: 'refused', reason: BASE_HASH_DIVERGED, baseHashConflict: { recovery_action: 'refresh_and_reconfirm' } });
  });

  it.each([
    ['an id that names no node', { option_node_id: 'opt_missing' }, 'node_target_not_found'],
    ['a node that is not an option', { option_node_id: 'fac_price' }, 'not_an_option'],
  ])('REFUSED: %s', (_n, ev, reason) => {
    expect(run(ev)).toMatchObject({ kind: 'refused', reason });
  });

  // ⛔ CODEX overflow #2454 5934135126 P2: ADOPTION IS NOT CURRENT PARTICIPATION. Removing an ADOPTED Olumi option sets
  // `retained_excluded`; reading participation alone then called it "never adopted" and refused putting it back, while the
  // adoption door refuses it too (`excluded_option`, olumi-option-adoption.ts) — the user had no way back.
  it('RED (CODEX P2): an ADOPTED Olumi option taken out can be PUT BACK — included again, still Olumi\'s, the other option untouched', () => {
    const adopted = persistedGraph({ opt_launch: { proposed_by: 'olumi', analysis_participation: 'included' } });
    const out = run({ option_node_id: 'opt_launch', expected_status: 'feasible', status: 'removed' }, adopted);
    expect(out.kind, JSON.stringify(out)).toBe('mutated');
    if (out.kind !== 'mutated') return;
    expect(nodeOf(out.mutatedGraph, 'opt_launch')).toMatchObject({ option_status: 'removed', analysis_participation: 'retained_excluded', proposed_by: 'olumi' });
    const back = run({ option_node_id: 'opt_launch', expected_status: 'removed', status: 'feasible' }, out.mutatedGraph as Record<string, unknown>);
    expect(back.kind, JSON.stringify(back)).toBe('mutated');
    if (back.kind !== 'mutated') return;
    expect(optionStatusHolds(back.mutatedGraph, 'opt_launch', 'feasible')).toBe(true);
    expect(nodeOf(back.mutatedGraph, 'opt_launch')).toMatchObject({ analysis_participation: 'included', proposed_by: 'olumi', label: 'Launch now' });
    const other = nodeOf(back.mutatedGraph, 'opt_carry_on');
    expect(other.option_status).toBeUndefined();
    expect(other.analysis_participation).toBeUndefined();
  });

  it.each([
    ['taking it out (removed)', { expected_status: 'feasible', status: 'removed' }],
    ['marking it not feasible', { expected_status: 'feasible', status: 'infeasible' }],
    ['"putting it in" (feasible) — that is adoption, a different door', { expected_status: 'feasible', status: 'feasible' }],
  ])('REFUSED: %s on an Olumi suggestion the user has NOT added → nothing written', (_n, ev) => {
    const g = persistedGraph({ opt_launch: { proposed_by: 'olumi' } });
    const r = run({ option_node_id: 'opt_launch', ...ev }, g);
    expect(r).toMatchObject({ kind: 'refused', reason: 'olumi_suggestion_not_adopted' });
    expect(r.kind === 'mutated').toBe(false);
  });

  it('CONTROL: the user\'s OWN option (no proposed_by) with the same bytes is taken out', () => {
    const g = persistedGraph();
    expect(run({ option_node_id: 'opt_launch', expected_status: 'feasible', status: 'removed' }, g).kind).toBe('mutated');
  });

  it('isUnadoptedOlumiSuggestion: adoption is read from authorship + participation + the user\'s own exclusion, never participation alone', () => {
    expect(isUnadoptedOlumiSuggestion({ proposed_by: 'olumi' })).toBe(true);
    expect(isUnadoptedOlumiSuggestion({ proposed_by: 'olumi', analysis_participation: 'included' })).toBe(false);
    expect(isUnadoptedOlumiSuggestion({ proposed_by: 'olumi', option_status: 'removed', analysis_participation: 'retained_excluded' })).toBe(false);
    expect(isUnadoptedOlumiSuggestion({ proposed_by: 'olumi', option_status: 'infeasible', analysis_participation: 'retained_excluded' })).toBe(false);
    expect(isUnadoptedOlumiSuggestion({ proposed_by: 'olumi', option_status: 'feasible' })).toBe(true);
    expect(isUnadoptedOlumiSuggestion({ analysis_participation: 'retained_excluded' })).toBe(false);
  });

  it('PARTICIPATION_FOR_STATUS is the one map', () => {
    expect(PARTICIPATION_FOR_STATUS).toEqual({ feasible: 'included', infeasible: 'retained_excluded', removed: 'retained_excluded' });
  });
});

describe('the Run leaves a user-excluded option out and names it (spec O1)', () => {
  const options = [{ id: 'opt_launch', label: 'Launch now' }, { id: 'opt_carry_on', label: 'Carry on as now' }];
  it('RED: a removed option leaves the submission and is named with its status', () => {
    const g = persistedGraph({ opt_carry_on: { option_status: 'removed', analysis_participation: 'retained_excluded' } });
    const r = userExcludedOptions({ options, graph: g });
    expect(r.options.map((o) => o.id)).toEqual(['opt_launch']);
    expect(r.excluded).toEqual([{ option_id: 'opt_carry_on', label: 'Carry on as now', status: 'removed' }]);
  });
  it('CONTROL: no status (every model before 0.69.0) → the submission is unchanged, nothing named', () => {
    const r = userExcludedOptions({ options, graph: persistedGraph() });
    expect(r.options).toBe(options);
    expect(r.excluded).toEqual([]);
  });
  it('CONTROL: a status on an option this Run would not submit is not named', () => {
    const g = persistedGraph({ opt_carry_on: { option_status: 'infeasible' } });
    expect(userExcludedOptions({ options: [options[0]!], graph: g }).excluded).toEqual([]);
  });
});
