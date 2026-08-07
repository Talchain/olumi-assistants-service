/**
 * CEE Orchestrator Types
 *
 * All TypeScript interfaces for the conversational orchestrator (Track C).
 * Faithfully reproduces the spec interfaces for:
 * - Request/response envelopes
 * - Blocks (conversation units)
 * - Context management
 * - Tool definitions
 * - PLoT V2 run response (narrow structural type)
 */

import type { GraphV3T, EdgeV3T, NodeV3T, OptionV3T } from "../schemas/cee-v3.js";

// ============================================================================
// Decision Stage
// ============================================================================

export type DecisionStage = 'frame' | 'ideate' | 'evaluate' | 'decide' | 'optimise';

// ============================================================================
// Request Types
// ============================================================================

// ============================================================================
// System Event Types — discriminated union on event_type
// ============================================================================

export type SystemEventType =
  | 'patch_accepted'
  | 'patch_dismissed'
  | 'direct_graph_edit'
  | 'direct_analysis_run'
  | 'feedback_submitted';

/** Opaque operation record sent from UI in patch events. */
export type SystemEventPatchOp = Record<string, unknown>;

export interface PatchAcceptedDetails {
  patch_id: string;
  block_id?: string;
  operations: SystemEventPatchOp[];
  applied_graph_hash?: string;
}

export interface PatchDismissedDetails {
  patch_id?: string;
  block_id?: string;
  reason?: string;
}

export interface DirectGraphEditDetails {
  changed_node_ids: string[];
  changed_edge_ids: string[];
  operations: ('add' | 'update' | 'remove')[];
}

/** No details — graph_state and analysis_state come from the turn request fields. */
export type DirectAnalysisRunDetails = Record<string, never>;

export interface FeedbackSubmittedDetails {
  turn_id: string;
  rating: 'up' | 'down';
  comment?: string;
}

export type SystemEvent =
  | { event_type: 'patch_accepted'; timestamp: string; event_id: string; details: PatchAcceptedDetails }
  | { event_type: 'patch_dismissed'; timestamp: string; event_id: string; details: PatchDismissedDetails }
  | { event_type: 'direct_graph_edit'; timestamp: string; event_id: string; details: DirectGraphEditDetails }
  | { event_type: 'direct_analysis_run'; timestamp: string; event_id: string; details: DirectAnalysisRunDetails }
  | { event_type: 'feedback_submitted'; timestamp: string; event_id: string; details: FeedbackSubmittedDetails };

export interface OrchestratorTurnRequest {
  /** User's natural language message */
  message: string;
  /** Current conversation context (graph, analysis, framing, messages) */
  context: ConversationContext;
  /** Scenario identifier */
  scenario_id: string;
  /** Optional system event (UI-originated) */
  system_event?: SystemEvent;
  /** Client-generated turn ID for idempotency */
  client_turn_id: string;
  /**
   * Full graph state provided by the UI.
   * Required when system_event.details.applied_graph_hash is set (patch_accepted Path A)
   * and for direct_analysis_run Path B validation.
   */
  graph_state?: GraphV3T | null;
  /**
   * Full analysis response provided by the UI (direct_analysis_run Path A).
   * When present, CEE skips PLoT /v2/run and uses this directly.
   */
  analysis_state?: V2RunResponseEnvelope | null;
  /** When true, the UI explicitly requested model generation (Generate Model button). */
  generate_model?: boolean;
  /** Chip click metadata — when present, bypass intent classification. */
  chip_metadata?: {
    action_type: string;
    parameters?: Record<string, unknown>;
  };
  /** Session decision state — echoed from previous turn's updated_session_state.
   *  Partial: UI may send incomplete state; mergeSessionState() fills defaults. */
  session_state?: Partial<import("./deterministic/session-state.js").SessionState>;
}

// ============================================================================
// Response Types
// ============================================================================

export interface SuggestedAction {
  label: string;
  prompt: string;
  role: 'facilitator' | 'challenger' | 'scientist';
  /** Deterministic chip transport — action type from the catalogue. */
  action_type?: string;
  /** Deterministic chip transport — typed parameters for the action. */
  parameters?: Record<string, unknown>;
}

