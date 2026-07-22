/**
 * Context-audit #1 (CONTEXT-SYSTEM-AUDIT-2026-07-22) — conformance for the
 * enrichment→LLM silent-drop seam (keep-list inventory row #2) and the
 * projection-cap parity mirror (row #6).
 *
 * The "derived" read-set is NOT hand-listed here (that would be the very
 * mirror the estate keeps paying for). It is OBSERVED AT RUNTIME: every
 * analysis→LLM enrichment reader is run against a `Proxy` over an EMPTY
 * enrichment, so each reader touches its top-level key(s) then bails, and the
 * union of the recorded property accesses is the true read-set — immune to
 * comment drift and impossible to forget to update.
 */

import { describe, it, expect } from 'vitest';

import type { AnalysisResponseSummary } from '../../../orchestrator/context/analysis-compact.js';
import {
  ENRICHMENT_PRODUCER_MANIFEST,
  ENRICHMENT_ANALYSIS_LLM_SKIP,
  ENRICHMENT_DEFENSIVE_NON_EMITTED_READS,
  MAX_LOGGED_ENRICHMENT_KEY_LENGTH,
  sanitiseEnrichmentKeyName,
  findUnknownEnrichmentKeys,
  emitUnknownEnrichmentKeyTelemetry,
  type EnrichmentTripwireLogger,
} from '../enrichment-manifest.js';
import {
  deriveConfidenceTierFromEnrichment,
  deriveEvidenceGapsFromEnrichment,
  deriveGoalFitFromEnrichment,
  deriveOptionGoalFitsFromEnrichment,
  deriveOptionOutcomesFromEnrichment,
  deriveTippingPointsFromTopLevel,
  OPTION_GOAL_FIT_SIGNAL_CAP,
  OPTION_OUTCOME_SIGNAL_CAP,
} from '../analysis-signals.js';
import { reconcileAnalysisSummaryWithEnrichment } from '../analysis-fallback.js';
import { MAX_PROJECTED_OPTIONS } from '../context-pack-assembler.js';

const sorted = (values: Iterable<string>): string[] => [...values].sort();

const MINIMAL_SUMMARY: AnalysisResponseSummary = {
  winner: { option_id: '', option_label: '', win_probability: 0 },
  options: [],
  top_drivers: [],
  robustness_level: 'unknown',
  fragile_edge_count: 0,
  margin: null,
  margin_pp: null,
  analysis_status: 'computed',
};

/**
 * Run every analysis→LLM enrichment reader against a Proxy over an EMPTY
 * enrichment and return the set of top-level property names each one accessed.
 * This is the runtime-DERIVED read-set (row #2), not a hand-maintained list.
 */
function observeTopLevelReads(): Set<string> {
  const reads = new Set<string>();
  const probe = new Proxy({} as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') reads.add(prop);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string') reads.add(prop);
      return Reflect.has(target, prop);
    },
  });
  // The individual derivers (analysis-signals.ts)…
  deriveTippingPointsFromTopLevel(probe);
  deriveEvidenceGapsFromEnrichment(probe);
  deriveGoalFitFromEnrichment(probe);
  deriveOptionGoalFitsFromEnrichment(probe);
  deriveOptionOutcomesFromEnrichment(probe);
  deriveConfidenceTierFromEnrichment(probe);
  // …plus the composite reconcile seam, which additionally exercises the
  // applyTopLevel{Drivers,FragileEdge}Override reads (factor_sensitivity,
  // robustness) in analysis-fallback.ts.
  reconcileAnalysisSummaryWithEnrichment(MINIMAL_SUMMARY, probe);
  return reads;
}

const observed = observeTopLevelReads();
const derivedReal = [...observed].filter((k) => ENRICHMENT_PRODUCER_MANIFEST.has(k));
const defensiveObserved = [...observed].filter((k) => !ENRICHMENT_PRODUCER_MANIFEST.has(k));

describe('enrichment producer manifest — conformance (context-audit #1 row #2)', () => {
  it('runtime-observed reads are only manifest fields or documented defensive reads', () => {
    // Direction 2: a deriver reading a field that is neither a known producer
    // field nor a documented defensive read goes RED.
    const undocumented = defensiveObserved.filter(
      (k) => !ENRICHMENT_DEFENSIVE_NON_EMITTED_READS.has(k),
    );
    expect(undocumented).toEqual([]);
  });

  it('every documented defensive read is actually read (no stale allowlist entry)', () => {
    for (const key of ENRICHMENT_DEFENSIVE_NON_EMITTED_READS) {
      expect(observed.has(key), `${key} is documented defensive but never read`).toBe(true);
    }
  });

  it('manifest is fully classified: derived reads ∪ skip == manifest, EXACTLY', () => {
    // Direction 1 (silent-drop guard): a new PLoT field that is neither
    // derived nor skipped goes RED.
    const classified = new Set<string>([...derivedReal, ...ENRICHMENT_ANALYSIS_LLM_SKIP.keys()]);
    expect(sorted(classified)).toEqual(sorted(ENRICHMENT_PRODUCER_MANIFEST));
  });

  it('a field is never both derived (projected) and skipped', () => {
    const both = derivedReal.filter((k) => ENRICHMENT_ANALYSIS_LLM_SKIP.has(k));
    expect(both).toEqual([]);
  });

  it('every skip entry is a manifest field with a non-empty reason', () => {
    for (const [key, reason] of ENRICHMENT_ANALYSIS_LLM_SKIP) {
      expect(ENRICHMENT_PRODUCER_MANIFEST.has(key), `${key} skipped but not in manifest`).toBe(true);
      expect(reason.trim().length, `${key} has an empty skip reason`).toBeGreaterThan(0);
    }
  });

  it('POSITIVE CONTROL — the classification checker SEES a dropped field', () => {
    // Simulate a deriver being silently removed: drop one real derived field
    // from the classified union and prove the equality assertion detects the
    // now-unclassified manifest field (doctrine trap #13).
    const broken = new Set<string>([...derivedReal, ...ENRICHMENT_ANALYSIS_LLM_SKIP.keys()]);
    broken.delete('flip_thresholds');
    expect(sorted(broken)).not.toEqual(sorted(ENRICHMENT_PRODUCER_MANIFEST));
    const unclassified = [...ENRICHMENT_PRODUCER_MANIFEST].filter((k) => !broken.has(k));
    expect(unclassified).toContain('flip_thresholds');
  });
});

