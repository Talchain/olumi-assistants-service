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

  it('the superset relation holds structurally over both corpora', () => {
    for (const m of [...CONSTRAINT_POSITIVE_CORPUS, ...NEGATIVE_CORPUS]) {
      if (hasMutationSignal(m)) {
        expect(hasMutationWarrantSignal(m), `superset violated for: ${m}`).toBe(true);
      }
    }
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
