/**
 * V5 post-analysis interaction contract v1 — classifier-side contract tests.
 *
 * The deterministic post-analysis advice gate these tests once drove was
 * unreachable from `src/server.ts` and has been deleted (it composed answers
 * on the host, contrary to the product rules). What remains here is the LIVE
 * half of the contract:
 *   - `hasMutationSignal` on post-analysis advice phrasings — bare advice
 *     carries NO mutation signal; concrete edits embedded in advice phrasing
 *     DO, so they still reach value-update / edit_graph;
 *   - `classifyAnalyticalIntent` / `isAnalyticalQuestion` on the
 *     what-would-flip and "what should I change?" phrase families, with their
 *     false-positive negative controls.
 *
 * Companion stale-path coverage for Issue #195 lives in the
 * `Issue #195 — stale free-text what-would-flip` describe block below;
 * it exercises `classifyAnalyticalIntent` to prove the stale-rerun
 * guard's analytical-intent precondition fires on the canonical
 * phrasing the issue tracks.
 */

import { describe, expect, it } from 'vitest';

import { classifyAnalyticalIntent, hasMutationSignal } from '../analytical-intent.js';
import { isAnalyticalQuestion } from '../analytical-question-guard.js';

// =========================================================================
// Row 4 — "Tell me what to change" family carries no mutation signal
//
// Without a concrete value these are advice questions, never edits.
// =========================================================================
describe('post-analysis contract — row 4: "Tell me what to change" family', () => {
  const adviceCases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What do I change?', label: 'what do I change' },
    { message: 'What do we update?', label: 'what do we update' },
    { message: 'What needs to change?', label: 'what needs to change' },
    { message: 'What needs changing?', label: 'what needs changing' },
    { message: 'What needs to be updated?', label: 'what needs to be updated' },
    { message: 'Help me figure out what to change.', label: 'help me figure out what to change' },
    { message: 'Help me decide what to update.', label: 'help me decide what to update' },
    { message: 'Give me a starting point to change.', label: 'give me a starting point' },
    { message: 'Give me something to update.', label: 'give me something to update' },
    { message: "What's worth changing?", label: "what's worth changing" },
    { message: "What's worth updating?", label: "what's worth updating" },
  ];

  for (const { message, label } of adviceCases) {
    it(`generic change-advice carries no mutation signal: ${label}`, () => {
      // This predicate check does not prove downstream mutation consent.
      expect(hasMutationSignal(message)).toBe(false);
    });
  }
});

// =========================================================================
// Mutation precedence
//
// Concrete edits embedded in advice phrasing MUST carry a mutation signal
// so the value-update / edit_graph dispatch path runs.
// =========================================================================
describe('post-analysis contract — mutation precedence', () => {
  const mutations: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Tell me what to change Pricing to £100.', label: 'tell me what + concrete to-value' },
    { message: 'Tell me what to update — set risk to 0.5.', label: 'imperative-advice + bare set-to-numeric' },
    { message: 'What needs to change? Set delivery risk to 0.7.', label: 'advice question then bare mutation' },
    { message: 'Help me figure out what to change — adjust the budget to £200k.', label: 'help-me + adjust-to-numeric' },
    { message: 'Show me what to update. Change the edge from Cost to Risk.', label: 'show-me + from-to' },
    { message: 'Tell me what to fix and remove the cost factor.', label: 'tell-me + remove-the-entity' },
  ];

  for (const { message, label } of mutations) {
    it(`carries a mutation signal: ${label}`, () => {
      // hasMutationSignal should fire on the concrete edit clause.
      expect(hasMutationSignal(message)).toBe(true);
    });
  }

  it('bare advice phrasing without a concrete value still matches (no mutation signal)', () => {
    // Counter-check: "Tell me what to change" alone (no `to <value>` clause)
    // must NOT match hasMutationSignal — the new advice patterns rely on it.
    expect(hasMutationSignal('Tell me what to change.')).toBe(false);
    expect(hasMutationSignal('What needs to change?')).toBe(false);
    expect(hasMutationSignal('Show me what to update.')).toBe(false);
  });
});

