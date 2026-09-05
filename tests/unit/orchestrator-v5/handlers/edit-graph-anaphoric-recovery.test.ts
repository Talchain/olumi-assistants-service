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

  it('never returns the reset text, and always asks, across every register state', () => {
    for (const referents of everyRegister) {
      const r = decideNoOpRecovery({ ...BASE, referents });
      expect(r.assistantText).not.toBe(BANNED_RESET_TEXT);
      expect(r.branch).not.toBe('vague_edit');
      // Asserting nothing and asking nothing is the failure mode being removed.
      expect(r.assistantText).toContain('?');
      expect(r.assistantText).not.toBeNull();
    }
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
