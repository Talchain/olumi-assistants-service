/**
 * RED-first spec for the GROUNDED sensitivity body (Lane C).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FIXES, MEASURED.
 *
 * `sensitivity_flip_risk` is the lens 40 of 45 real banked runs actually
 * select. Its entire user-facing surface is one coaching block (it declares NO
 * companion exercise — `phase3-blocks.ts`, the `return []` arm), whose body is
 * a CONSTANT from `BODY_BY_RATIONALE` keyed by rationale code. Measured across
 * the 45 captures: 1 distinct title, 2 distinct bodies.
 *
 * And the copy that reaches 38 of those 40 runs opens:
 *
 *     "THIS FACTOR moves the result more than any other."
 *
 * — a deictic with NO ANTECEDENT. The product points at a factor and never
 * says which one, while `factor_sensitivity[].factor_label` carries the name on
 * 40/40 of those same runs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ THE CLAIM BOUNDARY, AND IT IS THE WHOLE DESIGN. This module RESOLVES A
 * PRONOUN. It adds no proposition: every grounded body asserts exactly what the
 * constant asserted, with the referent made explicit. So there is no new claim
 * to license — no leading option, no magnitude, and critically NO FLIP VERB on
 * the `_NO_FLIP` codes, which are the ONLY two codes real traffic produces
 * (`SENSITIVITY_ISOLATED_NO_FLIP` 38, `DOMINANT_DRIVER_NO_FLIP` 2). Those runs
 * carry a positive producer attestation that nothing can move the winner; a
 * grounded body that reintroduced "could flip" would be false on precisely the
 * traffic it ships to.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { BODY_BY_RATIONALE } from '../../compose/lens-selector.js';
import { COACHING_BLOCK_BODY_MAX } from '../fragile-edge-offer-text.js';
import { buildLensSurface } from '../../compose/phase3-blocks.js';
import {
  GROUNDED_SENSITIVITY_BODY_MAX,
  selectGroundedSensitivityBody,
} from '../grounded-sensitivity-body.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', '..', 'compose', '__tests__', 'fixtures', 'dsk-walk');

function liveEnrichment(name: 'session-a' | 'session-b2'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.enrichment.json`), 'utf8'));
}

/**
 * ⚠ THIS HELPER WAS THE DEFECT IN MINIATURE (CEE #933 review).
 *
 * It was named `topFactorId`, documented "top-influence row", and returned
 * `rows[0]` — ARRAY ORDER. On `session-a` that is rank 4 of 4, roughly 104x
 * less influential than rank 1. A corpus helper that encodes the same wrong
 * assumption as the code cannot see the code's defect (CLAUDE.md trap 13d).
 *
 * It now derives the answer from the PRODUCER's `influence_rank`, which is the
 * same oracle the module itself must satisfy.
 */
function topFactorRow(en: Record<string, unknown>): { factor_id: string; factor_label: string } {
  const rows = en.factor_sensitivity as {
    factor_id: string;
    factor_label: string;
    influence_rank?: number;
  }[];
  const top = rows.reduce((a, b) => ((a.influence_rank ?? 999) <= (b.influence_rank ?? 999) ? a : b));
  return top;
}
function topFactorId(en: Record<string, unknown>): string {
  return topFactorRow(en).factor_id;
}
function topFactorLabel(en: Record<string, unknown>): string {
  return topFactorRow(en).factor_label;
}

