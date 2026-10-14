import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentCapabilities, leftOutCard, LINK_SET_SAVE_NOT_CONFIRMED, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { narrateWriteOutcome } from '../write-outcome.js';
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

function harness(mean: number, tamper?: (g: ReturnType<typeof initial>) => void) {
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
      // A row may change the stored graph after the commit, before Olumi reads it back.
      if (tamper !== undefined) { const g = read(); tamper(g); bytes = JSON.stringify(g); }
      return { status: 'committed', graph_hash: result.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [] };
    },
  });
  return { caps, proposals, writes, read };
}
// T2A5: no unverified text by default (an unverified statement of the band makes its origin unknown, AIE 6157593360).
const contextOf = (verified: string, interaction: Partial<AgentToolContext>) => ({ scenario_id: scenario, authenticated_user_id: null,
  request_id: 't2a', user_text: verified, user_turn_text: 'Please prepare the link.', ...interaction });
// ⛔ INPUT CHANGE (#3002, known-origin transport): every stub link declares its `origin`, as a prompt-following AI gives it: user
// when it quotes the user (`from_words`); olumi, with Olumi's own basis, when it does not. A row may still set it.
const linkOf = (from: string, overrides: Record<string, unknown>) => ({ links: [{ from_label: from, to_label: 'MRR', strength: 'weak',
  origin: typeof overrides.from_words === 'string' ? 'user' : 'olumi', ...(typeof overrides.from_words === 'string' ? {} : { basis: 'Olumi\u2019s own estimate from the model' }),
  ...overrides }],
  rationale: 'Prepare the requested link strength.' }) as never;
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
  it.each([{}, { origin: 'olumi', basis: 'Model estimate' }])('(a) the same earlier words, NOT quoted: origin unknown, nothing prepared: %j', async overrides => {
    const { result, writes } = await offer('Price', overrides);
    expect(result).toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(writes).toHaveLength(0);
  });
  // ⛔ EXPECTATION CHANGED (#3002 r2, DL three tiers on Codex CHECK-3002-a3b352af): a quote the host cannot verify is UNKNOWN,
  // never Olumi's (old model_proposed → new origin unknown, nothing prepared). Olumi's needs origin olumi, its basis and NO quote.
  it.each([{}, { origin: 'olumi', basis: 'Model estimate' }, { from_words: history }])('(b) a different existing link stays Olumi’s, or unknown when quoted: %j', async overrides => {
    if ('from_words' in overrides) return expectUnknown('Quality', overrides);
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
    if (from === 'Price' && quote === undefined) return expectUnknown(from, { strength: 'strong', origin: 'olumi', basis: 'Model estimate' },
      'Quality has a weak effect on MRR. Price is strong.', { ...priceReview, user_turn_text: 'Price is strong.' }, 0.3);
    // ⛔ INPUT CHANGE (#3002): the quoting AI declares the quote the user's (origin user); the AI's declared origin is
    // never overridden. Quality quoting "Price is strong" does not verify: old model_proposed → new origin unknown.
    if (from === 'Quality' && quote !== undefined) return expectUnknown(from, { strength: 'strong', origin: 'user', from_words: quote },
      'Quality has a weak effect on MRR. Price is strong.', { ...priceReview, user_turn_text: 'Price is strong.' }, 0.3);
    const result = await journey(from, { strength: 'strong', ...(quote === undefined ? { origin: 'olumi', basis: 'Model estimate' } : { origin: 'user', from_words: quote }) },
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
  // ⛔ EXPECTATION CHANGED (#3002 r2, DL three tiers on Codex CHECK-3002-a3b352af): a quote the host cannot verify is UNKNOWN,
  // never Olumi's (old model_proposed → new origin unknown, nothing prepared). Olumi's needs origin olumi, its basis and NO quote.
  it.each([{}, { from_words: 'Quality is strong.' }])('blocking 1: Price → MRR selected, "Quality is strong." stays Olumi’s, or unknown when quoted: %j', async overrides => {
    if ('from_words' in overrides) return expectUnknown('Price', { strength: 'strong', ...overrides }, 'Quality is strong.', { ...priceReview, user_turn_text: 'Quality is strong.' }, 0.3);
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
    for (const overrides of [{}, { origin: 'olumi', basis: 'Model estimate' }]) {
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
    // Buddy (fd148466): the superseded "weak" is still the user's earlier words, so proposing it is conflicting origin: old
    // model_proposed → new origin unknown, quoted or not (AIE: conflicting origin stays unknown).
    ['weak', undefined, 'unknown'], ['weak', 'Price has a weak effect on MRR.', 'unknown'],
    ['strong', undefined, 'unknown'], ['strong', 'Actually, Price has a strong effect on MRR.', 'user_stated'],
  ] as const)('"weak", then "Actually … strong": %s (from_words %s) is %s', async (strength, quote, want) => {
    const words = 'Price has a weak effect on MRR.\nActually, Price has a strong effect on MRR.';
    const overrides = { strength, ...(quote === undefined ? {} : { from_words: quote }) };
    if (want === 'unknown') return expectUnknown('Price', overrides, words, { user_turn_text: 'Please prepare the link.' }, strength === 'weak' ? 0.55 : 0.3);
    // Only the quoted "strong" row reaches here (the rest are origin unknown): it MOVES the link from 0.3.
    const result = await journey('Price', overrides, words, { user_turn_text: 'Please prepare the link.' }, 0.3);
    expect(author(result)).toBe(want);
  });
  // ⭐ T2A5 (buddy fd148466): EXPECTATION CHANGED, old model_proposed → new origin unknown: the superseded earlier "weak" is
  // still the user's words, so Olumi proposing it is conflicting origin, never Olumi's own estimate.
  it('this message’s shorthand for the selected link supersedes an earlier band; proposing the earlier band is origin unknown', async () => {
    await expectUnknown('Price', { strength: 'weak' }, `${history}\nPrice is strong.`, { ...priceReview, user_turn_text: 'Price is strong.' });
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
    // T2A5 (buddy fd148466): history still never CREDITS a plural, but it holds the band: old model_proposed → new origin unknown.
    ['earlier history never supplies the target of a plural', 'Price effects are weak.', 'Please prepare the link.', 'unknown', 'Price effects are weak'],
    // ⛔ EXPECTATION CHANGED (#3002 r2): quoted but unverified → old model_proposed → new origin unknown (never Olumi's).
    ['"Olumi says Price effects are weak." is never the user\u2019s: unknown', 'Olumi says Price effects are weak.', 'Olumi says Price effects are weak.', 'unknown', 'Olumi says Price effects are weak'],
    // ⛔ EXPECTATION CHANGED (#3002 r2): quoted but unverified → old model_proposed → new origin unknown (never Olumi's).
    ['a second entity named beside the plural gives no blanket credit', 'Quality matters, and Price effects are weak.', 'Quality matters, and Price effects are weak.', 'unknown', 'Quality matters, and Price effects are weak'],
  ] as const)('%s', async (_case, verified, turn, want, quote) => {
    if (want === 'unknown') return expectUnknown('Price', quote === undefined ? {} : { from_words: quote }, verified, { user_turn_text: turn });
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
  // ⭐ T2A5 (buddy fd148466): EXPECTATION CHANGED, old model_proposed → new origin unknown: the withdrawn statements are still
  // the user's words, so Olumi proposing the same band is conflicting origin; nothing is credited either way.
  it('withdrawing earlier estimates stops history crediting EVERY link; proposing the withdrawn band is origin unknown', async () => {
    const verified_user_messages = ['Price has a weak effect on MRR. Quality has a weak effect on MRR.', 'I withdraw all my earlier estimates.'];
    for (const from of ['Price', 'Quality']) {
      for (const overrides of [{}, { from_words: 'Price has a weak effect on MRR. Quality has a weak effect on MRR.' }]) {
        await expectUnknown(from, overrides, verified_user_messages.join('\n'), { verified_user_messages, user_turn_text: verified_user_messages[1] });
      }
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
    // The two origin-unknown rows here both propose "weak": the link sits at 0.55, so the band MOVES it.
    if (want === 'unknown') return expectUnknown('Price', { strength }, words, { user_turn_text: words }, 0.55);
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
  ] as const)('"%s" proposing %s, quoted whole → never the user\u2019s: unknown, nothing prepared', async (words, strength, interaction) => {
    // ⛔ EXPECTATION CHANGED (#3002 r2, DL three tiers on Codex CHECK-3002-a3b352af): a quote the host cannot verify is UNKNOWN,
    // never Olumi's (old model_proposed → new origin unknown, nothing prepared). Olumi's needs origin olumi, its basis and NO quote.
    await expectUnknown('Price', { strength, from_words: words }, words, { ...interaction, user_turn_text: words }, strength === 'strong' ? 0.3 : 0.55);
  });
});

// ⭐ T2A5 (AIE 6157593360): the host's mechanical checks on the AI's quote, one row each (a quote that fails is never Olumi's).
describe('T2A5: the AI quotes the user\u2019s complete statement, the host verifies it', () => {
  // ⭐ #3002 KNOWN-ORIGIN TRANSPORT (DL 14 Oct, after Codex CHECK-3002-783a55b8): the AI DECLARES whose band it is; the host
  // verifies. Olumi's estimate is only a declared olumi band with its own basis and no quote; a user band needs a verified quote
  // AND complete history; anything else stays UNKNOWN and is never written.
  it('CONTROL: origin olumi WITH Olumi\u2019s own basis, no quote, not read in the conversation, is Olumi\u2019s estimate', async () => {
    const result = await journey('Quality', { origin: 'olumi', basis: 'Quality shifts MRR only through churn in this model.' }, 'Please suggest a strength.', { user_turn_text: 'Please suggest a strength.' });
    expect(author(result)).toBe('model_proposed');
    expect(result.edge.provenance.magnitude).toBe('olumi_estimate');
  });
  it.each([
    ['origin olumi WITHOUT a basis', { origin: 'olumi', basis: undefined }],
    ['no origin: a false user flag plus basis text (the r2 shape) is no declaration', { origin: undefined, user_stated: false, basis: 'Quality shifts MRR only through churn in this model.' }],
    ['origin user WITHOUT a quote', { origin: 'user', basis: undefined }],
  ] as const)('%s: unknown, nothing prepared', async (_, overrides) => {
    await expectUnknown('Quality', overrides, 'Please suggest a strength.', { user_turn_text: 'Please suggest a strength.' });
  });
  it('under-declaration: a verified quote declared olumi is never relabelled Olumi\u2019s: unknown, nothing prepared', async () => {
    const words = 'Price has a weak effect on MRR.';
    await expectUnknown('Price', { origin: 'olumi', basis: 'Model estimate', from_words: words }, words, { user_turn_text: words });
  });
  it('origin third_party: never written, never Olumi\u2019s, left out and named with the source it cites', async () => {
    const words = 'Alice thinks Price has a weak effect on MRR.';
    const { result, writes } = await offer('Price', { origin: 'third_party', source: 'Alice', basis: undefined }, words, { user_turn_text: words });
    // ⛔ EXPECTATION CHANGED (packet 2b19ae59): named as the card names it, "attributed to" its whole source.
    expect(result).toMatchObject({ ok: false, refusal: 'origin_unknown', left_out_third_party: ['"Price" \u2192 "MRR", attributed to "Alice"'] });
    expect(writes).toHaveLength(0);
  });
  // ⛔ DL 14 Oct: reseeded chip text is stored as a user message, so a match there does not prove the user's words. Restored
  // rows reach the door only as UNVERIFIED text (`authorshipWords`), so a quote matching them alone is not a receipt.
  it('a quote matching ONLY restored (reseeded) text, never a typed message: unknown, nothing prepared', async () => {
    const restored = 'Price has a weak effect on MRR.';
    await expectUnknown('Price', { origin: 'user', from_words: restored }, 'Please record the links.',
      { user_turn_text: 'Please record the links.', unverified_user_text: restored, user_text_complete: false });
  });
  it('CONTROL: the same quote in a message the user TYPED is theirs, even with restored rows beside it (route turns are never "complete")', async () => {
    const words = 'Price has a weak effect on MRR.';
    const result = await journey('Price', { origin: 'user', from_words: words }, words,
      { user_turn_text: words, unverified_user_text: 'Some restored earlier row.', user_text_complete: false });
    expect(author(result)).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
  });
  it('truncated history + a quote of an earlier estimate the host cannot see: unknown, never "Olumi\u2019s estimate"', async () => {
    await expectUnknown('Price', { origin: 'user', from_words: 'Price has a weak effect on MRR.' }, 'Please record the links.',
      { user_turn_text: 'Please record the links.', user_text_complete: false });
  });
  it('a FRAGMENT of the user\u2019s own sentence is not a receipt: origin unknown, nothing prepared', async () => {
    const words = 'Price has a weak effect on MRR, and our evidence is strong.';
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR' }, words, { user_turn_text: words });
  });
  // ⛔ EXPECTATION CHANGED (#3002 r2, DL three tiers on Codex CHECK-3002-a3b352af): a quote the host cannot verify is UNKNOWN,
  // never Olumi's (old model_proposed → new origin unknown, nothing prepared). Olumi's needs origin olumi, its basis and NO quote.
  it('words the user never wrote are not a receipt: unknown, nothing prepared', async () => {
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR.' }, 'Please size the links.', { user_turn_text: 'Please size the links.' });
  });
  it('one named end never binds: "Price is weak." quoted whole, nothing selected → not the user\u2019s: unknown', async () => {
    const words = 'Price is weak.';
    await expectUnknown('Price', { from_words: words }, words, { user_turn_text: words });
  });
  it('the quote must bind THIS link by its own words: another sentence of the same message is not a receipt', async () => {
    const words = 'Price has a weak effect on MRR. Quality is weak.';
    await expectUnknown('Price', { from_words: 'Quality is weak.' }, words, { user_turn_text: words });
  });
  it.each([
    'Olumi supplied these estimates. Price has a weak effect on MRR.',
    'None of these are my estimates. Price has a weak effect on MRR.',
  ])('its whole message must agree: the framed or disowned sentence quoted alone is not the user\u2019s: unknown (%s)', async words => {
    // ⛔ EXPECTATION CHANGED (#3002 r2, DL three tiers on Codex CHECK-3002-a3b352af): a quote the host cannot verify is UNKNOWN,
    // never Olumi's (old model_proposed → new origin unknown, nothing prepared). Olumi's needs origin olumi, its basis and NO quote.
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR.' }, words, { user_turn_text: words });
  });
  // Buddy review (Codex, read-only, fd148466): a colon keeps its speaker; a later denial supersedes; copying is read widely.
  it('"Alice says: Price has a weak effect on MRR." quoted after the colon is not a receipt: origin unknown', async () => {
    const words = 'Alice says: Price has a weak effect on MRR.';
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR.' }, words, { user_turn_text: words });
  });
  it('a later message denying the band supersedes the quoted earlier statement: origin unknown', async () => {
    const verified_user_messages = ['Price has a weak effect on MRR.', 'Price does not have a weak effect on MRR.', 'Please size the link.'];
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR.' }, verified_user_messages.join('\n'), { verified_user_messages, user_turn_text: 'Please size the link.' });
  });
  it.each([
    ['unverified "<X> effects"', { ...priceReview, unverified_user_text: 'Price effects are weak.' }, 'Please size the link.'],
    ['an earlier verified "<X> effects"', { ...priceReview }, 'Price effects are weak.\nPlease size the link.'],
  ] as const)('copying is read widely: %s holding the band, unquoted → origin unknown, never Olumi\u2019s', async (_case, interaction, verified) => {
    await expectUnknown('Price', {}, verified, { ...interaction, user_turn_text: 'Please size the link.' });
  });
  it('a quote from UNVERIFIED words is never a receipt: origin unknown', async () => {
    await expectUnknown('Price', { from_words: 'Price has a weak effect on MRR' }, 'Please size the links.',
      { user_turn_text: 'Please size the links.', unverified_user_text: 'Price has a weak effect on MRR' });
  });
});

/**
 * ⭐ #3002: the AIE's companion, mixed-card and receipt texts (packet `AIE-LINK-ORIGIN-COMPANION-AND-MIXED-CARD-TEXTS-20261014.json`,
 * sha256 2b19ae59…, #94 6163353417). The literals below were extracted from the packet programmatically, never typed.
 */
const AIE = {
  source: 'Only with origin third_party: identify the person, publication or other source to which this specific directed-link band is attributed, using the retained source words. Preserve its complete applicable claim, qualifications, reference, period and verification state in the existing readable source and context. A name or citation alone does not verify the band or make it the user\'s judgement.',
  basis: 'Only with origin olumi: explain the grounded reasons for the genuinely new estimate Olumi is making now for this directed link, at its actual reference, period and conditions. A nonempty sentence, copied band, existing stored estimate or statement that the user did not supply it is not a basis for new AI authorship. If revising a prior estimate, identify the new estimate and its grounds while retaining the prior value and source separately. Preserve the full evidence and qualifications in the existing readable context.',
  strength: 'The band for this specific directed relationship. Declare its origin separately: a positively verified human statement, an attributed third-party claim, or a genuinely new grounded Olumi estimate. Missing human words do not make the band Olumi\'s. An unknown or unsupported origin stays unknown and is not offered as a change.',
  unknownOne: 'Left out of this change set: "A" \u2192 "B", because Olumi could not confirm who gave the proposed strength. Its current relationship and source are kept.',
  unknownMany: 'Left out of this change set: <directed relationships>, because Olumi could not confirm who gave the proposed strengths. Their current relationships and sources are kept.',
  thirdPartyOne: 'Left out of this change set: "A" \u2192 "B". The proposed strength comes from "<source>"; it is not presented as your judgement or a new Olumi estimate. Its current relationship and source are kept.',
  thirdPartyMany: 'Left out of this change set: <directed relationships, each with its attributed source>. These strengths are not presented as your judgement or new Olumi estimates. Their current relationships and sources are kept.',
  thirdPartyNote: 'Some proposed links were left out as attributed third-party bands (`left_out_third_party`). Name the directed relationships and their cited sources as the current card does; preserve the complete claims and their verification state. Say that this proposal does not change those links, not that the bands are absent from the model or have never been recorded. Do not ask the user to claim the source\'s view as their own. If the user independently supplies a new judgement, retain that new statement separately and use only an actually supported bound proposal; agreement or approval does not rewrite the original source.',
  unknownNote: 'Some proposed links were left out because the source of their bands could not be verified (`left_out_unknown_origin`). Name those directed relationships as the current card does. Their existing values and sources are kept; do not call the proposed bands the user\'s or Olumi\'s. Do not re-ask source already retained: explain the actual missing or conflicting binding, and use a focused clarification or useful evidence review where supported.',
  scopeNote: 'Nothing has changed yet. One approval applies only the changes listed as included on the current card, together or none; it does not apply any link listed as left out.',
  unconfirmed: 'The save could not be confirmed. Check the current model before retrying.',
};
describe('#3002 the AIE\u2019s texts and the whole-postimage receipt (packet 2b19ae59)', () => {
  const AB = '"A" \u2192 "B"';
  const price = '"Price" \u2192 "MRR"';
  const quality = '"Quality" \u2192 "MRR"';
  it('the tool\u2019s three field descriptions are the AIE\u2019s, byte for byte', () => {
    const item = (AGENT_TOOLS.find((t) => (t as { name?: string }).name === 'propose_link_strengths') as unknown as { parameters: any })
      .parameters.properties.links.items.properties;
    expect([item.source.description, item.basis.description, item.strength.description]).toEqual([AIE.source, AIE.basis, AIE.strength]);
    expect(item.origin.enum, 'the host-only `stored` is never offered to the AI').toEqual(['user', 'third_party', 'olumi']);
  });
  it('the four card sentences are the AIE\u2019s templates, filled with the model\u2019s labels and the whole source', () => {
    expect(leftOutCard('unknown_origin', [{ pair: AB }])).toBe(AIE.unknownOne);
    expect(leftOutCard('unknown_origin', [{ pair: price }, { pair: quality }])).toBe(AIE.unknownMany.replace('<directed relationships>', `${price}; ${quality}`));
    expect(leftOutCard('third_party', [{ pair: AB, source: '<source>' }])).toBe(AIE.thirdPartyOne);
    expect(leftOutCard('third_party', [{ pair: price, source: 'Alice' }, { pair: quality, source: 'the Smith report' }])).toBe(AIE.thirdPartyMany
      .replace('<directed relationships, each with its attributed source>', `${price}, attributed to "Alice"; ${quality}, attributed to "the Smith report"`));
    expect(leftOutCard('unknown_origin', [])).toBe('');
  });
  // The conversation states no band for Price, so Olumi's own estimate for it is not a copy.
  const asked = 'Please suggest the link strengths.';
  const mixed = (quality: Record<string, unknown>) => ({ links: [
    { from_label: 'Price', to_label: 'MRR', strength: 'weak', origin: 'olumi', basis: 'Olumi\u2019s own estimate from the model' },
    { from_label: 'Quality', to_label: 'MRR', strength: 'weak', ...quality }], rationale: 'Prepare the requested link strengths.' }) as never;
  it('a mixed card names its third-party link in the AIE\u2019s words, with the AIE\u2019s notes; the receipt repeats it once read back whole', async () => {
    const { caps, read } = harness(0.55);
    const ctx = contextOf(asked, { user_turn_text: 'Alice thinks Quality has a weak effect on MRR. Suggest the rest.' });
    const qualityBefore = JSON.stringify(read().edges.find((e) => e.from === 'quality'));
    const p = await caps.proposeLinkStrengths!(ctx, mixed({ origin: 'third_party', source: 'Alice' }));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const card = AIE.thirdPartyOne.replace(AB, quality).replace('<source>', 'Alice');
    expect(String(p.public_label).endsWith(`. ${card}`), String(p.public_label)).toBe(true);
    expect(String(p.note).startsWith(`${AIE.scopeNote} `)).toBe(true);
    expect(String(p.note)).toContain(AIE.thirdPartyNote);
    expect(String(p.note)).not.toContain(AIE.unknownNote);
    const out = await caps.authoriseChange({ ...ctx, typed_approval_of: String(p.proposal_id) }, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(String(out.follow_up)).toContain(card);
    expect(JSON.stringify(read().edges.find((e) => e.from === 'quality')), 'the left-out link keeps its value and source').toBe(qualityBefore);
  });
  it('a mixed card names its unknown link in the AIE\u2019s words, with the unknown note', async () => {
    const { caps } = harness(0.55);
    const p = await caps.proposeLinkStrengths!(contextOf(asked, {}), mixed({}));
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label).endsWith(`. ${AIE.unknownOne.replace(AB, quality)}`), String(p.public_label)).toBe(true);
    expect(String(p.note)).toContain(AIE.unknownNote);
    expect(String(p.note)).not.toContain(AIE.thirdPartyNote);
  });
  it('⭐ RED→GREEN: a left-out link that does not read back as it was makes the save UNCONFIRMED, in the AIE\u2019s words: no receipt', async () => {
    const { caps, read } = harness(0.55, (g) => { g.edges.find((e) => e.from === 'quality')!.provenance = { source: 'user_specified', magnitude: 'olumi_estimate' }; });
    const ctx = contextOf(asked, {});
    const p = await caps.proposeLinkStrengths!(ctx, mixed({ origin: 'third_party', source: 'Alice' }));
    const out = await caps.authoriseChange({ ...ctx, typed_approval_of: String(p.proposal_id) }, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_verified', follow_up: AIE.unconfirmed });
    expect(out.follow_up).toBe(LINK_SET_SAVE_NOT_CONFIRMED);
    // The user reads the AIE's one line, never "Recorded" or a left-out sentence.
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [out]).status).toBe(AIE.unconfirmed);
    expect(read().edges.find((e) => e.from === 'price')!.strength.mean, 'the approved link did land').not.toBe(0.55);
  });
  // ⭐ Buddy r1 on 0bbc66bc: an APPROVED link must read back whole too, never only its mean and its whose-mark.
  const review = { links: [{ from_label: 'Quality', to_label: 'MRR', strength: 'strong', origin: 'stored' }], rationale: 'Run a pre-mortem' } as never;
  it.each([
    ['an approved review\u2019s spread moved (0.1 → 0.99)', review, (g: ReturnType<typeof initial>) => { g.edges.find((e) => e.from === 'quality')!.strength.std = 0.99; }],
    ['an approved Olumi estimate\u2019s source moved', mixed({ origin: 'third_party', source: 'Alice' }),
      (g: ReturnType<typeof initial>) => { g.edges.find((e) => e.from === 'price')!.provenance.source = 'brief_extraction'; }],
    // Outside what the analysis reads (only the writer's scope rule sees it): a review stamp appears on the LEFT-OUT link.
    ['a left-out link gained a review stamp', mixed({ origin: 'third_party', source: 'Alice' }),
      (g: ReturnType<typeof initial>) => { (g.edges.find((e) => e.from === 'quality')!.provenance as Record<string, unknown>).reviewed_by_user = { intent: 'confirm', at: '2026-10-14T09:00:00.000Z' }; }],
  ] as const)('⭐ RED→GREEN: %s after the write → UNCONFIRMED, in the AIE\u2019s words: no receipt', async (_, args, tamper) => {
    const { caps } = harness(0.55, tamper);
    const ctx = contextOf(asked, {});
    const p = await caps.proposeLinkStrengths!(ctx, args);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange({ ...ctx, typed_approval_of: String(p.proposal_id) }, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_verified', follow_up: AIE.unconfirmed });
  });
  it('CONTROL: the same review, read back as written, is recorded as a review of Olumi\u2019s estimate', async () => {
    const { caps, read } = harness(0.55);
    const ctx = contextOf(asked, {});
    const before = read().edges.find((e) => e.from === 'quality')!;
    const p = await caps.proposeLinkStrengths!(ctx, review);
    const out = await caps.authoriseChange({ ...ctx, typed_approval_of: String(p.proposal_id) }, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const after = read().edges.find((e) => e.from === 'quality')!;
    expect(after.strength).toEqual(before.strength);
    expect([after.provenance.source, after.provenance.magnitude]).toEqual([before.provenance.source, before.provenance.magnitude]);
  });
  it('CONTROL: another writer\u2019s unconfirmed result keeps the generic words (no follow-up of its own)', () => {
    const status = narrateWriteOutcome('', [{ name: 'authorise_change' }], [{ ok: false, mutated: true, refusal: 'not_verified' }]).status;
    expect(status).not.toBe(AIE.unconfirmed);
    expect(status).toContain('could not be confirmed');
  });
  it('a third party\u2019s source is named whole, never cut; without a source the band is unknown', async () => {
    const long = 'the 2026 Smith & Partners pricing elasticity report, chapter 4, table 2 (survey of 312 SaaS firms, revised March 2026 edition)';
    expect(long.length).toBeGreaterThan(80);
    const { result } = await offer('Quality', { origin: 'third_party', source: long, basis: undefined });
    expect(result).toMatchObject({ ok: false, refusal: 'origin_unknown', left_out_third_party: [`${quality}, attributed to "${long}"`] });
    const blank = await offer('Quality', { origin: 'third_party', source: '  ', basis: undefined });
    expect(blank.result).toMatchObject({ ok: false, refusal: 'origin_unknown', left_out_unknown_origin: [quality] });
    expect(blank.result).not.toHaveProperty('left_out_third_party');
  });
  it('the host\u2019s `stored` declaration carries the STORED origin only for the band the link holds: a review of Olumi\u2019s estimate; any other band is unknown', async () => {
    // 0.55 sits in the stored band (strong); the stub's 'weak' does not.
    const { proposals, caps } = harness(0.55);
    const current = await caps.proposeLinkStrengths!(contextOf(history, {}), { links: [{ from_label: 'Quality', to_label: 'MRR',
      strength: 'strong', origin: 'stored' }], rationale: 'Run a pre-mortem' } as never);
    expect(current.ok, JSON.stringify(current)).toBe(true);
    expect(proposals.get(String(current.proposal_id))!.operations.map((o) => [(o.value as { intent: string }).intent, (o.value as { author: string }).author]))
      .toEqual([['confirm_current', 'model_proposed']]);
    const moved = await offer('Quality', { origin: 'stored', basis: undefined });
    expect(moved.result).toMatchObject({ ok: false, refusal: 'origin_unknown', left_out_unknown_origin: [quality] });
    expect(moved.writes).toHaveLength(0);
  });
});
