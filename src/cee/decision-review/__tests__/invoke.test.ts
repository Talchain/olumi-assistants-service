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
  getSystemPromptMeta: vi.fn(() => ({ prompt_version: 'v1' })),
}));

vi.mock('../science-claims.js', () => ({
  buildScienceClaimsSection: () => null,
  injectScienceClaimsSection: (p: string) => p,
}));

import * as routerMod from '../../../adapters/llm/router.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
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
