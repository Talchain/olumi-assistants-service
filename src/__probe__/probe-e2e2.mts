import { createAgentCapabilities } from '../orchestrator-v5/agent-lane/runtime/agent-capabilities.ts';
import { ProposalStore } from '../orchestrator-v5/agent-lane/proposal.ts';
const SCENARIO = '550e8400-e29b-41d4-a716-446655440099';
// --- revision (propose_link_strength) on an existing Olumi-assumed 0.5 link
async function revise(text: string, band: string) {
  let g: any = { nodes: [ { id: 'dec', kind: 'decision', label: 'Price decision' }, { id: 'price', kind: 'factor', label: 'Pro plan price' }, { id: 'mrr', kind: 'goal', label: 'MRR' } ],
    edges: [{ from: 'price', to: 'mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' }, defaulted: true }] };
  const sent: any[] = [];
  const d = async (path: string, body: any) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: 'h1' } };
    sent.push(body); const ev = body.event ?? {};
    if (ev.kind === 'edge_strength_edit') { g = { ...g, edges: g.edges.map((x: any) => ({ ...x, strength: { ...x.strength, mean: ev.magnitude }, provenance: { source: 'user_specified' } })) }; return { status: 200, json: { assistant_text: 'Updated.', graph_hash: 'h2' } }; }
    throw new Error('unexpected ' + path);
  };
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text };
  const caps = createAgentCapabilities(d as any, new ProposalStore());
  const p = await caps.proposeLinkStrength!(ctx as any, { from_label: 'Pro plan price', to_label: 'MRR', strength: band as any, rationale: 'x' });
  console.log(JSON.stringify({ tool: 'propose_link_strength', text, band, ok: p.ok, refusal: p.refusal ?? null }));
}
// --- new link (propose_model_change)
async function add(text: string, band: string) {
  let edges: any[] = []; const sent: any[] = [];
  const d = async (path: string, body: any) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [ { id: 'dec', kind: 'decision', label: 'Price decision' }, { id: 'price', kind: 'factor', label: 'Pro plan price' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' } ], edges }, graph_hash: `h${edges.length}` } };
    sent.push(body); const ev = body.event ?? {};
    if (ev.kind === 'structural_add_edge') { edges = [...edges, { from: ev.from, to: ev.to, strength: { mean: ev.magnitude, std: 0.1 }, effect_direction: ev.effect_direction, provenance: { source: 'user_specified' } }]; return { status: 200, json: { assistant_text: 'Connected.', graph_hash: `h${edges.length}` } }; }
    throw new Error('unexpected ' + path);
  };
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text };
  const caps = createAgentCapabilities(d as any, new ProposalStore());
  const p = await caps.proposeModelChange(ctx as any, { from_label: 'Pro plan price', to_label: 'Monthly churn', direction: 'positive', rationale: 'x', strength: band as any });
  if (p.ok !== true) { console.log(JSON.stringify({ tool: 'propose_model_change', text, band, proposed: false, refusal: p.refusal })); return; }
  const r = await caps.authoriseChange({ ...ctx, user_text: 'Yes.', user_turn_text: 'Yes.' } as any, { proposal_id: String(p.proposal_id) });
  console.log(JSON.stringify({ tool: 'propose_model_change', text, band, proposed: true, applied: r.applied, placeholder: r.placeholder_strength ?? null, wire_magnitude: sent[0]?.event?.magnitude, stored: edges[0]?.provenance }));
}
await revise('Change the price to MRR link from moderate to strong.', 'strong');
await revise('Bump it from moderate to very strong.', 'very strong');
await revise('Lower it from strong to weak.', 'weak');
await revise('Make it strong. You decide the direction.', 'strong');
await revise('Please record that link as strong, as my own estimate.', 'strong'); // control: grounds
await add('Connect price to churn. Maybe strong, maybe weak.', 'strong');
await add('Connect price to churn. Strong vs moderate, not sure.', 'strong');
await add('Connect price to churn. Strong, moderate, whichever.', 'strong');
await add('Connect price to churn. Strong, moderate, weak - you are the judge.', 'strong');
await add('Connect price to churn. Olumi picks the band: strong, moderate, whatever.', 'strong');
await add('Connect price to churn. Strong or moderate, you pick.', 'strong'); // control: refused
