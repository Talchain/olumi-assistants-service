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
import type { EdgeFieldStash } from "./edge-identity.js";
import type { RiskCoefficientCorrection } from "../transforms/risk-normalisation.js";
import type { EdgeFormat } from "./utils/edge-format.js";
import type { components } from "../../generated/openapi.d.ts";

type CEEDraftGraphResponseV1 = components["schemas"]["CEEDraftGraphResponseV1"];
type CEEErrorResponseV1 = components["schemas"]["CEEErrorResponseV1"];
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
}

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
  clarifierStatus: string | undefined;
  effectiveBrief: string;
  edgeFieldStash: EdgeFieldStash | undefined;
  skipRepairDueToBudget: boolean;
  repairTimeoutMs: number;
  draftDurationMs: number;
  /** LLM coaching output — preserved via .passthrough() from draft adapter */
  coaching?: unknown;
  /** LLM causal claims — validated and passed through to response (Phase 2B) */
  causalClaims?: unknown;

  // ── Stage 2 (Normalise) outputs ────────────────────────────────────────
  strpResult: any;
  riskCoefficientCorrections: RiskCoefficientCorrection[];
  transforms: any[];

  // ── Stage 3 (Enrich) outputs ───────────────────────────────────────────
  enrichmentResult: any;
  hadCycles: boolean;
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
  repairCost: number;
  repairFallbackReason: string | undefined;
  clarifierResult: any;
  structuralMeta: any;
  validationSummary: any;
  orchestratorRepairUsed?: boolean;
  orchestratorWarnings?: any[];
  repairTrace?: Record<string, unknown>;

  // ── Stage 4 Substep 1b (Deterministic sweep) outputs ─────────────────
  deterministicRepairs?: Array<{ code: string; path: string; action: string }>;
  remainingViolations?: Array<{ code: string; path?: string; message?: string }>;
  llmRepairNeeded?: boolean;
  llmRepairBriefIncluded?: boolean;
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
  /**
   * Schema version for migration compatibility.
   * Increment when adding/removing/renaming fields.
   */
  plan_annotation_version: "1";
  /**
   * Unique identifier for this execution. NOT stable across identical runs.
   * Use for request lineage tracking and log correlation.
   */
  plan_id: string;
  /**
   * Deterministic hash of plan content at Stage 3 checkpoint.
   * STABLE: same inputs → same plan_hash.
   *
   * CANONICAL PAYLOAD (hashed as a single object):
   * 1. graph — Stage 3 snapshot (nodes + edges in array order as received)
   * 2. rationales — post-truncation (max 50 × 500 chars), array order preserved
   * 3. confidence — { overall, structure, parameters } rounded to 3 decimal places
   *
   * Canonicalization: object keys are sorted alphabetically; array element
   * order is preserved as-is. See computeResponseHash / canonicalizeJson.
   *
   * Does NOT include: plan_id (random), timestamps, model_id, prompt_version
   * (these vary per execution but don't change the "plan content")
   *
   * Use for: caching, deduplication, replay verification.
   */
  plan_hash: string;
  /**
   * Rationales captured during Parse (Stage 1), snapshotted at Stage 3.
   *
   * Bounded to prevent trace bloat: max 50 entries, each rationale
   * truncated to 500 characters.
   */
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
   * Deterministic hash of input context (brief + seed only).
   *
   * PROVISIONAL: Will be replaced by full ContextPack hash (Stream C)
   * which includes prompt_version, model_id, selection, and other
   * context blocks. Do not build long-lived caching on this field.
   */
  context_hash: string;
  /** Model used for Parse/Enrich */
  model_id: string;
  /** Prompt version from config */
  prompt_version: string;
}
