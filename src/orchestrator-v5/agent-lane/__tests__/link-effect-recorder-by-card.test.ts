/**
 * ⭐ RT-6 — THE RECORDER BY CARD (red team #87 5992627435; HARNESS INTEGRATION lease 5992873873, Integrator CHAIN OK
 * 5992907492; MC's PR-D conditions). Served bytes: the guest model from the staging repro (`c6dcb3dd`, CEE a4977d9):
 * Olumi's link "Footfall lost from price rise" (a risk with NO unit) → "Gross margin" (a % goal), sized by the drafter
 * as −1 percentage point per +5 '%'. On staging the user's two plain answers were refused (direction_not_stated,
 * direction_contradicts), and a figure stated in the very unit Olumi used was then refused as unit_mismatch.
 * 0 LLM calls; the approval row writes through the REAL writer (`applyLinkEffectEdit`) and reads the link back.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import { approvalChipsFor } from '../approval-chips.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { linkEffectPrefilter } from '../link-effect-prefilter.js';
import { linkEffectTheUserStated } from '../stated-by-user.js';

type Json = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-rt6-bakery-footfall-margin-c6dcb3dd.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const FOOTFALL = 'Footfall lost from price rise';
const MARGIN = 'Gross margin';
const LINK = { from_label: FOOTFALL, to_label: MARGIN, amount: -2, amount_unit: 'percentage points', per_source_change: 5, per_source_change_unit: '%' };
/** The red team's words, verbatim (#87 5992627435), each refused 2/2 on staging. */
const SAID_UP = 'When footfall lost from price rise goes up by 5%, gross margin falls by about 2 percentage points.';
const SAID_FALL = 'A 5% fall in footfall would cost us about 2 percentage points of gross margin.';

const ctxSaying = (user_text: string) => ({ scenario_id: '0c6dcb3d-de66-4b46-8860-4b7dce0bb107', authenticated_user_id: null, request_id: 'rt6', user_text });
const ctxPressing = (proposalId: string, words: string) => ({ ...ctxSaying(words), typed_approval_of: proposalId, typed_approval_words: words });

/** A world over a MUTABLE copy of the served graph; the level door writes link effects through the real writer. */
function world(graph: Json = structuredClone(SERVED)) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    // One link arrives as `link_effect`, a grouped approval as `link_effects` (`dispatch.ts` CommitOptionLevelsInput).
    for (const le of [...(input.link_effects ?? []), ...(input.link_effect !== undefined ? [input.link_effect] : [])]) {
      const r = applyLinkEffectEdit({ persistedGraph: graph, from: le.from, to: le.to, effect: le.effect,
        expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: le.edge_token }, quote: le.quote, reading_token: le.reading_token });
      if (r.kind === 'refused') throw new Error(`writer refused at approval: ${r.reason}`);
      const next = r.mutatedGraph as Json;
      graph.edges = next.edges;
      graph.nodes = next.nodes;
    }
    return { status: 'committed', graph_hash: 'h-after', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  return { caps: createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels }), store, graph };
}
const cardFor = (store: ProposalStore, r: Json) => approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
  (id) => ({ proposal: store.get(id), result: r as never }))[0]!;
const linkOf = (g: Json) => (g.edges as Json[]).find((e) => e.from === 'footfall_lost_from_price_rise' && e.to === 'gross_margin')!;

