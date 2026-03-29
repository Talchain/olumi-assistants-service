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
  display_name?: string;
  /** Provider identifier. Defaults to 'openai' at load time if absent from JSON. */
  provider: "openai" | "anthropic";
  model: string;
  /** OpenAI: env var name for the API key (e.g. OPENAI_API_KEY). */
  api_key_env?: string;
  params?: Record<string, unknown>;
  target_mode?: TargetMode;
  pricing?: ModelPricing;
  // Provider-specific fields (see providers/types.ts for semantics)
  max_tokens?: number;
  timeout_ms?: number;
  reasoning_effort?: string | null;
  thinking?: { type: string };
  effort?: string;
}

// =============================================================================
// Brief (draft_graph)
// =============================================================================

/** Expected constraint entry in brief metadata for constraint_retention scoring. */
export interface ExpectedConstraint {
  /** Case-insensitive substring to match against constraint label or node_id */
  keyword: string;
  /** Exact operator match: "<=" or ">=" */
  operator: string;
  /** Expected value within ±0.02 tolerance */
  value: number;
  /** If true, value must be >= 1.0 (ratio scale, not incorrectly normalised to 0-1) */
  can_exceed_one?: boolean;
}

/** Expected ratio metric entry in brief metadata for ratio_encoding scoring. */
export interface ExpectedRatioMetric {
  /** Case-insensitive substring to match against node labels */
  keyword: string;
  /** Minimum plausible value when correctly encoded (e.g. 1.0 for NRR >= 100%) */
  expected_min: number;
}

export interface BriefMeta {
  expect_status_quo: boolean;
  has_numeric_target: boolean;
  complexity: "simple" | "moderate" | "complex";
  /** If true, the graph must include ≥1 external factor (scored in external_factor_presence) */
  expect_external_factor?: boolean;
  /** Expected constraints for constraint_retention scoring */
  expected_constraints?: ExpectedConstraint[];
  /** Expected ratio metrics for ratio_encoding scoring */
  ratio_metrics?: ExpectedRatioMetric[];
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
  /** Generic parsed JSON for non-draft_graph types */
  parsed_json?: Record<string, unknown>;
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
  /** Legacy dimensions (preserved for backward compatibility) */
  param_quality: number | null;
  option_diff: number | null;
  completeness: number | null;
  /** New dimensions (v187+) */
  constraint_retention: number | null;
  ratio_encoding: number | null;
  external_factor_presence: number | null;
  coaching_quality: number | null;
  overall_score: number | null;
  node_count: number;
  edge_count: number;
}

// =============================================================================
// Prompt type system
// =============================================================================

export type PromptType = "draft_graph" | "edit_graph" | "decision_review" | "research" | "orchestrator" | "repair_graph" | "validate_graph";

// =============================================================================
// Generic fixture / score for multi-type support
// =============================================================================

/** Base fixture type — all evaluator types extend this */
export interface BaseFixture {
  id: string;
  name: string;
  description: string;
}

/** Generic score result — per-type scorers produce this */
export interface GenericScoreResult {
  overall: number | null;
  dimensions: Record<string, boolean | number | null>;
  parse_error?: string;
  unmatched_numbers?: Array<{ value: number; field_path: string }>;
}

/** A scored result for any evaluator type */
export interface GenericScoredResult {
  response: LLMResponse;
  score: GenericScoreResult;
  fixture_id: string;
  model: ModelConfig;
  prompt_type: PromptType;
}

// =============================================================================
// Edit-graph types
// =============================================================================

export interface EditGraphFixture extends BaseFixture {
  graph: ParsedGraph;
  edit_instruction: string;
  expected: {
    has_operations: boolean;
    expected_op_types?: string[];
    forbidden_op_types?: string[];
    topology_must_hold: boolean;
    expect_warning_substrings?: string[];
    expect_rerun: boolean;
  };
}

