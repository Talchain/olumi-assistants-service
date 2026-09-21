/**
 * Payload equivalence — the comparison machinery behind the staged-vs-buffered
 * equivalence pin (ROADMAP 1.204 M1, tests/integration/staged-draft-sse.test.ts).
 *
 * Extracted from that test so the properties below can be pinned DIRECTLY and
 * DETERMINISTICALLY, rather than only through a live pipeline run whose verdict
 * depends on how many milliseconds a stage happened to take.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The pin compares the staged terminal payload against the buffered body. Some
 * fields differ between ANY two runs of the SAME route: correlation ids, plan
 * ids, and wall-clock durations. The test derives that volatile set by SAMPLING
 * — running one route repeatedly and unioning the pairwise diffs — precisely so
 * nothing is hand-listed (CLAUDE.md trap 12).
 *
 * Sampling handles ids perfectly: they differ on EVERY run, so they are always
 * classified volatile. It handles wall-clock durations BADLY, and the failure is
 * silent-then-loud. Under the fixtures adapter the threshold sweep completes in
 * under a millisecond, so `trace.pipeline.threshold_sweep.duration_ms` reads 0
 * on every sampled run and is NOT classified volatile — and then a run that
 * happens to take 1 ms reds the pin with a "divergence" that is not one.
 *
 * MEASURED, NOT INFERRED. At commit bfb2cb5f the SAME `Integration Tests
 * (advisory)` job ran twice on the identical tree and disagreed: job
 * 92755069551 passed, job 92755076632 failed on exactly that path. A local
 * census of every leaf over 30 buffered + 30 staged runs found the payload has
 * THREE numeric wall-clock leaves — `total_duration_ms` (varies, so sampling
 * already caught it), `threshold_sweep.duration_ms` and
 * `llm_metadata.duration_ms` (both constant at 0, so sampling caught NEITHER).
 * One of those two had fired; the other was the same defect waiting its turn.
 *
 * ── THE FIX, AND WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────
 * Wall-clock timings are NORMALISED, not ignored. Every NUMBER leaf under a
 * timing-named key is replaced by one sentinel before the comparison, so:
 *   - two different durations compare equal              (the volatility, gone)
 *   - a timing field present on ONE side only            still diverges
 *   - a timing field that changes TYPE (number→string/null) still diverges
 *   - every non-timing field                             still compares exactly
 * An ignore-list would have thrown all four away. Normalisation gives up exactly
 * the one thing that is volatile by construction: the measured number itself.
 *
 * ── DERIVED, WITH A CORPUS BEHIND IT (trap 12d) ────────────────────────────
 * The timing set is a NAME RULE over keys, not a list of instances, so a new
 * `*_ms` field anywhere in the payload is covered the day it is added. But
 * deriving a guard from a rule only MOVES the risk onto the rule, so the rule
 * carries two checks that are NOT derived from it:
 *   1. a hand-written corpus of real payload keys it must and must not match
 *      (tests/unit/payload-equivalence.test.ts) — that is what notices a rule
 *      which is too narrow or too broad; and
 *   2. `deriveVolatility` below reports `unnamedNumericVolatilePaths` — any path
 *      that still varies between runs of the SAME route while holding a number
 *      on both sides is a wall-clock-shaped field the rule does not know about.
 *      The integration test FAILS LOUD on it, by name.
 */

/**
 * Keys whose numeric value is a wall-clock reading and therefore volatile by
 * construction. A RULE, not a list: `duration_ms`, `total_duration_ms`,
 * `stream_duration_ms`, `elapsed_ms`, `latency_ms`, `started_at` all match
 * without anyone maintaining an inventory.
 *
 * Precision is measured, not assumed: across the 195 distinct leaf keys of a
 * real draft payload this matches `duration_ms` and `total_duration_ms` and
 * nothing else. Note the near-misses it correctly LEAVES ALONE — `build_timestamp`
 * (a build identity, constant and structural) and `estimated_minutes` (product
 * content). Matching either would hide a real divergence.
 */
export const TIMING_KEY_RE =
  /(?:^|_)(?:duration|elapsed|latency|runtime|uptime|took)s?(?:_|$)|(?:^|_)ms$|(?:^|_)at$/;

export function isTimingKey(key: string): boolean {
  return TIMING_KEY_RE.test(key);
}

/**
 * The single value every normalised wall-clock reading collapses to. A STRING,
 * deliberately: it can never collide with a real duration, and if the
 * normaliser is ever pointed at the wrong field the substitution is obvious in
 * a failure diff rather than looking like a plausible measurement.
 */
