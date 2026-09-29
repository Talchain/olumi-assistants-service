/**
 * Unit tests for the what-if lens orchestrator (selector → builder → ISL →
 * card), with an injected fake transport.
 *
 * Positive control + the fail-loud matrix: the lens emits a card ONLY with a
 * validated 2xx for the exact intervention; ANY absence or failure emits null,
 * and the ISL client is not even called when there is no probe / no mappable
 * model.
 */

import { describe, it, expect, vi } from 'vitest';

import { runCounterfactualLens } from '../run-counterfactual-lens.js';
import type {
  CounterfactualClient,
  CounterfactualResult,
} from '../../../../../adapters/isl/counterfactual-client.js';
import type { FlipSummary } from '../../../../compose/flip-proposal.js';
import type { RawRobustnessSignals } from '../../../../coaching/robustness-honesty.js';

const FRAGILE: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: false };

const CONCRETE_FLIP: FlipSummary = {
  overall_status: 'concrete',
  margin_supports_flip: true,
  entries: [{ factor_id: 'factor_capacity', factor_label: 'Engineering capacity', flip_value: 18 }],
};

function mappableGraph() {
  return {
    nodes: [
      { id: 'goal_fit', kind: 'goal', label: 'Goal fit', observed_state: { value: 0 } },
      {
        id: 'factor_capacity',
        kind: 'factor',
        label: 'Engineering capacity',
        observed_state: { value: 10, cap: 20, unit: 'engineers' },
      },
      { id: 'factor_cost', kind: 'factor', label: 'Hiring cost', observed_state: { value: 5 } },
    ],
    edges: [
      {
        from: 'factor_capacity',
        to: 'goal_fit',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'factor_cost',
        to: 'goal_fit',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'negative',
      },
    ],
  };
}

function okResponse(outcome = 'goal_fit'): CounterfactualResult {
  return {
    ok: true,
    response: {
      scenario: { intervention: { factor_capacity: 20 }, outcome },
      prediction: {
        point_estimate: 12,
        confidence_interval: { lower: 12, upper: 12 },
        sensitivity_range: { optimistic: 14, pessimistic: 10, explanation: 'x' },
      },
      uncertainty: { overall: 'low', sources: [] },
      robustness: { score: 'robust', critical_assumptions: [] },
      explanation: { summary: 's', reasoning: 'r', technical_basis: 't', assumptions: [] },
    } as never,
  };
}

function fakeClient(result: CounterfactualResult): { client: CounterfactualClient; calls: () => number } {
  const fn = vi.fn(async () => result);
  return { client: { getCounterfactual: fn }, calls: () => fn.mock.calls.length };
}

function baseInput(over?: Partial<Parameters<typeof runCounterfactualLens>[0]>) {
  return {
    client: fakeClient(okResponse()).client,
    graphForTurn: mappableGraph(),
    flipSummary: CONCRETE_FLIP,
    rawRobustness: FRAGILE,
    requestId: 'req-lens',
    signal: new AbortController().signal,
    ...over,
  };
}

describe('runCounterfactualLens — positive control', () => {
  it('emits a claim-safe card on a validated 2xx for the asked intervention', async () => {
    const result = await runCounterfactualLens(baseInput());
    expect(result).not.toBeNull();
    expect(result!.card).toContain('Engineering capacity');
    expect(result!.card).toContain('Goal fit');
    expect(result!.card).toContain('20 engineers');
    expect(result!.trigger).toBe('fragile_concrete_flip');
  });
});

describe('runCounterfactualLens — fail loud', () => {
  it('null client (latent) → null, no call attempted', async () => {
    const result = await runCounterfactualLens(baseInput({ client: null }));
    expect(result).toBeNull();
  });

  it('no concrete flip → null AND the ISL client is never called', async () => {
    const fake = fakeClient(okResponse());
    const result = await runCounterfactualLens(
      baseInput({ client: fake.client, flipSummary: { ...CONCRETE_FLIP, overall_status: 'none', entries: [] } }),
    );
    expect(result).toBeNull();
    expect(fake.calls()).toBe(0);
  });

  it('unmappable graph → null AND the ISL client is never called', async () => {
    const fake = fakeClient(okResponse());
    const result = await runCounterfactualLens(baseInput({ client: fake.client, graphForTurn: { bad: true } }));
    expect(result).toBeNull();
    expect(fake.calls()).toBe(0);
  });

  it.each(['invalid_input', 'non_2xx', 'timeout', 'network', 'unparsable'] as const)(
    'ISL %s → null (base answer byte-preserved)',
    async (reason) => {
      const result = await runCounterfactualLens(baseInput({ client: fakeClient({ ok: false, reason }).client }));
      expect(result).toBeNull();
    },
  );

  it('response for a different outcome → null (defensive mismatch guard)', async () => {
    const result = await runCounterfactualLens(
      baseInput({ client: fakeClient(okResponse('some_other_var')).client }),
    );
    expect(result).toBeNull();
  });
});
