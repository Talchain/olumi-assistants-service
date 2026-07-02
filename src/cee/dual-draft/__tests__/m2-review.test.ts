/**
 * Phase 2 M2-review-caller tests (RED-first).
 *
 * Every M2 failure mode must resolve to a typed non-ok outcome — never a
 * throw: sentinel prompt (fail-closed until Paul-authored copy exists),
 * loader error, insufficient headroom, adapter timeout, adapter error,
 * unparseable output. The adapter and prompt loader are mocked at module
 * level; no live LLM call is possible from this suite.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

// Hoisted holder so the configured M2 model can vary per test (the
// model-resolution gate requires CEE_MODEL_M2_REVIEW to be explicitly set AND
// to match the router's resolved model — activation ruling: unset/blocked/
// unexpected resolution must leave the stage inert, never silently active).
const modelCfg = vi.hoisted(() => ({ value: 'test-model' as string | undefined }));

vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      cee: {
        ...actual.config.cee,
        models: {
          ...actual.config.cee.models,
          get m2_review() {
            return modelCfg.value;
          },
        },
      },
    },
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn(),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: vi.fn(),
}));

import { getSystemPrompt } from '../../../adapters/llm/prompt-loader.js';
import { getAdapterWithResolution } from '../../../adapters/llm/router.js';
import { reviewDraftGraph } from '../m2-review.js';
import { M2_PROMPT_NOT_PROVISIONED_SENTINEL } from '../prompt-sentinel.js';
import { M2_REVIEW_TIMEOUT_MS } from '../../../config/timeouts.js';
import { UpstreamTimeoutError } from '../../../adapters/llm/errors.js';
import type { EnrichmentInput } from '../types.js';

const GRAPH: GraphV3T = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price point' },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
} as GraphV3T;

function makeInput(overrides: Partial<EnrichmentInput> = {}): EnrichmentInput {
  return {
    graph: GRAPH,
    brief: 'Should we launch now?',
    analysisReady: null,
    requestId: 'req-m2',
    scenarioId: 'scen-1',
    turnId: 'turn-1',
    pipelineElapsedMs: 20_000,
    ...overrides,
  };
}

const chatMock = vi.fn();

function wireAdapter(resolvedModel = 'test-model', provider = 'anthropic') {
  (getAdapterWithResolution as MockedFunction<typeof getAdapterWithResolution>).mockReturnValue({
    adapter: { chat: chatMock } as never,
    resolution: {
      task: 'm2_graph_review',
      resolved_model: resolvedModel,
      resolution_source: 'env_var',
      provider,
    },
  } as ReturnType<typeof getAdapterWithResolution>);
}

function okChat(content: string) {
  chatMock.mockResolvedValue({ content, usage: {}, model: 'test-model', latencyMs: 100 });
}

describe('reviewDraftGraph — model-resolution gate (activation ruling: inert + loud, never silently active)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelCfg.value = 'test-model';
    wireAdapter();
    (getSystemPrompt as MockedFunction<typeof getSystemPrompt>).mockResolvedValue('You are M2.');
  });

  it('CEE_MODEL_M2_REVIEW unset → model_not_resolved (cause model_unset), adapter NEVER called', async () => {
    modelCfg.value = undefined;
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('model_not_resolved');
    if (res.kind === 'model_not_resolved') expect(res.cause).toBe('model_unset');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('router resolves a DIFFERENT model than configured (blocked/failover) → model_not_resolved (cause model_mismatch), adapter never called', async () => {
    wireAdapter('some-other-model');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('model_not_resolved');
    if (res.kind === 'model_not_resolved') expect(res.cause).toBe('model_mismatch');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('model resolving to a non-Anthropic provider → model_not_resolved (cause provider_unsupported), adapter never called', async () => {
    wireAdapter('test-model', 'openai');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('model_not_resolved');
    if (res.kind === 'model_not_resolved') expect(res.cause).toBe('provider_unsupported');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('configured model matching the resolution proceeds to the LLM call', async () => {
    okChat(JSON.stringify({ proposals: [] }));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('ok');
    expect(chatMock).toHaveBeenCalledOnce();
  });
});

describe('reviewDraftGraph — fail-closed and degrade paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelCfg.value = 'test-model';
    wireAdapter();
    (getSystemPrompt as MockedFunction<typeof getSystemPrompt>).mockResolvedValue('You are M2.');
  });

  it('sentinel prompt → prompt_not_provisioned, adapter NEVER called (G17 fail-closed)', async () => {
    (getSystemPrompt as MockedFunction<typeof getSystemPrompt>).mockResolvedValue(
      `placeholder ${M2_PROMPT_NOT_PROVISIONED_SENTINEL}`,
    );
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('prompt_not_provisioned');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('prompt loader throws → prompt_not_provisioned, adapter never called', async () => {
    (getSystemPrompt as MockedFunction<typeof getSystemPrompt>).mockRejectedValue(
      new Error('Unknown LLM operation'),
    );
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('prompt_not_provisioned');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('insufficient headroom (pipeline already slow) → skip, adapter never called (G2)', async () => {
    const res = await reviewDraftGraph(makeInput({ pipelineElapsedMs: 999_999 }));
    expect(res.kind).toBe('insufficient_headroom');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('adapter timeout-shaped rejection → timeout', async () => {
    chatMock.mockRejectedValue(new Error(`Request timed out after ${M2_REVIEW_TIMEOUT_MS}ms`));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('timeout');
  });

  it('adapter abort-shaped rejection → timeout', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    chatMock.mockRejectedValue(err);
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('timeout');
  });

  it('adapter generic rejection → llm_error', async () => {
    chatMock.mockRejectedValue(new Error('upstream 500'));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('llm_error');
  });

  it("adapters' typed UpstreamTimeoutError → timeout (the real anthropic path converts AbortError to it)", async () => {
    chatMock.mockRejectedValue(
      new UpstreamTimeoutError('Anthropic chat timed out', 'anthropic', 'chat', 'body', 25_000),
    );
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('timeout');
  });

  it('UpstreamTimeoutError with pre_aborted phase (client disconnect, NOT a timeout) → llm_error', async () => {
    chatMock.mockRejectedValue(
      new UpstreamTimeoutError('request pre-aborted', 'anthropic', 'chat', 'pre_aborted', 1_000),
    );
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('llm_error');
  });

  it("non-timeout message containing 'abort' (e.g. upstream 529) → llm_error, not timeout", async () => {
    chatMock.mockRejectedValue(new Error('request aborted by upstream: 529 overloaded'));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('llm_error');
  });

  it('non-JSON content → parse_failed', async () => {
    okChat('this is not json');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('parse_failed');
  });

  it('JSON without a proposals array → parse_failed', async () => {
    okChat(JSON.stringify({ notproposals: [] }));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('parse_failed');
  });
});

describe('reviewDraftGraph — success path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelCfg.value = 'test-model';
    wireAdapter();
    (getSystemPrompt as MockedFunction<typeof getSystemPrompt>).mockResolvedValue('You are M2.');
  });

  it('returns ok with raw proposals when the adapter returns {proposals: [...]}', async () => {
    const proposals = [
      { type: 'added_risk', delta: { node: { id: 'risk_x', kind: 'risk', label: 'X' } }, evidence_pointer: 'e' },
    ];
    okChat(JSON.stringify({ proposals }));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.proposals).toEqual(proposals);
      expect(res.model).toBe('test-model');
    }
  });

  it('passes the M2 timeout, structured-outputs schema, and temperature 0 to the adapter', async () => {
    okChat(JSON.stringify({ proposals: [] }));
    await reviewDraftGraph(makeInput());
    expect(chatMock).toHaveBeenCalledOnce();
    const [args, opts] = chatMock.mock.calls[0];
    expect(args.temperature).toBe(0);
    expect(args.outputSchema).toBeDefined();
    expect(args.system).toBe('You are M2.');
    expect(args.userMessage).toContain('Should we launch now?');
    expect(args.userMessage).toContain('fac_price');
    expect(opts.timeoutMs).toBe(M2_REVIEW_TIMEOUT_MS);
    expect(opts.requestId).toBe('req-m2');
  });

  it('an empty proposals array is a valid success ("draft is sound")', async () => {
    okChat(JSON.stringify({ proposals: [] }));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.proposals).toEqual([]);
  });
});