export type ConversationalTopic =
  | 'framing'
  | 'editing'
  | 'configuring'
  | 'analysing'
  | 'explaining';

export type CanonicalConstraint = `${'budget' | 'timeline' | 'threshold'}:${string}`;

export interface LastFailedAction {
  tool: string;
  reason: string;
}

export interface PendingClarificationState {
  tool: 'edit_graph';
  original_edit_request: string;
  candidate_labels: string[];
}

export interface PendingProposalState {
  tool: 'edit_graph';
  original_edit_request: string;
  proposed_changes: ProposedChangesPayload;
  candidate_labels: string[];
  base_graph_hash: string;
}

export interface ConversationalState {
  active_entities: string[];
  stated_constraints: CanonicalConstraint[];
  current_topic: ConversationalTopic;
  last_failed_action: LastFailedAction | null;
  pending_clarification?: PendingClarificationState | null;
  pending_proposal?: PendingProposalState | null;
  /**
   * True when the previous assistant turn was a gap coaching response
   * (pre-analysis elicitation for missing factor values). When set, the
   * next run_analysis call auto-bypasses gap detection so the user can
   * proceed with defaults via natural language (e.g. "go ahead").
   */
  last_gap_coaching?: boolean;
}

export type ProposedChangeActionType =
  | 'value_update'
  | 'option_config'
  | 'structural_add'
  | 'structural_remove';

/**
 * @deprecated VESTIGIAL V4 proposed-change shape — carries NO value field, so a
 * proposal built from it can never represent the specific it asks for. Its only
 * remaining live use is building the propose-and-confirm "ask for the specifics"
 * copy WITHIN a turn (`buildProposeAndConfirmText`); it is no longer minted onto
 * the edit-lane hold (S3-L1 retired the write-only `pendingProposal` round-trip,
 * which nothing read back on the live V5 path). The value-bearing carrier is the
 * V5 `ProposedChange` (`orchestrator-v5/types/proposed-change.ts`, `params` +
 * `inline_patch.operations`), which has the live reader in
 * `proposed-change-synthesis.ts`. Do not add new consumers; prefer the V5 type.
 * Remaining references live behind the default-off V4 pipeline (410 tombstone).
 */
export interface ProposedChange {
  description: string;
  element_label: string;
  action_type: ProposedChangeActionType;
}

export interface ProposedChangesPayload {
  changes: ProposedChange[];
}

export interface OrchestratorError {
  code: 'LLM_TIMEOUT' | 'TOOL_EXECUTION_FAILED' | 'VALIDATION_REJECTED' | 'CONTEXT_TOO_LARGE' | 'INVALID_REQUEST' | 'MISSING_GRAPH_STATE' | 'INTERNAL_PAYLOAD_ERROR' | 'PLOT_RESPONSE_MALFORMED' | 'PIPELINE_ERROR' | 'UNKNOWN';
  message: string;
  tool?: string;
  recoverable: boolean;
  suggested_retry?: string;
}

export interface TurnPlan {
  selected_tool: string | null;
  routing: 'deterministic' | 'llm';
  long_running: boolean;
  tool_latency_ms?: number;
  /** All tools that executed this turn (in execution order). Single-tool turns have one entry. */
  executed_tools?: string[];
  /** Long-running tools deferred because one already executed this turn. */
  deferred_tools?: string[];
  /** Populated when the turn was driven by a system event. Additive — does not conflict with routing fields. */
  system_event?: { type: SystemEventType; event_id: string };
}


// ============================================================================
// Draft Coaching — UI-facing display shapes for envelope.draft_coaching
// ============================================================================

/** v0.11.0 schema amendment: WideningLog is now an object summary
 *  describing the widening process. The legacy "per-entry" shape
 *  (`{node_id,label,reason}[]`) is converted at the Anthropic adapter
 *  ingress seam in `src/adapters/llm/normalise-legacy-coaching.ts` —
 *  `node_id`s flow into `elements_added`; `reason` strings flow into
 *  `elements_considered_but_excluded`. */
export interface DraftCoachingWideningLog {
  elements_added: string[];
  elements_considered_but_excluded: string[];
  brief_completeness: "complete" | "partial" | "thin";
}