describe('selectGroundedSensitivityBody — it names the factor', () => {
  it('resolves the deictic on the code 38/40 of real runs use', () => {
    const en = liveEnrichment('session-a');
    const id = topFactorId(en);
    const label = topFactorLabel(en);

    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', id, en);

    expect(r.refusalReason).toBeNull();
    expect(r.grounded).not.toBeNull();
    // Identity binding (trap 19): the producer's own label for the SUBJECT id,
    // never "some factor whose influence is highest" — another row could
    // satisfy a value predicate after a producer re-order.
    expect(r.grounded!.factorId).toBe(id);
    expect(r.grounded!.factorLabel).toBe(label);
    expect(r.grounded!.body).toContain(label);

    // ⭐ THE ANTECEDENT IS GONE, not merely supplemented. A body that appended
    // the label while keeping "This factor" would pass a `toContain` check and
    // still ship the unresolved deictic.
    expect(r.grounded!.body.startsWith('This factor')).toBe(false);
  });

  it('⭐ ANTI-TEMPLATE: two different live runs yield different bodies', () => {
    const a = liveEnrichment('session-a');
    const b = liveEnrichment('session-b2');
    const ra = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', topFactorId(a), a);
    const rb = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', topFactorId(b), b);

    expect(ra.grounded).not.toBeNull();
    expect(rb.grounded).not.toBeNull();
    expect(rb.grounded!.body).not.toBe(ra.grounded!.body);
    expect(ra.grounded!.body).not.toContain(topFactorLabel(b));
  });

  it('grounds the other real-traffic code too', () => {
    const en = liveEnrichment('session-a');
    const r = selectGroundedSensitivityBody('DOMINANT_DRIVER_NO_FLIP', topFactorId(en), en);
    expect(r.grounded).not.toBeNull();
    expect(r.grounded!.body).toContain(topFactorLabel(en));
    expect(r.grounded!.body.startsWith('One factor')).toBe(false);
  });
});

describe('selectGroundedSensitivityBody — the claim boundary', () => {
  /**
   * The load-bearing honesty test. `_NO_FLIP` bodies exist because the run's own
   * evidence proves no factor can move the WINNER. The grounded body must keep
   * that framing intact — it may name the subject, never re-open the ranking.
   */
  it.each(['SENSITIVITY_ISOLATED_NO_FLIP', 'DOMINANT_DRIVER_NO_FLIP'] as const)(
    '%s introduces no flip verb',
    (code) => {
      const en = liveEnrichment('session-a');
      const r = selectGroundedSensitivityBody(code, topFactorId(en), en);
      expect(r.grounded).not.toBeNull();
      expect(r.grounded!.body).not.toMatch(/\bflip\b/i);
    },
  );

  it('POSITIVE CONTROL: the flip-verb probe genuinely fires on a flip body', () => {
    // Without this the assertion above could pass because the regex is inert.
    expect(BODY_BY_RATIONALE.FLIP_RISK_ISOLATED).toMatch(/\bflip\b/i);
  });

  it('adds no proposition — the grounded body preserves the constant\'s tail verbatim', () => {
    const en = liveEnrichment('session-a');
    const code = 'SENSITIVITY_ISOLATED_NO_FLIP';
    const r = selectGroundedSensitivityBody(code, topFactorId(en), en);
    // Everything after the substituted opening clause is the producer-reviewed
    // sentence, byte-for-byte. This is what makes "resolves a pronoun, adds no
    // claim" a checkable property rather than a stated intention.
    const tail = BODY_BY_RATIONALE[code].slice('This factor moves the result more than any other.'.length);
    expect(r.grounded!.body.endsWith(tail)).toBe(true);
  });

  it('names no option and no number', () => {
    const en = liveEnrichment('session-a');
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', topFactorId(en), en);
    expect(r.grounded!.body).not.toMatch(/\d/);
  });
});

describe('selectGroundedSensitivityBody — the honest empties', () => {
  it('refuses when the lens carried no subject factor', () => {
    const en = liveEnrichment('session-a');
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', null, en);
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('no_subject_factor');
  });

  it('refuses when the subject id resolves to no labelled row', () => {
    const en = liveEnrichment('session-a');
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', 'fac_not_present', en);
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('no_factor_label');
  });

  it('refuses a rationale code that declares no grounded form', () => {
    const en = liveEnrichment('session-a');
    const r = selectGroundedSensitivityBody('CONFIDENCE_NEEDS_WORK', topFactorId(en), en);
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('no_grounded_form');
  });

  it('refuses an ungroundable label rather than shipping it', () => {
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', 'fac_x', {
      factor_sensitivity: [
        { factor_id: 'fac_x', factor_label: 'Margin above 0.78 threshold', influence_rank: 1 },
      ],
    });
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('not_composable');
  });

  it('refuses a label long enough to breach the body cap', () => {
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', 'fac_x', {
      factor_sensitivity: [{ factor_id: 'fac_x', factor_label: 'L'.repeat(300), influence_rank: 1 }],
    });
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('not_composable');
  });
});

