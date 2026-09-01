/**
 * ⭐ MUTATION WARRANT — the hand-written corpus (INV-1, ROADMAP 2.652).
 *
 * CLAUDE.md trap 12d, stated as a test file: a guard DERIVED from a list can
 * only prove the copies agree; it is structurally blind to the list being
 * SHORT. The canonical `MUTATION_SIGNAL_PATTERNS` was short — it recognises
 * "set X to N" and "add a Y" and NO constraint phrasing at all, which is why
 * "Keep churn below 3%." carried no mutation signal on the walk's build. Only a
 * hand-written corpus of real phrasings notices that.
 *
 * So this file ships BOTH kinds of guard, because neither supersedes the other:
 *   · the CORPUS (positive + negative) notices the list is wrong;
 *   · the UNION assertion (derived, iterating the canonical list's own corpus)
 *     notices the two predicates have forked.
 *
 * ⚠ THE FAIL-SAFE DIRECTION IS INVERTED relative to `mutation-consent.test.ts`,
 * and the negative corpus is the more important half here. For withheld consent
 * a false positive costs one confirmation. For a warrant a false positive
 * SILENTLY REWRITES THE USER'S MODEL — it is the witnessed defect. Every entry
 * in NEGATIVE_CORPUS is a sentence a user might plausibly type that must NOT
 * authorise a write.
 */
import { describe, it, expect } from 'vitest';

