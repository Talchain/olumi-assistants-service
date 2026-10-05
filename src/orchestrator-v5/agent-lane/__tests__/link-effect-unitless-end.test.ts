/**
 * RT-6 — the unitless end's stored link unit, through the REAL proposer, approval and writer.
 * Served bytes: "Footfall lost from price rise" has no unit; its link to "Gross margin" was sized by Olumi
 * as −1 percentage point per +5 '%'. A sentence the served word rule reads must be recordable in that same unit.
 * P is RED on origin/staging (unit_mismatch). The word rule and proposer remain staging's; the card path is follow-up.
 * No LLM calls: approval writes through applyLinkEffectEdit, then authoriseChange reads the stored link back.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Json = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-rt6-bakery-footfall-margin-c6dcb3dd.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const SCENARIO = '0c6dcb3d-de66-4b46-8860-4b7dce0bb107';
const SOURCE = 'footfall_lost_from_price_rise';
const TARGET = 'gross_margin';
const FOOTFALL = 'Footfall lost from price rise';
const MARGIN = 'Gross margin';
const LINK = { from_label: FOOTFALL, to_label: MARGIN, amount: -2, amount_unit: 'percentage points', per_source_change: 5, per_source_change_unit: '%' };
const SAID_READ = 'Each 5% rise in footfall lost from price rise costs us about 2 percentage points of gross margin.';
const STATED_READ = SAID_READ.slice(0, -1); // staging stores the ONE sentence read, without its terminating period.
/** The red team's words, verbatim, stay refused by the served rule; interpreting them on a card is follow-up. */
const SAID_UP = 'When footfall lost from price rise goes up by 5%, gross margin falls by about 2 percentage points.';
const SAID_FALL = 'A 5% fall in footfall would cost us about 2 percentage points of gross margin.';

const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'rt6', user_text });
const ctxPressing = (proposalId: string, words: string) => ({ ...ctxSaying(words), typed_approval_of: proposalId, typed_approval_words: words });

/** A world over a MUTABLE copy of the served graph; the level door writes through the real link-effect writer. */
function world(graph: Json = structuredClone(SERVED)) {
  const store = new ProposalStore();
  const commits: CommitOptionLevelsInput[] = [];
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    for (const le of [...(input.link_effects ?? []), ...(input.link_effect !== undefined ? [input.link_effect] : [])]) {
      const r = applyLinkEffectEdit({ persistedGraph: graph, from: le.from, to: le.to, effect: le.effect,
        expected: { graph_hash: input.base_graph_hash, edge_token: le.edge_token }, quote: le.quote, reading_token: le.reading_token });
      if (r.kind === 'refused') throw new Error(`writer refused at approval: ${r.reason}`);
      const next = r.mutatedGraph as Json;
      graph.edges = next.edges;
      graph.nodes = next.nodes;
    }
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null,
      already_applied: false, committed_levels: [], links_resized: [] };
  };
  return { caps: createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels }), store, graph, commits };
}
const cardFor = (store: ProposalStore, r: Json) => approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
  (id) => ({ proposal: store.get(id), result: r as never }))[0]!;
const linkOf = (g: Json, from = SOURCE, to = TARGET) => (g.edges as Json[]).find((e) => e.from === from && e.to === to)!;

/** A refusal binds the exact typed reason, no offer, and the identified stored link's unchanged provenance. */
function expectRefused(r: Json, refusal: string, why: string | undefined, store: ProposalStore, graph: Json,
  before: Json, from = SOURCE, to = TARGET) {
  expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal }));
  if (why === undefined) expect(r).not.toHaveProperty('why');
  else expect(r.why).toBe(why);
  expect(r).not.toHaveProperty('proposal_id');
  expect(store.outstanding(SCENARIO, null)).toEqual([]);
  expect(linkOf(graph, from, to)).toMatchObject({ from, to });
  expect(linkOf(graph, from, to).provenance).toEqual(before);
}

