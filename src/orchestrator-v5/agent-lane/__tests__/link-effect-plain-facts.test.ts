/**
 * ⭐ A PLAIN ONE-SENTENCE FACT THAT USES THE ON-SCREEN NAMES IS RECORDABLE (DL restart 4 Oct 2026, defect C).
 *
 * SERVED (three signed-in journeys on staging, 4 Oct 15:20Z–16:11Z; `journey2/r2-*`, `r4-*`, `journey3/r2-*` … `r6-*`):
 * `propose_link_effect` refused five of six single sentences that named both ends by their exact labels and wrote both
 * figures. Each sentence below is the user's own, verbatim, against the labels that were on screen. Which sub-check
 * refused each one (measured on `5ade4ba`, before this change):
 *   · journey3 r2, r3 → `end_not_named`: the source "Price rise" is wholly inside the target "Customers lost to price
 *     rise", so it had no word of its own, and its whole label written out named nothing;
 *   · journey3 r5 → `figure_not_bound`: "removes" was no direction word, and the "lost" of the source's own LABEL was read
 *     as the target's movement, three words away from the £300;
 *   · journey2 r4 → `direction_not_stated` / `direction_contradicts`: "loses £300 … to churn" onto "MRR lost to price-rise
 *     churn" was read as that quantity FALLING, and the worked example after ", so" as a second movement;
 *   · journey2 r2 → `figure_not_bound`: the unit words "percentage point" stood between the figure and the source;
 *   · journey3 r4 (and r3, r5 once read) → the WRITER's `unit_mismatch`, said as "measured in its own unit": the served
 *     risk and outcome hold no unit and no scale at all.
 * The consent rule is unchanged in principle (PR Review on #2275): one statement of the user's names both ends, writes
 * both figures and says which way. The controls at the bottom still refuse.
 */
import { describe, expect, it } from 'vitest';
import { linkEffectTheUserStated, statingSentenceOf } from '../stated-by-user.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';

type Json = Record<string, any>;

// ── The labels on screen (journey3 `r2-chat.inner.txt`; journey2 `r2-chat.inner.txt`) ─────────────────────────────────
const J3 = ['Price rise', 'Starter tier monthly price', 'Starter tier subscribers', 'Customers lost to price rise',
  'Starter tier monthly recurring revenue', 'Monthly recurring revenue'];
const J2 = ['Existing-plan price change from today', 'Starter tier monthly price', 'Starter tier availability',
  'MRR lost to price-rise churn', 'Starter-tier MRR', 'monthly recurring revenue'];
type Effect = { amount: number; amount_unit: string; per_source_change: number; per_source_change_unit: string };
const rule = (quote: string, effect: Effect, source: string, target: string, quantities: readonly string[]) =>
  linkEffectTheUserStated(quote, effect, { source, target }, { quantities });

const R3 = 'Each 1% Price rise adds about 2 Customers lost to price rise, between 1 and 4.';
const R2 = 'Each 1% price rise loses about 2 customers, between 1 and 4, from Customers lost to price rise.';
const R4 = 'Each Starter tier subscribers adds £49 a month to Starter tier monthly recurring revenue.';
const R5 = 'Each Customers lost to price rise removes £300 a month of monthly recurring revenue.';
const R6 = 'Each Starter tier monthly price of £49 a month per subscriber adds £49 a month to Starter tier monthly recurring revenue.';
const J2R2 = 'Every 1 percentage point of Existing-plan price change from today adds £1,200 a month to monthly recurring revenue in GBP/month, so a 10% rise adds £12,000 a month before churn.';
const J2R4 = 'Each 1% price rise on existing plans loses about £300 a month of monthly recurring revenue to churn, so a 10% rise loses about £3,000 a month.';

const lost2: Effect = { amount: 2, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: '%' };
const starter49: Effect = { amount: 49, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'subscribers' };
const removes300: Effect = { amount: -300, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'customers' };

