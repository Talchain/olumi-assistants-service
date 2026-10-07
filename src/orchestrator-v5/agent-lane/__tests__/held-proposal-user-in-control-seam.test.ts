/**
 * ⭐ S-D USER-IN-CONTROL CHANGE, SLICE 1 (lane EDIT-PANEL, DL 0fd71f, 7 Oct; design inflight/lane-edit-panel-DESIGN.md).
 *
 * Paul's prod test (7 Oct, scenario 6582edbc, D-08): Olumi held "add risk 'Recruitment process taking a long time'"
 * (gmh_5c3ad0cdb55a, "Approve 2 changes", a placeholder strength). Paul pressed "Change something first" ("Before you
 * apply it, I want to change some of it."), Olumi asked what, his next message raised a second proposal, and the risk
 * was DROPPED with no word: the Agent turn decremented the hold twice (its inner hold row + its answer row) and the
 * Agent row discards the lapse. Paul (item 7): when Olumi proposes a change, the user sees the AI's values and the
 * missing data, edits them, and Submits; only then is the change applied, and Olumi says what they set vs its estimate.
 *
 * SPEC rows (Paul's words, not the failure mode): a held proposal stays held until approved or explicitly declined;
 * every turn while it is held carries its editable fields with whose each value is; approve-with-edits writes the
 * user's value with the user's provenance through the EXISTING door, and the reply says what they set vs Olumi's.
 *
 * HARNESS: `agent-writer-doors-seam.test.ts`'s, unchanged — the REAL route-v2 and the REAL Agent route on one Fastify
 * app, a stateful store with the production read semantics (latest non-claim answer row, JSONB key order, the REAL
 * `parsePendingAction`), OpenAI only; route-v2's LLM router throws if touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

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
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
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
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, tick)).toISOString() });
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
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: Call[] }; _provider_calls?: { provider: string }[] };
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

const SPEND = 'six_month_decision_spend';
/**
 * A runnable pricing model: decision, goal "Revenue", an outcome "Market share" that reaches it, the lever "Price",
 * and the Paul-shaped limit — a £20,000 cap on "Six-month decision spend" (unit GBP, value_frame 'level', drafted
 * from the brief) — plus a goal target row, to prove the limit door refuses the goal.
 */
const seedGraph = (): G => {
  const e = (from: string, to: string, mean = 0.5, dir: 'positive' | 'negative' = 'positive') =>
    ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
      { id: 'out_share', kind: 'outcome', label: 'Market share' },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: SPEND, kind: 'factor', label: 'Six-month decision spend', category: 'external', observed_state: { value: 0.375, raw_value: 15000, unit: 'GBP', cap: 40000 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a', 1), e('dec_x', 'opt_b', 1), e('opt_a', 'fac_price', 1), e('opt_b', 'fac_price', 1),
      e('fac_price', 'out_share'), e('out_share', 'goal_x'), e('fac_price', 'goal_x'), e(SPEND, 'goal_x', 0.2, 'negative')],
    goal_constraints: [
      { constraint_id: 'gc-spend-1', node_id: SPEND, operator: '<=', value: 20000, unit: 'GBP', value_frame: 'level',
        label: 'Six-month decision spend', provenance: 'inferred', source_quote: 'keep decision spend under £20,000 over six months' },
      { constraint_id: 'gc-goal-1', node_id: 'goal_x', operator: '>=', value: 60000, unit: 'GBP', value_frame: 'level', label: 'Revenue', provenance: 'explicit' },
    ],
  };
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

