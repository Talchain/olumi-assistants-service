/**
 * ⭐ QUANTITY BINDING CONTRACT — chat-writer rows (outbox/QUANTITY-BINDING-CONTRACT-20261018.md; owner: lean core; rows 6–9 from
 * Codex #3392 r2, reviews/CODEX-3392-e2e94525-delta-full.md). One rule for every writer: a value is the user's only on a cited span
 * that writes it for THIS quantity (`userStated` + the one binding); an uncited figure the user's own words write is recorded with its
 * origin unverified only where the writer's existing carrier reads unknown (row 8 is PR-A's; the rest is OWED); a limit has no unknown
 * carrier, so it stays refused with its existing disclosure (DL-3 ruling). The AI's speaker label only subtracts credit (C2). Each row runs the real writer
 * (dispatch or capability) on a read-only graph double and asserts by identity; RED at staging 006716c2 unless labelled GUARD.
 * Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';

type Rec = Record<string, any>;
const SID = '44444444-4444-4444-8444-4444444441b0';
const ctxOf = (said: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'qbc', user_text: said, user_turn_text: said, verified_user_messages: [said] });
const readOnly = (graph: unknown): InternalDispatch => async (path) => {
  if (!path.endsWith('/graph')) throw new Error(`No write is authorised here: ${path}`);
  return { status: 200, json: { graph: structuredClone(graph), graph_hash: 'h0' } };
};

/* ── Row 6: a limit's figure binds by its own clause (W19; propose_limit_change) ── */
const LIMIT = 'Coastal orders shipped within 2 days';
const LIMIT_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Customer satisfaction' },
    { id: 'ontime', kind: 'factor', label: LIMIT, observed_state: { value: 0.9, raw_value: 90, unit: '%', cap: 100 } },
    { id: 'packing', kind: 'factor', label: 'Harbour packing service time', observed_state: { value: 0.3, raw_value: 3, unit: 'days', cap: 10 } },
    { id: 'ads', kind: 'factor', label: 'Advertising share', observed_state: { value: 0.2, raw_value: 20, unit: '%', cap: 100 } },
  ],
  edges: [{ from: 'ontime', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  goal_constraints: [{ constraint_id: 'gc-ontime', node_id: 'ontime', operator: '>=', value: 90, unit: '%', value_frame: 'level', label: LIMIT, provenance: 'explicit' }],
};
async function proposeLimit(said: string, quote: string | undefined) {
  const store = new ProposalStore();
  const caps = createAgentCapabilities(readOnly(LIMIT_GRAPH), store);
  const r = await dispatchTool('propose_limit_change', JSON.stringify({ limit_label: LIMIT, operator: '>=', new_value: 85, unit: '%',
    ...(quote !== undefined ? { quote } : {}), rationale: said }), ctxOf(said) as never, caps) as Rec;
  return { r, author: typeof r.proposal_id === 'string' ? store.get(r.proposal_id)?.provenance.authored_by : undefined };
}
describe('row 6 (W19): a limit\'s figure is the user\'s only where the clause that writes it names this limit or no other quantity', () => {
  // OWED (DL-3 ruling, PR-B): "coastal-harbour constraint" names the limit AND a rival ("Harbour packing service time"), so the clause
  // licenses neither today (the safe failure). The 3 rival GUARDs below stay GREEN; this row flips when per-occurrence ownership lands.
  it.fails('OWED (P05 class): the user\'s own name for the limit shares a word with another factor → prepared as theirs', async () => {
    const said = 'The coastal-harbour constraint should be at least 85%, not 90%; I copied the wrong line.';
    expect(await proposeLimit(said, said)).toMatchObject({ r: { ok: true }, author: 'user_stated' });
  });
  it.each([
    ['semicolon', 'Keep Coastal orders shipped within 2 days unchanged; Advertising share is 85% this quarter.'],
    ['figure before its quantity', '85% is the Advertising share this quarter; keep Coastal orders shipped within 2 days unchanged.'],
    ['another sentence', 'Keep Coastal orders shipped within 2 days unchanged. Advertising share is 85% this quarter.'],
  ])('GUARD (%s): Advertising share\'s 85% never becomes the service limit', async (_name, said) => {
    const { r, author } = await proposeLimit(said, said);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, refusal: 'figure_not_stated' });
    expect(author).toBeUndefined();
  });
  it.each([
    ['the same 85% for both quantities, the limit\'s own clause', 'Advertising share is 85% this quarter. Coastal orders shipped within 2 days should be at least 85%.'],
    ['figure before the limit\'s name', 'At least 85% is the limit for Coastal orders shipped within 2 days.'],
  ])('GUARD (%s): the valid limit binds → prepared as theirs', async (_name, said) => {
    expect(await proposeLimit(said, said)).toMatchObject({ r: { ok: true }, author: 'user_stated' });
  });
  // OWED to the USER_QUOTE fold (DL-3 ruling, PR-B): `propose_limit_change` has no quote field; refusing an uncited figure needs one
  // (tool schema = prompt text + AIE), and must not refuse today's working "the budget is now £30k" turns.
  it.fails('OWED (B3, no unknown carrier for a limit): an uncited figure the user wrote is never prepared as theirs; refused with the existing disclosure', async () => {
    const { r, author } = await proposeLimit('Coastal orders shipped within 2 days should be at least 85%.', undefined);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_stated' });
    expect(author).toBeUndefined();
  });
});

