/**
 * ⛔ PJ-C3 — "PRICE SENSITIVITY IS VERY HIGH" IS THE LINK OUT OF PRICE SENSITIVITY (R&C root #70 5860219371).
 *
 * Served journey A, step A12 (DL runs `acceptance-f-runs/pj-*`): the user sized a NODE, and the Agent's one
 * `propose_link_strength` call picked the link INTO it (Pro plan price → Price sensitivity / a price node) in 4 of 5
 * runs. The one PASS picked the link OUT of it (Price sensitivity → monthly churn, which sat at Olumi's 0.0075
 * placeholder). The write path was fine: it wrote what was approved.
 *
 * The fix is R&C's rule, verbatim, in the tool's own description (DL route 5860238223). Which link a sentence names is
 * the model's reading of open language, so no handler-side word list decides it (a closed lexicon cannot bound open
 * language). The served measure is X3 PJ-C3 over ≥3 runs. These rows pin what CAN be pinned in-process:
 *   - the rule is in the description the model is sent, word for word;
 *   - on the SERVED graph (R&C's fixture from `214311Z`), the rule names exactly one link, the expected one, and the
 *     served wrong choice is a link into the node;
 *   - that link, proposed with the user's served words, is admitted and reaches the writer.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, A_FIGURE_IS_THE_FACTORS_VALUE, NODE_SIZE_MEANS_LINK_FROM, SLIGHT_IS_WEAK } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Edge = { from: string; to: string; strength: { mean: number; std: number }; [k: string]: unknown };
type Fixture = {
  user_message: string;
  draft_graph: { nodes: { id: string; kind: string; label: string }[]; edges: Edge[] };
  served_choice: { from: string; to: string; strength: string };
  expected_choice: { from: string; to: string; strength: string };
};
const FX = JSON.parse(
  readFileSync(new URL('./fixtures/pj-c3-214311Z-a12-link-choice.json', import.meta.url), 'utf8'),
) as Fixture;

// R&C's words (#70 5860219371), typed out here so the row binds the text, not the constant to itself.
const RC_RULE = "When the user says how big a factor or risk IS ('price sensitivity is very high'), they mean how strongly it moves "
  + 'what it affects: the link FROM it, to the outcome they name or imply. If it has several and they named none, ask which.';

const description = (name: string): string => AGENT_TOOLS.find((t) => t.name === name)!.description;
const labelOf = (id: string): string => FX.draft_graph.nodes.find((n) => n.id === id)!.label;

describe('PJ-C3: the size of a factor is the strength of the link out of it', () => {
  it('⭐ the propose_link_strength description the model is sent carries R&C’s rule, word for word', () => {
    expect(NODE_SIZE_MEANS_LINK_FROM).toBe(RC_RULE);
    const d = description('propose_link_strength');
    expect(d).toContain(RC_RULE);
    // Contrast: the probe reads the real description (its existing band rule is there too).
    expect(d).toContain(SLIGHT_IS_WEAK.trim());
  });

  it('⭐ the carve-out rides with it: a FIGURE for the factor itself is its value, not a link (DL CR on #2153, words verbatim)', () => {
    // Typed out, as the rule is, so the row binds the words.
    const DL_CARVE_OUT = "A figure for the factor itself (e.g. 'churn is 6%') is its value, not a link.";
    expect(A_FIGURE_IS_THE_FACTORS_VALUE).toBe(DL_CARVE_OUT);
    const d = description('propose_link_strength');
    // Directly after the rule it limits, so the model reads them as one instruction.
    expect(d).toContain(`${RC_RULE} ${DL_CARVE_OUT}`);
  });

  it('on the SERVED graph (214311Z A12) the rule names one link, the expected one; the served choice was a link INTO the node', () => {
    const sized = 'price_sensitivity';
    expect(labelOf(sized)).toBe('Price sensitivity');
    expect(FX.user_message.toLowerCase()).toContain('price sensitivity is very high');
    const out = FX.draft_graph.edges.filter((e) => e.from === sized);
    // One link out and none named → no "ask which": the rule resolves to it.
    expect(out.map((e) => `${e.from}->${e.to}`)).toEqual([`${FX.expected_choice.from}->${FX.expected_choice.to}`]);
    expect(out[0]!.strength.mean).toBe(0.0075);
    // What the Agent picked on the served run: a link that ENDS at the sized node.
    expect(FX.served_choice.to).toBe(sized);
    expect(FX.draft_graph.edges.some((e) => e.from === FX.served_choice.from && e.to === sized)).toBe(true);
  });

  it('that link, read from the user’s served words ("very high" → very strong), is admitted and reaches the writer as set 0.85', async () => {
    let edges = JSON.parse(JSON.stringify(FX.draft_graph.edges)) as Edge[];
    let rev = 1;
    const sent: Record<string, unknown>[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: FX.draft_graph.nodes, edges }, graph_hash: `h${rev}` } };
      sent.push(body as Record<string, unknown>);
      const ev = (body as { event: Record<string, unknown> }).event;
      // The writer as its contract states it: the approved figure, now the user's.
      edges = edges.map((x) => (x.from === ev['from'] && x.to === ev['to']
        ? { ...x, strength: { ...x.strength, mean: Number(ev['magnitude']) }, provenance: { source: 'user_specified' }, defaulted: false }
        : x));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.', graph_hash: `h${rev}` } };
    };
    const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c3', authenticated_user_id: null, request_id: 'r', user_text: FX.user_message, user_turn_text: FX.user_message };
    const caps = createAgentCapabilities(d, new ProposalStore());
    const p = await caps.proposeLinkStrength!(ctx, {
      from_label: labelOf(FX.expected_choice.from),
      to_label: labelOf(FX.expected_choice.to),
      strength: 'very strong',
      from_words: 'very high',
      rationale: FX.user_message,
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(sent).toHaveLength(0);
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    expect(sent).toHaveLength(1);
    const ev = (sent[0]!['event'] as Record<string, unknown>);
    expect([ev['from'], ev['to'], ev['intent'], ev['magnitude']]).toEqual(['price_sensitivity', 'monthly_churn', 'set', 0.85]);
  });
});
