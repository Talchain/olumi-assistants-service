/**
 * Tests for per-intervention display_value handling in analysis-ready.
 *
 * Covers:
 *   - LLM-provided InterventionV3.display_value is preserved on the
 *     intervention_details entry.
 *   - When absent, synthesiseDisplayValue() fills in qualitative / numeric
 *     forms deterministically.
 *   - display_value is presentation-only — interventions (Record<string, number>)
 *     remain untouched and flattening logic is unaffected.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: () => 'stub' }),
}));

import { buildAnalysisReadyPayload } from "../../../../src/cee/transforms/analysis-ready.js";
import type { OptionV3T, GraphV3T } from "../../../../src/schemas/cee-v3.js";

function makeGraph(factorOverride: Partial<{ unit: string; observed_state: unknown; display_value: string }> = {}): GraphV3T {
  return {
    schema_version: 'v3',
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Grow revenue' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      {
        id: 'fac_spend',
        kind: 'factor',
        label: 'Ad Spend',
        ...factorOverride,
      },
    ],
    edges: [
      { from: 'opt_a', to: 'fac_spend', strength: { mean: 0.5, std: 0.1 } },
    ],
  } as unknown as GraphV3T;
}

function makeOption(interventionOverride: Record<string, unknown>): OptionV3T {
  return {
    id: 'opt_a',
    label: 'Option A',
    interventions: {
      fac_spend: {
        value: 0.7125,
        source: 'brief_extraction',
        target_match: { confidence: 'high' },
        ...interventionOverride,
      },
    },
  } as unknown as OptionV3T;
}

describe('intervention display_value', () => {
  it('prefers LLM-provided display_value on the intervention', () => {
    const graph = makeGraph({ unit: '£', observed_state: { unit: '£' } as unknown });
    const option = makeOption({ display_value: '£71,250' });
    const payload = buildAnalysisReadyPayload([option], 'goal_g', graph, {});
    const details = payload.options[0].intervention_details;
    expect(details).toBeDefined();
    expect(details!['fac_spend'].display_value).toBe('£71,250');
  });

  it('falls back to synthesised qualitative band when no unit/cap metadata', () => {
    const graph = makeGraph();
    const option = makeOption({ value: 0.7125 });
    const payload = buildAnalysisReadyPayload([option], 'goal_g', graph, {});
    const details = payload.options[0].intervention_details;
    expect(details).toBeDefined();
    // Plain 0-1 value with no factor_type → numeric form from synthesiseDisplayValue.
    expect(details!['fac_spend'].display_value).toBeTruthy();
    expect(details!['fac_spend'].normalised_value).toBeCloseTo(0.7125, 4);
  });

  it('interventions map remains Record<string, number> — unaffected by display_value', () => {
    const graph = makeGraph({ unit: '£', observed_state: { unit: '£' } as unknown });
    const option = makeOption({ display_value: '£71,250', value: 0.7125 });
    const payload = buildAnalysisReadyPayload([option], 'goal_g', graph, {});
    const interventions = payload.options[0].interventions;
    expect(interventions['fac_spend']).toBe(0.7125);
    // Numeric-only map; no additional properties.
    expect(typeof interventions['fac_spend']).toBe('number');
  });

  it('LLM display_value that echoes the factor label is suppressed', () => {
    const graph = makeGraph();
    const option = makeOption({ display_value: 'Ad Spend' });
    const payload = buildAnalysisReadyPayload([option], 'goal_g', graph, {});
    const details = payload.options[0].intervention_details;
    // Echo should be stripped — display_value must not equal the factor label.
    expect(details!['fac_spend'].display_value.toLowerCase()).not.toBe('ad spend');
  });
});
