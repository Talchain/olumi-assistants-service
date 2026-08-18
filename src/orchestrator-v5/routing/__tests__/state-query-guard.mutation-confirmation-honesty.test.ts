/**
 * ⭐⭐⭐ A TURN THAT MADE NO MUTATION MUST NEVER SAY IT MADE ONE.
 *
 * ── THE DEFECT (composed journey witness, 18 Aug 2026, deployed CEE `4a513781`,
 *    `olumi-docs/feedback-2026-08-16/COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`
 *    LINK 6, VERBATIM) ────────────────────────────────────────────────────────
 *
 *   user:  "Why did you add a status quo option? I never mentioned one —
 *           where did that come from?"
 *   Olumi: "Updated Enterprise sales headcount and spend"
 *          (`llm_calls: 0`, `prompt_identity: []`, `graph_hash` UNCHANGED at
 *           `97285a72848128a3`, no write in the recorder)
 *
 * **The product asserted a mutation it did not make, on a turn that requested
 * none and produced none.** The prior build merely DECLINED the same phrasing
 * ("I don't have a record of recent edits in this conversation"). Declining is
 * unhelpful; claiming a change you did not make is a false statement about the
 * user's own model, and is strictly worse.
 *
 * ── THE FAULT PATH, DERIVED AT THE BYTES AND REPRODUCED BY EXECUTION ─────────
 * `tryStateQueryGuard`:
 *   1. `isStructureOriginQuestion` → **true** (`why did you …add`, and again on
 *      `where did …come from`).
 *   2. `FRESH_EDIT_BAIL_OUT_PATTERNS` → false (the `(?<!did\s+you\s+)`
 *      lookbehind suppresses the `add a status quo` hit).
 *   3. `recent_changes.length > 0` → **the origin arm DEFERS** to the
 *      session-edit arms.
 *   4. `STATE_QUERY_PATTERNS` `\bdid\s+you\s+(?:change|update|apply|add)\b`
 *      matches the substring inside the wh-question.
 *   5. → `with_recent_change`, `assistant_text = head.summary` = the PREVIOUS
 *      turn's mutation receipt, emitted bare.
 *
 * ── THE TWO FIXES, AND WHY THEY ARE DIFFERENT CLAIMS ─────────────────────────
 * **FIX 1 (unconditional, this file's `HONESTY-*`).** The readback arm quotes a
 * receipt written by a handler at the time of a PAST mutation, in the perfective
 * voice ("Updated X"). Emitted bare as a whole reply on a turn that wrote
 * nothing, that sentence is a present-tense claim, and it is false whatever
 * question reached the arm. The arm's input is
 * `Pick<ContextPack, 'recent_changes'>`, which is BY TYPE the projection of
 * `prior_facts`, and the guard runs before any handler and never mutates — so
 * "earlier in this session" is true by construction, not by inspection. The
 * summary stays VERBATIM (grounding is not weakened); only its attribution is
 * added.
 *
 * **FIX 2 (routing, this file's `ROUTE-*`).** The origin arm's blanket
 * `recent_changes.length > 0` deferral is narrowed to the case it was written
 * for. Deferring is right when the recorded change concerns THE ELEMENT BEING
 * ASKED ABOUT (trap 22f: genuinely ambiguous, do not guess). It is wrong when
 * the recorded change concerns a DIFFERENT element: "why did you add a status
 * quo option?" cannot be a question about "Enterprise sales headcount and
 * spend", and answering it with that receipt is the very defect the origin arm
 * was built to remove, reproduced one branch further in.
 *
 * ⚠ **THE ROUTING CONJUNCT IS A FACT ABOUT STATE, NOT ABOUT WORDING.** CEE #888
 * burned four rounds oscillating on one natural-language predicate (trap 22f),
 * and the ruling was that no further phrasing rule settles such a thing. Nothing
 * is added to any phrase list here. The new conjunct asks: *does a recorded
 * mutation target the element this question resolves to?* — resolved by the
 * existing identity-binding resolver, compared against the persisted
 * `RecentMutation.target_label`.
 *
 * ⚠ AND THE MEASURED TRAP AVOIDED: `isAnalyticalQuestion` is constant-false over
 * this seam's input class (already derived in `structure-origin-answer.ts`'s
 * header), so it is not reached for. `ROUTE-DISCRIMINATES` below is the positive
 * control proving the predicate this lane DOES reach for actually discriminates
 * on these inputs, in both directions.
 *
 * ⭐ THE LEAD QUESTION, ASKED OF THIS FIX ITSELF: *could it be another instance
 * of the defect class it removes — a guard substituting its own canned answer
 * for the user's question?*
 *   · FIX 1 substitutes nothing. It adds a true attribution to the SAME persisted
 *     content, and `HONESTY-GROUNDED` pins that the receipt survives verbatim.
 *   · FIX 2 substitutes nothing either: where it stops the readback it either
 *     answers from the element's OWN persisted provenance record, or DECLINES to
 *     the reasoning layer. `ROUTE-DECLINES-NEVER-CANNED` pins that no boilerplate
 *     is minted on the decline path, and `TWIN-SYNONYM` pins that the phrasing
 *     which already works is still handed to the reasoning layer untouched.
 */