/** @deprecated Use `DraftCoachingWideningLog`. Retained for legacy
 *  `tools/draft-graph.ts` consumers during the v192b → v194 transition. */
export interface DraftCoachingWideningEntry {
  node_id: string;
  label: string;
  reason: string;
}

/** One bias signal raised by the coaching model on the user's brief. */
export interface DraftCoachingBiasSignal {
  type: string;
  detail: string;
  target?: string;
}

/** Strengthen-an-area item produced by the LLM coaching pass. Canonical
 *  definition lives here; tools/draft-graph.ts re-exports as StrengthenItem. */
export interface DraftCoachingStrengthenItem {
  id: string;
  label: string;
  detail: string;
  action_type: string;
  bias_category?: string;
}

/** Draft-time coaching payload stamped onto the response envelope after a
 *  successful draft_graph turn. summary / widening_log / bias_signals are
 *  null when the LLM did not produce that field; strengthen_items defaults
 *  to []. Used as the internal narrowed shape; consumers reading the wire
 *  response should use `DraftCoachingWire` (sibling type) which omits
 *  `widening_log` / `bias_signals` rather than emitting null. */
export interface DraftCoaching {
  summary: string | null;
  strengthen_items: DraftCoachingStrengthenItem[];
  /** v0.11.0 schema amendment: canonical object shape (was
   *  `DraftCoachingWideningEntry[] | null` pre-amendment). The
   *  Anthropic-adapter ingress normaliser converts legacy LLM array
   *  output to this shape so the canonical Zod parse passes. */
  widening_log: DraftCoachingWideningLog | null;
  bias_signals: DraftCoachingBiasSignal[] | null;
}

/** Wire shape of the `coaching` field on `/assist/v1/draft-graph` responses.
 *  Differs from `DraftCoaching` in that empty/absent `widening_log` and
 *  `bias_signals` are OMITTED from the response (undefined) rather than
 *  emitted as null — matches the V3 `coaching` schema (z.array(...).optional()).
 *  `summary` may still be null when the LLM produced no summary string. */
export interface DraftCoachingWire {
  summary: string | null;
  strengthen_items: DraftCoachingStrengthenItem[];
  /** v0.11.0 canonical object shape; OMITTED when the canonical object is
   *  empty (zero elements added, zero excluded, brief_completeness="thin"). */
  widening_log?: DraftCoachingWideningLog;
  bias_signals?: DraftCoachingBiasSignal[];
}

/** @deprecated Re-exported from `tools/draft-graph.ts` as `StrengthenItem` for
 *  back-compat. Prefer `DraftCoachingStrengthenItem` in new code. */
export type StrengthenItem = DraftCoachingStrengthenItem;

export interface ResponseLineage {
  context_hash: string;
  plan_hash?: string;
  response_hash?: string;
  seed_used?: number;
  n_samples?: number;
  /** PLoT graph hash from validate-patch. Only set on patch_accepted acks. */
  graph_hash?: string;
}

export interface OrchestratorResponseEnvelope {
  turn_id: string;
  assistant_text: string | null;
  blocks: TypedConversationBlock[];
  suggested_actions?: SuggestedAction[];
  analysis_response?: unknown;
  lineage: ResponseLineage;
  turn_plan?: TurnPlan;
  stage_indicator?: DecisionStage;
  /** Response format version. 2 = deterministic pipeline. */
  response_version?: number;
  /** LLM-generated insights (deterministic pipeline only, max 3). */
  insights?: Array<{ type: string; description: string; severity?: string; target_id?: string; science_concept?: string }>;

