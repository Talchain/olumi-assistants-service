/**
 * ROADMAP 2.159 (re-scoped) — SILENT SCALE REDECLARATION, END-TO-END.
 *
 * THE DEFECT THIS CLOSES (measured at the bytes, 31 Jul, against PR #766's own
 * head): the handler persists `after.unit = parsed.unit ?? before.unit`, so a
 * proposal carrying a unit permanently changes what a previously-unitless
 * factor MEASURES — in an ordinary 200, with no consent step. The measured
 * consequence is a two-turn launder:
 *
 *   turn 1  { value: 0.9, unit: '%' }  → accepted; `unit: '%'` PERSISTED
 *   turn 2  { value: 1.5 }             → the factor now reads as unit-bearing
 *
 * ⚠ WHAT THIS FILE DOES NOT CLAIM. It does not bound a normalised `[0,1]`
 * factor. PR #766's first attempt did, by classifying a factor as normalised
 * when its stored value happened to sit in `[0,1]`; adversarial review refuted
 * that heuristic at the bytes in both directions — a small COUNT factor at 0 or
 * 1 (a class `prompts/defaults-v187.ts:301` explicitly sanctions as raw) was
 * refused a legitimate 1→3 edit with factually FALSE copy, and any count that
 * passed through `[0,1]` became permanently un-raisable. Bounding a normalised
 * factor needs a DECLARED scale on the contract — rowed as 2.193. The
 * `ACCEPTS 1.5` test below pins the fail-open so nobody reads this file as
 * having closed it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// `f-adoption` — no cap, no unit. `f-hires` — the small-count class, the one
// the refuted heuristic broke. `f-budget` — the capped control, untouched.
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-adoption',
        kind: 'factor',
        label: 'Adoption rate',
        observed_state: { value: 0.65 },
      },
      {
        id: 'f-hires',
        kind: 'factor',
        label: 'New hires',
        observed_state: { value: 1, raw_value: 1 },
      },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-adoption',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.3, std: 0.1 },
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

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

function committedGraph(): Record<string, unknown> | undefined {
  const call = appendMock.mock.calls.at(-1);
  return (call?.[0] as { graph?: Record<string, unknown> } | undefined)?.graph;
}

function observedStateOf(
  graph: Record<string, unknown> | undefined,
  id: string,
): Record<string, unknown> | undefined {
  const nodes = (graph?.nodes ?? []) as Array<{ id: string; observed_state?: Record<string, unknown> }>;
  return nodes.find((n) => n.id === id)?.observed_state;
}

describe('POST /orchestrate/v2/turn — scale redeclaration (ROADMAP 2.159)', () => {
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

  // ── THE LAUNDERING SEQUENCE ──────────────────────────────────────────────

  it('REFUSES turn 1 of the launder — a unit onto a previously-unitless factor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: 0.9, unit: '%' },
        '0',
      ),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // The turn is committed (the transcript records the refusal) but NO graph
    // is written — this is the assertion that was false before the fix.
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedGraph()).toBeUndefined();

    expect(body.assistant_text).toMatch(/haven't changed anything/i);
    expect(body.blocks).toEqual([]);
    expect(body.assistant_text).toContain('recorded without a unit');
    // Prediction-free AND free of computed arithmetic (an earlier draft
    // rendered "the value given was 1.2999999999999998").
    expect(body.assistant_text).not.toMatch(/\d{6}/);
  });

  it('THE FULL TWO-TURN LAUNDER cannot complete — the unit never lands, so turn 2 has nothing to exploit', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: 0.9, unit: '%' },
        '1',
      ),
    });
    // Nothing was written, so the persisted graph is unchanged: still unitless.
    expect(committedGraph()).toBeUndefined();
    expect(observedStateOf(persisted as Record<string, unknown>, 'f-adoption')?.unit).toBeUndefined();
  });

  // ── THE REFUSAL SHAPE, pinned for the UI half ────────────────────────────

  it('THE REFUSAL SHAPE ON THE WIRE — pinned for the UI half', async () => {
    // ⚠ THIS TEST EXISTS FOR ANOTHER REPO. The UI's #524 reject-revert keys off
    // a CEE refusal. Pin the payload here so a CEE-side change shows up as a
    // RED in CEE rather than as a silent regression in the UI.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: 0.9, unit: '%' },
        '2',
      ),
    });

    expect(JSON.parse(res.body)).toEqual({
      response_version: 2,
      assistant_text:
        'This factor is recorded without a unit, so applying a value in % would change ' +
        "what it measures. I haven't changed anything. Tell me what you'd like instead and I'll apply it.",
      blocks: [],
      suggested_actions: [
        {
          id: 'chip_prompt_param_retry',
          label: 'Try a different value',
          message: 'Use a different value for value.',
        },
      ],
      insights: [],
      stage_indicator: 'analyse',
    });
  });

  // ── THE FAIL-OPEN, pinned honestly ───────────────────────────────────────

  it('⚠ ACCEPTS 1.5 on the uncapped unitless factor — NOT closed here; that is 2.193', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-adoption', value: 1.5 }, '3'),
    });
    expect(res.statusCode).toBe(200);
    expect(observedStateOf(committedGraph(), 'f-adoption')?.value).toBe(1.5);
  });

  it('ACCEPTS the legitimate small-COUNT edit 1 -> 3 that the refuted heuristic broke', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-hires', value: 3 }, '4'),
    });
    expect(res.statusCode).toBe(200);
    expect(observedStateOf(committedGraph(), 'f-hires')?.value).toBe(3);
  });

  it('ACCEPTS a count edit in BOTH directions — no one-way trapdoor', async () => {
    // 3 -> 1 then 1 -> 4. Under the refuted heuristic the second was refused
    // forever, because passing through [0,1] reclassified the factor.
    persisted = buildPersistedGraph();
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-hires', value: 1 }, '5'),
    });
    persisted = committedGraph();
    appendMock.mockClear();
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor({ kind: 'factor_value_edit', target_id: 'f-hires', value: 4 }, '6'),
    });
    expect(observedStateOf(committedGraph(), 'f-hires')?.value).toBe(4);
  });

  // ── NON-REGRESSION: the capped lane is untouched ─────────────────────────

  it('leaves the CAPPED £ factor on its existing cap guards — in-range lands', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        '7',
      ),
    });
    expect(res.statusCode).toBe(200);
    const obs = observedStateOf(committedGraph(), 'f-budget');
    expect(obs?.raw_value).toBe(50000);
    expect(obs?.value).toBeCloseTo(0.5, 10);
    expect(obs?.cap).toBe(100000);
  });

  it('leaves the CAPPED £ factor on its existing cap guards — above-cap still refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 2.5, raw_value: 250000, unit: '£' },
        '8',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
    expect(JSON.parse(res.body).assistant_text).toMatch(/haven't changed anything/i);
  });
});
