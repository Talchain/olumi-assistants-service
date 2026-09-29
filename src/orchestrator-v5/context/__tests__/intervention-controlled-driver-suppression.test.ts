import { describe, it, expect } from 'vitest';

import {
  projectTopDrivers,
  type ContextPackAnalysis,
} from '../context-pack-assembler.js';
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

describe('projectTopDrivers — Spine A suppression', () => {
  it('removes an option-controlled driver before projection', () => {
    const out = projectTopDrivers([CONTROLLED, EXTERNAL], controlledSet);
    const labels = out.map((d) => d.factor_label);
    expect(labels).not.toContain('Factory Capacity');
    expect(labels).toContain('Market Demand');
  });

  it('keeps a genuinely external driver and preserves its computed value', () => {
    const out = projectTopDrivers([EXTERNAL], controlledSet);
    expect(out).toHaveLength(1);
    expect(out[0]!.factor_label).toBe('Market Demand');
    // sign re-attached for a 'negative' driver — value is the producer value,
    // not recomputed/corrected by the backstop.
    expect(out[0]!.sensitivity_value).toBeLessThan(0);
  });

  it('suppresses only the controlled driver in a mixed list', () => {
    const third = driver('fac_team_morale', 'Team Morale', 0.3);
    const out = projectTopDrivers([CONTROLLED, EXTERNAL, third], controlledSet);
    expect(out.map((d) => d.factor_label)).toEqual(['Market Demand', 'Team Morale']);
  });

  it('returns a valid empty projection when every driver is controlled', () => {
    const out = projectTopDrivers([CONTROLLED], controlledSet);
    expect(out).toEqual([]);
  });

  it('is a no-op when no controlled set is supplied (backward compatible)', () => {
    const without = projectTopDrivers([CONTROLLED, EXTERNAL]);
    const withEmpty = projectTopDrivers([CONTROLLED, EXTERNAL], new Set());
    expect(without.map((d) => d.factor_label)).toContain('Factory Capacity');
    expect(withEmpty.map((d) => d.factor_label)).toContain('Factory Capacity');
  });

  it('does not match by label when the id differs (id is the only authority)', () => {
    const lookalike = driver('fac_factory_capacity_external', 'Factory Capacity', 0.8);
    const out = projectTopDrivers([lookalike], controlledSet);
    expect(out.map((d) => d.factor_label)).toContain('Factory Capacity');
  });

  it('does not mutate the input drivers array', () => {
    const drivers = [CONTROLLED, EXTERNAL];
    const snapshot = JSON.parse(JSON.stringify(drivers));
    projectTopDrivers(drivers, controlledSet);
    expect(drivers).toEqual(snapshot);
  });
});

describe('projectTopDrivers — #271 prior-facts fill interaction', () => {
  it('suppresses a controlled driver even when it was filled from prior facts', () => {
    // Simulates the output of #271 `applyPriorFactsDriversFallback`: the ingress
    // echo dropped drivers, so they were recovered from the authoritative
    // persisted (prior-facts) analysis — and that recovered set contains the
    // option-controlled lever. Suppression must still fire DOWNSTREAM, so a
    // stale / recovered analysis cannot reintroduce the unsafe driver.
    const filledFromPriorFacts = [CONTROLLED, EXTERNAL];
    const out = projectTopDrivers(filledFromPriorFacts, controlledSet);
    expect(out.map((d) => d.factor_label)).toEqual(['Market Demand']);
  });
});

describe('explanation fallback composers — Spine A contract', () => {
  const analysisWith = (drivers: DriverSummary[], controlled: ReadonlySet<string>): ContextPackAnalysis => ({
    status: 'complete',
    leading_option: { label: 'Build in-house', probability: 0.62 },
    runner_up: { label: 'Outsource', probability: 0.38 },
    margin_pp: 24,
    robustness_band: 'stable',
    top_drivers: projectTopDrivers(drivers, controlled),
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
