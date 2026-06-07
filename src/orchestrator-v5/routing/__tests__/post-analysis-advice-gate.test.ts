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
  hasRenderableTopDriverLabel,
  type AdviceClass,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
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

    // ── evidence_gap (V5 coaching — validation / research / confidence) ─
    { message: 'What should we validate?', expectedClass: 'evidence_gap', label: 'what should we validate' },
    { message: 'What can we verify here?', expectedClass: 'evidence_gap', label: 'what can we verify' },
    { message: 'Anything we should confirm?', expectedClass: 'evidence_gap', label: 'anything we should confirm' },
    { message: 'What should we research?', expectedClass: 'evidence_gap', label: 'what should we research' },
    { message: 'How should we investigate this further?', expectedClass: 'evidence_gap', label: 'how should we investigate' },
    { message: 'How do we build confidence in this?', expectedClass: 'evidence_gap', label: 'how do we build confidence' },
    { message: 'How can we increase our confidence?', expectedClass: 'evidence_gap', label: 'how can we increase confidence' },
    { message: 'What evidence should we gather?', expectedClass: 'evidence_gap', label: 'what evidence should we gather' },
    { message: 'What data could we collect to confirm this?', expectedClass: 'evidence_gap', label: 'what data could we collect' },
    { message: 'What assumptions should we test?', expectedClass: 'evidence_gap', label: 'what assumptions should we test' },
    { message: 'What assumptions do we need to verify?', expectedClass: 'evidence_gap', label: 'what assumptions to verify' },
    { message: 'Do you have any recommendations on what we should validate or research further to build confidence in our decision?', expectedClass: 'evidence_gap', label: 'exact long workstream-brief prompt' },

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
    // V5 coaching — validation phrasing paired with a concrete bare-verb
    // edit. The bare-verb mutation pattern (`\bset\b ... \bto\s+\S+`) fires
    // and the gate returns mutation_signal even though the message also
    // looks like a validation/assumption question. Gerund mutations like
    // "by setting X to Y" don't trigger this pattern and are exercised
    // separately in the V5 coaching describe block below — there the
    // requirement is only "not classified as evidence_gap".
    ['Test this assumption — set the cost factor to high', 'assumption-test then mutation (V5 coaching)'],
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

  it('what_would_flip_free_text composer names the specific fragile assumption', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain("'Hire two senior engineers locally'");
      // Names the fragile edge (fragile_edges[0]) in user-friendly language, no sign claim.
      expect(out.assistant_text).toContain("the link from 'Delivery risk' to 'Successful launch'");
      expect(out.assistant_text).toMatch(/whether it holds as strongly as the model currently assumes/);
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
// advice gate primary ownership of four target phrase families ("what
// drove", "why is X ahead", "why is X leading", "what would need to
// change for another option to look better") that the fresh-followup
// catch-net (PR #187) previously handled with a static recap + chip.
// =========================================================================
describe('tryPostAnalysisAdviceGate — new patterns (grounded fresh-analysis workstream)', () => {
  const newPatternRows: ReadonlyArray<{
    readonly message: string;
    readonly expectedClass: AdviceClass;
    readonly label: string;
  }> = [
    // explain_results_free_text (4 newly-owned phrase families: what-drove,
    // why-X-ahead, why-X-leading, why-X-on-top/in-front/the-leader/the-favourite,
    // plus en-GB / en-US favourite variants)
    { message: 'What drove this result?', expectedClass: 'explain_results_free_text', label: 'what drove this result' },
    { message: 'What drove the outcome?', expectedClass: 'explain_results_free_text', label: 'what drove the outcome' },
    { message: 'What drove the analysis?', expectedClass: 'explain_results_free_text', label: 'what drove the analysis' },
    { message: 'Why is this option ahead?', expectedClass: 'explain_results_free_text', label: 'why is this option ahead' },
    { message: 'Why is Option A leading?', expectedClass: 'explain_results_free_text', label: 'why is Option A leading' },
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

  // Mutation precedence regression — concrete edits combined with any of
  // the new analytical patterns must still fall through with
  // `mutation_signal`. Reuses the existing MUTATION_SIGNAL_PATTERNS path;
  // adding patterns does not weaken the precedence rule.
  const mutationPairs: ReadonlyArray<readonly [string, string]> = [
    ['What drove this result, change the cost factor to 0.7?', 'what drove + set-to-numeric'],
    ['Why is this option ahead — set risk to 0.5?', 'why is X ahead + set-to-numeric'],
    ['Why is Option A leading? Set risk to 0.5.', 'why is X leading + set-to-numeric'],
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

  // Freshness gate regression — each newly-owned pattern must still fall
  // through `not_fresh` so the stale-rerun guard upstream owns those turns.
  // "Why is Option A leading?" is included because the analytical-intent
  // classifier broadening (this workstream) makes the stale-rerun guard
  // and no-analysis guard responsible for that phrasing when the advice
  // gate falls through.
  const newPatternMessages = [
    'What drove this result?',
    'Why is this option ahead?',
    'Why is Option A leading?',
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
      expect(out.assistant_text).toContain("Based on this model, the analysis currently favours 'Hire two senior engineers locally'");
      expect(out.assistant_text).toContain('with a probability of 62%');
      expect(out.assistant_text).toContain("That sits ahead of 'Hire one senior engineer overseas' by 24 percentage points");
      expect(out.assistant_text).toContain('Delivery risk');
      expect(out.assistant_text).toContain('Cost overrun risk');
      // sensitivity-direction phrases from formatSensitivityDirection
      expect(out.assistant_text).toMatch(/moderately strengthens the lead/);
      expect(out.assistant_text).toMatch(/moderately weakens the lead/);
      // Names the specific fragile assumption from fragile_edges[0] (parity
      // with what_would_flip) — no sign/causal claim.
      expect(out.assistant_text).toContain("The most useful thing to check is the link from 'Delivery risk' to 'Successful launch': whether it holds as strongly as the model currently assumes");
      // Humanised moderate-band copy — plain language, no "robustness band" jargon.
      expect(out.assistant_text).toContain('This result looks fairly stable, but it is worth checking the main assumptions before deciding');
      expect(out.assistant_text).not.toMatch(/robustness band/i);
      // Concrete, grounded next action (replaces the old generic "Small changes
      // to the strongest factor…"): names the most influential factor to revisit.
      expect(out.assistant_text).toContain('What to check next');
      expect(out.assistant_text).toMatch(/^• Re-run after revisiting 'Delivery risk', the factor with the most influence here, to see whether the lead holds\.$/m);
      expect(out.assistant_text).not.toMatch(/Small changes to the strongest factor can shift the picture/);
    }
  });

  it('composeWhatWouldFlip: clear lead → quoted labels, real margin, names the fragile link, no implied flip', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      // Clear-lead opener — quoted label, no "favoured option"/"best".
      expect(text).toContain("Based on this model, 'Hire two senior engineers locally' currently leads");
      expect(text).toContain('with a probability of 62%');
      expect(text).toContain("For 'Hire one senior engineer overseas' to overtake it, the lead of 24 percentage points would need to close");
      // Names the specific fragile assumption from fragile_edges[0] — no sign/causal claim.
      expect(text).toContain("The most useful thing to check is the link from 'Delivery risk' to 'Successful launch': whether it holds as strongly as the model currently assumes");
      // No decision_review.flip_thresholds present → no flip claim, no "favoured option"/"best".
      expect(text).not.toMatch(/\bmost likely to flip\b/i);
      expect(text).not.toMatch(/favoured option|\bbest\b/i);
      expect(text).not.toMatch(/robustness band/i);
      // Reframed next step never implies a single change flips the result.
      expect(text).toContain('What to check next');
      expect(text).toMatch(/^• Re-run after adjusting the most influential factor to see whether the lead holds\.$/m);
      expect(text).not.toMatch(/to see where the leading option moves/i);
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
      expect(out.assistant_text).toContain("It sits ahead of 'Hire one senior engineer overseas' by 24 percentage points");
      // Names the specific fragile assumption (parity with explain_results /
      // what_would_flip) — the sentence is itself the "what to check".
      expect(out.assistant_text).toContain("The most useful thing to check is the link from 'Delivery risk' to 'Successful launch'");
      expect(out.assistant_text).toMatch(/reflects (?:your current setup|the model you've built so far)/);
      // Meaning stays interpretive — no `What to check next` action block.
      expect(out.assistant_text).not.toContain('What to check next');
      expect(out.assistant_text).toMatch(/\n\nThe result reflects/);
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
      // Readability sectioning: the next-step sentence is a bullet
      // under its own labelled block.
      expect(out.assistant_text).toContain('What to check next');
      expect(out.assistant_text).toMatch(/^• The biggest thing to examine next is Delivery risk/m);
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
      expect(out.assistant_text).toContain('This result looks fairly stable, so smaller adjustments may not move the picture much');
      expect(out.assistant_text).not.toMatch(/robustness band/i);
      // Readability sectioning: "To improve confidence here, the most
      // useful thing to examine is X" is now a bullet under its own
      // labelled block. The robustness sentence stays in the lead.
      expect(out.assistant_text).toContain('What to check next');
      expect(out.assistant_text).toMatch(/^• To improve confidence here/m);
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
      expect(out.assistant_text).toContain("'Hire one senior engineer overseas' sits in second place");
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

  it('what_would_flip: missing margin + missing sensitivity → names fragile link, no invented direction', () => {
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
      // fragile_edges[0] is named; we never invent a sensitivity-direction clause.
      expect(out.assistant_text).toContain("the link from 'Delivery risk' to 'Successful launch'");
      expect(out.assistant_text).not.toContain('has little effect on the lead');
      expect(out.assistant_text).not.toContain('strengthens the lead');
      expect(out.assistant_text).not.toContain('weakens the lead');
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

// =========================================================================
// V5 coaching workstream — validation/research advice grounded in
// decision_review enrichment. The new evidence_gap patterns route the
// brief's canonical phrasings ("What should we validate?", "How do we
// build confidence?", "What assumptions should we test?", and the exact
// long workstream prompt) deterministically. composeEvidenceGap prefers
// `evidence_enhancements[].specific_action` + `key_assumptions[0]` when a
// decision_review record is threaded through; otherwise falls back to the
// projection-only behaviour preserved from PR #178.
// =========================================================================
describe('tryPostAnalysisAdviceGate — V5 coaching (validation/research advice)', () => {
  const SAMPLE_DECISION_REVIEW: Record<string, unknown> = Object.freeze({
    produced_at: '2026-05-21T10:00:00.000Z',
    evidence_enhancements: Object.freeze({
      fac_delivery_risk: Object.freeze({
        specific_action: 'Pull on-time delivery rates from the last two releases and check the variance.',
        rationale: 'Delivery risk is the highest-sensitivity factor.',
        evidence_type: 'historical_data',
      }),
      fac_cost_overrun_risk: Object.freeze({
        specific_action: 'Talk to the finance team about historical overruns on similar engagements.',
        rationale: 'Cost overrun is the second-highest driver.',
        evidence_type: 'expert_judgement',
      }),
    }),
    key_assumptions: Object.freeze([
      'The local senior hiring market will remain as competitive as it is today.',
      'Salary bands stay flat for the next two quarters.',
    ]),
  });

  it('"Validate this by setting budget to £30k" is NOT classified as evidence_gap', () => {
    // Workstream-brief requirement: validation phrasing wrapped around a
    // concrete edit must NOT be swallowed by the new evidence_gap
    // patterns. The new patterns require a `(?:what|anything)` lead plus
    // a pronoun, so the imperative "Validate this by ..." doesn't match
    // them. The bare-verb mutation pattern doesn't fire on the gerund
    // "setting", so the gate falls through with `no_advice_signal` and
    // the LLM router decides (likely → edit_graph for this phrasing).
    // The contract this test enforces is the narrow one: NOT evidence_gap.
    const out = tryPostAnalysisAdviceGate({
      message: 'Validate this by setting budget to £30k',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    if (out.matched) {
      expect(out.advice_class).not.toBe('evidence_gap');
    } else {
      // Fall-through is also acceptable — the requirement is only that
      // this phrasing not be intercepted as a coaching answer.
      expect(['mutation_signal', 'no_advice_signal']).toContain(out.reason);
    }
  });

  it('"Verify the model by changing delivery risk to 0.4" is NOT classified as evidence_gap', () => {
    // Companion case: gerund verbs ("changing") in the same mould.
    const out = tryPostAnalysisAdviceGate({
      message: 'Verify the model by changing delivery risk to 0.4',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    if (out.matched) {
      expect(out.advice_class).not.toBe('evidence_gap');
    } else {
      expect(['mutation_signal', 'no_advice_signal']).toContain(out.reason);
    }
  });

  it('misclassification guard — "What should I change?" routes to advice, NOT evidence_gap', () => {
    // The new evidence_gap patterns require a specific verb after the
    // pronoun (validate|verify|confirm|de-risk, research|investigate, etc.).
    // Generic "what should I/we/you change?" must continue to land on the
    // broader `advice` class so it answers in advice prose (leverage
    // point + next examine target), not in evidence-gap prose.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should I change?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('advice');
      expect(out.advice_class).not.toBe('evidence_gap');
    }
  });

  it('exact long workstream prompt routes to evidence_gap', () => {
    const out = tryPostAnalysisAdviceGate({
      message:
        'Do you have any recommendations on what we should validate or research further to build confidence in our decision?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) expect(out.advice_class).toBe('evidence_gap');
  });

  it('composeEvidenceGap uses decision_review.evidence_enhancements when present', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: SAMPLE_DECISION_REVIEW,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      // Opener
      expect(out.assistant_text).toContain('To build confidence in this analysis');
      // Pulls the first two specific_action strings verbatim
      expect(out.assistant_text).toContain(
        'Pull on-time delivery rates from the last two releases and check the variance.',
      );
      expect(out.assistant_text).toContain(
        'Talk to the finance team about historical overruns on similar engagements.',
      );
      // First key_assumption surfaces as a follow-up line
      expect(out.assistant_text).toContain('One assumption worth testing alongside this');
      expect(out.assistant_text).toContain(
        'The local senior hiring market will remain as competitive as it is today.',
      );
      // Does NOT fall through to the projection-only "biggest open gap"
      // sentence when enrichment is the source of truth
      expect(out.assistant_text).not.toMatch(/^The biggest open gap/);
    }
  });

  it('composeEvidenceGap falls back to projection when decision_review is absent', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      // decisionReview deliberately omitted
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      // Projection-only fallback: surfaces either an open-readiness item
      // or the fragile-edge / top-driver narrative
      expect(out.assistant_text).toMatch(/biggest open gap/i);
      // Should NOT contain enrichment-only opener
      expect(out.assistant_text).not.toContain('To build confidence in this analysis');
    }
  });

  it('composeEvidenceGap falls back when decision_review is empty (no usable enhancements)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: {
        produced_at: '2026-05-21T10:00:00.000Z',
        evidence_enhancements: {},
        key_assumptions: [],
      },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // No enhancements + no assumptions → enrichment helper returns null,
      // composer falls back to projection-only behaviour.
      expect(out.assistant_text).toMatch(/biggest open gap/i);
      expect(out.assistant_text).not.toContain('To build confidence in this analysis');
    }
  });

  it('composeEvidenceGap tolerates malformed enrichment (defensive parsing)', () => {
    // Enrichment is a passthrough `Record<string, unknown>`; the helper
    // must reject array shapes / non-string actions / nullish entries
    // without throwing and fall back cleanly.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: {
        produced_at: '2026-05-21T10:00:00.000Z',
        evidence_enhancements: {
          fac_a: null,
          fac_b: ['not an object'],
          fac_c: { specific_action: '   ' },
          fac_d: { specific_action: 42 },
        },
        key_assumptions: [null, 42, ''],
      },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toMatch(/biggest open gap/i);
      expect(out.assistant_text).not.toContain('To build confidence in this analysis');
    }
  });

  it('composeEvidenceGap copy is safe (no recommendation/winner vocabulary, no false-success leads)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: SAMPLE_DECISION_REVIEW,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const lower = out.assistant_text.toLowerCase();
      // Forbidden vocabulary
      expect(lower).not.toContain('recommendation');
      expect(lower).not.toContain('recommended');
      expect(lower).not.toMatch(/\bthe\s+winners?\b/);
      expect(lower).not.toMatch(/\bwinning\s+(option|probability|side|choice|outcome)\b/);
      // No raw IDs / decimals
      expect(out.assistant_text).not.toMatch(/\boption_\w+\b/);
      expect(out.assistant_text).not.toMatch(/\bfac_\w+\b/);
      // False-success guard: sentence-leading instructional verbs that
      // could trip downstream "Set/Updated/Added at line start" detection
      // (feedback_success_claim_regex_instructional_set). The deterministic
      // wrapper avoids these openers.
      expect(out.assistant_text.split('\n')[0]).not.toMatch(/^(?:Set|Updated|Added|Changed|Removed|Adjusted)\b/);
    }
  });

  it('evidence_gap class still emits NO chip even with decision_review enrichment present', () => {
    // The chip set is class-driven, not content-driven: evidence_gap
    // continues to emit zero chips so the response stays focused on the
    // grounded answer. The post-run_analysis prompt chip lives in the
    // chip-generator, not on the gate's own suggested_actions output.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: SAMPLE_DECISION_REVIEW,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      expect(out.suggested_actions).toHaveLength(0);
    }
  });

  // -----------------------------------------------------------------
  // Renderability hardening (ported from PR #189). The composer's
  // projection-only fall-through interpolates labels directly into
  // prose; malformed labels (empty / whitespace-only / blank
  // endpoint) would otherwise emit "sensitivity is on   " or
  // `link from "" to "B"`. These tests pin the renderability filter.
  // -----------------------------------------------------------------

  it('renderability — whitespace-only top_driver factor_label + no other signal → data_unavailable_for_class (no malformed prose)', () => {
    // The gate's evidence_gap predicate now uses `hasRenderableTopDriver`
    // (non-empty trimmed label) instead of bare `top_drivers.length > 0`,
    // so a whitespace-only label can't satisfy the gate and then make
    // the gap-list fall-through emit "sensitivity is on   ".
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
      expect(out.missing_inputs).toContain('analysis_ready_or_top_drivers');
    }
  });

  it('renderability — gap-list skips blank-endpoint fragile edges when readiness is present', () => {
    // With valid readiness data AND a degraded `fragile_edges[0]`
    // (blank endpoint), the gap-list previously emitted
    // `the link from "" to "..." is fragile, ...`. The composer now
    // filters fragile edges through `renderableFragileEdges` so the
    // blank entry is dropped; readiness gaps remain.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        fragile_edges: [{ from_label: '   ', to_label: 'Successful launch' }],
      },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).not.toMatch(/link from\s*""\s*to/);
      expect(out.assistant_text).not.toContain('"   " to');
      expect(out.assistant_text).not.toMatch(/link from "\s*" to /);
    }
  });

  it('renderability — gap-list iterates only renderable fragile edges (blank [0], valid [1])', () => {
    // Gate matches via top_drivers (FIXTURE has them); the gap-list
    // adds the renderable fragile-edge bullet. Blank-endpoint [0]
    // must be filtered out by `renderableFragileEdges`, with the
    // valid [1] surfacing instead.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        fragile_edges: [
          { from_label: '', to_label: 'Successful launch' },
          { from_label: 'Cost overrun risk', to_label: 'Successful launch' },
        ],
      },
      analysisReady: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('"Cost overrun risk" to "Successful launch"');
      expect(out.assistant_text).not.toMatch(/link from\s*""\s*to/);
    }
  });

  it('renderability — top-driver fallback is gated on renderable label (whitespace label suppresses the bullet)', () => {
    // top_drivers[0] is whitespace, readiness is present (so the gate
    // matches via readiness). The gap-list's top-driver fallback used
    // to use `analysis.top_drivers.length > 0` blindly and would emit
    // "sensitivity is on   ". Now gated on `hasRenderableTopDriver`.
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...FIXTURE_ANALYSIS,
        top_drivers: [{ factor_label: '   ', sensitivity_value: 0.45 }],
        fragile_edges: [],
      },
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Whitespace label MUST NOT appear in prose.
      expect(out.assistant_text).not.toMatch(/sensitivity is on\s*[.,\n]/);
      expect(out.assistant_text).not.toMatch(/sensitivity is on\s+\s/);
    }
  });

  // -----------------------------------------------------------------
  // Chip-click routing (ported from PR #189). The prompt chip emitted
  // by chip-generator.ts after a successful run_analysis has no
  // `action_type`; on click, DGAI submits the chip's `message` as the
  // next turn's user text. That message MUST route to `evidence_gap`
  // through the deterministic, synchronous, no-LLM path.
  // -----------------------------------------------------------------

  it('chip-click routing — exact PR #190 chip message routes to evidence_gap (deterministic, no LLM)', () => {
    // Hard-coded mirror of the message string in
    // src/orchestrator-v5/compose/chip-generator.ts post-run_analysis
    // branch. A regression that changes the chip copy surfaces here
    // as a clean assertion miss rather than passing silently.
    const CHIP_MESSAGE =
      'What should we validate or research to build confidence in this decision?';
    const out = tryPostAnalysisAdviceGate({
      message: CHIP_MESSAGE,
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: SAMPLE_DECISION_REVIEW,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      // With enrichment, the validation-aware lead is the
      // decision_review-grounded opener.
      expect(out.assistant_text).toContain('To build confidence in this analysis');
    }
  });

  it('chip-click routing — gate is structurally synchronous (no Promise)', () => {
    // Defence-in-depth for the deterministic chip-click path. A Promise
    // here would indicate the gate became async and would break the
    // 0-LLM-call guarantee for chip clicks.
    const CHIP_MESSAGE =
      'What should we validate or research to build confidence in this decision?';
    const result = tryPostAnalysisAdviceGate({
      message: CHIP_MESSAGE,
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: SAMPLE_DECISION_REVIEW,
    });
    expect(result).not.toHaveProperty('then');
  });

  it('chip-click routing — stale freshness suppresses the gate (chip should not have been emitted)', () => {
    // The chip itself is gated on a CURRENT-turn successful
    // run_analysis fact. If a stale follow-up turn somehow replays the
    // chip text, the gate must still suppress so the user sees the
    // stale-rerun path instead of a stale coaching answer.
    const CHIP_MESSAGE =
      'What should we validate or research to build confidence in this decision?';
    const out = tryPostAnalysisAdviceGate({
      message: CHIP_MESSAGE,
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'stale',
      decisionReview: SAMPLE_DECISION_REVIEW,
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('not_fresh');
  });

  // -----------------------------------------------------------------
  // Mutation-precedence over validation phrasings (ported from PR #189).
  // Additional bare-verb cases ensure the mutation pattern still wins
  // when validation vocabulary is wrapped around a real edit.
  // -----------------------------------------------------------------

  it.each([
    ['Set marketing spend to 50000. What should we validate?', 'set + to + numeric, then validate'],
    ['Change delivery risk to 0.7 — what assumptions should we test?', 'change + to + numeric, then test assumptions'],
    ['Adjust the edge from Cost to Risk and tell me what we should validate further.', 'edge edit + validate further'],
    ['Add a new constraint on budget — how do we build confidence?', 'add + entity, then confidence'],
    ['Remove the cost factor. What evidence should we gather?', 'remove + entity, then gather'],
  ] as const)('mutation precedence over validation: %s', (message, _label) => {
    void _label; // it.each passes both tuple elements; only `message` is asserted.
    const out = tryPostAnalysisAdviceGate({
      message,
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('mutation_signal');
  });
});

// =========================================================================
// Near-tie + raw-robustness handling for post-analysis copy.
//
// Regression for the reported P0/P1 case: a ~0.05pp lead was described as
// "meaningful rather than marginal" with "moderate" robustness. The
// composer must:
//   - treat |margin_pp| <= 1.0 as effectively tied,
//   - honour `enrichment.robustness.near_tie.is_tie === true` as a strong
//     override even when margin > 1.0pp,
//   - prefer raw `enrichment.robustness.level ∈ {very_low,low,fragile}`
//     over a coerced projected band,
//   - suppress moderate/stable wording in those cases,
//   - keep all existing wording for non-near-tie, non-fragile inputs.
//
// Sibling-composer audit (recorded here so future drift is caught):
//   - composeAdvice: margin sentence is neutral ("It sits ahead of … by …").
//     LEFT UNCHANGED. Locked below.
//   - composeMeaning: margin sentence is neutral. LEFT UNCHANGED. Locked.
//   - composeImprovement: had a stability claim ("smaller adjustments may
//     not move the picture much"). PATCHED: gated behind !near-tie / !raw-fragile.
//   - composeWhatWouldFlip: had a stability claim ("smaller changes are
//     unlikely to flip the outcome on their own") and a margin-asking-to-
//     close sentence. PATCHED: both gated; near-tie reframe added.
// =========================================================================
describe('tryPostAnalysisAdviceGate — near-tie + raw robustness', () => {
  // Forbidden strength-claim strings on a near-tie / raw-fragile path. The
  // composer MUST NOT emit any of these when isNearTie or isRawFragile.
  const FORBIDDEN_STRENGTH_PHRASES: readonly RegExp[] = [
    /meaningful rather than marginal/i,
    /\bmeaningful lead\b/i,
    /\bstrongly favours\b/i,
    /\brobustness band is moderate\b/i,
    /\brobustness band is currently moderate\b/i,
    /\brobustness band is stable\b/i,
    /\brobustness band is currently stable\b/i,
    /smaller adjustments may not move the picture much/i,
    /smaller changes are unlikely to flip the outcome/i,
  ];

  // No internal jargon in user-facing copy on any path.
  const FORBIDDEN_INTERNAL_TERMS: readonly RegExp[] = [
    /\bschema\b/i,
    /\bhandler\b/i,
    /\btool\b/i,
    /\bgraph hash\b/i,
    /\bnode\s*id\b/i,
    // UUID-like: 8-4-4-4-12 hex
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  ];

  function assertNoForbidden(
    text: string,
    forbidden: readonly RegExp[],
  ): void {
    for (const re of forbidden) {
      expect(text).not.toMatch(re);
    }
  }

  // ── 1. Reported case: leading=48.475%, runner_up=48.425%, margin≈0.05pp ─
  it('reported near-tie case (margin ≈ 0.05pp) → effectively-tied copy, no strength claim', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Can you explain these analysis results to me?',
      analysis: {
        status: 'success',
        leading_option: { label: 'Hire One Tech Lead', probability: 0.48475 },
        runner_up: { label: 'Hire Two Developers', probability: 0.48425 },
        margin_pp: 0.05,
        robustness_band: 'moderate',
        top_drivers: [
          { factor_label: 'Delivery risk', sensitivity_value: 0.45 },
        ],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('explain_results_free_text');
      const text = out.assistant_text;
      expect(text).toMatch(/effectively tied/i);
      expect(text).toContain('Hire One Tech Lead');
      expect(text).toContain('Hire Two Developers');
      // Margin-based near-tie → copy must say "one percentage point or
      // less" (numerically true at the inclusive 1.0pp threshold), NOT
      // "less than one percentage point" (which would be false at 1.0pp).
      expect(text).toMatch(/one percentage point or less/i);
      expect(text).not.toMatch(/less than one percentage point/i);
      assertNoForbidden(text, FORBIDDEN_STRENGTH_PHRASES);
      assertNoForbidden(text, FORBIDDEN_INTERNAL_TERMS);
    }
  });

  // ── 2. Exact threshold: margin_pp = 1.0 → near-tie (inclusive) ─────────
  it('exact threshold margin_pp = 1.0 → treated as near-tie', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'Option A', probability: 0.505 },
        runner_up: { label: 'Option B', probability: 0.495 },
        margin_pp: 1.0,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.3 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toMatch(/effectively tied/i);
      assertNoForbidden(out.assistant_text, FORBIDDEN_STRENGTH_PHRASES);
    }
  });

  // ── 3. Just over threshold: margin_pp = 1.1 → existing wording preserved ─
  it('margin_pp = 1.1 → existing strength wording preserved (NOT a near-tie)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'Option A', probability: 0.5055 },
        runner_up: { label: 'Option B', probability: 0.4945 },
        margin_pp: 1.1,
        robustness_band: 'stable',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.3 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('meaningful rather than marginal');
      expect(out.assistant_text).not.toMatch(/effectively tied/i);
    }
  });

  // ── 4. Wide lead: existing happy-path wording preserved verbatim ───────
  it('wide lead (margin_pp = 24) → existing strength wording preserved', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.62 },
        runner_up: { label: 'B', probability: 0.38 },
        margin_pp: 24,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('meaningful rather than marginal');
      expect(out.assistant_text).toContain('This result looks fairly stable, but it is worth checking the main assumptions before deciding');
      expect(out.assistant_text).not.toMatch(/robustness band/i);
    }
  });

  // ── 5. Robustness conflict: projection says moderate, raw says very_low ─
  it('robustness conflict — projection=moderate, raw.level=very_low → fragile copy', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.55 },
        runner_up: { label: 'B', probability: 0.45 },
        margin_pp: 10, // wide enough NOT to trigger near-tie on its own
        robustness_band: 'moderate', // misleadingly confident projection
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
      rawRobustness: { level: 'very_low', near_tie_is_tie: false },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      expect(text).toMatch(/picture appears fragile/i);
      expect(text).not.toContain('The robustness band is moderate');
      expect(text).not.toContain('The robustness band is stable');
    }
  });

  // ── 6. Strong override: raw near_tie.is_tie=true overrides wide margin ─
  it('raw near_tie.is_tie=true overrides margin > 1.0pp → near-tie copy', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'Hire One Tech Lead', probability: 0.515 },
        runner_up: { label: 'Hire Two Developers', probability: 0.485 },
        margin_pp: 3.0, // would normally NOT be a near-tie
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
      rawRobustness: { level: null, near_tie_is_tie: true },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      expect(text).toMatch(/effectively tied/i);
      // Raw-override branch: copy MUST NOT claim a sub-1pp gap when the
      // actual margin is 3pp. Generic "the analysis treats them as a
      // near-tie" wording is numerically true on this branch; the
      // margin-based phrasing ("one percentage point or less") is NOT.
      expect(text).toMatch(/the analysis treats .+ as a near[- ]tie/i);
      expect(text).not.toMatch(/one percentage point or less/i);
      expect(text).not.toMatch(/less than one percentage point/i);
      expect(text).not.toContain('meaningful rather than marginal');
    }
  });

  // ── 6b. Margin-based exact boundary: 1.0pp → "one percentage point or less" ─
  it('margin_pp = 1.0 → margin-based near-tie copy says "one percentage point or less" (true at boundary)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.505 },
        runner_up: { label: 'B', probability: 0.495 },
        margin_pp: 1.0,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.3 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toMatch(/one percentage point or less/i);
      // "less than one percentage point" would be FALSE at exact 1.0pp.
      expect(out.assistant_text).not.toMatch(/less than one percentage point/i);
    }
  });

  // ── 6c. Raw override + null margin: generic copy, no numeric claim ─────
  it('raw near_tie.is_tie=true with null margin_pp → generic copy, no numeric claim', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5 },
        runner_up: { label: 'B', probability: 0.5 },
        margin_pp: null, // no projected margin
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
      rawRobustness: { level: null, near_tie_is_tie: true },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      expect(text).toMatch(/effectively tied/i);
      expect(text).toMatch(/the analysis treats .+ as a near[- ]tie/i);
      expect(text).not.toMatch(/percentage point/i);
    }
  });

  // ── 7. Sibling composer: composeImprovement on near-tie suppresses claim ─
  it('composeImprovement on near-tie → no "smaller adjustments may not move" claim', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'How can we improve the outcome?',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('improvement');
      expect(out.assistant_text).not.toMatch(/smaller adjustments may not move the picture much/i);
      expect(out.assistant_text).toMatch(/picture appears fragile/i);
    }
  });

  // ── 8. Sibling composer: composeWhatWouldFlip on near-tie reframes lead ─
  it('composeWhatWouldFlip on margin near-tie (≤1pp) → effectively tied + one provisional caveat', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      expect(text).toMatch(/'A' and 'B' are effectively tied/);
      // Consolidated single caveat — provisional, not the old stacked "could flip" tail.
      expect(text).toMatch(/treat the lead as provisional/i);
      expect(text).not.toMatch(/outcome could flip with small changes/i);
      expect(text).not.toMatch(/smaller changes are unlikely to flip the outcome/i);
      // Numerically honest: never say a near-zero gap "would need to close".
      expect(text).not.toMatch(/the lead of .* would need to close/i);
    }
  });

  // ── 9. Sibling lock-in: composeAdvice stays NEUTRAL on near-tie ────────
  it('composeAdvice on near-tie: no strength claim added (neutral margin sentence preserved)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do?',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // composeAdvice does NOT assert lead-strength; ensure no false certainty
      // creeps in if a future edit adds one without the threshold guard.
      assertNoForbidden(out.assistant_text, FORBIDDEN_STRENGTH_PHRASES);
    }
  });

  // ── 10. Sibling lock-in: composeMeaning stays NEUTRAL on near-tie ──────
  it('composeMeaning on near-tie: no strength claim added (neutral margin sentence preserved)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What does this mean?',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      assertNoForbidden(out.assistant_text, FORBIDDEN_STRENGTH_PHRASES);
    }
  });

  // ── 10b. Sibling pin: composeAdvice at the reported 0.05pp case ────────
  //
  // Policy choice (codified here, not re-litigated): composeAdvice answers
  // "what should we do?" — the user is asking for advice, not for the
  // strength of the lead. The opener ("currently favours X") + neutral
  // margin sentence ("It sits ahead of Y by 0.1 percentage points") is
  // technically true at 0.05pp and softer than the explain-results
  // composer's previous "meaningful rather than marginal" assertion.
  // We deliberately keep the existing copy and only assert it stays
  // free of stronger strength claims. If product later decides advice
  // copy should also reframe on near-tie, this test makes that change
  // intentional.
  it('composeAdvice at reported 0.05pp: existing copy preserved, no escalation to strength claims', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do?',
      analysis: {
        status: 'success',
        leading_option: { label: 'Hire One Tech Lead', probability: 0.48475 },
        runner_up: { label: 'Hire Two Developers', probability: 0.48425 },
        margin_pp: 0.05,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('advice');
      const text = out.assistant_text;
      // Existing opener + neutral margin sentence preserved.
      expect(text).toContain('currently favours Hire One Tech Lead');
      expect(text).toMatch(/It sits ahead of Hire Two Developers/);
      // No escalation to strong-claim copy.
      assertNoForbidden(text, FORBIDDEN_STRENGTH_PHRASES);
      assertNoForbidden(text, FORBIDDEN_INTERNAL_TERMS);
    }
  });

  // ── 10c. composeMeaning near-tie honesty: reframes on the 0.05pp case ──
  //
  // Meaning now shares the interpretation-twin near-tie guard: on a sub-1pp
  // gap it leads with the closeness line and MUST NOT assert the result is
  // "driven by" a single factor (a near-tie is not confidently single-driver).
  it('composeMeaning at reported 0.05pp: reframes honestly on near-tie (no "driven by")', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What does this mean?',
      analysis: {
        status: 'success',
        leading_option: { label: 'Hire One Tech Lead', probability: 0.48475 },
        runner_up: { label: 'Hire Two Developers', probability: 0.48425 },
        margin_pp: 0.05,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('meaning');
      const text = out.assistant_text;
      // Closeness honesty, quoted labels.
      expect(text).toMatch(/effectively tied/i);
      expect(text).toContain("'Hire One Tech Lead'");
      // The honesty fix: never claim a single-factor "driven by" on a near-tie.
      expect(text).not.toMatch(/driven by/i);
      // Softened driver framing instead.
      expect(text).toContain("The order could shift with movement on 'Delivery risk'");
      // No confident margin/strength escalation.
      expect(text).not.toMatch(/It sits ahead of/);
      assertNoForbidden(text, FORBIDDEN_STRENGTH_PHRASES);
      assertNoForbidden(text, FORBIDDEN_INTERNAL_TERMS);
    }
  });

  // ── 11. British English on near-tie copy ───────────────────────────────
  it('near-tie copy uses British English ("favours") and no Americanisms ("favors")', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // The near-tie path does not include the "favours" opener, but if the
      // composer ever emits any "favour"-family word it must be the British
      // spelling. Verify no US spellings leak.
      expect(out.assistant_text).not.toMatch(/\bfavor(s|ed|ing|able)?\b/);
      expect(out.assistant_text).not.toMatch(/\bbehavior\b/);
      expect(out.assistant_text).not.toMatch(/\borganization\b/);
    }
  });

  // ── 12. No internal jargon / UUIDs ever leak into near-tie copy ────────
  it('near-tie copy contains no internal jargon or UUID-like substrings', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      assertNoForbidden(out.assistant_text, FORBIDDEN_INTERNAL_TERMS);
    }
  });

  // ── 12b. Exact perfect tie: margin_pp = 0 ──────────────────────────────
  it('exact perfect tie (margin_pp = 0) → near-tie copy', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5 },
        runner_up: { label: 'B', probability: 0.5 },
        margin_pp: 0,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.3 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toMatch(/effectively tied/i);
      expect(out.assistant_text).not.toContain('meaningful rather than marginal');
    }
  });

  // ── 12c. Raw fragile without near-tie still suppresses stability claim ─
  it('composeWhatWouldFlip raw-fragile only (margin > 1pp, level=fragile) → fragile copy, no stability claim', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.55 },
        runner_up: { label: 'B', probability: 0.45 },
        margin_pp: 10, // wide enough NOT to be a near-tie
        robustness_band: 'moderate', // misleadingly confident projection
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
      rawRobustness: { level: 'fragile', near_tie_is_tie: false },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      // Raw-fragile branch keeps the clear-lead framing (NOT near-tie reframe)
      // because margin > 1pp, but MUST suppress the stability claim and emit
      // the single fragile-aware caveat instead.
      expect(text).toMatch(/treat the lead as provisional/i);
      expect(text).not.toMatch(/smaller changes are unlikely to (flip|change)/i);
      expect(text).not.toContain('The robustness band is currently moderate');
    }
  });

  // ── 12d. Near-tie path drops the duplicate "Small changes…" closing line ─
  it('near-tie path omits redundant closing "Small changes to the strongest factor can shift the picture."', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // The fragile-aware sentence already conveys "small changes matter";
      // the original closing line would duplicate it on this path.
      expect(out.assistant_text).not.toMatch(/Small changes to the strongest factor can shift the picture\./);
      // Non-near-tie path still includes it — locked by the wide-lead test above.
    }
  });

  // ── 13. Deterministic invariants preserved on near-tie path ────────────
  it('near-tie path keeps llm_calls_used=0 / direct_answer / explain_results_free_text class', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Can you explain these analysis results to me?',
      analysis: {
        status: 'success',
        leading_option: { label: 'A', probability: 0.5005 },
        runner_up: { label: 'B', probability: 0.4995 },
        margin_pp: 0.1,
        robustness_band: 'moderate',
        top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('explain_results_free_text');
      // Suggested action: same chip set as the non-near-tie path
      // (what_would_flip chip) — chip ownership not affected by near-tie.
      expect(out.suggested_actions.length).toBe(1);
      expect(out.suggested_actions[0]?.action_type).toBe('what_would_flip');
    }
  });
});

