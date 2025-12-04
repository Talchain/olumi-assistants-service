export const CEE_BIAS_FINDINGS_MAX = 10;
export const CEE_OPTIONS_MAX = 6;
export const CEE_EVIDENCE_SUGGESTIONS_MAX = 20;
export const CEE_SENSITIVITY_SUGGESTIONS_MAX = 10;

export const CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM = 5;

export function resolveCeeRateLimit(envVarName: string): number {
  // eslint-disable-next-line no-restricted-syntax -- Dynamic env var lookup by name
  const raw = process.env[envVarName];
  if (raw === undefined) {
    return CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;
  }

  return Math.floor(parsed);
}