  /** Debug aid — not part of INT-3 contract */
  stage_label?: string;
  error?: OrchestratorError;
  /** Diagnostics content from LLM <diagnostics> tag. Only in non-production. */
  diagnostics?: string;
  /** Parse warnings from XML envelope extraction. Only in non-production. */
  parse_warnings?: string[];
  /** Structured debug summaries. Only in non-production. */
  debug?: OrchestratorDebugPayload;
  /** DSK deterministic coaching items. Omitted when DSK_COACHING_ENABLED=false or both arrays empty. */
  dsk_coaching?: import("../schemas/dsk-coaching.js").DskCoachingItems;
  /** Draft-time coaching from the unified pipeline. Set after a successful
   *  draft_graph turn; omitted on subsequent turns. Mirrors dsk_coaching in
   *  placement. */
  draft_coaching?: DraftCoaching;
  /** Server-constructed model receipt after draft_graph. */
  model_receipt?: ModelReceipt;
  /**
   * Diagnostic trace — tool-level LLM calls captured during this turn.
   * Gated by CEE_DIAGNOSTIC_TRACE_ENABLED. V1 pipeline parity with V2.
   */
  _diagnostic_trace?: import("./pipeline/diagnostic-trace.js").DiagnosticTrace;
}

export interface OrchestratorDebugPayload {
  response_summary: {
    assistant_text_present: boolean;
    assistant_text_length: number;
    block_count_by_type: Record<string, number>;
    suggested_action_count: number;
    error_present: boolean;
  };
  turn_summary: {
    stage: string | null;
    response_mode_declared: string | null;
    response_mode_inferred: string | null;
    tool_selected: string | null;
    tool_permitted: boolean | null;
  };
  fallback_summary: {
    fallback_injected: boolean;
    fallback_reason: string | null;
  };
  contract_summary: {
    contract_violations_count: number;
    contract_violation_codes: string[];
  };
}

// ============================================================================
// Model Receipt — server-side metadata for the UI after draft_graph
// ============================================================================

export interface ModelReceipt {
  node_count: number;
  edge_count: number;
  option_labels: string[];
  goal_label: string | null;
  top_insight: string | null;
  readiness_status: string | null;
  repairs_applied_count: number;
}

// ============================================================================
// V2RunResponseEnvelope — narrow structural type for PLoT /v2/run response
// ============================================================================

/**
 * CEE treats PLoT response as mostly opaque for forwarding but reads specific
 * fields for block construction. Uses unknown[] for arrays that are forwarded
 * without structural validation.
 */
export interface V2RunResponseEnvelope {
  meta: {
    seed_used: number;
    n_samples: number;
    response_hash: string;
    [k: string]: unknown;
  };
  /** OptionResult[] — CEE reads option_label, win_probability */
  results: unknown[];
  /** FactObjectV1[] — CEE reads fact_type, fact_id */
  fact_objects?: unknown[];
  /** ProposalCardV1[] — forwarded to ReviewCardBlock */
  review_cards?: unknown[];
  robustness?: {
    level: string;
    fragile_edges?: unknown[];
    [k: string]: unknown;
  };
  /** DecisionBriefV1 — used by generate_brief */
  decision_brief?: unknown;
  /** CEE reads label, elasticity, direction */
  factor_sensitivity?: unknown[];
  constraint_analysis?: {
    joint_probability?: number;
    per_constraint?: unknown[];
    [k: string]: unknown;
  };
  /** Top-level response_hash (preferred over meta.response_hash) */
  response_hash?: string;
  [k: string]: unknown;
}

// ============================================================================
// Block Types
// ============================================================================

export type BlockType = 'framing' | 'commentary' | 'graph_patch' | 'fact' | 'review_card' | 'brief' | 'evidence' | 'artefact';

export interface BlockProvenance {
  trigger: string;
  turn_id: string;
  timestamp: string;
}

export interface BlockAction {
  action_id: string;
  label: string;
  action_type: 'accept' | 'edit' | 'dismiss' | 'attach' | 'share' | 'rerun' | 'undo';
}

/**
 * Common fields shared by all block variants.
 * Use {@link TypedConversationBlock} for narrowing `data` by `block_type`.
 */
export interface ConversationBlock {
  block_id: string;
  block_type: BlockType;
  data: GraphPatchBlockData | FactBlockData | CommentaryBlockData | BriefBlockData | ReviewCardBlockData | FramingBlockData | EvidenceBlockData | ArtefactBlockData;
  actions?: BlockAction[];
  provenance: BlockProvenance;
  related_elements?: { node_ids?: string[]; edge_ids?: string[] };
}

