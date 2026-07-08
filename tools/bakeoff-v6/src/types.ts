/**
 * Core types for the V6 offline dual-model bake-off platform.
 *
 * BENCHMARK TOOLING ONLY. Nothing in this package is imported by src/** or
 * any production surface. Candidates validate against the REAL GraphV3
 * draft-graph contract imported read-only from src/schemas/cee-v3.ts.
 */

export type ArmId = "A" | "B" | "C" | "D";

export const ALL_ARMS: ArmId[] = ["A", "B", "C", "D"];

/** A decision brief loaded from the golden-brief fixture set. */
export interface BriefFixture {
  id: string;
  brief: string;
  sourcePath: string;
  sha256: string;
  /** Optional warranted reference set R for FGQ recall. Absent today (R unbuilt). */
  warrantedSet?: RItemInput[];
}

export interface RItemInput {
  id: string;
  kind: "positive" | "affirmative_defer";
  description?: string;
}

/** One LLM API call made by an arm, with full accounting. */
export interface CallRecord {
  purpose: string;
  requested_model: string;
  served_model: string | null;
  latency_ms: number;
  /** Raw usage object exactly as returned by the API (input/output/cache tokens). */
  usage: Record<string, unknown> | null;
  /**
   * Raw usage.iterations[] exactly as returned (advisor-tool / multi-attempt calls).
   * REQUIRED source of truth for arm-D cost — top-level tokens under-report.
   */
  iterations: unknown[] | null;
  cost_usd: number;
  /** True when cost had to fall back to top-level usage because iterations were absent. */
  cost_from_iterations: boolean;
  /** Finalized stream stop_reason (end_turn | max_tokens | refusal | ...). Captured for
   *  the dry run: max_tokens / refusal responses must be bucketed apart from schema-invalid. */
  stop_reason: string | null;
  error?: string;
}

export interface MergeFailure {
  proposal_index: number;
  proposal_type: string | null;
  reason: string;
}

export interface MergeReport {
  proposals_total: number;
  applied: number;
  artifacts: number;
  failures: MergeFailure[];
  /** Post-merge full-contract validation result. */
  post_merge_valid: boolean;
  post_merge_errors: string[];
}

/** A grounded defer/uncertainty/clarification artifact (non-mutating proposal). */
export interface DeferArtifact {
  type: string;
  question: string | null;
  rationale: string | null;
  evidence_pointer: string | null;
}

export interface CandidateTiming {
  started_at: string;
  finished_at: string;
  total_latency_ms: number;
}

/**
 * The stored record for one candidate: one arm x one brief x one seed.
 * `timing` is excluded from the canonical hash so deterministic paths can be
 * proven byte-identical across runs.
 */
export interface CandidateRecord {
  record_version: 1;
  run_id: string;
  arm: ArmId;
  brief_id: string;
  seed: number;
  prompt_hashes: Record<string, string>;
  prompt_placeholder: boolean;
  requested_models: string[];
  served_models: string[];
  calls: CallRecord[];
  cost_usd_total: number;
  /** The GraphV3 draft-graph candidate (CEEGraphResponseV3 shape) or null on failure. */
  candidate: unknown | null;
  validation: { valid: boolean; errors: string[] };
  /** Arm C only: raw M2 proposals + deterministic merge report. */
  arm_c: { proposals_raw: unknown[]; merge: MergeReport } | null;
  /** Arm D only: advisor advice texts + raw response content block types. */
  arm_d: { advice_texts: string[]; content_block_types: string[] } | null;
  /** Defer artifacts (arm C non-mutating proposals; normalized questions elsewhere). */
  artifacts: DeferArtifact[];
  failure: { stage: string; message: string } | null;
  timing: CandidateTiming;
  /** sha256 of the canonical (timing-free) form of this record. */
  canonical_hash: string;
}

export interface ResolvedArmModels {
  A: { model: string };
  B: { model: string; effort: string };
  C: { m1: string; m2: string };
  D: { executor: string; advisor: string };
}

export interface RunConfig {
  run_id: string;
  arms: ArmId[];
  brief_ids: string[] | null;
  seeds: number[];
  models: ResolvedArmModels;
  /** When true, uses the deterministic fixture client — no network, no keys. */
  mock: boolean;
  results_dir: string;
  /** Equal-compute tolerance, pre-declared. Fraction of USD target. */
  compute_tolerance: number;
}

export interface BlindCandidate {
  blind_id: string;
  brief: string;
  graph: BlindGraph;
  open_questions: string[];
}

export interface BlindGraph {
  nodes: BlindNode[];
  edges: BlindEdge[];
  options: BlindOption[];
  goal_node_id: string;
}

export interface BlindNode {
  id: string;
  kind: string;
  label: string;
  description?: string;
  value?: number;
  unit?: string;
  category?: string;
}

export interface BlindEdge {
  from: string;
  to: string;
  strength_mean: number;
  strength_std: number;
  exists_probability: number;
  effect_direction: string;
}

export interface BlindOption {
  id: string;
  label: string;
  description?: string;
  status: string;
  interventions: Array<{ factor_id: string; value: number; unit?: string }>;
}

export interface HolisticDeterministicScore {
  score: number;
  components: Record<string, number>;
  notes: string[];
}

export interface SafetyCellHit {
  cell: "invented_value_unit_or_effect" | "unsupported_causal_link" | "unsafe_to_apply";
  element_id: string;
  detail: string;
}

export interface PreflightModelResult {
  requested_model: string;
  models_api_ok: boolean;
  generation_ok: boolean;
  served_model: string | null;
  error: string | null;
}

export interface PreflightResult {
  ran_at: string;
  key_present: boolean;
  sdk_version: string;
  models: PreflightModelResult[];
  advisor_pairing_ok: boolean | null;
  advisor_error: string | null;
  pricing_stale: boolean;
  pricing_age_days: number;
  /** Per-arm verdict: may this arm make live calls? */
  arm_gate: Record<ArmId, { allowed: boolean; reason: string }>;
}
