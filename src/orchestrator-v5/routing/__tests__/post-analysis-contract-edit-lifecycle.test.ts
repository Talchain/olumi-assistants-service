/**
 * V5 post-analysis interaction contract v1 — edit-lifecycle regression locks.
 *
 * Verifies the new advice-gate patterns (post-analysis-advice-gate.ts and
 * analytical-intent.ts) do not regress the edit-lifecycle behaviours
 * shipped by PR #192 (deterministic from/to value edits), PR #194
 * (vague-edit + chip+vague pre-LLM intercepts), or PR #196 (honest
 * what_would_flip copy on fragile + near-tie).
 *
 * Lightweight by design — the canonical edit-lifecycle coverage lives
 * in `deterministic-value-update.test.ts`,
 * `deterministic-value-update.from-to.test.ts`, `vague-edit-guard.test.ts`,
 * and `coaching/__tests__/robustness-honesty.test.ts`. This file only
 * asserts the BOUNDARIES between those paths and the new advice
 * patterns so the workstream cannot quietly steal their phrases.
 */

import { describe, expect, it } from 'vitest';

import { tryVagueEditGuard } from '../vague-edit-guard.js';
import { hasMutationSignal } from '../analytical-intent.js';
import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';
import type { RawRobustnessSignals } from '../../coaching/robustness-honesty.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Option A' },
  runner_up: { label: 'Option B' },
  margin_pp: 12,
  top_drivers: [{ factor_label: 'Pricing' }],
  fragile_edges: [],
};

const FIXTURE_ANALYSIS_NEAR_TIE: AdviceGateAnalysis = {
  ...FIXTURE_ANALYSIS,
  margin_pp: 0.5, // < NEAR_TIE_PP_THRESHOLD = 1.0
};

const READY_PAYLOAD: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'ready',
  goal_threshold: 0.7,
  options: [
    { option_id: 'opt_a', label: 'Option A', status: 'ready', interventions: {} },
    { option_id: 'opt_b', label: 'Option B', status: 'ready', interventions: {} },
  ],
};

// =========================================================================
// PR #194 — vague-edit-guard still owns its phrases
//
// The new advice patterns must not steal "Make this better", "Change
// this", "Improve this" — those remain vague-edit intercepts.
// =========================================================================
describe('PR #194 regression — vague-edit-guard owns its phrases', () => {
  const vaguePhrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Make this better.', label: 'make this better' },
    { message: 'Change this.', label: 'change this' },
    { message: 'Improve this.', label: 'improve this' },
    { message: 'Simplify this.', label: 'simplify this' },
    { message: 'Tweak it.', label: 'tweak it' },
    { message: 'Adjust the model.', label: 'adjust the model' },
  ];

  for (const { message, label } of vaguePhrases) {
    it(`vague-edit-guard matches: ${label}`, () => {
      const out = tryVagueEditGuard(message, []);
      expect(out.matched).toBe(true);
    });
    it(`advice-gate does NOT match (vague-edit-guard owns it): ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD,
        freshness: 'fresh',
      });
      // Advice gate may legitimately not-match for any of several reasons,
      // but must not match `update_advice`/`advice` from the new patterns.
      if (out.matched) {
        expect(out.advice_class).not.toBe('update_advice');
        expect(out.advice_class).not.toBe('advice');
      }
    });
  }

  it('"Tell me what to change" stays in advice-gate (does NOT trigger vague-edit-guard)', () => {
    // Vague-edit-guard requires a vague-edit shape; "tell me what to
    // change" does not match its 8 phrase patterns. Advice gate owns it.
    expect(tryVagueEditGuard('Tell me what to change.', []).matched).toBe(false);
    const adviceOut = tryPostAnalysisAdviceGate({
      message: 'Tell me what to change.',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD,
      freshness: 'fresh',
    });
    expect(adviceOut.matched).toBe(true);
    if (adviceOut.matched) expect(adviceOut.advice_class).toBe('update_advice');
  });
});

// =========================================================================
// PR #192 — concrete edits with "to <value>" still mutate
//
// Mutation precedence in the advice gate must reject any message
// carrying a concrete value, even when wrapped in imperative-advice
// phrasing. value-update-pre-route (turn-executor.ts) owns these.
// =========================================================================
describe('PR #192 regression — concrete value-edit phrases still mutate', () => {
  const concreteEdits: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Set Pricing to £100', label: 'set + to numeric (existing)' },
    { message: 'Change Pricing from £80 to £100', label: 'from/to (PR #192 deictic)' },
    { message: 'Tell me what to change Pricing to £100', label: 'advice prefix + concrete to-value' },
    { message: 'Tell me what to change Pricing from £80 to £100', label: 'advice prefix + from/to' },
    { message: 'What needs to change? Set delivery risk to 0.7.', label: 'advice question + bare set' },
    { message: 'Help me figure out what to change — adjust budget to 200', label: 'help-me + adjust-to-value' },
  ];

  for (const { message, label } of concreteEdits) {
    it(`hasMutationSignal === true: ${label}`, () => {
      expect(hasMutationSignal(message)).toBe(true);
    });
    it(`advice-gate returns mutation_signal: ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('mutation_signal');
    });
  }

  it('"Tell me what to change" (no value) stays advice — does NOT mutate', () => {
    expect(hasMutationSignal('Tell me what to change.')).toBe(false);
    expect(hasMutationSignal('What needs to change?')).toBe(false);
    expect(hasMutationSignal('Show me what to update.')).toBe(false);
  });
});

