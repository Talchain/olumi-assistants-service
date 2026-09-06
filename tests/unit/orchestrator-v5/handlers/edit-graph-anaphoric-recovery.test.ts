/**
 * Spec §4.2 — the three outcomes of an ANAPHORIC edit, and the one that is
 * banned.
 *
 * ⚠ THE CASE THIS FILE EXISTS FOR, witnessed at the wire on deployed staging
 * (CEE `1af54f6c`, UI `53dbd616`, fresh guest, 5 Sep 2026 ~16:52Z):
 *
 *   turn 4, assistant: "…What would you like the sales headcount investment set
 *                       to: the low end of £80k, the high end of £120k, or a
 *                       blended figure like £100k?"
 *   turn 5, user:      "Can you update it with the correct range?"
 *   turn 5, assistant: "I have not changed the model yet. Tell me what you want
 *                       to change, and I will help apply it."
 *
 * The product asked a three-way question naming the object, then one turn later
 * could not resolve the pronoun referring to it. That reply asserts nothing and
 * asks nothing: it is the one branch where the product holds MORE information
 * than the user and volunteers LESS. It is banned here, by name.
 *
 * Fixtures are transcribed verbatim from that capture. Assertions bind by
 * IDENTITY — node id `919d7f50`, the exact label — never by a value predicate
 * another node could satisfy (five nodes in this graph are factors).
 */

import { describe, expect, it } from 'vitest';

import { decideNoOpRecovery } from '../../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { findForbiddenPhraseHit } from '../../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';
import { hasMutationSignal } from '../../../../src/orchestrator-v5/routing/analytical-intent.js';
import {
  isEditClarifyTargetKind,
  selectEditClarifyTargets,
} from '../../../../src/orchestrator-v5/compose/edit-clarify-response.js';
import { NodeKindV3 } from '../../../../src/schemas/cee-v3.js';
import {
  RANK_ORDER,
  type TurnReferent,
  type TurnReferents,
} from '../../../../src/orchestrator-v5/context/turn-referents.js';

/** The witnessed message, verbatim. 41 characters. */
const WITNESSED_MESSAGE = 'Can you update it with the correct range?';

/** The reply the deployed build gave, verbatim. The banned outcome. */
const BANNED_RESET_TEXT =
  'I have not changed the model yet. Tell me what you want to change, '
  + 'and I will help apply it.';

const CLAIM_RANK = RANK_ORDER.indexOf('last_assistant_claim');

const FORBIDDEN_INTERNAL = /validator|dispatcher|\bpatch\b|\bschema\b|tool\s+call|\bnode\b|\bedge\b/i;
/** Em dash included: the copy contract forbids it. */
const FORBIDDEN_PRESCRIPTIVE = /\bwinner|\brecommend|—/i;

function referent(ref: string, label: string): TurnReferent {
  return {
    ref,
    kind: 'factor',
    label,
    introduced_by: 'last_assistant_claim',
    introduced_at_turn: 4,
    recency_rank: CLAIM_RANK,
    claim: {
      sentence: 'What would you like the sales headcount investment set to?',
      about: [ref],
      asserted_values: [],
      authored: 'llm',
    },
  };
}

const ONE_CANDIDATE: TurnReferents = {
  referents: [referent('node:919d7f50', 'Sales Headcount Investment')],
  source: 'complete',
};

const TWO_CANDIDATES: TurnReferents = {
  referents: [
    referent('node:919d7f50', 'Sales Headcount Investment'),
    referent('node:5a596708', 'MRR Growth'),
  ],
  source: 'complete',
};

const EMPTY_COMPLETE: TurnReferents = { referents: [], source: 'complete' };
const DEGRADED: TurnReferents = { referents: [], source: 'degraded' };

/**
 * ⚠ A DEGRADED REGISTER THAT NEVERTHELESS CARRIES AN ENTRY.
 *
 * This fixture exists because a mutant survived without it. Deleting the
 * `source !== 'degraded'` guard changed nothing observable, because the only
 * degraded fixture was also EMPTY — so the two conditions could not be told
 * apart and the guard was, on the evidence, asserting nothing.
 *
 * `projectTurnReferents` happens to return an empty list whenever it degrades,
 * so today's producer cannot emit this shape. The guard is not about today's
 * producer: `source` is the field that says whether the CONTENTS can be
 * trusted, and a caller that supplies a partially-read register must still get
 * a question rather than a confident bind. §4.2 is explicit — "0, **or**
 * `source: 'degraded'`" — so degraded ASKS regardless of what it contains.
 */