/** The category each declared sentence asserts, so a probe can satisfy its gate. */
const SUBSTITUTION_EXPECTATIONS: Record<string, { category: string }> = {
  FLIP_RISK_ISOLATED: { category: 'isolated' },
  FLIP_RISK_CORRELATED: { category: 'correlated' },
  DOMINANT_DRIVER: { category: 'isolated' },
  SENSITIVITY_ISOLATED_NO_FLIP: { category: 'isolated' },
  DOMINANT_DRIVER_NO_FLIP: { category: 'isolated' },
};

describe('selectGroundedSensitivityBody — drift guard on the borrowed copy', () => {
  /**
   * ⚠ THE ANTI-MIRROR GUARD. The substitution is expressed as an EXPECTED
   * OPENING CLAUSE plus its grounded replacement. If someone edits
   * `BODY_BY_RATIONALE` — which lives in another module and is reviewed on its
   * own terms — the expected clause stops matching and this module REFUSES
   * (falling back to the constant) instead of silently grounding the wrong
   * sentence or mangling a rewritten one.
   *
   * This test is the LOUD half: at rest, every declared code must still match
   * its constant, so a copy edit turns this RED rather than turning the feature
   * quietly off in production.
   */
  it('every declared substitution still matches its constant', () => {
    const declared = [
      'FLIP_RISK_ISOLATED',
      'FLIP_RISK_CORRELATED',
      'DOMINANT_DRIVER',
      'SENSITIVITY_ISOLATED_NO_FLIP',
      'DOMINANT_DRIVER_NO_FLIP',
    ] as const;
    for (const code of declared) {
      // Each code is asked with a subject satisfying BOTH producer gates, so the
      // only refusal this can surface is copy drift — which is what this test is
      // for. Asserting `refusalReason === null` would conflate a copy edit with
      // a rank/category mismatch and send the next reader to the wrong file.
      const sub = SUBSTITUTION_EXPECTATIONS[code]!;
      const r = selectGroundedSensitivityBody(code, 'fac_probe', {
        factor_sensitivity: [
          {
            factor_id: 'fac_probe',
            factor_label: 'Probe Factor',
            influence_rank: 1,
            flip_risk_category: sub.category,
          },
        ],
      });
      expect(r.refusalReason, `${code} no longer matches its constant`).not.toBe('copy_drifted');
      expect(r.grounded, `${code} produced no grounded body`).not.toBeNull();
    }
  });

  /**
   * ⚠ A PRE-EXISTING DEFECT THIS LANE FOUND AND DID NOT PAPER OVER.
   *
   * `SENSITIVITY_CORRELATED_NO_FLIP`'s constant is **312 characters** — already
   * ABOVE the 300-char `BODY_MAX`, so `phase3-blocks.ts` truncates it in
   * production TODAY, mid-sentence. Grounding makes it longer still, so this
   * module refuses it on the cap and the caller keeps the (truncated) constant:
   * behaviour is byte-identical to today for that code.
   *
   * The refusal is PINNED here rather than routed around, because the tempting
   * "fix" is to raise this module's cap — which would ship a body the block then
   * truncates, moving the damage instead of removing it. The copy itself lives
   * in `compose/lens-selector.ts` and is reviewed on its own terms; shortening
   * it is a copy change for that owner, and it is reported, not smuggled.
   *
   * It never fired in the 45-capture census, so nothing user-visible turns on it.
   * This test REDs if the constant is shortened — at which point the code can
   * simply be added to the list above.
   */
  it('SENSITIVITY_CORRELATED_NO_FLIP refuses: its constant already exceeds BODY_MAX', () => {
    const en = liveEnrichment('session-a');
    expect(BODY_BY_RATIONALE.SENSITIVITY_CORRELATED_NO_FLIP.length).toBeGreaterThan(
      GROUNDED_SENSITIVITY_BODY_MAX,
    );
    const r = selectGroundedSensitivityBody('SENSITIVITY_CORRELATED_NO_FLIP', topFactorId(en), en);
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('not_composable');
  });

  /**
   * ⚠ THIS USED TO READ `toBeLessThanOrEqual(300)`, WHICH WOULD HAVE SURVIVED
   * THE OWNER SHRINKING THE CONSTANT TO 250 — it looked like the guarantee
   * while contributing nothing. The real protection is the nine behavioural
   * failures a shrink causes; this now pins the BINDING itself.
   */
  it('the cap IS the owner\'s constant — not a copy that happens to match', () => {
    expect(GROUNDED_SENSITIVITY_BODY_MAX).toBe(COACHING_BLOCK_BODY_MAX);
  });
});

