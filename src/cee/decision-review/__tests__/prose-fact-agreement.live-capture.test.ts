/**
 * PROSE / FACT AGREEMENT — bound to the 2026-09-03 live capture.
 *
 * This is the load-bearing evidence for the seam. Every producer subtree in
 * `fixtures/live-decision-review-2026-09-03.json` is VERBATIM from a real
 * failed founder session (scenario 7826c742, UI build 86786efb) — nothing in
 * it was authored here. That matters: a fixture the author wrote is not
 * evidence about the wire (parent CLAUDE.md trap 16-inverse), and the defect
 * this seam catches is precisely a claim that looked right to whoever wrote
 * the prose.
 *
 * ⚠ THE FIXTURE IS A HISTORIC RECORD AND IS APPEND-ONLY (trap 14b). It pins
 * sentences the product ACTUALLY EMITTED on a dated build. Rewriting it to
 * keep a future assertion green would falsify the record; if the producer's
 * shape changes, add a new dated capture beside it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  VOI_SUPERLATIVE_REPLACEMENT,
  checkProseFactAgreement,
  classifyAssertedMovement,
  deriveEdgeFlipFacts,
  deriveVoiLicence,
} from '../prose-fact-agreement.js';

/**
 * The VOI-bearing half of the invoke input AS THE ENRICHER BUILDS IT for this
 * capture — DERIVED from the capture rather than typed out, so it cannot
 * quietly stop describing it (the first draft of this constant asserted "no
 * evpi_percentage_points at all" and was wrong: the field is present and
 * reads ZERO, which is a stronger fact).
 *
 * The two forwarding rules mirrored here are the ONLY VOI paths into the
 * decision_review prompt, both in `coaching/decision-review-enricher.ts`:
 *   `normaliseDeterministicCoachingFromM1` — `m1_coaching.evidence_gaps` or
 *   `[]` when the key is absent, as it is here;
 *   `normaliseFactorSensitivity` — forwards `evpi_percentage_points` only
 *   when it is a finite number.
 */
function invokeInputAsBuilt(): Record<string, unknown> {
  const enrichment = capture().enrichment;
  const m1 = enrichment.m1_coaching as Record<string, unknown> | undefined;
  const rows = enrichment.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
  return {
    deterministic_coaching: {
      readiness: 'unknown',
      headline_type: 'neutral',
      evidence_gaps: Array.isArray(m1?.evidence_gaps) ? m1.evidence_gaps : [],
      model_critiques: [],
    },
    isl_results: {
      factor_sensitivity: rows.map((r) => {
        const out: Record<string, unknown> = { factor_id: r.factor_id, elasticity: r.elasticity };
        if (typeof r.evpi_percentage_points === 'number' && Number.isFinite(r.evpi_percentage_points)) {
          out.evpi_percentage_points = r.evpi_percentage_points;
        }
        return out;
      }),
    },
  };
}

const CAPTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'live-decision-review-2026-09-03.json'), 'utf8'),
) as {
  enrichment: Record<string, unknown>;
  decision_review_output: Record<string, unknown>;
};

/** Deep clone so one test can never leak a redaction into another's input. */
function capture(): { enrichment: Record<string, unknown>; review: Record<string, unknown> } {
  const clone = JSON.parse(JSON.stringify(CAPTURE)) as typeof CAPTURE;
  return { enrichment: clone.enrichment, review: clone.decision_review_output };
}

const SALES_TO_RUNWAY = '919d7f50->428612e0';
const CAC_TO_GOAL = 'bbbbd8f2->552bd1c0';

describe('live capture — the producer fact', () => {
  it('carries a signed flip requirement for both narrated edges', () => {
    const { enrichment } = capture();
    const facts = deriveEdgeFlipFacts(enrichment);

    // POSITIVE CONTROL FIRST: the derivation must see a plausible number of
    // rows. The capture holds 11 edge_e_values rows; a derivation that read
    // zero, or one, would agree with every "no fact available" outcome below
    // while measuring nothing.
    expect(facts.size).toBe(11);

    expect(facts.get('919d7f50|428612e0')?.requirement).toBe('weaker');
    expect(facts.get('bbbbd8f2|552bd1c0')?.requirement).toBe('weaker');
  });

  it('spells the SAME edge two ways in one payload, so an id-string join reads zero', () => {
    // CONTRAST CONTROL for the join hazard. `fragile_edges` / the
    // scenario_contexts keys use "from->to"; `edge_e_values` uses "from::to".
    // A join on the literal id must find NOTHING — if this ever starts
    // passing, the endpoint join in the module has been quietly replaced by a
    // string join and every directional check has degraded to "ungrounded".
    const { enrichment } = capture();
    const eValueIds = new Set(
      (enrichment.edge_e_values as ReadonlyArray<Record<string, unknown>>).map(
        (r) => r.edge_id as string,
      ),
    );
    const fragileIds = (
      (enrichment.robustness as Record<string, unknown>)
        .fragile_edges as ReadonlyArray<Record<string, unknown>>
    ).map((r) => r.edge_id as string);

    expect(fragileIds).toContain(SALES_TO_RUNWAY);
    expect(eValueIds.has(SALES_TO_RUNWAY)).toBe(false);
    expect(eValueIds.has('919d7f50::428612e0')).toBe(true);
    // …and the endpoint join DOES resolve it — the discriminating half.
    expect(deriveEdgeFlipFacts(enrichment).has('919d7f50|428612e0')).toBe(true);
  });

  it('derives WEAKER from a negative edge whose flip_direction reads "increase"', () => {
    // The trap this pins: bbbbd8f2::552bd1c0 has current_mean −0.5 and
    // flip_direction "increase", which moves the weight to −0.079 — the harm
    // getting SMALLER. Anything that maps "increase" onto "the phenomenon
    // gets worse" inverts exactly the sentence under test.
    const { enrichment } = capture();
    const row = (enrichment.edge_e_values as ReadonlyArray<Record<string, unknown>>).find(
      (r) => r.edge_id === 'bbbbd8f2::552bd1c0',
    );
    expect(row?.flip_direction).toBe('increase');
    expect(row?.current_mean).toBeLessThan(0);
    expect(deriveEdgeFlipFacts(enrichment).get('bbbbd8f2|552bd1c0')?.requirement).toBe('weaker');
  });
});

