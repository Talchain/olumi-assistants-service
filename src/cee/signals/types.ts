/**
 * BriefSignals v1 — Deterministic brief quality signal types.
 *
 * These types define the shape of signals extracted from a decision brief
 * by `computeBriefSignals()`. Computed exactly once per request inside
 * `evaluatePreflightDecision()` — never recomputed downstream.
 */

// ============================================================================
// Numeric Anchor
// ============================================================================

/**
 * A numeric value extracted from the brief with its unit and contextual role.
 *
 * Role classification uses same-sentence adjacency with precedence:
 *   target (highest) > constraint > baseline > context (lowest)
 *
 * Values are normalised: 200k→200000, 4.5m→4500000, 50%→50 (percentage points).
 * Years (1900–2099) and ordinals ("1st", "2nd") are excluded.
 */
export interface NumericAnchor {
  value: number;
  unit: string | null;
  role: "target" | "baseline" | "constraint" | "context";
  source_text: string;
}

// ============================================================================
// Constraint Marker
// ============================================================================

/** A constraint detected in the brief — budget caps, deadlines, or thresholds. */
export interface ConstraintMarker {
  type: "budget" | "deadline" | "threshold" | "other";
  has_value: boolean;
  source_text: string;
}

// ============================================================================
// Bias Signal
// ============================================================================

/**
 * A cognitive bias signal detected in the brief.
 *
 * Persisted in the response payload (`bias_signals` field) for downstream
 * consumption by the orchestrator/UI layer — not ephemeral.
 *
 * v1 supports two bias types: sunk_cost and anchoring.
 */
export interface BiasSignal {
  type: "sunk_cost" | "anchoring";
  confidence: "high";
  evidence: string;
}

// ============================================================================
// Missing Item
// ============================================================================

/**
 * A component missing from the brief, with a fixed priority order.
 *
 * Priority is never reordered:
 *   1=alternative, 2=measurable_outcome, 3=baseline, 4=constraint, 5=risk
 */
export interface MissingItem {
  component:
    | "alternative"
    | "measurable_outcome"
    | "baseline"
    | "constraint"
    | "risk";
  priority: number;
  suggested_question: string;
}

// ============================================================================
// BriefSignals (top-level)
// ============================================================================

/**
 * Deterministic quality signals extracted from a decision brief.
 *
 * Computed by `computeBriefSignals()` in <50ms for briefs up to 1000 words.
 * Pure regex/string matching — no external calls, no NLP.
 *
 * **Compute-once rule:** Call exactly once per request inside
 * `evaluatePreflightDecision()`. Attach to the decision result. All
 * downstream consumers (context header, telemetry, response payload)
 * read from there — never recompute.
 */
export interface BriefSignals {
  option_count_estimate: number;
  option_markers: string[];
  has_explicit_goal: boolean;
  goal_markers: string[];
  has_measurable_target: boolean;
  target_markers: NumericAnchor[];
  baseline_state: "present" | "unknown_explicit" | "missing";
  baseline_markers: NumericAnchor[];
  has_constraints: boolean;
  constraint_markers: ConstraintMarker[];
  has_risks: boolean;
  risk_markers: string[];
  numeric_anchors: NumericAnchor[];
  numeric_anchor_count: number;
  bias_signals: BiasSignal[];
  brief_strength: "strong" | "ok" | "weak";
  missing_items: MissingItem[];
  word_count: number;
  sentence_count: number;
}
