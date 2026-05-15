/**
 * Unit tests for the post-analysis advice gate / deterministic post-
 * analysis router. Pure-function tests, no I/O.
 *
 * Classification matrix coverage:
 *   - advice / next_step / update_advice / improvement / meaning
 *   - readiness / evidence_gap
 *   - explain_results_free_text / what_would_flip_free_text
 *
 * Plus:
 *   - mutation-signal precedence across the expanded class set
 *   - data-availability fall-through per class
 *   - pre-condition failures preserved from PR #173
 *   - composer copy contract (no `recommendation` / `the winner`,
 *     no raw IDs, no raw decimals, no readiness percentage)
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceClass,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  runner_up: { label: 'Hire one senior engineer overseas' },
  top_drivers: [
    { factor_label: 'Delivery risk' },
    { factor_label: 'Cost overrun risk' },
  ],
  fragile_edges: [
    { from_label: 'Delivery risk', to_label: 'Successful launch' },
  ],
};

const READY_PAYLOAD_READY: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'ready',
  goal_threshold: 0.7,
  options: [
    { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'ready', interventions: { 'fac_delivery_risk': 0.3 } },
    { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'ready', interventions: { 'fac_delivery_risk': 0.6 } },
  ],
};

const READY_PAYLOAD_OPEN: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_user_mapping',
  // goal_threshold deliberately absent → readiness summariser surfaces it
  options: [
    { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'needs_user_mapping', interventions: {} },
    { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'needs_encoding', interventions: {} },
  ],
};

// =========================================================================
// Classification matrix — at least 20 cases across the expanded class set.
// Each row asserts (a) gate matches, (b) advice_class is correct, (c)
// assistant_text contains no forbidden phrase.
// =========================================================================
describe('tryPostAnalysisAdviceGate — classification matrix', () => {
  const matrix: ReadonlyArray<{
    readonly message: string;
    readonly expectedClass: AdviceClass;
    readonly label: string;
  }> = [
    // ── advice (existing PR #173 surface) ────────────────────────────
    { message: 'What would you recommend?', expectedClass: 'advice', label: 'what would you recommend' },
    { message: 'What do you suggest based on this?', expectedClass: 'advice', label: 'what do you suggest' },
    { message: 'Where should we focus?', expectedClass: 'advice', label: 'where should we focus' },
    { message: 'Any suggestions on what to examine?', expectedClass: 'advice', label: 'any suggestions' },
    { message: 'Can you suggest something based on this?', expectedClass: 'advice', label: 'can you suggest' },
    { message: 'What should we do?', expectedClass: 'advice', label: 'what should we do' },

    // ── next_step ────────────────────────────────────────────────────
    { message: 'What is the next step?', expectedClass: 'next_step', label: 'next step (singular)' },
    { message: "What's next?", expectedClass: 'next_step', label: "what's next" },
    { message: 'Where do we go next?', expectedClass: 'next_step', label: 'where do we go next' },

    // ── update_advice ────────────────────────────────────────────────
    { message: 'How should we update this decision?', expectedClass: 'update_advice', label: 'how should we update this' },
    { message: 'How do we update this?', expectedClass: 'update_advice', label: 'how do we update this' },
    { message: 'What would you update?', expectedClass: 'update_advice', label: 'what would you update' },
    { message: 'How do you recommend we update the decision based on this?', expectedClass: 'update_advice', label: 'canonical c952 misroute case' },
    { message: 'Should we update anything?', expectedClass: 'update_advice', label: 'should we update anything' },

    // ── improvement ──────────────────────────────────────────────────
    { message: 'What should we improve?', expectedClass: 'improvement', label: 'what should we improve' },
    { message: 'How can we improve the outcome?', expectedClass: 'improvement', label: 'how can we improve' },
    { message: 'What could be improved?', expectedClass: 'improvement', label: 'what could be improved' },
    { message: 'How to improve confidence?', expectedClass: 'improvement', label: 'how to improve' },

    // ── meaning ──────────────────────────────────────────────────────
    { message: 'What does this mean?', expectedClass: 'meaning', label: 'what does this mean' },
    { message: 'How should I read this?', expectedClass: 'meaning', label: 'how should I read this' },
    { message: 'Help me interpret this.', expectedClass: 'meaning', label: 'help me interpret' },
    { message: 'Walk me through this.', expectedClass: 'meaning', label: 'walk me through' },
    { message: 'Explain the reasoning.', expectedClass: 'meaning', label: 'explain the reasoning' },

    // ── readiness ────────────────────────────────────────────────────
    { message: 'Why is this only 35% ready?', expectedClass: 'readiness', label: 'why is this only 35% ready' },
    { message: 'Why is the readiness so low?', expectedClass: 'readiness', label: 'why is the readiness so low' },
    { message: "Why isn't this ready?", expectedClass: 'readiness', label: "why isn't this ready" },
    { message: "What's blocking the analysis?", expectedClass: 'readiness', label: "what's blocking" },
    { message: "What's stopping us from running this?", expectedClass: 'readiness', label: "what's stopping" },
    { message: "What does the model need before it can run?", expectedClass: 'readiness', label: "what does the model need" },
    { message: "What's left to do?", expectedClass: 'readiness', label: "what's left to do" },

    // ── evidence_gap ─────────────────────────────────────────────────
    { message: "What's missing?", expectedClass: 'evidence_gap', label: "what's missing" },
    { message: 'What evidence is missing?', expectedClass: 'evidence_gap', label: 'what evidence is missing' },
    { message: "What's the gap?", expectedClass: 'evidence_gap', label: "what's the gap" },
    { message: "Anything I'm missing?", expectedClass: 'evidence_gap', label: "anything I'm missing" },
    { message: "What haven't we covered?", expectedClass: 'evidence_gap', label: "what haven't we covered" },

    // ── explain_results_free_text (latency Fix 2) ───────────────────
    { message: 'Explain the results.', expectedClass: 'explain_results_free_text', label: 'explain the results' },
    { message: 'Walk me through the analysis.', expectedClass: 'explain_results_free_text', label: 'walk me through the analysis' },
    { message: 'Tell me about these findings.', expectedClass: 'explain_results_free_text', label: 'tell me about these findings' },

    // ── what_would_flip_free_text (latency Fix 2) ───────────────────
    { message: 'What would flip this?', expectedClass: 'what_would_flip_free_text', label: 'what would flip this' },
    { message: 'What would change the outcome?', expectedClass: 'what_would_flip_free_text', label: 'what would change the outcome' },
    { message: 'What would tip the balance?', expectedClass: 'what_would_flip_free_text', label: 'what would tip' },
    { message: 'What would it take to flip the result?', expectedClass: 'what_would_flip_free_text', label: 'what would it take to flip' },
  ];

  for (const { message, expectedClass, label } of matrix) {
    it(`classifies as ${expectedClass}: ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe(expectedClass);
        expect(out.assistant_text.length).toBeGreaterThan(0);
        // Forbidden-phrase invariants
        expect(out.assistant_text.toLowerCase()).not.toContain('recommendation');
        expect(out.assistant_text.toLowerCase()).not.toContain('recommended');
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bthe\s+winners?\b/);
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bwinning\s+(option|probability|side|choice|outcome)\b/);
        // No raw decimals or raw IDs
        expect(out.assistant_text).not.toMatch(/\boption_\w+\b/);
        expect(out.assistant_text).not.toMatch(/\boutcome_\w+\b/);
        expect(out.assistant_text).not.toMatch(/\d+\.\d+/);
        // No numeric readiness echo (qualitative readiness only)
        expect(out.assistant_text).not.toMatch(/\b\d{1,3}\s*%\s*ready\b/i);
      }
    });
  }
});

// =========================================================================
// Mutation-signal precedence across the expanded class set: concrete edits
// must NOT be intercepted by any of the new advice / readiness / meaning
// paths.
// =========================================================================
describe('tryPostAnalysisAdviceGate — mutation-signal precedence', () => {
  const mutations: ReadonlyArray<readonly [string, string]> = [
    ['Set delivery risk to 0.7', 'set + to + numeric'],
    ['Set delivery risk to high', 'set + to + non-numeric'],
    ['Change delivery risk to 0.5', 'change + to + numeric'],
    ['Adjust the edge from A to B', 'adjust + from-to'],
    ['Remove the cost factor', 'remove the + entity'],
    ['Delete the delivery risk factor', 'delete the + entity'],
    ['Add a new option for staffing', 'add a new + entity'],
    ['Insert a new constraint on budget', 'insert a new + entity'],
    ['Change the edge from Cost to Risk', 'change + from-to'],
    ['Raise the budget to 100k', 'raise + to + numeric'],
    ['Lower delivery risk by 0.2', 'lower + numeric'],
    ['Set X to Y', 'set + to + token'],
    // Compound prompts — mutation + explanation in the same message. The
    // mutation MUST win across every advice class. Mutation-signal
    // precedence is the load-bearing invariant for the deterministic
    // router; concrete edits must never be intercepted, even when the
    // user piles a coaching question onto the end.
    ['Update delivery risk to 0.5 — why is that less ready?', 'mutation + readiness verbiage'],
    ['Set the edge from A to B — what does this mean?', 'mutation + meaning verbiage'],
    ['Set delivery risk to 0.7. What would you recommend after that?', 'mutation then advice'],
    ['Change the budget to £100k — explain the results.', 'mutation then explain_results_free_text'],
    ['Add a new option for staffing, and what is the next step?', 'mutation then next_step'],
    ['Remove the cost factor — what would flip the outcome?', 'mutation then what_would_flip_free_text'],
    ['What does this mean? Also set risk to 0.5.', 'meaning then mutation (mutation still wins)'],
    ['What is missing? Set the budget to £200k.', 'evidence_gap then mutation'],
  ];

  for (const [message, label] of mutations) {
    it(`falls through (mutation_signal): ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('mutation_signal');
    });
  }
});

// =========================================================================
// Per-class data-availability fallback — required correction:
// when a class matches but its required inputs are missing, the gate
// MUST return `data_unavailable_for_class` with `advice_class` and
// `missing_inputs`, so callers fall through to Sonnet.
// =========================================================================
describe('tryPostAnalysisAdviceGate — data-availability fallback', () => {
  it('readiness without analysisReady → data_unavailable_for_class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Why is this only 35% ready?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('readiness');
      expect(out.missing_inputs).toEqual(['analysis_ready']);
    }
  });

  it('improvement without top driver → data_unavailable_for_class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we improve?',
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [] },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('improvement');
      expect(out.missing_inputs).toContain('top_driver');
    }
  });

  it('explain_results_free_text without top driver → data_unavailable_for_class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [] },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('explain_results_free_text');
      expect(out.missing_inputs).toContain('top_driver');
    }
  });

  it('what_would_flip_free_text without top driver → data_unavailable_for_class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [] },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('what_would_flip_free_text');
      expect(out.missing_inputs).toContain('top_driver');
    }
  });

  it('evidence_gap with no readiness AND no drivers → data_unavailable_for_class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: "What's missing?",
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [] },
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

  it('evidence_gap with drivers OR readiness → still matches (either is sufficient)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: "What's missing?",
      analysis: FIXTURE_ANALYSIS,
      analysisReady: null, // drivers alone are enough
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) expect(out.advice_class).toBe('evidence_gap');
  });

  it('advice without leading option → data_unavailable_for_class (uniform contract)', () => {
    // Post-Codex review: the special-case `no_leading_option` reason was
    // retired in favour of the per-class data-availability fallback.
    // Missing leading_option now surfaces through the same path as every
    // other missing input, so dashboards see WHICH class fell through.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do?',
      analysis: { ...FIXTURE_ANALYSIS, leading_option: null },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('advice');
      expect(out.missing_inputs).toEqual(['leading_option']);
    }
  });

  it('explain_results_free_text without leading option → data_unavailable_for_class with both missing inputs surfaced', () => {
    // Codex follow-up test: when a class declares multiple required
    // inputs (`needs_leading_option` + `needs_top_driver`), an absent
    // leading_option must be reported alongside any other missing
    // input, rather than short-circuiting on the first miss. Stripping
    // both the leading_option AND the top_drivers exercises the
    // multi-miss path; a fixture with only one absent input would
    // hide a regression where the early-out is reintroduced.
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: { ...FIXTURE_ANALYSIS, leading_option: null, top_drivers: [] },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('explain_results_free_text');
      expect(out.missing_inputs).toContain('leading_option');
      expect(out.missing_inputs).toContain('top_driver');
    }
  });

  it('explain_results_free_text without leading option (top driver present) → leading_option in missing_inputs', () => {
    // Direct mirror of Codex's suggested assertion: fresh analysis,
    // no leading_option, otherwise sufficient fields.
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: { ...FIXTURE_ANALYSIS, leading_option: null },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('explain_results_free_text');
      expect(out.missing_inputs).toContain('leading_option');
    }
  });

  it('advice with whitespace-only leading_option label → data_unavailable_for_class (defence-in-depth)', () => {
    // The composer interpolates leading_option.label directly into
    // prose without a length guard. An empty / whitespace-only label
    // would yield "Based on the analysis,  is currently ahead." with
    // awkward double-spacing — fall through cleanly instead.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do?',
      analysis: { ...FIXTURE_ANALYSIS, leading_option: { label: '   ' } },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('advice');
      expect(out.missing_inputs).toContain('leading_option');
    }
  });

  it('improvement with whitespace-only top_driver factor_label → data_unavailable_for_class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we improve?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        top_drivers: [{ factor_label: '' }, { factor_label: 'Cost overrun risk' }],
      },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    // top_drivers[0] is empty; gate treats this as missing top_driver
    // even though the array length is > 0. The composer would otherwise
    // emit a fallback for empty topDriverLabel, but the contract is to
    // surface the missing-input rather than degrade prose silently.
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('improvement');
      expect(out.missing_inputs).toContain('top_driver');
    }
  });

  it('readiness without leading option STILL fires (readiness does not require it)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: "What's blocking the analysis?",
      analysis: { ...FIXTURE_ANALYSIS, leading_option: null },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) expect(out.advice_class).toBe('readiness');
  });
});

// =========================================================================
// Pre-condition failures preserved from PR #173.
// =========================================================================
describe('tryPostAnalysisAdviceGate — pre-condition failures', () => {
  it('falls through when analysis is null', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do next?',
      analysis: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('no_analysis');
  });

  it('falls through when message is empty', () => {
    const out = tryPostAnalysisAdviceGate({
      message: '   ',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('empty_message');
  });

  it('falls through when message is unrelated chit-chat', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Thanks, that helps.',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('no_advice_signal');
  });

  it.each([
    ['stale', 'graph mutated since last run'],
    ['unknown', 'freshness verdict missing'],
    ['none', 'no successful prior run'],
  ] as const)('falls through when freshness=%s (%s)', (freshness, label) => {
    void label;
    const out = tryPostAnalysisAdviceGate({
      message: 'How do you recommend we update the decision based on this?',
      analysis: FIXTURE_ANALYSIS,
      freshness,
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('not_fresh');
  });

  it('falls through when freshness is undefined', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do next?',
      analysis: FIXTURE_ANALYSIS,
      freshness: undefined,
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('not_fresh');
  });
});

// =========================================================================
// Composer copy contract — class-by-class verification of the prose.
// =========================================================================
describe('tryPostAnalysisAdviceGate — composer copy contract', () => {
  it('advice composer template (top driver present)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would you recommend?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toBe(
        'Based on the analysis, Hire two senior engineers locally is currently ahead. ' +
          'The biggest thing to examine next is Delivery risk, because it could change the result.',
      );
    }
  });

  it('improvement composer mentions the top driver as the leverage point', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we improve?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('To improve confidence');
      expect(out.assistant_text).toContain('Delivery risk');
    }
  });

  it('meaning composer frames the result as a reflection of the current model', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What does this mean?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toMatch(/reflects (?:your current setup|the model you've built so far)/);
      expect(out.assistant_text).toContain('Hire two senior engineers locally');
    }
  });

  it('readiness composer surfaces qualitative open items (no percentage)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Why is this only 35% ready?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Surfaces at least one open item
      expect(out.assistant_text).toMatch(/still open|isn't connected|no numeric values|measurable success threshold/i);
      // NEVER echoes the percentage
      expect(out.assistant_text).not.toMatch(/35\s*%/);
      expect(out.assistant_text).not.toMatch(/\d{1,3}\s*%/);
    }
  });

  it('readiness composer with everything ready surfaces a neutral non-prescriptive line', () => {
    const out = tryPostAnalysisAdviceGate({
      message: "What's blocking the analysis?",
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_READY,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Doesn't claim "all set"; invites the user to direct
      expect(out.assistant_text).toMatch(/let me know which factor/i);
    }
  });

  it('evidence_gap composer surfaces gaps from readiness AND fragile edges', () => {
    const out = tryPostAnalysisAdviceGate({
      message: "What's missing?",
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toMatch(/biggest open gap/i);
      // Either the fragile edge or a readiness gap appears
      expect(out.assistant_text.length).toBeGreaterThan(40);
    }
  });

  it('explain_results_free_text composer name the leading option AND top driver', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Hire two senior engineers locally');
      expect(out.assistant_text).toContain('Delivery risk');
    }
  });

  it('what_would_flip_free_text composer names the most-sensitive factor', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Hire two senior engineers locally');
      expect(out.assistant_text).toMatch(/most\s+(likely|sensitive)/i);
      expect(out.assistant_text).toContain('Delivery risk');
    }
  });

  it('never emits "recommendation" / "recommended" / "the winner" across any class', () => {
    const messages = [
      'How do you recommend we update the decision based on this?',
      'What does this mean?',
      'Why is this only 35% ready?',
      "What's missing?",
      'Explain the results.',
      'What would flip this?',
      'How can we improve?',
      'What is the next step?',
    ];
    for (const message of messages) {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      if (out.matched) {
        const lower = out.assistant_text.toLowerCase();
        expect(lower).not.toContain('recommendation');
        expect(lower).not.toContain('recommended');
        expect(lower).not.toMatch(/\bthe\s+winners?\b/);
        expect(lower).not.toMatch(/\bwinning\s+(option|probability|side|choice|outcome)\b/);
      }
    }
  });
});
