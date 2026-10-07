/**
 * ⭐ G1b ANSWER DOOR: a switch's figure, and a figure inside the range the user wrote around it, land as the user's — the
 * same two readings construction makes of the same sentence in a brief (Science 6008844683: a switch's effect is its
 * target figure alone; Science d5 #87 6009282279, a8's shape ruling: "about 150, between 80 and 250" is the point 150
 * inside the user's range, carried as `natural_effect.stated_range` with `end: 'centre'`).
 *
 * Served (g1-2633t draft 1, turn 4, CEE c787820; `served_turn` in the fixture): the user answered Olumi's ask with
 * "The starter tier would win about 150 new subscribers, between 80 and 250." `propose_link_effect` refused it
 * (`not_the_users_statement`) and Olumi asked "What single change in “Starter subscribers” do you mean, rather than a
 * range?" — the figure the user had just given. Nothing was recorded. At staging f07a8c19 the same answer is refused on
 * all 8 banked T1b drafts whose ‘Starter tier …’ → ‘Starter subscribers’ link is Olumi's estimate (2 of them Olumi's 80,
 * the low end): `unclear_figure` with the range, `not_the_users_figure` ("…, in figures?") without it.
 *
 * Rows are the REAL banked drafted graphs (bench/bank, verbatim) through the REAL proposer, card, approval and writer.
 * No LLM calls: the Agent's tool arguments are the reading the card shows.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import { approvalChipsFor } from '../approval-chips.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { endsOfGraph, heldLinkOf } from '../../goal-target/held-user-links.js';

type Json = Record<string, any>;
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/g1b-answer-door-banked.json', import.meta.url), 'utf8')) as {
  served_turn: { user_message: string; tool_calls: Json[]; assistant_text: string; cee_build: string };
  graphs: Record<string, { graph: Json; served_run_build: string; scenario: string }>;
};
const graphOf = (c: string): Json => structuredClone(FIXTURE.graphs[c]!.graph);
const ANSWER = FIXTURE.served_turn.user_message;
/** The 8 banked T1b drafts whose switch → subscribers link is Olumi's estimate (bench/bank, INDEX 97). */
const F4: readonly (readonly [string, string, string, number])[] = [
  ['acc__g1-2633t_draft-1__a9ee494a', 'Starter tier launched', 'Starter subscribers', 150],
  ['acc__g1-2633s_draft-2__5fe19642', 'Starter tier launched', 'Starter subscribers', 150],
  ['acc__g1-2633s_draft-4__e7b8ee26', 'Starter-tier availability', 'Starter subscribers', 80],
  ['acc__g1-2633t_draft-6__88353f5d', 'Starter tier availability', 'New starter subscribers', 80],
  ['acc__g1-fa9f_draft-7__b63d8672', 'Starter tier launched', 'Starter subscribers', 150],
  ['acc__g1-fa9f_draft-11__fa05dd14', 'Starter tier launched', 'Starter subscribers', 150],
  ['acc__g1-2633-predup-overlapMC_draft-1__52d4d576', 'Starter tier availability', 'Starter subscribers', 150],
  ['acc__g1-2633t_draft-3__72af3e85', 'Starter tier active', 'Starter subscribers', 150],
];
const D1 = F4[0]!;
const INVESTOR = 'acc__witness-cc281ac8_w-investor-18__4b7b7c80';

const ctxSaying = (user_text: string) => ({ scenario_id: 'g1b-answer-door', authenticated_user_id: null, request_id: 'g1b', user_text });
const ctxPressing = (proposalId: string, words: string) => ({ ...ctxSaying(words), typed_approval_of: proposalId, typed_approval_words: words });

/** A world over a MUTABLE copy of one banked graph; the commit door writes through the real link-effect writer. */
function world(graph: Json) {
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
        expected: { graph_hash: input.base_graph_hash, edge_token: le.edge_token }, quote: le.quote, reading_token: le.reading_token,
        unit_readings: le.unit_readings, reversal: le.reversal, link_selected: le.link_selected, frameRefit: true });
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
const idOf = (g: Json, label: string): string => (g.nodes as Json[]).find((n) => n.label === label)!.id;
const linkOf = (g: Json, from: string, to: string): Json => (g.edges as Json[]).find((e) => e.from === from && e.to === to)!;
const switchArgs = (from: string, to: string, amount: number) => ({ from_label: from, to_label: to, amount, amount_unit: 'subscribers',
  per_source_change: 1, per_source_change_unit: 'switch' });
const cardFor = (store: ProposalStore, r: Json) => approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
  (id) => ({ proposal: store.get(id), result: r as never }))[0]!;