const DEGRADED_WITH_ENTRY: TurnReferents = {
  referents: [referent('node:919d7f50', 'Sales Headcount Investment')],
  source: 'degraded',
};

const BASE = {
  message: WITNESSED_MESSAGE,
  priorFacts: [],
  freshness: 'none' as const,
  graphReady: true,
};

describe('§4.2 outcome 1 — exactly one candidate BINDS, and discloses it', () => {
  it('names Sales Headcount Investment in the reply', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    expect(r.branch).toBe('anaphoric_edit_bound');
    // BIND BY IDENTITY: the exact label, not "contains a label".
    expect(r.assistantText).toContain('Sales Headcount Investment');
  });

  it('discloses the binding rather than acting silently, and asks', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    expect(r.assistantText).toContain('Taking that as');
    expect(r.assistantText).toContain('?');
  });

  it('discloses it in its OWN sentence, immediately after the mutation-status lead', () => {
    // ⚠ POSITION, not presence. The docstring on `buildAnaphoricBoundText` and
    // the PR body both describe WHERE the disclosure sits; a `toContain` cannot
    // hold that sentence to the copy. Split on sentence terminators and pin the
    // index: the lead is sentence 0, the disclosure is sentence 1, the question
    // is last. A reorder in either direction REDs here.
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    const sentences = (r.assistantText ?? '').split(/(?<=[.?!])\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    expect(sentences[0]).toBe('I have not changed the model yet.');
    expect(sentences[1]).toBe('Taking that as Sales Headcount Investment.');
    expect(sentences[sentences.length - 1]).toMatch(/\?$/);
  });

  it('offers the bound referent as a chip addressed by its node id', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    expect(r.suggestedActions).toHaveLength(1);
    const chip = r.suggestedActions[0]!;
    expect(chip.id).toBe('edit_clarify_919d7f50');
    expect(chip.label).toBe('Change Sales Headcount Investment');
    // ⚠ The submit message must NOT carry an EDIT_GRAPH_POSITIVE_REGEX verb, or
    // a click re-enters the V4 edit dispatch value-less and dead-ends in the
    // same loop. Inherited from the composer's own builder, not re-implemented.
    expect(chip.message).toBe('For Sales Headcount Investment, what value should we use?');
  });

  it('IS NOT THE RESET', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    expect(r.assistantText).not.toBe(BANNED_RESET_TEXT);
    expect(r.branch).not.toBe('vague_edit');
  });
});

describe('§4.2 outcome 2 — more than one candidate ASKS, and never binds', () => {
  it('asks, offering both candidates as chips', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: TWO_CANDIDATES });
    expect(r.branch).toBe('anaphoric_edit_ask_candidates');
    expect(r.assistantText).toContain('?');
    expect(r.suggestedActions.map((c) => c.label)).toEqual([
      'Change Sales Headcount Investment',
      'Change MRR Growth',
    ]);
  });

  it('does NOT pick one of them, in either direction', () => {
    // The discriminating half: a branch that silently bound the first candidate
    // would still "ask" and still ship chips. It must not assert a binding.
    const r = decideNoOpRecovery({ ...BASE, referents: TWO_CANDIDATES });
    expect(r.assistantText).not.toContain('Taking that as');
    expect(r.branch).not.toBe('anaphoric_edit_bound');
  });
});

