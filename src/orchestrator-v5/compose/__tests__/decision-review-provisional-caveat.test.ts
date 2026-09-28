/**
 * ⭐⭐ THE THIRD SURFACE — `enrichment.decision_review`, which got the
 *    entitlement and none of the caveat.
 *
 * ⛔ THE DEFECT, AND WHY NO EXISTING SUITE COULD SEE IT. The permit-with-caveat
 *    arm qualified `assistant_text` and `analysis_result.summary`. The product
 *    has a THIRD user-facing narrative on the SAME block, built by the same
 *    turn: `enrichment.decision_review`. It conjoins only the ENTITLEMENT term
 *    (`decision-review-enricher.ts`, keyed on `mayNameLeadingOption` alone) and
 *    received no qualification at all. Each surface was correct in isolation and
 *    every suite was green — CLAUDE.md trap 21, exactly.
 *
 * ⭐ THE FIXTURE IS A REAL CAPTURE, NOT AUTHORED HERE (CLAUDE.md trap 22 / the
 *    16-inverse rule: *a fixture you wrote yourself is not evidence about the
 *    wire*). `fixtures/beat6-decision-review-capture.json` is the response body
 *    the DEPLOYED product served on staging build `d536aae`, guest scenario
 *    `914266c1`, beat 6, banked at
 *    `output/journey-witness-20260921/beat6-analyse.json`. It is an APPEND-ONLY
 *    RECORD of what the product once said and must never be edited to keep it
 *    current (trap 14b).
 *
 * ⭐⭐ THIS SUITE PINS ITS OWN PRECONDITION, which is the whole reason it is not
 *    a tautology. Case (0) asserts that ON THIS PAYLOAD the two conjuncts
 *    GENUINELY DISAGREE — entitlement `true`, admission `false` — and that the
 *    captured blob genuinely contradicts itself. Without that, cases (1)-(2)
 *    could pass on a payload where nothing was ever at stake and there would be
 *    no red anywhere (trap 21's own detection note).
 *
 * Synthetic harness over captured bytes. No provider, browser or DB call.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { OlumiResponseSchema, type OlumiResponse } from '@talchain/schemas/boundary';

import { analysisReadyPermitsLeaderNaming } from '../../admission/analysis-admission.js';
import {
  enforceLeadingOptionClaimsAtWire,
  PROVISIONAL_FIGURES_CAVEAT,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';

interface Capture {
  readonly assistant_text: string;
  readonly analysis_admission: Record<string, unknown>;
  readonly analysis_state_leader_claim: { readonly permitted?: unknown };
  readonly analysis_result_block: Record<string, unknown>;
}

const CAPTURE = JSON.parse(
  readFileSync(
    new URL('./fixtures/beat6-decision-review-capture.json', import.meta.url),
    'utf8',
  ),
) as Capture;

/** The admission exactly as the deployed product emitted it on beat 6. */
const CAPTURED_READINESS = { analysis_admission: CAPTURE.analysis_admission };

/**
 * The same shape with the claim cap LIFTED — the one restriction that must keep
 * the arm shut. Built by replacing a single member of the captured admission so
 * the contrast differs from the target in exactly one respect.
 */
const FULL_LEADER_READINESS = {
  analysis_admission: {
    ...CAPTURE.analysis_admission,
    permitted_analysis_mode: 'comparative_leader',
  },
};

/**
 * Deliberately NOT pre-qualified. The CAPTURED `assistant_text` already carries
 * the caveat (it was captured downstream of this very arm), so reusing it would
 * make the answer limb a no-op and hide which member actually moved.
 */
const UNQUALIFIED_ANSWER =
  'Move Upmarket Into Enterprise scored highest against your goal in 66% of runs of this model.';

function envelope(): OlumiResponse {
  return OlumiResponseSchema.parse({
    response_version: 2,
    assistant_text: UNQUALIFIED_ANSWER,
    blocks: [CAPTURE.analysis_result_block],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  });
}

/** Bind by IDENTITY — the `analysis_result` block, never "the first block". */
function analysisResultBlock(response: OlumiResponse): Record<string, unknown> {
  const block = response.blocks.find(
    (candidate) => (candidate as { type?: unknown }).type === 'analysis_result',
  );
  if (block === undefined) throw new Error('no analysis_result block');
  return block as Record<string, unknown>;
}

