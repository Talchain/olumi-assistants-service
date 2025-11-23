import type {
  CEETraceMeta,
  CEEQualityMeta,
  CEEValidationIssue,
  CEEDraftGraphResponseV1,
  CEEExplainGraphResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEOptionsResponseV1,
  CEEBiasCheckResponseV1,
  CEESensitivityCoachResponseV1,
  CEETeamPerspectivesResponseV1,
} from "./ceeTypes.js";
import {
  CEE_QUALITY_HIGH_MIN,
  CEE_QUALITY_MEDIUM_MIN,
  CEE_HEALTH_RISK_MAX,
  CEE_HEAVY_TRUNCATION_FLAG_COUNT,
  CEE_TEAM_DISAGREEMENT_MIN_SCORE,
} from "./ceePolicy.js";
import { OlumiAPIError, OlumiNetworkError } from "./errors.js";

export type CeeQualityBand = "confident" | "uncertain" | "low_confidence";

export function classifyCeeQuality(
  quality: CEEQualityMeta | null | undefined,
): CeeQualityBand | undefined {
  const overall = quality?.overall;
  if (typeof overall !== "number" || !Number.isFinite(overall)) {
    return undefined;
  }

  const score = Math.min(10, Math.max(1, Math.round(overall)));

  if (score >= 7) {
    return "confident";
  }

  if (score >= 4) {
    return "uncertain";
  }

  return "low_confidence";
}

// Union of all known CEE response envelopes.
export type AnyCEEEnvelope =
  | CEEDraftGraphResponseV1
  | CEEExplainGraphResponseV1
  | CEEEvidenceHelperResponseV1
  | CEEOptionsResponseV1
  | CEEBiasCheckResponseV1
  | CEESensitivityCoachResponseV1
  | CEETeamPerspectivesResponseV1;

type CEEWithLimits =
  | CEEDraftGraphResponseV1
  | CEEEvidenceHelperResponseV1
  | CEEBiasCheckResponseV1
  | CEEOptionsResponseV1
  | CEESensitivityCoachResponseV1;

export function getCEETrace<T extends { trace?: CEETraceMeta } | null | undefined>(
  response: T,
): CEETraceMeta | undefined {
  return response?.trace;
}

export function getCEEQualityOverall<T extends { quality?: CEEQualityMeta } | null | undefined>(
  response: T,
): number | undefined {
  return response?.quality?.overall;
}

export function getCEEValidationIssues<
  T extends { validation_issues?: CEEValidationIssue[] } | null | undefined,
>(response: T): CEEValidationIssue[] {
  const issues = response?.validation_issues;
  return Array.isArray(issues) ? issues : [];
}

// Return true if any known truncation flag is set on the response_limits block.
export function ceeAnyTruncated(
  response: CEEWithLimits | null | undefined,
): boolean {
  const limits = (response as any)?.response_limits;
  if (!limits || typeof limits !== "object") return false;

  const flags = [
    "items_truncated",
    "evidence_suggestions_truncated",
    "bias_findings_truncated",
    "options_truncated",
    "sensitivity_suggestions_truncated",
  ];

  return flags.some((key) => limits[key] === true);
}

export interface DecisionStorySummary {
  headline: string;
  key_drivers: string[];
  risks_and_gaps: string[];
  next_actions: string[];
  any_truncated: boolean;
  quality_overall?: number;
}

// Determine whether a CEE error is retryable based on HTTP status and code.
export function isRetryableCEEError(error: unknown): boolean {
  if (error instanceof OlumiNetworkError) {
    // Network errors are always retryable at the transport level.
    return true;
  }

  if (!(error instanceof OlumiAPIError)) {
    return false;
  }

  // 429 is always retryable (CEE or non-CEE).
  if (error.statusCode === 429) {
    return true;
  }

  const code = (error as any).code as string | undefined;
  if (code === "CEE_RATE_LIMIT") {
    return true;
  }

  // For other CEE error codes, defer to the server-side retryable hint where
  // available. The OlumiAPIError currently exposes only the details bag, so we
  // look for either a generic retryable flag or the cee_retryable helper flag
  // that the CEE client attaches when mapping CEEErrorResponseV1.
  const details = (error as any).details as { [key: string]: unknown } | undefined;
  if (!details || typeof details !== "object") {
    return false;
  }

  if ((details as any).retryable === true) {
    return true;
  }

  if ((details as any).cee_retryable === true) {
    return true;
  }

  return false;
}

