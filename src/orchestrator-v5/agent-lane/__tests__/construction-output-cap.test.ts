/**
 * ⛔ THE FIRST-BRIEF MODEL IS NOT TRUNCATED BY THE OUTPUT CAP — and when a cap does truncate it, that is SAID as
 * truncation, never passed off as a parse error.
 *
 * MEASURED on served CEE staging `770a477` (DL acceptance runs, 27 Sep): 2 of 14 first-brief turns answered "I couldn't
 * construct the decision model because of a technical error" after 78–88 s. In BOTH, the single
 * `agent-v1-turn.callStructured` call (purpose `construction`, gpt-5.6-terra, effort medium) returned usage
 * `output_tokens` == 6000 EXACTLY — the `whole` budget's ceiling — with reasoning 4406 and 4896: reasoning spent the
 * budget, the strict-schema JSON was cut off mid-object, `JSON.parse` threw, and the refusal carried a SyntaxError.
 *   · output/rc-delivery-lead-20260925/scratchpad/acceptance-f-runs/pj-20260927T162124Z/C01-brief-msg1.json
 *   · output/rc-delivery-lead-20260925/scratchpad/acceptance-f-runs/pj-20260927T162916Z/A01-brief-msg1.json
 * Across all 119 construction calls banked in those acceptance runs no successful call reached 6000 (max 5573), the
 * largest VISIBLE answer (output − reasoning) was 2040 tokens, and reasoning ran from 0 to at least 4896.
 *
 * Two seams, both bound here:
 *   (a) the ceiling the construction call SENDS (the route's wire, not the table);
 *   (b) the route's `callStructured` carries the Responses API's own completion status, so a cut-off answer is told
 *       apart from a malformed one (AIX-001, the contract `callModel` already honours).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';

/**
 * ⭐ THE SERVED NEED. The largest reasoning a construction call has been MEASURED to spend (4896, and that is a FLOOR:
 * the call was cut off while still going) plus the largest visible answer any construction call has emitted (2040).
 * A ceiling at or below this truncates a first model that the served corpus shows can occur. Defined HERE, not read
 * from the budget table, so the table cannot move this line by moving itself.
 */
const MAX_OBSERVED_CONSTRUCTION_REASONING = 4896;
const MAX_OBSERVED_CONSTRUCTION_ANSWER = 2040;
const SERVED_CONSTRUCTION_NEED = MAX_OBSERVED_CONSTRUCTION_REASONING + MAX_OBSERVED_CONSTRUCTION_ANSWER;
/**
 * ⭐ THE CHOSEN CEILING, PINNED FROM ABOVE TOO (DL #2113 N2: 6937 or 100000 also passed a lower bound alone).
 * 12000 ≈ 1.7× the served need of 6936 — the ~1.8x margin convention of `BANKED_BUDGETS`. Not higher: the call's
 * own deadline (`constructionDeadline`, start + 100 s at the served 125 s proxy) lets at most ~8.7k tokens finish at the
 * measured 76–87 tok/s, so a larger ceiling buys spend, never a model the user receives.
 */
const PINNED_CONSTRUCTION_CEILING = 12_000;

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };

/** A minimal candidate the admitter accepts (same shape as build-model-capability.test.ts). */
const CANDIDATE = {
  goal: { metric: 'MRR', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [{ metric: 'Monthly churn', operator: '<', value: 4, unit: '%', provenance: 'explicit' }],
  options: [{ label: 'Raise Pro to £59', provenance: 'explicit', interventions: [] }],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' },
    // Olumi's level (DL ruling #72 5863840239): a limited quantity with none is a gap that spends the one retry.
    { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed' },
  ],
  risks: [{ label: 'Churn rises', provenance: 'inferred' }],
  outcomes: [{ label: 'Monthly recurring revenue', provenance: 'inferred' }],
  links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};
/** What the served truncated call looked like: a strict-schema object cut off mid-way. */
const CUT_OFF = JSON.stringify(CANDIDATE).slice(0, 140);

function dispatcher() {
  const calls: string[] = [];
  const d: InternalDispatch = async (path) => {
    calls.push(path);
    if (path.endsWith('/graph/register')) return { status: 200, json: {} };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'before' } };
  };
  return { d, calls };
}