describe('the consent rule reads the served sentences as a careful reader does', () => {
  it('RED journey3 r3: a source label wholly inside the target\'s ("Price rise" in "Customers lost to price rise") is named by its whole label', () => {
    expect(rule(R3, lost2, 'Price rise', 'Customers lost to price rise', J3)).toBeNull();
  });
  it('RED journey3 r2: "loses about 2 customers … from Customers lost to price rise" says that loss GROWS by 2', () => {
    expect(rule(R2, lost2, 'Price rise', 'Customers lost to price rise', J3)).toBeNull();
  });
  it('journey3 r4: the rule already passed "Each Starter tier subscribers adds £49 a month to …" (the writer refused it)', () => {
    expect(rule(R4, starter49, 'Starter tier subscribers', 'Starter tier monthly recurring revenue', J3)).toBeNull();
  });
  it('RED journey3 r5: "removes £300 a month of monthly recurring revenue" is a fall of £300, per one of the source', () => {
    expect(rule(R5, removes300, 'Customers lost to price rise', 'Monthly recurring revenue', J3)).toBeNull();
  });
  it('RED journey2 r4: "loses about £300 a month … to churn" onto "MRR lost to price-rise churn" says that loss GROWS by £300', () => {
    expect(rule(J2R4, { amount: 300, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' },
      'Existing-plan price change from today', 'MRR lost to price-rise churn', J2)).toBeNull();
  });
  it('RED journey2 r2: "Every 1 percentage point of <source> adds £1,200 a month to <target>" — the unit words are part of the figure', () => {
    for (const unit of ['%', 'percentage points']) {
      expect(rule(J2R2, { amount: 1200, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: unit },
        'Existing-plan price change from today', 'monthly recurring revenue', J2), unit).toBeNull();
    }
  });
  it('the card quotes the ONE clause that states it, never the worked example after ", so"', () => {
    expect(statingSentenceOf(J2R4, { amount: 300, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' },
      { source: 'Existing-plan price change from today', target: 'MRR lost to price-rise churn' }, { quantities: J2 }))
      .toBe('Each 1% price rise on existing plans loses about £300 a month of monthly recurring revenue to churn');
  });
  it('plural or singular, "a month" or "/month": "Each Starter tier subscriber adds £49 a month to …" is the same statement', () => {
    expect(rule('Each Starter tier subscriber adds £49 a month to Starter tier monthly recurring revenue', starter49,
      'Starter tier subscribers', 'Starter tier monthly recurring revenue', J3)).toBeNull();
    expect(rule('Each lost customer removes £300 a month of monthly recurring revenue', removes300,
      'Customers lost to price rise', 'Monthly recurring revenue', J3)).toBeNull();
  });
});

describe('controls: what a careful reader would NOT accept still refuses, and for the precise reason', () => {
  it('a sentence naming only ONE end: "Each 1% rise adds about 2 Customers lost to price rise" never names "Price rise"', () => {
    expect(rule('Each 1% rise adds about 2 Customers lost to price rise', lost2, 'Price rise', 'Customers lost to price rise', J3)).toBe('end_not_named');
  });
  it('a sentence naming only ONE end: "Each 1% Price rise adds about 2" never names the target', () => {
    expect(rule('Each 1% Price rise adds about 2', lost2, 'Price rise', 'Customers lost to price rise', J3)).toBe('end_not_named');
  });
  it('a figure that belongs to a DIFFERENT link: r4\'s £49 is the starter tier\'s revenue, never the goal\'s', () => {
    expect(rule(R4, starter49, 'Starter tier subscribers', 'Monthly recurring revenue', J3)).toBe('end_not_named');
  });
  it('a figure that belongs to a DIFFERENT link: r5\'s £300 is per lost customer, never per 1% of "Price rise"', () => {
    expect(rule(R5, { ...removes300, per_source_change_unit: '%' }, 'Price rise', 'Monthly recurring revenue', J3)).not.toBeNull();
  });
  it('TWO candidate labels: "price rise" written once names neither "Price rise" nor a sibling that carries its words plus one written', () => {
    const two = [...J3, 'Enterprise price rise'];
    expect(rule('Each 1% enterprise price rise adds about 2 Customers lost to price rise', lost2, 'Price rise', 'Customers lost to price rise', two))
      .toBe('end_not_named');
    // …and the sibling it does name is still recordable.
    expect(rule('Each 1% enterprise price rise adds about 2 Customers lost to price rise', lost2, 'Enterprise price rise', 'Customers lost to price rise', two))
      .toBeNull();
  });
  it('the OPPOSITE sign for a loss that grows: −2 on "adds about 2 Customers lost to price rise" contradicts the words', () => {
    expect(rule(R3, { ...lost2, amount: -2 }, 'Price rise', 'Customers lost to price rise', J3)).toBe('direction_contradicts');
    expect(rule(R2, { ...lost2, amount: -2 }, 'Price rise', 'Customers lost to price rise', J3)).toBe('direction_contradicts');
  });
  it('a loss verb onto a quantity that is NOT a loss still says it falls: +£300 on r5 contradicts "removes"', () => {
    expect(rule(R5, { ...removes300, amount: 300 }, 'Customers lost to price rise', 'Monthly recurring revenue', J3)).toBe('direction_contradicts');
  });
  it('a range end is never the size: "between 1 and 4" does not make 4 (or 1) the user\'s figure for the link', () => {
    expect(rule(R3, { ...lost2, amount: 4 }, 'Price rise', 'Customers lost to price rise', J3)).not.toBeNull();
  });
  it('journey3 r6 stays refused: "monthly price of £49 a month per subscriber" is a LEVEL, and sizes no change', () => {
    expect(rule(R6, { amount: 49, amount_unit: '£/month', per_source_change: 49, per_source_change_unit: '£ per subscriber / month' },
      'Starter tier monthly price', 'Starter tier monthly recurring revenue', J3)).not.toBeNull();
  });
  it('a label\'s own words are a NAME, never a movement: "Customers lost to price rise" alone says no direction', () => {
    expect(rule('Each 1% Price rise and 2 Customers lost to price rise', lost2, 'Price rise', 'Customers lost to price rise', J3)).toBe('direction_not_stated');
  });
  it('a denial or a question is still not a statement', () => {
    expect(rule('Each 1% Price rise does not add 2 Customers lost to price rise', lost2, 'Price rise', 'Customers lost to price rise', J3)).toBe('denied');
    expect(rule('Does each 1% Price rise add about 2 Customers lost to price rise?', lost2, 'Price rise', 'Customers lost to price rise', J3)).toBe('question');
  });
});

// ── The door and the writer, on a model with the served labels ───────────────────────────────────────────────────────
const edge = (from: string, to: string, mean: number): Json => ({ from, to, strength: { mean, std: 0.125 }, defaulted: true,
  provenance: { source: 'cee_hypothesis' }, effect_direction: mean < 0 ? 'negative' : 'positive', exists_probability: 0.8 });
/** `quantified: false` is the SERVED shape: the risk and the outcome are `{label, provenance}` only. */
function journey3Graph(quantified: boolean): Json {
  const frame = (unit: string, scale: number): Json => (quantified ? { scale_frame: scale, observed_state: { unit, value: 0, raw_value: 0, source: 'cee_inference' } } : {});
  return {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'monthly recurring revenue', provenance: 'from_brief' },
      { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue', provenance: 'from_brief', goal_direction: '>=', goal_threshold: 0.8,
        goal_threshold_cap: 187500, goal_threshold_raw: 150000, goal_threshold_unit: 'GBP per month', goal_threshold_frame: 'level' },
      { id: 'raise', kind: 'option', label: 'Raise prices by 10%', provenance: 'from_brief',
        interventions: { price_rise: { unit: '%', value: 0.1, source: 'brief_extraction', raw_value: 10 } } },
      { id: 'starter', kind: 'option', label: 'Launch starter tier', provenance: 'from_brief',
        interventions: { starter_subs: { unit: 'subscribers', value: 0.15, source: 'brief_extraction', raw_value: 150 } } },
      { id: 'keep', kind: 'option', label: 'Keep pricing as it is', provenance: 'from_brief', is_baseline: true },
      { id: 'price_rise', kind: 'factor', label: 'Price rise', category: 'controllable', provenance: 'from_brief',
        observed_state: { cap: 100, unit: '%', value: 0, source: 'cee_inference', raw_value: 0 } },
      { id: 'starter_price', kind: 'factor', label: 'Starter tier monthly price', category: 'controllable', provenance: 'from_brief',
        observed_state: { cap: 100, unit: 'GBP per subscriber / month', value: 0, source: 'cee_inference', raw_value: 0 } },
      { id: 'starter_subs', kind: 'factor', label: 'Starter tier subscribers', category: 'controllable', provenance: 'from_brief',
        observed_state: { cap: 1000, unit: 'subscribers', value: 0, source: 'cee_inference', raw_value: 0 } },
      { id: 'customers_lost', kind: 'risk', label: 'Customers lost to price rise', provenance: 'from_brief', ...frame('customers', 400) },
      { id: 'starter_mrr', kind: 'outcome', label: 'Starter tier monthly recurring revenue', provenance: 'from_brief', ...frame('GBP per month', 50000) },
    ],
    edges: [
      edge('decision', 'raise', 1), edge('decision', 'starter', 1), edge('decision', 'keep', 1),
      edge('raise', 'price_rise', 1), edge('starter', 'starter_subs', 1),
      edge('price_rise', 'mrr', 0.5), edge('price_rise', 'customers_lost', 0.5), edge('customers_lost', 'mrr', -0.5),
      edge('starter_subs', 'starter_mrr', 0.5), edge('starter_price', 'starter_mrr', 0.5), edge('starter_mrr', 'mrr', 0.5),
    ],
  };
}
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'r', user_text });
function world(graph: Json) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, store), store };
}
type LinkArgs = Effect & { from_label: string; to_label: string; quote: string };
const args = (from_label: string, to_label: string, effect: Effect, quote: string): LinkArgs => ({ from_label, to_label, ...effect, quote });
const A3 = args('Price rise', 'Customers lost to price rise', lost2, R3);
const A4 = args('Starter tier subscribers', 'Starter tier monthly recurring revenue', starter49, R4);
const A5 = args('Customers lost to price rise', 'Monthly recurring revenue', removes300, R5);

