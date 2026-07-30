/**
 * ROADMAP 2.159 — normalised factor bounds, END-TO-END on the route.
 *
 * THE DEFECT (Codex P1, live-proven 31 Jul): editing a NORMALISED `[0,1]`
 * factor to `1.5` was ACCEPTED and PERSISTED end-to-end. CEE's range guard
 * runs only when a `cap` exists (`evaluate-factor-value-proposal.ts` §6), and
 * `normaliseFactorValue` writes `value = raw_value = 1.5` verbatim when the
 * cap is absent — so "uncapped" was silently conflated with "unbounded" for
 * factors whose declared model scale IS the unit interval (binary/one-hot
 * indicators, ordinal 0-1 encodings, inferred `0.5` baselines, qualitative
 * Low/Medium/High = 0.2/0.5/0.8 — see `prompts/defaults-v187.ts`
 * EXTRACTION_RULES + SCALE_DISCIPLINE). The persisted `1.5` then feeds every
 * downstream delta as if it were a proportion.
 *
 * These tests replay that exact event against the route:
 *   - `1.5` on `{ value: 0.65 }`  → REFUSED, no write, honest copy that states
 *                                   the bound AND the received value.
 *   - `-0.2` on the same factor   → REFUSED (the bound is two-sided).
 *   - `0.65` on the same factor   → STILL LANDS (the control; the fix must not
 *                                   break the in-range edit).
 *   - the capped `£` factor       → untouched by this change.
 *
 * Reuses `route-v2-factor-value-edit.test.ts`'s harness shape deliberately:
 * this is the same wire event, the same store mock, the same route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ── the persisted model ────────────────────────────────────────────────────
// `f-adoption` is the NORMALISED factor: no cap, no unit, model value 0.65.
// That is exactly the state the estate's own integrity pass calls a
// "qualitative 0-1 factor" (`cee/transforms/graph-data-integrity.ts`
// `shouldSkipScaleCheck`) and clamps interventions against ("factor values
// are normalised", same file).
//
// `f-budget` is the CAPPED control — £, cap 100000 — whose existing guards
// this change must leave byte-identical.
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

/** The graph the commit actually handed the store, or undefined if none. */
function committedGraph(): Record<string, unknown> | undefined {
  const call = appendMock.mock.calls.at(-1);
  const arg = call?.[0] as { graph?: Record<string, unknown> } | undefined;
  return arg?.graph;
}

function observedStateOf(
  graph: Record<string, unknown> | undefined,
  id: string,
): Record<string, unknown> | undefined {
  const nodes = (graph?.nodes ?? []) as Array<{ id: string; observed_state?: Record<string, unknown> }>;
  return nodes.find((n) => n.id === id)?.observed_state;
}

describe('POST /orchestrate/v2/turn — normalised factor bounds (ROADMAP 2.159)', () => {
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

  // ── THE LIVE EVENT ───────────────────────────────────────────────────────

  it('REFUSES 1.5 on a normalised [0,1] factor — no write, no clamp, no 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        // The exact live event: a normalised factor edited to 1.5.
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: 1.5 },
        '0',
      ),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // The turn is still committed (the transcript records the refusal) but NO
    // graph is written — this is the assertion that was false before the fix.
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedGraph()).toBeUndefined();

    // NOT SILENTLY CLAMPED, and the copy is honest.
    expect(body.assistant_text).toMatch(/haven't changed anything/i);
    expect(body.blocks).toEqual([]);
    // Prediction-free copy: state the BOUND and the RECEIVED VALUE, nothing
    // about what the analysis would have done.
    expect(body.assistant_text).toContain('1.5');
    expect(body.assistant_text).toMatch(/0 to 1/);
  });

  it('THE REFUSAL SHAPE ON THE WIRE — pinned for the UI half', async () => {
    // ⚠ THIS TEST EXISTS FOR ANOTHER REPO. The UI's #524 reject-revert keys off
    // a CEE refusal, and the UI-feedback half of ROADMAP 2.159 builds min/max
    // hints against exactly this payload. Pin it here so a CEE-side change to
    // the refusal shape shows up as a RED in CEE rather than as a silent
    // regression in the UI.
    //
    // ⚠ AND NOTE WHAT IS ABSENT: there is NO structured bound on the wire — no
    // min, no max, no rejection code. The bound exists only inside the prose.
    // Carrying it structurally needs a declared contract field (see the CEE-half
    // section of PHASE0-EVIDENCE-2026-07-28/fix-factor-bounds.md).
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: 1.5 },
        '8',
      ),
    });
    const body = JSON.parse(res.body);

    expect(body).toEqual({
      response_version: 2,
      assistant_text:
        "This factor is on a 0 to 1 scale, and the value given was 1.5. " +
        "I haven't changed anything. Tell me what you'd like instead and I'll apply it.",
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

  it('REFUSES a negative value on a normalised [0,1] factor — the bound is two-sided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: -0.2 },
        '1',
      ),
    });

    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
    expect(JSON.parse(res.body).assistant_text).toMatch(/haven't changed anything/i);
  });

  // ── THE CONTROL ──────────────────────────────────────────────────────────

  it('STILL LANDS an in-range 0.65 edit on the same normalised factor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-adoption', value: 0.8 },
        '2',
      ),
    });

    expect(res.statusCode).toBe(200);
    const graph = committedGraph();
    expect(graph).toBeDefined();
    const obs = observedStateOf(graph, 'f-adoption');
    expect(obs?.value).toBeCloseTo(0.8, 10);
    // Uncapped stores raw and model identically (normalise-factor-value.ts).
    expect(obs?.raw_value).toBeCloseTo(0.8, 10);
    // No cap is invented by the guard — the bound is derived, never persisted.
    expect(obs?.cap).toBeUndefined();
  });

  it('accepts the boundary values 0 and 1 exactly', async () => {
    // Turn ids are UUIDs — the base is 35 chars, so each suffix is ONE char.
    for (const [value, suffix] of [[0, '6'], [1, '7']] as const) {
      appendMock.mockClear();
      persisted = buildPersistedGraph();
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(
          { kind: 'factor_value_edit', target_id: 'f-adoption', value },
          suffix,
        ),
      });
      expect(res.statusCode).toBe(200);
      expect(observedStateOf(committedGraph(), 'f-adoption')?.value).toBeCloseTo(value, 10);
    }
  });

  // ── NON-REGRESSION: the capped lane is untouched ─────────────────────────

  it('leaves the CAPPED £ factor on its existing cap guards — in-range lands', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
        '4',
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
        '5',
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeUndefined();
    expect(JSON.parse(res.body).assistant_text).toMatch(/haven't changed anything/i);
  });
});