// ===========================================================================
// Scope B — two-driver evidence-gap fallback + by-design phase3 grounding
// ===========================================================================

describe('composeEvidenceGap — two-driver evidence-priority fallback', () => {
  // Pure top-driver fallback: no readiness gaps (no analysisReady), no fragile
  // edges, no decision_review → the composer names where evidence matters most.
  const TWO_DRIVERS_NO_EDGES: AdviceGateAnalysis = {
    ...FIXTURE_ANALYSIS,
    fragile_edges: [],
    top_drivers: [
      { factor_label: 'Delivery risk' },
      { factor_label: 'Cost overrun risk' },
    ],
  };

  it('names BOTH highest-leverage drivers when the projection carries a second one', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: TWO_DRIVERS_NO_EDGES,
      freshness: 'fresh',
      // no analysisReady, no decisionReview — the by-design fallback source.
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      expect(out.assistant_text).toContain('Delivery risk');
      expect(out.assistant_text).toContain('Cost overrun risk');
      expect(out.assistant_text).toMatch(/next most sensitive factor/);
      // Both surface as bullets under the plural header.
      expect(out.assistant_text).toMatch(/biggest open gaps right now are/i);
      // Direction-honest by construction: makes no increases/decreases claim.
      expect(out.assistant_text).not.toMatch(/increase|decrease|raises|lowers/i);
      // No raw IDs / decimals / readiness percentage.
      expect(out.assistant_text).not.toMatch(/\bfac_|\bopt_|\d{1,3}\s*%/);
    }
  });

  it('keeps single-driver wording intact when only one driver is renderable', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: { ...TWO_DRIVERS_NO_EDGES, top_drivers: [{ factor_label: 'Delivery risk' }] },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Singular header, original sentence, no second-driver line.
      expect(out.assistant_text).toMatch(/^The biggest open gap right now is:/);
      expect(out.assistant_text).toContain(
        'the strongest sensitivity is on Delivery risk, so that',
      );
      expect(out.assistant_text).not.toContain('Cost overrun risk');
      expect(out.assistant_text).not.toMatch(/next most sensitive/);
    }
  });

  it('two-driver fallback copy passes the real egress guards (no forbidden / success-claim / ID / decimal / internal-label leak)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: TWO_DRIVERS_NO_EDGES, // 2 drivers, no edges, no readiness, no DR
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Confirm we exercised the two-driver branch (not single-driver / DR / readiness).
      expect(out.advice_class).toBe('evidence_gap');
      expect(out.assistant_text).toMatch(/biggest open gaps right now are/i);
      expect(out.assistant_text).toMatch(/next most sensitive factor/);

      const text = out.assistant_text;
      // Real egress guards run against the matched assistant_text.
      expect(findForbiddenPhraseHit(text), `forbidden phrase in:\n${text}`).toBeNull();
      expect(findSuccessClaimHit(text), `success-claim phrase in:\n${text}`).toBeNull();
      // No raw entity IDs.
      expect(text).not.toMatch(/\b(?:fac|opt|out|risk|goal|dec|node|con)_[a-z0-9]+/i);
      // No raw long decimals (2+ fractional digits).
      expect(text).not.toMatch(/\d+\.\d{2,}/);
      // No internal labels / schema tokens.
      for (const token of [
        'phase3',
        'm1_coaching',
        'widening_log',
        'strengthen_items',
        'bias_signals',
        'decision_review',
        'factor_sensitivity',
        'top_drivers',
        'analysis_projection',
        'highly_stable',
      ]) {
        expect(text.toLowerCase(), `internal token "${token}" leaked`).not.toContain(token);
      }
    }
  });

  it('never names the same factor twice when the two top drivers share a label', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...TWO_DRIVERS_NO_EDGES,
        top_drivers: [{ factor_label: 'Delivery risk' }, { factor_label: 'Delivery risk' }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Only one distinct factor exists → single-driver wording, named once.
      const occurrences = out.assistant_text.split('Delivery risk').length - 1;
      expect(occurrences).toBe(1);
      expect(out.assistant_text).not.toMatch(/next most sensitive/);
      expect(out.assistant_text).toMatch(/^The biggest open gap right now is:/);
    }
  });

  it('treats whitespace / case variants of a label as the same factor (normalised dedup)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...TWO_DRIVERS_NO_EDGES,
        // Same factor, incidental trailing space + case difference.
        top_drivers: [{ factor_label: 'Delivery risk' }, { factor_label: 'delivery risk ' }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Normalised compare → treated as one factor → single-driver wording.
      expect(out.assistant_text).not.toMatch(/next most sensitive/);
      expect(out.assistant_text).toMatch(/^The biggest open gap right now is:/);
      // The variant second label must not appear as its own named driver.
      expect(out.assistant_text).not.toContain('delivery risk ');
    }
  });

  it('renders a distinct second label trimmed (no incidental whitespace from upstream)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: {
        ...TWO_DRIVERS_NO_EDGES,
        // Two DISTINCT factors; the second carries an incidental trailing space.
        top_drivers: [{ factor_label: 'Delivery risk' }, { factor_label: 'Cost risk ' }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      // Both named (distinct), and the second renders trimmed — no double space.
      expect(out.assistant_text).toMatch(/next most sensitive factor/);
      expect(out.assistant_text).toContain('Cost risk is the next most sensitive factor');
      expect(out.assistant_text).not.toContain('Cost risk  is');
    }
  });
});

