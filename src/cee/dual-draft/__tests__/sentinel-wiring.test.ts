/**
 * Phase 4 — end-to-end sentinel wiring proof, NO mocks.
 *
 * Uses the REAL prompt registry/defaults/loader to prove that the registered
 * `m2_graph_review` default is the fail-closed sentinel and that the real
 * reviewDraftGraph therefore stays inert (no router, no adapter, no LLM)
 * even when invoked directly — i.e. flag ON with unprovisioned prompt copy
 * can never reach a live model call.
 */
import { describe, it, expect } from 'vitest';
import { getSystemPrompt } from '../../../adapters/llm/prompt-loader.js';
import { reviewDraftGraph } from '../m2-review.js';
import { isM2PromptProvisioned, M2_PROMPT_NOT_PROVISIONED_SENTINEL } from '../prompt-sentinel.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

describe('Phase 4 — sentinel wiring (real prompt registry, no mocks)', () => {
  it('the registered m2_graph_review default IS the sentinel', async () => {
    const content = await getSystemPrompt('m2_graph_review', { forceDefault: true });
    expect(content).toContain(M2_PROMPT_NOT_PROVISIONED_SENTINEL);
    expect(isM2PromptProvisioned(content)).toBe(false);
  });

  it('real reviewDraftGraph is inert against the registered default: prompt_not_provisioned, no adapter involvement', async () => {
    const graph: GraphV3T = {
      nodes: [
        { id: 'goal_x', kind: 'goal', label: 'Goal' },
        { id: 'fac_y', kind: 'factor', label: 'Factor' },
      ],
      edges: [
        {
          from: 'fac_y',
          to: 'goal_x',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.8,
          effect_direction: 'positive',
        },
      ],
    } as GraphV3T;

    const res = await reviewDraftGraph({
      graph,
      brief: 'A real brief long enough to matter.',
      analysisReady: null,
      requestId: 'req-sentinel-e2e',
      scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      pipelineElapsedMs: 10_000,
    });

    // The sentinel fires before the model-resolution gate and before any
    // router/adapter involvement — this is the "flag ON but prompt missing →
    // inert" proof with the production wiring, not mocks.
    expect(res.kind).toBe('prompt_not_provisioned');
  });
});
