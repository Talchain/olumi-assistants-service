/**
 * ⛔ PJ-C3, NO NODE FOR WHAT THE USER SIZED: THE CAUSE → OUTCOME LINK, NEVER A LINK INTO A NODE BETWEEN THEM
 * (DL GO #72 5861666870; Runtime 5861644148 / 5861684872).
 *
 * #2153 settled the node-present case: "price sensitivity is very high" sizes the link OUT of Price sensitivity. With
 * no node named for it, served journey A (DL runs `acceptance-f-runs/pj-*`, 9 runs, graph before vs after the
 * approval) wrote price → churn at 0.85 in 6/9, and in 3/9 sized price → an intermediate node the BRIEF had drafted
 * ("Price resistance", "Price-value mismatch", "Price-driven churn risk"). On `84440ff` (011147Z) that left
 * Price-driven churn risk → Monthly churn at Olumi's 0.0075, so the user's "very high" was multiplied by a
 * placeholder, and only a SECOND approval sized the link on. None of the 3 graphs had a direct price → churn link, so
 * the faithful move is to ADD it at the user's band: one `propose_model_change`, one approval.
 *
 * Which link a sentence names is the model's reading of open language, so the rule lives in the tool description
 * (no handler-side word list). These rows pin what CAN be pinned in-process:
 *   - the rule is in the description the model is sent, word for word, right after #2153's rule and its carve-out;
 *   - on the SERVED graph the premise holds (no node named for it, no direct link, the served choice ends at an
 *     intermediate node whose link on is Olumi's placeholder), with #2153's node-present fixture as the contrast;
 *   - the tool the model tries first points it to the add in the same turn, and that add is ONE link at 0.85, the
 *     user's, with no node created.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, A_FIGURE_IS_THE_FACTORS_VALUE, NODE_SIZE_MEANS_LINK_FROM } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Edge = { from: string; to: string; strength: { mean: number; std: number }; provenance?: { source?: string }; [k: string]: unknown };
type Fixture = {
  user_message: string;
  draft_graph: { nodes: { id: string; kind: string; label: string }[]; edges: Edge[] };
  served_choice: { from: string; to: string; strength: string };
  expected_choice: { from: string; to: string; strength: string };
};
const load = (name: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Fixture;
/** 84440ff, run 011147Z: the model as the "very high" ask began (A10), and the message (A11). */
const NO_NODE = load('pj-c3-011147Z-a11-no-sized-node.json');
/** #2153's node-present fixture (R&C, 214311Z A12): the CONTRAST. */
const NODE_PRESENT = load('pj-c3-214311Z-a12-link-choice.json');

// The DL's rule (#72 5861666870), in the words the model is sent — typed out so the row binds the text, not a constant.
const NO_NODE_RULE = 'If no factor or risk is named for what they sized, they mean how strongly its cause moves that outcome '
  + '(price sensitivity: Pro plan price → churn): record THAT link, proposing it with propose_model_change at their band '
  + 'if the model lacks it — never a link INTO a node between the two, whose own link on would stay Olumi’s placeholder.';

/** The journey harness's own test for "a node named for price sensitivity" (`paul-journey-v2.mjs` PS_RE). */
const PS_RE = /price.?sensitiv/i;
const description = (name: string): string => AGENT_TOOLS.find((t) => t.name === name)!.description;
const idOf = (fx: Fixture, label: string): string => fx.draft_graph.nodes.find((n) => n.label === label)!.id;

