/**
 * PROSE / FACT AGREEMENT — unit behaviour, discrimination, and the declared
 * known gap.
 *
 * Three things this file is deliberately doing, because each closes a way the
 * suite could agree with itself:
 *
 *  1. EVERY directional case has its OPPOSITE-DIRECTION TWIN (trap 22b). A
 *     corpus that only tests the inversion we happened to find cannot see the
 *     over-suppression we would trade it for.
 *  2. The DECLINED set is pinned EXACTLY (trap 22f's honest-gap rule): the
 *     test REDs if the classifier starts answering one of them OR stops
 *     answering something it answers today. A gap recorded in the suite is
 *     honest; a gap invisible to it is how four rounds of oscillation happen.
 *  3. The influence corpus is asserted NON-matching, so a VOI pattern that
 *     widens into "biggest influence" REDs instead of quietly deleting the
 *     product's real coaching.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EDGE_KEY_SEPARATOR,
  checkProseFactAgreement,
  classifyAssertedMovement,
  VOI_SUPERLATIVE_REPLACEMENT,
  countVoiSuperlativeClaims,
  deriveEdgeFlipFacts,
  deriveEdgeFlipRequirement,
  deriveVoiLicence,
  summariseProseFactViolations,
} from '../prose-fact-agreement.js';

// ── The producer fact ───────────────────────────────────────────────────────

describe('deriveEdgeFlipRequirement', () => {
  const row = (over: Record<string, unknown>) => ({
    edge_id: 'a::b',
    from_id: 'a',
    to_id: 'b',
    ...over,
  });

  it('reads a positive edge that must weaken', () => {
    expect(
      deriveEdgeFlipRequirement(
        row({ current_mean: 0.65, flip_mean: 0.355, flip_direction: 'decrease' }),
      )?.requirement,
    ).toBe('weaker');
  });

  it('reads a positive edge that must strengthen — the twin', () => {
    expect(
      deriveEdgeFlipRequirement(
        row({ current_mean: 0.45, flip_mean: 0.745, flip_direction: 'increase' }),
      )?.requirement,
    ).toBe('stronger');
  });

  it('reads a NEGATIVE edge that must weaken, though flip_direction says "increase"', () => {
    expect(
      deriveEdgeFlipRequirement(
        row({ current_mean: -0.5, flip_mean: -0.079, flip_direction: 'increase' }),
      )?.requirement,
    ).toBe('weaker');
  });

  it('reads a NEGATIVE edge that must strengthen — the twin', () => {
    expect(
      deriveEdgeFlipRequirement(
        row({ current_mean: -0.5, flip_mean: -0.9, flip_direction: 'decrease' }),
      )?.requirement,
    ).toBe('stronger');
  });

  it('calls a sign crossing "reversed", not "weaker"', () => {
    expect(
      deriveEdgeFlipRequirement(
        row({ current_mean: 0.55, flip_mean: -0.604, flip_direction: 'decrease' }),
      )?.requirement,
    ).toBe('reversed');
  });

  it('yields NO fact when the enum and the means disagree', () => {
    // Fail-closed union assertion. A guard derived from one field can only
    // ever prove that field is self-consistent.
    expect(
      deriveEdgeFlipRequirement(
        row({ current_mean: 0.65, flip_mean: 0.355, flip_direction: 'increase' }),
      )?.requirement,
    ).toBeNull();
  });

  it('yields NO fact on a zero baseline, a missing mean, or a missing endpoint', () => {
    expect(
      deriveEdgeFlipRequirement(row({ current_mean: 0, flip_mean: 0.4 }))?.requirement,
    ).toBeNull();
    expect(deriveEdgeFlipRequirement(row({ current_mean: 0.5 }))?.requirement).toBeNull();
    expect(
      deriveEdgeFlipRequirement({ current_mean: 0.5, flip_mean: 0.9, to_id: 'b' }),
    ).toBeNull();
    expect(deriveEdgeFlipRequirement(null)).toBeNull();
    expect(deriveEdgeFlipRequirement('a::b')).toBeNull();
  });

  it('tolerates an absent flip_direction and derives from the means alone', () => {
    expect(
      deriveEdgeFlipRequirement(row({ current_mean: 0.65, flip_mean: 0.355 }))?.requirement,
    ).toBe('weaker');
  });
});

describe('deriveEdgeFlipFacts', () => {
  it('returns an empty index for an unreadable enrichment', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { edge_e_values: {} }]) {
      expect(deriveEdgeFlipFacts(bad).size).toBe(0);
    }
  });

  it('keys on the endpoint pair with a separator that is neither producer spelling', () => {
    expect(EDGE_KEY_SEPARATOR).not.toContain('-');
    expect(EDGE_KEY_SEPARATOR).not.toContain('>');
    expect(EDGE_KEY_SEPARATOR).not.toContain(':');
    const facts = deriveEdgeFlipFacts({
      edge_e_values: [
        { from_id: 'a', to_id: 'b', current_mean: 1, flip_mean: 2, flip_direction: 'increase' },
      ],
    });
    expect([...facts.keys()]).toEqual([`a${EDGE_KEY_SEPARATOR}b`]);
  });
});

// ── The prose classifier ────────────────────────────────────────────────────

describe('classifyAssertedMovement', () => {
  const STRONGER = [
    // Live, verbatim (2026-09-03 capture).
    'If Sales Headcount Investment increases runway depletion risk more than forecast,',
    'If Customer Acquisition Cost rises faster than expected,',
    // Same frame, other comparatives.
    'If the link turns out stronger than modelled,',
    'If churn bites harder than we assumed,',
    'If acquisition cost runs higher than planned,',
  ];
  const WEAKER = [
    // The opposite-direction twins of the live sentences.
    'If Sales Headcount Investment increases runway depletion risk less than forecast,',
    'If Customer Acquisition Cost rises slower than expected,',
    'If the link turns out weaker than modelled,',
    'If churn bites softer than we assumed,',
    'If acquisition cost runs lower than planned,',
  ];

  it.each(STRONGER)('reads a strengthening claim: %s', (text) => {
    expect(classifyAssertedMovement(text)).toBe('stronger');
  });

  it.each(WEAKER)('reads a weakening claim: %s', (text) => {
    expect(classifyAssertedMovement(text)).toBe('weaker');
  });

  /**
   * THE DECLARED GAP — asserted as an EXACT set.
   *
   * Each of these carries a real direction that a human reads instantly, and
   * this module refuses all of them, because the rule that would catch them
   * is the rule that inverts the ones above. The set is pinned so that
   * shrinking it (someone "improved" the classifier) and growing it
   * (someone widened a pattern into a decline) both go RED and get reviewed.
   */
  const DECLINED = [
    // An adverb between the comparative and `than` moves the polarity onto
    // the adverb: "more slowly" is a WEAKENING that "more … than" misreads.
    'If Customer Acquisition Cost rises more slowly than expected,',
    'If runway drains less quickly than forecast,',
    // Negated comparative — inverting a negation is the interrupted-
    // construction class that shipped a defect and then its mirror here.
    'If the link is not stronger than modelled,',
    // Comparative with no baseline noun: "than the runner-up" is a
    // comparison between OPTIONS, not against the model.
    'If Sales Headcount Investment matters more than Competitive Pressure,',
    // Both polarities in one sentence — a claim about two things.
    'If churn runs higher than forecast while acquisition cost runs lower than forecast,',
    // No comparative frame at all.
    'If the link from Sales Headcount Investment to Runway Depletion Risk breaks down,',
    // The live story_headline, which is about an OPTION managing something
    // well, not about the link deviating from the model.
    'Hire a Dedicated Sales Team could overtake if sales headcount investment manages runway and customer acquisition cost more effectively.',
  ];

  it('declines exactly the declared set, no more and no fewer', () => {
    const answered = DECLINED.filter((t) => classifyAssertedMovement(t) !== null);
    expect(answered).toEqual([]);
    // …and the classifier is not simply mute: the corpora above prove it
    // answers 10 sentences, so "declines everything" cannot pass this file.
    expect(classifyAssertedMovement(STRONGER[0])).not.toBeNull();
  });

  it('declines empty and non-string input', () => {
    for (const bad of ['', '   ', null, undefined, 7, {}]) {
      expect(classifyAssertedMovement(bad)).toBeNull();
    }
  });
});