describe('post-analysis stays grounded when decision_review is unavailable (by-design phase3 path)', () => {
  // Regression for the resolved gate: on a fresh follow-up the persisted
  // run_analysis fact carries raw PLoT enrichment only (no decision_review),
  // so phase3_block_context_available is false BY DESIGN
  // (V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW defaults off). The advice gate must
  // still answer from the projected analysis fallback, never degrade to a
  // generic template.
  it('answers an explanatory question with concrete drivers, not generic copy', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
      // decisionReview deliberately omitted — mirrors the fresh-follow-up shape.
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('Hire two senior engineers locally');
      expect(out.assistant_text).toMatch(/Delivery risk|Cost overrun risk/);
      expect(out.assistant_text.length).toBeGreaterThan(60);
    }
  });

  it('answers an evidence-gap question from the projection when decision_review is absent', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What evidence is missing?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('evidence_gap');
      // Grounded in the projection (fragile edge / top driver), not a template.
      expect(out.assistant_text).toMatch(/biggest open gap/i);
      expect(out.assistant_text).not.toContain('To build confidence in this analysis');
    }
  });
});

describe('advice-gate copy-source descriptor (Scope C diagnostics)', () => {
  it('tags evidence_gap from decision_review when usable evidence_enhancements exist', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
      decisionReview: {
        produced_at: '2026-05-21T10:00:00.000Z',
        evidence_enhancements: {
          fac_a: { specific_action: 'Pull the last two quarters of delivery data and check the variance.' },
        },
        key_assumptions: ['The hiring market stays as competitive as today.'],
      },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.copy_source).toBe('decision_review');
      expect(out.coaching_fields_used).toContain('decision_review');
    }
  });

  it('tags the evidence_gap fallback as top_drivers when only drivers remain', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: { ...FIXTURE_ANALYSIS, fragile_edges: [] },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.copy_source).toBe('top_drivers');
      expect(out.coaching_fields_used).toContain('top_drivers');
      expect(out.coaching_fields_used).not.toContain('decision_review');
    }
  });

  it('tags the evidence_gap fallback as fragile_edges when a renderable edge exists', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS, // carries one renderable fragile edge
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.copy_source).toBe('fragile_edges');
      expect(out.coaching_fields_used).toContain('fragile_edges');
    }
  });

  it('tags projection-class composers as analysis_projection with the fields used', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What would you recommend?',
      analysis: FIXTURE_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('advice');
      expect(out.copy_source).toBe('analysis_projection');
      expect(out.coaching_fields_used).toEqual(
        expect.arrayContaining(['leading_option', 'top_drivers']),
      );
      expect(out.coaching_fields_used).not.toContain('decision_review');
    }
  });

  it('tags the readiness composer as readiness', () => {
    const out = tryPostAnalysisAdviceGate({
      message: "What's blocking the analysis?",
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe('readiness');
      expect(out.copy_source).toBe('readiness');
    }
  });
});

