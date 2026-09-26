/**
 * ⭐ THE USER TELLS THE AGENT THEIR SUCCESS TARGET, AND ONE APPROVAL WRITES IT THROUGH THE PRODUCT'S TYPED WRITER.
 *
 * Before this, the Agent could not set a goal's target at all: a user who said "we need at least £60k MRR" was
 * answered in words and the model kept no target. The product already has the typed writer — the `goal_target_edit`
 * system event (schemas 0.59.0), handled by `dispatchGoalTargetEdit` → `applyGoalTargetEdit` → the SAME
 * `add_constraint` handler the Canvas control uses. `propose_goal_target` prepares ONE change the user approves once,
 * and the approval sends exactly that event.
 *
 * Nothing is recorded as the user's unless the user said it:
 * - the FIGURE must be written in the user's own words (`figureTheUserWrote`, the lane's one matcher);
 * - the DIRECTION (at least / at most) must be said in THIS turn's typed words, affirmed — absent, contradictory,
 *   negated or only asked about, the Agent is refused and must ask.
 *
 * The write is confirmed from STATE, never from the status code: the stored `goal_constraints` row (and, for at least,
 * the goal's own `goal_threshold_raw`) must hold what was approved, or the result says it could not be confirmed.
 *
 * Every event the Agent sends is parsed by the REAL boundary schema (`SystemEventTurnPayloadSchema`). The writer below
 * is a model of the product's contract only; `agent-sets-the-goal-target-real-writer.test.ts` drives the REAL product.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';
import { authorisationTurnId, createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool, toolsFor } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { comparatorTheUserWrote, userWordsOf } from '../stated-by-user.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { ADD_CONSTRAINT_USER_GUIDANCE, SUCCESS_TARGET_POSITIVE_USER_GUIDANCE } from '../../tools/handlers/d1-shared/user-guidance.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440061';
const SAID = 'We need at least £60k MRR by the end of the year.';
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });
const ctx = ctxOf(SAID);
/** The approval arrives on a LATER turn: the user's earlier words are kept, this turn's words are only "Yes." */
const laterTurn = ctxOf('Yes.', [SAID]);