describe('propose_link_effect on the served labels', () => {
  it.each([['r3', A3, R3], ['r4', A4, R4], ['r5', A5, R5]] as const)(
    'RED journey3 %s, both ends quantified: prepared as ONE change, quoting the user\'s sentence', async (_n, a, said) => {
      const { caps, store } = world(journey3Graph(true));
      const r = await caps.proposeLinkEffect!(ctxSaying(said), a) as Json;
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const p = store.get(String(r.proposal_id))!;
      expect(p.provenance.authored_by).toBe('user_stated');
      expect(p.operations).toHaveLength(1);
      // No figure the user did not write: the stored effect is exactly the two figures of the sentence.
      expect((p.operations[0]!.value as Json).effect).toEqual({ amount: a.amount, amount_unit: a.amount_unit,
        per_source_change: a.per_source_change, per_source_change_unit: a.per_source_change_unit });
      expect(String((p.operations[0]!.value as Json).quote)).toBe(said.replace(/\.$/, ''));
    });

  it('the unit as the user and the model say it: "£ a month", "GBP/month", "customer", "subscriber" are the ends\' own units', async () => {
    for (const [a, said, over] of [
      [A4, R4, { amount_unit: '£ a month', per_source_change_unit: 'subscriber' }],
      [A4, R4, { amount_unit: 'GBP/month' }],
      [A5, R5, { per_source_change_unit: 'customer', amount_unit: '£ per month' }],
    ] as const) {
      const { caps } = world(journey3Graph(true));
      const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...a, ...over }) as Json;
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  });

  it('the decision shares the goal\'s name (served: "monthly recurring revenue"): a size is about the QUANTITY, so r5 is not ambiguous', async () => {
    const g = journey3Graph(true);
    expect(g.nodes.filter((n: Json) => String(n.label).toLowerCase() === 'monthly recurring revenue').map((n: Json) => n.kind)).toEqual(['decision', 'goal']);
    const r = await world(g).caps.proposeLinkEffect!(ctxSaying(R5), A5) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((r.link as Json).to).toBe('Monthly recurring revenue');
  });
  it('control: TWO QUANTITIES with one name are still ambiguous — nothing is prepared, single or grouped', async () => {
    const g = journey3Graph(true);
    g.nodes.push({ id: 'price_rise_2', kind: 'factor', label: 'Price rise', category: 'controllable', provenance: 'ai_inferred',
      observed_state: { cap: 100, unit: '%', value: 0, source: 'cee_inference', raw_value: 0 } });
    const one = world(g);
    const r = await one.caps.proposeLinkEffect!(ctxSaying(R3), A3) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'ambiguous_entity' }));
    expect((r.ambiguous_targets as Json[])[0]!.candidates).toHaveLength(2);
    const many = world(g);
    const grouped = await many.caps.proposeLinkEffect!(ctxSaying(`${R3} ${R4}`), { links: [A3, A4] }) as Json;
    expect((grouped.not_prepared as Json[]).map((x) => x.refusal)).toEqual(['ambiguous_entity']);
    expect(many.store.get(String(grouped.proposal_id))!.operations).toHaveLength(1);
    expect(one.store.size()).toBe(0);
  });
  it('control: a name that is only an OPTION is not a link end, and the refusal says so', async () => {
    const { caps, store } = world(journey3Graph(true));
    const r = await caps.proposeLinkEffect!(ctxSaying(R5), { ...A5, from_label: 'Launch starter tier' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unresolved_entity' }));
    expect(String(r.detail)).toContain('is an option, not a quantity');
    expect(store.size()).toBe(0);
  });

  it('RED multi-link: the three served facts in ONE message are prepared in ONE approval (the same per-link checks)', async () => {
    const { caps, store } = world(journey3Graph(true));
    const text = `${R3} ${R4} ${R5}`;
    const r = await caps.proposeLinkEffect!(ctxSaying(text), { links: [A3, A4, A5] }) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.not_prepared).toBeUndefined();
    expect(store.get(String(r.proposal_id))!.operations).toHaveLength(3);
  });

  /**
   * THE RULE FOR AN END THAT HOLDS NO UNIT (the served shape). A size is a strength on the two ends' SCALES; an end with no
   * unit and no scale has nothing to convert against, and a scale is a number the user did not state — so the stated unit
   * is NOT adopted here. The refusal names that one end, says the user's wording is not the problem, and never says
   * "measured in its own unit".
   */
  it.each([
    ['r3', A3, R3, 'target_not_quantified', 'Customers lost to price rise'],
    ['r4', A4, R4, 'target_not_quantified', 'Starter tier monthly recurring revenue'],
    ['r5', A5, R5, 'source_not_quantified', 'Customers lost to price rise'],
  ] as const)('RED journey3 %s as SERVED (the end holds no unit): refused naming the one end that is not quantified', async (_n, a, said, refusal, end) => {
    const { caps, store } = world(journey3Graph(false));
    const r = await caps.proposeLinkEffect!(ctxSaying(said), a) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal }));
    expect(String(r.detail)).toContain(`"${end}" has no unit`);
    expect(String(r.detail)).toMatch(/not (?:their|the user.s) wording/i);
    expect(String(r.detail)).not.toContain('its own unit');
    expect(store.size()).toBe(0);
  });

  it('multi-link as SERVED: each unquantified link is listed with its own precise reason, none is stored', async () => {
    const { caps, store } = world(journey3Graph(false));
    const r = await caps.proposeLinkEffect!(ctxSaying(`${R3} ${R4} ${R5}`), { links: [A3, A4, A5] }) as Json;
    expect(r.ok).toBe(false);
    expect((r.not_prepared as Json[]).map((x) => x.refusal)).toEqual(['target_not_quantified', 'target_not_quantified', 'source_not_quantified']);
    expect(store.size()).toBe(0);
  });

  it('every consent refusal names ONE precise thing to ask (never a bare code)', async () => {
    const { caps } = world(journey3Graph(true));
    const ask = async (said: string, a: LinkArgs): Promise<Json> => await caps.proposeLinkEffect!(ctxSaying(said), { ...a, quote: said }) as Json;
    const unnamed = await ask('Each 1% rise adds about 2 Customers lost to price rise', A3);
    expect(unnamed).toEqual(expect.objectContaining({ ok: false, refusal: 'not_the_users_statement', why: 'end_not_named' }));
    expect(String(unnamed.detail)).toContain('does not name "Price rise"');
    const wrongWay = await ask(R3, { ...A3, amount: -2 });
    expect(wrongWay).toEqual(expect.objectContaining({ ok: false, refusal: 'not_the_users_statement', why: 'direction_contradicts' }));
    expect(String(wrongWay.detail)).toMatch(/"Customers lost to price rise" goes UP/);
    const noWay = await ask('Each 1% Price rise and 2 Customers lost to price rise', A3);
    expect(noWay).toEqual(expect.objectContaining({ ok: false, why: 'direction_not_stated' }));
    expect(String(noWay.detail)).toMatch(/whether "Customers lost to price rise" goes up or down/);
    const level = await ask(R6, args('Starter tier monthly price', 'Starter tier monthly recurring revenue',
      { amount: 49, amount_unit: 'GBP per month', per_source_change: 49, per_source_change_unit: 'GBP per subscriber / month' }, R6));
    expect(level.ok).toBe(false);
    expect(String(level.detail)).toMatch(/Ask the user ONE thing/);
  });
});

