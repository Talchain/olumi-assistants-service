/**
 * ⭐ QUANTITY BINDING CONTRACT, PR-A row 8 (outbox/QUANTITY-BINDING-CONTRACT-20261018.md v2; Codex approach AMEND; DL build order).
 * A level that ONLY the retained or brief words write (origin unknown, K3) was left unset `origin_unknown` by the new-option
 * writer (existing-option levels and new graded levels). It is now RECORDED through that writer's EXISTING unverified carrier
 * (`cee_hypothesis` + `user_material_unverified`, which reads origin UNKNOWN at readback), with the AIE's note: never "your
 * figure", never Olumi's. With no such words (an incomplete history), the existing disclosed refusal stands. Writers whose only
 * carrier reads origin human (assumptions, new factor) stay refused, as the limit does. Synthetic words.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';
import { UNKNOWN_ORIGIN_DETAIL } from '../runtime/statement-origin.js';
import { settingProvenanceOf, valueProvenanceOf } from '../../../cee/provenance/provenance-of.js';
import { buildAddOptionTransaction } from '../../routing/add-option-transaction.js';

type Rec = Record<string, any>;
/** The AIE's exact Agent note (`prompt/AIE-B0-GUIDANCE-AND-ORIGIN-NOTE-20261018-v1.json` g3), pinned byte-for-byte. */
const NOTE = 'These entries retain figures found in the user-supplied material, but Olumi could not verify their attribution or binding to the proposed quantities from a cited statement. Their origin remains unverified (`origin_unverified`): do not call them the user’s statements or Olumi’s estimates. Preserve the source, speaker, unit, reference, qualifications and conditions actually available; do not invent missing ones. Distinguish an offered proposal from a saved change using the actual result and readback. Approval authorises only the displayed change and does not verify source credit or scientific support. Reuse supplied figures rather than asking the user to repeat or confirm them; ask only for a genuinely missing or conflicting meaning.';
const SID = '44444444-4444-4444-8444-44444444a8a8';
const ctxOf = (said: string, retained: string, complete = true) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'qbc-a8',
  user_text: said, user_turn_text: said, unverified_user_text: retained, user_text_complete: complete });
