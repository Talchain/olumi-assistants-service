/** S-D slice 2. Real route-v2 + Agent route; copied slice-1 latest-row/JSONB/parser harness.
 * RED-on-base is checked by the lane owner. Every RED row binds the proposal, revision and displayed digest.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** Every append that carried a graph, per scenario: "ONE graph-bearing row". */
const graphWrites = new Map<string, number>();
/**
 * Codex r1 P1 on #2743: run ONCE inside the persistence floor's own pending read (the read just before an answer row is
 * appended), to stage another request's write landing between a turn's reconcile and its append.
 */
let atFloorRead: (() => Promise<void>) | undefined;
const calledFromFloor = (): boolean => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  return stack.includes('appendCheckedGraphWrite');
};
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
      : v;
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  scenarioExists: vi.fn(async () => true),
  getScenarioOwner: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => ({ userId: null, graph: graphOf.get(SCENARIO), briefText: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    if (atFloorRead !== undefined && calledFromFloor()) { const staged = atFloorRead; atFloorRead = undefined; await staged(); }
    return parsedPending(latestRow(sid), sid);
  }),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date().toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) {
        graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
        graphWrites.set(w.scenario_id, (graphWrites.get(w.scenario_id) ?? 0) + 1);
      }
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the writer doors (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

type Chip = { id: string; label: string; message: string; detail?: string };
type Call = { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string };
type Body = { _proposal_fields?: import('../proposal-object/record.js').ProposalFieldsWire; assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: Call[]; receipts: readonly import('../turn-receipts.js').TurnReceipt[] }; _provider_calls?: { provider: string }[] };
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

/** Canonical minimal graph. No incidental constraint or intervention repair can fail the writer's scope check. */
const seedGraph = (): G => ({ nodes: [
  { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
  { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
  { id: 'opt_a', kind: 'option', label: 'Keep £49' },
  { id: 'opt_b', kind: 'option', label: 'Raise to £59' },
], edges: [['dec_x', 'opt_a'], ['dec_x', 'opt_b'], ['opt_a', 'fac_hours'], ['opt_b', 'fac_hours']].map(([from, to]) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })) });

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