describe('(a) the construction call has room for the reasoning the served corpus measured', () => {
  it('RED: the ceiling SENT on the real construction call exceeds the served need (reasoning 4896 + answer 2040)', async () => {
    const seen: number[] = [];
    const capture: CallStructuredModel = async (r) => {
      seen.push(r.max_output_tokens);
      return { text: JSON.stringify(CANDIDATE) };
    };
    const { d } = dispatcher();
    await createAgentCapabilities(d, new ProposalStore(), capture).buildModelFromBrief(ctx, { brief: 'a brief' });
    expect(seen).toHaveLength(1);
    expect(
      seen[0]!,
      `the construction ceiling (${seen[0]}) must leave room for ${MAX_OBSERVED_CONSTRUCTION_REASONING} reasoning + ` +
        `${MAX_OBSERVED_CONSTRUCTION_ANSWER} answer tokens — at 6000, 2/14 served first briefs were cut off`,
    ).toBeGreaterThan(SERVED_CONSTRUCTION_NEED);
    expect(seen[0], 'the chosen ceiling, pinned from above: see PINNED_CONSTRUCTION_CEILING').toBe(PINNED_CONSTRUCTION_CEILING);
  });
});

describe('(b) a response the output cap cut off is labelled as truncation, not as a parse error', () => {
  it('RED: status "incomplete" / max_output_tokens → construction_failed carrying incomplete_reason, never a SyntaxError', async () => {
    const { d, calls } = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, 'a brief', d, async () => ({
      text: CUT_OFF, status: 'incomplete', incomplete_reason: 'max_output_tokens',
    })) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'construction_failed', incomplete_reason: 'max_output_tokens' });
    expect(out.detail).toBe('incomplete: max_output_tokens');
    expect(String(out.detail)).not.toMatch(/SyntaxError|JSON/);
    expect(calls.some((p) => p.endsWith('/graph/register')), 'a cut-off answer is never registered').toBe(false);
  });

  it('CONTRAST: a COMPLETED answer that is malformed is still a parse error, with no incomplete_reason', async () => {
    const { d } = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, 'a brief', d, async () => ({ text: CUT_OFF, status: 'completed' })) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, refusal: 'construction_failed' });
    expect(out.incomplete_reason).toBeUndefined();
    expect(String(out.detail)).toMatch(/SyntaxError/);
  });

  it('the user still reads the same sentence: the refusal code, and so its words, are unchanged', async () => {
    const { d } = dispatcher();
    const out = await buildModelFromBrief(SCENARIO, 'a brief', d, async () => ({
      text: CUT_OFF, status: 'incomplete', incomplete_reason: 'max_output_tokens',
    }));
    const n = narrateWriteOutcome('Here is what I found.', [{ name: 'build_model_from_brief' }], [out as never]);
    const text = withWriteOutcome(n.text, n.status);
    expect(text).toContain('the model builder could not produce a usable model this time');
    expect(text).not.toMatch(/max_output_tokens|incomplete_reason/);
  });
});

// ─── The route's wire: what `callStructured` SENDS, and what it hands back from an `incomplete` 200 ───────────────

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPriorFactsWithReadState: async () => ({ status: 'ok', facts: [] }) };
});

const BRIEF = 'Should we raise the Pro plan price to £59 to reach £20k MRR, keeping churn under 4%?';
/**
 * `hang`: the FIRST construction call never answers (it ends only when its own signal aborts, else the stub gives up
 * with a plain transport failure after STUB_GIVE_UP_MS). `headers_timeout`: the first call fails the way undici's 110 s
 * headers timeout does. In both, any SECOND call answers at once with a valid model — the late model the DL found
 * registered after the user was told the turn failed.
 */
