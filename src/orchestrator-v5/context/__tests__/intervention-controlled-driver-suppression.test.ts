/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): `projectTopDrivers` is deleted with the
 * ContextPack assembler. Its Spine A suppression delegated to the LIVE
 * `partitionInterventionControlledDrivers`, whose own suite
 * (`intervention-controlled-drivers.test.ts`) already pins removal, the
 * all-controlled empty result, the empty-set no-op, id-only authority and
 * no-mutation, so the `projectTopDrivers` rows were dropped. The Spine A
 * composer NEGATIVES below are kept, re-pointed to feed the composers through
 * `partitionInterventionControlledDrivers` instead of `projectTopDrivers`.
 */
import { describe, it, expect } from 'vitest';

import type { ContextPackAnalysis, ContextPackAnalysisDriver } from '../context-pack-types.js';
import { partitionInterventionControlledDrivers } from '../intervention-controlled-drivers.js';
import { buildAnalysisProjectionSummary } from '../projection-summaries.js';
import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../tools/handlers/explanation-fallback.js';
import type { DriverSummary } from '../../../orchestrator/context/analysis-compact.js';

const driver = (
  factor_id: string,
  factor_label: string,
  sensitivity: number,
): DriverSummary => ({ factor_id, factor_label, sensitivity, direction: 'negative' });

// A factor an option intervenes on (the unsafe lever) AND a genuinely external
// factor. The controlled lever is given the LARGER magnitude so that, without
// suppression, it would lead the "driven mainly by …" sentence — proving the
// backstop removes the unsafe lead, not just a trailing mention.
const CONTROLLED = driver('fac_factory_capacity', 'Factory Capacity', 0.9);
const EXTERNAL = driver('fac_market_demand', 'Market Demand', 0.5);
const controlledSet = new Set(['fac_factory_capacity']);

/** Minimal literal projection of a kept driver into the pack's driver shape. */
const toPackDriver = (d: DriverSummary): ContextPackAnalysisDriver => ({
  factor_label: d.factor_label,
  sensitivity_value: d.direction === 'negative' ? -Math.abs(d.sensitivity) : Math.abs(d.sensitivity),
});

describe('explanation fallback composers — Spine A contract', () => {
  const analysisWith = (drivers: DriverSummary[], controlled: ReadonlySet<string>): ContextPackAnalysis => ({
    status: 'complete',
    leading_option: { label: 'Build in-house', probability: 0.62 },
    runner_up: { label: 'Outsource', probability: 0.38 },
    margin_pp: 24,
    robustness_band: 'stable',
    top_drivers: partitionInterventionControlledDrivers(drivers, controlled).kept.map(toPackDriver),
    fragile_edges: [],
  });

  it('explain_results does not name an option-controlled lever as a tunable driver', () => {
    const projection = buildAnalysisProjectionSummary(
      analysisWith([CONTROLLED, EXTERNAL], controlledSet),
    );
    const text = composeExplainResultsFallback(projection ?? undefined);
    expect(text).not.toContain('Factory Capacity');
    expect(text).toContain('Market Demand');
  });

  it('what_would_flip does not name an option-controlled lever as the thing to tune', () => {
    const projection = buildAnalysisProjectionSummary(
      analysisWith([CONTROLLED, EXTERNAL], controlledSet),
    );
    const text = composeWhatWouldFlipFallback(projection ?? undefined);
    expect(text).not.toContain('Factory Capacity');
    expect(text).toContain('Market Demand');
  });

  it('a genuinely external driver still surfaces normally (no over-suppression)', () => {
    // No controlled set → external driver leads as before.
    const projection = buildAnalysisProjectionSummary(
      analysisWith([EXTERNAL], new Set()),
    );
    const text = composeExplainResultsFallback(projection ?? undefined);
    expect(text).toContain('Market Demand');
  });
});