describe('§4.2 outcome 3 — nothing to bind to ASKS, and says what it looked at', () => {
  const cases: readonly [string, TurnReferents | null | undefined][] = [
    ['an empty but authoritative register', EMPTY_COMPLETE],
    ['a degraded register', DEGRADED],
    ['a degraded register that still carries an entry', DEGRADED_WITH_ENTRY],
    ['no register supplied at all', undefined],
    ['an explicitly null register', null],
  ];

  for (const [name, register] of cases) {
    it(`asks for ${name}, and never resets`, () => {
      const r = decideNoOpRecovery({ ...BASE, referents: register });
      expect(r.branch).toBe('anaphoric_edit_ask_unresolved');
      expect(r.assistantText).toContain('?');
      expect(r.assistantText).not.toBe(BANNED_RESET_TEXT);
    });
  }

  it('a DEGRADED source is never trusted, even when it carries a lone candidate', () => {
    // The discriminating case. An empty-degraded register cannot distinguish
    // "we checked the source flag" from "the list happened to be empty"; this
    // one can. Without it the `source !== 'degraded'` guard asserts nothing.
    const r = decideNoOpRecovery({ ...BASE, referents: DEGRADED_WITH_ENTRY });
    expect(r.branch).toBe('anaphoric_edit_ask_unresolved');
    expect(r.assistantText).not.toContain('Taking that as');
    expect(r.assistantText).not.toContain('Sales Headcount Investment');
  });

  it('CONTRAST: the SAME lone candidate under a complete source DOES bind', () => {
    // Opposite-direction twin. Proves the refusal above is caused by `source`,
    // not by anything about the candidate itself.
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    expect(r.branch).toBe('anaphoric_edit_bound');
    expect(r.assistantText).toContain('Sales Headcount Investment');
  });

  it('says what it actually looked at, and claims nothing it did not', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: EMPTY_COMPLETE });
    expect(r.assistantText).toContain('what I last told you about');
    // ⚠ THE HONESTY HALF. Spec §4.2's example copy also offers "I looked at what
    // you have selected". The selection rank has NO producer in this build, so
    // saying it would be a notice whose truth condition the code does not meet.
    // When that producer lands, this assertion is what forces the copy to change
    // with it.
    expect(r.assistantText).not.toContain('selected');
  });
});

describe('THE BANNED OUTCOME — a reset is unreachable for an anaphoric edit', () => {
  const everyRegister: readonly (TurnReferents | null | undefined)[] = [
    ONE_CANDIDATE,
    TWO_CANDIDATES,
    EMPTY_COMPLETE,
    DEGRADED,
    null,
    undefined,
  ];

  /**
   * ⚠ THE MESSAGE IS VARIED, NOT JUST THE REGISTER (review finding, PR #1362).
   *
   * The first version of this test held `BASE.message` fixed and swept the
   * register, so it proved unreachability across REGISTER STATES only — it said
   * nothing about the thing that decides which branch is entered, which is the
   * MESSAGE. A predicate change could have re-admitted every one of these to
   * the reset and this test would have stayed green on all six registers.
   *
   * These messages are the ones this change MOVED, plus the witnessed one. They
   * are the covered set; the family that is NOT covered is pinned by name in
   * its own describe below, deliberately separate — an unreachability claim and
   * a known gap are two different claims and must not share one assertion.
   */
  const coveredAnaphoricMessages: readonly string[] = [
    WITNESSED_MESSAGE,
    'Change this.',
    'Adjust this.',
    'Improve this.',
    'Update it.',
    'Tweak that.',
    'Can you update it?',
    'Revise this.',
  ];

  it('every covered anaphoric message avoids the reset in every register state', () => {
    let cases = 0;
    for (const message of coveredAnaphoricMessages) {
      for (const referents of everyRegister) {
        const r = decideNoOpRecovery({ ...BASE, message, referents });
        expect(r.assistantText).not.toBe(BANNED_RESET_TEXT);
        expect(r.branch).not.toBe('vague_edit');
        // Asserting nothing and asking nothing is the failure mode being removed.
        expect(r.assistantText).toContain('?');
        expect(r.assistantText).not.toBeNull();
        cases += 1;
      }
    }
    // The loop is not vacuous, and it is the CROSS PRODUCT it claims to be.
    expect(cases).toBe(coveredAnaphoricMessages.length * everyRegister.length);
    expect(cases).toBe(48);
  });

  it('CONTRAST: a genuinely target-less edit still gets the vague-edit reset', () => {
    // The opposite-direction twin. If this went green only because the reset was
    // deleted everywhere, the fix would be a blanket removal wearing a fix's
    // clothes. The reset is correct copy for a message with no target.
    const r = decideNoOpRecovery({
      ...BASE,
      message: 'Update something.',
      referents: ONE_CANDIDATE,
    });
    expect(r.branch).toBe('vague_edit');
    expect(r.assistantText).toBe(BANNED_RESET_TEXT);
  });
});

