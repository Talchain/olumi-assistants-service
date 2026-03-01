/**
 * Deterministic Science Knowledge Base (DSK) types.
 *
 * Consumed by the DSK loader, validator, linter, and canonicaliser.
 * All types are structural — no runtime validation here (see linter.ts).
 */

export type DecisionStage =
  | "frame"
  | "ideate"
  | "evaluate"
  | "decide"
  | "optimise";

export interface Citation {
  doi_or_isbn: string;
  page_or_section: string;
}

export interface ClaimReference {
  claim_id: string;
  claim_version: string;
}

/** Fields shared by every DSK object. */
export interface DSKObjectBase {
  /** Immutable, format: /^DSK-(B|T|TR)\d{3}$/ */
  id: string;
  type: "claim" | "protocol" | "trigger";
  /** Human-readable name, e.g. "Anchoring bias" */
  title: string;
  evidence_strength: "strong" | "medium" | "weak" | "mixed";
  contraindications: string[];
  stage_applicability: DecisionStage[];
  /** e.g. 'pricing', 'hiring', 'build_vs_buy' */
  context_tags: string[];
  /** Semver, e.g. '1.0.0' */
  version: string;
  /** ISO 8601 date */
  last_reviewed_at: string;
  /** At least one required */
  source_citations: Citation[];
  deprecated: boolean;
  deprecated_reason?: string;
  /** Must reference a non-deprecated object of the same type */
  replacement_id?: string;
}

export interface DSKClaim extends DSKObjectBase {
  type: "claim";
  claim_category:
    | "empirical"
    | "technique_efficacy"
    | "causal_rule"
    | "population";
  scope: {
    /** At least one required */
    decision_contexts: string[];
    /** At least one required */
    stages: DecisionStage[];
    /** At least one required */
    populations: string[];
    /** At least one required (use ['none'] if genuinely universal) */
    exclusions: string[];
  };
  permitted_phrasing_band: "strong" | "medium" | "weak";
  evidence_pack: {
    key_findings: string;
    effect_direction: "positive" | "negative" | "mixed" | "null";
    boundary_conditions: string;
    known_limitations: string;
  };
}

export interface DSKProtocol extends DSKObjectBase {
  type: "protocol";
  /** At least one required */
  steps: string[];
  required_inputs: string[];
  expected_outputs: string[];
}

export interface DSKTrigger extends DSKObjectBase {
  type: "trigger";
  observable_signal: string;
  recommended_behaviour: string;
  /** At least one required — when NOT to fire */
  negative_conditions: string[];
  linked_claim_ids: string[];
  linked_protocol_ids: string[];
}

export type DSKObject = DSKClaim | DSKProtocol | DSKTrigger;

export interface DSKBundle {
  /** Bundle semver */
  version: string;
  /** ISO 8601 — metadata only, excluded from hash */
  generated_at: string;
  /** Canonical hash computed by tooling, verified at load */
  dsk_version_hash: string;
  objects: DSKObject[];
}

/** Controlled vocabulary for context_tags */
export const CONTEXT_TAG_VOCABULARY = [
  "pricing",
  "hiring",
  "build_vs_buy",
  "market_entry",
  "resource_allocation",
  "general",
] as const;

export type ContextTag = (typeof CONTEXT_TAG_VOCABULARY)[number];

/** Valid DecisionStage values */
export const DECISION_STAGES: readonly DecisionStage[] = [
  "frame",
  "ideate",
  "evaluate",
  "decide",
  "optimise",
] as const;

/** Valid evidence_strength values */
export const EVIDENCE_STRENGTHS = [
  "strong",
  "medium",
  "weak",
  "mixed",
] as const;

/** Valid claim_category values */
export const CLAIM_CATEGORIES = [
  "empirical",
  "technique_efficacy",
  "causal_rule",
  "population",
] as const;

/** Valid effect_direction values */
export const EFFECT_DIRECTIONS = [
  "positive",
  "negative",
  "mixed",
  "null",
] as const;

/** Valid DSK object type discriminants */
export const DSK_OBJECT_TYPES = ["claim", "protocol", "trigger"] as const;

/** Regex for valid DSK IDs */
export const DSK_ID_REGEX = /^DSK-(B|T|TR)\d{3}$/;
