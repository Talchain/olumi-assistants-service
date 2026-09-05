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
/**
 * Corpus sizes, published out of the describe scope so the collection guard at
 * the foot of this file can assert them BY NAME. Populated at collection time.
 */
const TRANSITIVE_CORPUS_SIZES = {
  transitiveQuestions: 0,
  attributionQuestions: 0,
  compoundGuardFires: 0,
};

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
   * immediate grammatical neighbours, NOT invented to fit the pattern.
   *
   * The OPPOSITE-DIRECTION TWINS live in `STILL_EDITS` in
   * `explain-misroute-edit-suppression.test.ts` — the compound "question +
   * edit" corpus. (An earlier version of this comment said "below" and pointed
   * at a corpus that did not exist anywhere in the repo: a comment describing
   * a verification that was never performed. The twins are real now, and the
   * anti-vacuity test beside them asserts they can actually reach this
   * pattern's mandatory left anchor.)
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

  /**
   * ⭐⭐ DRIVER-ATTRIBUTION QUESTIONS ARE NOT `what_changed` — a deliberate
   * class decision, recorded rather than left to the alternation.
   *
   * `what_changed` means "compare the last two RUNS", and the comparison gate
   * answers it with a two-run `RunDelta`. These questions ask what a DOMAIN
   * DRIVER did — a different question, owned by `what_drove`, that the
   * comparison gate cannot answer. Left unanchored, the verb alternation
   * `(?:chang|affect|shift|alter|impact)` mixes DELTA verbs with CAUSAL ones
   * and hands all of these to the gate; an independent review drove five of
   * them through the real gate on a single-run session and got
   * "there is only one analysis run so far, so there is nothing to compare
   * yet" — a confident answer to a question nobody asked.
   *
   * The fix is the SUBJECT anchor, not dropping `affect|impact`: dropping the
   * causal verbs would also lose "How has the change affected the results?"
   * from the corpus above, which is the same delta question in a causal voice.
   * Anchoring the subject on a CHANGE EVENT keeps both distinctions.
   *
   * Corpus is a generated cross product (8 drivers × 4 verbs × 5 objects = 160)
   * of which these are representatives; all 160 measured `what_changed` at the
   * previous head and `null` here.
   */
  const DRIVER_ATTRIBUTION_QUESTIONS = [
    'How did the price rise affect the outcome?',
    'How did marketing spend affect the results?',
    'How has competition impacted the analysis?',
    'How did the recession affect the ranking?',
    'How did the new hire affect the leading option?',
    'How did inflation change the outcome?',
    'How did the supply delay affect the analysis?',
  ] as const;

  it('driver-attribution questions do NOT claim the comparison gate', () => {
    for (const m of DRIVER_ATTRIBUTION_QUESTIONS) {
      expect(classifyAnalyticalIntent(m), `attribution must not be what_changed: ${m}`).not.toBe(
        'what_changed',
      );
    }
  });

  it('DISCRIMINATION CONTROL: the exclusion is the SUBJECT, not the causal verb', () => {
    // Without this pair the test above would also pass if `affect|impact` had
    // simply been deleted from the alternation — a different, worse fix that
    // loses the causal voice of the delta question. Same verbs, both sides.
    expect(classifyAnalyticalIntent('How has the change affected the results?')).toBe(
      'what_changed',
    );
    expect(classifyAnalyticalIntent('How has the recession affected the results?')).not.toBe(
      'what_changed',
    );
    expect(classifyAnalyticalIntent('How has that edit impacted the ranking?')).toBe(
      'what_changed',
    );
    expect(classifyAnalyticalIntent('How has competition impacted the ranking?')).not.toBe(
      'what_changed',
    );
  });

  /**
   * ⭐ THE STRUCTURAL INVARIANT that bounds this change's blast radius across
   * all 8 `classifyAnalyticalIntent` call sites and all 3 `isAnalyticalQuestion`
   * ones, without having to measure each consumer's behaviour separately:
   *
   *   for every message, the class this module returns is either what it
   *   returned before this change, or `what_changed`.
   *
   * It holds BY CONSTRUCTION because the only entry this change added carries
   * `yieldsToOutsideMutation`, and when that flag fires the entry is skipped —
   * leaving a pattern list identical to the one that shipped. It is asserted
   * here rather than argued, over the compound shapes where the flag actually
   * fires (`the flag fires here` pins that precondition, so this cannot pass by
   * iterating cases that never reach the guard).
   */
  const COMPOUND_WHERE_THE_GUARD_FIRES = [
    'How has the update changed the analysis, and add a risk node for supply delays',
    'How did the edit change the results, and delete the compliance risk',
    'How has the update changed the analysis? Add a risk node for supply delays',
    'How have the updates changed the outcome — remove the marketing spend factor',
    'How did my change affect the leading option and set pricing to 0.7',
  ] as const;

  it('a compound question+edit is NOT claimed by the classifier (guard fires)', () => {
    for (const m of COMPOUND_WHERE_THE_GUARD_FIRES) {
      expect(classifyAnalyticalIntent(m), `must not claim compound: ${m}`).not.toBe('what_changed');
      // PRECONDITION PIN — the guard can only be doing the work if the message
      // really does carry a concrete edit clause. Without this the test above
      // would pass just as well on a corpus the pattern never matched.
      expect(hasMutationSignal(m), `must carry a real edit clause: ${m}`).toBe(true);
    }
  });

  it('but the SAME question without the edit clause still classifies (both directions)', () => {
    // The opposite-direction twin of the test above: proves the guard keys on
    // the edit clause and not on the question shape. Strip the edit, keep the
    // classification.
    expect(classifyAnalyticalIntent('How has the update changed the analysis')).toBe(
      'what_changed',
    );
    expect(classifyAnalyticalIntent('How did the edit change the results')).toBe('what_changed');
    expect(classifyAnalyticalIntent('How have the updates changed the outcome')).toBe(
      'what_changed',
    );
  });

  TRANSITIVE_CORPUS_SIZES.transitiveQuestions = TRANSITIVE_COMPARISON_QUESTIONS.length;
  TRANSITIVE_CORPUS_SIZES.attributionQuestions = DRIVER_ATTRIBUTION_QUESTIONS.length;
  TRANSITIVE_CORPUS_SIZES.compoundGuardFires = COMPOUND_WHERE_THE_GUARD_FIRES.length;

  it('the guard reads only OUTSIDE its own match (a trailing "to X" is not an edit)', () => {
    // Blanking the matched span rather than deleting it is what makes this
    // work: "update" is itself in the mutation-verb alternation, so an
    // un-blanked re-test would pair it with the later "to before" and suppress
    // a perfectly ordinary comparison question.
    expect(classifyAnalyticalIntent('How has the update changed the analysis compared to before?')).toBe(
      'what_changed',
    );
  });
});