// ============================================================================
// ⭐ THE WIRING PROOF.
//
// Last round's lesson, applied before it could bite again: a unit-tested pure
// module is worth nothing if the call site never reaches it, and every
// pre-existing suite can stay green while the new branch is dead. So the
// emitted BLOCK is asserted here, through the real `buildLensSurface`, on a
// committed LIVE capture — not on a fixture this lane authored.
// ============================================================================

describe('wiring — the emitted coaching block names the factor', () => {
  const CTX = {
    created_at: '2026-08-13T00:00:00.000Z',
    graph_hash_at_generation: 'gh_a1b2c3d4e5f60001',
  };

  function factFrom(en: Record<string, unknown>): RunAnalysisHandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-test',
        leading_option_id: 'opt_a',
        summary: 'Ran analysis.',
        graph_hash_at_run: CTX.graph_hash_at_generation,
        enrichment: en,
      },
    } as unknown as RunAnalysisHandlerFact;
  }

  it('ARM 1 — a live capture selecting this lens ships the factor by name', () => {
    const en = liveEnrichment('session-b2');
    const surface = buildLensSurface(factFrom(en), CTX as never, null);

    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('sensitivity_flip_risk');

    // The subject the selector chose, resolved to the producer's own label.
    const subjectId = surface!.selection.subjectRef!.id;
    const row = (en.factor_sensitivity as { factor_id: string; factor_label: string }[]).find(
      (r) => r.factor_id === subjectId,
    )!;

    // Identity-bound: the label of the SUBJECT the selector named.
    expect(surface!.suggestion.body).toContain(row.factor_label);
    // …and the unresolved deictic is gone.
    expect(surface!.suggestion.body).not.toContain('a single factor that could tip');
  });

  it('ARM 2 — an enrichment with no labelled subject falls back to today\'s copy', () => {
    // Same capture, labels stripped: the selector still fires (it reads
    // flip_risk_category, not the label), so this isolates the GROUNDING.
    const en = liveEnrichment('session-b2');
    const stripped = {
      ...en,
      factor_sensitivity: (en.factor_sensitivity as Record<string, unknown>[]).map((r) => {
        const { factor_label: _drop, ...rest } = r;
        return rest;
      }),
    };
    const surface = buildLensSurface(factFrom(stripped), CTX as never, null);

    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('sensitivity_flip_risk');
    // Degrades to the constant — never to a worse sentence, never to no card.
    expect(surface!.suggestion.body).toBe(BODY_BY_RATIONALE[surface!.selection.rationaleCode]);
  });
});

