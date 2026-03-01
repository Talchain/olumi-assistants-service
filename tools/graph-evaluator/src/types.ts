/**
 * Shared types for the graph evaluator tool.
 * These mirror the LLM output format from the draft-graph prompt (V3 format).
 */

// =============================================================================
// Graph types (matching LLM output format from the draft-graph prompt)
// =============================================================================

export interface GraphNodeData {
  value?: number;
  raw_value?: number;
  unit?: string;
  cap?: number;
  extractionType?: string;
  factor_type?: string;
  uncertainty_drivers?: string[];
  interventions?: Record<string, number>;
  [key: string]: unknown;
}

export interface GraphNode {
  id: string;
  kind: "goal" | "decision" | "option" | "outcome" | "risk" | "factor";
  label?: string;
  /** Factor category (controllable | observable | external) */
  category?: "controllable" | "observable" | "external";
  data?: GraphNodeData;
  /** External factor prior distribution */
  prior?: { distribution: string; range_min: number; range_max: number };
  /** Goal threshold fields */
  goal_threshold?: number;
  goal_threshold_raw?: number;
  goal_threshold_unit?: string;
  goal_threshold_cap?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
  /** Optional — may be absent; scoring uses strength.mean sign */
  effect_direction?: "positive" | "negative";
  /** "directed" (default) or "bidirected" (unmeasured confounder) */
  edge_type?: "directed" | "bidirected";
}

export interface CoachingItem {
  id: string;
  label?: string;
  detail?: string;
  action_type?: string;
  bias_category?: string;
}

export interface CoachingData {
  summary?: string;
  strengthen_items?: CoachingItem[];
}

export interface GoalConstraint {
  constraint_id?: string;
  node_id: string;
  operator?: string;
  value?: number;
  label?: string;
  unit?: string;
  source_quote?: string;
  confidence?: number;
  provenance?: string;
}

export interface CausalClaim {
  type: string;
  from?: string;
  to?: string;
  via?: string;
  between?: string[];
  stated_strength?: string;
}

export interface ParsedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  coaching?: CoachingData;
  goal_constraints?: GoalConstraint[];
  causal_claims?: CausalClaim[];
}

// =============================================================================
// Model configuration
// =============================================================================

export type TargetMode = "fast" | "normal" | "deep" | "baseline";

export interface ModelPricing {
  input_per_1m: number;
  output_per_1m: number;
  source: string;
}

export interface ModelConfig {
  id: string;
  display_name: string;
  provider: "openai";
  model: string;
  api_key_env: string;
  params: Record<string, unknown>;
  target_mode: TargetMode;
  pricing: ModelPricing;
}

// =============================================================================
// Brief
// =============================================================================

export interface BriefMeta {
  expect_status_quo: boolean;
  has_numeric_target: boolean;
  complexity: "simple" | "moderate" | "complex";
}

export interface Brief {
  id: string;
  meta: BriefMeta;
  /** Body text only — no front-matter. This is what gets sent to the LLM. */
  body: string;
}

// =============================================================================
// LLM responses
// =============================================================================

export type FailureCode =
  | "parse_failed"
  | "timeout_failed"
  | "rate_limited"
  | "auth_failed"
  | "invalid_request"
  | "server_error";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
}

export interface LLMResponse {
  model_id: string;
  brief_id: string;
  status: "success" | FailureCode;
  raw_text?: string;
  parsed_graph?: ParsedGraph;
  extraction_attempted?: boolean;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  est_cost_usd?: number;
  pricing_source?: "api_usage" | "model_config";
  failure_code?: FailureCode;
  error_message?: string;
}

// =============================================================================
// Scoring
// =============================================================================

export interface ScoreResult {
  structural_valid: boolean;
  violation_codes: string[];
  param_quality: number | null;
  option_diff: number | null;
  completeness: number | null;
  overall_score: number | null;
  node_count: number;
  edge_count: number;
}

// =============================================================================
// Run configuration
// =============================================================================

export interface RunConfig {
  run_id: string;
  timestamp: string;
  /** Path to the prompt file (relative to cwd) */
  prompt_file: string;
  prompt_content: string;
  model_ids: string[];
  brief_ids: string[];
  force: boolean;
  resume: boolean;
  dry_run: boolean;
  /** Absolute path to results directory */
  results_dir: string;
}

export interface ScoredResult {
  response: LLMResponse;
  score: ScoreResult;
  brief: Brief;
  model: ModelConfig;
}

// =============================================================================
// Run manifest
// =============================================================================

export interface RunManifest {
  run_id: string;
  timestamp: string;
  git_sha: string;
  tool_version: string;
  cli_args: string[];
  prompt: { filename: string; content_hash: string };
  models: Record<string, { config_hash: string }>;
  briefs: Record<string, { content_hash: string }>;
}

// =============================================================================
// Reporter
// =============================================================================

export interface ReportFiles {
  scores_csv: string;
  summary_md: string;
  analysis_pack_md: string;
}
