/**
 * SINGLE-PASS EGRESS — the byte-identity corpus and the scan-position pin.
 * ROADMAP 1.272 E1 + E2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THESE TWO CHANGES ARE, AND WHY THEY NEED DIFFERENT KINDS OF PROOF.
 *
 * E1 moved the Layer-3 leading-option guard OUT of
 * `sanitiseOlumiResponseForEgress` — which `sendFinalised200` re-enters 2–8×
 * per response — and into ONE call on the final `wireBody` immediately before
 * `reply.send`. E1 is byte-neutral BY CONSTRUCTION and not merely by test: the
 * guard is observe-only (`enforce: false`), it returns its input unchanged, and
 * the call site discards the return value. There is no code path by which it
 * can alter a wire byte, so the honest proof for E1 is STRUCTURAL (below) plus
 * the route-level "exactly one alarm" pin in
 * `claim-safety-hoist-and-input-gate-route-level.test.ts`.
 *
 * E2 is different: it CHANGES AN OBJECT THAT SHIPS. On a withheld turn the
 * blobs `projectTransportEnrichmentForWithheldClaim` drops whole are no longer
 * deep-cloned first. Skipping construction of a subtree that is discarded one
 * line later ought to be invisible — but "ought to be" is exactly the claim a
 * corpus is for, because there is a real boundary where it could NOT have
 * been: both functions end with the same `nothing survived ⇒ undefined` rule,
 * so an enrichment whose ONLY keep-list member is a dropped blob takes a
 * different route to `undefined` before and after. That case is fixture 6.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { toSafeTransportEnrichment } from '../../compose.js';
// NOTE: `WITHHELD_DROPPED_ENRICHMENT_BLOBS` is deliberately NOT imported here.
// The helpers below pass the same BOOLEAN production passes, so this file
// cannot mirror (and therefore cannot drift from) the real drop-set.
import { projectTransportEnrichmentForWithheldClaim } from '../withheld-claim-projection.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_V2 = readFileSync(resolve(HERE, '../../../orchestrator/route-v2.ts'), 'utf8');
const OUTPUT_SAFETY = readFileSync(resolve(HERE, '../output-safety.ts'), 'utf8');

/** A `decision_review`-shaped blob: nested, prose-bearing, leader-naming. */
const decisionReview = (): Record<string, unknown> => ({
  opt_a: {
    headline: 'Standardise on MacBook Pro comes out ahead',
    detail: 'It leads in 44% of simulations, with Dell XPS close behind at 34%.',
    drivers: [{ id: 'fac_1', label: 'Unit cost', weight: 0.4 }],
  },
  opt_b: { headline: 'Dell XPS', detail: 'Runner up.', drivers: [] },
  __cee_debug: 'should be stripped by stripInternalKeysDeep',
});

/**
 * The corpus. Each entry is an `enrichment` blob; every one is run through
 * BOTH the permitted and the withheld path.
 */
const CORPUS: ReadonlyArray<readonly [string, unknown]> = [
  ['full enrichment, every keep-list member present', {
    option_comparison: [{ id: 'opt_a', rank: 1 }, { id: 'opt_b', rank: 2 }],
    factor_sensitivity: [{ id: 'fac_1', delta: 0.2 }],
    results: { runs: 5000 },
    robustness: { near_tie: { is_tie: false, gap: 0.1, threshold: 0.05 }, winner_id: 'opt_a' },
    decision_review: decisionReview(),
    option_comparison_status: 'computed',
    conditional_probabilities: { opt_a: 0.44 },
  }],
  ['no decision_review at all (the drop-set is absent)', {
    option_comparison: [{ id: 'opt_a', rank: 1 }],
    results: { runs: 5000 },
  }],
  ['decision_review plus one other keep-list member', {
    decision_review: decisionReview(),
    results: { runs: 100 },
  }],
  ['keys OUTSIDE the keep-list must be dropped either way', {
    decision_review: decisionReview(),
    m1_coaching: 'not on the keep-list',
    some_unknown_blob: { a: 1 },
  }],
  ['robustness present — projected, never dropped whole', {
    decision_review: decisionReview(),
    robustness: { near_tie: { is_tie: true, gap: 0.01, threshold: 0.05 }, winner_id: 'opt_a' },
  }],
  // ⭐ THE BOUNDARY CASE. `decision_review` is the ONLY keep-list member, so
  // before E2 the pipeline built `{decision_review}`, handed it to the
  // projection, the projection dropped it, and the `length > 0 ? out :
  // undefined` collapse produced `undefined`. After E2 nothing is built and
  // `toSafeTransportEnrichment` itself collapses to `undefined`, so the
  // projection is handed `undefined` and short-circuits. Two different routes,
  // and the corpus is what proves they land on the same byte.
  ['ONLY decision_review — the empty-collapse boundary', { decision_review: decisionReview() }],
  ['ONLY dropped blobs plus non-keep-list noise', {
    decision_review: decisionReview(),
    m1_coaching: 'x',
  }],
  ['empty enrichment', {}],
  ['null enrichment', null],
  ['undefined enrichment', undefined],
  ['non-object enrichment', 'not an object'],
];