describe('runtime tripwire — findUnknownEnrichmentKeys / emit (context-audit #1 row #2)', () => {
  it('returns [] when every top-level key is in the manifest (no false alarm)', () => {
    const allKnown: Record<string, unknown> = {};
    for (const key of ENRICHMENT_PRODUCER_MANIFEST) allKnown[key] = 1;
    expect(findUnknownEnrichmentKeys(allKnown)).toEqual([]);
  });

  it('POSITIVE CONTROL — SEES an unknown key (proves it can detect a presence)', () => {
    const withUnknown = { option_comparison: [], brand_new_plot_field: 42 };
    expect(findUnknownEnrichmentKeys(withUnknown)).toEqual(['brand_new_plot_field']);
  });

  it('sanitises + caps a pathological key name; emits the NAME, never a value', () => {
    const nasty = `weird key/with spaces & ${'x'.repeat(100)}`;
    const out = findUnknownEnrichmentKeys({ [nasty]: 'SECRET_VALUE' });
    expect(out).toHaveLength(1);
    const name = out[0];
    // ≤ 64 chars + a single `~` truncation/replacement marker.
    expect(name.length).toBeLessThanOrEqual(MAX_LOGGED_ENRICHMENT_KEY_LENGTH + 1);
    expect(name.endsWith('~')).toBe(true);
    expect(name).not.toContain(' ');
    expect(name).not.toContain('/');
    // The value must never appear anywhere in the output.
    expect(name).not.toContain('SECRET_VALUE');
  });

  it('sanitiseEnrichmentKeyName leaves a clean short key unchanged', () => {
    expect(sanitiseEnrichmentKeyName('option_comparison')).toBe('option_comparison');
  });

  it('non-object / array input yields no unknown keys', () => {
    expect(findUnknownEnrichmentKeys(null)).toEqual([]);
    expect(findUnknownEnrichmentKeys(undefined)).toEqual([]);
    expect(findUnknownEnrichmentKeys([1, 2, 3])).toEqual([]);
    expect(findUnknownEnrichmentKeys('str')).toEqual([]);
  });

  it('emit fires ONE warn for an unknown key and stays silent for all-known', () => {
    const calls: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const fake: EnrichmentTripwireLogger = {
      warn: (payload, message) => {
        calls.push({ payload, message });
      },
    };

    // All-known → silent (positive control's negative half).
    const allKnown: Record<string, unknown> = {};
    for (const key of ENRICHMENT_PRODUCER_MANIFEST) allKnown[key] = 1;
    emitUnknownEnrichmentKeyTelemetry(allKnown, fake);
    expect(calls).toHaveLength(0);

    // Unknown key → exactly one loud, structured event carrying the sanitised
    // name (never the value).
    emitUnknownEnrichmentKeyTelemetry(
      { option_comparison: [], sneaky_new_field: { secret: 1 } },
      fake,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.event).toBe('v5.enrichment.unknown_producer_key');
    expect(calls[0].payload.unknown_keys).toEqual(['sneaky_new_field']);
    expect(calls[0].payload.unknown_key_count).toBe(1);
  });

  it('emit never throws on malformed input (observe-only contract)', () => {
    const thrower: EnrichmentTripwireLogger = {
      warn: () => {
        throw new Error('logger blew up');
      },
    };
    expect(() =>
      emitUnknownEnrichmentKeyTelemetry({ unknown_x: 1 }, thrower),
    ).not.toThrow();
    expect(() => emitUnknownEnrichmentKeyTelemetry(null, thrower)).not.toThrow();
  });
});

describe('projection cap parity (context-audit #1 row #6 — was comment-only)', () => {
  it('OPTION_GOAL_FIT_SIGNAL_CAP === OPTION_OUTCOME_SIGNAL_CAP === MAX_PROJECTED_OPTIONS', () => {
    // Fail-loud pin: the per-option annotation caps must never silently fall
    // below the option list they annotate. If MAX_PROJECTED_OPTIONS moves,
    // both caps must move with it or this goes RED.
    expect(OPTION_GOAL_FIT_SIGNAL_CAP).toBe(MAX_PROJECTED_OPTIONS);
    expect(OPTION_OUTCOME_SIGNAL_CAP).toBe(MAX_PROJECTED_OPTIONS);
  });
});