import {
  hasMutationWarrantSignal,
  hasConstraintMutationSignal,
  detectMutationWarrant,
  CONSTRAINT_MUTATION_SIGNAL_PATTERNS,
  buildMutationWarrantDemotionText,
  buildResidualConstraintDisclosure,
  hasExplicitNoModelChangeIntent,
} from '../mutation-warrant.js';
import { hasMutationSignal } from '../analytical-intent.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../mutation-consent.js';
import { TYPED_CHIP_MUTATION_ACTION_TYPES } from '../typed-chip-mutation-proposal.js';
import {
  EDIT_GRAPH_POSITIVE_REGEX,
  EDIT_GRAPH_NEGATIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';

/**
 * CONSTRAINT PHRASINGS A USER ACTUALLY WRITES. Every one of these is an
 * instruction to bound something; none is recognised by the canonical
 * mutation-signal list. Drawn from the walk's own vocabulary plus the shapes
 * the `add_constraint` handler can express (at_least / at_most).
 */
const CONSTRAINT_POSITIVE_CORPUS: readonly string[] = [
  'Keep churn below 3%.',
  'Keep the budget under 50000.',
  'Hold spend under 50k.',
  'Maintain uptime above 99%.',
  'Churn must be at most 3%.',
  'Churn must be at least 1%.',
  'Revenue must be no less than 250000.',
  'It has to be under 3% for this to work.',
  'Uptime needs to be above 99.5%.',
  'Churn should be no more than 3%.',
  "Churn can't exceed 3%.",
  'Churn cannot exceed 3%.',
  'Spend must not go above 50000.',
  "Churn shouldn't rise above 3%.",
  'Limit churn to 3%.',
  'Cap spend at 50000.',
  'Constrain churn to 3%.',
  'Restrict the budget to 50000.',
  'Make sure churn stays below 3%.',
  'Ensure uptime remains above 99%.',
  "Don't let churn rise above 3%.",
  'Never let spend exceed 50000.',
  'No more than 3% churn.',
  'At most 3% churn, please.',
];

/**
 * ⚠ THE HALF THAT MATTERS MOST. A hit on any of these grants a warrant to
 * rewrite the model on a turn the user never asked to edit anything.
 */
const NEGATIVE_CORPUS: readonly string[] = [
  // THE WITNESSED UTTERANCE (walk §J7). The whole fix exists for this line.
  'Open the analysis panel and show me the option comparison',
  // The walk's calibration forecast (#831 / ROADMAP 2.627). DESCRIPTIVE, not
  // deontic: the bound appears inside a probability claim about the world.
  // A bare `stays below N` pattern would grant on this — which is why there
  // is no bare `stays below N` pattern.
  "I'd say there's about a 70% chance churn stays below 3%.",
  'I think monthly churn staying below 3% in December is pretty likely.',
  // Questions and reads about existing bounds.
  'Why is churn constrained to 3%?',
  'Show me the constraints.',
  'What happens if churn goes above 3%?',
  'Is churn below 3% right now?',
  'Which of my limits was not checked?',
  'Explain the results.',
  'Run the analysis again.',
  'What would change the answer?',
  'Tell me what to change.',
  'What should we update based on this?',
  // Reporting, not instructing.
  'Our churn has been below 3% for 6 months.',
  'The churn limit is stored backwards.',
  'Last quarter we stayed under 50000.',
  // Deontic frame but NO quantity — nothing to write.
  'Keep churn low.',
  'Make sure spend stays reasonable.',
  "Churn can't get out of hand.",
];

describe('CONSTRAINT CORPUS — the phrasings the canonical mutation-signal list does not carry', () => {
  it('every constraint phrasing grants a warrant', () => {
    const missed = CONSTRAINT_POSITIVE_CORPUS.filter((m) => !hasMutationWarrantSignal(m));
    expect(missed).toEqual([]);
  });

  it('the corpus is genuinely NEW — most of it carries NO canonical mutation signal, so a derived-only guard would have missed it', () => {
    // The load-bearing claim behind the whole corpus. If this ever drops to
    // zero, `MUTATION_SIGNAL_PATTERNS` has absorbed these shapes and this
    // module's extension is dead weight worth deleting.
    const invisibleToCanonical = CONSTRAINT_POSITIVE_CORPUS.filter((m) => !hasMutationSignal(m));
    expect(invisibleToCanonical.length).toBeGreaterThan(15);
    // Named instance, so the claim is not just a count.
    expect(hasMutationSignal('Keep churn below 3%.')).toBe(false);
    expect(hasMutationWarrantSignal('Keep churn below 3%.')).toBe(true);
  });
});

describe('NEGATIVE CORPUS — a read, a question or a forecast must NEVER authorise a write', () => {
  it('no negative-corpus utterance grants a warrant', () => {
    const wronglyGranted = NEGATIVE_CORPUS.filter((m) => hasMutationWarrantSignal(m));
    expect(wronglyGranted).toEqual([]);
  });

  it('the WITNESSED utterance specifically grants nothing', () => {
    expect(
      hasMutationWarrantSignal('Open the analysis panel and show me the option comparison'),
    ).toBe(false);
  });

  it('a DESCRIPTIVE bound inside a probability claim grants nothing (the 2.627 collision)', () => {
    expect(
      hasConstraintMutationSignal("I'd say there's about a 70% chance churn stays below 3%."),
    ).toBe(false);
    // …while the deontic twin of the same bound does grant.
    expect(hasConstraintMutationSignal('Make sure churn stays below 3%.')).toBe(true);
  });

  it('a deontic frame with no quantity grants nothing — there is no value to write', () => {
    expect(hasConstraintMutationSignal('Keep churn low.')).toBe(false);
    expect(hasConstraintMutationSignal("Churn can't get out of hand.")).toBe(false);
  });
});

describe('EXPLICIT NO-MODEL-CHANGE GRAMMAR — bounded class and semantic mutants', () => {
  it.each([
    [true, 'Do not change the model.'],
    [true, 'DON’T UPDATE THE CURRENT GRAPH!'],
    [true, 'Without modifying this model, please.'],
    [true, 'Without making any changes to the current model.'],
    [true, 'Without applying edits to our graph.'],
    [true, 'Make no updates to the existing model.'],
    [true, 'No changes to current model.'],
    [true, 'Without current model changes.'],
    [true, 'Do not, PLEASE, update my CURRENT causal graph.'],
    [true, "Don't let our causal graph be mutated."],
    [true, 'Without my current causal model being modified.'],
    [true, 'Without edits being made to my underlying causal graph.'],
    [true, 'Apply no edits of the underlying causal graph.'],
    [true, 'Make no current causal model updates.'],
    [true, 'Do not make further changes to the current causal model.'],
    [true, 'Never change my current causal model.'],
    [true, 'Never make any changes to our causal graph.'],
    [true, 'Never apply edits to the current model.'],
    [true, 'No current causal model changes.'],
    [true, 'Please, no edits to my current causal graph.'],
    [true, 'Do not allow changes to the underlying causal model.'],
    [true, 'Make no changes in the current causal model.'],
    [true, 'Apply no edits on my causal graph.'],
    [true, 'No updates within the current model.'],
    [true, 'Without further changes to my current causal model.'],
    [true, 'Without a modification to my causal graph.'],
    [true, 'There must be no changes to the current causal model.'],
    [true, 'Do not "change" the current causal model.'],
    [true, 'Do not change the "current causal model".'],
    [true, '"Do not change the current causal model."'],
    [true, '‘Don’t change the current causal model.’'],
    [true, "'Don't update the current graph.'"],
    [true, 'The unmatched quote says ‘Don’t change the current model.'],
    [false, 'Without changing the agenda.'],
    [false, 'Without making changes to the meeting plan.'],
    [false, 'The current model changes weekly.'],
    [false, 'No model changes were recorded.'],
    [false, 'No current causal graph updates were recorded.'],
    [false, 'No changes to the current causal model were recorded.'],
    [false, 'There were no changes to the current causal model.'],
    [false, 'We made no edits to the current causal graph.'],
    [false, 'No touching the graph.'],
    [false, 'No change-management updates are needed.'],
    [false, 'Show me the model changes.'],
    [false, 'Do not show me the current model changes.'],
    [false, 'Without explaining the current graph updates.'],
    [false, 'No graph-paper edits are required.'],
    [false, 'Without changing the modelling approach.'],
    [false, 'No graphical updates are required.'],
    [false, 'Do not update the graphical forecast.'],
    [false, 'Do not edit the graph-paper notes.'],
    [false, 'Do not update the model-driven forecast.'],
    [false, 'Without touching graphology.'],
    [false, 'Without changing the model, the team ran the comparison yesterday.'],
    [false, 'The team ran the comparison yesterday without changing the model.'],
    [false, 'The note says, "Do not change the current model."'],
    [false, "The note says 'without changing the graph'."],
    [false, 'The note says, ‘Don’t change the current model.’'],
    [false, "The note says 'Don't update the current graph.'"],
    [false, 'The review approved no changes to the current model.'],
    [false, 'The proposal contains no current causal model changes.'],
    [false, 'No model changes are proposed for the next review.'],
    [false, 'Planning assumed no edits on the current graph.'],
    [false, 'The report notes no changes within the underlying model.'],
    [false, 'Set Team Capacity to 53% without changing anything else.'],
    [false, 'Set Team Capacity to 53% without making any other changes.'],
    [false, 'Set Team Capacity to 53% without making any other updates to my current causal model.'],
    [false, 'Without additional changes to our current causal graph, set Team Capacity to 53%.'],
    [false, 'Make Team Capacity 53% without making any other changes to the current causal model.'],
    [false, 'Ensure Team Capacity is set to 53% without changing anything else.'],
    [false, 'Team Capacity should be set to 53% without making other changes.'],
  ])('%s for: %s', (expected, message) => {
    expect(hasExplicitNoModelChangeIntent(message)).toBe(expected);
  });

  it.each([
    'Do not modify my current causal model.',
    'Do not let my current causal model be modified.',
    'Without modifying my current causal model.',
    'Without my current causal model being modified.',
    'Without modifications to my current causal model.',
    'Make no modifications to my current causal model.',
    'Make no current causal model modifications.',
  ])('is invariant to bounded imperative/object token order: %s', (message) => {
    expect(hasExplicitNoModelChangeIntent(message)).toBe(true);
  });
});

describe('UNION — the derived half: the warrant predicate is a strict SUPERSET of the canonical one', () => {
  it('every canonical mutation signal also grants a warrant', () => {
    // Iterates the canonical list itself, so a pattern ADDED there is covered
    // on the day it is written — the guard that cannot go stale.
    const canonicalExamples: readonly string[] = [
      'Set Marketing to 0.7',
      'Change the budget to 50000',
      'Raise the target to 300000',
      'Add a new risk factor',
      'Create an option for pricing',
      'Remove the demand factor',
      'Change from low to high',
      'Set Customer Churn Rate to 2%.',
      'Delete that option',
    ];
    for (const m of canonicalExamples) {
      // Precondition pinned in-test (trap 13b): prove the example actually
      // exercises the canonical list, so this assertion cannot pass by the
      // example silently stopping being a canonical hit.
      expect(hasMutationSignal(m), `canonical precondition failed for: ${m}`).toBe(true);
      expect(hasMutationWarrantSignal(m), `warrant did not cover canonical: ${m}`).toBe(true);
    }
  });

  /**
   * ⭐ THE SUPERSET RELATION — UNCONDITIONAL AGAIN.
   *
   * ⚠ THIS TEST BRIEFLY CARRIED A "SANCTIONED EXCEPTION" BRANCH FOR AN EXPLICIT
   * VETO, AND BOTH ITS BRANCHES WERE DEAD. Measured over the two corpora this
   * loop reads: 43 rows, of which **0** satisfy `hasMutationSignal`. The body
   * never executed at all, so neither the relation nor its exception was ever
   * asserted here — proven by replacing both expectations with guaranteed-failing
   * assertions and watching the file stay green.
   *
   * The exception is gone because the fork it existed to admit does not exist:
   * `hasMutationWarrantSignal`'s Term 0 refuses only when `hasMutationSignal` is
   * FALSE, so a canonical hit can never be vetoed. Measured over 1,093,500
   * generated canonical-hit messages: 0 forks (850,500 before that guard).
   *
   * ⚠ THE VACUITY IS FIXED BY ASSERTING THE EXECUTED COUNT, NOT BY TRUSTING THE
   * LOOP. `executed` is pinned below, so if these corpora ever stop containing
   * canonical hits — or start containing them — this REDs and says so, instead of
   * silently reading as coverage the way it did before.
   */
  it('the superset relation holds structurally over both corpora', () => {
    const corpus = [...CONSTRAINT_POSITIVE_CORPUS, ...NEGATIVE_CORPUS];
    let executed = 0;
    for (const m of corpus) {
      if (!hasMutationSignal(m)) continue;
      executed += 1;
      expect(hasMutationWarrantSignal(m), `superset violated for: ${m}`).toBe(true);
    }
    // ⭐ THE HONEST DISCLOSURE. These two corpora were assembled to exercise the
    // CONSTRAINT vocabulary, which the canonical list deliberately does not
    // carry, so no row here is a canonical hit and this loop asserts NOTHING
    // about the superset relation. It is retained as a drift alarm: the real
    // coverage is `canonicalExamples` above (9 rows, preconditions pinned) and
    // the 15 canonical hits in the explicit-veto corpus.
    expect(corpus.length, 'corpus size drifted').toBe(43);
    expect(
      executed,
      'a canonical hit appeared in these corpora — this loop is no longer vacuous, ' +
        'which is good news: fold the row into the real superset coverage and raise this number',
    ).toBe(0);
  });

  it('every constraint pattern is anchored to a digit — the property the fail-safe direction rests on', () => {
    // A pattern that can fire without a quantity is a pattern that can grant a
    // warrant for a change with nothing to write. Asserted over the exported
    // list, so a new pattern is covered without being named here.
    for (const re of CONSTRAINT_MUTATION_SIGNAL_PATTERNS) {
      expect(re.source, `pattern must require a digit: ${re.source}`).toContain('\\d');
    }
  });
});

describe('WARRANT SOURCES — the three ratified ways a turn may authorise a mutation', () => {
  const sources = GRAPH_MUTATING_HANDLER_IDS;

  it('confirm-resume grants regardless of message or chip', () => {
    expect(
      detectMutationWarrant(
        {
          message: 'yes',
          turnSource: 'composer',
          chipActionType: undefined,
          isConfirmResume: true,
        },
        sources,
      ),
    ).toEqual({ granted: true, source: 'confirm_resume' });
  });

  it('a typed MUTATION chip click grants; a typed NON-mutation chip click does not', () => {
    expect(
      detectMutationWarrant(
        {
          message: 'Do that.',
          turnSource: 'chip_click',
          chipActionType: 'add_constraint',
          isConfirmResume: false,
        },
        sources,
      ),
    ).toEqual({ granted: true, source: 'typed_mutation_chip' });

    // DISCRIMINATING TWIN: same turn shape, a chip that is not a mutation.
    expect(
      detectMutationWarrant(
        {
          message: 'Do that.',
          turnSource: 'chip_click',
          chipActionType: 'explain_results',
          isConfirmResume: false,
        },
        sources,
      ),
    ).toEqual({ granted: false });
  });

  it('a PLAIN-message chip (no action_type) is judged on its message, not on being a chip', () => {
    // Load-bearing for the calibration flow: the "Use 70%" chip carries NO
    // action_type and replays "Set <factor> to 70%." — its warrant must come
    // from the message, not from a blanket chip exemption.
    expect(
      detectMutationWarrant(
        {
          message: 'Set Monthly Churn Rate to 70%.',
          turnSource: 'chip_click',
          chipActionType: undefined,
          isConfirmResume: false,
        },
        sources,
      ),
    ).toEqual({ granted: true, source: 'message_signal' });

    expect(
      detectMutationWarrant(
        {
          message: 'Show me the option comparison',
          turnSource: 'chip_click',
          chipActionType: undefined,
          isConfirmResume: false,
        },
        sources,
      ),
    ).toEqual({ granted: false });
  });

  it('a composer turn with a read-shaped message grants nothing — the witnessed case', () => {
    expect(
      detectMutationWarrant(
        {
          message: 'Open the analysis panel and show me the option comparison',
          turnSource: 'composer',
          chipActionType: undefined,
          isConfirmResume: false,
        },
        sources,
      ),
    ).toEqual({ granted: false });
  });

  it('an empty or non-string message grants nothing', () => {
    for (const message of ['', '   ', undefined as unknown as string]) {
      expect(
        detectMutationWarrant(
          { message, turnSource: 'composer', chipActionType: undefined, isConfirmResume: false },
          sources,
        ),
      ).toEqual({ granted: false });
    }
  });
});

describe('DERIVED — the chip action-type vocabulary and the mutating-handler set agree', () => {
  it('the typed mutation chip action types are exactly the graph-mutating handler ids', () => {
    // The executor passes `GRAPH_MUTATING_HANDLER_IDS` as the chip vocabulary.
    // If the two ever diverge, a typed mutation chip could either grant a
    // warrant for a handler this gate does not cover, or fail to grant one for
    // a chip the UI legitimately sends. Derived, so it fails on the day of.
    expect([...TYPED_CHIP_MUTATION_ACTION_TYPES].sort()).toEqual(
      [...GRAPH_MUTATING_HANDLER_IDS].sort(),
    );
  });
});

/**
 * ⭐ THE SECONDARY-CHANNEL DECISION, RECORDED EXECUTABLY.
 *
 * The 2.652 trace named a second no-chip write channel for the manifest:
 * Graph-Management `update_node_field` on `goal_constraints` (`ai_only` class,
 * passes field-safety, would_apply-eligible). It is reached from
 * `orchestrator/route-v2.ts` on `editIntentDetected` — OUTSIDE
 * `runTurnExecutor`, so INV-1's LAYER 1 and LAYER 2 do not cover it, exactly as
 * `mutation-consent.ts` already records for `edit_graph` (ROADMAP 2.628a).
 *
 * THE DERIVATION (not an assumption): that door already asks a coarse form of
 * the warrant question, which the executor door did not ask at all.
 * `editIntentDetected` requires `positiveEditRegexHit && !negativeEditRegexHit`
 * (plus value-update / analytical / state-query suppressors) — i.e. the message
 * must carry an edit VERB and must not carry a read marker. The witnessed
 * utterance fails BOTH halves, so the walk's defect could not have arisen on
 * that channel.
 *
 * CONCLUSION: the warrant gate is NOT duplicated at the GM chokepoint in this
 * fix. The residual there is a PRECISION problem in an existing gate (a coarse
 * verb regex), not an ABSENT gate — a different defect class with a different
 * owner. Recorded here as executable evidence rather than prose so a future
 * change to those regexes that opens the read-shaped door turns this RED.
 */
describe('SECONDARY CHANNEL — the GM edit_graph door already gates on message shape', () => {
  it('the WITNESSED utterance carries no edit verb AND trips the read-marker guard', () => {
    const m = 'Open the analysis panel and show me the option comparison';
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(m)).toBe(false);
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(m)).toBe(true);
  });

  it.each([
    'Show me the constraints.',
    'Explain the results.',
    'Compare the options for me.',
    'Why is churn constrained?',
    'Tell me what changed.',
  ])('read-shaped utterance never opens the GM door: %s', (m) => {
    const opens = EDIT_GRAPH_POSITIVE_REGEX.test(m) && !EDIT_GRAPH_NEGATIVE_REGEX.test(m);
    expect(opens).toBe(false);
  });

  it('POSITIVE CONTROL — a genuine edit request DOES open it, so the assertions above are not vacuous', () => {
    const m = 'Add a constraint that churn must be at most 3%.';
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(m)).toBe(true);
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(m)).toBe(false);
  });
});

