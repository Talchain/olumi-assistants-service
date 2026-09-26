/**
 * AI EXPERIENCE / CHATGPT: bounded typed-Run versus free-text-Run regression.
 *
 * Intended CEE path:
 * src/orchestrator-v5/agent-lane/__tests__/run-answer-completeness.test.ts
 * Inspected base: b4a350213afc0553d93db8eacd1573f649c6336b.
 * Reuses the Fastify/provider-capture pattern in run-fast-path.test.ts.
 *
 * STATUS: patch-ready, NOT executed in a complete CEE checkout by its author.
 * All fixtures are synthetic; no provider, database or product writes occur.
 * Six cases: two completed positive controls and four incomplete-response controls.
 * The incomplete controls are EXPECTED to fail on the inspected base, not observed RED.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const store = vi.hoisted(() => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'synthetic-answer-row' })),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Entry = 'typed_run' | 'free_text_run';
type TerminalCase = 'completed' | 'incomplete_same_text' | 'incomplete_cut_caveat';
type Body = Record<string, unknown>;

// Deliberately minimal graph carrier, following run-fast-path.test.ts.
// This is NOT a claim that an engine computed the supplied result from this graph.
const GRAPH = {
  nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }],
  edges: [{ from: 'f', to: 'g' }],
};
const STATE = {
  run_state: { kind: 'complete_current' },
  leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' },
};
const WHY = 'The churn limit was not evaluated because its baseline was not supplied.';
const FINDING = 'In the current model, the result turns on Capacity.';
const COMPLETE_TEXT = `${FINDING} ${WHY}`;

function runOutput(body: Body): Body | undefined {
  const input = Array.isArray(body.input) ? body.input as Body[] : [];
  for (const item of [...input].reverse()) {
    if (item.type !== 'function_call_output' || typeof item.output !== 'string') continue;
    try {
      const parsed = JSON.parse(item.output) as Body;
      if (Object.hasOwn(parsed, 'ran')) return parsed;
    } catch { /* A different tool output is not this run. */ }
  }
  return undefined;
}

