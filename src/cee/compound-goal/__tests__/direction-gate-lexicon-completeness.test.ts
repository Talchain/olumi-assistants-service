/**
 * ROADMAP 2.1051 — THE LEXICON COMPLETENESS SWEEP.
 *
 * ⚠⚠ WHY A UNION ASSERTION WAS NOT ENOUGH, AND THIS IS.
 *
 * The gate exports `NEGATION_SCREEN_RE` so a UNION assertion can prove
 * gate ⊇ extractor. Round-1 review found three live inversions anyway, and the
 * reason is the whole of trap 12d's second face: **a union proves AGREEMENT,
 * never COMPLETENESS.** `resist` was absent from the gate's `PREVENTION_SRC`
 * *and* from the extractor's `NEGATION_OR_PREVENTION_LEAD`, so the union
 * assertion was STRUCTURALLY BLIND to it — both lists were short in the same
 * place, and a derivation from either can only ever confirm the other.
 *
 * `shrink` was missing the same way on the movement side, and it cost an
 * inversion whose `falling` twin was handled correctly — the discriminating
 * pair that proves it was a defect and not noise.
 *
 * ⭐ THE ONLY INSTRUMENT THAT CAN NOTICE A SHORT LIST IS A CORPUS FROM OUTSIDE
 * THE LIST. So this file sweeps a vocabulary drawn from general business
 * English — deliberately written WITHOUT reading `direction-gate.ts` — through
 * a MINIMAL-VARIATION PROBE: one fixed sentence frame, one token swapped, the
 * end-to-end outcome asserted. That is the technique `extractor.ts`'s own
 * `CLAUSE_INTRODUCER` comment prescribes for exactly this failure mode, and it
 * is what found the five coordinators there.
 *
 * ⭐⭐ AND THE RESIDUE IS PINNED, NOT HIDDEN. Every verb the gate does NOT screen
 * sits in an explicit KNOWN set asserted with `.toEqual`, so the suite REDs if
 * the set GROWS (a regression) **or** SHRINKS (a fix nobody recorded). A gap
 * recorded in the suite is honest; a gap invisible to it is how four rounds of
 * this defect happened. Adding two words and declaring the class closed is
 * precisely what this file exists to prevent.
 *
 * ⚠⚠ THE PINNED SETS CONTAIN LIES, NOT DEGRADATIONS. Their names say so. A
 * member ships an INVERTED bound to a user — the opposite of what they wrote —
 * which is a strictly worse class than the `MUST_SURVIVE` pin's correct-row-
 * becomes-a-question. THE LIE CLASS THEREFORE DIES BY ENUMERATION, NOT BY
 * CONSTRUCTION: S3 blesses any sentence with no LISTED token, so the guarantee
 * is exactly as wide as these lists and no wider.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCompoundGoals } from '../../unified-pipeline/stages/repair/compound-goals.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const B1 = JSON.parse(
  readFileSync(resolve(HERE, '../../context-integrity/__tests__/fixtures/b1-growth.cold-read.json'), 'utf-8'),
) as { graph: { nodes: Array<{ id: string }> } };

function wireFor(brief: string): Array<{ node_id: string; operator: string; value: number }> {
  const ctx: any = {
    requestId: 'lexicon-sweep',
    effectiveBrief: brief,
    graph: { nodes: B1.graph.nodes.map((n) => ({ ...n })), edges: [] },
    goalConstraints: undefined,
    directionUnresolved: undefined,
  };
  runCompoundGoals(ctx);
  return (ctx.goalConstraints ?? []).map((c: any) => ({ node_id: c.node_id, operator: c.operator, value: c.value }));
}

/* =========================================================================
 * THE EXTERNAL VOCABULARY — written from general business English, not read
 * off the gate's own lists.
 * ======================================================================= */

