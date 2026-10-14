import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import type { SessionTurnWrite } from '../../session/store.js';
import type { AgentToolContext } from '../runtime/agent-tools.js';
import { latestLinkBands, linkBandTheUserStated } from '../../goal-target/input-claim-context.js';

beforeEach(() => __setUseAppendV6ForTest(false));
const scenario = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nodes = ['Price', 'MRR', 'Quality'].map(label => ({ id: label.toLowerCase(), kind: 'factor', label }));
const history = 'Price has a weak effect on MRR';
const initial = (mean = 0.55) => ({ nodes, edges: ['price', 'quality'].map(from => ({ from, to: 'mrr',
  strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } })) });

function harness(mean: number) {
  let bytes = JSON.stringify(initial(mean));
  const writes: SessionTurnWrite[] = [];
  const read = () => JSON.parse(bytes) as ReturnType<typeof initial>;
  const store = createMockSessionStore({
    loadGraph: async () => read(), readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async write => { writes.push(structuredClone(write)); bytes = JSON.stringify(write.graph); return { id: 'row-1' }; },
    readRecent: async () => writes.map(w => makeSessionTurnRow({ id: 'row-1', scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms,
      assistant_message: w.assistantMessage ?? null })),
    readFactsWithTurnFor: async () => writes.flatMap(w => w.handler_facts.map(fact => ({
      turn_id: 'row-1', fact_created_at: '2026-10-13T00:00:00.000Z', fact }))),
  });
  const dispatch: InternalDispatch = async path => {
    expect(path.endsWith('/graph')).toBe(true);
    return { status: 200, json: { graph: read(), graph_hash: computeAnalysisAffectingGraphHash(read()) } };
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitOptionLevels: async input => {
      const result = await executeOptionInterventionBatch({ scenarioId: scenario, turnId: input.turn_id,
        requestId: 't2a', requestHash: 't2a-approved', stage: 'frame', freshness: 'none', hasExistingAnalysis: false,
        expectedGraphHash: input.base_graph_hash, targets: [],
        // The production mapping (`dispatch.ts` commitOptionLevelsInProcess): adoption only for a `set`; a kept band is a review.
        linkStrengths: input.link_strengths?.map(l => ({ from: l.from, to: l.to, magnitude: l.magnitude, intent: l.intent,
          expected: l.expected, band: l.band, adopted: l.author === 'model_proposed' && l.intent === 'set',
          ...(l.author === 'model_proposed' && l.intent === 'confirm_current' ? { review: true } : {}) })) }, store);
      expect(result.kind, JSON.stringify(result)).toBe('committed');
      if (result.kind !== 'committed') throw new Error(JSON.stringify(result));
      return { status: 'committed', graph_hash: result.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [] };
    },
  });
  return { caps, proposals, writes, read };
}
// T2A5: no unverified text by default (an unverified statement of the band makes its origin unknown, AIE 6157593360).
const contextOf = (verified: string, interaction: Partial<AgentToolContext>) => ({ scenario_id: scenario, authenticated_user_id: null,
  request_id: 't2a', user_text: verified, user_turn_text: 'Please prepare the link.', ...interaction });
const linkOf = (from: string, overrides: Record<string, unknown>) => ({ links: [{ from_label: from, to_label: 'MRR', strength: 'weak', ...overrides }],
  rationale: 'Prepare the requested link strength.' });