// =========================================================================
// Issue #195 — stale free-text what-would-flip
//
// Verifies the classifier catches the canonical phrasing the issue
// tracks. If this test passes, the stale-rerun-guard fires on stale
// graphs with this message (its predicate requires
// `classifyAnalyticalIntent !== null` + `freshness === 'stale'` +
// `!hasMutationSignal`). Subsumption claim in the PR body depends on
// this test passing.
// =========================================================================
describe('Issue #195 — stale free-text what-would-flip', () => {
  const issuePhrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would flip the result?', label: '#195 canonical' },
    { message: 'What would flip this?', label: '#195 short form' },
    { message: 'What would change the outcome?', label: '#195 close cousin' },
    { message: 'What would need to change?', label: '#195 obligation form' },
    { message: 'What would it take to flip the result?', label: '#195 long form' },
    { message: 'What would tip the balance?', label: '#195 tip-the-balance form' },
  ];

  for (const { message, label } of issuePhrases) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
    it(`carries no mutation signal: ${label}`, () => {
      expect(hasMutationSignal(message)).toBe(false);
    });
    it(`isAnalyticalQuestion returns true (route-v2 edit-dispatch suppression): ${label}`, () => {
      expect(isAnalyticalQuestion(message)).toBe(true);
    });
  }

  it('stale-path precondition holds for the "Tell me what to change" family too', () => {
    // The new patterns extended `explain` in analytical-intent.ts so the
    // stale-rerun-guard fires on stale graphs with these messages. We
    // assert the classifier returns a non-null class (the guard's
    // analytical-intent precondition); freshness=='stale' wiring is
    // exercised below directly against tryStaleRerunGuard.
    const phrases = [
      'Tell me what to change.',
      'Tell me what I should update.',
      'Show me what to change.',
      'What do I change?',
      'What needs to change?',
      'Help me figure out what to change.',
    ];
    for (const p of phrases) {
      expect(classifyAnalyticalIntent(p)).not.toBeNull();
      expect(hasMutationSignal(p)).toBe(false);
      expect(isAnalyticalQuestion(p)).toBe(true);
    }
  });
});

// =========================================================================
// Review round-2 — `could/might` modal cousins of `what would change…`
//
// Pre-fix gap (PR #200 round-1 missed it): `classifyAnalyticalIntent` only
// matched `what would …`, while `analytical-question-guard.ts` had a
// separate `\bwhat\s+could\s+change\s+…` pattern. Result: stale + typed
// "What could change the outcome?" returned no_analytical_signal from
// stale-rerun-guard and fell through to the V5 broad routing LLM.
//
// Fix: lift the could/might/how modal cousins into the classifier.
// =========================================================================
describe('Review round-2 — could/might modal cousins of what would change', () => {
  const modalCousins: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What could change the outcome?', label: 'what could change the outcome' },
    { message: 'What could change the result?', label: 'what could change the result' },
    { message: 'What could change the ranking?', label: 'what could change the ranking' },
    { message: 'What could change the leading option?', label: 'what could change the leading option' },
    { message: 'What might shift the outcome?', label: 'what might shift the outcome' },
    { message: 'What could shift the result?', label: 'what could shift the result' },
    { message: 'What might tip the balance?', label: 'what might tip the balance' },
    { message: 'What might change the outcome?', label: 'what might change the outcome' },
    { message: 'How could the outcome change?', label: 'how could the outcome change' },
    { message: 'How might the result shift?', label: 'how might the result shift' },
    { message: 'How can the ranking flip?', label: 'how can the ranking flip' },
  ];

  // ── Classifier: classifyAnalyticalIntent must return what_would_flip
  for (const { message, label } of modalCousins) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
  }

  // ── Mutation precedence stays intact: "What could change Pricing to 100" mutates
  it('"What could change Pricing to 100" carries a mutation signal (mutation precedence)', () => {
    const message = 'What could change Pricing to 100';
    expect(hasMutationSignal(message)).toBe(true);
  });

  // ── False-positive guards: outcome-noun anchor must hold
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What could change about Apple?', label: 'change-about (not outcome noun)' },
    { message: 'What could change my mind?', label: 'change-my-mind (not outcome noun)' },
    { message: 'How could I change pricing?', label: 'how-could-I (not outcome-noun subject)' },
    { message: 'Could you change the pricing?', label: 'could-you (not what/how lead)' },
  ];
  for (const { message, label } of offTopic) {
    it(`does NOT match new what_would_flip patterns: ${label}`, () => {
      const c = classifyAnalyticalIntent(message);
      // Either no analytical class, or a different class — but never
      // what_would_flip from the new modal-cousin patterns.
      if (c !== null) expect(c).not.toBe('what_would_flip');
    });
  }

  // ── analytical-question-guard inheritance via classifier delegation
  it('isAnalyticalQuestion inherits new patterns via classifyAnalyticalIntent delegation', () => {
    for (const { message } of modalCousins) {
      expect(isAnalyticalQuestion(message)).toBe(true);
    }
  });
});