describe('DEMOTION COPY', () => {
  it('states the outcome in the first clause and never claims something was applied', () => {
    const text = buildMutationWarrantDemotionText('a limit keeping "Churn" at or below 3%', null);
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    expect(text.toLowerCase()).not.toContain('applied');
    expect(text).toContain('at or below 3%');
  });

  it('appends the INV-2 residual disclosure when one is supplied, naming the surviving row', () => {
    const residual = buildResidualConstraintDisclosure('churn could rise floor');
    const text = buildMutationWarrantDemotionText('a limit keeping "Churn" at or below 3%', residual);
    expect(text).toContain('churn could rise floor');
    expect(text).toContain('stay in place');
  });

  it('the residual disclosure degrades honestly when the surviving row has no label', () => {
    const residual = buildResidualConstraintDisclosure(null);
    expect(residual).toContain('the limit already on that factor');
    expect(residual).toContain('stay in place');
  });
});

/**
 * ⭐⭐ THE DEMOTION COPY MAY DESCRIBE WHAT THE PRODUCT DID, NEVER WHAT THE USER
 * ASKED FOR (INV-3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WITNESSED THREE TIMES, on three different builds, from the SAME clause.
 *
 *   1. 20 Aug 2026, fresh-guest browser walk (`outstanding-effect-ask-misroute
 *      .ts:15`): the product ASKED for a missing effect value, the user
 *      answered it, and the reply opened "You did not ask me to edit the
 *      model."
 *   2. The consent-loop dead end pinned in `mutation-warrant-consent-parity
 *      .test.ts:727` — offer → the user says yes → "You did not ask me to edit
 *      the model." Closed by widening the warrant, not by touching this copy.
 *   3. 1 Sep 2026, deployed build. The user asked three times ("Change Warm
 *      Introduction Access" / "let's say 50% for now until I've checked" /
 *      "Warm Introduction Access — the 50% was for that one") and was told
 *      they had not asked, in the same message that then offered them exactly
 *      what they had asked for.
 *
 * ⭐ THE FIX IS THE COPY, DELIBERATELY — NOT THE PREDICATE. `hasMutationWarrant
 * Signal`'s own docstring (line ~290) closes with a standing ruling: four
 * consecutive rounds and PR #1107 were burned trying to tell a scope fence from
 * a retraction, and "no further punctuation-only or lexical rule will settle
 * it". So the warrant gate WILL keep missing a real instruction sometimes. That
 * is survivable when the reply merely declines to write; it is a lie when the
 * reply also asserts the user never spoke. Removing the assertion makes the
 * residual predicate error BENIGN IN BOTH DIRECTIONS instead of insulting, and
 * it needs no new predicate to do it.
 *
 * ⚠ IT IS ALSO A STANDING RULING THIS ESTATE ALREADY RATIFIED ELSEWHERE.
 * `coaching/pick-defaulted-assumptions.ts:217` — "IT DESCRIBES WHAT THE PRODUCT
 * DID, NEVER WHAT THE USER DID … 'you did not set X' would be a statement about
 * the user". This module simply never got the ruling applied to it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO DIRECTIONS. They fail on DIFFERENT assertions, which is the point —
 * a fix that merely deleted the sentence would satisfy TWIN B and break TWIN A.
 */
