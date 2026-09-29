/**
 * Edit-graph receives raw numeric edge parameters (brief A2.1 isolation).
 *
 * The display-safe graph projection (A2.1) substitutes a `display_graph`
 * (decision-language `relationship` phrases) for `graph` in the LLM-facing
 * routing context pack. Edit-graph dispatch lives on a wholly separate
 * path: `serialiseEditContextForLLM` calls `editCompactGraph()` against
 * the raw `GraphV3T`, never touching the routing's ContextPack projection.
 *
 * This test pins that contract: the edit-graph LLM context contains
 * numeric `strength_mean`, `strength_std`, `exists_probability` so that
 * the LLM can produce valid `PatchOperation` objects. If A2.1 ever
 * accidentally reroutes edit-graph through the display-safe projection,
 * this test will fail with `relationship` strings instead of numerics.
 */

import { describe, expect, it } from 'vitest';

import {
  editCompactGraph,
  serialiseEditContextForLLM,
} from '../../../../src/orchestrator/context/serialise.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';

function makeRawGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Revenue' },
      { id: 'factor_1', kind: 'factor', label: 'Price' },
      { id: 'factor_2', kind: 'factor', label: 'Marketing' },
    ],
    edges: [
      {
        from: 'factor_1',
        to: 'goal_1',
        strength: { mean: 0.65, std: 0.12 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'factor_2',
        to: 'goal_1',
        strength: { mean: -0.4, std: 0.15 },
        exists_probability: 0.7,
        effect_direction: 'negative',
      },
    ],
  } as unknown as GraphV3T;
}

describe('edit-graph isolation — raw numeric edge parameters survive A2.1', () => {
  it('editCompactGraph emits numeric strength_mean / strength_std / exists_probability', () => {
    const compact = editCompactGraph(makeRawGraph());

    expect(compact.edges).toHaveLength(2);
    const e0 = compact.edges[0]!;
    expect(typeof e0.strength_mean).toBe('number');
    expect(e0.strength_mean).toBe(0.65);
    expect(typeof e0.strength_std).toBe('number');
    expect(e0.strength_std).toBe(0.12);
    expect(typeof e0.exists_probability).toBe('number');
    expect(e0.exists_probability).toBe(0.9);
    expect(e0.effect_direction).toBe('positive');

    const e1 = compact.edges[1]!;
    expect(e1.strength_mean).toBe(-0.4);
    expect(e1.exists_probability).toBe(0.7);
    expect(e1.effect_direction).toBe('negative');
  });

  it('serialiseEditContextForLLM emits raw numeric edge JSON (not display-safe phrases)', () => {
    const ctx: ConversationContext = {
      graph: makeRawGraph() as unknown as ConversationContext['graph'],
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'test-scenario',
    } as ConversationContext;

    const llmContext = serialiseEditContextForLLM(ctx);

    // Raw numeric fields present and parseable. truncateGraphJson emits
    // compact JSON (no `: ` separator).
    expect(llmContext).toMatch(/"strength_mean":\s?0\.65/);
    expect(llmContext).toMatch(/"strength_std":\s?0\.12/);
    expect(llmContext).toMatch(/"exists_probability":\s?0\.9/);
    expect(llmContext).toMatch(/"effect_direction":\s?"positive"/);

    // No display-safe leakage — A2.1's vocabulary should NOT appear in the
    // edit-graph context. If these ever do, edit-graph's LLM will lose
    // the numeric grounding it needs to emit valid PatchOperations.
    expect(llmContext).not.toMatch(/relationship/);
    expect(llmContext).not.toMatch(/positive link/);
    expect(llmContext).not.toMatch(/negative link/);
    expect(llmContext).not.toMatch(/negligible link/);
  });
});