const readOnly = (graph: unknown): InternalDispatch => async (path) => {
  if (!path.endsWith('/graph')) throw new Error(`No write is authorised here: ${path}`);
  return { status: 200, json: { graph: structuredClone(graph), graph_hash: 'h0' } };
};
const ORDERS = projectGraphForPersistence({
  nodes: [{ id: 'goal', kind: 'goal', label: 'Customer satisfaction' },
    { id: 'orders', kind: 'factor', label: 'Daily orders', observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: 'orders a day' } }],
  edges: [{ from: 'orders', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  goal_node_id: 'goal',
} as never);

describe('row 8 / the writers whose only carrier reads origin HUMAN stay refused (no unknown carrier; same ruling as the limit)', () => {
  // `observed_state.user_material_unverified` reads origin human, role unverified (provenance-of.ts `readValue`): retained words may
  // be a chip's, so recording them there would credit a person. No new stamp is made (Paul: no new meaning stamp).
  it('GUARD: propose_assumptions keeps the disclosed origin_unknown refusal for a figure only the retained words write', async () => {
    const caps = createAgentCapabilities(readOnly(ORDERS), new ProposalStore());
    const r = await caps.proposeAssumptions(ctxOf('Use that daily orders figure.', 'Daily orders are 40 orders a day.') as never, { assumptions: [
      { factor_label: 'Daily orders', value: 40, unit: 'orders a day', basis: 'the retained words', user_stated: true, revise: true }] } as never);
    expect(r).toEqual({ ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL });
  });
  it('CONTROL: the observed_state marker reads human/unverified, the option-cell marker reads unknown', () => {
    expect(valueProvenanceOf({ value: 0.4, source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true }))
      .toMatchObject({ origin: 'human', role: 'unverified' });
    expect(settingProvenanceOf({ value: 0.125, source: 'cee_hypothesis', user_material_unverified: true })).toMatchObject({ origin: 'unknown' });
  });
});

describe('row 8 / propose_new_option: a retained level is sent with its origin unverified, and the add-option builder keeps it', () => {
  const GRAPH = {
    nodes: [{ id: 'dec', kind: 'decision', label: 'Membership pricing' }, { id: 'goal', kind: 'goal', label: 'Monthly revenue' },
      { id: 'price', kind: 'factor', label: 'Membership price', observed_state: { value: 0.1, raw_value: 20, unit: 'GBP per month', cap: 200 } },
      { id: 'opt_keep', kind: 'option', label: 'Keep £20', interventions: { price: { value: 0.1, raw_value: 20, unit: 'GBP per month', source: 'user_specified' } } }],
    edges: [{ from: 'dec', to: 'opt_keep' }, { from: 'opt_keep', to: 'price', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'price', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  };
  const propose = async (said: string, retained: string, complete = true) => {
    const sent: Rec[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(GRAPH), graph_hash: 'h0' } };
      sent.push(body as Rec);
      const p = (body as Rec).chip?.parameters;
      return { status: 200, json: { suggested_actions: [{ id: gmHeldProposalRef(SID, `node:${p?.options?.[0]?.option_id ?? p?.option_id}`), label: 'Approve changes', message: 'Yes.' }] } };
    };
    const r = await createAgentCapabilities(d, new ProposalStore()).proposeNewOption(ctxOf(said, retained, complete) as never, { label: 'Members plan',
      acts_on: [{ factor_label: 'Membership price', direction: 'positive', level: { value: 25, unit: 'GBP per month' } }], rationale: 'retained words' } as never) as Rec;
    const p = sent[0]?.chip?.parameters;
    return { r, params: p as Rec | undefined, price: ((p?.interventions ?? p?.options?.[0]?.interventions ?? []) as Rec[]).find((i) => i.factor_id === 'price') };
  };
  it('RED → GREEN: "£25 for new members" only in retained words → sent as `cee_hypothesis` + marker; the builder\'s add_node keeps the marker', async () => {
    const { r, params, price } = await propose('Add the members plan.', 'The members plan would be £25 for new members.');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(price, JSON.stringify(price)).toMatchObject({ raw_value: 25, source: 'cee_hypothesis', user_material_unverified: true });
    expect(r.origin_unverified).toEqual([{ option: 'Members plan', factor: 'Membership price', value: 25 }]);
    expect(r.origin_unverified_note).toBe(NOTE);
    const built = buildAddOptionTransaction(params, GRAPH as never) as Rec;
    expect(built.matched, JSON.stringify(built)).toBe(true);
    const add = (built.proposal.operations as Rec[]).find((o) => o.op === 'add_node');
    expect(add!.value.interventions.price).toMatchObject({ source: 'cee_hypothesis', user_material_unverified: true });
    // Readback: origin unknown, never the person's and never Olumi's.
    expect(settingProvenanceOf(add!.value.interventions.price).origin).toBe('unknown');
    expect(JSON.stringify(r.options ?? r.levels)).not.toContain('olumi_estimate');
  });
  it('NEGATIVE (builder): the marker beside the user\'s own source is refused, never kept', () => {
    const bad = buildAddOptionTransaction({ parent_decision_id: 'dec', label: 'X', interventions: [{ factor_id: 'price', value: 0.125, raw_value: 25,
      unit: 'GBP per month', user_material_unverified: true }] }, GRAPH as never) as Rec;
    expect(bad).toMatchObject({ matched: false, reason: 'parameters_invalid' });
  });
  it('NEGATIVE kept: unknown with NO retained words leaves the level unset with the existing disclosure', async () => {
    const { r, price } = await propose('Add the members plan.', '', false);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(price?.value ?? null).toBeNull();
    expect(r.levels_not_set).toEqual([expect.objectContaining({ factor: 'Membership price', value: 25, reason: UNKNOWN_ORIGIN_DETAIL })]);
  });
});