/** Refused: nothing proposed, nothing stored, the link exactly as drafted. */
async function expectAsked(c: string, args: Json, said: string, why: string | undefined, refusal = 'not_the_users_statement') {
  const graph = graphOf(c);
  const { caps, store, commits } = world(graph);
  const from = idOf(graph, args.from_label); const to = idOf(graph, args.to_label);
  const before = structuredClone(linkOf(graph, from, to));
  const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...args, quote: said }) as Json;
  expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal });
  if (why !== undefined) expect(r.why).toBe(why);
  expect(r).not.toHaveProperty('proposal_id');
  expect(store.outstanding('g1b-answer-door', null)).toEqual([]);
  expect(commits).toEqual([]);
  expect(linkOf(graph, from, to)).toEqual(before);
  return r;
}

describe('fixture provenance: the served refusal this fixes', () => {
  it('g1-2633t d1 turn 4 (CEE c787820): the answer was refused and Olumi asked for "a single change … rather than a range"', () => {
    expect(ANSWER).toBe('The starter tier would win about 150 new subscribers, between 80 and 250.');
    expect(FIXTURE.served_turn.cee_build).toBe('c787820');
    expect(FIXTURE.served_turn.tool_calls).toEqual([{ name: 'propose_link_effect', ok: false, mutated: false, refusal: 'not_the_users_statement' }]);
    expect(FIXTURE.served_turn.assistant_text).toContain('What single change in “Starter subscribers” do you mean, rather than a range?');
  });
});

describe('MUST-FIX (8 banked T1b drafts): the user\'s "about 150, between 80 and 250" lands as theirs, with its range', () => {
  it.each(F4)('%s: card offered, approval writes 150 per switch WITH the range, held like the brief sentence', async (c, from, to, olumis) => {
    const graph = graphOf(c);
    const { caps, store, commits } = world(graph);
    const f = idOf(graph, from); const t = idOf(graph, to);
    expect(linkOf(graph, f, t).provenance, 'precondition: Olumi\'s estimate, never the user\'s').toMatchObject({ magnitude: 'olumi_estimate',
      natural_effect: { amount: olumis, per_source_change: 1, per_source_change_unit: 'switch' } });
    const r = await caps.proposeLinkEffect!(ctxSaying(ANSWER), { ...switchArgs(from, to, 150), quote: ANSWER }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false,
      link: { from, to, effect: { amount: 150, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'switch' }, your_words: ANSWER } });
    expect(r).not.toHaveProperty('question');
    const card = cardFor(store, r);
    expect(card.detail).toBe(`Record: turning on "${from}" → +150 subscribers in "${to}": turning on "${from}" raises "${to}" by 150 subscribers. `
      + `From your words: "${ANSWER}" Approve, or correct.`);
    expect(commits).toEqual([]);

    const out = await caps.authoriseChange(ctxPressing(String(r.proposal_id), card.message), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(commits).toHaveLength(1);
    const stored = linkOf(graph, f, t);
    expect(stored.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', source_quote: ANSWER,
      natural_effect: { amount: 150, per_source_change: 1, per_source_change_unit: 'switch',
        stated_range: { low: 80, high: 250, text: 'between 80 and 250', end: 'centre' } } });
    // Held at existence 1.0 with the range's own spread: what the same sentence in the brief gives this link.
    expect(heldLinkOf(stored, endsOfGraph(graph)(stored)), 'the user\'s range excludes zero: the link is held').not.toBeNull();
  });
});

describe('NO-REPEAT: an answer that gives the figure is never answered with the question for it', () => {
  it('the served answer, sent twice: a card both times, never "rather than a range" / "in figures"', async () => {
    const graph = graphOf(D1[0]);
    const { caps } = world(graph);
    for (let i = 0; i < 2; i += 1) {
      const r = await caps.proposeLinkEffect!(ctxSaying(ANSWER), { ...switchArgs(D1[1], D1[2], 150), quote: ANSWER }) as Json;
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      expect(JSON.stringify(r)).not.toMatch(/rather than a range|in figures\?/);
    }
  });
  it('without the range, the switch figure alone also lands (never "How much does … move …, in figures?")', async () => {
    const said = 'The starter tier would win about 150 new subscribers.';
    const graph = graphOf(D1[0]);
    const { caps } = world(graph);
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...switchArgs(D1[1], D1[2], 150), quote: said }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, link: { your_words: said } });
    expect(JSON.stringify(r)).not.toMatch(/in figures\?/);
  });
});

