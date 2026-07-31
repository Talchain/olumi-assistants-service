/**
 * T1 claim safety, LAYER 3 — the egress guard's own scan surface.
 *
 * The route-level file (`__tests__/constraint-disclosure-route-level.test.ts`)
 * asserts the guard's behaviour on SERIALISED BYTES through the real route.
 * This file asserts the two things a route test structurally cannot:
 *
 *   1. THE SCAN SURFACE. Every field the guard claims to cover is covered, one
 *      assertion per field. A route test can only prove the fields a fixture
 *      happens to populate; the coverage CLAIM needs a field-by-field manifest
 *      (the estate's evidence rule).
 *   2. NEVER THROWS. Feeding the real route a malformed envelope is not
 *      possible — the boundary schema rejects it long before egress. The
 *      degrade path is only reachable by calling the guard directly.
 *
 * Every absence assertion here is paired with a POSITIVE CONTROL on the same
 * field, so a scanner that silently stopped looking at a field fails in the
 * present direction rather than passing in the absent one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findLeaderClaims,
  guardLeadingOptionClaimsAtEgress,
} from '../leading-option-egress-guard.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { ExerciseBlockSchema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';

/** Minimal envelope; `patch` overlays the field under test. */
function envelope(patch: Record<string, unknown> = {}): OlumiResponse {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    blocks: [],
    suggested_actions: [],
    insights: [],
    ...patch,
  } as unknown as OlumiResponse;
}

const LEADER_PROSE = 'The MacBook Pro leads by a margin of about 52 percentage points.';
const CLEAN_PROSE = 'Three factors shape this outcome; two of them are uncertain.';