describe('copy contract', () => {
  const texts = (): string[] =>
    [ONE_CANDIDATE, TWO_CANDIDATES, EMPTY_COMPLETE]
      .map((referents) => decideNoOpRecovery({ ...BASE, referents }).assistantText)
      .filter((t): t is string => t !== null);

  it('clears the runtime egress forbidden-phrase guard', () => {
    // By EXECUTION against the shipped guard, not by inspection. A denial like
    // "nothing changed" would make the egress layer replace the whole response.
    for (const t of texts()) {
      expect(findForbiddenPhraseHit(t)).toBeNull();
    }
    // Positive control: the guard is live and does bite. Without this, a guard
    // that silently matched nothing would "pass" every string above.
    expect(findForbiddenPhraseHit('Actually nothing changed here.')).not.toBeNull();
  });

  it('leaks no internal vocabulary and no em dashes', () => {
    for (const t of texts()) {
      expect(t).not.toMatch(FORBIDDEN_INTERNAL);
      expect(t).not.toMatch(FORBIDDEN_PRESCRIPTIVE);
    }
  });

  it('states mutation status positively and never quotes a raw id', () => {
    for (const t of texts()) {
      expect(t).toContain('I have not changed the model yet.');
      expect(t).not.toContain('919d7f50');
      expect(t).not.toContain('node:');
    }
  });
});

describe('the strings this change MOVED, pinned where they moved to', () => {
  // Three cases were pinned as `vague_edit` before this change: 'Change this.'
  // (edit-graph-no-op-recovery.test.ts) and 'Adjust this.' / 'Improve this.'
  // (analytical-intent.test.ts). Each is asserted false for the vague predicate
  // there and true here, so neither branch can quietly reclaim them and the move
  // cannot be undone by accident in one place only.
  for (const msg of ['Change this.', 'Adjust this.', 'Improve this.']) {
    it(`"${msg}" now reaches an anaphoric branch, never the reset`, () => {
      const r = decideNoOpRecovery({ ...BASE, message: msg, referents: ONE_CANDIDATE });
      expect(r.branch).toBe('anaphoric_edit_bound');
      expect(r.assistantText).not.toBe(BANNED_RESET_TEXT);
    });
  }
});

describe('branch precedence', () => {
  it('an anaphoric edit does not reach the vague-edit branch', () => {
    const r = decideNoOpRecovery({ ...BASE, referents: ONE_CANDIDATE });
    expect(r.branch).toBe('anaphoric_edit_bound');
  });

  it('a concrete edit reaches neither branch', () => {
    const r = decideNoOpRecovery({
      ...BASE,
      message: 'Can you update Sales Headcount Investment to 100000?',
      referents: ONE_CANDIDATE,
    });
    expect(r.branch).not.toBe('anaphoric_edit_bound');
    expect(r.branch).not.toBe('vague_edit');
  });

  it('a REFUSAL reaches neither branch', () => {
    // "Don't change it" is anaphoric in shape and a refusal in meaning. The
    // shared negation gate is what keeps it out of both.
    const r = decideNoOpRecovery({
      ...BASE,
      message: "Don't change it.",
      referents: ONE_CANDIDATE,
    });
    expect(r.branch).not.toBe('anaphoric_edit_bound');
    expect(r.branch).not.toBe('anaphoric_edit_ask_candidates');
    expect(r.branch).not.toBe('anaphoric_edit_ask_unresolved');
    expect(r.branch).not.toBe('vague_edit');
  });

  it('an already-preserved clarification is not clobbered', () => {
    // R10's inert-decision guarantee must survive the new branch.
    const r = decideNoOpRecovery({
      ...BASE,
      referents: ONE_CANDIDATE,
      noOpClarificationPreserved: true,
    });
    expect(r.branch).not.toBe('anaphoric_edit_bound');
    expect(r.assistantText).toBeNull();
  });
});

/**
 * ⭐ ELIGIBILITY — the bind must not reach a kind that cannot be edited.
 *
 * The branch offers its target through `buildLabelChip`, whose sibling
 * `selectEditClarifyTargets` admits `factor|option` ONLY. The first version of
 * this branch copied that function's 3-cap and left its eligibility filter
 * behind, so it bound an `outcome` and asked "what value would you like it set
 * to?" about a node whose value the user cannot set.
 *
 * Witnessed by replay against the 5 Sep founder capture: turn 8's assistant
 * message resolved to the `outcome` MRR Growth and BOUND it —
 * "Taking that as MRR Growth. What value would you like it set to?"
 *
 * The predicate is IMPORTED from the composer, so the two surfaces cannot
 * present different eligibility for the same question.
 */
