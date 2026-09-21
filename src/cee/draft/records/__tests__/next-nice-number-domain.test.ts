import { describe, it, expect } from "vitest";
import { nextNiceNumberAbove, deriveFactorScaleFrame } from "../projector.js";

/**
 * ⭐⭐ THE CLAIM THIS FILE EXISTS TO PROVE: `nextNiceNumberAbove` TERMINATES ON
 * EVERY DOUBLE, and refuses rather than invents wherever no truthful rung
 * exists.
 *
 * ── WHY IT NEEDED PROVING ────────────────────────────────────────────────────
 * The function's docstring has always declared `(x > 0, finite)`. The body never
 * enforced it. Outside that domain the walk does not throw and does not return:
 * every comparison against the candidate is false, and the only exit is
 * `return`, so it SPINS FOREVER on a live thread. It hung a reviewer's probe
 * process, which is how it was found.
 *
 * Measured at `9f401d25` in a SIGKILL-bounded child process, six classes hang:
 * `NaN` · `+Infinity` · `-Infinity` · `0` · any negative · and the two smallest
 * positive denormals (`5e-324`, `1e-323`), where `10 ** -324` underflows the
 * start magnitude to `0` and `0 * 10` stays `0` for ever.
 *
 * ⚠ NOTE WHAT THE CALLER'S GUARDS DID AND DID NOT CATCH — this is the reason
 * the defect survived a guarded caller. `deriveFactorScaleFrame` refuses
 * `m < 0` and `max <= 1`. BOTH ARE FALSE FOR `NaN`, because every ordering
 * comparison against `NaN` is false. So `-Infinity` IS caught by the sign
 * guard, and `NaN` and `+Infinity` are not: they pass a sign test and a bound
 * test alike and arrive at the loop. An ordering test is not a domain test
 * (trap 13d — the guard written with the same asymmetry as the failure mode in
 * hand).
 *
 * ── ⚠ HOW RED WAS ESTABLISHED, STATED HONESTLY ───────────────────────────────
 * These are DIRECT calls, so at the pristine tip they do not fail — they HANG,
 * and a hang cannot be bounded from inside the same thread that is spinning
 * (a tight synchronous loop never yields, so no in-process timeout can fire).
 * RED was therefore demonstrated OUT OF SUITE, against the committed bytes, in
 * a child process with a hard `SIGKILL` timeout, alongside positive controls
 * that terminated in the same run — so the harness was shown to discriminate
 * hang from termination rather than merely reporting a timeout for everything.
 * That evidence is in the PR verdict comment.
 *
 * ⚠ THE RESIDUAL, NAMED RATHER THAN HIDDEN: if the domain guard is reverted,
 * this file WEDGES rather than going red. It is a true regression signal, but
 * not a well-behaved one. Bounding it in-suite needs a child process or a
 * worker per case; that was judged disproportionate for a pre-existing,
 * NOT-REACHABLE defect and is not built here.
 */
