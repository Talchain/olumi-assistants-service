import { describe, expect, it } from 'vitest';
import { composeReplyShape, sentenceMultiset, type GateReplyPart, type ReplyPartIdentity } from '../compose-reply.js';
import { enforceAgentLaneLeaderClaimsAtWire } from '../../withheld-leader-fail-closed.js';

const identity: ReplyPartIdentity = { cause: 'GOAL_FIGURES_PRODUCT_NOT_READ', subjects: ['price→mrr', 'subscribers→mrr'], slot: 'closing' };
const closing = 'No option can be put forward because the goal is a product of your figures.';
const part: GateReplyPart = { role: 'withheld_reason', text: closing, identity };
const headline = 'Keep the model assumptions visible.';
const paraphrase = 'The revenue calculation combines the two inputs, leaving the comparison unresolved.';
const face = (c: ReturnType<typeof composeReplyShape>): string => c.shape ? [c.shape.headline, ...c.shape.bullets].join('\n') : c.text;

describe('gate parts: placement uses typed identity, never already-said words', () => {
  it('a product-reason paraphrase carrying the same typed identity moves to detail', () => {
    const text = `${paraphrase} ${headline}`;
    const c = composeReplyShape({ text, gateParts: [part], narratorParts: [{ text: paraphrase, identity }] });
    expect(face(c)).toContain(closing);
    expect(face(c)).not.toContain(paraphrase);
    expect(c.shape?.detail).toContain(paraphrase);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(`${text}\n\n${closing}`));
  });

  it('a closing already present verbatim binds once without inserting a second copy', () => {
    const text = `${headline}\n\n${closing}`;
    const c = composeReplyShape({ text, gateParts: [part, { ...part }] });
    expect(c.text).toBe(text);
    expect(c.text.split(closing)).toHaveLength(2);
  });

  it('two existing copies carry one face part and retain the narrator copy in detail', () => {
    const text = `${closing} ${headline}\n\n${closing}`;
    const c = composeReplyShape({ text, gateParts: [part] });
    expect(face(c).split(closing)).toHaveLength(2);
    expect(c.shape?.detail).toContain(closing);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });

  it('CONTROL: shared words with a different identity remain on the face', () => {
    const unrelated = 'The product of your figures describes the goal.';
    const c = composeReplyShape({ text: `${unrelated} ${headline}`, gateParts: [part],
      narratorParts: [{ text: unrelated, identity: { ...identity, subjects: ['other→goal'] } }] });
    expect(face(c)).toContain(unrelated);
    expect(c.measure?.restatements_to_detail).toBe(0);
  });

  it('cause and ask slots of the same subject each remain owed once', () => {
    const ask: GateReplyPart = { role: 'ask', text: 'Which evidence tests this assumption?', identity: { ...identity, slot: 'ask' } };
    const c = composeReplyShape({ text: headline, gateParts: [part, ask, ask] });
    expect(face(c)).toContain(closing);
    expect(face(c)).toContain(ask.text);
    expect(c.text.split(ask.text)).toHaveLength(2);
  });

  it('recorded warning links bypass the gate word dedupers and emit one owed identity', () => {
    const graph = { nodes: [{ id: 'cost', label: 'Support cost' }, { id: 'loss', label: 'Lost revenue' }] };
    const response = { assistant_text: 'The first option is best. Keep assumptions visible.',
      analysis_state: { leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized', separation: 'unavailable' } },
      blocks: [{ type: 'analysis_result', enrichment: { inference_warnings: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', links: [{ from: 'cost', to: 'loss' }] }] } }] };
    const gated = enforceAgentLaneLeaderClaimsAtWire(response as never, { requestId: 'typed', exitPath: 'agent_lane_v1',
      mayNameLeadingOption: false, separationEstablished: false, leaderClaimWithheldReason: 'goal_path_unsized', graph, composeGateParts: true });
    expect(gated.response.assistant_text).not.toContain('best');
    expect(gated.gateParts).toHaveLength(1);
    expect(gated.gateParts![0]!.identity).toEqual({ cause: 'goal_path_unsized:unavailable:GOAL_FIGURES_PLACEHOLDER_PATH', subjects: ['cost→loss'], slot: 'closing' });
    const composed = composeReplyShape({ text: gated.response.assistant_text!, gateParts: gated.gateParts, graph });
    expect(face(composed)).toContain(gated.gateParts![0]!.text);
  });

  it('legacy warning with no recorded identity keeps the old gate output byte for byte', () => {
    const response = { assistant_text: 'The first option is best. Keep assumptions visible.',
      analysis_state: { leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized', separation: 'unavailable' } },
      blocks: [{ type: 'analysis_result', enrichment: { inference_warnings: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', message: 'A link is unsized.' }] } }] };
    const opts = { requestId: 'legacy', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, separationEstablished: false,
      leaderClaimWithheldReason: 'goal_path_unsized', graph: { nodes: [], edges: [] } };
    const old = enforceAgentLaneLeaderClaimsAtWire(response as never, opts);
    const current = enforceAgentLaneLeaderClaimsAtWire(response as never, { ...opts, composeGateParts: true });
    expect(current).toEqual(old);
    expect(current.gateParts).toBeUndefined();
  });
});