/** Shared fields minus the discriminant pair — used internally by the union variants. */
interface ConversationBlockBase {
  block_id: string;
  actions?: BlockAction[];
  provenance: BlockProvenance;
  related_elements?: { node_ids?: string[]; edge_ids?: string[] };
}

/**
 * Discriminated union of ConversationBlock — enables TypeScript narrowing on
 * `block_type` to infer the correct `data` shape without double-casts.
 *
 * @example
 * ```ts
 * function handleBlock(block: TypedConversationBlock) {
 *   if (block.block_type === 'graph_patch') {
 *     block.data.operations; // TypeScript infers GraphPatchBlockData
 *   }
 * }
 * ```
 */
export type TypedConversationBlock =
  | (ConversationBlockBase & { block_type: 'graph_patch'; data: GraphPatchBlockData })
  | (ConversationBlockBase & { block_type: 'fact'; data: FactBlockData })
  | (ConversationBlockBase & { block_type: 'commentary'; data: CommentaryBlockData })
  | (ConversationBlockBase & { block_type: 'brief'; data: BriefBlockData })
  | (ConversationBlockBase & { block_type: 'review_card'; data: ReviewCardBlockData })
  | (ConversationBlockBase & { block_type: 'framing'; data: FramingBlockData })
  | (ConversationBlockBase & { block_type: 'evidence'; data: EvidenceBlockData })
  | (ConversationBlockBase & { block_type: 'artefact'; data: ArtefactBlockData })
  | (ConversationBlockBase & { block_type: 'comparison'; data: import('./deterministic/types.js').ComparisonBlockData })
  | (ConversationBlockBase & { block_type: 'premortem'; data: import('./deterministic/types.js').PremortemBlockData })
  | (ConversationBlockBase & { block_type: 'flip_analysis'; data: import('./deterministic/types.js').FlipAnalysisBlockData })
  | (ConversationBlockBase & { block_type: 'proposal'; data: import('./deterministic/types.js').ProposalBlockData })
  | (ConversationBlockBase & { block_type: 'exercise'; data: import('./deterministic/types.js').ExerciseBlockData });

// ---- Graph Patch Block ----

export type PatchType = 'full_draft' | 'edit' | 'repair';
export type PatchStatus = 'proposed' | 'accepted' | 'dismissed' | 'rejected';

export interface PatchOperation {
  op: 'add_node' | 'remove_node' | 'update_node' | 'add_edge' | 'remove_edge' | 'update_edge';
  path: string;
  value?: unknown;
  old_value?: unknown;
}

/**
 * PLoT emits repairs in two shapes:
 *  - Legacy: { action, field, from_value, reason, to_value }
 *  - F.5 canonical: { action, after, before, code, field, field_path, from_value, layer, reason, severity, to_value }
 *
 * `reason` is present in both — use it as the primary display field.
 * `code` is canonical-only — use it to identify repair type when available.
 */
export type RepairEntry =
  | {
      /** F.5 canonical shape */
      code: string;
      /** Origin layer: 'plot' for PLoT-applied repairs, 'cee' for CEE deterministic/boundary repairs */
      layer: 'plot' | 'cee';
      field_path: string;
      field?: string;
      before: unknown;
      after: unknown;
      from_value?: unknown;
      to_value?: unknown;
      reason: string;
      severity: 'info' | 'warn';
      action: string;
    }
  | {
      /** Legacy shape — no code, layer, or field_path */
      action: string;
      field: string;
      from_value: unknown;
      to_value: unknown;
      reason: string;
    };

