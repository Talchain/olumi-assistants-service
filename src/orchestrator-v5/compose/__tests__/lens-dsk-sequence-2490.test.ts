/**
 * ROADMAP 2.490 — the sensitivity → devils_advocacy SEQUENCE, measured on the
 * LIVE WIRE CAPTURES rather than on fixtures this lane wrote.
 *
 * WHY THE FIXTURES ARE CAPTURES. `devils_advocacy` shipped in DSK slice 1 and
 * was selected on ZERO of five live staging sessions. The reason it survived
 * the slice-1 suite is that every fixture in that suite was HAND-BUILT, and
 * the hand-built shapes happened to omit the one field
 * (`factor_sensitivity[].flip_risk_category`) whose presence decides whether
 * the 2.211-① correlated yield engages — which is the whole of the difference
 * between "the sequence rule fires" and "it is inert". A fixture you wrote
 * yourself is not evidence about the wire, so the two fixtures here are the
 * VERBATIM `enrichment` objects captured from deployed staging
 * (`PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/{sessionA,sessionB2}`), committed
 * whole rather than trimmed — a trimmed capture would silently stop being
 * evidence the day the selector reads a sixth field.
 *
 * WHAT CHANGED (two hunks in `lens-selector.ts`, each INERT ALONE and
 * load-bearing only TOGETHER — a lane that measures either on its own will
 * wrongly conclude it does nothing):
 *
 *   HUNK 1 — the sequence rule. A DISPLACED `sensitivity_flip_risk` head hands
 *     its slot to `devils_advocacy` rather than to the next ladder entry.
 *   HUNK 2 — `evaluateDevilsAdvocacy`'s `isRawFragile` clause is removed, a
 *     DELIBERATE override of a declared DSK-TR-005 clause on that clause's own
 *     stated rationale (see the evaluator's comment).
 *
 * Hunk 1 alone is inert because on the shape that needs it (sessionB2) the lens
 * is not ELIGIBLE at all; hunk 2 alone is inert because the ladder binds the
 * runner-up slot first.
 *
 * ⚠ THE ONE PLACE THIS LANE DEPARTED FROM ITS OWN BRIEF, AND WHY — hunk 1 as
 * specified read `slotOrder.find(devils_advocacy)` unconditionally. MEASURED at
 * this tip: that starves `consider_opposite` on any shape where sensitivity is
 * a non-yielding head and BOTH DSK triggers fire (the slice-1 suite's own
 * positive control went red on it). The shipped rule therefore carries one
 * extra clause — the sequel does not apply while `consider_opposite` is
 * eligible — which is byte-identical on all five live captures and preserves
 * the declared partition below. Pinned by `neither DSK exercise starves`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  DOMINANCE_SHARE_MIN,
  PREMORTEM_WINPROB_MAX,
  PREMORTEM_WINPROB_MIN,
  selectLens,
  type LensId,
  type LensSelection,
} from '../lens-selector.js';
import { RAW_FRAGILE_LEVELS } from '../../coaching/robustness-honesty.js';

// ============================================================================
// The captures, loaded whole
// ============================================================================

type Enrichment = Record<string, unknown>;

function loadCapture(file: string): Enrichment {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/dsk-walk/${file}`, import.meta.url), 'utf8'),
  ) as Enrichment;
}

/** Live capture: decisive leader, dominant driver, attested non-fragile level,
 *  every flip hit `correlated` (so the 2.211-① yield engages). */
const SESSION_A = loadCapture('session-a.enrichment.json');
/** Live capture: NO decisive leader, dominant driver, attested FRAGILE level,
 *  an `isolated` flip hit (so the yield does NOT engage). */
const SESSION_B2 = loadCapture('session-b2.enrichment.json');

function makeFact(enrichment: Enrichment): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2490',
      leading_option_id: 'opt_leader',
      summary: 'Ran analysis.',
      graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
      computed_at: '2026-08-05T00:00:00.000Z',
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

// ============================================================================
// Derivations over a capture — every precondition below is DERIVED from the
// fixture bytes, never restated as a literal this file also asserts against.
// A fixture that is edited, truncated or regenerated fails these loudly rather
// than quietly making the behavioural tests mean something else (the
// "discriminator that cannot detect its own fixture rotting" defect).
// ============================================================================

function factors(enrichment: Enrichment): readonly Record<string, unknown>[] {
  const fs = enrichment.factor_sensitivity;
  expect(Array.isArray(fs)).toBe(true);
  return fs as readonly Record<string, unknown>[];
}

