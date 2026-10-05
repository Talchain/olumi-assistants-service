/**
 * ⭐ THE USER'S ANSWER TO "HOW MUCH DOES X MOVE Y?" HAS A DOOR (DL 5882763151: Runtime owns the answer handler; Canonical
 * the writer `applyLinkEffectEdit`, contract 5882965890 + correction 5882989451; AIQ 5882619314 "answerable end to end").
 *
 * Before: nothing after construction wrote `magnitude: 'user_stated'` + a `natural_effect` (Runtime 5882633365), so "every
 * £1 on the price loses us about 50 subscribers" had nowhere to land. `propose_link_effect` prepares ONE change: the
 * user's two figures, in the units of the link's two ends (or the ask's own unit words), with their verbatim quote,
 * bound to the analysis revision AND every byte of the link (`edge_token`). It DRY-RUNS Canonical's pure writer on the
 * read it proposes from, so every refusal is the writer's own, said truthfully at propose time — never at approval.
 *
 * SERVED fixtures: journey C (5411da8) has a DIRECT, UNSIZED "Pro plan price" → "Pro plan paying subscribers" link;
 * journey A (0df78f4) has "Pro plan price" (£/month) → "Monthly churn" (%).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';
import { approvalChipsFor, approvalChipIdFor, readingOfLinkEffectApproval } from '../approval-chips.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const served = (f: string): Json => (JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as { graph: Json }).graph;
const C = served('served-journey-c-price-subscribers-unsized-5411da8.json');
const A = served('served-journey-a-price-churn-0df78f4.json');
const BEYOND = served('served-price-subscribers-beyond-range-0df78f4-d2.json');
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'r', user_text });
/** The card `propose_link_effect` offers for its result, read from the STORED proposal (as the route does). */
const cardFor = (store: ProposalStore, r: Json) => approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
  (id) => ({ proposal: store.get(id), result: r as never }))[0]!;
/** The route's context when the user PRESSED a card naming `proposalId`, which sent `words` (`typedApprovalOf`, bound by the route). */
const ctxPressing = (proposalId: string, words: string) => ({ ...ctxSaying(words), typed_approval_of: proposalId, typed_approval_words: words });

function world(graph: Json) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, store), store };
}
const SUBS_SAID = 'Honestly, every £1 on the Pro price loses us about 50 paying subscribers.';
const SUBS_ARGS = {
  from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers',
  amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month',
  quote: 'every £1 on the Pro price loses us about 50 paying subscribers',
};

