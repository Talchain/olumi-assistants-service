/**
 * Adversarial pins — M2 review failure paths not covered by
 * dual-draft/__tests__/m2-review.test.ts (gap-fill only, no repeats).
 *
 * Same fully-mocked harness as that suite: adapter, prompt loader and config
 * are mocked at module level; no live LLM call is possible from here.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

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
import { reviewDraftGraph } from '../../dual-draft/m2-review.js';
import type { EnrichmentInput } from '../../dual-draft/types.js';

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

function makeInput(): EnrichmentInput {
  return {
    graph: GRAPH,
    brief: 'Should we launch now?',
    analysisReady: null,
    requestId: 'req-adv',
    scenarioId: 'scen-1',
    turnId: 'turn-1',
    pipelineElapsedMs: 20_000,
  };
}

const chatMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  modelCfg.value = 'test-model';
  (getAdapterWithResolution as MockedFunction<typeof getAdapterWithResolution>).mockReturnValue({
    adapter: { chat: chatMock } as never,
    resolution: {
      task: 'm2_graph_review',
      resolved_model: 'test-model',
      resolution_source: 'env_var',
      provider: 'anthropic',
    },
  } as ReturnType<typeof getAdapterWithResolution>);
  (getSystemPrompt as MockedFunction<typeof getSystemPrompt>).mockResolvedValue('You are M2.');
});

function okChat(content: string) {
  chatMock.mockResolvedValue({ content, usage: {}, model: 'test-model', latencyMs: 100 });
}

describe('reviewDraftGraph — throw-shape edge cases', () => {
  it('adapter rejecting with a non-Error value → llm_error carrying String(err)', async () => {
    chatMock.mockRejectedValue('string-shaped failure');
    const res = await reviewDraftGraph(makeInput());
    expect(res).toEqual({ kind: 'llm_error', message: 'string-shaped failure' });
  });

  it('adapter rejecting with a plain object → llm_error, stringified, never a throw', async () => {
    chatMock.mockRejectedValue({ code: 529 });
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('llm_error');
    expect((res as { message: string }).message).toBe(String({ code: 529 }));
  });
});

describe('reviewDraftGraph — proposals-shape edge cases (structured outputs cannot be trusted)', () => {
  it('{"proposals": {}} (object, not array) → parse_failed', async () => {
    okChat('{"proposals": {}}');
    const res = await reviewDraftGraph(makeInput());
    expect(res).toEqual({ kind: 'parse_failed', message: 'output has no proposals array' });
  });

  it('{"proposals": null} → parse_failed', async () => {
    okChat('{"proposals": null}');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('parse_failed');
  });

  it('a bare JSON array (no wrapper object) → parse_failed', async () => {
    okChat('[]');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('parse_failed');
  });

  it('JSON null → parse_failed (optional-chain on null parses, proposals undefined)', async () => {
    okChat('null');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('parse_failed');
  });

  it('BOM-prefixed JSON → parse_failed (JSON.parse rejects a leading BOM)', async () => {
    okChat('\uFEFF{"proposals": []}');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('parse_failed');
  });

  it('leading whitespace/newlines before the JSON object → ok (JSON.parse tolerates them)', async () => {
    okChat('\n\n  {"proposals": []}');
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('ok');
    expect((res as { proposals: readonly unknown[] }).proposals).toEqual([]);
  });

  it('a 1000-item proposals array is returned intact at the review layer (capping is the merge’s job)', async () => {
    const flood = Array.from({ length: 1000 }, (_, i) => ({
      type: 'added_risk',
      delta: { node: { id: `risk_${i}`, kind: 'risk', label: `Risk ${i}` } },
      evidence_pointer: 'e',
    }));
    okChat(JSON.stringify({ proposals: flood }));
    const res = await reviewDraftGraph(makeInput());
    expect(res.kind).toBe('ok');
    expect((res as { proposals: readonly unknown[] }).proposals).toHaveLength(1000);
  });
});