import { describe, expect, it } from 'vitest';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { RecentMutation } from '../../context/recent-changes.js';
import { tryStructureOriginAnswer } from '../../../cee/context-integrity/structure-origin-answer.js';
import {
  RECENT_CHANGE_RECORD_PREFIX,
  isStateQueryQuestionShape,
  tryStateQueryGuard,
} from '../state-query-guard.js';

// ── THE CAPTURED TURN ───────────────────────────────────────────────────────
// Verbatim from the witness's wire-verified request body. The rendered DOM in
// the same capture shows a HYPHEN where the request body carries an EM DASH, so
// both transports are exercised: a fix that only closes one of them has not
// closed what the user typed.
const WITNESS_MESSAGE_EM_DASH =
  'Why did you add a status quo option? I never mentioned one — where did that come from?';
const WITNESS_MESSAGE_HYPHEN =
  'Why did you add a status quo option? I never mentioned one - where did that come from?';

// The phrasing ONE SYNONYM AWAY that the same capture proves already works: it
// reaches the reasoning layer (`llm_calls: 1`) and returns the best provenance
// answer witnessed on either build. It must keep reaching the reasoning layer.
const WITNESS_SYNONYM =
  "What is the status quo option based on? I don't remember mentioning it in my brief.";

/**
 * The reply the product actually emitted, VERBATIM. Reproduced as a
 * `graph_edited` projection because that is the branch whose `summary` is the
 * fact's `safe_summary` quoted verbatim (`recent-changes.ts:84-92`) — the only
 * branch that can produce this exact string. `formatFactorChange` would have
 * produced "Updated X from 0.5 to 0.8." (61 chars, under the 80-char cap, so
 * not a truncation of one either). `SUMMARY_SHAPES` below re-runs the honesty
 * invariant over the derived shapes as well, so nothing here rests on this one
 * reconstruction.
 */
const WITNESSED_CHANGE: RecentMutation = {
  action: 'graph_edited',
  summary: 'Updated Enterprise sales headcount and spend',
  target_label: 'Enterprise sales headcount and spend',
};

/**
 * The persisted V3 graph shape — a display-enum `provenance` string, NOT the
 * records dict (`schema-v3.ts:1136`; the guard reads `context.persistedGraph`,
 * i.e. the `scenarios.graph` column). Nodes and labels taken from the witness's
 * own graph readout at LINK 2 / LINK 6.
 */
const WITNESS_GRAPH_NO_QUOTE = {
  nodes: [
    {
      id: 'e405d56a',
      kind: 'option',
      label: 'Status Quo: Hold current strategy',
      provenance: 'ai_inferred',
    },
    {
      id: '4abad64d',
      kind: 'option',
      label:
        'double down on enterprise sales (higher margins but longer cycles and more headcount)',
      provenance: 'from_brief',
      source_quote:
        'double down on enterprise sales (higher margins but longer cycles and more headcount)',
    },
    {
      id: '3a75cabd',
      kind: 'factor',
      label: 'Enterprise sales headcount and spend',
      provenance: 'ai_inferred',
    },
  ],
  edges: [],
};