describe('drift guard — the RUNTIME refusal arm, exercised', () => {
  /**
   * ⭐ THIS TEST EXISTS BECAUSE A MUTANT SURVIVED.
   *
   * Deleting the `startsWith` check left all 18 tests green: at rest every
   * declared opening matches, so the guard's refusal arm was unreachable and
   * therefore unverified — the module claimed "fail-safe at runtime" on the
   * strength of a branch nothing executed. Measured, not assumed.
   *
   * Injecting a DRIFTED copy bank exercises it: the constant no longer starts
   * with the declared opening, so the module must refuse rather than ground a
   * sentence it no longer recognises (or splice a clause onto the wrong tail).
   */
  it('refuses when the borrowed copy no longer starts with the declared opening', () => {
    const en = liveEnrichment('session-a');
    const drifted = {
      ...BODY_BY_RATIONALE,
      SENSITIVITY_ISOLATED_NO_FLIP: 'Someone rewrote this sentence entirely.',
    };

    const r = selectGroundedSensitivityBody(
      'SENSITIVITY_ISOLATED_NO_FLIP',
      topFactorId(en),
      en,
      drifted,
    );

    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('copy_drifted');
  });

  it('POSITIVE CONTROL: the same call grounds against the undrifted bank', () => {
    // Proves the refusal above is the DRIFT, not the injection mechanism —
    // without this, a seam that always refused would look like a working guard.
    const en = liveEnrichment('session-a');
    const r = selectGroundedSensitivityBody(
      'SENSITIVITY_ISOLATED_NO_FLIP',
      topFactorId(en),
      en,
      BODY_BY_RATIONALE,
    );
    expect(r.refusalReason).toBeNull();
    expect(r.grounded).not.toBeNull();
  });
});

// ============================================================================
// ⭐⭐ THE SELECTOR/SENTENCE MISMATCH — CEE #933 review.
//
// THE GENERAL LESSON, because it outlives this bug: GROUNDING A TEMPLATE
// PROMOTES EVERY LATENT SELECTION DEFECT INTO AN EXPLICIT CLAIM. Vague copy
// quietly tolerated a wrong subject; specific copy asserts it. When you replace
// a deictic with a name you inherit responsibility for the correctness of every
// input the vague version was tolerating — check the SELECTOR before the
// SENTENCE.
//
// The concrete mismatch: `evaluateSensitivityFlipRisk` picks its subject with
// `.find(f => f.flipRiskCategory === 'isolated')` — a FLIPPABILITY category, on
// the FIRST array match. `SENSITIVITY_ISOLATED_NO_FLIP` asserts "moves the
// result more than any other" — a MAGNITUDE SUPERLATIVE. Different properties.
//
// ⚠ THE ORACLE IS THE PRODUCER'S `influence_rank`, NOT THE SELECTION. Deriving
// the expectation from the selection under test is why a `.find`→`.findLast`
// mutant survived 34 green tests (trap 13c: a mutant kit measures whether a
// test can DETECT a change, never whether the EXPECTATION is right).
// ============================================================================

const WITNESS_2267 = JSON.parse(
  readFileSync(
    join(HERE, '..', '..', '..', '..', 'tests', 'fixtures', 'cross-service', 'witness-2267-attested-no-flip.json'),
    'utf8',
  ),
) as { runs: Record<string, { factor_sensitivity: FactorRow[] }> };

interface FactorRow {
  readonly factor_id: string;
  readonly factor_label: string;
  readonly influence_rank?: number;
  readonly influence_score?: number;
  readonly flip_risk_category?: string;
}

/** Reproduces the live selector's pick — first array match on the category. */
function selectorPick(rows: readonly FactorRow[]): FactorRow {
  return rows.find((f) => f.flip_risk_category === 'isolated')!;
}
/** The PRODUCER's answer to "which factor moves the result most?" */
function producerTopInfluence(rows: readonly FactorRow[]): FactorRow {
  return rows.reduce((a, b) => ((a.influence_rank ?? 999) <= (b.influence_rank ?? 999) ? a : b));
}

