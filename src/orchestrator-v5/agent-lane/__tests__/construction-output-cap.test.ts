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

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };

/** A minimal candidate the admitter accepts (same shape as build-model-capability.test.ts). */
const CANDIDATE = {
  goal: { metric: 'MRR', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [{ metric: 'Monthly churn', operator: '<', value: 4, unit: '%', provenance: 'explicit' }],
  options: [{ label: 'Raise Pro to £59', provenance: 'explicit', interventions: [] }],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' },
    { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'explicit' },
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
let constructionMode: 'cut_off' | 'malformed' = 'cut_off';
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

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } } };
    if (body.text?.format?.type === 'json_schema') {
      constructionBodies.push(body);
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
