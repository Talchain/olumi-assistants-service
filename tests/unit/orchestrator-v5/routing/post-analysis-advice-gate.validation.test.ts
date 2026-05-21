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

  it('skips a blank-endpoint fragile edge even when top driver is renderable', () => {
    // Round-2 P1: composer-side renderability filter. Previously the
    // validation-aware lead picked `fragile_edges[0]` blindly; a blank
    // `from_label` would emit `validating the link from "" to "B"`.
    // The composer now routes fragile-edge picks through
    // `renderableFragileEdges`, so the malformed sentence cannot reach
    // assistant text — only the valid top-driver lead remains.
    const analysis: AdviceGateAnalysis = {
      ...FIXTURE_ANALYSIS,
      fragile_edges: [{ from_label: '', to_label: 'Successful launch' }],
    };
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Top-driver lead is present.
      expect(out.assistant_text).toContain(
        'The most useful place to gather evidence is Delivery risk',
      );
      // Fragile-edge sentence is SUPPRESSED (no malformed quotes).
      expect(out.assistant_text).not.toContain('worth validating the link');
      expect(out.assistant_text).not.toMatch(/link from\s*""\s*to/);
      expect(out.assistant_text).not.toMatch(/link from "[^"]+" to ""/);
    }
  });

  it('picks the first RENDERABLE fragile edge when [0] is blank but [1] is valid', () => {
    // Renderability filter must scan the whole array, not bail on [0].
    // A degraded leading entry must not mask a downstream renderable one.
    const analysis: AdviceGateAnalysis = {
      ...FIXTURE_ANALYSIS,
      fragile_edges: [
        { from_label: '   ', to_label: 'Outcome A' }, // blank-shaped
        { from_label: 'Cost overrun risk', to_label: 'Outcome B' }, // valid
      ],
    };
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('worth validating the link');
      expect(out.assistant_text).toContain(
        '"Cost overrun risk" to "Outcome B"',
      );
      // The blank entry's endpoint label must NOT appear in prose.
      expect(out.assistant_text).not.toMatch(/"\s+"/);
      expect(out.assistant_text).not.toContain('"Outcome A"');
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

  it('evidence_gap with no readiness AND no drivers AND no fragile edges → data_unavailable_for_class even on validation phrasing', () => {
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
      expect(out.missing_inputs).toContain('analysis_ready_or_top_drivers_or_fragile_edge');
    }
  });

  it('whitespace-only driver + no fragile edges + no readiness → data_unavailable_for_class (renderability gate)', () => {
    // Renderability fix: a whitespace-only `factor_label` is NOT a
    // sufficient grounding signal even though `top_drivers.length > 0`.
    // Previously this combination would match the gate, then the
    // gap-list fall-through inside composeEvidenceGap would emit
    // "sensitivity is on   ". The gate now rejects the match upfront.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        top_drivers: [{ factor_label: '   ', sensitivity_value: 0.45 }],
        fragile_edges: [],
      },
      analysisReady: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('evidence_gap');
      expect(out.missing_inputs).toContain('analysis_ready_or_top_drivers_or_fragile_edge');
    }
  });

  it('renderable fragile-edge ONLY (no drivers, no readiness) → match with fragile-edge-only validation lead', () => {
    // Regression guard: previously this analysis shape was rejected
    // even though the composer can produce grounded prose from just
    // the fragile edge. The renderability fix accepts fragile_edges as
    // a first-class grounding signal on its own.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        top_drivers: [],
        // fragile_edges from FIXTURE_ANALYSIS is preserved.
      },
      analysisReady: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      // No top-driver lead.
      expect(out.assistant_text).not.toContain('The most useful place to gather evidence is');
      // Fragile-edge sentence is the sole validation lead.
      expect(out.assistant_text).toContain('worth validating the link');
      expect(out.assistant_text).toContain('"Delivery risk" to "Successful launch"');
      // Gap-list fall-through MUST NOT have fired (composer returned
      // early with the fragile-edge lead).
      expect(out.assistant_text).not.toContain('biggest open gap');
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
// Chip-click routing — the prompt chip emitted by chip-generator.ts after a
// successful run_analysis has NO `action_type`. On click, DGAI submits the
// chip's `message` as the next turn's user text. That message MUST route
// to `evidence_gap` (validation-aware composer) through the same
// deterministic, synchronous, no-LLM path tested elsewhere.
//
// `tryPostAnalysisAdviceGate` is structurally synchronous — see
// `post-analysis-advice-gate.timing.test.ts` for the "no Promise" /
// loop-budget proof. Combined with the routing assertion below, the chip-
// click flow has end-to-end coverage with zero LLM calls.
// =========================================================================
describe('advice-gate — chip-click routing (chip_prompt_validate_assumptions)', () => {
  // Mirror of the exact `message` string from
  // src/orchestrator-v5/compose/chip-generator.ts (post-run_analysis
  // branch). Hard-coded here so a regression that changes the chip copy
  // surfaces as a clean assertion miss.
  const CHIP_MESSAGE =
    'What should we validate or research to build confidence in this decision?';

  it('chip message routes to evidence_gap with validation-aware lead', () => {
    const out = tryPostAnalysisAdviceGate({
      message: CHIP_MESSAGE,
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      // Validation-aware lead fires (top_driver lead + fragile-edge
      // sentence). Verifies the chip click reaches the same deterministic
      // composer the catch-net free-text tests above cover.
      expect(out.assistant_text).toContain('The most useful place to gather evidence is');
      expect(out.assistant_text).toContain('Delivery risk');
      expect(out.assistant_text).toContain('worth validating the link');
    }
  });

  it('chip message is structurally synchronous (no Promise)', () => {
    // Defence-in-depth: even though the timing test asserts this for
    // multiple phrasings, the exact chip message must NEVER become
    // async in isolation either. A Promise here would indicate a
    // regression that broke the deterministic chip-click path.
    const result = tryPostAnalysisAdviceGate({
      message: CHIP_MESSAGE,
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(result).not.toHaveProperty('then');
  });

  it('chip message is rejected when freshness is stale (chip should not have been emitted)', () => {
    // The chip itself is gated on a successful run_analysis fact on
    // the current turn (chip-generator's `handlerJustRan ===
    // 'run_analysis'` branch). If a stale follow-up turn somehow
    // replays the chip text, the gate must still suppress so the user
    // sees the stale-rerun path instead of a stale coaching answer.
    const out = tryPostAnalysisAdviceGate({
      message: CHIP_MESSAGE,
      analysis: FIXTURE_ANALYSIS,
      freshness: 'stale',
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
