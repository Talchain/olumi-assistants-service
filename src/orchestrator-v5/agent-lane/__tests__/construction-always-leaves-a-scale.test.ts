/**
 * ⭐⭐ A KNOWN BASELINE LEAVES CONSTRUCTION WITH A SCALE, OR IS ONE OF THE FOUR
 * CASES THAT CANNOT CARRY ONE — asserted EXHAUSTIVELY, not sampled.
 *
 * ── WHY THIS FILE EXISTS: SAMPLE SIZE WAS THE WHOLE GAME ────────────────────
 * #63 item 1 is BRIEF-DEPENDENT, and that made every wire measurement of it
 * inconclusive in both directions. I published "item 1 does not hold on this
 * build" from ONE served sample, retracted it, then re-confirmed the defect on a
 * different brief. Post-fix I measured 6 zero-baseline factors across 4 briefs on
 * served `31847a8` with none unframed — strong evidence, but explicitly NOT proof,
 * because an absence over 4 LLM drafts cannot exclude a 5th reproducing it.
 *
 * A manual probe over LLM briefs can never close that. This closes it a different
 * way: `admitCandidateModel` is PURE over its candidate, so the invariant can be
 * asserted over the whole input space that matters, deterministically, in CI.
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE ─────────
 * The framer's own contract names exactly four cases a 0..cap frame cannot
 * express, and everything else must be framed:
 *   1. no cap at all               → nothing to frame against
 *   2. cap not strictly above 1    → would encode a frame of 1 or less
 *   3. a NEGATIVE baseline         → a 0..cap frame cannot represent it
 *   4. a baseline ABOVE the cap    → the cap is not a bound for this value
 * For every other (baseline, cap) pair the node must leave construction with a
 * frame, and with EXACTLY ONE carrier — `observed_state.cap` or node
 * `scale_frame`, never both, because two carriers can disagree.
 *
 * ⚠ It asserts the ONE-CARRIER rule too, which is the half my first fix got
 * wrong: the mutant that restored `raw <= 0` SURVIVED a test that accepted either
 * carrier, because the node-level fallback satisfied it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

const here = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', here), 'utf8')) as CandidateModel;

const LABEL = 'Enterprise customers';

function admitOne(baseline: number, plausibleMax: number | undefined) {
  const candidate = {
    ...faithful,
    factors: [{
      label: LABEL,
      role: 'controllable',
      provenance: 'explicit',
      unit: 'customers',
      baseline_known: true,
      baseline_value: baseline,
      ...(plausibleMax === undefined ? {} : { plausible_max: plausibleMax }),
    }],
  } as unknown as CandidateModel;
  const m = admitCandidateModel(candidate);
  const n = m.nodes.find((x) => x.label === LABEL) as unknown as {
    scale_frame?: number;
    observed_state?: { value?: number; raw_value?: number; cap?: number };
  } | undefined;
  return n;
}

/**
 * ⭐⭐ TIGHTENED AFTER A SURVIVING MUTANT. My first version listed FOUR cases as
 * unframeable and the mutant that neutralises the `scale_frame` fallback SURVIVED
 * it — because a negative baseline and a baseline above the cap were permitted to
 * be unframed either way, so the fallback was never exercised.
 *
 * Measured what the constructor actually does:
 *
 *   baseline=900 cap=500  → observed.cap=undefined  scale_frame=500
 *   baseline=-5  cap=500  → observed.cap=undefined  scale_frame=500
 *   baseline=0   cap=1    → neither
 *   baseline=0   cap=∅    → neither
 *   baseline=0   cap=500  → observed.cap=500        scale_frame=undefined
 *
 * So the real contract is stronger and simpler than my first reading: WHENEVER A
 * USABLE CAP EXISTS the node is framed — in `observed_state` when the baseline fits
 * the 0..cap frame, at NODE level when it cannot (the levels still need a frame even
 * if the baseline is not expressible). Only TWO cases are genuinely unframeable.
 */
function unframeableBySpec(_baseline: number, cap: number | undefined): boolean {
  if (cap === undefined || !Number.isFinite(cap)) return true; // no cap at all
  if (cap <= 1) return true;                                   // would encode a frame of 1 or less
  return false;
}

/**
 * Which carrier the contract requires, given a usable cap. `observed_state` when the
 * baseline fits 0..cap; the node otherwise. Asserting WHICH one is what makes the
 * fallback testable at all.
 */
function expectedCarrier(baseline: number, cap: number): 'observed_state' | 'node' {
  return baseline >= 0 && baseline <= cap ? 'observed_state' : 'node';
}

