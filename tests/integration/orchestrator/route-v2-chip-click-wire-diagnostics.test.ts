/**
 * P0 fast-follow (review #949 F1) — THE 500 BODY'S DIAGNOSTICS, PINNED AT THE WIRE.
 *
 * `route-v2.ts`'s `preStageExtras` spread on the `handler_failure` arm is the exact
 * line `DIAGNOSIS.md` §3 names as "THE OBSERVABILITY DEFECT": it used to be
 * `{ cause_kind, action_type }` and nothing else, discarding the diagnostics the
 * handler had already assembled. The measured cost was three 500 bodies
 * **byte-identical at 1126 B**, two entirely different PLoT dispositions
 * indistinguishable on the wire, and a trigger that could only be settled with
 * Render log access.
 *
 * ⚠⚠ WHY THIS FILE EXISTS: THE FIX SHIPPED UNGUARDED. The #949 reviewer's mutant
 * M6 reverted that spread and **all 34 targeted tests stayed green** — repo-wide,
 * no test asserted a wire-level 500 body's diagnostic keys. The chip-path pins
 * stop at `out.diagnostics`, one hop short of the response. A future route-v2
 * refactor could silently reinstate the undiagnosable-500s state with every suite
 * green. That is the guarantee-theatre shape the fix was written to remove,
 * reappearing in the fix's own coverage.
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY THE REAL DISPATCHER AND THE REAL HANDLER, NOT A MOCKED OUTCOME
 * ─────────────────────────────────────────────────────────────────
 * Both existing route-level chip suites (`route-v2-chip-click.test.ts`,
 * `route-v2-chip-click-recoverable.test.ts`) mock `dispatchChipClickRunAnalysis`
 * and hand route-v2 a literal outcome object. A test in that idiom could assert
 * the wire body carries whatever `diagnostics` **the test itself invented** — it
 * would pin the route hop while proving nothing about whether a real PLoT failure
 * ever produces those keys. That is a fixture agreeing with itself (trap 16: a
 * fixture you wrote yourself is not evidence about the wire).
 *
 * So this file keeps `dispatchChipClickRunAnalysis` REAL (and with it
 * `pickWireSafeFailureDetails`), keeps `route-v2` REAL, and injects ONLY the
 * registry — so the assertion covers the whole chain the diagnosis named:
 *
 *     PLoT error → run-analysis details → dispatcher allowlist
 *                → route-v2 preStageExtras → the bytes a client receives.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const ensureScenarioExistsSpy = vi.fn(async (_scenarioId: string, userId: string) => ({
  user_id: userId,
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: vi.fn().mockResolvedValue({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: ensureScenarioExistsSpy,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// `dispatchChipClickRunAnalysis` calls `buildTurnContext` unconditionally, which
// would hit Supabase. Stubbed with a minimal context — the same treatment the
// dispatcher's own unit suite uses. Everything downstream of it stays real.
vi.mock('../../../src/orchestrator-v5/build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/build-turn-context.js')>();
  return {
    ...actual,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }],
      session_id: '77777777-7777-4777-8777-777777777777',
      request_id: 'req-wire',
      budgets: {
        turn_ms: 30000,
        handler_ms: 20000,
        plot_ms: 15000,
        anthropic_ms: 15000,
        openai_ms: 15000,
      },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    })),
  };
});

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

/**
 * The ONLY seam mocked on the dispatch path, and it delegates to the REAL
 * dispatcher with an injected registry. `dispatchChipClickRunAnalysis` itself —
 * including `pickWireSafeFailureDetails`, the function under test — is untouched.
 */
let nextPlotError: () => Error = () => new Error('not configured');

vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js')
  >();
  const { createRegistry } = await import('../../../src/orchestrator-v5/tools/registry.js');
  return {
    ...actual,
    dispatchDeterministicChipClick: async (actionType: string, params: Record<string, unknown>) => {
      if (actionType !== 'run_analysis') throw new Error(`unexpected action_type: ${actionType}`);
      const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
      const snapshot = {
        graph,
        // CONFIGURED options on purpose: the pre-PLoT all-unconfigured guard must
        // NOT fire, or PLoT is never reached and this test would silently measure
        // the honest-block path instead of the failure path.
        options: [
          { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 1.2 } },
          { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 0.9 } },
        ],
        goal_node_id: 'g',
        rawPersistedGraph: graph,
      };
      const plotClient = {
        run: vi.fn(() => Promise.reject(nextPlotError())),
        validatePatch: vi.fn().mockResolvedValue({}),
      };
      return actual.dispatchChipClickRunAnalysis({
        ...params,
        handlerRegistry: createRegistry({
          scenarioReader: (() => Promise.resolve(snapshot)) as never,
          plotClient: plotClient as never,
        }),
      } as never);
    },
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { PLoTError } = await import('../../../src/orchestrator/plot-client.js');
const { log } = await import('../../../src/utils/telemetry.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let app: FastifyInstance;

function chipPayload(turnId: string) {
  return {
    kind: 'message' as const,
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    stage: 'analyse' as const,
    message: 'Run analysis',
    turn_class: 'decide' as const,
    source: 'chip_click' as const,
    chip: { action_type: 'run_analysis' as const },
  };
}

/**
 * The BoundaryError shape as a client receives it. `details` is typed
 * `Record<string, unknown>` deliberately: the contract's own
 * `BoundaryErrorSchema.details` is a Zod PASSTHROUGH object, so the wire genuinely
 * admits arbitrary keys — which is exactly why the diagnostic keys can ride there,
 * and exactly why nothing but a test can pin that they do.
 */
interface WireBoundaryBody {
  readonly error?: string;
  readonly retryable?: boolean;
  readonly details: Record<string, unknown>;
}

/** POST the chip turn and return the parsed wire response. */
async function postChipTurn(
  turnId: string,
): Promise<{ statusCode: number; body: WireBoundaryBody }> {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: chipPayload(turnId),
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) as WireBoundaryBody };
}

beforeAll(async () => {
  vi.spyOn(log, 'warn').mockImplementation(() => {});
  vi.spyOn(log, 'error').mockImplementation(() => {});
  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as unknown as { user: { id: string } }).user = { id: USER_ID };
  });
  await app.register(ceeOrchestratorRouteV2);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

