/** RC5: a direct canvas write is applied, then the same reply asks about its implied current goal level. */
import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../factor-value-edit.js';

const SUBSCRIBERS_ID = 'pro_paying_subscribers';
const EXPECTED_ASK = 'At £49 × 8,000, MRR today would be about £390,000, about 20 times your £20,000 target, so the goal would already be met. Is 8,000 your Pro paying subscribers, or a different count, for example all users?';

function persistedGraph() {
  return {
    goal_node_id: 'mrr',
    nodes: [
      {
        id: 'mrr', kind: 'goal', label: 'MRR',
        goal_direction: '>=', goal_threshold: 0.8,
        goal_threshold_raw: 20000, goal_threshold_unit: '£/month',
        goal_threshold_cap: 25000, goal_threshold_frame: 'level',
        threshold_source: 'brief_extraction',
        nonlinear_identity: {
          operation: 'product', factor_ids: ['pro_plan_price', SUBSCRIBERS_ID], stated_in_brief: true,
        },
      },
      {
        id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price',
        observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: '£/month', source: 'brief_extraction' },
      },
      {
        id: SUBSCRIBERS_ID, kind: 'factor', label: 'Pro paying subscribers',
        observed_state: { value: 0.015, raw_value: 300, cap: 20000, unit: 'subscribers', source: 'cee_inference' },
      },
    ],
    edges: ['pro_plan_price', SUBSCRIBERS_ID].map((from) => ({
      from, to: 'mrr', strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1, effect_direction: 'positive',
    })),
  };
}

describe('factor_value_edit — RC5 goal coherence on the mutated success path', () => {
  it('applies 300 → 8,000 and returns the exact ask plus both controls bound to the edited id', async () => {
    // Reuse the typed event/payload harness from factor-value-edit-native-panel-scale.test.ts.
    const event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }> = {
      kind: 'factor_value_edit', target_id: SUBSCRIBERS_ID, field: 'value',
      value: 0.4, raw_value: 8000, unit: 'subscribers', intent: 'set',
    };
    const payload: SystemEventTurnPayload = {
      kind: 'system_event', scenario_id: '11111111-1111-4111-8111-111111111111',
      turn_id: '77777777-7777-4777-8777-777777777777', stage: 'analyse', event,
    };
    const result = await applyFactorValueEdit({
      payload, event, requestId: 'req-goal-coherence', persistedGraph: persistedGraph(), priorFacts: [],
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(result.response.assistant_text).toContain(EXPECTED_ASK);
    expect(result.response.suggested_actions).toEqual(expect.arrayContaining([
      {
        id: `coherence-keep:${SUBSCRIBERS_ID}`,
        label: 'Yes, 8,000 Pro paying subscribers',
        message: "Yes, 8,000 is right for 'Pro paying subscribers'.",
      },
      {
        id: `coherence-change:${SUBSCRIBERS_ID}`,
        label: 'No, let me change it',
        message: "No, I'll change 'Pro paying subscribers'.",
      },
    ]));
    const edited = result.graph.nodes.find((node) => node.id === SUBSCRIBERS_ID);
    expect(edited?.observed_state).toMatchObject({ value: 0.4, raw_value: 8000, source: 'user_override' });
    expect(result.mutatedGraph).toMatchObject(result.graph);
    expect(result.handlerFacts.some((fact) => fact.fact_type === 'set_factor_value')).toBe(true);
  });

  it("Paul's served shape through the real door: unconfirmed reading, two causal parents, and an edge-marked definitional addend", async () => {
    const graph = persistedGraph() as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    const goal = graph.nodes.find((n) => n.id === 'mrr')!;
    // A LISTED addend can't be used here: the mutation merge drops an identity that carries `addends` (reported as a row).
    goal.nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', SUBSCRIBERS_ID], stated_in_brief: false };
    graph.nodes.push(
      { id: 'release', kind: 'factor', label: 'Next Pro feature release timing', observed_state: { value: 0.25, raw_value: 3, unit: 'months from now', source: 'cee_inference' } },
      { id: 'backlash', kind: 'factor', label: 'MRR lost to pricing backlash', observed_state: { value: 0, raw_value: 0, unit: '£/month', source: 'cee_inference' } },
      { id: 'other_mrr', kind: 'factor', label: 'Other MRR', observed_state: { value: 0.05, raw_value: 1000, unit: '£/month', source: 'brief_extraction' } },
    );
    graph.edges.push(
      { from: 'release', to: 'mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      { from: 'backlash', to: 'mrr', strength: { mean: -0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      { from: 'other_mrr', to: 'mrr', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis', definitional: true } },
    );
    const event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }> = {
      kind: 'factor_value_edit', target_id: SUBSCRIBERS_ID, field: 'value', value: 0.4, raw_value: 8000, unit: 'subscribers', intent: 'set',
    };
    const payload: SystemEventTurnPayload = {
      kind: 'system_event', scenario_id: '11111111-1111-4111-8111-111111111111', turn_id: '77777777-7777-4777-8777-777777777778', stage: 'analyse', event,
    };
    const result = await applyFactorValueEdit({ payload, event, requestId: 'req-goal-coherence-paul', persistedGraph: graph, priorFacts: [] });
    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    // £49 × 8,000 + £1,000 (the edge-marked definitional addend) = £393,000; the two causal parents are ignored.
    expect(result.response.assistant_text).toContain("At £49 × 8,000 + £1,000, MRR today would be about £390,000, about 20 times your £20,000 target, so the goal would already be met, if MRR = Pro plan price × Pro paying subscribers (Olumi's reading).");
  });
});