/** The door's answer alone, nothing approved: for the T2A5 refusals (origin unknown, nothing prepared). */
async function offer(from: string, overrides: Record<string, unknown> = {}, verified = history, interaction: Partial<AgentToolContext> = {}, mean = 0.55) {
  const { caps, writes } = harness(mean);
  return { result: await caps.proposeLinkStrengths!(contextOf(verified, interaction), linkOf(from, overrides)), writes };
}
async function journey(from: string, overrides: Record<string, unknown> = {}, verified = history,
  interaction: Partial<AgentToolContext> = {}, mean = 0.55) {
  const { caps, proposals, writes, read } = harness(mean);
  const ctx = contextOf(verified, interaction);
  const proposal = await caps.proposeLinkStrengths!(ctx, linkOf(from, overrides));
  expect(proposal.ok, JSON.stringify(proposal)).toBe(true);
  expect(writes).toHaveLength(0);
  const approval = await caps.authoriseChange({ ...ctx, typed_approval_of: String(proposal.proposal_id) }, { proposal_id: String(proposal.proposal_id) });
  expect(approval.ok, JSON.stringify(approval)).toBe(true);
  expect(approval.applied).toBe(true);
  expect(writes).toHaveLength(1);
  return { proposal, op: proposals.get(String(proposal.proposal_id))!.operations[0]!, edge: read().edges.find(e => e.from === from.toLowerCase())! };
}

describe('T2-A retained input_claim on the exact link through proposal, approval, canonical writer and JSON readback', () => {
  // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
  // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
  // Quoted: old (T2A3) model_proposed → new user_stated. Not quoted: old model_proposed → new origin unknown.
  it('(a) earlier verified words naming both ends, quoted by the AI, credit the exact link', async () => {
    const result = await journey('Price', { from_words: history });
    expect((result.op.value as { author: string }).author).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
    expect(result.edge.strength.mean).toBe(0.1);
  });
  it.each([{}, { user_stated: false, basis: 'Model estimate' }])('(a) the same earlier words, NOT quoted: origin unknown, nothing prepared: %j', async overrides => {
    const { result, writes } = await offer('Price', overrides);
    expect(result).toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(writes).toHaveLength(0);
  });
  it.each([{}, { user_stated: false, basis: 'Model estimate' }, { from_words: history }])('(b) a different existing link stays Olumi’s: %j', async overrides => {
    const result = await journey('Quality', overrides);
    expect((result.op.value as { author: string }).author).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
    expect(result.edge.provenance.magnitude).toBe('olumi_estimate');
    expect(result.proposal.public_label).toBe('Record this link strength: "Quality" → "MRR" as slight, Olumi’s estimate');
  });
  // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED, old Olumi's estimate (cee_hypothesis) → new origin unknown, nothing
  // prepared: an unverified statement of this band for this link is never relabelled Olumi's. Without it, Olumi's estimate.
  it('unverified history cannot supply human evidence, and is never relabelled Olumi\u2019s estimate', async () => {
    const { result, writes } = await offer('Price', {}, 'Please suggest a strength.', { unverified_user_text: history });
    expect(result).toMatchObject({ ok: false, refusal: 'origin_unknown', link: '"Price" \u2192 "MRR"' });
    expect(writes).toHaveLength(0);
    expect((await journey('Price', {}, 'Please suggest a strength.')).edge.provenance.source, 'control: no such words').toBe('cee_hypothesis');
  });
  it.each([
    'MRR has a weak effect on Price', 'Price has a weak effect. MRR is important.',
    'Price is weakly affected by MRR', 'Price gets a weak contribution from MRR',
    'Price has a weak effect on Quality; Quality affects MRR.', 'Does Price have a weak effect on MRR?',
    'Price does not have a weak effect on MRR', 'Price has a strong effect on MRR; Quality has a weak effect on MRR',
    // T2A3: the user reporting or disputing Olumi's claim is not stating it.
    'Olumi says Price has a weak effect on MRR. Is that right?', 'You suggested Price has a weak effect on MRR; I disagree.',
    'According to Olumi, Price has a weak effect on MRR.', 'You suggested: Price has a weak effect on MRR.',
    'Price has a weak effect on MRR. Is that right?',
    // Superseded: the latest statement for the pair wins.
    'Price has a weak effect on MRR. Actually, Price has a strong effect on MRR.',
    // T2A3 buddy review: a framing clause covers the rest of its message; quoted first person stays Olumi's.
    'Olumi supplied these estimates. Price has a weak effect on MRR.',
    'Olumi says, "I think Price has a weak effect on MRR."',
    // A disowning message credits nothing, for every link.
    'None of these are my estimates. Price has a weak effect on MRR.',
    'Price has a weak effect on MRR. Quality has a weak effect on MRR. I disagree with all these estimates.',
  ])('no credit from another pair, clause or band: %s', text => {
    expect(linkBandTheUserStated('weak', text, nodes, 'price', 'mrr')).toBe(false);
  });
});

