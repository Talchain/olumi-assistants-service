/**
 * Unified Pipeline Types
 *
 * Core interfaces for the 6-stage unified CEE pipeline.
 * StageContext is the single mutable context object passed through all stages.
 */

import type { FastifyRequest } from "fastify";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { DraftGraphInputT } from "../../schemas/assist.js";
import type { PipelineCheckpoint } from "../pipeline-checkpoints.js";
import type { DraftProvenanceDescriptor } from "../../context/context-pack.js";
import type { EdgeFieldStash } from "./edge-identity.js";
import type { RiskCoefficientCorrection } from "../transforms/risk-normalisation.js";
import type { EdgeFormat } from "./utils/edge-format.js";
import type { FieldDeletionEvent } from "./utils/field-deletion-audit.js";
import type { components } from "../../generated/openapi.d.ts";

type CEEDraftGraphResponseV1 = components["schemas"]["CEEDraftGraphResponseV1"];
type _CEEErrorResponseV1 = components["schemas"]["CEEErrorResponseV1"];
type CEEStructuralWarningV1 = components["schemas"]["CEEStructuralWarningV1"];
type CEEQualityMeta = components["schemas"]["CEEQualityMeta"];

// ---------------------------------------------------------------------------
// Pipeline Options
// ---------------------------------------------------------------------------

export interface UnifiedPipelineOpts {
  schemaVersion: "v1" | "v2" | "v3";
  strictMode?: boolean;
  includeDebug?: boolean;
  unsafeCaptureEnabled?: boolean;
  rawOutput?: boolean;
  refreshPrompts?: boolean;
  forceDefault?: boolean;
  signal?: AbortSignal;
  requestStartMs?: number;
  /**
   * ROADMAP 1.204 M1 — the staged-emission seam (the never-built D-M Option C
   * `onStage`, now with a consumer: the staged SSE sibling route).
   *
   * ABSENT (every pre-existing caller: the buffered /assist/v1/draft-graph
   * route, the 2-frame /assist/v1/draft-graph/stream route, and the V5
   * orchestrator's draft_graph tool) ⇒ the pipeline runs BYTE-IDENTICALLY to
   * before. Every emission site is guarded on this field being set, so the
   * OFF path pays one `undefined` check per stage boundary and nothing else.
   *
   * PRESENT ⇒ the pipeline calls it at stage boundaries that ALREADY EXIST.
   * It is a PURE OBSERVER: no stage is added, removed, or reordered, and the
   * emitter can neither change the response body nor fail the draft. That is
   * what makes the staged route's terminal frame byte-equivalent to the
   * buffered route's body BY CONSTRUCTION rather than by assertion.
   *
   * DELIBERATELY SYNCHRONOUS AND `void`-RETURNING. The pipeline never awaits
   * the consumer, so a slow or dead SSE socket can never stall or fail an
   * in-flight draft — the transport degrades to a plain buffered completion
   * (M3 snapshot/resume is out of scope). Throws are swallowed at the call
   * site (see `emitStageEvent` in ./index.ts).
   */
  onStage?: PipelineStageEmitter;
}

// ---------------------------------------------------------------------------
// Staged emission seam (ROADMAP 1.204 M1)
// ---------------------------------------------------------------------------

/**
 * Mid-flight progress, derived from the draft adapter's ALREADY-EXISTING token
 * accumulator (`acc` in adapters/llm/anthropic.ts) — the same character stream
 * the runaway detector and `time_to_edges_ms` are computed from. Carries node
 * LABELS ONLY: no strengths, no rationales, no coaching, no claims.
 */
export interface PipelineProgressEvent {
  kind: "PROGRESS";
  /** Node labels seen in the partial draft so far, in stream order. */
  labels: string[];
  /** Which region of the draft the accumulator has reached. */
  phase: "nodes" | "edges";
  elapsed_ms: number;
}

/**
 * The validated graph, emitted the moment Stage 4 (Repair) + the validation
 * pipeline complete and BEFORE the ~20 s coaching pass — i.e. at the point the
 * live probe measured as ~33 s of a ~53 s draft.
 *
 * Structure only. At this point in `runUnifiedPipeline`, `ctx.coaching` and
 * `ctx.causalClaims` are still `undefined` (the coaching pass has not run), so
 * this frame cannot carry a leader designation, a recommendation, or any
 * analysis claim — not by filtering, but because the claim-bearing fields do
 * not yet exist. See the claim-safety pin in
 * tests/integration/staged-draft-sse.test.ts.
 */
