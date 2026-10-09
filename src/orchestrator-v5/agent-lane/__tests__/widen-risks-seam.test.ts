/**
 * ⭐ S-C MODEL WIDENING, target risks, on the LIVE route end to end (DL 0fd71f 7 Oct, lane WIDEN; Paul's prod test D-11):
 *   "Suggest risks" press → ONE tool-less model call → the identity gate → a deterministic reply (method, what each hits,
 *   one gap question) + one Add per item + Something else, NOTHING stored → Add → NO model call → the existing add-risk
 *   door holds ONE card → the existing approve → the risk is in the model with its validated links (RC3: timing and
 *   dependency risks stay on the canvas, stamped to one option, with zero links and left out of the Run).
 * The model is Paul's served v1 (scenario 6582edbc, CEE 7e3f8fb2), reconstructed from its run fact; the risk names are the
 * ones served as prose on turn #2 ("None has been added", no Add buttons).
 *
 * HARNESS: copied from `widen-turn-seam.test.ts` (itself from `agent-add-option-held-seam.test.ts`): the REAL route-v2 and
 * the REAL Agent route in one app, a stateful store with production read semantics, OpenAI scripted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asSent } from './helpers/as-sent.js';
import { readFileSync } from 'node:fs';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { sentenceMultiset, type ReplyComposeInput } from '../reply/compose-reply.js';

let lastComposeInput: ReplyComposeInput | undefined;
vi.mock('../reply/compose-reply.js', async (original) => {
  const actual = await original<typeof import('../reply/compose-reply.js')>();
  return { ...actual, composeReplyShape: (input: ReplyComposeInput) => {
    lastComposeInput = structuredClone(input);
    return actual.composeReplyShape(input);
  } };
});

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; response_emitted: boolean; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** The latest ANSWER row for a scenario — claim rows excluded, exactly as the production read excludes them. */
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/** What a Postgres `jsonb` column gives back: keys shorter-first then bytewise, `undefined` dropped. */
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
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; response_emitted?: boolean; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      vi.setSystemTime(Date.now() + 1);
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        response_emitted: w.response_emitted ?? true,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        // Stored with the turn, as `append_turn_atomic` does, so a writer's own read-back of its fact is served.
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date().toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string, limit = 20) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim')).slice(0, limit)),
  readFactsFor: vi.fn(async () => []),
  // The production shape (`supabase-store.ts` readFactsWithTurnFor): each stored fact with the id of the turn row it rode on.
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
/** route-v2's LLM router: the typed add-option and its confirm are deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the typed add-option seam (${what})`); };
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
type Body = { assistant_text: string; _answer_shape?: AnswerShape; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _provider_calls?: { provider: string; outcome?: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string; conflict_fields?: string[]; rejected_levels?: Record<string, unknown>[] }[] } };

/** Scripted OpenAI: each Agent model call takes the next reply; anything that is not OpenAI throws. */
let script: ((body: Record<string, unknown>) => unknown)[] = [];
/** The construction response goes through the real builder, without spending a scripted conversation reply. */
let constructionCandidate: Record<string, unknown> | undefined;
/** #2854 draft-time widening: when set, the served route's widening request is answered from the graph it was sent. */
let wideningAnswer: ((graph: { nodes: { id: string; kind: string; label: string }[] }) => unknown) | undefined;
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The inner requests the Agent sent to route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the confirm). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
/** Runs as route-v2's answer to an inner request is sent — AFTER it has decided. */
let onInnerSent: ((body: Record<string, unknown>) => void) | undefined;
/** Extra keys on the graph read (an analysis state), per row. */
let extraRead: Record<string, unknown> = {};

