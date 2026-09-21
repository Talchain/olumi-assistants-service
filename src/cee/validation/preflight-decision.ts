/**
 * Shared preflight decision function — single source of truth for the policy ladder.
 *
 * Both the sync route (/assist/v1/draft-graph) and the SSE route
 * (/assist/v1/draft-graph/stream) call this function. No policy ladder
 * logic lives in route handlers — only this module decides.
 *
 * Policy ladder (v1.17):
 *   1. preflight.valid === false (gibberish / empty / control chars)
 *      → action: "reject", HTTP 400
 *   2. Valid English + readiness below threshold + strict mode enabled
 *      → action: "clarify", HTTP 200 (sync) or SSE needs_clarification event (stream)
 *   3. Everything else
 *      → action: "proceed", caller runs the generation pipeline
 */

import { assessBriefReadiness } from "./readiness.js";
import type { ReadinessAssessment } from "./readiness.js";
import { computeBriefSignals } from "../signals/brief-signals.js";
import type { BriefSignals } from "../signals/types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Config subset consumed by the preflight decision function.
 * Note: preflightEnabled is NOT included — callers already guard with
 * `if (config.cee.preflightEnabled)` before calling this function.
 */
export interface PreflightDecisionConfig {
  preflightStrict: boolean;
  preflightReadinessThreshold: number;
}

/** Telemetry fields emitted identically from both routes. */
export interface PreflightTelemetryData {
  readiness_level: ReadinessAssessment["level"];
  readiness_score: number;
  gibberish: boolean;
  reject_reason: "gibberish" | "schema_violation" | null;
  word_count: number;
  dictionary_coverage: number;
  entropy: number;
}

/** Payload when action === "reject". */
export interface PreflightRejectPayload {
  rejection_reason: string;
  preflight_issues: ReadinessAssessment["preflight"]["issues"];
  message: string;
}

/** Payload when action === "clarify". */
export interface NeedsClarificationPayload {
  status: "needs_clarification";
  readiness_score: number;
  readiness_level: ReadinessAssessment["level"];
  summary: string;
  clarification_questions: string[];
  factors: ReadinessAssessment["factors"];
}

export interface PreflightDecision {
  /** The policy ladder outcome. */
  action: "reject" | "clarify" | "proceed";
  /**
   * HTTP status for sync route.
   * 400 = reject, 200 = clarify or proceed.
   * SSE route ALWAYS uses 200 for the HTTP response itself — check action instead.
   */
  httpStatus: 400 | 200;
  /** Populated for "reject" and "clarify"; null for "proceed". */
  payload: PreflightRejectPayload | NeedsClarificationPayload | null;
  /** Full readiness assessment — available to callers that need it (e.g. clarification enforcement). */
  readiness: ReadinessAssessment;
  /** Telemetry fields to emit as cee.preflight.completed (identical from both routes). */
  telemetry: PreflightTelemetryData;
  /**
   * Deterministic brief quality signals. Computed once; all downstream
   * consumers (header, telemetry, response payload) read from here.
   * Undefined when action === "reject" (gibberish/too-short — no signals).
   */
  briefSignals?: BriefSignals;
}

// ============================================================================
// Main decision function
// ============================================================================

/**
 * Evaluate the preflight policy ladder for a brief.
 *
 * Pure function — no side effects (no emit, no logging). The caller is
 * responsible for emitting telemetry and logging using the returned data.
 *
 * @param brief  The raw brief string (post-Zod validation, pre-preflight)
 * @param cfg    Config subset (preflightStrict, preflightReadinessThreshold)
 */
export function evaluatePreflightDecision(
  brief: string,
  cfg: PreflightDecisionConfig
): PreflightDecision {
  // Run preflight + readiness scoring
  const readiness = assessBriefReadiness(brief);

  // Build telemetry data (shared between sync and SSE routes)
  const gibberishIssue = readiness.preflight.issues.find(
    (i) => i.code === "BRIEF_APPEARS_GIBBERISH"
  );
  const schemaIssue = readiness.preflight.issues.find(
    (i) =>
      i.code === "BRIEF_TOO_SHORT" ||
      i.code === "BRIEF_TOO_FEW_WORDS" ||
      i.code === "BRIEF_INVALID_CHARACTERS"
  );
  const telemetry: PreflightTelemetryData = {
    readiness_level: readiness.level,
    readiness_score: readiness.score,
    gibberish: Boolean(gibberishIssue),
    reject_reason: gibberishIssue
      ? "gibberish"
      : schemaIssue
        ? "schema_violation"
        : null,
    word_count: readiness.preflight.metrics.word_count,
    dictionary_coverage: readiness.preflight.metrics.dictionary_coverage,
    entropy: readiness.preflight.metrics.entropy,
  };

  // ── Rung 1: Hard reject — brief is genuinely unusable ────────────────────
  if (!readiness.preflight.valid) {
    const primaryIssue = readiness.preflight.issues[0];
    const rejectionReason = primaryIssue?.code ?? "BRIEF_INVALID";

    // Skip BriefSignals computation on reject (gibberish/too-short)
    return {
      action: "reject",
      httpStatus: 400,
      payload: {
        rejection_reason: rejectionReason,
        preflight_issues: readiness.preflight.issues,
        message: primaryIssue?.message ?? "Brief failed validation",
      } satisfies PreflightRejectPayload,
      readiness,
      telemetry,
    };
  }

  // ── Compute BriefSignals (once — all downstream consumers read from here) ─
  const briefSignals = computeBriefSignals(brief);

  // ── Rung 2: Guidance — valid English, but underspecified (strict mode) ────
  if (cfg.preflightStrict && readiness.score < cfg.preflightReadinessThreshold) {
    // For weak briefs, use BriefSignals missing_items for targeted questions
    const clarificationQuestions =
      briefSignals.brief_strength === "weak"
        ? briefSignals.missing_items.slice(0, 2).map((m) => m.suggested_question)
        : (readiness.suggested_questions ?? []);

    return {
      action: "clarify",
      httpStatus: 200,
      payload: {
        status: "needs_clarification",
        readiness_score: readiness.score,
        readiness_level: readiness.level,
        summary: readiness.summary,
        clarification_questions: clarificationQuestions,
        factors: readiness.factors,
      } satisfies NeedsClarificationPayload,
      readiness,
      telemetry,
      briefSignals,
    };
  }

  // ── Rung 3: Proceed to generation pipeline ────────────────────────────────
  // For weak briefs in non-strict mode, include advisory clarification
  // questions in the payload. The UI can surface them without blocking
  // generation. Without this, BriefSignals is inert when CEE_PREFLIGHT_STRICT=false.
  let payload: NeedsClarificationPayload | null = null;
  if (briefSignals.brief_strength === "weak") {
    payload = {
      status: "needs_clarification",
      readiness_score: readiness.score,
      readiness_level: readiness.level,
      summary: readiness.summary,
      clarification_questions: briefSignals.missing_items
        .slice(0, 2)
        .map((m) => m.suggested_question),
      factors: readiness.factors,
    };
  }

  return {
    action: "proceed",
    httpStatus: 200,
    payload,
    readiness,
    telemetry,
    briefSignals,
  };
}