describe('S-D slice 2 Agent proposals', () => {
  let app: FastifyInstance;
  let proposalsForApp: import('../proposal.js').ProposalStore;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error(`non-OpenAI network call: ${String(url)}`);
      openAiCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next(body) : say('Done.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    proposalsForApp = (await import('../held-approval-offers.js')).agentProposals;
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const id = (req.params as { id: string }).id;
      const g = graphOf.get(id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    // App emission and DB row times share a clock. Only Date is fake; network/server timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
    nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; atFloorRead = undefined; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    // Separate user turns beyond the resolver's 2 s app/DB skew allowance.
    vi.setSystemTime(Date.now() + 10_000);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const bytes = () => JSON.stringify(graphOf.get(SCENARIO));
  const hashNow = async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    return computeAnalysisAffectingGraphHash(graphNow() as never) as string;
  };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const pending = async () => store.readMostRecentPendingActions(SCENARIO) as Promise<import('../../session/pending-action.js').PendingAction[]>;
  const seed = (bounded = false) => {
    const g = seedGraph();
    g.nodes.push({ id: 'fac_hours', kind: 'factor', label: 'Hours', ...(bounded ? { observed_state: { value: 0.25, raw_value: 10, unit: 'hours', cap: 40, declared_scale: 'unit_interval', source: 'cee_inference' } } : {}) },
      { id: 'fac_cost', kind: 'factor', label: 'Cost', ...(bounded ? { observed_state: { value: 0.2, raw_value: 200, unit: 'GBP', cap: 1000, declared_scale: 'unit_interval', source: 'cee_inference' } } : {}) });
    g.edges.push({ from: 'fac_hours', to: 'goal_x', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, defaulted: true, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_cost', to: 'goal_x', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, defaulted: true, strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' });
    graphOf.set(SCENARIO, projectGraphForPersistence(g));
  };
  const assumptions = (only = false) => {
    script = [() => fnCall('propose_assumptions', { assumptions: [
      { factor_label: 'Hours', value: 10, unit: 'hours', basis: 'A starting estimate', ...(graphNow().nodes.find(n => n.id === 'fac_hours')?.observed_state ? { keep: true } : {}) },
      ...(only ? [] : [{ factor_label: 'Cost', value: 200, unit: 'GBP', basis: 'A starting estimate', ...(graphNow().nodes.find(n => n.id === 'fac_cost')?.observed_state ? { keep: true } : {}) }]),
    ] }), () => say('Here are starting assumptions for the missing figures.')];
    return turn({ message: 'Suggest starting assumptions for the missing figures.' });
  };
  const links = () => {
    script = [() => fnCall('propose_link_strengths', { links: [
      { from_label: 'Hours', to_label: 'Revenue', strength: 'moderate' },
      { from_label: 'Cost', to_label: 'Revenue', strength: 'moderate' },
    ] }), () => say('Here are estimates for these links.')];
    return turn({ message: 'Suggest estimates for these two links.' });
  };
  const shown = (b: Body) => { expect(b._proposal_fields).toBeDefined(); return b._proposal_fields!.proposals.at(-1)!; };
  const press = (p: { approve_action: Chip }) => ({ source: 'chip', chip: { id: p.approve_action.id }, message: p.approve_action.message });
  const submit = (b: Body, fields: unknown[], extra: Record<string, unknown> = {}) => {
    const p = shown(b);
    return turn({ ...press(p), proposal_edits: { proposal_id: p.proposal_id, revision: p.revision, digest: p.digest,
      graph_hash: b._proposal_fields!.graph_hash, fields, ...extra } });
  };
  const stalePlainApprovalWords = 'Nothing changed. That card is out of date: the change it shows has been replaced. Use the newest card for it.';
  const os = (id: string) => graphNow().nodes.find(n => n.id === id)!.observed_state as Record<string, unknown>;

  it('CONTROL passes at base: plain A1 approval retains the existing figures and authorship in one commit', async () => {
    seed(); const b = await assumptions(); const chip = approveChipOf(b)!;
    const r = await turn({ source: 'chip', chip: { id: chip.id }, message: chip.message });
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(os('fac_hours')).toMatchObject({ raw_value: 10, source: 'user_assumption' });
    expect(os('fac_cost')).toMatchObject({ raw_value: 200, source: 'user_assumption' });
    expect(graphWrites.get(SCENARIO)).toBe(1);
  }, 120_000);
  it('A1 RED: two missing factors project their stored units, estimates and Not now card', async () => {
    seed(); const b = await assumptions(); const p = shown(b);
    expect(p.proposal_id).toMatch(/^prop_[0-9a-f]{32}$/);
    expect(p.fields).toEqual([
      expect.objectContaining({ field_id: 'factor_value:fac_cost', kind: 'factor_value', current: { value: 200, unit: 'GBP', source: 'estimate' }, filled_missing: true }),
      expect.objectContaining({ field_id: 'factor_value:fac_hours', kind: 'factor_value', current: { value: 10, unit: 'hours', source: 'estimate' }, filled_missing: true }),
    ]);
    expect(b.suggested_actions).toContainEqual(p.decline_action);
  }, 120_000);
  it('APPLIED A1 stays silently settled on the next ordinary turn and its approve card remains idempotent', async () => {
    seed(); const b = await assumptions(); const p = shown(b);
    const applied = await turn(press(p));
    expect(applied._agent.tool_calls).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    // Durable, not only in-process: the approve turn's own row no longer carries the applied proposal (a restart
    // between the approval and the next turn must not find it "held" and say it lapsed).
    const carriedAfter = (await pending()).filter((x) => (x.action as { inline_patch?: { agent_proposal?: { proposal_id?: string } } })
      .inline_patch?.agent_proposal?.proposal_id === p.proposal_id);
    expect(carriedAfter, 'the applied proposal is not carried').toEqual([]);
    const before = bytes(); const writes = graphWrites.get(SCENARIO);
    const next = await turn({ message: 'Explain the assumptions.' });
    expect(next.assistant_text).toBe('Done.');
    expect(next._proposal_fields).toBeUndefined();
    expect((await pending()).filter((x) => (x.action as { inline_patch?: { agent_proposal?: { proposal_id?: string } } })
      .inline_patch?.agent_proposal?.proposal_id === p.proposal_id), 'nor is it carried by the next ordinary turn').toEqual([]);
    expect(next.suggested_actions.map(c => c.id)).not.toContain(p.approve_action.id);
    expect(next.suggested_actions.map(c => c.id)).not.toContain(p.decline_action.id);
    expect(await pending()).not.toContainEqual(expect.objectContaining({ chip_id: p.approve_action.id }));
    const again = await turn(press(p));
    expect(again._agent.tool_calls).toEqual([expect.objectContaining({ ok: true, mutated: false, proposal_id: p.proposal_id })]);
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO)).toBe(writes);
  }, 120_000);
  it('A1 edits RED: one user value, untouched Olumi value, one commit and both receipt lines', async () => {
    seed(); const b = await assumptions();
    const r = await submit(b, [{ field_id: 'factor_value:fac_hours', value: 12 }]);
    expect(os('fac_hours')).toMatchObject({ raw_value: 12, source: 'user_override' });
    expect(os('fac_cost')).toMatchObject({ raw_value: 200, source: 'user_assumption' });
    expect(graphWrites.get(SCENARIO)).toBe(1);
    expect(r.assistant_text).toContain('You set "Hours" to 12 hours; Olumi\'s estimate was 10 hours.');
    expect(r.assistant_text).toContain('Left as Olumi\'s estimate: "Cost" (£200).');
  }, 120_000);
  it('A6 RED: projected Olumi bands, one edited user link and one untouched estimate with receipts', async () => {
    seed(); const b = await links(); const p = shown(b);
    expect(p.fields).toHaveLength(2);
    expect(p.fields.every(f => f.current.source === 'estimate')).toBe(true);
    const r = await submit(b, [{ field_id: 'link_strength:fac_hours::goal_x', band: 'very_strong' }]);
    const e = (id: string) => graphNow().edges.find(x => x.from === id && x.to === 'goal_x')!;
    expect(e('fac_hours').provenance).toMatchObject({ source: 'user_specified' });
    expect(e('fac_cost').provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } });
    expect(graphWrites.get(SCENARIO)).toBe(1);
    expect(r.assistant_text).toContain('You set how strongly "Hours" affects "Revenue": very strong; Olumi\'s estimate was moderate.');
    expect(r.assistant_text).toContain('Left as Olumi\'s estimate: "Cost" → "Revenue".');
  }, 120_000);
  it.each([
    ['unknown field', [{ field_id: 'factor_value:other', value: 12 }], {}],
    ['negative value', [{ field_id: 'factor_value:fac_hours', value: -1 }], {}],
    ['above cap', [{ field_id: 'factor_value:fac_hours', value: 41 }], {}],
    ['non finite', [{ field_id: 'factor_value:fac_hours', value: Infinity }], {}],
    ['another digest', [{ field_id: 'factor_value:fac_hours', value: 12 }], { digest: 'another' }],
    ['another revision', [{ field_id: 'factor_value:fac_hours', value: 12 }], { revision: 'another' }],
    ['another model', [{ field_id: 'factor_value:fac_hours', value: 12 }], { graph_hash: 'another' }],
    ['unknown band', [{ field_id: 'link_strength:fac_hours::goal_x', band: 'enormous' }], {}],
  ])('NEGATIVE + CONTROL RED: %s refuses without writing and the correct panel lands', async (_name, fields, extra) => {
    seed(_name === 'negative value' || _name === 'above cap'); const b = _name === 'unknown band' ? await links() : await assumptions(); const before = bytes();
    const r = await submit(b, fields as unknown[], extra as Record<string, unknown>);
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(r.assistant_text).toContain('Nothing in the model changed'); expect(r.assistant_text).not.toContain('\u2014');
    expect((await pending()).some(p => p.action.kind === 'apply_proposed_change')).toBe(true);
    const ok = await submit(r, _name === 'unknown band' ? [{ field_id: 'link_strength:fac_hours::goal_x', band: 'very_strong' }] : [{ field_id: 'factor_value:fac_hours', value: 12 }]);
    expect(ok._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: true, mutated: true }));
  }, 120_000);
  it('Not now RED: removes prop, says its public label, and the old approve cannot write', async () => {
    seed(); const b = await assumptions(); const p = shown(b); const before = bytes();
    const r = await turn({ source: 'chip', chip: { id: p.decline_action.id }, message: p.decline_action.message });
    expect(r.assistant_text).toContain('Set aside:'); expect(r.assistant_text).toContain('Nothing in the model changed.');
    expect(await pending()).not.toContainEqual(expect.objectContaining({ chip_id: p.approve_action.id }));
    await turn(press(p)); expect(bytes()).toBe(before);
  }, 120_000);
  it('D-08 RED: second Agent proposal keeps both carriers, approving one says the other lapse', async () => {
    seed(); const a = shown(await assumptions()); const b = await links(); const z = shown(b);
    expect(b._proposal_fields!.proposals.map(p => p.proposal_id)).toEqual([a.proposal_id, z.proposal_id]);
    const continuity = await turn({ message: 'Explain what is waiting.' });
    expect(approveChipOf(continuity)?.id).toBe(a.approve_action.id);
    const r = await turn(press(a));
    expect(r.assistant_text).toContain('has lapsed'); expect(r.assistant_text).toContain('model');
  }, 120_000);
  it('cap RED: offered fourth approval keeps its room and the overflow is said', async () => {
    seed(); await assumptions(true); await links();
    script = [() => fnCall('propose_option_status', { option_label: 'Keep £49', status: 'removed' }), () => say('Take this option out?')];
    await turn({ message: 'Take Keep £49 out of the comparison.' });
    script = [() => fnCall('propose_option_status', { option_label: 'Raise to £59', status: 'removed' }), () => say('Take this option out too?')];
    const b = await turn({ message: 'Take Raise to £59 out of the comparison too.' });
    expect(await pending()).toHaveLength(3);
    expect(b.assistant_text).toContain('only three changes can wait at once');
    expect(b._proposal_fields!.proposals.some(p => p.approve_action.id === approveChipOf(b)!.id)).toBe(true);
  }, 120_000);
  it.each(['agent', 'product'])('replay warm and cold RED %s: current fields and oldest card, including Not now, are re-derived', async dialect => {
    seed();
    if (dialect === 'agent') await assumptions();
    else { script = [() => fnCall('propose_new_risk', { label: 'Delay', affects: [{ target_label: 'Revenue', direction: 'negative' }], rationale: 'An explicit risk.' }), () => say('Shall I add the delay risk?')]; await turn({ message: 'Add a delay risk that reduces Revenue.' }); } const tid = randomUUID();
    const original = await turn({ turn_id: tid, message: 'Explain these assumptions.' });
    const check = (b: Body) => { expect(b._proposal_fields).toEqual(original._proposal_fields); const p = shown(b);
      expect(b.suggested_actions).toContainEqual(p.approve_action); expect(b.suggested_actions).toContainEqual(p.decline_action);
      expect(b.suggested_actions.some(c => c.id === 'agent-amend-proposal')).toBe(true); };
    check(await turn({ turn_id: tid, message: 'Explain these assumptions.' }));
    vi.resetModules(); const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const cold = Fastify({ logger: false });
    cold.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: graphNow(), graph_hash: await hashNow() }));
    await cold.register(agentV1TurnRoute); await cold.ready();
    try { const r = await cold.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: tid, message: 'Explain these assumptions.' } });
      expect(r.statusCode, r.body).toBe(200); check(r.json()); } finally { await cold.close(); }
  }, 120_000);
  it('reload RED: real graph read includes the Agent envelope on conversation opt-in', async () => {
    seed(); const b = await assumptions();
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const reload = Fastify({ logger: false }); await reload.register(scenarioGraphRoute); await reload.ready();
    try {
      const r = await reload.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().proposal_fields).toEqual(b._proposal_fields);
    } finally { await reload.close(); }
  }, 120_000);

  it('floor RED: concurrent decline is never resurrected for prop carriers', async () => {
    seed(); await assumptions();
    script = [() => { atFloorRead = async () => { await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'concurrent-decline', pending_actions: [] }); }; return say('These are assumptions.'); }];
    await turn({ message: 'Explain the assumptions.' });
    expect(atFloorRead).toBeUndefined(); expect(await pending()).toEqual([]);
  }, 120_000);
  it('floor RED: concurrent Agent arrival is never erased', async () => {
    seed(); const b = await assumptions(); const minted = await pending();
    await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'empty', pending_actions: [] });
    script = [() => { atFloorRead = async () => { await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'concurrent-arrival', pending_actions: minted }); }; return say('These are assumptions.'); }];
    await turn({ message: 'Explain the model.' }); expect(atFloorRead).toBeUndefined();
    expect(await pending()).toContainEqual(expect.objectContaining({ chip_id: shown(b).approve_action.id }));
    expect((await turn(press(shown(b))))._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: true, mutated: true }));
  }, 120_000);

  it.each(['revision', 'digest', 'graph_hash'])('P53 prop plain approval RED: stale %s refuses with card words, no graph bytes or writes', async (key) => {
    seed(); const b = await assumptions(); const before = bytes();
    const refused = await submit(b, [], { [key]: 'another' });
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(refused.assistant_text).toBe(stalePlainApprovalWords);
    expect(refused._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    const landed = await submit(refused, []);
    expect(landed._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: true, mutated: true }));
    expect(graphWrites.get(SCENARIO)).toBe(1);
    expect(os('fac_hours')).toMatchObject({ raw_value: 10, source: 'user_assumption' });
  }, 120_000);
  it('P53 prop plain approval RED: current empty binding commits with the byte-equal no-edits twin reply', async () => {
    seed(); const bound = await assumptions();
    const current = await submit(bound, []);
    expect(current._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphWrites.get(SCENARIO)).toBe(1);
    const acceptedHours = structuredClone(os('fac_hours'));
    const acceptedCost = structuredClone(os('fac_cost'));
    const acceptedGraph = structuredClone(graphNow());
    const acceptedFacts = structuredClone(latestRow()!.handler_facts);
    acceptedHours['reviewed_by_user'] = { ...(acceptedHours['reviewed_by_user'] as object), at: expect.any(String) };
    acceptedCost['reviewed_by_user'] = { ...(acceptedCost['reviewed_by_user'] as object), at: expect.any(String) };
    for (const node of acceptedGraph.nodes) {
      if (node.observed_state !== undefined) {
        const state = node.observed_state as Record<string, unknown>;
        state['reviewed_by_user'] = { ...(state['reviewed_by_user'] as object), at: expect.any(String) };
      }
    }
    nextScenario(); seed(); const twin = await assumptions();
    const plain = await turn(press(shown(twin)));
    expect(plain._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphWrites.get(SCENARIO)).toBe(1);
    expect(current.assistant_text).toBe(plain.assistant_text);
    expect(current.assistant_text).not.toMatch(/You set|Left as Olumi's estimate/);
    expect(os('fac_hours')).toEqual(acceptedHours); expect(os('fac_cost')).toEqual(acceptedCost);
    expect(graphNow()).toEqual(acceptedGraph);
    expect(plain._agent.receipts).toEqual(current._agent.receipts);
    expect(latestRow()!.handler_facts).toEqual(acceptedFacts);
  }, 120_000);
  it('P53 prop stale same-target card RED: its own empty binding cannot approve the newer held value', async () => {
    seed();
    script = [() => fnCall('propose_assumptions', { assumptions: [{ factor_label: 'Hours', value: 10, unit: 'hours', basis: 'First estimate' }] }), () => say('Use ten hours?')];
    const first = await turn({ message: 'Suggest ten hours as a starting estimate.' }); const old = shown(first);
    script = [() => fnCall('propose_assumptions', { assumptions: [{ factor_label: 'Hours', value: 20, unit: 'hours', basis: 'Second estimate' }] }), () => say('Use twenty hours?')];
    const second = await turn({ message: 'Suggest twenty hours instead.' }); const newer = shown(second);
    expect(newer.proposal_id).not.toBe(old.proposal_id);
    expect(second._proposal_fields!.proposals.map(p => p.proposal_id)).toEqual([newer.proposal_id]);
    const before = bytes(); const r = await submit(first, []);
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(r.assistant_text).toBe(stalePlainApprovalWords);
    expect(r._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', proposal_id: old.proposal_id, ok: false, mutated: false }));
    const landed = await submit(second, []);
    expect(landed._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', proposal_id: newer.proposal_id, ok: true, mutated: true }));
    expect(os('fac_hours')).toMatchObject({ raw_value: 20, source: 'user_assumption' });
    expect(graphWrites.get(SCENARIO)).toBe(1);
  }, 120_000);
  it('P53 prop issued rows RED: two distinct live holds preserve order and bind each revision to its first answer row', async () => {
    seed(); const firstTurn = randomUUID();
    script = [() => fnCall('propose_assumptions', { assumptions: [{ factor_label: 'Hours', value: 10, unit: 'hours', basis: 'First estimate' }] }), () => say('Use ten hours?')];
    const first = await turn({ turn_id: firstTurn, message: 'Suggest ten hours as a starting estimate.' }); const old = shown(first);
    const secondTurn = randomUUID();
    script = [() => fnCall('propose_assumptions', { assumptions: [{ factor_label: 'Cost', value: 200, unit: 'GBP', basis: 'Second estimate' }] }), () => say('Use two hundred pounds?')];
    const second = await turn({ turn_id: secondTurn, message: 'Suggest two hundred pounds as the cost estimate.' }); const newer = shown(second);
    expect(newer.proposal_id).not.toBe(old.proposal_id);
    expect(second._proposal_fields!.proposals.map(p => p.proposal_id)).toEqual([old.proposal_id, newer.proposal_id]);
    const expected = [{ proposal_id: old.proposal_id, issued_turn_id: firstTurn }, { proposal_id: newer.proposal_id, issued_turn_id: secondTurn }];
    expect(second._proposal_fields!.proposals).toEqual(expected.map(p => expect.objectContaining(p)));
    const continued = await turn({ message: 'Explain both estimates.' });
    expect(continued._proposal_fields!.proposals).toEqual(expected.map(p => expect.objectContaining(p)));
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const reload = Fastify({ logger: false }); await reload.register(scenarioGraphRoute); await reload.ready();
    const fullRowRead = store.readRecent.getMockImplementation()!;
    try {
      const r = await reload.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().proposal_fields.proposals).toEqual(expected.map(p => expect.objectContaining(p)));
      // Production readRecent omits pending_actions. Preserve that shape here, so the exact committed-row
      // fallback is also witnessed instead of only passing on this harness's convenient full rows.
      store.readRecent.mockImplementation(async sid => [...order].reverse().map(k => rows.get(k)!)
        .filter(row => row.scenario_id === sid && !row.turn_id.endsWith(':claim'))
        .map(row => { const summary = { ...row }; Reflect.deleteProperty(summary, 'pending_actions'); return summary; }));
      const committedReads = store.readCommittedTurn.mock.calls.length;
      const fallback = await reload.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(fallback.statusCode, fallback.body).toBe(200);
      expect(fallback.json().proposal_fields.proposals).toEqual(expected.map(p => expect.objectContaining(p)));
      const newReads = store.readCommittedTurn.mock.calls.slice(committedReads);
      expect(newReads.length, 'at most one candidate and one predecessor read per hold').toBeLessThanOrEqual(4);
      expect(newReads).toEqual([[SCENARIO, firstTurn], [SCENARIO, secondTurn], [SCENARIO, firstTurn]]);
    } finally { store.readRecent.mockImplementation(fullRowRead); await reload.close(); }
  }, 120_000);
  it('P53 prop unmatched issuing row RED: graph read labels a legacy hold with issued_turn_id null', async () => {
    seed(); const offered = await assumptions(); const p = shown(offered);
    // A legacy carrier has no user-visible issuing message. Its live pending record remains present;
    // neither a claim row nor a textless carrier is a conversation row that can own a rendered card.
    const carrier = latestRow()!;
    carrier.user_message = null; carrier.assistant_message = null;
    const claim = rows.get(`${SCENARIO}:${carrier.turn_id}:claim`)!;
    claim.pending_actions = structuredClone(carrier.pending_actions);
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const reload = Fastify({ logger: false }); await reload.register(scenarioGraphRoute); await reload.ready();
    const before = bytes();
    try {
      const read = await reload.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().proposal_fields.proposals).toEqual([
        expect.objectContaining({ proposal_id: p.proposal_id, revision: p.revision, digest: p.digest, issued_turn_id: null }),
      ]);
      expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    } finally { await reload.close(); }
  }, 120_000);
  it('P53 prop full-window RED: issuer outside a full loaded window cannot bind to the oldest carry-forward row within +1 s', async () => {
    seed(); const offered = await assumptions(); const card = shown(offered);
    const issuer = latestRow()!;
    for (let index = 0; index < 200; index += 1) {
      const turnId = randomUUID();
      const key = `${SCENARIO}:${turnId}`;
      rows.set(key, { ...issuer, id: `near-carried-${index}`, turn_id: turnId,
        created_at: new Date(Date.parse(issuer.created_at) + 1000 + index * 10).toISOString(),
        user_message: `Continue the shared reasoning ${index}.`, assistant_message: 'That estimate is still waiting.',
        pending_actions: structuredClone(issuer.pending_actions) });
      order.push(key);
    }
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const reload = Fastify({ logger: false }); await reload.register(scenarioGraphRoute); await reload.ready();
    const originalRecent = store.readRecent.getMockImplementation()!;
    store.readRecent.mockImplementation(async (sid: string, limit?: number) => [...order].reverse().map(key => rows.get(key)!)
      .filter(row => row.scenario_id === sid && !row.turn_id.endsWith(':claim')).slice(0, limit)
      .map(({ pending_actions: _pending, ...row }) => row as Row));
    const readsBefore = store.readCommittedTurn.mock.calls.length;
    const recentReadsBefore = store.readRecent.mock.calls.length;
    const before = bytes();
    try {
      const read = await reload.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(read.statusCode, read.body).toBe(200);
      expect(store.readRecent.mock.calls.slice(recentReadsBefore)).toContainEqual([SCENARIO, 200]);
      expect(read.json().conversation_turns).toHaveLength(50);
      expect(read.json().conversation_turns.map((row: { turn_id: string }) => row.turn_id)).not.toContain(issuer.turn_id);
      expect(read.json().proposal_fields.proposals).toEqual([
        expect.objectContaining({ proposal_id: card.proposal_id, revision: card.revision, digest: card.digest, issued_turn_id: null }),
      ]);
      expect(store.readCommittedTurn.mock.calls.slice(readsBefore).length).toBeLessThanOrEqual(2);
      expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    } finally { store.readRecent.mockImplementation(originalRecent); await reload.close(); }
  }, 120_000);
  it('P53 prop complete-history CONTROL: first conversation issuer remains bound on live reply, replay and reload', async () => {
    seed(); const offered = await assumptions(); const card = shown(offered);
    const issuer = latestRow()!;
    expect(card.issued_turn_id).toBe(issuer.turn_id);
    const replay = await turn({ turn_id: issuer.turn_id, message: issuer.user_message });
    expect(shown(replay)).toMatchObject({ revision: card.revision, digest: card.digest, issued_turn_id: issuer.turn_id });
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const reload = Fastify({ logger: false }); await reload.register(scenarioGraphRoute); await reload.ready();
    const originalRecent = store.readRecent.getMockImplementation()!;
    store.readRecent.mockImplementation(async (sid: string, limit?: number) => [...order].reverse().map(key => rows.get(key)!)
      .filter(row => row.scenario_id === sid && !row.turn_id.endsWith(':claim')).slice(0, limit)
      .map(({ pending_actions: _pending, ...row }) => row as Row));
    const readsBefore = store.readCommittedTurn.mock.calls.length;
    try {
      const read = await reload.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().conversation_turns.map((row: { turn_id: string }) => row.turn_id)).toEqual([issuer.turn_id]);
      expect(read.json().proposal_fields.proposals).toEqual([
        expect.objectContaining({ proposal_id: card.proposal_id, revision: card.revision, digest: card.digest, issued_turn_id: issuer.turn_id }),
      ]);
      // One existing approval-offer authority read and one issuing-row verification; no predecessor exists.
      expect(store.readCommittedTurn.mock.calls.slice(readsBefore)).toEqual([[SCENARIO, issuer.turn_id], [SCENARIO, issuer.turn_id]]);
    } finally { store.readRecent.mockImplementation(originalRecent); await reload.close(); }
  }, 120_000);
  it('P53 prop digest CONTROL: the same held record has the same digest under different issuing rows', async () => {
    seed(); const offered = await assumptions(); const p = shown(offered);
    const { proposalRecord, proposalFieldsWire } = await import('../proposal-object/record.js');
    const held = (await pending()).find(pa => pa.id === p.revision)!;
    const record = proposalRecord(held, graphNow())!;
    const firstTurn = randomUUID(); const secondTurn = randomUUID();
    const first = proposalFieldsWire([record], offered._proposal_fields!.graph_hash, new Map([[record.revision, firstTurn]]))!;
    const second = proposalFieldsWire([record], offered._proposal_fields!.graph_hash, new Map([[record.revision, secondTurn]]))!;
    expect(first.proposals[0]!.issued_turn_id).toBe(firstTurn);
    expect(second.proposals[0]!.issued_turn_id).toBe(secondTurn);
    expect(first.proposals[0]!.digest).toBe(p.digest);
    expect(second.proposals[0]!.digest).toBe(p.digest);
    expect(record.digest).toBe(p.digest);
    expect({ ...first.proposals[0], issued_turn_id: null }).toEqual({ ...second.proposals[0], issued_turn_id: null });
  }, 120_000);
  it('P53 prop reload replay RED: latest reply retains the first issuing row and graph-read binding still commits', async () => {
    seed(); const offered = await assumptions(); const issued = latestRow()!.turn_id;
    const latest = randomUUID(); const message = 'Explain the estimate before I approve it.';
    const original = await turn({ turn_id: latest, message });
    expect(shown(original)).toMatchObject({ proposal_id: shown(offered).proposal_id, issued_turn_id: issued });
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const cold = Fastify({ logger: false });
    await cold.register(scenarioGraphRoute); await cold.register(agentV1TurnRoute); await cold.ready();
    try {
      const replay = await cold.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: latest, message } });
      expect(replay.statusCode, replay.body).toBe(200);
      expect((replay.json() as Body)._proposal_fields).toEqual(original._proposal_fields);
      const read = await cold.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
      expect(read.statusCode, read.body).toBe(200);
      const wire = read.json().proposal_fields as NonNullable<Body['_proposal_fields']>;
      expect(wire).toEqual(original._proposal_fields);
      const p = wire.proposals.find(x => x.proposal_id === shown(offered).proposal_id)!;
      const approval = await cold.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...press(p),
        proposal_edits: { proposal_id: p.proposal_id, revision: p.revision, digest: p.digest, graph_hash: wire.graph_hash, fields: [] } } });
      expect(approval.statusCode, approval.body).toBe(200);
      const accepted = approval.json() as Body;
      expect(accepted._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
      expect(graphWrites.get(SCENARIO)).toBe(1);
      expect(os('fac_hours')).toMatchObject({ raw_value: 10, source: 'user_assumption' });
      expect(accepted.assistant_text).not.toMatch(/You set|Left as Olumi's estimate/);
    } finally { await cold.close(); }
  }, 120_000);
  it('floor cap RED: a concurrent arrival and this new approval keep room; the displaced hold is re-projected, and said at the start of the next reply', async () => {
    seed(); const first = await assumptions(); const second = await links(); const two = await pending();
    const incoming = await assumptions(true); const incomingRow = await pending();
    await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'restore-two', pending_actions: two });
    script = [() => fnCall('propose_assumptions', { assumptions: [{ factor_label: 'Hours', value: 12, unit: 'hours', basis: 'A different estimate' }] }),
      () => { atFloorRead = async () => { await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'concurrent-offer', pending_actions: incomingRow }); }; return say('Here is a different estimate.'); }];
    const own = await turn({ message: 'Suggest a different estimate of hours.' });
    const held = await pending(); expect(held).toHaveLength(3);
    const ownId = `agent-approve-proposal:${own._agent.tool_calls.find(c => c.name === 'propose_assumptions')!.proposal_id}`;
    expect(held.map(p => p.chip_id)).toContain(shown(incoming).approve_action.id);
    expect(held.map(p => p.chip_id)).toContain(ownId);
    expect(approveChipOf(own)!.id).toBe(ownId);
    const { offeredApproveChipOnRow } = await import('../durable-proposal.js');
    expect(offeredApproveChipOnRow(held, { scenario_id: SCENARIO, user_id: null })?.id).toBe(ownId);
    expect(held.map(p => p.chip_id)).toContain(shown(first).approve_action.id);
    expect(held.map(p => p.chip_id)).not.toContain(shown(second).approve_action.id);
    // The composer is the ONE last writer of a reply (#2748): this reply is not changed after it was composed ...
    expect(own.assistant_text).not.toContain('only three changes can wait at once');
    expect(latestRow(SCENARIO)!.assistant_message).toBe(own.assistant_text);
    expect(own._proposal_fields!.proposals.map(p => p.approve_action.id)).toEqual(held.map(p => p.chip_id));
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    // ... so the set-aside proposal is said at the start of the NEXT reply, once, never in silence (D-08).
    script = [() => say('Three changes are waiting for you.')];
    const next = await turn({ message: 'What is still waiting?' });
    expect(next.assistant_text, next.assistant_text).toContain('only three changes can wait at once');
    script = [() => say('Noted.')];
    const after = await turn({ message: 'Thanks.' });
    expect(after.assistant_text, 'said once').not.toContain('only three changes can wait at once');
  }, 120_000);

  it('cold replay RED: a newer approval retains its own offered card beside both held envelopes', async () => {
    seed(); await assumptions(); const tid = randomUUID();
    script = [() => fnCall('propose_link_strengths', { links: [{ from_label: 'Hours', to_label: 'Revenue', strength: 'moderate' }] }), () => say('Shall I record this link estimate?')];
    const original = await turn({ turn_id: tid, message: 'Suggest an estimate for this link.' });
    const offered = approveChipOf(original)!;
    vi.resetModules(); const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const cold = Fastify({ logger: false });
    cold.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: graphNow(), graph_hash: await hashNow() }));
    await cold.register(agentV1TurnRoute); await cold.ready();
    try {
      const r = await cold.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: tid, message: 'Suggest an estimate for this link.' } });
      expect(r.statusCode, r.body).toBe(200); const b = r.json() as Body;
      expect(b._proposal_fields).toEqual(original._proposal_fields); expect(approveChipOf(b)).toEqual(offered);
      expect(b.suggested_actions).toContainEqual(original._proposal_fields!.proposals.find(p => p.approve_action.id === offered.id)!.decline_action);
    } finally { await cold.close(); }
  }, 120_000);

  // ⭐ "CHECK ESTIMATES" (DL 7 Oct, ACTION-BAR): the host-built call opens the SAME panel on factors' CURRENT figures.
  const checkEstimates = async (ids: string[]) => {
    const { checkEstimatesCall } = await import('../proposal-object/check-estimates.js');
    const call = checkEstimatesCall(graphNow(), ids);
    expect(call, 'the builder opens a card for these ids').toBeDefined();
    script = [() => fnCall(call!.name, call!.args as unknown as Record<string, unknown>), () => say('Here are Olumi\'s current estimates to check.')];
    return turn({ message: 'Check estimates.' });
  };
  it('CHECK ESTIMATES builder: at most 3 ids, every id a factor holding a figure, or nothing is opened', async () => {
    seed(true);
    const { checkEstimatesCall } = await import('../proposal-object/check-estimates.js');
    expect(checkEstimatesCall(graphNow(), ['fac_hours', 'fac_cost'])?.args.assumptions).toEqual([
      expect.objectContaining({ factor_label: 'Hours', value: 10, unit: 'hours', keep: true }),
      expect.objectContaining({ factor_label: 'Cost', value: 200, unit: 'GBP', keep: true }),
    ]);
    expect(checkEstimatesCall(graphNow(), ['fac_hours', 'fac_hours'])?.args.assumptions).toHaveLength(1);
    expect(checkEstimatesCall(graphNow(), [])).toBeUndefined();
    // The cap, against ids that would each pass: three open a card (the control), a fourth opens nothing.
    const four = { nodes: [...graphNow().nodes, ...['fac_c', 'fac_d'].map((id) => ({ id, kind: 'factor', label: id, observed_state: { value: 1, unit: 'units' } }))] };
    expect(checkEstimatesCall(four, ['fac_hours', 'fac_cost', 'fac_c'])?.args.assumptions).toHaveLength(3);
    expect(checkEstimatesCall(four, ['fac_hours', 'fac_cost', 'fac_c', 'fac_d'])).toBeUndefined();
    expect(checkEstimatesCall(graphNow(), ['fac_hours', 'opt_a']), 'an option is not a factor').toBeUndefined();
    seed();
    expect(checkEstimatesCall(graphNow(), ['fac_hours']), 'a factor with no figure has no estimate to check').toBeUndefined();
  }, 120_000);
  it('CHECK ESTIMATES RED: one held card of the current figures, no change proposed, with Not now', async () => {
    seed(true); const before = bytes();
    const b = await checkEstimates(['fac_hours', 'fac_cost']); const p = shown(b);
    expect(p.proposal_id).toMatch(/^prop_[0-9a-f]{32}$/);
    expect(b._proposal_fields!.proposals).toHaveLength(1);
    expect(p.fields).toEqual([
      expect.objectContaining({ field_id: 'factor_value:fac_cost', kind: 'factor_value', current: { value: 200, unit: 'GBP', source: 'estimate' }, filled_missing: false, editable: true }),
      expect.objectContaining({ field_id: 'factor_value:fac_hours', kind: 'factor_value', current: { value: 10, unit: 'hours', source: 'estimate' }, filled_missing: false, editable: true }),
    ]);
    expect(b.suggested_actions).toContainEqual(p.decline_action);
    expect(bytes(), 'opening the card changes nothing').toBe(before);
  }, 120_000);
  it('R-keep-edit: edited keep has one receipt, no starting values, and accepted untouched Cost', async () => {
    seed(true);
    const b = await checkEstimates(['fac_hours', 'fac_cost']);
    const r = await submit(b, [{ field_id: 'factor_value:fac_hours', value: 12 }]);
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(os('fac_hours')).toMatchObject({ raw_value: 12, source: 'user_override' });
    expect(os('fac_cost')).toMatchObject({ raw_value: 200, source: 'user_assumption', reviewed_by_user: expect.objectContaining({ intent: 'confirm' }) });
    expect(graphWrites.get(SCENARIO)).toBe(1);
    expect(r.assistant_text).toContain('You set "Hours" to 12 hours; Olumi\'s estimate was 10 hours.');
    expect(r.assistant_text).not.toMatch(/starting value/i);
    expect(r.assistant_text).not.toMatch(/Recorded that you accept Olumi/);
    // ACTION-BAR's rule: a figure the user did not edit is never recorded or said as theirs.
    expect(os('fac_cost')['source']).not.toBe('user_override');
    expect(r.assistant_text).toContain('Left as Olumi\'s estimate: "Cost" (£200).');
  }, 120_000);
  it('CHECK ESTIMATES confirm: pressing the card unchanged records acceptance of the same figures', async () => {
    seed(true);
    const b = await checkEstimates(['fac_hours']); const p = shown(b);
    const r = await turn(press(p));
    expect(r._agent.tool_calls).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: p.proposal_id })]);
    // The same figure, now Olumi's estimate ACCEPTED by the user (`isAcceptedOlumiEstimate`), never the user's own.
    expect(os('fac_hours')).toMatchObject({ raw_value: 10, source: 'user_assumption', reviewed_by_user: expect.objectContaining({ intent: 'confirm' }) });
    expect(os('fac_cost')).toMatchObject({ raw_value: 200, source: 'cee_inference' });
    expect(r.assistant_text).toContain('Recorded that you accept Olumi\u2019s estimate');
  }, 120_000);

  it('R-band: choosing the current canonical band reviews Hours without changing its magnitude or source', async () => {
    seed(); const b = await links();
    const { edgeBandFromMagnitude, strengthBandFromEdgeBand } = await import('../../format/edge-strength-bands.js');
    const before = graphNow().edges.find(e => e.from === 'fac_hours' && e.to === 'goal_x')!;
    const strength = before.strength as { mean: number; std: number };
    const source = (before.provenance as { source: string }).source;
    const band = strengthBandFromEdgeBand(edgeBandFromMagnitude(Math.abs(strength.mean)));
    expect(band).toBe('strong');
    const r = await submit(b, [{ field_id: 'link_strength:fac_hours::goal_x', band }]);
    const after = graphNow().edges.find(e => e.from === 'fac_hours' && e.to === 'goal_x')!;
    expect(after.strength).toEqual(strength);
    expect(after.provenance).toMatchObject({ source, reviewed_by_user: { intent: 'confirm' } });
    expect((after.provenance as { source: string }).source).not.toBe('user_specified');
    expect(r.assistant_text).not.toContain('You set how strongly "Hours"');
    expect(r._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: true, mutated: true }));
    // CONTROL: a band differing from both the current and proposed bands is the user's at its midpoint.
    nextScenario(); seed(); const control = await links();
    await submit(control, [{ field_id: 'link_strength:fac_hours::goal_x', band: 'very_strong' }]);
    const moved = graphNow().edges.find(e => e.from === 'fac_hours' && e.to === 'goal_x')!;
    const { EDGE_STRENGTH_MIDPOINTS } = await import('../../format/edge-strength-bands.js');
    expect((moved.strength as { mean: number }).mean).toBe(EDGE_STRENGTH_MIDPOINTS['very strong']);
    expect(moved.provenance).toMatchObject({ source: 'user_specified' });
  }, 120_000);

  it('R-equal-value: equal Hours and changed Cost store Hours exactly as plain A1 approval', async () => {
    seed(); const plain = await assumptions(); await turn(press(shown(plain)));
    const plainHours = structuredClone(os('fac_hours'));
    // The acceptance timestamp belongs to each press; every other stored byte must match.
    plainHours['reviewed_by_user'] = { ...(plainHours['reviewed_by_user'] as object), at: expect.any(String) };
    nextScenario(); seed(); const b = await assumptions();
    const r = await submit(b, [{ field_id: 'factor_value:fac_hours', value: 10 }, { field_id: 'factor_value:fac_cost', value: 220 }]);
    expect(os('fac_hours')).toEqual(plainHours);
    expect(os('fac_cost')).toMatchObject({ raw_value: 220, source: 'user_override' });
    expect(r.assistant_text).not.toContain('You set "Hours"');
    expect(r.assistant_text).toContain('Left as Olumi\'s estimate: "Hours" (10 hours).');
  }, 120_000);

  it('R-equal-all: all equal fields authorise the original proposal without an edited_from proposal', async () => {
    seed(); const b = await assumptions(); const p = shown(b);
    const agentProposals = proposalsForApp;
    const authorise = vi.spyOn(agentProposals, 'authorise');
    const put = vi.spyOn(agentProposals, 'put');
    try {
      const r = await submit(b, [{ field_id: 'factor_value:fac_hours', value: 10 }, { field_id: 'factor_value:fac_cost', value: 200 }]);
      expect(r._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', proposal_id: p.proposal_id, ok: true, mutated: true }));
      expect(authorise.mock.calls.some(([req]) => req.proposal_id === p.proposal_id)).toBe(true);
      expect(authorise.mock.calls.every(([req]) => req.proposal_id === p.proposal_id)).toBe(true);
      expect(put.mock.calls.filter(([proposal]) => proposal.provenance.basis?.startsWith('edited_from:'))).toEqual([]);
      expect(r.assistant_text).not.toContain('You set');
      expect(os('fac_hours')).toMatchObject({ raw_value: 10, source: 'user_assumption' });
    } finally { authorise.mockRestore(); put.mockRestore(); }
  }, 120_000);

  it('R-refused: stale Agent Submit re-offers its exact approve, Change and Not now controls without writing', async () => {
    seed(); const b = await assumptions(); const p = shown(b); const before = bytes();
    const r = await submit(b, [{ field_id: 'factor_value:fac_hours', value: 12 }], { digest: 'stale' });
    expect(r._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', proposal_id: p.proposal_id, ok: false, mutated: false }));
    expect(bytes()).toBe(before); expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(r.suggested_actions).toContainEqual(p.approve_action);
    expect(r.suggested_actions).toContainEqual(p.decline_action);
    expect(r.suggested_actions).toContainEqual(expect.objectContaining({ id: 'agent-amend-proposal', label: 'Change something first' }));
  }, 120_000);

  it('R-reviewed-link-field: a user-stated confirm_current Hours link stays an editable estimate', async () => {
    seed(); const words = 'I think Hours has a strong effect on Revenue.';
    script = [() => fnCall('propose_link_strengths', { links: [{ from_label: 'Hours', to_label: 'Revenue', strength: 'strong', from_words: words }] }), () => say('Review this link.')];
    const b = await turn({ message: words }); const p = shown(b);
    const agentProposals = proposalsForApp;
    expect(agentProposals.get(p.proposal_id)!.operations[0]!.value).toMatchObject({ author: 'user_stated', intent: 'confirm_current' });
    expect(p.fields).toEqual([expect.objectContaining({ field_id: 'link_strength:fac_hours::goal_x', current: { band: 'strong', source: 'estimate' }, editable: true })]);
  }, 120_000);

  it('R-decline-rehydrate: Not now restores FIFO-evicted A, declines its label, and never carries A again', async () => {
    seed(); const a = shown(await assumptions()); const b = shown(await links());
    const agentProposals = proposalsForApp;
    const { createProposal, MAX_PROPOSALS } = await import('../proposal.js');
    const original = agentProposals.get(a.proposal_id)!; const other = agentProposals.get(b.proposal_id)!;
    for (let i = 0; i < MAX_PROPOSALS; i++) agentProposals.put(createProposal({ ...original, scenario_id: '550e8400-e29b-41d4-a716-446655440099', public_label: `Eviction control ${i}` }));
    agentProposals.put(other);
    expect(agentProposals.get(a.proposal_id)).toBeUndefined();
    expect(agentProposals.outstanding(SCENARIO, null).map(p => p.proposal_id)).toEqual([b.proposal_id]);
    const before = bytes();
    const r = await turn({ source: 'chip', chip: { id: a.decline_action.id }, message: a.decline_action.message });
    expect(r.assistant_text).toContain(`Set aside: ${original.public_label}. Nothing in the model changed.`);
    expect(bytes()).toBe(before);
    expect((await pending()).map(p => p.chip_id)).not.toContain(a.approve_action.id);
    const next = await turn({ message: 'Explain what is waiting.' });
    expect(next._proposal_fields?.proposals.map(p => p.proposal_id)).not.toContain(a.proposal_id);
    expect((await pending()).map(p => p.chip_id)).not.toContain(a.approve_action.id);
  }, 120_000);

  it('R-lapse-words: a held removal lapses with its quoted public label and no to add', async () => {
    seed();
    script = [() => fnCall('propose_option_status', { option_label: 'Keep £49', status: 'removed' }), () => say('Take this option out?')];
    const a = shown(await turn({ message: 'Take Keep £49 out of the comparison.' }));
    const agentProposals = proposalsForApp;
    const label = agentProposals.get(a.proposal_id)!.public_label.replace(/\.$/, '');
    graphNow().nodes.find(n => n.id === 'goal_x')!.goal_threshold = 0.9;
    const r = await turn({ message: 'Explain what is waiting.' });
    expect(r.assistant_text).toContain(`The held change "${label}" no longer fits the model as it now stands, so it has lapsed; say the word if you still want it.`);
    expect(r.assistant_text).not.toContain('The held change to add');
  }, 120_000);

  it('R-multi-held-words: pressing identity A after status B binds A card words and writes A', async () => {
    graphOf.set(SCENARIO, JSON.parse(readFileSync(new URL('./fixtures/served-identity-draft-950177e-20260930.json', import.meta.url), 'utf8')).graph);
    script = [() => fnCall('propose_identity', {}), () => say('Confirm this reading.')];
    const a = shown(await turn({ message: 'Confirm the reading of MRR.' }));
    const agentProposals = proposalsForApp;
    expect(agentProposals.get(a.proposal_id)!.operations[0]!.op).toBe('confirm_identity');
    script = [() => fnCall('propose_option_status', { option_label: 'Raise to £59', status: 'removed' }), () => say('Take this option out?')];
    const held = await turn({ message: 'Take Raise to £59 out of the comparison.' }); const b = shown(held);
    expect(b.proposal_id).not.toBe(a.proposal_id);
    expect(approveChipOf(held)?.id).toBe(b.approve_action.id);
    expect(held._proposal_fields!.proposals.map(p => p.proposal_id)).toContain(a.proposal_id);
    const r = await turn(press(a));
    expect(r._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', proposal_id: a.proposal_id, ok: true, mutated: true }));
    expect(r._agent.tool_calls.map(c => c.refusal)).not.toContain('reading_not_confirmed');
  }, 120_000);

  it('R-replay-review: decision review retries never add the held Agent card controls', async () => {
    seed(); const a = shown(await assumptions()); const tid = randomUUID();
    const { DECISION_REVIEW_PRESS_ID } = await import('../decision-review-press.js');
    const payload = { turn_id: tid, source: 'chip_click', chip: { id: DECISION_REVIEW_PRESS_ID }, message: 'Review this decision' };
    const live = await turn(payload);
    const excluded = [a.approve_action.id, 'agent-amend-proposal', a.decline_action.id];
    expect(live.suggested_actions.map(c => c.id).filter(id => excluded.includes(id))).toEqual([]);
    for (const retry of [payload, { turn_id: tid, source: 'retry', message: payload.message }]) {
      const replay = await turn(retry);
      expect(replay.suggested_actions.map(c => c.id).filter(id => excluded.includes(id))).toEqual([]);
    }
  }, 120_000);

  it('R-check-ids: duplicate-label factors open one Check estimates card with both node fields', async () => {
    seed(true); graphNow().nodes.find(n => n.id === 'fac_cost')!.label = 'Hours';
    const b = await checkEstimates(['fac_hours', 'fac_cost']);
    expect(b._proposal_fields!.proposals).toHaveLength(1);
    expect(shown(b).fields.map(f => f.field_id).sort()).toEqual(['factor_value:fac_cost', 'factor_value:fac_hours']);
  }, 120_000);

  it('R-once: an edited A6 states the Hours band only in the S-D receipt', async () => {
    seed(); const b = await links();
    const r = await submit(b, [{ field_id: 'link_strength:fac_hours::goal_x', band: 'very_strong' }]);
    const sentence = 'You set how strongly "Hours" affects "Revenue": very strong; Olumi\'s estimate was moderate.';
    expect(r.assistant_text.split(sentence)).toHaveLength(2);
    expect(r.assistant_text.match(/very strong/g)).toHaveLength(1);
    expect(r.assistant_text).not.toContain('Recorded these 2 link strengths:');
  }, 120_000);

  it('R-replay-method: What would change retries never add the held Agent card controls', async () => {
    seed(); const a = shown(await assumptions()); const tid = randomUUID();
    const { TIPPING_POINT_PRESS_ID } = await import('../tipping-point-coaching.js');
    const payload = { turn_id: tid, source: 'chip_click', chip: { id: TIPPING_POINT_PRESS_ID }, message: 'What would change this?' };
    const live = await turn(payload);
    const excluded = [a.approve_action.id, 'agent-amend-proposal', a.decline_action.id];
    expect(live.suggested_actions.map(c => c.id).filter(id => excluded.includes(id))).toEqual([]);
    for (const retry of [payload, { turn_id: tid, source: 'retry', message: payload.message }]) {
      const replay = await turn(retry);
      expect(replay.suggested_actions.map(c => c.id).filter(id => excluded.includes(id))).toEqual([]);
    }
  }, 120_000);

});
