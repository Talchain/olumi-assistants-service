/**
 * AI Harness capability 1 — targeted honesty / safety proofs.
 *
 * Four narrow, deterministic proofs requested at review time:
 *   A. Committed mutation-success language is PRESERVED (not neutralised).
 *   B. Non-committed mutation-success language is NEUTRALISED (swapped).
 *   C. Benign prose is NOT over-suppressed.
 *   D. The safe-now composer never SURFACES held-science fields, even when the
 *      analysis carries them.
 *
 * These exercise the exact predicates the runtime guards use:
 *   - `classifyStructuralClaim` (the always-on finalise neutraliser + STEP 6.6),
 *   - `findSuccessClaimHit` / `findForbiddenPhraseHit` (egress detectors),
 *   - `tryPostAnalysisAdviceGate` (the flag-gated safe-now composer).
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
  type AdviceGateCanonicalState,
} from '../../../src/orchestrator-v5/routing/post-analysis-advice-gate.js';
import {
  classifyStructuralClaim,
  V5_STRUCTURAL_DECLINE_TEXT,
} from '../../../src/orchestrator-v5/routing/mutation-language.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';
import type { GraphPatchBlockData } from '../../../src/orchestrator/types.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// High-confidence first-person STRUCTURAL completion/commitment claims — the
// precise class the always-on neutraliser (and STEP 6.6) is anchored on.
const STRUCTURAL_SUCCESS_CLAIMS: readonly string[] = [
  'I added a factor to your model.',
  "I'll add the new option to your model now.",
];

// Lower-confidence claims that are MONITOR-ONLY by design (value-update +
// vague/passive). The precision-first contract deliberately does NOT swap
// these — widening them is deferred to #288/#289 and is OUT OF SCOPE here.
// Tested explicitly so the honesty boundary is documented, not accidental.
const MONITOR_ONLY_CLAIMS: readonly string[] = [
  "I've updated the budget to 50,000.",
  'I have applied the change to the graph.',
];

const ALL_CLAIMS: readonly string[] = [...STRUCTURAL_SUCCESS_CLAIMS, ...MONITOR_ONLY_CLAIMS];

const CANON_USABLE: AdviceGateCanonicalState = {
  status: 'needs_user_mapping',
  usableForProse: true,
  blockedUnusable: false,
};

const READY_OPEN: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_user_mapping',
  options: [
    { option_id: 'opt_a', label: 'Option A', status: 'needs_user_mapping', interventions: {} },
    { option_id: 'opt_b', label: 'Option B', status: 'needs_encoding', interventions: {} },
  ],
};

describe('AI Harness cap-1 — targeted honesty / safety proofs', () => {
  // ── A. Committed mutation-success language PRESERVED ───────────────────────
  describe('A: committed mutation success is preserved', () => {
    it.each(ALL_CLAIMS)('handler emitted mutated_graph → no swap: %s', (text) => {
      const decision = classifyStructuralClaim({
        assistantText: text,
        handlerEmittedMutatedGraph: true, // a durable mutation committed this turn
        proposedHandlerId: 'set_factor_value',
      });
      expect(decision.verdict).toBe('pass'); // success language is TRUE → kept
    });

    it('draft_graph / edit_graph system mutations are also exempt', () => {
      for (const handler of ['draft_graph', 'edit_graph'] as const) {
        const d = classifyStructuralClaim({
          assistantText: 'I added a factor to your model.',
          handlerEmittedMutatedGraph: false,
          proposedHandlerId: handler,
        });
        expect(d.verdict).toBe('pass');
      }
    });
  });

  // ── B. Non-committed mutation-success language NEUTRALISED ─────────────────
  describe('B: non-committed mutation-success language is neutralised', () => {
    it.each(STRUCTURAL_SUCCESS_CLAIMS)('structural claim, no mutation → swap: %s', (text) => {
      const decision = classifyStructuralClaim({
        assistantText: text,
        handlerEmittedMutatedGraph: false, // nothing committed
        proposedHandlerId: null,
      });
      expect(decision.verdict).toBe('swap');
    });

    // Documented boundary (precision-first contract): value-update / vague
    // claims are MONITOR-ONLY — NOT swapped. Widening these is the deferred
    // #288/#289 work the brief explicitly keeps out of scope. This asserts the
    // boundary is intentional, not a silent gap.
    it.each(MONITOR_ONLY_CLAIMS)('value-update/vague claim → monitor-only, not swapped: %s', (text) => {
      const decision = classifyStructuralClaim({
        assistantText: text,
        handlerEmittedMutatedGraph: false,
        proposedHandlerId: null,
      });
      expect(decision.verdict).not.toBe('swap');
    });

    it('the swap target is the neutral decline text (contains no claim)', () => {
      // Mirrors what the finalise guard substitutes; re-classifying it is a no-op.
      expect(findSuccessClaimHit(V5_STRUCTURAL_DECLINE_TEXT)).toBeNull();
      expect(findForbiddenPhraseHit(V5_STRUCTURAL_DECLINE_TEXT)).toBeNull();
      expect(
        classifyStructuralClaim({
          assistantText: V5_STRUCTURAL_DECLINE_TEXT,
          handlerEmittedMutatedGraph: false,
          proposedHandlerId: null,
        }).verdict,
      ).not.toBe('swap');
    });
  });

  // ── C. Benign prose NOT over-suppressed ───────────────────────────────────
  describe('C: benign prose is not over-suppressed', () => {
    const BENIGN: readonly string[] = [
      "Here's what's still open: the goal doesn't have a measurable success threshold set.",
      'You can re-run the analysis or look at what could change the outcome.',
      'I can help you map the options to factors whenever you are ready.',
      'Your most recent analysis is up to date with the current model.',
      'Recent change in view: Customer churn from 10% to 12%.',
    ];
    it.each(BENIGN)('benign prose → no swap, no false hit: %s', (text) => {
      expect(
        classifyStructuralClaim({
          assistantText: text,
          handlerEmittedMutatedGraph: false,
          proposedHandlerId: null,
        }).verdict,
      ).not.toBe('swap');
      expect(findSuccessClaimHit(text)).toBeNull();
      expect(findForbiddenPhraseHit(text)).toBeNull();
    });

    it('the actual safe-now composer output is itself benign (not swapped)', () => {
      const out = tryPostAnalysisAdviceGate({
        message: 'What does this mean?',
        analysis: { status: 'success', leading_option: null, top_drivers: [] },
        analysisReady: READY_OPEN,
        freshness: 'fresh',
        canonicalState: CANON_USABLE,
        recentChanges: [{ summary: 'Customer churn from 10% to 12%' }],
      });
      expect(out.matched).toBe(true);
      if (!out.matched) return;
      expect(out.copy_source).toBe('canonical_rich');
      expect(
        classifyStructuralClaim({
          assistantText: out.assistant_text,
          handlerEmittedMutatedGraph: false,
          proposedHandlerId: null,
        }).verdict,
      ).not.toBe('swap');
    });
  });

  // ── D. Held-science fields NOT surfaced by the safe-now composer ───────────
  describe('D: safe-now composer never surfaces held-science fields', () => {
    it('drivers / fragile edges / sensitivity present in analysis → absent from the answer', () => {
      const UNIQUE_DRIVER = 'Xylophone-throughput-driver'; // unique token not in any safe fixture
      const ANALYSIS_WITH_SCIENCE: AdviceGateAnalysis = {
        status: 'success',
        leading_option: null, // blank thin projection → relaxation path
        top_drivers: [{ factor_label: UNIQUE_DRIVER, sensitivity_value: 0.87 }],
        fragile_edges: [{ from_label: UNIQUE_DRIVER, to_label: 'Some outcome' }],
      };
      const out = tryPostAnalysisAdviceGate({
        message: 'How can we improve this?',
        analysis: ANALYSIS_WITH_SCIENCE,
        analysisReady: READY_OPEN,
        freshness: 'fresh',
        canonicalState: CANON_USABLE,
        recentChanges: [{ summary: 'Budget from 100k to 120k' }], // no held-science vocab
      });
      expect(out.matched).toBe(true);
      if (!out.matched) return;
      expect(out.copy_source).toBe('canonical_rich');
      const text = out.assistant_text;
      // The held-science driver label and any sensitivity/fragility/flip prose
      // must NOT have leaked into the safe-now answer.
      expect(text).not.toContain(UNIQUE_DRIVER);
      expect(text).not.toMatch(/\b(sensitiv\w*|fragile|fragility|flip|driver|drivers|robustness|elasticity|influence)\b/i);
      // It SHOULD carry safe-now content instead.
      expect(text).toMatch(/still open|threshold|connected|Budget/i);
    });
  });
});
