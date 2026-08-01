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

  // ⚠ ADDED AFTER REVIEW OF #779. The first version of this fix required the
  // SUBJECT NOUN whenever the terminal was `valid|fresh|current`, which also
  // killed the subject-LESS form — the most idiomatic staleness phrasing there
  // is. All six measured as `null` (they were `rerun_question` on base), and
  // `cls === null` makes BOTH `tryStaleRerunGuard` and `tryNoAnalysisGuard`
  // decline, so on a stale analysis the canonical question lost its
  // deterministic stale answer AND its re-run chip. The original 7 controls all
  // carried a subject noun or an unambiguous staleness word, so this shape was
  // untested in BOTH directions — the diagnosis shared the blind spot.
  const SUBJECT_LESS_STALENESS = [
    'Is this still current?',
    'Is this still valid?',
    'Are these still valid?',
    'Are these still current?',
    'Is that still valid?',
    'Is this still fresh?',
  ];
  for (const msg of SUBJECT_LESS_STALENESS) {
    it(`classifies the subject-less staleness form "${msg}"`, () => {
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


// ---------------------------------------------------------------------------
// ⚠ #779 REVIEW BLOCKER — the imperative recogniser was `\brerun\b` in disguise.
//
// `IMPERATIVE_RERUN_PATTERNS[0]` shipped with its object group OPTIONAL, making
// it equivalent to a bare token match. Because the pre-route sits AHEAD of every
// guard and ahead of the router, ten ordinary sentences dispatched a REAL
// `run_analysis` — PLoT→ISL compute, a new fact, a new `graph_hash_at_run`, and
// the user's existing result REPLACED. Measured in the integration harness:
// `handler_invocations=1 · preroute=["routed"] · llm_called=0` on all ten.
//
// Four of them are the user explicitly REFUSING. The PR's own thesis inverted:
// it set out to stop recognition being punished by a canned string, and instead
// punished recognition with an unrequested execution — deterministically, where
// the defect it replaced was intermittent.
//
// Two independent repairs, BOTH required:
//   1. the object group is now REQUIRED (clears the six question/reference
//      shapes, which carry no object);
//   2. a NEGATION VETO ahead of the imperative patterns — necessary on its own,
//      because "Do not re-run THE ANALYSIS" carries a valid object and survives
//      repair 1 untouched.
// ---------------------------------------------------------------------------
describe('looksLikeImperativeRerun — #779 review blocker corpus', () => {
  const EXPLICIT_REFUSALS = [
    'Do not re-run the analysis.',
    "Don't re-run it.",
    'Never re-run this automatically.',
    'I do not want to re-run anything.',
  ];
  for (const msg of EXPLICIT_REFUSALS) {
    it(`NEVER executes on an explicit refusal: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  const QUESTIONS_ABOUT_A_PAST_RUN = [
    // Canonical `what_changed` question the run-comparison gate exists to
    // serve — the pre-route was stealing it and destroying the comparison.
    'What changed in the re-run?',
    'Why did the rerun give a different answer?',
    'Show me the re-run results.',
    'How long did the rerun take?',
    'Explain the rerun to me.',
    'Was the rerun better?',
  ];
  for (const msg of QUESTIONS_ABOUT_A_PAST_RUN) {
    it(`NEVER executes on a question ABOUT a past run: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // ⚠ SECOND REVIEW PASS — the object-group repair closed the measured CORPUS,
  // not the CLASS. It required an object but never required `re-?run` to be in
  // VERB position, so the ATTRIBUTIVE-MODIFIER reading survived: "the re-run
  // analysis" is determiner + modifier + noun, and "analysis" is itself in the
  // object list — the pattern matched on the very words proving it is not an
  // instruction. All five measured at PATH level with real dispatch
  // (`invocations=1`) before the leading lookbehind existed, and all five are
  // NEW relative to `staging` (this pre-route does not exist there).
  //
  // The lesson worth keeping: closing every sentence a reviewer hands you is
  // not the same as closing the class they came from. The first repair passed
  // its own corpus completely and left a live path.
  const ATTRIBUTIVE_MODIFIER_NOT_A_VERB = [
    'What did the re-run analysis show?',
    'Tell me about the rerun model.',
    'Summarise the re-run analysis for me.',
    'Was the re-run analysis different?',
    'The rerun scenario looked odd, why?',
  ];
  for (const msg of ATTRIBUTIVE_MODIFIER_NOT_A_VERB) {
    it(`NEVER executes when "re-run" is an ADJECTIVE, not a verb: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // ⚠ THIRD REVIEW PASS — the blocklist was replaced by a VERB-POSITION
  // ALLOWLIST. Round 3 required an object and added a lookbehind blocklist of
  // nine tokens; TWENTY of the twenty-one ordinary sentences below walked
  // through it at path level with real dispatch (`inv=1, routed=true`). The
  // twenty-first — "Look at these re-run analyses." — was already blocked
  // there, but only because `these` happened to be one of the nine listed
  // tokens: coverage by accident, which is the argument against the blocklist
  // rather than a point in its favour. A blocklist of "things that
  // could precede a noun" is a hand-maintained mirror of ENGLISH (trap 12) and
  // it drifted at birth — `your/our/my/his/her` were absent, and `my`/`our`
  // appear in that same regex's own object group.
  //
  // These twenty-one are pinned against the INVERTED form. The property that
  // makes the inversion right is not that this list is longer: it is that an
  // unrecognised left context now DECLINES instead of EXECUTING.
  const NOMINAL_NOT_A_VERB = [
    // possessives the blocklist omitted — the first blocked sentence of round 3
    // with a single word changed
    'What did your re-run analysis show?',
    'What did our re-run analysis show?',
    'What did my re-run analysis show?',
    'What did his re-run analysis show?',
    'What did her re-run analysis show?',
    // possessive-'s
    "Paul's rerun analysis looked wrong.",
    // determiner + ADJECTIVE (the blocklist matched only determiner + token)
    'The failed re-run analysis was misleading.',
    'The last re-run analysis was better.',
    'Review the previous re-run analysis.',
    // determiner + TWO spaces — the blocklist's `\s` matches exactly one char
    'In the  re-run analysis, capacity was higher.',
    // determiners and quantifiers absent from the blocklist
    'Which re-run analysis was better?',
    'Every re-run analysis told the same story.',
    'Each re-run analysis differed slightly.',
    'Some re-run analysis must have failed.',
    'Any re-run analysis would show this.',
    'Both re-run analyses agreed.',
    'Compare the two re-run analyses.',
    'Look at these re-run analyses.',
    // BARE PLURAL at sentence start — the one shape a left-context allowlist
    // cannot reach, since its left context legitimately IS string-start. Closed
    // structurally instead: a plural object requires a determiner.
    'Rerun analyses showed a different leader.',
    // possessive inside a prepositional phrase
    'In your re-run analysis, capacity was higher.',
    'Our rerun model was stale.',
  ];
  for (const msg of NOMINAL_NOT_A_VERB) {
    it(`NEVER executes on a NOMINAL use: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // ⚠ FOURTH REVIEW PASS — the structural rule was ONE INFLECTION too narrow,
  // and the pin that introduced it CONTRADICTED ITSELF: it required a
  // determiner for the PLURAL ("Rerun analyses showed a different leader." →
  // declined, pinned above) while the SINGULAR — one letter different — still
  // EXECUTED at path level. My own stated rationale ("Re-run the analyses" is
  // an instruction, "Rerun analyses" is a heading) applies verbatim to the
  // singular; I simply did not carry it across.
  //
  // Every sentence below has a LICENSED left context — sentence start, a comma,
  // `and`, `now` — and a bare noun after it. That is precisely the gap a
  // left-context allowlist cannot see, and it is why the object rule and the
  // position rule are BOTH needed: neither one alone closes the class.
  //
  // Remedy: every bare NOUN object now requires a determiner; only PRONOUN
  // objects ("Re-run it." / "Re-run this.") may stand alone, because those have
  // no nominal reading to be confused with. A strict TIGHTENING, so every
  // must-decline pin above stays green by construction.
  const BARE_NOUN_NOMINALS = [
    'Rerun analysis showed a different leader.',
    'Rerun model was stale.',
    'Rerun scenario was slower.',
    'Results were mixed. Rerun analysis disagreed.',
    'As noted, rerun analysis was inconclusive.',
    'Compared to rerun analysis, capacity was higher.',
    'According to rerun analysis, capacity was higher.',
    'Right now rerun analysis is queued.',
    'We looked at it; rerun analysis was fine.',
    'Both the baseline and rerun analysis showed the same leader.',
    'The first pass and rerun analysis disagreed.',
    'Please note, rerun analysis is pending.',
    'Now rerun model looks different.',
    'And rerun analysis confirmed it.',
  ];
  for (const msg of BARE_NOUN_NOMINALS) {
    it(`NEVER executes on a bare-noun NOMINAL in a licensed position: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // The exemption that keeps the rule honest: a PRONOUN object is a complete
  // instruction and must still dispatch. If these ever go red the tightening
  // has over-reached.
  for (const msg of ['Re-run it.', 'Re-run this.', 'Re-run that.']) {
    it(`still fires on a PRONOUN object: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(true);
    });
  }

  // ⚠ FIFTH REVIEW PASS — the blocker that split this fix onto its own branch.
  // `VERB_POSITION_LEFT_CONTEXTS` carried a bare `/\bto\s+$/i`, which licensed
  // ANY infinitival `to`. Every subordinate clause and nominalisation under a
  // refusal therefore read as a command, and all eight below EXECUTED a real
  // `run_analysis` at path level — the worst being a user explicitly DECLINING
  // one and losing their computed result for it.
  //
  // The negation veto did not save them: it catches `do not` / `don't` /
  // `never`, not bare `not to`, `no reason to`, `pointless`, `too early`,
  // `forgot to`, `nobody`.
  //
  // ⚠ HISTORY, NOT THE SHIPPED MECHANISM — read this before trusting the
  // paragraph above. These eight were first closed by NARROWING `to` to a
  // matrix-verb allowlist, on the reasoning that deleting `to` was not an
  // option because it carried the polite "I want you to…" forms.
  //
  // That narrowing then opened TWENTY-TWO other shapes (pinned below), and the
  // `to` context was DELETED OUTRIGHT. So these eight are now closed by
  // POSITION — there is no `to` left context at all — not by any judgement
  // about which verb governs the infinitive. The polite forms that argument was
  // protecting are the documented declines further down.
  const INFINITIVE_UNDER_A_NON_DIRECTIVE = [
    'We decided not to re-run the analysis.',
    'There is no reason to re-run the analysis.',
    'It is pointless to re-run the analysis.',
    'I forgot to re-run the analysis.',
    'It is too early to re-run the analysis.',
    'Whether to re-run the analysis is unclear.',
    'The decision to re-run the analysis was wrong.',
    // The one the (since-deleted) matrix-verb allowlist could not reach —
    // `wants to` is genuinely instruction-shaped, so the refusal lives in the
    // SUBJECT. Closed via the negation veto, which is where refusal belongs,
    // and that veto entry outlived the allowlist deliberately.
    'Nobody wants to re-run the analysis.',
  ];
  for (const msg of INFINITIVE_UNDER_A_NON_DIRECTIVE) {
    it(`NEVER executes on an infinitive under a NON-directive verb: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // ⚠ SIXTH REVIEW PASS — THE `to` ENTRY IS GONE, AND THESE SEVEN ARE THE
  // MEASURED, ACCEPTED COST. They were pinned as must-FIRE one round ago, under
  // the matrix-verb allowlist. That allowlist closed 8 shapes and opened 22 —
  // reported speech, non-first-person questions, `need`/`ask` as NOUNS,
  // conditionals, and six explicit REFUSALS including "We didn't want to re-run
  // the analysis." So the entry was deleted outright rather than narrowed a
  // third time.
  //
  // These now fall through to the LLM router, which is EXACTLY what `staging`
  // does today: zero regression against the deployed baseline. Pinned as
  // declines so the cost is visible and so a future `to` entry has to argue
  // with a test rather than slip in.
  //
  // ⚠ IF ONE OF THESE STARTS FIRING, that is a `to` entry being reintroduced —
  // review it against the 22-sentence corpus above before accepting it.
  const POLITE_FORMS_LOST_WITH_THE_to_ENTRY = [
    'I want you to re-run the analysis.',
    'I need you to re-run the analysis.',
    "I'd like you to re-run the analysis.",
    'I am going to re-run the analysis.',
    'Try to re-run the analysis.',
    'Ask them to re-run the analysis.',
    'Tell it to re-run the analysis.',
  ];
  for (const msg of POLITE_FORMS_LOST_WITH_THE_to_ENTRY) {
    it(`ACCEPTED COST — declines, falls through to the LLM as staging does: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // ⚠ THE 22 THE MATRIX-VERB ALLOWLIST OPENED. Every one measured EXECUTING a
  // real `run_analysis` at path level before the `to` entry was deleted, and
  // every one is NEW relative to `staging`, where no recogniser exists. Six are
  // the user explicitly REFUSING.
  const MATRIX_VERB_FINDINGS: ReadonlyArray<readonly [string, string]> = [
    ["We didn't want to re-run the analysis.", 'explicit refusal, contracted'],
    ["We won't need to re-run the analysis.", 'explicit refusal, contracted'],
    ["You shouldn't need to re-run the analysis.", 'explicit refusal, contracted'],
    ["I wouldn't want to re-run the analysis now.", 'explicit refusal, contracted'],
    ["He doesn't want to re-run the analysis.", 'explicit refusal, contracted'],
    ['I was going to re-run the analysis but changed my mind.', 'refusal by retraction'],
    ['She said she wanted to re-run the analysis.', 'reported speech'],
    ['He told me to re-run the analysis.', 'reported speech'],
    ['They asked me to re-run the analysis.', 'reported speech'],
    ['The team said they need to re-run the analysis.', 'reported speech'],
    ['She told me to re-run the analysis.', 'reported speech'],
    ['He said he was going to re-run the analysis.', 'reported speech'],
    ['They were going to re-run the analysis.', 'reported speech, past'],
    ['Do they want to re-run the analysis?', 'question, non-first-person subject'],
    ['Does he need to re-run the analysis?', 'question, non-first-person subject'],
    ['Did she ask to re-run the analysis?', 'question, non-first-person subject'],
    ['Would you want to re-run the analysis?', 'question, non-first-person subject'],
    ['The need to re-run the analysis is unclear.', '`need` as a NOUN'],
    ['There was no ask to re-run the analysis.', '`ask` as a NOUN'],
    ['Our need to re-run the analysis has passed.', '`need` as a NOUN'],
    ['If you need to re-run the analysis, tell me.', 'conditional'],
    ['If they want to re-run the analysis, it will take time.', 'conditional'],
  ];
  for (const [msg, why] of MATRIX_VERB_FINDINGS) {
    it(`NEVER executes — ${why}: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // ⚠ THE MIRROR DEFECT — and this note is now correct, which it was not.
  //
  // FOUR contracted negators (`won't` · `shouldn't` · `wouldn't` · `doesn't`)
  // are absent from `RERUN_NEGATION_VETO_PATTERNS` while present in
  // `NEGATED_EDIT_PATTERNS` — the sibling list IN THE SAME source file,
  // expressing the same concept, one fuller than the other.
  //
  // ⚠⚠ `didn't` IS ABSENT FROM BOTH. The first draft of this note named it
  // among the five "present in the sibling" — so a note written to record a
  // hand-maintained-mirror defect had itself drifted at birth, and was caught
  // only by a byte check of the two regexes. Verified with a probe, not read.
  //
  // The canonical statement now lives at BOTH source sites; this is the
  // test-side pointer, not the record.
  it('the two negation lists in this file have diverged — recorded, not silently tolerated', () => {
    // Deliberately a documentation pin, not a behaviour assertion: unifying
    // them is a change with its own blast radius (NEGATED_EDIT_PATTERNS gates
    // the vague-edit clarifier) and belongs in its own lane.
    expect(looksLikeImperativeRerun("We didn't want to re-run the analysis.")).toBe(false);
  });

  // The all-occurrence scan: one message can carry a nominal use AND a real
  // instruction. Stopping at the first match would decline these, because the
  // first occurrence is the nominal one.
  const NOMINAL_THEN_INSTRUCTION = [
    'The re-run analysis was odd. Re-run the model.',
    'Check the re-run analysis, then re-run the model.',
  ];
  for (const msg of NOMINAL_THEN_INSTRUCTION) {
    it(`still fires when a real instruction FOLLOWS a nominal use: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(true);
    });
  }

  // ⚠ DOCUMENTED DECLINES — genuine instructions this allowlist does NOT
  // recognise. Pinned as CURRENT behaviour and as an ACCEPTED cost, never as
  // desired behaviour: each falls through to the LLM router, which is the
  // pre-PR path, so the cost is a clarification and never a destroyed result.
  // The first five are also genuinely AMBIGUOUS — "the re-run analysis" there
  // is determiner + modifier + noun, the very construction the allowlist exists
  // to refuse. If one of these starts firing, that is a WIDENING to review, not
  // a fix to celebrate.
  const KNOWN_DECLINES_FAILING_SAFE = [
    'Start the re-run analysis.',
    'Kick off the re-run analysis.',
    'Trigger the re-run analysis.',
    'Perform the re-run analysis.',
    'Repeat the re-run analysis.',
    'Go ahead with the re-run analysis.',
    'I want the re-run analysis.',
    'The re-run analysis was odd, so re-run the model.',
    // ⚠ FOURTH REVIEW PASS — the block above previously read as the COMPLETE
    // measured decline set. It was not. Any sentence-initial discourse marker
    // or modal absent from the allowlist also declines, and two of these are
    // common phrasings a real user would type.
    'Just re-run the analysis.',
    'You should re-run the analysis.',
    'So re-run the analysis.',
    'Also re-run the analysis.',
    'First re-run the analysis.',
    'Next re-run the analysis.',
    'Finally re-run the analysis.',
    'OK re-run the analysis.',
    'Yes re-run the analysis.',
    'Instead re-run the analysis.',
    'Maybe re-run the analysis.',
    'Actually re-run the analysis.',
    'Here is what I need: re-run the analysis.',
    // ⚠ AN ADJECTIVE BETWEEN DETERMINER AND NOUN also declines — the object
    // rule matches determiner + noun with nothing between. Safe direction, and
    // previously undisclosed. These are natural phrasings and the most likely
    // source of a "why didn't it re-run?" report.
    'Re-run the whole analysis.',
    'Re-run the full analysis.',
    'Re-run the updated model.',
    'Re-run the baseline scenario.',
    // Infinitives generally, now that the `to` left context is DELETED (not
    // narrowed — an earlier revision narrowed it, and that is what opened the
    // 22).
    'It would be sensible to re-run the analysis.',
    'The plan is to re-run the analysis.',
  ];
  for (const msg of KNOWN_DECLINES_FAILING_SAFE) {
    it(`KNOWN DECLINE (accepted cost, fails safe to the LLM): "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(false);
    });
  }

  // BOTH DIRECTIONS. Every genuine instruction must survive both repairs —
  // a veto that silences the feature is not a fix.
  const STILL_INSTRUCTIONS = [
    'Please run the analysis again on this same model.',
    'Run the analysis again.',
    'Re-run the analysis.',
    'Rerun the analysis please.',
    'Run it again.',
    'Can you re-run the analysis?',
    "Let's re-run this.",
  ];
  for (const msg of STILL_INSTRUCTIONS) {
    it(`still recognises the instruction: "${msg}"`, () => {
      expect(looksLikeImperativeRerun(msg)).toBe(true);
    });
  }
});
