/**
 * 1.16 item A2 — consented cap extension via an explicit proposal cap,
 * with option-intervention renormalisation.
 *
 * CRITICAL CORRECTNESS REQUIREMENT (verified against the storage
 * convention before implementation): option interventions are stored as
 * normalised multiples of the target factor's cap (CEE SCALE_DISCIPLINE;
 * `plot-intervention-scale.ts` header; `resolveExistingRawValue` trusts
 * the same `value = raw / cap` convention for the factor's own
 * observed_state). An intervention `value: 1` on a cap-£200,000 factor
 * MEANS £200,000. If the cap is extended to £312,500 and the stored
 * value is left at 1, the intervention silently becomes £312,500 —
 * corrupting every option's absolute configuration. When a consented cap
 * change applies, every option's intervention on that factor must be
 * renormalised by old_cap/new_cap so absolute values are preserved.
 *
 * The analysis path reads interventions from OPTION-KIND NODES
 * (`computeStructuralReadiness` → `mergeInterventionSources` over
 * `graph.nodes`), and node-level records survive the persistence merges
 * (`applyAndValidateMutation` + `mergeMutatedGraphForPersistence` stamp
 * `nodes`) — so the handler-side renormalisation of option NODES is both
 * necessary and sufficient for the analysis-visible state.
 */

import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../routing/types.js';

function capExtensionProposal(): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-budget', // cap=100000, unit='£', value=0.4, raw_value=40000
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        // The consented rescale replay shape: explicit value + unit + cap.
        value: { value: 250000, unit: '£', cap: 312500 },
        operator: 'set',
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  };
}

interface InterventionShape {
  readonly value: number;
  readonly raw_value?: number | boolean;
  readonly value_type?: string;
  readonly source?: string;
  readonly target_match?: unknown;
}

function graphWithOptionInterventions(): GraphV3T {
  const graph = buildD1Fixture();
  const tm = { node_id: 'f-budget', match_type: 'exact_id', confidence: 'high' };
  // o-launch: normalised intervention value 1 on the old cap-100000 factor
  // — absolute meaning £100,000 (the "intervention 1 = old cap" case).
  const launch = graph.nodes.find((n) => n.id === 'o-launch')! as GraphV3T['nodes'][number] & {
    interventions?: Record<string, unknown>;
  };
  launch.interventions = {
    'f-budget': { value: 1, source: 'user_specified', target_match: tm },
  };
  // o-wait: pair-consistent {value, raw_value} intervention (£50,000).
  graph.nodes.push({
    id: 'o-wait',
    kind: 'option',
    label: 'Wait',
    interventions: {
      'f-budget': { value: 0.5, raw_value: 50000, source: 'user_specified', target_match: tm },
    },
  } as unknown as GraphV3T['nodes'][number]);
  // o-raw: raw-looking value (>1) — already absolute, must NOT be touched.
  graph.nodes.push({
    id: 'o-raw',
    kind: 'option',
    label: 'Raw convention',
    interventions: {
      'f-budget': { value: 25000, source: 'user_specified', target_match: tm },
    },
  } as unknown as GraphV3T['nodes'][number]);
  // o-bool: encoded boolean intervention — must NOT be scaled.
  graph.nodes.push({
    id: 'o-bool',
    kind: 'option',
    label: 'Toggle',
    interventions: {
      'f-budget': {
        value: 1,
        raw_value: true,
        value_type: 'boolean',
        source: 'user_specified',
        target_match: tm,
      },
    },
  } as unknown as GraphV3T['nodes'][number]);
  return graph;
}

function interventionOn(graph: GraphV3T, optionId: string): InterventionShape {
  const node = graph.nodes.find((n) => n.id === optionId) as
    | { interventions?: Record<string, InterventionShape> }
    | undefined;
  const entry = node?.interventions?.['f-budget'];
  expect(entry).toBeDefined();
  return entry!;
}

describe('set_factor_value — consented cap extension (item A2, 1.16)', () => {
  const handler = createSetFactorValueHandler();

  it('applies the value, extends the cap, and renormalises option interventions in absolute terms', async () => {
    const graph = graphWithOptionInterventions();
    const outcome = await handler(
      buildHandlerInvocation({ proposal: capExtensionProposal(), graph }),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    const factor = mutated.nodes.find((n) => n.id === 'f-budget')!;

    // Factor: value applied, cap extended, normalised value consistent.
    expect(factor.observed_state?.raw_value).toBe(250000);
    expect(factor.observed_state?.cap).toBe(312500);
    expect(factor.observed_state?.value).toBeCloseTo(250000 / 312500, 10);

    // o-launch: value 1 meant £100,000 under the old cap → renormalised
    // to 100000/312500 = 0.32 so its absolute meaning is preserved.
    expect(interventionOn(mutated, 'o-launch').value).toBeCloseTo(100000 / 312500, 10);

    // o-wait: raw_value is the absolute truth (£50,000) — value recomputed
    // against the new cap, raw_value untouched.
    const wait = interventionOn(mutated, 'o-wait');
    expect(wait.raw_value).toBe(50000);
    expect(wait.value).toBeCloseTo(50000 / 312500, 10);

    // o-raw: raw-looking (>1) — already absolute, untouched.
    expect(interventionOn(mutated, 'o-raw').value).toBe(25000);

    // o-bool: encoded boolean — never scaled.
    const bool = interventionOn(mutated, 'o-bool');
    expect(bool.value).toBe(1);
    expect(bool.raw_value).toBe(true);
  });

  it('receipt names the change and the extended scale', async () => {
    const graph = graphWithOptionInterventions();
    const outcome = await handler(
      buildHandlerInvocation({ proposal: capExtensionProposal(), graph }),
    );
    expect(outcome.assistant_text).toContain('£250,000');
    expect(outcome.assistant_text).toContain('£312,500');
  });

  it('no renormalisation when the proposal cap equals the stored cap', async () => {
    const graph = graphWithOptionInterventions();
    const proposal = capExtensionProposal();
    proposal.parameters = [
      {
        name: 'value',
        value: { value: 50000, unit: '£', cap: 100000 },
        operator: 'set',
        source: 'user_explicit',
      },
    ];
    const outcome = await handler(buildHandlerInvocation({ proposal, graph }));
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(interventionOn(mutated, 'o-launch').value).toBe(1);
    expect(interventionOn(mutated, 'o-wait').value).toBe(0.5);
  });
});