export interface GraphPatchBlockData {
  patch_type: PatchType;
  operations: PatchOperation[];
  status: PatchStatus;
  /**
   * When true, the UI applies the patch immediately without an Accept/Dismiss gate.
   * Used for full_draft patches (draft_graph). Targeted edits (edit_graph) use false.
   */
  auto_apply?: boolean;
  applied_graph_hash?: string;
  /** Canonical graph state after PLoT applies the patch */
  applied_graph?: GraphV3T;
  /** Hash of the graph the patch was generated against (optimistic concurrency audit trail) */
  base_graph_hash?: string;
  /** Semantic repairs applied by PLoT (surfaced as-is, never rewritten into operations) */
  repairs_applied?: RepairEntry[];
  summary?: string;
  /**
   * Past-tense summary for proposal blocks. Lets the UI render the accepted
   * card without waiting for a patch_accepted round-trip. Populated alongside
   * `summary` on `'proposed'`/`'previewed'` blocks; omitted on blocks whose
   * `status` is already `'accepted'` (use `summary` directly there).
   */
  applied_summary?: string;
  rejection?: {
    reason: string;
    message?: string;
    code?: string;
    /** PLoT's specific rejection code (e.g. CYCLE_DETECTED). Only set when PLoT is the rejector. */
    plot_code?: string;
    /** PLoT's violation details (opaque — forwarded as-is). Only set when PLoT is the rejector. */
    plot_violations?: unknown[];
    /** Total LLM attempts before rejection (1 = no retry, 2 = one retry, etc.) */
    attempts?: number;
  };
  validation_warnings?: string[];
  /**
   * Analysis-ready payload from the draft pipeline (full_draft only).
   * Contains option intervention mappings, goal_node_id, and readiness status.
   * The UI uses this to populate the pre-analysis panel without a separate API call.
   */
  analysis_ready?: {
    options: Array<{
      option_id: string;
      label: string;
      status: string;
      interventions: Record<string, number>;
      is_baseline?: boolean;
      intervention_details?: Record<string, {
        display_value: string;
        normalised_value: number;
        raw_value?: number;
        unit?: string;
      }>;
      extraction_metadata?: Record<string, unknown>;
      raw_interventions?: Record<string, unknown>;
      status_reason?: string;
    }>;
    goal_node_id: string;
    status: string;
    blockers?: unknown[];
    model_adjustments?: unknown[];
    goal_threshold?: number;
    /**
     * ROADMAP 2.315(a) — the RAW goal target as the user stated it, alongside
     * the normalised `goal_threshold` above. Carried VERBATIM from the values
     * the enricher attested on the goal node; never re-derived downstream
     * (see the contract note on `AnalysisReadyPayload` in
     * src/schemas/analysis-ready.ts for why re-derivation is unsafe).
     */
    goal_threshold_raw?: number;
    goal_threshold_unit?: string;
    goal_threshold_cap?: number;
    bias_findings?: Array<{
      id: string;
      category: string;
      severity: string;
      node_ids?: string[];
      explanation?: string;
      code?: string;
    }>;
    /**
     * ISO-8601 UTC timestamp. V5 state-trust: when freshness derivation
     * selected a prior run_analysis fact, this is THAT fact's
     * computed_at (i.e. when the analysis ran), so explain / direct-
     * answer turns do NOT restamp a fresher timestamp than the underlying
     * analysis. When no fact is selected (freshness === 'none' /
     * 'unknown' with no fact), it falls back to wire-emit time.
     */
    computed_at?: string;
    /**
     * V5 state-trust freshness verdict. Tells the UI whether the analysis
     * matches the current graph state. Populated on every primary CEE
     * dispatch path (turn_executor, chip_click, draft_graph, edit_graph).
     * The `?` means "additive contract for forward compat" — future
     * dispatch paths can adopt the wire fields gradually without breaking
     * existing UI consumers; current paths always emit it.
     */
    freshness?: 'fresh' | 'stale' | 'unknown' | 'none';
    /** Stable string code for the freshness reason — debug / telemetry. */
    freshness_reason?: string;
    /** Hash of the analysis-affecting graph fields at the moment
     *  run_analysis executed. Present when freshness is fresh / stale. */
    graph_hash_at_run?: string;
    /** Hash of the analysis-affecting graph fields on this turn. */
    current_graph_hash?: string;
    /**
     * F1 model-understanding receipt (PR A): a short, sanitised, pre-analysis
     * "assumption to check" line for DGAI's ModelReceiptBlock top-insight.
     * Additive + passthrough-safe — `analysis_ready` is `.passthrough()` at
     * both the CEE schema (`src/schemas/analysis-ready.ts`) and the boundary
     * (`@talchain/schemas` OlumiResponseSchema), so it crosses the wire with
     * no shared-schema-package change. Understanding / assumption prose only:
     * the shared copy gate (gateAssumptionFragment) rejects recommendation /
     * winner / best-option phrasing, and post-analysis verdict / confidence /
     * likelihood *claims* cannot arise because the source is pre-analysis
     * draft coaching — bare "likely" / "confidence" / "verdict" may still
     * appear as legitimate pre-analysis assumptions and are kept consistent
     * with the chat narrative. Omitted / null when no signal-backed summary
     * exists; DGAI then
     * renders the receipt without a top-insight. Set by the draft dispatch and
     * stamped by the response finaliser; nothing renders it today (DGAI wiring
     * is PR B).
     */
    coaching_summary?: string | null;
  };
  /**
   * Explicit intervention updates extracted from edit_graph operations.
   * Each entry maps an option→factor intervention to its normalised numeric value.
   * Enables downstream consumers to merge intervention edits into the options[]
   * payload without re-parsing the graph.
   */
  intervention_updates?: Array<{
    option_id: string;
    factor_id: string;
    value: number;
  }>;
  /**
   * Per-operation metadata, indexed parallel to operations[].
   * Each entry: { impact, rationale } — rationale is the LLM's reason for the
   * change, surfaced in the UI's edit-confirmation block.
   * Mirrored at this top level so the UI can read it without reaching into
   * provenance._meta. Only populated when at least one operation has a
   * non-default impact or a non-empty rationale.
   */
  operation_meta?: Array<{
    impact: string;
    rationale: string;
  }>;
}