/**
 * ⚠ THE SAME GRAPH WITH A RECORDED `source_quote` ON THE CHALLENGED NODE.
 *
 * The witness reports the node's `provenance` (`ai_inferred`) but does NOT
 * report whether it carries a `source_quote`, and `composeAnswer` DECLINES on
 * `ai_inferred` + a recorded quote (the enum's catch-all ambiguity). So which
 * sub-case production is in is UNMEASURED, and a fixture I wrote is not evidence
 * about the wire (trap 16-inverse). Both sub-cases are therefore exercised, and
 * the invariant under test is the one that holds over BOTH: **the turn never
 * receives the mutation readback.** One resolves to a deterministic provenance
 * answer, the other to a decline into the reasoning layer; both are correct, and
 * neither can assert a change.
 */
const WITNESS_GRAPH_WITH_QUOTE = {
  ...WITNESS_GRAPH_NO_QUOTE,
  nodes: WITNESS_GRAPH_NO_QUOTE.nodes.map((n) =>
    n.id === 'e405d56a' ? { ...n, source_quote: 'hold current strategy' } : n,
  ),
};

function ctx(recent: readonly RecentMutation[]): Pick<ContextPack, 'recent_changes'> {
  return { recent_changes: recent };
}

// ============================================================================
// FIX 1 — UNCONDITIONAL. A bare mutation confirmation is never the whole reply.
// ============================================================================

/**
 * Derived over a corpus of summary SHAPES rather than one witnessed string, so
 * the invariant is written against the SPEC ("a receipt is never emitted bare")
 * and not against the failure mode in hand (trap 13d).
 */
const SUMMARY_SHAPES: readonly RecentMutation[] = [
  WITNESSED_CHANGE,
  {
    action: 'factor_value_updated',
    summary: 'Updated Enterprise sales headcount and spend from 0.5 to 0.8.',
    target_label: 'Enterprise sales headcount and spend',
  },
  {
    action: 'constraint_added',
    summary: 'Added constraint: Total cost must be at most £50,000.',
    target_label: 'Total cost',
  },
  {
    action: 'link_strength_updated',
    summary: 'Strengthened the Hiring Cost → Budget Overrun Risk edge from 0.5 to 0.7.',
    target_label: 'Hiring Cost',
  },
  {
    // Cap-truncated shape: `cap()` closes with `…`, which is terminal
    // punctuation and must not acquire a second full stop.
    action: 'graph_edited',
    summary: `Updated ${'a'.repeat(60)} and some other very long thing indee…`,
    target_label: 'a'.repeat(60),
  },
];

// Every message here is a genuine READBACK question the guard legitimately owns
// — this is the arm working as designed, not the misroute.
const READBACK_MESSAGES: readonly string[] = [
  'What changed?',
  'What just changed?',
  'What update did you make?',
  'Did you add the cost constraint?',
];