type Node = { id: string; kind: string; label: string; [k: string]: unknown };
type Graph = { nodes: Node[]; edges: Record<string, unknown>[]; goal_constraints?: Record<string, unknown>[] };
const graphWith = (goals: Node[] = [{ id: 'mrr', kind: 'goal', label: 'MRR' }], extra: Partial<Graph> = {}): Graph => ({
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Pricing decision' },
    { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, unit: '£', cap: 200 } },
    ...goals,
  ],
  edges: goals.map((g) => ({ from: 'price', to: g.id, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
  ...extra,
});

/**
 * A recording dispatch over one stored graph. The target writer is modelled only as far as the product's contract
 * states it (`goal-target-edit.ts`, `add-constraint.ts`): a stale base is a 409 and writes nothing; an at-least target
 * of 0 is refused 422 with nothing written; otherwise the `>=`/`<=` row for the goal is upserted and, for at least,
 * the goal's own raw target is stamped. The REAL writer is driven in the sibling `-real-writer` file.
 */
function world(initial: Graph) {
  let g = JSON.parse(JSON.stringify(initial)) as Graph;
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] === 'goal_target_edit') {
      if (ev['base_graph_hash'] !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED', details: { reason: 'graph_write_conflict' } } };
      if (ev['constraint_type'] === 'at_least' && !(Number(ev['raw_value']) > 0)) {
        return { status: 422, json: { error: 'INGRESS_CONTRACT_VIOLATION', details: { reason: 'system_event_refused_no_write', event_kind: 'goal_target_edit' } } };
      }
      const operator = ev['constraint_type'] === 'at_least' ? '>=' : '<=';
      const row = { constraint_id: 'gc-1', node_id: ev['goal_node_id'], operator, value: ev['raw_value'], unit: ev['unit'], provenance: 'explicit', value_frame: 'level' };
      g = {
        ...g,
        goal_constraints: [...(g.goal_constraints ?? []).filter((c) => !(c['node_id'] === ev['goal_node_id'] && c['operator'] === operator)), row],
        nodes: g.nodes.map((n) => (n.id === ev['goal_node_id'] && operator === '>='
          ? { ...n, goal_threshold_raw: ev['raw_value'], goal_threshold_unit: ev['unit'], success_threshold: ev['raw_value'], threshold_source: 'user' } : n)),
      };
      rev += 1;
      return { status: 200, json: { assistant_text: 'Success target set.', graph_hash: `h${rev}` } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { d, sent, graph: () => g, move: () => { rev += 1; g = { ...g, nodes: g.nodes.map((n) => (n.id === 'price' ? { ...n, observed_state: { value: 0.3, raw_value: 60, unit: '£', cap: 200 } } : n)) }; } };
}

const parsesOnTheWire = (body: Record<string, unknown>) => {
  const r = SystemEventTurnPayloadSchema.safeParse(body);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
};
/** A raw code the user must never read: snake_case identifiers or SHOUTING_CODES. */
const RAW_CODE = /\b[a-z]+(?:_[a-z]+)+\b|\b[A-Z]+(?:_[A-Z]+)+\b/;
const call = (r: Record<string, unknown>) => ({ name: 'authorise_change', ok: r['ok'] === true, mutated: r['mutated'] === true, proposal_id: String(r['proposal_id']) });

describe('the Agent sets the goal\'s success target the user stated, through the product\'s typed target writer', () => {
  it('RED: "at least £60k" → ONE proposal (nothing written) → ONE approve chip → approved on a LATER turn → ONE goal_target_edit carrying exactly the target and the proposal\'s base → read back → a plain receipt', async () => {
    const { approvalChipsFor } = await import('../approval-chips.js');
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'The user said so.' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(w.sent, 'a proposal writes nothing').toEqual([]);
    expect(p.public_label).toBe('Set the goal "MRR" to at least £60,000');
    const chips = approvalChipsFor([{ name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(p.proposal_id) }]);
    expect(chips.map((c) => c.id), 'ONE approve button, plus amend').toEqual([`agent-approve-proposal:${String(p.proposal_id)}`, 'agent-amend-proposal']);

    // A LATER turn: a fresh capability set (capabilities are per request) over the same proposals.
    const r = await createAgentCapabilities(w.d, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent, 'exactly one typed write').toHaveLength(1);
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]).toEqual({
      kind: 'system_event', turn_id: authorisationTurnId(String(p.proposal_id)), scenario_id: SCENARIO, stage: 'frame',
      event: { kind: 'goal_target_edit', goal_node_id: 'mrr', constraint_type: 'at_least', raw_value: 60000, unit: '£', base_graph_hash: 'h1' },
    });
    expect(p.base_revision, 'the event carries the base the proposal was made on').toBe('h1');
    const row = w.graph().goal_constraints!.find((c) => c['node_id'] === 'mrr');
    expect(row).toEqual(expect.objectContaining({ operator: '>=', value: 60000 }));
    // The receipt the user reads: the server's status line, then the capability's own sentence. Plain words, no code.
    const said = [narrateWriteOutcome('', [call(r)], [r], { versioned: false }).status, String(r.follow_up ?? '')].join(' ');
    expect(said).toBe('Saved. The goal "MRR" now has the target at least £60,000, as you stated it.');
    expect(said).not.toMatch(RAW_CODE);
    // A retry of the same approval writes nothing twice.
    const again = await createAgentCapabilities(w.d, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(again).toEqual(expect.objectContaining({ ok: true, already_applied: true }));
    expect(w.sent).toHaveLength(1);
  });

  it('RED: "keep churn under 5%" → at most, read back from the goal\'s <= row', async () => {
    const turn = 'Keep monthly churn under 5%, please.';
    const w = world(graphWith([{ id: 'churn', kind: 'goal', label: 'Monthly churn', goal_threshold_unit: '%' }]));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(turn), { constraint_type: 'at_most', value: 5, unit: '%', rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, public_label: 'Set the goal "Monthly churn" to at most 5%' }));
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [turn]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ goal_node_id: 'churn', constraint_type: 'at_most', raw_value: 5, unit: '%' }));
  });

  it('RED: a figure the user did not write → refused, NOTHING prepared, nothing sent, and the Agent is told to ask for the figure', async () => {
    for (const [c, value] of [[ctx, 65000], [ctx, 60], [ctxOf('Yes.'), 60000]] as const) {
      const w = world(graphWith());
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(c, { constraint_type: 'at_least', value, unit: '£', rationale: 'x' });
      expect(p, `${value} after "${c.user_text}"`).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_not_stated' }));
      expect(String(p.detail)).toMatch(/ask .*figure/i);
      expect(p).not.toHaveProperty('proposal_id');
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
    // No words bound at all proves nothing.
    const { user_text: _a, user_turn_text: _b, ...bare } = ctx;
    const w = world(graphWith());
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(bare, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(p.refusal).toBe('target_not_stated');
  });

  it('RED: the direction must be the user\'s own, said THIS turn — absent, contradictory, negated, asked, or different from the Agent\'s → refused, nothing prepared', async () => {
    const cases: [string, 'at_least' | 'at_most', string?][] = [
      ['MRR should be £60k by December.', 'at_least'],
      ['We need at least £60k MRR, and keep it under £60k of spend.', 'at_least'],
      ['It is not at least £60k we need.', 'at_least'],
      ['Is at least £60k realistic?', 'at_least'],
      ['We need at most £60k MRR.', 'at_least'],
      ['Yes.', 'at_least', SAID],
    ];
    for (const [turn, type, earlier] of cases) {
      const w = world(graphWith());
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(turn, earlier !== undefined ? [earlier] : []), { constraint_type: type, value: 60000, unit: '£', rationale: 'x' });
      expect(p, turn).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'direction_not_stated' }));
      expect(String(p.detail)).toMatch(/at least or at most/);
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
  });

  it('the goal must resolve to exactly one: none, or two → refused, nothing prepared, and the Agent asks', async () => {
    for (const goals of [[], [{ id: 'mrr', kind: 'goal', label: 'MRR' }, { id: 'arr', kind: 'goal', label: 'ARR' }]]) {
      const w = world(graphWith(goals));
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
      expect(p, JSON.stringify(goals)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'goal_not_resolved' }));
      expect(store.outstanding(SCENARIO, null)).toEqual([]);
      expect(w.sent).toEqual([]);
    }
    const two = await createAgentCapabilities(world(graphWith([{ id: 'mrr', kind: 'goal', label: 'MRR' }, { id: 'arr', kind: 'goal', label: 'ARR' }])).d, new ProposalStore())
      .proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(String(two.detail)).toMatch(/"MRR".*"ARR"|"ARR".*"MRR"/);
    expect(String(two.detail)).toMatch(/[Aa]sk/);
  });

  it('a figure in another kind of unit from the goal\'s own (a percentage for a £ goal) → refused in plain words, nothing prepared', async () => {
    const turn = 'We need at least 60% more MRR.';
    const w = world(graphWith([{ id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 50000, goal_threshold_unit: '£' }]));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(turn), { constraint_type: 'at_least', value: 60, unit: '%', rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_unit_mismatch' }));
    expect(String(p.detail)).toMatch(/"MRR" is measured in £/);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.sent).toEqual([]);
  });

  it('an at-least target of 0 → refused with the target writer\'s own sentence, nothing prepared', async () => {
    const turn = 'We need at least 0 customers.';
    const w = world(graphWith([{ id: 'cust', kind: 'goal', label: 'Customers' }]));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(turn), { constraint_type: 'at_least', value: 0, unit: 'customers', rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_not_positive' }));
    expect(String(p.detail)).toContain(SUCCESS_TARGET_POSITIVE_USER_GUIDANCE);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('RED: the model moved after the offer → superseded, NOTHING sent', async () => {
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    w.move();
    const r = await createAgentCapabilities(w.d, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(w.sent).toEqual([]);
  });

  it('RED: the model moved between the approval\'s read and the write → the writer\'s stale-base refusal is "superseded", nothing written', async () => {
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    const racing: InternalDispatch = async (path, body) => {
      if (!path.endsWith('/graph')) w.move();
      return w.d(path, body);
    };
    const r = await createAgentCapabilities(racing, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(w.graph().goal_constraints ?? []).toEqual([]);
  });

  it('RED: the writer answers 200 but the stored target is not what was approved → "could not be confirmed" (mutated), never "Not saved"', async () => {
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    const silent: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return w.d(path, body);
      w.sent.push(body as Record<string, unknown>);
      return { status: 200, json: { assistant_text: 'Success target set.', graph_hash: 'h1' } };
    };
    const r = await createAgentCapabilities(silent, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, refusal: 'not_confirmed' }));
    expect(r.applied).not.toBe(true);
    expect(String(r.detail)).toMatch(/could not be confirmed/);
    const status = String(narrateWriteOutcome('', [call(r)], [r]).status);
    expect(status).toMatch(/could not be confirmed/);
    expect(status).not.toMatch(/Not saved|Partly saved|refused/);
    expect(status).not.toMatch(RAW_CODE);
  });

  it('RED: the write answers 200 but the model cannot be read back → "could not be confirmed" (mutated)', async () => {
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    let wrote = false;
    const blind: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph') && wrote) return { status: 503, json: {} };
      if (!path.endsWith('/graph')) wrote = true;
      return w.d(path, body);
    };
    const r = await createAgentCapabilities(blind, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, refusal: 'not_confirmed' }));
    expect(String(r.detail)).toMatch(/could not be confirmed/);
  });

  it('RED: the product refuses the write (422, no reason on the wire) → not saved, and its own sentence is relayed in plain words — never a code', async () => {
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    const refusing: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return w.d(path, body);
      w.sent.push(body as Record<string, unknown>);
      return { status: 422, json: { error: 'INGRESS_CONTRACT_VIOLATION', details: { reason: 'system_event_refused_no_write', event_kind: 'goal_target_edit' }, retryable: false } };
    };
    const r = await createAgentCapabilities(refusing, store).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_applied' }));
    expect(String(r.detail)).toContain(ADD_CONSTRAINT_USER_GUIDANCE);
    expect(String(r.follow_up)).toContain(ADD_CONSTRAINT_USER_GUIDANCE);
    for (const text of [String(r.detail), String(r.follow_up), String(narrateWriteOutcome('', [call(r)], [r]).status)]) {
      expect(text, text).not.toMatch(RAW_CODE);
    }
    expect(w.graph().goal_constraints ?? []).toEqual([]);
  });

  it('RED: approvable like every other proposal — one button, the awaiting flag, and a persisted carrier that restores and applies the same event', async () => {
    const { approvalChipsFor, proposalsAwaitingApproval } = await import('../approval-chips.js');
    const { proposalPendingAction, rehydrateProposals } = await import('../durable-proposal.js');
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const { leavesProposalAwaitingApproval } = await import('../../../routes/agent-v1-turn.js');
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    const calls = [{ name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(p.proposal_id) }];
    const chips = approvalChipsFor(calls);
    expect(chips).toHaveLength(2);
    expect(proposalsAwaitingApproval(calls).size).toBe(1);
    expect(leavesProposalAwaitingApproval(calls)).toBe(true);
    // Stored the way Postgres gives it back: object keys shorter-first (the JSONB reorder that once broke every id).
    const jsonbOrder = (v: unknown): unknown => Array.isArray(v) ? v.map(jsonbOrder)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
        : v;
    const pa = parsePendingAction(jsonbOrder(JSON.parse(JSON.stringify(proposalPendingAction(store.get(String(p.proposal_id))!, chips[0]!, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() })))));
    expect(pa, 'the production read would drop it').not.toBeNull();
    const fresh = new ProposalStore();
    expect(rehydrateProposals([pa!], fresh, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    const r = await createAgentCapabilities(w.d, fresh).authoriseChange(laterTurn, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual({ kind: 'goal_target_edit', goal_node_id: 'mrr', constraint_type: 'at_least', raw_value: 60000, unit: '£', base_graph_hash: 'h1' });
  });
});