// Deliberately includes 0 — the value the defect was about — plus the boundaries
// of every clause above, and magnitudes across five orders.
const BASELINES = [-1000, -1, -0.5, 0, 0.0001, 0.5, 1, 2, 40, 89, 400, 40000, 500000];
const CAPS: (number | undefined)[] = [undefined, 0, 0.5, 1, 1.5, 2, 100, 500, 1000, 100000, 1000000];

describe('construction: a known baseline is framed unless the spec says it cannot be', () => {
  it('⭐⭐ EXHAUSTIVE over the (baseline, cap) space — every pair obeys the contract', () => {
    const violations: string[] = [];
    const framedCount = { framed: 0, unframed: 0 };
    for (const b of BASELINES) {
      for (const c of CAPS) {
        const n = admitOne(b, c);
        if (n === undefined) { violations.push(`baseline=${b} cap=${c}: factor not admitted at all`); continue; }
        const os = n.observed_state ?? {};
        const inObserved = typeof os.cap === 'number';
        const atNode = typeof n.scale_frame === 'number';
        const framed = inObserved || atNode;
        if (framed) framedCount.framed += 1; else framedCount.unframed += 1;
        const mayBeUnframed = unframeableBySpec(b, c);

        // THE INVARIANT.
        if (!framed && !mayBeUnframed) {
          violations.push(`baseline=${b} cap=${c}: UNFRAMED but the spec requires a frame`);
        }
        // ⭐ AND THE RIGHT CARRIER, which is what makes the node-level fallback
        // testable. Without this the fallback can be neutralised and the sweep
        // still passes — measured: that mutant SURVIVED the first version.
        if (!mayBeUnframed && c !== undefined) {
          const want = expectedCarrier(b, c);
          const got = inObserved ? 'observed_state' : atNode ? 'node' : 'none';
          if (got !== want) {
            violations.push(`baseline=${b} cap=${c}: carrier ${got}, contract requires ${want}`);
          }
        }
        // ⛔ EXACTLY ONE CARRIER. Two can disagree, and the mutant that restored
        // `raw <= 0` survived a test that accepted either.
        if (inObserved && atNode) {
          violations.push(`baseline=${b} cap=${c}: TWO carriers (observed_state.cap AND scale_frame)`);
        }
        // ⭐ Nothing is invented: a framed observed_state must keep the user's own
        // figure in `raw_value` and put the framed value inside [0,1].
        if (inObserved) {
          if (os.raw_value !== b) {
            violations.push(`baseline=${b} cap=${c}: raw_value=${os.raw_value} lost the authored figure`);
          }
          if (typeof os.value !== 'number' || os.value < 0 || os.value > 1) {
            violations.push(`baseline=${b} cap=${c}: framed value ${os.value} outside [0,1]`);
          }
        }
      }
    }
    // Both arms must be non-empty, or the sweep proves nothing about either.
    expect(framedCount.framed, 'no pair was framed — the sweep is vacuous').toBeGreaterThan(0);
    expect(framedCount.unframed, 'no pair was left unframed — the spec cases are unreachable').toBeGreaterThan(0);
    expect(violations, `${violations.length} contract violation(s):\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('⛔⛔ THE WITNESSED CASE: baseline ZERO with a usable cap is framed in `observed_state`', () => {
    // The exact shape measured on served `389051f`: value 0, no cap, no scale_frame.
    // Pinned to the OBSERVED_STATE carrier specifically, because the value writer and
    // the Run read the `(value, raw_value, cap)` pair — a node-level-only frame
    // records nothing about what the 0 is 0 OF.
    const n = admitOne(0, 500);
    expect(n?.observed_state?.cap).toBe(500);
    expect(n?.observed_state?.raw_value).toBe(0);
    expect(n?.observed_state?.value).toBe(0);
    expect(n?.scale_frame, 'a framed observed_state must not also carry a node frame').toBeUndefined();
  });

  it('⭐ both true exemptions are reachable, and the node-carrier cases use the node', () => {
    // A contrast control for the sweep: if an exemption were unreachable the
    // invariant would be weaker than it looks.
    expect(admitOne(0, undefined)?.observed_state?.cap).toBeUndefined();   // no cap
    expect(admitOne(0, 1)?.observed_state?.cap).toBeUndefined();           // cap <= 1
    // ⚠ These two are NOT exemptions — they are the NODE-CARRIER cases. Measured:
    // the framer declines them in `observed_state` and the fallback supplies
    // `scale_frame` instead, because the option levels still need a frame.
    expect(admitOne(-5, 500)?.observed_state?.cap).toBeUndefined();
    expect(admitOne(-5, 500)?.scale_frame).toBe(500);
    expect(admitOne(900, 500)?.observed_state?.cap).toBeUndefined();
    expect(admitOne(900, 500)?.scale_frame).toBe(500);
  });
});