// ---- Fact Block ----

export interface FactBlockData {
  fact_type: string;
  facts: unknown[];
}

// ---- Commentary Block ----

export interface SupportingRef {
  ref_type: 'fact' | 'review_card' | 'evidence';
  ref_id: string;
  claim: string;
  ui_anchor?: { block_id?: string; section_id?: string };
}

export interface CommentaryBlockData {
  narrative: string;
  supporting_refs: SupportingRef[];
  /** Structured sections for deterministic explain_result blocks. */
  sections?: Array<{ heading: string; content?: string; items?: string[] }>;
}

// ---- Brief Block ----

export interface BriefBlockData {
  brief: unknown;
}

// ---- Review Card Block ----

export interface ReviewCardBlockData {
  card: unknown;
}

// ---- Framing Block ----

export interface FramingBlockData {
  stage: DecisionStage;
  goal?: string;
  constraints?: unknown[];
}

// ---- Evidence Block ----

/**
 * Evidence block — research findings from web search, grounded with citations.
 * Produced by research_topic tool. Claims and mapping suggestions are best-effort;
 * never auto-applied to the model — advisory only.
 *
 * ⚠ NO PRODUCER SINCE 2026-07-22. The `research_topic` tool that filled this shape was deleted
 * in `f957d6d8` (V1-belt sweep collateral — it met the "zero live-V5 importers" bar because V5
 * never ported it). Only `createEvidenceBlock()` in `blocks/factory.ts` names it, and that has
 * zero callers.
 *
 * RETAINED DELIBERATELY, and it is the most load-bearing of the research orphans: the SHIPPED
 * contract's `EvidenceBlock` (`@talchain/schemas` boundary/blocks.ts) describes an evidence
 * *gap* and carries no `sources[]`, no `url`, no `findings` — so today there is no wire shape
 * that can carry back what a research call actually found. The `sources[].{title,url}`,
 * `claims[].source_url` and `confidence_note` fields below are the drafted answer to exactly
 * that gap. Deleting this would discard a contract proposal, not dead weight.
 * See `docs-designs/RESEARCH-ARTEFACT-DESIGN-2026-07-25.md` (programme docs, sibling dir — untracked) §2.1 and §2.3.
 */
export interface EvidenceBlockData {
  query: string;
  target_factor: string | null;
  findings: string;
  claims?: Array<{
    claim: string;
    value: string | null;
    time_period: string | null;
    context: string | null;
    source_url: string | null;
  }>;
  model_mapping_suggestions?: Array<{
    target_factor: string;
    suggested_update: string;
    confidence: 'direct' | 'inferred';
  }>;
  sources: Array<{ title: string; url: string }>;
  confidence_note: string;
}