describe('the tool is declared, dispatched, withheld in preview, and named in the route\'s mutation instruction', () => {
  it('RED: propose_goal_target is a declared mutation tool with {constraint_type, value, unit, rationale}', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'propose_goal_target');
    expect(t, 'declared').toBeDefined();
    expect((t!.parameters as { required?: unknown }).required).toEqual(['constraint_type', 'value', 'unit', 'rationale']);
    expect(((t!.parameters as { properties: Record<string, { enum?: unknown }> }).properties.constraint_type!.enum)).toEqual(['at_least', 'at_most']);
    expect(MUTATION_TOOLS).toContain('propose_goal_target');
    expect(toolsFor('preview').map((x) => x.name)).not.toContain('propose_goal_target');
  });

  it('RED: dispatchTool routes propose_goal_target to the capability, and refuses it in preview', async () => {
    const w = world(graphWith());
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const args = JSON.stringify({ constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(await dispatchTool('propose_goal_target', args, ctx, caps)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(await dispatchTool('propose_goal_target', args, ctx, caps, 'preview')).toEqual(expect.objectContaining({ ok: false, refusal: 'read_only_preview' }));
  });

  it('RED: the route\'s mutation instruction names propose_goal_target', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const instruction = /const MUTATION_INSTRUCTION =[\s\S]*?;\n/.exec(route)?.[0] ?? '';
    expect(instruction).toContain('propose_goal_target');
  });
});