export interface EditGraphScore {
  valid_json: boolean;
  correct_shape: boolean;
  operation_types_correct: boolean;
  topology_compliant: boolean;
  has_impact_rationale: boolean;
  correct_ordering: boolean;
  empty_ops_handled: boolean;
  coaching_present: boolean;
  path_syntax_valid: boolean;
  overall: number;
}

// =============================================================================
// Decision-review types
// =============================================================================

export interface DecisionReviewFixture extends BaseFixture {
  input: {
    winner: { id: string; label: string; win_probability: number; outcome_mean: number };
    runner_up: { id: string; label: string; win_probability: number; outcome_mean: number } | null;
    margin: number | null;
    deterministic_coaching: {
      headline_type: string;
      readiness: string;
      evidence_gaps: Array<{ factor_id: string; factor_label: string; voi: number; confidence: number }>;
      model_critiques: Array<{
        type: string;
        severity: string;
        message: string;
        suggested_action?: string;
        affected_node_ids?: string[];
      }>;
    };
    isl_results: {
      option_comparison: Array<{
        option_id: string;
        option_label: string;
        win_probability: number;
        outcome: { mean: number; p10: number; p90: number };
      }>;
      factor_sensitivity: Array<{
        factor_id: string;
        factor_label: string;
        elasticity: number;
        confidence: number;
      }>;
      fragile_edges: Array<{
        edge_id: string;
        from_label: string;
        to_label: string;
        switch_probability: number;
        alternative_winner_id?: string;
        alternative_winner_label?: string;
      }>;
      robustness: { recommendation_stability: number; overall_confidence: number };
    };
    graph: { nodes: GraphNode[]; edges: GraphEdge[] };
    brief: string;
  };
  /** Whether to inject <SCIENCE_CLAIMS> section into the prompt */
  inject_dsk?: boolean;
  expected: {
    tone: "confident" | "balanced" | "cautious" | "structural";
    must_mention_factors: string[];
    bias_types_expected?: string[];
    dsk_fields_expected: boolean;
    pre_mortem_expected: boolean;
    forbidden_phrases?: string[];
  };
}

export interface DecisionReviewScore {
  valid_json: boolean;
  schema_complete: boolean;
  story_headlines_match: boolean;
  evidence_enhancements_coverage: boolean;
  scenario_contexts_valid: boolean;
  grounding_compliance: boolean;
  tone_alignment: boolean;
  bias_findings_grounded: boolean;
  dsk_fields_correct: boolean;
  pre_mortem_correct: boolean;
  overall: number;
  unmatched_numbers?: Array<{ value: number; field_path: string }>;
}

// =============================================================================
// Research types
// =============================================================================

export interface ResearchFixture extends BaseFixture {
  query: string;
  context_hint: string | null;
  target_factor: string | null;
  expected: {
    min_findings_length: number;
    min_source_count: number;
    must_contain_keywords: string[];
    expects_numeric_values: boolean;
    expects_confidence_note: boolean;
    forbidden_substrings: string[];
  };
}

export interface ResearchScore {
  valid_json: boolean;
  has_findings: boolean;
  findings_length_met: boolean;
  source_count_met: boolean;
  keyword_coverage: boolean;
  no_forbidden_substrings: boolean;
  has_numeric_values: boolean;
  has_confidence_note: boolean;
  overall: number;
}

// =============================================================================
// Orchestrator types
// =============================================================================

export interface OrchestratorTurn {
  role: "user" | "assistant";
  content: string | null;
}

// ── TurnContext schema (v30.3) ──────────────────────────────────────────────

export interface EntityRef {
  id: string;
  label: string;
}

export interface FactorEntityRef extends EntityRef {
  category: "controllable" | "observable" | "external";
  value?: number | null;
  has_prior?: boolean;
}

export interface GoalEntityRef extends EntityRef {
  threshold?: number | null;
  unit?: string;
}

export interface EdgeRef {
  from: string;
  to: string;
  strength_mean: number;
  exists_probability: number;
}

export interface ConstraintRef {
  id: string;
  node_id: string;
  label: string;
  operator: string;
  value: number;
}

