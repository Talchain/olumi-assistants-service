/**
 * DSK grounding policy — ROADMAP 2.491 (closing the 2.456 omitted-id hole).
 *
 * ## RED-first at pristine (f4b4d879) — STATED HONESTLY, CORRECTED
 *
 * ⚠ This docblock previously claimed each assertion below fails with
 * `expected undefined to be 'general'`. **That was false.** At pristine this
 * file does not COLLECT at all — `Cannot find module '…/dsk-grounding-policy
 * .js'`, **zero tests run**. A module-not-found is the weakest possible red:
 * it shows the file is new, not that any assertion binds to behaviour.
 *
 * **The real RED-first control for this feature is the sibling file**
 * `orchestrator-v5/coaching/__tests__/decision-review-enricher.dsk-grounding
 * .test.ts`, which imports no new module and therefore runs at pristine: 1 of
 * its 3 cases fails, with `expected undefined to be 'attested'`. The other two
 * (a precondition check and the fail-closed control) pass at pristine, as
 * controls should — they describe behaviour this change does not alter.
 *
 * The product-level statement of the defect: an entry with no `dsk_claim_id`
 * left the enricher carrying only `{question, principle, applies_because}` —
 * no verdict, no marker — and reached the user indistinguishable from an
 * attested prompt except by the SILENCE of the grounding badge.
 *
 * ## Coverage caveat, disclosed
 *
 * The named typecheck gate (`tsc -p tsconfig.build.json`) EXCLUDES test files,
 * so this file is type-checked only by the non-required drift ratchet.
 *
 * ## The oracle (trap 13c — derived from the producer, not from our reading)
 *
 * The expectations here are derived from the PRODUCER's declared semantics at
 * the bytes, not from what the field "ought" to mean:
 *   - `Prompts/canonical/decision_review.txt`: *"a finding matching a listed
 *     claim MUST carry dsk_claim_id and evidence_strength copied exactly"*,
 *     *"dsk_protocol_id copied exactly from it"*, *"When unsure, omit the claim
 *     fields"*, *"A dsk_claim_id that is not listed … the whole response is
 *     rejected"*.
 *   - `science-claims.ts`: injects EVERY `DSK-T-*` claim with its exact title,
 *     so a title the model echoes verbatim is a row it demonstrably selected.
 *
 * ## Trap 12d — BOTH kinds of guard, because neither can do the other's job
 *
 *   - DERIVED (§"every bundle claim resolves"): iterates the real bundle, so a
 *     consumer can never drift from it. Structurally BLIND to a missing claim.
 *   - HAND-WRITTEN CORPUS (§"live wire corpus"): the five principle strings
 *     actually measured on staging, verdicts written out. This is the only
 *     guard that can notice the bundle is SHORT.
 * Ship both; dropping either loses a whole defect class.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * ⚠ `importOriginal`-SPREAD, NOT a replacement factory (trap 12).
 *
 * A bare `vi.mock(path, () => ({ config: {...} }))` REPLACES the module. The
 * real `config/index.js` exports ~20 named symbols and `dsk-loader.ts:21`
 * imports `config` from it — so a two-key replacement is one import away from
 * a collection-time failure, which is exactly how 51 tests went dark in this
 * repo once before. Spreading the original keeps every other export intact and
 * overrides only the flags this suite needs.
 */
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return {
    ...actual,
    config: { ...actual.config, features: { ...actual.config.features, dskEnabled: true, dskV0: false } },
  };
});

import { loadDskBundle, getAllByType, getClaimById, _resetDskBundle } from '../../../orchestrator/dsk-loader.js';
import type { DSKClaim } from '../../../dsk/types.js';
import {
  applyDskGroundingPolicy,
  buildTechniqueTitleIndex,
  DSK_GROUNDING_KEY,
} from '../dsk-grounding-policy.js';

/** The REAL shipped bundle — not a fixture, not a mirror. */
let techniqueClaims: DSKClaim[];

beforeAll(() => {
  _resetDskBundle();
  loadDskBundle();
  techniqueClaims = (getAllByType('claim') as DSKClaim[]).filter((c) =>
    c.id.startsWith('DSK-T-'),
  );
  // Precondition for EVERY test below: the bundle actually loaded. Without
  // this the policy short-circuits to passthrough and every "is marked"
  // assertion would fail loudly — but every "is NOT marked" assertion would
  // pass VACUOUSLY. Pin it once, here.
  expect(techniqueClaims.length).toBeGreaterThan(0);
});

