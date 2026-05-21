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
    // Enriched composers (this workstream) no longer match a single
    // hard-coded string — they include optional probability / margin /
    // robustness fragments that degrade gracefully when fields are
    // absent. The structural contract is: the opener uses the new
    // "currently favours" vocabulary, the leading option is named,
    // and the top driver is referenced as the next-examine point.
    const out = tryPostAnalysisAdviceGate({
      message: 'What would you recommend?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Based on this model, the analysis currently favours Hire two senior engineers locally');
      expect(out.assistant_text).toContain('The biggest thing to examine next is Delivery risk');
      expect(out.assistant_text).toContain('it could change the result');
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

// =========================================================================
// New patterns added by the grounded-fresh-analysis workstream — give the
// advice gate primary ownership of three phrases that the fresh-followup
// catch-net (PR #187) previously handled with a static recap + chip.
// =========================================================================
describe('tryPostAnalysisAdviceGate — new patterns (grounded fresh-analysis workstream)', () => {
  const newPatternRows: ReadonlyArray<{
    readonly message: string;
    readonly expectedClass: AdviceClass;
    readonly label: string;
  }> = [
    // explain_results_free_text (3 new + 2 regressions for context)
    { message: 'What drove this result?', expectedClass: 'explain_results_free_text', label: 'what drove this result' },
    { message: 'What drove the outcome?', expectedClass: 'explain_results_free_text', label: 'what drove the outcome' },
    { message: 'What drove the analysis?', expectedClass: 'explain_results_free_text', label: 'what drove the analysis' },
    { message: 'Why is this option ahead?', expectedClass: 'explain_results_free_text', label: 'why is this option ahead' },
    { message: 'Why is Option A in front?', expectedClass: 'explain_results_free_text', label: 'why is Option A in front' },
    { message: 'Why is the result on top?', expectedClass: 'explain_results_free_text', label: 'why is the result on top' },
    { message: 'Why is this the favourite?', expectedClass: 'explain_results_free_text', label: 'why is this the favourite (en-GB)' },
    { message: 'Why is this the favorite?', expectedClass: 'explain_results_free_text', label: 'why is this the favorite (en-US)' },

    // what_would_flip_free_text (4 new variants of "need to change")
    { message: 'What would need to change for another option to look better?', expectedClass: 'what_would_flip_free_text', label: 'what would need to change for another option' },
    { message: 'What does need to change here?', expectedClass: 'what_would_flip_free_text', label: 'what does need to change' },
    { message: 'What might need to happen to flip things?', expectedClass: 'what_would_flip_free_text', label: 'what might need to happen' },
    { message: 'What would need to shift in this?', expectedClass: 'what_would_flip_free_text', label: 'what would need to shift' },

    // Existing advice-class regression — "what should I pay attention to"
    // continues to route to `advice` per the brief's preserve-precedence
    // instruction. Pinning this case proves the precedence is not
    // accidentally pre-empted by a more specific pattern this workstream
    // added.
    { message: 'What should I pay attention to?', expectedClass: 'advice', label: 'what should I pay attention to (regression)' },
  ];

  for (const { message, expectedClass, label } of newPatternRows) {
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
      }
    });
  }

  // "Why is X leading?" intentionally stays OUTSIDE the new pattern
  // (the predicate mirrors PR #187's classifier exactly: ahead / in front
  // / on top / the leader / the favourite — no "leading" / "winning").
  // This pattern still falls through to the fresh-followup catch-net via
  // `no_advice_signal`.
  it('"Why is Option A leading?" falls through (advice gate does NOT capture "leading")', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Why is Option A leading?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('no_advice_signal');
    }
  });

  // Mutation precedence regression — concrete edits combined with any of
  // the new analytical patterns must still fall through with
  // `mutation_signal`. Reuses the existing MUTATION_SIGNAL_PATTERNS path;
  // adding patterns does not weaken the precedence rule.
  const mutationPairs: ReadonlyArray<readonly [string, string]> = [
    ['What drove this result, change the cost factor to 0.7?', 'what drove + set-to-numeric'],
    ['Why is this option ahead — set risk to 0.5?', 'why is X ahead + set-to-numeric'],
    ['What would need to change? Set Pricing to 0.7.', 'what would need to change + numeric edit'],
    ['What drove the result then add a new option for staffing?', 'what drove + add-new'],
  ];
  for (const [message, label] of mutationPairs) {
    it(`falls through (mutation_signal): ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(false);
      if (!out.matched) {
        expect(out.reason).toBe('mutation_signal');
      }
    });
  }

  // Freshness gate regression — each new pattern must still fall through
  // `not_fresh` so the stale-rerun guard upstream owns those turns.
  const newPatternMessages = [
    'What drove this result?',
    'Why is this option ahead?',
    'What would need to change for another option to look better?',
  ];
  for (const message of newPatternMessages) {
    it.each([['stale'], ['unknown'], ['none']] as const)(
      `falls through (not_fresh, freshness=%s): "${message}"`,
      (freshness) => {
        const out = tryPostAnalysisAdviceGate({
          message,
          analysis: FIXTURE_ANALYSIS,
          analysisReady: READY_PAYLOAD_OPEN,
          freshness,
        });
        expect(out.matched).toBe(false);
        if (!out.matched) {
          expect(out.reason).toBe('not_fresh');
        }
      },
    );
  }
});

// =========================================================================
// Enriched composer fingerprints — the grounded-fresh-analysis workstream
// extends composeExplainResults / composeWhatWouldFlip / composeMeaning /
// composeAdvice / composeImprovement to use the optional probability /
// margin / robustness / sensitivity fields already on ContextPackAnalysis
// when present. Each test pins both the "full data" path AND the
// degrade-gracefully behaviour when individual fields are missing.
// =========================================================================
describe('tryPostAnalysisAdviceGate — enriched composer output (full data)', () => {
  const ENRICHED_ANALYSIS: AdviceGateAnalysis = {
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

  it('composeExplainResults: includes probability, margin, two drivers with direction, and robustness', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Based on this model, the analysis currently favours Hire two senior engineers locally');
      expect(out.assistant_text).toContain('with a probability of 62%');
      expect(out.assistant_text).toContain('That sits ahead of Hire one senior engineer overseas by 24 percentage points');
      expect(out.assistant_text).toContain('Delivery risk');
      expect(out.assistant_text).toContain('Cost overrun risk');
      // sensitivity-direction phrases from formatSensitivityDirection
      expect(out.assistant_text).toMatch(/moderately strengthens the lead/);
      expect(out.assistant_text).toMatch(/moderately weakens the lead/);
      expect(out.assistant_text).toContain('The robustness band is moderate');
    }
  });

  it('composeWhatWouldFlip: includes probability, margin, drivers with direction, and robustness', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Based on this model, Hire two senior engineers locally currently appears to be the favoured option');
      expect(out.assistant_text).toContain('with a probability of 62%');
      expect(out.assistant_text).toContain('For Hire one senior engineer overseas to overtake it, the lead of 24 percentage points would need to close');
      expect(out.assistant_text).toContain('Movement on Delivery risk or Cost overrun risk would shift this result the most');
      expect(out.assistant_text).toMatch(/moderately strengthens the lead/);
      expect(out.assistant_text).toMatch(/moderately weakens the lead/);
      expect(out.assistant_text).toContain('The robustness band is currently moderate');
    }
  });

  it('composeMeaning: includes probability and margin sentence when both present', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What does this mean?',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Hire two senior engineers locally');
      expect(out.assistant_text).toContain('with a probability of 62%');
      expect(out.assistant_text).toContain('It sits ahead of Hire one senior engineer overseas by 24 percentage points');
      expect(out.assistant_text).toMatch(/reflects (?:your current setup|the model you've built so far)/);
    }
  });

  it('composeAdvice: includes margin sentence when runner_up + margin present', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do?',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Based on this model, the analysis currently favours Hire two senior engineers locally');
      expect(out.assistant_text).toContain('with a probability of 62%');
      expect(out.assistant_text).toContain('It sits ahead of Hire one senior engineer overseas by 24 percentage points');
      expect(out.assistant_text).toContain('The biggest thing to examine next is Delivery risk');
    }
  });

  it('composeImprovement: includes robustness band sentence when present', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we improve?',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('To improve confidence');
      expect(out.assistant_text).toContain('Delivery risk');
      expect(out.assistant_text).toContain('The robustness band is moderate');
    }
  });

  it('vocabulary guard: enriched copy never contains "winner" / "winning option" / "recommended"', () => {
    const messages = [
      'Explain the results.',
      'What would flip this?',
      'What does this mean?',
      'What should we do?',
      'What should we improve?',
      'What drove this result?',
      'Why is this option ahead?',
      'What would need to change for another option to look better?',
    ];
    for (const message of messages) {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: ENRICHED_ANALYSIS,
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

// =========================================================================
// Degrade-gracefully behaviour — when probability / margin / robustness /
// sensitivity are absent, the enriched composers must omit the
// surrounding clause silently rather than rendering "Not available" or
// raw decimals. F.6 invariant: format only; never invent missing values.
// =========================================================================
describe('tryPostAnalysisAdviceGate — degrade-gracefully (partial data)', () => {
  it('explain_results: missing probability → no probability fragment, still names leading option', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        ...FIXTURE_ANALYSIS, // leading_option has no probability field
        top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Hire two senior engineers locally');
      // Probability fragment is omitted entirely
      expect(out.assistant_text).not.toContain('probability of');
      expect(out.assistant_text).not.toContain('Not available');
    }
  });

  it('explain_results: missing margin → no margin fragment, runner-up still mentioned without pp', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        ...FIXTURE_ANALYSIS,
        leading_option: { label: 'Hire two senior engineers locally', probability: 0.62 },
        runner_up: { label: 'Hire one senior engineer overseas', probability: 0.38 },
        // margin_pp omitted
        top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Hire one senior engineer overseas sits in second place');
      // Don't claim a margin we don't have
      expect(out.assistant_text).not.toContain('percentage points');
    }
  });

  it('explain_results: missing robustness band → no robustness sentence', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        ...FIXTURE_ANALYSIS,
        leading_option: { label: 'Hire two senior engineers locally', probability: 0.62 },
        top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
        // robustness_band omitted
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).not.toContain('robustness band');
    }
  });

  it('explain_results: single driver with no sensitivity → no direction clause', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        ...FIXTURE_ANALYSIS,
        leading_option: { label: 'Hire two senior engineers locally' },
        top_drivers: [{ factor_label: 'Delivery risk' }], // no sensitivity_value
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Delivery risk');
      // Sensitivity-direction clause omitted entirely
      expect(out.assistant_text).not.toContain('strengthens the lead');
      expect(out.assistant_text).not.toContain('weakens the lead');
    }
  });

  it('what_would_flip: missing margin + missing sensitivity → still names drivers without invented direction', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        // Both drivers lack sensitivity_value
        top_drivers: [
          { factor_label: 'Delivery risk' },
          { factor_label: 'Cost overrun risk' },
        ],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Movement on Delivery risk or Cost overrun risk');
      // No fabricated "Today X has little effect on the lead" when sensitivity is absent
      expect(out.assistant_text).not.toContain('has little effect on the lead');
    }
  });

  it('no raw decimals anywhere in enriched composer output (no Not available leakage)', () => {
    // Sweep every advice class against a fixture with `leading_option` but
    // no probability/margin/robustness — guarantees the format helpers
    // never render "Not available" into prose and never leak raw decimals.
    const partialAnalysis: AdviceGateAnalysis = {
      ...FIXTURE_ANALYSIS,
      leading_option: { label: 'Hire two senior engineers locally' },
    };
    const messages = [
      'Explain the results.',
      'What would flip this?',
      'What does this mean?',
      'What should we do?',
      'What should we improve?',
      'What drove this result?',
      'Why is this option ahead?',
      'What would need to change for another option to look better?',
    ];
    for (const message of messages) {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: partialAnalysis,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      if (out.matched) {
        expect(out.assistant_text).not.toContain('Not available');
        expect(out.assistant_text).not.toMatch(/\d+\.\d+/);
      }
    }
  });
});

// =========================================================================
// Per-class suggested-action chips. The grounded-fresh-analysis workstream
// threads one `what_would_flip` chip onto matched explain/meaning/advice/
// next_step/update_advice/improvement turns, leaves `what_would_flip_free_text`
// chipless (its prose already nudges toward the change action), and
// preserves the existing chipless behaviour for readiness / evidence_gap.
// =========================================================================
describe('tryPostAnalysisAdviceGate — suggested_actions per class', () => {
  const oneChipClasses: ReadonlyArray<readonly [string, AdviceClass]> = [
    ['Explain the results.', 'explain_results_free_text'],
    ['What drove this result?', 'explain_results_free_text'],
    ['Why is this option ahead?', 'explain_results_free_text'],
    ['What does this mean?', 'meaning'],
    ['What should we do?', 'advice'],
    ['What should I pay attention to?', 'advice'],
    ['What is the next step?', 'next_step'],
    ['How should we update this decision?', 'update_advice'],
    ['What should we improve?', 'improvement'],
  ];
  for (const [message, expectedClass] of oneChipClasses) {
    it(`${expectedClass} ("${message}") emits exactly one what_would_flip chip`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe(expectedClass);
        expect(out.suggested_actions).toHaveLength(1);
        const chip = out.suggested_actions[0]!;
        expect(chip.action_type).toBe('what_would_flip');
        expect(chip.id).toBe('chip_action_what_would_flip');
        expect(chip.label).toBe('What could change the outcome?');
        expect(chip.message).toBe('What could change the outcome of this analysis?');
      }
    });
  }

  const chiplessClasses: ReadonlyArray<readonly [string, AdviceClass]> = [
    ['What would flip this?', 'what_would_flip_free_text'],
    ['What would need to change for another option to look better?', 'what_would_flip_free_text'],
    ["What's blocking the analysis?", 'readiness'],
    ["What's missing?", 'evidence_gap'],
  ];
  for (const [message, expectedClass] of chiplessClasses) {
    it(`${expectedClass} ("${message}") emits no chip`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe(expectedClass);
        expect(out.suggested_actions).toHaveLength(0);
      }
    });
  }
});
