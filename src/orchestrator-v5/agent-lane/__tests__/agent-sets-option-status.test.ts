/**
 * ⭐ THE AGENT TAKES AN OPTION OUT OF THE COMPARISON (or puts it back) THROUGH THE SAME WRITER AS THE UI (MG F1 T6; spec §7
 * "one op per semantic change"; F5 I1.3). R3's replay of Paul's "Carrying on as we are now is not really an option" on
 * `29a37d18`: "I can't exclude it with the available controls". `propose_option_status` prepares ONE card; the approval
 * sends exactly one `option_status_edit` carrying the status this card was read on (`expected_status`) and its base hash,
 * and "done" is what the model HOLDS (`optionStatusHolds`), never the status code.
 */
import { describe, it, expect } from 'vitest';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';
import { authorisationTurnId, createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import { PARTICIPATION_FOR_STATUS } from '../../system-events/option-status-edit.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440d06';
const SAID = 'Carrying on as we are now is not really an option.';
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });

type Node = { id: string; kind: string; label: string; [k: string]: unknown };
function world(extra: Partial<Record<string, Record<string, unknown>>> = {}) {
  let g = { nodes: [
    { id: 'goal', kind: 'goal', label: 'Quarterly revenue' },
    { id: 'opt_ai', kind: 'option', label: 'AI Reporting Module Sprint', ...extra.opt_ai },
    { id: 'opt_carry_on', kind: 'option', label: 'Continue Current Plan', is_baseline: true, ...extra.opt_carry_on },
  ] as Node[], edges: [] as Record<string, unknown>[] };
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'option_status_edit') {
      if (ev['base_graph_hash'] !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
      const status = ev['status'] as 'feasible' | 'infeasible' | 'removed';
      g = { ...g, nodes: g.nodes.map((n) => (n.id === ev['option_node_id']
        ? { ...n, option_status: status, analysis_participation: PARTICIPATION_FOR_STATUS[status] } : n)) };
      rev += 1;
      return { status: 200, json: { assistant_text: 'ok', graph_hash: `h${rev}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { d, sent, graph: () => g };
}

describe('the Agent takes an option out of the comparison through option_status_edit', () => {
  it('RED: "carrying on as now is not an option" → ONE card → approved later → ONE option_status_edit (expected_status read on the card) → read back → done', async () => {
    const w = world();
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf(SAID), { option_label: 'Continue Current Plan', status: 'infeasible', rationale: SAID });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(w.sent, 'a proposal writes nothing').toEqual([]);
    expect(p.public_label).toBe('Mark "Continue Current Plan" as not feasible and take it out of the comparison (it stays in your model)');
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [SAID]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toEqual({
      kind: 'system_event', turn_id: authorisationTurnId(String(p.proposal_id)), scenario_id: SCENARIO, stage: 'frame',
      event: { kind: 'option_status_edit', option_node_id: 'opt_carry_on', expected_status: 'feasible', status: 'infeasible', base_graph_hash: 'h1' },
    });
    expect(OrchestratorTurnPayloadSchema.safeParse(w.sent[0]).success, 'the event parses on the real wire').toBe(true);
    expect(w.graph().nodes.find((n) => n.id === 'opt_carry_on')).toMatchObject({ option_status: 'infeasible', analysis_participation: 'retained_excluded' });
    expect(w.graph().nodes.find((n) => n.id === 'opt_ai')!.option_status, 'the other option is untouched').toBeUndefined();
    expect(String(r.follow_up)).toBe('Marked "Continue Current Plan" as not feasible and took it out of the comparison. It stays in your model. Run the analysis again to compare the rest.');
  });

  it('RED: putting a removed option back sends expected_status: removed', async () => {
    const w = world({ opt_carry_on: { option_status: 'removed', analysis_participation: 'retained_excluded' } });
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf('Put it back.'), { option_label: 'Continue Current Plan', status: 'feasible', rationale: 'x' });
    expect(p.ok).toBe(true);
    await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.'), { proposal_id: String(p.proposal_id) });
    expect((w.sent[0] as { event: Record<string, unknown> }).event).toMatchObject({ expected_status: 'removed', status: 'feasible' });
  });

  it.each([
    ['an option the model does not have', { option_label: 'Hire a contractor', status: 'removed' }, 'option_not_found'],
    ['no effect (already in the comparison)', { option_label: 'Continue Current Plan', status: 'feasible' }, 'no_effect'],
    ['an unreadable status', { option_label: 'Continue Current Plan', status: 'paused' }, 'unreadable_option_status'],
  ])('REFUSED, nothing prepared: %s', async (_n, args, refusal) => {
    const w = world();
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeOptionStatus!(ctxOf(SAID), { ...args, rationale: 'x' } as never);
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal }));
    expect(w.sent).toEqual([]);
  });

  it('REFUSED: Olumi\'s un-added suggestion is never put into the comparison by this door', async () => {
    const w = world({ opt_ai: { proposed_by: 'olumi', option_status: 'removed', analysis_participation: 'retained_excluded' } });
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeOptionStatus!(ctxOf('Add it back.'), { option_label: 'AI Reporting Module Sprint', status: 'feasible', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'olumi_suggestion_not_adopted' }));
  });

  it('the tool is declared, a mutation tool, and routed', async () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toContain('propose_option_status');
    expect(MUTATION_TOOLS).toContain('propose_option_status');
    const w = world();
    const r = await dispatchTool('propose_option_status', JSON.stringify({ option_label: 'Continue Current Plan', status: 'removed', rationale: 'x' }),
      ctxOf(SAID) as never, createAgentCapabilities(w.d, new ProposalStore()));
    expect(r).toEqual(expect.objectContaining({ ok: true }));
  });
});
