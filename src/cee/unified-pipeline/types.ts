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
}