describe('propose_link_effect — the user\'s stated effect on a link, prepared as ONE change', () => {
  it('RED (served journey C, unsized direct link): prepared, bound to the revision AND the link\'s own bytes, quoting the user', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const p = store.get(String(r.proposal_id))!;
    expect(p.base_graph_identity_hash).toBe(computeAnalysisAffectingGraphHash(C as never));
    expect(p.provenance.authored_by).toBe('user_stated');
    expect(p.operations).toEqual([{ op: 'set_link_effect', path: 'pro_plan_price::pro_plan_paying_subscribers', value: {
      from: 'pro_plan_price', to: 'pro_plan_paying_subscribers',
      effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' },
      quote: SUBS_ARGS.quote, edge_token: linkEffectEdgeToken(C, 'pro_plan_price', 'pro_plan_paying_subscribers'),
    } }]);
    expect(String(r.public_label)).toContain(SUBS_ARGS.quote);
  });

  it('RED (served journey A): "0.5 points" of a % churn is the ask\'s own unit words — prepared, not refused', async () => {
    const { caps } = world(A);
    const said = 'A £10 rise in the Pro price adds about 0.5 points of monthly churn.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), {
      from_label: 'Pro plan price', to_label: 'Monthly churn', amount: 0.5, amount_unit: 'percentage points',
      per_source_change: 10, per_source_change_unit: '£/month', quote: 'A £10 rise in the Pro price adds about 0.5 points of monthly churn',
    }) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('REFUSED: a figure the user did not write is never recorded as theirs', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying('Every price rise loses us subscribers.'), { ...SUBS_ARGS, quote: 'Every price rise loses us subscribers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'not_the_users_figure' }));
    expect(store.size()).toBe(0);
  });

  it('REFUSED: the quote must be the user\'s own words, verbatim', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), { ...SUBS_ARGS, quote: 'each pound costs roughly fifty customers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'quote_not_verbatim' }));
  });

  it('REFUSED by the writer\'s own rule, at propose time: a unit that is not the end\'s ("customers") → unit_mismatch, said', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), { ...SUBS_ARGS, amount_unit: 'customers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).toMatch(/subscribers/);
  });

  /**
   * ⛔ PR Review CHANGES_REQUIRED on #2275 @ `ac0023c7`: a size is the user's only when ONE statement of theirs says it
   * (`linkEffectTheUserStated`). The input CLASS, on served journey C (Pro plan price → Pro plan paying subscribers):
   * six ways a user states it, each prepared; eight near-misses, each refused — the same numerals in the turn, a
   * question, a denial, an unnamed end, the opposite way, no way at all, a source said to fall with no word of it.
   */
  const stated = async (turn: string, quote: string, amount: number, per: number): Promise<Json> => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(turn), { ...SUBS_ARGS, amount, per_source_change: per, quote }) as Json;
    return { ...r, stored: store.size() };
  };
  it.each([
    ['every £1 on the Pro price loses us about 50 paying subscribers', -50, 1],
    ['every £1 we add to the Pro price costs us roughly 50 paying subscribers', -50, 1],
    ['A £10 rise in the Pro price would lose us about 500 paying subscribers', -500, 10],
    ['every £1 increase in the Pro price loses us 50 paying subscribers', -50, 1],
    ['If the Pro price falls by £1 we gain about 50 paying subscribers', 50, -1],
    ['each £1 on the Pro price means 50 fewer paying subscribers', -50, 1],
    // The £1 IS the change: "by £1" after the move, or its own move straight after (PR Review's fifth CR, the kept shapes).
    ['If the Pro price rises by £1 we lose about 50 paying subscribers', -50, 1],
    ['A £1 Pro price increase loses us about 50 paying subscribers', -50, 1],
    // Several sentences where ONE states it; the model's own colon-prefixed quote (live replay, 29 Sep).
    ['We checked last quarter. Every £1 on the Pro price loses us about 50 paying subscribers', -50, 1],
    ['From our last two price changes: every £1 on the Pro price loses us about 50 paying subscribers', -50, 1],
  ])('STATED, prepared: "%s"', async (quote, amount, per) => {
    const r = await stated(`${quote}.`, quote as string, amount as number, per as number);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it.each([
    // PR Review's case: both numerals in the turn, the quote a question — and the statement with them names no price.
    ['Our budget is £1 per month and we currently have 50 subscribers. Does a Pro price rise affect paying subscribers?',
      'Does a Pro price rise affect paying subscribers?', -50, 1, 'not_the_users_statement', 'question'],
    ['Our budget is £1 per month and we currently have 50 paying subscribers. Does a Pro price rise affect them?',
      'Our budget is £1 per month and we currently have 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    ['Does every £1 on the Pro price lose us 50 paying subscribers?', 'Does every £1 on the Pro price lose us 50 paying subscribers', -50, 1,
      'not_the_users_statement', 'question'],
    ['Every £1 on the Pro price does not lose us 50 paying subscribers.', 'Every £1 on the Pro price does not lose us 50 paying subscribers',
      -50, 1, 'not_the_users_statement', 'denied'],
    ['£1 on the Pro price and 50 paying subscribers.', '£1 on the Pro price and 50 paying subscribers', -50, 1,
      'not_the_users_statement', 'no_change_stated'],
    // The figures only ELSEWHERE in the turn; the quoted statement names both ends and the way, but no size.
    ['Our budget is £1 a month; we have 50 paying subscribers. Raising the Pro price loses us paying subscribers.',
      'Raising the Pro price loses us paying subscribers', -50, 1, 'not_the_users_figure', undefined],
    // PR Review's second CR (@ f5aaec34): every element present, but in DIFFERENT sentences — £1 a budget, 50 today's level.
    ['Pro price rises. Paying subscribers fall. Our budget is £1 per month. We currently have 50 paying subscribers.',
      'Pro price rises. Paying subscribers fall. Our budget is £1 per month. We currently have 50 paying subscribers', -50, 1,
      'not_the_users_statement', 'not_one_statement'],
    ['Pro price rises: paying subscribers fall: our budget is £1 per month: we have 50 paying subscribers.',
      'Pro price rises: paying subscribers fall: our budget is £1 per month: we have 50 paying subscribers', -50, 1,
      'not_the_users_statement', 'not_one_statement'],
    // ONE sentence, every element in it, but neither figure sizes the movement.
    ['Our budget is £1 per month and we currently have 50 paying subscribers, and a Pro price rise loses us paying subscribers.',
      'Our budget is £1 per month and we currently have 50 paying subscribers, and a Pro price rise loses us paying subscribers',
      -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // PR Review's third CR (@ 157b42ae), its two exact strings: a sentence-ending period after a digit; and a budget
    // beside the source's NAME that describes no change of it ("£1 and Pro price rises").
    ['Our budget is £1. Pro price rises, losing 50 paying subscribers.',
      'Our budget is £1. Pro price rises, losing 50 paying subscribers', -50, 1, 'not_the_users_statement', 'not_one_statement'],
    ['Our budget is £1 and Pro price rises, losing 50 paying subscribers.',
      'Our budget is £1 and Pro price rises, losing 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // The source's figure sizes the price move, but 50 is today's level — it does not size the loss.
    ['Every £1 on the Pro price loses us paying subscribers, and we have 50 paying subscribers today.',
      'Every £1 on the Pro price loses us paying subscribers, and we have 50 paying subscribers today', -50, 1,
      'not_the_users_statement', 'target_figure_a_level'],
    // PR Review's fourth CR (@ ce3cd9d0): £1 is today's LEVEL of the price, not a £1 rise — no change is sized.
    ['With Pro price £1 today, raising it loses 50 paying subscribers.',
      'With Pro price £1 today, raising it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // PR Review's fifth CR (@ db47673d), its exact string: the comma ends "£1" as today's price; the rise has no size.
    ['With Pro price £1, raising it loses 50 paying subscribers.',
      'With Pro price £1, raising it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    ['At a Pro price of £1, raising it loses 50 paying subscribers.',
      'At a Pro price of £1, raising it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // PR Review @ fe509477, its exact string: no punctuation, and the move straight after £1 is a VERB on the price.
    ['With Pro price £1 raising it loses 50 paying subscribers.',
      'With Pro price £1 raising it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    ['At a Pro price of £1 raising it loses 50 paying subscribers.',
      'At a Pro price of £1 raising it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // Codex buddy r2 HIGH: "equals" states today's level as plainly as "is".
    ['Pro price equals £1, raising it loses 50 paying subscribers.',
      'Pro price equals £1, raising it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    ['With Pro price £1 increasing it loses 50 paying subscribers.',
      'With Pro price £1 increasing it loses 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // Today's level, then a comma, then a change of NO stated size: the comma ends the figure's phrase (each passes if
    // punctuation is ignored).
    ['With the Pro price at £1, price increase loses us about 50 paying subscribers.',
      'With the Pro price at £1, price increase loses us about 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    ['Pro price is £1, price increase loses us about 50 paying subscribers.',
      'Pro price is £1, price increase loses us about 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    ['At £1, Pro price increase loses us about 50 paying subscribers.',
      'At £1, Pro price increase loses us about 50 paying subscribers', -50, 1, 'not_the_users_statement', 'source_figure_a_level'],
    // A NAMED under-claim: the source only implied ("a £10 rise") — the Agent asks, never infers the price.
    ['A £10 rise loses us about 500 paying subscribers.', 'A £10 rise loses us about 500 paying subscribers', -500, 10,
      'not_the_users_statement', 'end_not_named'],
  ])('NOT STATED, refused: %s', async (turn, quote, amount, per, refusal, why) => {
    const r = await stated(turn as string, quote as string, amount as number, per as number);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal }));
    if (why !== undefined) expect(r.why).toBe(why);
    expect(r.stored).toBe(0);
  });

  // RT-6 step 3, option B (DL; Science B2): the direction and verb vocabulary no longer refuses. These three were refused
  // ONLY by that vocabulary; each now offers a card whose WORDS state the Agent's reading, so the user approves or corrects
  // THAT reading (the first two read correctly; "wins" with a −50 reading is exposed in the card's own words, the M-sign
  // class). Level and binding figures stay refused above (DL e8, 5 Oct ~18:5xZ).
  const TAIL = ' Approve, or correct.';
  it.each([
    ['If we raise the Pro price by £1 we lose about 50 paying subscribers.', 'If we raise the Pro price by £1 we lose about 50 paying subscribers', -50, 1,
      'Record: +£1/month on "Pro plan price" \u2192 \u221250 subscribers in "Pro plan paying subscribers": raising "Pro plan price" by £1/month lowers "Pro plan paying subscribers" by 50 subscribers. From your words: "If we raise the Pro price by £1 we lose about 50 paying subscribers".' + TAIL],
    ['Every £1 on the Pro price loses us about 50 paying subscribers.', 'Every £1 on the Pro price loses us about 50 paying subscribers', 50, -1,
      'Record: \u2212£1/month on "Pro plan price" \u2192 +50 subscribers in "Pro plan paying subscribers": lowering "Pro plan price" by £1/month raises "Pro plan paying subscribers" by 50 subscribers. From your words: "Every £1 on the Pro price loses us about 50 paying subscribers".' + TAIL],
    // Codex buddy r2 P2: "is" after a CHANGE noun states the change's size, not a level.
    ['The Pro price rise is £1, and we lose 50 paying subscribers for that rise.', 'The Pro price rise is £1, and we lose 50 paying subscribers for that rise', -50, 1,
      'Record: +£1/month on "Pro plan price" \u2192 \u221250 subscribers in "Pro plan paying subscribers": raising "Pro plan price" by £1/month lowers "Pro plan paying subscribers" by 50 subscribers. From your words: "The Pro price rise is £1, and we lose 50 paying subscribers for that rise".' + TAIL],
    ['Every £1 on the Pro price wins us about 50 paying subscribers.', 'Every £1 on the Pro price wins us about 50 paying subscribers', -50, 1,
      'Record: +£1/month on "Pro plan price" \u2192 \u221250 subscribers in "Pro plan paying subscribers": raising "Pro plan price" by £1/month lowers "Pro plan paying subscribers" by 50 subscribers. From your words: "Every £1 on the Pro price wins us about 50 paying subscribers".' + TAIL],
  ] as const)('B2 (option B), now a card stating the Agent\'s reading: %s', async (turn, quote, amount, per, card) => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(turn), { ...SUBS_ARGS, amount, per_source_change: per, quote }) as Json;
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(cardFor(store, r).detail).toBe(card);
  });

  /**
   * ⭐ PROPOSER, NOT STAMPER (AIQ 5884881500; Canonical 5884892804: `user_stated` is written only on this approval). The
   * proposal stores the ONE sentence the rule read, and the approval card shows the READING beside it — the user approves
   * that reading, so a wrong parse costs a "no".
   */
  it('the proposal stores the ONE stating sentence, never the longer quote', async () => {
    const { caps, store } = world(C);
    const said = 'We checked last quarter. Every £1 on the Pro price loses us about 50 paying subscribers.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...SUBS_ARGS, quote: 'We checked last quarter. Every £1 on the Pro price loses us about 50 paying subscribers' }) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const op = store.get(String(r.proposal_id))!.operations[0]!.value as Json;
    expect(op.quote).toBe('Every £1 on the Pro price loses us about 50 paying subscribers');
    expect(r.link.your_words).toBe(op.quote);
    expect(String(r.public_label)).not.toMatch(/We checked last quarter/);
  });

  it('the approval card SHOWS the reading it records: both changes with their signs, both ends, the user\'s sentence', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const id = String(r.proposal_id);
    const chips = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: id }],
      () => ({ proposal: store.get(id), result: r as never }));
    const approve = chips.find((c) => c.id === approvalChipIdFor(id))!;
    expect(approve.label).toBe('Record this reading'); // AIQ 5885199635: a reading the user confirms
    // B3 (RT-6 step 3): symbols AND words, then the user's sentence; was `… — from your words: "…"`.
    expect(approve.detail).toBe('Record: +£1/month on "Pro plan price" \u2192 \u221250 subscribers in "Pro plan paying subscribers": raising "Pro plan price" by £1/month lowers "Pro plan paying subscribers" by 50 subscribers. From your words: "every £1 on the Pro price loses us about 50 paying subscribers". Approve, or correct.');
  });

  it('NO CARD, NO BUTTON (PR Review\'s fifth CR): the proposer\'s result and the stored proposal disagree → nothing to approve', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const id = String(r.proposal_id);
    const ask = [{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: id }];
    // Control: the SAME proposal with its own result has its card.
    expect(approvalChipsFor(ask, () => ({ proposal: store.get(id), result: r as never })).map((c) => c.id)).toContain(approvalChipIdFor(id));
    const other = { ...r, link: { ...r.link, your_words: 'something else' } };
    expect(approvalChipsFor(ask, () => ({ proposal: store.get(id), result: other as never }))).toEqual([]);
    expect(approvalChipsFor(ask)).toEqual([]); // no source to read the reading from at all
  });

  it('A CARD PUT BACK AFTER A RESTART shows the same reading: its words carry it (the durable carrier keeps the words)', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const card = cardFor(store, r);
    expect(readingOfLinkEffectApproval(card.message)).toBe(card.detail);
    expect(readingOfLinkEffectApproval('Yes, record that.')).toBeUndefined(); // any other card's words carry no reading
  });

  /**
   * The door a stub stands in for stores the REAL writer's postimage (RT-6 step 3, B4: the read-back checks the reloaded
   * link IS that postimage, `reading` and `source_quote` included). Was a hand-made `{ ...provenance, ...THEIRS }`.
   */
  const writerPostimage = (graph: Json, input: CommitOptionLevelsInput): Json => {
    const le = input.link_effect!;
    const out = applyLinkEffectEdit({ persistedGraph: structuredClone(graph), from: le.from, to: le.to, effect: le.effect, quote: le.quote,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: le.edge_token }, reading_token: le.reading_token,
      ...(le.unit_readings !== undefined ? { unit_readings: le.unit_readings } : {}), ...(le.reversal !== undefined ? { reversal: le.reversal } : {}),
      ...(le.link_selected === true ? { link_selected: true } : {}) });
    if (out.kind !== 'mutated') throw new Error(`writer refused in the stub door: ${JSON.stringify(out)}`);
    return (out.mutatedGraph as Json).edges.find((x: Json) => x.from === le.from && x.to === le.to);
  };
  const storePostimage = (graph: Json, input: CommitOptionLevelsInput, change: (edge: Json) => void = () => {}): void => {
    const edge = structuredClone(writerPostimage(graph, input));
    change(edge);
    const i = (graph.edges as Json[]).findIndex((x) => x.from === edge.from && x.to === edge.to);
    graph.edges[i] = edge;
  };

  it('ONLY FROM THE CARD (PR Review\'s fifth CR): the Agent approving from the user\'s "yes" records nothing; the card then does', async () => {
    const graph = structuredClone(C);
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    let doorCalls = 0;
    let sent: CommitOptionLevelsInput | undefined;
    const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      doorCalls += 1;
      sent = input;
      storePostimage(graph, input);
      return { status: 'committed', graph_hash: 'h-after', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    };
    const store = new ProposalStore();
    const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels });
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const id = String(r.proposal_id);
    const card = cardFor(store, r);
    expect(card.message).toBe(`Yes \u2014 ${card.detail}`); // the card's words ARE its reading
    for (const ctx of [ctxSaying(card.message), ctxPressing('prop_0123456789abcdef0123456789abcdef', card.message)]) {
      const said = await caps.authoriseChange(ctx, { proposal_id: id }) as Json;
      expect(said).toEqual(expect.objectContaining({ ok: false, mutated: false, reason: 'approve_on_the_card' }));
      expect(String(said.detail)).not.toMatch(/approve_on_the_card/); // never the raw code in the words
    }
    // AIQ 5885290014: a FORGED approval of this proposal — no reading, the old plain words, or another reading — is refused.
    const other = String(card.message).replace('\u221250', '\u221260');
    for (const words of ['', 'Yes, record that.', 'Yes, record that reading.', other]) {
      const forged = await caps.authoriseChange(ctxPressing(id, words), { proposal_id: id }) as Json;
      expect(forged, words).toEqual(expect.objectContaining({ ok: false, mutated: false, reason: 'reading_not_confirmed' }));
    }
    expect(doorCalls, 'nothing written from words, another proposal\'s card, or a card without this reading').toBe(0);
    expect(await caps.authoriseChange(ctxPressing(id, card.message), { proposal_id: id })).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(doorCalls).toBe(1);
    // Canonical #2283: the door gets the token of exactly the reading the card showed (the writer recomputes it).
    expect(sent?.link_effect?.reading_token).toBe(linkEffectReadingToken({ from: 'pro_plan_price', to: 'pro_plan_paying_subscribers',
      effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' }, quote: SUBS_ARGS.quote }));
  });

  it('the tool is registered: dispatchTool routes propose_link_effect to the capability', async () => {
    const { caps } = world(C);
    const r = await dispatchTool('propose_link_effect', JSON.stringify(SUBS_ARGS), ctxSaying(SUBS_SAID), caps) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  // B2 (RT-6 step 3): a reading against the stored direction is an explicit REVERSAL card, said in words; was a sign_conflict
  // refusal pointing at propose_link_strength. Nothing is written until the user approves that reversal.
  it('REVERSAL CARD (was sign_conflict, AIQ 5882847470): the user\'s figure runs the OTHER way — said plainly on the card', async () => {
    const { caps, store } = world(C);
    const said = 'Every £1 on the Pro price wins us about 50 paying subscribers.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...SUBS_ARGS, amount: 50, quote: 'Every £1 on the Pro price wins us about 50 paying subscribers' }) as Json;
    const edge = (C.edges as Json[]).find((e) => e.from === 'pro_plan_price' && e.to === 'pro_plan_paying_subscribers')!;
    expect(edge.effect_direction ?? Math.sign(edge.strength?.mean)).not.toBe('positive'); // precondition: served link runs negative
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(cardFor(store, r).detail).toBe('REVERSAL: this changes the link from negative to positive. Record: +£1/month on "Pro plan price" \u2192 +50 subscribers in "Pro plan paying subscribers": raising "Pro plan price" by £1/month raises "Pro plan paying subscribers" by 50 subscribers. From your words: "Every £1 on the Pro price wins us about 50 paying subscribers". Approve, or correct.');
    expect(store.size()).toBe(1);
  });

  it('RED (live replay on served C + 0929 D2, 29 Sep: 6/6 prepared, 0 chips): the prepared change is OFFERED — one approve chip for it', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const chips = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: r as never }));
    const approve = chips.filter((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve.map((c) => c.id)).toEqual([approvalChipIdFor(String(r.proposal_id))]);
    expect(approve[0]!.label).toBe('Record this reading');
  });

  const BEYOND_SAID = 'From our last two price changes: every £1 on the Pro price loses us about 50 paying subscribers.';
  const BEYOND_ARGS = {
    from_label: 'Pro plan price', to_label: 'Pro paying subscribers', amount: -50, amount_unit: 'subscribers',
    per_source_change: 1, per_source_change_unit: 'GBP/month', quote: 'every £1 on the Pro price loses us about 50 paying subscribers',
  };

  it('REFUSED (served 0df78f4 D2, live replay 3/3; AIQ 5883669977): the model\'s RANGE is what stops it — never the user\'s figure first, no dead-end offer', async () => {
    const { caps, store } = world(BEYOND);
    const r = await caps.proposeLinkEffect!(ctxSaying(BEYOND_SAID), BEYOND_ARGS) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'not_representable' }));
    const detail = String(r.detail);
    expect(detail).toMatch(/the range the model uses for "Pro plan price" \(up to 200 GBP\/month\) and "Pro paying subscribers"/);
    expect(detail).toMatch(/it is that range, not their figure, that stops it being used/);
    expect(detail).toMatch(/Never ask them to change their figure first/);
    expect(detail).toMatch(/Repeat their figure in their own words/);
    expect(detail).toMatch(/cannot be changed from this conversation yet/); // no dead-end "OK?" before a reframe door exists (Canonical 5883707376)
    expect(detail).not.toMatch(/Is that the size they meant/); // mutant: asking the user's size first → RED
    // Canonical 5883707376: no typed field says whose a cap is — the words never claim the range is Olumi's (or theirs).
    expect(detail).not.toMatch(/Olumi\u2019s own|Olumi's own|their range|range they gave/);
    expect(detail).not.toMatch(/not_representable|not representable/); // never the raw code
    expect(store.size()).toBe(0);
  });

  /**
   * PR Review on #2275: the read-back proves THIS figure — the user's source, both numbers AND both units. A door that
   * reports "committed" while the stored link holds another source or unit is never said as "recorded".
   */
  const readBackAfter = async (change: (edge: Json) => void): Promise<Json> => {
    const graph = structuredClone(C);
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      storePostimage(graph, input, change);
      return { status: 'committed', graph_hash: 'h-after', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    };
    const store = new ProposalStore();
    const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels });
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    return await caps.authoriseChange(ctxPressing(String(r.proposal_id), cardFor(store, r).message), { proposal_id: String(r.proposal_id) }) as Json;
  };
  it('READ-BACK: the user\'s source, numbers and units → recorded', async () => {
    expect(await readBackAfter(() => {})).toEqual(expect.objectContaining({ ok: true, applied: true }));
  });
  it.each([
    ['another source', (e: Json) => { e.provenance.source = 'cee_hypothesis'; }],
    ['another target unit', (e: Json) => { e.provenance.natural_effect.amount_unit = 'customers'; }],
    ['another source unit', (e: Json) => { e.provenance.natural_effect.per_source_change_unit = 'percent'; }],
    ['no confirmed reading', (e: Json) => { delete e.provenance.reading; }],
  ] as const)('READ-BACK: %s → never said as recorded', async (_why, change) => {
    expect(await readBackAfter(change)).toEqual(expect.objectContaining({ ok: false, applied: false, refusal: 'not_verified' }));
  });

  it('FAIL CLOSED without the level door: approving writes nothing and says so (never a strength-only or register fallback)', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const out = await caps.authoriseChange(ctxPressing(String(r.proposal_id), cardFor(store, r).message), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: false, reason: 'link_effect_writer_unavailable' }));
  });
});