describe('the sentence asserts a superlative — so the subject must BE the superlative', () => {
  it('POSITIVE CONTROL: run r3 is genuinely a mismatch (selector pick is not rank 1)', () => {
    const rows = WITNESS_2267.runs.r3!.factor_sensitivity;
    const picked = selectorPick(rows);
    const top = producerTopInfluence(rows);

    // The oracle, referenced explicitly — the producer's own rank field.
    expect(top.influence_rank).toBe(1);
    expect(picked.influence_rank).toBeGreaterThan(1);
    expect(picked.factor_id).not.toBe(top.factor_id);
  });

  it('REFUSES rather than asserting a false superlative about a lower-ranked factor', () => {
    const rows = WITNESS_2267.runs.r3!.factor_sensitivity;
    const picked = selectorPick(rows);

    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', picked.factor_id, {
      factor_sensitivity: rows,
    });

    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('subject_not_top_influence');
  });

  it('GROUNDS when the selector\'s pick IS the producer\'s rank-1 factor', () => {
    // Discriminating twin: same code, same shape, subject that satisfies the
    // superlative. Without this, the refusal above could be the module simply
    // never grounding this code.
    const rows = WITNESS_2267.runs.r2!.factor_sensitivity;
    const picked = selectorPick(rows);
    const top = producerTopInfluence(rows);

    expect(picked.factor_id).toBe(top.factor_id);
    expect(top.influence_rank).toBe(1);

    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', picked.factor_id, {
      factor_sensitivity: rows,
    });

    expect(r.refusalReason).toBeNull();
    expect(r.grounded!.factorLabel).toBe(top.factor_label);
    expect(r.grounded!.body).toContain(top.factor_label);
  });

  it('refuses when the producer supplied no influence_rank to check against', () => {
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', 'fac_x', {
      factor_sensitivity: [{ factor_id: 'fac_x', factor_label: 'Some Factor' }],
    });
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('no_influence_rank');
  });

  it('codes whose sentence asserts NO superlative are unaffected', () => {
    // FLIP_RISK_CORRELATED names the subject as a MEMBER of a combination, so a
    // lower-ranked subject is not a false claim and must still ground.
    const rows = WITNESS_2267.runs.r3!.factor_sensitivity;
    const lowRanked = rows.find((f) => (f.influence_rank ?? 0) > 1)!;
    const r = selectGroundedSensitivityBody('FLIP_RISK_CORRELATED', lowRanked.factor_id, {
      factor_sensitivity: rows,
    });
    expect(r.refusalReason).toBeNull();
    expect(r.grounded!.body).toContain(lowRanked.factor_label);
  });
});

describe('INVARIANT — no false superlative can reach the wire, whatever the selector does', () => {
  /**
   * ⭐ THE ORACLE IS THE PRODUCER, NOT THE SELECTION.
   *
   * The wiring proofs above derive their expectation from `selection.subjectRef`
   * — the very thing under test — which is why swapping the evaluator's `.find`
   * for `.findLast` left 34 tests green (trap 13c). This invariant closes that:
   * it asks the PRODUCER which factor ranks first, and asserts the shipped body
   * either names THAT factor or names none at all.
   *
   * Any future change to `evaluateSensitivityFlipRisk`'s subject that ships a
   * magnitude superlative about a lower-ranked factor turns this RED.
   */
  const SUPERLATIVE_CODES = new Set(['SENSITIVITY_ISOLATED_NO_FLIP', 'DOMINANT_DRIVER_NO_FLIP']);

  it.each(['session-a', 'session-b2'] as const)(
    '%s: a superlative body names the producer rank-1 factor, or no factor',
    (name) => {
      const en = liveEnrichment(name);
      const fact = {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: 'scen-test',
          leading_option_id: 'opt_a',
          summary: '',
          graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
          enrichment: en,
        },
      } as unknown as RunAnalysisHandlerFact;

      const surface = buildLensSurface(
        fact,
        { created_at: '2026-08-13T00:00:00.000Z', graph_hash_at_generation: 'gh_a1b2c3d4e5f60001' } as never,
        null,
      );
      if (surface === null || surface.selection.lens !== 'sensitivity_flip_risk') return;
      if (!SUPERLATIVE_CODES.has(surface.selection.rationaleCode)) return;

      const rows = en.factor_sensitivity as {
        factor_id: string;
        factor_label: string;
        influence_rank?: number;
      }[];
      const top = topFactorRow(en);
      const body = surface.suggestion.body ?? '';

      // Producer-derived oracle, referenced explicitly.
      expect((top as { influence_rank?: number }).influence_rank).toBe(1);

      for (const row of rows) {
        if (row.factor_id === top.factor_id) continue;
        expect(
          body.includes(row.factor_label),
          `shipped a superlative naming ${row.factor_label} (rank ${row.influence_rank}) over rank-1 ${top.factor_label}`,
        ).toBe(false);
      }
    },
  );
});

