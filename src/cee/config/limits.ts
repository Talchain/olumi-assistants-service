import { log } from "../../utils/telemetry.js";

export const CEE_BIAS_FINDINGS_MAX = 10;
export const CEE_OPTIONS_MAX = 6;
export const CEE_EVIDENCE_SUGGESTIONS_MAX = 20;
export const CEE_SENSITIVITY_SUGGESTIONS_MAX = 10;

// ===========================================================================
// Rate buckets — DERIVED, boot-validated, tiered config (single source of truth)
// ===========================================================================
//
// Per-feature rate limits are DERIVED from three cost tiers, not scattered as
// per-route literals. The tier a route belongs to lives once in
// RATE_BUCKET_REGISTRY; the RPM for each tier lives once in TIER_BASE_RPM. This
// is the "derive-don't-mirror" rule: to change how tightly draft is limited you
// change ONE number here, and every draft route follows.
//
//   draft  — expensive generative LLM (draft-graph, draft-graph-stream). Tightest.
//   coach  — medium LLM coaching / analysis + the orchestrator turn. Middle.
//   read   — cheap / deterministic / read-only (graph-readiness). Loosest.
//
// Invariant (asserted at boot, see assertRateBucketsValid): draft <= coach <= read.
// A per-tier env override exists as an escape hatch, but the DEFAULT is the
// derived value — no route needs its own literal.
//
// Historical hazard this replaces: `resolveCeeRateLimit(envVar)` always returned
// a number (5 when the env was unset), so per-route `?? 30` fallbacks in the
// route files were dead code that never fired — every unset route silently ran
// at the flat 5, NOT its intended default. The registry below makes the tiering
// real and the drift detectable (see the drift test).

export type RateBucketTier = "draft" | "coach" | "read";

/** Per-tier env override knobs (ONE per tier — never per route). */
const TIER_ENV_VAR: Record<RateBucketTier, string> = {
  draft: "CEE_RATE_BUCKET_DRAFT_RPM",
  coach: "CEE_RATE_BUCKET_COACH_RPM",
  read: "CEE_RATE_BUCKET_READ_RPM",
};

/**
 * Derived base RPM per tier. Design-partner-calibrated: comfortably above normal
 * human cadence, low enough to bound abuse. All strictly above the historical
 * flat 5, so this change loosens legitimate traffic while making the RELATIVE
 * tiering (draft tightest) real.
 */
const TIER_BASE_RPM: Record<RateBucketTier, number> = {
  draft: 10,
  coach: 40,
  read: 90,
};

/**
 * Fail posture per tier. Compute routes (draft/coach) fail CLOSED — if the
 * limiter itself errors, deny rather than wave through expensive/abusable work.
 * Read-only routes fail OPEN — availability over strictness for cheap traffic.
 */
const TIER_FAIL_OPEN: Record<RateBucketTier, boolean> = {
  draft: false,
  coach: false,
  read: true,
};

/**
 * Registry: every per-feature rate-limit env var → its cost tier. This is the
 * one place the route→tier assignment lives. A route whose env var is missing
 * here fails SAFE (tightest tier) and warns loudly — and the drift test
 * (tests/unit/cee.rate-buckets.drift.test.ts) fails the build if any route
 * references an unregistered env var.
 */
