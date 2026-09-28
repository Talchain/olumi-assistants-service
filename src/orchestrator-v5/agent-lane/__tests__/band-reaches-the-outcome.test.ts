/**
 * ⛔ PJ-C3: THE USER'S BAND MUST REACH THE OUTCOME THEY NAME (DL #72 5864154474; the re-land of the reverted #2183).
 *
 * Served (pj-x3 FINAL on `a94fcb9`, C3 PASS/FAIL/FAIL), asked "our customers' price sensitivity is very high…", the
 * Agent sized the link INTO a node. That was the node named for what they sized (price → "Price-sensitive customer
 * loss", `…052306Z`), or a node between cause and outcome (price → "Price-driven churn", `…053022Z`). The node's own
 * link on to churn stayed Olumi's 0.0075, so "very high" never reached churn.
 *
 * #2183 fixed the no-node shape with a worked example ("price sensitivity: Pro plan price → churn") that then steered
 * the named-node shape to the direct link on its first served run (reverted, #2191). So this rule:
 *   - comes AFTER the named-node rule (`NODE_SIZE_MEANS_LINK_FROM`),
 *   - names no domain at all,
 *   - and the refusal for a missing link says to propose it now (one change), not offer it.
 *
 * What the words do to the MODEL is measured live, not here. These rows pin the text's structure and the refusal.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, NODE_SIZE_MEANS_LINK_FROM, THE_BAND_MUST_REACH_THE_OUTCOME } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const linkTool = () => AGENT_TOOLS.find((t) => t.name === 'propose_link_strength')!;

describe('⛔ PJ-C3: a band is recorded on the link that reaches the outcome the user named', () => {
  it('RED: propose_link_strength carries the rule, AFTER the named-node rule (a named node is sized first)', () => {
    const d = String(linkTool().description);
    const named = d.indexOf(NODE_SIZE_MEANS_LINK_FROM);
    const reach = d.indexOf(THE_BAND_MUST_REACH_THE_OUTCOME);
    expect([named >= 0, reach >= 0]).toEqual([true, true]);
    expect(reach, 'the named-node rule comes first').toBeGreaterThan(named);
    expect(THE_BAND_MUST_REACH_THE_OUTCOME).toMatch(/INTO a node never does/);
    expect(THE_BAND_MUST_REACH_THE_OUTCOME).toMatch(/FROM it to that outcome/);
    expect(THE_BAND_MUST_REACH_THE_OUTCOME).toMatch(/propose_model_change/);
  });

  it('⛔ the rule names NO domain (the #2183 lesson: a worked example steered the named-node shape)', () => {
    expect(THE_BAND_MUST_REACH_THE_OUTCOME).not.toMatch(/price|churn|sensitiv|MRR|subscri|revenue|Pro plan|→/i);
  });

  it('RED: a band for a link the model lacks → refused, and told to PROPOSE it now with the same band (one change), not to offer it', async () => {
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'Decision' },
        { id: 'cause', kind: 'factor', label: 'Cause' },
        { id: 'mid', kind: 'risk', label: 'Middle risk' },
        { id: 'out', kind: 'factor', label: 'Outcome' },
      ],
      edges: [
        { from: 'cause', to: 'mid', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'mid', to: 'out', strength: { mean: 0.0075, std: 0.002 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    };
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h1' } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    const proposals = new ProposalStore();
    const text = 'The cause moves the outcome very strongly.';
    const r = await createAgentCapabilities(d, proposals).proposeLinkStrength!(
      { scenario_id: 's', authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text },
      { from_label: 'Cause', to_label: 'Outcome', strength: 'very strong', rationale: text },
    );
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'no_such_link' }));
    expect(String(r.detail)).toMatch(/propose it now with propose_model_change, with the same strength and from_words/);
    expect(String(r.detail)).not.toMatch(/^.*offer to add it with propose_model_change\.$/);
    expect(proposals.outstanding('s', null)).toEqual([]);
  });
});