describe('live capture — the prose', () => {
  it('asserts a STRONGER link in both narrated triggers', () => {
    const { review } = capture();
    const scenarios = review.scenario_contexts as Record<
      string,
      { trigger_description: string; consequence: string }
    >;
    expect(classifyAssertedMovement(scenarios[SALES_TO_RUNWAY].trigger_description)).toBe(
      'stronger',
    );
    expect(classifyAssertedMovement(scenarios[CAC_TO_GOAL].trigger_description)).toBe('stronger');
  });

  it('names an option the producer also names, so the WHO was never the defect', () => {
    // Worth pinning because it refutes the obvious first hypothesis. The
    // producer's own `alternative_winner_id` for both edges IS
    // 05f973ef / "Hire a Dedicated Sales Team" — the model read that field
    // correctly. Only the DIRECTION was invented, because no direction was
    // supplied. A fix aimed at the option name would have found nothing.
    const { enrichment, review } = capture();
    const fragile = (enrichment.robustness as Record<string, unknown>)
      .fragile_edges as ReadonlyArray<Record<string, unknown>>;
    const row = fragile.find((r) => r.edge_id === SALES_TO_RUNWAY);
    expect(row?.alternative_winner_label).toBe('Hire a Dedicated Sales Team');
    const scenarios = review.scenario_contexts as Record<string, { consequence: string }>;
    expect(scenarios[SALES_TO_RUNWAY].consequence).toContain('Hire a Dedicated Sales Team');
  });
});

describe('live capture — the seam', () => {
  it('redacts both inverted scenarios and reports them as contradictions', () => {
    const { enrichment, review } = capture();
    const before = Object.keys(review.scenario_contexts as Record<string, unknown>);
    expect(before).toEqual([SALES_TO_RUNWAY, CAC_TO_GOAL]);

    const result = checkProseFactAgreement(review, enrichment);

    expect(result.redactedContradicted).toBe(2);
    expect(result.redactedUngrounded).toBe(0);
    expect(result.unclassifiedKept).toBe(0);
    expect(Object.keys(result.output.scenario_contexts as Record<string, unknown>)).toEqual([]);
    expect(result.violations).toEqual([
      { rule: 'directional_claim_contradicts_flip_fact', observed: 2 },
    ]);
  });

  it('never mutates the caller’s review object', () => {
    const { enrichment, review } = capture();
    checkProseFactAgreement(review, enrichment);
    expect(Object.keys(review.scenario_contexts as Record<string, unknown>)).toHaveLength(2);
  });

  it('leaves every other authored field byte-identical', () => {
    // The remedy is targeted. A seam that quietly rewrote the narrative or
    // dropped a headline would be a different and larger change than the one
    // reviewed.
    const { enrichment, review } = capture();
    const result = checkProseFactAgreement(review, enrichment);
    for (const key of Object.keys(review)) {
      if (key === 'scenario_contexts') continue;
      expect(result.output[key]).toEqual(review[key]);
    }
  });

  it('does not drop the review for a directional contradiction', () => {
    // Directional violations are REDACTIONS, not drops: scenario_contexts is
    // optional by contract (the prompt itself specifies `{}` when there is
    // nothing to say), so the honest remedy is to say nothing about that
    // edge rather than lose the whole review. The narrative, the headlines,
    // the evidence enhancements and the quality prompts all survive.
    const { enrichment, review } = capture();
    const result = checkProseFactAgreement(review, enrichment);
    expect(result.output.narrative_summary).toBe(review.narrative_summary);
    expect(result.output.story_headlines).toEqual(review.story_headlines);
    expect(result.output.evidence_enhancements).toEqual(review.evidence_enhancements);
    expect(result.output.decision_quality_prompts).toEqual(review.decision_quality_prompts);
  });
});