describe('AI Experience: analysis explanation completion, both Run entry points', () => {
  let app: FastifyInstance;
  let modelBodies: Body[] = [];
  let providerReplies: Body[] = [];
  let runs = 0;
  let terminalCase: TerminalCase = 'completed';
  /** Runtime #2009 (R&C B1): the model answers directly, with no tool call, and its answer is cut short. */
  let directIncomplete = false;
  let scenarioId = randomUUID();
  let fallback: string;

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      // Never call a real provider. A new unexpected network path is a test failure.
      if (String(url) !== 'https://api.openai.com/v1/responses') {
        throw new Error(`Unexpected mocked fetch target: ${String(url)}`);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Body;
      modelBodies.push(body);
      let envelope: Body;
      if (directIncomplete) {
        envelope = { id: 'resp_direct_synthetic', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'message', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: 'The biggest driver is' }] }] };
      } else if (body.tool_choice !== 'none' && runOutput(body) === undefined) {
        // Only free-text Run needs the routing request. This is a scripted tool choice,
        // not a claim about how a real model will route the message.
        envelope = {
          id: 'resp_route_synthetic', status: 'completed', incomplete_details: null,
          output: [{ type: 'function_call', name: 'run_analysis', call_id: 'call_run_synthetic',
            arguments: JSON.stringify({ reason: 'the user asked for analysis' }), status: 'completed' }],
        };
      } else {
        const complete = terminalCase === 'completed';
        envelope = {
          id: 'resp_interpret_synthetic',
          status: complete ? 'completed' : 'incomplete',
          incomplete_details: complete ? null : { reason: 'max_output_tokens' },
          output: [{ type: 'message', role: 'assistant',
            status: complete ? 'completed' : 'incomplete',
            content: [{ type: 'output_text', text: terminalCase === 'incomplete_cut_caveat' ? FINDING : COMPLETE_TEXT }],
          }],
        };
      }
      providerReplies.push(envelope);
      return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    vi.resetModules();
    const route = await import('../../../routes/agent-v1-turn.js');
    fallback = route.interpretationUnavailableText({ ran: true });
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      runs += 1;
      return {
        response_version: 2, assistant_text: WHY,
        suggested_actions: [], insights: [], graph_hash: 'h1', analysis_state: STATE,
        blocks: [{ type: 'analysis_result', data: { marker: 'same-canonical-result' } }],
        analysis_ready: { status: 'ready', options: [], blockers: [] },
      };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: GRAPH, graph_hash: 'h1', analysis_state: STATE,
    }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    modelBodies = []; providerReplies = []; runs = 0;
    terminalCase = 'completed'; scenarioId = randomUUID(); directIncomplete = false;
  });

  async function exercise(entry: Entry) {
    const response = await app.inject({
      method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: scenarioId, message: 'Run the analysis please',
        ...(entry === 'typed_run' ? { source: 'chip_click', chip: { action_type: 'run_analysis' } } : {}),
      },
    });
    const body = response.json() as Body;
    // Keep complete capture available in assertion failures. Expected rules are never model input.
    return { response, body, capture: { modelBodies, providerReplies } };
  }

  for (const entry of ['typed_run', 'free_text_run'] as const) {
    it(`${entry}: completed useful answer preserves the supplied finding and reason`, async () => {
      const { response, body, capture } = await exercise(entry);
      expect(response.statusCode, JSON.stringify(capture)).toBe(200);
      expect(runs).toBe(1);
      // The model receives the same run-domain result and correct supplied reason in both paths.
      const answering = modelBodies.find((b) => runOutput(b) !== undefined);
      expect(answering).toBeDefined();
      const seen = runOutput(answering!)!;
      expect(seen.ran).toBe(true);
      expect(seen.what_is_missing).toBe(WHY);
      expect(JSON.stringify(seen.result)).toContain('same-canonical-result');
      expect(seen.claim_permissions).toBeDefined();
      expect(body.assistant_text).toContain('Capacity');
      expect(body.assistant_text).toContain(WHY);
      expect(body.assistant_text).not.toBe(fallback);
      if (entry === 'typed_run') {
        expect(modelBodies).toHaveLength(1);
        expect(answering!.tools).toEqual([]);
        expect(answering!.tool_choice).toBe('none');
      } else {
        expect(modelBodies).toHaveLength(2);
        // Do not demand identical prompts or prematurely disable the ordinary Agent's tools.
        expect(Array.isArray(answering!.tools)).toBe(true);
      }
    });

    for (const variant of ['incomplete_same_text', 'incomplete_cut_caveat'] as const) {
      it(`${entry}: ${variant} is not accepted as a completed explanation and does not rerun`, async () => {
        terminalCase = variant;
        const { response, body, capture } = await exercise(entry);
        expect(providerReplies.at(-1)?.status).toBe('incomplete');
        expect(response.statusCode, JSON.stringify(capture)).toBe(200);
        expect(runs, 'Do not repeat a successful run to recover its explanation').toBe(1);
        expect(modelBodies, 'No additional provider call or action-enabled recovery').toHaveLength(entry === 'typed_run' ? 1 : 2);
        // Proposed minimal policy: reuse the existing completed-run/explanation-unavailable
        // response, preserving the successful run. This is not a new public result schema.
        expect(body.assistant_text, JSON.stringify(capture)).toBe(fallback);
        const toolCalls = (body._agent as { tool_calls?: { name: string }[] } | undefined)?.tool_calls ?? [];
        expect(toolCalls.map((c) => c.name)).toEqual(['run_analysis']);
      });
    }
  }

  it('Runtime #2009 (R&C B1): a direct answer cut short, with no run, never promises to "continue" — it was not kept', async () => {
    directIncomplete = true;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenarioId, message: 'What drives the result most?' } });
    const body = response.json() as Body;
    expect(response.statusCode).toBe(200);
    expect(runs).toBe(0);
    expect(modelBodies).toHaveLength(1);
    expect(body.assistant_text).toBe('My answer ran too long and was cut short, so I have not shown it. Try asking about one part at a time.');
    expect(String(body.assistant_text)).not.toMatch(/continue/i);
    expect(String(body.assistant_text)).not.toContain('The biggest driver is');
  });
});