// ── The seam's two remedies ─────────────────────────────────────────────────

function enrichmentWith(requirement: 'weaker' | 'stronger'): Record<string, unknown> {
  return {
    edge_e_values: [
      requirement === 'weaker'
        ? { from_id: 'a', to_id: 'b', current_mean: 0.65, flip_mean: 0.355, flip_direction: 'decrease' }
        : { from_id: 'a', to_id: 'b', current_mean: 0.45, flip_mean: 0.745, flip_direction: 'increase' },
    ],
  };
}

const REVIEW = (trigger: string) => ({
  narrative_summary: 'Founder-led sales leads.',
  scenario_contexts: {
    'a->b': { trigger_description: trigger, consequence: 'then B overtakes A.' },
  },
});

describe('checkProseFactAgreement — directional remedy', () => {
  it('redacts a claim that contradicts the fact', () => {
    const r = checkProseFactAgreement(
      REVIEW('If A drives B more than forecast,'),
      enrichmentWith('weaker'),
    );
    expect(r.redactedContradicted).toBe(1);
    expect(Object.keys(r.output.scenario_contexts as object)).toEqual([]);
    // The remedy is a redaction, not a drop — the rest of the review survives.
    expect(r.output.narrative_summary).toBe('Founder-led sales leads.');
  });

  it('KEEPS the same sentence when the fact points the same way — the twin', () => {
    // Without this, "redacts a contradiction" is satisfied by a seam that
    // redacts everything.
    const r = checkProseFactAgreement(
      REVIEW('If A drives B more than forecast,'),
      enrichmentWith('stronger'),
    );
    expect(r.redactedContradicted).toBe(0);
    expect(r.redactedUngrounded).toBe(0);
    expect(Object.keys(r.output.scenario_contexts as object)).toEqual(['a->b']);
    expect(r.violations).toEqual([]);
  });

  it('redacts an ungrounded claim when the producer shipped no fact for the edge', () => {
    const r = checkProseFactAgreement(REVIEW('If A drives B more than forecast,'), {
      edge_e_values: [
        { from_id: 'x', to_id: 'y', current_mean: 1, flip_mean: 2, flip_direction: 'increase' },
      ],
    });
    expect(r.redactedUngrounded).toBe(1);
    expect(r.redactedContradicted).toBe(0);
    expect(r.violations).toEqual([{ rule: 'directional_claim_ungrounded', observed: 1 }]);
  });

  it('KEEPS an unclassifiable claim on a grounded edge, and counts it', () => {
    const r = checkProseFactAgreement(
      REVIEW('If A drives B more slowly than expected,'),
      enrichmentWith('weaker'),
    );
    expect(r.unclassifiedKept).toBe(1);
    expect(r.redactedContradicted).toBe(0);
    expect(r.redactedUngrounded).toBe(0);
    expect(Object.keys(r.output.scenario_contexts as object)).toEqual(['a->b']);
  });

  it('resolves a "from::to" scenario key as well as "from->to"', () => {
    const review = {
      scenario_contexts: {
        'a::b': { trigger_description: 'If A drives B more than forecast,', consequence: 'x' },
      },
    };
    expect(checkProseFactAgreement(review, enrichmentWith('weaker')).redactedContradicted).toBe(1);
  });

  it('treats an unsplittable key as ungrounded rather than skipping it', () => {
    const review = {
      scenario_contexts: {
        'not-an-edge': { trigger_description: 'If A drives B more than forecast,', consequence: 'x' },
      },
    };
    expect(checkProseFactAgreement(review, enrichmentWith('weaker')).redactedUngrounded).toBe(1);
  });

  it('says nothing about a "reversed" requirement in either direction', () => {
    const reversed = {
      edge_e_values: [
        { from_id: 'a', to_id: 'b', current_mean: 0.55, flip_mean: -0.6, flip_direction: 'decrease' },
      ],
    };
    for (const trigger of [
      'If A drives B more than forecast,',
      'If A drives B less than forecast,',
    ]) {
      const r = checkProseFactAgreement(REVIEW(trigger), reversed);
      expect(r.redactedContradicted).toBe(0);
      expect(r.unclassifiedKept).toBe(0);
    }
  });

  it('is total on unreadable input and makes no claim', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      const r = checkProseFactAgreement({ narrative_summary: 'x' }, bad, bad);
      expect(r.violations).toEqual([]);
      expect(r.output).toEqual({ narrative_summary: 'x' });
    }
  });
});

