/**
 * ⭐⭐⭐ ORDINARY-TEXT AUTHORITY — THE WRITE GATE, BOTH CONSUMERS.
 *
 * ═══ THE USER OUTCOME THIS FILE DEFENDS ═══
 * A person can ask "Should we rename this?" or "What are your thoughts on this
 * budget limit?" and get an offer with their model PROVABLY UNCHANGED and the
 * reply saying so FIRST — while an outright instruction, a confirmed proposal, a
 * typed chip, or advice mixed with an explicit edit all still save in ONE turn,
 * with no extra confirmation step.
 *
 * ═══ THE DEFECT, MEASURED AT PRISTINE ═══
 * The product performed the SAME model mutation whether the user gave an
 * explicit edit instruction or merely asked for advice.
 *   · PATH A (V5 typed handlers): `detectMutationWarrant` GRANTS on
 *     "Do you think the churn rate should be lower?" — Term 3
 *     (`isEditRequestShape`) is TRUE, so an advice question is an authorised
 *     write. RED-first signature: `expected { granted: false } … received
 *     { granted: true, source: 'message_signal' }`.
 *   · PATH B (`edit_graph`): `grep -c warrant` over
 *     `handlers/edit-graph-dispatch.ts` reads ZERO at pristine (in-file contrast
 *     control `scope_unresolved` reads 3, so the probe can see). The lane had no
 *     affirmative authority at all, and the advice turn COMMITTED.
 *
 * ═══ WHAT IS PINNED HERE, AND WHY EACH CASE EXISTS ═══
 *  1. advice WITHHOLDS — the harm class, both consumers;
 *  2. the explicit arm still SAVES — or the fix is "no edits";
 *  3. a MIXED edit is preserved — advice + an explicit edit in one message;
 *  4. typed chip + held confirmation asserted BY SOURCE, not by outcome — a
 *     `granted: true` proves nothing about WHICH authority granted it;
 *  5. ⭐ the QUOTED-LABEL case, which the live corpus produced and nobody would
 *     have written otherwise: a graph carrying a node labelled
 *     "What should we do?" made 2 of 3 deliberative-framed mutating turns FALSE
 *     POSITIVES. It is pinned WITH ITS OWN PRECONDITION (the same message with
 *     no labels supplied must reach the OTHER verdict), so the case cannot
 *     decay into a tautology if the mask ever stops discriminating;
 *  6. a DISCRIMINATING MUTANT PAIR for the object binding;
 *  7. KNOWN_DROPPED, asserted as an EXACT SET so the suite REDs if it GROWS or
 *     SHRINKS.
 */

import { describe, it, expect } from 'vitest';

import {
  detectMutationWarrant,
  hasMutationWarrantSignal,
  hasStrongerThanTextWarrant,
  hasConstraintMutationSignal,
} from '../mutation-warrant.js';
import {
  maskQuotedNodeLabels,
  projectModelNodeLabels,
  resolveOrdinaryTextAuthority,
} from '../ordinary-text-authority.js';
import { classifyUnappliedEditFrame } from '../../compose/unapplied-edit-reply.js';
import { hasMutationSignal } from '../analytical-intent.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../mutation-consent.js';

/** The label that made two real mutating turns read as deliberation. */
const DELIBERATIVE_NODE_LABEL = 'What should we do?';