/** Verbs for a metric moving DOWN. A bound below one of these is a FLOOR. */
const FALL_GERUNDS = [
  'falling', 'dropping', 'slipping', 'dipping', 'sinking', 'declining', 'decreasing',
  'sliding', 'shrinking', 'contracting', 'dwindling', 'eroding', 'deteriorating',
  'worsening', 'weakening', 'diminishing', 'lessening', 'sagging', 'softening',
  'tapering', 'reducing', 'plummeting', 'plunging', 'tumbling', 'collapsing',
  'crashing', 'retreating', 'receding', 'ebbing', 'waning', 'subsiding',
  'cratering', 'backsliding', 'degrading', 'regressing', 'going',
] as const;

/** Verbs of PREVENTION. A bound under one of these reverses. */
const PREVENTION_VERBS = [
  'Avoid', 'Prevent', 'Stop', 'Refuse', 'Protect', 'Guard', 'Resist', 'Block',
  'Forbid', 'Prohibit', 'Preclude', 'Disallow', 'Veto', 'Curb', 'Restrain',
  'Deny', 'Reject', 'Safeguard', 'Shield', 'Defend', 'Insulate', 'Avert',
  'Thwart', 'Foil', 'Hinder', 'Impede', 'Obstruct', 'Deter', 'Discourage',
  'Suppress', 'Contain', 'Check', 'Limit', 'Cap', 'Restrict', 'Minimise',
  'Counter', 'Oppose', 'Fight', 'Combat',
] as const;

/* =========================================================================
 * THE PINNED RESIDUE.
 *
 * Each entry is a verb the gate does NOT screen, with the reason it is parked.
 * `.toEqual` on the sorted list means this REDs on grow AND on shrink.
 * ======================================================================= */

/**
 * ⚠⚠ VERBS THAT SHIP AN INVERTED BOUND — i.e. A USER-VISIBLE FALSEHOOD.
 *
 * EMPTY, and measured — the round-1 sweep drove this to zero. It stays as a
 * pinned set rather than an inline `[]` so a verb slipping out of the lexicon
 * REDs here with its own name instead of quietly rejoining a gap. The sentinel
 * control below is what proves an empty result means "all covered" rather than
 * "the probe stopped looking".
 *
 * ⭐ THIS PIN IS A DIFFERENT AND STRICTLY WORSE SEVERITY CLASS THAN THE
 * `MUST_SURVIVE` PIN in `direction-gate-corpus.test.ts`, and the two must never
 * be read as the same kind of debt:
 *
 *   MUST_SURVIVE  = DEGRADATIONS. A correct row becomes a QUESTION. The user
 *                   loses convenience; the model stays honest.
 *   THIS SET      = LIES. A floor ships as a ceiling. The product states, at
 *                   0.85 confidence, the exact opposite of the user's limit,
 *                   and then penalises the options that honour it.
 *
 * A member here is a defect being tolerated, not a trade being made.
 */
const KNOWN_INVERTING_FALL_VERBS: readonly string[] = [];

/**
 * ⚠⚠ PREVENTION VERBS THAT SHIP AN INVERTED BOUND — TEN USER-VISIBLE FALSEHOODS.
 *
 * ⭐ READ THE SEVERITY BEFORE THE REASONS. Every member of this set means a
 * sentence like "Limit any move that takes NRR below 90%" reaches the wire as
 * `nrr <= 0.9` — a hard CEILING demanding the very collapse the user is trying
 * to prevent. This is NOT the `MUST_SURVIVE` class (a correct row becoming a
 * question); it is the lie class itself, enumerated and tolerated. Anyone
 * widening this set is admitting new falsehoods, not accepting new friction.
 *
 * They are tolerated for one reason only: at the merge-base every one of them
 * inverts too, so this PR is MONOTONE — it removes inversions and adds none —
 * and blocking a monotone improvement to finish enumerating is the treadmill
 * trap 22f exists to stop.
 *
 * WHY EACH IS STILL HERE:
 *   - `Cap`, `Check`, `Contain`, `Limit`, `Minimise`, `Restrict` are ALSO the
 *     vocabulary of a legitimate ceiling — "Cap spend at £5m", "Limit churn to
 *     4%". Screening them as prevention would withhold the very constraints they
 *     state: the 13-of-14 over-suppression the #888 review measured. Trading a
 *     rare lie for a common gap is not obviously right, so it waits for the
 *     structural fix rather than a lexicon judgement.
 *   - `Combat`, `Counter`, `Fight`, `Oppose` are rare in briefs and ambiguous as
 *     verbs. Parked as a judgement, not an oversight.
 *
 * ⭐ THE REAL FIX IS STRUCTURAL AND IS SEQUENCED SEPARATELY: making the
 * `keep X from <VERB> below|above N` frame VERB-AGNOSTIC closes the fall side
 * wholesale, because the PREPOSITION already carries the direction. That is what
 * "by construction" would actually look like here — removing the lexicon from
 * the decision rather than lengthening it.
 */