describe('FIX 1 — a turn that made no mutation never emits a bare mutation confirmation', () => {
  for (const change of SUMMARY_SHAPES) {
    for (const message of READBACK_MESSAGES) {
      it(`HONESTY-BARE the receipt is never the opening words of the reply [${change.action}] "${message}"`, () => {
        const outcome = tryStateQueryGuard({ message, contextPack: ctx([change]) });
        // Precondition pinned in-test: this message MUST reach the readback arm,
        // or the assertion below is vacuous (trap 13b).
        expect(outcome.matched).toBe(true);
        if (!outcome.matched) return;
        expect(outcome.dispatch).toBe('with_recent_change');
        if (outcome.dispatch !== 'with_recent_change') return;

        // ⭐ THE HARM: the reply opens with a perfective mutation receipt, so it
        // reads as a claim about THIS turn.
        expect(outcome.assistant_text.startsWith(change.summary)).toBe(false);
        // And it is attributed to the record, not to now.
        expect(outcome.assistant_text.startsWith(RECENT_CHANGE_RECORD_PREFIX)).toBe(true);
      });

      it(`HONESTY-GROUNDED the persisted receipt survives VERBATIM [${change.action}] "${message}"`, () => {
        // ⭐ OPPOSITE DIRECTION (trap 22b). A fix that made the sentence true by
        // dropping the grounded content would pass HONESTY-BARE and destroy the
        // capability. The receipt must still be there, byte for byte.
        const outcome = tryStateQueryGuard({ message, contextPack: ctx([change]) });
        expect(outcome.matched).toBe(true);
        if (!outcome.matched || outcome.dispatch !== 'with_recent_change') return;
        expect(outcome.assistant_text).toContain(change.summary);
      });
    }
  }

  it('HONESTY-NO-DOUBLE-STOP a receipt already ending in terminal punctuation does not acquire a second one', () => {
    for (const change of SUMMARY_SHAPES) {
      const outcome = tryStateQueryGuard({
        message: 'What changed?',
        contextPack: ctx([change]),
      });
      if (!outcome.matched || outcome.dispatch !== 'with_recent_change') {
        throw new Error(`precondition failed for ${change.action}`);
      }
      expect(outcome.assistant_text).not.toMatch(/[.!?…][.!?]/u);
    }
  });

  it('HONESTY-MULTI the multi-change tail still follows a properly terminated sentence', () => {
    const outcome = tryStateQueryGuard({
      message: 'What changed?',
      contextPack: ctx([WITNESSED_CHANGE, SUMMARY_SHAPES[2]!]),
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched || outcome.dispatch !== 'with_recent_change') return;
    expect(outcome.assistant_text).toContain(WITNESSED_CHANGE.summary);
    expect(outcome.assistant_text).toContain('just ask.');
    // The witnessed receipt carries no trailing stop; the tail must not be
    // welded onto it.
    expect(outcome.assistant_text).not.toContain('spend If you want');
  });
});

// ============================================================================
// FIX 2 — ROUTING. The origin question stops being answered with a receipt.
// ============================================================================

describe('FIX 2 — the captured provenance challenge never receives a mutation confirmation', () => {
  const TRANSPORTS: readonly (readonly [string, string])[] = [
    ['em dash (wire body)', WITNESS_MESSAGE_EM_DASH],
    ['hyphen (rendered DOM)', WITNESS_MESSAGE_HYPHEN],
  ];
  const GRAPHS: readonly (readonly [string, unknown])[] = [
    ['challenged node carries no source_quote', WITNESS_GRAPH_NO_QUOTE],
    ['challenged node carries a recorded source_quote', WITNESS_GRAPH_WITH_QUOTE],
  ];

  for (const [transportName, message] of TRANSPORTS) {
    for (const [graphName, graph] of GRAPHS) {
      it(`ROUTE-NO-RECEIPT the turn is never dispatched as a mutation readback [${transportName}] [${graphName}]`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctx([WITNESSED_CHANGE]),
          briefAudit: { briefText: 'We are a Series A healthtech startup...', graph },
        });
        if (outcome.matched) {
          expect(outcome.dispatch).not.toBe('with_recent_change');
        }
      });

      it(`ROUTE-NO-FALSE-CLAIM the reply never contains the previous turn's receipt [${transportName}] [${graphName}]`, () => {
        // ⭐ THE HARM, ASSERTED AT THE STRING THE USER SAW. Independent of which
        // dispatch is chosen: no answer to this turn may carry that sentence.
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctx([WITNESSED_CHANGE]),
          briefAudit: { briefText: null, graph },
        });
        if (outcome.matched) {
          expect(outcome.assistant_text).not.toContain(WITNESSED_CHANGE.summary);
          expect(outcome.assistant_text).not.toContain('Updated Enterprise sales');
        }
      });
    }
  }

  it('ROUTE-HANDS-TO-REASONING the turn goes where its own neighbouring phrasing already goes', () => {
    // ⭐⭐ THE CHOSEN OUTCOME, AND WHY IT IS A DECLINE RATHER THAN A DETERMINISTIC
    // ANSWER. The deterministic arm COULD answer this message — asserted on the
    // next line, so this is a deliberate choice and not an accidental failure to
    // resolve (trap 13b: pin your own precondition, or the assertion is vacuous).
    expect(
      tryStructureOriginAnswer(WITNESS_MESSAGE_EM_DASH, WITNESS_GRAPH_NO_QUOTE),
    ).not.toBeNull();
    // But taking it would substitute a one-line canned sentence for the answer
    // the reasoning layer gives — which the same capture graded "the best
    // provenance answer witnessed on either build". Extending a guard's canned
    // copy over a witnessed-good answer IS the defect class this lane removes,
    // so the interception is deleted and the answer is left where it works.
    for (const graph of [WITNESS_GRAPH_NO_QUOTE, WITNESS_GRAPH_WITH_QUOTE]) {
      const outcome = tryStateQueryGuard({
        message: WITNESS_MESSAGE_EM_DASH,
        contextPack: ctx([WITNESSED_CHANGE]),
        briefAudit: { briefText: null, graph },
      });
      expect(outcome.matched).toBe(false);
    }
  });

  it('ROUTE-1033-UNTOUCHED with nothing on record, the deterministic provenance answer still fires', () => {
    // ⭐ OPPOSITE DIRECTION. Declining in the deferral branch must not have
    // killed #1033's arm, which owns the SAME question when no mutation is
    // recorded. A fix that silenced both would pass every assertion above.
    for (const message of [WITNESS_MESSAGE_EM_DASH, WITNESS_MESSAGE_HYPHEN, WITNESS_SYNONYM]) {
      const outcome = tryStateQueryGuard({
        message,
        contextPack: ctx([]),
        briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
      });
      expect(outcome.matched).toBe(true);
      if (!outcome.matched) continue;
      expect(outcome.dispatch).toBe('structure_origin');
      expect(outcome.assistant_text).toContain('Status Quo: Hold current strategy');
      expect(outcome.assistant_text.toLowerCase()).toContain('my suggestion');
    }
  });

  it('ROUTE-DECLINES-NEVER-CANNED the decline is a genuine fall-through, minting no boilerplate', () => {
    // It must never become a canned reply — that would rebuild the defect class
    // one layer further in. `matched: false` is the only shape that carries no
    // text at all, which is why it is asserted rather than a copy predicate.
    const outcome = tryStateQueryGuard({
      message: WITNESS_MESSAGE_EM_DASH,
      contextPack: ctx([WITNESSED_CHANGE]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_WITH_QUOTE },
    });
    expect(outcome.matched).toBe(false);
  });

  it('ROUTE-NO-GRAPH a degraded persisted read declines rather than falling back to the receipt', () => {
    // `context.persistedGraph` is null on a degraded read. Previously this fell
    // straight through to the readback arm and produced the false claim.
    const outcome = tryStateQueryGuard({
      message: WITNESS_MESSAGE_EM_DASH,
      contextPack: ctx([WITNESSED_CHANGE]),
      briefAudit: { briefText: null, graph: null },
    });
    expect(outcome.matched).toBe(false);
  });
});

