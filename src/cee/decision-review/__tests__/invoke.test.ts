/**
 * Direct regression guard for `invokeDecisionReview`.
 *
 * The V5 holistic audit (UU-16) flagged that the decision_review LLM call
 * lived on the legacy `getAdapter(...)` seam and therefore emitted no
 * `model_resolutions` telemetry. The migration in `claude/v5-audit-followup`
 * commit `dd0b3b80` moved `invoke.ts` to `getAdapterWithResolution(...)` and
 * added `resolution` to `DecisionReviewInvokeResult`.
 *
 * The existing enricher-level test (decision-review-enricher.test.ts)
 * mocks `invokeDecisionReview` wholesale — a silent refactor that dropped
 * `resolution` from the return shape would slip past it. This file tests
 * the invoke function DIRECTLY, asserting:
 *
 *   1. `getAdapterWithResolution` is called with the task ID `'decision_review'`.
 *   2. The `resolution` object returned by the router is propagated to the
 *      caller via `DecisionReviewInvokeResult.resolution` with reference
 *      equality (no copy/defensive-clone that could drift).
 *   3. Propagation holds on both happy path (`output` is a parsed JSON
 *      object) and degenerate path (`output === null` when extraction fails)
 *      — the resolution is known the moment the adapter is resolved, so
 *      token-spending degenerate calls still surface on the dashboard.
 *   4. `model` / `provider` fields come from the adapter's `chat` result and
 *      adapter name respectively (not from the resolution), proving the
 *      two are independent axes of information that both need to surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: vi.fn(),
  getMaxTokensFromConfig: vi.fn(() => 4096),
}));

vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn(async () => 'SYSTEM PROMPT'),
  // ⚠ DELIBERATELY DIVERGENT from the snapshot below — this models the real
  // transient store-failure path, where the loader serves DEFAULT bytes but
  // leaves an expired STORE entry in the cache for a separate meta read to
  // find. Any code that reads identity from here rather than from the bound
  // snapshot certifies the served bytes against the wrong prompt.
  getSystemPromptMeta: vi.fn(() => ({
    prompt_version: 'STALE-STORE-v1',
    prompt_hash: 'sha256:STALESTOREENTRYHASH',
    source: 'store',
  })),
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  // The BOUND resolution — content and meta from one entry. These are the
  // bytes actually sent, so this is the only identity that may be recorded.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'SYSTEM PROMPT',
    meta: {
      prompt_version: 'v1',
      prompt_hash: 'sha256:drpromptidentity01',
      source: 'default',
    },
  }),
}));

vi.mock('../science-claims.js', () => ({
  buildScienceClaimsSection: () => null,
  injectScienceClaimsSection: (p: string) => p,
}));

import * as routerMod from '../../../adapters/llm/router.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import { setTestSink } from '../../../utils/telemetry.js';
import {
  invokeDecisionReview,
  type DecisionReviewInvokeInput,
} from '../invoke.js';

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

function baseInput(): DecisionReviewInvokeInput {
  return {
    brief: 'Decision brief about pricing strategy',
    brief_hash: 'abc123',
    graph: { nodes: [], edges: [] },
    isl_results: { summary: 'ran' },
    deterministic_coaching: { cards: [] },
    winner: { id: 'opt-1', label: 'Option A', win_probability: 0.7 },
    runner_up: { id: 'opt-2', label: 'Option B', win_probability: 0.3 },
  };
}

function makeAdapterStub(content: string, overrides: Partial<{ name: string; model: string }> = {}) {
  return {
    name: overrides.name ?? 'openai',
    model: overrides.model ?? 'gpt-4.1',
    chat: vi.fn().mockResolvedValue({
      content,
      usage: { input_tokens: 10, output_tokens: 20 },
      model: overrides.model ?? 'gpt-4.1',
      latencyMs: 42,
    }),
  };
}

describe('invokeDecisionReview — UU-16 regression guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes via getAdapterWithResolution("decision_review") — not the legacy getAdapter seam', async () => {
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}');
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION,
    });

    await invokeDecisionReview(baseInput(), { requestId: 'req-1', timeoutMs: 15_000 });

    expect(routerMod.getAdapterWithResolution).toHaveBeenCalledTimes(1);
    expect(routerMod.getAdapterWithResolution).toHaveBeenCalledWith('decision_review');
  });

  it('propagates the resolution object through DecisionReviewInvokeResult (reference equality)', async () => {
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}');
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION,
    });

    const result = await invokeDecisionReview(baseInput(), {
      requestId: 'req-1',
      timeoutMs: 15_000,
    });

    // Reference equality: the enricher forwards `result.resolution` to
    // recordModelResolution unchanged. A defensive clone here would hide a
    // future bug that mutates resolution before forwarding.
    expect(result.resolution).toBe(MOCK_RESOLUTION);
    expect(result.resolution.task).toBe('decision_review');
    expect(result.resolution.resolved_model).toBe('gpt-4.1');
    expect(result.resolution.resolution_source).toBe('task_default');
    expect(result.resolution.provider).toBe('openai');
  });

  it('propagates resolution when shape extraction returns non-object (output === null)', async () => {
    // Token-spending degenerate case: adapter returned JSON that parsed
    // fine but was an array / primitive rather than the expected object
    // (invoke.ts filters to plain objects). The enricher still needs to
    // see `resolution` so the dashboard records the spent tokens against
    // the correct model — the whole point of UU-16. An array satisfies the
    // extractor (it finds valid JSON) while failing invoke.ts's
    // `typeof === 'object' && !Array.isArray(...)` filter.
    const adapter = makeAdapterStub('[1, 2, 3]');
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION,
    });

    const result = await invokeDecisionReview(baseInput(), {
      requestId: 'req-1',
      timeoutMs: 15_000,
    });

    expect(result.output).toBeNull();
    expect(result.resolution).toBe(MOCK_RESOLUTION);
  });

  it('surfaces model from the adapter chat result and provider from adapter.name (independent of resolution)', async () => {
    // Resolution carries the *routing decision* ("we picked gpt-4.1 via
    // task_default"). model/provider on the result carry the *actual
    // response attribution* ("the adapter reported gpt-4.1 answered via
    // openai"). Both need to surface; they are decoupled deliberately so
    // failover or adapter-level model substitutions show up distinctly
    // from routing. Guard against a refactor that collapses them.
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}', {
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION, // still says openai / gpt-4.1
    });

    const result = await invokeDecisionReview(baseInput(), {
      requestId: 'req-1',
      timeoutMs: 15_000,
    });

    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.provider).toBe('anthropic');
    // Resolution unchanged — provider mismatch on purpose, asserts the two
    // fields are independent axes of information.
    expect(result.resolution.provider).toBe('openai');
    expect(result.resolution.resolved_model).toBe('gpt-4.1');
  });

  it('returns the SERVED prompt identity so the caller can attribute the analysis brief', async () => {
    // `invoke.ts` already read `promptMeta.prompt_hash` for its context-budget
    // event but never RETURNED it, so every downstream consumer — including
    // the diagnostic trace of the most user-facing LLM call in the product —
    // had no identity to record. This is the producer hop of that thread.
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}');
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION,
    });

    const result = await invokeDecisionReview(baseInput(), {
      requestId: 'req-prompt-identity',
      timeoutMs: 15_000,
    });

    // Derived from the loader (the producer), not from a value invented here.
    expect(result.prompt_hash).toBe('sha256:drpromptidentity01');
    expect(result.prompt_version).toBe('v1');
    // The loader's OWN verdict, threaded verbatim — not relabelled 'pms'.
    // A hardcoded-default prompt reported as store-managed would be exactly
    // the untruth this attribution exists to prevent.
    expect(result.prompt_source).toBe('default');

    // DISCRIMINATION — the load-bearing half. `getSystemPromptMeta` is mocked
    // to a DIFFERENT, stale store identity, mirroring the real transient
    // store-failure path. Reverting to the unbound two-read pattern would make
    // these three assertions report the stale entry and RED here, which is what
    // makes the binding a tested property rather than a docblock claim.
    expect(result.prompt_hash).not.toBe('sha256:STALESTOREENTRYHASH');
    expect(result.prompt_version).not.toBe('STALE-STORE-v1');
    expect(result.prompt_source).not.toBe('store');
  });

  it('RIDER-B — a per-call model override routes as a per_call source; the default path is unchanged', async () => {
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}', { name: 'anthropic', model: 'claude-sonnet-5' });
    // Cast to the resolution return type (the stub omits unused LLMAdapter methods)
    // so this new line adds no typecheck-drift beyond the file's existing baseline.
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue(
      { adapter, resolution: MOCK_RESOLUTION } as unknown as ReturnType<typeof routerMod.getAdapterWithResolution>,
    );

    // Override present → model + per_call origin threaded to the router.
    await invokeDecisionReview(baseInput(), { requestId: 'req-ab', timeoutMs: 15_000, model: 'claude-sonnet-5' });
    expect(routerMod.getAdapterWithResolution).toHaveBeenLastCalledWith('decision_review', 'claude-sonnet-5', 'per_call');

    vi.mocked(routerMod.getAdapterWithResolution).mockClear();

    // Override ABSENT → EXACTLY the single-arg default call (byte-identical, no live switch).
    await invokeDecisionReview(baseInput(), { requestId: 'req-default', timeoutMs: 15_000 });
    expect(routerMod.getAdapterWithResolution).toHaveBeenLastCalledWith('decision_review');
  });

  it('forwards requestId and timeoutMs to the adapter chat call', async () => {
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}');
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION,
    });

    await invokeDecisionReview(baseInput(), { requestId: 'req-xyz', timeoutMs: 7_500 });

    expect(adapter.chat).toHaveBeenCalledTimes(1);
    const [, callOpts] = adapter.chat.mock.calls[0]!;
    expect(callOpts.requestId).toBe('req-xyz');
    expect(callOpts.timeoutMs).toBe(7_500);
  });
});

describe('invokeDecisionReview — v5.context_budget must say whether the model got a graph', () => {
  /**
   * ⚠⚠ THE MEASURED HARM (enricher docs, `decision-review-enricher.ts:121-134`).
   * A real user session reported `section_chars: { graph_json: 21, ... }`, and
   * it took a human comparing three hypothetical renderings — `{}` is 21,
   * `{nodes:[],edges:[]}` is 51, a one-node graph 103 — to establish that the
   * REVIEWING MODEL HAD BEEN SENT NO GRAPH AT ALL. The manifest says it
   * outright. A producer mutant (`graph_json: {}`) survived every suite in this
   * repo before this test existed.
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  async function budgetPayloadFor(
    graph: DecisionReviewInvokeInput['graph'],
  ): Promise<Record<string, unknown>> {
    const captured: { event: string; payload: Record<string, unknown> }[] = [];
    setTestSink((event, payload) => {
      captured.push({ event, payload: payload as Record<string, unknown> });
    });
    const adapter = makeAdapterStub('{"narrative_summary":"ok"}');
    // Cast scoped to THIS block. `makeAdapterStub` omits five LLMAdapter
    // methods this path never calls, which is a pre-existing type error on six
    // other lines of this file (measured: 6 at pristine). Those are not this
    // lane's to fix, but adding a SEVENTH would move the `Typecheck Drift`
    // ratchet — so the new call site is typed rather than absorbed.
    vi.mocked(routerMod.getAdapterWithResolution).mockReturnValue({
      adapter,
      resolution: MOCK_RESOLUTION,
    } as unknown as ReturnType<typeof routerMod.getAdapterWithResolution>);
    await invokeDecisionReview(
      { ...baseInput(), graph },
      { requestId: 'req-manifest', timeoutMs: 15_000 },
    );
    const events = captured.filter(
      (c) =>
        c.event === 'v5.context_budget' &&
        (c.payload as { call_site?: string }).call_site === 'decision_review',
    );
    expect(events, 'precondition: exactly one decision_review budget event was emitted').toHaveLength(1);
    return events[0].payload;
  }

  it('DISCRIMINATES an empty graph from a real one, through the real assembly path', async () => {
    const emptyPayload = await budgetPayloadFor({ nodes: [], edges: [] });
    const realPayload = await budgetPayloadFor({
      nodes: [
        { id: 'opt-1', label: 'Option A' },
        { id: 'opt-2', label: 'Option B' },
      ],
      edges: [{ from: 'opt-1', to: 'opt-2' }],
    } as DecisionReviewInvokeInput['graph']);

    const emptyShape = emptyPayload.section_shape as Record<string, Record<string, number>>;
    const realShape = realPayload.section_shape as Record<string, Record<string, number>>;

    // Bind by IDENTITY to the counts the builder actually put in the <GRAPH>
    // block — read back off the assembled user message, not off the input.
    expect(emptyShape.graph_json.nodes).toBe(0);
    expect(emptyShape.graph_json.edges).toBe(0);
    expect(realShape.graph_json.nodes).toBe(2);
    expect(realShape.graph_json.edges).toBe(1);
    expect(emptyShape.graph_json).not.toEqual(realShape.graph_json);
  });

  it('the CALL SITE emits every section as a finite number (NOT a claim about redaction — see below)', async () => {
    // ⚠ SCOPE, stated so this cannot be misread as covering the sha8 defect:
    // `emit()` calls the test sink BEFORE `log.info`, so this payload has not
    // been through pino redaction. It proves the PRODUCER passes counts; the
    // claim that those counts survive the logger is a different claim, proven
    // against the real `createLoggerConfig` boundary in
    // `orchestrator-v5/context/__tests__/context-budget-sections-are-measurements.test.ts`.
    const payload = await budgetPayloadFor({ nodes: [], edges: [] });
    const sectionChars = payload.section_chars as Record<string, unknown>;
    for (const [section, value] of Object.entries(sectionChars)) {
      expect(
        typeof value === 'number' && Number.isFinite(value),
        `section_chars.${section} must be a finite number, got ${JSON.stringify(value)}`,
      ).toBe(true);
    }
    expect(sectionChars.brief as number).toBeGreaterThan(0);
  });
});
