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
 *   - DERIVED (§"every bundle claim resolves", §"every technique claim attests
 *     from its canonical tuple"): iterates the real bundle, so a consumer can
 *     never drift from it. Structurally BLIND to a missing or wrong claim.
 *   - HAND-WRITTEN CORPUS (§"live wire corpus", §"hand-written corpus: real and
 *     adversarial id/prose pairs"): principle strings and id/prose tuples
 *     transcribed from the WIRE, with verdicts written out. These are the only
 *     guards that can notice the bundle is SHORT or has drifted from what users
 *     were actually served.
 * Ship both; dropping either loses a whole defect class.
 *
 * ## RED-first for the ATTEST-BINDING work (2.491 follow-up) — MEASURED
 *
 * Measured at pristine `e82738b2` with the source UNCHANGED (`git status` on
 * `dsk-grounding-policy.ts` empty at the time of the run):
 * **28 failed | 31 passed (59 collected)** in this file. Named signatures:
 *
 *   - `wrong-real-ID: a real technique id paired with a DIFFERENT claim's prose
 *      must NOT attest` → `expected 'attested' not to be 'attested'`
 *   - `COMPANION MISMATCH (the measured case): bogus protocol + wrong strength
 *      must NOT attest` → `expected 'attested' not to be 'attested'`
 *   - `non-technique-ID: a REAL bias claim id must NOT attest a
 *      decision-quality prompt` → `expected 'attested' to be 'general'`
 *   - `INVERTED: improvised prose keeps NO provenance, whatever real id it
 *      cites` → `DSK-B-001 must not attest improvised prose: expected
 *      'attested' to be 'general'`
 *
 * These are behavioural reds against a module that already exists — not the
 * module-not-found non-red the original version of this file recorded.
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
 * The id side of the boundary, stated as a UNION assertion over the bundle
 * (trap 12d): the set of ids that can attest must be exactly the TECHNIQUE
 * claims `getClaimById` resolves — no wider (a bias id or a fabricated id must
 * not attest) and no narrower (every technique claim must be attestable).
 *
 * ⚠ THIS REPLACES A TEST THAT ASSERTED A WEAKER, WRONG BOUNDARY. The original
 * paired every bundle id with the improvised prose `'An improvised heuristic'`
 * and asserted `stats.attested === 1` iff `getClaimById(id)` resolved — i.e.
 * it pinned "any real id attests any prose", including bias ids. Both halves
 * were wrong: prose must bind to the cited claim, and `decision_quality_prompts`
 * are offered the TECHNIQUE table only.
 */
describe('the attestable id set is exactly the bundle TECHNIQUE claims', () => {
  it('is no narrower than the bundle: every DSK-T-* claim attests from its canonical tuple', () => {
    expect(techniqueClaims.length).toBeGreaterThan(0); // positive control
    for (const c of techniqueClaims) {
      expect(getClaimById(c.id), `bundle disagreement on ${c.id}`).toBeDefined();
      const { prompts, stats } = applyDskGroundingPolicy([
        { question: 'q', principle: c.title },
      ]);
      // Identity-bound: THIS claim's id, from THIS claim's title.
      expect(prompts[0].dsk_claim_id, `id for ${c.id}`).toBe(c.id);
      expect(stats.unverified).toBe(0);
    }
  });

  it('is no wider than the bundle: non-technique, non-claim and fabricated ids never attest', () => {
    const biasIds = (getAllByType('claim') as DSKClaim[])
      .filter((c) => !c.id.startsWith('DSK-T-'))
      .map((c) => c.id);
    // Precondition: the bundle genuinely carries a non-technique claim family,
    // or the "no wider" half of this union assertion tests nothing.
    expect(biasIds.length).toBeGreaterThan(0);
    // …and those ids ARE real claims, so this is not merely re-testing unknown ids.
    for (const id of biasIds) expect(getClaimById(id), `${id} should be a real claim`).toBeDefined();

    const probes = [...biasIds, 'DSK-P-002', 'DSK-T-999', 'DSK-B-999', 'DSK-T-002 ', 'dsk-t-002'];
    for (const id of probes) {
      const { prompts, stats } = applyDskGroundingPolicy([
        { question: 'q', principle: 'An improvised heuristic', dsk_claim_id: id },
      ]);
      expect(verdict(prompts[0]), `${JSON.stringify(id)} must not attest`).not.toBe('attested');
      expect(stats.attested, `${JSON.stringify(id)} must not attest`).toBe(0);
      expect(prompts[0].dsk_claim_id, `${JSON.stringify(id)} must not survive`).toBeUndefined();
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
      unverifiedByReason: {
        unknownId: 0,
        nonTechniqueId: 0,
        principleMismatch: 0,
        companionMismatch: 0,
      },
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

  /**
   * ⚠⚠ THIS TEST IS THE INVERSION OF ONE THAT PINNED THE DEFECT (ROADMAP 2.491
   * follow-up). Its predecessor read:
   *
   *   it('every bundle claim id is accepted by the validator — derived, not mirrored', …)
   *     for (const c of getAllByType('claim') as DSKClaim[]) {
   *       const { prompts, stats } = applyDskGroundingPolicy([
   *         { question: 'q', principle: 'An improvised heuristic', dsk_claim_id: c.id },
   *       ]);
   *       expect(stats.unverified).toBe(0);
   *       expect(prompts[0].dsk_claim_id).toBe(c.id);
   *     }
   *
   * WHY THAT WAS WRONG — two independent errors, both user-visible:
   *   1. It asserted that ARBITRARY MODEL PROSE paired with ANY real claim id
   *      keeps its provenance. The id was checked for EXISTENCE, never for
   *      correspondence with the sentence displayed beside it. The UI renders
   *      `Grounded in: <bundle claim title> · <strength> evidence` from that
   *      provenance, so improvised prose was shown to a user as attested
   *      decision science.
   *   2. It iterated ALL claims, so it also pinned a BIAS claim (`DSK-B-*`)
   *      as a valid citation for a `decision_quality_prompts` entry — a field
   *      whose prompt is only ever shown the TECHNIQUE table.
   *
   * The union assertion it was reaching for is real and is preserved above, in
   * its correct form: the attestable set is exactly the technique claims, each
   * proved from ITS OWN canonical tuple rather than from improvised prose.
   */
  it('INVERTED: improvised prose keeps NO provenance, whatever real id it cites', () => {
    const improvised = 'An improvised heuristic';
    // Precondition (trap 13b): the prose must genuinely match no bundle title,
    // or this test would be measuring the resolve arm instead.
    expect((getAllByType('claim') as DSKClaim[]).map((c) => c.title)).not.toContain(improvised);

    for (const c of getAllByType('claim') as DSKClaim[]) {
      const { prompts, stats } = applyDskGroundingPolicy([
        { question: 'q', principle: improvised, dsk_claim_id: c.id },
      ]);
      expect(verdict(prompts[0]), `${c.id} must not attest improvised prose`).toBe('general');
      expect(prompts[0].dsk_claim_id, `${c.id} provenance must be stripped`).toBeUndefined();
      expect(prompts[0].evidence_strength).toBeUndefined();
      expect(prompts[0].dsk_protocol_id).toBeUndefined();
      expect(stats.unverified, `${c.id} is a fabricated citation`).toBe(1);
      // …but the coaching itself is never destroyed.
      expect(prompts[0].question).toBe('q');
      expect(prompts[0].principle).toBe(improvised);
    }
  });
});

// ============================================================================
// ATTEST — the id must RESOLVE TO THE CLAIM THAT IS DISPLAYED
//
// The defect these close (measured independently twice, 2026-08-05): the
// attested arm validated only that the id EXISTED. It never checked that the
// id matched the `principle` shown beside it, nor that the companion
// provenance equalled the bundle's values for that claim. So
// `{dsk_claim_id:'DSK-T-002', dsk_protocol_id:'DSK-P-BOGUS',
//   evidence_strength:'weak'}` was marked `attested`.
//
// The UI then renders it — verified at the bytes on UI staging tip `af5c5a37`:
// `KeyQuestionCard.tsx:85-86` prints `Grounded in: {grounding.principle}` plus
// `` · ${strength} evidence ``, and `deriveDskGrounding`
// (`decisionQualityPrompts.ts:122-128`) gates ONLY on `dskClaimId && principle`
// and passes `principle: p.principle` — THE ENTRY'S OWN TEXT. So the badge
// shows the MODEL'S PROSE under the bundle's authority, with the model's
// strength: "· weak evidence" for a claim the bundle rates `strong`.
// A FALSE CREDIBILITY SIGNAL under a real id.
//
// The invariant now enforced: COMPANIONS APPEAR ONLY WHEN THEY EQUAL THE
// BUNDLE'S VALUES FOR THE RESOLVING CLAIM. "The id resolves" is necessary and
// NOT sufficient — the DSK-P-BOGUS case satisfies it exactly.
// ============================================================================

describe('attest: the citation must match the claim, not merely exist', () => {
  /** The canonical, bundle-exact tuple for a claim — the positive-control shape. */
  const canonicalEntry = (id: string, question = 'q'): Record<string, unknown> => {
    const claim = techniqueClaims.find((c) => c.id === id);
    expect(claim, `bundle must carry ${id}`).toBeDefined();
    const protocols = getAllByType('protocol') as { id: string; linked_claim_id?: string }[];
    const protocolId = protocols.find((p) => p.linked_claim_id === id)?.id;
    expect(protocolId, `bundle must link a protocol to ${id}`).toBeDefined();
    return {
      question,
      principle: claim!.title,
      dsk_claim_id: id,
      evidence_strength: claim!.evidence_strength,
      dsk_protocol_id: protocolId,
    };
  };

  // --------------------------------------------------------------------
  // POSITIVE CONTROL (trap 13) — without this, a policy that attested
  // NOTHING would pass every "must not attest" case below.
  // --------------------------------------------------------------------
  it('POSITIVE CONTROL: a correct id/prose/strength/protocol tuple DOES attest, values intact', () => {
    const entry = canonicalEntry('DSK-T-002');
    const { prompts, stats } = applyDskGroundingPolicy([entry]);

    expect(verdict(prompts[0])).toBe('attested');
    // Bound by IDENTITY (trap 19) — the exact claim, not "some claim".
    expect(prompts[0].dsk_claim_id).toBe('DSK-T-002');
    expect(prompts[0].principle).toBe('Outside view and reference class forecasting');
    expect(prompts[0].evidence_strength).toBe('strong');
    expect(prompts[0].dsk_protocol_id).toBe('DSK-P-002');
    expect(stats.attested).toBe(1);
    expect(stats.unverified).toBe(0);
  });

  it('POSITIVE CONTROL: an id + canonical prose with NO companions attests, filled FROM the bundle', () => {
    const { prompts } = applyDskGroundingPolicy([
      { question: 'q', principle: 'Consider-the-opposite as a debiasing strategy', dsk_claim_id: 'DSK-T-003' },
    ]);
    expect(verdict(prompts[0])).toBe('attested');
    expect(prompts[0].dsk_claim_id).toBe('DSK-T-003');
    expect(prompts[0].evidence_strength).toBe('medium');
    expect(prompts[0].dsk_protocol_id).toBe('DSK-P-003');
  });

  // --------------------------------------------------------------------
  // CASE 1 — WRONG-REAL-ID: a real DSK-T-* id beside another claim's prose
  // --------------------------------------------------------------------
  it('wrong-real-ID: a real technique id paired with a DIFFERENT claim’s prose must NOT attest', () => {
    const t001 = techniqueClaims.find((c) => c.id === 'DSK-T-001')!;
    const t002 = techniqueClaims.find((c) => c.id === 'DSK-T-002')!;
    // Precondition: both are real, and their titles genuinely differ.
    expect(t001.title).not.toBe(t002.title);

    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: t001.title, dsk_claim_id: 'DSK-T-002' },
    ]);

    expect(verdict(prompts[0])).not.toBe('attested');
    // The displayed provenance now agrees with the displayed prose: the entry
    // re-grades by TITLE, so the id shown is DSK-T-001 — never the cited one.
    expect(verdict(prompts[0])).toBe('resolved');
    expect(prompts[0].dsk_claim_id).toBe('DSK-T-001');
    expect(prompts[0].evidence_strength).toBe(t001.evidence_strength);
    expect(stats.attested).toBe(0);
    expect(stats.unverified).toBe(1);
    expect(stats.unverifiedByReason.principleMismatch).toBe(1);
  });

  it('wrong-real-ID with improvised prose: no id, no strength, no protocol survives', () => {
    // The reviewer's second measured case, verbatim in shape: arbitrary
    // model-authored principle prose + any real claim id.
    const improvised = 'Bayesian belief updating under ambiguity';
    expect((getAllByType('claim') as DSKClaim[]).map((c) => c.title)).not.toContain(improvised);

    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: improvised, dsk_claim_id: 'DSK-T-002', evidence_strength: 'strong', dsk_protocol_id: 'DSK-P-002' },
    ]);

    expect(verdict(prompts[0])).toBe('general');
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(prompts[0].evidence_strength).toBeUndefined();
    expect(prompts[0].dsk_protocol_id).toBeUndefined();
    expect(stats.unverifiedByReason.principleMismatch).toBe(1);
    // The prose still reaches the user — stripped of the credibility it forged.
    expect(prompts[0].principle).toBe(improvised);
  });

  it('an id with NO principle at all cannot attest — nothing displayed binds to the claim', () => {
    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', dsk_claim_id: 'DSK-T-002' },
    ]);
    expect(verdict(prompts[0])).toBe('general');
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(stats.unverifiedByReason.principleMismatch).toBe(1);
  });

  // --------------------------------------------------------------------
  // CASE 2 — NON-TECHNIQUE-ID: a real bias/protocol id on a technique prompt
  // --------------------------------------------------------------------
  it('non-technique-ID: a REAL bias claim id must NOT attest a decision-quality prompt', () => {
    const bias = (getAllByType('claim') as DSKClaim[]).find((c) => c.id.startsWith('DSK-B-'))!;
    // Precondition: it IS a real claim — so this proves family-gating, not
    // merely that an unknown id is rejected.
    expect(getClaimById(bias.id)).toBeDefined();

    const { prompts, stats } = applyDskGroundingPolicy([
      // Even paired with its OWN canonical title, which is the strongest form
      // of the attack: everything about the citation is internally consistent.
      { question: 'q', principle: bias.title, dsk_claim_id: bias.id, evidence_strength: bias.evidence_strength },
    ]);

    expect(verdict(prompts[0])).toBe('general');
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(prompts[0].evidence_strength).toBeUndefined();
    expect(stats.attested).toBe(0);
    expect(stats.unverifiedByReason.nonTechniqueId).toBe(1);
  });

  it('non-technique-ID: a real PROTOCOL id in the claim slot must NOT attest', () => {
    const protocol = (getAllByType('protocol') as { id: string; title: string }[])[0];
    expect(protocol.id.startsWith('DSK-P-')).toBe(true);
    // Precondition: a protocol id is not a claim id, so this lands on the
    // unknown-id reason rather than the wrong-family one.
    expect(getClaimById(protocol.id)).toBeUndefined();

    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: protocol.title, dsk_claim_id: protocol.id },
    ]);
    expect(verdict(prompts[0])).toBe('general');
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(stats.unverifiedByReason.unknownId).toBe(1);
  });

  // --------------------------------------------------------------------
  // CASE 3 — COMPANION MISMATCH: the exact reviewer-measured input
  // --------------------------------------------------------------------
  it('COMPANION MISMATCH (the measured case): bogus protocol + wrong strength must NOT attest', () => {
    // Verbatim shape from the independent measurement:
    //   {dsk_claim_id:'DSK-T-002', dsk_protocol_id:'DSK-P-BOGUS', evidence_strength:'weak'}
    // Before the fix this returned `attested`, retaining a NONEXISTENT protocol
    // and a strength of `weak` for a claim the bundle rates `strong`.
    const t002 = techniqueClaims.find((c) => c.id === 'DSK-T-002')!;
    expect(t002.evidence_strength).toBe('strong'); // precondition: 'weak' really is wrong
    expect((getAllByType('protocol') as { id: string }[]).map((p) => p.id)).not.toContain('DSK-P-BOGUS');

    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', dsk_claim_id: 'DSK-T-002', dsk_protocol_id: 'DSK-P-BOGUS', evidence_strength: 'weak' },
    ]);

    expect(verdict(prompts[0])).not.toBe('attested');
    expect(prompts[0].dsk_protocol_id).toBeUndefined();
    expect(prompts[0].evidence_strength).toBeUndefined();
    expect(prompts[0].dsk_claim_id).toBeUndefined();
    expect(stats.attested).toBe(0);
  });

  it('COMPANION MISMATCH: wrong STRENGTH beside canonical prose never reaches the wire', () => {
    // This is the user-visible string: KeyQuestionCard prints
    // `Grounded in: {grounding.principle}` + `` · ${strength} evidence ``.
    // A retained 'weak' here is a false credibility signal for a claim the
    // bundle rates 'strong'.
    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002', evidence_strength: 'weak' },
    ]);

    expect(verdict(prompts[0])).not.toBe('attested');
    // Whatever verdict it lands on, the displayed strength is the BUNDLE's.
    expect(prompts[0].evidence_strength).not.toBe('weak');
    expect(prompts[0].evidence_strength).toBe('strong');
    expect(prompts[0].dsk_claim_id).toBe('DSK-T-002');
    expect(stats.unverifiedByReason.companionMismatch).toBe(1);
  });

  it('COMPANION MISMATCH: wrong PROTOCOL beside canonical prose never reaches the wire', () => {
    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'q', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002', dsk_protocol_id: 'DSK-P-003' },
    ]);
    expect(verdict(prompts[0])).not.toBe('attested');
    expect(prompts[0].dsk_protocol_id).toBe('DSK-P-002');
    expect(stats.unverifiedByReason.companionMismatch).toBe(1);
  });

  it('a NON-STRING companion is a mismatch, not a passthrough', () => {
    const { prompts } = applyDskGroundingPolicy([
      { question: 'q', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002', evidence_strength: 42 },
    ]);
    expect(verdict(prompts[0])).not.toBe('attested');
    expect(prompts[0].evidence_strength).toBe('strong');
  });

  // --------------------------------------------------------------------
  // DISCRIMINATING PAIR, in-test (trap 19): same batch, same claim id,
  // one entry attests and one does not — so the binding is to the OBJECT.
  // --------------------------------------------------------------------
  it('DISCRIMINATING PAIR: same real id, canonical prose attests while foreign prose does not', () => {
    const { prompts, stats } = applyDskGroundingPolicy([
      { question: 'matching', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
      { question: 'foreign', principle: 'Opportunity cost neglect', dsk_claim_id: 'DSK-T-002' },
    ]);
    const matching = prompts.find((p) => p.question === 'matching')!;
    const foreign = prompts.find((p) => p.question === 'foreign')!;

    // Neither half alone shows the binding; the pair does. A policy that
    // attested everything fails the second; one that attested nothing fails
    // the first.
    expect(verdict(matching)).toBe('attested');
    expect(matching.dsk_claim_id).toBe('DSK-T-002');

    expect(verdict(foreign)).not.toBe('attested');
    // The prose is DSK-T-004's title, so it re-grades to that claim — the
    // provenance follows the DISPLAYED text, never the cited id.
    expect(foreign.dsk_claim_id).toBe('DSK-T-004');
    expect(stats.attested).toBe(1);
    expect(stats.unverified).toBe(1);
  });

  it('the reason counters partition `unverified` exactly — a derived, fail-loud accounting', () => {
    const { stats } = applyDskGroundingPolicy([
      { question: 'a', principle: 'improvised', dsk_claim_id: 'DSK-T-999' },
      { question: 'b', principle: 'Anchoring and insufficient adjustment', dsk_claim_id: 'DSK-B-001' },
      { question: 'c', principle: 'improvised', dsk_claim_id: 'DSK-T-002' },
      { question: 'd', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002', evidence_strength: 'weak' },
      { question: 'e', principle: 'Outside view and reference class forecasting', dsk_claim_id: 'DSK-T-002' },
    ]);
    const r = stats.unverifiedByReason;
    expect(r).toEqual({ unknownId: 1, nonTechniqueId: 1, principleMismatch: 1, companionMismatch: 1 });
    expect(r.unknownId + r.nonTechniqueId + r.principleMismatch + r.companionMismatch).toBe(stats.unverified);
    // Positive control: the batch is not uniformly rejected.
    expect(stats.attested).toBe(1);
  });
});

// ============================================================================
// Trap 12d over the ATTEST arm — BOTH guards, because neither does the other's
// job. DERIVED (below) proves consumers cannot drift from the bundle; it is
// structurally blind to the bundle being short or wrong. The HAND-WRITTEN
// corpus further down is written from the WIRE and is the only guard that can
// notice that.
// ============================================================================

describe('derived: every technique claim attests from its canonical tuple and rejects every perturbation', () => {
  it.each(
    (() => {
      _resetDskBundle();
      loadDskBundle();
      const claims = (getAllByType('claim') as DSKClaim[]).filter((c) => c.id.startsWith('DSK-T-'));
      const protocols = getAllByType('protocol') as { id: string; linked_claim_id?: string }[];
      return claims.map((c, i) => {
        const other = claims[(i + 1) % claims.length];
        return [
          c.id,
          c.title,
          c.evidence_strength,
          protocols.find((p) => p.linked_claim_id === c.id)?.id,
          other.title,
        ] as const;
      });
    })(),
  )(
    '%s: canonical attests; foreign prose / wrong strength / wrong protocol do not',
    (id, title, strength, protocolId, otherTitle) => {
      // Precondition: the perturbation is a genuine one for THIS claim.
      expect(otherTitle).not.toBe(title);
      expect(protocolId).toBeDefined();

      // Canonical — the positive control for this row.
      const ok = applyDskGroundingPolicy([
        { question: 'q', principle: title, dsk_claim_id: id, evidence_strength: strength, dsk_protocol_id: protocolId },
      ]);
      expect(verdict(ok.prompts[0])).toBe('attested');
      expect(ok.prompts[0].dsk_claim_id).toBe(id);

      // Foreign prose.
      const foreign = applyDskGroundingPolicy([
        { question: 'q', principle: otherTitle, dsk_claim_id: id },
      ]);
      expect(verdict(foreign.prompts[0])).not.toBe('attested');
      expect(foreign.prompts[0].dsk_claim_id).not.toBe(id);

      // Wrong strength — a real vocabulary value, just not this claim's.
      const wrongStrength = strength === 'strong' ? 'weak' : 'strong';
      const strengthCase = applyDskGroundingPolicy([
        { question: 'q', principle: title, dsk_claim_id: id, evidence_strength: wrongStrength },
      ]);
      expect(verdict(strengthCase.prompts[0])).not.toBe('attested');
      expect(strengthCase.prompts[0].evidence_strength).toBe(strength);

      // Wrong protocol — a real protocol id, just not this claim's.
      const protocolCase = applyDskGroundingPolicy([
        { question: 'q', principle: title, dsk_claim_id: id, dsk_protocol_id: 'DSK-P-BOGUS' },
      ]);
      expect(verdict(protocolCase.prompts[0])).not.toBe('attested');
      expect(protocolCase.prompts[0].dsk_protocol_id).toBe(protocolId);
    },
  );
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
// Trap 12d, guard 2 of 2 for the ATTEST arm — HAND-WRITTEN id/prose CORPUS
//
// Written by hand ON PURPOSE. The derived guard above iterates the bundle, so
// it proves the policy AGREES with whatever the bundle says and is
// structurally blind to the bundle being short, mistitled or mis-strengthed.
// These rows are transcribed from the WIRE — the 25 entries that actually
// carried a `dsk_claim_id` across the walk of 2026-08-05
// (`PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/`), measured to be exactly two
// distinct tuples — plus hand-authored adversarial mutations of them.
//
// If a POSITIVE row starts failing, the BUNDLE has drifted from what the model
// is being shown and what users were served: a content finding, not a test to
// relax. If a NEGATIVE row starts passing, the attestation boundary has been
// widened and a false credibility signal is reachable again.
// ============================================================================

describe('hand-written corpus: real and adversarial id/prose pairs', () => {
  interface CorpusRow {
    readonly name: string;
    readonly entry: Record<string, unknown>;
    readonly attests: boolean;
    /** What the user must end up seeing, whatever verdict is reached. */
    readonly displayedId: string | undefined;
    readonly displayedStrength: string | undefined;
    readonly displayedProtocol: string | undefined;
  }

  const CORPUS: readonly CorpusRow[] = [
    // ---- MEASURED ON THE WIRE (15 of the 25 cited entries) ----
    {
      name: 'live DSK-T-002 tuple, exactly as served',
      entry: {
        question: 'What is the base rate for UK parcel depots needing emergency capacity expansion?',
        principle: 'Outside view and reference class forecasting',
        dsk_claim_id: 'DSK-T-002',
        evidence_strength: 'strong',
        dsk_protocol_id: 'DSK-P-002',
      },
      attests: true,
      displayedId: 'DSK-T-002',
      displayedStrength: 'strong',
      displayedProtocol: 'DSK-P-002',
    },
    // ---- MEASURED ON THE WIRE (the other 10 cited entries) ----
    {
      name: 'live DSK-T-003 tuple, exactly as served',
      entry: {
        question: 'What would make you shift away from the leading option?',
        principle: 'Consider-the-opposite as a debiasing strategy',
        dsk_claim_id: 'DSK-T-003',
        evidence_strength: 'medium',
        dsk_protocol_id: 'DSK-P-003',
      },
      attests: true,
      displayedId: 'DSK-T-003',
      displayedStrength: 'medium',
      displayedProtocol: 'DSK-P-003',
    },
    // ---- HAND-AUTHORED ADVERSARIAL MUTATIONS OF THE ABOVE ----
    {
      name: 'live tuple with the strength downgraded to weak',
      entry: {
        question: 'q',
        principle: 'Outside view and reference class forecasting',
        dsk_claim_id: 'DSK-T-002',
        evidence_strength: 'weak',
        dsk_protocol_id: 'DSK-P-002',
      },
      attests: false,
      displayedId: 'DSK-T-002',
      displayedStrength: 'strong',
      displayedProtocol: 'DSK-P-002',
    },
    {
      name: 'live tuple with a nonexistent protocol',
      entry: {
        question: 'q',
        principle: 'Outside view and reference class forecasting',
        dsk_claim_id: 'DSK-T-002',
        evidence_strength: 'strong',
        dsk_protocol_id: 'DSK-P-BOGUS',
      },
      attests: false,
      displayedId: 'DSK-T-002',
      displayedStrength: 'strong',
      displayedProtocol: 'DSK-P-002',
    },
    {
      name: 'the two live ids swapped onto each other’s prose',
      entry: {
        question: 'q',
        principle: 'Consider-the-opposite as a debiasing strategy',
        dsk_claim_id: 'DSK-T-002',
        evidence_strength: 'strong',
        dsk_protocol_id: 'DSK-P-002',
      },
      attests: false,
      displayedId: 'DSK-T-003',
      displayedStrength: 'medium',
      displayedProtocol: 'DSK-P-003',
    },
    {
      name: 'model-authored science prose under a real id',
      entry: {
        question: 'q',
        principle: 'Bayesian belief updating under ambiguity',
        dsk_claim_id: 'DSK-T-002',
        evidence_strength: 'strong',
        dsk_protocol_id: 'DSK-P-002',
      },
      attests: false,
      displayedId: undefined,
      displayedStrength: undefined,
      displayedProtocol: undefined,
    },
    {
      name: 'a real BIAS claim cited on a decision-quality prompt',
      entry: {
        question: 'q',
        principle: 'Anchoring and insufficient adjustment',
        dsk_claim_id: 'DSK-B-001',
        evidence_strength: 'strong',
      },
      attests: false,
      displayedId: undefined,
      displayedStrength: undefined,
      displayedProtocol: undefined,
    },
    {
      name: 'a protocol id in the claim slot',
      entry: { question: 'q', principle: 'Pre-mortem exercise', dsk_claim_id: 'DSK-P-001' },
      attests: false,
      displayedId: undefined,
      displayedStrength: undefined,
      displayedProtocol: undefined,
    },
    {
      name: 'a case-variant of a real title under its own id',
      entry: {
        question: 'q',
        principle: 'outside view and reference class forecasting',
        dsk_claim_id: 'DSK-T-002',
      },
      attests: false,
      displayedId: undefined,
      displayedStrength: undefined,
      displayedProtocol: undefined,
    },
    {
      name: 'id present, prose absent',
      entry: { question: 'q', dsk_claim_id: 'DSK-T-002', evidence_strength: 'strong' },
      attests: false,
      displayedId: undefined,
      displayedStrength: undefined,
      displayedProtocol: undefined,
    },
  ];

  it.each(CORPUS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
    const { prompts, stats } = applyDskGroundingPolicy([{ ...row.entry }]);
    const out = prompts[0];

    expect(verdict(out) === 'attested', `attests?`).toBe(row.attests);
    expect(out.dsk_claim_id, 'displayed claim id').toBe(row.displayedId);
    expect(out.evidence_strength, 'displayed strength').toBe(row.displayedStrength);
    expect(out.dsk_protocol_id, 'displayed protocol').toBe(row.displayedProtocol);
    // Every entry still leaves with a verdict — the 2.456 property.
    expect(typeof verdict(out)).toBe('string');
    // And the coaching text is never destroyed by a provenance rejection.
    expect(out.question).toBe(row.entry.question);
    if (row.entry.principle !== undefined) expect(out.principle).toBe(row.entry.principle);
    if (!row.attests) expect(stats.unverified).toBe(1);
  });

  it('the corpus contains BOTH polarities, so no row can be passing vacuously', () => {
    // A corpus of only-negatives would pass against a policy that attests
    // nothing; only-positives against one that attests everything.
    expect(CORPUS.filter((r) => r.attests).length).toBeGreaterThan(0);
    expect(CORPUS.filter((r) => !r.attests).length).toBeGreaterThan(0);
    // The two positive rows are the ONLY tuples measured on the live wire; if
    // a third ever appears, add it here rather than deriving it.
    expect(CORPUS.filter((r) => r.attests).map((r) => r.entry.dsk_claim_id)).toEqual([
      'DSK-T-002',
      'DSK-T-003',
    ]);
  });
});

// ============================================================================
// Trap 12d — THE COMPLETENESS HALF DERIVATION CANNOT SUPPLY: the whole
// technique table, WRITTEN OUT BY HAND.
//
// ⚠ MEASURED HOLE THIS CLOSES — row 12d's `thousand` reproduced INSIDE a PR
// that cites 12d. Before this block, hand-written `DSK-T-*` ids appeared for
// T-001..T-004 only; T-005 and T-006 appeared NOWHERE in this file. Measured by
// adversarial review, each with the bundle rehashed by the repo's own hasher:
//
//     delete DSK-T-001 (corpus spells it) .............. RED  ✓
//     DSK-T-002 strong -> medium (corpus spells it) .... RED  ✓
//     delete DSK-T-005 / DSK-T-006 ..................... 59 -> 57, GREEN
//     RETITLE DSK-T-005 ................................ 59/59 GREEN
//     DSK-T-006 strong -> weak ......................... 59/59 GREEN
//
// The last row decides it: THE EVIDENCE STRENGTH PRINTED TO A USER BESIDE A
// SCIENTIFIC CLAIM COULD BE SILENTLY DOWNGRADED WITH EVERY TEST STILL GREEN —
// on the trust surface whose entire thesis is that displayed provenance is
// bound to the canonical record.
//
// Every other technique-claim guard in this file is DERIVED from the bundle and
// therefore agrees with it BY CONSTRUCTION: derivation proves agreement and can
// never prove completeness, so none of them can notice the bundle itself being
// short, retitled or mis-strengthed. This table is written by hand for exactly
// that reason, and it REDs on deletion, addition, retitle AND strength drift.
//
// Severity of the hole, honestly: fail-closed, maintenance-time only, needs a
// deliberate bundle edit, unreachable from model output. It could never
// FABRICATE a badge — it could silently LOSE or MISPRICE one.
//
// ⚠ If a row here fails, THE BUNDLE CHANGED. That is a CONTENT finding: go and
// re-derive what users are being served. It is not a table to re-copy green.
// ============================================================================

describe('hand-written: the whole technique table, written out', () => {
  /** id, title, evidence_strength, linked protocol id — literals, never read from the bundle. */
  const TECHNIQUE_TABLE: ReadonlyArray<readonly [string, string, string, string]> = [
    ['DSK-T-001', 'Pre-mortem and prospective hindsight', 'medium', 'DSK-P-001'],
    ['DSK-T-002', 'Outside view and reference class forecasting', 'strong', 'DSK-P-002'],
    ['DSK-T-003', 'Consider-the-opposite as a debiasing strategy', 'medium', 'DSK-P-003'],
    ['DSK-T-004', 'Opportunity cost neglect', 'medium', 'DSK-P-004'],
    ['DSK-T-005', "Structured dissent and devil's advocacy", 'medium', 'DSK-P-005'],
    ['DSK-T-006', 'Implementation intentions for decision follow-through', 'strong', 'DSK-P-006'],
  ];

  it('the bundle carries EXACTLY these claims, titles and strengths — the union assertion', () => {
    const actual = (getAllByType('claim') as DSKClaim[])
      .filter((c) => c.id.startsWith('DSK-T-'))
      .map((c) => [c.id, c.title, c.evidence_strength] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const expected = TECHNIQUE_TABLE.map(([id, title, strength]) => [id, title, strength]).sort(
      (a, b) => a[0].localeCompare(b[0]),
    );
    // One assertion, four drift classes: a DELETED claim shortens `actual`, an
    // ADDED one lengthens it, a RETITLE changes [1], a STRENGTH change [2].
    expect(actual).toEqual(expected);
  });

  it('every linked protocol is exactly the one written here', () => {
    const protocols = getAllByType('protocol') as { id: string; linked_claim_id?: string }[];
    for (const [id, , , protocolId] of TECHNIQUE_TABLE) {
      expect(protocols.find((p) => p.linked_claim_id === id)?.id, `protocol for ${id}`).toBe(
        protocolId,
      );
    }
  });

  it.each(TECHNIQUE_TABLE)(
    '%s attests end-to-end from its hand-written tuple',
    (id, title, strength, protocolId) => {
      // Closes the loop: the table is not merely asserted about the bundle, it
      // is proved to be what the POLICY honours and what reaches the wire.
      const { prompts } = applyDskGroundingPolicy([
        {
          question: 'q',
          principle: title,
          dsk_claim_id: id,
          evidence_strength: strength,
          dsk_protocol_id: protocolId,
        },
      ]);
      expect(verdict(prompts[0])).toBe('attested');
      expect(prompts[0].dsk_claim_id).toBe(id);
      expect(prompts[0].evidence_strength).toBe(strength);
      expect(prompts[0].dsk_protocol_id).toBe(protocolId);
    },
  );
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