describe('hasRenderableTopDriverLabel — projection-shaped top_driver_present source', () => {
  it('true when the projection has a top driver with a non-empty label', () => {
    expect(
      hasRenderableTopDriverLabel({
        top_drivers: [{ factor_label: 'Overtime Intensity' }],
      }),
    ).toBe(true);
  });

  it('false on an empty / missing top_drivers array', () => {
    expect(hasRenderableTopDriverLabel({ top_drivers: [] })).toBe(false);
    expect(hasRenderableTopDriverLabel({})).toBe(false);
    expect(hasRenderableTopDriverLabel(null)).toBe(false);
    expect(hasRenderableTopDriverLabel(undefined)).toBe(false);
  });

  it('false when the first driver label is whitespace-only or null', () => {
    expect(hasRenderableTopDriverLabel({ top_drivers: [{ factor_label: '   ' }] })).toBe(false);
    expect(hasRenderableTopDriverLabel({ top_drivers: [{ factor_label: null }] })).toBe(false);
  });

  it('reports presence from the projection independent of advice-gate matching', () => {
    // Regression for the telemetry inconsistency: a projection WITH drivers
    // must report true even on turns where the advice gate would not match a
    // driver-consuming class. The predicate reads only the projection.
    const projectionWithDrivers = {
      top_drivers: [
        { factor_label: 'Launch Readiness' },
        { factor_label: 'Cost' },
      ],
    };
    expect(hasRenderableTopDriverLabel(projectionWithDrivers)).toBe(true);
  });
});

