import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { approvalChipsFor } from '../approval-chips.js';
import { ProposalStore } from '../proposal.js';
import { UNKNOWN_ORIGIN_DETAIL } from '../runtime/statement-origin.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../../cee/unified-pipeline/stages/repair/status-quo-fix.js';

// The AIE packet's basis line (aie-a2-option-level-field-20261013.json) was replaced by Paul's principle review (#3051, B.md #3013).
const basisLine = (basis: string): string => `Why Olumi suggests this (not checked against a source unless one is shown): \u201c${basis}\u201d`;
const ctx = { scenario_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', authenticated_user_id: 'user-a', request_id: 'r',
  user_text: 'Suggest starting figures.', user_text_complete: false };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
function product(keep = false, held = false, extra = false) {
  const graph = { nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    ...(extra ? [{ id: 'cost', kind: 'factor', label: 'Campaign cost', category: 'observable', scale_frame: 1000 }] : []),
    { id: 'effectiveness', kind: 'factor', label: 'Campaign effectiveness', category: 'observable', scale_frame: 1,
      ...(keep ? { observed_state: { value: 0.2, unit: 'proportion', source: 'cee_inference', extractionType: 'inferred' } } : {}) },
    { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: 'GBP' } },
    { id: 'option', kind: 'option', label: 'Continue campaign', ...(held ? { is_baseline: true } : {}) },
  ], edges: [...(extra ? [edge('cost', 'goal')] : []), edge('effectiveness', 'goal'), edge('price', 'goal'),
    { ...edge('option', 'price'), ...(held ? { origin: REPAIR_AUTHORED_ORIGIN,
      provenance: { source: 'cee_hypothesis', reasoning: CONNECTIVITY_REPAIR_WIRING_REASON } } : {}) }], goal_node_id: 'goal' };
  const before = JSON.stringify(graph);
  const d: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h0' } });
  const store = new ProposalStore();
  const caps = createAgentCapabilities(d, store);
  const chips = (name: string, r: Awaited<ReturnType<typeof caps.proposeAssumptions>>) => approvalChipsFor(
    [{ name, ok: r.ok, mutated: r.mutated, proposal_id: String(r.proposal_id) }],
    id => ({ proposal: store.get(id), result: r }));
  return { caps, store, chips, unchanged: () => expect(JSON.stringify(graph)).toBe(before) };
}
const assumption = (basis: string, user_stated = false) => ({ factor_label: 'Campaign effectiveness', value: 0.2, unit: 'proportion', basis, user_stated });
const level = (user_stated: boolean | undefined, value = 55) => ({ option_label: 'Continue campaign', factor_label: 'Pro plan price', value, basis: 'a new trial price',
  ...(user_stated === undefined ? {} : { user_stated }) });

