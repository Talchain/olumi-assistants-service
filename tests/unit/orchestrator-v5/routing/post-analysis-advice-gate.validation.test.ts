/**
 * V5 coaching orchestration — validation/research intent recognition in
 * the post-analysis advice gate.
 *
 * Covers the new `evidence_gap` patterns added for the workstream's
 * analysis-complete moment ("what should we validate/research?", "how
 * do we build confidence?", "what assumptions should we test?", "what
 * evidence should we gather?", "validate or research further"), plus
 * the validation-aware composer branch in `composeEvidenceGap` that
 * leads with a top-driver / fragile-edge recommendation.
 *
 * Companion to the comprehensive matrix in
 * `src/orchestrator-v5/routing/__tests__/post-analysis-advice-gate.test.ts`
 * and the latency check in `post-analysis-advice-gate.timing.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../../../../src/orchestrator-v5/routing/post-analysis-advice-gate.js';
import { findForbiddenPhraseHit } from '../../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally', probability: 0.62 },
  runner_up: { label: 'Hire one senior engineer overseas', probability: 0.38 },
  margin_pp: 24,
  robustness_band: 'moderate',
  top_drivers: [
    { factor_label: 'Delivery risk', sensitivity_value: 0.45 },
    { factor_label: 'Cost overrun risk', sensitivity_value: -0.32 },
  ],
  fragile_edges: [
    { from_label: 'Delivery risk', to_label: 'Successful launch' },
  ],
};

// =========================================================================
// Classification — each phrasing the workstream brief lists must route to
// `evidence_gap`. The composer enriches the response with a validation-
// aware lead, but the routing decision happens here.
// =========================================================================
describe('advice-gate — validation/research intent recognition', () => {
  const phrasings: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should we validate?', label: 'what should we validate' },
    { message: 'What should we research?', label: 'what should we research' },
    { message: 'How do we build confidence?', label: 'how do we build confidence' },
    { message: 'How to build confidence in this decision?', label: 'how to build confidence' },
    { message: 'What evidence should we gather?', label: 'what evidence should we gather' },
    { message: 'What assumptions should we test?', label: 'what assumptions should we test' },
    {
      // The spec's long-form composite. Subject/verb word order is
      // "we should validate" (not "should we validate"), so the family's
      // word-order alternation must catch it; the disjunction safety net
      // also fires on "validate or research".
      message:
        'Do you have any recommendations for what we should validate or research further to build confidence in our decision?',
      label: 'long-form composite (we should validate or research further)',
    },
  ];

  for (const { message, label } of phrasings) {
    it(`routes to evidence_gap: ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe('evidence_gap');
        expect(out.assistant_text.length).toBeGreaterThan(0);
        // Copy-safety invariants — same set the main matrix enforces.
        expect(out.assistant_text.toLowerCase()).not.toContain('recommendation');
        expect(out.assistant_text.toLowerCase()).not.toContain('recommended');
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bthe\s+winners?\b/);
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bwinning\s+(option|probability|side|choice|outcome)\b/);
        expect(out.assistant_text).not.toMatch(/\boption_\w+\b/);
        expect(out.assistant_text).not.toMatch(/\bfac_\w+\b/);
        expect(out.assistant_text).not.toMatch(/\bcon_\w+\b/);
        // Central forbidden-phrase guard
        expect(findForbiddenPhraseHit(out.assistant_text)).toBeNull();
      }
    });
  }
});

// =========================================================================
// Validation-aware composer lead — `composeEvidenceGap` is supposed to
// reorder its response when the matched message carries a validation
// flavour, leading with the top-driver recommendation and (if present)
// the fragile-edge sentence.
// =========================================================================
describe('advice-gate — composeEvidenceGap validation-aware lead', () => {
  it('leads with the top-driver recommendation when present', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate to build confidence in this decision?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Lead names the top driver and frames it as the place where new
      // evidence has the most leverage.
      expect(out.assistant_text).toMatch(/^The most useful place to gather evidence is Delivery risk\./);
      expect(out.assistant_text).toContain('new data would change the analysis the most');
    }
  });

  it('appends the fragile-edge sentence after the lead when both signals are present', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What assumptions should we test?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Delivery risk'); // lead
      expect(out.assistant_text).toContain(
        '"Delivery risk" to "Successful launch"',
      );
      expect(out.assistant_text).toContain('most sensitive');
    }
  });

  it('uses fragile-edge as the sole lead when top_drivers is empty', () => {
    // Validation-aware behaviour: top_drivers and fragile_edges are
    // independent — when only fragile_edges is present, the composer
    // STILL leads with the validation sentence (just the fragile-edge
    // one). The fall-through to gap-list only fires when BOTH grounding
    // signals are absent. evidence_gap's mixed predicate (readiness OR
    // top_drivers) lets the gate match via readiness while top_drivers
    // is empty.
    const analysis: AdviceGateAnalysis = {
      ...FIXTURE_ANALYSIS,
      top_drivers: [],
    };
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis,
      analysisReady: {
        goal_node_id: 'goal_1',
        status: 'needs_user_mapping',
        options: [
          {
            option_id: 'opt_a',
            label: 'Hire two senior engineers locally',
            status: 'needs_user_mapping',
            interventions: {},
          },
          {
            option_id: 'opt_b',
            label: 'Hire one senior engineer overseas',
            status: 'needs_encoding',
            interventions: {},
          },
        ],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // No top-driver lead (top_drivers is empty).
      expect(out.assistant_text).not.toContain('The most useful place to gather evidence is');
      // Fragile-edge sentence is emitted as the sole validation-aware lead.
      expect(out.assistant_text).toContain('worth validating the link');
      expect(out.assistant_text).toContain('"Delivery risk" to "Successful launch"');
    }
  });

  it('falls through to gap-list only when BOTH top_drivers and fragile_edges are absent', () => {
    // Validation-flavour message + neither grounding signal → composer
    // can't emit a useful validation lead, so the fall-through path
    // engages. The gate still matches via the readiness branch of
    // evidence_gap's mixed predicate.
    const analysis: AdviceGateAnalysis = {
      ...FIXTURE_ANALYSIS,
      top_drivers: [],
      fragile_edges: [],
    };
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis,
      analysisReady: {
        goal_node_id: 'goal_1',
        status: 'needs_user_mapping',
        options: [
          {
            option_id: 'opt_a',
            label: 'Hire two senior engineers locally',
            status: 'needs_user_mapping',
            interventions: {},
          },
          {
            option_id: 'opt_b',
            label: 'Hire one senior engineer overseas',
            status: 'needs_encoding',
            interventions: {},
          },
        ],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).not.toContain('The most useful place to gather evidence is');
      expect(out.assistant_text).not.toContain('worth validating the link');
      const hasGapList =
        out.assistant_text.includes('biggest open gap') ||
        out.assistant_text.includes("aren't obvious structural gaps");
      expect(hasGapList).toBe(true);
    }
  });

  it('does not duplicate top-driver naming when both lead and fall-through would fire', () => {
    // Regression guard: the lead emits "is Delivery risk" exactly once.
    // If a future refactor dropped the early `return` and let the
    // fall-through also append, the same factor would appear twice.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const matches = out.assistant_text.match(/Delivery risk/g) ?? [];
      // The lead names it once; the fragile-edge sentence names it again
      // as part of the link description. Two mentions are correct.
      // What MUST NOT happen is the gap-list fall-through running on top,
      // which would push the count to ≥3.
      expect(matches.length).toBeLessThanOrEqual(2);
    }
  });
});

// =========================================================================
// Data-availability fallback — empty / whitespace-only label degrades to
// `data_unavailable_for_class` rather than emitting malformed prose.
// =========================================================================
describe('advice-gate — validation phrasings under data-availability', () => {
  it('whitespace-only top_drivers[0].factor_label suppresses the top-driver lead (no malformed prose)', () => {
    // The composer's `topDriverLabel.trim().length > 0` guard rejects
    // whitespace-only labels so the lead never interpolates "is  ."
    // The fragile-edge sentence still emits if `fragile_edges` is non-
    // empty (independent grounding signal); we assert that the validation
    // path produces SOMETHING grounded — never the malformed lead.
    const analysis: AdviceGateAnalysis = {
      ...FIXTURE_ANALYSIS,
      top_drivers: [{ factor_label: '   ', sensitivity_value: 0.45 }],
    };
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Lead must not interpolate the whitespace-only label.
      expect(out.assistant_text).not.toMatch(/is\s+\.\s/);
      expect(out.assistant_text).not.toMatch(/is\s+\s*,/);
      expect(out.assistant_text).not.toMatch(/place to gather evidence is\s+[.,]/);
      // No malformed top-driver lead reaches the wire.
      expect(out.assistant_text).not.toContain('The most useful place to gather evidence is   .');
      // Fragile-edge sentence emits as the validation-aware lead.
      expect(out.assistant_text).toContain('worth validating the link');
    }
  });

  it('evidence_gap with no readiness AND no drivers → data_unavailable_for_class even on validation phrasing', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [], fragile_edges: [] },
      analysisReady: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('evidence_gap');
      expect(out.missing_inputs).toContain('analysis_ready_or_top_drivers');
    }
  });

  it('stale freshness → not_fresh (gate suppresses, validation path included)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'stale',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('not_fresh');
  });

  it('unknown freshness → not_fresh', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we research?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'unknown',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('not_fresh');
  });
});

// =========================================================================
// Mutation-signal precedence — concrete edits paired with validation
// phrasings MUST still short-circuit to `mutation_signal`, never
// emitting deterministic coaching copy on top of a real edit.
// =========================================================================
describe('advice-gate — mutation precedence over validation phrasings', () => {
  const mutationPairs: ReadonlyArray<readonly [string, string]> = [
    ['Set marketing spend to 50000. What should we validate?', 'set + to + numeric, then validate'],
    ['Change delivery risk to 0.7 — what assumptions should we test?', 'change + to + numeric, then test assumptions'],
    ['From 30 to 50, what should we research?', 'from-to edit + research'],
    [
      'Adjust the edge from Cost to Risk and tell me what we should validate or research further.',
      'edge edit + long-form composite',
    ],
    ['Add a new constraint on budget — how do we build confidence?', 'add + entity, then confidence'],
    ['Remove the cost factor. What evidence should we gather?', 'remove + entity, then gather'],
  ];

  for (const [message, label] of mutationPairs) {
    it(`mutation wins: ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('mutation_signal');
    });
  }

  it('pure validation phrasing (no edit) still routes', () => {
    // Sanity check: confirm the suite isn't accidentally fast-failing
    // every validation phrasing. The mutation-precedence cases above
    // would silently pass on a regression that broke the new patterns
    // entirely; this paired case proves they still fire when no edit
    // is present.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate or research?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) expect(out.advice_class).toBe('evidence_gap');
  });
});