describe('comparatorTheUserWrote — the direction is the user\'s own words, affirmed, this turn', () => {
  it('reads each phrase, and "no less/more than" as a whole', () => {
    for (const t of ['We need at least £60k.', 'A minimum of £60k.', 'No less than £60k.', 'More than £60k.', 'Over £60k.', 'Above £60k MRR.']) {
      expect(comparatorTheUserWrote(t), t).toBe('at_least');
    }
    for (const t of ['At most 5%.', 'No more than 5%.', 'Under 5%.', 'Below 5%.', 'Less than 5%.', 'A maximum of 5%.', 'Cap it at 5%.']) {
      expect(comparatorTheUserWrote(t), t).toBe('at_most');
    }
  });

  it('absent, contradictory, negated or asked → null (the Agent asks)', () => {
    for (const t of [
      'MRR should be £60k.',
      'At least £60k MRR and under 5% churn.',
      'Not at least £60k.',
      'It must not fall below £40k.',
      // A denial anywhere in the turn makes the Agent ask, even beside an affirmed direction.
      'It is not under £50k; we need at least £60k.',
      'Is at least £60k realistic?',
      'Should it be more than £60k',
      '',
    ]) {
      expect(comparatorTheUserWrote(t), t).toBeNull();
    }
    expect(comparatorTheUserWrote(null)).toBeNull();
    expect(comparatorTheUserWrote(undefined)).toBeNull();
    // A request to act names it, even as a question; words are whole words ("capacity" is not "cap").
    expect(comparatorTheUserWrote('Can you set the target to at least £60k?')).toBe('at_least');
    expect(comparatorTheUserWrote('We have capacity for £60k.')).toBeNull();
  });
});