describe("nextNiceNumberAbove — the domain, ENFORCED rather than documented", () => {
  /**
   * Each of these SPUN FOREVER at `9f401d25`. Bound by identity (the exact
   * input), never by a predicate another value could satisfy.
   */
  const REFUSED: ReadonlyArray<readonly [string, number]> = [
    ["NaN — passes a sign guard AND a bound guard, both false", NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero — magnitude 0, and 0 * 10 is 0 for ever", 0],
    ["negative finite — Math.log10 of a negative is NaN", -5],
    ["-0", -0],
    ["Number.MIN_VALUE (5e-324) — 10 ** -324 underflows to 0", 5e-324],
    ["1e-323 — the other double whose floor(log10) is -324", 1e-323],
  ];

  it.each(REFUSED)("refuses %s — returns undefined, never an invented number", (_label, x) => {
    expect(nextNiceNumberAbove(x)).toBeUndefined();
  });

  it("refuses ABOVE the domain too: no finite rung exists past ~1.6e308", () => {
    // 2e308 is not representable, so there is no finite {1,2,5}·10^k above
    // 1e308. Returning Infinity here would ship a frame that divides every
    // magnitude to a fabricated level 0.
    expect(nextNiceNumberAbove(1e308)).toBeUndefined();
    expect(nextNiceNumberAbove(1.7e308)).toBeUndefined();
    expect(nextNiceNumberAbove(Number.MAX_VALUE)).toBeUndefined();
  });

  /**
   * ⭐ THE ACCEPTED DOMAIN IS UNCHANGED. This is the differential half: a fix
   * that stopped the hang by narrowing what the ladder answers would move live
   * levels silently, which is the harm `projector.ts`'s own header forbids.
   */
  it.each([
    [45, 50],
    [100, 200], // exact power — the boundary the original comment exists for
    [1, 2],
    [0.5, 1],
    [115, 200],
    [20000, 50000],
    [30, 50],
  ])("still answers %d with %d — the ladder itself did not move", (x, expected) => {
    expect(nextNiceNumberAbove(x)).toBe(expected);
  });

  /**
   * ⚠ THE RUNGS ARE BINARY FLOATS BUILT FROM `10 ** k`, NOT DECIMAL LITERALS —
   * written down because this test took TWO wrong drafts to get right, and the
   * second wrong draft is the interesting one.
   *
   *   draft 1:  `toBe(0.0002)`      — wrong, the rung is 0.00019999999999999998
   *   draft 2:  `toBe(2 * 1e-4)`    — ALSO wrong, and it evaluates to 0.0002
   *
   * The reason is that `10 ** -4` is `0.00009999999999999999` and the literal
   * `1e-4` is `0.0001` — DIFFERENT DOUBLES. The ladder's magnitude comes from
   * `10 ** Math.floor(Math.log10(x))`, so the rung is `2 * 10 ** -4`. Deriving
   * an expectation the same way the code derives the value is the only version
   * that cannot drift; transcribing a decimal is how both wrong drafts read as
   * obviously-correct.
   */
  it("small normal magnitudes: the rung is `m * 10 ** k`, not the decimal literal", () => {
    expect(nextNiceNumberAbove(1e-4)).toBe(2 * 10 ** -4);
    // Both of the plausible-looking transcriptions are wrong. Pinned so that a
    // future tidy-up cannot "simplify" this back into a falsehood.
    expect(nextNiceNumberAbove(1e-4)).not.toBe(0.0002);
    expect(10 ** -4, "the ladder's magnitude is not the decimal literal").not.toBe(1e-4);
  });

  /**
   * ⭐ SUBNORMALS ARE ANSWERED, AND THE ANSWER IS APPROXIMATE — the honest
   * scope. Below ~2.2e-308 a double has fewer significand bits, so no exact
   * {1,2,5}·10^k exists to return: `nextNiceNumberAbove(1e-320)` is
   * `1.996e-320`, not `2e-320`. The SAFETY properties still hold exactly
   * (finite, positive, strictly above the input), and those are what the
   * caller depends on. This is stated, not asserted away.
   */
  it("subnormal magnitudes terminate and stay strictly above, with an approximate rung", () => {
    const r = nextNiceNumberAbove(1e-320);
    expect(r).toBeDefined();
    expect(Number.isFinite(r as number)).toBe(true);
    expect(r as number).toBeGreaterThan(1e-320);
    // Approximate, and deliberately pinned as such: NOT the decimal rung.
    expect(r as number).not.toBe(2e-320);
    expect(r as number).toBeCloseTo(2e-320, 322);
  });

  /**
   * THE POSTCONDITION, asserted over a swept corpus rather than a handful of
   * remembered cases: the return is a FINITE POSITIVE {1,2,5}·10^k STRICTLY
   * ABOVE the input, or nothing. Written against the SPEC, not against the
   * failure mode in hand (trap 13d).
   */
  it("postcondition holds across a swept corpus: a finite {1,2,5}·10^k strictly above x, or nothing", () => {
    const corpus: number[] = [
      NaN, Infinity, -Infinity, 0, -0, -1, -1e308, 5e-324, 1e-323,
      Number.MAX_VALUE, 1e308, 1e-320,
    ];
    for (let e = -300; e <= 300; e += 1) {
      for (const m of [1, 1.5, 2, 3, 4.9, 5, 7, 9.99]) corpus.push(m * 10 ** e);
    }

    // Below this a double loses significand bits, so no exact {1,2,5}·10^k is
    // representable and the rung is necessarily approximate. The SAFETY
    // properties are asserted everywhere; the exact-rung identity only where
    // the format can actually hold it. Naming the boundary is the point — an
    // invariant asserted outside the domain it holds in is a false invariant.
    const MIN_NORMAL_DOUBLE = 2.2250738585072014e-308;

    let answered = 0;
    let refused = 0;
    let rungChecked = 0;
    for (const x of corpus) {
      const r = nextNiceNumberAbove(x);
      if (r === undefined) {
        refused++;
        continue;
      }
      answered++;
      // The safety properties — these hold over the WHOLE domain, and they are
      // the ones the caller's correctness rests on.
      expect(Number.isFinite(r), `finite for ${x}`).toBe(true);
      expect(r, `positive for ${x}`).toBeGreaterThan(0);
      expect(r, `strictly above ${x}`).toBeGreaterThan(x);

      if (r < MIN_NORMAL_DOUBLE) continue;
      rungChecked++;
      // {1,2,5}·10^k, DERIVED from the value rather than hand-listed.
      const k = Math.floor(Math.log10(r) + 1e-9);
      const mantissa = r / 10 ** k;
      expect(
        [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9),
        `mantissa of ${r} (=${mantissa}) must be 1, 2 or 5`,
      ).toBe(true);
    }

    // CONTRAST CONTROLS. Without all three arms non-zero the assertions above
    // could pass vacuously — an all-refused corpus satisfies every one of them
    // by never entering the loop body, and an all-subnormal corpus would skip
    // every rung check while still looking thorough.
    expect(answered, "corpus must exercise the ANSWER path").toBeGreaterThan(4000);
    expect(refused, "corpus must exercise the REFUSE path").toBeGreaterThan(8);
    expect(rungChecked, "corpus must actually reach the rung identity").toBeGreaterThan(4000);
  });
});

describe("deriveFactorScaleFrame — the caller's behaviour is unchanged by the refusal move", () => {
  it("a NaN magnitude cannot hang the projector, and mints no frame", () => {
    // NaN defeats BOTH of this function's own guards, so before the fix this
    // call reached the unbounded loop. Unframed is the honest outcome.
    expect(deriveFactorScaleFrame([NaN], "widgets")).toBeUndefined();
    expect(deriveFactorScaleFrame([10, NaN, 30], "widgets")).toBeUndefined();
    expect(deriveFactorScaleFrame([Infinity], "widgets")).toBeUndefined();
    expect(deriveFactorScaleFrame([10, Infinity], "widgets")).toBeUndefined();
  });

  it("the -Infinity case was already caught by the sign guard, and still is", () => {
    expect(deriveFactorScaleFrame([-Infinity], "widgets")).toBeUndefined();
  });

  it("the astronomical case still refuses — moving the guard did not move the outcome", () => {
    // Previously: nextNiceNumberAbove returned Infinity and this function
    // filtered it. Now: nextNiceNumberAbove refuses. Same observable result.
    expect(deriveFactorScaleFrame([1.7e308], "widgets")).toBeUndefined();
  });

  it("ordinary frames are byte-identical to the pinned values", () => {
    expect(deriveFactorScaleFrame([20, 40, 60], "%")).toBe(100);
    expect(deriveFactorScaleFrame([30, 250], "bps")).toBe(10000);
    expect(deriveFactorScaleFrame([115], "% NRR")).toBe(200);
    expect(deriveFactorScaleFrame([20000], "bps")).toBe(50000);
    expect(deriveFactorScaleFrame([10, 20, 30], "pp")).toBe(50);
    expect(deriveFactorScaleFrame([0.2, 0.9], "%")).toBeUndefined();
  });
});