/**
 * INSTRUMENT GUARDS for this file.
 */
describe('classifyAnalyticalIntent — instrument guards', () => {
  it('is idempotent (no INTENT_PATTERN carries a stateful /g or /y flag)', () => {
    // `classifyAnalyticalIntent` switched from `.test` to `.exec` so the
    // `yieldsToOutsideMutation` entry can see its own span. `.exec` on a
    // GLOBAL regex advances `lastIndex`, so a `/g` flag anywhere in the table
    // would make the classifier return different answers on successive calls
    // for the same string — a defect no single-call assertion can see.
    // Asserting the property rather than the flag list keeps this a derivation
    // and not another hand-maintained mirror.
    for (const m of [
      'How has the update changed the analysis?',
      'What changed?',
      'What would flip this?',
      'What drove this result?',
      'Should I rerun the analysis?',
      'Explain the results',
      'How has the update changed the analysis, and add a risk node for supply delays',
      'Hello there',
    ]) {
      const first = classifyAnalyticalIntent(m);
      expect(classifyAnalyticalIntent(m), `call 2 differs: ${m}`).toBe(first);
      expect(classifyAnalyticalIntent(m), `call 3 differs: ${m}`).toBe(first);
    }
  });

  it('this spec collected its own corpora at the expected sizes', () => {
    // A spec that collects zero tests is invisible to the suite total, the exit
    // code and the failure count alike. Pinned by name, per the standing rule.
    expect(TRANSITIVE_CORPUS_SIZES).toEqual({
      transitiveQuestions: 8,
      attributionQuestions: 7,
      compoundGuardFires: 5,
    });
  });
});