export interface TurnContext {
  scenario_id: string;
  turn_id: string;
  stage: "frame" | "ideate" | "evaluate" | "decide";
  entities: {
    decisions: EntityRef[];
    options: EntityRef[];
    factors: FactorEntityRef[];
    outcomes: EntityRef[];
    risks: EntityRef[];
    goals: GoalEntityRef[];
    edges: EdgeRef[];
    constraints: ConstraintRef[];
  };
  graph: {
    node_count: number;
    edge_count: number;
    option_count: number;
    missing_structural: string[];
  };
  analysis: {
    status: "not_run" | "ready" | "running" | "completed" | "stale";
    staleness_reason: string | null;
    winner: { id: string; label: string; probability: number } | null;
    runner_up: { id: string; label: string; probability: number } | null;
    robustness_band: "fragile" | "moderate" | "stable" | "highly_stable" | null;
    top_drivers: Array<{ id: string; label: string; sensitivity: number }>;
    fragile_edges: Array<{ from_label: string; to_label: string }>;
    constraints_met: boolean | null;
  };
  capabilities: {
    can_run_analysis: boolean;
    can_explain_results: boolean;
    can_edit_graph: boolean;
    can_compare_options: boolean;
    can_generate_artefact: boolean;
    disabled_reasons: Record<string, string>;
  };
  blockers: Array<{
    type: string;
    target_id: string | null;
    target_label: string | null;
    message: string;
    suggested_action_type: string;
  }>;
  signals: {
    high_uncertainty_factors: Array<{ id: string; label: string; reason: string }>;
    dominant_factor: { id: string; label: string; sensitivity: number } | null;
    close_call: boolean;
    missing_option_families: string[];
    default_value_count: number;
    weak_edges: Array<{ from_label: string; to_label: string; exists_probability: number }>;
  };
  conversation: {
    turn_count: number;
    last_user_intent: string | null;
    last_tool_used: string | null;
    recent_actions_taken: string[];
    recent_actions_declined: string[];
    pending_confirmation: { action_type: string; description: string; proposal: unknown } | null;
    last_failed_action: { action_type: string; reason: string } | null;
  };
  eligible_actions: string[];
}

// ── Fixture (v30.3 TurnContext-based) ───────────────────────────────────────

export interface OrchestratorFixture extends BaseFixture {
  /** The stage context for the fixture */
  stage: "frame" | "ideate" | "evaluate" | "decide";
  /** Single-turn user message */
  user_message?: string;
  /** Multi-turn conversation. assistant turns with null content are filled by the model. */
  turns?: OrchestratorTurn[];
  /** Full TurnContext for v30.3 prompt format */
  turn_context: TurnContext;
  /** Expected behaviour assertions */
  expected: {
    /** Whether response should use uncertainty language (not absolutes) */
    expects_uncertainty_language: boolean;
    /** Forbidden phrases that must not appear */
    forbidden_phrases?: string[];
    /** Required substrings in text */
    must_contain?: string[];
    /** Scenario-specific assertion function name (scored in scenario_specific dimension) */
    scenario_assertions?: ScenarioAssertion[];
  };
}

export interface ScenarioAssertion {
  /** Human-readable description of the assertion */
  description: string;
  /** Check type */
  check: "action_type_absent" | "action_type_present" | "target_id_omitted" | "text_contains" | "text_not_contains" | "max_actions" | "min_actions" | "asks_question" | "no_rubber_stamp" | "proposes_structural_fix";
  /** Value for the check (e.g., action_type name, substring) */
  value?: string | number;
}

// ── Score (v30.3 dimensions) ────────────────────────────────────────────────

export interface OrchestratorScore {
  valid_json: boolean;
  text_quality: boolean;
  insight_compliance: boolean;
  action_eligibility: boolean;
  parameter_validity: boolean;
  fabrication_check: boolean;
  banned_terms: boolean;
  scenario_specific: boolean;
  overall: number;
}

export interface JudgeDimensionScore {
  score: number;
  reason: string;
}