// ── The value-of-information half ───────────────────────────────────────────

describe('countVoiSuperlativeClaims', () => {
  const CAUGHT = [
    'so validating it, even informally, is the highest-value check before acting on this lead.',
    'so validating it (even informally) is the single highest-value check before acting on this result.',
    'a structured customer interview or survey would settle the single largest source of uncertainty here.',
    'This is the most valuable thing you could find out before deciding.',
    'That assumption is worth the most to resolve first.',
    'It carries the highest expected value of learning of anything in the model.',
  ];
  /**
   * ALLOWED — every one of these is live prose from the same failed session
   * and every one of them is TRUE: ICP clarity really does rank first on
   * influence. A pattern that cannot tell these from the set above deletes
   * the product's real coaching.
   */
  const ALLOWED = [
    'ICP clarity has the biggest influence on this result, feeding into both churn and acquisition cost.',
    'It has the biggest influence on which option leads, yet nothing in your brief confirms it.',
    'The belief that product gaps rather than price explain churn is the second biggest driver.',
    'The product-gaps-drive-churn story is the second strongest driver.',
    'Your ICP clarity assumption is doing most of the work.',
    'The link from Sales Headcount Investment to Runway Depletion Risk could flip the result.',
    'This is the largest option in the comparison by investment.',
  ];

  it.each(CAUGHT)('flags a value-of-learning superlative: %s', (text) => {
    expect(countVoiSuperlativeClaims(text)).toBeGreaterThan(0);
  });

  it.each(ALLOWED)('leaves influence language alone: %s', (text) => {
    expect(countVoiSuperlativeClaims(text)).toBe(0);
  });

  it('is quiet on empty and non-string input', () => {
    for (const bad of ['', null, undefined, 3, {}]) {
      expect(countVoiSuperlativeClaims(bad)).toBe(0);
    }
  });
});