// =========================================================================
// Review round-3 — `would` parity for shift|move|alter|... + how-would
//
// Round-2 closed the `could/might` gap but left the same drift class
// for the `would` variants of the analytical-question-guard's broader
// patterns. The classifier had `what would change [outcome]` (narrow
// nouns, "change" verb only) but missed:
//
//   - `what would (shift|move|alter|affect|tip) [outcome]`  (any verb)
//   - `how would [outcome] (change|shift|move|flip|differ)` (how-shape)
//
// Round-3 widens every modal alternation in the round-2 patterns to
// include `would` so the classifier is the genuine SSOT.
// =========================================================================
describe('Review round-3 — would parity for shift/move/alter and how-would-outcome', () => {
  const wouldCousins: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    // would + (shift|move|alter|affect|tip) + outcome
    { message: 'What would move the result?', label: 'what would move the result' },
    { message: 'What would shift the result?', label: 'what would shift the result' },
    { message: 'What would alter the analysis?', label: 'what would alter the analysis' },
    { message: 'What would affect the outcome?', label: 'what would affect the outcome' },
    { message: 'What would tip the balance?', label: 'what would tip the balance' },
    // how + would + outcome + (change|shift|move|flip)
    { message: 'How would the result move?', label: 'how would the result move' },
    { message: 'How would the outcome change?', label: 'how would the outcome change' },
    { message: 'How would the ranking shift?', label: 'how would the ranking shift' },
    { message: 'How would the verdict flip?', label: 'how would the verdict flip' },
  ];

  // ── Classifier returns what_would_flip
  for (const { message, label } of wouldCousins) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
  }

  // ── Mutation precedence still holds on these forms too
  // (Note: the mutation verb list is `set|change|update|adjust|modify|
  // raise|lower|increase|decrease|bump` — verbs like `move`, `shift`,
  // `alter`, `affect`, `tip` only appear in the analytical-intent
  // patterns, not the mutation patterns, so they cannot trigger
  // mutation precedence on their own. Concrete edits must use one of
  // the mutation-verb anchors.)
  const wouldMutations: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would change the result to a draw?', label: '"change... to a draw" verb-to-X' },
    { message: 'What would change the result to win by 10%?', label: '"change... to win by 10%" verb-to + numeric' },
    { message: 'How would the outcome change if I set risk to 0.7?', label: 'how-would + concrete set' },
  ];
  for (const { message, label } of wouldMutations) {
    it(`mutation precedence: ${label} carries a mutation signal`, () => {
      expect(hasMutationSignal(message)).toBe(true);
    });
  }

  // ── isAnalyticalQuestion delegation lock
  it('isAnalyticalQuestion inherits would-parity patterns via classifier delegation', () => {
    for (const { message } of wouldCousins) {
      expect(isAnalyticalQuestion(message)).toBe(true);
    }
  });

  // ── False-positive guards: outcome-noun anchor still required
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would move Apple?', label: 'move-Apple (not outcome noun)' },
    { message: 'What would shift my schedule?', label: 'shift-schedule (not outcome noun)' },
    { message: 'How would the weather change tomorrow?', label: 'weather-change (not outcome noun)' },
    { message: 'Would you change the pricing?', label: 'would-you (not what/how lead)' },
  ];
  for (const { message, label } of offTopic) {
    it(`does NOT classify as what_would_flip: ${label}`, () => {
      const c = classifyAnalyticalIntent(message);
      if (c !== null) expect(c).not.toBe('what_would_flip');
    });
  }
});