// =========================================================================
// PR #196 — honest copy on fragile + near-tie
//
// The advice-gate composers that branch on near-tie / raw-fragile
// (composeImprovement, composeWhatWouldFlip) must continue to suppress
// stability claims on a near-tie or raw-fragile result. The new
// patterns route to update_advice/advice (composeAdvice), which is
// neutral by construction ("it could change the result") — assert
// neutrality holds.
// =========================================================================
describe('PR #196 regression — honest copy on fragile + near-tie', () => {
  const RAW_FRAGILE: RawRobustnessSignals = {
    level: 'fragile',
    near_tie_is_tie: false,
  };

  it('composeImprovement on raw-fragile result emits the fragile-aware caveat', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we improve?',
      analysis: { ...FIXTURE_ANALYSIS, robustness_band: 'wide' },
      analysisReady: READY_PAYLOAD,
      rawRobustness: RAW_FRAGILE,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text.toLowerCase()).toMatch(/fragile/);
      // Should NOT echo the "smaller adjustments may not move the picture
      // much" stability claim from the wide-robustness branch.
      expect(out.assistant_text.toLowerCase()).not.toMatch(
        /smaller\s+adjustments\s+may\s+not\s+move/,
      );
    }
  });

  it('composeImprovement on near-tie result emits the fragile-aware caveat', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we improve?',
      analysis: { ...FIXTURE_ANALYSIS_NEAR_TIE, robustness_band: 'wide' },
      analysisReady: READY_PAYLOAD,
      rawRobustness: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text.toLowerCase()).toMatch(/fragile/);
      expect(out.assistant_text.toLowerCase()).not.toMatch(
        /smaller\s+adjustments\s+may\s+not\s+move/,
      );
    }
  });

  it('new "Tell me what to change" route uses composeAdvice — neutral, no overclaim', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Tell me what to change.',
      analysis: FIXTURE_ANALYSIS_NEAR_TIE,
      analysisReady: READY_PAYLOAD,
      rawRobustness: RAW_FRAGILE,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('update_advice');
      const text = out.assistant_text.toLowerCase();
      // composeAdvice phrasing — "could change the result" is fragile-
      // honest by construction; no overclaim required.
      expect(text).toMatch(/could\s+change\s+the\s+result/);
      // Must not promise stability on a fragile/near-tie result.
      expect(text).not.toMatch(/\bproven\b/);
      expect(text).not.toMatch(/\bcertain\b/);
      expect(text).not.toMatch(/\bscientifically\s+(?:validated|proven)\b/);
      expect(text).not.toMatch(/smaller\s+adjustments\s+may\s+not\s+move/);
    }
  });
});
