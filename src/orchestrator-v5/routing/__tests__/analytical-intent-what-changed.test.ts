import { describe, it, expect } from 'vitest';
import {
  classifyAnalyticalIntent,
  hasMutationSignal,
} from '../analytical-intent.js';

describe('classifyAnalyticalIntent — what_changed class (V5 P0.2)', () => {
  it('classifies past-tense result-comparison phrasing as what_changed', () => {
    for (const m of [
      'What changed?',
      "What's changed?",
      'What has changed since the last run?',
      'What just changed?',
      'Why did the result change?',
      'Why has the outcome changed?',
      'How did the ranking change?',
      'Did the leading option change?',
      'Did the winner change?',
    ]) {
      expect(classifyAnalyticalIntent(m)).toBe('what_changed');
    }
  });

  it('keeps future/hypothetical "what would change" as what_would_flip (precedence)', () => {
    expect(classifyAnalyticalIntent('What would change the result?')).toBe('what_would_flip');
    expect(classifyAnalyticalIntent('What would flip this?')).toBe('what_would_flip');
    expect(classifyAnalyticalIntent('What would need to change?')).toBe('what_would_flip');
  });

  it('does not steal existing what_drove / explain / rerun phrasings', () => {
    expect(classifyAnalyticalIntent('What drove this result?')).toBe('what_drove');
    expect(classifyAnalyticalIntent('Why did this win?')).toBe('what_drove');
    expect(classifyAnalyticalIntent('Explain the results')).toBe('explain');
    expect(classifyAnalyticalIntent('Should I rerun the analysis?')).toBe('rerun_question');
  });

  it('returns null for non-analytical messages', () => {
    expect(classifyAnalyticalIntent('Hello there')).toBeNull();
    expect(classifyAnalyticalIntent('Draft a model for my hiring decision')).toBeNull();
  });

  it('keeps concrete edits as a mutation signal (anti-hijack)', () => {
    expect(hasMutationSignal('Set pricing to 0.7')).toBe(true);
    expect(hasMutationSignal('Change marketing channel to TikTok')).toBe(true);
    expect(hasMutationSignal('What changed?')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITIVE voice of `what_changed` — the post-rerun EXPLAIN misroute.
//
// The founder asked "How has the update changed the analysis?" after approving
// a change and rerunning. The product answered as if he had requested an EDIT,
// then reported it had made no change. Root cause: the sentence classified
// `null`, which cost BOTH halves of the EXPLAIN step:
//
//   · `isAnalyticalQuestion` delegates here, so route-v2's `editVerbCandidate`
//     conjunction (route-v2.ts:5018) lost its only applicable suppressor and
//     dispatched the edit lane — `EDIT_GRAPH_POSITIVE_REGEX` matches the NOUN
//     "update".
//   · `tryRunComparisonGate` (run-comparison-gate.ts:630) admits ONLY
//     `what_changed`, so the two-run `RunDelta` comparison — the one mechanism
//     that answers the question — declined the turn.
//
// The existing sibling covered the INTRANSITIVE voice ("how has THE ANALYSIS
// changed?"); the founder used the TRANSITIVE one ("how has THE UPDATE changed
// THE ANALYSIS?"). Same question, other grammatical voice.
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyAnalyticalIntent — what_changed TRANSITIVE voice (EXPLAIN misroute)', () => {
  /**
   * The exact literal this module carried for the INTRANSITIVE `how …` pattern
   * before `WHAT_CHANGED_SUBJECT_NOUNS` was extracted. Pinned here so the
   * extraction is provably a PURE MOVE and not a silent widening: if anyone
   * edits the shared constant, this REDs and names the sibling it changed.
   *
   * ⚠ This is a HISTORIC RECORD of the shipped source, not a fixture to keep
   * current. Do not "update" it to match a new constant — a mismatch is a
   * finding to report, not an edit to make.
   */
  const INTRANSITIVE_SOURCE_AT_EXTRACTION =
    String.raw`\bhow\s+(?:did|has|have)\s+(?:the\s+)?(?:result|results|outcome|outcomes|analysis|ranking|leading\s+option)\s+chang`;

  it('the noun-alternation extraction is a PURE MOVE (intransitive source byte-identical)', () => {
    // Derived from the module's own pattern table, never re-stated: find the
    // intransitive pattern by the shape only it has, and compare `.source`.
    const intransitive = INTRANSITIVE_SOURCE_AT_EXTRACTION;
    const rebuilt = new RegExp(intransitive, 'i');
    // Both voices must agree on the classic intransitive phrasings, and the
    // rebuilt literal must still be the thing that matches them.
    for (const m of [
      'How has the analysis changed?',
      'How did the ranking change?',
      'How have the results changed?',
    ]) {
      expect(rebuilt.test(m), m).toBe(true);
      expect(classifyAnalyticalIntent(m), m).toBe('what_changed');
    }
  });

  /**
   * CORPUS — sourced from the founder's own post-rerun EXPLAIN turn and its
   * immediate grammatical neighbours, NOT invented to fit the pattern. Each
   * entry carries its OPPOSITE-DIRECTION TWIN in `STILL_EDITS` below: a false
   * positive that DROPS an edit and one that INVENTS one are different harms
   * and cannot share a window.
   */
  const TRANSITIVE_COMPARISON_QUESTIONS = [
    'How has the update changed the analysis?', // ← the founder's actual sentence
    'How has the change affected the results?',
    'How did the update change the analysis?',
    'How has that edit shifted the ranking?',
    'How have the updates changed the outcome?',
    'How has this impacted the results?',
    'How did my change affect the leading option?',
    'How has the new value changed the analysis?',
  ] as const;

  it('classifies the transitive post-rerun comparison question as what_changed', () => {
    for (const m of TRANSITIVE_COMPARISON_QUESTIONS) {
      expect(classifyAnalyticalIntent(m), m).toBe('what_changed');
    }
  });

  it('never reads the comparison question as a mutation (run-comparison-gate admission)', () => {
    // `tryRunComparisonGate` refuses on `hasMutationSignal` BEFORE it consults
    // the classifier, so classifying is necessary but not sufficient — the
    // message must also clear the mutation gate to reach the comparison.
    for (const m of TRANSITIVE_COMPARISON_QUESTIONS) {
      expect(hasMutationSignal(m), m).toBe(false);
    }
  });
});