describe('RT-6 recorder by card: the user\'s plain answer reaches an approval card, and the card is the consent', () => {
  it.each([['"a 5% fall in footfall" (was direction_contradicts)', SAID_FALL]])(
    'P1 %s → ONE card showing the signed reading, both ends, and the user\'s words', async (_why, said) => {
      const { caps, store } = world();
      const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.reading_check, 'Olumi, not the word rule, read these words: the user is asked to check').toBe('read_by_olumi');
      expect(String(r.note)).toContain('which way each one moves');
      const card = cardFor(store, r);
      expect(card.detail).toContain(`"${FOOTFALL}"`);
      expect(card.detail).toContain(`"${MARGIN}"`);
      expect(card.detail).toMatch(/\+5\s?%/);
      expect(card.detail).toContain('−2 percentage points');
      expect(card.detail).toContain(said);
      expect(store.get(String(r.proposal_id))!.provenance.authored_by).toBe('user_stated');
    });

  it('P2 approve from the card → the REAL writer records THEIR figure in the link\'s own unit, and the read-back says recorded', async () => {
    const { caps, store, graph } = world();
    expect(linkOf(graph).provenance.magnitude, 'control: Olumi\'s estimate before').toBe('olumi_estimate');
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID_FALL), { ...LINK, quote: SAID_FALL }) as Json;
    const out = await caps.authoriseChange(ctxPressing(String(r.proposal_id), cardFor(store, r).message), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(linkOf(graph).provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated',
      natural_effect: { amount: -2, amount_unit: 'percentage points', per_source_change: 5, per_source_change_unit: '%' } });
    expect(linkOf(graph).effect_direction).toBe('negative');
    // The adopted unit was stored, so the link stays stateable: a second statement in the same unit is prepared too.
    const again = 'A 5% fall in footfall would cost us about 3 percentage points of gross margin.';
    const r2 = await caps.proposeLinkEffect!(ctxSaying(again), { ...LINK, amount: -3, quote: again }) as Json;
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
  });

  it('P3 control: words the rule reads itself are prepared with no extra check asked', async () => {
    const { caps } = world();
    const said = 'Each 5% rise in footfall lost from price rise costs us about 2 percentage points of gross margin.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('reading_check');
  });

  it.each([
    // Codex buddy P1s (#2586 @7d906c28 and @d75fedbd): a figure that sizes something else never reaches a card.
    ['a budget', 'Our budget is 5% for footfall and gross margin varies by 2 percentage points.', 'direction_not_stated'],
    ["today's level", 'Footfall lost from price rise is 5% today and gross margin falls by about 2 percentage points.', 'figure_not_bound'],
    ['a budget that goes up', 'Our budget for footfall goes up by 5%, gross margin falls by about 2 percentage points.', 'direction_not_stated'],
    ['a target level', 'When footfall goes up by 5%, gross margin of 2 percentage points is our target.', 'direction_not_stated'],
    ["a target's current level", "When footfall goes up by 5%, gross margin of 2 percentage points is today's level.", 'direction_not_stated'],
  ])('N %s → refused with its true typed reason, nothing prepared or proposed', async (_why, said, why) => {
    const ends = { source: FOOTFALL, target: MARGIN };
    const scope = { quantities: (SERVED.nodes as Json[]).filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => String(n.label)) };
    expect(linkEffectPrefilter(said, LINK, ends, scope)).toEqual(expect.objectContaining({ kind: 'refused',
      refusal: 'not_the_users_statement', why }));
    const { caps, store } = world();
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false,
      refusal: 'not_the_users_statement', why }));
    expect(r).not.toHaveProperty('proposal_id');
    expect(store.outstanding('0c6dcb3d-de66-4b46-8860-4b7dce0bb107', null)).toEqual([]);
  });

  // ⚠ FOLLOW-UP, pinned as it stands: an end whose NAME holds movement words ("footfall LOST from price RISE") defeats
  // the word rule's early direction read. Widening the rule to read it let a budget and a target level through (Codex
  // buddy r2), so these stay refused with their true reason — the Agent asks again, nothing is fabricated.
  it.each([
    ['SAID_UP', SAID_UP],
    ['"rises by 5%"', 'When footfall lost from price rise rises by 5%, gross margin falls by about 2 percentage points.'],
  ])('FOLLOW-UP %s stays refused (direction_not_stated), nothing proposed', async (_why, said) => {
    const { caps, store } = world();
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'not_the_users_statement', why: 'direction_not_stated' }));
    expect(store.outstanding('0c6dcb3d-de66-4b46-8860-4b7dce0bb107', null)).toEqual([]);
  });

  it('direct rule: card mode skips ONLY the final sign checks; the early direction miss, binding and change checks still refuse', () => {
    const ends = { source: FOOTFALL, target: MARGIN };
    const scope = { quantities: (SERVED.nodes as Json[]).filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => String(n.label)) };
    expect(linkEffectTheUserStated(SAID_FALL, LINK, ends, scope)).toBe('direction_contradicts');
    expect(linkEffectTheUserStated(SAID_FALL, LINK, ends, scope, { directionOnCard: true })).toBeNull();
    const budget = 'Our budget is 5% for footfall and gross margin varies by 2 percentage points.';
    expect(linkEffectTheUserStated(budget, LINK, ends, scope, { directionOnCard: true })).toBe('direction_not_stated');
    const level = 'Footfall lost from price rise is 5% today and gross margin falls by about 2 percentage points.';
    expect(linkEffectTheUserStated(level, LINK, ends, scope, { directionOnCard: true })).toBe('figure_not_bound');
  });

  it.each([
    ['a question', 'Does a 5% rise in footfall lost cost about 2 percentage points of gross margin?', 'not_the_users_statement', 'question'],
    ['a negation', "A 5% rise in footfall lost wouldn't cost 2 percentage points of gross margin.", 'not_the_users_statement', 'denied'],
    // A third figure: the validator cannot pick the two, so the direction miss stays the refusal it always was.
    ['a third figure', 'A 5% fall in footfall would cost us about 2, maybe 3 percentage points of gross margin.', 'not_the_users_statement', 'direction_contradicts'],
    ['a corrected figure', 'An 8%, no, a 5% fall in footfall costs about 2 percentage points of gross margin.', 'not_the_users_statement', 'denied'],
    ['no figures', 'Footfall lost from price rise matters a lot for gross margin.', 'not_the_users_figure', 'figures_not_written'],
  ])('N %s → refused with its true typed reason, nothing stored', async (_why, said, refusal, why) => {
    const { caps, store } = world();
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal, why }));
    expect(store.outstanding('0c6dcb3d-de66-4b46-8860-4b7dce0bb107', null)).toEqual([]);
  });

  it('N figures the words do not write (another unit, another number) → refused, never filled in', async () => {
    const { caps } = world();
    for (const args of [{ ...LINK, per_source_change_unit: '£' }, { ...LINK, amount: -3 }]) {
      const r = await caps.proposeLinkEffect!(ctxSaying(SAID_FALL), { ...args, quote: SAID_FALL }) as Json;
      expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'not_the_users_figure', why: 'figures_not_written' }));
    }
  });

  it('S the sign-inverted reading of "a 5% fall in footfall" (−5 on footfall LOST) is refused by the writer\'s sign guard', async () => {
    const { caps } = world();
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID_FALL), { ...LINK, per_source_change: -5, quote: SAID_FALL }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'sign_conflict' }));
  });

  it('T twin (Integrator row 1, proposer ⊆ writer): the same link with NO stored size has no unit to adopt → no card, the true reason', async () => {
    const graph = structuredClone(SERVED);
    const { natural_effect: _dropped, ...kept } = linkOf(graph).provenance;
    linkOf(graph).provenance = kept;
    const { caps } = world(graph);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID_FALL), { ...LINK, quote: SAID_FALL }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).toContain(`"${FOOTFALL}" has no unit or scale`);
    expect(String(r.detail), 'the % goal is never called unitless').not.toContain(`"${MARGIN}" has no unit`);
  });

  it('C contrast: an end WITH its own unit stays strict (a £ figure for the % "Bread price increase" → unit_mismatch)', async () => {
    const { caps } = world();
    const said = 'Every £1 on the bread price adds about 2 percentage points of gross margin.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { from_label: 'Bread price increase', to_label: MARGIN,
      amount: 2, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£', quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).not.toContain('has no unit or scale');
  });
});