// =========================================================================
// what_would_flip — richer evidence + honest coaching (this workstream).
// Regression fixture: the hiring near-tie ("Hire One Tech Lead" vs
// "Hire One Tech Lead and One Developer", ~5pp, flagged a near-tie by the
// raw override, top fragile cost→risk link, no reliable flip signal).
// =========================================================================
describe('tryPostAnalysisAdviceGate — what_would_flip richer evidence + honesty', () => {
  const HIRING_NEAR_TIE: AdviceGateAnalysis = {
    status: 'success',
    leading_option: { label: 'Hire One Tech Lead', probability: 0.445 },
    runner_up: { label: 'Hire One Tech Lead and One Developer', probability: 0.3935 },
    margin_pp: 5.15,
    robustness_band: 'fragile',
    top_drivers: [{ factor_label: 'Hiring and Salary Cost', sensitivity_value: 0.5 }],
    fragile_edges: [{ from_label: 'Hiring and Salary Cost', to_label: 'Budget Overrun Risk' }],
  };
  // Raw override: the ~5pp gap is a near-tie via the upstream flag, not the margin.
  const RAW_OVERRIDE = { level: 'fragile', near_tie_is_tie: true };

  function flip(
    analysis: AdviceGateAnalysis,
    extra: {
      rawRobustness?: { level: string | null; near_tie_is_tie: boolean };
      decisionReview?: Record<string, unknown>;
    } = {},
  ) {
    return tryPostAnalysisAdviceGate({
      message: 'What would flip this?',
      analysis,
      freshness: 'fresh',
      ...extra,
    });
  }

  // 1. Lead with near-tie / closeness.
  it('1. near-tie (raw override, ~5pp) leads with closeness and the real margin', () => {
    const out = flip(HIRING_NEAR_TIE, { rawRobustness: RAW_OVERRIDE });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect(t).toContain(
        "This is a close call: 'Hire One Tech Lead' is narrowly ahead of 'Hire One Tech Lead and One Developer' by about 5 percentage points",
      );
      expect(t).not.toMatch(/effectively tied/i);
      expect(t).not.toMatch(/favoured option|performing best|\bbest\b/i);
    }
  });

  // 2. Option labels containing "and" stay readable.
  it('2. "and"-containing option labels produce unambiguous quoted comparison copy', () => {
    const out = flip(HIRING_NEAR_TIE, { rawRobustness: RAW_OVERRIDE });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect(t).toContain("'Hire One Tech Lead'");
      expect(t).toContain("'Hire One Tech Lead and One Developer'");
      // The ambiguous unquoted run must NOT appear.
      expect(t).not.toContain('Hire One Tech Lead and Hire One Tech Lead and One Developer');
    }
  });

  // 3. Hedge consolidation — exactly one caveat.
  it('3. near-tie + fragile → exactly one consolidated caveat, no stacked hedges', () => {
    const out = flip(HIRING_NEAR_TIE, { rawRobustness: RAW_OVERRIDE });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect((t.match(/treat the lead as provisional/gi) ?? []).length).toBe(1);
      expect(t).not.toMatch(/could flip with small changes/i);
      expect(t).not.toMatch(/picture appears fragile/i);
    }
  });

  // 4. Name the fragile assumption only when backed by real evidence.
  it('4a. names the specific fragile assumption when fragile_edges present', () => {
    const out = flip(HIRING_NEAR_TIE, { rawRobustness: RAW_OVERRIDE });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain(
        "The most useful thing to check is the link from 'Hiring and Salary Cost' to 'Budget Overrun Risk': whether it holds as strongly as the model currently assumes",
      );
    }
  });
  it('4b. does NOT invent a fragile assumption when fragile_edges absent', () => {
    const out = flip({ ...HIRING_NEAR_TIE, fragile_edges: [] }, { rawRobustness: RAW_OVERRIDE });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).not.toContain('the link from');
    }
  });

  // 5. Honest flip handling (amendment: empty is ambiguous → never claim no-flip).
  it('5a. flip_thresholds absent → no flip claim and no implied flip', () => {
    const out = flip(HIRING_NEAR_TIE, { rawRobustness: RAW_OVERRIDE });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect(t).not.toMatch(/most likely to flip|single-factor change that flips|threshold signal/i);
      expect(t).not.toMatch(/to see where the leading option moves/i);
      expect(t).toMatch(/treat the lead as provisional/i);
    }
  });
  it('5b. flip_thresholds: [] → no "no-flip" claim and no implied flip (empty is ambiguous)', () => {
    const out = flip(HIRING_NEAR_TIE, {
      rawRobustness: RAW_OVERRIDE,
      decisionReview: { flip_thresholds: [] },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect(t).not.toMatch(/threshold signal/i);
      expect(t).not.toMatch(/does not show a simple|no simple single-factor/i);
      expect(t).not.toMatch(/most likely to flip/i);
    }
  });
  it('5c. non-empty flip_thresholds with a clean label → provenance-safe threshold sentence', () => {
    const out = flip(HIRING_NEAR_TIE, {
      rawRobustness: RAW_OVERRIDE,
      decisionReview: { flip_thresholds: [{ factor_label: 'Hiring and Salary Cost' }] },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain("One threshold signal to inspect is 'Hiring and Salary Cost'");
      // Never overstate the source.
      expect(out.assistant_text).not.toMatch(/the analysis suggests the result could change/i);
    }
  });
  it('5d. non-empty flip_thresholds with unsafe/missing label → omit the threshold sentence', () => {
    const out = flip(HIRING_NEAR_TIE, {
      rawRobustness: RAW_OVERRIDE,
      decisionReview: { flip_thresholds: [{ factor_label: 'fac_cost_01' }, { factor_label: '   ' }] },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).not.toMatch(/threshold signal to inspect/i);
      expect(out.assistant_text).not.toContain('fac_cost_01');
    }
  });

  // 6. Copy safety.
  it('6. copy is glossary-safe: no raw decimals, IDs, internal vocab, best/recommended/winner', () => {
    const out = flip(HIRING_NEAR_TIE, {
      rawRobustness: RAW_OVERRIDE,
      decisionReview: { flip_thresholds: [{ factor_label: 'Hiring and Salary Cost' }] },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect(t).not.toMatch(/\b0\.\d+/); // raw normalised decimals
      expect(t).not.toMatch(/\b(fac|opt|out|risk|goal|dec|node)_[a-z0-9]/i); // entity IDs
      expect(t).not.toMatch(/_meta|graph hash|node id/i);
      expect(t).not.toMatch(/\b(best|recommended|winner)\b/i);
      expect(findForbiddenPhraseHit(t)).toBeNull();
    }
  });

  // 7. Deterministic fast path — no LLM call.
  it('7. fast path is deterministic and synchronous (no async LLM dispatch)', () => {
    const out = flip(HIRING_NEAR_TIE, { rawRobustness: RAW_OVERRIDE });
    // A synchronous result object — not a Promise/thenable — proves no LLM round-trip.
    expect(typeof (out as { then?: unknown }).then).toBe('undefined');
    expect(out.matched).toBe(true);
  });

  // 8. Graceful when richer evidence is absent.
  it('8. clear-lead answer when fragile_edges, decisionReview and rawRobustness all absent', () => {
    const out = flip({
      status: 'success',
      leading_option: { label: 'Option A', probability: 0.7 },
      runner_up: { label: 'Option B', probability: 0.3 },
      margin_pp: 40,
      robustness_band: 'stable',
      top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.4 }],
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      expect(t).toContain("Based on this model, 'Option A' currently leads");
      expect(t).not.toContain('the link from'); // no invented fragile assumption
      expect(t).not.toMatch(/most likely to flip|threshold signal/i); // no implied flip
      expect(t).toContain('What to check next');
    }
  });
});

