/**
 * Gold Brief Types for Parametric Edge Stability Benchmarks
 *
 * These types define the fixture format for gold briefs used in
 * edge stability benchmarking. Each brief is a realistic decision
 * scenario designed to exercise different graph topologies.
 */

// ---------------------------------------------------------------------------
// Gold Brief Definition
// ---------------------------------------------------------------------------

export interface GoldBrief {
  /** Stable identifier, e.g. "gold_001" */
  id: string;
  /** Increment on any change to the brief */
  version: number;
  /** Domain category for diversity tracking */
  domain: GoldBriefDomain;
  /** The full decision brief text sent to CEE */
  brief_text: string;
  /** Expected number of decision options */
  expected_option_count: number;
  /** Optional notes about what this brief exercises */
  notes?: string;
}

export type GoldBriefDomain =
  | "market_pricing"
  | "product_feature"
  | "hiring_team"
  | "operations"
  | "technology"
  | "strategy";

// ---------------------------------------------------------------------------
// Prompt Sensitivity Transformations
// ---------------------------------------------------------------------------

export interface SynonymMap {
  [original: string]: string;
}

export interface TransformationMetadata {
  /** Fixed synonym map for synonym_swap transform */
  synonym_map?: SynonymMap;
  /** Character index to split at for clause_reorder transform */
  clause_split_index?: number;
  /** 0-indexed sentence indices to convert for passive_voice transform */
  passive_voice_sentences?: number[];
}

export interface GoldBriefWithTransforms extends GoldBrief {
  /** Metadata for deterministic prompt transformations */
  transformations: TransformationMetadata;
}

// ---------------------------------------------------------------------------
// Gold Brief Set (top-level fixture)
// ---------------------------------------------------------------------------

export interface GoldBriefSet {
  /** Increment on any change to any brief or the set itself */
  gold_set_version: number;
  /** All gold briefs */
  briefs: GoldBrief[];
  /** Subset of brief IDs selected for prompt sensitivity testing */
  sensitivity_brief_ids: string[];
  /** Briefs with transformation metadata (for sensitivity subset) */
  sensitivity_briefs: GoldBriefWithTransforms[];
}
