import { describe, expect, it } from 'vitest';
import { selectFactorQuantity } from '@talchain/schemas';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { buildAppliedGraphWireField } from '../../../compose/applied-graph-emit.js';
import { composeBody } from '../../../compose/validation-failure-responses.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { buildGraphLookup } from '../../../routing/graph-lookup-adapter.js';
import { resolveRelativeFactorDelta } from '../../../routing/resolve-relative-factor-delta.js';
import { ProposalActionSchema, type ProposalAction } from '../../../routing/types.js';
import { validateToolCall, type GraphLookup } from '../../../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { mergeMutatedGraphForPersistence } from '../d1-shared/apply-graph-mutation.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

// The independent review's original five-case reproducer remains unchanged.
// These regression controls permit the intended early refusal instead of
// assuming that routing must accept a delta against placeholder support.
const TARGET_ID = 'f-churn';
const SIBLING_ID = 'f-churn-sibling';
const REASONING = { rationale: 'Placeholder only; no supplied baseline.', context_basis: [] };
const SYSTEM_PRIOR = {
  distribution: 'uniform', range_min: 0, range_max: 1,
  prior_is_unquantified: true, source: 'cee_inference', reasoning: REASONING,
};
type Node = GraphV3T['nodes'][number];
type Baseline = 'supplied' | 'neutral' | 'estimate' | 'fallback' | 'stale_user_fallback'
  | 'unattributed_prior' | 'supplied_prior' | 'legacy_unknown_prior';
type Frame = 'percent' | 'currency' | 'uncapped_currency' | 'unitless';

function target(graph: { nodes: readonly Node[] }): Node {
  const found = graph.nodes.find((node) => node.id === TARGET_ID);
  expect(found).toBeDefined();
  return found!;
}

function fixture(baseline: Baseline = 'supplied', frame: Frame = 'percent'): GraphV3T {
  const graph = buildD1Fixture();
  const node = target(graph);
  node.label = frame === 'percent' ? 'Customer churn' : 'Service budget';
  node.source_quote = 'The selected canonical quantity, not its similarly named neighbour.';
  node.observed_state = frame === 'percent'
    ? { value: 0.12, raw_value: 12, unit: '%', cap: 100, source: 'user_override' }
    : frame === 'currency'
      ? { value: 0.12, raw_value: 12_000, unit: 'GBP', cap: 100_000, source: 'user_override' }
      : frame === 'uncapped_currency'
        ? { value: 12_000, raw_value: 12_000, unit: 'GBP', source: 'user_override' }
        : { value: 200, raw_value: 200, source: 'user_override' };
  if (baseline === 'neutral') delete node.observed_state.source;
  if (baseline === 'estimate') node.observed_state.source = 'cee_inference';
  if (baseline === 'fallback' || baseline === 'stale_user_fallback') {
    node.observed_state.source = baseline === 'fallback' ? 'cee_inference' : 'user_override';
    node.observed_state.value_tier = 'fallback_default';
    node.observed_state.reasoning = REASONING;
    node.prior = structuredClone(SYSTEM_PRIOR);
  }
  if (baseline === 'unattributed_prior' || baseline === 'supplied_prior') {
    node.prior = {
      distribution: 'uniform', range_min: 0, range_max: 0.132,
      ...(baseline === 'supplied_prior' ? { source: 'user_override' } : {}),
    };
  }
  if (baseline === 'legacy_unknown_prior') {
    delete node.observed_state;
    node.prior = structuredClone(SYSTEM_PRIOR);
  }
  graph.nodes.push({
    id: SIBLING_ID, kind: 'factor', label: node.label,
    observed_state: { value: 0.24, raw_value: 24, unit: '%', cap: 100, source: 'user_override' },
  });
  expect(GraphV3.safeParse(graph).success).toBe(true);
  return graph;
}

function lookupOf(graph: unknown): GraphLookup {
  const built = buildGraphLookup(GraphStateIngressSchema.parse(graph));
  expect(built.kind).toBe('ok');
  if (built.kind !== 'ok') throw new Error('Fixture graph must produce a real lookup');
  return built.lookup;
}