describe('findLeaderClaims — the scan surface, field by field', () => {
  // ── Top-level prose ────────────────────────────────────────────────────────
  it('scans assistant_text', () => {
    expect(findLeaderClaims(envelope({ assistant_text: LEADER_PROSE })).map((h) => h.path))
      .toEqual(['assistant_text']);
    expect(findLeaderClaims(envelope({ assistant_text: CLEAN_PROSE }))).toEqual([]);
  });

  it('scans framing_question — the UI renders it VERBATIM and nothing else scanned it', () => {
    expect(findLeaderClaims(envelope({ framing_question: LEADER_PROSE })).map((h) => h.path))
      .toEqual(['framing_question']);
    expect(findLeaderClaims(envelope({ framing_question: CLEAN_PROSE }))).toEqual([]);
  });

  it('scans decision_classification.horizon', () => {
    const hit = findLeaderClaims(
      envelope({ decision_classification: { horizon: 'Until the leading option changes' } }),
    );
    expect(hit.map((h) => h.path)).toEqual(['decision_classification.horizon']);
    expect(
      findLeaderClaims(envelope({ decision_classification: { horizon: 'Next quarter' } })),
    ).toEqual([]);
  });

  // ── Block prose, per field ─────────────────────────────────────────────────
  //
  // `signal` is the load-bearing one: `sanitiseBlock` walks title / body /
  // action_label and the evidence quartet, and SKIPS `signal`. It is a
  // 140-char user-visible line that nothing scanned before this guard.
  for (const field of [
    'title',
    'body',
    'signal',
    'action_label',
    'factor_label',
    'evidence_gap',
    'suggested_technique',
    'impact_if_gathered',
    'note',
  ] as const) {
    it(`scans blocks[].${field}`, () => {
      const present = findLeaderClaims(
        envelope({ blocks: [{ type: 'review_card', [field]: LEADER_PROSE }] }),
      );
      expect(present.map((h) => h.path), `blocks[].${field} is unscanned`).toEqual([
        `blocks[0].${field}`,
      ]);
      // Positive control on the SAME field: clean copy must not fire, so the
      // assertion above is detecting the claim and not merely the field.
      expect(
        findLeaderClaims(envelope({ blocks: [{ type: 'review_card', [field]: CLEAN_PROSE }] })),
      ).toEqual([]);
    });
  }

  it('scans every block in the array, not just the first', () => {
    const hits = findLeaderClaims(
      envelope({
        blocks: [
          { type: 'review_card', body: CLEAN_PROSE },
          { type: 'review_card', body: LEADER_PROSE },
          { type: 'coaching', body: 'the right combination of factors could tip which option leads' },
        ],
      }),
    );
    expect(hits.map((h) => h.path)).toEqual(['blocks[1].body', 'blocks[2].body']);
  });

  // ── The enrichment blob ────────────────────────────────────────────────────
  //
  // The G-CEE-1 walk's matcher EXCLUDED this blob as "wire data, not rendered
  // copy". That exclusion was wrong: DecisionGuideAI's applyV5State maps
  // `blocks[].enrichment.decision_review` onto `runMeta.ceeReviewV1` and
  // renders it. `story_headlines` is an explicit per-option RANKING.
  it('scans blocks[].enrichment.decision_review.narrative_summary', () => {
    const hits = findLeaderClaims(
      envelope({
        blocks: [
          {
            type: 'analysis_result',
            enrichment: { decision_review: { narrative_summary: LEADER_PROSE } },
          },
        ],
      }),
    );
    expect(hits.map((h) => h.path)).toEqual([
      'blocks[0].enrichment.decision_review.narrative_summary',
    ]);
  });

  it('scans every entry of blocks[].enrichment.decision_review.story_headlines', () => {
    const hits = findLeaderClaims(
      envelope({
        blocks: [
          {
            type: 'analysis_result',
            enrichment: {
              decision_review: {
                story_headlines: [CLEAN_PROSE, 'MacBook Pro is ahead', 'Dell is the best option'],
              },
            },
          },
        ],
      }),
    );
    expect(hits.map((h) => h.path)).toEqual([
      'blocks[0].enrichment.decision_review.story_headlines[1]',
      'blocks[0].enrichment.decision_review.story_headlines[2]',
    ]);
  });

  // ── The pattern bank ───────────────────────────────────────────────────────
  //
  // Sourced from the G-CEE-1 walk's own matcher, so a string this guard misses
  // is one the acceptance walk would also miss. The three bodies below are the
  // VERBATIM live-staging failures (build 1c078f0).
  it.each([
    ['blocks[1].body, live', 'The MacBook Pro leads by a margin of about 52 percentage points, but this result relies on assumptions.'],
    ['blocks[2].body, live', 'The current result is not robust, as the lead depends on assumptions about onboarding friction.'],
    ['blocks[13].body, live', 'No single factor is decisive here, but the right combination of factors could tip which option leads.'],
    ['lens WIN_PROB_MODERATE', 'The leading option is ahead, but not by a wide margin.'],
    ['lens DOMINANT_DRIVER', 'A sensitivity check shows how far it can move before the leading option changes.'],
    ['terminology-rewrite output', 'Follow the leading option for now.'],
    ['recommendation', 'Our recommendation is to proceed.'],
    ['winner', 'The winner is clear.'],
    ['best option', 'Dell is the best option here.'],
  ])('catches the leader claim in %s', (_label, prose) => {
    expect(findLeaderClaims(envelope({ blocks: [{ type: 'review_card', body: prose }] })))
      .toHaveLength(1);
  });

  it('does NOT fire on prose that names no leader (the false-positive direction)', () => {
    for (const prose of [
      'Two factors dominate this result and both are uncertain.',
      'Re-state that limit against a measure recorded in the same units as the limit.',
      'The analysis engine could not evaluate it against this model, so no option can be put forward yet.',
      'Imagine this decision has failed: what went wrong?',
    ]) {
      expect(findLeaderClaims(envelope({ blocks: [{ type: 'review_card', body: prose }] })), prose)
        .toEqual([]);
    }
  });
});