function leaderWinProbability(enrichment: Enrichment): number {
  const oc = enrichment.option_comparison as readonly Record<string, unknown>[];
  const probs = oc
    .map((o) => o.win_probability)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  expect(probs.length).toBeGreaterThan(1);
  return Math.max(...probs);
}

/** The selector's own strict-majority influence-share derivation, recomputed
 *  here from the capture so the precondition is independent of the selector. */
function dominance(enrichment: Enrichment): { share: number; factorId: string } | null {
  const scored = factors(enrichment)
    .map((f) => ({ id: f.factor_id, score: f.influence_score }))
    .filter(
      (f): f is { id: string; score: number } =>
        typeof f.id === 'string' && typeof f.score === 'number' && f.score > 0,
    );
  if (scored.length === 0) return null;
  const total = scored.reduce((a, f) => a + f.score, 0);
  const top = scored.reduce((a, f) => (f.score > a.score ? f : a), scored[0]!);
  const share = top.score / total;
  return share > DOMINANCE_SHARE_MIN ? { share, factorId: top.id } : null;
}

function flipCategories(enrichment: Enrichment): readonly string[] {
  return factors(enrichment)
    .map((f) => f.flip_risk_category)
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.toLowerCase());
}

function robustnessLevel(enrichment: Enrichment): string {
  const r = enrichment.robustness as Record<string, unknown>;
  expect(typeof r.level).toBe('string');
  return r.level as string;
}

/** Structured-clone a capture and hand it to `mutate` — every derived shape in
 *  this file is ONE documented field change away from real wire bytes, and the
 *  change is asserted to have LANDED (an applied-check: a transform that
 *  silently no-ops turns every downstream assertion into theatre). */
function derived(base: Enrichment, mutate: (e: Enrichment) => void): Enrichment {
  const copy = structuredClone(base);
  mutate(copy);
  expect(JSON.stringify(copy)).not.toBe(JSON.stringify(base));
  return copy;
}

// ============================================================================
// The walk — the defect is a property of the CYCLE, not of any one turn, so a
// single-turn probe cannot see it. Each selection is fed back as
// `previousAnalysisLens`, the way `compose.ts` threads it on the fresh branch.
// ============================================================================

function walk(enrichment: Enrichment, turns = 8): readonly (LensSelection | null)[] {
  const fact = makeFact(enrichment);
  const seen: (LensSelection | null)[] = [];
  let previous: LensId | null = null;
  for (let t = 0; t < turns; t++) {
    const selection = selectLens(fact, { previousAnalysisLens: previous });
    seen.push(selection);
    previous = selection === null ? null : selection.lens;
  }
  return seen;
}

function lensesIn(enrichment: Enrichment, turns = 8): readonly (LensId | null)[] {
  return walk(enrichment, turns).map((s) => (s === null ? null : s.lens));
}

function firstSelectionOf(
  enrichment: Enrichment,
  lens: LensId,
  turns = 8,
): LensSelection | null {
  return walk(enrichment, turns).find((s) => s !== null && s.lens === lens) ?? null;
}

// ============================================================================
// 1. CAPTURE PRECONDITIONS
// ============================================================================