const priceReview = {
  grounded_selection: { element_ids: [], unresolved: 'none' as const },
  grounded_links: [{ from: 'price', to: 'mrr' }],
};
describe('T2A2 current interaction supplies the exact link, never an end from history', () => {
  it('Price is strong. with no drawn or reviewed link is not human', async () => {
    const result = await journey('Price', { strength: 'strong' }, 'Price is strong.',
      { user_turn_text: 'Price is strong.' }, 0.3);
    expect((result.op.value as { author: string }).author).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
    expect(result.proposal.public_label).toBe('Record this link strength: "Price" → "MRR" as strong, Olumi’s estimate');
  });
  // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
  // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
  // Price without a quote, old (T2A3) model_proposed → new origin unknown; the AI's quote "Price is strong" credits it.
  it.each([['Price', undefined], ['Quality', undefined], ['Price', 'Price is strong'], ['Quality', 'Price is strong']] as const)('review A with earlier history B credits only A, and only with the AI\u2019s quote: %s, from_words %s', async (from, quote) => {
    if (from === 'Price' && quote === undefined) return expectUnknown(from, { strength: 'strong', user_stated: false, basis: 'Model estimate' },
      'Quality has a weak effect on MRR. Price is strong.', { ...priceReview, user_turn_text: 'Price is strong.' }, 0.3);
    const result = await journey(from, { strength: 'strong', user_stated: false, basis: 'Model estimate', ...(quote === undefined ? {} : { from_words: quote }) },
      'Quality has a weak effect on MRR. Price is strong.',
      { ...priceReview, user_turn_text: 'Price is strong.' }, 0.3);
    const theirs = from === 'Price' && quote !== undefined;
    expect((result.op.value as { author: string }).author).toBe(theirs ? 'user_stated' : 'model_proposed');
    expect(result.edge.provenance.source).toBe(theirs ? 'user_specified' : 'cee_hypothesis');
    expect(result.edge.strength.mean).toBe(0.55);
  });
  it('a current review card cannot borrow the shorthand band from earlier history', async () => {
    const result = await journey('Price', { strength: 'strong' }, 'Price is strong. Please prepare the link.',
      { ...priceReview, user_turn_text: 'Please prepare the link.' }, 0.3);
    expect((result.op.value as { author: string }).author).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
  it.each([undefined, [{ from: 'mrr', to: 'price' }]])('two selected nodes or the reversed link cannot ground a directed link: %j', async grounded_links => {
    const result = await journey('Price', { strength: 'strong' }, 'Price is strong.', {
      user_turn_text: 'Price is strong.',
      grounded_selection: { element_ids: ['price', 'mrr'], unresolved: 'none' }, grounded_links,
    }, 0.3);
    expect((result.op.value as { author: string }).author).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
  it('an unresolved selection cannot ground shorthand', async () => {
    const result = await journey('Price', { strength: 'strong' }, 'Price is strong.', {
      ...priceReview, user_turn_text: 'Price is strong.',
      grounded_selection: { element_ids: [], unresolved: 'could_not_check' },
    }, 0.3);
    expect((result.op.value as { author: string }).author).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
});

const author = (result: Awaited<ReturnType<typeof journey>>) => (result.op.value as { author: string }).author;
/** T2A5: the user's own words, not verifiably quoted, keep an unknown origin: the set is refused and nothing is written. */
async function expectUnknown(...input: Parameters<typeof offer>) {
  const { result, writes } = await offer(...input);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: false, refusal: 'origin_unknown' });
  expect(writes).toHaveLength(0);
}
const bothReview = {
  grounded_selection: { element_ids: [], unresolved: 'none' as const },
  grounded_links: [{ from: 'price', to: 'mrr' }, { from: 'quality', to: 'mrr' }],
};
describe('T2A3 (#2993 check): a bound link still needs the user’s words to name an end of it', () => {
  it.each([{}, { from_words: 'Quality is strong.' }])('blocking 1: Price → MRR selected, "Quality is strong." stays Olumi’s: %j', async overrides => {
    const result = await journey('Price', { strength: 'strong', ...overrides }, 'Quality is strong.',
      { ...priceReview, user_turn_text: 'Quality is strong.' }, 0.3);
    expect(author(result)).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
    expect(result.proposal.public_label).toBe('Record this link strength: "Price" → "MRR" as strong, Olumi’s estimate');
  });
  // PL 22:07Z: an ambiguous selection (two links selected) credits NO link, even the one whose end is named.
  it('blocking 1, two links selected: "Quality is strong." credits neither link', async () => {
    for (const from of ['Price', 'Quality']) {
      const result = await journey(from, { strength: 'strong' }, 'Quality is strong.',
        { ...bothReview, user_turn_text: 'Quality is strong.' }, 0.3);
      expect(author(result), from).toBe('model_proposed');
      expect(result.edge.provenance.source, from).toBe('cee_hypothesis');
    }
  });
  it.each([
    ['an end both selected links share', 'MRR is strong.', bothReview],
    ['another entity in the same clause', 'Price is fine but Quality is strong.', priceReview],
  ] as const)('no credit for %s', async (_case, words, review) => {
    const result = await journey('Price', { strength: 'strong' }, words, { ...review, user_turn_text: words }, 0.3);
    expect(author(result)).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
});

describe('T2A3 (#2993 check): reporting or disputing Olumi’s claim is not the user’s statement', () => {
  const later = 'OK, record your estimates for the links.';
  it.each([
    'Olumi says Price has a weak effect on MRR. Is that right?',
    'You suggested Price has a weak effect on MRR; I disagree.',
    'According to Olumi, Price has a weak effect on MRR.',
  ])('blocking 2: "%s" then a later estimate stays Olumi’s, flagged or not', async earlier => {
    for (const overrides of [{}, { user_stated: false, basis: 'Model estimate' }]) {
      const result = await journey('Price', overrides, `${earlier}\n${later}`, { user_turn_text: later });
      expect(author(result), JSON.stringify(overrides)).toBe('model_proposed');
      expect(result.edge.provenance.source).toBe('cee_hypothesis');
      expect(result.edge.provenance.magnitude).toBe('olumi_estimate');
    }
  });
  // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
  // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
  // Quoted: old (T2A3) model_proposed → new user_stated. Not quoted: old model_proposed → new origin unknown.
  it('control: the user’s own earlier statement, quoted by the AI, is credited', async () => {
    const result = await journey('Price', { from_words: 'Price has a weak effect on MRR.' }, `Price has a weak effect on MRR.\n${later}`, { user_turn_text: later });
    expect(author(result)).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
    await expectUnknown('Price', {}, `Price has a weak effect on MRR.\n${later}`, { user_turn_text: later });
  });
});

describe('T2A3: a later statement supersedes an earlier one for the same link', () => {
  // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
  // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
  // "strong": not quoted, old (T2A3) model_proposed → new origin unknown; quoted, old model_proposed → new user_stated. The
  // superseded "weak", even quoted, is never the user's (a later message states another band).
  it.each([
    ['weak', undefined, 'model_proposed'], ['weak', 'Price has a weak effect on MRR.', 'model_proposed'],
    ['strong', undefined, 'unknown'], ['strong', 'Actually, Price has a strong effect on MRR.', 'user_stated'],
  ] as const)('"weak", then "Actually … strong": %s (from_words %s) is %s', async (strength, quote, want) => {
    const words = 'Price has a weak effect on MRR.\nActually, Price has a strong effect on MRR.';
    const overrides = { strength, ...(quote === undefined ? {} : { from_words: quote }) };
    if (want === 'unknown') return expectUnknown('Price', overrides, words, { user_turn_text: 'Please prepare the link.' }, 0.3);
    const result = await journey('Price', overrides, words, { user_turn_text: 'Please prepare the link.' }, strength === 'weak' ? 0.55 : 0.3);
    expect(author(result)).toBe(want);
  });
  it('this message’s shorthand for the selected link supersedes an earlier band', async () => {
    const result = await journey('Price', { strength: 'weak' }, `${history}\nPrice is strong.`,
      { ...priceReview, user_turn_text: 'Price is strong.' });
    expect(author(result)).toBe('model_proposed');
  });
});

describe('T2A3 buddy review (Codex, read-only): same-sentence bands, direction, framing and scope', () => {
  it.each([
    ['a second band in the same clause', 'Price has a weak effect on MRR, and our evidence is strong.', 'strong'],
    ['the reversed direction, with the link selected', 'MRR has a weak effect on Price.', 'weak'],
    ['a passive reading, with the link selected', 'Price is weakly affected by MRR.', 'weak'],
  ] as const)('no credit for %s', async (_case, words, strength) => {
    // The link sits in another band, so the proposal MOVES it (a set, never a no-change review).
    const result = await journey('Price', { strength }, words, { ...priceReview, user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
    expect(author(result)).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
  it('a framing clause ("Olumi supplied these estimates.") makes the rest of that message Olumi\u2019s, for EVERY link', async () => {
    const words = 'Olumi supplied these estimates. Price has a weak effect on MRR. Quality has a weak effect on MRR.';
    for (const from of ['Price', 'Quality']) {
      const result = await journey(from, {}, words, { user_turn_text: 'Please prepare the links.' });
      expect(author(result), from).toBe('model_proposed');
      expect(result.edge.provenance.source, from).toBe('cee_hypothesis');
    }
  });
  // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
  // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
  // Quoted: old (T2A3) model_proposed → new user_stated. Not quoted: old model_proposed → new origin unknown.
  it('the frame stops at its own message: the user\u2019s next message, quoted by the AI, is theirs', async () => {
    const verified_user_messages = ['Olumi supplied these estimates.', 'Price has a weak effect on MRR.', 'Please prepare the link.'];
    const result = await journey('Price', { from_words: 'Price has a weak effect on MRR.' }, verified_user_messages.join('\n'), { verified_user_messages });
    expect(author(result)).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
    await expectUnknown('Price', {}, verified_user_messages.join('\n'), { verified_user_messages });
  });
  it.each([
    ['Olumi says Quality is weak; my own estimate is that Price has a strong effect on MRR.', 'my own estimate is that Price has a strong effect on MRR.'],
    ['Price has a strong effect on MRR. I disagree with Olumi about Quality.', 'Price has a strong effect on MRR.'],
  ])('an attribution or dispute about something else never demotes the user\u2019s own quoted statement: %s', async (words, statement) => {
    // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
    // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
    // Not quoted: old (T2A3) model_proposed → new origin unknown. The quote is the user's COMPLETE statement (AIE).
    await expectUnknown('Price', { strength: 'strong' }, words, { user_turn_text: words }, 0.3);
    const result = await journey('Price', { strength: 'strong', from_words: statement }, words, { user_turn_text: words }, 0.3);
    expect(author(result)).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
  });
});

describe('T2A3 (DL, PL 22:07Z): first-person claims after an attribution, and "<X> effects" in this message', () => {
  it('"Olumi says Quality is weak, but I think Price has a strong effect on MRR." credits the user\u2019s own quoted clause', async () => {
    const words = 'Olumi says Quality is weak, but I think Price has a strong effect on MRR.';
    // ⭐ T2A5 (AIE 6157593360): EXPECTATION CHANGED. The AI's verbatim quote of the user's complete statement credits it, in
    // this message or an earlier one; the user's own words NOT quoted are never relabelled Olumi's: origin unknown, nothing prepared.
    // Not quoted: old (T2A3) model_proposed → new origin unknown. Quoted, the COMPLETE statement (AIE: with its source):
    await expectUnknown('Price', { strength: 'strong' }, words, { user_turn_text: words }, 0.3);
    const result = await journey('Price', { strength: 'strong', from_words: words }, words, { user_turn_text: words }, 0.3);
    expect(author(result)).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
  });
  // ⛔ T2A3 DL ruling (Codex FAIL on c78b4ad4): a band is the user's only with the AI's own quote of THIS message (`from_words`);
  // no quote → Olumi's, and earlier messages credit nothing (staging never did) until T2A5's quote. EXPECTATION CHANGED:
  // the first row, old user_stated → new model_proposed (no quote); its quoted twin keeps the old outcome. Every negative
  // runs with the AI quoting the whole message, so the host's veto is what keeps it Olumi's.
  it.each([
    // T2A5 (AIE): not quoted, old (T2A3) model_proposed → new origin unknown, nothing prepared.
    ['this message: "Price effects are weak." credits the link leaving Price', 'Price effects are weak.', 'Price effects are weak.', 'unknown', undefined],
    ['this message, with the AI\u2019s quote: "Price effects are weak." credits the link leaving Price', 'Price effects are weak.', 'Price effects are weak.', 'user_stated', 'Price effects are weak'],
    ['earlier history never supplies the target of a plural', 'Price effects are weak.', 'Please prepare the link.', 'model_proposed', 'Price effects are weak'],
    ['"Olumi says Price effects are weak." is Olumi\u2019s', 'Olumi says Price effects are weak.', 'Olumi says Price effects are weak.', 'model_proposed', 'Olumi says Price effects are weak'],
    ['a second entity named beside the plural gives no blanket credit', 'Quality matters, and Price effects are weak.', 'Quality matters, and Price effects are weak.', 'model_proposed', 'Quality matters, and Price effects are weak'],
  ] as const)('%s', async (_case, verified, turn, want, quote) => {
    if (want === 'unknown') return expectUnknown('Price', {}, verified, { user_turn_text: turn });
    const result = await journey('Price', quote === undefined ? {} : { from_words: quote }, verified, { user_turn_text: turn });
    expect(author(result)).toBe(want);
    expect(result.edge.provenance.source).toBe(want === 'user_stated' ? 'user_specified' : 'cee_hypothesis');
  });
});

describe('T2A3 buddy review 3 (Codex, read-only, 35aae691): the band belongs to the link\u2019s phrase; disowning reaches every link', () => {
  it.each([
    ['Price is £49 and MRR growth is strong.', 'strong', 'model_proposed'],
    ['Price affects MRR, and our evidence is strong.', 'strong', 'model_proposed'],
    ['Price has a weak effect on MRR, and our evidence is strong.', 'strong', 'model_proposed'],
    // The user's own band in the same sentence is still theirs (never demoted by an unrelated band), when the AI quotes it.
    // T2A5 (AIE 6157593360): EXPECTATION CHANGED for the four unquoted rows, old (T2A3) model_proposed → new origin unknown
    // (the user's own words are never relabelled Olumi's). The quoted twins now quote the COMPLETE statement (AIE: a
    // substring is not a receipt); old quote → new quote: "Price has a weak effect on MRR" → the whole sentence, and
    // "my own estimate is that …" → "But my own estimate is that …". Outcome unchanged: user_stated.
    ['Price has a weak effect on MRR, and our evidence is strong.', 'weak', 'unknown'],
    ['Price has a weak effect on MRR, while Olumi says Quality is strong.', 'weak', 'unknown'],
    ['Olumi supplied these estimates. But my own estimate is that Price has a weak effect on MRR.', 'weak', 'unknown'],
    ['Price \u2192 MRR is strong.', 'strong', 'unknown'],
    ['Price has a weak effect on MRR, and our evidence is strong.', 'weak', 'user_stated', 'Price has a weak effect on MRR, and our evidence is strong.'],
    ['Price has a weak effect on MRR, while Olumi says Quality is strong.', 'weak', 'user_stated', 'Price has a weak effect on MRR, while Olumi says Quality is strong.'],
    ['Olumi supplied these estimates. But my own estimate is that Price has a weak effect on MRR.', 'weak', 'user_stated', 'But my own estimate is that Price has a weak effect on MRR.'],
    ['Price \u2192 MRR is strong.', 'strong', 'user_stated', 'Price \u2192 MRR is strong'],
  ] as const)('"%s" proposing %s → %s (from_words %s)', async (words, strength, want, quote?: string) => {
    if (want === 'unknown') return expectUnknown('Price', { strength }, words, { user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
    const result = await journey('Price', { strength, ...(quote === undefined ? {} : { from_words: quote }) }, words, { user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
    expect(author(result)).toBe(want);
    expect(result.edge.provenance.source).toBe(want === 'user_stated' ? 'user_specified' : 'cee_hypothesis');
  });
  it.each([
    'None of these are my estimates. Price has a weak effect on MRR. Quality has a weak effect on MRR.',
    'Price has a weak effect on MRR. Quality has a weak effect on MRR. I disagree with all these estimates.',
  ])('a disowning message credits NO link: %s', async words => {
    for (const from of ['Price', 'Quality']) {
      const result = await journey(from, {}, words, { user_turn_text: words });
      expect(author(result), from).toBe('model_proposed');
    }
  });
  it('withdrawing earlier estimates now stops history crediting EVERY link', async () => {
    const verified_user_messages = ['Price has a weak effect on MRR. Quality has a weak effect on MRR.', 'I withdraw all my earlier estimates.'];
    for (const from of ['Price', 'Quality']) {
      const result = await journey(from, {}, verified_user_messages.join('\n'),
        { verified_user_messages, user_turn_text: verified_user_messages[1] });
      expect(author(result), from).toBe('model_proposed');
    }
  });
  it('a selected reverse link cannot borrow an outgoing plural ("Price effects are strong." with MRR \u2192 Price selected)', () => {
    expect(latestLinkBands('Price effects are strong.', nodes, 'mrr', 'price', { bound: [{ from: 'mrr', to: 'price' }] })).toBeNull();
    expect(latestLinkBands('Price effects are strong.', nodes, 'price', 'mrr', { bound: [] }), 'control: the outgoing link').toEqual(['strong']);
  });
});

describe('T2A3 buddy review 4 (Codex, read-only, 07323ca6)', () => {
  it.each([
    ['Price is £49 and strong MRR growth continues.', 'strong', 'model_proposed'],
    ['Olumi says "Quality is weak, but I think Price has a strong effect on MRR."', 'strong', 'model_proposed'],
    ['Price has a weak effect on MRR, according to Olumi.', 'weak', 'model_proposed'],
    // T2A5 (AIE 6157593360): EXPECTATION CHANGED for the two unquoted rows, old (T2A3) model_proposed → new origin unknown.
    ['I do not withdraw my estimates. Price has a weak effect on MRR.', 'weak', 'unknown'],
    ['I estimate a weak effect of Price on MRR.', 'weak', 'unknown'],
    ['I do not withdraw my estimates. Price has a weak effect on MRR.', 'weak', 'user_stated', 'Price has a weak effect on MRR'],
    ['I estimate a weak effect of Price on MRR.', 'weak', 'user_stated', 'I estimate a weak effect of Price on MRR'],
  ] as const)('"%s" proposing %s → %s (from_words %s)', async (words, strength, want, quote?: string) => {
    if (want === 'unknown') return expectUnknown('Price', { strength }, words, { user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
    const result = await journey('Price', { strength, ...(quote === undefined ? {} : { from_words: quote }) }, words, { user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
    expect(author(result)).toBe(want);
    expect(result.edge.provenance.source).toBe(want === 'user_stated' ? 'user_specified' : 'cee_hypothesis');
  });
});

// ⛔ T2A3 DL ruling: credit now rests on the AI's quote, so every negative is re-run with the AI quoting the WHOLE message
// (the adverse case: staging credits such a quote). The host's veto is what keeps each one Olumi's.
describe('T2A3 ruling: the AI quoting the user\u2019s whole message credits none of the negatives', () => {
  it.each([
    ['Price is strong.', 'strong', {}],
    ['Price is strong.', 'strong', { grounded_selection: { element_ids: ['price', 'mrr'], unresolved: 'none' as const } }],
    ['Price has a weak effect on MRR, and our evidence is strong.', 'strong', {}],
    ['MRR has a weak effect on Price.', 'weak', priceReview],
    ['Price is weakly affected by MRR.', 'weak', priceReview],
    ['Price is £49 and MRR growth is strong.', 'strong', {}],
    ['Price affects MRR, and our evidence is strong.', 'strong', {}],
    ['Price is £49 and strong MRR growth continues.', 'strong', {}],
    ['Olumi says "Quality is weak, but I think Price has a strong effect on MRR."', 'strong', {}],
    ['Price has a weak effect on MRR, according to Olumi.', 'weak', {}],
    ['Olumi says Price has a weak effect on MRR. Is that right?', 'weak', {}],
    ['You suggested Price has a weak effect on MRR; I disagree.', 'weak', {}],
    ['According to Olumi, Price has a weak effect on MRR.', 'weak', {}],
    ['Olumi supplied these estimates. Price has a weak effect on MRR.', 'weak', {}],
    ['Price has a weak effect on MRR. Is that right?', 'weak', {}],
    ['Price has a weak effect on MRR. Actually, Price has a strong effect on MRR.', 'weak', {}],
    ['None of these are my estimates. Price has a weak effect on MRR. Quality has a weak effect on MRR.', 'weak', {}],
    ['Price has a weak effect on MRR. Quality has a weak effect on MRR. I disagree with all these estimates.', 'weak', {}],
  ] as const)('"%s" proposing %s, quoted whole → Olumi\u2019s', async (words, strength, interaction) => {
    const result = await journey('Price', { strength, from_words: words }, words, { ...interaction, user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
    expect(author(result)).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
});

// ⭐ T2A5 (AIE 6157593360): the host's mechanical checks on the AI's quote, one row each (a quote that fails is never Olumi's).
describe('T2A5: the AI quotes the user\u2019s complete statement, the host verifies it', () => {
  it('a FRAGMENT of the user\u2019s own sentence is not a receipt: origin unknown, nothing prepared', async () => {
    const words = 'Price has a weak effect on MRR, and our evidence is strong.';
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR' }, words, { user_turn_text: words });
  });
  it('words the user never wrote are not a receipt (and the band unstated: Olumi\u2019s own estimate)', async () => {
    const result = await journey('Price', { from_words: 'Price has a weak effect on MRR.' }, 'Please size the links.', { user_turn_text: 'Please size the links.' });
    expect(author(result)).toBe('model_proposed');
  });
  it('one named end never binds: "Price is weak." quoted whole, nothing selected → not the user\u2019s', async () => {
    const words = 'Price is weak.';
    const result = await journey('Price', { from_words: words }, words, { user_turn_text: words });
    expect(author(result)).toBe('model_proposed');
  });
  it('a quote from UNVERIFIED words is never a receipt: origin unknown', async () => {
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR' }, 'Please size the links.',
      { user_turn_text: 'Please size the links.', unverified_user_text: 'Price has a weak effect on MRR' });
  });
});
