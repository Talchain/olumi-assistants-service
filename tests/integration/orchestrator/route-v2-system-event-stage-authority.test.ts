/**
 * ⭐ THE STALE-`decide` TWIN, ON THE PATH IT COULD NOT SEE.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * CEE #1042 gave the estate ONE stage authority — `deriveAuthoritativeStage`
 * (`orchestrator-v5/context/derive-stage.ts`) — and applied it in exactly one
 * place: `buildTurnContext`. That module carries a TWIN (`derive-stage.ts`, the
 * `requestedStage === 'decide' && hasGraph` branch) whose whole job is that a
 * stale `decide` echo must not outlive the analysis that earned it.
 *
 * The SYSTEM-EVENT family never calls `buildTurnContext` — it cannot, because
 * `SystemEventTurnPayload` has no `message` field and the route dispatches it
 * before the TurnExecutor. So every system-event writer stamped
 * `stage_indicator: payload.stage` RAW (`system-events/factor-value-edit.ts`,
 * `edge-strength-edit.ts`, `structural-delete.ts`, `dispatch.ts`'s two
 * acknowledgement composers). Once CEE can ORIGINATE `decide`, the UI stores it
 * and sends it back — and a user editing a factor value got their `decide` pill
 * echoed straight back over a model whose analysis had just gone stale. That is
 * the exact lie the twin exists to prevent, on the one path the twin could not
 * reach.
 *
 * ── WHY THIS FILE ASSERTS AT THE ROUTE ───────────────────────────────────────
 * The correction lives at the ONE application point (`route-v2.ts`, immediately
 * after the single `dispatchSystemEvent` call site), because that is the only
 * place where all three derivation inputs — the requested stage, the freshness
 * derivation and the committed graph — are in scope for EVERY system-event
 * writer and every refusal/ack floor at once. A unit test on any one writer
 * would therefore assert nothing about the fix. The wire response is the object
 * under test.
 *
 * ── BOUND BY IDENTITY ────────────────────────────────────────────────────────
 * Every expectation names an EXACT stage string. `'analyse'` and `'decide'` are
 * different objects and no other value satisfies either assertion, so a
 * correction that produced some third stage fails loudly rather than passing on
 * a value predicate (CLAUDE.md trap 19).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ── the persisted model ────────────────────────────────────────────────────
// TWO options, so `optionCount >= MIN_OPTIONS_FOR_DECIDE` is satisfied and the
// ONLY thing standing between this turn and a `decide` promotion is freshness.
// That is deliberate: it makes this fixture a test of the FRESHNESS conjunct,
// not of the option count, and it means a mutant that dropped the freshness
// input would flip the answer instead of coincidentally agreeing.
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
      { id: 'o-wait', kind: 'option', label: 'Wait a quarter' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
let persisted: unknown = buildPersistedGraph();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    // NO analysis facts: `deriveAnalysisFreshness` resolves `none`, so the
    // model cannot support `decide`. This is the "the analysis under your
    // `decide` pill has gone" state, derived rather than injected.
    readFactsFor: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
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

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID_BASE = '44444444-4444-4444-8444-44444444444';

function payloadFor(
  event: Record<string, unknown>,
  suffix: string,
  stage: 'frame' | 'analyse' | 'decide' | 'review',
) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage,
    event,
  };
}

const FACTOR_EDIT = {
  kind: 'factor_value_edit',
  target_id: 'f-budget',
  value: 0.5,
  raw_value: 50000,
  unit: '£',
} as const;

describe('POST /orchestrate/v2/turn — the system-event family obeys the ONE stage authority', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
  });

  // ── 1. THE TWIN, ON THE SYSTEM-EVENT PATH ────────────────────────────────

  it('a factor_value_edit arriving as `decide` over a model with no live analysis comes back `analyse`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(FACTOR_EDIT, '0', 'decide'),
    });

    expect(res.statusCode).toBe(200);
    // Sanity: this must be the WRITER path, not a refusal floor. Without it the
    // stage assertion below could pass on a turn that never reached the writer
    // — and the writer is the path the user's edit takes.
    expect(appendMock, 'the edit did not commit — this is not the writer path').toHaveBeenCalledTimes(1);

    const body = JSON.parse(res.body);
    expect(
      body.stage_indicator,
      'CEE echoed the client\'s stale `decide` back over a model whose analysis has gone — ' +
        'the exact lie derive-stage.ts\'s twin exists to prevent, on the path it could not see',
    ).toBe('analyse');
  });

  // ── 2. THE PASS-THROUGH HALF (the same run, opposite direction) ───────────
  //
  // ⭐ THE DISCRIMINATING TWIN of the test above. Without it, a "correction"
  // that hardcoded `'analyse'` for every system event would pass test 1 and be
  // completely wrong. These two differ ONLY in the requested stage, over the
  // identical model, so a passing PAIR is evidence about the derivation and not
  // about the file having learnt one answer.

  it('the SAME edit arriving as `analyse` is passed through untouched — nothing is demoted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(FACTOR_EDIT, '1', 'analyse'),
    });

    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(
      body.stage_indicator,
      'a non-`decide` request must be returned byte-for-byte — the derivation is ' +
        'ADDITIVE by construction and withdraws no affordance',
    ).toBe('analyse');
  });

  it('a `frame` request over the same model is passed through as `frame`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(FACTOR_EDIT, '2', 'frame'),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.stage_indicator).toBe('frame');
  });

  // ── 3. THE ACK / REFUSAL FLOOR — NO READ, NO VERDICT ─────────────────────
  //
  // `undo` is client-only: it commits nothing, reads no graph and derives no
  // freshness, so `dispatchSystemEvent` returns `graph: null` and no
  // `freshness`. The correction therefore sees `hasGraph: false`, the twin's
  // own bound refuses to fire, and the requested stage survives. That is
  // FAIL-CLOSED and correct — a floor that looked at nothing must not deliver
  // a verdict about the model.

  it('the client-only ack floor (`undo`) passes `decide` through untouched — no read, no verdict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'undo' }, '3', 'decide'),
    });

    expect(res.statusCode).toBe(200);
    // POSITIVE CONTROL for the absence claim below: prove this really is the
    // no-commit floor rather than a writer that happened to agree.
    expect(
      appendMock,
      'the ack floor committed — then the pass-through below is not evidence about a floor',
    ).not.toHaveBeenCalled();

    const body = JSON.parse(res.body);
    expect(
      body.stage_indicator,
      'a floor that read NOTHING rewrote the stage anyway — a verdict manufactured ' +
        'from no evidence is worse than the echo it replaced',
    ).toBe('decide');
  });

  it('`patch_dismissed` — the other ack floor — also passes `decide` through', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'patch_dismissed', patch_id: 'p-1' }, '4', 'decide'),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.stage_indicator).toBe('decide');
  });
});
