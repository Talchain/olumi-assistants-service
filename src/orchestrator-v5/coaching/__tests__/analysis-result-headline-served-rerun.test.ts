/**
 * ⛔ THE SERVED RERUN (R&C round 2, R3-5; independent review 5831920107).
 *
 * UI a9968d8c · CEE c74a432 (staging), the panel edit-chain witness: the
 * explicit rerun after the user set active seats to 1,500. Its analysis_result
 * block said:
 *
 *   "Raise Price to £50 was supported by 84% of runs of this
 *    model, but treat this as provisional: the link between Price per seat and
 *    Monthly revenue is fragile."
 *
 * while its own warning channel carried GOAL_DIRECTION_UNATTESTED (ranked by
 * the largest goal value, an assumption), GOAL_ANCESTOR_DATA_GAP and
 * ROOT_NODE_DEFAULT_VALUE, and no record carried any attainment field. Round 2
 * would have withdrawn the goal frame but said only "could not test", dropping
 * the direction clause (R3-1). This file pins the served shape itself:
 *   - the headline makes NO goal claim and CARRIES the direction disclosure;
 *   - the leader permission is unchanged (a headline exists with and without
 *     the code, with the same descriptor, as `leader_claim.permitted` says);
 *   - GOAL_ANCESTOR_DATA_GAP and ROOT_NODE_DEFAULT_VALUE alone do NOT withdraw
 *     the goal frame: without the DIRECTION code the headline is the served one,
 *     byte for byte.
 *
 * CAPTURE, not invented: `fixtures/rerun-c74a432.analysis-result-block.trimmed.json`
 * (its `_provenance` names the witness file, the turn, both sha256s and the
 * trim). c1ddb50 (this PR's base) is an ancestor of c74a432, and the headline,
 * the cage and run-analysis.ts are identical between them, so the served
 * headline is today's builder on this envelope; the first assertion below
 * proves it rather than assuming it.
 *
 * ⚠ OUT OF SCOPE, RECORDED HERE SO IT IS NOT MISTAKEN FOR COVERAGE (owner to
 * confirm): the same turn shipped a coaching card, "Strengthen your model:
 * argue the other side", whose body opens "One option is clearly ahead here."
 * That copy comes from `compose/lens-selector.ts:1433` (source_handler
 * decision_review_enricher, signal STRENGTHEN_ITEM), not from this builder, and
 * this lane does not touch lens-selector. PLoT's own
 * `decision_brief.headline_banded.text` ("Raise Price to £50 is clearly ahead.")
 * is producer copy the headline builder does not read; it is dropped by the trim.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  describeGoalFrame,
  isAllowedRunAnalysisAssistantText,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';

type Json = Record<string, unknown>;

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/rerun-c74a432.analysis-result-block.trimmed.json', import.meta.url), 'utf8'),
) as { _provenance: Json; blocks: Json[]; analysis_state: { leader_claim: Json } };
const BLOCK = FIXTURE.blocks[0] as Json;
const ENRICHMENT = BLOCK['enrichment'] as Json;
const SERVED_SUMMARY = BLOCK['summary'] as string;
const LEADER_CLAIM = FIXTURE.analysis_state.leader_claim;

// Spelled as the wire spells them, never imported from the code under test.
const DIRECTION = 'GOAL_DIRECTION_UNATTESTED';
const THRESHOLD = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';
const ANCESTOR = 'GOAL_ANCESTOR_DATA_GAP';
const ROOT_DEFAULT = 'ROOT_NODE_DEFAULT_VALUE';

/** The served headline (goal-framed), the first sentence of the served summary. */
const SERVED_HEADLINE =
  'Raise Price to £50 was supported by 84% of runs of this model,' +
  ' but treat this as provisional: the link between Price per seat and Monthly revenue is fragile.';
/**
 * The same goal-framed headline as TODAY's builder words it. The only difference from the served capture is the link
 * caution (principle audit, 5 Oct: "fragile" retired from user copy); the capture above stays byte-for-byte as served.
 */