describe('RT-6 writer: a unitless end adopts only the unit already held on its own link', () => {
  it('P the served rule reads the statement → a card approves the REAL writer, stored provenance and recorded read-back', async () => {
    const { caps, store, graph, commits } = world();
    const before = structuredClone(linkOf(graph).provenance);
    expect(linkOf(graph)).toMatchObject({ from: SOURCE, to: TARGET,
      provenance: { magnitude: 'olumi_estimate', natural_effect: { per_source_change_unit: '%' } } });
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID_READ), { ...LINK, quote: SAID_READ }) as Json;
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false,
      link: { from: FOOTFALL, to: MARGIN, effect: { amount: -2, amount_unit: 'percentage points',
        per_source_change: 5, per_source_change_unit: '%' }, your_words: STATED_READ } }));
    expect(r).not.toHaveProperty('reading_check');
    const proposalId = String(r.proposal_id);
    const proposal = store.get(proposalId)!;
    expect(proposal.proposal_id).toBe(proposalId);
    expect(proposal.provenance).toEqual({ authored_by: 'user_stated', basis: STATED_READ });
    expect(proposal.operations).toEqual([{ op: 'set_link_effect', path: `${SOURCE}::${TARGET}`,
      value: { from: SOURCE, to: TARGET, effect: { amount: -2, amount_unit: 'percentage points',
        per_source_change: 5, per_source_change_unit: '%' }, quote: STATED_READ, edge_token: expect.any(String) } }]);
    expect(store.outstanding(SCENARIO, null).map((p) => p.proposal_id)).toEqual([proposalId]);
    expect(linkOf(graph).provenance).toEqual(before); // proposing never writes.
    expect(commits).toEqual([]);
    const card = cardFor(store, r);
    expect(card.id).toBe(approvalChipIdFor(proposalId));
    expect(card.detail).toContain(`"${FOOTFALL}"`);
    expect(card.detail).toContain(`"${MARGIN}"`);
    expect(card.detail).toMatch(/\+5\s?%/);
    expect(card.detail).toContain('−2 percentage points');
    expect(card.detail).toContain(STATED_READ);

    const out = await caps.authoriseChange(ctxPressing(proposalId, card.message), { proposal_id: proposalId }) as Json;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true, proposal_id: proposalId,
      revision_before: proposal.base_graph_identity_hash, revision_after: computeAnalysisAffectingGraphHash(graph as never),
      follow_up: `Recorded your figure for how "${FOOTFALL}" moves "${MARGIN}", in your words: "${STATED_READ}". Any earlier result is now out of date.` }));
    expect(commits).toHaveLength(1);
    expect(commits[0]!.link_effect).toMatchObject({ from: SOURCE, to: TARGET, quote: STATED_READ,
      effect: { amount: -2, amount_unit: 'percentage points', per_source_change: 5, per_source_change_unit: '%' } });
    expect(linkOf(graph)).toMatchObject({ from: SOURCE, to: TARGET, effect_direction: 'negative' });
    expect(linkOf(graph).provenance).toEqual({ source: 'user_specified', magnitude: 'user_stated',
      natural_effect: { amount: -2, amount_unit: 'percentage points', per_source_change: 5,
        per_source_change_unit: '%', strength_mean: linkOf(graph).strength.mean, strength_mean_frame: 'edge_strength' } });
    expect(store.outstanding(SCENARIO, null)).toEqual([]);

    // The adopted source unit remains stored: another stated size in those same units reaches a fresh proposal.
    const again = 'Each 5% rise in footfall lost from price rise costs us about 3 percentage points of gross margin.';
    const after = structuredClone(linkOf(graph).provenance);
    const r2 = await caps.proposeLinkEffect!(ctxSaying(again), { ...LINK, amount: -3, quote: again }) as Json;
    expect(r2, JSON.stringify(r2)).toEqual(expect.objectContaining({ ok: true, mutated: false,
      link: { from: FOOTFALL, to: MARGIN, effect: { amount: -3, amount_unit: 'percentage points',
        per_source_change: 5, per_source_change_unit: '%' }, your_words: again.slice(0, -1) } }));
    expect(store.get(String(r2.proposal_id))!.provenance).toEqual({ authored_by: 'user_stated', basis: again.slice(0, -1) });
    expect(store.outstanding(SCENARIO, null).map((p) => p.proposal_id)).toEqual([String(r2.proposal_id)]);
    expect(linkOf(graph).provenance).toEqual(after);
  });

  it('T twin: the same link with NO stored natural_effect refuses the source as unitless, never the % goal', async () => {
    const graph = structuredClone(SERVED);
    const { natural_effect: _dropped, ...kept } = linkOf(graph).provenance;
    linkOf(graph).provenance = kept;
    const before = structuredClone(linkOf(graph).provenance);
    const { caps, store } = world(graph);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID_READ), { ...LINK, quote: SAID_READ }) as Json;
    expectRefused(r, 'unit_mismatch', undefined, store, graph, before);
    expect(String(r.detail)).toContain(`"${FOOTFALL}" has no unit or scale`);
    expect(String(r.detail), 'the % goal is never called unitless').not.toContain(`"${MARGIN}" has no unit`);
  });

  it('C contrast: an end WITH its own unit stays strict (a £ figure for the % "Bread price increase" → unit_mismatch)', async () => {
    const { caps, store, graph } = world();
    const before = structuredClone(linkOf(graph, 'bread_price_increase').provenance);
    const said = 'Every £1 on the bread price adds about 2 percentage points of gross margin.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { from_label: 'Bread price increase', to_label: MARGIN,
      amount: 2, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£', quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).not.toContain('has no unit or scale');
    expectRefused(r, 'unit_mismatch', undefined, store, graph, before, 'bread_price_increase');
  });

  it('S a sign-inverted reading passes the served word rule but is refused by the writer sign guard', async () => {
    const { caps, store, graph } = world();
    const before = structuredClone(linkOf(graph).provenance);
    const said = 'Each 5% fall in footfall costs us about 2 percentage points of gross margin.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, per_source_change: -5, quote: said }) as Json;
    expectRefused(r, 'sign_conflict', undefined, store, graph, before);
  });

  // PINNED FOLLOW-UP: the served word rule refuses these today. Card-based interpretation is outside this unit fix.
  // It already accepts "Our budget for footfall rises by 5% and costs…"; that pre-existing binding loophole is follow-up.
  it.each([
    ['SAID_FALL', SAID_FALL, 'direction_contradicts'],
    ['SAID_UP', SAID_UP, 'direction_not_stated'],
    ['a budget', 'Our budget is 5% for footfall and gross margin varies by 2 percentage points.', 'direction_not_stated'],
    ["today's level", 'Footfall lost from price rise is 5% today and gross margin falls by about 2 percentage points.', 'figure_not_bound'],
    ['a budget that goes up', 'Our budget for footfall goes up by 5%, gross margin falls by about 2 percentage points.', 'direction_not_stated'],
    ['a target level', 'When footfall goes up by 5%, gross margin of 2 percentage points is our target.', 'direction_not_stated'],
    ["a target's current level", "When footfall goes up by 5%, gross margin of 2 percentage points is today's level.", 'direction_not_stated'],
    ['a budget that falls', 'Our budget for footfall falls by 5% and costs us about 2 percentage points of gross margin.', 'direction_contradicts'],
    ['net margin while gross margin stays steady', 'A 5% fall in footfall would cost us about 2 percentage points of net margin while gross margin stays steady.', 'direction_contradicts'],
    ['"rises by 5%"', 'When footfall lost from price rise rises by 5%, gross margin falls by about 2 percentage points.', 'direction_not_stated'],
  ] as const)('PINNED FOLLOW-UP %s → served refusal, nothing outstanding', async (_name, said, why) => {
    const { caps, store, graph } = world();
    const before = structuredClone(linkOf(graph).provenance);
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
    expectRefused(r, 'not_the_users_statement', why, store, graph, before);
  });

  it.each([
    ['a question', 'Does a 5% rise in footfall lost cost about 2 percentage points of gross margin?', 'not_the_users_statement', 'question'],
    ['a negation', "A 5% rise in footfall lost wouldn't cost 2 percentage points of gross margin.", 'not_the_users_statement', 'denied'],
    ['a third figure', 'A 5% fall in footfall would cost us about 2, maybe 3 percentage points of gross margin.', 'not_the_users_statement', 'direction_contradicts'],
    ['a corrected figure', 'An 8%, no, a 5% fall in footfall costs about 2 percentage points of gross margin.', 'not_the_users_statement', 'denied'],
    ['no figures', 'Footfall lost from price rise matters a lot for gross margin.', 'not_the_users_figure', undefined],
  ] as const)('N %s → served refusal, nothing stored', async (_name, said, refusal, why) => {
    const { caps, store, graph } = world();
    const before = structuredClone(linkOf(graph).provenance);
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, quote: said }) as Json;
    expectRefused(r, refusal, why, store, graph, before);
  });

  it('N figures the words do not write (another unit, another number) → refused, never filled in', async () => {
    for (const args of [{ ...LINK, per_source_change_unit: '£' }, { ...LINK, amount: -3 }]) {
      const { caps, store, graph } = world();
      const before = structuredClone(linkOf(graph).provenance);
      const r = await caps.proposeLinkEffect!(ctxSaying(SAID_READ), { ...args, quote: SAID_READ }) as Json;
      expectRefused(r, 'not_the_users_figure', undefined, store, graph, before);
    }
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
    const { caps, store, graph } = world();
    const before = structuredClone(linkOf(graph).provenance);
    const said = 'Each 5% rise in footfall lost from price rise costs us about 2% of gross margin.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...LINK, amount_unit: '%', quote: said }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).toContain('recorded in percentage points');
    expectRefused(r, 'unit_mismatch', undefined, store, graph, before);
  });
  it('(d) a COUNT goal is not a % level: points into it stay unsized', () => {
    const count = goalPath('percentage points', 'user_stated', { goal_threshold_unit: 'customers', goal_threshold_raw: 600, goal_threshold_cap: 1000 });
    expect(p5Of(count).length).toBeGreaterThan(0);
  });
});
