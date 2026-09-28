/**
 * ⛔ R3-9 ON THE AGENT'S DOOR (DL #72 5866746362; Canonical #2229, the ONE predicate `definitionalLinkOf`).
 *
 * AIQ's served R3 result (5866734772): a user's edit to a DEFINITIONAL link (price → MRR, where MRR = price ×
 * subscribers is a declared identity) was stored, then silently ignored, because an evaluated identity never reads the
 * strengths of the edges into it. Canonical refuses it on the canvas and in `adjust_edge_strength`. The Agent's
 * `propose_link_strength` prepared the same change for approval.
 *
 * The rule: `propose_link_strength` asks the same predicate once the link is found. For a strength and a reversal
 * alike, a definitional link is refused in the predicate's own words (`definitionalLinkRefusalText`), and nothing is
 * prepared. Every other link is unchanged. The graph is served journey C's (651a7fd), where MRR declares
 * Pro plan price × Pro paying subscribers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dispatchTool } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const C05 = (JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-c05-budget-651a7fd.json', import.meta.url), 'utf8')) as { graph: Record<string, unknown> }).graph;

async function propose(args: Record<string, unknown>, message: string): Promise<{ r: Record<string, unknown>; puts: unknown[] }> {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(C05)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' } } }
    : { status: 500, json: {} });
  const store = new ProposalStore();
  const puts: unknown[] = [];
  const put = store.put.bind(store);
  store.put = (p) => { puts.push(p); return put(p); };
  const caps = createAgentCapabilities(d, store);
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c3', authenticated_user_id: null, request_id: 'r', user_text: message, user_turn_text: message };
  return { r: (await dispatchTool('propose_link_strength', JSON.stringify(args), ctx as never, caps)) as Record<string, unknown>, puts };
}
const DEFINED = 'This link is defined by MRR = Pro plan price × Pro paying subscribers';

describe('⛔ R3-9: the Agent never prepares a change to a link an identity defines', () => {
  it('RED (strength): "Pro plan price → MRR very strong" is refused in the predicate’s words, and nothing is prepared', async () => {
    const msg = 'Make the link from Pro plan price to MRR very strong.';
    const { r, puts } = await propose({ from_label: 'Pro plan price', to_label: 'MRR', strength: 'very strong', rationale: msg }, msg);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'definitional_link' }));
    expect(String(r.detail)).toContain(DEFINED);
    expect(String(r.detail)).toContain('Change Pro plan price or Pro paying subscribers instead.');
    expect(r).not.toHaveProperty('proposal_id');
    expect(puts, 'nothing is prepared').toEqual([]);
  });

  it('RED (the other operand, and a reversal): refused the same way', async () => {
    const msg = 'More Pro paying subscribers actually push MRR down, so it is a strong negative link.';
    const { r } = await propose({ from_label: 'Pro paying subscribers', to_label: 'MRR', strength: 'strong', direction: 'negative',
      direction_from_words: 'actually push MRR down', rationale: msg }, msg);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'definitional_link' }));
    expect(String(r.detail)).toContain(DEFINED);
  });

  it('CONTRAST: a link into MRR that the identity does not define (Cost overrun risk → MRR) is prepared as before', async () => {
    const msg = 'The link from Cost overrun risk to MRR is very strong.';
    const { r, puts } = await propose({ from_label: 'Cost overrun risk', to_label: 'MRR', strength: 'very strong', rationale: msg }, msg);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(typeof r.proposal_id).toBe('string');
    expect(puts).toHaveLength(1);
  });
});