describe('deriveVoiLicence', () => {
  /**
   * ⚠ EVERY CASE HERE IS BUILT FROM THE INVOKE INPUT, NOT THE ENRICHMENT, and
   * that distinction is the correction this suite exists to hold. An earlier
   * draft licensed superlatives from `factor_evppi` / `p_win_sensitivity` on
   * the enrichment — fields `readIslResults` does not forward, so the model
   * never sees them — and its "it licenses correctly" twin passed against a
   * status literal (`above_resolution`) the producer does not emit. Both the
   * fixture and the expectation came out of the author's head; they agreed
   * with each other and with nothing else.
   */
  it('does not license when the input carried no evidence gaps at all', () => {
    const licence = deriveVoiLicence({
      deterministic_coaching: { readiness: 'unknown', evidence_gaps: [], model_critiques: [] },
      isl_results: { factor_sensitivity: [{ factor_id: 'f1', elasticity: 1 }] },
    });
    expect(licence.rowsInspected).toBe(0);
    expect(licence.licensed).toBe(false);
  });

  it('does not license from a zero voi', () => {
    const licence = deriveVoiLicence({
      deterministic_coaching: { evidence_gaps: [{ factor_id: 'f1', voi: 0, confidence: 0.5 }] },
    });
    expect(licence.rowsInspected).toBe(1);
    expect(licence.licensed).toBe(false);
  });

  it('licenses a non-zero voi — the twin', () => {
    expect(
      deriveVoiLicence({
        deterministic_coaching: { evidence_gaps: [{ factor_id: 'f1', voi: 0.3, confidence: 0.5 }] },
      }).licensed,
    ).toBe(true);
  });

  it('reads the upstream voi_score spelling as well as the renamed voi', () => {
    for (const key of ['voi_score', 'voi']) {
      expect(
        deriveVoiLicence({
          deterministic_coaching: { evidence_gaps: [{ factor_id: 'f1', [key]: 0.3 }] },
        }).licensed,
      ).toBe(true);
    }
  });

  it('licenses a non-zero evpi_percentage_points on the forwarded sensitivity rows', () => {
    expect(
      deriveVoiLicence({
        isl_results: {
          factor_sensitivity: [{ factor_id: 'f1', evpi_percentage_points: 4.2 }],
        },
      }).licensed,
    ).toBe(true);
  });

  it('does not license from enrichment-only VOI fields the prompt never receives', () => {
    // factor_evppi / decision_evpi / p_win_sensitivity / factor_sensitivity
    // .value_of_information are NOT forwarded by readIslResults. ISL states of
    // p_win_sensitivity that it "is NOT value-of-information" at all, and
    // enrichment-manifest.ts::R_VOI_NOT_COACH_NARRATED records that narrating
    // the family in prose is forbidden pending doctrine. Licensing a
    // superlative from any of them would cite evidence the model never saw.
    expect(
      deriveVoiLicence({
        factor_evppi: [{ factor_id: 'f1', evppi: 0.4, status: 'resolved' }],
        p_win_sensitivity: [{ factor_id: 'f1', p_win_delta: 0.4, status: 'resolved' }],
        decision_evpi: 99,
        factor_sensitivity: [{ factor_id: 'f1', value_of_information: 0.9 }],
      }).licensed,
    ).toBe(false);
  });

  it('reports zero rows inspected on an unreadable input', () => {
    for (const bad of [null, undefined, 7, 'x', []]) {
      expect(deriveVoiLicence(bad).rowsInspected).toBe(0);
      expect(deriveVoiLicence(bad).licensed).toBe(false);
    }
  });
});