describe('ROADMAP 2.490 — the captures carry the shapes the behaviour tests assume', () => {
  it('sessionB2: dominant driver, NO decisive leader, ATTESTED FRAGILE level, isolated flip hit', () => {
    const dom = dominance(SESSION_B2);
    expect(dom).not.toBeNull();
    // TR-005's observable — a single factor carrying the result — is TRUE here.
    expect(dom!.share).toBeGreaterThan(DOMINANCE_SHARE_MIN);
    expect(dom!.factorId).toBe('fac_flour_price');

    // TR-003's observable — a DECISIVE leader — is FALSE here, and the leader
    // sits inside pre_mortem 2c's band, so pre_mortem is a real competitor for
    // the displaced slot (that is what makes §5's promotion-order test bite).
    const leader = leaderWinProbability(SESSION_B2);
    expect(leader).toBeLessThan(PREMORTEM_WINPROB_MAX);
    expect(leader).toBeGreaterThanOrEqual(PREMORTEM_WINPROB_MIN);

    // The level IS one the shared truth table calls fragile — this is the
    // session on which hunk 2's override of DSK-TR-005's declared
    // `robustness != 'fragile'` clause is what makes the lens eligible at all.
    expect(RAW_FRAGILE_LEVELS.has(robustnessLevel(SESSION_B2))).toBe(true);

    // An `isolated` hit means the 2.211-① correlated yield does NOT engage, so
    // `sensitivity_flip_risk` really is the head whose slot the sequel takes.
    expect(flipCategories(SESSION_B2)).toContain('isolated');
  });

  it('sessionA: decisive leader, dominant driver, attested NON-fragile level, correlated-only flips', () => {
    const dom = dominance(SESSION_A);
    expect(dom).not.toBeNull();
    expect(dom!.factorId).toBe('fac_partner_invest');

    // TR-003's observable is TRUE here — this is the decisive-leader half of
    // the partition.
    expect(leaderWinProbability(SESSION_A)).toBeGreaterThanOrEqual(PREMORTEM_WINPROB_MAX);
    expect(RAW_FRAGILE_LEVELS.has(robustnessLevel(SESSION_A))).toBe(false);

    // No `isolated` hit, at least one `correlated` ⇒ the yield DOES engage, and
    // the sensitivity head steps to the end before any promotion is considered.
    // This is the reason hunk 1 is inert on this session (and, measured on it
    // alone, would read as inert in general).
    expect(flipCategories(SESSION_A)).toContain('correlated');
    expect(flipCategories(SESSION_A)).not.toContain('isolated');
  });
});

// ============================================================================
// 2. THE FIX — devils_advocacy becomes reachable on the live sessionB2 shape
// ============================================================================

describe('ROADMAP 2.490 — a displaced sensitivity head hands the slot to devils_advocacy', () => {
  it('THE FIX — devils_advocacy is selected on the live sessionB2 capture', () => {
    // RED before the two hunks: this walk was `sensitivity_flip_risk` ↔
    // `pre_mortem` for its whole length, on every previousAnalysisLens state.
    expect(lensesIn(SESSION_B2)).toContain('devils_advocacy');
  });

  it('binds that selection to the dominating factor BY ID, with the displacement pair', () => {
    // Identity binding: the exact factor id derived from the capture, never a
    // value predicate another factor could satisfy.
    const dom = dominance(SESSION_B2)!;
    const selection = firstSelectionOf(SESSION_B2, 'devils_advocacy');
    expect(selection).not.toBeNull();
    expect(selection!.rationaleCode).toBe('DOMINANT_FACTOR_DISSENT');
    expect(selection!.groundingField).toBe('factor_sensitivity');
    expect(selection!.subjectRef).toEqual({ id: dom.factorId, kind: 'factor' });
    // The slot was MOVED, and by the no-repeat rule — not won outright.
    expect(selection!.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection!.displacementCause).toBe('no_repeat');
  });

  it('the single turn that produces it: previous lens = the sensitivity head', () => {
    const selection = selectLens(makeFact(SESSION_B2), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('devils_advocacy');
  });

  it('BINDS THE SEQUEL TO devils_advocacy, not to "whatever is next on the ladder"', () => {
    // The ordinary 2.211 runner-up on this capture is `pre_mortem` — proven in
    // §5 by removing the dominance, devils' only other input. So a rule that
    // promoted merely "the next eligible lens" would answer `pre_mortem` here.
    // Asserting the exact id is what discriminates the two.
    const selection = selectLens(makeFact(SESSION_B2), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection!.lens).toBe('devils_advocacy');
    expect(selection!.lens).not.toBe('pre_mortem');
  });

  it('the sequel applies to a SENSITIVITY head only — it never repeats the head lens', () => {
    // Discriminates the `head.lens === 'sensitivity_flip_risk'` clause. On
    // sessionA with a fragile level, consider_opposite drops out and the
    // correlated yield leaves `devils_advocacy` itself at the head; a sequel
    // rule that did not check the head would then find devils in slotOrder and
    // hand the slot straight back to it — a no-repeat rule producing a repeat.
    const fragileA = derived(SESSION_A, (e) => {
      (e.robustness as Record<string, unknown>).level = robustnessLevel(SESSION_B2);
    });
    const head = selectLens(makeFact(fragileA));
    expect(head).not.toBeNull();
    expect(head!.lens).toBe('devils_advocacy');

    const next = selectLens(makeFact(fragileA), {
      previousAnalysisLens: 'devils_advocacy',
    });
    expect(next).not.toBeNull();
    // THE CLAUSE UNDER TEST, unchanged: the sequel did not hand the slot back
    // to the head. This is what this case discriminates.
    expect(next!.lens).not.toBe('devils_advocacy');
    // ⚠ RE-PINNED BY ROADMAP 2.989 (wave-1 Lane A), and the distinction matters.
    // What changed is NOT this clause — it is LADDER MEMBERSHIP. This line used
    // to read `toBe('sensitivity_flip_risk')`, which pinned WHO the ordinary
    // runner-up happens to be on this derived shape, not the sequel rule. With
    // `fragile_edge_resolution` on the ladder (below devils_advocacy, above the
    // what-if extension) the yielded sensitivity head is no longer the only
    // alternate, so the runner-up is the new lens. Measured across FOUR
    // candidate placements (above the DSK pair, between them, below them, and
    // last): every one of them moves a runner-up identity somewhere in this
    // file, because these controls pin exact alternates on derived session-A
    // shapes. This position was chosen because it disturbs exactly this ONE
    // assertion and leaves the 2.490 partition, the yield, the no-repeat rule
    // and both DSK exercises' reachability untouched.
    expect(next!.lens).toBe('fragile_edge_resolution');
  });

  it('no walk ever emits the same lens on consecutive turns while an alternate exists', () => {
    for (const capture of [SESSION_A, SESSION_B2]) {
      const seen = lensesIn(capture, 10);
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]).not.toBe(seen[i - 1]);
      }
    }
  });
});