export interface PipelineGraphReadyEvent {
  kind: "GRAPH_READY";
  /**
   * The repaired + validated graph, ALREADY PROJECTED into the negotiated
   * schema vocabulary (`schema_version` below) so its node ids and labels are
   * byte-equal to the terminal frame's. Emitting the raw V1 graph here would
   * hand the client one set of ids at ~33 s and a different set at ~53 s —
   * see staged-graph-projection.ts.
   */
  graph: unknown;
  /** The vocabulary `graph` is expressed in — the negotiated schema version. */
  schema_version: "v1" | "v2" | "v3";
  elapsed_ms: number;
}

/**
 * The coaching pass has settled (completed, degraded, or budget-skipped).
 * Carries only its STATUS — the coaching prose itself rides the terminal
 * COMPLETE frame, which is the byte-identical buffered body, so coaching
 * reaches the client through exactly one path and one shape.
 */
export interface PipelineCoachingReadyEvent {
  kind: "COACHING_READY";
  coaching_status: CoachingStatus;
  elapsed_ms: number;
}

export type PipelineStageEvent =
  | PipelineProgressEvent
  | PipelineGraphReadyEvent
  | PipelineCoachingReadyEvent;

export type PipelineStageEmitter = (event: PipelineStageEvent) => void;

// ---------------------------------------------------------------------------
// Pipeline Result
// ---------------------------------------------------------------------------

export interface UnifiedPipelineResult {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Stage Context
// ---------------------------------------------------------------------------

export type DraftInputWithCeeExtras = DraftGraphInputT & {
  seed?: string;
  archetype_hint?: string;
  raw_output?: boolean;
  /** Pre-formatted BriefSignals header to append to user message (from preflight decision). */
  briefSignalsHeader?: string;
  /** Deterministic bias signals from BriefSignals v1 — persisted in response payload + trace. */
  bias_signals?: Array<{ type: string; confidence: string; evidence: string }>;
  /** Pre-formatted currency context instruction to append to LLM prompts. */
  currencyInstruction?: string;
};

export interface StageContext {
  // ── Inputs (immutable after init) ──────────────────────────────────────
  readonly input: DraftInputWithCeeExtras;
  readonly rawBody: unknown;
  readonly request: FastifyRequest;
  readonly requestId: string;
  readonly opts: UnifiedPipelineOpts;
  readonly start: number;

  // ── Mutable graph (stages 1–4 write, stage 5+ read-only) ──────────────
  graph: GraphV1 | undefined;

  // ── Stage 1 (Parse) outputs ────────────────────────────────────────────
  rationales: any[];
  draftCost: number;
  draftAdapter: any;
  llmMeta: any;
  confidence: number | undefined;
  effectiveBrief: string;
  edgeFieldStash: EdgeFieldStash | undefined;
  skipRepairDueToBudget: boolean;
  repairTimeoutMs: number;
  draftDurationMs: number;
  /** LLM coaching output — preserved via .passthrough() from draft adapter */
  coaching?: unknown;
  /** LLM causal claims — validated and passed through to response (Phase 2B) */
  causalClaims?: unknown;
  /** v0.11.0 schema amendment: LLM topology plan — string array describing
   *  graph layout. Stashed at Stage 1 Parse, packaged at Stage 5, and
   *  carried V1 → V3 with deep-equality preservation at Stage 6. */
  topologyPlan?: unknown;
  /** LLM-emitted goal constraints — merged with regex-extracted constraints in Stage 4 */
  llmGoalConstraints?: Array<Record<string, unknown>>;
  /** True if parse stage retried the LLM call due to default strength detection. */
  strengthDefaultRetried?: boolean;
  /** Strength default detection result from the initial attempt (for telemetry). */
  strengthDefaultDetection?: { detected: boolean; total_edges: number; defaulted_count: number };

  // ── Stage 2 (Normalise) outputs ────────────────────────────────────────
  strpResult: any;
  riskCoefficientCorrections: RiskCoefficientCorrection[];
  transforms: any[];