function decisionReview(response: OlumiResponse): Record<string, unknown> {
  const enrichment = analysisResultBlock(response).enrichment as Record<string, unknown>;
  return enrichment.decision_review as Record<string, unknown>;
}

function readinessRationale(response: OlumiResponse): string {
  return decisionReview(response).readiness_rationale as string;
}

function summary(response: OlumiResponse): string {
  return analysisResultBlock(response).summary as string;
}

const BASE = {
  requestId: 'decision-review-provisional-caveat',
  exitPath: 'edit_graph' as const,
  graph: null,
};

function enforce(readiness: unknown) {
  return enforceLeadingOptionClaimsAtWire(envelope(), {
    ...BASE,
    mayNameLeadingOption: true,
    analysisReady: readiness,
    separationEstablished: true,
  });
}

describe('decision_review carries the provisional caveat on the permit-with-caveat arm', () => {
  it('(0) PRECONDITION — the two conjuncts DISAGREE on this payload, and the blob contradicts itself', () => {
    // ⭐ WITHOUT THIS CASE THE SUITE IS A TAUTOLOGY. It asserts that the payload
    //    under test is one where the entitlement says yes and the admission says
    //    no — i.e. that a caveat is genuinely owed — rather than one where the
    //    arm would have fired for some unrelated reason.
    expect(CAPTURE.analysis_state_leader_claim.permitted).toBe(true);
    expect(analysisReadyPermitsLeaderNaming(CAPTURED_READINESS)).toBe(false);
    expect(CAPTURE.analysis_admission.permitted_analysis_mode).toBe('quantified_provisional');

    // And the contrast DISCRIMINATES: the same reader says yes once the cap is
    // lifted, so the `false` above is the mode's doing and not a blind probe.
    expect(analysisReadyPermitsLeaderNaming(FULL_LEADER_READINESS)).toBe(true);

    // The captured run had NO user-stated material parameters — which is what
    // makes "well evidenced" a false claim rather than a stylistic one.
    const signals = CAPTURE.analysis_admission.semantic_signals as Record<string, unknown>;
    expect(signals.material_parameters_user_stated).toBe(0);
    expect(signals.confidence_parameters_user_stated).toBe(0);

    // ⛔ THE SELF-CONTRADICTION, pinned at the captured bytes. These two
    //    sentences were served inside ONE 5 KB object, on one screen.
    const captured = CAPTURE.analysis_result_block.enrichment as Record<string, unknown>;
    const review = captured.decision_review as Record<string, unknown>;
    expect(review.readiness_rationale as string).toContain('settled enough to act on');
    expect(review.readiness_rationale as string).toContain('well evidenced');
    expect(
      (review.robustness_explanation as Record<string, unknown>).summary as string,
    ).toContain('directional rather than settled');

    // And it arrived UNQUALIFIED — the defect this suite exists to hold closed.
    expect(review.readiness_rationale as string).not.toContain(PROVISIONAL_FIGURES_CAVEAT);
  });

  it('(1) the caveat reaches decision_review.readiness_rationale, and the prose is KEPT', () => {
    const result = enforce(CAPTURED_READINESS);
    expect(result.changed).toBe(true);
    expect(result.blocksProjected).toBe(true);

    const rationale = readinessRationale(result.response);
    expect(rationale).toContain(PROVISIONAL_FIGURES_CAVEAT);
    // CAVEAT, NOT WITHHOLD. The producer's sentence survives verbatim — nothing
    // is removed, reworded or replaced.
    const original = (
      (CAPTURE.analysis_result_block.enrichment as Record<string, unknown>)
        .decision_review as Record<string, unknown>
    ).readiness_rationale as string;
    expect(rationale.startsWith(original)).toBe(true);
    expect(rationale).not.toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('(2) all three surfaces carry ONE interpretation from the same decision', () => {
    const result = enforce(CAPTURED_READINESS);
    expect(result.response.assistant_text).toContain(PROVISIONAL_FIGURES_CAVEAT);
    expect(summary(result.response)).toContain(PROVISIONAL_FIGURES_CAVEAT);
    expect(readinessRationale(result.response)).toContain(PROVISIONAL_FIGURES_CAVEAT);
  });

  it('(3) NARROW — no other decision_review member is touched', () => {
    // The fix attaches the caveat to the member that measurably carried the
    // claim. It is not a wording sweep over LLM prose, and this case REDs if it
    // ever becomes one.
    const before = (
      (CAPTURE.analysis_result_block.enrichment as Record<string, unknown>)
        .decision_review as Record<string, unknown>
    );
    const after = decisionReview(enforce(CAPTURED_READINESS).response);

    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      if (key === 'readiness_rationale') continue;
      expect(JSON.stringify(after[key])).toBe(JSON.stringify(before[key]));
    }
    // Named explicitly, because these are the two members a widening would take
    // first and a key-count check alone would not notice a reworded value.
    expect(after.narrative_summary).toBe(before.narrative_summary);
    expect(JSON.stringify(after.robustness_explanation)).toBe(
      JSON.stringify(before.robustness_explanation),
    );
  });

  it('(4) IDEMPOTENT — re-running the arm is byte-identical', () => {
    const once = enforce(CAPTURED_READINESS);
    const twice = enforceLeadingOptionClaimsAtWire(once.response, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: CAPTURED_READINESS,
      separationEstablished: true,
    });
    expect(twice.changed).toBe(false);
    expect(readinessRationale(twice.response)).toBe(readinessRationale(once.response));
    // Identity on our own constant: exactly one occurrence, never two.
    expect(readinessRationale(twice.response).split(PROVISIONAL_FIGURES_CAVEAT)).toHaveLength(2);
  });

  it('(5) THE RESTRICTION DOES NOT MOVE — a full comparative-leader admission leaves the blob alone', () => {
    // Lifting the cap takes the OTHER branch (`analysisReadyPermitsLeaderNaming`
    // ⇒ unchanged). The decision_review must then be byte-identical to what the
    // producer set — this arm never qualifies a run that was fully licensed.
    const result = enforce(FULL_LEADER_READINESS);
    expect(result.changed).toBe(false);
    expect(readinessRationale(result.response)).not.toContain(PROVISIONAL_FIGURES_CAVEAT);
  });

  it('(6) UNENTITLED turns still DROP the blob whole — the two paths do not collide', () => {
    // ⭐ MEASURED, AND IT CORRECTED THIS CASE'S FIRST DRAFT. I wrote it
    //    expecting "untouched"; the run showed `decision_review` is dropped
    //    ENTIRELY on a withheld turn, by `withheld-claim-projection.ts`'s
    //    `WITHHELD_DROPPED_ENRICHMENT_BLOBS`, while the other thirteen
    //    enrichment keys survive. That is the correct behaviour and the
    //    stronger fact, so it is pinned rather than worked around.
    //
    //    It matters for THIS change: a withheld turn must keep dropping, and a
    //    permit-with-caveat turn must keep qualifying. Two different questions,
    //    two different instruments (CLAUDE.md trap 21). This case REDs if a
    //    future edit lets the caveat arm reach a withheld turn, or lets the drop
    //    reach a permitted one.
    const result = enforceLeadingOptionClaimsAtWire(envelope(), {
      ...BASE,
      mayNameLeadingOption: false,
      analysisReady: CAPTURED_READINESS,
      separationEstablished: true,
    });
    const enrichment = analysisResultBlock(result.response).enrichment as Record<string, unknown>;
    expect('decision_review' in enrichment).toBe(false);
    // Contrast in the same assertion: the drop is SCOPED, not an enrichment wipe.
    expect('robustness' in enrichment).toBe(true);
    expect('decision_brief' in enrichment).toBe(true);
  });

  it('(7) a block with no decision_review is byte-identical through the same arm', () => {
    const stripped = OlumiResponseSchema.parse({
      response_version: 2,
      assistant_text: UNQUALIFIED_ANSWER,
      blocks: [
        {
          ...CAPTURE.analysis_result_block,
          enrichment: Object.fromEntries(
            Object.entries(CAPTURE.analysis_result_block.enrichment as Record<string, unknown>)
              .filter(([key]) => key !== 'decision_review'),
          ),
        },
      ],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    });
    const result = enforceLeadingOptionClaimsAtWire(stripped, {
      ...BASE,
      mayNameLeadingOption: true,
      analysisReady: CAPTURED_READINESS,
      separationEstablished: true,
    });
    const enrichment = analysisResultBlock(result.response).enrichment as Record<string, unknown>;
    expect('decision_review' in enrichment).toBe(false);
    // The summary limb is unaffected by the new member's absence.
    expect(summary(result.response)).toContain(PROVISIONAL_FIGURES_CAVEAT);
  });
});
