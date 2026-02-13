/**
 * Response capping utilities.
 *
 * Extracted from pipeline.ts for reuse in the unified pipeline.
 * Truncates response lists to configured maximums.
 */

import {
  CEE_BIAS_FINDINGS_MAX,
  CEE_OPTIONS_MAX,
  CEE_EVIDENCE_SUGGESTIONS_MAX,
  CEE_SENSITIVITY_SUGGESTIONS_MAX,
} from "../config/limits.js";

export type ResponseLimitsMeta = {
  bias_findings_max: number;
  bias_findings_truncated: boolean;
  options_max: number;
  options_truncated: boolean;
  evidence_suggestions_max: number;
  evidence_suggestions_truncated: boolean;
  sensitivity_suggestions_max: number;
  sensitivity_suggestions_truncated: boolean;
};

export function capList<T>(value: unknown, max: number): { list?: T[]; truncated: boolean } {
  if (!Array.isArray(value)) {
    return { list: undefined, truncated: false };
  }
  if (value.length <= max) {
    return { list: value as T[], truncated: false };
  }
  return { list: (value as T[]).slice(0, max), truncated: true };
}

export function applyResponseCaps(payload: any): { cappedPayload: any; limits: ResponseLimitsMeta } {
  const cappedPayload = { ...payload };

  const bias = capList<any>(payload.bias_findings, CEE_BIAS_FINDINGS_MAX);
  if (bias.list) cappedPayload.bias_findings = bias.list;

  const opts = capList<any>(payload.options, CEE_OPTIONS_MAX);
  if (opts.list) cappedPayload.options = opts.list;

  const evidence = capList<any>(payload.evidence_suggestions, CEE_EVIDENCE_SUGGESTIONS_MAX);
  if (evidence.list) cappedPayload.evidence_suggestions = evidence.list;

  const sensitivity = capList<any>(payload.sensitivity_suggestions, CEE_SENSITIVITY_SUGGESTIONS_MAX);
  if (sensitivity.list) cappedPayload.sensitivity_suggestions = sensitivity.list;

  const limits: ResponseLimitsMeta = {
    bias_findings_max: CEE_BIAS_FINDINGS_MAX,
    bias_findings_truncated: bias.truncated,
    options_max: CEE_OPTIONS_MAX,
    options_truncated: opts.truncated,
    evidence_suggestions_max: CEE_EVIDENCE_SUGGESTIONS_MAX,
    evidence_suggestions_truncated: evidence.truncated,
    sensitivity_suggestions_max: CEE_SENSITIVITY_SUGGESTIONS_MAX,
    sensitivity_suggestions_truncated: sensitivity.truncated,
  };

  return { cappedPayload, limits };
}