export interface CeeErrorMetadata {
  ceeCode?: string;
  retryable: boolean;
  traceId?: string;
}

// Extract structured CEE error metadata for downstream consumers.
//
// This helper is intentionally metadata-only: it uses only error codes,
// retryability hints, and request/trace IDs surfaced by the SDK, and never
// inspects or re-emits any prompts, graphs, or LLM text.
export function getCeeErrorMetadata(error: unknown): CeeErrorMetadata {
  const retryable = isRetryableCEEError(error);
  let ceeCode: string | undefined;
  let traceId: string | undefined;

  if (error instanceof OlumiAPIError) {
    const details = error.details as { [key: string]: unknown } | undefined;

    const fromDetails =
      details && typeof (details as any).cee_code === "string"
        ? ((details as any).cee_code as string)
        : undefined;

    if (fromDetails) {
      ceeCode = fromDetails;
    } else if (typeof error.code === "string") {
      ceeCode = error.code;
    }

    if (typeof error.requestId === "string") {
      traceId = error.requestId;
    } else if (
      details &&
      typeof (details as any).cee_trace?.request_id === "string"
    ) {
      traceId = (details as any).cee_trace.request_id as string;
    }
  } else if (error instanceof OlumiNetworkError) {
    // Network errors are transport-level only; we expose retryable but no
    // CEE-specific code or trace.
    ceeCode = undefined;
    traceId = undefined;
  }

  return { ceeCode, retryable, traceId };
}

export interface CeeErrorViewModel {
  code?: string;
  retryable: boolean;
  traceId?: string;
  suggestedAction: "retry" | "fix_input" | "fail";
}

// Higher-level error view model suitable for UI/engine surfaces. This helper
// remains metadata-only: it uses only codes, retryability, and trace IDs and
// never inspects error messages or content.
export function buildCeeErrorViewModel(error: unknown): CeeErrorViewModel {
  const meta = getCeeErrorMetadata(error);

  let suggestedAction: CeeErrorViewModel["suggestedAction"] = "fail";

  const code = meta.ceeCode;

  if (meta.retryable) {
    suggestedAction = "retry";
  }

  if (code === "CEE_VALIDATION_FAILED") {
    suggestedAction = "fix_input";
  }

  return {
    code: meta.ceeCode,
    retryable: meta.retryable,
    traceId: meta.traceId,
    suggestedAction,
  };
}

function computeQualityBand(
  qualityOverall: number | undefined,
): "low" | "medium" | "high" | undefined {
  if (typeof qualityOverall !== "number") return undefined;
  if (qualityOverall >= CEE_QUALITY_HIGH_MIN) return "high";
  if (qualityOverall >= CEE_QUALITY_MEDIUM_MIN) return "medium";
  return "low";
}