let constructionMode: 'cut_off' | 'malformed' | 'hang' | 'headers_timeout' = 'cut_off';
const STUB_GIVE_UP_MS = 8_000;
/** How many hanging construction calls ended because THEIR OWN signal aborted (not the stub giving up). */
let abortedBySignal = 0;
let constructionBodies: Record<string, unknown>[] = [];
let modelBodies: Record<string, unknown>[] = [];
let script: Record<string, unknown>[] = [];
let registered = 0;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const callTool = (name: string, args: Record<string, unknown>) =>
  ({ output: [{ type: 'function_call', name, call_id: `c${modelBodies.length}`, arguments: JSON.stringify(args) }] });

/** The Responses API's own shapes: `incomplete` at the cap (as served), and `completed` with a malformed answer. */
const constructionResponse = () => constructionMode === 'cut_off'
  ? {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: CUT_OFF }] }],
    usage: { input_tokens: 4584, output_tokens: 6000, output_tokens_details: { reasoning_tokens: 4406 } },
  }
  : {
    status: 'completed',
    incomplete_details: null,
    output: [{ type: 'message', content: [{ type: 'output_text', text: CUT_OFF }] }],
    usage: { input_tokens: 4584, output_tokens: 1200, output_tokens_details: { reasoning_tokens: 900 } },
  };

const VALID_ANSWER = {
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(CANDIDATE) }] }],
  usage: { input_tokens: 4584, output_tokens: 2900, output_tokens_details: { reasoning_tokens: 2000 } },
};

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } } };
    if (body.text?.format?.type === 'json_schema') {
      constructionBodies.push(body);
      if (constructionMode === 'hang' || constructionMode === 'headers_timeout') {
        if (constructionBodies.length > 1) return new Response(JSON.stringify(VALID_ANSWER), { status: 200 });
        if (constructionMode === 'headers_timeout') {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('Headers Timeout Error'), { name: 'HeadersTimeoutError', code: 'UND_ERR_HEADERS_TIMEOUT' }),
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          const giveUp = setTimeout(() => reject(new TypeError('fetch failed (stub: the call was never bounded)')), STUB_GIVE_UP_MS);
          init?.signal?.addEventListener('abort', () => { clearTimeout(giveUp); abortedBySignal += 1; reject(init.signal!.reason); }, { once: true });
        });
      }
      return new Response(JSON.stringify(constructionResponse()), { status: 200 });
    }
    modelBodies.push(body);
    const next = body['tool_choice'] === 'none' ? undefined : script.shift();
    return new Response(JSON.stringify(next ?? say('I could not build it this time.')), { status: 200 });
  }));
}

async function buildApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const a = Fastify({ logger: false });
  a.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'empty' }));
  a.post('/assist/v1/scenarios/:id/graph/register', async () => { registered += 1; return { registered: true, graph_hash: 'h1' }; });
  a.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
  a.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
  await a.register(agentV1TurnRoute);
  await a.ready();
  return a;
}

/** The tool result the route handed back to the conversation model — the Agent's only view of the build. */
const buildResultSeenByTheModel = (): Record<string, unknown> => {
  for (const b of modelBodies) {
    for (const item of (b.input as Record<string, unknown>[] | undefined) ?? []) {
      if (item.type === 'function_call_output') return JSON.parse(String(item.output)) as Record<string, unknown>;
    }
  }
  throw new Error('the conversation model never received the build result');
};