function warrant(
  message: string,
  over: Partial<Parameters<typeof detectMutationWarrant>[0]> = {},
): ReturnType<typeof detectMutationWarrant> {
  return detectMutationWarrant(
    {
      message,
      turnSource: 'composer',
      chipActionType: undefined,
      isConfirmResume: false,
      ...over,
    },
    GRAPH_MUTATING_HANDLER_IDS,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 — ADVICE WITHHOLDS
// ═══════════════════════════════════════════════════════════════════════════

describe('an advice turn does not authorise a write', () => {
  it('PRECONDITION — the classifier already calls these deliberation, and the harm case still reached the write path at pristine', () => {
    // Bind to the ratified classifier by IDENTITY, not by re-stating its rules.
    expect(classifyUnappliedEditFrame('Should we rename this?')).toBe('deliberation');
    expect(classifyUnappliedEditFrame('What are your thoughts on this budget limit?'))
      .toBe('deliberation');
    // …and the harm case carries NO unambiguous instruction, which is exactly
    // why the veto may fire on it. If this ever became true the veto would be
    // subordinated away and case 1 below would pass for the wrong reason.
    expect(hasMutationSignal('Do you think the churn rate should be lower?')).toBe(false);
    expect(hasConstraintMutationSignal('Do you think the churn rate should be lower?'))
      .toBe(false);
  });

  it('THE HARM CLASS — an advice question is no longer an authorised write', () => {
    // RED at pristine: { granted: true, source: 'message_signal' }.
    expect(warrant('Do you think the churn rate should be lower?')).toEqual({ granted: false });
  });

  it('the deliverable’s own two sentences authorise nothing', () => {
    expect(warrant('Should we rename this?').granted).toBe(false);
    expect(warrant('What are your thoughts on this budget limit?').granted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 + 3 — EXPLICIT AND MIXED EDITS STILL SAVE IN ONE TURN
// ═══════════════════════════════════════════════════════════════════════════

describe('everything that WAS an authorised write still is', () => {
  const EXPLICIT = [
    'Set churn to 5%.',
    'Keep churn below 3%.',
    'Rename "Launch now" to "Launch in Q3".',
    'Add a risk for supplier delay.',
    'Increase hiring cost to 0.9.',
  ];

  it.each(EXPLICIT)('explicit edit still saves in one turn: %s', (message) => {
    expect(warrant(message)).toEqual({ granted: true, source: 'message_signal' });
  });

  /**
   * ⭐ THE MIXED EDIT — advice AND an explicit edit in one message.
   *
   * This is what the veto's two negated conjuncts buy, and they are Term 0's own
   * shape for Term 0's own reason. Each of these messages is `deliberation` by
   * the frame classifier AND carries an unambiguous canonical or constraint
   * instruction, so the authority survives. Without the conjuncts every one of
   * them would be demoted to a chip.
   */
  const MIXED: ReadonlyArray<readonly [string, string]> = [
    ['Do you think churn is too high? Set churn to 5%.', 'canonical'],
    ['What are your thoughts on the budget limit? Cap marketing at £200,000.', 'constraint'],
    ['Any thoughts on supplier risk? Add a risk for supplier delay.', 'canonical'],
    ['Do you think we need it? Remove the status quo option.', 'canonical'],
    ['Is it worth it? Increase hiring cost to 0.9.', 'canonical'],
  ];

  it.each(MIXED)('mixed edit preserved (%s)', (message, via) => {
    // PRECONDITION IN-TEST: prove the case is genuinely MIXED before asserting
    // it survives, or a frame-list change could make this pass vacuously.
    expect(classifyUnappliedEditFrame(message)).toBe('deliberation');
    expect(via === 'canonical' ? hasMutationSignal(message) : hasConstraintMutationSignal(message))
      .toBe(true);
    expect(warrant(message)).toEqual({ granted: true, source: 'message_signal' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — THE TWO STRONGER SOURCES, ASSERTED BY SOURCE
// ═══════════════════════════════════════════════════════════════════════════

describe('the veto is subordinate to the two stronger warrant sources', () => {
  const CHIP_ACTION = [...GRAPH_MUTATING_HANDLER_IDS][0]!;

  it('PRECONDITION — this message would otherwise be vetoed', () => {
    expect(warrant('Should we rename this?')).toEqual({ granted: false });
  });

  it('a TYPED MUTATION CHIP still saves, and the SOURCE says which authority granted it', () => {
    expect(
      warrant('Should we rename this?', {
        turnSource: 'chip_click',
        chipActionType: CHIP_ACTION,
      }),
    ).toEqual({ granted: true, source: 'typed_mutation_chip' });
  });

  it('a VALIDATED HELD CONFIRMATION still saves, asserted by SOURCE', () => {
    expect(warrant('Should we rename this?', { isConfirmResume: true }))
      .toEqual({ granted: true, source: 'confirm_resume' });
  });

  it('`hasStrongerThanTextWarrant` states the same precedence as a value', () => {
    expect(
      hasStrongerThanTextWarrant(
        { turnSource: 'composer', chipActionType: undefined, isConfirmResume: true },
        GRAPH_MUTATING_HANDLER_IDS,
      ),
    ).toBe(true);
    expect(
      hasStrongerThanTextWarrant(
        { turnSource: 'chip_click', chipActionType: CHIP_ACTION, isConfirmResume: false },
        GRAPH_MUTATING_HANDLER_IDS,
      ),
    ).toBe(true);
    // The discrimination: a PLAIN-message chip is not a source in its own right.
    expect(
      hasStrongerThanTextWarrant(
        { turnSource: 'chip_click', chipActionType: undefined, isConfirmResume: false },
        GRAPH_MUTATING_HANDLER_IDS,
      ),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — THE QUOTED LABEL: THE CASE THE LIVE CORPUS PRODUCED
// ═══════════════════════════════════════════════════════════════════════════

describe('quote-masking by the graph’s own node labels', () => {
  const QUOTED = `Change the node called "${DELIBERATIVE_NODE_LABEL}" to a decision.`;
  const LABELS = [DELIBERATIVE_NODE_LABEL, 'Monthly Churn Rate'];

  it('PRECONDITION IN-TEST — unmasked, this message DOES read as deliberation', () => {
    // Without this the case below could pass because the frame list stopped
    // matching, not because the mask worked. Pin the precondition, not the
    // outcome (CLAUDE.md trap 13b).
    expect(classifyUnappliedEditFrame(QUOTED)).toBe('deliberation');
    expect(resolveOrdinaryTextAuthority({ message: QUOTED, modelNodeLabels: [] }))
      .toBe('withheld_deliberation');
  });

  it('MASKED BY THE GRAPH — the quoted label is blanked and authority is restored', () => {
    expect(classifyUnappliedEditFrame(maskQuotedNodeLabels(QUOTED, LABELS))).toBe('instruction');
    expect(resolveOrdinaryTextAuthority({ message: QUOTED, modelNodeLabels: LABELS }))
      .toBe('granted');
  });

  it('a quoted CONFIRMATION of an explicit edit still applies', () => {
    const m = `Set "${DELIBERATIVE_NODE_LABEL}" to 0.5.`;
    expect(warrant(m, { modelNodeLabels: LABELS }))
      .toEqual({ granted: true, source: 'message_signal' });
  });

  it('the mask is bound to the GRAPH — an unrelated label masks nothing', () => {
    // The discrimination. A mask that blanked any quoted span would pass the
    // case above while doing something entirely different.
    expect(resolveOrdinaryTextAuthority({ message: QUOTED, modelNodeLabels: ['Revenue'] }))
      .toBe('withheld_deliberation');
    expect(maskQuotedNodeLabels(QUOTED, ['Revenue'])).toBe(QUOTED);
  });

  it('the mask cannot blank the user’s OWN deliberation', () => {
    // A user quoting their own question, with no such node on the graph.
    const m = 'I asked "Should we rename this?" and want your view.';
    expect(resolveOrdinaryTextAuthority({ message: m, modelNodeLabels: LABELS }))
      .toBe('withheld_deliberation');
  });

  it('`projectModelNodeLabels` reads labels off a permissive graph and degrades to []', () => {
    expect(projectModelNodeLabels({ nodes: [{ label: 'A' }, { label: '  ' }, { id: 'x' }] }))
      .toEqual(['A']);
    expect(projectModelNodeLabels(null)).toEqual([]);
    expect(projectModelNodeLabels({ nodes: 'not an array' })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 — THE DISCRIMINATING MUTANT PAIR (binding by identity, CLAUDE.md trap 19)
// ═══════════════════════════════════════════════════════════════════════════

describe('the gate binds to the OBJECT it names', () => {
  /**
   * A single biting mutant proves sensitivity to SOMETHING. The pair proves
   * sensitivity to the NAMED object:
   *   · loosen the verdict for ALL messages  → the harm case must be granted;
   *   · loosen it for a DIFFERENT message    → the harm case must stay withheld.
   * Simulated here by driving the ONE parameter the veto reads, because that
   * parameter IS the object under test.
   */
  const HARM = 'Do you think the churn rate should be lower?';
  const OTHER = 'Should we rename this?';

  it('loosening the verdict for ALL messages re-opens the harm (mutant A must bite)', () => {
    expect(hasMutationWarrantSignal(HARM, 'granted')).toBe(true);
    expect(hasMutationWarrantSignal(OTHER, 'granted')).toBe(false);
  });

  it('loosening it for a DIFFERENT message leaves the harm closed (mutant B must NOT bite)', () => {
    expect(hasMutationWarrantSignal(HARM, 'withheld_deliberation')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 — KNOWN-DROPPED, PINNED AS AN EXACT SET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⛔ THE GAP, SHIPPED HONESTLY — FIVE MEMBERS, TWO MECHANISMS.
 *
 * Every message below is PURE ADVICE: it carries no instruction to change the
 * model, and a person sending it expects a view, not a write. The ones this gate
 * STILL lets through are pinned by name WITH the mechanism that lets each
 * through, and the set is asserted EXACTLY — the suite REDs if it GROWS (a
 * regression) or SHRINKS (a widening that would have to be re-priced against
 * mixed edits first).
 *
 * ⚠ MEASURED, AND THE BRIEF'S FIGURE WAS WRONG. The scoping put this set at TWO
 * members. Executed at this tip over the corpus below it is FIVE. The extra
 * three are all mechanism B, and mechanism B is not a list of accidents — it is
 * the exact price of the mixed-edit preservation, so it could not have been
 * two unless mixed edits were being dropped.
 *
 * ⚠ DO NOT WIDEN THE FRAME LIST. The obvious widening (`you'd` / `would
 * recommend`) was PRICED over real traffic: it holds exactly ONE extra mutating
 * turn, and that turn is a MIXED edit which must be preserved — so widening buys
 * only a regression.
 *
 * ⛔ AND DO NOT WRITE A PREDICATE FOR MECHANISM B. Telling
 *     "Should we cap marketing at £200,000?"                        (advice)
 * from
 *     "What are your thoughts on the budget limit? Cap marketing
 *      at £200,000."                                     (a mixed edit, saves)
 * is a natural-language discrimination over trailing clauses. Four consecutive
 * rounds on exactly that shape on exactly this module each closed one direction
 * and reopened the other under a fully green suite, a reviewer then ran the
 * obvious fifth round in advance and proved it oscillates too, and PR #1107 was
 * closed after five variants across two independent corpora. The standing ruling
 * on `hasMutationWarrantSignal` is that no further punctuation-only or lexical
 * rule will settle it.
 *
 * ⭐ THE ALTERNATIVE WAS BUILT, MEASURED AND DELIBERATELY NOT TAKEN — recorded
 * here so the next seat inherits the number rather than the idea. A
 * CLAUSE-SCOPED subordination (split on sentence boundaries; withhold unless an
 * unambiguous instruction survives in a clause carrying no deliberative frame)
 * scores, over this corpus plus the mixed and explicit corpora above:
 *
 *      SHIPPED (message-level)  advice withheld 5/10 · mixed 0/5 · explicit 0/5
 *      ALTERNATIVE (clause)     advice withheld 9/10 · mixed 0/5 · explicit 0/5
 *
 * It is better on this corpus and it was still refused, for a reason that is not
 * caution: the SHIPPED rule's mixed-edit preservation is PROVABLE BY
 * CONSTRUCTION — it can only withhold when no canonical and no constraint signal
 * exists ANYWHERE in the message, so no mixed edit can reach the veto. The
 * clause-scoped rule's "mixed 0/5" is a CORPUS result, and the corpus is the
 * author's own, on the one predicate class this estate has already shown a
 * self-authored corpus cannot bound (CLAUDE.md trap 22/22b/22c). Taking it needs
 * an INDEPENDENT corpus as the deliverable, not a second opinion about this one.
 */
const ADVICE_CORPUS: readonly string[] = [
  'Should we rename this?',
  'What are your thoughts on this budget limit?',
  'Do you think the churn rate should be lower?',
  'Do you think we should add a risk for supplier delay?',
  'Is it worth adding a risk for supplier delay?',
  'Do you agree that churn should be 5%?',
  'Am I right that we should drop the status quo option?',
  'Should we cap marketing at £200,000?',
  'Should we increase the marketing budget to £200,000?',
  'Our budget limit of £200,000 was set by finance last year.',
];

/**
 * Each member carries the MECHANISM that drops it, so the pin binds to the
 * reason and not only to the string. A member whose mechanism changes REDs the
 * precondition below even if the set size happens to stay the same.
 *
 *   'frame_list'  — the ratified frame list returns 'instruction' for it.
 *   'subordinate' — it IS deliberation, but an unambiguous canonical or
 *                   constraint instruction sits in the same message, and that
 *                   is exactly what preserves a mixed edit.
 */
const KNOWN_DROPPED: ReadonlyArray<readonly [string, 'frame_list' | 'subordinate']> = [
  // Mechanism A. A flat statement of an existing bound is not a deliberative
  // frame, and `CONSTRAINT_MUTATION_SIGNAL_PATTERNS` pattern 4 reads the
  // ordinary NOUN "limit … of … <number>" as deontic. Closing it needs a new
  // lexical rule — the thing the standing ruling forbids.
  ['Our budget limit of £200,000 was set by finance last year.', 'frame_list'],
  // Mechanism B ×4 — deliberation carrying its own unambiguous instruction.
  ['Should we cap marketing at £200,000?', 'subordinate'],
  ['Should we increase the marketing budget to £200,000?', 'subordinate'],
  ['Do you think we should add a risk for supplier delay?', 'subordinate'],
  ['Am I right that we should drop the status quo option?', 'subordinate'],
];

describe('KNOWN-DROPPED: the advice turns this gate still lets write', () => {
  it('PRECONDITION — every pinned member is dropped by the MECHANISM it names', () => {
    for (const [message, mechanism] of KNOWN_DROPPED) {
      expect(ADVICE_CORPUS).toContain(message);
      const frame = classifyUnappliedEditFrame(message);
      if (mechanism === 'frame_list') {
        expect(frame, message).toBe('instruction');
      } else {
        expect(frame, message).toBe('deliberation');
        expect(
          hasMutationSignal(message) || hasConstraintMutationSignal(message),
          message,
        ).toBe(true);
      }
    }
  });

  it('EXACTLY this set still receives authority — REDs if it grows OR shrinks', () => {
    const stillGranted = ADVICE_CORPUS.filter((m) => warrant(m).granted);
    expect([...stillGranted].sort()).toEqual([...KNOWN_DROPPED.map(([m]) => m)].sort());
  });

  it('and everything else in the corpus is withheld', () => {
    const withheld = ADVICE_CORPUS.filter((m) => !warrant(m).granted);
    expect(withheld).toHaveLength(ADVICE_CORPUS.length - KNOWN_DROPPED.length);
  });
});