describe('the writer refuses an end with no unit by name, and reads the end\'s own unit however it is spelled', () => {
  const write = (graph: Json, from: string, to: string, effect: Effect) => {
    const p = { persistedGraph: graph, from, to, effect, quote: 'q',
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, from, to)! } };
    return applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p) });
  };
  it('target with no unit → target_not_quantified; source with no unit → source_not_quantified; nothing written', () => {
    expect(write(journey3Graph(false), 'starter_subs', 'starter_mrr', starter49)).toEqual({ kind: 'refused', reason: 'target_not_quantified' });
    expect(write(journey3Graph(false), 'customers_lost', 'mrr', removes300)).toEqual({ kind: 'refused', reason: 'source_not_quantified' });
  });
  it('control: a unit of ANOTHER kind on a quantified end is still unit_mismatch (never converted by guess)', () => {
    expect(write(journey3Graph(true), 'starter_subs', 'starter_mrr', { ...starter49, amount_unit: 'customers' })).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
    expect(write(journey3Graph(true), 'starter_subs', 'starter_mrr', { ...starter49, amount_unit: '£/year' })).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
    expect(write(journey3Graph(true), 'starter_subs', 'starter_mrr', { ...starter49, amount_unit: '$/month' })).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
    expect(write(journey3Graph(true), 'starter_subs', 'starter_mrr', { ...starter49, per_source_change_unit: 'customers' })).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it('a unit but no scale: the refusal names that end, and asks for its level only where this conversation can record one', async () => {
    const g = journey3Graph(true);
    const outcome = g.nodes.find((n: Json) => n.id === 'starter_mrr');
    delete outcome.scale_frame;
    outcome.observed_state = { unit: 'GBP per month', value: 5, raw_value: 5, source: 'cee_inference' };
    const r = await world(g).caps.proposeLinkEffect!(ctxSaying(R4), A4) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unconvertible' }));
    expect(String(r.detail)).toContain('"Starter tier monthly recurring revenue" has a unit (GBP per month) but no level or range');
    expect(String(r.detail)).toContain('cannot be added from this conversation yet');
    expect(String(r.detail)).not.toMatch(/\(unconvertible\)/);
  });
  it('written: the size is exactly the user\'s two figures on the ends\' scales, recorded as theirs', () => {
    const r = write(journey3Graph(true), 'starter_subs', 'starter_mrr', starter49);
    expect(r.kind).toBe('mutated');
    const e = ((r as Json).mutatedGraph.edges as Json[]).find((x) => x.from === 'starter_subs' && x.to === 'starter_mrr')!;
    expect(e.provenance).toEqual(expect.objectContaining({ source: 'user_specified', magnitude: 'user_stated' }));
    expect(e.provenance.natural_effect).toEqual(expect.objectContaining({ amount: 49, per_source_change: 1 }));
    expect(e.strength.mean).toBeCloseTo((49 / 50000) / (1 / 1000), 12);
  });
});