export const TIMING_SENTINEL = "<wall-clock-timing:normalised>";

export interface NormaliseResult {
  /** A deep copy with every numeric wall-clock leaf replaced. Input untouched. */
  value: unknown;
  /** Dotted paths of the leaves that were replaced, in traversal order. */
  touched: string[];
}

/**
 * Replace every NUMBER leaf sitting under a timing-named key with
 * TIMING_SENTINEL. Only numbers are replaced — a string, `null`, or a missing
 * key under the same name is left exactly as it is, which is what keeps the
 * presence and type-change comparisons alive.
 */
export function normaliseWallClockTimings(value: unknown): NormaliseResult {
  const touched: string[] = [];
  const walk = (v: unknown, path: string, key: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, key));
    if (typeof v === "object" && v !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(x, path ? `${path}.${k}` : k, k);
      }
      return out;
    }
    if (typeof v === "number" && isTimingKey(key)) {
      touched.push(path);
      return TIMING_SENTINEL;
    }
    return v;
  };
  return { value: walk(value, "", ""), touched };
}

export interface Divergence {
  path: string;
  a: unknown;
  b: unknown;
}

/** Every differing leaf between two JSON values, with both sides' values. */
export function diffEntries(a: unknown, b: unknown, path = ""): Divergence[] {
  if (a === b) return [];
  const bothObjects =
    typeof a === "object" && a !== null && typeof b === "object" && b !== null;
  if (!bothObjects) return [{ path, a, b }];
  if (Array.isArray(a) !== Array.isArray(b)) return [{ path, a, b }];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [{ path, a, b }];
    return a.flatMap((v, i) => diffEntries(v, (b as unknown[])[i], `${path}[${i}]`));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  return [...keys].flatMap((k) => diffEntries(ao[k], bo[k], path ? `${path}.${k}` : k));
}

/** Every differing path between two JSON values, as dotted paths. */
export function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  return diffEntries(a, b, path).map((d) => d.path);
}

export interface VolatilityDerivation {
  /** Paths that differ between runs of the SAME route — ids, and anything else
   *  genuinely non-deterministic. Derived by sampling, never hand-listed. */
  volatilePaths: Set<string>;
  /**
   * THE FAIL-LOUD SIGNAL. Paths that vary between runs of the same route while
   * holding a NUMBER on both sides, AFTER wall-clock normalisation. A number
   * that changes under an identical input is either a wall-clock reading whose
   * key TIMING_KEY_RE does not recognise, or real non-determinism in the
   * pipeline. Both are things a maintainer must be told about by name — this is
   * the check that notices the rule has gone short.
   */
  unnamedNumericVolatilePaths: string[];
}

/**
 * Derive what is volatile from repeated runs of each route AGAINST ITSELF.
 * Never across the two routes — that would be circular, using the very equality
 * under test to decide what may be ignored.
 *
 * @param sameRouteGroups one group of bodies per route; only within-group pairs
 *                        are compared.
 */
export function deriveVolatility(sameRouteGroups: unknown[][]): VolatilityDerivation {
  const volatilePaths = new Set<string>();
  const unnamed = new Set<string>();
  for (const group of sameRouteGroups) {
    const normalised = group.map((b) => normaliseWallClockTimings(b).value);
    for (let i = 0; i < normalised.length; i++) {
      for (let j = i + 1; j < normalised.length; j++) {
        for (const d of diffEntries(normalised[i], normalised[j])) {
          volatilePaths.add(d.path);
          if (typeof d.a === "number" && typeof d.b === "number") unnamed.add(d.path);
        }
      }
    }
  }
  return { volatilePaths, unnamedNumericVolatilePaths: [...unnamed].sort() };
}

export interface EquivalenceOptions {
  /** Paths derived as volatile by sampling (ids, plan ids). */
  ignorePaths?: ReadonlySet<string>;
}

/**
 * The divergences between two payloads that are claimed equivalent: everything
 * that differs after wall-clock timings are normalised, minus the sampled
 * volatile set.
 */
export function equivalenceDivergences(
  a: unknown,
  b: unknown,
  opts: EquivalenceOptions = {},
): string[] {
  const ignore = opts.ignorePaths ?? new Set<string>();
  const na = normaliseWallClockTimings(a).value;
  const nb = normaliseWallClockTimings(b).value;
  return diffPaths(na, nb).filter((p) => !ignore.has(p));
}