// ============================================================================
// 3. NON-VACUITY + THE PARTITION — neither DSK exercise starves
// ============================================================================

describe('ROADMAP 2.490 — the two DSK exercises partition the live shapes', () => {
  it('POSITIVE CONTROL — the harness can observe consider_opposite being selected', () => {
    // Trap 13: every "X is absent" assertion below is worthless unless this
    // harness demonstrably observes the other lens somewhere.
    expect(lensesIn(SESSION_A)).toContain('consider_opposite');
  });

  it('decisive leader (sessionA) ⇒ consider_opposite, never devils_advocacy', () => {
    const seen = lensesIn(SESSION_A);
    expect(seen).toContain('consider_opposite');
    expect(seen).not.toContain('devils_advocacy');
  });

  it('dominant driver without a decisive leader (sessionB2) ⇒ devils_advocacy, never consider_opposite', () => {
    const seen = lensesIn(SESSION_B2);
    expect(seen).toContain('devils_advocacy');
    expect(seen).not.toContain('consider_opposite');
  });

  it('the sequel stands down while consider_opposite is eligible (non-yielding head)', () => {
    // ⚠ SCOPE, stated because the stronger reading is the tempting one: what is
    // pinned here is that the sequence rule does not TAKE a slot
    // consider_opposite would otherwise have had — on THIS shape, where
    // consider_opposite is the ordinary runner-up. It is NOT a general "neither
    // DSK lens ever starves" claim: with a core lens eligible BETWEEN the two,
    // pre_mortem takes the slot and then contraindicates both exercises, so
    // consider_opposite goes unselected anyway. That is pristine behaviour,
    // unchanged by this rule — see the clause's comment in `lens-selector.ts`.
    //
    // The shape no live capture happens to contain, and the one the unnarrowed
    // sequence rule got wrong: sessionA's real bytes with the flip category
    // rewritten to `isolated` — a value taken from sessionB2's own capture, so
    // it is a vocabulary the producer really emits — which suppresses the
    // 2.211-① yield and leaves `sensitivity_flip_risk` as the head.
    const isolatedA = derived(SESSION_A, (e) => {
      for (const f of e.factor_sensitivity as Record<string, unknown>[]) {
        if (typeof f.flip_risk_category === 'string') f.flip_risk_category = 'isolated';
      }
    });
    expect(flipCategories(isolatedA)).toContain('isolated');

    // consider_opposite keeps the slot its own declared observable earned.
    const seen = lensesIn(isolatedA);
    expect(seen).toContain('consider_opposite');
    expect(seen).not.toContain('devils_advocacy');

    // …and this is NOT vacuous: devils' own trigger is satisfied on exactly
    // these bytes. Remove the ONE field consider_opposite additionally needs
    // (its positive robustness attestation) and devils takes the slot.
    expect(dominance(isolatedA)).not.toBeNull();
    const unattested = derived(isolatedA, (e) => {
      delete e.robustness;
    });
    const unattestedSeen = lensesIn(unattested);
    expect(unattestedSeen).toContain('devils_advocacy');
    expect(unattestedSeen).not.toContain('consider_opposite');
  });

  it('DSK-P-005 contraindication holds on every walk in this file', () => {
    // "Do not run immediately after a pre-mortem or disconfirmation exercise on
    // the same decision" — the fix must not buy reachability with a sequence
    // the bundle forbids.
    for (const capture of [SESSION_A, SESSION_B2]) {
      const seen = lensesIn(capture, 10);
      for (let i = 1; i < seen.length; i++) {
        if (seen[i] === 'devils_advocacy') {
          expect(seen[i - 1]).not.toBe('pre_mortem');
          expect(seen[i - 1]).not.toBe('consider_opposite');
        }
      }
    }
  });
});