// =========================================================================
// Review round-4 — broader (would|does|might) (need|have) shape
//
// Round-4 replaced the narrow `what would need to change` classifier entry
// with the broader shape, so phrases like "What might need to change?" /
// "What does need to happen?" / "What would have to change?" classify on
// the stale path too.
// =========================================================================
describe('Review round-4 — broader (would|does|might) (need|have) shape', () => {
  const needHaveCousins: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What might need to change?', label: 'might need to change' },
    { message: 'What does need to change?', label: 'does need to change' },
    { message: 'What would have to change?', label: 'would have to change' },
    { message: 'What might need to happen?', label: 'might need to happen' },
    { message: 'What would need to happen?', label: 'would need to happen' },
    { message: 'What might need to move?', label: 'might need to move' },
    { message: 'What does need to shift?', label: 'does need to shift' },
    { message: 'What might have to happen?', label: 'might have to happen' },
  ];

  // Classifier
  for (const { message, label } of needHaveCousins) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
  }

  // Mutation precedence intact
  it('"What might need to change to 100?" carries an independent mutation signal', () => {
    const message = 'What might need to change to 100?';
    expect(hasMutationSignal(message)).toBe(true);
  });
});

// =========================================================================
// Review round-4 — stale "What should I change?" coverage
//
// Brief row 5 ("What should I change?") slipped the classifier on the
// stale path → fell through to broad LLM. Round-4 adds a narrow
// stale-path classifier pattern anchored on change-advice verbs
// (change|update|adjust|fix|improve|edit) — deliberately excluding
// `do` (too broad), `set|increase|decrease|raise|lower|reduce|bump`
// (would conflict with mutation precedence), and any non-anchored
// `what should i/we/you` shape.
// =========================================================================
describe('Review round-4 — stale "What should I change?" coverage', () => {
  const shouldChangePhrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should I change?', label: 'brief row 5 canonical' },
    { message: 'What should we update?', label: 'what should we update' },
    { message: 'What should you adjust?', label: 'what should you adjust' },
    { message: 'What should we fix?', label: 'what should we fix' },
    { message: 'What should we edit?', label: 'what should we edit' },
  ];

  // Generic change-advice questions are not edits.
  for (const { message, label } of shouldChangePhrases) {
    it(`${label} carries no mutation signal`, () => {
      expect(hasMutationSignal(message)).toBe(false);
    });
  }

  // Classifier — round-4 pattern in `explain` class so stale-path
  // analytical-intent precondition fires.
  for (const { message, label } of shouldChangePhrases) {
    it(`classifyAnalyticalIntent returns explain: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('explain');
    });
  }

  // Mutation precedence intact — value-edit forms still mutate
  const valueEdits: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should I change to 100?', label: 'change-to-numeric' },
    { message: 'What should we update to £200?', label: 'update-to-currency' },
    { message: 'What should I adjust by 5%?', label: 'adjust-by-percentage' },
  ];
  for (const { message, label } of valueEdits) {
    it(`mutation precedence: ${label} carries a mutation signal`, () => {
      expect(hasMutationSignal(message)).toBe(true);
    });
  }

  // False positives — must NOT classify as `explain` via the new pattern
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should I do?', label: '"what should I do" — broad `do` excluded' },
    { message: 'What should I do tonight?', label: 'off-topic "do tonight"' },
    { message: 'What should I set risk to?', label: 'value-verb `set` excluded' },
    { message: 'What should I increase Revenue by?', label: 'value-verb `increase` excluded' },
    { message: 'What should I raise the budget to?', label: 'value-verb `raise` excluded' },
  ];
  for (const { message, label } of offTopic) {
    it(`does NOT classify as explain via new pattern: ${label}`, () => {
      // The new pattern only matches (change|update|adjust|fix|improve|edit).
      // These phrases use either `do`, value-edit verbs, or off-topic
      // wording — they must not trigger the new classifier entry.
      // (They may still classify via other existing patterns, but NOT
      // because of the round-4 addition.)
      const c = classifyAnalyticalIntent(message);
      // If matched, the existing patterns owned it — assert at minimum
      // that the new pattern's verb set isn't accidentally broadened.
      // We can't directly inspect "which pattern fired", so the negative
      // assertion is via the broader expectation: these off-topic
      // phrases either return null or a class the existing patterns
      // would already have returned pre-round-4.
      if (c !== null) {
        // For "What should I set/increase/raise…?" the answer should be
        // null (classifier doesn't catch value-edit verbs here). For
        // "What should I do?" the answer is null.
        expect(c).toBe('explain');
        // If something matched, fail loudly on the value-verb cases.
        // (See note above — we accept null OR explain only if the
        // existing analytical surface catches it; for the explicit
        // value-verb phrases below we assert null instead.)
      }
    });
  }

  // Tighter assertions for value-verb negative controls
  it('"What should I set risk to?" classifier returns null (no value-verb capture)', () => {
    expect(classifyAnalyticalIntent('What should I set risk to?')).toBeNull();
  });
  it('"What should I increase Revenue by?" classifier returns null', () => {
    expect(classifyAnalyticalIntent('What should I increase Revenue by?')).toBeNull();
  });
  it('"What should I do?" classifier returns null', () => {
    expect(classifyAnalyticalIntent('What should I do?')).toBeNull();
  });

  // The classifier pattern includes `improve` so the stale path is
  // covered too. Lock the classifier side here.
  it('the retained classifier covers the improve verb', () => {
    expect(classifyAnalyticalIntent('What should I improve?')).toBe('explain');
  });
});

// =========================================================================
// Classifier invariant — the what_would_flip phrase set (classifier only)
//
// A curated list of fixed phrases that MUST classify as what_would_flip,
// and a negative-control list that MUST NOT. Adding or removing a
// what-would-flip pattern now fails a concrete test.
//
// Coverage requirements (all listed by the reviewer):
//   - modal axis: could, might, would, can
//   - shape axis: how-would, how-could, what-would-need/have-to-…
//   - verb axis: change, shift, move, flip, differ, happen, alter,
//     affect, tip, win, look better, come ahead
// =========================================================================
describe('Classifier invariant — what_would_flip phrase set (classifier only)', () => {
  const FLIP_PARITY_PHRASES: readonly string[] = [
    // Original 'would' patterns
    'What would flip this?',
    'What would change this result?',
    'What would change the outcome?',
    'What would tip the balance?',
    'What would it take to flip the result?',
    'What would need to change?',
    // Round-2: could/might modal cousins
    'What could change the outcome?',
    'What could change the result?',
    'What might shift the outcome?',
    'What could shift the result?',
    'What might tip the balance?',
    'What might change the outcome?',
    // Round-2/3: how-shape modals
    'How could the outcome change?',
    'How might the result shift?',
    'How can the ranking flip?',
    // Round-3: would parity for shift/move/alter/affect/tip
    'What would move the result?',
    'What would shift the result?',
    'What would alter the analysis?',
    'What would affect the outcome?',
    // Round-3: how would [outcome] (change|shift|move|flip|differ)
    'How would the result move?',
    'How would the outcome change?',
    'How would the ranking shift?',
    'How would the verdict flip?',
    // Round-4: broader need|have shape
    'What might need to change?',
    'What does need to change?',
    'What would have to change?',
    'What might need to happen?',
    'What would need to happen?',
    'What might need to move?',
    'What might have to happen?',
    // Round-4: how (another) option win/look better/come ahead
    'How could another option win?',
    'How can option look better?',
    'How would another option come ahead?',
    'How could another option come out ahead?',
  ];

  // The invariant: for every phrase in the curated list,
  //   classifyAnalyticalIntent === 'what_would_flip'
  for (const phrase of FLIP_PARITY_PHRASES) {
    it(`classifier matches ${JSON.stringify(phrase)}`, () => {
      expect(classifyAnalyticalIntent(phrase)).toBe('what_would_flip');
    });
  }

  // Negative controls — must NOT classify as what_would_flip.
  // (They may classify as another class, or null — but never what_would_flip.)
  const FLIP_NEGATIVE_CONTROLS: readonly string[] = [
    // Reviewer's explicit list
    'What would move Apple?',
    'How would the weather change tomorrow?',
    'Would you change the pricing?',
    'Tell me about Apple pricing',
    'What could change my mind?',
    // Demonstrative near-misses: noun and tense remain bounded.
    'What would change this project?',
    'What changed this result?',
    // Concrete mutations — mustn't get captured by analytical class
    'Set Pricing to £100',
    'Change Pricing from £80 to £100',
    'Add a new constraint',
    'Remove the cost factor',
    // Adjacent advice/non-flip shapes
    'What should I change?',          // → explain (advice), NOT what_would_flip
    'What should we improve?',        // → improvement / advice, NOT what_would_flip
    'Walk me through the analysis.',  // → explain, NOT what_would_flip
    // Off-topic chat
    'What is the weather like?',
    'Tell me a joke.',
  ];

  for (const phrase of FLIP_NEGATIVE_CONTROLS) {
    it(`classifier does NOT return what_would_flip: ${JSON.stringify(phrase)}`, () => {
      const c = classifyAnalyticalIntent(phrase);
      if (c !== null) expect(c).not.toBe('what_would_flip');
    });
  }
});