describe('DEMOTION COPY — INV-3, the two opposite-direction twins', () => {
  const CHANGE = 'setting "Warm Introduction Access" to 50%';

  /**
   * The claim class, written against the SPEC ("no assertion about what the
   * user communicated"), never against the one witnessed literal — CLAUDE.md
   * trap 13d. A predicate shaped to the failure mode in hand cannot see the
   * next phrasing of the same harm.
   */
  const USER_INTENT_CLAIM =
    /\byou\s+(?:did\s+not|didn['’]t|have\s+not|haven['’]t|never)\s+(?:ask|request|say|state|tell|mention)/i;

  /** Verbatim, from the dated live corpus (`digit-bearing-replies.json:79`). */
  const WITNESSED_2026_08_17 =
    'Nothing has been changed. You did not ask me to edit the model, so I have not — ' +
    'but a limit keeping "Monthly Churn Rate" at or below 4% looks like it would help. ' +
    'Say the word and I will make it.';

  it('POSITIVE CONTROL — the claim detector matches the sentence actually emitted on a dated build, so TWIN B cannot pass vacuously', () => {
    expect(WITNESSED_2026_08_17).toMatch(USER_INTENT_CLAIM);
  });

  it('TWIN A (gate) — a turn that genuinely instructs nothing still carries NO warrant, so the demotion branch is still reached', () => {
    expect(
      detectMutationWarrant(
        {
          message: 'Show me the constraints.',
          turnSource: 'composer',
          chipActionType: undefined,
          isConfirmResume: false,
        },
        GRAPH_MUTATING_HANDLER_IDS,
      ),
    ).toEqual({ granted: false });
  });

  it('TWIN A (copy) — the no-write disclosure STILL FIRES and the change is STILL offered', () => {
    const text = buildMutationWarrantDemotionText(CHANGE, null);
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    expect(text).toContain(CHANGE);
    expect(text).toContain('Say the word and I will make it.');
  });

  it('TWIN B — the copy asserts NOTHING about what the user did or did not ask for', () => {
    const text = buildMutationWarrantDemotionText(CHANGE, null);
    expect(text).not.toMatch(USER_INTENT_CLAIM);
  });

  it('TWIN B holds for the residual-disclosure shape too, which is a second composed string', () => {
    const text = buildMutationWarrantDemotionText(
      CHANGE,
      buildResidualConstraintDisclosure('churn could rise floor'),
    );
    expect(text).not.toMatch(USER_INTENT_CLAIM);
    expect(text).toContain('stay in place');
  });
});