describe('§4.2 eligibility — only kinds this product can offer as an edit target', () => {
  function referentOfKind(kind: TurnReferent['kind'], ref: string, label: string): TurnReferent {
    return { ...referent(ref, label), kind };
  }

  const INELIGIBLE = ['outcome', 'decision', 'risk', 'goal', 'action'] as const;
  const ELIGIBLE = ['factor', 'option'] as const;

  it('the two sets are disjoint and together cover NodeKindV3 (the sweep is not vacuous)', () => {
    // Positive control on the corpus itself: a sweep that quietly lost members
    // would report a clean pass over nothing.
    expect([...ELIGIBLE, ...INELIGIBLE].sort()).toEqual(
      [...NodeKindV3.options].sort(),
    );
  });

  it.each(INELIGIBLE)('a lone %s candidate is NOT bound — it asks instead', (kind) => {
    const r = decideNoOpRecovery({
      ...BASE,
      referents: {
        referents: [referentOfKind(kind, 'node:5a596708', 'MRR Growth')],
        source: 'complete',
      },
    });
    expect(r.branch).toBe('anaphoric_edit_ask_unresolved');
    // The banned outcome stays unreachable: filtering to zero still ASKS.
    expect(r.assistantText).not.toBe(BANNED_RESET_TEXT);
    expect(r.assistantText).toContain('?');
    // And it offers nothing it cannot honour.
    expect(r.suggestedActions).toEqual([]);
  });

  it.each(ELIGIBLE)('CONTRAST: a lone %s candidate IS bound', (kind) => {
    // The opposite-direction twin. Without it, a filter that rejected
    // everything would satisfy every assertion above.
    const r = decideNoOpRecovery({
      ...BASE,
      referents: {
        referents: [referentOfKind(kind, 'node:919d7f50', 'Sales Headcount Investment')],
        source: 'complete',
      },
    });
    expect(r.branch).toBe('anaphoric_edit_bound');
    expect(r.assistantText).toContain('Sales Headcount Investment');
    expect(r.suggestedActions.map((a) => a.id)).toEqual(['edit_clarify_919d7f50']);
  });

  it('an ineligible candidate is dropped from a MIXED set, not just from a lone one', () => {
    // Binds by identity. Two candidates before the filter, one after — so the
    // branch moves from ASK to BIND, and it binds the eligible one.
    const r = decideNoOpRecovery({
      ...BASE,
      referents: {
        referents: [
          referentOfKind('risk', 'node:428612e0', 'Runway Depletion Risk'),
          referentOfKind('factor', 'node:919d7f50', 'Sales Headcount Investment'),
        ],
        source: 'complete',
      },
    });
    expect(r.branch).toBe('anaphoric_edit_bound');
    expect(r.assistantText).toContain('Sales Headcount Investment');
    expect(r.assistantText).not.toContain('Runway Depletion Risk');
    expect(r.suggestedActions.map((a) => a.id)).toEqual(['edit_clarify_919d7f50']);
  });

  it('the chips offered on the ASK path are eligible kinds only', () => {
    const r = decideNoOpRecovery({
      ...BASE,
      referents: {
        referents: [
          referentOfKind('option', 'node:501e2731', 'ICP Validation Sprint Before Hiring'),
          referentOfKind('factor', 'node:919d7f50', 'Sales Headcount Investment'),
          referentOfKind('risk', 'node:428612e0', 'Runway Depletion Risk'),
        ],
        source: 'complete',
      },
    });
    expect(r.branch).toBe('anaphoric_edit_ask_candidates');
    expect(r.suggestedActions.map((a) => a.id)).toEqual([
      'edit_clarify_501e2731',
      'edit_clarify_919d7f50',
    ]);
  });

  it('the filter is the COMPOSER’s, not a copy — the predicate agrees with it', () => {
    // Derived agreement, not a second list: `selectEditClarifyTargets` and this
    // branch must admit the same kinds. Asserting the predicate against the
    // composer’s own behaviour is what makes the single-sourcing checkable.
    for (const kind of NodeKindV3.options) {
      const offered = selectEditClarifyTargets([
        { id: 'n1', label: 'Some Label', kind },
      ]);
      expect(offered.length > 0).toBe(isEditClarifyTargetKind(kind));
    }
  });
});

