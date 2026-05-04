import { describe, it, expect } from "vitest";
import { applyTemplateOperations } from "../../../../src/orchestrator-v5/handlers/edit-templates/apply-template.js";
import { buildAddRiskOperations, buildAddRiskConfirmation } from "../../../../src/orchestrator-v5/handlers/edit-templates/add-risk-template.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

const baseGraph = (): GraphV3T => ({
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Reach 1000 customers' },
    { id: 'dec_1', kind: 'decision', label: 'Pricing model' },
    { id: 'opt_a', kind: 'option', label: 'Subscription' },
    { id: 'opt_b', kind: 'option', label: 'One-off' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_price', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'opt_b', to: 'fac_price', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T);

const buildContext = (graph: GraphV3T): ConversationContext => ({
  graph,
  analysis_response: null,
  framing: { stage: 'frame' },
  messages: [{ role: 'user', content: 'Add team dynamics as a risk' }],
  scenario_id: 'sc_test',
});

describe('applyTemplateOperations', () => {
  it('happy path — applies risk node + bridge edges, returns confirmation', async () => {
    const graph = baseGraph();
    const { operations } = buildAddRiskOperations('team dynamics', graph);
    const context = buildContext(graph);

    const result = await applyTemplateOperations({
      operations,
      context,
      requestId: 'req_1',
      turnId: 'turn_1',
      templateName: 'add_risk',
      confirmationText: buildAddRiskConfirmation('team dynamics'),
    });

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    expect(result.appliedGraph!.nodes.some((n) => n.id === 'risk_team_dynamics')).toBe(true);
    expect(result.appliedGraph!.edges.some((e) => e.from === 'risk_team_dynamics' && e.to === 'goal_1')).toBe(true);
    expect(result.appliedGraph!.edges.some((e) => e.from === 'dec_1' && e.to === 'risk_team_dynamics')).toBe(true);
    expect(result.assistantText).toContain('team dynamics');
    expect(result.assistantText).toContain('What factors drive this risk');
    expect(result.blocks).toEqual([]);
  });

  it('completes in under 100ms (no LLM call)', async () => {
    const graph = baseGraph();
    const { operations } = buildAddRiskOperations('market competition', graph);
    const context = buildContext(graph);
    const start = Date.now();
    await applyTemplateOperations({
      operations,
      context,
      requestId: 'req_2',
      turnId: 'turn_2',
      templateName: 'add_risk',
      confirmationText: buildAddRiskConfirmation('market competition'),
    });
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('UX parity: emits appliedChanges receipt + rerun chip when prior analysis exists', async () => {
    const graph = baseGraph();
    const { operations } = buildAddRiskOperations('cyber attacks', graph);
    const ctxWithAnalysis: ConversationContext = {
      ...buildContext(graph),
      // Minimal stub: existence is what triggers rerun_recommended.
      analysis_response: { meta: { seed_used: 0, n_samples: 0, response_hash: '' }, results: [] } as unknown as ConversationContext['analysis_response'],
    };

    const result = await applyTemplateOperations({
      operations,
      context: ctxWithAnalysis,
      requestId: 'req_rerun',
      turnId: 'turn_rerun',
      templateName: 'add_risk',
      confirmationText: buildAddRiskConfirmation('cyber attacks'),
    });

    expect(result.wasRejected).toBe(false);
    expect(result.appliedChanges).toBeDefined();
    expect(result.appliedChanges!.rerun_recommended).toBe(true);
    expect(result.appliedChanges!.changes.length).toBe(operations.length);
    const rerunChip = (result.suggestedActions ?? []).find((c) => /re-?run/i.test(c.label));
    expect(rerunChip).toBeDefined();
  });

  it('UX parity: NO rerun chip when prior analysis does NOT exist', async () => {
    const graph = baseGraph();
    const { operations } = buildAddRiskOperations('regulatory risk', graph);
    const result = await applyTemplateOperations({
      operations,
      context: buildContext(graph), // analysis_response: null
      requestId: 'req_norerun',
      turnId: 'turn_norerun',
      templateName: 'add_risk',
      confirmationText: buildAddRiskConfirmation('regulatory risk'),
    });

    expect(result.wasRejected).toBe(false);
    expect(result.appliedChanges).toBeDefined();
    expect(result.appliedChanges!.rerun_recommended).toBe(false);
    const rerunChip = (result.suggestedActions ?? []).find((c) => /re-?run/i.test(c.label));
    expect(rerunChip).toBeUndefined();
  });

  it('returns rejected EditGraphResult with friendly text + chip when validation fails', async () => {
    // Inject a malformed operation to force Zod failure.
    const badOps = [
      {
        op: 'add_node',
        path: '/nodes/risk_x',
        value: { id: 'risk_x', kind: 'risk' /* missing label */ },
      } as unknown as import('../../../../src/orchestrator/types.js').PatchOperation,
    ];
    const result = await applyTemplateOperations({
      operations: badOps,
      context: buildContext(baseGraph()),
      requestId: 'req_3',
      turnId: 'turn_3',
      templateName: 'add_risk',
      confirmationText: 'unused',
    });
    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
    expect(result.assistantText).not.toMatch(/Schema:/);
    expect(result.assistantText).not.toMatch(/operation/i);
    expect(result.suggestedActions?.length).toBeGreaterThan(0);
  });
});
