import { runAgentTurn, type AgentTurnInput, type AgentTurnResult, type CallModel } from './runtime/agent-loop.js';
import { toolsFor, dispatchTool, type AgentCapabilities } from './runtime/agent-tools.js';

const PREFIX = 'agent-drawn-link:';
const DECLINE = 'agent-decline-drawn-link:';
export const isDrawnLinkPress = (id: unknown): id is string => typeof id === 'string' && (id.startsWith(PREFIX) || id.startsWith(DECLINE));
export function parseDrawnLinkPress(id: unknown): { press_id: string; from: string; to: string } | null {
  if (typeof id !== 'string' || !id.startsWith(PREFIX)) return null;
  const match = /^([^>\s:]{1,200})>([^>\s:]{1,200})$/u.exec(id.slice(PREFIX.length));
  return match !== null && match[1] !== match[2] ? { press_id: id, from: match[1]!, to: match[2]! } : null;
}
const answer = (text: string): AgentTurnResult => ({ assistant_text: text, items: [], tool_calls: [], tool_results: [], mutated: false,
  hops: 0, stopped_reason: 'answered', timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } });

/** One host-bound pair, one forced proposal call, one held card. A press never falls through to an ordinary turn. */
export async function drawnLinkPress(id: string, input: AgentTurnInput, graph: unknown, caps: AgentCapabilities, model: CallModel): Promise<AgentTurnResult> {
  if (id.startsWith(DECLINE)) {
    const proposalId = id.slice(DECLINE.length);
    if (!/^prop_[0-9a-f]{32}$/u.test(proposalId)) return answer('That suggestion could not be found. Nothing changed.');
    const result = await dispatchTool('withdraw_proposal', JSON.stringify({ proposal_id: proposalId }), input.ctx, caps, input.mode ?? 'full');
    return { ...answer(result.ok ? 'The suggested link has been declined. Nothing changed.' : 'That suggestion could not be withdrawn. Nothing changed.'),
      tool_calls: [{ name: 'withdraw_proposal', ok: result.ok, mutated: false, proposal_id: proposalId }], tool_results: [result] };
  }
  const pair = parseDrawnLinkPress(id);
  const nodes = graph !== null && typeof graph === 'object' && Array.isArray((graph as { nodes?: unknown }).nodes)
    ? (graph as { nodes: { id?: unknown; label?: unknown }[] }).nodes : [];
  if (pair === null || [pair.from, pair.to].some(end => nodes.filter(n => n?.id === end && typeof n.label === 'string').length !== 1)) {
    return answer('Olumi could not find both cards for that link in the saved model. Reload and try again.');
  }
  const state = await caps.getCanonicalState(input.ctx);
  const run = await runAgentTurn({ ...input, ctx: { ...input.ctx, user_turn_text: '', user_text: '', drawn_link: pair },
    selectionNote: JSON.stringify({ drawn_link: pair, canonical_state: state }),
    withheldTools: toolsFor(input.mode ?? 'full').map(t => t.name).filter(name => name !== 'propose_model_change'),
    firstCallTool: 'propose_model_change', maxHops: 1,
    composeReply: (_tool, _args, result) => result.ok && typeof result.public_label === 'string' ? result.public_label : null,
  }, caps, async req => {
    const response = await model(req);
    const calls = response.output.filter(o => o.type === 'function_call');
    return calls.length === 1 && calls[0]!.name === 'propose_model_change' ? response
      : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Olumi could not prepare that link suggestion. Try again.' }] }] };
  });
  if (run.tool_results[0]?.ok === false) return { ...run, assistant_text: run.tool_results[0]?.refusal === 'already_present'
    ? 'That link is already in the model. Nothing changed.' : 'Olumi could not prepare that link suggestion. Nothing changed.' };
  return run;
}
