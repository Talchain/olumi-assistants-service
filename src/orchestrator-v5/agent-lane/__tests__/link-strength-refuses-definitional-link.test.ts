/**
 * ⛔ R3-9 ON THE AGENT'S DOOR (DL #72 5866746362; Canonical #2229, the ONE predicate; AIQ's amendments 5867435409).
 *
 * AIQ's served R3 result (5866734772): a user's edit to a DEFINITIONAL link (price → MRR, where MRR = price ×
 * subscribers is a declared identity) was stored, then silently ignored, because an evaluated identity never reads the
 * strengths of the edges into it. Canonical refuses it on the canvas and in `adjust_edge_strength`, and the Agent's
 * `propose_link_strength` prepared the same change for approval.
 *
 * The rule, from the same module (`definitionalLinkInUse` + `definitionalLinkRefusalText`):
 *   - refused while the identity is IN USE, i.e. no Run yet, or the last Run evaluated the carrier;
 *   - the words say whose reading it is: an inferred identity is "Olumi reads …", with the way out;
 *   - a carrier the last Run did not attest as evaluated (withdrawn, or no list) is prepared as an ordinary belief. On
 *     approval, the product's link writer decides from the run facts themselves. A lever the analysis DID use is never
 *     blocked here on a guess.
 *
 * The graph is served journey C's (651a7fd), where MRR declares Pro plan price × Pro paying subscribers, as Olumi's
 * reading (`stated_in_brief: false`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dispatchTool } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const C05 = (JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-c05-budget-651a7fd.json', import.meta.url), 'utf8')) as { graph: Record<string, unknown> }).graph;

type LastRun = { run: 'never_run' | 'complete_current'; evaluated?: string[] };
const NO_RUN: LastRun = { run: 'never_run' };
const EVALUATED: LastRun = { run: 'complete_current', evaluated: ['mrr'] };

async function propose(args: Record<string, unknown>, message: string, last: LastRun, graph = C05): Promise<{ r: Record<string, unknown>; puts: unknown[] }> {
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: {
      graph: JSON.parse(JSON.stringify(graph)), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' },
      analysis_state: { run_state: { kind: last.run } },
      ...(last.evaluated !== undefined ? { analysis_identity_evaluated_node_ids: last.evaluated } : {}),
    } }
    : { status: 500, json: {} });
  const store = new ProposalStore();
  const puts: unknown[] = [];
  const put = store.put.bind(store);
  store.put = (p) => { puts.push(p); return put(p); };
  const caps = createAgentCapabilities(d, store);
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c3', authenticated_user_id: null, request_id: 'r', user_text: message, user_turn_text: message };
  return { r: (await dispatchTool('propose_link_strength', JSON.stringify(args), ctx as never, caps)) as Record<string, unknown>, puts };
}
const STRONG = 'Make the link from Pro plan price to MRR very strong.';
const STRONG_ARGS = { from_label: 'Pro plan price', to_label: 'MRR', strength: 'very strong', rationale: STRONG };
const OLUMI_READS = 'Olumi reads MRR as Pro plan price × Pro paying subscribers, so this link\'s strength isn\'t used while that holds';

describe('⛔ R3-9: the Agent never prepares a change to a link an identity defines while it is in use', () => {
  for (const [name, last] of [['no Run yet', NO_RUN], ['the last Run evaluated MRR', EVALUATED]] as const) {
    it(`RED (${name}): "Pro plan price → MRR very strong" is refused in the predicate’s words, as Olumi’s reading, and nothing is prepared`, async () => {
      const { r, puts } = await propose(STRONG_ARGS, STRONG, last);
      expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'definitional_link' }));
      expect(String(r.detail)).toContain(OLUMI_READS);
      expect(String(r.detail)).toContain('or tell me if MRR isn\'t that, and I\'ll stop reading it that way.');
      expect(r).not.toHaveProperty('proposal_id');
      expect(puts, 'nothing is prepared').toEqual([]);
    });
  }

  it('RED (the other operand, and a reversal): refused the same way', async () => {
    const msg = 'More Pro paying subscribers actually push MRR down, so it is a strong negative link.';
    const { r } = await propose({ from_label: 'Pro paying subscribers', to_label: 'MRR', strength: 'strong', direction: 'negative',
      direction_from_words: 'actually push MRR down', rationale: msg }, msg, EVALUATED);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, refusal: 'definitional_link' }));
    expect(String(r.detail)).toContain(OLUMI_READS);
  });

  it('a stated identity is said as the brief’s definition', async () => {
    const stated = JSON.parse(JSON.stringify(C05)) as { nodes: Array<Record<string, unknown>> };
    (stated.nodes.find((n) => n.id === 'mrr')!.nonlinear_identity as Record<string, unknown>).stated_in_brief = true;
    const { r } = await propose(STRONG_ARGS, STRONG, EVALUATED, stated as never);
    expect(String(r.detail)).toContain('This link is defined by MRR = Pro plan price × Pro paying subscribers');
  });

  for (const [name, last] of [
    ['the last Run did not evaluate MRR (withdrawn)', { run: 'complete_current', evaluated: [] }],
    ['the last Run attests no list', { run: 'complete_current' }],
  ] as const) {
    it(`CONTROL (${name}): the link was a belief that Run used, so the change is prepared`, async () => {
      const { r, puts } = await propose(STRONG_ARGS, STRONG, last as LastRun);
      expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(puts).toHaveLength(1);
    });
  }

  it('CONTRAST: a link into MRR that the identity does not define (Cost overrun risk → MRR) is prepared, whatever the Run', async () => {
    const msg = 'The link from Cost overrun risk to MRR is very strong.';
    for (const last of [NO_RUN, EVALUATED]) {
      const { r, puts } = await propose({ from_label: 'Cost overrun risk', to_label: 'MRR', strength: 'very strong', rationale: msg }, msg, last);
      expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(puts).toHaveLength(1);
    }
  });
});