describe('the route: the construction call as it goes over the wire', () => {
  let app: FastifyInstance;
  let n = 0;
  const sid = () => `7b1e2d3c-4a5f-4e6d-8c7b-8a9f0e1d2c${String(n).padStart(2, '0')}`;
  const turn = async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid(), message: BRIEF } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as { _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] } };
  };

  beforeAll(async () => {
    installFetch();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { n += 1; constructionBodies = []; modelBodies = []; script = []; registered = 0; });

  it('RED: SENDS a ceiling above the served need, and an `incomplete` 200 reaches the builder as truncation', async () => {
    constructionMode = 'cut_off';
    const b = await turn();
    expect(constructionBodies, 'exactly one construction call').toHaveLength(1);
    expect(constructionBodies[0]!.max_output_tokens as number).toBeGreaterThan(SERVED_CONSTRUCTION_NEED);
    expect(b._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: false, refusal: 'construction_failed' }]);
    const seen = buildResultSeenByTheModel();
    expect(seen).toMatchObject({ refusal: 'construction_failed', incomplete_reason: 'max_output_tokens', detail: 'incomplete: max_output_tokens' });
    expect(registered, 'nothing registered from a cut-off answer').toBe(0);
  });

  it('CONTRAST: a `completed` 200 with a malformed answer stays a parse error on the same wire', async () => {
    constructionMode = 'malformed';
    await turn();
    expect(constructionBodies).toHaveLength(1);
    const seen = buildResultSeenByTheModel();
    expect(seen).toMatchObject({ refusal: 'construction_failed' });
    expect(seen.incomplete_reason).toBeUndefined();
    expect(String(seen.detail)).toMatch(/SyntaxError/);
    expect(registered).toBe(0);
  });
});

// ─── DL CHANGES_REQUIRED on #2113 @ 6aa4f3c2: the construction call's OWN deadline, no retry of a timeout ──────────

describe('the construction deadline: the arithmetic the route uses', () => {
  it('ends the call by start + proxy − TURN_RESPONSE_HEADROOM_MS − CONSTRUCTION_TAIL_RESERVE_MS: 100 s at the served 125 s, under undici’s 110 s', async () => {
    const { constructionDeadline, CONSTRUCTION_TAIL_RESERVE_MS } = await import('../../../routes/agent-v1-turn.js');
    const { TURN_RESPONSE_HEADROOM_MS, DEFAULT_HTTP_CLIENT_TIMEOUT_MS } = await import('../../../config/timeouts.js');
    expect(constructionDeadline(0, 125_000)).toBe(125_000 - TURN_RESPONSE_HEADROOM_MS - CONSTRUCTION_TAIL_RESERVE_MS);
    expect(constructionDeadline(0, 125_000)).toBe(100_000);
    expect(constructionDeadline(0, 125_000)).toBeLessThan(DEFAULT_HTTP_CLIENT_TIMEOUT_MS);
  });

  /**
   * ⛔ WHY THERE IS NO "RETRY A CUT-OFF DRAFT" BRANCH (Runtime 5859414906, DL 5859428786 (1)). The ceiling is reached only
   * after 12000 output tokens; the fastest construction measured ran at ~91 tok/s (a Terra draw cut off at 6000 in 66 s,
   * Sol tail screen 27 Sep), so the deadline's abort ends the call first and a construction answers `construction_timeout`,
   * never `max_output_tokens`. A retry for the cut-off could not be reached, so none is written. If the ceiling rises, the
   * deadline widens, or construction gets faster than this bound, this row goes RED and the question reopens.
   */
  it('PINNED: the SENT ceiling cannot be reached before the deadline at 120 tok/s (above the fastest measured, ~91)', async () => {
    const { constructionDeadline } = await import('../../../routes/agent-v1-turn.js');
    const { budgetFor } = await import('../model-budgets.js');
    const FASTEST_ASSUMED_TOKENS_PER_SECOND = 120;
    const msToReachCeiling = (budgetFor('gpt-5.6-terra', 'whole').max_output_tokens / FASTEST_ASSUMED_TOKENS_PER_SECOND) * 1000;
    expect(msToReachCeiling).toBeGreaterThanOrEqual(constructionDeadline(0, 125_000));
  }, 60_000);
});

