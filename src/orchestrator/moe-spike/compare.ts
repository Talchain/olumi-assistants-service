/**
 * MoE Spike — comparison engine.
 *
 * Pure, synchronous, deterministic. Compares spike specialist result with BIL.
 *
 * Verdict logic:
 * - spike_adds_value: ≥2 spike-only bias signals with confidence ≥ 0.7 that
 *   are not contradicted by BIL (i.e. BIL doesn't have the same bias_type).
 * - spike_worse: ≥2 BIL-only bias signals AND 0 spike-only signals.
 * - equivalent: everything else.
 *
 * stakeholder_completeness is observational metadata only — not used in verdict.
 * framing/diversity comparisons are heuristic proxies — not decisive evidence.
 */

import type { MoeSpikeResult, MoeSpikeComparison } from "./schemas.js";
import type { BriefIntelligence } from "../../schemas/brief-intelligence.js";
import { MOE_SPIKE_VERSION } from "./schemas.js";

export function compareSpikeWithBil(
  spike: MoeSpikeResult,
  bil: BriefIntelligence,
  briefHash: string,
): MoeSpikeComparison {
  // ── Bias matching (case-insensitive by bias_type) ──
  const spikeTypes = new Set(spike.bias_signals.map((s) => s.bias_type.toLowerCase()));
  const bilTypes = new Set(bil.dsk_cues.map((c) => c.bias_type.toLowerCase()));

  const biasAgreed: string[] = [];
  const biasAgreedTypes = new Set<string>();
  const biasSpikeOnly: string[] = [];
  const biasBilOnly: string[] = [];

  for (const t of spikeTypes) {
    if (bilTypes.has(t)) {
      biasAgreed.push(t);
      biasAgreedTypes.add(t);
    } else {
      biasSpikeOnly.push(t);
    }
  }
  for (const t of bilTypes) {
    if (!spikeTypes.has(t)) {
      biasBilOnly.push(t);
    }
  }

  // ── Framing comparison ──
  // Heuristic proxy. BIL completeness_band is not a direct framing quality measure.
  const bilFraming: 'strong' | 'moderate' | 'weak' =
    bil.completeness_band === 'high' ? 'strong' :
    bil.completeness_band === 'medium' ? 'moderate' : 'weak';
  const framingAgrees = spike.framing_quality === bilFraming;

  // ── Diversity comparison ──
  // Heuristic proxy. BIL options count is not a direct diversity measure.
  const bilDiversity: 'diverse' | 'similar' | 'single_lever' =
    bil.options.length >= 3 ? 'diverse' :
    bil.options.length === 2 ? 'similar' : 'single_lever';
  const diversityAgrees = spike.diversity_assessment === bilDiversity;

  // ── Missing elements comparison (case-insensitive) ──
  const spikeMissing = new Set(spike.missing_elements.map((e) => e.toLowerCase()));
  const bilMissing = new Set(bil.missing_elements.map((e) => e.toLowerCase()));

  const missingElementsSpikeOnly = [...spikeMissing].filter((e) => !bilMissing.has(e));
  const missingElementsBilOnly = [...bilMissing].filter((e) => !spikeMissing.has(e));

  // ── Verdict ──
  // Only bias signals and missing elements drive the verdict.
  // Stakeholder, framing, diversity are observational — not decisive.
  const highConfSpikeOnly = spike.bias_signals.filter(
    (s) => !biasAgreedTypes.has(s.bias_type.toLowerCase())
      && s.confidence >= 0.7
      // Not contradicted: BIL doesn't have the same bias_type at all
      && !bilTypes.has(s.bias_type.toLowerCase()),
  );

  let verdict: MoeSpikeComparison['verdict'];
  if (highConfSpikeOnly.length >= 2) {
    verdict = 'spike_adds_value';
  } else if (biasBilOnly.length >= 2 && biasSpikeOnly.length === 0) {
    verdict = 'spike_worse';
  } else {
    verdict = 'equivalent';
  }

  return {
    version: MOE_SPIKE_VERSION,
    brief_hash: briefHash,
    bias_agreed: biasAgreed,
    bias_spike_only: biasSpikeOnly,
    bias_bil_only: biasBilOnly,
    framing_agrees: framingAgrees,
    diversity_agrees: diversityAgrees,
    missing_elements_spike_only: missingElementsSpikeOnly,
    missing_elements_bil_only: missingElementsBilOnly,
    spike_bias_count: spikeTypes.size,
    bil_bias_count: bilTypes.size,
    verdict,
  };
}
