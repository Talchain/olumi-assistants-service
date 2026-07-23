import { describe, expect, it } from 'vitest';

import {
  checkDecisionReviewContract,
  collectGraphEntityIds,
  findFabricatedContinuityHit,
  summariseContractViolations,
  isEnforcedRule,
  COUNT_CAP_RULES,
  MAX_BIAS_FINDINGS,
  MAX_DECISION_QUALITY_PROMPTS,
  MAX_KEY_ASSUMPTIONS,
  MAX_SCENARIO_CONTEXTS,
  type DecisionReviewContractRule,
} from '../contract-gate.js';

/**
 * The graph the review's entities are grounded against. Node/edge ids here are
 * the ONLY valid targets for bias_findings[].affected_elements.
 */
function graph(): Record<string, unknown> {
  return {
    nodes: [
      { id: 'node-price', label: 'Price' },
      { id: 'node-demand', label: 'Demand' },
    ],
    edges: [{ id: 'edge-price-demand', from: 'node-price', to: 'node-demand' }],
  };
}

const GATE_INPUT = { graph: graph() };

/**
 * A known-good, live-shaped decision_review output: every required block
 * present and non-empty, all counts within the TIGHT prompt caps, no
 * fabricated conversational callback, and every affected_element a real graph
 * id. This is the POSITIVE CONTROL — it must pass the gate untouched.
 */
function goodReview(): Record<string, unknown> {
  return {
    narrative_summary:
      'The leading option holds a clear lead, though the result leans on the price assumption.',
    story_headlines: { 'opt-1': 'Stays ahead across most scenarios.' },
    robustness_explanation: {
      summary: 'The result is stable while demand stays near its modelled level.',
      stability_factors: ['A wide margin on the leading option.'],
      fragility_factors: ['A sharp drop in demand.'],
    },
    readiness_rationale: 'The picture is clear enough to act on, with one assumption to watch.',
    evidence_enhancements: {},
    bias_findings: [
      {
        type: 'anchoring',
        source: 'structural',
        description: 'The framing leans on a single price point.',
        affected_elements: ['node-price'],
      },
    ],
    key_assumptions: ['Demand holds near its modelled level.', 'Price stays fixed.'],
    decision_quality_prompts: [
      { technique: 'pre-mortem', question: 'What would make this fail?' },
    ],
    scenario_contexts: { 'edge-price-demand': { narrative: 'If demand falls, the lead narrows.' } },
    flip_thresholds: [],
  };
}

/** Assert the gate flagged EXACTLY (at least) the given rule and nothing spurious. */
function rulesOf(output: Record<string, unknown>): DecisionReviewContractRule[] {
  return checkDecisionReviewContract(output, GATE_INPUT).violations.map((v) => v.rule);
}