export interface JudgeResult {
  rubric_version: string;
  scores: {
    scientific_polymath: JudgeDimensionScore;
    causal_mechanism: JudgeDimensionScore;
    coaching_over_telling: JudgeDimensionScore;
    grounded_quantification: JudgeDimensionScore;
    warm_directness: JudgeDimensionScore;
    appropriate_brevity: JudgeDimensionScore;
    constructive_challenge: JudgeDimensionScore;
    elicitation_quality: JudgeDimensionScore;
    session_coherence: JudgeDimensionScore;
  };
  overall_impression: string;
  weighted_average: number;
  judge_latency_ms: number;
  judge_cost_usd: number;
  judge_error?: string;
}

// =============================================================================
// Repair-graph types
// =============================================================================

/** A violation to be fixed by the repair prompt. */
export interface RepairViolation {
  code: string;
  node_or_edge?: string;
  detail?: string;
}

export interface RepairGraphFixture extends BaseFixture {
  /** The graph (broken) to send to the repair prompt. */
  graph: ParsedGraph;
  /** Short brief text for context (optional — sent with the graph). */
  brief?: string;
  /** Violations reported by the validator for this graph. */
  violations: RepairViolation[];
  /** Scoring expectations. */
  expected: {
    /** Every violation code listed here must appear in output rationales. */
    violations_addressed: string[];
    /** These node IDs must be present (and unchanged) in the output. */
    preserve_node_ids: string[];
    /** These edge from->to pairs must NOT appear in the repaired output (removed/rerouted). */
    forbidden_edges?: Array<{ from: string; to: string }>;
    /** These edge from->to pairs MUST appear in the repaired output. */
    required_edges?: Array<{ from: string; to: string }>;
    /** If true, no outcome->goal or risk->goal bridge edges should be present (pre-sweep). */
    no_bridge_edges: boolean;
    /** If true, any bidirected edges in the input must appear unchanged in output. */
    preserve_bidirected: boolean;
    /** If true, verify all new external factor nodes include a prior field. */
    check_external_prior: boolean;
    /** If set, verify inbound sum on this node is <=1.0 after repair. */
    check_inbound_sum_node?: string;
    /** If true, verify no // or block comments in the response JSON text. */
    no_json_comments: boolean;
  };
}

export interface RepairGraphScore {
  valid_json: boolean;
  correct_schema: boolean;
  violations_addressed: boolean;
  ids_preserved: boolean;
  forbidden_edges_removed: boolean;
  required_edges_present: boolean;
  no_bridge_edges: boolean;
  bidirected_preserved: boolean;
  external_prior_present: boolean;
  inbound_sum_valid: boolean;
  no_json_comments: boolean;
  overall: number;
}

// =============================================================================
// Validate-graph types
// =============================================================================

/** Expected edge properties for validate_graph scoring. */
export interface ValidateGraphExpectedEdge {
  from: string;
  to: string;
}

export interface ValidateGraphFixture extends BaseFixture {
  /** The graph to send for independent parameter estimation. */
  graph: ParsedGraph;
  /** Brief text for context. */
  brief: string;
  /** Scoring expectations. */
  expected: {
    /** In-scope directed causal edges (excludes structural + bidirected). */
    in_scope_edges: ValidateGraphExpectedEdge[];
  };
}

export interface ValidateGraphScore {
  valid_json: boolean;
  edge_coverage: boolean;
  budget_constraint: boolean;
  uncertainty_constraint: boolean;
  basis_consistency: boolean;
  no_zero_means: boolean;
  differentiation: boolean;
  edge_ordering: boolean;
  precision: boolean;
  overall: number;
}

// =============================================================================
// Evaluator adapter interface
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EvaluatorAdapter<F = any> {
  loadCases(dir: string): Promise<F[]>;
  buildRequest(fixture: F, prompt: string): { system: string; user: string };
  parseResponse(raw: string): { parsed: Record<string, unknown> | null; error?: string };
  score(fixture: F, parsed: Record<string, unknown> | null, response: LLMResponse): GenericScoreResult;
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
  prompt_type: PromptType;
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