describe('guardLeadingOptionClaimsAtEgress — behaviour', () => {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  beforeEach(() => {
    events.length = 0;
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, unknown> });
    });
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  const opts = { requestId: 'req-1', exitPath: 'test', enforce: false };

  it('is a NO-OP when the turn may name a leading option', () => {
    const res = envelope({ blocks: [{ type: 'review_card', body: LEADER_PROSE }] });
    expect(guardLeadingOptionClaimsAtEgress(res, { ...opts, mayNameLeadingOption: true })).toBe(res);
    expect(events).toEqual([]);
  });

  it('emits nothing when the claim is withheld and no leader copy is present', () => {
    const res = envelope({ blocks: [{ type: 'review_card', body: CLEAN_PROSE }] });
    expect(guardLeadingOptionClaimsAtEgress(res, { ...opts, mayNameLeadingOption: false })).toBe(res);
    expect(events).toEqual([]);
  });

  it('OBSERVE-ONLY: reports the violation and returns the response BYTE-IDENTICAL', () => {
    const res = envelope({ blocks: [{ type: 'review_card', body: LEADER_PROSE }] });
    const out = guardLeadingOptionClaimsAtEgress(res, { ...opts, mayNameLeadingOption: false });
    // Identity, not deep-equality: observe-only must not even clone.
    expect(out).toBe(res);
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('v5.egress.leading_option_claim_withheld_violated');
    expect(events[0]!.data.hit_count).toBe(1);
    expect(events[0]!.data.reason).toBe('leads');
    // `dropped: false` is the whole point of the observe-only ship — it makes
    // the pre-enforcement period countable apart from enforcement.
    expect(events[0]!.data.dropped).toBe(false);
  });

  it('the telemetry payload carries NO prose — only bounded scalars', () => {
    const res = envelope({ blocks: [{ type: 'review_card', body: LEADER_PROSE }] });
    guardLeadingOptionClaimsAtEgress(res, { ...opts, mayNameLeadingOption: false });
    const payload = JSON.stringify(events[0]!.data);
    expect(payload).not.toContain('MacBook');
    expect(payload).not.toContain('percentage points');
    // Field paths travel on the log.error payload, never on the event.
    expect(payload).not.toContain('blocks[0].body');
    expect(Object.keys(events[0]!.data).sort()).toEqual(
      ['dropped', 'exit_path', 'hit_count', 'reason', 'request_id'].sort(),
    );
  });

  it('NEVER THROWS on a malformed envelope — it degrades and names the invariant', () => {
    // A getter that throws is the cheapest total stand-in for "the scan hit
    // something it could not read". The house rule is absolute: a 500 at egress
    // is worse than the prose the guard is watching for.
    const hostile = envelope();
    Object.defineProperty(hostile, 'blocks', {
      get() {
        throw new Error('exploding envelope');
      },
    });
    let out: OlumiResponse | undefined;
    expect(() => {
      out = guardLeadingOptionClaimsAtEgress(hostile, { ...opts, mayNameLeadingOption: false });
    }).not.toThrow();
    expect(out).toBe(hostile);
    expect(events).toHaveLength(1);
    expect(events[0]!.data.reason).toBe('scan_failed');
    expect(events[0]!.data.dropped).toBe(false);
  });

  it('dedupes and sorts the reported codes so the event stays low-cardinality', () => {
    const res = envelope({
      blocks: [
        { type: 'review_card', body: 'The MacBook Pro leads.' },
        { type: 'review_card', body: 'Dell leads on cost.' },
        { type: 'coaching', body: 'Our recommendation stands.' },
      ],
    });
    guardLeadingOptionClaimsAtEgress(res, { ...opts, mayNameLeadingOption: false });
    expect(events[0]!.data.hit_count).toBe(3);
    // Primary code only on the tag; `leads` sorts before `recommend`.
    expect(events[0]!.data.reason).toBe('leads');
  });
});

// ===========================================================================
// EXERCISE-BLOCK PROSE COVERAGE (capability P1 / CEE #770 adversarial review B1)
//
// Until #770 the `exercise` block kind had no V5 producer, and none of its six
// prose fields were in `BLOCK_PROSE_FIELDS`. That made the 2.149 scope block's
// stated justification for leaving `blocks[]` out of WIRE enforcement — "the
// alarm keeps observing them" — FALSE for this block kind.
//
// The paired probe that established it, reproduced verbatim as the first test
// below: the SAME roster sentence in the exercise prose fields returned ZERO
// hits while `review_card.body` returned one. That pairing is what makes these
// assertions field-driven rather than vacuous — a scanner that had simply
// stopped working would fail the `review_card` arm too.
// ===========================================================================