describe('the route: a construction call that runs out of turn budget is ONE call, typed, and registers nothing', () => {
  /** 28 000 − 10 000 − 15 000 ⇒ the construction must end 3 s after the turn starts. */
  const PROXY_MS = 28_000;
  const WINDOW_MS = PROXY_MS - 10_000 - 15_000;
  let app: FastifyInstance;
  let n = 0;
  const sid = () => `7b1e2d3c-4a5f-4e6d-8c7b-8a9f0e1d3c${String(n).padStart(2, '0')}`;
  const turn = async () => {
    script = [callTool('build_model_from_brief', { brief: BRIEF })];
    const t0 = Date.now();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid(), message: BRIEF } });
    const ms = Date.now() - t0;
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return { ms, body: r.json() as { _agent: { tool_calls: Record<string, unknown>[] } } };
  };
  const expectTypedTimeout = (b: { _agent: { tool_calls: Record<string, unknown>[] } }) => {
    // N1: the reason is where exports see it, not only in the Agent's tool result.
    // No answer arrived, so the refusal is the no-answer one (its user words unchanged); the typed label is the truncation's.
    expect(b._agent.tool_calls).toMatchObject([{ name: 'build_model_from_brief', ok: false, mutated: false, refusal: 'no_structured_output', incomplete_reason: 'construction_timeout' }]);
    expect(buildResultSeenByTheModel()).toMatchObject({ refusal: 'no_structured_output', incomplete_reason: 'construction_timeout', detail: 'incomplete: construction_timeout' });
  };

  beforeAll(async () => {
    installFetch();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    process.env.BROWSER_PROXY_TIMEOUT_MS = String(PROXY_MS);
    app = await buildApp();
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; delete process.env.BROWSER_PROXY_TIMEOUT_MS;
  });
  beforeEach(() => { n += 1; constructionBodies = []; modelBodies = []; script = []; registered = 0; abortedBySignal = 0; });

  it('RED: a construction call that never answers is aborted at the deadline — exactly ONE call, typed `construction_timeout`, nothing registered', async () => {
    constructionMode = 'hang';
    const { ms, body } = await turn();
    expect(constructionBodies, 'exactly one paid construction call — never a second after the timeout').toHaveLength(1);
    expectTypedTimeout(body);
    expect(registered, 'no model registered after the turn has failed').toBe(0);
    expect(ms, `the turn answered inside the proxy less headroom (${PROXY_MS - 10_000} ms)`).toBeLessThan(PROXY_MS - 10_000);
    expect(ms, 'the call was held to its deadline, not cut short').toBeGreaterThanOrEqual(WINDOW_MS - 1_000);
    // Bound by the call's OWN abort, not by another bound (a stub give-up, a retry that finds the deadline spent).
    expect(abortedBySignal, 'the construction call ended because its own signal fired').toBe(1);
    expect(ms, `answered at the ${WINDOW_MS} ms deadline, not after the ${STUB_GIVE_UP_MS} ms stub give-up`).toBeLessThan(STUB_GIVE_UP_MS);
  }, 60_000);

  it('RED: undici’s headers timeout on the construction call is NOT transport-retried — one call, typed, the late second model never registered', async () => {
    constructionMode = 'headers_timeout';
    const { body } = await turn();
    expect(constructionBodies, 'a timeout is not retried: no second paid call').toHaveLength(1);
    expectTypedTimeout(body);
    expect(registered, 'the second call’s model would register here').toBe(0);
  }, 60_000);

  it('RED: past the deadline no construction call starts at all — zero calls, typed `construction_timeout`', async () => {
    // 25 000 − 10 000 − 15 000 ⇒ the deadline IS the turn's start.
    process.env.BROWSER_PROXY_TIMEOUT_MS = '25000';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
    try {
      constructionMode = 'hang';
      const { body } = await turn();
      expect(constructionBodies, 'no paid call that cannot end before the browser gives up').toHaveLength(0);
      expectTypedTimeout(body);
      expect(registered).toBe(0);
    } finally {
      process.env.BROWSER_PROXY_TIMEOUT_MS = String(PROXY_MS);
      _resetConfigCache();
    }
  }, 60_000);
});