describe('S-D slice 1 — a held proposal stays held, shows its assumptions, and is approved with the user\'s own values', () => {
  let app: FastifyInstance;
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
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; atFloorRead = undefined; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
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
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string; value?: Record<string, unknown> }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const newRisk = () => graphNow().nodes.find((x) => x.kind === 'risk' && x.label === 'Competitive response');
  const RISK_MSG = 'Add a competitive response risk: a price rise could provoke competitors, which lowers revenue.';
  const proposeRisk = (args: Record<string, unknown> = {}, message = RISK_MSG) => {
    script = [
      () => fnCall('propose_new_risk', {
        label: 'Competitive response',
        affects: [{ target_label: 'Revenue', direction: 'negative' }],
        caused_by: [{ factor_label: 'Price', direction: 'positive' }],
        rationale: 'The user asked for it.',
        ...args,
      }),
      () => say('I would add the risk "Competitive response", driven by Price and lowering Revenue. Shall I add it?'),
    ];
    return turn({ message });
  };

  type Field = { field_id: string; kind: string; from_id: string; to_id: string; from_label: string; to_label: string; direction: string;
    current: { band: string; source: string }; allowed_bands: string[]; editable: boolean };
  type Proposal = { proposal_id: string; revision: string; digest: string; approve_action: Chip; decline_action: Chip; fields: Field[]; missing: { node_id: string; label: string; kind: string; what: string }[] };
  type Fields = { version: number; graph_hash: string; proposals: Proposal[] };
  /** The carrier's own id: the stored revision a panel names. */
  const revisionOf = (pa: unknown): string => (pa as { id: string }).id;
  const fieldsOf = (b: Body) => (b as unknown as { _proposal_fields?: Fields })._proposal_fields;
  /** What the panel was shown for this proposal on that turn: the digest a Submit must echo (Codex r1 P1 on #2743). */
  const shownOf = (b: Body, ref: string): Proposal => {
    const p = fieldsOf(b)?.proposals.find((x) => x.proposal_id === ref);
    expect(p, JSON.stringify(fieldsOf(b))).toBeDefined();
    return p!;
  };
  const AMEND = { message: 'Before you apply it, I want to change some of it.', source: 'chip', chip: { id: 'agent-amend-proposal' } };
  const edgeOf = (from: string, to: string) => graphNow().edges.find((e) => e.from === from && e.to === to) as
    ({ strength?: { mean?: number; std?: number }; provenance?: { source?: string }; defaulted?: unknown } & Record<string, unknown>) | undefined;
  const proposeOption = () => {
    script = [
      () => fnCall('propose_new_option', { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }], rationale: 'The user asked for it.' }),
      () => say('I would add "Test £54 at release". Shall I add it?'),
    ];
    return turn({ message: 'Also add an option: test £54 at release.' });
  };

  it('CONTROL (passes at base): the plain approve applies the held risk with Olumi\'s placeholder links, exactly as before', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeRisk())!;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const risk = newRisk()!;
    for (const e of [edgeOf(risk.id, 'goal_x')!, edgeOf('fac_price', risk.id)!]) {
      expect(e.provenance?.source, JSON.stringify(e)).toBe('cee_hypothesis');
      expect(e.defaulted, JSON.stringify(e)).toBe(true);
    }
    expect(t2.assistant_text).not.toMatch(/You set how strongly/);
  }, 120_000);

  it('[D-08] RED: "Change something first" keeps the held risk held, re-offers its card, and the turn carries its editable fields with whose each value is', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const riskId = (await heldOnLatestRow())[0]!.action.inline_patch!.operations![0]!.path;
    script = [() => say('What would you like to change: the risk’s wording, what it threatens, or how strongly it acts?')];
    const t2 = await turn(AMEND);
    expect((await heldOnLatestRow()).map((p) => p.chip_id), 'still held').toEqual([ref]);
    expect(approveChipOf(t2)?.id, 'its card is offered again: a hold the user cannot press is a dead hold').toBe(approve.id);
    expect(approveChipOf(t2)?.message, 'the exact words the door checks').toBe(approve.message);
    expect(t2.suggested_actions.map((c) => c.id), 'its "Not now" is on offer: words alone never set it aside').toContain(`agent-decline-proposal:${ref}`);
    const f = fieldsOf(t2);
    expect(f, JSON.stringify(Object.keys(t2))).toBeDefined();
    expect(f!.graph_hash).toBe(await hashNow());
    expect(f!.proposals.map((p) => p.proposal_id)).toEqual([ref]);
    const p = f!.proposals[0]!;
    expect(p.revision, 'the exact stored revision the panel shows').toBe(revisionOf((await heldOnLatestRow())[0]!));
    expect(p.digest, 'a digest of exactly what the panel shows').toMatch(/^[0-9a-f]{32}$/);
    expect(p.approve_action).toEqual(expect.objectContaining({ id: approve.id, message: approve.message }));
    expect(p.decline_action.id).toBe(`agent-decline-proposal:${ref}`);
    // Bound by identity: one field per held link, keyed by the held op's own path.
    expect(p.fields.map((x) => x.field_id).sort()).toEqual([`link_strength:${riskId}::goal_x`, `link_strength:fac_price::${riskId}`].sort());
    const toGoal = p.fields.find((x) => x.field_id === `link_strength:${riskId}::goal_x`)!;
    expect(toGoal).toEqual(expect.objectContaining({ kind: 'link_strength', from_id: riskId, to_id: 'goal_x', from_label: 'Competitive response',
      to_label: 'Revenue', direction: 'negative', editable: true, current: { band: 'strong', source: 'placeholder' } }));
    expect(toGoal.allowed_bands).toEqual(['slight', 'moderate', 'strong', 'very_strong']);
    expect(p.missing).toEqual([{ node_id: riskId, label: 'Competitive response', kind: 'risk', what: 'level_today' }]);
  }, 120_000);

  it('[D-08] RED: a second proposal in a later turn never drops the first; approving the second keeps the first held and approvable', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approveRisk = approveChipOf(await proposeRisk())!;
    const riskRef = approveRisk.id.slice('agent-approve-proposal:'.length);
    script = [() => say('What would you like to change?')];
    await turn(AMEND);
    const t3 = await proposeOption();
    const approveOption = approveChipOf(t3)!;
    expect(approveOption?.id, JSON.stringify(t3._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const optionRef = approveOption.id.slice('agent-approve-proposal:'.length);
    expect((await heldOnLatestRow()).map((p) => p.chip_id).sort(), 'BOTH held after the second proposal (Paul’s turn 5)').toEqual([riskRef, optionRef].sort());
    expect(fieldsOf(t3)!.proposals.map((p) => p.proposal_id).sort()).toEqual([riskRef, optionRef].sort());
    // Paul's turn 6: approving the option moves the model; the risk is re-checked against it and stays held.
    const t4 = await turn({ message: approveOption.message, source: 'chip', chip: { id: approveOption.id } });
    expect(t4._agent.tool_calls[0], JSON.stringify(t4._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect((await heldOnLatestRow()).map((p) => p.chip_id), 'the risk is still held after another change landed').toEqual([riskRef]);
    expect(approveChipOf(t4)?.id, 'and its card is offered').toBe(approveRisk.id);
    const t5 = await turn({ message: approveRisk.message, source: 'chip', chip: { id: approveRisk.id } });
    expect(t5._agent.tool_calls[0], JSON.stringify(t5._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(newRisk(), 'the risk Paul approved reached the model').toBeDefined();
  }, 180_000);

  it('RED: approve-with-edits — the user’s band is written with the user’s provenance through the existing door; the field left blank stays Olumi’s; the reply says what they set vs Olumi’s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const riskId = (await heldOnLatestRow())[0]!.action.inline_patch!.operations![0]!.path;
    const revision = revisionOf((await heldOnLatestRow())[0]!);
    const { digest } = shownOf(t1, ref);
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const calls = openAiCalls;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id },
      proposal_edits: { proposal_id: ref, revision, digest, graph_hash: await hashNow(), fields: [{ field_id: `link_strength:${riskId}::goal_x`, band: 'very_strong' }] } });
    expect(openAiCalls - calls, 'no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: ref })]);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore, 'ONE graph-bearing row: the existing door').toBe(1);
    const edited = edgeOf(riskId, 'goal_x')!;
    expect(edited.provenance?.source, JSON.stringify(edited)).toBe('user_specified');
    expect(edited.defaulted, JSON.stringify(edited)).toBeUndefined();
    expect(edited.strength?.mean, 'the very strong band, signed by the held direction').toBeCloseTo(-0.85, 10);
    const { edgeBandStd } = await import('../../format/edge-strength-bands.js');
    expect(edited.strength?.std).toBeCloseTo(edgeBandStd('very strong'), 10);
    const kept = edgeOf('fac_price', riskId)!;
    expect(kept.provenance?.source, 'the link the user left blank stays Olumi’s').toBe('cee_hypothesis');
    expect(kept.defaulted).toBe(true);
    expect(await heldOnLatestRow(), 'consumed').toEqual([]);
    expect(t2.assistant_text, t2.assistant_text).toContain('You set how strongly "Competitive response" affects "Revenue": very strong. Olumi had only a placeholder there, not an estimate.');
    expect(t2.assistant_text, t2.assistant_text).toContain('Left as Olumi\'s placeholder: "Price" → "Competitive response".');
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('NEGATIVE: an edit naming a field the proposal does not hold, a stale model, another revision or proposal, or what another panel showed → nothing written, still held, and the reply says so (with no em dash)', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const { digest } = shownOf(t1, ref);
    const before = bytes();
    const hash = await hashNow();
    const held = (await heldOnLatestRow())[0]!;
    const revision = revisionOf(held);
    const link = `link_strength:fac_price::${held.action.inline_patch!.operations![0]!.path}`;
    for (const edits of [
      // a field this proposal does not hold (an existing link of the model) — bound by identity, never by shape
      { proposal_id: ref, revision, digest, graph_hash: hash, fields: [{ field_id: 'link_strength:fac_price::goal_x', band: 'strong' }] },
      // values set on another model
      { proposal_id: ref, revision, digest, graph_hash: 'f'.repeat(64), fields: [{ field_id: link, band: 'strong' }] },
      // values set on another revision of this proposal (Codex P0: two panels never approve each other's values)
      { proposal_id: ref, revision: '00000000-0000-4000-8000-000000000000', digest, graph_hash: hash, fields: [{ field_id: link, band: 'strong' }] },
      // values for another proposal than the card pressed
      { proposal_id: 'gmh_000000000000', revision, digest, graph_hash: hash, fields: [{ field_id: link, band: 'strong' }] },
      // a band outside the vocabulary
      { proposal_id: ref, revision, digest, graph_hash: hash, fields: [{ field_id: link, band: 'enormous' }] },
      // what another panel showed (Codex r1 P1: the hash and revision alone do not bind the words on screen)
      { proposal_id: ref, revision, digest: '0'.repeat(32), graph_hash: hash, fields: [{ field_id: link, band: 'strong' }] },
    ]) {
      const t = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id }, proposal_edits: edits });
      expect(t._agent.tool_calls.filter((c) => c.name === 'authorise_change' && c.ok), JSON.stringify(edits)).toEqual([]);
      expect(bytes(), `nothing written for ${JSON.stringify(edits)}`).toBe(before);
      expect((await heldOnLatestRow()).map((p) => p.chip_id), 'still held').toEqual([ref]);
      expect(t.assistant_text, t.assistant_text).toMatch(/Nothing in the model changed/);
      expect(t.assistant_text, 'no em dash in the refusal (Codex r1 P2)').not.toContain('\u2014');
    }
    // CONTROL: the same press with what this panel showed lands (each refusal above is the one difference named).
    const ok = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id }, proposal_edits: { proposal_id: ref, revision, digest, graph_hash: hash, fields: [{ field_id: link, band: 'strong' }] } });
    expect(ok._agent.tool_calls[0], JSON.stringify(ok._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
  }, 240_000);

  it('RED (Codex P0): THE DOOR ITSELF applies edits only to the stored revision they name — a press naming another revision writes nothing; the same press naming this one lands the user\u2019s value', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const { digest } = shownOf(t1, ref);
    const held = (await heldOnLatestRow())[0]!;
    const riskId = held.action.inline_patch!.operations![0]!.path;
    const before = bytes();
    // Straight at the product's confirm (route-v2), bypassing the Agent's own pre-check: the door must bind on its own.
    const press = (revision: string, shown: string = digest) => app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame', turn_class: 'frame', source: 'chip',
      message: approve.message, chip: { id: ref, parameters: { proposal_edits: { proposal_id: ref, revision, digest: shown, graph_hash: hashBefore,
        fields: [{ field_id: `link_strength:${riskId}::goal_x`, band: 'slight' }] } } },
    } });
    const hashBefore = await hashNow();
    const other = await press('00000000-0000-4000-8000-000000000000');
    expect(other.statusCode, other.body.slice(0, 300)).toBe(200);
    expect(bytes(), 'another revision writes nothing').toBe(before);
    const otherPanel = await press(revisionOf(held), '0'.repeat(32));
    expect(otherPanel.statusCode, otherPanel.body.slice(0, 300)).toBe(200);
    expect(bytes(), 'what another panel showed writes nothing, at the door too').toBe(before);
    const own = await press(revisionOf(held));
    expect(own.statusCode, own.body.slice(0, 300)).toBe(200);
    const e = edgeOf(riskId, 'goal_x')!;
    expect(e.provenance?.source, JSON.stringify(e)).toBe('user_specified');
    expect(e.strength?.mean).toBeCloseTo(-0.1, 10);
  }, 120_000);

  it('RED: the typed decline sets the held proposal aside — gone from the row, nothing written, said in words', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeRisk())!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const before = bytes();
    const t2 = await turn({ message: 'Not now.', source: 'chip', chip: { id: `agent-decline-proposal:${ref}` } });
    expect(await heldOnLatestRow(), 'no longer held').toEqual([]);
    expect(bytes()).toBe(before);
    expect(t2.assistant_text, t2.assistant_text).toContain("Set aside: the risk 'Competitive response'. Nothing in the model changed.");
    expect(fieldsOf(t2)).toBeUndefined();
    const late = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(late._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(bytes(), 'a declined proposal writes nothing').toBe(before);
  }, 120_000);

  it('RED (Codex r1 P1): values shown for one model are never applied to a renamed one: same hash, other words → nothing written, still held; the panel shown afresh lands, in the new words', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const riskId = (await heldOnLatestRow())[0]!.action.inline_patch!.operations![0]!.path;
    const shown = shownOf(t1, ref);
    const hash = await hashNow();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'fac_price' ? { ...x, label: 'Advertising spend' } : x)) });
    expect(await hashNow(), 'precondition: a rename leaves the analysis hash as it was').toBe(hash);
    const before = bytes();
    const edits = (digest: string) => ({ proposal_id: ref, revision: shown.revision, digest, graph_hash: hash,
      fields: [{ field_id: `link_strength:fac_price::${riskId}`, band: 'very_strong' }] });
    const stale = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id }, proposal_edits: edits(shown.digest) });
    expect(stale._agent.tool_calls.filter((c) => c.name === 'authorise_change' && c.ok), JSON.stringify(stale._agent.tool_calls)).toEqual([]);
    expect(bytes(), 'the user sized a link they saw as "Price"; nothing is written under another name').toBe(before);
    expect((await heldOnLatestRow()).map((x) => x.chip_id), 'still held').toEqual([ref]);
    expect(stale.assistant_text, stale.assistant_text).toMatch(/Nothing in the model changed/);
    script = [() => say('What would you like to change?')];
    const fresh = shownOf(await turn(AMEND), ref);
    expect(fresh.fields.find((f) => f.field_id === `link_strength:fac_price::${riskId}`)?.from_label).toBe('Advertising spend');
    expect(fresh.digest).not.toBe(shown.digest);
    const ok = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id }, proposal_edits: edits(fresh.digest) });
    expect(ok._agent.tool_calls[0], JSON.stringify(ok._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(edgeOf('fac_price', riskId)?.provenance?.source).toBe('user_specified');
    expect(ok.assistant_text, ok.assistant_text).toContain('You set how strongly "Advertising spend" affects "Competitive response": very strong.');
  }, 180_000);

  it('RED (Codex r1 P1): values submitted after the model moved → nothing written, said plainly with no em dash; the proposal is still there to decide', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const riskId = (await heldOnLatestRow())[0]!.action.inline_patch!.operations![0]!.path;
    const shown = shownOf(t1, ref);
    const hash = await hashNow();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'fac_price' ? { ...x, observed_state: { value: 0.275, raw_value: 55, unit: 'GBP', cap: 200 } } : x)) });
    expect(await hashNow(), 'precondition: the model moved').not.toBe(hash);
    const before = bytes();
    const t = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id }, proposal_edits: { proposal_id: ref, revision: shown.revision,
      digest: shown.digest, graph_hash: hash, fields: [{ field_id: `link_strength:fac_price::${riskId}`, band: 'very_strong' }] } });
    expect(t._agent.tool_calls.filter((c) => c.name === 'authorise_change' && c.ok), JSON.stringify(t._agent.tool_calls)).toEqual([]);
    expect(bytes(), 'nothing written').toBe(before);
    expect(t.assistant_text, t.assistant_text).toMatch(/Nothing in the model changed/);
    expect(t.assistant_text, t.assistant_text).not.toContain('—');
    expect((await heldOnLatestRow()).map((x) => x.chip_id), 'never dropped in silence').toEqual([ref]);
  }, 120_000);

  it('RED (Codex r1 P1): a request that reconciled its held proposals and then answered never puts back one another request declined meanwhile', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeRisk())!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    expect((await heldOnLatestRow()).map((x) => x.chip_id)).toEqual([ref]);
    // Another request's decline lands between this turn's reconcile and its append (its answer row holds nothing).
    atFloorRead = async () => {
      await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'another-request-declined-it', userMessage: 'Not now.',
        assistantMessage: "Set aside: the risk 'Competitive response'. Nothing in the model changed.", pending_actions: [] });
    };
    script = [() => say('It means competitors may answer a price rise with their own cuts.')];
    await turn({ message: 'Tell me what this risk means.' });
    expect(atFloorRead, 'precondition: the race was staged at the floor’s own read').toBeUndefined();
    expect(await heldOnLatestRow(), 'never resurrected').toEqual([]);
  }, 120_000);

  it('RED (Codex r1 P1): three held proposals and a new approval this turn offers → the offered approval is on the row; a held one that cannot fit is SAID set aside, never dropped in silence', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const labels = ['Competitive response', 'Supplier delay', 'Staff turnover'];
    const refs: string[] = [];
    for (const label of labels) {
      const a = approveChipOf(await proposeRisk({ label }, `Add a risk: ${label}, which lowers revenue.`));
      expect(a, label).toBeDefined();
      refs.push(a!.id.slice('agent-approve-proposal:'.length));
    }
    const heldBefore = (await heldOnLatestRow()).map((x) => x.chip_id);
    expect(heldBefore.length, 'precondition: the row is full of held proposals').toBeGreaterThanOrEqual(2);
    script = [
      () => fnCall('propose_link_strength', { from_label: 'Price', to_label: 'Revenue', strength: 'strong', rationale: 'The user said its effect is strong.' }),
      () => say('I would set how strongly Price affects Revenue to strong. Shall I?'),
    ];
    const t = await turn({ message: 'Price has a strong effect on revenue.' });
    const offered = approveChipOf(t);
    expect(offered?.id, JSON.stringify(t._agent.tool_calls)).toMatch(/^agent-approve-proposal:(?!gmh_)/);
    const offeredRef = offered!.id.slice('agent-approve-proposal:'.length);
    const row = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { inline_patch?: { agent_proposal?: { proposal_id?: string } } } }[];
    expect(row.some((x) => x.action.inline_patch?.agent_proposal?.proposal_id === offeredRef), JSON.stringify(row.map((x) => x.chip_id))).toBe(true);
    const heldAfter = (await heldOnLatestRow()).map((x) => x.chip_id);
    const cut = refs.filter((r) => heldBefore.includes(r) && !heldAfter.includes(r));
    expect(cut.length, 'precondition: at least one held proposal could not fit').toBeGreaterThanOrEqual(1);
    for (const r of cut) {
      const label = labels[refs.indexOf(r)]!;
      expect(t.assistant_text, t.assistant_text).toContain(`The held change to add the risk '${label}' was set aside because only three changes can wait at once`);
    }
  }, 240_000);
});