describe('PJ-C3: with no node named for what the user sized, the cause → outcome link — never a link into a node between them', () => {
  it('⭐ the propose_link_strength description carries the rule, word for word, right after #2153’s rule and its carve-out', () => {
    const d = description('propose_link_strength');
    expect(d).toContain(NO_NODE_RULE);
    expect(d).toContain(`${NODE_SIZE_MEANS_LINK_FROM} ${A_FIGURE_IS_THE_FACTORS_VALUE} ${NO_NODE_RULE}`);
  });

  it('on the SERVED graph (84440ff 011147Z) the premise holds; #2153’s node-present graph is the contrast', () => {
    const price = idOf(NO_NODE, 'Pro plan price');
    const churn = idOf(NO_NODE, 'Monthly churn');
    expect(NO_NODE.user_message.toLowerCase()).toContain('price sensitivity is very high');
    // Target: no node is named for what they sized …
    expect(NO_NODE.draft_graph.nodes.filter((n) => PS_RE.test(n.label))).toEqual([]);
    // … contrast: the same probe finds #2153's node, so it is not blind.
    expect(NODE_PRESENT.draft_graph.nodes.filter((n) => PS_RE.test(n.label)).map((n) => n.label)).toEqual(['Price sensitivity']);
    // No direct link to size: the right move is to ADD it.
    expect(NO_NODE.draft_graph.edges.some((e) => e.from === price && e.to === churn)).toBe(false);
    expect([NO_NODE.expected_choice.from, NO_NODE.expected_choice.to]).toEqual([price, churn]);
    // What the Agent picked on the served run: price → a node BETWEEN price and churn, whose link on stayed Olumi's.
    const between = NO_NODE.served_choice.to;
    expect(NO_NODE.served_choice.from).toBe(price);
    expect(NO_NODE.draft_graph.edges.some((e) => e.from === price && e.to === between)).toBe(true);
    const on = NO_NODE.draft_graph.edges.find((e) => e.from === between && e.to === churn)!;
    expect([on.strength.mean, on.provenance?.source]).toEqual([0.0075, 'cee_hypothesis']);
  });

  it('⭐ the served first try (price → churn with propose_link_strength) sends the model to the add, now, with the same band', async () => {
    const { caps, sent, ctx } = world();
    const p = await caps.proposeLinkStrength!(ctx, {
      from_label: 'Pro plan price', to_label: 'Monthly churn', strength: 'very strong', from_words: 'very high', rationale: NO_NODE.user_message,
    });
    expect(p).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'no_such_link' }));
    expect(String(p.detail)).toContain('If the user has just sized that link, propose it now with propose_model_change, with the same strength and from_words');
    expect(String(p.detail)).toContain('not a question first');
    expect(sent).toEqual([]);
  });

  it('⭐ that add, from the user’s served words ("very high" → very strong), is ONE link at 0.85, theirs, and creates no node', async () => {
    const { caps, sent, ctx, proposals } = world();
    const p = await caps.proposeModelChange!(ctx, {
      from_label: 'Pro plan price', to_label: 'Monthly churn', direction: 'positive', strength: 'very strong', from_words: 'very high',
      rationale: NO_NODE.user_message,
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const ops = proposals.get(String(p.proposal_id))!.operations;
    expect(ops.map((o) => [o.op, o.path])).toEqual([['add_edge', 'pro_plan_price::monthly_churn']]);
    expect(sent, 'a proposal writes nothing').toEqual([]);
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    expect(sent).toHaveLength(1);
    const parsed = OrchestratorTurnPayloadSchema.safeParse(sent[0]);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(sent[0]!['event']).toEqual(expect.objectContaining({
      kind: 'structural_add_edge', from: 'pro_plan_price', to: 'monthly_churn', magnitude: 0.85, effect_direction: 'positive',
    }));
  });
});

/** The served graph behind the Agent's reads; the link writer modelled only as far as its contract states it. */
function world() {
  const nodes = NO_NODE.draft_graph.nodes;
  let edges = JSON.parse(JSON.stringify(NO_NODE.draft_graph.edges)) as Edge[];
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'structural_add_edge') {
      const mag = Number(ev['magnitude']);
      const dir = ev['effect_direction'] as 'positive' | 'negative';
      // `signedMeanFor` + the edge-level origin stamp, exactly as `structural-add-edge.ts` writes them.
      edges = [...edges, { from: String(ev['from']), to: String(ev['to']), strength: { mean: dir === 'negative' ? -mag : mag, std: 0.1 }, effect_direction: dir, provenance: { source: 'user_specified' } }];
      rev += 1;
      return { status: 200, json: { assistant_text: 'Connected.', graph_hash: `h${rev}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c4', authenticated_user_id: null, request_id: 'r', user_text: NO_NODE.user_message, user_turn_text: NO_NODE.user_message };
  return { caps: createAgentCapabilities(d, proposals), sent, ctx, proposals };
}