  // ── Stage 3 (Enrich) outputs ───────────────────────────────────────────
  enrichmentResult: any;
  hadCycles: boolean;
  /**
   * ROADMAP 2.281 — ids of goal nodes whose `goal_threshold` the ENRICHER
   * minted this run, recorded at the mint site and consumed by Stage 4b.
   *
   * This is an ATTESTATION, not a heuristic: Stage 4b's "round raw + digit-free
   * label ⇒ possibly model-inferred" rule cannot distinguish a fabricated
   * number from a user-stated one by inspecting the number, and post-#789 the
   * enricher is the only draft mint — so without this record the sweep could
   * only ever delete targets the user actually supplied.
   *
   * Absent/empty ⇒ Stage 4b behaves exactly as it did before.
   */
  enricherMintedGoalIds?: Set<string>;
  enrichmentTrace?: {
    called_count: number;
    extraction_mode: string;
    factors_added: number;
    factors_enhanced: number;
    factors_skipped: number;
    llm_success?: boolean;
  };

  // ── Stage 4 (Repair) outputs ───────────────────────────────────────────
  nodeRenames: Map<string, string>;
  goalConstraints: any;
  /** Late STRP result (Stage 4 substep 6 — Rules 3,5 with goalConstraints context) */
  constraintStrpResult: any;
  structuralMeta: any;
  validationSummary: any;
  orchestratorRepairUsed?: boolean;
  orchestratorWarnings?: any[];
  repairTrace?: Record<string, unknown>;

  // ── Stage 4 Substep 1b (Deterministic sweep) outputs ─────────────────
  deterministicRepairs?: Array<{ code: string; path: string; action: string }>;
  // `context` carries validator-specific structured detail when available
  // (e.g. OPTIONS_IDENTICAL → { optionIds, signature }). Optional and
  // additive — existing consumers that destructure {code,path,message} are
  // unaffected. Consumed by the OPTIONS_IDENTICAL fail-fast gate in
  // stages/repair/index.ts (substep 1.5).
  remainingViolations?: Array<{
    code: string;
    path?: string;
    message?: string;
    context?: Record<string, unknown>;
  }>;
  /** Set by the deterministic sweep: Bucket-C violations survived the sweep
   *  (and PLoT validation is needed). Since ROADMAP 2.731 removed the draft
   *  path's LLM repair, this no longer triggers any repair call — it remains
   *  a truthful sweep diagnostic (predicts the post-enforcement 422 when the
   *  deterministic normalisation cannot clear the violations) and still
   *  gates substep 1b's defer-vs-422 decision. */
  llmRepairNeeded?: boolean;
  detectedEdgeFormat?: EdgeFormat;

  // ── Stage 4b (Threshold Sweep) outputs ──────────────────────────────
  thresholdSweepTrace?: {
    ran: boolean;
    duration_ms: number;
    goals_checked: number;
    strips_applied: number;
    warnings_emitted: number;
    codes: string[];
  };

  // ── Stage 5 (Package) outputs ──────────────────────────────────────────
  quality: CEEQualityMeta | undefined;
  archetype: any;
  draftWarnings: CEEStructuralWarningV1[];
  ceeResponse: CEEDraftGraphResponseV1 | undefined;
  pipelineTrace: any;

  // ── Stage 6 (Boundary) outputs ─────────────────────────────────────────
  finalResponse: unknown;

  // ── Cross-cutting ──────────────────────────────────────────────────────
  collector: any; // CorrectionCollector
  pipelineCheckpoints: PipelineCheckpoint[];
  checkpointsEnabled: boolean;
  earlyReturn?: UnifiedPipelineResult;

  // ── Stage snapshots (observability — goal_threshold field tracking) ──
  stageSnapshots?: Record<string, StageSnapshot>;

  // ── Plan annotation checkpoint (captured after Stage 3 — Enrich) ──
  planAnnotation?: PlanAnnotationCheckpoint;

  // ── Field deletion audit telemetry ──────────────────────────────────────
  /** Per-field deletion events collected across repair stages. Emitted in trace.field_deletions. */
  fieldDeletions?: FieldDeletionEvent[];

  // ── ContextPack v1 (Stream C — assembled in Stage 5 Package) ──
  contextPack?: DraftProvenanceDescriptor;