describe('route-v2 chip_click — a fatal PLoT failure is DIAGNOSABLE FROM THE WIRE BODY', () => {
  it('F1: the 500 body carries downstream_http_status + plot_primary_code (kills the M6 survivor)', async () => {
    // A PLoT 502 carrying a typed `failed` envelope: still FATAL after the P0 fix
    // (502 is neither 422-blocked nor 503), so it exercises the
    // `handler_failure` → 500 arm — the only arm `diagnostics` ride.
    //
    // ⚠ The cause here is `analysis_failed`, NOT `plot_error`, and the first cut
    // of this test asserted the latter and RED-ed. The code was right and the
    // expectation was wrong: `isTypedFailedEnvelope` is
    // `status !== 422 && analysis_status === 'failed'`, which a 502-with-envelope
    // satisfies. Corrected against the producer rather than "fixed" by loosening
    // (trap 13c — derive the expectation from the code's declared semantics).
    // The `plot_error` twin is pinned in the next test, so both fatal causes are
    // covered at the wire.
    nextPlotError = () => {
      const err = new PLoTError('PLoT run returned 502', 502, 'run', 15, 'req-wire-502');
      err.v2RunError = {
        analysis_status: 'failed',
        status_reason: 'upstream gateway error',
        critiques: [{ code: 'ISL_CALL_FAILED', message: 'call failed' }],
      };
      return err;
    };

    const { statusCode, body } = await postChipTurn('11111111-1111-4111-8111-1111111111f1');

    // PRECONDITION PINS (trap 13b) — assert this really is the 500 arm, and the
    // SAME 500 the diagnosis characterised. Without these, the diagnostic
    // assertions below could pass on some other response shape entirely.
    expect(statusCode).toBe(500);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('chip_click_run_analysis_handler_failed');
    expect(body.details.cause_kind).toBe('analysis_failed');

    // ⭐ THE PIN. These two keys are what DIAGNOSIS §3 says the wire discarded,
    // and what took Render log access to recover. Bound to the IDENTIFYING VALUES
    // (trap 19): `502` and `ISL_CALL_FAILED` are this disposition's and no other's
    // — a different PLoT failure could not satisfy them.
    expect(body.details.downstream_http_status).toBe(502);
    expect(body.details.plot_primary_code).toBe('ISL_CALL_FAILED');
  });

  it('F1: a plot_error 500 (no envelope) carries its status too — the diagnosis’s own cause_kind', async () => {
    // `plot_error` is the cause_kind on all three banked 500s. With no envelope
    // there are no critique codes to carry, so the status is the ONLY diagnostic
    // there is — which makes it the one that must survive.
    nextPlotError = () =>
      new PLoTError('PLoT run returned 502', 502, 'run', 15, 'req-wire-bare-502');

    const { statusCode, body } = await postChipTurn('11111111-1111-4111-8111-1111111111f5');

    expect(statusCode).toBe(500);
    expect(body.details.cause_kind).toBe('plot_error');
    expect(body.details.downstream_http_status).toBe(502);
    // Honest about what is absent: no envelope means no code, and the wire must
    // not invent one.
    expect(body.details.plot_primary_code).toBeUndefined();
  });

  it('F1: the handler cannot SHADOW cause_kind or action_type via a same-named detail', async () => {
    // The spread order in `route-v2.ts` puts diagnostics FIRST so `cause_kind`
    // and `action_type` stay authoritative. That ordering was deliberate and
    // nothing pinned it — an innocuous-looking reorder would let a handler detail
    // overwrite the field every consumer branches on.
    //
    // `cause_kind` is on the allowlist precisely so this is testable: the handler
    // is made to emit a FALSE one, and the wire must still report the real one.
    nextPlotError = () => {
      const err = new PLoTError('PLoT run returned 502', 502, 'run', 15, 'req-wire-shadow');
      err.v2RunError = {
        analysis_status: 'failed',
        status_reason: 'x',
        critiques: [{ code: 'ISL_ERROR', message: 'e' }],
      };
      return err;
    };

    const { body } = await postChipTurn('11111111-1111-4111-8111-1111111111f2');

    expect(body.details.cause_kind).toBe('analysis_failed');
    expect(body.details.action_type).toBe('run_analysis');
    // And the reason string, which consumers key on, is untouched by the spread.
    expect(body.details.reason).toBe('chip_click_run_analysis_handler_failed');
  });

  it('F1: PLoT prose and user content never reach the wire error body', async () => {
    // The allowlist is pinned at the dispatcher layer, but the LEAK would happen
    // here — an error body reaches logs and clients. Asserted with a payload that
    // ACTUALLY CARRIES the prose, or the absence proves nothing (trap 13).
    nextPlotError = () => {
      const err = new PLoTError('PLoT run analysis failed', 200, 'run', 90, 'req-wire-prose');
      err.v2RunError = {
        analysis_status: 'failed',
        status_reason: "Option 'Acquire Northwind Ltd for £4.2m' could not be priced",
        critiques: [
          {
            code: 'ISL_REJECTED',
            message: "Option 'Acquire Northwind Ltd for £4.2m' was rejected",
            user_message: "We could not analyse 'Acquire Northwind Ltd for £4.2m'",
          },
        ],
      };
      return err;
    };

    const { statusCode, body } = await postChipTurn('11111111-1111-4111-8111-1111111111f3');

    expect(statusCode).toBe(500);
    // POSITIVE CONTROL: the projection reached the wire at all. Without this, the
    // absence assertions below would pass on a body that carried NOTHING — the
    // exact state the M6 mutant produces, i.e. the test would agree with the
    // defect it exists to catch.
    expect(body.details.plot_primary_code).toBe('ISL_REJECTED');

    // And the prose did not.
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('Northwind');
    expect(wire).not.toContain('£4.2m');
    expect(body.details.plot_status_reason).toBeUndefined();
    expect(body.details.plot_user_message).toBeUndefined();
    expect(body.details.first_option_label).toBeUndefined();
  });

  it('CONTRAST: a RECOVERED disposition returns 200 and no BoundaryError at all', async () => {
    // The discrimination that makes the 500 assertions meaningful (trap 13b, and
    // trap 20's heuristic — keep one probe whose expected answer DIFFERS). If
    // every disposition 500d, the pins above would be satisfied by a route that
    // had stopped discriminating entirely. This is also the P0's user-facing
    // outcome, asserted end to end at the wire for the first time.
    nextPlotError = () => {
      const err = new PLoTError('PLoT run analysis blocked', 422, 'run', 95, 'req-wire-blocked');
      err.v2RunError = {
        analysis_status: 'blocked',
        status_reason: 'Conflicting duplicate edges',
        critiques: [
          {
            code: 'DUPLICATE_EDGE_CONFLICT',
            message:
              'Edges sha8:c1f82a62 -> sha8:12984236 (directed) appear 2 times with different values '
              + '(strength.mean, strength.std). Keep one edge per relationship, or merge the beliefs into a single edge.',
          },
        ],
      };
      return err;
    };

    const { statusCode, body } = await postChipTurn('11111111-1111-4111-8111-1111111111f4');

    expect(statusCode).toBe(200);
    expect(body.error).toBeUndefined();
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('INTERNAL_ERROR');
    // PLoT's node ids must never render.
    expect(wire).not.toContain('sha8:');
  });
});
