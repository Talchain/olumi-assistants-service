/** The original Sept 3 fixture is unchanged. Tests join its producer facts,
 * the emitted prose, and the corrected stored review without inventing outcome identity.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  VOI_SUPERLATIVE_REPLACEMENT,
  UNVERIFIED_CONSEQUENCE,
  checkProseFactAgreement,
  classifyAssertedMovement,
  deriveEdgeFlipFacts,
  deriveVoiLicence,
} from '../prose-fact-agreement.js';

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

    expect(facts.size).toBe(11);

    expect(facts.get('919d7f50|428612e0')?.requirement).toBe('weaker');
    expect(facts.get('bbbbd8f2|552bd1c0')?.requirement).toBe('weaker');
  });

  it('spells the SAME edge two ways in one payload, so an id-string join reads zero', () => {
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
    expect(deriveEdgeFlipFacts(enrichment).has('919d7f50|428612e0')).toBe(true);
  });

  it('derives WEAKER from a negative edge whose flip_direction reads "increase"', () => {
    const { enrichment } = capture();
    const row = (enrichment.edge_e_values as ReadonlyArray<Record<string, unknown>>).find(
      (r) => r.edge_id === 'bbbbd8f2::552bd1c0',
    );
    expect(row?.flip_direction).toBe('increase');
    expect(row?.current_mean).toBeLessThan(0);
    expect(deriveEdgeFlipFacts(enrichment).get('bbbbd8f2|552bd1c0')?.requirement).toBe('weaker');
  });
});

describe('live capture — the ungrounded blast radius, measured', () => {
  it('records how many fragile edges carry no signed fact on this run', () => {
    const { enrichment } = capture();
    const fragile = (enrichment.robustness as Record<string, unknown>)
      .fragile_edges as ReadonlyArray<Record<string, unknown>>;
    const facts = deriveEdgeFlipFacts(enrichment);
    const ungrounded = fragile.filter(
      (f) => !facts.has(`${f.from_id as string}|${f.to_id as string}`),
    );
    expect(fragile).toHaveLength(12);
    expect(ungrounded.map((f) => f.edge_id)).toEqual([
      '422ceee7->b6941ac0',
      '16ec3d64->bbbbd8f2',
    ]);
  });

  it('has usable directional facts for both narrated edges and keeps both cards', () => {
    const { enrichment, review } = capture();
    const facts = deriveEdgeFlipFacts(enrichment);
    const narrated = Object.keys(review.scenario_contexts as Record<string, unknown>);
    expect(narrated).toEqual([SALES_TO_RUNWAY, CAC_TO_GOAL]);
    for (const key of narrated) {
      const [fromId, toId] = key.split('->');
      expect(facts.get(`${fromId}|${toId}`)?.requirement).not.toBeNull();
    }
    const result = checkProseFactAgreement(review, enrichment);
    expect(result.qualifiedTriggers).toBe(0);
    expect(result.correctedTriggers).toBe(2);
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

  it('names the fragile-edge alternative, which still does not bind the coefficient-search baseline', () => {
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
  it('repairs both conditions and qualifies the unbound named consequences', () => {
    const { enrichment, review } = capture();
    const before = Object.keys(review.scenario_contexts as Record<string, unknown>);
    expect(before).toEqual([SALES_TO_RUNWAY, CAC_TO_GOAL]);

    const result = checkProseFactAgreement(review, enrichment);

    expect(result.correctedTriggers).toBe(2);
    expect(result.qualifiedTriggers).toBe(0);
    expect(result.qualifiedConsequences).toBe(2);
    expect(Object.keys(result.output.scenario_contexts as Record<string, unknown>)).toEqual([SALES_TO_RUNWAY, CAC_TO_GOAL]);
    const scenarios = result.output.scenario_contexts as Record<string, Record<string, string>>;
    for (const key of [SALES_TO_RUNWAY, CAC_TO_GOAL]) {
      expect(scenarios[key].trigger_description).toContain('weaker than the model assumes');
      expect(scenarios[key].consequence).toBe(UNVERIFIED_CONSEQUENCE);
    }
    expect(result.violations).toEqual([
      { rule: 'directional_claim_corrected', observed: 2 },
      { rule: 'scenario_consequence_unverified', observed: 2 },
    ]);
  });

  it('never mutates the caller’s review object', () => {
    const { enrichment, review } = capture();
    checkProseFactAgreement(review, enrichment);
    expect(Object.keys(review.scenario_contexts as Record<string, unknown>)).toHaveLength(2);
  });

  it('leaves every other authored field byte-identical', () => {
    const { enrichment, review } = capture();
    const result = checkProseFactAgreement(review, enrichment);
    for (const key of Object.keys(review)) {
      if (key === 'scenario_contexts') continue;
      expect(result.output[key]).toEqual(review[key]);
    }
  });

  it('does not drop the review for a directional contradiction', () => {
    const { enrichment, review } = capture();
    const result = checkProseFactAgreement(review, enrichment);
    expect(result.output.narrative_summary).toBe(review.narrative_summary);
    expect(result.output.story_headlines).toEqual(review.story_headlines);
    expect(result.output.evidence_enhancements).toEqual(review.evidence_enhancements);
    expect(result.output.decision_quality_prompts).toEqual(review.decision_quality_prompts);
  });
});

describe('live capture — no quantity escapes the seam', () => {
  it('surfaces no number from edge_e_values, a ratified tier-3 deny field', () => {
    const { enrichment, review } = capture();
    const magnitudes = (
      enrichment.edge_e_values as ReadonlyArray<Record<string, unknown>>
    ).flatMap((r) => [r.e_value, r.current_mean, r.flip_mean])
      .filter((v): v is number => typeof v === 'number' && v !== 0)
      .map((v) => String(v));
    expect(magnitudes.length).toBeGreaterThan(20); // positive control

    const result = checkProseFactAgreement(review, enrichment, invokeInputAsBuilt());
    const serialisedOutput = JSON.stringify(result.output);
    const serialisedVerdict = JSON.stringify({
      violations: result.violations,
      correctedTriggers: result.correctedTriggers,
      qualifiedTriggers: result.qualifiedTriggers,
      qualifiedConsequences: result.qualifiedConsequences,
      voiFieldsRedacted: result.voiFieldsRedacted,
    });
    for (const magnitude of magnitudes) {
      expect(serialisedVerdict).not.toContain(magnitude);
      if (!JSON.stringify(review).includes(magnitude)) {
        expect(serialisedOutput).not.toContain(magnitude);
      }
    }
  });
});

describe('live capture — the value-of-information licence', () => {
  it('confirms the capture carried no VOI input for the prompt to read', () => {
    const { enrichment } = capture();
    expect(enrichment.m1_coaching).toBeUndefined();
    const sensitivity = enrichment.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
    expect(sensitivity).toHaveLength(6);
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
    expect(licence.rowsInspected).toBe(4);
    expect(licence.licensed).toBe(false);
  });

  it('is not licensed by decision_evpi, which answers a different question', () => {
    const { enrichment } = capture();
    expect(enrichment.decision_evpi).toBeGreaterThan(0);
    expect(deriveVoiLicence({ ...invokeInputAsBuilt(), decision_evpi: 99 }).licensed).toBe(false);
  });

  it('does not turn one additional heuristic reading into a comparable VOI rank', () => {
    expect(
      deriveVoiLicence({
        ...invokeInputAsBuilt(),
        deterministic_coaching: {
          ...(invokeInputAsBuilt().deterministic_coaching as Record<string, unknown>),
          evidence_gaps: [{ factor_id: '16ec3d64', factor_label: 'ICP Clarity', voi: 0.31 }],
        },
      }).licensed,
    ).toBe(false);
  });

  it('replaces a highest-value-check sentence on this run', () => {
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
    const { enrichment, review } = capture();
    const influence =
      'How well you understand your ideal customer has the biggest influence on the outcome, feeding into both churn and acquisition cost.';
    review.readiness_rationale = influence;
    const result = checkProseFactAgreement(review, enrichment, invokeInputAsBuilt());
    expect(result.voiFieldsRedacted).toBe(0);
    expect(result.output.readiness_rationale).toBe(influence);
    expect(result.violations).toEqual([
      { rule: 'directional_claim_corrected', observed: 2 },
      { rule: 'scenario_consequence_unverified', observed: 2 },
    ]);
  });

  it('leaves the shipped review untouched on the VOI axis — it carried no superlative', () => {
    const { enrichment, review } = capture();
    expect(checkProseFactAgreement(review, enrichment, invokeInputAsBuilt()).voiFieldsRedacted)
      .toBe(0);
  });
});