const CURRENT_GOAL_FRAMED_HEADLINE =
  'Raise Price to £50 was supported by 84% of runs of this model,' +
  ' but treat this as provisional: it rests heavily on how much Price per seat changes Monthly revenue.';
/** The served summary's scaffold sentence, which run-analysis.ts appends after the headline. */
const SCAFFOLD_SENTENCE = SERVED_SUMMARY.slice(SERVED_HEADLINE.length);

const DIRECTION_CLAUSE = 'In this model I’ve assumed a higher value is better for your goal';
/** What this envelope must now produce: the withdrawn frame plus the combined sentence (R3-1). */
const FIXED_HEADLINE =
  'Raise Price to £50 was supported by 84% of runs of this model,' +
  ' but treat this as provisional: it rests heavily on how much Price per seat changes Monthly revenue.' +
  ' In this model I’ve assumed a higher value is better for your goal,' +
  ' and the model could not test whether any option reaches your goal. If lower is better, set the goal’s target to ‘at most’ and re-run.';

function input(enrichment: Json): AnalysisResultHeadlineInput {
  // RT-10 B′: the handler passes true for a goal whose target is not a change; this envelope's goal is taken as one.
  return { enrichment, leading_option_id: BLOCK['leading_option_id'] as string, status_kind: 'ok', goal_direction_correctable: true };
}

/** The envelope with the warning channel reduced to the entries whose codes are in `keep`. */
function withCodes(keep: readonly string[]): Json {
  const copy = structuredClone(ENRICHMENT);
  copy['inference_warnings'] = (copy['inference_warnings'] as Json[]).filter((w) => keep.includes(w['code'] as string));
  return copy;
}

const codes = (e: Json): string[] => (e['inference_warnings'] as Json[]).map((w) => w['code'] as string);

describe('the served rerun capture (positive controls)', () => {
  it('is the rerun turn it claims to be, from the build it names', () => {
    expect(FIXTURE._provenance['turn_index']).toBe('line 3 of 3 (0-based index 2)');
    expect(String(FIXTURE._provenance['source'])).toContain('CEE c74a432');
    expect(String(FIXTURE._provenance['source'])).toContain('5831920107');
    expect(BLOCK['type']).toBe('analysis_result');
    expect(BLOCK['leading_option_id']).toBe('raise_price_to_50');
  });

  it('carries DIRECTION, ANCESTOR and ROOT_DEFAULT on the warning channel, and no THRESHOLD', () => {
    expect(codes(ENRICHMENT)).toEqual(expect.arrayContaining([DIRECTION, ANCESTOR, ROOT_DEFAULT]));
    expect(codes(ENRICHMENT)).not.toContain(THRESHOLD);
  });

  it('no record carries attainment data (neither Channel A nor Channel B)', () => {
    const records = ENRICHMENT['option_comparison'] as Json[];
    expect(records.length).toBe(3);
    for (const r of records) {
      expect(r['probability_of_goal']).toBeUndefined();
      expect(r['probability_of_joint_goal']).toBeUndefined();
    }
  });

  it('the served summary opens with the goal-claiming headline, and the leader was permitted', () => {
    expect(SERVED_SUMMARY.startsWith(SERVED_HEADLINE)).toBe(true);
    expect(SCAFFOLD_SENTENCE).toContain('was analysed as no change');
    expect(LEADER_CLAIM).toEqual({ permitted: true, separation: 'separated' });
  });

  it('⭐ REPRODUCTION: without the DIRECTION code, today\'s builder on the trimmed envelope gives the served headline, differing only in the caution wording', () => {
    const withoutDirection = withCodes(codes(ENRICHMENT).filter((c) => c !== DIRECTION));
    expect(buildAnalysisResultHeadline(input(withoutDirection))).toBe(CURRENT_GOAL_FRAMED_HEADLINE);
    // The ONLY difference from the served bytes is the reworded caution reason.
    expect(SERVED_HEADLINE.replace(
      'the link between Price per seat and Monthly revenue is fragile',
      'it rests heavily on how much Price per seat changes Monthly revenue',
    )).toBe(CURRENT_GOAL_FRAMED_HEADLINE);
  });
});