  // ── Pipeline outcome (Track 1: progressive degradation) ──
  pipelineOutcome: PipelineOutcome;
}

// ---------------------------------------------------------------------------
// Pipeline Outcome (Track 1: progressive degradation metadata)
// ---------------------------------------------------------------------------

export type SoftGateStatus = 'passed' | 'skipped' | 'failed_degraded';
export type EnrichmentStatus = 'complete' | 'partial' | 'skipped';
// 'skipped_budget' (Lane C2, 2026-07-23): the post-draft coaching pass was
// SKIPPED because the request budget remaining after a successful draft could
// not fit the pass to completion — coaching is canonical-empty and A2's async
// coaching-ingest lane fills it. Surfaced on `_pipeline_outcome.coaching_status`
// so probes and the async-ingest lane can count budget-skips (distinct from a
// pass that ran and completed → 'complete', or one that ran and errored →
// 'failed_degraded'). A drafted graph with empty coaching beats a 504.
export type CoachingStatus = 'complete' | 'partial' | 'failed_degraded' | 'skipped_budget';

export interface PipelineWarning {
  stage: string;
  error: string;
  degraded: boolean;
  /**
   * True when the pipeline stage produced a typed fail-closed response
   * rather than degrading. Distinct from `degraded: true` (which means
   * the pipeline continued with lower-quality output). Introduced with
   * the MC-29 boundary-stage fix.
   */
  blocked?: boolean;
}

export interface RepairProvenanceEntry {
  rule: string;
  code: string;
  node_or_edge_id: string;
  field: string;
  before: unknown;
  after: unknown;
  source: 'structure' | 'brief_extraction' | 'fallback_default';
}

export interface LlmRepairOutcome {
  triggered: boolean;
  outcome: 'accepted' | 'rejected' | 'timed_out' | 'skipped';
  fallback_reason: string | null;
  attempts: number;
}

export interface FactorValueCoverage {
  total: number;
  explicit: number;
  inferred_with_evidence: number;
  fallback_default: number;
}

/**
 * Present on every response (success and error). Tracks which stages
 * passed, were skipped, or failed with degradation.
 */
export interface PipelineOutcome {
  graph_drafted: boolean;
  graph_structurally_valid: boolean;
  deterministic_sweep_violations: number;
  verification_status: SoftGateStatus;
  validation_status: SoftGateStatus;
  enrichment_status: EnrichmentStatus;
  coaching_status: CoachingStatus;
  warnings: PipelineWarning[];

  // Deterministic pipeline diagnostic metrics (CEE-only, not forwarded through orchestrator)
  rescue_score: number;
  factor_value_coverage: FactorValueCoverage;
  edge_strength_unique_count: number;
  llm_repair: LlmRepairOutcome;
  repair_provenance: RepairProvenanceEntry[];
}

/**
 * Lightweight snapshot of goal node state at a pipeline stage boundary.
 *
 * Sentinel values:
 *  - `null`     → field is explicitly `null` on the node (LLM output JSON null)
 *  - `"absent"` → field is `undefined` / not present on the node
 */
export interface StageSnapshot {
  goal_node_id: string | null;
  goal_threshold: number | null | "absent";
  goal_threshold_raw: number | null | "absent";
  goal_threshold_unit: string | null | "absent";
  goal_threshold_cap: number | null | "absent";
  goal_constraints_count: number;
}

// ---------------------------------------------------------------------------
// Plan Annotation Checkpoint (captured after Stage 3 — Enrich)
// ---------------------------------------------------------------------------

/**
 * Plan annotation checkpoint captured after Stage 3 (Enrich) completes.
 *
 * Provides lineage for Review Pass and enables future two-phase flows.
 * Stored as a sibling to StageSnapshot on the context — not inside it —
 * because StageSnapshot tracks goal node fields while this captures
 * whole-graph plan state.
 */
export interface PlanAnnotationCheckpoint {
  /** UUID v4 generated once at checkpoint — stable for the request */
  plan_id: string;
  /** Deterministic hash of graph state at Stage 3 (same graph → same hash) */
  plan_hash: string;
  /** Rationales captured during Parse (Stage 1), snapshotted at Stage 3 */
  stage3_rationales: {
    node_id: string;
    rationale: string;
  }[];
  /** Confidence breakdown at Stage 3 boundary */
  confidence: {
    overall: number;
    structure: number;
    parameters: number;
  };
  /** Clarifications not yet resolved at Stage 3 */
  open_questions: string[];
  /**
   * DEPRECATED: Remove after Stream D Review Pass ships (target: v1.14).
   * Use context_hash from DraftProvenanceDescriptor (provenance.context_hash) instead.
   *
   * Legacy hash of input context (brief + seed only — incomplete).
   * Renamed from `context_hash` to make migration grep-able.
   */
  context_hash_v0: string;
  /** Model used for Parse/Enrich */
  model_id: string;
  /** Prompt version from config */
  prompt_version: string;
}