describe('S-C WIDEN risks on the live route: suggestions, then ONE card per Add', () => {
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { computeGraphIdentityHash } = await import('../../context/graph-identity.js');
    const { registrationTurnId, registrationRequestHash } = await import('../../graph-registration/registration-identity.js');
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') { inner.push(req.body as Record<string, unknown>); onInner?.(req.body as Record<string, unknown>); } });
    a.addHook('onSend', async (req, _reply, payload) => { if (req.url === '/orchestrate/v2/turn') onInnerSent?.(req.body as Record<string, unknown>); return payload; });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        graph_identity_hash: g === null ? null : computeGraphIdentityHash(g as never), ...extraRead };
    });
    a.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      const sid = (req.params as { id: string }).id;
      const body = req.body as { graph: unknown; brief_text?: string; operation_id?: string };
      const g = jsonbOrder(JSON.parse(JSON.stringify(body.graph)));
      // The production registration leaves a committed, non-public row as the first construction's stored marker.
      await store.append({ scenario_id: sid, turn_id: registrationTurnId(sid, body.operation_id),
        request_hash: registrationRequestHash(g, body.brief_text), response_emitted: false,
        turn_class: 'direct_answer', handler_id: null, graph: g });
      return { registered: true, graph_hash: computeAnalysisAffectingGraphHash(g as never) };
    });
    a.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error(`non-OpenAI network call: ${String(url)}`);
      openAiCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      // Both widening passes open with widen-draft's DRAFT_WIDENING_PREAMBLE (not imported: it reorders this file's mocks).
      if (wideningAnswer !== undefined && String(body['instructions'] ?? '').startsWith("This is Olumi's own check of a first draft;")) {
        const sent = JSON.parse(String(body['input'])) as { graph: { nodes: { id: string; kind: string; label: string }[] } };
        return new Response(JSON.stringify(say(JSON.stringify(wideningAnswer(sent.graph)))), { status: 200 });
      }
      if (constructionCandidate !== undefined
        && (body['text'] as { format?: { type?: string } } | undefined)?.format?.type === 'json_schema') {
        return new Response(JSON.stringify(say(JSON.stringify(constructionCandidate))), { status: 200 });
      }
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next(body) : say('Done.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { vi.setSystemTime(Date.UTC(2026, 9, 8, 12)); nextScenario(); script = []; constructionCandidate = undefined; wideningAnswer = undefined; openAiCalls = 0; inner = []; onInner = undefined; onInnerSent = undefined; routerCalls.length = 0; extraRead = {}; lastComposeInput = undefined; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    // Issuance allows 2 seconds of clock skew; separate public turns so the preceding answer cannot be the issuer.
    vi.setSystemTime(Date.now() + 3000);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: { id: string; kind: string; label: string; proposed_by?: string;
    analysis_participation?: string; interventions?: Record<string, unknown> }[]; edges: { from: string; to: string }[] };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  /** The hold the Agent's LATEST answer row carries — what the next turn (and route-v2's confirm) will read. */
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; expires_at_turn_count: number; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string; value?: unknown }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };


  const RISKS = { id: 'agent-next-suggest-risks', message: "Suggest risks I haven't considered." };
  const THIN_BUTTON = 'Suggest up to 3 more risks, including one against ‘Raise to £59’';
  const CONSTRUCTION_BRIEF = 'Raise Pro £49 → £59 to reach £20,000 Total MRR within 12 months. One risk is customer churn.';
  /** A real constructor candidate: one user-proposed option, a declared baseline, and unquantified risks. */
  const thinConstruction = async (riskCount: number, prepare?: () => void, brief = CONSTRUCTION_BRIEF, expectRisks = riskCount) => {
    constructionCandidate = {
      goal: { kind: null, deliverable: null, metric: 'Total MRR', operator: '>=', target_stated: true, value: 20000,
        unit: 'GBP', horizon_months: 12, provenance: 'explicit', frame: 'level', baseline_known: false,
        baseline_value: null, baseline_provenance: 'inferred', scope: null },
      constraints: [],
      options: [
        { label: 'Raise to £59', provenance: 'explicit', changes: ['Pro plan price'], interventions: [], is_status_quo: null, added_capacity: null },
        { label: 'Keep £49', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true, added_capacity: null },
      ],
      factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 }],
      risks: ['Customer churn', 'Competitor discount', 'Slower acquisition'].slice(0, riskCount).map((label) => ({ label, provenance: 'inferred', unit: null, plausible_max: null })),
      outcomes: [],
      links: [{ from: 'Pro plan price', to: 'Total MRR', direction: 'positive', provenance: 'inferred',
        effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null }],
      identities: [], unknowns: [], decision_question: null,
    };
    script = [() => fnCall('build_model_from_brief', { brief }), () => say('Here is the model to explore together.')];
    prepare?.();
    const t = await turn({ message: brief });
    expect(t._agent.tool_calls, JSON.stringify(t)).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true, mutated: true }));
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(expectRisks);
    expect(graphNow().nodes.find((node) => node.label === 'Raise to £59')).toMatchObject({ kind: 'option', provenance: 'from_brief' });
    return t;
  };

  /** R1's real first-draft identity card, reused by the identity-answer rows below. */
  const thinIdentityConstruction = async (riskCount: number, prepare?: () => void) => {
    const t = await thinConstruction(riskCount, () => {
      const candidate = constructionCandidate!;
      (candidate.factors as Record<string, unknown>[])[0]!.unit = 'GBP/month';
      // #2851 RE-PIN (class: Olumi's inferred 250, now a missing level so no card): these rows test the risk offers beside
      // a pending identity card, so the brief states the count and the card is offered on the user's figure.
      (candidate.factors as Record<string, unknown>[]).push({ label: 'Paying subscribers', role: 'observable',
        baseline_known: true, baseline_value: 250, unit: 'subscribers', provenance: 'explicit', plausible_max: 1000 });
      (candidate.links as Record<string, unknown>[]).push({ from: 'Paying subscribers', to: 'Total MRR', direction: 'positive', provenance: 'inferred',
        effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null });
      // Churn threatens the subscriber count. Give every risk its own real path, so the constructor does not repair
      // an unconnected risk straight into the goal and change the product's two direct parents.
      for (const risk of candidate.risks as { label: string }[]) {
        (candidate.links as Record<string, unknown>[]).push({ from: risk.label, to: 'Paying subscribers', direction: 'negative', provenance: 'inferred',
          effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null });
      }
      candidate.identities = [{ outcome: 'Total MRR', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'ai_proposed' }];
      script.splice(1, 1, () => fnCall('propose_identity', {}), () => say('Here is the model to explore together.'));
      prepare?.();
    }, `${CONSTRUCTION_BRIEF} We have 250 paying subscribers.`);
    const identity = t._agent.tool_calls.find((c) => c.name === 'propose_identity');
    expect(identity, `identity fixture setup: ${JSON.stringify(t)}`).toMatchObject({ ok: true, mutated: false });
    expect(t.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:')), JSON.stringify(t.suggested_actions)).toHaveLength(1);
    expect(approveChipOf(t)!.id).toBe(`agent-approve-proposal:${identity!.proposal_id}`);
    return t;
  };
  const pressCard = (chip: Chip) => turn({ message: chip.message, source: 'chip', chip: { id: chip.id } });
  const expectThinPress = (t: Body) => {
    const runIndex = t.suggested_actions.findIndex((c) => c.id === 'agent-run-analysis');
    expect(runIndex, JSON.stringify(t.suggested_actions)).toBeLessThanOrEqual(0);
    expect(t.suggested_actions[runIndex === 0 ? 1 : 0], JSON.stringify(t)).toEqual({ id: RISKS.id, label: THIN_BUTTON, message: RISKS.message });
    expect(t.suggested_actions.filter((c) => c.id === RISKS.id)).toHaveLength(1);
    expect(t.suggested_actions.length).toBeLessThanOrEqual(3);
  };
  const expectNoThinPress = (t: Body) =>
    expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(t)).toBe(false);
  /** A real proposing tool called AFTER the builder, on the same public construction answer. */
  const thinConfirmConstruction = async (name: string, args: Record<string, unknown>, brief = CONSTRUCTION_BRIEF, prepare?: () => void) => {
    const t = await thinConstruction(1, () => {
      script.splice(1, 1, () => fnCall(name, args), () => say('Here is the model to explore together.'));
      prepare?.();
    }, brief);
    const proposal = t._agent.tool_calls.find(c => c.name === name);
    expect(proposal, `construction confirm fixture: ${JSON.stringify(t)}`).toMatchObject({ ok: true, mutated: false });
    expect(proposal!.proposal_id).toBeTypeOf('string');
    expect(approveChipOf(t)?.id, JSON.stringify(t)).toBe(`agent-approve-proposal:${proposal!.proposal_id}`);
    expectNoThinPress(t);
    return t;
  };
  const heldAgentProposal = async (id: string) => {
    const { agentProposalOf } = await import('../proposal-object/record.js');
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return (await store.readMostRecentPendingActions(SCENARIO)).flatMap(raw => {
      const pa = parsePendingAction(raw);
      const proposal = pa === null ? undefined : agentProposalOf(pa);
      return proposal?.proposal_id === id ? [proposal] : [];
    })[0];
  };
  /** Count only the offer block's reads, including a nested resolver's second read, not unrelated route history. */
  const constructionOfferReads = async (resolve: () => Promise<Body>) => {
    const routeLines = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8').split('\n');
    const blockStart = routeLines.findIndex(line => line.includes('const constructionConfirmResolved = await')) + 1;
    const blockEnd = routeLines.findIndex((line, index) => index >= blockStart && line.includes('const thin = thinDraftOffer')) + 1;
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const readRecent = store.readRecent.getMockImplementation()!;
    const attributed: string[] = [];
    const read = vi.spyOn(store, 'readRecent').mockImplementation(async (sid, limit = 20) => {
      const stack = new Error().stack ?? '';
      if ([...stack.matchAll(/agent-v1-turn\.ts:(\d+):\d+/gu)]
        .some(match => Number(match[1]) >= blockStart && Number(match[1]) < blockEnd)) attributed.push(stack);
      return readRecent(sid, limit);
    });
    try {
      const response = await resolve();
      return { response, reads: attributed.length, stacks: attributed };
    } finally {
      read.mockRestore();
    }
  };

  it('P05b-8a: construction with one risk puts the relabelled risks press first and conserves the base sentence multiset', async () => {
    const t = await thinConstruction(1);
    expect(t.suggested_actions[0], JSON.stringify(t)).toEqual({ id: RISKS.id, label: THIN_BUTTON, message: RISKS.message });
    expect(t.suggested_actions.filter((c) => c.id === RISKS.id)).toHaveLength(1);
    expect(t.suggested_actions.length).toBeLessThanOrEqual(3);
    // The live pre-composition base supplies the sentence identities; shaping may move them but loses/adds none.
    expect(lastComposeInput?.faceContract).toBe('draft');
    expect(lastComposeInput?.text).toBeDefined();
    expect(sentenceMultiset(t.assistant_text)).toEqual(sentenceMultiset(lastComposeInput!.text));
    expect(t._answer_shape).toBeDefined();
    expect(t.assistant_text).toBe(deriveAnswerTextFromShape(t._answer_shape!));
  }, 120_000);

  it('R1 first-draft construction with a pending identity approval keeps exactly the offers without thin, including approve and decline', async () => {
    const nextSteps = await import('../next-steps-from-guidance.js');
    const { AMEND_CHIP } = await import('../approval-chips.js');
    const selectOffers = nextSteps.nextStepOffersForTurn;
    let withoutThin: Chip[] = [];
    const selection = vi.spyOn(nextSteps, 'nextStepOffersForTurn').mockImplementation((...args) => {
      const result = selectOffers(...args);
      // Snapshot this turn's offers before the route can inject/relabel the thin press.
      withoutThin = structuredClone(result.offered);
      return result;
    });
    try {
      expect(graphOf.has(SCENARIO)).toBe(false);
      const t = await thinIdentityConstruction(0);
      const { thinDraftOffer } = await import('../method-turn/widen-turn.js');
      expect(thinDraftOffer(graphNow(), true)?.button).toBe(THIN_BUTTON);
      const identity = t._agent.tool_calls.find((c) => c.name === 'propose_identity');
      expect(identity, JSON.stringify(t)).toMatchObject({ ok: true, mutated: false });
      expect(identity!.proposal_id).toBeTypeOf('string');
      const approveId = `agent-approve-proposal:${identity!.proposal_id}`;
      const decline = { id: `agent-decline-proposal:${identity!.proposal_id}`, label: 'Not now', message: 'Not now.' };
      const words = 'Olumi reads ‘Total MRR’ as ‘Pro plan price’ × ‘Paying subscribers’. Is that how you work it out?';
      expect(withoutThin).toEqual([
        { id: approveId, label: "Yes, that's how", message: `Yes — ${words}`, detail: words },
        AMEND_CHIP,
      ]);
      // The unchanged downstream route inserts this approval's decline after Change something first.
      expect(t.suggested_actions, JSON.stringify(t)).toEqual([...withoutThin, decline]);
      expect(t.suggested_actions.find((c) => c.id === approveId)).toEqual(withoutThin[0]);
      expect(t.suggested_actions.find((c) => c.id === decline.id)).toEqual(decline);
      expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON)).toBe(false);
    } finally {
      selection.mockRestore();
    }
  }, 120_000);

  it('r5-identity / r4a: Paul\'s B1 construction with a pending identity and one risk offers the exact thin press after Yes', async () => {
    const construction = await thinIdentityConstruction(1);
    const identity = construction._agent.tool_calls.find((c) => c.name === 'propose_identity');
    expect(identity, JSON.stringify(construction)).toMatchObject({ ok: true, mutated: false });
    expect(construction.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON)).toBe(false);
    const approve = approveChipOf(construction)!;
    expect(approve.id).toBe(`agent-approve-proposal:${identity!.proposal_id}`);
    const t = await pressCard(approve);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: identity!.proposal_id }));
    expect(t._diagnostic_trace.fast_path).toBe('approve');
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(1);
    expectThinPress(t);
  }, 120_000);

  it('r4a Run placement: a naturally runnable thin identity-answer keeps Run first and the thin press second', async () => {
    const construction = await thinIdentityConstruction(0, () => {
      const option = (constructionCandidate!.options as Record<string, unknown>[])[0]!;
      option.interventions = [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' }];
    });
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(t.suggested_actions[0]?.id, JSON.stringify(t)).toBe('agent-run-analysis');
    expectThinPress(t);
  }, 120_000);

  it('r4b RED: Not now on the real B1 identity card offers the exact thin press without another confirm', async () => {
    const construction = await thinIdentityConstruction(1);
    const identity = construction._agent.tool_calls.find((c) => c.name === 'propose_identity')!;
    const decline = construction.suggested_actions.find((c) => c.id === `agent-decline-proposal:${identity.proposal_id}`)!;
    expect(decline).toEqual({ id: `agent-decline-proposal:${identity.proposal_id}`, label: 'Not now', message: 'Not now.' });
    const t = await pressCard(decline);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'withdraw_proposal', ok: true, mutated: false, proposal_id: identity.proposal_id }));
    expect(t.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), JSON.stringify(t)).toBe(false);
    expectThinPress(t);
  }, 120_000);

  it('r4c CONTRAST: an ordinary chat turn after the identity Yes offers no relabelled thin press', async () => {
    const construction = await thinIdentityConstruction(1);
    const answered = await pressCard(approveChipOf(construction)!);
    expect(answered._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    script = [() => say('We can explore this model together.')];
    const t = await turn({ message: 'What do you think about the pricing options?' });
    expect(t._agent.tool_calls).toEqual([]);
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(1);
    expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(t)).toBe(false);
  }, 120_000);

  it('r4c repeated-Yes CONTRAST: a settled identity card cannot offer the relabelled thin press twice', async () => {
    const construction = await thinIdentityConstruction(1);
    const approve = approveChipOf(construction)!;
    const first = await pressCard(approve);
    expect(first._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const repeated = await pressCard(approve);
    expect(repeated._agent.tool_calls.some((c) => c.name === 'authorise_change' && c.mutated === true)).toBe(false);
    expect(repeated.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(repeated)).toBe(false);
  }, 120_000);

  it('r4d CONTRAST and producer mutant: Yes on a non-identity link approval on a one-risk graph offers no relabelled thin press', async () => {
    await thinConstruction(1);
    script = [() => fnCall('propose_model_change', { from_label: 'Customer churn', to_label: 'Pro plan price', direction: 'negative', strength: 'strong' }),
      () => say('I can connect Customer churn to Pro plan price as your strong negative influence. Shall I?')];
    const proposed = await turn({ message: 'Connect Customer churn to Pro plan price with a strong negative influence.' });
    const link = proposed._agent.tool_calls.find((c) => c.name === 'propose_model_change');
    expect(link, JSON.stringify(proposed)).toMatchObject({ ok: true, mutated: false });
    const t = await pressCard(approveChipOf(proposed)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: link!.proposal_id }));
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(1);
    const { thinDraftOffer } = await import('../method-turn/widen-turn.js');
    expect(thinDraftOffer(graphNow(), true)?.button).toBe(THIN_BUTTON);
    expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(t)).toBe(false);
  }, 120_000);

  it('r4e CONTRAST: Yes on an identity card when the graph has three risks offers no relabelled thin press', async () => {
    const construction = await thinIdentityConstruction(3);
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(3);
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(3);
    expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(t)).toBe(false);
  }, 120_000);

  it('r4f unchanged diagnostic: construction with only an untyped goal-scope pending question already offers the thin press', async () => {
    const t = await thinConstruction(1, () => {
      const candidate = constructionCandidate!;
      const goal = candidate.goal as Record<string, unknown>;
      goal.metric = 'Non-Pro MRR';
      goal.scope = { modelled: 'the Pro plan only', alternative: 'all plans together', stated_in_brief: false };
      (candidate.links as Record<string, unknown>[])[0]!.to = 'Non-Pro MRR';
    });
    const pending = await store.readMostRecentPendingActions(SCENARIO) as { chip_id: string; action: { kind: string; expected?: string; scope?: unknown } }[];
    expect(pending, JSON.stringify(pending)).toHaveLength(1);
    expect(pending[0]).toMatchObject({ chip_id: 'goal-scope:non_pro_mrr', action: { kind: 'reconcile_goal_scope', expected: 'scope' } });
    expect(pending[0]!.action.scope).toBeUndefined();
    expect(t.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
    expectThinPress(t);
  }, 120_000);

  it('r5-deadline RED: the construction turn\'s set_goal_deadline card offers the thin press after Yes', async () => {
    const construction = await thinConfirmConstruction('propose_goal_deadline', { deadline_words: '12 months', rationale: 'The user stated this deadline.' });
    const proposalId = construction._agent.tool_calls.find(c => c.name === 'propose_goal_deadline')!.proposal_id!;
    expect((await heldAgentProposal(proposalId))?.operations).toEqual([
      expect.objectContaining({ op: 'set_goal_deadline', path: 'total_mrr' }),
    ]);
    expect(approveChipOf(construction)?.message).toBe('Yes, that is my deadline.');
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: proposalId }));
    expect(t._diagnostic_trace.fast_path).toBe('approve');
    expectThinPress(t);
  }, 120_000);

  it('r5-deadline declined: Not now on the construction deadline card resolves the held confirm and offers thin', async () => {
    const construction = await thinConfirmConstruction('propose_goal_deadline', { deadline_words: '12 months', rationale: 'The user stated this deadline.' });
    const proposalId = construction._agent.tool_calls.find(c => c.name === 'propose_goal_deadline')!.proposal_id!;
    const decline = construction.suggested_actions.find(c => c.id === `agent-decline-proposal:${proposalId}`)!;
    const t = await pressCard(decline);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'withdraw_proposal', ok: true, mutated: false, proposal_id: proposalId }));
    expect(t.suggested_actions.some(c => c.id.startsWith('agent-approve-proposal:')), JSON.stringify(t)).toBe(false);
    expectThinPress(t);
  }, 120_000);

  it('r5-target RED: the construction turn\'s set_goal_target card offers the thin press after Yes', async () => {
    const construction = await thinConfirmConstruction('propose_goal_target', { constraint_type: 'at_least', value: 20000, unit: 'GBP', rationale: 'The user stated this target.' }, CONSTRUCTION_BRIEF, () => {
      // The card owns this first target. Restating a target already stored on the node is a writer no-op without a row.
      const goal = constructionCandidate!.goal as Record<string, unknown>;
      goal.target_stated = false;
      goal.value = null;
    });
    const proposalId = construction._agent.tool_calls.find(c => c.name === 'propose_goal_target')!.proposal_id!;
    expect((await heldAgentProposal(proposalId))?.operations).toEqual([
      expect.objectContaining({ op: 'set_goal_target', path: 'total_mrr' }),
    ]);
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls, JSON.stringify(t)).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: proposalId }));
    expectThinPress(t);
  }, 120_000);

  it('r5-scope RED: a reachable typed goal-scope card issued by construction resolves through authorise_change and offers thin', async () => {
    const { composeAnalysisStateV1, NO_ANALYSIS_CONTEXT_DERIVATION } = await import('../../compose/analysis-state-v1.js');
    const { canonicalStateFromFreshness } = await import('../../context/canonical-analysis-state.js');
    // The real graph reader supplies canonical authority even before any Run. A missing mock authority removes scope cards.
    extraRead.analysis_state = composeAnalysisStateV1({ canonical: canonicalStateFromFreshness(NO_ANALYSIS_CONTEXT_DERIVATION), rawRobustness: null });
    const quote = 'Total MRR covers all plans together and is £10,000 today.';
    const scope = { modelled: 'all plans together', alternative: 'the Pro plan only', extent: 'total', stated_in_brief: true, source: { quote } };
    const construction = await thinConfirmConstruction('reconcile_goal_scope', {
      goal_label: 'Total MRR', scope, current_level: { value: 10000, unit: 'GBP', quote },
    }, `${CONSTRUCTION_BRIEF} ${quote}`);
    const proposalId = construction._agent.tool_calls.find(c => c.name === 'reconcile_goal_scope')!.proposal_id!;
    expect((await heldAgentProposal(proposalId))?.operations).toEqual([
      expect.objectContaining({ op: 'update_node', path: 'total_mrr', value: expect.objectContaining({ goal_scope: scope }) }),
    ]);
    // The constructor's untyped goal-scope:<goal> question (r4f) is not this proposal-backed approval door.
    expect(approveChipOf(construction)?.id).toBe(`agent-approve-proposal:${proposalId}`);
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls, JSON.stringify(t)).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: proposalId }));
    expect((await store.readMostRecentPendingActions(SCENARIO)).some(raw =>
      (raw as { action?: { kind?: string } }).action?.kind === 'reconcile_goal_scope')).toBe(false);
    expectThinPress(t);
  }, 120_000);

  it('r5-later CONTRAST and issuing-turn mutant: Yes on a deadline card issued after construction offers no thin press', async () => {
    await thinConstruction(1);
    script = [() => fnCall('propose_goal_deadline', { deadline_words: '6 months', rationale: 'The user changed their deadline.' }),
      () => say('Please confirm the new deadline.')];
    const proposed = await turn({ message: 'Set my deadline to 6 months.' });
    const proposal = proposed._agent.tool_calls.find(c => c.name === 'propose_goal_deadline');
    expect(proposal, JSON.stringify(proposed)).toMatchObject({ ok: true, mutated: false });
    const t = await pressCard(approveChipOf(proposed)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: proposal!.proposal_id }));
    expect(graphNow().nodes.filter(node => node.kind === 'risk')).toHaveLength(1);
    expectNoThinPress(t);
  }, 120_000);

  it('r6-deferred RED and first-user-turn mutant: chat A, construction deadline B, then Yes C offers thin', async () => {
    script = [() => say('Tell me about the strategic work you want to explore.')];
    const chat = await turn({ message: 'I would like to explore our pricing strategy.' });
    expect(chat._agent.tool_calls).toEqual([]);
    expect(graphOf.has(SCENARIO)).toBe(false);
    const construction = await thinConfirmConstruction('propose_goal_deadline', { deadline_words: '12 months', rationale: 'The user stated this deadline.' });
    const proposalId = construction._agent.tool_calls.find(c => c.name === 'propose_goal_deadline')!.proposal_id!;
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: proposalId }));
    expectThinPress(t);
  }, 120_000);

  it('r6-one-read RED and proposalIssuers mutant: a qualifying resolution adds exactly one offer history read', async () => {
    const construction = await thinConfirmConstruction('propose_goal_deadline', { deadline_words: '12 months', rationale: 'The user stated this deadline.' });
    const { response: t, reads, stacks } = await constructionOfferReads(() => pressCard(approveChipOf(construction)!));
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expectThinPress(t);
    expect(reads, stacks.join('\n\n')).toBe(1);
  }, 120_000);

  it('r6-nonthin RED: resolving a construction identity on a three-risk graph adds zero offer history reads', async () => {
    const construction = await thinIdentityConstruction(3);
    const { response: t, reads, stacks } = await constructionOfferReads(() => pressCard(approveChipOf(construction)!));
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphNow().nodes.filter(node => node.kind === 'risk')).toHaveLength(3);
    expectNoThinPress(t);
    expect(reads, stacks.join('\n\n')).toBe(0);
  }, 120_000);

  it('r6-expiry RED: a card live at turn start and approved before its hold expires still offers thin', async () => {
    const construction = await thinConfirmConstruction('propose_goal_deadline', { deadline_words: '12 months', rationale: 'The user stated this deadline.' });
    const approve = approveChipOf(construction)!;
    const proposalId = construction._agent.tool_calls.find(c => c.name === 'propose_goal_deadline')!.proposal_id!;
    const expiresAt = Date.now() + 4000;
    const hold = latestRow()!.pending_actions.find(raw => (raw as { chip_id?: string }).chip_id === approve.id) as { expires_at_iso: string } | undefined;
    expect(hold).toBeDefined();
    hold!.expires_at_iso = new Date(expiresAt).toISOString();
    expect(Date.now() + 3000, 'the resolving turn starts before the hold expires').toBeLessThan(expiresAt);
    const writers = await import('../../system-events/dispatch.js');
    const { authorisationTurnId } = await import('../runtime/agent-capabilities.js');
    const commit = writers.commitOptionLevelsInProcess;
    let crossedExpiry = false;
    const write = vi.spyOn(writers, 'commitOptionLevelsInProcess').mockImplementation(async (...args) => {
      const written = await commit(...args);
      if (args[0].turn_id === authorisationTurnId(`${proposalId}#deadline`)) {
        expect(written.status).toBe('committed');
        expect(Date.now(), 'the approval writer commits while the hold is live').toBeLessThan(expiresAt);
        vi.setSystemTime(expiresAt + 1);
        crossedExpiry = true;
      }
      return written;
    });
    try {
      const t = await pressCard(approve);
      expect(crossedExpiry).toBe(true);
      expect(Date.now()).toBeGreaterThan(expiresAt);
      expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: proposalId }));
      expectThinPress(t);
    } finally {
      write.mockRestore();
    }
  }, 120_000);

  it.each(['registration', 'public user message'] as const)('r5 fail closed: a missing construction %s marker offers no thin press after identity Yes', async (marker) => {
    const construction = await thinIdentityConstruction(1);
    const row = marker === 'registration'
      ? [...rows.values()].find(r => r.scenario_id === SCENARIO && r.request_hash.startsWith('graph_registration:'))
      : latestRow();
    expect(row).toBeDefined();
    if (marker === 'registration') row!.request_hash = 'sha256:unverified_registration';
    else row!.user_message = null;
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expectNoThinPress(t);
  }, 120_000);

  it('r5 import CONTRAST: a generic graph registration cannot attest build_model_from_brief before a first-chat confirm', async () => {
    const construction = await thinIdentityConstruction(1);
    const { registrationTurnId } = await import('../../graph-registration/registration-identity.js');
    const registration = [...rows.values()].find(r => r.scenario_id === SCENARIO && r.request_hash.startsWith('graph_registration:'));
    expect(registration).toBeDefined();
    // A UI import shares the committed registration shape, but has no construction operation identity.
    registration!.turn_id = registrationTurnId(SCENARIO);
    const t = await pressCard(approveChipOf(construction)!);
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expectNoThinPress(t);
  }, 120_000);

  it('r5 fail closed: an unreadable issuing/construction window offers no thin press after identity Not now', async () => {
    const construction = await thinIdentityConstruction(1);
    const decline = construction.suggested_actions.find(c => c.id.startsWith('agent-decline-proposal:'))!;
    const failedRead = vi.spyOn(store, 'readRecent').mockRejectedValue(new Error('construction history unavailable'));
    try {
      // Withdrawal resolves this held card without making the writer's separate confirmation read unavailable too.
      const t = await pressCard(decline);
      expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'withdraw_proposal', ok: true, mutated: false }));
      expectNoThinPress(t);
    } finally {
      failedRead.mockRestore();
    }
  }, 120_000);

  it('r5 fail closed: a full bounded window cannot attest the first construction answer', async () => {
    const construction = await thinIdentityConstruction(1);
    const readRecent = store.readRecent.getMockImplementation()!;
    const fullRead = vi.spyOn(store, 'readRecent').mockImplementation(async (sid, limit = 20) => {
      const recent = await readRecent(sid, limit);
      if (sid !== SCENARIO) return recent;
      // Keep the real construction and its live hold visible, while the raw cap cannot prove history exhaustion.
      return [...recent, ...Array.from({ length: Math.max(0, limit - recent.length) }, (_, i): Row => ({
        ...recent[0]!, id: `older-row-${i}`, turn_id: `older-internal-${i}`, request_hash: 'sha256:older-internal',
        response_emitted: false, user_message: null, assistant_message: null, pending_actions: [],
        created_at: new Date(Date.UTC(2026, 9, 7, 0, 0, i)).toISOString(),
      }))];
    });
    try {
      const t = await pressCard(approveChipOf(construction)!);
      expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
      expectNoThinPress(t);
    } finally {
      fullRead.mockRestore();
    }
  }, 120_000);

  it('P05b-8b CONTRAST: construction with three risks has no relabelled risks press', async () => {
    const t = await thinConstruction(3);
    expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(t)).toBe(false);
  }, 120_000);

  it('#2854 served-500 row: a construction turn whose draft is WIDENED (an Olumi risk with draft_widening and no relies_on) completes 200 through the real route and names it', async () => {
    const t = await thinConstruction(1, () => {
      wideningAnswer = (graph) => {
        const id = (kind: string, label: string) => graph.nodes.find((n) => n.kind === kind && n.label === label)!.id;
        return { risk_suggestions: [{ label: 'Feature release slips', category: 'timing', mechanism: 'relies_on',
          hits_id: id('option', 'Raise to £59'), through_id: id('factor', 'Pro plan price'), through_direction: 'positive',
          affects_id: graph.nodes.find((n) => n.kind === 'goal')!.id, direction: 'negative',
          relies_on: 'shipping the feature release with the new price', watch_for: 'the release date moves later' }] };
      };
    }, undefined, 2);
    const widened = graphNow().nodes.filter((n) => (n as { draft_widening?: { provenance?: string } }).draft_widening?.provenance === 'ai_suggested_widen');
    expect(widened.map((n) => n.label), 'control: the route really widened this draft').toEqual(['Feature release slips']);
    expect((widened[0] as { relies_on?: unknown }).relies_on).toBeUndefined();
    expect(t._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
  });

  it('P05b-8c CONTRAST: a non-construction turn on the one-risk graph has no relabelled risks press', async () => {
    await thinConstruction(1);
    script = [() => say('We can explore this model together.')];
    const t = await turn({ message: 'What do you think about the pricing options?' });
    expect(t._agent.tool_calls.some((c) => c.name === 'build_model_from_brief' && c.mutated === true)).toBe(false);
    expect(graphNow().nodes.filter((node) => node.kind === 'risk')).toHaveLength(1);
    expect(t.suggested_actions.some((c) => c.id === RISKS.id && c.label === THIN_BUTTON), JSON.stringify(t)).toBe(false);
  }, 120_000);
  const paulV1 = () => {
    const g = JSON.parse(readFileSync(new URL('../method-turn/__tests__/fixtures/s-c-widen/paul-6582edbc-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    delete g['_provenance'];
    graphOf.set(SCENARIO, g);
  };
  /** Served turn #2's prose risks (forensics D-11), as the typed candidates the method call now returns. */
  const TURN2 = [
    { label: 'Recruitment delay', category: 'timing', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
      affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'filling both developer roles quickly', watch_for: 'no accepted offer by week 4' },
    { label: 'Wrong bottleneck', category: 'dependency', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
      affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'a Tech Lead removing the main delivery blocker', watch_for: 'delays persist after the Tech Lead starts' },
    { label: 'Coordination drag', category: 'people', mechanism: 'drives', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
      affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'new developers joining without slowing the team', watch_for: 'senior time spent on onboarding' },
    { label: 'Quality trade-off', category: 'cost', mechanism: 'drives', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
      affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'keeping quality while hiring under time pressure', watch_for: 'rising defect counts before launch' },
  ];
  const candidates = (items: unknown) => say(`<risk_suggestions>${JSON.stringify(items)}</risk_suggestions>`);
  const nodeLabels = () => graphNow().nodes.map((x) => x.label).sort();
  const addChips = (b: Body) => b.suggested_actions.filter((c) => c.id.startsWith('agent-widen-add:'));
  /** #2742 S1's ONE question for a chance goal with no date (`chanceGoalDeadlineAsk`), verbatim. */
  const S1_ASK = 'What is the deadline for "meet our next feature-launch deadline"? A date or a time from now is fine, for example "6 months"; I\'ll propose it as your deadline.';
  const gapOf = (b: Body) => (b as unknown as { model_gap?: { kind: string; question: string } }).model_gap;

  it('SR-1 RED (served turn #2): the press runs the method — ONE tool-less call, ≤3 risks each with an Add, Something else, the gap question; NOTHING stored', async () => {
    paulV1();
    const before = nodeLabels();
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return candidates(TURN2); }];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(openAiCalls, 'ONE model call').toBe(1);
    expect(((bodies[0]!['tools'] ?? []) as unknown[]), 'no tool: the call suggests, the server decides').toEqual([]);
    expect(JSON.stringify(bodies[0]!['instructions'] ?? '')).toContain('METHOD TURN: the user asked Olumi to suggest risks');
    expect(addChips(t1).map((c) => c.label), JSON.stringify(t1.suggested_actions)).toEqual(['Add ‘Recruitment delay’', 'Add ‘Wrong bottleneck’', 'Add ‘Coordination drag’']);
    expect(t1.suggested_actions.map((c) => c.id).slice(3)).toEqual(['agent-widen-something-else']);
    expect(t1.assistant_text).toContain('(assumption-based planning)');
    expect(t1.assistant_text).toContain("- Olumi's suggestion: ‘Recruitment delay’: ‘Hire Two Developers’ relies on filling both developer roles quickly. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.");
    expect((t1 as unknown as { model_gap?: { kind: string } }).model_gap?.kind, 'the typed gap rides the wire').toBe('deadline_missing');
    expect(t1.assistant_text).not.toContain('<risk_suggestions>');
    expect(t1.assistant_text.trim().split('\n').at(-1)).toBe(S1_ASK);
    expect(t1._agent.tool_calls).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(nodeLabels(), 'nothing is written by the suggestion').toEqual(before);
  }, 120_000);

  it('SR-2: Add → NO model call → ONE held card → approve → stamped timing risk has zero edges', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    expect(add?.message, JSON.stringify(t1.suggested_actions)).toBe('Add the risk ‘Recruitment delay’ to ‘Hire Two Developers’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
    const before = nodeLabels();
    const calls = openAiCalls;
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(openAiCalls, 'the Add press makes no model call').toBe(calls);
    expect(t2._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    // Served sc-plus-1 (7 Oct 16:58Z): the card was held, yet the words said it was not. A held card is never a refusal.
    expect(t2.assistant_text).not.toContain('I couldn’t prepare that risk');
    expect(t2.assistant_text).toContain('I’ve prepared this change');
    expect(t2.assistant_text).toContain('Recruitment delay');
    const approve = approveChipOf(t2);
    expect(approve?.id, JSON.stringify(t2.suggested_actions)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    const ops = held[0]!.action.inline_patch!.operations!.map((o) => `${o.op} ${o.path}`);
    expect(ops).toEqual(['add_node risk_recruitment_delay']);
    expect(held[0]!.action.inline_patch!.operations![0]!.value).toMatchObject({ relies_on: { option_id: 'hire_two_developers' } });
    expect(nodeLabels(), 'nothing is written before the approval').toEqual(before);
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const g = graphNow();
    expect(g.nodes.some((x) => x.id === 'risk_recruitment_delay' && x.kind === 'risk' && x.label === 'Recruitment delay')).toBe(true);
    expect(g.edges.filter((e) => e.to === 'risk_recruitment_delay').map((e) => e.from), 'RC3: hiring is not the cause of its timing precondition failing').toEqual([]);
    expect(g.edges.filter((e) => e.from === 'risk_recruitment_delay').map((e) => e.to)).toEqual([]);
    expect(g.nodes.find((x) => x.id === 'risk_recruitment_delay')).toMatchObject({ relies_on: { option_id: 'hire_two_developers' } });
  }, 120_000);

  it('SR-3 RED: the canvas "+" Risk press (ask:risks) reaches the SAME door', async () => {
    paulV1();
    script = [() => candidates(TURN2.slice(0, 1))];
    const t1 = await turn({ message: 'What could go wrong, or unexpectedly well, that this model doesn’t have yet?', source: 'chip', chip: { id: 'ask:risks' } });
    expect(addChips(t1).map((c) => c.label)).toEqual(['Add ‘Recruitment delay’']);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('SR-4: nothing passes the gate → RC\'s fallback and Talk it through; nothing stored, no Add', async () => {
    paulV1();
    const before = nodeLabels();
    script = [() => say('Consider these possible risks—not established facts: Recruitment delay, Wrong bottleneck. None has been added.')];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(t1.assistant_text).toBe('What else could stop ‘meet our next feature-launch deadline’ from working out? For example, something about people, timing, cost, a dependency, or something outside your control.');
    expect(t1.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
    expect(nodeLabels()).toEqual(before);
  }, 120_000);

  it('SR-5 CONTROL: the pre-mortem worksheet "Add this as a risk" (same id, its own message) stays an ordinary Agent turn with its tools', async () => {
    paulV1();
    const bodies: Record<string, unknown>[] = [];
    script = [
      (body) => { bodies.push(asSent(body) as Record<string, unknown>); return fnCall('propose_new_risk', { label: 'Onboarding drag', rationale: 'The user asked for it.',
        affects: [{ target_label: 'Feature Delivery Capacity', direction: 'negative' }], caused_by: [{ factor_label: 'Developer Hires', direction: 'positive' }] }); },
      () => say('I can add it. Shall I?'),
    ];
    const t1 = await turn({ message: 'Prepare one risk called "Onboarding drag": Onboarding takes longer. It would lower "Feature Delivery Capacity". Olumi hypothesis — for you to challenge. Show the proposed change for approval.',
      source: 'chip', chip: { id: RISKS.id } });
    expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name)).toContain('propose_new_risk');
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    expect(addChips(t1)).toEqual([]);
  }, 120_000);

  // ⛔ AIE 6048621134: an Add id carries ':', which the answer-offers migration refuses, and the refusal cost the WHOLE answer
  // its row. Until the envelope admits it (a migration, or a colon-free id in CEE and DGAI: DL ruling), the Add stays live
  // and is NOT stored, and the answer is recorded (x4-answer-offers-reload rows 7b/7c). Reload durability is the open gap.
  it('SR-7 (reload): the Add presses are live-only until the offers envelope admits their id, and stand only while the result is current and nothing awaits approval', async () => {
    const { isDurableAnswerOffer, stillValidOffers } = await import('../../../routes/agent-v1-turn.js');
    const { riskAddPressFor } = await import('../method-turn/widen-turn.js');
    const add = riskAddPressFor({ label: 'Recruitment delay', mechanism: 'drives', hits: { id: 'hire_two_developers', label: 'Hire Two Developers', kind: 'option' },
      through: { id: 'developer_hires', label: 'Developer Hires', direction: 'positive' },
      affects: { id: 'feature_delivery_capacity', label: 'Feature Delivery Capacity', direction: 'negative' } });
    expect(isDurableAnswerOffer(add)).toBe(false);
    const current = { analysisReady: undefined, modelExists: true, analysisState: { run_state: { kind: 'complete_current' }, usable_for_chips: true } };
    expect(stillValidOffers([add], { ...current, outstandingProposalIds: new Set() }).map((a) => a.id)).toEqual([add.id]);
    expect(stillValidOffers([add], { ...current, outstandingProposalIds: new Set(['gmh_0123456789ab']) })).toEqual([]);
    expect(stillValidOffers([add], { ...current, analysisState: { run_state: { kind: 'stale' }, usable_for_chips: true }, outstandingProposalIds: new Set() })).toEqual([]);
  });

  it('SR-8 (Codex r1 P1): an Add press whose message was edited is REFUSED in words — no model call, no proposal, never ordinary generation', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    const calls = openAiCalls;
    script = [() => fnCall('propose_new_option', { label: 'Contractor cover', acts_on: [{ factor_label: 'Developer Hires', direction: 'positive' }], rationale: 'r' })];
    const t2 = await turn({ message: 'Add an option called Contractor cover instead; it increases Developer Hires.', source: 'chip', chip: { id: add.id } });
    expect(openAiCalls, 'no model call').toBe(calls);
    expect(t2._agent.tool_calls).toEqual([]);
    expect(t2.assistant_text).toBe('I couldn’t prepare that risk as a change, so nothing was added. The model may have changed since I suggested it. Press Suggest risks for a fresh set.');
    expect(t2.suggested_actions.map((c) => c.id)).toEqual([RISKS.id]);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('SR-9 (Codex r1 P1): a STALE Add — its factor renamed and a new node given the old name — is refused; nothing held', async () => {
    paulV1();
    script = [() => candidates([TURN2[2]])];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    const g = graphOf.get(SCENARIO) as { nodes: Record<string, unknown>[] };
    graphOf.set(SCENARIO, { ...g, nodes: [...g.nodes.map((n) => (n['id'] === 'developer_hires' ? { ...n, label: 'Renamed developer count' } : n)),
      { id: 'fac_other', kind: 'factor', label: 'Developer Hires', observed_state: { value: 0 } }] });
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(t2._agent.tool_calls).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  /**
   * DL 7 Oct (Reasoning lane, DGAI #2598): `agent-next-widen` is now sent at EVERY stage from every door. Both targets answer
   * a pre-run model and a withheld-leader Run with their own typed turn — never ordinary generation.
   */
  const WITHHELD = { analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-07T09:17:02.002Z' }, usable_for_chips: true,
    leader_claim: { permitted: false, withheld_reason: 'goal_figures_withheld' } } };
  for (const [stage, read] of [['pre-run (no analysis)', {}], ['withheld leader', WITHHELD]] as const) {
    it(`SR-10 ${stage}: "Suggest options" runs the options door (its ONLY tool), and an empty answer is RC's typed fallback`, async () => {
      paulV1();
      extraRead = read;
      const bodies: Record<string, unknown>[] = [];
      script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return say('Here are some ideas in prose.'); }];
      const t = await turn({ message: 'Suggest options I haven’t considered.', source: 'chip', chip: { id: 'agent-next-widen' } });
      expect(openAiCalls).toBe(1);
      expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name)).toEqual(['propose_new_option']);
      expect(t.assistant_text).toBe('What other way could you reach ‘meet our next feature-launch deadline’? For example, a different lever, a smaller first step, or a mix of these options.');
      expect(t.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
    }, 120_000);
    it(`SR-11 ${stage}: "Suggest risks" runs the risks door (no tool) and answers with typed items and Adds`, async () => {
      paulV1();
      extraRead = read;
      const bodies: Record<string, unknown>[] = [];
      script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return candidates(TURN2.slice(0, 2)); }];
      const t = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
      expect(openAiCalls).toBe(1);
      expect(((bodies[0]!['tools'] ?? []) as unknown[])).toEqual([]);
      expect(addChips(t).map((c) => c.label)).toEqual(['Add ‘Recruitment delay’', 'Add ‘Wrong bottleneck’']);
    }, 120_000);
  }

  it('SR-12 JOINED (PL/Codex 5443200599 with #2742 S1): on Paul\'s CHANCE goal only S1\'s deadline question survives — in the widen text, on the wire, and on an ordinary turn', async () => {
    paulV1();
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(t1.assistant_text).not.toContain('What would count as meeting it');
    expect(t1.assistant_text.split(S1_ASK)).toHaveLength(2);
    expect(t1.assistant_text.match(/\?/gu), 'ONE question in the reply').toHaveLength(1);
    expect(gapOf(t1)).toEqual({ kind: 'deadline_missing', goal_id: 'meet_our_next_feature_launch_deadline', question: S1_ASK });
    script = [() => say('We can look at the hiring options together.')];
    const t2 = await turn({ message: 'What do you think about the two hires?' });
    expect(JSON.stringify(t2)).not.toContain('What would count as meeting it');
    expect(gapOf(t2)?.question).toBe(S1_ASK);
  }, 120_000);

  it('SR-13 CONTROL: the same model with a QUANTITY goal keeps the target ask on the wire and in the widen text', async () => {
    paulV1();
    const g = graphOf.get(SCENARIO) as { nodes: Record<string, unknown>[] };
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((n) => (n['kind'] === 'goal' ? { ...n, goal_threshold_unit: 'features shipped' } : n)) });
    script = [() => candidates(TURN2)];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(gapOf(t1)?.kind).toBe('goal_target_missing');
    expect(t1.assistant_text.trim().split('\n').at(-1)).toBe('One gap: ‘meet our next feature-launch deadline’ has no target or deadline yet. What would count as meeting it, and by when?');
    expect(t1.assistant_text).not.toContain(S1_ASK);
  }, 120_000);

  /**
   * Served canvas witness sc-plus-1 (UI a36315d4, CEE 666dad1, 7 Oct 16:58:44Z): the "+" → Risk press offered three Adds; the
   * first Add's message, VERBATIM, held its card (`widen_add: propose_new_risk, held: true`) and the reply said "I couldn't
   * prepare that risk". The model here carries the served labels only (the stored graph was not read: guest, key-gated).
   */
  const STARTER = {
    nodes: [
      { id: 'dec_pricing', kind: 'decision', label: 'How should we price the starter tier?' },
      { id: 'goal_mrr', kind: 'goal', label: 'Total MRR', goal_threshold_unit: '£', goal_threshold_raw: 50000 },
      { id: 'out_starter_mrr', kind: 'outcome', label: 'Starter-plan MRR' },
      { id: 'fac_subs', kind: 'factor', label: 'Starter-plan paying subscribers', observed_state: { value: 0.2, raw_value: 200, unit: 'subscribers', cap: 1000 } },
      { id: 'opt_launch', kind: 'option', label: 'Launch cheaper starter plan', interventions: { fac_subs: { value: 0.5, raw_value: 500, unit: 'subscribers' } } },
      { id: 'opt_keep', kind: 'option', label: 'Keep current pricing', is_baseline: true, interventions: {} },
    ],
    edges: [
      { from: 'dec_pricing', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_pricing', to: 'opt_keep', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_launch', to: 'fac_subs', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_keep', to: 'fac_subs', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', origin: 'repair' },
      { from: 'fac_subs', to: 'out_starter_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'out_starter_mrr', to: 'goal_mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'goal_mrr',
    goal_constraints: [],
  };
  const SERVED_ADD_MESSAGE = 'Add the risk ‘Weak starter demand’ to ‘Launch cheaper starter plan’: driven by less ‘Starter-plan paying subscribers’, it would lower ‘Starter-plan MRR’.';
  it('SR-14 RED (served sc-plus-1): canvas "+" Risk → Add with the served message VERBATIM → ONE held card AND the words say it is prepared, never "I couldn’t prepare"', async () => {
    graphOf.set(SCENARIO, structuredClone(STARTER));
    script = [() => candidates([{ label: 'Weak starter demand', category: 'external', mechanism: 'drives', hits_id: 'opt_launch', through_id: 'fac_subs', through_direction: 'negative',
      affects_id: 'out_starter_mrr', direction: 'negative', relies_on: 'attracting new paying subscribers with a cheaper plan', watch_for: 'interest fails to convert into paid subscriptions' }])];
    const t1 = await turn({ message: 'What could go wrong, or unexpectedly well, that this model doesn’t have yet?', source: 'chip', chip: { id: 'ask:risks' } });
    const add = addChips(t1)[0]!;
    expect(add?.message, JSON.stringify(t1.suggested_actions)).toBe(SERVED_ADD_MESSAGE);
    const calls = openAiCalls;
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(openAiCalls).toBe(calls);
    expect(t2._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    expect(approveChipOf(t2)?.id).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(t2.assistant_text).not.toContain('I couldn’t prepare that risk');
    expect(t2.assistant_text).toContain('I’ve prepared this change');
    expect(t2.assistant_text).toContain('Weak starter demand');
    // The door's OWN typed reply (`newRiskReply`), not the fallback: the press is the whole request. Through #2748's ONE
    // composer it is the `proposal` profile, so it ships WHOLE, byte for byte, with no reshaped `_answer_shape` (DL 17:3xZ).
    expect(t2.assistant_text).toBe([
      'I’ve prepared this change: add risk \'Weak starter demand\', link \'Weak starter demand\' to \'Starter-plan MRR\' and link \'Starter-plan paying subscribers\' to \'Weak starter demand\'.',
      'It threatens Starter-plan MRR (lowers it).',
      'It is driven by Starter-plan paying subscribers (more of it makes the risk less likely).',
      'How strongly it acts is not known yet: Olumi uses a placeholder strength for each link, not an estimate, for you to correct.',
      'Approve these 3 changes?',
    ].join('\n\n'));
    expect((t2 as unknown as { _answer_shape?: unknown })._answer_shape, 'kept whole: no reshaped answer shape').toBeUndefined();
    const held = await heldOnLatestRow();
    expect(held[0]!.action.inline_patch!.operations!.map((o) => `${o.op} ${o.path}`))
      .toEqual(['add_node risk_weak_starter_demand', 'add_edge risk_weak_starter_demand::out_starter_mrr', 'add_edge fac_subs::risk_weak_starter_demand']);
  }, 120_000);

  it('SR-6 RED: the canvas "+" Option press (ask:widen) reaches the options door — its ONLY tool is propose_new_option', async () => {
    paulV1();
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return say('No suggestion.'); }];
    await turn({ message: 'What other options could answer this that I have not put on the board?', source: 'chip', chip: { id: 'ask:widen' } });
    expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name)).toEqual(['propose_new_option']);
  }, 120_000);

  /** RC3: Paul's pricing precondition, separate from the historical hiring fixture above. */
  const RC3_PRICING = {
    nodes: [
      { id: 'dec_pricing', kind: 'decision', label: 'How should we price the Pro plan?' },
      { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_unit: '£', goal_threshold_raw: 50000 },
      { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, unit: '£', cap: 100 } },
      { id: 'keep_49', kind: 'option', label: 'Keep £49', is_baseline: true, interventions: { pro_plan_price: { value: 0.49, raw_value: 49, unit: '£' } } },
      { id: 'raise_59', kind: 'option', label: 'Raise Pro price to £59', interventions: { pro_plan_price: { value: 0.59, raw_value: 59, unit: '£' } } },
    ],
    edges: [
      { from: 'dec_pricing', to: 'keep_49', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_pricing', to: 'raise_59', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'keep_49', to: 'pro_plan_price', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', origin: 'repair' },
      { from: 'raise_59', to: 'pro_plan_price', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'pro_plan_price', to: 'mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'mrr',
    goal_constraints: [],
  };
  const RC3_TIMING = {
    label: 'Feature release slips', category: 'timing', hits_id: 'raise_59', through_id: 'pro_plan_price', through_direction: 'negative', mechanism: 'drives',
    affects_id: 'mrr', direction: 'negative', relies_on: 'the feature release enabling the planned price increase', watch_for: 'release date moves',
  };

  it('rc3-paul-known-answer: timing overrides model drives; Add → no model → hold → approve stores stamped zero-edge risk', async () => {
    const { assembleGuidanceSignals } = await import('../turn-context/guidance-signals.js');
    const { riskGate, risksTurnFromSignals } = await import('../method-turn/widen-turn.js');
    graphOf.set(SCENARIO, structuredClone(RC3_PRICING));
    const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph: RC3_PRICING,
      analysisState: undefined, analysisResult: undefined, optionParticipation: undefined, leaderLicensed: false });
    expect(signals['model.status_quo_option_id']).toBe('keep_49');
    const method = risksTurnFromSignals(signals, RC3_PRICING);
    if (method.kind !== 'run_risks') throw new Error(`expected a risks run, got ${method.kind}`);
    expect(method.options.map((o) => o.id)).toEqual(['raise_59']);
    const gate = riskGate(method, [RC3_TIMING]);
    expect(gate.kept, 'the known-answer item is accepted, never silently dropped').toHaveLength(1);
    expect((gate.kept[0] as typeof gate.kept[number] & { mechanism?: string }).mechanism,
      'M1: timing deterministically overrides the model’s drives').toBe('relies_on');

    script = [() => candidates([RC3_TIMING])];
    const before = nodeLabels();
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    expect(openAiCalls, 'one suggestion call').toBe(1);
    const adds = addChips(t1);
    expect(adds).toHaveLength(1);
    const add = adds[0]!;
    expect(add.message).toBe('Add the risk ‘Feature release slips’ to ‘Raise Pro price to £59’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
    expect(add.message).not.toContain('driven by');
    expect(t1.assistant_text).toContain("- Olumi's suggestion: ‘Feature release slips’: ‘Raise Pro price to £59’ relies on the feature release enabling the planned price increase. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.");
    expect(t1.assistant_text).not.toContain('affects every option alike');
    expect(nodeLabels(), 'suggesting writes nothing').toEqual(before);
    const calls = openAiCalls;
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(openAiCalls, 'the Add press makes no model call').toBe(calls);
    expect(t2._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    expect(t2.assistant_text).toContain('I’ve prepared this change');
    expect(t2.assistant_text).not.toContain('driven by');
    const leftOutLine = "‘Feature release slips’: ‘Raise Pro price to £59’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.";
    expect(t2.assistant_text).toBe([
      "I’ve prepared this change: add risk 'Feature release slips'.", leftOutLine, 'Approve this change?',
    ].join('\n\n'));
    const cards = (t2 as unknown as { _proposal_fields?: { proposals: { approve_action: { detail?: string }; missing: unknown[] }[] } })._proposal_fields?.proposals ?? [];
    expect(cards[0]?.approve_action.detail).toContain(leftOutLine);
    expect(cards[0]?.missing).toEqual([]);
    const approve = approveChipOf(t2);
    expect(approve?.id, JSON.stringify(t2.suggested_actions)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    expect(held[0]!.action.inline_patch!.operations!.map((o) => `${o.op} ${o.path}`), 'the relies_on door holds no edge at all')
      .toEqual(['add_node risk_feature_release_slips']);
    expect(held[0]!.action.inline_patch!.operations![0]!.value).toEqual({ id: 'risk_feature_release_slips', kind: 'risk', label: 'Feature release slips', relies_on: { option_id: 'raise_59' } });
    expect(nodeLabels(), 'holding writes nothing').toEqual(before);
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const g = graphNow();
    expect(g.nodes.some((x) => x.id === 'risk_feature_release_slips' && x.kind === 'risk' && x.label === 'Feature release slips')).toBe(true);
    expect(g.edges.some((e) => e.from === 'pro_plan_price' && e.to === 'risk_feature_release_slips'), 'no invented price → release-slip driver').toBe(false);
    expect(g.nodes.find((x) => x.id === 'risk_feature_release_slips')).toMatchObject({ relies_on: { option_id: 'raise_59' } });
    expect(g.edges.filter((e) => e.from === 'risk_feature_release_slips' || e.to === 'risk_feature_release_slips'), 'M2: no incoming OR outgoing edge').toEqual([]);
  }, 120_000);

  it('rc3-drives-control: explicit cost/drives keeps the exact old Add wording and stores price → risk → MRR', async () => {
    const { assembleGuidanceSignals } = await import('../turn-context/guidance-signals.js');
    const { riskGate, risksTurnFromSignals } = await import('../method-turn/widen-turn.js');
    graphOf.set(SCENARIO, structuredClone(RC3_PRICING));
    const cost = { ...RC3_TIMING, label: 'Price-driven churn', category: 'cost', mechanism: 'drives', through_direction: 'positive',
      relies_on: 'customers accepting the increased price', watch_for: 'cancellations after the price increase' };
    const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph: RC3_PRICING,
      analysisState: undefined, analysisResult: undefined, optionParticipation: undefined, leaderLicensed: false });
    expect(signals['model.status_quo_option_id']).toBe('keep_49');
    const method = risksTurnFromSignals(signals, RC3_PRICING);
    if (method.kind !== 'run_risks') throw new Error(`expected a risks run, got ${method.kind}`);
    expect(method.options.map((o) => o.id)).toEqual(['raise_59']);
    const gate = riskGate(method, [cost]);
    expect(gate.kept).toHaveLength(1);
    expect((gate.kept[0] as typeof gate.kept[number] & { mechanism?: string }).mechanism).toBe('drives');
    script = [() => candidates([cost])];
    const t1 = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(t1)[0]!;
    expect(add?.message, JSON.stringify(t1.suggested_actions)).toBe('Add the risk ‘Price-driven churn’ to ‘Raise Pro price to £59’: driven by more ‘Pro plan price’, it would lower ‘MRR’.');
    const calls = openAiCalls;
    const before = nodeLabels();
    const t2 = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    expect(openAiCalls, 'the drives Add press also makes no model call').toBe(calls);
    expect(t2._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_risk', true]]);
    const approve = approveChipOf(t2);
    expect(approve?.id, JSON.stringify(t2.suggested_actions)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    expect(held[0]!.action.inline_patch!.operations!.map((o) => `${o.op} ${o.path}`))
      .toEqual(['add_node risk_price_driven_churn', 'add_edge risk_price_driven_churn::mrr', 'add_edge pro_plan_price::risk_price_driven_churn']);
    expect(nodeLabels(), 'holding writes nothing').toEqual(before);
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const g = graphNow();
    expect(g.nodes.some((x) => x.id === 'risk_price_driven_churn' && x.kind === 'risk' && x.label === 'Price-driven churn')).toBe(true);
    expect(g.nodes.find((x) => x.id === 'risk_price_driven_churn')).not.toHaveProperty('relies_on');
    expect(g.edges.filter((e) => e.to === 'risk_price_driven_churn').map((e) => e.from)).toEqual(['pro_plan_price']);
    expect(g.edges.find((e) => e.from === 'pro_plan_price' && e.to === 'risk_price_driven_churn'))
      .toMatchObject({ effect_direction: 'positive', strength: { mean: 0.5 } });
    expect(g.edges.find((e) => e.from === 'risk_price_driven_churn' && e.to === 'mrr'))
      .toMatchObject({ effect_direction: 'negative', strength: { mean: -0.5 } });
  }, 120_000);
});