/**
 * Science RULED YES, amended (#87 5993238492): a % LEVEL goal's change is said in points (1 point = 1 raw unit of the
 * level). P5 reads it through the WRITER's comparator. Rows (a)–(d) as Science asked; the mutant reverts the comparator.
 * The served graph with every goal-path link made the user's own, so P5 turns on the unit alone.
 */
function goalPath(unit: string, magnitude: 'user_stated' | 'olumi_estimate', goal?: Json): Json {
  const g = structuredClone(SERVED);
  const kind = new Map((g.nodes as Json[]).map((n) => [n.id, n.kind]));
  for (const e of g.edges as Json[]) {
    delete e.defaulted;
    if (e.to === 'gross_margin') {
      e.provenance = { source: magnitude === 'user_stated' ? 'user_specified' : 'cee_hypothesis', magnitude,
        natural_effect: { amount: -1, amount_unit: unit, per_source_change: 5, per_source_change_unit: '%' } };
    } else if (kind.get(e.from) !== 'option' && kind.get(e.from) !== 'decision') {
      e.provenance = { ...(e.provenance ?? {}), source: 'user_specified', magnitude: 'user_stated' };
    }
  }
  if (goal !== undefined) Object.assign((g.nodes as Json[]).find((n) => n.id === 'gross_margin')!, goal);
  return g;
}
const p5Of = (g: Json): Json[] => { const v = targetTestabilityOf(g) as Json; return v.kind === 'not_testable' ? (v.failures as Json[]).filter((f) => f.precondition === 'P5') : []; };

describe('RT-6 row 2 (Science): points size a % LEVEL goal, through the writer\'s own comparator', () => {
  it('(a) the user\'s figure in percentage points into the % level "Gross margin" → P5 passes', () => {
    expect(p5Of(goalPath('percentage points', 'user_stated'))).toEqual([]);
  });
  it('(b) contrast: the same links as Olumi\'s estimates stay unsized (only the user\'s own figure licenses)', () => {
    expect(p5Of(goalPath('percentage points', 'olumi_estimate')).length).toBeGreaterThan(0);
  });
  it('(c) a relative "%" for a % level goal is never taken as points: the writer refuses it and asks for points', async () => {
    const { caps, store } = world();
    const said = 'When footfall lost from price rise goes up by 5%, gross margin falls by about 2%.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, amount_unit: '%', quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).toContain('recorded in percentage points');
    expect(store.outstanding('0c6dcb3d-de66-4b46-8860-4b7dce0bb107', null)).toEqual([]);
  });
  it('(d) a COUNT goal is not a % level: points into it stay unsized', () => {
    const count = goalPath('percentage points', 'user_stated', { goal_threshold_unit: 'customers', goal_threshold_raw: 600, goal_threshold_cap: 1000 });
    expect(p5Of(count).length).toBeGreaterThan(0);
  });
});