describe('⭐ R3-5 — the served rerun shape makes no goal claim and discloses the direction', () => {
  it('the headline is the withdrawn frame plus the combined sentence', () => {
    const text = buildAnalysisResultHeadline(input(ENRICHMENT));
    expect(text).toBe(FIXED_HEADLINE);
    expect(describeGoalFrame(input(ENRICHMENT))).toBe('direction_assumed_and_attainment_untested');
  });

  it('no goal claim anywhere outside the disclosure', () => {
    const text = buildAnalysisResultHeadline(input(ENRICHMENT))!;
    expect(text).not.toMatch(/against\s+your\s+goal/i);
    const beforeDisclosure = text.slice(0, text.indexOf(DIRECTION_CLAUSE));
    expect(beforeDisclosure).not.toMatch(/\byour\s+goal\b/i);
  });

  it('⭐ the direction disclosure rides (DIRECTION is present, so it is never dropped)', () => {
    expect(buildAnalysisResultHeadline(input(ENRICHMENT))).toContain(DIRECTION_CLAUSE);
  });

  it('the composed summary (headline + the served scaffold sentence) is admitted at egress', () => {
    const composed = `${buildAnalysisResultHeadline(input(ENRICHMENT))}${SCAFFOLD_SENTENCE}`;
    expect(isAllowedRunAnalysisAssistantText(composed)).toBe(true);
    // CONTRAST: the served summary with the disclosure appended contradicts itself and is rejected.
    expect(
      isAllowedRunAnalysisAssistantText(
        `${CURRENT_GOAL_FRAMED_HEADLINE} In this model I’ve assumed a higher value is better for your goal,` +
          ` and the model could not test whether any option reaches your goal. If lower is better, set the goal’s target to ‘at most’ and re-run.${SCAFFOLD_SENTENCE}`,
      ),
    ).toBe(false);
  });

  it('⭐ LEADER PERMISSION UNCHANGED: a headline exists with and without the code, with the same descriptor', () => {
    const warned = input(ENRICHMENT);
    const clean = input(withCodes(codes(ENRICHMENT).filter((c) => c !== DIRECTION)));
    expect(buildAnalysisResultHeadline(warned)).not.toBeNull();
    expect(buildAnalysisResultHeadline(clean)).not.toBeNull();
    expect(describeAnalysisHeadline(warned)).toEqual(describeAnalysisHeadline(clean));
    // The served turn permitted the leader; the fixed headline still names it.
    expect(LEADER_CLAIM['permitted']).toBe(true);
    expect(buildAnalysisResultHeadline(warned)!.startsWith('Raise Price to £50 scored highest in 84%')).toBe(true);
  });
});

describe('⭐ R3-5 — GOAL_ANCESTOR_DATA_GAP and ROOT_NODE_DEFAULT_VALUE alone do NOT withdraw the goal frame', () => {
  const CASES: ReadonlyArray<[string, readonly string[]]> = [
    ['ANCESTOR + ROOT_DEFAULT (the served channel minus DIRECTION)', [ANCESTOR, ROOT_DEFAULT]],
    ['ANCESTOR alone', [ANCESTOR]],
    ['ROOT_DEFAULT alone', [ROOT_DEFAULT]],
  ];

  for (const [name, keep] of CASES) {
    it(`${name}: the served headline (today's caution wording), goal frame intact`, () => {
      const e = withCodes(keep);
      expect(codes(e)).toEqual(keep.length === 2 ? [ROOT_DEFAULT, ANCESTOR] : keep);
      expect(buildAnalysisResultHeadline(input(e))).toBe(CURRENT_GOAL_FRAMED_HEADLINE);
      expect(describeGoalFrame(input(e))).toBe('goal_framed');
    });
  }

  it('CONTRAST: the same channel PLUS the served DIRECTION entry does withdraw it (the probe sees a change)', () => {
    const e = withCodes([ANCESTOR, ROOT_DEFAULT, DIRECTION]);
    expect(buildAnalysisResultHeadline(input(e))).toBe(FIXED_HEADLINE);
  });
});
