import { timingIt } from '../../../../tests/helpers/scaling-ratio.js';
/**
 * CEE #4b: one typed answer and one Yes record an asked product part's own figure and the reading together.
 * Both fixtures are stored B1 graphs; the pre-Yes copy only makes Olumi's goal reading unconfirmed.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { plotResolvesFrame } from '../../../cee/graph-readiness/identity-frames.js';
import { identityApproveMessage, identityReadingOf, readingOfIdentityApproval } from '../../agent-lane/identity-card.js';
import { proposeProductIdentity } from '../../agent-lane/identity-proposal.js';
import { breakEvenFor, breakEvenLine } from '../../agent-lane/break-even.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { figureTheUserWroteFor, hasApproximateFigureQualifier } from '../../agent-lane/stated-by-user.js';
import { sayFigureWithoutRounding } from '../../agent-lane/say-figure.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../dispatch.js';
import {
  applyIdentityConfirmEdit, identityConfirmPostimageIsScoped, identityConfirmReadingToken, identityPartsWithoutLevel,
  type IdentityConfirmReading,
} from '../identity-confirm-edit.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/${name}-stored-graph.json`, import.meta.url), 'utf8'));
const OUTCOME = fixture('b1-828d87ac');
const FACTOR = fixture('b1-9f32a4b4');
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id)!;
const beforeYes = (stored: Rec = OUTCOME): Rec => {
  const g = structuredClone(stored);
  node(g, 'mrr').nonlinear_identity.stated_in_brief = false;
  return g;
};
const hashOf = (g: Rec): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
const figure = { part_id: 'pro_paying_subscribers', raw_value: 300, unit: 'subscribers' };
const partArgs = { part_label: 'Pro paying subscribers', value: 300, unit: 'subscribers' };
const args = { parts: [partArgs] };
const ctx = (user_turn_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400c9', authenticated_user_id: null,
  request_id: 'identity-part-figure', user_text: user_turn_text, user_turn_text });
const scope = (g: Rec) => ({ target: ['Pro paying subscribers'], exactFigure: true as const, others: g.nodes
  .filter((n: Rec) => n.kind !== 'option' && n.kind !== 'decision' && n.id !== figure.part_id).map((n: Rec) => String(n.label)) });

/** Issuance and approval are production capabilities; the injected commit executes the real canonical writer once. */
function world(start: Rec) {
  const state = { graph: start, writes: 0, sent: [] as CommitOptionLevelsInput[] };
  const store = new ProposalStore();
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: state.graph, graph_hash: hashOf(state.graph) } };
    throw new Error(`Unexpected dispatch: ${path}`);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    state.sent.push(input);
    const reading = input.identity_confirm!;
    const r = applyIdentityConfirmEdit({ persistedGraph: state.graph, ...reading, expected_graph_hash: input.base_graph_hash });
    if (r.kind === 'refused') return { status: 'refused', reason: `identity_${r.reason}` };
    state.graph = r.mutatedGraph as Rec;
    state.writes += 1;
    return { status: 'committed', graph_hash: hashOf(state.graph), already_applied: false, committed_levels: [], links_resized: [],
      receipt: { version: 1, version_id: 'identity-part-figure-v1', mutation_id: 'identity-part-figure-m1', source_turn_id: 'identity-part-figure-t1' } };
  };
  const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { commitOptionLevels });
  const propose = async (text = '300'): Promise<Rec> => caps.proposeIdentity!(ctx(text), args) as Promise<Rec>;
  const approve = async (offered: Rec): Promise<Rec> => {
    const words = String(offered.card.words);
    const message = identityApproveMessage(words);
    return caps.authoriseChange({ ...ctx(message), typed_approval_of: String(offered.proposal_id), typed_approval_words: message },
      { proposal_id: String(offered.proposal_id) }) as Promise<Rec>;
  };
  return { state, store, caps, propose, approve };
}