// ============================================================================
// ⭐ THE POSITIVE CONTROL — the new conjunct genuinely discriminates, both ways.
// ============================================================================

describe('ROUTE-DISCRIMINATES the deferral conjunct is a real discrimination on THIS seam’s inputs', () => {
  const SAME_SUBJECT: RecentMutation = {
    action: 'graph_edited',
    summary: 'Updated Status Quo: Hold current strategy',
    target_label: 'Status Quo: Hold current strategy',
  };

  it('pins its own precondition: the origin arm COULD answer this message either way', () => {
    // Without this, a deferral that never fires and an origin arm that cannot
    // answer are indistinguishable, and both branches below pass vacuously
    // (trap 13b — exactly how the previous deferral test passed a mutant).
    expect(
      tryStructureOriginAnswer(WITNESS_MESSAGE_EM_DASH, WITNESS_GRAPH_NO_QUOTE),
    ).not.toBeNull();
  });

  it('DIFFERENT element recorded → no deferral; the turn reaches the reasoning layer', () => {
    const outcome = tryStateQueryGuard({
      message: WITNESS_MESSAGE_EM_DASH,
      contextPack: ctx([WITNESSED_CHANGE]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(false);
  });

  it('SAME element recorded → still defers to the grounded readback (trap 22f preserved)', () => {
    const outcome = tryStateQueryGuard({
      message: WITNESS_MESSAGE_EM_DASH,
      contextPack: ctx([SAME_SUBJECT]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('with_recent_change');
    // …and even here, the receipt is attributed, never asserted as fresh.
    expect(outcome.assistant_text.startsWith(RECENT_CHANGE_RECORD_PREFIX)).toBe(true);
  });
});

// ============================================================================
// OPPOSITE-DIRECTION TWINS — everything the guard legitimately protects.
// ============================================================================

describe('TWIN: what must keep working, unchanged', () => {
  const ADD_CONSTRAINT_50K: RecentMutation = {
    action: 'constraint_added',
    summary: 'Added constraint: Total cost must be at most £50,000.',
    target_label: 'Total cost',
  };

  it('TWIN-SYNONYM the phrasing that already works still reaches the reasoning layer', () => {
    // ⭐ The capability is PRESENT one synonym away and this lane must not
    // capture it. `llm_calls: 1` on the witness = the guard declined.
    const outcome = tryStateQueryGuard({
      message: WITNESS_SYNONYM,
      contextPack: ctx([WITNESSED_CHANGE]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(false);
  });

  it('TWIN-READBACK "What changed?" still gets the grounded recent-change answer', () => {
    const outcome = tryStateQueryGuard({
      message: 'What changed?',
      contextPack: ctx([ADD_CONSTRAINT_50K]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('with_recent_change');
    expect(outcome.assistant_text).toContain('£50,000');
  });

  it('TWIN-DID-YOU "Did you add the cost constraint?" still gets the readback', () => {
    const outcome = tryStateQueryGuard({
      message: 'Did you add the cost constraint?',
      contextPack: ctx([ADD_CONSTRAINT_50K]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('with_recent_change');
  });

  it('TWIN-NO-EDITS the honest no-record copy is unchanged when nothing is on record', () => {
    const outcome = tryStateQueryGuard({ message: 'Did you add it?', contextPack: ctx([]) });
    expect(outcome.matched).toBe(true);
    if (!outcome.matched) return;
    expect(outcome.dispatch).toBe('no_recent_changes');
  });

  it('TWIN-WARRANT a question is still never granted a mutation warrant', () => {
    // ⭐ THE ORIGINAL GUARD'S GENUINE PROTECTION: "did you change it?" must not
    // route into `edit_graph` and mutate the thing it asked about.
    // `mutation-warrant.ts` reads this predicate.
    expect(isStateQueryQuestionShape(WITNESS_MESSAGE_EM_DASH)).toBe(true);
    expect(isStateQueryQuestionShape(WITNESS_MESSAGE_HYPHEN)).toBe(true);
    expect(isStateQueryQuestionShape('Did you change it?')).toBe(true);
    expect(isStateQueryQuestionShape('What changed?')).toBe(true);
  });

  it('TWIN-FRESH-EDIT a fresh edit imperative is still not claimed', () => {
    const outcome = tryStateQueryGuard({
      message: 'add a constraint about cost being below 50000',
      contextPack: ctx([WITNESSED_CHANGE]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(false);
  });

  it('TWIN-COMPOUND a compound origin+edit turn still falls through to normal routing', () => {
    const outcome = tryStateQueryGuard({
      message: 'Why did you add a status quo option? Add another option for partnerships.',
      contextPack: ctx([WITNESSED_CHANGE]),
      briefAudit: { briefText: null, graph: WITNESS_GRAPH_NO_QUOTE },
    });
    expect(outcome.matched).toBe(false);
  });
});