describe('findLeaderClaims — ExerciseBlock prose (B1)', () => {
  const ROSTER = 'The MacBook Pro leads by a margin of about 52 percentage points.';

  function exerciseBlock(patch: Record<string, unknown>): Record<string, unknown> {
    return {
      type: 'exercise',
      exercise_kind: 'pre_mortem',
      target_refs: [],
      ...patch,
    };
  }

  it('THE PAIRED PROBE — the roster sentence is seen in exercise prose AND in review_card.body', () => {
    const inExercise = findLeaderClaims(
      envelope({
        blocks: [
          exerciseBlock({
            failure_scenario: ROSTER,
            warning_signs: [ROSTER],
            mitigation: ROSTER,
            reference_class: ROSTER,
            counter_case: ROSTER,
            review_trigger: ROSTER,
          }),
        ],
      }),
    );
    // The control leg: the identical sentence on an already-covered field. If
    // this ever stops hitting, the probe is measuring a broken scanner and the
    // exercise leg's result means nothing.
    const inReviewCard = findLeaderClaims(
      envelope({ blocks: [{ type: 'review_card', card_kind: 'narrative', body: ROSTER }] }),
    );

    expect(inReviewCard.map((h) => h.path)).toEqual(['blocks[0].body']);
    expect(inExercise.map((h) => h.path).sort()).toEqual(
      [
        'blocks[0].counter_case',
        'blocks[0].failure_scenario',
        'blocks[0].mitigation',
        'blocks[0].reference_class',
        'blocks[0].review_trigger',
        'blocks[0].warning_signs[0]',
      ].sort(),
    );
  });

  // One assertion per field, each with its own clean-prose negative — the
  // file's established "coverage CLAIM needs a field-by-field manifest" rule.
  for (const field of [
    'failure_scenario',
    'mitigation',
    'reference_class',
    'counter_case',
    'review_trigger',
  ] as const) {
    it(`scans exercise.${field}`, () => {
      expect(
        findLeaderClaims(envelope({ blocks: [exerciseBlock({ [field]: ROSTER })] })).map(
          (h) => h.path,
        ),
      ).toEqual([`blocks[0].${field}`]);
      expect(
        findLeaderClaims(envelope({ blocks: [exerciseBlock({ [field]: CLEAN_PROSE })] })),
      ).toEqual([]);
    });
  }

  it('scans EVERY entry of the warning_signs ARRAY, with indexed paths', () => {
    // `scanString` early-returns on non-strings, so listing `warning_signs` in
    // BLOCK_PROSE_FIELDS without array handling would read as coverage and scan
    // NOTHING. This is the assertion that separates the two.
    const hits = findLeaderClaims(
      envelope({
        blocks: [
          exerciseBlock({
            warning_signs: [CLEAN_PROSE, 'Dell XPS is ahead on cost.', CLEAN_PROSE, ROSTER],
          }),
        ],
      }),
    );
    expect(hits.map((h) => h.path)).toEqual([
      'blocks[0].warning_signs[1]',
      'blocks[0].warning_signs[3]',
    ]);
    expect(
      findLeaderClaims(
        envelope({ blocks: [exerciseBlock({ warning_signs: [CLEAN_PROSE, CLEAN_PROSE] })] }),
      ),
    ).toEqual([]);
  });

  it('tolerates a malformed warning_signs (non-array, non-string entries) without throwing', () => {
    expect(() =>
      findLeaderClaims(
        envelope({
          blocks: [
            exerciseBlock({ warning_signs: 'not an array but still prose — Dell leads.' }),
            exerciseBlock({ warning_signs: [null, 42, { a: 1 }, ROSTER] }),
          ],
        }),
      ),
    ).not.toThrow();
    const hits = findLeaderClaims(
      envelope({
        blocks: [
          exerciseBlock({ warning_signs: 'not an array but still prose — Dell leads.' }),
          exerciseBlock({ warning_signs: [null, 42, { a: 1 }, ROSTER] }),
        ],
      }),
    );
    // A non-array string still scans (scalar path); non-string entries skip.
    expect(hits.map((h) => h.path)).toEqual([
      'blocks[0].warning_signs',
      'blocks[1].warning_signs[3]',
    ]);
  });

  /**
   * THE DRIFT GUARD — and it is BEHAVIOURAL, not a list comparison.
   *
   * The obvious form is "assert every prose key of `ExerciseBlockSchema` appears
   * in `BLOCK_PROSE_FIELDS`". That form is exactly the vacuity this amendment
   * was raised to fix: `warning_signs` WAS going to be in the list and STILL
   * scan nothing, because `scanString` early-returns on arrays. A membership
   * check would have gone green on a blind scanner.
   *
   * So the derivation drives the SCANNER instead: for every schema key not
   * explicitly classified as structured/metadata, put a known leader claim in
   * that field and require a hit. A future schema minor that adds an exercise
   * prose field REDs here — unobserved-by-default is how `signal` and `summary`
   * got into this list years late — and a field that is listed but unscannable
   * REDs too.
   */
  it('every prose-bearing ExerciseBlockSchema key is actually SCANNED (derived, behavioural)', () => {
    const STRUCTURED_OR_METADATA = new Set([
      'block_id',
      'signal_id',
      'created_at',
      'source_handler',
      'graph_hash_at_generation',
      'freshness',
      'type',
      'exercise_kind',
      'target_element_ref',
      'target_refs',
      'category',
      'priority',
      'signal_code',
    ]);
    const proseKeys = Object.keys(ExerciseBlockSchema.shape).filter(
      (k) => !STRUCTURED_OR_METADATA.has(k),
    );
    // Non-vacuity: the derivation must actually yield the fields we know exist,
    // including the array one and the already-covered `signal`.
    expect(proseKeys.length).toBeGreaterThanOrEqual(7);
    expect(proseKeys).toContain('warning_signs');
    expect(proseKeys).toContain('signal');

    // A SCHEMA-VALID exercise block, so the array-vs-scalar question below is
    // answered by the contract rather than by poking at Zod internals.
    const VALID_BASE = {
      block_id: '550e8400-e29b-41d4-a716-446655440099',
      signal_id: 'exercise:pre_mortem:gh',
      created_at: '2026-07-31T09:00:00.000Z',
      source_handler: 'decision_review_enricher',
      graph_hash_at_generation: 'gh_drift_guard',
      freshness: 'fresh',
      type: 'exercise',
      exercise_kind: 'pre_mortem',
      target_refs: [],
    } as const;

    for (const key of proseKeys) {
      // Ask the CONTRACT which shape this key takes. Guessing wrong would make
      // this whole loop vacuous for `warning_signs`: a bare string in that field
      // hits via the scalar path even when array handling is absent (see the
      // malformed-input test above), so a mis-shaped payload would pass while
      // the real array stayed invisible — the exact failure this amendment fixes.
      const arrayForm = ExerciseBlockSchema.safeParse({ ...VALID_BASE, [key]: [ROSTER] }).success;
      const scalarForm = ExerciseBlockSchema.safeParse({ ...VALID_BASE, [key]: ROSTER }).success;
      expect(
        arrayForm || scalarForm,
        `could not construct a schema-valid payload for exercise prose key '${key}'`,
      ).toBe(true);

      const hits = findLeaderClaims(
        envelope({ blocks: [{ ...VALID_BASE, [key]: arrayForm ? [ROSTER] : ROSTER }] }),
      );
      expect(
        hits.length,
        `ExerciseBlockSchema prose key '${key}' is INVISIBLE to the Layer-3 alarm — ` +
          'add it to BLOCK_PROSE_FIELDS (and give it array handling if it is an array)',
      ).toBeGreaterThan(0);
      // …and name the path, so a hit that came from some OTHER field cannot
      // stand in for this one.
      expect(hits.some((h) => h.path.startsWith(`blocks[0].${key}`))).toBe(true);
    }
  });
});