const verdict = (e: Record<string, unknown>): unknown => e[DSK_GROUNDING_KEY];
const claimIdsInBundle = (): string[] => (getAllByType('claim') as DSKClaim[]).map((c) => c.id);

/**
 * The validator must agree with `getClaimById` — the function whose semantics
 * the documented boundary is written in — for every id in the bundle AND for
 * ids outside it. The policy uses a derived Set for O(1) lookup rather than
 * calling `getClaimById` per entry; this pins that the optimisation did not
 * change the boundary. A union assertion, per trap 12d.
 */
describe('the id validator agrees with getClaimById, in both directions', () => {
  it('accepts exactly the ids getClaimById resolves', () => {
    const probes = [...claimIdsInBundle(), 'DSK-T-999', 'DSK-B-999', '', 'DSK-T-002 ', 'dsk-t-002'];
    for (const id of probes) {
      const resolves = getClaimById(id) !== undefined;
      const { stats } = applyDskGroundingPolicy([
        { question: 'q', principle: 'An improvised heuristic', dsk_claim_id: id },
      ]);
      // `unverified` fires iff the id was present and did NOT resolve.
      const treatedAsValid = stats.attested === 1;
      expect(treatedAsValid, `disagreement on ${JSON.stringify(id)}`).toBe(resolves);
    }
  });
});

// ============================================================================
// The stated policy, total over the input space — 2.456's asymmetry, closed
// ============================================================================

describe('the asymmetry is closed: no input is left unverdicted', () => {
  /**
   * What would have to be true for this guard to PASS while the property
   * FAILS? Only if `dsk_grounding` were set to a constant for every entry —
   * which the per-arm value assertions below rule out, and which the
   * discriminating mutant pair proves cannot happen silently.
   */
  it('assigns exactly one verdict to every entry across all three admissible arms', () => {
    const { prompts, stats } = applyDskGroundingPolicy([
      // arm 1 — model cited
      { question: 'q1', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
      // arm 2 — id omitted, principle IS a bundle claim title
      { question: 'q2', principle: 'Pre-mortem and prospective hindsight' },
      // arm 3 — id omitted, principle is a paraphrase of one
      { question: 'q3', principle: 'Outside view' },
    ]);

    expect(prompts.map(verdict)).toEqual(['attested', 'resolved', 'general']);
    expect(stats).toEqual({
      attested: 1,
      resolved: 1,
      general: 1,
      unverified: 0,
      nonTechniqueAttested: 0,
      skipped: false,
    });
    // Not one entry escapes a verdict — the 2.456 hole, stated as an assertion.
    expect(prompts.every((p) => typeof verdict(p) === 'string')).toBe(true);
  });

  /**
   * ⚠ THIS TEST REPLACES ONE THAT ASSERTED THE OPPOSITE AND WAS WRONG.
   *
   * The original asserted `DSK-T-999` passes through as `attested`, on the
   * stated ground that `shape-check.ts` hard-rejects unknown ids before egress.
   * That premise is FALSE on the live path — complete manifest:
   * `performShapeCheck` is called only from `decompose.ts:781` (behind a
   * DEFAULT-OFF flag) and `routes/assist.v1.decision-review.ts`; NEVER from
   * `invoke.ts`, which is what the V5 enricher calls. `getClaimById` has no
   * production caller outside `shape-check.ts`. So a fabricated id reached the
   * user with a badge citing a claim that does not exist, and the old test
   * PINNED that behaviour as correct.
   */
  it('a fabricated claim id is STRIPPED, not blessed — the boundary is enforced here', () => {
    const bogus = 'DSK-T-999';
    // Precondition, derived: the id must genuinely not be in the bundle, or
    // this test proves nothing the day someone adds it.
    expect(techniqueClaims.map((c) => c.id)).not.toContain(bogus);

    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: 'An improvised heuristic', dsk_claim_id: bogus, evidence_strength: 'strong', dsk_protocol_id: 'DSK-P-999' },
    ]);

    expect(verdict(prompts[0])).toBe('general');
    // Nothing unverifiable survives to the wire.
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(prompts[0].dsk_protocol_id).toBeUndefined();
    expect(prompts[0].evidence_strength).toBeUndefined();
    expect(stats.unverified).toBe(1);
    expect(stats.attested).toBe(0);
  });

  it('a fabricated id whose principle IS a bundle title re-grades to resolved, with the BUNDLE id', () => {
    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: 'Pre-mortem and prospective hindsight', dsk_claim_id: 'DSK-T-999' },
    ]);
    expect(verdict(prompts[0])).toBe('resolved');
    // Identity-bound: the bundle's id, never the fabricated one.
    expect(prompts[0].dsk_claim_id).toBe('DSK-T-001');
    expect(stats.unverified).toBe(1);
  });

  it('DISCRIMINATING PAIR: a real id survives while a fabricated one is stripped', () => {
    // Neither assertion alone shows the check binds to bundle membership; the
    // pair does. A check that stripped everything would fail the first; one
    // that stripped nothing would fail the second.
    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'real', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
      { question: 'fake', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002-NOPE' },
    ]);
    const real = prompts.find((p) => p.question === 'real')!;
    const fake = prompts.find((p) => p.question === 'fake')!;

    expect(verdict(real)).toBe('attested');
    expect(real.dsk_claim_id).toBe('DSK-T-002');

    // The fake's principle happens to be a real title, so it re-grades to
    // `resolved` — carrying the BUNDLE's id, not the string it arrived with.
    expect(verdict(fake)).toBe('resolved');
    expect(fake.dsk_claim_id).toBe('DSK-T-002');
    expect(stats).toMatchObject({ attested: 1, resolved: 1, unverified: 1 });
  });

  it('every bundle claim id is accepted by the validator — derived, not mirrored', () => {
    // The union side of trap 12d: the validator must not be narrower than the
    // bundle. Iterates every claim, so a hand-narrowed id set REDs.
    for (const c of getAllByType('claim') as DSKClaim[]) {
      const { prompts, stats } = applyDskGroundingPolicy([
        { question: 'q', principle: 'An improvised heuristic', dsk_claim_id: c.id },
      ]);
      expect(stats.unverified).toBe(0);
      expect(prompts[0].dsk_claim_id).toBe(c.id);
    }
  });
});

