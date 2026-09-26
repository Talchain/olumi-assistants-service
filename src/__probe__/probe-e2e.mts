import { createAgentCapabilities } from '/private/tmp/cee-rt-rt-linkband/src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts';
import { ProposalStore } from '/private/tmp/cee-rt-rt-linkband/src/orchestrator-v5/agent-lane/proposal.ts';
const SCENARIO = '550e8400-e29b-41d4-a716-446655440099';
async function tryOne(text: string, band: string) {
  let edges: any[] = [];
  const sent: any[] = [];
  const d = async (path: string, body: any) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [
      { id: 'dec', kind: 'decision', label: 'Price decision' },
      { id: 'price', kind: 'factor', label: 'Pro plan price' },
      { id: 'churn', kind: 'factor', label: 'Monthly churn' },
    ], edges }, graph_hash: `h${edges.length}` } };
    sent.push(body);
    const ev = body.event ?? {};
    if (ev.kind === 'structural_add_edge') {
      edges = [...edges, { from: ev.from, to: ev.to, strength: { mean: ev.magnitude, std: 0.1 }, effect_direction: ev.effect_direction, provenance: { source: 'user_specified' } }];
      return { status: 200, json: { assistant_text: 'Connected.', graph_hash: `h${edges.length}` } };
    }
    throw new Error('unexpected ' + path);
  };
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text };
  const caps = createAgentCapabilities(d as any, new ProposalStore());
  const p = await caps.proposeModelChange(ctx as any, { from_label: 'Pro plan price', to_label: 'Monthly churn', direction: 'positive', rationale: 'x', strength: band as any });
  if (p.ok !== true) { console.log(JSON.stringify({ text, band, proposed: false, refusal: p.refusal })); return; }
  const r = await caps.authoriseChange({ ...ctx, user_text: 'Yes.', user_turn_text: 'Yes.' } as any, { proposal_id: String(p.proposal_id) });
  console.log(JSON.stringify({ text, band, proposed: true, applied: r.applied, placeholder: r.placeholder_strength ?? null, wire_magnitude: sent[0]?.event?.magnitude, stored: edges[0]?.provenance }));
}
await tryOne('Connect price to churn, you decide how strong.', 'strong');
await tryOne('Connect price to churn. Moderate or strong, you pick.', 'moderate');
await tryOne('Our retention is strong. Connect price to churn.', 'strong');
await tryOne('Connect price to churn.', 'strong');