describe('E2: skipping the clone of dropped blobs is BYTE-IDENTICAL', () => {
  /** The PRE-E2 pipeline: clone everything, then project. */
  const before = (enrichment: unknown, mayName: boolean): unknown => {
    const safe = toSafeTransportEnrichment(enrichment);
    return mayName ? safe : projectTransportEnrichmentForWithheldClaim(safe);
  };

  /**
   * The POST-E2 pipeline: skip the clone of what the projection drops whole.
   * The second argument is the SAME expression `buildAnalysisResultBlock`
   * passes (`!mayNameLeadingOption`) — a boolean, so this helper cannot drift
   * from production by choosing a different key set, because there is no key
   * set to choose. That is deliberate: the first version of this test passed
   * the drop-set explicitly and was therefore a MIRROR of the production
   * wiring, which meant a mutation at the real call site was invisible to it.
   */
  const after = (enrichment: unknown, mayName: boolean): unknown => {
    const safe = toSafeTransportEnrichment(enrichment, !mayName);
    return mayName ? safe : projectTransportEnrichmentForWithheldClaim(safe);
  };

  for (const [name, enrichment] of CORPUS) {
    for (const mayName of [true, false]) {
      it(`${mayName ? 'permitted' : 'withheld'}: ${name}`, () => {
        const a = before(enrichment, mayName);
        const b = after(enrichment, mayName);
        // Serialise and compare, not `toEqual`: the claim is about the BYTES
        // that reach the wire, and `toEqual` would forgive a key-ORDER change
        // that a content hash on the consumer side would not. DGAI dedupes
        // blocks by content hash.
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        // …and `undefined` vs `{}` are different wire shapes (the key is
        // omitted vs present-and-empty), which `JSON.stringify` alone would
        // blur at the top level. Pin the distinction explicitly.
        expect(b === undefined).toBe(a === undefined);
      });
    }
  }

  it('INSTRUMENT: the corpus really does exercise the drop (not a corpus of no-ops)', () => {
    // Rule 2 — a byte-identity corpus that never touches the changed branch
    // proves nothing. Prove the withheld path genuinely removes `decision_review`
    // on a fixture that has it, and that the permitted path genuinely keeps it.
    const withDR = { decision_review: decisionReview(), results: { runs: 1 } };
    const permitted = after(withDR, true) as Record<string, unknown>;
    const withheld = after(withDR, false) as Record<string, unknown>;
    expect(permitted).toHaveProperty('decision_review');
    expect(withheld).not.toHaveProperty('decision_review');
    expect(withheld).toHaveProperty('results');
  });

  it('INSTRUMENT: a TRANSFORMED blob survives the withheld path — the case a key-set param could have deleted', () => {
    // ⭐ THIS FIXTURE EXISTS BECAUSE A MUTATION FOUND ITS ABSENCE.
    //
    // `robustness` is NOT in the drop-set: the projection keeps it and strips
    // only the leader designations, because `is_tie`/`gap`/`threshold` are the
    // tie FACTS and are precisely what a withheld turn should still show. When
    // this parameter was a caller-supplied key ARRAY, a mutant that added
    // 'robustness' to it deleted those facts — and every test passed, because
    // the corpus helper passed its own array and never exercised the real call
    // site. The parameter is a boolean now, so that mutant is unrepresentable;
    // this assertion pins the behaviour it would have broken.
    const e = {
      robustness: {
        near_tie: {
          is_tie: true,
          gap: 0.01,
          threshold: 0.05,
          // A member the near-tie projection DOES drop, so this fixture proves
          // the projection ran rather than that the blob was passed through.
          second_option_id: 'opt_b',
        },
      },
      decision_review: decisionReview(),
    };
    const withheld = after(e, false) as Record<string, unknown>;
    expect(withheld, 'the withheld turn must still carry the tie facts').toHaveProperty(
      'robustness',
    );
    expect(withheld['robustness']).toEqual({
      near_tie: { is_tie: true, gap: 0.01, threshold: 0.05 },
    });
    // The projection RAN (the identity went) and the dropped blob went whole.
    expect(JSON.stringify(withheld)).not.toContain('second_option_id');
    expect(withheld).not.toHaveProperty('decision_review');
  });

  it('INSTRUMENT: the drop-set is DERIVED from the projection, not re-listed', () => {
    // The skip is only safe while it is exactly the set the projection drops
    // WHOLE. Pin that compose.ts consults that frozen constant rather than
    // carrying a literal copy — a second list is how the two silently diverge.
    const composeSrc = readFileSync(resolve(HERE, '../../compose.ts'), 'utf8');
    expect(composeSrc).toContain('WITHHELD_DROPPED_ENRICHMENT_BLOBS.includes(key)');
    // And the call site passes the PERMISSION, not a key set, so a caller
    // cannot name a blob the projection merely transforms.
    expect(composeSrc).toContain('toSafeTransportEnrichment(enrichment, !mayNameLeadingOption)');
  });
});