// ============================================================================
// RESOLVE — identity-bound, and never a guess
// ============================================================================

describe('resolve: exact bundle-title match only', () => {
  it('resolves id, strength and protocol FROM THE BUNDLE, bound by identity', () => {
    const claim = techniqueClaims.find((c) => c.id === 'DSK-T-001');
    expect(claim).toBeDefined();
    // Precondition (trap 13b): this test is meaningless unless the fixture
    // genuinely carries no id. Assert it rather than trusting the literal.
    const fixture = { question: 'How could this fail?', principle: claim!.title };
    expect('dsk_claim_id' in fixture).toBe(false);

    const { prompts } = applyDskGroundingPolicy([fixture]);

    // Bound by IDENTITY (trap 19): the exact claim id, not "some id", and not
    // a value predicate another claim could satisfy.
    expect(prompts[0].dsk_claim_id).toBe('DSK-T-001');
    expect(prompts[0].dsk_protocol_id).toBe('DSK-P-001');
    expect(prompts[0].evidence_strength).toBe(claim!.evidence_strength);
    expect(verdict(prompts[0])).toBe('resolved');
    // The question text is carried untouched — we annotate, never rewrite.
    expect(prompts[0].question).toBe('How could this fail?');
  });

  it('does NOT resolve a paraphrase — a near-miss is general, never a guessed citation', () => {
    // Precondition, DERIVED from the real bundle so it cannot rot if someone
    // later adds a claim actually titled "Consider-the-opposite".
    const paraphrase = 'Consider-the-opposite';
    expect(techniqueClaims.map((c) => c.title)).not.toContain(paraphrase);

    const { prompts } = applyDskGroundingPolicy([{ question: 'q', principle: paraphrase }]);

    expect(verdict(prompts[0])).toBe('general');
    // The fabrication guarantee, stated: no id appears from nowhere.
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(prompts[0].dsk_protocol_id).toBeUndefined();
    expect(prompts[0].evidence_strength).toBeUndefined();
  });

  /**
   * The reviewer's exact measured input. The earlier paraphrase test asserted
   * these fields were `undefined` only because its fixture never SET them —
   * a guard agreeing with itself (trap 13b). This one sets them.
   */
  it('strips ORPHANED credibility fields on the general arm', () => {
    const orphaned = {
      question: 'q',
      principle: 'Some entirely made-up heuristic',
      evidence_strength: 'strong',
      dsk_protocol_id: 'DSK-P-002',
    };
    // Precondition: the fixture must genuinely carry them, or this is vacuous.
    expect(orphaned.evidence_strength).toBe('strong');
    expect(orphaned.dsk_protocol_id).toBe('DSK-P-002');
    // …and must genuinely have no id and no title match.
    expect('dsk_claim_id' in orphaned).toBe(false);
    expect(techniqueClaims.map((c) => c.title)).not.toContain(orphaned.principle);

    const { prompts } = applyDskGroundingPolicy([orphaned]);

    expect(verdict(prompts[0])).toBe('general');
    // An entry declared "genuinely unattested" must not ship credibility.
    expect(prompts[0].evidence_strength).toBeUndefined();
    expect(prompts[0].dsk_protocol_id).toBeUndefined();
    expect(prompts[0].dsk_claim_id).toBeUndefined();
  });

  it('INVARIANT: protocol id and strength never appear without a resolving claim id', () => {
    // Stated as a property over a mixed batch rather than per-case, so a new
    // arm added later cannot quietly reintroduce an orphan.
    const { prompts } = applyDskGroundingPolicy([
      { question: 'a', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
      { question: 'b', principle: 'Pre-mortem and prospective hindsight' },
      { question: 'c', principle: 'made up', evidence_strength: 'strong', dsk_protocol_id: 'DSK-P-002' },
      { question: 'd', principle: 'made up', dsk_claim_id: 'DSK-T-999', evidence_strength: 'strong' },
    ]);
    for (const p of prompts) {
      if (p.dsk_protocol_id !== undefined || p.evidence_strength !== undefined) {
        expect(typeof p.dsk_claim_id).toBe('string');
        expect(claimIdsInBundle()).toContain(p.dsk_claim_id);
      }
    }
    // Positive control: at least one entry DID keep its provenance, so the
    // loop above is not passing over an all-stripped batch.
    expect(prompts.filter((p) => p.dsk_claim_id !== undefined)).toHaveLength(2);
  });

  it('does not resolve a BIAS claim title — wrong claim family for this field', () => {
    const bias = (getAllByType('claim') as DSKClaim[]).find((c) => c.id.startsWith('DSK-B-'));
    expect(bias).toBeDefined();
    const { prompts } = applyDskGroundingPolicy([{ question: 'q', principle: bias!.title }]);
    expect(verdict(prompts[0])).toBe('general');
    expect(prompts[0].dsk_claim_id).toBeUndefined();
  });
});

// ============================================================================
// Trap 12d, guard 1 of 2 — DERIVED from the bundle (catches consumer drift)
// ============================================================================

describe('derived: every technique claim resolves to ITSELF by its own title', () => {
  it.each(
    // Built at run time from the real bundle — no hand-copied list.
    (() => {
      _resetDskBundle();
      loadDskBundle();
      return (getAllByType('claim') as DSKClaim[])
        .filter((c) => c.id.startsWith('DSK-T-'))
        .map((c) => [c.id, c.title] as const);
    })(),
  )('%s resolves from its title', (id, title) => {
    const { prompts } = applyDskGroundingPolicy([{ question: 'q', principle: title }]);
    expect(verdict(prompts[0])).toBe('resolved');
    expect(prompts[0].dsk_claim_id).toBe(id);
  });

  it('the index is derived from the bundle, not mirrored', () => {
    const index = buildTechniqueTitleIndex();
    expect(index.size).toBe(techniqueClaims.length);
    for (const c of techniqueClaims) {
      expect(index.get(c.title.normalize('NFC').trim())?.claim.id).toBe(c.id);
    }
  });
});

// ============================================================================
// Trap 12d, guard 2 of 2 — HAND-WRITTEN CORPUS (catches a SHORT bundle)
// ============================================================================

describe('live wire corpus: the five principle strings measured on staging', () => {
  /**
   * Every distinct `principle` string observed across the 31 analysis-turn
   * `decision_quality_prompts[]` entries captured in
   * `PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/` (walk of 2026-08-05, CEE
   * f4b4d879). Written by hand ON PURPOSE: a guard derived from the bundle
   * cannot notice that the bundle is missing something the model says.
   *
   * If a row here starts failing because a string no longer resolves, the
   * BUNDLE is short — that is a content finding, not a test to relax.
   */
  const LIVE_CORPUS: ReadonlyArray<readonly [string, 'resolved' | 'general', string | undefined]> = [
    ['Consider-the-opposite as a debiasing strategy', 'resolved', 'DSK-T-003'],
    ['Outside view and reference class forecasting', 'resolved', 'DSK-T-002'],
    ['Pre-mortem and prospective hindsight', 'resolved', 'DSK-T-001'],
    ['Consider-the-opposite', 'general', undefined],
    ['Outside view', 'general', undefined],
  ];

  it.each(LIVE_CORPUS)('%s → %s', (principle, expected, expectedId) => {
    const { prompts } = applyDskGroundingPolicy([{ question: 'q', principle }]);
    expect(verdict(prompts[0])).toBe(expected);
    expect(prompts[0].dsk_claim_id).toBe(expectedId);
  });

  it('the corpus covers what the walk measured: 3 of 5 strings are bundle titles', () => {
    // Pins the SPLIT itself. If a bundle edit ever made "Consider-the-opposite"
    // a real title, this count changes and the finding must be re-derived
    // rather than silently absorbed.
    const resolved = LIVE_CORPUS.filter(([, v]) => v === 'resolved');
    expect(resolved).toHaveLength(3);
  });
});

// ============================================================================
// POSITIVE CONTROL (trap 13) — the harness can see BOTH states
// ============================================================================

describe('positive control: the harness distinguishes grounded from general', () => {
  it('sees the grounded case NOT marked general, and the general case NOT grounded', () => {
    const { prompts } = applyDskGroundingPolicy([
      { question: 'attested-q', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
      { question: 'general-q', principle: 'Some entirely made-up heuristic' },
    ]);

    const attested = prompts.find((p) => p.question === 'attested-q')!;
    const general = prompts.find((p) => p.question === 'general-q')!;

    // Both directions, so neither assertion can pass by testing nothing.
    expect(verdict(attested)).toBe('attested');
    expect(verdict(attested)).not.toBe('general');
    expect(attested.dsk_claim_id).toBe('DSK-T-002');

    expect(verdict(general)).toBe('general');
    expect(verdict(general)).not.toBe('attested');
    expect(general.dsk_claim_id).toBeUndefined();
  });
});

// ============================================================================
// Fail-closed — no bundle ⇒ no claim AND no disclaimer
// ============================================================================

describe('fail-closed when DSK is unavailable', () => {
  it('marks nothing at all when DSK is disabled', () => {
    const { prompts, stats } = applyDskGroundingPolicy(
      [{ question: 'q', principle: 'Pre-mortem and prospective hindsight' }],
      { dskEnabled: false },
    );
    expect(stats.skipped).toBe(true);
    // Neither attested nor disclaimed: with no bundle we cannot honestly do
    // either. A consumer seeing no field must render nothing.
    expect(verdict(prompts[0])).toBeUndefined();
    expect(prompts[0].dsk_claim_id).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const input = [{ question: 'q', principle: 'Pre-mortem and prospective hindsight' }];
    applyDskGroundingPolicy(input);
    expect(input[0]).not.toHaveProperty(DSK_GROUNDING_KEY);
    expect(input[0]).not.toHaveProperty('dsk_claim_id');
  });
});

// ============================================================================
// EGRESS — the verdict must actually reach the wire (trap 12: keep-lists
// silently demote unknown keys, and a "no error" drop reads exactly like green)
// ============================================================================

describe('egress: the verdict survives the enrichment sanitiser', () => {
  it('carries dsk_grounding through sanitiseEnrichment byte-equal', async () => {
    const { sanitiseEnrichment } = await import('../../../orchestrator-v5/compose/sanitise-enrichment.js');

    const { prompts } = applyDskGroundingPolicy([
      { question: 'attested-q', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
      { question: 'general-q', principle: 'Some entirely made-up heuristic' },
    ]);

    const { enrichment } = sanitiseEnrichment({
      decision_review: { decision_quality_prompts: prompts, produced_at: '2026-08-05T00:00:00.000Z' },
    });

    const out = (enrichment.decision_review as Record<string, unknown>)
      .decision_quality_prompts as Record<string, unknown>[];

    // Positive control for THIS guard: an already-shipping sibling key on the
    // same object survives too, so a failure here means the new key
    // specifically was dropped — not that the whole subtree was.
    expect(out.find((p) => p.question === 'attested-q')?.dsk_claim_id).toBe('DSK-T-002');

    expect(out.find((p) => p.question === 'attested-q')?.[DSK_GROUNDING_KEY]).toBe('attested');
    expect(out.find((p) => p.question === 'general-q')?.[DSK_GROUNDING_KEY]).toBe('general');
  });
});