describe('checkProseFactAgreement — VOI remedy', () => {
  const unlicensed = { deterministic_coaching: { evidence_gaps: [] } };
  const licensed = {
    deterministic_coaching: { evidence_gaps: [{ factor_id: 'f1', voi: 0.3 }] },
  };
  const review = () => ({
    narrative_summary: 'Founder-led sales leads.',
    readiness_rationale:
      'ICP clarity is unvalidated. Validating it is the single highest-value check. Interview ten customers.',
  });

  it('replaces the offending SENTENCE and keeps the rest of the field', () => {
    const r = checkProseFactAgreement(review(), {}, unlicensed);
    expect(r.voiFieldsRedacted).toBe(1);
    expect(r.violations).toEqual([
      { rule: 'voi_superlative_without_voi_evidence', observed: 1 },
    ]);
    const rationale = r.output.readiness_rationale as string;
    expect(rationale).toContain('ICP clarity is unvalidated.');
    expect(rationale).toContain('Interview ten customers.');
    expect(rationale).not.toContain('highest-value check');
    expect(rationale).toContain(VOI_SUPERLATIVE_REPLACEMENT);
  });

  it('does NOT drop the review — the ratified per-field remedy', () => {
    const r = checkProseFactAgreement(review(), {}, unlicensed);
    expect(r.output.narrative_summary).toBe('Founder-led sales leads.');
    expect(Object.keys(r.output).sort()).toEqual(['narrative_summary', 'readiness_rationale']);
  });

  it('leaves the same review byte-identical when a voi reading exists — the twin', () => {
    const input = review();
    const r = checkProseFactAgreement(input, {}, licensed);
    expect(r.voiFieldsRedacted).toBe(0);
    expect(r.violations).toEqual([]);
    expect(r.output).toEqual(input);
  });

  it('never mutates the caller\u2019s review object', () => {
    const input = review();
    checkProseFactAgreement(input, {}, unlicensed);
    expect(input.readiness_rationale).toContain('single highest-value check');
  });

  it('scans nested prose, not just top-level strings', () => {
    const nested = {
      narrative_summary: 'Founder-led sales leads.',
      evidence_enhancements: {
        f1: { rationale: 'This is the most valuable thing to find out.' },
      },
      decision_quality_prompts: [{ question: 'What is the highest-value check here?' }],
    };
    const r = checkProseFactAgreement(nested, {}, unlicensed);
    expect(r.voiFieldsRedacted).toBe(2);
    expect(
      (r.output.evidence_enhancements as Record<string, Record<string, string>>).f1.rationale,
    ).toBe(VOI_SUPERLATIVE_REPLACEMENT);
  });

  it('leaves ids, timestamps and enum values alone', () => {
    // The walk is total, so it must be safe over non-prose strings by
    // construction rather than by an exclusion list.
    const structural = {
      produced_at: '2026-09-03T16:17:00.000Z',
      story_headlines: { '05f973ef': '94b13741' },
      evidence_enhancements: { f1: { evidence_type: 'customer_research' } },
    };
    const r = checkProseFactAgreement(structural, {}, unlicensed);
    expect(r.voiFieldsRedacted).toBe(0);
    expect(r.output).toEqual(structural);
  });

  it('says nothing about VOI when no invoke input is supplied', () => {
    // The default argument must not license: an absent input is "we do not
    // know what the model saw", and the fail-closed reading of that is to
    // treat the superlative as unlicensed.
    const r = checkProseFactAgreement(review(), {});
    expect(r.voiFieldsRedacted).toBe(1);
  });
});

describe('summariseProseFactViolations', () => {
  it('emits bounded rule codes and a count only', () => {
    const summary = summariseProseFactViolations([
      { rule: 'voi_superlative_without_voi_evidence', observed: 3 },
      { rule: 'directional_claim_ungrounded', observed: 1 },
      { rule: 'directional_claim_ungrounded', observed: 1 },
    ]);
    expect(summary).toEqual({
      reason: 'directional_claim_ungrounded',
      reasons: 'directional_claim_ungrounded,voi_superlative_without_voi_evidence',
      violation_count: 2,
    });
  });
});

describe('source hygiene', () => {
  it('carries no NUL byte, so the module stays visible to a plain grep', () => {
    // Trap 17: a NUL makes `file(1)` call the source binary and plain grep
    // reports ZERO matches inside it — an absence claim from a sweep that
    // could not see the file. This repo has shipped that twice.
    const src = readFileSync(join(__dirname, '..', 'prose-fact-agreement.ts'));
    expect(src.includes(0)).toBe(false);
  });
});
