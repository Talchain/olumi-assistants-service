/**
 * Tier 0 S1 — Decision Data Spine proof slice: typed reader / narrowing.
 *
 * Reads the LIVE V5 turn-response shape (POST /proxy/v5/turn): the analysis
 * result sits at `blocks[0]` and the rich scientific fields under
 * `blocks[0].enrichment`. This module extracts that loose
 * `Record<string, unknown>` and narrows it into a typed scientific view.
 *
 * ── DESIGN BOUNDARY ────────────────────────────────────────────────────────
 *  - READ-ONLY: never mutates its input. `view.raw` is the SAME object
 *    reference that was passed in — preservation is byte-for-byte.
 *  - PURE: no I/O, no telemetry, no fs, no persistence. Unlike
 *    context/freshness.ts (which has a telemetry-emitting companion) this
 *    module has NO side-effecting path at all.
 *  - CEE-LOCAL TYPES ONLY: the live shape is NOT the richer repo-typed
 *    `V2RunResponse`/`V2RunResponseEnvelope` (which puts
 *    results/factor_sensitivity/robustness at the TOP level, not under
 *    `enrichment`). We deliberately do NOT import that type, `@talchain/schemas`,
 *    or any response-shaping module — doing so would mistype the live shape and
 *    couple the proof slice to forbidden files. We narrow defensively from
 *    `unknown` instead.
 */

import { KNOWN_ENRICHMENT_KEYS } from './claim-safety.js';

// ── local narrowing helpers (mirrors the is-guard idiom in context/*, not imported) ──
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

export interface FactorSensitivityView {
  readonly factorId: string | null;
  readonly factorLabel: string | null;
  readonly elasticity: number | null;
  readonly sensitivityScore: number | null;
  readonly influenceScore: number | null;
  readonly direction: string | null;
  readonly confidence: number | null;
  /** VOI embedded in a sensitivity row (composite field). */
  readonly valueOfInformation: number | null;
  /** EVPI embedded in a sensitivity row (composite field). */
  readonly evpiPercentagePoints: number | null;
}

export interface FactorStabilityView {
  readonly factorId: string | null;
  readonly factorLabel: string | null;
  readonly elasticityStd: number | null;
  readonly rankFlipRate: number | null;
  readonly attributionStability: string | null;
}

export interface OptionOutcomeView {
  readonly mean: number | null;
  readonly p10: number | null;
  readonly p50: number | null;
  readonly p90: number | null;
}

export interface OptionComparisonView {
  readonly optionId: string | null;
  readonly optionLabel: string | null;
  readonly winProbability: number | null;
  readonly outcome: OptionOutcomeView | null;
}

export interface FragileEdgeView {
  readonly edgeId: string | null;
  readonly fromId: string | null;
  readonly toId: string | null;
  readonly switchProbability: number | null;
  readonly alternativeWinnerId: string | null;
}

export interface NearTieView {
  readonly isTie: boolean | null;
  readonly gap: number | null;
  readonly threshold: number | null;
}

export interface RobustnessView {
  readonly level: string | null;
  readonly isRobust: boolean | null;
  readonly recommendationStability: number | null;
  readonly confidence: number | null;
  readonly fragileEdges: FragileEdgeView[];
  readonly nearTie: NearTieView | null;
}

export interface FlipThresholdView {
  readonly factorId: string | null;
  readonly factorLabel: string | null;
  readonly currentValue: number | null;
  readonly flipValue: number | null;
  readonly direction: string | null;
  readonly flipReason: string | null;
}

export interface IdentifiabilityView {
  readonly status: string | null;
  readonly method: string | null;
  readonly pairsChecked: number | null;
  readonly pairsIdentifiable: number | null;
}

export interface EvidenceGapView {
  readonly factorId: string | null;
  readonly factorLabel: string | null;
  readonly voiScore: number | null;
  readonly evpiPercentagePoints: number | null;
  readonly evpiMethod: string | null;
}

export interface ScientificEnrichmentView {
  /** The original enrichment object, unchanged (same reference). */
  readonly raw: Record<string, unknown>;
  readonly factorSensitivity: FactorSensitivityView[] | null;
  readonly factorStability: FactorStabilityView[] | null;
  readonly edgeSensitivity: unknown[] | null;
  readonly edgeEValues: unknown[] | null;
  readonly robustness: RobustnessView | null;
  readonly optionComparison: OptionComparisonView[] | null;
  readonly conditionalWinners: unknown[] | null;
  readonly flipThresholds: FlipThresholdView[] | null;
  readonly identifiability: IdentifiabilityView | null;
  readonly confidenceTier: string | null;
  /** Value-of-information / EVPI gaps, sourced from `m1_coaching.evidence_gaps`. */
  readonly evidenceGaps: EvidenceGapView[] | null;
  readonly inferenceWarnings: unknown[] | null;
  /** Enrichment keys the spine does not recognise (preserved verbatim in `raw`). */
  readonly unknownFields: string[];
}

/**
 * Extract `blocks[0].enrichment` from a live turn response. Defensive: returns
 * `null` (never throws) for any non-conforming `unknown`.
 */
export function extractBlock0Enrichment(turnResponse: unknown): Record<string, unknown> | null {
  const root = asRecord(turnResponse);
  if (!root) return null;
  const blocks = asArray(root.blocks);
  if (!blocks || blocks.length === 0) return null;
  const block0 = asRecord(blocks[0]);
  if (!block0) return null;
  return asRecord(block0.enrichment);
}