function proposal(value: unknown, operator: 'set' | 'increase' | 'decrease' | 'multiply'): ProposalAction {
  return ProposalActionSchema.parse({
    handler_id: 'set_factor_value',
    entity: { id: TARGET_ID, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'value', value, operator, source: 'user_explicit' }],
    cited_context_fields: [],
  });
}

function route(graph: unknown, input: ProposalAction, lookup = lookupOf(graph)) {
  const relative = resolveRelativeFactorDelta(input, lookup);
  // Reparse the actual resolver result through the real wire grammar: an
  // untyped sideband cannot carry the operation past this boundary.
  const action = ProposalActionSchema.parse(JSON.parse(JSON.stringify(relative.resolved ? relative.action : input)));
  return { relative, action, lookup, validation: validateToolCall(action, lookup, HANDLER_VALIDATION_REGISTRY) };
}

async function execute(graph: unknown, action: ProposalAction) {
  return createSetFactorValueHandler()(buildHandlerInvocation({
    graph, proposal: action, message: 'Apply the stated change to the selected factor.',
    requestId: 'relative-authority', scenarioId: 'relative-authority-fixture',
  }));
}

async function accept(graph: GraphV3T, input: ProposalAction, lookup?: GraphLookup) {
  const before = JSON.stringify(graph);
  const routed = route(graph, input, lookup);
  expect(routed.validation.valid, JSON.stringify(routed.validation)).toBe(true);
  if (!routed.validation.valid) throw new Error('Expected accepted control');
  const outcome = await execute(graph, routed.validation.proposal);
  expect(outcome.mutated_graph).toBeDefined();
  const merged = mergeMutatedGraphForPersistence({
    mutatedGraph: outcome.mutated_graph as Record<string, unknown>, persistedBase: graph,
    requestId: 'relative-authority', scenarioId: 'relative-authority-fixture',
  });
  const persisted = projectGraphForPersistence(merged, { source: 'set_factor_value', scenarioId: 'relative-authority-fixture' });
  const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(persisted)));
  const wire = buildAppliedGraphWireField(reloaded);
  expect(wire.nodes).toEqual(reloaded.nodes);
  expect(target(reloaded).observed_state).toEqual(target(outcome.mutated_graph as GraphV3T).observed_state);
  expect(target(reloaded).source_quote).toBe(target(graph).source_quote);
  expect(reloaded.nodes.filter((node) => node.id !== TARGET_ID)).toEqual(graph.nodes.filter((node) => node.id !== TARGET_ID));
  expect(reloaded.edges).toEqual(graph.edges);
  expect(JSON.stringify(graph)).toBe(before);
  expect(outcome.handler_facts?.[0]).toMatchObject({ noop: false, result: { target_id: TARGET_ID, status: 'applied' } });
  expect(selectFactorQuantity(target(reloaded))).toMatchObject({ kind: 'point', carrier: 'observed_state', source: 'user_override' });
  return { ...routed, outcome, reloaded, node: target(reloaded), wire };
}

async function refuse(graph: GraphV3T, input: ProposalAction) {
  const before = JSON.stringify(graph);
  const routed = route(graph, input);
  expect(routed.validation).toMatchObject({ valid: false, error: { code: 'PARAMETER_INVALID' } });
  // A caller bypassing routing must still be unable to stamp user authority.
  await expect(execute(graph, routed.action)).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  expect(JSON.stringify(graph)).toBe(before);
  return routed;
}