describe('A2i9 B4 bound card basis', () => {
  it.each([false, true])('exact card before consent, combined=%s', async combined => {
    const w = product();
    const basis = 'A new estimate for the first quarter; uncertain until tested.\nOnly if funding holds — this is not an observed outcome.';
    const args = { assumptions: [assumption(basis)], option_levels: [level(false)] };
    const r = combined ? await w.caps.proposeStartingPoint(ctx, args) : await w.caps.proposeAssumptions(ctx, args);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const p = w.store.get(String(r.proposal_id))!;
    const expected = `Adopt 1 starting assumption: Campaign effectiveness = 0.2 proportion\n${basisLine(basis)}`
      + (combined ? '; Continue campaign sets Pro plan price to £55' : '');
    expect(p.public_label).toBe(expected);
    expect(w.chips(combined ? 'propose_starting_point' : 'propose_assumptions', r)[0].detail).toBe(expected);
    expect(p.operations[0].value).toMatchObject({ basis, authored_by: 'model_proposed', unit: 'proportion' });
    w.unchanged();
  });
  it('each item carries its own full basis on the same card', async () => {
    const w = product(false, false, true);
    const first = 'An uncertain response rate; only for this quarter.';
    const second = 'A new cost allowance, excluding staffing and tax.';
    const r = await w.caps.proposeAssumptions(ctx, { assumptions: [assumption(first),
      { factor_label: 'Campaign cost', value: 100, unit: 'GBP', basis: second, user_stated: false }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const card = `Adopt 2 starting assumptions: Campaign cost = £100\n${basisLine(second)}; Campaign effectiveness = 0.2 proportion\n${basisLine(first)}`;
    expect(w.chips('propose_assumptions', r)[0].detail).toBe(card);
    expect(w.store.get(String(r.proposal_id))!.public_label).toBe(card);
    w.unchanged();
  });
  it('verified human figure does not acquire an Olumi basis line', async () => {
    const w = product();
    const r = await w.caps.proposeAssumptions({ ...ctx, user_text: 'Campaign effectiveness is 0.2.' }, { assumptions: [assumption('user supplied this', true)] });
    expect(r.ok).toBe(true);
    expect(w.chips('propose_assumptions', r)[0].detail).toBe('Record 1 figure you gave: Campaign effectiveness = 0.2 proportion');
    expect(w.store.get(String(r.proposal_id))!.operations[0].value).toMatchObject({ authored_by: 'user_stated' });
    w.unchanged();
  });
  it('kept canonical Olumi estimate is retained, not newly authored', async () => {
    const w = product(true);
    const r = await w.caps.proposeAssumptions(ctx, { assumptions: [{ ...assumption('accept the retained estimate'), keep: true }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(w.chips('propose_assumptions', r)[0].detail).toBe('Accept Olumi’s estimate, unchanged: Campaign effectiveness = 0.2 proportion');
    expect(w.store.get(String(r.proposal_id))!.operations[0].value).toMatchObject({ value: 0.2, authored_by: 'model_proposed' });
    expect(r.assumptions).toEqual([{ factor: 'Campaign effectiveness', value: 0.2, unit: 'proportion', basis: 'accept the retained estimate', keeps_olumis_estimate: true }]);
    w.unchanged();
  });
  it.each([false, true])('earlier-note basis remains verbatim; tier-2 match=%s', async tier2 => {
    const w = product();
    const basis = 'From your earlier note, campaign effectiveness is 0.2';
    const r = await w.caps.proposeAssumptions({ ...ctx, ...(tier2 ? { unverified_user_text: 'Campaign effectiveness is 0.2.' } : {}) }, { assumptions: [assumption(basis)] });
    if (tier2) {
      expect(r).toEqual({ ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL });
      expect(w.store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toEqual([]);
    } else {
      expect(r.ok).toBe(true);
      expect(w.chips('propose_assumptions', r)[0].detail).toBe(`Adopt 1 starting assumption: Campaign effectiveness = 0.2 proportion\n${basisLine(basis)}`);
      expect(w.store.get(String(r.proposal_id))!.operations[0].value).toMatchObject({ basis, authored_by: 'model_proposed' });
    }
    w.unchanged();
  });
});

describe('A2i9 B5 host contrasts under incomplete source', () => {
  it.each([
    { name: 'verified human true', flag: true, words: 'Continue campaign sets Pro plan price to £55.', tier2: '', author: 'user_stated' },
    { name: 'new Olumi false', flag: false, words: ctx.user_text, tier2: '', author: 'model_proposed' },
    { name: 'missing', flag: undefined, words: ctx.user_text, tier2: '', author: undefined },
    { name: 'unverifiable true', flag: true, words: ctx.user_text, tier2: '', author: undefined },
    { name: 'tier-2 overrides false', flag: false, words: ctx.user_text, tier2: 'Continue campaign sets Pro plan price to £55.', author: undefined },
  ])('$name', async row => {
    const w = product();
    const r = await w.caps.proposeOptionInterventions({ ...ctx, user_text: row.words, unverified_user_text: row.tier2 }, { interventions: [level(row.flag)] });
    if (row.author === undefined) {
      expect(r).toEqual({ ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL });
      expect(w.store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toEqual([]);
    } else {
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(w.store.get(String(r.proposal_id))!.operations[0].value).toMatchObject({ authored_by: row.author, raw: 55, unit: 'GBP' });
    }
    w.unchanged();
  });
  it.each([
    { flag: true, verified: true, value: 55, accepted: true },
    { flag: false, verified: true, value: 55, accepted: false },
    { flag: true, verified: false, value: 55, accepted: false },
    { flag: true, verified: true, value: 49, accepted: false },
  ])('held status quo requires true and verified changed level: %j', async row => {
    const w = product(false, true);
    const state = await w.caps.getCanonicalState(ctx);
    expect((state.structure as { status_quo_held: string[] }).status_quo_held).toEqual(['Continue campaign']);
    const r = await w.caps.proposeOptionInterventions({ ...ctx, user_text: row.verified ? `Continue campaign sets Pro plan price to £${row.value}.` : ctx.user_text }, { interventions: [level(row.flag, row.value)] });
    expect(r.ok, JSON.stringify(r)).toBe(row.accepted);
    expect(w.store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(row.accepted ? 1 : 0);
    if (row.accepted) expect(w.store.get(String(r.proposal_id))!.operations[0].value).toMatchObject({ authored_by: 'user_stated' });
    w.unchanged();
  });
});
