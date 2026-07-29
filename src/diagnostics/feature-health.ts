/**
 * Feature Health Diagnostics
 *
 * Startup-time health check for feature flags.
 * For every feature flag that's `true`, verify — from evidence, never from the
 * flag itself — that the feature can actually do something.
 * Logs a single summary line with per-feature status.
 *
 * Designed to catch "dark features" — features that are enabled via env vars
 * but silently produce no output because an internal precondition fails.
 *
 * ## Why `healthy` is never derived from `enabled`
 *
 * Until 2026-07-30 six of the nine checks below returned `healthy: enabled`
 * (or a hardcoded `true`). A verdict that restates its own input cannot fail,
 * so this module — whose entire purpose is catching dark features — reported
 * `healthy: true` for four subsystems whose producing code had been DELETED a
 * week earlier (`f957d6d8`, #615: brief-intelligence, dsk-coaching,
 * prompt-zones/zone2-blocks, pipeline/pipeline.ts), for a fifth whose producer
 * has no caller (entity memory), and for the DSK bundle even when it failed to
 * load or failed hash verification (`loadDskBundle()` degrades gracefully — it
 * does not throw, contrary to the comment that used to sit here).
 *
 * So every check now names its EVIDENCE (`FeatureEvidence`) and `healthy` is
 * computed from that evidence being observed:
 *
 *   - `runtime_state`   — an accessor proves the subsystem is loaded/active.
 *   - `producer_module` — the module that produces the feature's output must
 *     RESOLVE. Probed by dynamic `import()` at report time, so the verdict is
 *     derived from the tree, not from a list somebody has to remember to
 *     update: delete the module and this goes red on its own; re-add it and it
 *     goes green on its own.
 *   - `dependency`      — a configured external dependency.
 *   - `no_producer`     — statically verified dead: the producing symbol still
 *     exists but has no production caller, so a module probe would report a
 *     FALSE GREEN. This verdict is pinned by a caller-count assertion in
 *     `__tests__/feature-health.test.ts`, which REDs the moment anyone wires
 *     the producer up. Fail-loud, never assume-good.
 *
 * Retiring the flags that now gate nothing is a separate decision (ROADMAP) —
 * this module's job is to stop lying about them, not to remove them.
 */

import { config } from "../config/index.js";
import { log } from "../utils/telemetry.js";
import { getDskVersionHash } from "../orchestrator/dsk-loader.js";

// ============================================================================
// Types
// ============================================================================

/**
 * What a health verdict is derived FROM. Never the flag itself.
 */
export type FeatureEvidence =
  /** A runtime accessor proves the subsystem is loaded/active. */
  | { kind: 'runtime_state'; describes: string; observe: () => boolean }
  /**
   * The module producing the feature's output must resolve.
   * `specifier` is relative to THIS module and is probed with `import()`.
   */
  | { kind: 'producer_module'; specifier: string }
  /** A configured external dependency the feature cannot run without. */
  | { kind: 'dependency'; describes: string; satisfied: () => boolean }
  /**
   * Statically verified dead — producer present but uncalled. Always
   * unhealthy; pinned by a caller-count test so it cannot rot silently.
   */
  | { kind: 'no_producer'; describes: string };

export interface FeatureHealthCheck {
  name: string;
  flag: string;
  enabled: boolean;
  healthy: boolean;
  /** The evidence kind this verdict was derived from (echoed for ops triage). */
  evidence_kind: FeatureEvidence['kind'];
  reason?: string;
}

export interface FeatureHealthReport {
  checks: FeatureHealthCheck[];
  healthy_count: number;
  unhealthy_count: number;
  disabled_count: number;
}

interface FeatureDeclaration {
  name: string;
  flag: string;
  enabled: () => boolean;
  evidence: FeatureEvidence;
}

// ============================================================================
// Feature declarations — one row per reported feature, each naming its evidence
// ============================================================================

/**
 * Exported for the derivation test, which independently re-derives every
 * `producer_module` specifier against the filesystem so a typo'd or stale
 * specifier fails loud instead of passing as "unresolvable".
 */