// ============================================================================
// 4. THE DELIBERATELY OVERRIDDEN DSK-TR-005 CLAUSE
// ============================================================================

describe('ROADMAP 2.490 — TR-005s robustness clause is overridden, and only for devils', () => {
  it('devils_advocacy fires on an ATTESTED FRAGILE level — the override, on the record', () => {
    // DSK-TR-005 declares "...AND robustness != 'fragile'". sessionB2's level
    // IS fragile by the shared truth table, and the lens fires anyway. This is
    // deliberate: in this platform `robustness.level` is the leader's win
    // probability banded against 0.7, so on this session the field means "no
    // option clearly wins" — which says nothing about the dominant driver's
    // weighting, the thing DSK-P-005 actually challenges.
    expect(RAW_FRAGILE_LEVELS.has(robustnessLevel(SESSION_B2))).toBe(true);
    expect(lensesIn(SESSION_B2)).toContain('devils_advocacy');
  });

  it('the override did NOT leak into consider_opposite — its positive condition still gates', () => {
    // Discriminating control: same capture, same walk helper, the OTHER DSK
    // lens. Force sessionA's level to sessionB2's fragile value and
    // consider_opposite must disappear — proving hunk 2 removed one clause from
    // one evaluator rather than disabling fragility everywhere.
    expect(lensesIn(SESSION_A)).toContain('consider_opposite');
    const fragileA = derived(SESSION_A, (e) => {
      (e.robustness as Record<string, unknown>).level = robustnessLevel(SESSION_B2);
    });
    expect(lensesIn(fragileA)).not.toContain('consider_opposite');
  });
});

// ============================================================================
// 5. THE SHARED 2.211 PROMOTION ORDER CHANGED — evidenced as its own test
// ============================================================================

describe('ROADMAP 2.490 — pre_mortem loses the displaced-sensitivity slot when dominance holds', () => {
  /** sessionB2 with every influence score flattened to 1 — the ONE mechanical
   *  transform that removes the dominance (devils' only other input) while
   *  leaving option_comparison, confidence_tier and the flip evidence exactly
   *  as captured. */
  const B2_NO_DOMINANCE = derived(SESSION_B2, (e) => {
    for (const f of e.factor_sensitivity as Record<string, unknown>[]) {
      if (typeof f.influence_score === 'number') f.influence_score = 1;
    }
  });

  it('PREMISE — pre_mortem genuinely fires on this capture and WOULD take the slot', () => {
    // Without this the test below could pass because pre_mortem never
    // triggered at all — the displacement would be uncontested and the
    // promotion-order claim would be empty.
    expect(dominance(B2_NO_DOMINANCE)).toBeNull();
    const selection = selectLens(makeFact(B2_NO_DOMINANCE), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('pre_mortem');
  });

  it('THE ORDER CHANGE — with the dominance present, that slot goes to devils_advocacy', () => {
    const selection = selectLens(makeFact(SESSION_B2), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection!.lens).toBe('devils_advocacy');
    // …and pre_mortem is therefore absent from the whole cycle on this shape.
    // This is a change to LOCKED-ORDER machinery shared with the three core
    // lenses, ratified for 2.490: the exercise about the driver sensitivity
    // just named outranks the next ladder entry on a displaced sensitivity
    // head. Stated here so it is a decision on the record, not a side effect.
    expect(lensesIn(SESSION_B2)).not.toContain('pre_mortem');
  });

  it('and the change is bounded to a DISPLACED head — turn 1 is still sensitivity', () => {
    // devils' trigger is a strict SUBSET of sensitivity rule 1b's, so devils
    // can never win the head slot outright; it depends entirely on the
    // displacement. Proven on the turn with no previous lens.
    const firstTurn = selectLens(makeFact(SESSION_B2));
    expect(firstTurn).not.toBeNull();
    expect(firstTurn!.lens).toBe('sensitivity_flip_risk');
  });
});