/**
 * ⭐ KNOWN NOT COVERED — the gap this change NARROWED but did not close, named
 * in the suite rather than left invisible.
 *
 * `ANAPHORIC_EDIT_PATTERNS` requires VERB–PRONOUN ADJACENCY (`update it`), so
 * the NOMINALISED form of the same request — `make a change to it`, `do an edit
 * on this` — is not recognised as anaphoric and still reaches the reset (or,
 * where a mutation signal fires, the `ambiguous` branch, which is the spec's
 * own "different bad answer, not a better one").
 *
 * ⚠ EXTENDING THE PATTERN WAS TRIED FIRST AND REJECTED, ON MEASUREMENT. Adding
 * the nominalised shape to `ANAPHORIC_EDIT_PATTERNS` would recover 96 of these
 * 120 messages. The other 24 — every `(change|update) to <pronoun>` form —
 * would NOT move, because `hasMutationSignal` fires on them and the anaphoric
 * branch is gated behind `!mutationSignal`. Reaching those needs a change to
 * the mutation-signal gate, i.e. an adjustment in the OPPOSITE direction, which
 * is where this estate's oscillating rounds come from (CLAUDE.md trap 22f). One
 * predicate change buying one direction and opening another is the signal to
 * stop and name the gap instead.
 *
 * ⚠ THIS SET IS A SAMPLED FLOOR OVER AN OPEN CLASS, never an enumeration of it.
 * English has more ways to refer than a generated family covers. What the
 * assertions below pin exactly is the partition of THIS corpus: they RED if it
 * GROWS (a covered case regressing into the gap) and they RED if it SHRINKS (a
 * later fix landing without updating the record).
 */
describe('KNOWN NOT COVERED — the nominalised anaphoric form still resets', () => {
  const VERBS = ['make', 'do'] as const;
  const NOUN_PHRASES = ['a change', 'an update', 'an edit', 'an adjustment', 'a tweak'] as const;
  const PREPOSITIONS = ['to', 'on'] as const;
  const PRONOUNS = ['it', 'this', 'that'] as const;

  /** Generated from the lists above, so the corpus is not a hand-typed mirror. */
  const FAMILY: readonly string[] = (() => {
    const out: string[] = [];
    for (const verb of VERBS) {
      for (const noun of NOUN_PHRASES) {
        for (const preposition of PREPOSITIONS) {
          for (const pronoun of PRONOUNS) {
            const core = `${verb} ${noun} ${preposition} ${pronoun}`;
            out.push(`${core.charAt(0).toUpperCase()}${core.slice(1)}.`);
            out.push(`Can you ${core}?`);
          }
        }
      }
    }
    return out;
  })();

  /**
   * The subset that reaches `ambiguous` rather than the reset, listed in full.
   * Every member is a `(change|update) to <pronoun>` form — the shape
   * `hasMutationSignal` fires on. Pinned as strings, not as a predicate, so the
   * record says WHICH sentences rather than restating the rule that produced
   * them.
   */
  const AMBIGUOUS_MEMBERS: readonly string[] = [
    'Can you do a change to it?',
    'Can you do a change to that?',
    'Can you do a change to this?',
    'Can you do an update to it?',
    'Can you do an update to that?',
    'Can you do an update to this?',
    'Can you make a change to it?',
    'Can you make a change to that?',
    'Can you make a change to this?',
    'Can you make an update to it?',
    'Can you make an update to that?',
    'Can you make an update to this?',
    'Do a change to it.',
    'Do a change to that.',
    'Do a change to this.',
    'Do an update to it.',
    'Do an update to that.',
    'Do an update to this.',
    'Make a change to it.',
    'Make a change to that.',
    'Make a change to this.',
    'Make an update to it.',
    'Make an update to that.',
    'Make an update to this.',
  ];

  function branchOf(message: string): string {
    return decideNoOpRecovery({ ...BASE, message, referents: ONE_CANDIDATE }).branch;
  }

  it('the generated corpus is the size it claims to be', () => {
    expect(FAMILY).toHaveLength(120);
    expect(new Set(FAMILY).size).toBe(120);
  });

  it('POSITIVE CONTROL: the covered form does reach an anaphoric branch', () => {
    // Without this, every assertion below would also pass if the whole feature
    // were broken and nothing anywhere reached an anaphoric branch.
    for (const message of ['Update it.', 'Change this.', 'Adjust that.']) {
      expect(branchOf(message)).toBe('anaphoric_edit_bound');
    }
  });

  it('PINNED: not one member of this family reaches an anaphoric branch', () => {
    const covered = FAMILY.filter((m) => branchOf(m).startsWith('anaphoric_'));
    expect(covered).toEqual([]);
  });

  it('PINNED: exactly where they land instead', () => {
    const counts: Record<string, number> = {};
    for (const message of FAMILY) {
      const branch = branchOf(message);
      counts[branch] = (counts[branch] ?? 0) + 1;
    }
    expect(counts).toEqual({ vague_edit: 96, ambiguous: 24 });
  });

  it('PINNED: the ambiguous subset, by name', () => {
    const ambiguous = FAMILY.filter((m) => branchOf(m) === 'ambiguous').sort();
    expect(ambiguous).toEqual([...AMBIGUOUS_MEMBERS].sort());
  });

  it('the cost is stated, not implied: the 96 ship the banned reset verbatim', () => {
    const r = decideNoOpRecovery({
      ...BASE,
      message: 'Do an edit on this.',
      referents: ONE_CANDIDATE,
    });
    expect(r.branch).toBe('vague_edit');
    expect(r.assistantText).toBe(BANNED_RESET_TEXT);
  });

  it('and the 24 get no copy at all', () => {
    const r = decideNoOpRecovery({
      ...BASE,
      message: 'Make a change to it.',
      referents: ONE_CANDIDATE,
    });
    expect(r.branch).toBe('ambiguous');
    expect(r.assistantText).toBeNull();
  });
});

