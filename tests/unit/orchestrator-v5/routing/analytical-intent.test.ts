import { describe, it, expect } from 'vitest';
import {
  classifyAnalyticalIntent,
  hasMutationSignal,
  looksLikeImperativeRerun,
  looksLikeVagueEdit,
} from '../../../../src/orchestrator-v5/routing/analytical-intent.js';

describe('classifyAnalyticalIntent', () => {
  describe('rerun_question class', () => {
    const positives = [
      'Do I need to rerun the analysis?',
      'Should we re-run analysis?',
      'Is this analysis still valid?',
      'Are these results stale?',
      'Is the result out of date?',
      'Does this need a rerun?',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('rerun_question');
      });
    }
  });

  describe('what_would_flip class', () => {
    const positives = [
      'What would flip this result?',
      'What would change the outcome?',
      'What would change the leading option?',
      'What would tip the balance?',
      'What would it take to change this?',
      'What would need to change?',
      'How could another option win?',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('what_would_flip');
      });
    }
  });

  describe('what_drove class', () => {
    const positives = [
      'What drove this result?',
      'Why did this happen?',
      'What made the result go this way?',
      "What's driving the outcome?",
      'Which factors drove the analysis?',
      // Present-state ranking questions — added so the fresh-analysis
      // follow-up guard can route "Why is X ahead?" to explain_results
      // rather than letting it fall to edit_graph. The grounded-fresh-
      // analysis workstream broadened this predicate to include "leading"
      // so the sibling guards (stale-rerun, no-analysis, advice-gate
      // data-unavailable fallback) all classify the brief's canonical
      // "Why is Option A leading?" phrasing consistently. "winning"
      // intentionally stays out — its surviving call sites are handler-
      // direct and don't route through this classifier.
      'Why is this option ahead?',
      'Why is the recommendation in front?',
      'Why is this on top?',
      'Why is this the leader?',
      'Why is Option A leading?',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('what_drove');
      });
    }
  });

  describe('explain class', () => {
    const positives = [
      'Explain the results.',
      'Walk me through the analysis.',
      'Walk me through this.',
      'Tell me about the results.',
      'What does this mean?',
      'How should I interpret this?',
      'Help me understand the result.',
      'Explain this.',
      'Summarise the results.',
      'Summarize the analysis.',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('explain');
      });
    }
  });

  describe('negative cases (no analytical intent)', () => {
    const negatives = [
      'Set Pricing to 0.7.',
      'Add a new risk for supply chain.',
      'Remove the demand factor.',
      'Update the model.',
      'Increase the strength of that edge.',
      '',
      '   ',
      'Hi there.',
    ];
    for (const msg of negatives) {
      it(`returns null for "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBeNull();
      });
    }
  });

  it('preserves precedence: rerun_question over explain', () => {
    expect(
      classifyAnalyticalIntent('Should I rerun analysis before I explain the results?'),
    ).toBe('rerun_question');
  });
});

describe('looksLikeVagueEdit', () => {
  const positives = [
    'Update something.',
    'Change something please.',
    'Adjust this.',
    'Modify the model.',
    'Fix the graph.',
    'Improve this.',
    'Tweak something.',
    'Make a change.',
    'Make an adjustment.',
    'Do an update.',
    'Can you change something?',
    'Can you adjust the model?',
    'Update.',
    'Adjust.',
  ];
  for (const msg of positives) {
    it(`flags "${msg}" as vague edit`, () => {
      expect(looksLikeVagueEdit(msg)).toBe(true);
    });
  }

  const negatives = [
    // Concrete edits — caught by hasMutationSignal, not vague-edit
    'Set Pricing to 0.7.',
    'Add a new risk for supply chain.',
    'Remove the demand node.',
    // Concrete-target imperative with no value: not vague (the target
    // is named). Must fall through to ambiguous so we do not ask
    // "which factor?" when the user has already named one.
    'Change pricing factor',
    'Change pricing factor.',
    'Update the demand driver',
    'Adjust the supply chain edge',
    // Negated / non-request phrasings — the user is REJECTING an edit,
    // not asking for one. Must NOT trigger the clarification ask.
    "Don't change anything.",
    "Do not change anything.",
    "I don't want to change anything.",
    "I don't want to update the model.",
    "Please don't change anything.",
    "I won't update the model.",
    "I can't change anything right now.",
    "I shouldn't change anything.",
    "I wouldn't change anything.",
    "Never change the model.",
    "No need to update the model.",
    "No point in changing this.",
    "I don't want to make a change.",
    "Won't make any changes.",
    // Analytical questions
    'Walk me through the analysis.',
    'What drove this result?',
    'What would flip this?',
    // General conversation — must NOT be flagged as vague edit
    'Hi.',
    'OK, thanks.',
    'That is interesting.',
    'I see.',
    'Something needs to change here.',
    'Why is this happening?',
    '',
    '   ',
  ];
  for (const msg of negatives) {
    it(`does not flag "${msg}" as vague edit`, () => {
      expect(looksLikeVagueEdit(msg)).toBe(false);
    });
  }
});

describe('hasMutationSignal', () => {
  const positives = [
    'Set the pricing factor to 0.7.',
    'Change the demand to 0.5.',
    'Increase pricing to 80%.',
    'Add a new risk.',
    'Remove the demand node.',
    'Adjust the edge from A to B.',
    'Set Pricing.',
  ];
  for (const msg of positives) {
    it(`flags "${msg}" as mutation`, () => {
      expect(hasMutationSignal(msg)).toBe(true);
    });
  }

  const negatives = [
    'What should we update based on this?',
    'Walk me through the analysis.',
    'What drove this result?',
    'Is this stale?',
    '',
  ];
  for (const msg of negatives) {
    it(`does not flag "${msg}"`, () => {
      expect(hasMutationSignal(msg)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// ROADMAP 2.229 fix 1 — the staleness pattern must require its SUBJECT group
// when the terminal word is one of the three that do not, on their own, carry
// a staleness sense: `valid` / `fresh` / `current`.
//
// Diagnosed defect (PHASE0-EVIDENCE-2026-07-28/diagnosis-2229-canned-coach.md
// §4): the optional `(?:result|results|analysis|outcome|outcomes)` group meant
// "…and what IS THE CURRENT value?" read as "is this still current?" — a
// staleness question — and `rerun_question` is FIRST in precedence, so it beat
// the flip intent that dominated the rest of the sentence.
//
// All SEVEN controls the diagnosis measured are pinned here: 4 true positives
// (must keep classifying) and 3 false positives (must stop classifying).
// ---------------------------------------------------------------------------
describe('classifyAnalyticalIntent — staleness pattern subject requirement (2.229 fix 1)', () => {
  const TRUE_POSITIVES = [
    'Is the analysis out of date?',
    'Is this result still stale?',
    'Are these results still valid?',
    'Is this analysis still current?',
  ];
  for (const msg of TRUE_POSITIVES) {
    it(`still classifies the genuine staleness question "${msg}"`, () => {
      expect(classifyAnalyticalIntent(msg)).toBe('rerun_question');
    });
  }

  const MEASURED_FALSE_POSITIVES = [
    'What is the current value of Weekly Parcel Volume?',
    'Is that valid input for the model?',
    'Is the fresh estimate better?',
  ];
  for (const msg of MEASURED_FALSE_POSITIVES) {
    it(`no longer misreads "${msg}" as a staleness question`, () => {
      expect(classifyAnalyticalIntent(msg)).not.toBe('rerun_question');
    });
  }

  it('the walk Q1 sentence falls through the classifier entirely (mutation control from the diagnosis)', () => {
    // With `:217` suppressed the diagnosis measured Q1 → null: no other
    // pattern re-captures it, so it reaches the LLM router — the route Q3/Q4
    // took and came back with grounded coaching.
    expect(
      classifyAnalyticalIntent(
        'Looking at the flip point on screen: at exactly what value does the answer change, and what is the current value? Please give me the precise numbers, not a range.',
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ROADMAP 2.229 fix 4 — imperative re-run recognition.
//
// Every `rerun_question` pattern is INTERROGATIVE, so a direct instruction
// ("run the analysis again") matched nothing, fell through every guard, and
// was classified by the LLM — nondeterministically between `run_analysis` and
// a mutation handler (diagnosis §8, anomaly 4). `looksLikeImperativeRerun` is
// the deterministic recogniser the pre-route keys on.
//
// It is DELIBERATELY not an INTENT_PATTERNS entry: `rerun_question` means "the
// user is ASKING whether a re-run is needed", and answering is the right
// treatment for that. This predicate means "the user INSTRUCTED a re-run".
// ---------------------------------------------------------------------------
describe('looksLikeImperativeRerun (2.229 fix 4)', () => {
  const IMPERATIVES = [
    'Please run the analysis again on this same model.',
    'Run the analysis again.',
    'Re-run the analysis.',
    'Rerun the analysis please.',
    'Run it again.',
    'Can you re-run the analysis?',
    'Could you run the analysis one more time?',
    "Let's re-run this.",
    'Analyse it again.',
    'Analyze the model again.',
    'Run the numbers again.',
  ];
  for (const msg of IMPERATIVES) {
    it(`recognises the instruction "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(true);
    });
  }

  const NOT_IMPERATIVES = [
    // Questions ABOUT re-running — these must keep reaching the answer paths.
    'Do I need to re-run the analysis?',
    'Should we re-run analysis?',
    'Does this need a rerun?',
    'Is this analysis still current?',
    'Is it worth re-running the analysis?',
    // NEGATIVE CONTROL from the brief: a graph edit that happens to contain
    // "again" must not trip the re-run route.
    'Set the marketing budget to 200 again.',
    'Add a new risk factor again.',
    'Change the demand factor to 0.5 again.',
    // Ordinary post-analysis coaching questions.
    'What drove this result?',
    'Walk me through the analysis.',
    '',
  ];
  for (const msg of NOT_IMPERATIVES) {
    it(`does NOT treat "${msg}" as a re-run instruction`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }
});