describe('THE RANGE READING ON A PER-ONE LINK (T1b F2, served g1-2633t d3 turn 4 @c787820: refused live)', () => {
  const F2 = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
  const selectedF2 = (graph: Json, said: string) => ({ ...ctxSaying(said),
    grounded_selection: { unresolved: 'none', element_ids: [idOf(graph, 'Existing-price rise'), idOf(graph, 'Customers lost from price rise')] } });
  const f2Args = { from_label: 'Existing-price rise', to_label: 'Customers lost from price rise', amount: 2, amount_unit: 'customers',
    per_source_change: 1, per_source_change_unit: '%' };
  it('"about 2, between 1 and 4" on the selected link: never "rather than a range"; the one question left is U3\'s points-or-share', async () => {
    // The source is a % whose level is Olumi's estimate, so "1%" is a points-or-share question (Science F1/U3), asked
    // whatever the range: that question is not this PR's. The range itself is now read as the user's figure inside it.
    const graph = graphOf(D1[0]);
    const { caps, store } = world(graph);
    const r = await caps.proposeLinkEffect!(selectedF2(graph, F2) as never, { ...f2Args, quote: F2 }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'unit_mismatch',
      question: 'Is that a 1-point rise in “Existing-price rise” (say 10% → 11%), or 1% of today’s level?' });
    expect(JSON.stringify(r)).not.toMatch(/rather than a range/);
    expect(store.outstanding('g1b-answer-door', null)).toEqual([]);
  });
  it('a SECOND range in the same sentence ("or 3-5 in a bad year") → still asked for one figure', async () => {
    const said = 'Each 1% price rise loses about 2 customers, between 1 and 4, or 3-5 in a bad year.';
    const graph = graphOf(D1[0]);
    const { caps, store } = world(graph);
    const r = await caps.proposeLinkEffect!(selectedF2(graph, said) as never, { ...f2Args, quote: said }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'not_the_users_statement', why: 'unclear_figure' });
    expect(store.outstanding('g1b-answer-door', null)).toEqual([]);
  });
});

describe('CONTROLS: where Olumi cannot read one figure, it still asks', () => {
  it.each([
    ['a range with no figure inside it', 'The starter tier would win between 80 and 250 new subscribers.', 150, 'unclear_figure', 'not_the_users_statement'],
    ['two figures and a range', 'The starter tier would win about 150 or 200 new subscribers, between 80 and 250.', 150, 'unclear_figure', 'not_the_users_statement'],
    ['a range in another unit', 'The starter tier would win about 150 new subscribers, between 1 and 4 months after launch.', 150, 'unclear_figure', 'not_the_users_statement'],
    ['no figure at all', 'The starter tier would win new subscribers.', 150, undefined, 'not_the_users_figure'],
  ] as const)('%s → asked, nothing proposed or stored', async (_name, said, amount, why, refusal) => {
    await expectAsked(D1[0], switchArgs(D1[1], D1[2], amount), said, why, refusal);
  });
  it('a level, not a change ("has 150 subscribers") → asked, nothing proposed or stored; read as a level when read at all', async () => {
    const said = 'The starter tier has 150 subscribers.';
    const graph = graphOf(D1[0]);
    const { caps, store, commits } = world(graph);
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...switchArgs(D1[1], D1[2], 150), quote: said }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false });
    if (r.refusal === 'not_the_users_statement') expect(r.why).toBe('target_figure_a_level');
    else expect(r.refusal).toBe('not_the_users_figure');
    expect(store.outstanding('g1b-answer-door', null)).toEqual([]);
    expect(commits).toEqual([]);
  });
});

describe('NO WRONG BINDING: a figure of another change or another quantity never lands as the switch\'s', () => {
  it('investor-18 (witness, 5a586cb): "from 20% to about 30%" is a level change, never a 30-point switch effect', async () => {
    const said = 'Enterprise prospects tell us building the AI reporting module would lift our enterprise win rate from 20% to about 30%.';
    for (const amount of [30, 10]) {
      await expectAsked(INVESTOR, { from_label: 'AI reporting module availability', to_label: 'Enterprise win rate', amount,
        amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'switch' }, said, undefined, 'not_the_users_figure');
    }
  });
  it('the support cost (£6 a month per subscriber) never sizes the switch → subscribers link, even on the selected link', async () => {
    const said = 'Each starter subscriber costs about £6 a month in support.';
    await expectAsked(D1[0], switchArgs(D1[1], D1[2], 6), said, undefined, 'not_the_users_figure');
    const graph = graphOf(D1[0]);
    const { caps, store } = world(graph);
    const selected = { ...ctxSaying(said), grounded_selection: { unresolved: 'none', element_ids: [idOf(graph, D1[1]), idOf(graph, D1[2])] } };
    const r = await caps.proposeLinkEffect!(selected as never, { ...switchArgs(D1[1], D1[2], 6), quote: said }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'not_the_users_figure' });
    expect(store.outstanding('g1b-answer-door', null)).toEqual([]);
  });
  it('a continuous source is never read as a switch: "Existing-price rise" (%) refuses a per-switch figure', async () => {
    const graph = graphOf(D1[0]);
    const { caps, store } = world(graph);
    const said = 'The price rise would lose about 2 customers, between 1 and 4.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { from_label: 'Existing-price rise', to_label: 'Customers lost from price rise',
      amount: 2, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: 'switch', quote: said }) as Json;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false });
    expect(store.outstanding('g1b-answer-door', null)).toEqual([]);
  });
});