describe('requiresCategory — honesty in the SECOND dimension the selector controls', () => {
  /**
   * ⭐ THE LANDMINE THIS DEFUSES.
   *
   * `requiresTopInfluence` makes the superlative sentences honest no matter
   * WHICH factor a selector picks. Three codes assert something different — a
   * FLIP-RISK CATEGORY — and for those, honesty still depended on the selector
   * picking within the category the sentence names. Nothing pinned that.
   *
   * It is unreachable TODAY only because each of those codes is selected BY the
   * very category it asserts. That is a property of today's PREDICATES, not of
   * the contract — so a future selector change touching the CATEGORY predicates
   * (rather than their ordering) would make these three sentences lie with no
   * gate and no test. Deferring the selector decision is sound; handing its next
   * owner a trap is not.
   *
   * Verified exactly as `requiresTopInfluence` is: against the producer's own
   * `flip_risk_category`, never against the selection.
   */
  const NEGLIGIBLE_ROWS = [
    {
      factor_id: 'fac_req_change',
      factor_label: 'Requirements Change Rate',
      influence_rank: 1,
      flip_risk_category: 'negligible',
    },
    {
      factor_id: 'fac_iso',
      factor_label: 'Genuinely Isolated Factor',
      influence_rank: 2,
      flip_risk_category: 'isolated',
    },
  ];

  it('refuses a flippability sentence about a factor the producer calls negligible', () => {
    const r = selectGroundedSensitivityBody('FLIP_RISK_ISOLATED', 'fac_req_change', {
      factor_sensitivity: NEGLIGIBLE_ROWS,
    });
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('subject_category_mismatch');
  });

  it('DISCRIMINATING TWIN: grounds when the producer agrees the factor is isolated', () => {
    const r = selectGroundedSensitivityBody('FLIP_RISK_ISOLATED', 'fac_iso', {
      factor_sensitivity: NEGLIGIBLE_ROWS,
    });
    expect(r.refusalReason).toBeNull();
    expect(r.grounded!.body).toContain('Genuinely Isolated Factor');
  });

  it('refuses a combination sentence about a factor the producer calls isolated', () => {
    const r = selectGroundedSensitivityBody('FLIP_RISK_CORRELATED', 'fac_iso', {
      factor_sensitivity: NEGLIGIBLE_ROWS,
    });
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('subject_category_mismatch');
  });

  it('refuses when the producer supplied no category to check against', () => {
    const r = selectGroundedSensitivityBody('FLIP_RISK_ISOLATED', 'fac_x', {
      factor_sensitivity: [{ factor_id: 'fac_x', factor_label: 'No Category', influence_rank: 1 }],
    });
    expect(r.grounded).toBeNull();
    expect(r.refusalReason).toBe('no_flip_risk_category');
  });

  it('codes asserting NO category are unaffected by the producer category', () => {
    // SENSITIVITY_ISOLATED_NO_FLIP asserts a magnitude superlative and says
    // nothing about flippability — its own `_NO_FLIP` remap exists BECAUSE the
    // run's evidence contradicts flippability. A `negligible` rank-1 factor is
    // therefore a perfectly honest subject for it.
    const r = selectGroundedSensitivityBody('SENSITIVITY_ISOLATED_NO_FLIP', 'fac_req_change', {
      factor_sensitivity: NEGLIGIBLE_ROWS,
    });
    expect(r.refusalReason).toBeNull();
    expect(r.grounded!.body).toContain('Requirements Change Rate');
  });
});
