import type { components } from "../../generated/openapi.d.ts";
import { CEE_QUALITY_HIGH_MIN, CEE_QUALITY_MEDIUM_MIN } from "../policy.js";

type CEEQualityMeta = components["schemas"]["CEEQualityMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type CEEGuidance = {
  summary: string;
  risks?: string[];
  next_actions?: string[];
  any_truncated?: boolean;
};

export type ResponseLimitsLike = {
  bias_findings_truncated?: boolean;
  options_truncated?: boolean;
  evidence_suggestions_truncated?: boolean;
  items_truncated?: boolean;
  sensitivity_suggestions_truncated?: boolean;
};

export function ceeAnyTruncated(limits: ResponseLimitsLike | undefined): boolean {
  if (!limits) return false;
  return (
    !!limits.bias_findings_truncated ||
    !!limits.options_truncated ||
    !!limits.evidence_suggestions_truncated ||
    !!limits.items_truncated ||
    !!limits.sensitivity_suggestions_truncated
  );
}

export function buildCeeGuidance(args: {
  quality: CEEQualityMeta;
  validationIssues: CEEValidationIssue[];
  limits: ResponseLimitsLike;
}): CEEGuidance {
  const { quality, validationIssues, limits } = args;

  const overall = typeof quality.overall === "number" ? quality.overall : undefined;

  let qualityBand: "low" | "medium" | "high" | undefined;
  if (overall !== undefined) {
    if (overall >= CEE_QUALITY_HIGH_MIN) qualityBand = "high";
    else if (overall >= CEE_QUALITY_MEDIUM_MIN) qualityBand = "medium";
    else qualityBand = "low";
  }

  const anyTruncated = ceeAnyTruncated(limits);

  const issueCount = Array.isArray(validationIssues) ? validationIssues.length : 0;
  const hasErrors = validationIssues.some((issue: any) => issue && issue.severity === "error");

  const risks: string[] = [];
  const nextActions: string[] = [];

  if (anyTruncated) {
    risks.push(
      "Some CEE lists were truncated for performance; less-important items may be missing from this view.",
    );
    nextActions.push(
      "If this decision is high stakes, consider narrowing the scope or running CEE again with more focused inputs.",
    );
  }

  if (issueCount > 0) {
    const level = hasErrors ? "errors or warnings" : "warnings";
    risks.push(
      `CEE reported ${issueCount} validation ${level} about the model; these may affect how reliable the draft is.`,
    );
    nextActions.push(
      "Review validation_issues in the response and address any structural or guard-related problems before acting.",
    );
  }

  if (!anyTruncated && issueCount === 0) {
    nextActions.push(
      "Use other CEE tools (Options, Bias Check, Evidence Helper, Team Perspectives) to deepen the analysis before committing to a decision.",
    );
  }

  // Ensure we dont return duplicate guidance lines.
  const dedupe = (items: string[]): string[] => Array.from(new Set(items)).slice(0, 3);

  const summaryParts: string[] = [];

  if (overall !== undefined && qualityBand) {
    summaryParts.push(`Overall CEE model quality is ${overall}/10 (${qualityBand}).`);
  } else {
    summaryParts.push("CEE evaluated this draft using structural heuristics and validation checks.");
  }

  if (anyTruncated) {
    summaryParts.push("Some result lists were capped; see risks and next_actions for how to interpret this.");
  } else if (issueCount > 0) {
    summaryParts.push("Validation issues are present; review them before relying on this draft.");
  } else {
    summaryParts.push("No major truncation flags or validation issues were detected.");
  }

  const summary = summaryParts.join(" ");

  return {
    summary,
    risks: risks.length ? dedupe(risks) : undefined,
    next_actions: nextActions.length ? dedupe(nextActions) : undefined,
    any_truncated: anyTruncated || undefined,
  };
}
