/**
 * Feature Flags System
 *
 * Supports both environment-level flags (via env vars) and per-request overrides.
 *
 * Environment variables:
 * - ENABLE_GROUNDING: Enable document grounding for attachments (default: false - opt-in for safety)
 * - ENABLE_CRITIQUE: Enable graph critique endpoint (default: true)
 * - ENABLE_CLARIFIER: Enable clarifying questions in draft responses (default: true)
 *
 * Per-request overrides can be passed via the `flags` field in request bodies.
 */

import { config } from "../config/index.js";

export type FeatureFlag =
  | 'grounding'
  | 'critique'
  | 'clarifier';

interface FeatureFlagConfig {
  envVar: string;
  defaultValue: boolean;
  description: string;
}

const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlagConfig> = {
  grounding: {
    envVar: 'ENABLE_GROUNDING',
    defaultValue: false,  // Conservative default - opt-in for production safety
    description: 'Enable document grounding for attachments'
  },
  critique: {
    envVar: 'ENABLE_CRITIQUE',
    defaultValue: true,
    description: 'Enable graph critique endpoint'
  },
  clarifier: {
    envVar: 'ENABLE_CLARIFIER',
    defaultValue: true,
    description: 'Enable clarifying questions in draft responses'
  }
};

/**
 * Get the environment-level value for a feature flag
 */
function getEnvFlag(flag: FeatureFlag): boolean {
  // Map flag names to centralized config properties
  switch (flag) {
    case 'grounding':
      return config.features.grounding;
    case 'critique':
      return config.features.critique;
    case 'clarifier':
      return config.features.clarifier;
  }
  // Exhaustive check - TypeScript ensures all cases are handled above
  const _exhaustiveCheck: never = flag;
  return _exhaustiveCheck;
}

/**
 * Check if a feature is enabled
 *
 * @param flag - The feature flag to check
 * @param requestFlags - Optional per-request flag overrides from the request body
 * @returns true if the feature is enabled
 *
 * Priority order:
 * 1. Per-request flag (if provided)
 * 2. Environment variable
 * 3. Default value
 */
export function isFeatureEnabled(
  flag: FeatureFlag,
  requestFlags?: Record<string, boolean>
): boolean {
  // Check per-request override first
  if (requestFlags && flag in requestFlags) {
    return requestFlags[flag] === true;
  }

  // Fall back to environment-level flag
  return getEnvFlag(flag);
}

/**
 * Get all feature flags with their current values
 * Useful for debugging and health checks
 */
export function getAllFeatureFlags(
  requestFlags?: Record<string, boolean>
): Record<FeatureFlag, boolean> {
  const result: Record<string, boolean> = {};

  for (const flag of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
    result[flag] = isFeatureEnabled(flag, requestFlags);
  }

  return result as Record<FeatureFlag, boolean>;
}