describe('E1: the Layer-3 scan happens ONCE, on the bytes that ship', () => {
  it('the guard is armed at the send point in sendFinalised200', () => {
    expect(ROUTE_V2).toContain('guardLeadingOptionClaimsAtEgress(wireBody, {');
    expect(ROUTE_V2).toContain('mayNameLeadingOption: ctx.mayNameLeadingOption,');
    // Observe-only. If this ever flips to `enforce: true` at THIS site it stops
    // being byte-neutral, and the byte-identity argument above dies with it.
    const call = ROUTE_V2.slice(ROUTE_V2.indexOf('guardLeadingOptionClaimsAtEgress(wireBody, {'));
    expect(call.slice(0, 260)).toContain('enforce: false');
  });

  it('the scan is the LAST thing before the send, and after the last wireBody write', () => {
    // Position is the whole correctness claim. `finaliseV5Response` mutates
    // enrichment and overrides `graph_hash` AFTER every sanitiser call, and two
    // re-attach passes can fail closed and DISCARD the object they just built —
    // so a scan anywhere earlier is a scan of bytes that may never ship.
    const scanAt = ROUTE_V2.indexOf('guardLeadingOptionClaimsAtEgress(wireBody, {');
    const sendAt = ROUTE_V2.indexOf('return reply.code(200).send(wireBody);');
    const lastWrite = ROUTE_V2.lastIndexOf('wireBody = ');
    expect(scanAt, 'the single guard call was not found').toBeGreaterThan(0);
    expect(sendAt, 'the send site was not found').toBeGreaterThan(0);
    expect(lastWrite, 'no wireBody assignment found').toBeGreaterThan(0);
    expect(scanAt, 'the scan must come AFTER the last wireBody assignment').toBeGreaterThan(
      lastWrite,
    );
    expect(scanAt, 'the scan must come BEFORE the send').toBeLessThan(sendAt);
  });

  it('the re-entered chokepoint no longer scans', () => {
    // `sanitiseOlumiResponseForEgress` runs 2–8× per response. A scan there is
    // 2–8 scans of near-identical bytes AND multiplies the alarm's own
    // `hit_count`, which the guard's docstring used to tell dashboard readers
    // to divide by a constant that was never the right number.
    expect(
      OUTPUT_SAFETY,
      'the Layer-3 guard has been re-added to `sanitiseOlumiResponseForEgress`, which ' +
        '`sendFinalised200` re-enters 2–8 times per response. It belongs at the single send ' +
        'point on the final `wireBody`. See ROADMAP 1.272 E1.',
    ).not.toContain('guardLeadingOptionClaimsAtEgress(sanitised');
  });

  it('POSITIVE CONTROL: the chokepoint-absence check can FAIL', () => {
    // Rule 2 — prove the `not.toContain` discriminates by planting the exact
    // pre-fix call back into the source it reads.
    const planted = `${OUTPUT_SAFETY}\n  guardLeadingOptionClaimsAtEgress(sanitised, { enforce: false });`;
    expect(planted).toContain('guardLeadingOptionClaimsAtEgress(sanitised');
  });

  it('the multiplicity documentation no longer tells readers to divide by 4', () => {
    // trap #14: the number was load-bearing (a dashboard instruction), it was
    // an undercount, and it was not even a constant — the true re-entry count
    // varied 2–8 with which debug surfaces were enabled.
    const guardSrc = readFileSync(resolve(HERE, '../leading-option-egress-guard.ts'), 'utf8');
    expect(guardSrc).not.toContain('re-enters this chokepoint up to 4×');
    expect(guardSrc).toContain('MULTIPLICITY: 1× PER RESPONSE');
  });
});
