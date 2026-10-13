import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import type { SessionTurnWrite } from '../../session/store.js';
import type { AgentToolContext } from '../runtime/agent-tools.js';
import { linkBandTheUserStated } from '../../goal-target/input-claim-context.js';

beforeEach(() => __setUseAppendV6ForTest(false));
const scenario = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nodes = ['Price', 'MRR', 'Quality'].map(label => ({ id: label.toLowerCase(), kind: 'factor', label }));
const history = 'Price has a weak effect on MRR';
const initial = (mean = 0.55) => ({ nodes, edges: ['price', 'quality'].map(from => ({ from, to: 'mrr',
  strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } })) });

async function journey(from: string, overrides: Record<string, unknown> = {}, verified = history,
  interaction: Partial<AgentToolContext> = {}, mean = 0.55) {
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
        expectedGraphHash: input.base_graph_hash, targets: [], linkStrengths: input.link_strengths?.map(link => ({ ...link, adopted: link.author === 'model_proposed' })) }, store);
      expect(result.kind, JSON.stringify(result)).toBe('committed');
      if (result.kind !== 'committed') throw new Error(JSON.stringify(result));
      return { status: 'committed', graph_hash: result.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [] };
    },
  });
  const ctx = { scenario_id: scenario, authenticated_user_id: null, request_id: 't2a',
    user_text: verified, user_turn_text: 'Please prepare the link.', unverified_user_text: history, ...interaction };
  const proposal = await caps.proposeLinkStrengths!(ctx, { links: [{ from_label: from, to_label: 'MRR', strength: 'weak', ...overrides }], rationale: 'Prepare the requested link strength.' });
  expect(proposal.ok, JSON.stringify(proposal)).toBe(true);
  expect(writes).toHaveLength(0);
  const approval = await caps.authoriseChange({ ...ctx, typed_approval_of: String(proposal.proposal_id) }, { proposal_id: String(proposal.proposal_id) });
  expect(approval.ok, JSON.stringify(approval)).toBe(true);
  expect(approval.applied).toBe(true);
  expect(writes).toHaveLength(1);
  return { proposal, op: proposals.get(String(proposal.proposal_id))!.operations[0]!, edge: read().edges.find(e => e.from === from.toLowerCase())! };
}

describe('T2-A retained input_claim on the exact link through proposal, approval, canonical writer and JSON readback', () => {
  it.each([{}, { user_stated: false, basis: 'Model estimate' }])('(a) earlier verified words win over model flags: %j', async overrides => {
    const result = await journey('Price', overrides);
    expect((result.op.value as { author: string }).author).toBe('user_stated');
    expect(result.edge.provenance.source).toBe('user_specified');
    expect(result.edge.strength.mean).toBe(0.1);
  });
  it.each([{}, { user_stated: false, basis: 'Model estimate' }, { from_words: history }])('(b) a different existing link stays Olumi’s: %j', async overrides => {
    const result = await journey('Quality', overrides);
    expect((result.op.value as { author: string }).author).toBe('model_proposed');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
    expect(result.edge.provenance.magnitude).toBe('olumi_estimate');
    expect(result.proposal.public_label).toBe('Record this link strength: "Quality" → "MRR" as slight, Olumi’s estimate');
  });
  it('unverified history cannot supply human evidence', async () => {
    const result = await journey('Price', {}, 'Please suggest a strength.');
    expect(result.edge.provenance.source).toBe('cee_hypothesis');
  });
  it.each([
    'MRR has a weak effect on Price', 'Price has a weak effect. MRR is important.',
    'Price is weakly affected by MRR', 'Price gets a weak contribution from MRR',
    'Price has a weak effect on Quality; Quality affects MRR.', 'Does Price have a weak effect on MRR?',
    'Price does not have a weak effect on MRR', 'Price has a strong effect on MRR; Quality has a weak effect on MRR',
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
  it.each(['Price', 'Quality'])('review A with earlier history B credits only A: %s', async from => {
    const result = await journey(from, { strength: 'strong', user_stated: false, basis: 'Model estimate' },
      'Quality has a weak effect on MRR. Price is strong.',
      { ...priceReview, user_turn_text: 'Price is strong.' }, 0.3);
    expect((result.op.value as { author: string }).author).toBe(from === 'Price' ? 'user_stated' : 'model_proposed');
    expect(result.edge.provenance.source).toBe(from === 'Price' ? 'user_specified' : 'cee_hypothesis');
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
  it.each([
    { press_id: 'agent-drawn-link:price>mrr', from: 'price', to: 'mrr', author: 'user_stated' },
    { press_id: 'agent-drawn-link:quality>mrr', from: 'quality', to: 'mrr', author: 'model_proposed' },
    { press_id: 'agent-drawn-link:quality>mrr', from: 'price', to: 'mrr', author: 'model_proposed' },
  ])('only a validated current drawn pair grounds the band: %j', async ({ author, ...drawn_link }) => {
    const result = await journey('Price', { strength: 'strong' }, 'Price is strong.',
      { user_turn_text: 'Price is strong.', drawn_link }, 0.3);
    expect((result.op.value as { author: string }).author).toBe(author);
    expect(result.edge.provenance.source).toBe(author === 'user_stated' ? 'user_specified' : 'cee_hypothesis');
  });
});