describe('live capture — the value-of-information licence', () => {
  /**
   * The invoke input for this run is reconstructed the way the enricher builds
   * it: `m1_coaching` is ABSENT from the captured enrichment, so
   * `normaliseDeterministicCoachingFromM1` yields `evidence_gaps: []`, and
   * `normaliseFactorSensitivity` forwards `evpi_percentage_points` only when
   * upstream supplies it — the captured rows carry none.
   */
  it('confirms the capture carried no VOI input for the prompt to read', () => {
    const { enrichment } = capture();
    expect(enrichment.m1_coaching).toBeUndefined();
    const sensitivity = enrichment.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
    expect(sensitivity).toHaveLength(6);
    // The prompt WAS shown a value-of-information reading for four factors,
    // and it read ZERO on every one of them. That is stronger than an
    // absence: the model was told the answer and narrated the opposite.
    const forwarded = sensitivity
      .map((r) => r.evpi_percentage_points)
      .filter((v) => typeof v === 'number');
    expect(forwarded).toEqual([0, 0, 0, 0]);
    expect(sensitivity.every((r) => r.value_of_information === 0)).toBe(true);
    expect(
      (enrichment.factor_evppi as ReadonlyArray<Record<string, unknown>>)[0].status,
    ).toBe('below_resolution');
  });

  it('is not licensed by the run the founder actually got', () => {
    const licence = deriveVoiLicence(invokeInputAsBuilt());
    // POSITIVE CONTROL: four VOI-bearing rows WERE inspected. A licence that
    // read zero rows would return the same `licensed: false` for the wrong
    // reason — "we saw nothing" rather than "we saw zero".
    expect(licence.rowsInspected).toBe(4);
    expect(licence.licensed).toBe(false);
  });

  it('is not licensed by decision_evpi, which answers a different question', () => {
    const { enrichment } = capture();
    expect(enrichment.decision_evpi).toBeGreaterThan(0);
    // decision_evpi is not forwarded to this prompt at all, and would not
    // license a PER-FACTOR superlative even if it were.
    expect(deriveVoiLicence({ ...invokeInputAsBuilt(), decision_evpi: 99 }).licensed).toBe(false);
  });

  it('would license once an evidence gap carried a real voi — the twin', () => {
    // Without this, "not licensed" could be an instrument that never licenses.
    expect(
      deriveVoiLicence({
        ...invokeInputAsBuilt(),
        deterministic_coaching: {
          ...(invokeInputAsBuilt().deterministic_coaching as Record<string, unknown>),
          evidence_gaps: [{ factor_id: '16ec3d64', factor_label: 'ICP Clarity', voi: 0.31 }],
        },
      }).licensed,
    ).toBe(true);
  });

  it('replaces a highest-value-check sentence on this run', () => {
    // The sentence is the live one, verbatim from the same session's
    // assistant_text (turn 16). It is applied to a decision_review field here
    // because that is the surface this seam owns; the identical predicate is
    // exported for the conversational egress, which this lane does not own.
    const { enrichment, review } = capture();
    review.readiness_rationale =
      'Validating it (even informally) is the single highest-value check before acting on this result.';
    const result = checkProseFactAgreement(review, enrichment, invokeInputAsBuilt());
    expect(result.voiFieldsRedacted).toBe(1);
    expect(result.output.readiness_rationale).toBe(VOI_SUPERLATIVE_REPLACEMENT);
    expect(result.violations).toContainEqual({
      rule: 'voi_superlative_without_voi_evidence',
      observed: 1,
    });
  });

  it('permits the influence sentence from the same session', () => {
    // CONTRAST CONTROL. Also live, also turn 16, and it is TRUE: ICP clarity
    // does rank first on influence. A guard that cannot tell these two
    // sentences apart is a guard that deletes the product's real coaching.
    const { enrichment, review } = capture();
    const influence =
      'How well you understand your ideal customer has the biggest influence on the outcome, feeding into both churn and acquisition cost.';
    review.readiness_rationale = influence;
    const result = checkProseFactAgreement(review, enrichment, invokeInputAsBuilt());
    expect(result.voiFieldsRedacted).toBe(0);
    expect(result.output.readiness_rationale).toBe(influence);
    expect(result.violations).toEqual([
      { rule: 'directional_claim_contradicts_flip_fact', observed: 2 },
    ]);
  });

  it('leaves the shipped review untouched on the VOI axis — it carried no superlative', () => {
    // Worth recording precisely, because it bounds the claim this seam makes.
    // The VOI superlative that reached the founder was in `assistant_text`,
    // composed by the CONVERSATIONAL model — not in decision_review. On this
    // capture the VOI half of the seam therefore fires zero times, and saying
    // otherwise would be over-reading the fix.
    const { enrichment, review } = capture();
    expect(checkProseFactAgreement(review, enrichment, invokeInputAsBuilt()).voiFieldsRedacted)
      .toBe(0);
  });
});