// ---- Artefact Block ----

/**
 * Artefact block — self-contained HTML block for interactive decision-support
 * outputs (decision matrices, charts, comparison tables). Passed through to
 * the UI unchanged; rendered in a sandboxed iframe.
 */
export interface ArtefactBlockData {
  artefact_type: string;
  title: string;
  description?: string;
  /** Raw HTML — preserved exactly as generated, no escaping or transformation. */
  content: string;
  actions?: Array<{
    label: string;
    message: string;
  }>;
}

// ============================================================================
// Context Types
// ============================================================================

export interface OptionForAnalysis {
  option_id: string;
  label: string;
  interventions: Record<string, unknown>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Array<{ name: string; input: Record<string, unknown> }>;
}

export interface AnalysisInputs {
  options: OptionForAnalysis[];
  constraints?: unknown[];
  seed?: number;
  n_samples?: number;
  [k: string]: unknown;
}

export interface ConversationContext {
  graph: GraphV3T | null;
  analysis_response: V2RunResponseEnvelope | null;
  framing: {
    stage: DecisionStage;
    goal?: string;
    constraints?: string[];
    options?: string[];
  } | null;
  messages: ConversationMessage[];
  event_log_summary?: string;
  selected_elements?: string[];
  scenario_id: string;
  analysis_inputs?: AnalysisInputs | null;
  conversational_state?: ConversationalState;
  /**
   * Context Architecture v2 S2 (ROADMAP 1.199): the persisted decision brief
   * (`scenarios.brief_text`), projected to the edit-lane slice — first
   * EDIT_CONTEXT_BRIEF_CHAR_CAP chars, truncation DISCLOSED via the same
   * {text, truncated, original_chars} shape the routing ContextPack uses
   * (ContextPackBriefSchema). Populated by dispatchEditGraph UNCONDITIONALLY
   * when a brief exists (S2 shipped ON, no-dark-launches); absent otherwise
   * (no-brief byte-identity). Rendered as `## Decision Brief` by
   * serialiseEditContextForLLM; repair_edit_graph inherits automatically
   * (same contextSection).
   */
  brief?: { text: string; truncated: boolean; original_chars: number } | null;
}

export interface OrchestratorEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface OrchestratorToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_block_types: BlockType[];
  requires: string[];
  long_running: boolean;
}

// ============================================================================
// HTTP Status Mapping
// ============================================================================

export function getHttpStatusForError(error: OrchestratorError): number {
  switch (error.code) {
    case 'LLM_TIMEOUT': return 504;
    case 'TOOL_EXECUTION_FAILED': return 502;
    case 'VALIDATION_REJECTED': return 422;
    case 'CONTEXT_TOO_LARGE': return 413;
    case 'INVALID_REQUEST': return 400;
    case 'MISSING_GRAPH_STATE': return 400;
    case 'INTERNAL_PAYLOAD_ERROR': return 500;
    case 'PLOT_RESPONSE_MALFORMED': return 502;
    case 'PIPELINE_ERROR': return 500;
    case 'UNKNOWN':
    default: return 500;
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { GraphV3T, EdgeV3T, NodeV3T, OptionV3T };

/** INT-3 convenience aliases */
export type ToolDefinition = OrchestratorToolDefinition;
export type V2RunResponse = V2RunResponseEnvelope;

// ============================================================================
// Applied Changes Receipt — returned on successful edit_graph
// ============================================================================

export interface AppliedChangeItem {
  /** Human-readable element label. Never contains internal IDs. */
  label: string;
  /** Description of the change (old->new or new state if old unavailable). */
  description: string;
  /** Node/edge path for UI highlighting. Not shown to user. */
  element_ref: string;
}

/**
 * Structured receipt for a successful edit_graph operation.
 * Additive supplement to GraphPatchBlock — does not replace it.
 */
export interface AppliedChanges {
  /** One compact sentence describing the net change. No internal IDs. */
  summary: string;
  changes: AppliedChangeItem[];
  /** True when an existing analysis would be materially affected by this change. */
  rerun_recommended: boolean;
}