const reading = (g: Rec = beforeYes(), partLevel = figure): IdentityConfirmReading => ({
  ...proposeProductIdentity(g)!, part_levels: [partLevel],
});
const press = (g: Rec, r = reading(g), reading_token = identityConfirmReadingToken(r)) => applyIdentityConfirmEdit({
  persistedGraph: g, ...r, expected_graph_hash: hashOf(g), reading_token,
});

describe('CEE #4b: the asked count is saveable in the single identity confirmation', () => {
  it('R1 828d87ac OUTCOME: draft → typed 300 → one card → one Yes → ONE write, with the Run inputs intact', async () => {
    const before = beforeYes();
    const unchanged = JSON.stringify(before);
    const w = world(before);
    const offered = await w.propose();
    expect(offered).toMatchObject({ ok: true, mutated: false });
    expect(w.state.writes).toBe(0);
    const proposal = w.store.get(String(offered.proposal_id))!;
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]).toMatchObject({ op: 'confirm_identity', value: { part_levels: [figure] } });
    expect(identityReadingOf(proposal)).toMatchObject({ part_levels: [figure] });
    expect(offered.card.words).toContain('‘Pro paying subscribers’ (300, your figure)');
    expect(readingOfIdentityApproval(identityApproveMessage(offered.card.words))).toBe(offered.card.words);
    expect(await w.approve(offered)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.state.sent).toHaveLength(1);
    expect(w.state.sent[0]).toMatchObject({ links: [], levels: [], identity_confirm: { part_levels: [figure] } });
    expect(w.state.writes).toBe(1);
    const after = w.state.graph;
    expect(node(after, 'mrr').nonlinear_identity.stated_in_brief).toBe(true);
    expect(node(after, figure.part_id).observed_state).toEqual({ value: 0.15, raw_value: 300, unit: 'subscribers', source: 'user_override' });
    expect(node(after, figure.part_id).scale_frame).toBe(2000);
    expect(identityPartsWithoutLevel(after, node(after, 'mrr').nonlinear_identity.factor_ids)).toEqual([]);
    expect(JSON.stringify(before)).toBe(unchanged);
    // run-analysis.ts assembles the whole PLoT payload inline; there is no pure whole-request translator in CEE.
    // Its graph carries today's status-quo product £49 × 300 = £14,700/month BEFORE the separate price-sensitivity term.
    // Churn and new-subscriber links INTO this outcome remain causal inputs to the Run: no edge removed or reweighted.
    expect(node(after, 'pro_plan_price').observed_state.raw_value * node(after, figure.part_id).observed_state.raw_value).toBe(14_700);
    expect(after.edges.filter((e: Rec) => e.to === figure.part_id)).toEqual(before.edges.filter((e: Rec) => e.to === figure.part_id));
    expect(after.edges.filter((e: Rec) => e.to === figure.part_id).map((e: Rec) => e.from).sort())
      .toEqual(['monthly_churn', 'new_pro_subscribers_per_month']);
    expect(after.edges).toEqual(before.edges);
    expect(identityConfirmPostimageIsScoped(before, after, 'mrr', [figure])).toBe(true);
    for (const change of [
      (g: Rec) => { node(g, figure.part_id).observed_state.source = 'user_confirmed'; },
      (g: Rec) => { node(g, figure.part_id).observed_state.raw_value = 350; },
      (g: Rec) => { node(g, figure.part_id).observed_state.value = 0.175; },
      (g: Rec) => { node(g, figure.part_id).scale_frame = 5000; },
      (g: Rec) => { node(g, 'pro_plan_price').observed_state.raw_value = 50; },
      (g: Rec) => { g.edges.find((e: Rec) => e.to === figure.part_id).strength.mean = 0.9; },
    ]) {
      const extra = structuredClone(after); change(extra);
      expect(identityConfirmPostimageIsScoped(before, extra, 'mrr', [figure])).toBe(false);
    }
  });

  it('P1-a 828d87ac: two missing parts get one card and both figures in one write; either missing figure refuses', async () => {
    const before = beforeYes();
    // A stored observed_state requires value. Clear the raw level and its user authorship while keeping its unit/frame.
    delete node(before, 'pro_plan_price').observed_state.raw_value;
    node(before, 'pro_plan_price').observed_state.source = 'cee_inference';
    expect(identityPartsWithoutLevel(before, node(before, 'mrr').nonlinear_identity.factor_ids).map(p => p.id))
      .toEqual(['pro_plan_price', figure.part_id]);
    const priceArgs = { part_label: 'Pro plan price', value: 49, unit: '£ per Pro subscriber per month' };
    const both = { parts: [priceArgs, partArgs] };
    const text = 'Pro plan price is £49 per Pro subscriber per month; we have 300 Pro subscribers.';
    const w = world(before);
    const offered = await w.caps.proposeIdentity!(ctx(text), both) as Rec;
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.card.words).toContain('‘Pro plan price’ (£49 per Pro subscriber per month, your figure)');
    expect(offered.card.words).toContain('‘Pro paying subscribers’ (300, your figure)');
    expect(w.state.writes).toBe(0);
    expect(await w.approve(offered)).toMatchObject({ ok: true, applied: true });
    expect(w.state.writes).toBe(1);
    expect(w.state.sent).toHaveLength(1);
    const levels = [{ part_id: 'pro_plan_price', raw_value: 49, unit: priceArgs.unit }, figure];
    expect(w.state.sent[0]?.identity_confirm?.part_levels).toEqual(levels);
    expect(node(w.state.graph, 'pro_plan_price').observed_state).toMatchObject({ raw_value: 49, source: 'user_override' });
    expect(node(w.state.graph, figure.part_id).observed_state).toMatchObject({ raw_value: 300, source: 'user_override' });
    expect(identityConfirmPostimageIsScoped(before, w.state.graph, 'mrr', levels)).toBe(true);
    const changed = structuredClone(w.state.graph);
    node(changed, 'pro_plan_price').observed_state.raw_value = 59;
    expect(identityConfirmPostimageIsScoped(before, changed, 'mrr', levels)).toBe(false);
    for (const [parts, other] of [[[partArgs], 'Pro plan price'], [[priceArgs], 'Pro paying subscribers']] as const) {
      const partial = world(structuredClone(before));
      const refused = await partial.caps.proposeIdentity!(ctx(text), { parts }) as Rec;
      expect(refused).toMatchObject({ ok: false, mutated: false, refusal: 'identity_operand_level_missing' });
      expect(refused.detail).toContain(other);
      expect(refused).not.toHaveProperty('card');
      expect(partial.state.writes).toBe(0);
    }
    const unwritten = await world(structuredClone(before)).caps.proposeIdentity!(ctx('We have 300 Pro subscribers'), both) as Rec;
    expect(unwritten).toMatchObject({ ok: false, mutated: false });
    expect(unwritten.detail).toContain('Pro plan price');
    expect(unwritten).not.toHaveProperty('card');
  });

  it('P1-a distinct part ids: duplicate tool entries and duplicate token-bound levels refuse', async () => {
    const before = beforeYes();
    const w = world(before);
    const refused = await w.caps.proposeIdentity!(ctx('We have 300 Pro subscribers'), { parts: [partArgs, partArgs] }) as Rec;
    expect(refused).toMatchObject({ ok: false, mutated: false });
    expect(refused).not.toHaveProperty('card');
    expect(press(before, { ...reading(before), part_levels: [figure, figure] })).toMatchObject({ kind: 'refused', reason: 'part_level_not_asked' });
    expect(w.state.writes).toBe(0);
  });

  it.each(['scale_frame', 'cap', 'pair'])('P1-b frame below 5,000 (%s): normalize to 0.5 on a persisted 10,000 frame, guard mirrors it', frame => {
    const before = beforeYes();
    const shown = reading(before);
    const part = node(before, figure.part_id);
    if (frame === 'cap') { delete part.scale_frame; part.observed_state = { value: 0.125, raw_value: 250, cap: 2000, unit: figure.unit, source: 'cee_inference' }; }
    if (frame === 'pair') { delete part.scale_frame; part.observed_state = { value: 0.125, raw_value: 250, unit: figure.unit, source: 'cee_inference' }; }
    const level = { ...figure, raw_value: 5000 };
    const r = press(before, { ...shown, part_levels: [level] });
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const after = r.mutatedGraph as Rec;
    expect(node(after, figure.part_id).scale_frame).toBe(10_000);
    expect(node(after, figure.part_id).observed_state).toEqual({ value: 0.5, raw_value: 5000, unit: 'subscribers', source: 'user_override' });
    expect(identityConfirmPostimageIsScoped(before, after, 'mrr', [level])).toBe(true);
    node(after, figure.part_id).scale_frame = 2000;
    node(after, figure.part_id).observed_state.value = 2.5;
    expect(identityConfirmPostimageIsScoped(before, after, 'mrr', [level])).toBe(false);
  });

  it('P2-d exact formatting keeps extra digits and currency placement without placeholder replacement', () => {
    expect(sayFigureWithoutRounding(300.125, '')).toBe('300.125');
    expect(sayFigureWithoutRounding(49.123456, 'GBP/month')).toBe('£49.123456 / month');
    expect(sayFigureWithoutRounding(49.12, 'GBP/month')).toBe('£49.12 / month');
  });

  timingIt('P2-e both exactFigure qualifier regexes take <50ms on 20,000 spaces and repeated about', () => {
    const times: number[] = [];
    for (const text of [' '.repeat(20_000), 'about '.repeat(3334).slice(0, 20_000)]) {
      for (const side of ['before', 'after']) {
        const start = performance.now();
        hasApproximateFigureQualifier(side === 'before' ? text : '', side === 'after' ? text : '');
        const elapsed = performance.now() - start;
        expect(elapsed, `${side} qualifier: ${elapsed}ms`).toBeLessThan(50);
        times.push(elapsed);
      }
    }
    process.stdout.write(`exactFigure qualifier timings (ms): ${times.map(t => t.toFixed(3)).join(', ')}\n`);
  });

  it('R1 frame control: an asked OUTCOME with no PLoT-resolvable frame is given exactly 2× the typed count', () => {
    const before = beforeYes();
    delete node(before, figure.part_id).scale_frame;
    const r = press(before);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const after = r.mutatedGraph as Rec;
    expect(node(after, figure.part_id).scale_frame).toBe(600);
    expect(node(after, figure.part_id).observed_state).toEqual({ value: 0.5, raw_value: 300, unit: 'subscribers', source: 'user_override' });
    expect(identityConfirmPostimageIsScoped(before, after, 'mrr', [figure])).toBe(true);
    expect(after.edges).toEqual(before.edges);
  });

  it('R2 9f32a4b4 FACTOR: Olumi’s basis-less 250 becomes the user’s 300; nothing else on the node changes', async () => {
    const before = beforeYes(FACTOR);
    expect(node(before, figure.part_id).observed_state).toMatchObject({ raw_value: 250, source: 'cee_inference' });
    const w = world(before);
    expect(await w.approve(await w.propose())).toMatchObject({ ok: true, applied: true });
    const { observed_state: _old, ...oldRest } = node(before, figure.part_id);
    const { observed_state: level, ...newRest } = node(w.state.graph, figure.part_id);
    expect(level).toEqual({ value: 0.15, raw_value: 300, unit: 'subscribers', source: 'user_override' });
    expect(newRest).toEqual(oldRest);
    expect(w.state.graph.edges).toEqual(before.edges);
    expect(w.state.writes).toBe(1);
  });

  it('R1 framing: a cap lost on replacement stays resolvable on the resulting part', () => {
    const before = beforeYes();
    const shown = reading(before);
    const part = node(before, figure.part_id);
    delete part.scale_frame;
    part.observed_state = { value: 0.25, raw_value: 0.25, cap: 1, unit: 'subscribers', source: 'cee_inference' };
    const level = { ...figure, raw_value: 0.125 };
    const r = press(before, { ...shown, part_levels: [level] });
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const after = r.mutatedGraph as Rec;
    expect(node(after, figure.part_id).observed_state).toEqual({ value: 0.125, raw_value: 0.125, unit: 'subscribers', source: 'user_override' });
    expect(node(after, figure.part_id).scale_frame).toBe(1);
    expect(plotResolvesFrame(node(after, figure.part_id))).toBe(true);
    expect(identityConfirmPostimageIsScoped(before, after, 'mrr', [level])).toBe(true);
  });

  it('R3 exact precision: the card never rounds the figure its Yes writes', async () => {
    const w = world(beforeYes());
    const offered = await w.caps.proposeIdentity!(ctx('300.125'), { parts: [{ ...partArgs, value: 300.125 }] }) as Rec;
    expect(offered).toMatchObject({ ok: true, mutated: false });
    expect(offered.card.words).toContain('(300.125, your figure)');
    expect(await w.approve(offered)).toMatchObject({ ok: true, applied: true });
    expect(node(w.state.graph, figure.part_id).observed_state.raw_value).toBe(300.125);
  });

  it.each(['about 300', 'about three hundred', '300-ish', 'a few hundred'])('R3 unreadable %j: not the user’s exact 300; no card or write', async text => {
    const before = beforeYes();
    expect(figureTheUserWroteFor(300, 'subscribers', text, scope(before))).toBe(false);
    const w = world(before);
    const offered = await w.propose(text);
    expect(offered).toMatchObject({ ok: false, mutated: false,
      detail: 'Nothing was offered. Ask once, in plain words: ‘What\'s the number for ‘Pro paying subscribers’ today?’ Never guess, round or invent it.' });
    expect(offered).not.toHaveProperty('card');
    expect(offered).not.toHaveProperty('proposal_id');
    expect(offered).not.toHaveProperty('value');
    expect(w.state.writes).toBe(0);
    expect(w.state.sent).toEqual([]);
    expect(w.state.graph).toEqual(before);
  });

  it('R3 control: “We have 300 Pro subscribers” is accepted, from this turn’s own message', async () => {
    const before = beforeYes();
    const text = 'We have 300 Pro subscribers';
    expect(figureTheUserWroteFor(300, 'subscribers', text, scope(before))).toBe(true);
    const w = world(before);
    expect(await w.propose(text)).toMatchObject({ ok: true, mutated: false });
    expect(w.state.writes).toBe(0);
    const current = await w.caps.proposeIdentity!({ ...ctx('a few hundred'), user_text: 'We have 300 Pro subscribers\nUser: a few hundred' }, args) as Rec;
    expect(current).toMatchObject({ ok: false, mutated: false });
    expect(current).not.toHaveProperty('card');
    const historyOnly = await w.caps.proposeIdentity!({ ...ctx(''), user_text: text, user_turn_text: undefined }, args) as Rec;
    expect(historyOnly).toMatchObject({ ok: false, mutated: false });
    expect(historyOnly).not.toHaveProperty('card');
    expect(w.state.writes).toBe(0);
  });

  it.each([
    { name: 'not an asked part', args: { part_label: 'Pro plan price', value: 59, unit: '£ per Pro subscriber per month' } },
    { name: 'unknown label', args: { ...partArgs, part_label: 'Absent subscribers' } },
    { name: 'zero', args: { ...partArgs, value: 0 } },
    { name: 'negative', args: { ...partArgs, value: -300 } },
    { name: 'nonfinite', args: { ...partArgs, value: Infinity } },
    { name: 'missing unit', args: { part_label: partArgs.part_label, value: 300 } },
    { name: 'missing label', args: { value: 300, unit: 'subscribers' } },
  ])('R3 admission guard: $name cannot offer a card or write', async row => {
    const before = beforeYes();
    const w = world(before);
    const offered = await w.caps.proposeIdentity!(ctx('We have 300 Pro subscribers; price is £59 per Pro subscriber per month'), { parts: [row.args] } as never) as Rec;
    expect(offered).toMatchObject({ ok: false, mutated: false });
    expect(offered).not.toHaveProperty('card');
    expect(offered).not.toHaveProperty('proposal_id');
    expect(w.state.writes).toBe(0);
    expect(w.state.graph).toEqual(before);
  });

  it('R4: a token bound to 300 cannot approve 350, even with identical card words', () => {
    const before = beforeYes();
    const shown = reading(before);
    const changed = { ...shown, part_levels: [{ ...figure, raw_value: 350 }] };
    expect(identityConfirmReadingToken(shown)).not.toBe(identityConfirmReadingToken(changed));
    expect(press(before, changed, identityConfirmReadingToken(shown))).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
    expect(node(before, figure.part_id).observed_state).toBeUndefined();
  });

  it('R5 reload: GraphV3 → persistence projection keeps user_override and the confirmed identity', () => {
    const r = press(beforeYes());
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const cold = projectGraphForPersistence(GraphV3.parse(structuredClone(r.mutatedGraph))) as Rec;
    expect(node(cold, figure.part_id).observed_state).toMatchObject({ raw_value: 300, source: 'user_override', unit: 'subscribers' });
    expect(node(cold, 'mrr').nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
    expect(identityPartsWithoutLevel(cold, node(cold, 'mrr').nonlinear_identity.factor_ids)).toEqual([]);
  });

  it('R6: the user-levelled price was not asked; part_levels on it is refused whole', () => {
    const before = beforeYes();
    const unchanged = JSON.stringify(before);
    const r = press(before, reading(before, { part_id: 'pro_plan_price', raw_value: 59, unit: '£ per Pro subscriber per month' }));
    expect(r).toMatchObject({ kind: 'refused', reason: 'part_level_not_asked' });
    expect(JSON.stringify(before)).toBe(unchanged);
  });

  /** The existing arithmetic producer formats ISO currency codes. These explicit equivalent-unit readings use it;
   * the £59 row is arithmetic with the same 300 held, not a prediction of how many subscribers will remain.
   * identityReceiptWords currently has no numeric arithmetic; there is no £↔pence conversion producer here.
   */
  const arithmeticReading = (stored: Rec, price: number, period = 'month'): Rec => {
    const g = structuredClone(stored);
    const p = node(g, 'pro_plan_price');
    p.observed_state = { ...p.observed_state, raw_value: price, value: price / p.observed_state.cap, unit: `GBP/subscriber/${period}` };
    node(g, 'mrr').goal_threshold_unit = `GBP/${period}`;
    return g;
  };

  it('R7 Paul’s 2 Oct check 1: existing arithmetic says £14,700/month at £49 and £17,700/month at £59 with the user’s same 300', () => {
    const r = press(beforeYes());
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    for (const [price, total] of [[49, 14_700], [59, 17_700]]) {
      const be = breakEvenFor(arithmeticReading(r.mutatedGraph as Rec, price!));
      expect(be).toMatchObject({ baseline_price: price, baseline_volume: 300, baseline_volume_by: 'user', baseline_goal: total });
      // r15 copy re-pin, existing break-even rule: "its per-item denominator is not repeated:
      // \"£49 a month\", \"£12,250 a month\"". Count and arithmetic stay exact.
      expect(breakEvenLine(be!)).toContain(`at £${price} a month and 300 Pro paying subscribers, MRR is £${total!.toLocaleString('en-GB')} a month today.`);
    }
    expect(breakEvenFor(arithmeticReading(beforeYes(), 49))).toBeNull();
  });

  it('R7 annual control: the existing producer retains the annual basis rather than calling it monthly MRR', () => {
    const r = press(beforeYes());
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
    const annual = arithmeticReading(r.mutatedGraph as Rec, 49, 'year');
    node(annual, 'mrr').label = 'Annual recurring revenue';
    const be = breakEvenFor(annual);
    expect(be).toMatchObject({ baseline_goal: 14_700, unit: 'GBP/subscriber/year' });
    const words = breakEvenLine(be!);
    // The same existing "per-item denominator is not repeated" rule applies annually; monthly guard polarity stays.
    expect(words).toContain('Annual recurring revenue is £14,700 a year today.');
    expect(words).not.toContain('a month');
  });
});
