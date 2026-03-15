/**
 * Feature Health Diagnostics
 *
 * Startup-time health check for feature flags.
 * For every feature flag that's `true`, verify its dependencies are satisfied.
 * Logs a single summary line with per-feature status.
 *
 * Designed to catch "dark features" — features that are enabled via env vars
 * but silently produce no output because an internal precondition fails.
 */

import { config } from "../config/index.js";
import { log } from "../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export interface FeatureHealthCheck {
  name: string;
  flag: string;
  enabled: boolean;
  healthy: boolean;
  reason?: string;
}

export interface FeatureHealthReport {
  checks: FeatureHealthCheck[];
  healthy_count: number;
  unhealthy_count: number;
  disabled_count: number;
}

// ============================================================================
// Per-feature checks
// ============================================================================

function checkBil(): FeatureHealthCheck {
  const enabled = !!config.features?.bilEnabled;
  return {
    name: 'BIL',
    flag: 'BIL_ENABLED',
    enabled,
    healthy: enabled, // BIL is self-contained — if enabled, it can run (stage-gated at runtime)
    reason: enabled ? undefined : 'disabled',
  };
}

function checkDsk(): FeatureHealthCheck {
  const enabled = !!(config.features?.dskEnabled || config.features?.dskV0);
  // DSK requires the bundle file — loadDskBundle() throws on missing file,
  // so if we got here, it either loaded or the flag is off.
  return {
    name: 'DSK',
    flag: 'DSK_ENABLED',
    enabled,
    healthy: enabled, // If enabled and server started, bundle loaded successfully
    reason: enabled ? undefined : 'disabled',
  };
}

function checkDskCoaching(): FeatureHealthCheck {
  const enabled = !!config.features?.dskCoachingEnabled;
  const dskActive = !!(config.features?.dskEnabled || config.features?.dskV0);
  const bilActive = !!config.features?.bilEnabled;
  const healthy = enabled && dskActive && bilActive;
  let reason: string | undefined;
  if (enabled && !dskActive) reason = 'DSK_ENABLED/ENABLE_DSK_V0 is false — DSK coaching needs DSK bundle';
  else if (enabled && !bilActive) reason = 'BIL_ENABLED is false — DSK coaching needs BIL extraction to produce dsk_cues';
  return {
    name: 'DSK_coaching',
    flag: 'DSK_COACHING_ENABLED',
    enabled,
    healthy,
    reason,
  };
}

function checkEntityMemory(): FeatureHealthCheck {
  const enabled = !!config.cee?.entityMemoryEnabled;
  return {
    name: 'entity_memory',
    flag: 'CEE_ENTITY_MEMORY_ENABLED',
    enabled,
    healthy: enabled, // Requires multi-turn context at runtime — no static dependency
    reason: enabled ? undefined : 'disabled',
  };
}

function checkCausalValidation(): FeatureHealthCheck {
  const enabled = !!config.cee?.causalValidationEnabled;
  const islConfigured = !!config.isl?.baseUrl;
  const healthy = enabled && islConfigured;
  let reason: string | undefined;
  if (enabled && !islConfigured) reason = 'ISL_BASE_URL not configured — causal validation requires ISL service';
  return {
    name: 'causal_validation',
    flag: 'CEE_CAUSAL_VALIDATION_ENABLED',
    enabled,
    healthy,
    reason,
  };
}

function checkGrounding(): FeatureHealthCheck {
  const enabled = !!config.features?.grounding;
  return {
    name: 'grounding',
    flag: 'GROUNDING_ENABLED',
    enabled,
    healthy: enabled, // Grounding is attachment-gated at runtime, no static dependency
    reason: enabled ? undefined : 'disabled',
  };
}

function checkZone2Registry(): FeatureHealthCheck {
  const enabled = !!config.features?.zone2Registry;
  return {
    name: 'zone2_registry',
    flag: 'CEE_ZONE2_REGISTRY_ENABLED',
    enabled,
    healthy: enabled, // Zone 2 is self-contained — block activation is context-dependent
    reason: enabled ? undefined : 'disabled',
  };
}

function checkOrchestratorV2(): FeatureHealthCheck {
  const enabled = !!config.features?.orchestratorV2;
  return {
    name: 'orchestrator_v2',
    flag: 'ENABLE_ORCHESTRATOR_V2',
    enabled,
    healthy: enabled,
    reason: enabled ? undefined : 'disabled',
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run all feature health checks and return a structured report.
 */
export function checkFeatureHealth(): FeatureHealthReport {
  const checks = [
    checkBil(),
    checkDsk(),
    checkDskCoaching(),
    checkEntityMemory(),
    checkCausalValidation(),
    checkGrounding(),
    checkZone2Registry(),
    checkOrchestratorV2(),
  ];

  const healthy_count = checks.filter((c) => c.enabled && c.healthy).length;
  const unhealthy_count = checks.filter((c) => c.enabled && !c.healthy).length;
  const disabled_count = checks.filter((c) => !c.enabled).length;

  return { checks, healthy_count, unhealthy_count, disabled_count };
}

/**
 * Log the feature health report at startup.
 * Healthy features → info. Unhealthy features → warn.
 */
export function logFeatureHealth(): FeatureHealthReport {
  const report = checkFeatureHealth();

  // Build compact summary string: "BIL=✓, DSK=✓, entity_memory=✗ (missing ISL)"
  const summary = report.checks
    .filter((c) => c.enabled)
    .map((c) => `${c.name}=${c.healthy ? '✓' : '✗'}${c.reason ? ` (${c.reason})` : ''}`)
    .join(', ');

  const disabledNames = report.checks
    .filter((c) => !c.enabled)
    .map((c) => c.name)
    .join(', ');

  // Always log the summary
  if (report.unhealthy_count > 0) {
    log.warn(
      {
        event: 'feature_health',
        healthy: report.healthy_count,
        unhealthy: report.unhealthy_count,
        disabled: report.disabled_count,
        details: report.checks.filter((c) => c.enabled && !c.healthy),
      },
      `Feature health: ${summary}${disabledNames ? ` | disabled: ${disabledNames}` : ''}`,
    );
  } else {
    log.info(
      {
        event: 'feature_health',
        healthy: report.healthy_count,
        unhealthy: 0,
        disabled: report.disabled_count,
      },
      `Feature health: ${summary || 'no features enabled'}${disabledNames ? ` | disabled: ${disabledNames}` : ''}`,
    );
  }

  return report;
}