export const RATE_BUCKET_REGISTRY: Readonly<Record<string, RateBucketTier>> = {
  // --- draft: expensive generative LLM ---
  CEE_DRAFT_RATE_LIMIT_RPM: "draft",
  CEE_STREAM_RATE_LIMIT_RPM: "draft",

  // --- read: cheap / deterministic / read-only ---
  CEE_GRAPH_READINESS_RATE_LIMIT_RPM: "read",
  // Scenario-addressed graph read (ROADMAP 2.312): two indexed Supabase reads,
  // no LLM, no writes — the same cost shape as graph-readiness, so the same
  // tier. Its bucket is keyed on the CLIENT, not the key id; see the route.
  CEE_SCENARIO_GRAPH_RATE_LIMIT_RPM: "read",

  // --- coach: medium coaching / analysis engines ---
  // RESERVED — no src reference yet, deliberately. The drift test reads this
  // marker (it is machine-read, not decoration: see the reverse assertion in
  // tests/unit/cee.rate-buckets.drift.test.ts) and exempts this entry from the
  // "every registry entry is referenced" check. The marker is self-policing:
  // once this env var IS wired, the test FAILS until the marker is removed, so
  // it cannot silently outlive its reason.
  // Reserved for the orchestrator-turn per-scenario bucket (deferred — see
  // parallel-briefs/RATE-BUCKETS-2026-07-24.md): the turn path needs to gate
  // only expensive LLM turns, not cheap chip/system-event turns, and its test
  // harness needs a per-test bucket reset. The tier decision (coach) is fixed
  // here so the follow-up wires it with no config change.
  CEE_TURN_RATE_LIMIT_RPM: "coach",
  CEE_OPTIONS_RATE_LIMIT_RPM: "coach",
  CEE_BIAS_CHECK_RATE_LIMIT_RPM: "coach",
  CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM: "coach",
  CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM: "coach",
  CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM: "coach",
  CEE_EXPLAIN_RATE_LIMIT_RPM: "coach",
  CEE_EXPLAIN_POLICY_RATE_LIMIT_RPM: "coach",
  CEE_EXPLAIN_TRADEOFF_RATE_LIMIT_RPM: "coach",
  CEE_EDGE_FUNCTION_RATE_LIMIT_RPM: "coach",
  CEE_RISK_TOLERANCE_RATE_LIMIT_RPM: "coach",
  CEE_UTILITY_WEIGHT_RATE_LIMIT_RPM: "coach",
  CEE_ELICIT_PREFERENCES_RATE_LIMIT_RPM: "coach",
  CEE_ELICIT_PREFERENCES_ANSWER_RATE_LIMIT_RPM: "coach",
  CEE_ELICIT_BELIEF_RATE_LIMIT_RPM: "coach",
  CEE_REVIEW_RATE_LIMIT_RPM: "coach",
  CEE_NARRATE_CONDITIONS_RATE_LIMIT_RPM: "coach",
  CEE_ISL_SYNTHESIS_RATE_LIMIT_RPM: "coach",
  CEE_DECISION_REVIEW_RATE_LIMIT_RPM: "coach",
};

/**
 * Fail-SAFE fallback for an env var that is not in the registry (a new route
 * that forgot to register). Deliberately tight — an unmapped route must not
 * accidentally get a loose limit. Also the value the pre-existing
 * resolveCeeRateLimit tests assert against for their (unregistered) test var.
 */
export const CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM = 5;

function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/** Whether a tier fails OPEN on limiter error (read-only) or CLOSED (compute). */
export function tierFailsOpen(tier: RateBucketTier): boolean {
  return TIER_FAIL_OPEN[tier];
}

/** Effective RPM for a tier: per-tier env override if valid, else derived base. */
export function tierRpm(tier: RateBucketTier): number {
  // eslint-disable-next-line no-restricted-syntax -- Dynamic env var lookup by tier
  const override = parsePositiveIntEnv(process.env[TIER_ENV_VAR[tier]]);
  return override ?? TIER_BASE_RPM[tier];
}

const _warnedUnregistered = new Set<string>();

/**
 * Resolve the RPM for a per-feature rate limit env var.
 *
 * Precedence:
 *   1. An explicit, valid per-route env override wins (back-compat escape hatch).
 *   2. Otherwise DERIVE from the route's bucket tier (the normal path).
 *   3. Otherwise (unregistered env var) fail SAFE at CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM
 *      and warn once so the drift is visible.
 */