describe('checkDecisionReviewContract', () => {
  // ── Positive control ──────────────────────────────────────────────────
  it('passes a known-good live-shaped review untouched', () => {
    const result = checkDecisionReviewContract(goodReview(), GATE_INPUT);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  // ── Rule class 1: fabricated conversational callback (R-CONT) ──────────
  describe('R-CONT — fabricated conversational callbacks', () => {
    it('catches a fabricated callback phrase in narrative_summary', () => {
      const bad = goodReview();
      bad.narrative_summary =
        'As you mentioned earlier, the leading option keeps its lead.';
      expect(rulesOf(bad)).toContain('fabricated_continuity_phrase');
    });

    it('catches the F14 exemplar ("your pre-mortem asked for")', () => {
      const bad = goodReview();
      bad.readiness_rationale = 'Treat this as the evidence your pre-mortem asked for.';
      expect(rulesOf(bad)).toContain('fabricated_continuity_phrase');
    });

    it('catches a callback buried in a nested bias_findings description', () => {
      const bad = goodReview();
      (bad.bias_findings as Record<string, unknown>[])[0].description =
        'As we discussed, the framing leans on one price point.';
      expect(rulesOf(bad)).toContain('fabricated_continuity_phrase');
    });

    it('catches a banned staleness-continuity phrase ("previous analysis")', () => {
      const bad = goodReview();
      bad.narrative_summary = 'The previous analysis pointed the same way.';
      expect(rulesOf(bad)).toContain('fabricated_continuity_phrase');
    });

    it('does NOT flag a reflective question to the reader', () => {
      const ok = goodReview();
      ok.decision_quality_prompts = [
        { technique: 'pre-mortem', question: 'What would change your mind about this?' },
      ];
      expect(checkDecisionReviewContract(ok, GATE_INPUT).ok).toBe(true);
    });
  });

  // ── Rule class 2: bias-card cap ───────────────────────────────────────
  describe('bias-card cap (tight prompt bound, ≤ 2)', () => {
    it('catches a bias-cap breach (3 > 2)', () => {
      const bad = goodReview();
      bad.bias_findings = [
        { type: 'anchoring', source: 'structural', description: 'a', affected_elements: ['node-price'] },
        { type: 'confirmation', source: 'structural', description: 'b', affected_elements: ['node-demand'] },
        { type: 'availability', source: 'structural', description: 'c', affected_elements: ['node-price'] },
      ];
      const v = checkDecisionReviewContract(bad, GATE_INPUT).violations;
      expect(v.map((x) => x.rule)).toContain('bias_findings_cap_exceeded');
      expect(v.find((x) => x.rule === 'bias_findings_cap_exceeded')?.observed).toBe(3);
    });

    it('allows exactly the cap (2)', () => {
      const ok = goodReview();
      ok.bias_findings = [
        { type: 'anchoring', source: 'structural', description: 'a', affected_elements: ['node-price'] },
        { type: 'confirmation', source: 'structural', description: 'b', affected_elements: ['node-demand'] },
      ];
      expect(checkDecisionReviewContract(ok, GATE_INPUT).ok).toBe(true);
    });
  });

  // ── Rule class 3: missing review_card (coverage floor) ────────────────
  describe('coverage floor — ≥ 1 review_card', () => {
    it('catches a missing review_card (narrative_summary absent)', () => {
      const bad = goodReview();
      delete bad.narrative_summary;
      expect(rulesOf(bad)).toContain('missing_review_card');
    });

    it('catches an empty-after-trim narrative_summary', () => {
      const bad = goodReview();
      bad.narrative_summary = '   ';
      expect(rulesOf(bad)).toContain('missing_review_card');
    });

    it('catches a non-string narrative_summary', () => {
      const bad = goodReview();
      bad.narrative_summary = 42;
      expect(rulesOf(bad)).toContain('missing_review_card');
    });
  });

  // ── Rule class 4: ungrounded entity reference (R-ID / R-BIAS) ──────────
  describe('grounded entity references', () => {
    it('catches an ungrounded affected_element id', () => {
      const bad = goodReview();
      (bad.bias_findings as Record<string, unknown>[])[0].affected_elements = ['node-imaginary'];
      const v = checkDecisionReviewContract(bad, GATE_INPUT).violations;
      expect(v.map((x) => x.rule)).toContain('ungrounded_entity_reference');
      expect(v.find((x) => x.rule === 'ungrounded_entity_reference')?.observed).toBe(1);
    });

    it('grounds against edge ids too', () => {
      const ok = goodReview();
      (ok.bias_findings as Record<string, unknown>[])[0].affected_elements = ['edge-price-demand'];
      expect(checkDecisionReviewContract(ok, GATE_INPUT).ok).toBe(true);
    });

    it('skips the check when the graph carries no id corpus', () => {
      const bad = goodReview();
      (bad.bias_findings as Record<string, unknown>[])[0].affected_elements = ['node-imaginary'];
      const result = checkDecisionReviewContract(bad, { graph: { nodes: [], edges: [] } });
      expect(result.violations.map((v) => v.rule)).not.toContain('ungrounded_entity_reference');
    });
  });

  // ── Remaining tight count caps ────────────────────────────────────────
  describe('other tight count caps', () => {
    it('catches decision_quality_prompts > 2', () => {
      const bad = goodReview();
      bad.decision_quality_prompts = [{ q: 1 }, { q: 2 }, { q: 3 }];
      expect(rulesOf(bad)).toContain('decision_quality_prompts_cap_exceeded');
    });

    it('catches key_assumptions > 3', () => {
      const bad = goodReview();
      bad.key_assumptions = ['a', 'b', 'c', 'd'];
      expect(rulesOf(bad)).toContain('key_assumptions_cap_exceeded');
    });

    it('catches scenario_contexts > 2', () => {
      const bad = goodReview();
      bad.scenario_contexts = { 'edge-1': {}, 'edge-2': {}, 'edge-3': {} };
      expect(rulesOf(bad)).toContain('scenario_contexts_cap_exceeded');
    });
  });

  // ── Constants pin the TIGHT prompt bound, below the shape-check backstop ─
  it('pins the tight prompt caps (below the loose shape-check backstop)', () => {
    // shape-check backstop: bias > 3, dqp > 3, key_assumptions > 5.
    expect(MAX_BIAS_FINDINGS).toBe(2);
    expect(MAX_DECISION_QUALITY_PROMPTS).toBe(2);
    expect(MAX_KEY_ASSUMPTIONS).toBe(3);
    expect(MAX_SCENARIO_CONTEXTS).toBe(2);
  });

  // ── Multiple violations reported together ─────────────────────────────
  it('reports every violated rule in one pass', () => {
    const bad = goodReview();
    delete bad.narrative_summary; // missing_review_card
    bad.bias_findings = [
      { type: 'a', source: 'structural', description: 'As we discussed, x.', affected_elements: ['node-nope'] },
      { type: 'b', source: 'structural', description: 'b', affected_elements: ['node-price'] },
      { type: 'c', source: 'structural', description: 'c', affected_elements: ['node-demand'] },
    ];
    const rules = rulesOf(bad);
    expect(rules).toContain('missing_review_card');
    expect(rules).toContain('bias_findings_cap_exceeded');
    expect(rules).toContain('fabricated_continuity_phrase');
    expect(rules).toContain('ungrounded_entity_reference');
  });
});

// ── B1 (A1 ruling D-11): enforce-vs-telemetry rule classification ─────────
// SAFETY rules ENFORCE-DROP; COUNT-CAP rules are TELEMETRY-ONLY (counted for
// the per-model A/B signal but never drop the review). The gate reports every
// violation; `result.mustDrop` is true iff ANY enforced (safety) rule fired.
describe('enforce-vs-telemetry classification (B1 / D-11)', () => {
  const SAFETY_RULES: DecisionReviewContractRule[] = [
    'missing_review_card',
    'fabricated_continuity_phrase',
    'ungrounded_entity_reference',
  ];
  const CAP_RULES: DecisionReviewContractRule[] = [
    'bias_findings_cap_exceeded',
    'decision_quality_prompts_cap_exceeded',
    'key_assumptions_cap_exceeded',
    'scenario_contexts_cap_exceeded',
  ];

  it('safety rules ENFORCE (drop); count-cap rules are telemetry-only', () => {
    for (const r of SAFETY_RULES) expect(isEnforcedRule(r)).toBe(true);
    for (const r of CAP_RULES) expect(isEnforcedRule(r)).toBe(false);
    // COUNT_CAP_RULES is EXACTLY the four cap rules — the only telemetry-only
    // exemption set. (Fail-closed: anything not in it enforces.)
    expect([...COUNT_CAP_RULES].sort()).toEqual([...CAP_RULES].sort());
  });

  it('fail-closed: enforced ⇔ NOT a count-cap rule, across the whole vocabulary', () => {
    for (const r of [...SAFETY_RULES, ...CAP_RULES]) {
      expect(isEnforcedRule(r)).toBe(!COUNT_CAP_RULES.has(r));
    }
  });

  it('count-cap-only breach (ka=4/dqp=3/bias=3): ok=false but mustDrop=false', () => {
    // A prompt-legal tolerance-band review that SHIPS today (shape-check rejects
    // only at bias>3 / dqp>3 / ka>5). All three breach the TIGHT gate caps; NO
    // safety violation. D-11: telemetry fires (ok=false) but the review is NOT
    // dropped (mustDrop=false).
    const capOnly = goodReview();
    capOnly.key_assumptions = ['a', 'b', 'c', 'd']; // 4 > 3
    capOnly.decision_quality_prompts = [{ q: 1 }, { q: 2 }, { q: 3 }]; // 3 > 2
    capOnly.bias_findings = [
      { type: 'a', source: 'structural', description: 'a', affected_elements: ['node-price'] },
      { type: 'b', source: 'structural', description: 'b', affected_elements: ['node-demand'] },
      { type: 'c', source: 'structural', description: 'c', affected_elements: ['edge-price-demand'] },
    ]; // 3 > 2, every affected_element grounded
    const result = checkDecisionReviewContract(capOnly, GATE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.mustDrop).toBe(false);
    expect(result.violations.map((v) => v.rule).sort()).toEqual([
      'bias_findings_cap_exceeded',
      'decision_quality_prompts_cap_exceeded',
      'key_assumptions_cap_exceeded',
    ]);
  });

  it('a safety breach (missing_review_card): mustDrop=true', () => {
    const bad = goodReview();
    delete bad.narrative_summary;
    const result = checkDecisionReviewContract(bad, GATE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.mustDrop).toBe(true);
  });

  it('mixed safety + count-cap: mustDrop=true and BOTH reported', () => {
    const bad = goodReview();
    bad.narrative_summary = 'As you mentioned, Option A stays ahead.'; // R-CONT (safety)
    bad.key_assumptions = ['a', 'b', 'c', 'd']; // count-cap
    const result = checkDecisionReviewContract(bad, GATE_INPUT);
    expect(result.mustDrop).toBe(true);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain('fabricated_continuity_phrase');
    expect(rules).toContain('key_assumptions_cap_exceeded');
  });

  it('a clean review: ok=true, mustDrop=false', () => {
    const result = checkDecisionReviewContract(goodReview(), GATE_INPUT);
    expect(result.ok).toBe(true);
    expect(result.mustDrop).toBe(false);
  });
});

describe('collectGraphEntityIds', () => {
  it('collects node and edge ids, ignoring malformed entries', () => {
    const ids = collectGraphEntityIds({
      nodes: [{ id: 'n1' }, { label: 'no id' }, 'junk'],
      edges: [{ id: 'e1' }, {}],
    });
    expect([...ids].sort()).toEqual(['e1', 'n1']);
  });

  it('returns an empty set for an unrecognisable graph', () => {
    expect(collectGraphEntityIds({}).size).toBe(0);
    expect(collectGraphEntityIds({ nodes: 'nope' }).size).toBe(0);
  });
});

describe('findFabricatedContinuityHit', () => {
  it('returns the matched phrase on a hit, null when clean', () => {
    expect(findFabricatedContinuityHit('As you mentioned, X.')).not.toBeNull();
    expect(findFabricatedContinuityHit('The margin is wide and the result is stable.')).toBeNull();
  });
});

// ── P2-2: fabricated-continuity pattern PRECISION ─────────────────────────
// R-CONT is an ENFORCE-DROP rule, so a FALSE POSITIVE drops a legitimate
// review. After the PR #645 fix-round narrowing, these LEGITIMATE phrasings
// must NOT match (negative controls), while the genuinely-fabricated callbacks
// the patterns were narrowed against MUST still match (positive controls).
// Where a pattern cannot be made precise without conversation context the rule
// is deliberately biased to FALSE-NEGATIVE (miss a rare fabrication) over
// FALSE-POSITIVE (drop a good review) — see the R-CONT doc in contract-gate.ts.
describe('R-CONT pattern precision (P2-2 negative + positive controls)', () => {
  // Each legit phrasing pairs with the narrowed pattern that USED to false-fire
  // on it, so a regression that re-broadens a pattern turns this red.
  const LEGITIMATE_PHRASES = [
    // "the … you ran/described" — the user initiates the analysis run and the
    // scenario/question live in the brief the review HAS; grounded, not a prior
    // turn. (Narrowed: `the (pre-mortem|exercise) you …` only.)
    'Building on the analysis you ran, the leading option holds.',
    'The scenario you described leaves demand as the swing factor.',
    // "in this analysis" — intra-artefact self-reference to THIS review.
    'In this analysis, the leading option holds a clear lead.',
    // "your pre-mortem" prospective / first-person DQP guidance — not a
    // callback to a pre-mortem the user already did. (Narrowed: requires a
    // past-finding verb after "your pre-mortem".)
    'Your pre-mortem should focus on the demand assumption.',
    // "as noted above" — intra-document back-reference, not a prior
    // conversation. (Narrowed: dropped `above` from the staleness pattern.)
    'As noted above, the margin on the leading option is thin.',
  ];
  it.each(LEGITIMATE_PHRASES)('does NOT flag a legitimate phrasing: %s', (phrase) => {
    expect(findFabricatedContinuityHit(phrase)).toBeNull();
    const ok = goodReview();
    ok.narrative_summary = phrase;
    expect(checkDecisionReviewContract(ok, GATE_INPUT).ok).toBe(true);
  });

  // Positive controls — narrowing must NOT gut the rule: each genuine
  // fabricated callback the patterns target still drops.
  const FABRICATED_PHRASES = [
    'As you mentioned, the leading option keeps its lead.',
    'As we discussed, the framing leans on one price point.',
    'Treat this as the evidence your pre-mortem asked for.',
    'This only confirms the exercise you did.',
    'As discussed earlier, demand is the swing factor.',
    'The previous analysis pointed the same way.',
  ];
  it.each(FABRICATED_PHRASES)('still flags a genuine fabricated callback: %s', (phrase) => {
    expect(findFabricatedContinuityHit(phrase)).not.toBeNull();
    const bad = goodReview();
    bad.narrative_summary = phrase;
    expect(rulesOf(bad)).toContain('fabricated_continuity_phrase');
  });
});

describe('summariseContractViolations (R-004-clean telemetry)', () => {
  it('reduces to bounded rule codes and a count — no user text', () => {
    const bad = goodReview();
    delete bad.narrative_summary;
    (bad.bias_findings as Record<string, unknown>[])[0].affected_elements = ['node-nope'];
    const { violations } = checkDecisionReviewContract(bad, GATE_INPUT);
    const summary = summariseContractViolations(violations);
    expect(summary.reason).toBe('missing_review_card'); // sorted-first
    expect(summary.reasons).toBe('missing_review_card,ungrounded_entity_reference');
    expect(summary.violation_count).toBe(2);
    // Nothing in the payload carries prose, a label, or a raw id.
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain('node-nope');
  });
});