const KNOWN_INVERTING_PREVENTION_VERBS: readonly string[] = [
  'Cap', 'Check', 'Combat', 'Contain', 'Counter', 'Fight', 'Limit', 'Minimise',
  'Oppose', 'Restrict',
];

/**
 * A verb that is in NO lexicon anywhere — the sweep's positive control.
 *
 * An absence assertion needs a presence assertion or it is vacuous (trap 13).
 * With the fall set driven to empty, "no verb leaked" and "the probe cannot see
 * a leak" produce byte-identical output; this sentinel is the only thing that
 * tells them apart.
 */
const SENTINEL_UNKNOWN_FALL_VERB = 'zorbling';

describe('ROADMAP 2.1051 — lexicon completeness (external vocabulary sweep)', () => {
  it('COLLECTION GUARD: the external vocabulary is the declared size', () => {
    expect(FALL_GERUNDS.length).toBe(36);
    expect(PREVENTION_VERBS.length).toBe(40);
  });

  /* ---------------------------------------------------------------------
   * FALL SWEEP — "keep X from <VERB>ing below N" must never ship a ceiling.
   * ------------------------------------------------------------------- */
  it('FALL SWEEP: no movement verb in the external vocabulary ships an inverted ceiling', () => {
    const leaked: string[] = [];
    for (const v of FALL_GERUNDS) {
      const wire = wireFor(`We must keep cash runway from ${v} below 250000.`);
      if (wire.some((r) => r.node_id === 'fac_cash_runway' && r.operator === '<=')) leaked.push(v);
    }
    expect(
      [...leaked].sort(),
      'unscreened fall verbs must match the pinned set EXACTLY — grow or shrink both RED',
    ).toEqual([...KNOWN_INVERTING_FALL_VERBS].sort());
  });

  it('FALL SWEEP POSITIVE CONTROL: an unknown verb DOES leak, so the empty result means something', () => {
    // Without this, `KNOWN_INVERTING_FALL_VERBS = []` is satisfied equally well by a
    // gate that covers every verb and by a probe that observes nothing.
    const wire = wireFor(`We must keep cash runway from ${SENTINEL_UNKNOWN_FALL_VERB} below 250000.`);
    expect(
      wire.some((r) => r.node_id === 'fac_cash_runway' && r.operator === '<='),
      'the probe must be able to OBSERVE a leak, or the sweep above proves nothing',
    ).toBe(true);
  });

  it('FALL CONTROL: the covered verbs are genuinely covered, not vacuously clean', () => {
    // The discriminating half. Without it, a probe that emitted no rows for ANY
    // verb would satisfy the sweep above by testing nothing.
    for (const v of ['falling', 'shrinking', 'dropping', 'eroding']) {
      const wire = wireFor(`We must keep cash runway from ${v} below 250000.`);
      expect(wire.filter((r) => r.operator === '<='), `${v} must not ship a ceiling`).toEqual([]);
    }
    // …and a sentence with NO prevention framing still ships its plain ceiling,
    // proving the harness can produce a row at all.
    expect(
      wireFor('Keep marketing spend under 1500000.').some((r) => r.operator === '<='),
      'the harness must be able to emit a row, or every result above is vacuous',
    ).toBe(true);
  });

  /* ---------------------------------------------------------------------
   * PREVENTION SWEEP — "<VERB> any move that takes X above N" must never
   * ship a floor. Sign-symmetric twin below.
   * ------------------------------------------------------------------- */
  it('PREVENTION SWEEP (ceiling side): no screened verb ships an inverted floor', () => {
    const leaked: string[] = [];
    for (const v of PREVENTION_VERBS) {
      const wire = wireFor(`${v} any move that takes marketing spend above 2000000.`);
      if (wire.some((r) => r.node_id === 'fac_marketing_spend' && r.operator === '>=')) leaked.push(v);
    }
    expect(leaked.length, 'the probe must observe the parked leaks').toBeGreaterThan(0);
    expect([...leaked].sort()).toEqual([...KNOWN_INVERTING_PREVENTION_VERBS].sort());
  });

  it('PREVENTION SWEEP (floor side): the SAME verbs, the opposite direction', () => {
    // Trap 22b: a corpus that tests one direction is a guard watching one door.
    // The prevention screen is sign-symmetric by construction (S3 reads the
    // sentence, never the operator), so the leaked set must be IDENTICAL.
    const leaked: string[] = [];
    for (const v of PREVENTION_VERBS) {
      const wire = wireFor(`${v} any move that takes net revenue retention below 90%.`);
      if (wire.some((r) => r.node_id === 'fac_nrr' && r.operator === '<=')) leaked.push(v);
    }
    expect(
      [...leaked].sort(),
      'the screen must be sign-symmetric — a different set here means S3 has acquired a direction',
    ).toEqual([...KNOWN_INVERTING_PREVENTION_VERBS].sort());
  });

  /* ---------------------------------------------------------------------
   * THE THREE ROUND-1 INVERSIONS, PINNED BY NAME.
   * ------------------------------------------------------------------- */
  it('round-1 inversion 1: `keep X from shrinking below N` is a floor, never a ceiling', () => {
    const wire = wireFor('We must keep cash runway from shrinking below 250000.');
    expect(wire.filter((r) => r.operator === '<=')).toEqual([]);
  });

  it('round-1 inversion 1 TWIN: the `falling` form behaves identically', () => {
    const shrink = wireFor('We must keep cash runway from shrinking below 250000.');
    const fall = wireFor('We must keep cash runway from falling below 250000.');
    expect(shrink.map((r) => r.operator)).toEqual(fall.map((r) => r.operator));
  });

  it('round-1 inversion 2: `Resist any move that takes X above N` never ships a floor', () => {
    expect(wireFor('Resist any move that takes marketing spend above 2000000.')
      .filter((r) => r.operator === '>=')).toEqual([]);
  });

  it('round-1 inversion 3: `Resist any move that takes X below N` never ships a ceiling', () => {
    expect(wireFor('Resist any move that takes net revenue retention below 90%.')
      .filter((r) => r.operator === '<=')).toEqual([]);
  });

  it('the parked ceiling idioms still SHIP their ceilings — the reason they are parked', () => {
    // If these ever start withholding, the residue above stopped being a
    // deliberate trade and became the over-suppression it was parked to avoid.
    // NB: 'Cap X at N' / 'Limit X to N' mint NO row at all (a pre-existing
    // extractor gap, not a gate outcome), so the idioms asserted here are the
    // ones the extractor actually reads.
    for (const brief of ['Marketing spend is capped at 2000000.', 'Keep marketing spend under 2000000.']) {
      const wire = wireFor(brief);
      expect(wire.some((r) => r.operator === '<='), `"${brief}" must still ship its ceiling`).toBe(true);
    }
  });
});
