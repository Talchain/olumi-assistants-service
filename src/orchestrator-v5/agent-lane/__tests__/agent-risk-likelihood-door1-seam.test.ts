/** Door 1: exact jw-j2 fixtures through Agent → choice → product hold → Apply.
 * RED assertions were authored before production edits. Local execution is skipped when the load check is blocked.
 * The session mock preserves JSONB ordering and uses the production pending parser, as the existing event-risk seam.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Block } from '@talchain/schemas/boundary';
import type { ProposalFieldsWire } from '../proposal-object/record.js';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const briefOf = new Map<string, string>();
/** Every append that carried a graph, per scenario: "ONE graph-bearing row". */
const graphWrites = new Map<string, number>();
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
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
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
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: briefOf.get(sid) ?? null })),
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
type Body = { assistant_text: string; suggested_actions: Chip[]; blocks?: readonly Block[];
  _proposal_fields?: ProposalFieldsWire; _agent: { tool_calls: Call[] }; _provider_calls?: { provider: string }[] };
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

const SPEND = 'six_month_decision_spend';
/**
 * A runnable pricing model: decision, goal "Revenue", an outcome "Market share" that reaches it, the lever "Price",
 * and an existing spend limit; the unrelated add-risk control must preserve the complete legacy graph.
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
/** The tool output the model was handed on its NEXT call (the first function_call_output in its input). */
const toolOutputIn = (body: Record<string, unknown>): Record<string, unknown> => {
  const out = (body['input'] as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').at(-1);
  return JSON.parse(String(out?.output ?? '{}')) as Record<string, unknown>;
};

const PROBABILITY = 'largest_client_contract_cut_likelihood';
const SHARE = 'largest_client_revenue_share';
const RISK = 'expected_revenue_lost_from_largest_client_cut';
const DUPLICATE = 'risk_largest_client_contract_cancellation';
const TARGET = 'monthly_revenue';
const RISK_LABEL = 'Expected revenue lost from largest-client cut';
const PROBABILITY_LABEL = 'Largest-client contract-cut likelihood';
const SHARE_LABEL = 'Largest-client revenue share';
const DUPLICATE_LABEL = 'Largest-client contract cancellation';
const SHARE_REMOVAL_DETAIL = "‘Largest-client revenue share’: its 40% is now the size of the loss on the link, so it's removed as a separate factor.";
const IMPACT_SOURCE_REFUSAL = "I can't convert this yet without losing your 40%; I've kept the model as it is";
// The supplied graph has no stored horizon on its probability factor. Attest the original words from the saved brief,
// rather than editing the graph fixture or pretending the 9-month goal window is this event's window.
const DRAFT_BRIEF = 'There is about a 30% chance that our largest client, who is 40% of our revenue, cuts their contract this year.';
const CLIENT_MSG = 'Add a risk: our largest client might cancel their contract, maybe 20 - 40% in the next 6 months. If they cancel, monthly revenue would drop.';
const PICK_NEW = `Use 20–40% in the next 6 months for ${RISK_LABEL}.`;
const EVENT = { version: 1, occurrence: { p_low: 0.2, p_high: 0.4, basis: 'user', meaning: 'at_least_once_within_horizon' }, horizon: { months: 6 } };
const fixture = (which: 'before' | 'after'): G => JSON.parse(readFileSync(new URL(`./fixtures/door1/jw-j2-graph-${which}.json`, import.meta.url), 'utf8')) as G;
const clientRisk = (g: G) => g.nodes.find((node) => node.id === RISK)!;
const plainGraph = (): G => {
  const graph = seedGraph();
  graph.nodes.push({ id: 'risk_competitive_response', kind: 'risk', label: 'Competitive response' });
  graph.edges.push({ from: 'risk_competitive_response', to: 'goal_x', strength: { mean: -0.5, std: 0.2 },
    exists_probability: 0.8, effect_direction: 'negative', defaulted: true,
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
  return graph;
};
const actionWords = (chip: Chip) => [chip.label, chip.message, chip.detail ?? ''];
/** Only display copy: held_proposal.summary and the other boundary block prose, never raw graph/operation JSON. */
const blockWords = (block: Block): string[] => ['summary', 'content', 'title', 'body', 'description']
  .flatMap((key) => {
    const value = (block as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' ? [value] : [];
  });
/** The route's proposal card is the _proposal_fields sidecar, not a proposal_card boundary block. */
const proposalWords = (wire: ProposalFieldsWire | undefined) => (wire?.proposals ?? []).flatMap((proposal) => [
  ...actionWords(proposal.approve_action), ...actionWords(proposal.decline_action),
  ...proposal.fields.flatMap((field) => field.kind === 'link_strength'
    ? [field.from_label, field.to_label, field.current.band, field.current.source, ...field.allowed_bands]
    : [field.label, field.unit, field.current.unit, field.current.source]),
  ...proposal.missing.map((datum) => datum.label),
]);
const publicLines = (body: Body) => [body.assistant_text, ...body.suggested_actions.flatMap(actionWords),
  ...(body.blocks ?? []).flatMap(blockWords), ...proposalWords(body._proposal_fields)]
  .flatMap((text) => text.split('\n')).filter(Boolean);
const publicWords = (body: Body) => publicLines(body).join('\n');

describe('EVENT-RISK door 1 — existing event update and conversion', () => {
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
      const graph = graphOf.get(id) ?? null;
      return { graph, graph_hash: graph === null ? null : computeAnalysisAffectingGraphHash(graph as never), brief_text: briefOf.get(id) ?? null };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => {
    await app?.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0;
    briefOf.set(SCENARIO, DRAFT_BRIEF);
  });
  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(response.statusCode, response.body.slice(0, 400)).toBe(200);
    return response.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const bytes = () => JSON.stringify(graphNow());
  const approvalOf = (body: Body) => body.suggested_actions.find((chip) => chip.id.startsWith('agent-approve-proposal:'));
  const heldOnLatestRow = async () => {
    const pending = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string; inline_patch?: {
      handler_id?: string; operations?: { op: string; path: string; value?: Record<string, unknown> }[]; [key: string]: unknown;
    } } }[];
    return pending.filter((item) => item.action.kind === 'apply_proposed_change' && item.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const apply = async (chip: Chip) => {
    const before = graphWrites.get(SCENARIO) ?? 0;
    const body = await turn({ message: chip.message, source: 'chip', chip: { id: chip.id } });
    expect(body._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect((graphWrites.get(SCENARIO) ?? 0) - before).toBe(1);
    expect(routerCalls).toEqual([]);
    return body;
  };
  const offerUpdate = async (message: string, riskLabel = RISK_LABEL) => {
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_risk_likelihood', { risk_label: riskLabel, rationale: 'Use the likelihood the user stated.' }),
      (body) => { result = toolOutputIn(body); return say(String(result.detail ?? result.note ?? 'Review the proposed likelihood.')); }];
    const body = await turn({ message });
    return { body, result, approve: approvalOf(body) };
  };
  const offerClientConversion = async () => {
    let detection: Record<string, unknown> = {};
    let update: Record<string, unknown> = {};
    script = [
      () => fnCall('propose_new_risk', { label: DUPLICATE_LABEL, affects: [{ target_label: 'Monthly revenue', direction: 'negative' }],
        caused_by: [], rationale: 'The user restated this event.' }),
      (body) => {
        detection = toolOutputIn(body);
        return detection.refusal === 'same_event_modelled'
          ? fnCall('propose_risk_likelihood', { risk_label: RISK_LABEL, rationale: 'Update the event already modelled.' })
          : say('Review the new risk before applying it.');
      },
      (body) => { update = toolOutputIn(body); return say([update.detail, update.preview_detail].filter((value) => typeof value === 'string').join('\n') || 'Which should the model use?'); },
    ];
    const body = await turn({ message: CLIENT_MSG });
    // The detection-off mutant takes today's add path. Apply that actual offered card before asserting identity,
    // so the mutant evidence witnesses the second client node through the real door rather than merely a return code.
    if (detection.ok === true) {
      const unintendedAdd = approvalOf(body);
      expect(unintendedAdd).toBeDefined();
      await apply(unintendedAdd!);
      expect(graphNow().nodes.filter((node) => node.kind === 'risk' && /client/i.test(node.label)).map((node) => node.id)).toEqual([RISK]);
    }
    expect(detection).toMatchObject({ ok: false, mutated: false, refusal: 'same_event_modelled',
      existing_risk_label: RISK_LABEL, existing_probability_factor_label: PROBABILITY_LABEL, next: 'propose_risk_likelihood' });
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: false, refusal: 'same_event_modelled' }));
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_risk_likelihood' }));
    const words = publicWords(body);
    expect(words).toContain(PROBABILITY_LABEL);
    expect(words).toContain(SHARE_LABEL);
    expect(words).toMatch(/remov(?:e|ed|es|ing)/i);
    expect(words).toMatch(/(?:30%[^\n]*this year|this year[^\n]*30%)/i);
    expect(words).toMatch(/20\s*[–-]\s*40%[^\n]*6 months/);
    expect(words).toContain('Which should the model use?');
    expect(approvalOf(body)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    return { body, update };
  };
  const assertSingleClientEvent = (shareState: 'removed' | 'retained' | 'unchecked' = 'removed') => {
    const graph = graphNow();
    const risks = graph.nodes.filter((node) => node.kind === 'risk' && /client/i.test(node.label));
    expect(risks.map((node) => node.id)).toEqual([RISK]);
    expect(clientRisk(graph).event_risk).toEqual(EVENT);
    expect(graph.nodes.some((node) => node.id === PROBABILITY)).toBe(false);
    expect(graph.edges.some((edge) => edge.from === PROBABILITY || edge.to === PROBABILITY)).toBe(false);
    if (shareState === 'removed') expect(graph.nodes.some((node) => node.id === SHARE)).toBe(false);
    if (shareState === 'retained') expect(graph.nodes.find((node) => node.id === SHARE)).toBeDefined();
    expect(graph.edges.some((edge) => edge.from === SHARE && edge.to === RISK)).toBe(false);
    expect(graph.edges.some((edge) => edge.to === RISK)).toBe(false);
    expect(graph.edges.filter((edge) => edge.from === RISK && edge.to === TARGET)).toHaveLength(1);
  };

  it('door1-jw-j2-convert: detection → both horizons → user picks range → one atomic event', async () => {
    graphOf.set(SCENARIO, fixture('before'));
    const before = bytes();
    await offerClientConversion();
    expect(bytes()).toBe(before);
    const { body, result, approve } = await offerUpdate(PICK_NEW);
    expect(result).toMatchObject({ ok: true, mutated: false, proposal_id: expect.stringMatching(/^gmh_/) });
    expect(approve).toBeDefined();
    expect((await heldOnLatestRow())).toHaveLength(1);
    expect(approve!.message).toBe(`Yes, update risk '${RISK_LABEL}', remove factor '${PROBABILITY_LABEL}', remove the link from '${SHARE_LABEL}' to '${RISK_LABEL}', remove factor '${SHARE_LABEL}' and make the effect on ‘Monthly revenue’ a 40% loss if it happens.`);
    expect(approve!.message).not.toMatch(/,? and [A-Z]/);
    expect(approve!.message).not.toContain(';');
    expect(approve!.message).not.toContain('If it happens,');
    const effectDetail = "If it happens, Monthly revenue falls by 40% at the model's current £110,000 / month reference (£44,000 / month); this link carries that fixed loss.";
    expect(approve!.detail?.split('\n').filter((line) => line === effectDetail)).toEqual([effectDetail]);
    expect(approve!.detail?.split('\n').filter((line) => line === SHARE_REMOVAL_DETAIL)).toEqual([SHARE_REMOVAL_DETAIL]);
    const cardApprove = body._proposal_fields?.proposals.find((proposal) => proposal.approve_action.id === approve!.id)?.approve_action;
    expect(cardApprove?.message).toBe(approve!.message);
    expect(cardApprove?.detail?.split('\n').filter((line) => line === effectDetail)).toEqual([effectDetail]);
    expect(cardApprove?.detail?.split('\n').filter((line) => line === SHARE_REMOVAL_DETAIL)).toEqual([SHARE_REMOVAL_DETAIL]);
    expect(publicWords(body)).toContain(PROBABILITY_LABEL);
    expect(publicWords(body)).toContain(SHARE_LABEL);
    expect(publicWords(body)).toMatch(/20\s*[–-]\s*40%[^\n]*6 months/);
    expect(publicWords(body)).toMatch(/If it happens, [‘']?Monthly revenue[’']? falls by 40%/);
    expect(publicWords(body)).not.toContain('stays a placeholder');
    expect(publicWords(body)).toContain('This assumes the whole contract is lost; if they\'d only cut part of it, how much?');
    expect(bytes()).toBe(before);
    await apply(approve!);
    assertSingleClientEvent();
    const impact = graphNow().edges.find((edge) => edge.from === RISK && edge.to === TARGET)!;
    expect(impact.exists_probability).toBe(1);
    expect(impact.provenance).toMatchObject({ source: 'brief_extraction', magnitude: 'user_stated', natural_effect: {
      amount: -44000, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: 'occurrence',
    } });
    expect((impact.strength as { mean: number }).mean).toBeCloseTo(-44000 / 187500, 12);
    expect(clientRisk(graphNow()).scale_frame).toBe(1);
    expect(graphNow().nodes.find((node) => node.id === TARGET)?.goal_horizon_months).toBe(9);
  }, 120_000);

  it('door1-convert-run-ready: Apply introduces no new canonical readiness blocker', async () => {
    const { assessCanonicalAnalysisReadiness } = await import('../../../orchestrator/tools/analysis-ready-helper.js');
    const { validateGraphStructure } = await import('../../../orchestrator/graph-structure-validator.js');
    graphOf.set(SCENARIO, fixture('before'));
    const before = assessCanonicalAnalysisReadiness(graphNow());
    const structuralBefore = validateGraphStructure(graphNow() as never, { leaveOutInertRisks: true });
    await offerClientConversion();
    const { approve } = await offerUpdate(PICK_NEW);
    expect(approve).toBeDefined();
    await apply(approve!);
    // The keep-F6 mutant must reach canonical readiness, so this row deliberately leaves node removal to readiness.
    assertSingleClientEvent('unchecked');
    const after = assessCanonicalAnalysisReadiness(graphNow());
    const structuralAfter = validateGraphStructure(graphNow() as never, { leaveOutInertRisks: true });
    const blockerKey = (issue: (typeof before.blockingIssues)[number]) => JSON.stringify([issue.code, issue.option_id ?? null, issue.factor_id ?? null]);
    const beforeKeys = new Set(before.blockingIssues.map(blockerKey));
    const diagnostics = JSON.stringify({
      before: { safeToAnalyse: before.safeToAnalyse, blockingIssues: before.blockingIssues, structural: structuralBefore.violations },
      after: { safeToAnalyse: after.safeToAnalyse, blockingIssues: after.blockingIssues, structural: structuralAfter.violations },
    }, null, 2);
    expect(after.blockingIssues.filter((issue) => !beforeKeys.has(blockerKey(issue))), diagnostics).toEqual([]);
    expect(before.safeToAnalyse && !after.safeToAnalyse, diagnostics).toBe(false);
  }, 120_000);

  it('door1-ii-remove-share: the sole share factor is named in the same hold and its brief figure survives on the effect', async () => {
    const { assessCanonicalAnalysisReadiness } = await import('../../../orchestrator/tools/analysis-ready-helper.js');
    const { GM_HELD_RISK_LIKELIHOOD_KEY, riskLikelihoodRefereeOperations } = await import('../../handlers/risk-likelihood-dispatch.js');
    graphOf.set(SCENARIO, fixture('before'));
    const before = bytes();
    expect(assessCanonicalAnalysisReadiness(graphNow()).blockingIssues).toEqual([]);
    const { body, approve } = await offerUpdate(PICK_NEW);
    expect(approve).toBeDefined();
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    expect(held[0]!.action.inline_patch!.operations!.map((operation) => `${operation.op}:${operation.path}`)).toEqual([
      `update_node:${RISK}`, `remove_node:${PROBABILITY}`, `remove_edge:${SHARE}::${RISK}`,
      `remove_node:${SHARE}`, `update_edge:${RISK}::${TARGET}`,
    ]);
    const patch = held[0]!.action.inline_patch!;
    const operations = patch.operations! as unknown as Parameters<typeof riskLikelihoodRefereeOperations>[0];
    const member = patch[GM_HELD_RISK_LIKELIHOOD_KEY] as Record<string, unknown>;
    expect(member).toMatchObject({ impact_path: 'ii' });
    expect(riskLikelihoodRefereeOperations(operations.filter((operation) => operation.op !== 'remove_node' || operation.path !== SHARE), member, graphNow())).toBeUndefined();
    expect(riskLikelihoodRefereeOperations(operations, { ...member, impact_path: 'i', effects: [] }, graphNow())).toBeUndefined();
    const graphWithAnotherShareEdge = fixture('before');
    graphWithAnotherShareEdge.edges.push({ from: SHARE, to: TARGET, strength: { mean: 0.2, std: 0.1 },
      exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } });
    expect(riskLikelihoodRefereeOperations(operations, member, graphWithAnotherShareEdge)).toBeUndefined();
    expect(approve!.detail?.split('\n')).toContain(SHARE_REMOVAL_DETAIL);
    expect(approve!.detail?.split('\n')).toContain(`Remove the link from ‘${SHARE_LABEL}’ to ‘${RISK_LABEL}’.`);
    expect(publicWords(body)).not.toContain('the share remains the size of the loss');
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    await apply(approve!);
    assertSingleClientEvent();
    expect(assessCanonicalAnalysisReadiness(graphNow()).blockingIssues).toEqual([]);
    expect(graphNow().edges.find((edge) => edge.from === RISK && edge.to === TARGET)?.provenance).toMatchObject({
      source: 'brief_extraction', magnitude: 'user_stated', natural_effect: {
        amount: -44000, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: 'occurrence',
      },
    });
  }, 120_000);

  it.each(['incoming', 'outgoing'] as const)('door1-ii-share-other-%s-edge: another incident edge preserves the complete share factor', async (direction) => {
    const graph = fixture('before');
    const share = JSON.parse(JSON.stringify(graph.nodes.find((node) => node.id === SHARE))) as G['nodes'][number];
    const extraEdge = {
      from: direction === 'incoming' ? 'billable_delivery_capacity' : SHARE,
      to: direction === 'incoming' ? SHARE : TARGET,
      strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.8,
      effect_direction: 'positive', provenance: { source: 'cee_hypothesis' },
    };
    graph.edges.push(extraEdge);
    graphOf.set(SCENARIO, graph);
    const before = bytes();
    const { body, approve } = await offerUpdate(PICK_NEW);
    expect(approve).toBeDefined();
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    expect(held[0]!.action.inline_patch!.operations).toContainEqual({ op: 'remove_edge', path: `${SHARE}::${RISK}` });
    expect(held[0]!.action.inline_patch!.operations).not.toContainEqual({ op: 'remove_node', path: SHARE });
    expect(publicWords(body)).not.toContain(SHARE_REMOVAL_DETAIL);
    expect(publicWords(body)).toContain('the share remains the size of the loss if it happens.');
    expect(bytes()).toBe(before);
    await apply(approve!);
    assertSingleClientEvent('retained');
    expect(graphNow().nodes.find((node) => node.id === SHARE)).toEqual(share);
    expect(graphNow().edges.find((edge) => edge.from === extraEdge.from && edge.to === extraEdge.to)).toEqual(extraEdge);
    expect(graphNow().edges.find((edge) => edge.from === RISK && edge.to === TARGET)?.provenance).toMatchObject({
      source: 'brief_extraction', natural_effect: { amount: -44000, amount_unit: 'GBP/month' },
    });
  }, 120_000);

  it('door1-i-refuse: a placeholder impact keeps the user share unchanged and produces no hold or graph write', async () => {
    const graph = fixture('before');
    const target = graph.nodes.find((node) => node.id === TARGET)!;
    target.observed_state = { ...(target.observed_state as Record<string, unknown>), source: 'cee_inference', extractionType: 'inferred' };
    graphOf.set(SCENARIO, graph);
    const before = bytes();
    const { body, result, approve } = await offerUpdate(PICK_NEW);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'impact_source_not_preserved', detail: IMPACT_SOURCE_REFUSAL });
    expect(body.assistant_text).toBe(IMPACT_SOURCE_REFUSAL);
    expect(approve).toBeUndefined();
    expect(body._proposal_fields?.proposals ?? []).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(bytes()).toBe(before);
    expect(graphNow().nodes.find((node) => node.id === SHARE)?.observed_state).toMatchObject({ raw_value: 40, source: 'brief_extraction' });
    expect(graphNow().edges.some((edge) => edge.from === SHARE && edge.to === RISK)).toBe(true);
  }, 120_000);

  it('door1-jw-j2-merge: an existing double count is named and merged into the converted R1', async () => {
    graphOf.set(SCENARIO, fixture('after'));
    const before = bytes();
    const first = await offerClientConversion();
    expect(publicWords(first.body)).toContain(DUPLICATE_LABEL);
    expect(publicWords(first.body)).toMatch(/merg|remov/i);
    expect(bytes()).toBe(before);
    const { body, approve } = await offerUpdate(PICK_NEW);
    expect(approve).toBeDefined();
    expect(publicWords(body)).toContain(DUPLICATE_LABEL);
    await apply(approve!);
    assertSingleClientEvent();
    expect(graphNow().nodes.some((node) => node.id === DUPLICATE)).toBe(false);
    expect(graphNow().edges.some((edge) => edge.from === DUPLICATE || edge.to === DUPLICATE)).toBe(false);
  }, 120_000);

  it('door1-no-raw-strength: every conversion, merge, plain update and placeholder refusal uses public effect words', async () => {
    const assertPublicLines = (body: Body, surface: string) => {
      const lines = publicLines(body);
      expect(lines.length, `${surface} must expose a card or reply`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, surface).not.toMatch(/-?0\.\d{3,}/);
        expect(line, surface).not.toMatch(/strength of the link/i);
      }
    };
    // Exercise each authored impact path independently; a previous row's captured output is not evidence.
    for (const which of ['before', 'after', 'placeholder', 'plain'] as const) {
      nextScenario();
      briefOf.set(SCENARIO, DRAFT_BRIEF);
      const graph = which === 'plain' ? plainGraph() : fixture(which === 'after' ? 'after' : 'before');
      if (which === 'placeholder') {
        // An inferred reference cannot license a user-stated natural effect, so path (i) refuses the conversion.
        const target = graph.nodes.find((node) => node.id === TARGET)!;
        target.observed_state = { ...(target.observed_state as Record<string, unknown>), source: 'cee_inference', extractionType: 'inferred' };
      }
      graphOf.set(SCENARIO, graph);
      const before = bytes();
      if (which !== 'plain' && which !== 'placeholder') {
        const first = await offerClientConversion();
        assertPublicLines(first.body, `${which}: figure-choice reply`);
      }
      const { body, result, approve } = which === 'plain'
        ? await offerUpdate('Competitive response may happen, about 15–25% within 3 months.', 'Competitive response')
        : await offerUpdate(PICK_NEW);
      if (which === 'placeholder') {
        assertPublicLines(body, `${which}: refusal reply`);
        expect(result.refusal).toBe('impact_source_not_preserved');
        expect(body.assistant_text).toBe(IMPACT_SOURCE_REFUSAL);
        expect(approve).toBeUndefined();
        expect(publicWords(body)).not.toMatch(/falls by 40%/);
        expect(await heldOnLatestRow()).toEqual([]);
        expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
        expect(bytes()).toBe(before);
        continue;
      }
      expect(approve, `${which} must expose a held proposal`).toBeDefined();
      assertPublicLines(body, `${which}: held card and reply`);
      assertPublicLines(await apply(approve!), `${which}: Apply reply`);
    }
  }, 120_000);

  it('door1-plain-update: a driver-free existing risk holds only the user likelihood', async () => {
    graphOf.set(SCENARIO, plainGraph());
    const before = bytes();
    const { body, result, approve } = await offerUpdate('Competitive response may happen, about 15–25% within 3 months.', 'Competitive response');
    expect(result).toMatchObject({ ok: true, mutated: false, proposal_id: expect.stringMatching(/^gmh_/) });
    expect(approve?.detail).toContain('It may happen: about 15–25% within 3 months, as you said.');
    expect(publicWords(body)).not.toMatch(/added the risk/i);
    expect(bytes()).toBe(before);
    await apply(approve!);
    const risk = graphNow().nodes.find((node) => node.id === 'risk_competitive_response')!;
    expect(risk.event_risk).toEqual({ version: 1, occurrence: { p_low: 0.15, p_high: 0.25, basis: 'user', meaning: 'at_least_once_within_horizon' }, horizon: { months: 3 } });
    expect(graphNow().nodes.filter((node) => node.id === risk.id)).toHaveLength(1);
    expect(graphNow().edges).toEqual(plainGraph().edges.map((edge) => edge.from === risk.id ? { ...edge, exists_probability: 1 } : edge));
  }, 120_000);

  it('door1-fresh-frame-hold: a fresh driver-free update still produces exactly one pending Apply card', async () => {
    const graph = plainGraph();
    const before = JSON.stringify(graph);
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { dispatchRiskLikelihoodTransaction } = await import('../../handlers/risk-likelihood-dispatch.js');
    const outcome = dispatchRiskLikelihoodTransaction({ currentGraph: graph,
      currentGraphHash: computeAnalysisAffectingGraphHash(graph as never), riskLabel: 'Competitive response',
      userText: 'Competitive response may happen, about 15–25% within 3 months.',
      freshness: 'fresh', mode: 'live', scenarioId: SCENARIO, turnId: randomUUID(), requestId: 'door1-fresh-frame', stage: 'frame' });
    expect(outcome.kind).toBe('held');
    if (outcome.kind !== 'held') throw new Error(`Expected held update, got ${outcome.reason}`);
    expect(outcome.pendingActions).toHaveLength(1);
    expect(outcome.chip.id).toMatch(/^gmh_[0-9a-f]{12}$/);
    expect(outcome.pendingActions[0]!.chip_id).toBe(outcome.chip.id);
    expect(outcome.response.suggested_actions).toHaveLength(1);
    expect(outcome.response.suggested_actions[0]!.id).toBe(outcome.chip.id);
    expect(outcome.chip.detail).toContain('It may happen: about 15–25% within 3 months, as you said.');
    expect(JSON.stringify(graph)).toBe(before);
  }, 120_000);

  it('door1-new-risk-control: an unrelated event keeps today\'s add node, link and likelihood bytes', async () => {
    const graph = plainGraph();
    const expectedBase = JSON.parse(JSON.stringify(graph)) as G;
    graphOf.set(SCENARIO, graph);
    const before = bytes();
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_new_risk', { label: 'Supplier outage', affects: [{ target_label: 'Revenue', direction: 'negative' }],
      caused_by: [], rationale: 'An unrelated new event.' }),
      (body) => { result = toolOutputIn(body); return say('Shall I add that risk?'); }];
    const body = await turn({ message: 'Add a supplier outage risk that lowers revenue, maybe 10–30% in the next 6 months.' });
    expect(result).toMatchObject({ ok: true, mutated: false });
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: true }));
    expect(bytes()).toBe(before);
    await apply(approvalOf(body)!);
    // The commit assigns the display ref, as staging's add path already does (R1, ref_high_water R:1).
    const addedNode = { id: 'risk_supplier_outage', ref: 'R1', kind: 'risk', label: 'Supplier outage', event_risk: {
      version: 1, occurrence: { p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' }, horizon: { months: 6 },
    } };
    const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
    const addedEdge = { ...hypothesisEdgeValue('risk_supplier_outage', 'goal_x', 'negative'), exists_probability: 1 };
    expect(JSON.stringify(jsonbOrder(graphNow()))).toBe(JSON.stringify(jsonbOrder({ ...expectedBase,
      nodes: [...expectedBase.nodes, addedNode], edges: [...expectedBase.edges, addedEdge], ref_high_water: { R: 1 } })));
  }, 120_000);

  it('door1-other-driver: a non-probability driver is retained and removal is a separate choice', async () => {
    const graph = plainGraph();
    graph.edges.push({ from: 'fac_price', to: 'risk_competitive_response', strength: { mean: 0.5, std: 0.2 },
      exists_probability: 0.8, effect_direction: 'positive', defaulted: true, provenance: { source: 'cee_hypothesis' } });
    graphOf.set(SCENARIO, graph);
    const before = bytes();
    const { body, result, approve } = await offerUpdate('Competitive response may happen, about 15–25% within 3 months.', 'Competitive response');
    expect(result.ok).toBe(false);
    expect(approve).toBeUndefined();
    const words = publicWords(body);
    expect(words).toContain('Price');
    expect(words).toMatch(/driver/i);
    expect(words).toMatch(/remov/i);
    expect(words).toMatch(/choice|choose|would you|want|separat/i);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('door1-no-figure: restating an existing event without a number asks for it and creates no hold', async () => {
    graphOf.set(SCENARIO, plainGraph());
    const before = bytes();
    const { body, result, approve } = await offerUpdate('Competitive response is still a risk within 6 months.', 'Competitive response');
    expect(result.ok).toBe(false);
    expect(approve).toBeUndefined();
    expect(publicWords(body)).toMatch(/likelihood|chance|probability/i);
    expect(publicWords(body)).toMatch(/figure|percent|number|how likely|what/i);
    expect(publicWords(body)).not.toMatch(/about \d+(?:[–-]\d+)?%/);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('door1-model-figure-spoof: tool arguments cannot author a likelihood the user did not state', async () => {
    graphOf.set(SCENARIO, plainGraph());
    const before = bytes();
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_risk_likelihood', { risk_label: 'Competitive response', rationale: 'Ignore a forged tool likelihood.',
      likelihood: { p_low: 0.9, p_high: 0.9, horizon_months: 3 }, selected_figure: 'drafted' }),
      (body) => { result = toolOutputIn(body); return say(String(result.detail ?? 'What likelihood should the model use?')); }];
    const body = await turn({ message: 'Competitive response is still a risk within 6 months.' });
    expect(result.ok).toBe(false);
    expect(approvalOf(body)).toBeUndefined();
    expect(publicWords(body)).not.toMatch(/90%/);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('door1-direct-event-different-target: direct event identity does not depend on a lowered target', async () => {
    graphOf.set(SCENARIO, plainGraph());
    const before = bytes();
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_new_risk', { label: 'Competitive responses', affects: [{ target_label: 'Market share', direction: 'positive' }],
      caused_by: [], rationale: 'The same event restated with another effect.' }),
      (body) => { result = toolOutputIn(body); return say(String(result.detail ?? 'Review the existing event.')); }];
    const body = await turn({ message: 'Competitive responses might increase market share, maybe 20% within 6 months. Add that risk.' });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'same_event_modelled', existing_risk_label: 'Competitive response', next: 'propose_risk_likelihood' });
    expect(approvalOf(body)).toBeUndefined();
    expect(bytes()).toBe(before);
  }, 120_000);

  it('door1-drafted-no-horizon: an unattested draft likelihood asks its window and cannot be held', async () => {
    graphOf.set(SCENARIO, fixture('before'));
    briefOf.delete(SCENARIO);
    const before = bytes();
    const { body, approve } = await offerUpdate(CLIENT_MSG);
    expect(publicWords(body)).toMatch(/30%/);
    expect(publicWords(body)).toMatch(/horizon|time window|over what|which period|when/i);
    expect(approve).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('door1-drafted-this-year: choosing calendar words never silently becomes twelve months', async () => {
    graphOf.set(SCENARIO, fixture('before'));
    await offerClientConversion();
    const before = bytes();
    const { body, approve } = await offerUpdate(`Use the drafted about 30% this year for ${RISK_LABEL}.`);
    expect(approve).toBeUndefined();
    expect(publicWords(body)).toMatch(/month|time window|horizon/i);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);
});