// ===========================================================================
// Slice 1 — GQPV parity for the interpretation twins (explain_results + meaning)
//
// These lock the user-visible uplift: quoted labels, the named fragile
// assumption (drawn from fragile_edges already on the projection), a concrete
// next action on every path, and near-tie honesty in composeMeaning — all
// deterministic, no new LLM call, no decision_review dependency.
// ===========================================================================

describe('interpretation twins — GQPV parity (explain_results + meaning)', () => {
  const FRAGILE_EDGE = { from_label: 'Hiring and Salary Cost', to_label: 'Budget Overrun Risk' };

  const CONFIDENT_WITH_EDGE: AdviceGateAnalysis = {
    status: 'success',
    // Runner-up label contains "and" — the readability case quoting fixes.
    leading_option: { label: 'Hire One Tech Lead', probability: 0.62 },
    runner_up: { label: 'Hire One Tech Lead and One Developer', probability: 0.38 },
    margin_pp: 24,
    robustness_band: 'moderate',
    top_drivers: [
      { factor_label: 'Delivery risk', sensitivity_value: 0.45 },
      { factor_label: 'Cost overrun risk', sensitivity_value: -0.32 },
    ],
    fragile_edges: [FRAGILE_EDGE],
  };

  const MINIMAL_NO_EDGE: AdviceGateAnalysis = {
    status: 'success',
    leading_option: { label: 'Option A', probability: 0.7 },
    runner_up: { label: 'Option B', probability: 0.3 },
    margin_pp: 40,
    robustness_band: 'stable',
    top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.4 }],
    // no fragile_edges, no rawRobustness
  };

  const explain = (analysis: AdviceGateAnalysis, extra: Record<string, unknown> = {}) =>
    tryPostAnalysisAdviceGate({ message: 'Explain the results.', analysis, freshness: 'fresh', ...extra });
  const meaning = (analysis: AdviceGateAnalysis, extra: Record<string, unknown> = {}) =>
    tryPostAnalysisAdviceGate({ message: 'What does this mean?', analysis, freshness: 'fresh', ...extra });

  // ── Quoted "and"-containing labels stay readable (both twins) ──────────
  it('quotes "and"-containing option labels so the comparison is unambiguous', () => {
    for (const out of [explain(CONFIDENT_WITH_EDGE), meaning(CONFIDENT_WITH_EDGE)]) {
      expect(out.matched).toBe(true);
      if (out.matched) {
        const t = out.assistant_text;
        expect(t).toContain("'Hire One Tech Lead'");
        expect(t).toContain("'Hire One Tech Lead and One Developer'");
        // The ambiguous unquoted run must NOT appear.
        expect(t).not.toContain('Hire One Tech Lead and Hire One Tech Lead and One Developer');
      }
    }
  });

  // ── Fragile assumption named when present; never invented when absent ──
  it('names the specific fragile assumption when fragile_edges present (both twins)', () => {
    for (const out of [explain(CONFIDENT_WITH_EDGE), meaning(CONFIDENT_WITH_EDGE)]) {
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.assistant_text).toContain(
          "The most useful thing to check is the link from 'Hiring and Salary Cost' to 'Budget Overrun Risk': whether it holds as strongly as the model currently assumes",
        );
      }
    }
  });

  it('does NOT invent a fragile assumption when fragile_edges absent (both twins)', () => {
    for (const out of [explain(MINIMAL_NO_EDGE), meaning(MINIMAL_NO_EDGE)]) {
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.assistant_text).not.toContain('the link from');
      }
    }
  });

  // ── explain_results gives a concrete next action on EVERY path ─────────
  it('explain_results emits a concrete next action on the confident path (names the driver)', () => {
    const out = explain(CONFIDENT_WITH_EDGE);
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('What to check next');
      expect(out.assistant_text).toMatch(
        /^• Re-run after revisiting 'Delivery risk', the factor with the most influence here, to see whether the lead holds\.$/m,
      );
    }
  });

  it('explain_results emits a concrete next action on the fragile path (strengthen the named link)', () => {
    const out = explain(CONFIDENT_WITH_EDGE, { rawRobustness: { level: 'fragile', near_tie_is_tie: false } });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      // Fragile signal present → strengthen-the-link Propose, not the generic one.
      expect(t).toMatch(/^• Strengthen the evidence behind that link, then re-run to see whether the lead holds\.$/m);
      // Single robustness caveat — no stacked hedges.
      expect((t.match(/picture appears fragile/gi) ?? []).length).toBe(1);
    }
  });

  // ── Amendment 2: combined near-tie + fragile for composeMeaning ───────
  it('composeMeaning near-tie + fragile: closeness honesty, named assumption, one caveat, no "driven by"', () => {
    const out = meaning({
      status: 'success',
      leading_option: { label: 'Hire One Tech Lead', probability: 0.5025 },
      runner_up: { label: 'Hire Two Developers', probability: 0.4975 },
      margin_pp: 0.5, // sub-1pp near-tie
      robustness_band: 'moderate',
      top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
      fragile_edges: [FRAGILE_EDGE],
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const t = out.assistant_text;
      // Closeness honesty.
      expect(t).toMatch(/effectively tied/i);
      // Never assert a single-factor "driven by" on a near-tie.
      expect(t).not.toMatch(/driven by/i);
      expect(t).toContain("The order could shift with movement on 'Delivery risk'");
      // Fragile assumption composes coherently — named exactly once.
      expect(
        (t.match(/The most useful thing to check is the link from/g) ?? []).length,
      ).toBe(1);
      // Exactly one caveat: meaning adds neither "treat as provisional" nor
      // "picture appears fragile" on top of the named assumption.
      expect(t).not.toMatch(/treat the lead as provisional/i);
      expect(t).not.toMatch(/picture appears fragile/i);
      // No contradictory confidence.
      expect(t).not.toMatch(/meaningful rather than marginal/i);
      expect(t).not.toMatch(/It sits ahead of/);
    }
  });

  // ── Absent-signal fallback: safe, sensible, no crash (both twins) ──────
  it('absent fragile/raw signals → safe fallback copy (explain_results keeps an action; meaning stays interpretive)', () => {
    const ex = explain(MINIMAL_NO_EDGE);
    expect(ex.matched).toBe(true);
    if (ex.matched) {
      expect(ex.assistant_text).toContain('What to check next');
      expect(ex.assistant_text).not.toContain('the link from');
    }
    const me = meaning(MINIMAL_NO_EDGE);
    expect(me.matched).toBe(true);
    if (me.matched) {
      expect(me.assistant_text).not.toContain('What to check next'); // interpretive
      expect(me.assistant_text).toMatch(/\n\nThe result reflects/);
      expect(me.assistant_text).not.toContain('the link from');
    }
  });

  // ── Copy safety: no raw decimals / IDs / banned vocab (both twins) ─────
  it('copy is glossary-safe across both twins (no raw decimals, IDs, banned vocab)', () => {
    for (const out of [explain(CONFIDENT_WITH_EDGE), meaning(CONFIDENT_WITH_EDGE)]) {
      expect(out.matched).toBe(true);
      if (out.matched) {
        const t = out.assistant_text;
        expect(t).not.toMatch(/\b0\.\d+/); // raw normalised decimals
        expect(t).not.toMatch(/\b(fac|opt|out|risk|goal|dec|node)_[a-z0-9]/i); // entity IDs
        expect(t).not.toMatch(/_meta|graph hash|node id/i);
        expect(t).not.toMatch(/\b(best|recommended|winner)\b/i);
        expect(findForbiddenPhraseHit(t)).toBeNull();
      }
    }
  });

  // ── Deterministic fast path — no LLM round-trip (both twins) ───────────
  it('both twins resolve synchronously with no LLM dispatch', () => {
    for (const out of [explain(CONFIDENT_WITH_EDGE), meaning(CONFIDENT_WITH_EDGE)]) {
      // A synchronous result object — not a Promise/thenable — proves no LLM call.
      expect(typeof (out as { then?: unknown }).then).toBe('undefined');
      expect(out.matched).toBe(true);
    }
  });
});
