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
import { ModelVersionMutationReceiptV1LocalSchema } from '../../model-management/mutation-receipt.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440d06';
const SAID = 'Carrying on as we are now is not really an option.';
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });

/** A receipt that passes the real strict schema, naming the turn that committed it (`source_turn_id`). */
const receiptFor = (turnId: string, sequence: number) => ModelVersionMutationReceiptV1LocalSchema.parse({
  schema: 'model_version_mutation_receipt.v1', scenario_id: SCENARIO,
  mutation_id: 'cb1dd25d-36c3-4beb-aadf-5a016b2bce25', version_id: 'c0813c01-1111-4111-8111-111111111111', sequence,
  graph: { nodes: [], edges: [] }, full_hash: 'a'.repeat(64), hash_algorithm: 'sha256', identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1', graph_schema_version: 'graph_v3', analysis_affecting_hash: 'b'.repeat(64),
  actor: { kind: 'unknown' }, creation: { kind: 'committed_mutation' }, source_turn_id: turnId,
  lineage: { kind: 'known', parent_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  undo_version_id: null, event_id: 'model_version_created_mutation_cb1dd25d-36c3-4beb-aadf-5a016b2bce25',
});

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
      // The writer's own CAS on the status it read (CODEX overflow #2467 P2: this fake once omitted it): a stale
      // `expected_status` is the typed 409 conflict, `option_expected_status_mismatch`, never a 200.
      const stored = (g.nodes.find((n) => n.id === ev['option_node_id'])?.option_status as string | undefined) ?? 'feasible';
      if (stored !== ev['expected_status']) {
        return { status: 409, json: { error: 'GRAPH_DIVERGED', details: { conflict_category: 'option_expected_status_mismatch' } } };
      }
      const status = ev['status'] as 'feasible' | 'infeasible' | 'removed';
      g = { ...g, nodes: g.nodes.map((n) => (n.id === ev['option_node_id']
        ? { ...n, option_status: status, analysis_participation: PARTICIPATION_FOR_STATUS[status] } : n)) };
      rev += 1;
      return { status: 200, json: { assistant_text: 'ok', graph_hash: `h${rev}`, model_version_receipt: receiptFor(String((body as { turn_id?: unknown }).turn_id), rev) } };
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

  it.each(['removed', 'infeasible', 'feasible'] as const)('REFUSED, nothing prepared: %s on Olumi\'s un-added suggestion (adding it is the adoption door)', async (status) => {
    const w = world({ opt_ai: { proposed_by: 'olumi' } });
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeOptionStatus!(ctxOf('Take the AI one out.'), { option_label: 'AI Reporting Module Sprint', status, rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'olumi_suggestion_not_adopted' }));
    expect(w.sent).toEqual([]);
  });

  it('RED (CODEX overflow P2): an ADOPTED Olumi option the user took out → "put it back" → ONE card → ONE event (removed → feasible) → included again', async () => {
    const w = world({ opt_ai: { proposed_by: 'olumi', option_status: 'removed', analysis_participation: 'retained_excluded' } });
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf('Put the AI one back.'), { option_label: 'AI Reporting Module Sprint', status: 'feasible', rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.'), { proposal_id: String(p.proposal_id) });
    expect(w.sent).toHaveLength(1);
    expect((w.sent[0] as { event: Record<string, unknown> }).event).toMatchObject({ option_node_id: 'opt_ai', expected_status: 'removed', status: 'feasible' });
    expect(w.graph().nodes.find((n) => n.id === 'opt_ai')).toMatchObject({ analysis_participation: 'included', proposed_by: 'olumi' });
  });

  // ⛔ CODEX overflow #2467 5935234950 P2 #1: a REFUSED event read as success. The card read infeasible; another client took
  // the option out first (infeasible → removed moves no analysis hash), so the writer refuses the stale expected_status.
  it('RED (CODEX P2): another client removed the option first → the stale status is a typed conflict → "superseded", nothing claimed', async () => {
    const w = world({ opt_carry_on: { option_status: 'infeasible', analysis_participation: 'retained_excluded' } });
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf('Remove it entirely.'), { option_label: 'Continue Current Plan', status: 'removed', rationale: 'x' });
    expect(p.ok).toBe(true);
    // The concurrent client: same analysis hash (both statuses are retained_excluded), different stored status.
    const node = w.graph().nodes.find((n) => n.id === 'opt_carry_on')!;
    node.option_status = 'removed';
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', ['Remove it entirely.']), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'superseded' }));
  });

  it('RED (CODEX P2): a 200 with NO receipt for this operation is never "applied", even when the model holds the status', async () => {
    const w = world({ opt_carry_on: { option_status: 'removed', analysis_participation: 'retained_excluded' } });
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf('Put it back.'), { option_label: 'Continue Current Plan', status: 'feasible', rationale: 'x' });
    // An honest refusal committed as 200 (no write, no receipt) while the option happens to be back in (another client).
    const refusedButHolds: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return w.d(path, body);
      const n = w.graph().nodes.find((x) => x.id === 'opt_carry_on')!;
      n.option_status = 'feasible'; n.analysis_participation = 'included';
      return { status: 200, json: { assistant_text: '"Continue Current Plan" is already in the comparison, so there was nothing to change.' } };
    };
    const r = await createAgentCapabilities(refusedButHolds, store).authoriseChange(ctxOf('Yes.', ['Put it back.']), { proposal_id: String(p.proposal_id) });
    // Unconfirmed, never "applied" — and never "nothing changed" either: a 200 without a receipt proves neither (P2-1 below).
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, applied: false, refusal: 'not_confirmed' }));
  });

  // ⛔ CODEX overflow #2467 delta P2-1 (DL: BLOCKS): with model versions OFF (`CEE_MODEL_VERSIONS_ENABLED=false`, supported on
  // staging) a commit SAVES the graph and returns no receipt. Missing evidence is "could not be confirmed", never "did not change".
  it('RED (CODEX delta P2-1): a SUCCESSFUL commit with no receipt (model versions off) → "could not be confirmed", never "did not change the option"', async () => {
    const w = world();
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf(SAID), { option_label: 'Continue Current Plan', status: 'infeasible', rationale: SAID });
    const versionsOff: InternalDispatch = async (path, body) => {
      const r = await w.d(path, body);
      if (path.endsWith('/graph')) return r;
      const { model_version_receipt: _dropped, ...json } = r.json as Record<string, unknown>;
      return { status: r.status, json };
    };
    const r = await createAgentCapabilities(versionsOff, store).authoriseChange(ctxOf('Yes.', [SAID]), { proposal_id: String(p.proposal_id) });
    expect(w.graph().nodes.find((n) => n.id === 'opt_carry_on'), 'precondition: the write DID land').toMatchObject({ option_status: 'infeasible' });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
    expect(String(r.detail)).not.toMatch(/did not change|not changed|nothing changed/i);
  });

  // ⛔ CODEX P2 #2: the success branch never marked the proposal applied, so it stayed on offer and a retry read "superseded".
  it('RED (CODEX P2): an applied approval is MARKED applied — not offered again, and a retry reads "already applied" with its receipt, sending nothing', async () => {
    const w = world();
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeOptionStatus!(ctxOf(SAID), { option_label: 'Continue Current Plan', status: 'infeasible', rationale: SAID });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [SAID]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true, receipts: [expect.objectContaining({ source_turn_id: authorisationTurnId(String(p.proposal_id)) })] }));
    const again = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [SAID]), { proposal_id: String(p.proposal_id) });
    expect(again, JSON.stringify(again)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(String(again.detail ?? again.note ?? '')).toMatch(/already applied/);
    expect(w.sent, 'the retry sends nothing').toHaveLength(1);
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