/**
 * ⭐ KNOWN NOT COVERED, second class — the VALUE-BEARING anaphoric edit.
 *
 * The bound reply above asks "What value would you like it set to?", and the
 * natural answer carries a value: "Set it to 100000." / "Can you update it to
 * 100000?". Both carry a concrete mutation signal, and the anaphoric branch is
 * gated `!mutationSignal` — so the message the product's own question elicits
 * reaches NONE of §4.2's three outcomes at this layer and falls to `ambiguous`
 * (`assistantText: null`, the V4 handler's copy). This is the SAME gate that
 * blocks the 24 nominalised members above, and the same "different bad answer".
 *
 * Not fixed here, by design: the fix is spec §4.3 — admit the bare pronoun in
 * `deterministic-value-update.ts` under the register precondition — which is a
 * value-path change, not a recovery-branch change, and lands in its own PR.
 * Pinned so the suite REDs when it moves, exactly as the family above is.
 */
describe('KNOWN NOT COVERED — the value-bearing anaphoric edit reaches no §4.2 outcome here', () => {
  const VALUE_BEARING: readonly string[] = [
    'Can you update it to 100000?', // anaphoric by predicate AND a mutation signal
    'Set it to 100000.',            // `set` is not in the anaphoric verb list; mutation signal only
  ];

  it('POSITIVE CONTROL: the same request WITHOUT a value binds', () => {
    // Without this the pins below would also pass with the whole feature broken.
    for (const message of ['Can you update it?', 'Update it.']) {
      const r = decideNoOpRecovery({ ...BASE, message, referents: ONE_CANDIDATE });
      expect(r.branch, message).toBe('anaphoric_edit_bound');
    }
  });

  it('PRECONDITION: every member carries a mutation signal', () => {
    // The pin's cause, asserted in-test: if a later change to
    // `MUTATION_SIGNAL_PATTERNS` stopped firing on these, the pin below would
    // pass for a different reason and this is what says so.
    for (const message of VALUE_BEARING) {
      expect(hasMutationSignal(message), message).toBe(true);
    }
  });

  it('PINNED: with exactly one register candidate, each still lands on ambiguous / null', () => {
    for (const message of VALUE_BEARING) {
      const r = decideNoOpRecovery({ ...BASE, message, referents: ONE_CANDIDATE });
      expect(r.branch, message).toBe('ambiguous');
      expect(r.assistantText, message).toBeNull();
    }
  });
});