// Build a high-level "decision story" summary from one or more CEE envelopes.
// This helper only uses structured metadata (quality scores, counts, truncation
// flags, team summary) and never inspects free-text briefs, labels, or LLM
// outputs, preserving the privacy guarantees of the CEE surface.
export function buildDecisionStorySummary(args: {
  draft?: CEEDraftGraphResponseV1 | null;
  explain?: CEEExplainGraphResponseV1 | null;
  evidence?: CEEEvidenceHelperResponseV1 | null;
  options?: CEEOptionsResponseV1 | null;
  bias?: CEEBiasCheckResponseV1 | null;
  sensitivity?: CEESensitivityCoachResponseV1 | null;
  team?: CEETeamPerspectivesResponseV1 | null;
}): DecisionStorySummary {
  const { draft, explain, evidence, options, bias, sensitivity, team } = args;

  const pickQualitySource =
    draft || explain || options || bias || evidence || sensitivity || team || null;

  const qualityOverall = getCEEQualityOverall(pickQualitySource as any);
  const qualityBand = computeQualityBand(qualityOverall);

  const optionCount = Array.isArray((options as any)?.options)
    ? ((options as any).options as unknown[]).length
    : 0;
  const evidenceCount = Array.isArray((evidence as any)?.items)
    ? ((evidence as any).items as unknown[]).length
    : 0;

  const participantCount = (team as any)?.summary?.participant_count as number | undefined;
  const disagreementScore = (team as any)?.summary?.disagreement_score as number | undefined;

  const anyTruncated =
    ceeAnyTruncated(draft as any) ||
    ceeAnyTruncated(options as any) ||
    ceeAnyTruncated(evidence as any) ||
    ceeAnyTruncated(bias as any) ||
    ceeAnyTruncated(sensitivity as any);

  const allIssues: CEEValidationIssue[] = [
    ...getCEEValidationIssues(draft as any),
    ...getCEEValidationIssues(explain as any),
    ...getCEEValidationIssues(options as any),
    ...getCEEValidationIssues(evidence as any),
    ...getCEEValidationIssues(bias as any),
    ...getCEEValidationIssues(sensitivity as any),
    ...getCEEValidationIssues(team as any),
  ];

  const risks: string[] = [];
  const nextActions: string[] = [];
  const drivers: string[] = [];

  if (typeof optionCount === "number" && optionCount > 0) {
    drivers.push(`${optionCount} CEE options were generated for this decision.`);
  }

  if (typeof evidenceCount === "number" && evidenceCount > 0) {
    drivers.push(`${evidenceCount} evidence items were scored for strength and relevance.`);
  }

  if (typeof participantCount === "number" && participantCount > 0) {
    drivers.push(`${participantCount} team perspectives contributed to this view.`);
  }

  if (typeof disagreementScore === "number") {
    drivers.push(`Team disagreement score is ${disagreementScore.toFixed(2)} (0 = aligned, 1 = highly split).`);
  }

  if (anyTruncated) {
    risks.push(
      "Some CEE lists were truncated for performance; lower-priority items may not be shown in full.",
    );
    nextActions.push(
      "If this is a high-impact decision, consider narrowing the scope or re-running CEE with more focused inputs to reduce truncation.",
    );
  }

  if (allIssues.length > 0) {
    const errorCount = allIssues.filter((i) => i.severity === "error").length;
    const warningCount = allIssues.filter((i) => i.severity === "warning").length;
    const infoCount = allIssues.length - errorCount - warningCount;

    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} errors`);
    if (warningCount > 0) parts.push(`${warningCount} warnings`);
    if (infoCount > 0) parts.push(`${infoCount} info notices`);

    const countsText = parts.join(", ");
    risks.push(
      `CEE reported validation issues (${countsText}); these may affect how reliable this model is in its current form.`,
    );
    nextActions.push(
      "Review validation_issues across CEE responses and address structural or guard-related problems before committing.",
    );
  }

  if (typeof evidenceCount === "number" && evidenceCount === 0) {
    risks.push("No supporting evidence was provided; the model may be based purely on assumptions.");
    nextActions.push(
      "Add a small set of high-quality evidence items (experiments, market data, or user research) and re-run Evidence Helper.",
    );
  }

  if (
    typeof participantCount === "number" &&
    participantCount > 0 &&
    typeof disagreementScore === "number" &&
    disagreementScore >= CEE_TEAM_DISAGREEMENT_MIN_SCORE
  ) {
    risks.push("Team perspectives are materially split; alignment on goals and trade-offs may be needed.");
    nextActions.push(
      "Facilitate a discussion with key stakeholders to understand why stances differ and what evidence could resolve the disagreement.",
    );
  }

  const dedupe = (items: string[]): string[] => Array.from(new Set(items)).slice(0, 4);

  const summaryParts: string[] = [];

  if (typeof qualityOverall === "number" && qualityBand) {
    summaryParts.push(`CEE currently rates overall model quality at ${qualityOverall}/10 (${qualityBand}).`);
  } else {
    summaryParts.push("CEE evaluated this decision model using structural heuristics and metadata.");
  }

  if (typeof optionCount === "number" && optionCount > 0) {
    summaryParts.push(`The model includes ${optionCount} explicit decision options.`);
  }

  if (typeof participantCount === "number" && participantCount > 0) {
    summaryParts.push(`Team input from ${participantCount} participants has been summarized.`);
  }

  if (anyTruncated) {
    summaryParts.push("Some response lists were capped; see risks_and_gaps and next_actions for interpretation.");
  } else if (allIssues.length > 0) {
    summaryParts.push("Validation issues are present; address them before treating this as a final decision view.");
  } else {
    summaryParts.push("No major truncation flags or critical validation issues were detected.");
  }

  const headline = summaryParts.join(" ");

  return {
    headline,
    key_drivers: dedupe(drivers),
    risks_and_gaps: dedupe(risks),
    next_actions: dedupe(nextActions),
    any_truncated: Boolean(anyTruncated),
    quality_overall: qualityOverall,
  };
}

export interface CeeUiFlags {
  has_high_risk_envelopes: boolean;
  has_team_disagreement: boolean;
  has_truncation_somewhere: boolean;
  is_journey_complete: boolean;
}

export function buildCeeUiFlags(journey: CeeJourneySummary): CeeUiFlags {
  const { health, story, is_complete, has_team_disagreement } = journey;

  const hasHighRiskEnvelope =
    health.overallStatus === "risk" ||
    Object.values(health.perEnvelope).some((summary) => summary?.status === "risk");

  const hasTruncationSomewhere =
    story.any_truncated ||
    health.any_truncated ||
    Object.values(health.perEnvelope).some((summary) => summary?.any_truncated);

  return {
    has_high_risk_envelopes: hasHighRiskEnvelope,
    has_team_disagreement,
    has_truncation_somewhere: hasTruncationSomewhere,
    is_journey_complete: is_complete,
  };
}

export interface CeeHealthSummary {
  status: "ok" | "warning" | "risk";
  reasons: string[];
  any_truncated: boolean;
  has_validation_issues: boolean;
  quality_overall?: number;
  source: "draft" | "explain" | "evidence" | "bias" | "options" | "sensitivity" | "team";
}

export function buildCeeHealthSummary(
  source: CeeHealthSummary["source"],
  response: AnyCEEEnvelope | null | undefined,
): CeeHealthSummary {
  const qualityOverall = getCEEQualityOverall(response as any);
  const issues = getCEEValidationIssues(response as any);
  const hasValidationIssues = issues.length > 0;
  const hasErrors = issues.some((issue) => issue && issue.severity === "error");

  const limits = (response as any)?.response_limits as Record<string, unknown> | undefined;
  let anyTruncated = false;
  let truncatedFlagCount = 0;

  if (limits && typeof limits === "object") {
    for (const [key, value] of Object.entries(limits)) {
      if (key.endsWith("truncated") && value === true) {
        anyTruncated = true;
        truncatedFlagCount += 1;
      }
    }
  }

  let evidenceCount = 0;
  let optionCount = 0;
  let participantCount = 0;

  if (response && typeof response === "object") {
    const anyResponse = response as any;

    if (Array.isArray(anyResponse.items)) {
      evidenceCount = anyResponse.items.length;
    }

    if (Array.isArray(anyResponse.options)) {
      optionCount = anyResponse.options.length;
    }

    const summary = anyResponse.summary;
    if (summary && typeof summary === "object" && typeof summary.participant_count === "number") {
      participantCount = summary.participant_count;
    }
  }

  const qualityBand = computeQualityBand(qualityOverall);

  const reasons: string[] = [];

  if (hasValidationIssues) {
    reasons.push("CEE reported validation issues for this result; check them before treating it as final.");
  }

  if (anyTruncated) {
    reasons.push(
      "Some results were truncated for performance; lower-priority items may be missing.",
    );
  }

  if (typeof qualityOverall === "number" && qualityBand === "low") {
    reasons.push(
      `CEE rated overall quality for this result as low (${qualityOverall}/10); treat it with extra caution.`,
    );
  }

  if (source === "evidence" && evidenceCount === 0) {
    reasons.push("This CEE result has no supporting evidence items.");
  }

  if (source === "options" && optionCount === 0) {
    reasons.push(
      "No structured options were generated for this decision; consider revisiting the graph or brief.",
    );
  }

  if (source === "team" && participantCount === 0) {
    reasons.push("No team perspectives were provided for this result.");
  }

  let status: CeeHealthSummary["status"] = "ok";
  const heavyTruncation =
    anyTruncated && truncatedFlagCount >= CEE_HEAVY_TRUNCATION_FLAG_COUNT;

  if (
    hasErrors ||
    heavyTruncation ||
    (typeof qualityOverall === "number" && qualityOverall <= CEE_HEALTH_RISK_MAX)
  ) {
    status = "risk";
  } else if (
    hasValidationIssues ||
    anyTruncated ||
    (typeof qualityOverall === "number" && qualityOverall < CEE_QUALITY_MEDIUM_MIN)
  ) {
    status = "warning";
  }

  const uniqueReasons = Array.from(new Set(reasons)).slice(0, 4);

  return {
    status,
    reasons: uniqueReasons,
    any_truncated: anyTruncated,
    has_validation_issues: hasValidationIssues,
    quality_overall: qualityOverall,
    source,
  };
}

export interface CeeEvidenceCoverageSummary {
  requested_count?: number;
  returned_count: number;
  max_items?: number;
  items_truncated: boolean;
  saturation_ratio?: number;
  coverage_level: "none" | "partial" | "full";
}

export function buildCeeEvidenceCoverageSummary(args: {
  evidence?: CEEEvidenceHelperResponseV1 | null;
  requestedCount?: number;
}): CeeEvidenceCoverageSummary {
  const { evidence, requestedCount } = args;

  const items =
    evidence && Array.isArray((evidence as any).items)
      ? ((evidence as any).items as unknown[])
      : [];
  const returnedCount = items.length;

  const limits = (evidence as any)?.response_limits as
    | { items_max?: number; items_truncated?: boolean }
    | undefined;

  const maxItems =
    limits && typeof limits.items_max === "number" && Number.isFinite(limits.items_max)
      ? limits.items_max
      : undefined;
  const itemsTruncated = Boolean(limits && limits.items_truncated === true);

  let saturationRatio: number | undefined;
  if (typeof maxItems === "number" && maxItems > 0) {
    saturationRatio = returnedCount / maxItems;
  }

  let coverageLevel: CeeEvidenceCoverageSummary["coverage_level"];
  if (returnedCount === 0) {
    coverageLevel = "none";
  } else {
    let partial = itemsTruncated;
    if (typeof requestedCount === "number" && requestedCount > returnedCount) {
      partial = true;
    }

    coverageLevel = partial ? "partial" : "full";
  }

  return {
    requested_count: requestedCount,
    returned_count: returnedCount,
    max_items: maxItems,
    items_truncated: itemsTruncated,
    saturation_ratio: saturationRatio,
    coverage_level: coverageLevel,
  };
}

export type CeeHealthTone = "success" | "warning" | "danger";

export function mapCeeHealthStatusToTone(status: CeeHealthSummary["status"]): CeeHealthTone {
  switch (status) {
    case "ok":
      return "success";
    case "warning":
      return "warning";
    case "risk":
    default:
      return "danger";
  }
}

export interface CeeJourneyEnvelopes {
  draft?: CEEDraftGraphResponseV1 | null;
  explain?: CEEExplainGraphResponseV1 | null;
  evidence?: CEEEvidenceHelperResponseV1 | null;
  options?: CEEOptionsResponseV1 | null;
  bias?: CEEBiasCheckResponseV1 | null;
  sensitivity?: CEESensitivityCoachResponseV1 | null;
  team?: CEETeamPerspectivesResponseV1 | null;
}

export interface CeeEngineStatus {
  provider?: string;
  model?: string;
  degraded: boolean;
}

// Summarise engine metadata across a set of CEE envelopes. This helper is
// metadata-only and only inspects the trace.engine block (provider, model,
// degraded flag).
export function buildCeeEngineStatus(
  envelopes: CeeJourneyEnvelopes,
): CeeEngineStatus | undefined {
  const sources: (AnyCEEEnvelope | null | undefined)[] = [
    envelopes.draft,
    envelopes.explain,
    envelopes.evidence,
    envelopes.options,
    envelopes.bias,
    envelopes.sensitivity,
    envelopes.team,
  ];

  let provider: string | undefined;
  let model: string | undefined;
  let degraded = false;

  for (const envelope of sources) {
    if (!envelope) continue;
    const trace = getCEETrace(envelope as any);
    const engine = (trace as any)?.engine as any;
    if (!engine || typeof engine !== "object") continue;

    const p = typeof engine.provider === "string" ? engine.provider : undefined;
    const m = typeof engine.model === "string" ? engine.model : undefined;
    const d = engine.degraded === true;

    if (!provider && p) provider = p;
    if (!model && m) model = m;
    if (d) degraded = true;
  }

  if (!provider && !model && !degraded) {
    return undefined;
  }

  return { provider, model, degraded };
}

export interface CeeJourneyHealth {
  perEnvelope: Partial<Record<CeeHealthSummary["source"], CeeHealthSummary>>;
  overallStatus: CeeHealthSummary["status"];
  overallTone: CeeHealthTone;
  any_truncated: boolean;
  has_validation_issues: boolean;
}

export interface CeeJourneySummary {
  story: DecisionStorySummary;
  health: CeeJourneyHealth;
  is_complete: boolean;
  missing_envelopes: CeeHealthSummary["source"][];
  has_team_disagreement: boolean;
}

export function buildCeeJourneySummary(envelopes: CeeJourneyEnvelopes): CeeJourneySummary {
  const story = buildDecisionStorySummary(envelopes);

  const perEnvelope: Partial<Record<CeeHealthSummary["source"], CeeHealthSummary>> = {};

  const addHealth = (
    source: CeeHealthSummary["source"],
    response: AnyCEEEnvelope | null | undefined,
  ): void => {
    if (response) {
      perEnvelope[source] = buildCeeHealthSummary(source, response);
    }
  };

  addHealth("draft", envelopes.draft ?? null);
  addHealth("explain", envelopes.explain ?? null);
  addHealth("evidence", envelopes.evidence ?? null);
  addHealth("options", envelopes.options ?? null);
  addHealth("bias", envelopes.bias ?? null);
  addHealth("sensitivity", envelopes.sensitivity ?? null);
  addHealth("team", envelopes.team ?? null);

  let overallStatus: CeeHealthSummary["status"] = "ok";
  let anyTruncated = false;
  let hasValidationIssues = false;

  const severityRank = (status: CeeHealthSummary["status"]): number => {
    switch (status) {
      case "risk":
        return 2;
      case "warning":
        return 1;
      case "ok":
      default:
        return 0;
    }
  };

  for (const summary of Object.values(perEnvelope)) {
    if (!summary) continue;

    if (severityRank(summary.status) > severityRank(overallStatus)) {
      overallStatus = summary.status;
    }
    if (summary.any_truncated) {
      anyTruncated = true;
    }
    if (summary.has_validation_issues) {
      hasValidationIssues = true;
    }
  }

  const overallTone = mapCeeHealthStatusToTone(overallStatus);

  // A journey is considered "complete" when all known CEE v1 envelopes are present
  // in the helper input. This is advisory metadata for UI and does not affect
  // underlying CEE behaviour.
  const allSources: CeeHealthSummary["source"][] = [
    "draft",
    "explain",
    "evidence",
    "options",
    "bias",
    "sensitivity",
    "team",
  ];

  const missing_envelopes = allSources.filter((source) => !envelopes[source]);
  const is_complete = missing_envelopes.length === 0;

  const teamEnvelope = envelopes.team as CEETeamPerspectivesResponseV1 | null | undefined;
  const has_team_disagreement = Boolean(
    teamEnvelope &&
      teamEnvelope.summary &&
      (teamEnvelope.summary as any).has_team_disagreement === true,
  );

  return {
    story,
    health: {
      perEnvelope,
      overallStatus,
      overallTone,
      any_truncated: anyTruncated,
      has_validation_issues: hasValidationIssues,
    },
    is_complete,
    missing_envelopes,
    has_team_disagreement,
  };
}

/**
 * Compact, metadata-only payload suitable for driving a Sandbox/Scenario-style
 * "decision review" UI.
 *
 * This is the canonical CEE v1 review contract exposed by the SDK:
 * - Only structured metadata (story/journey/uiFlags/trace).
 * - No prompts, briefs, graph labels, or LLM text.
 * - Safe to persist/log on the PLoT side for saved or explicit "review" runs.
 *
 * PLoT should surface this shape as `ceeReview` on its APIs; the Scenario UI
 * should treat it as read-only input.
 *
 * @typedef {Object} CeeDecisionReviewPayload
 * @property {DecisionStorySummary} story
 * @property {CeeJourneySummary} journey
 * @property {CeeUiFlags} uiFlags
 * @property {Object} [trace]
 * @property {string} [trace.request_id]
 * @property {string} [trace.correlation_id]
 */
export interface CeeDecisionReviewPayload {
  story: DecisionStorySummary;
  journey: CeeJourneySummary;
  uiFlags: CeeUiFlags;
  trace?: {
    request_id?: string;
    correlation_id?: string;
  };
}

/**
 * Build a CeeDecisionReviewPayload from a set of CEE envelopes.
 *
 * This helper is:
 * - Metadata-only: it consumes existing CEE envelopes (draft, options, evidence,
 *   bias, sensitivity, team, explain) and never inspects briefs, graphs, or
 *   LLM text.
 * - Deterministic: given the same envelopes, it always returns the same
 *   story/journey/uiFlags/trace.
 *
 * The resulting payload is suitable for persistence on the PLoT side and for
 * driving a Decision Review panel in the Scenario UI.
 *
 * @param {CeeJourneyEnvelopes} envelopes
 * @returns {CeeDecisionReviewPayload}
 */
export function buildCeeDecisionReviewPayload(
  envelopes: CeeJourneyEnvelopes,
): CeeDecisionReviewPayload {
  const journey = buildCeeJourneySummary(envelopes);
  const uiFlags = buildCeeUiFlags(journey);

  const traceSources: (AnyCEEEnvelope | null | undefined)[] = [
    envelopes.draft,
    envelopes.explain,
    envelopes.options,
    envelopes.evidence,
    envelopes.bias,
    envelopes.sensitivity,
    envelopes.team,
  ];

  let traceMeta: CEETraceMeta | undefined;
  for (const envelope of traceSources) {
    if (!envelope) continue;
    const meta = getCEETrace(envelope as any);
    if (meta) {
      traceMeta = meta;
      break;
    }
  }

  const trace =
    traceMeta && (traceMeta.request_id || traceMeta.correlation_id)
      ? {
          request_id: traceMeta.request_id,
          correlation_id: traceMeta.correlation_id,
        }
      : undefined;

  return {
    story: journey.story,
    journey,
    uiFlags,
    trace,
  };
}

/**
 * Compact trace summary for downstream integration surfaces (PLoT / Scenario).
 *
 * Only exposes a requestId, degraded flag, and optional timestamp/provider/model,
 * never raw prompts, graphs, or LLM text.
 */
export interface CeeTraceSummary {
  requestId: string;
  degraded: boolean;
  timestamp?: string;
  provider?: string;
  model?: string;
}

/**
 * Build a CeeTraceSummary from a CEETraceMeta and optional engine status.
 *
 * Returns null if no request_id is present on the trace; callers can use this
 * to decide whether to attach trace metadata to a review bundle.
 */
export function buildCeeTraceSummary(args: {
  trace?: CEETraceMeta | null;
  engineStatus?: CeeEngineStatus | null;
  timestamp?: string;
}): CeeTraceSummary | null {
  const { trace, engineStatus, timestamp } = args;

  const requestId = trace && typeof trace.request_id === "string" ? trace.request_id : undefined;
  if (!requestId) {
    return null;
  }

  const degraded = Boolean(engineStatus && engineStatus.degraded);

  return {
    requestId,
    degraded,
    timestamp,
    provider: engineStatus?.provider ?? undefined,
    model: engineStatus?.model ?? undefined,
  };
}

/**
 * Thin wrapper that builds a CeeErrorView (UI-safe error model) from an error.
 *
 * This is an alias over buildCeeErrorViewModel to make the integration surface
 * explicit for PLoT and Scenario UI consumers.
 */
export type CeeErrorView = CeeErrorViewModel;

/**
 * Thin wrapper that builds a CeeErrorView (UI-safe error model) from an error.
 *
 * This is an alias over buildCeeErrorViewModel to make the integration surface
 * explicit for PLoT and Scenario UI consumers.
 */
export function buildCeeErrorView(error: unknown): CeeErrorView {
  return buildCeeErrorViewModel(error);
}

/**
 * Canonical bundle for CEE integration: compact review payload + trace summary
 * + optional error view.
 *
 * This is the shape PLoT is expected to expose to the Scenario UI as the
 * "decision review" attachment for a scenario/report.
 */
export interface CeeIntegrationReviewBundle {
  review: CeeDecisionReviewPayload | null;
  trace: CeeTraceSummary | null;
  error?: CeeErrorView;
}

/**
 * Build a CeeIntegrationReviewBundle, normalising undefined fields.
 */
export function buildCeeIntegrationReviewBundle(args: {
  review?: CeeDecisionReviewPayload | null;
  trace?: CeeTraceSummary | null;
  error?: CeeErrorView | null;
}): CeeIntegrationReviewBundle {
  return {
    review: args.review ?? null,
    trace: args.trace ?? null,
    error: args.error ?? undefined,
  };
}

export interface CeeBiasStructureDraftSummary {
  quality_overall?: number;
  quality_band?: CeeQualityBand;
  structural_warning_count: number;
  structural_warnings_by_id: Record<string, { count: number; severity?: string }>;
  confidence_flags?: {
    simplification_applied?: boolean;
    uncertain_node_count?: number;
  };
}

export interface CeeBiasStructureBiasSummary {
  quality_overall?: number;
  quality_band?: CeeQualityBand;
  total_findings: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_code: Record<string, number>;
}

export interface CeeBiasStructureSnapshot {
  draft?: CeeBiasStructureDraftSummary | null;
  bias?: CeeBiasStructureBiasSummary | null;
}

function summarizeDraftForBiasStructure(
  envelopes: CeeJourneyEnvelopes,
): CeeBiasStructureDraftSummary | null {
  const draft = envelopes.draft as any;
  if (!draft || typeof draft !== "object") {
    return null;
  }

  const quality_overall =
    draft.quality && typeof draft.quality.overall === "number"
      ? (draft.quality.overall as number)
      : undefined;
  const quality_band = draft.quality ? classifyCeeQuality(draft.quality as any) : undefined;

  const warnings = Array.isArray(draft.draft_warnings)
    ? (draft.draft_warnings as any[])
    : [];

  const structural_warnings_by_id: Record<string, { count: number; severity?: string }> = {};

  for (const w of warnings) {
    if (!w || typeof w !== "object") continue;
    const id = typeof w.id === "string" && w.id.length > 0 ? (w.id as string) : "unknown";
    const severity = typeof w.severity === "string" ? (w.severity as string) : undefined;

    const current = structural_warnings_by_id[id];
    if (current) {
      current.count += 1;
    } else {
      structural_warnings_by_id[id] = { count: 1, severity };
    }
  }

  const structural_warning_count = warnings.length;

  const cf = draft.confidence_flags as
    | { uncertain_nodes?: string[]; simplification_applied?: boolean }
    | undefined;

  let confidence_flags: CeeBiasStructureDraftSummary["confidence_flags"];
  if (cf && (Array.isArray(cf.uncertain_nodes) || cf.simplification_applied === true)) {
    confidence_flags = {
      simplification_applied: cf.simplification_applied === true ? true : undefined,
      uncertain_node_count: Array.isArray(cf.uncertain_nodes)
        ? cf.uncertain_nodes.length
        : undefined,
    };
  }

  return {
    quality_overall,
    quality_band,
    structural_warning_count,
    structural_warnings_by_id,
    confidence_flags,
  };
}

function summarizeBiasForBiasStructure(
  envelopes: CeeJourneyEnvelopes,
): CeeBiasStructureBiasSummary | null {
  const bias = envelopes.bias as any;
  if (!bias || typeof bias !== "object") {
    return null;
  }

  const quality_overall =
    bias.quality && typeof bias.quality.overall === "number"
      ? (bias.quality.overall as number)
      : undefined;
  const quality_band = bias.quality ? classifyCeeQuality(bias.quality as any) : undefined;

  const findings = Array.isArray(bias.bias_findings)
    ? (bias.bias_findings as any[])
    : [];

  const by_severity: Record<string, number> = {};
  const by_category: Record<string, number> = {};
  const by_code: Record<string, number> = {};

  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    const severity = typeof f.severity === "string" ? (f.severity as string) : "unknown";
    const category = typeof f.category === "string" ? (f.category as string) : "unknown";
    const code = typeof f.code === "string" && f.code.length > 0 ? (f.code as string) : "unknown";

    by_severity[severity] = (by_severity[severity] ?? 0) + 1;
    by_category[category] = (by_category[category] ?? 0) + 1;
    by_code[code] = (by_code[code] ?? 0) + 1;
  }

  return {
    quality_overall,
    quality_band,
    total_findings: findings.length,
    by_severity,
    by_category,
    by_code,
  };
}

export function buildCeeBiasStructureSnapshot(
  envelopes: CeeJourneyEnvelopes,
): CeeBiasStructureSnapshot {
  const draft = summarizeDraftForBiasStructure(envelopes);
  const bias = summarizeBiasForBiasStructure(envelopes);

  return {
    draft,
    bias,
  };
}
