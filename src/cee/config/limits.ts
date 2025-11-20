export const CEE_BIAS_FINDINGS_MAX = 10;
export const CEE_OPTIONS_MAX = 6;
export const CEE_EVIDENCE_SUGGESTIONS_MAX = 20;
export const CEE_SENSITIVITY_SUGGESTIONS_MAX = 10;

export const CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM = 5;

export function resolveCeeRateLimit(envVarName: string): number {
  const raw = process.env[envVarName];
  const parsed = raw === undefined ? NaN : Number(raw);
  return parsed || CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;
}