export const FEATURE_DECLARATIONS: readonly FeatureDeclaration[] = [
  {
    // Brief Intelligence Layer. Producer deleted 2026-07-22 (f957d6d8, #615).
    name: 'BIL',
    flag: 'BIL_ENABLED',
    enabled: () => !!config.features?.bilEnabled,
    evidence: {
      kind: 'producer_module',
      specifier: '../orchestrator/brief-intelligence/extract.js',
    },
  },
  {
    // Real liveness: the bundle is loaded AND its hash verified, or it isn't.
    // loadDskBundle() returns silently on ENOENT / bad JSON / bad shape /
    // HASH MISMATCH, so "the server started" proves nothing about the bundle.
    name: 'DSK',
    flag: 'DSK_ENABLED',
    enabled: () => !!(config.features?.dskEnabled || config.features?.dskV0),
    evidence: {
      kind: 'runtime_state',
      describes: 'DSK bundle loaded and hash-verified (dsk_version_hash present)',
      observe: () => getDskVersionHash() !== null,
    },
  },
  {
    // Producer deleted 2026-07-22 (f957d6d8, #615). Nothing in src/ assigns
    // `dskCoaching`, so the envelope field can never be emitted.
    name: 'DSK_coaching',
    flag: 'DSK_COACHING_ENABLED',
    enabled: () => !!config.features?.dskCoachingEnabled,
    evidence: {
      kind: 'producer_module',
      specifier: '../orchestrator/dsk-coaching/index.js',
    },
  },
  {
    // NO-DARK-LAUNCH (Paul, 19 Jul): CEE_ENTITY_MEMORY_ENABLED was deleted, so
    // this used to report a hardcoded enabled/healthy true. The tracker module
    // still exists — which is exactly why a module probe would be a false
    // green — but `trackEntityStates()` has no production caller.
    name: 'entity_memory',
    flag: 'unconditional',
    enabled: () => true,
    evidence: {
      kind: 'no_producer',
      describes:
        'trackEntityStates() (src/orchestrator/context/entity-state-tracker.ts) has no ' +
        'production caller — nothing populates entity_state_map on any live path',
    },
  },
  {
    name: 'causal_validation',
    flag: 'CEE_CAUSAL_VALIDATION_ENABLED',
    enabled: () => !!config.cee?.causalValidationEnabled,
    evidence: {
      kind: 'dependency',
      describes: 'ISL_BASE_URL configured — causal validation requires the ISL service',
      satisfied: () => !!config.isl?.baseUrl,
    },
  },
  {
    name: 'grounding',
    flag: 'GROUNDING_ENABLED',
    enabled: () => !!config.features?.grounding,
    evidence: {
      kind: 'producer_module',
      specifier: '../grounding/index.js',
    },
  },
  {
    // Zone 2 block registry prompt assembly. Producer deleted 2026-07-22
    // (f957d6d8, #615: src/orchestrator/prompt-zones/**).
    name: 'zone2_registry',
    flag: 'CEE_ZONE2_REGISTRY_ENABLED',
    enabled: () => !!config.features?.zone2Registry,
    evidence: {
      kind: 'producer_module',
      specifier: '../orchestrator/prompt-zones/zone2-blocks.js',
    },
  },
  {
    // The V2 five-phase pipeline entry point, deleted 2026-07-22 (f957d6d8,
    // #615). NB /orchestrate/v2/turn is the V5 endpoint (orchestrator/
    // route-v2.ts:2) — the route name outlived the pipeline this flag named.
    name: 'orchestrator_v2',
    flag: 'ENABLE_ORCHESTRATOR_V2',
    enabled: () => !!config.features?.orchestratorV2,
    evidence: {
      kind: 'producer_module',
      specifier: '../orchestrator/pipeline/pipeline.js',
    },
  },
  {
    // Deterministic NL brief → draft_graph routing. Its subject
    // (looksLikeDecisionBrief / classifyIntentWithContext in
    // src/orchestrator/intent-gate.ts) was deleted 2026-07-22 (f957d6d8, #615).
    name: 'brief_detection',
    flag: 'CEE_BRIEF_DETECTION_ENABLED',
    enabled: () => !!config.features?.briefDetectionEnabled,
    evidence: {
      kind: 'producer_module',
      specifier: '../orchestrator/intent-gate.js',
    },
  },
] as const;

// ============================================================================
// Evidence probing
// ============================================================================

/**
 * Does the named module resolve and load from HERE?
 *
 * Deliberately a real `import()`, not a filesystem stat: it proves the module
 * loads (its own imports resolve too), and it resolves the specifier the same
 * way production code would. Every live specifier below is already in the
 * server's static import graph, so this adds no load-order side effects.
 */
async function probeProducerModule(
  specifier: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    await import(specifier);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: message.split('\n')[0] };
  }
}

async function evaluate(
  evidence: FeatureEvidence,
): Promise<{ ok: boolean; reason?: string }> {
  switch (evidence.kind) {
    case 'runtime_state':
      return evidence.observe()
        ? { ok: true }
        : { ok: false, reason: `runtime_state_absent: ${evidence.describes}` };
    case 'producer_module': {
      const probe = await probeProducerModule(evidence.specifier);
      return probe.ok
        ? { ok: true }
        : {
            ok: false,
            reason:
              `producer_module_unresolvable: ${evidence.specifier}` +
              (probe.detail ? ` (${probe.detail})` : ''),
          };
    }
    case 'dependency':
      return evidence.satisfied()
        ? { ok: true }
        : { ok: false, reason: `dependency_unsatisfied: ${evidence.describes}` };
    case 'no_producer':
      return { ok: false, reason: `no_producer: ${evidence.describes}` };
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run all feature health checks and return a structured report.
 *
 * Async because producer-module evidence is probed by dynamic `import()`.
 */
export async function checkFeatureHealth(): Promise<FeatureHealthReport> {
  const checks: FeatureHealthCheck[] = [];

  for (const declaration of FEATURE_DECLARATIONS) {
    const enabled = declaration.enabled();
    if (!enabled) {
      checks.push({
        name: declaration.name,
        flag: declaration.flag,
        enabled: false,
        healthy: false,
        evidence_kind: declaration.evidence.kind,
        reason: 'disabled',
      });
      continue;
    }

    const verdict = await evaluate(declaration.evidence);
    checks.push({
      name: declaration.name,
      flag: declaration.flag,
      enabled: true,
      healthy: verdict.ok,
      evidence_kind: declaration.evidence.kind,
      reason: verdict.reason,
    });
  }

  const healthy_count = checks.filter((c) => c.enabled && c.healthy).length;
  const unhealthy_count = checks.filter((c) => c.enabled && !c.healthy).length;
  const disabled_count = checks.filter((c) => !c.enabled).length;

  return { checks, healthy_count, unhealthy_count, disabled_count };
}

/**
 * Log the feature health report at startup.
 * Healthy features → info. Unhealthy features → warn.
 */
export async function logFeatureHealth(): Promise<FeatureHealthReport> {
  const report = await checkFeatureHealth();

  // Build compact summary string, e.g.
  // "DSK=✓, DSK_coaching=✗ (producer_module_unresolvable: ...)"
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