describe('relative factor edits preserve the selected starting quantity', () => {
  it('supplied 12% +5 percentage points remains 17% through mutation, reload and receipt', async () => {
    const result = await accept(fixture(), proposal({ value: 5, unit: '%' }, 'increase'));
    expect(result.relative.resolved).toBe(false);
    expect(result.node.observed_state).toMatchObject({ value: 0.17, raw_value: 17, unit: '%', cap: 100, source: 'user_override' });
    expect(result.outcome.assistant_text).toContain('Updated Customer churn from 12% to 17%.');
  });

  it.each(['currency', 'uncapped_currency'] as const)('%s increase/decrease use a dimensionless multiplier and the selected ID', async (frame) => {
    for (const [operator, multiplier, raw] of [['increase', 1.1, 13_200], ['decrease', 0.9, 10_800]] as const) {
      const result = await accept(fixture('supplied', frame), proposal({ value: 10, unit: '%' }, operator));
      expect(result.relative.resolved).toBe(true);
      expect(result.action.parameters[0]).toEqual({ name: 'value', value: multiplier, operator: 'multiply', source: 'user_explicit' });
      expect(result.node.observed_state?.raw_value).toBeCloseTo(raw, 8);
      expect(result.node.observed_state?.value).toBeCloseTo(frame === 'currency' ? raw / 100_000 : raw, 8);
      expect(result.node.observed_state?.unit).toBe('GBP');
      expect(result.outcome.assistant_text).toContain(`from 12,000 GBP to ${raw === 13_200 ? '13,200' : '10,800'} GBP`);
    }
  });

  it('an uncapped unitless point retains the established 200 +5% =210 behavior', async () => {
    const result = await accept(fixture('supplied', 'unitless'), proposal({ value: 5, unit: '%' }, 'increase'));
    expect(result.action.parameters[0]).toEqual({ name: 'value', value: 1.05, operator: 'multiply', source: 'user_explicit' });
    expect(result.node.observed_state?.value).toBeCloseTo(210, 8);
    expect(result.node.observed_state).not.toHaveProperty('unit');
  });

  it('accepts GBP10000 +14% at the exact GBP11400 cap but rejects a genuinely lower cap', async () => {
    const graph = fixture('supplied', 'currency');
    Object.assign(target(graph).observed_state!, { value: 10_000 / 11_400, raw_value: 10_000, cap: 11_400 });
    const input = proposal({ value: 14, unit: '%' }, 'increase');
    const result = await accept(graph, input);
    expect(result.action.parameters[0]).toEqual({ name: 'value', value: 1.14, operator: 'multiply', source: 'user_explicit' });
    expect(result.node.observed_state).toMatchObject({ value: 1, raw_value: 11_400, cap: 11_400, unit: 'GBP' });
    expect(result.outcome.assistant_text).toContain('from 10,000 GBP to 11,400 GBP');

    const below = structuredClone(graph);
    const smallerCap = 11_400 - 1e-8;
    Object.assign(target(below).observed_state!, { value: 10_000 / smallerCap, cap: smallerCap });
    const refused = await refuse(below, input);
    expect(refused.validation).toMatchObject({ valid: false, error: { details: { rejection_reason: 'bare_number_outside_cap' } } });
  });

  it.each(['neutral', 'estimate'] as const)('does not classify a nonfallback %s point as unknown', async (baseline) => {
    const graph = fixture(baseline);
    const selection = selectFactorQuantity(target(graph));
    expect(selection).toMatchObject({ kind: 'point', carrier: 'observed_state' });
    expect(lookupOf(graph).findFactorQuantity?.(TARGET_ID)).toEqual(selection);
    const result = await accept(graph, proposal({ value: 5, unit: '%' }, 'increase'));
    expect(result.node.observed_state?.raw_value).toBe(17);
  });

  it('supplied point with an unattributed old prior remains usable and preserves that prior', async () => {
    const graph = fixture('unattributed_prior');
    const priorBytes = JSON.stringify(target(graph).prior);
    const result = await accept(graph, proposal({ value: 5, unit: '%' }, 'increase'));
    expect(result.node.observed_state?.raw_value).toBe(17);
    expect(JSON.stringify(result.node.prior)).toBe(priorBytes);
  });

  it('distinguishes supplied 4% +2 points from the identical unattributed point with a competing prior', async () => {
    // Exact carrier pair from the frozen stated-percent script; that script
    // remains untouched. A neutral observation plus a separate prior does
    // not identify which quantity supplies the arithmetic starting point.
    const neutral = fixture('neutral');
    Object.assign(target(neutral).observed_state!, { value: 0.04, raw_value: 4 });
    target(neutral).prior = { distribution: 'uniform', range_min: 0, range_max: 1 };
    const priorBytes = JSON.stringify(target(neutral).prior);
    const input = proposal({ value: 2, unit: '%' }, 'increase');
    expect(selectFactorQuantity(target(neutral))).toMatchObject({ kind: 'ambiguous' });
    await refuse(neutral, input);

    const supplied = structuredClone(neutral);
    target(supplied).observed_state!.source = 'user_override';
    expect(selectFactorQuantity(target(supplied))).toMatchObject({ kind: 'point', carrier: 'observed_state' });
    const result = await accept(supplied, input);
    expect(result.node.id).toBe(TARGET_ID);
    expect(result.node.observed_state).toMatchObject({ value: 0.06, raw_value: 6, unit: '%', cap: 100, source: 'user_override' });
    expect(JSON.stringify(result.node.prior)).toBe(priorBytes);
    expect(result.outcome.assistant_text).toContain('from 4% to 6%');
  });

  it('explicit absolute 12% replaces equal-number fallback and retires only its stale qualifiers', async () => {
    const result = await accept(fixture('fallback'), proposal({ value: 12, unit: '%' }, 'set'));
    expect(result.node.observed_state).toMatchObject({ value: 0.12, raw_value: 12, source: 'user_override' });
    expect(result.node.observed_state).not.toHaveProperty('value_tier');
    expect(result.node.observed_state).not.toHaveProperty('reasoning');
    expect(result.node).not.toHaveProperty('prior');
    expect(result.outcome.assistant_text).toBe('Updated Customer churn to 12%.');
  });

  it.each(['fallback', 'stale_user_fallback', 'supplied_prior', 'legacy_unknown_prior'] as const)(
    'refuses percentage-point arithmetic on %s without touching the graph', async (baseline) => {
      const graph = fixture(baseline);
      const selection = selectFactorQuantity(target(graph));
      expect(selection.kind).not.toBe('point');
      expect(lookupOf(graph).findFactorQuantity?.(TARGET_ID)).toEqual(selection);
      const result = await refuse(graph, proposal({ value: 5, unit: '%' }, 'increase'));
      expect(result.validation).toMatchObject({ valid: false, error: { details: { rejection_reason: 'delta_baseline_unresolved' } } });
    },
  );

  it('does not conceal fallback GBP12000 behind a synthetic absolute GBP13200', async () => {
    const graph = fixture('fallback', 'currency');
    const result = await refuse(graph, proposal({ value: 10, unit: '%' }, 'increase'));
    expect(result.relative.resolved).toBe(true);
    expect(result.action.parameters[0]).toEqual({ name: 'value', value: 1.1, operator: 'multiply', source: 'user_explicit' });
    expect(result.validation).toMatchObject({ valid: false, error: { details: { factor_quantity_kind: 'fallback' } } });
    if (result.validation.valid) throw new Error('Expected fallback refusal');
    const presentation = composeBody(result.validation.error, { handlerRegistry: HANDLER_VALIDATION_REGISTRY, graph: result.lookup });
    expect(presentation.body.assistant_text).toContain('has only a fallback starting value');
    expect(presentation.body.assistant_text).toContain('complete value');
  });

  it('presents conflicting supplied quantities differently from a fallback starting value', async () => {
    const result = await refuse(fixture('supplied_prior'), proposal({ value: 5, unit: '%' }, 'increase'));
    if (result.validation.valid) throw new Error('Expected conflict refusal');
    const presentation = composeBody(result.validation.error, { handlerRegistry: HANDLER_VALIDATION_REGISTRY, graph: result.lookup });
    expect(presentation.body.assistant_text).toContain('has conflicting current quantities');
    expect(presentation.body.assistant_text).not.toContain('fallback');
  });

  it('nonnumeric unknown is refused upstream; current CEE ingress still does not admit that prior arm', async () => {
    const graph = fixture();
    const unknownGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === TARGET_ID ? {
        ...node, observed_state: undefined, prior: { prior_is_unquantified: true, source: 'cee_inference' },
      } : node),
    };
    const before = JSON.stringify(unknownGraph);
    expect(GraphV3.safeParse(unknownGraph).success).toBe(false);
    const result = route(unknownGraph, proposal({ value: 5, unit: '%' }, 'increase'));
    expect(result.lookup.findFactorQuantity?.(TARGET_ID)).toMatchObject({ kind: 'unknown', carrier: 'prior' });
    expect(result.validation).toMatchObject({ valid: false, error: { code: 'PARAMETER_INVALID' } });
    await expect(execute(unknownGraph, result.action)).rejects.toMatchObject({ cause_kind: 'graph_invariant_violated' });
    expect(JSON.stringify(unknownGraph)).toBe(before);
  });

  it('semantic-loss mutant: dropping the adapter selection turns the usable-point acceptance invariant RED', () => {
    const graph = fixture('supplied', 'currency');
    const input = proposal({ value: 10, unit: '%' }, 'increase');
    const healthy = route(graph, input);
    expect(healthy.validation.valid).toBe(true);
    const lost = { ...healthy.lookup };
    delete lost.findFactorQuantity;
    const mutant = route(graph, input, lost);
    expect(mutant.validation).toMatchObject({ valid: false, error: { details: { rejection_reason: 'delta_baseline_unresolved' } } });
    expect(() => expect(mutant.validation.valid).toBe(true)).toThrow();
  });

  it.each([false, true])('missing numeric lookup cannot bypass fallback refusal (also drop selection: %s)', async (dropSelection) => {
    const graph = fixture('fallback');
    const before = JSON.stringify(graph);
    const input = proposal({ value: 5, unit: '%' }, 'increase');
    const healthy = await refuse(graph, input);
    expect(healthy.lookup.findFactorQuantity?.(TARGET_ID)).toMatchObject({ kind: 'fallback' });

    const lost = { ...healthy.lookup };
    delete lost.findFactorObservedState;
    if (dropSelection) delete lost.findFactorQuantity;
    const mutant = route(graph, input, lost);
    expect(mutant.validation).toMatchObject({ valid: false, error: { details: { rejection_reason: 'delta_baseline_unresolved' } } });
    expect(JSON.stringify(graph)).toBe(before);

    // Missing baseline transport must not prohibit a complete explicit
    // correction. The handler still validates against the canonical graph.
    const absolute = await accept(graph, proposal({ value: 12, unit: '%' }, 'set'), lost);
    expect(absolute.node.observed_state).toMatchObject({ value: 0.12, raw_value: 12, source: 'user_override' });
    expect(absolute.node.observed_state).not.toHaveProperty('value_tier');
    expect(absolute.node).not.toHaveProperty('prior');
  });

  it('semantic-loss mutant: rewriting the relative operation as set makes the fallback-refusal invariant RED', async () => {
    const graph = fixture('fallback', 'currency');
    const healthy = route(graph, proposal({ value: 10, unit: '%' }, 'increase'));
    expect(healthy.validation.valid).toBe(false);
    // The exact old meaning loss: calculating 13200 while erasing its
    // dependency on the unsupported 12000 starting quantity.
    const mutant = proposal({ value: 13_200, unit: 'GBP' }, 'set');
    const accepted = await accept(graph, mutant);
    expect(() => expect(accepted.validation.valid).toBe(false)).toThrow();
    expect(accepted.node.observed_state?.raw_value).toBe(13_200);
    expect(selectFactorQuantity(accepted.node)).toMatchObject({ kind: 'point', source: 'user_override' });
  });

  it('unrelated label change stays GREEN; editing after reload still uses the original canonical ID', async () => {
    const graph = fixture('supplied', 'currency');
    target(graph).label = 'Renewal service spend';
    const first = await accept(graph, proposal({ value: 10, unit: '%' }, 'increase'));
    expect(first.node.id).toBe(TARGET_ID);
    expect(first.node.label).toBe('Renewal service spend');
    const second = await accept(first.reloaded, proposal({ value: 10, unit: '%' }, 'decrease'));
    expect(second.node.observed_state?.raw_value).toBeCloseTo(11_880, 8);
    expect(second.node.id).toBe(TARGET_ID);
    expect(second.outcome.assistant_text).toContain('Renewal service spend');
    expect(second.reloaded.nodes.find((node) => node.id === SIBLING_ID)).toEqual(graph.nodes.find((node) => node.id === SIBLING_ID));
  });
});