function narrowFactorSensitivity(v: unknown): FactorSensitivityView[] | null {
  const arr = asArray(v);
  if (!arr) return null;
  return arr.map((item) => {
    const r = asRecord(item) ?? {};
    return {
      factorId: asString(r.factor_id),
      factorLabel: asString(r.factor_label),
      elasticity: asNumber(r.elasticity),
      sensitivityScore: asNumber(r.sensitivity_score),
      influenceScore: asNumber(r.influence_score),
      direction: asString(r.direction),
      confidence: asNumber(r.confidence),
      valueOfInformation: asNumber(r.value_of_information),
      evpiPercentagePoints: asNumber(r.evpi_percentage_points),
    };
  });
}

function narrowFactorStability(v: unknown): FactorStabilityView[] | null {
  const arr = asArray(v);
  if (!arr) return null;
  return arr.map((item) => {
    const r = asRecord(item) ?? {};
    return {
      factorId: asString(r.factor_id),
      factorLabel: asString(r.factor_label),
      elasticityStd: asNumber(r.elasticity_std),
      rankFlipRate: asNumber(r.rank_flip_rate),
      attributionStability: asString(r.attribution_stability),
    };
  });
}

function narrowOutcome(v: unknown): OptionOutcomeView | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    mean: asNumber(r.mean),
    p10: asNumber(r.p10),
    p50: asNumber(r.p50),
    p90: asNumber(r.p90),
  };
}

function narrowOptionComparison(v: unknown): OptionComparisonView[] | null {
  const arr = asArray(v);
  if (!arr) return null;
  return arr.map((item) => {
    const r = asRecord(item) ?? {};
    return {
      optionId: asString(r.option_id) ?? asString(r.id),
      optionLabel: asString(r.option_label) ?? asString(r.label),
      winProbability: asNumber(r.win_probability),
      outcome: narrowOutcome(r.outcome),
    };
  });
}

function narrowFragileEdges(v: unknown): FragileEdgeView[] {
  const arr = asArray(v);
  if (!arr) return [];
  return arr.map((item) => {
    const r = asRecord(item) ?? {};
    return {
      edgeId: asString(r.edge_id),
      fromId: asString(r.from_id),
      toId: asString(r.to_id),
      switchProbability: asNumber(r.switch_probability),
      alternativeWinnerId: asString(r.alternative_winner_id),
    };
  });
}

function narrowRobustness(v: unknown): RobustnessView | null {
  const r = asRecord(v);
  if (!r) return null;
  const nearTieRec = asRecord(r.near_tie);
  return {
    level: asString(r.level),
    isRobust: asBoolean(r.is_robust),
    recommendationStability: asNumber(r.recommendation_stability),
    confidence: asNumber(r.confidence),
    fragileEdges: narrowFragileEdges(r.fragile_edges),
    nearTie: nearTieRec
      ? { isTie: asBoolean(nearTieRec.is_tie), gap: asNumber(nearTieRec.gap), threshold: asNumber(nearTieRec.threshold) }
      : null,
  };
}

function narrowFlipThresholds(v: unknown): FlipThresholdView[] | null {
  const arr = asArray(v);
  if (!arr) return null;
  return arr.map((item) => {
    const r = asRecord(item) ?? {};
    return {
      factorId: asString(r.factor_id),
      factorLabel: asString(r.factor_label),
      currentValue: asNumber(r.current_value),
      flipValue: asNumber(r.flip_value),
      direction: asString(r.direction),
      flipReason: asString(r.flip_reason),
    };
  });
}

function narrowIdentifiability(v: unknown): IdentifiabilityView | null {
  const r = asRecord(v);
  if (!r) return null;
  return {
    status: asString(r.status),
    method: asString(r.method),
    pairsChecked: asNumber(r.pairs_checked),
    pairsIdentifiable: asNumber(r.pairs_identifiable),
  };
}

function narrowEvidenceGaps(coaching: unknown): EvidenceGapView[] | null {
  const r = asRecord(coaching);
  if (!r) return null;
  const arr = asArray(r.evidence_gaps);
  if (!arr) return null;
  return arr.map((item) => {
    const g = asRecord(item) ?? {};
    return {
      factorId: asString(g.factor_id),
      factorLabel: asString(g.factor_label),
      voiScore: asNumber(g.voi_score),
      evpiPercentagePoints: asNumber(g.evpi_percentage_points),
      evpiMethod: asString(g.evpi_method),
    };
  });
}

/**
 * Narrow a live `blocks[0].enrichment` object into a typed scientific view.
 * Defensive over `unknown`; never throws, never mutates. `view.raw` is the same
 * reference as the input when the input is a plain object (preservation), else `{}`.
 */
export function narrowScientificEnrichment(enrichment: unknown): ScientificEnrichmentView {
  const raw = asRecord(enrichment) ?? {};
  const unknownFields = Object.keys(raw).filter((k) => !KNOWN_ENRICHMENT_KEYS.has(k));
  return {
    raw,
    factorSensitivity: narrowFactorSensitivity(raw.factor_sensitivity),
    factorStability: narrowFactorStability(raw.factor_stability),
    edgeSensitivity: asArray(raw.edge_sensitivity),
    edgeEValues: asArray(raw.edge_e_values),
    robustness: narrowRobustness(raw.robustness),
    optionComparison: narrowOptionComparison(raw.option_comparison),
    conditionalWinners: asArray(raw.conditional_winners),
    flipThresholds: narrowFlipThresholds(raw.flip_thresholds),
    identifiability: narrowIdentifiability(raw.identifiability),
    confidenceTier: asString(raw.confidence_tier),
    evidenceGaps: narrowEvidenceGaps(raw.m1_coaching),
    inferenceWarnings: asArray(raw.inference_warnings),
    unknownFields,
  };
}