/* ── Row 7: a range is credited only by userStated (W14; propose_option_interventions) ── */
const RANGE_GRAPH = {
  nodes: [{ id: 'goal', kind: 'goal', label: 'Continuity' },
    { id: 'downtime', kind: 'factor', label: 'Downtime', observed_state: { value: 0.1, raw_value: 10, cap: 100, unit: 'days' } },
    { id: 'migration', kind: 'option', label: 'Migration' }],
  edges: [{ from: 'migration', to: 'downtime', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'downtime', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }],
};
async function proposeRangeLevel(said: string, quote?: string) {
  const store = new ProposalStore();
  const caps = createAgentCapabilities(readOnly(RANGE_GRAPH), store);
  const r = await caps.proposeOptionInterventions(ctxOf(said) as never, { interventions: [{ option_label: 'Migration', factor_label: 'Downtime', value: 15, unit: 'days',
    basis: 'the middle of the stated range', user_stated: true, likely_low: 10, likely_high: 20, range_user_stated: true, range_meaning: 'likely_range',
    ...(quote !== undefined ? { quote } : {}) }] } as never) as Rec;
  const op = typeof r.proposal_id === 'string' ? store.get(r.proposal_id)?.operations.find((o) => o.op === 'set_option_intervention') : undefined;
  return { r, value: (op?.value ?? {}) as Rec };
}
describe('row 7 (W14): a likely range is the user\'s only by userStated, and never credits a point it does not write', () => {
  it('RED: "likely between 10 and 20 days", cited → the range is theirs; the unwritten 15 is never "you said"', async () => {
    const said = 'For Migration, downtime is likely between 10 and 20 days.';
    const { r, value } = await proposeRangeLevel(said, said);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(value.likely_range).toEqual({ low: 10, high: 20 });
    expect(value.authored_by, JSON.stringify(value)).not.toBe('user_stated');
    expect(JSON.stringify(r.interventions)).not.toMatch(/"stated_by":"user"/);
  });
  it('RED: another speaker\'s range (Inez, quoted) is never recorded as the user\'s likely range', async () => {
    const said = 'Inez said: "For Migration, downtime is likely between 10 and 20 days."';
    const { r, value } = await proposeRangeLevel(said, said);
    expect(value.likely_range, JSON.stringify(r)).toBeUndefined();
    expect(String(r.public_label ?? '')).not.toContain('Your stated range');
  });
});


/* ── Row 9 (B4 + DL ruling (a)): a quoted option title is never credited by label equality ── */
const TITLE = '£25 for new members; keep current members';
const W15_GRAPH = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Membership pricing' },
    { id: 'goal', kind: 'goal', label: 'Monthly revenue' },
    { id: 'price', kind: 'factor', label: 'Membership price', observed_state: { value: 0.1, raw_value: 20, unit: 'GBP per month', cap: 200 } },
    { id: 'opt_keep', kind: 'option', label: 'Keep £20', interventions: { price: { value: 0.1, raw_value: 20, unit: 'GBP per month', source: 'user_specified' } } },
  ],
  edges: [{ from: 'dec', to: 'opt_keep' }, { from: 'opt_keep', to: 'price', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'price', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
};
async function proposeTitled(said: string, label = TITLE) {
  const sent: Rec[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(W15_GRAPH), graph_hash: 'h0' } };
    sent.push(body as Rec);
    const p = (body as Rec).chip?.parameters;
    const oid = p?.options?.[0]?.option_id ?? p?.option_id;
    return { status: 200, json: { suggested_actions: [{ id: gmHeldProposalRef(SID, `node:${oid}`), label: 'Approve changes', message: 'Yes.' }] } };
  };
  const caps = createAgentCapabilities(d, new ProposalStore());
  const r = await caps.proposeNewOption(ctxOf(said) as never, { label, acts_on: [{ factor_label: 'Membership price', direction: 'positive',
    level: { value: 25, unit: 'GBP per month', quote: said } }], rationale: 'The user asked for it.' } as never) as Rec;
  const p = sent[0]?.chip?.parameters;
  const entry = (p?.options ?? (p !== undefined ? [p] : [])).find((o: Rec) => o.label === label) as Rec | undefined;
  return { r, price: (entry?.interventions as Rec[] | undefined)?.find((i) => i.factor_id === 'price') };
}
describe('row 9: the user\'s credit for a figure inside quotation marks never comes from matching an option title', () => {
  it('RED (B4): another speaker\'s quoted proposal that names the option is never the user\'s £25 (recorded unverified)', async () => {
    const { r, price } = await proposeTitled(`Inez said: "${TITLE}".`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(price, JSON.stringify(price)).toMatchObject({ source: 'cee_hypothesis', user_material_unverified: true });
  });
  it('RED (DL ruling (a), the one disclosed base flip): the user\'s own quoted title is ambiguous → recorded unverified, never lost', async () => {
    const { r, price } = await proposeTitled(`Let’s add the members plan: "${TITLE}".`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(price, JSON.stringify(price)).toMatchObject({ source: 'cee_hypothesis', user_material_unverified: true });
  });
  it('GUARD: the same figure in the user\'s own unquoted words, cited, stays theirs (no stamp)', async () => {
    const said = 'Add an option: charge £25 for new members and keep current members.';
    const { r, price } = await proposeTitled(said, 'Charge £25 for new members');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(price, JSON.stringify(price)).toBeDefined();
    expect(price).not.toHaveProperty('source');
  });
});