export function resolveCeeRateLimit(envVarName: string): number {
  // eslint-disable-next-line no-restricted-syntax -- Dynamic env var lookup by name
  const override = parsePositiveIntEnv(process.env[envVarName]);
  if (override !== undefined) return override;

  const tier = RATE_BUCKET_REGISTRY[envVarName];
  if (tier) return tierRpm(tier);

  if (!_warnedUnregistered.has(envVarName)) {
    _warnedUnregistered.add(envVarName);
    log.warn(
      { event: "rate_bucket_unregistered", env_var: envVarName },
      "Rate-limit env var not in RATE_BUCKET_REGISTRY — defaulting to fail-safe limit",
    );
  }
  return CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;
}

/**
 * Boot-time invariant check. Called at module load so a misconfigured tier
 * override (e.g. draft looser than read) fails LOUD at startup instead of
 * silently inverting the whole security posture.
 */
export function assertRateBucketsValid(): void {
  const values: Array<[RateBucketTier, number]> = [
    ["draft", tierRpm("draft")],
    ["coach", tierRpm("coach")],
    ["read", tierRpm("read")],
  ];
  for (const [tier, v] of values) {
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(
        `[rate-buckets] tier '${tier}' RPM must be a positive integer, got ${v}`,
      );
    }
  }
  const [, draft] = values[0];
  const [, coach] = values[1];
  const [, read] = values[2];
  if (!(draft <= coach && coach <= read)) {
    throw new Error(
      `[rate-buckets] tier ordering violated: draft(${draft}) <= coach(${coach}) <= read(${read}) must hold`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sanctioned keys (eval / probe harnesses)
// ---------------------------------------------------------------------------
//
// Our own trust-surface matrices (flip probes, eval runs) legitimately burst
// well above design-partner cadence. Rather than loosen the buckets for
// everyone, sanctioned key IDs get a large multiplier so the abuse buckets
// never throttle sanctioned traffic — while remaining finite (a leaked
// sanctioned key still cannot hammer infinitely).
//
// Configured by key ID hash (fastHash(apiKey, 8) — the same truncated,
// non-reversible id used everywhere else), comma-separated.

const SANCTIONED_MULTIPLIER = 100;

function readSanctionedKeyIds(): ReadonlySet<string> {
  // eslint-disable-next-line no-restricted-syntax -- operational allowlist, read dynamically
  const raw = process.env.CEE_RATE_LIMIT_SANCTIONED_KEY_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isSanctionedKey(keyId: string | undefined): boolean {
  if (!keyId) return false;
  return readSanctionedKeyIds().has(keyId);
}

/**
 * Unified per-feature rate limiting for CEE endpoints.
 *
 * Uses in-memory token buckets with a fixed window.
 *
 * ## Multi-Instance Limitation
 *
 * **IMPORTANT**: This is a per-process in-memory implementation. In multi-instance
 * deployments (e.g., Render with 2+ instances, Kubernetes pods), each instance
 * maintains separate rate limit buckets. This means:
 * - Effective rate limit is approximately `N × RPM` where N = number of instances
 * - Users could bypass limits by hitting different instances
 *
 * For production multi-instance deployments, consider:
 * 1. Using Redis-backed rate limiting via `utils/quota.ts`
 * 2. Implementing distributed rate limiting with Redis INCR + EXPIRE
 * 3. Using a load balancer with sticky sessions (partial mitigation)
 */

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;

// Global feature buckets map: Map<featureName, Map<keyId, BucketState>>
const featureBuckets = new Map<string, Map<string, BucketState>>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  // First pass: remove stale buckets
  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

  if (map.size <= MAX_BUCKETS) return;

  // Second pass: remove oldest if still over limit
  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

export interface CeeFeatureRateLimiter {
  feature: string;
  rpm: number;
  /**
   * Try to consume a rate limit token for the given bucket key.
   *
   * @param bucketKey  the bucket to charge (e.g. `key::<keyId>` or `scenario::<id>`)
   * @param rawKeyId   the caller's raw key id, used ONLY to apply the sanctioned
   *                   multiplier; unrelated to which bucket is charged
   */
  tryConsume(
    bucketKey: string,
    rawKeyId?: string,
  ): { allowed: boolean; retryAfterSeconds: number };
}

/**
 * Get or create a rate limiter for a CEE feature.
 *
 * @param feature - Feature name (e.g., "narrate_conditions")
 * @param envVarName - Environment variable for RPM config (optional)
 */
export function getCeeFeatureRateLimiter(
  feature: string,
  envVarName?: string,
): CeeFeatureRateLimiter {
  const baseRpm = envVarName
    ? resolveCeeRateLimit(envVarName)
    : CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM;

  // Get or create bucket map for this feature
  if (!featureBuckets.has(feature)) {
    featureBuckets.set(feature, new Map());
  }
  const buckets = featureBuckets.get(feature)!;

  return {
    feature,
    rpm: baseRpm,
    tryConsume(
      bucketKey: string,
      rawKeyId?: string,
    ): { allowed: boolean; retryAfterSeconds: number } {
      const now = Date.now();
      pruneBuckets(buckets, now);

      const rpm = isSanctionedKey(rawKeyId)
        ? baseRpm * SANCTIONED_MULTIPLIER
        : baseRpm;

      let state = buckets.get(bucketKey);
      if (!state) {
        state = { count: 0, windowStart: now };
        buckets.set(bucketKey, state);
      }

      // Reset window if expired
      if (now - state.windowStart >= WINDOW_MS) {
        state.count = 0;
        state.windowStart = now;
      }

      // Check limit
      if (state.count >= rpm) {
        const resetAt = state.windowStart + WINDOW_MS;
        const diffMs = Math.max(0, resetAt - now);
        const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      // Consume token
      state.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export interface RateBucketDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Which dimension tripped, for telemetry. `error` = limiter threw. */
  dimension?: "key" | "scenario" | "error";
}

/**
 * Enforce the per-feature rate buckets across BOTH dimensions a route can carry:
 * a per-key ceiling (always) and, where the route carries a scenario, an
 * independent per-scenario ceiling (protects a shared scenario from aggregate
 * abuse across keys — e.g. collaborators). Sanctioned keys are lifted on both.
 *
 * Fail posture follows the feature's tier: compute routes fail CLOSED (deny on
 * limiter error), read-only routes fail OPEN.
 */
export function enforceRateBuckets(args: {
  feature: string;
  envVarName?: string;
  keyId?: string;
  scenarioId?: string;
  ip?: string;
}): RateBucketDecision {
  const { feature, envVarName, keyId, scenarioId, ip } = args;
  const tier = envVarName ? RATE_BUCKET_REGISTRY[envVarName] : undefined;
  const failOpen = tier ? TIER_FAIL_OPEN[tier] : false;

  try {
    const limiter = getCeeFeatureRateLimiter(feature, envVarName);
    const primary = keyId ?? ip;

    // Dimension 1 — per key (only when the route can identify a key or ip).
    if (primary !== undefined) {
      const keyResult = limiter.tryConsume(`key::${primary}`, keyId);
      if (!keyResult.allowed) return { ...keyResult, dimension: "key" };
    }

    // Dimension 2 — per scenario (only where the route carries one).
    if (scenarioId) {
      const scenResult = limiter.tryConsume(`scenario::${scenarioId}`, keyId);
      if (!scenResult.allowed) return { ...scenResult, dimension: "scenario" };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err) {
    log.error(
      {
        event: "rate_bucket_enforce_error",
        feature,
        fail_open: failOpen,
        error: err instanceof Error ? err.message : String(err),
      },
      "Rate bucket enforcement error",
    );
    // Compute routes fail closed; read-only routes fail open.
    return failOpen
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: 5, dimension: "error" };
  }
}

/**
 * Reset all rate limit buckets for a feature (for testing)
 */
export function resetCeeFeatureRateLimiter(feature: string): void {
  featureBuckets.get(feature)?.clear();
}

/**
 * Reset all rate limit buckets for all features (for testing)
 */
export function resetAllCeeFeatureRateLimiters(): void {
  featureBuckets.clear();
}

// Boot-validated: assert the tier invariants hold under the current env.
assertRateBucketsValid();
