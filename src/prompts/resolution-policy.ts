/**
 * Prompt resolution policy — observability classifier (PR1).
 *
 * `classifyPromptResolution` is a PURE function: given the key, the runtime
 * environment, and what source the loader actually resolved, it returns the
 * observability outcome — which telemetry to emit, how loudly to log, and
 * whether the resolution should be considered degraded. It performs NO I/O and
 * has NO side effects, so it is trivially unit-testable.
 *
 * PR1 is observability-only and changes NO behaviour: nothing here decides what
 * content is served — callers still serve exactly what they resolve today. The
 * point is to make a critical prompt silently falling back to the bundled
 * default *loud and visible* in staging/prod, so PMS coverage can be proven
 * before any fail-closed enforcement is armed.
 *
 * PR2 (deferred, flag-gated) will extend this into a `decidePromptResolution`
 * that also returns an enforcement `action` (serve_last_known_good /
 * fail_closed) using `fallbackReason`, last-known-good availability, and the
 * `CEE_PROMPT_FAIL_CLOSED_ENABLED` / `CEE_PROMPT_EMERGENCY_DEFAULT_ALLOWED`
 * flags. None of that exists yet.
 */

import type { CeeTaskId } from './schema.js';
import { isTrackedKey, mapSource, type TrackedKey } from './tracked.js';
import type { RuntimeEnv } from '../config/env-resolver.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';

/**
 * Why a `loadPrompt()` call ended up on the bundled default. Surfaced
 * additively on `LoadedPrompt.fallbackReason` so a critical-key fallback can be
 * told apart from a genuine "no PMS row" (diagnostic in PR1; load-bearing for
 * PR2's last-known-good vs fail-closed decision).
 */
export type FallbackReason =
  | 'pms_disabled' // prompt management disabled / no DB-backed store
  | 'not_found' // store reachable but no row for the key
  | 'fetch_error' // store threw (caught + swallowed)
  | 'timeout' // store fetch timed out (adapter-detected)
  | 'none'; // resolved from store, or reason not applicable

/**
 * PR1 observability outcomes. PR2 extends with
 * `lkg_used | emergency_default | fail_closed`.
 */
export type PromptResolutionOutcome =
  | 'pms_success'
  | 'default_allowed'
  | 'default_on_critical_deployed';

export interface PromptResolutionObservation {
  outcome: PromptResolutionOutcome;
  /** True when serving this resolution is a degraded state worth flagging. */
  degraded: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ClassifyPromptResolutionInput {
  key: CeeTaskId;
  runtimeEnv: RuntimeEnv;
  /** What the loader actually resolved (not what we wish it had). */
  resolvedSource: 'store' | 'default';
}

/** Critical prompt keys = the PMS-tracked keys (routing is critical by construction). */
export function isCriticalKey(key: string): key is TrackedKey {
  return isTrackedKey(key);
}

/** staging/prod are "deployed"; local/test are "dev". */
export function isDeployedEnv(env: RuntimeEnv): boolean {
  return env === 'staging' || env === 'prod';
}

/**
 * Pure classifier. No I/O, no side effects.
 */
export function classifyPromptResolution(
  input: ClassifyPromptResolutionInput,
): PromptResolutionObservation {
  const { key, runtimeEnv, resolvedSource } = input;

  if (resolvedSource === 'store') {
    return { outcome: 'pms_success', degraded: false, logLevel: 'info' };
  }

  // resolvedSource === 'default'
  if (!isCriticalKey(key)) {
    // Non-critical keys may freely use defaults anywhere — quiet.
    return { outcome: 'default_allowed', degraded: false, logLevel: 'debug' };
  }

  if (isDeployedEnv(runtimeEnv)) {
    // A critical prompt silently fell back to the bundled default in
    // staging/prod. This is the exact signal PR2 will eventually block —
    // surface it LOUDLY and mark it degraded so it's visible pre-enforcement.
    return { outcome: 'default_on_critical_deployed', degraded: true, logLevel: 'error' };
  }

  // local/test: default fallback is allowed, but say so explicitly.
  return { outcome: 'default_allowed', degraded: false, logLevel: 'warn' };
}

export interface RecordPromptResolutionInput extends ClassifyPromptResolutionInput {
  fallbackReason?: FallbackReason;
  /** Origin of the resolution (e.g. 'startup', 'runtime') — log context only. */
  trigger?: string;
}

/**
 * Glue: classify, then emit `v5.prompt_resolution_policy` + a level-appropriate
 * structured log. Returns the observation so callers can react if they want
 * (PR1 callers only observe). The pure classifier above stays the testable core.
 */
export function recordPromptResolutionObservation(
  input: RecordPromptResolutionInput,
): PromptResolutionObservation {
  const { key, runtimeEnv, resolvedSource, fallbackReason = 'none', trigger } = input;
  const obs = classifyPromptResolution({ key, runtimeEnv, resolvedSource });

  const payload = {
    key,
    outcome: obs.outcome,
    degraded: obs.degraded,
    source: mapSource(resolvedSource),
    fallback_reason: fallbackReason,
    runtime_env: runtimeEnv,
    ...(trigger ? { trigger } : {}),
  };

  emit(TelemetryEvents.V5PromptResolutionPolicy, payload);
  log[obs.logLevel](payload, `prompt.resolution.${obs.outcome}`);

  return obs;
}
