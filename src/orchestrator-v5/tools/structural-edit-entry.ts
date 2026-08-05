/**
 * ROADMAP 2.474 (CEE leg) — ENTRY LOGIC for `propose_structural_edit`.
 *
 * "Rulebook first; if the rulebook does not CLAIM the utterance and the turn is
 * edit-shaped, the tool engages." This is the explicit second path that kills
 * the "four turns and nothing applies" dead-end — the one the 2.380 diagnosis
 * measured, where a user rephrases an edit three times and the deterministic
 * composer returns zero operations every time.
 *
 * ── AMENDMENT A9: WHAT COUNTS AS A "CLAIM" ─────────────────────────────────
 * A claim is the rulebook producing OPERATIONS — an op batch that goes on to
 * the gate, where it is applied or held. A regex match that ends in refusal,
 * in zero operations, or in a parameter failure is NOT a claim: the SAME turn
 * falls through to the tool. That is the load-bearing detail. A second path on
 * the NEXT turn is not a second path at all — it is the dead-end with an extra
 * step, because the user has to notice the failure and rephrase first.
 *
 * ── ⚠ "EDIT-SHAPED" IS INHERITED, NEVER RE-DERIVED ─────────────────────────
 * This module used to answer "is this edit-shaped?" itself, from two of
 * route-v2's regexes, and claimed to combine them "exactly as route-v2 combines
 * them". THAT CLAIM WAS FALSE AT THE BYTES: route-v2 combines THREE detectors
 * (`editVerbCandidate || configureOptionIntent || structuralRestructureIntent`)
 * under four shared suppressors, with the negative regex ANDed onto all three.
 * The divergence was not cosmetic — it UNDER-TRIGGERED on exactly the class
 * this row exists to rescue: `configureOptionIntent` is an edit-verb-FREE
 * candidate, so a configure-option turn reached dispatch, returned zero ops,
 * and was then refused entry with `not_edit_shaped` by a predicate that could
 * not see why it had been dispatched.
 *
 * The re-derivation was also structurally pointless: `dispatchEditGraph` has
 * ONE call site, gated on route-v2's `editIntentDetected`, which is strictly
 * stronger than anything this module could compute. So the second judgement
 * could only ever SUBTRACT — a hand-maintained mirror of a decision that had
 * already been made, in a module whose own header warns against mirrors.
 *
 * The answer is now an INPUT (`editIntentDetectedByRulebook`), supplied by the
 * caller that already holds it. It stays an explicit field rather than an
 * assumption because the second leg of this train (the V5 router path) enters
 * from somewhere route-v2's gate does not cover, and must state its own answer
 * deliberately rather than inherit this one by accident.
 *
 * ── ⚠ THE KILL SWITCH MUST NOT MAKE THINGS WORSE ───────────────────────────
 * The tool's entire safety story is the referee's hold: structural ops are held
 * for a confirm chip and nothing moves until the user says so. That routing
 * exists ONLY while `CEE_GRAPH_MANAGEMENT_MODE` resolves to 'live' — in
 * 'shadow' and 'off' the gate returns `blockApply: false` BY CONSTRUCTION.
 *
 * So without `holdSpineActive`, turning the mode DOWN would not have disabled
 * this tool; it would have removed its hold and left it AUTO-APPLYING
 * LLM-composed structural edits. A kill switch that makes the thing more
 * dangerous is worse than no kill switch. The tool therefore engages only where
 * the hold spine is live, which also makes the mode a real off-switch for the
 * capability — and keeps it inert in production, where 'live' is downgraded to
 * 'shadow' by the standing lockdown.
 *
 * This is not a new flag (doctrine: no env-var gates): it binds the tool to the
 * EXISTING mode that carries its guarantee, and that mode's repo default is
 * 'live', so the capability ships ON.
 */

/**
 * Does the referee's hold routing exist under this mode?
 *
 * ONLY 'live' routes verdicts. 'shadow' evaluates and emits telemetry but
 * returns `blockApply: false` by construction (the A3 CAS-observe pattern),
 * and 'off' does not evaluate at all — so under either, a structural batch
 * reaching the gate is APPLIED, not held.
 *
 * This lives here, next to the decision that consumes it, rather than as an
 * inline `=== 'live'` at the dispatch call site: the call site should read a
 * config value and pass it, not carry the judgement about what that value
 * MEANS for this tool's safety. An inline comparison there is invisible to
 * every test in this module and dies silently to a careless edit.
 */
export function holdSpineActiveForMode(mode: 'off' | 'shadow' | 'live'): boolean {
  return mode === 'live';
}

/** The rulebook outcome the entry decision reads. */
export interface RulebookOutcome {
  /** True when the deterministic composer refused the edit outright. */
  readonly wasRejected: boolean;
  /** The canonical operations it produced (absent / empty = produced none). */
  readonly operations?: readonly unknown[] | undefined;
}

/**
 * A9 — did the rulebook CLAIM this utterance?
 *
 * TRUE only when it produced at least one operation and did not refuse. Those
 * operations go to the gate, which applies or holds them: either way the
 * utterance is claimed and the tool must stay out of the turn (one entry seam
 * per turn — two composers racing for the same commit is the parity defect in
 * a different costume).
 *
 * FALSE for the three shapes the 2.380 dead-end is made of: a refusal, an
 * empty batch, and an absent batch. Note that `wasRejected` alone is not the
 * test — the measured dead-end returns `wasRejected: false` WITH zero
 * operations, so a predicate keyed on rejection would read "claimed" on the
 * exact turns this path exists to rescue.
 */
export function rulebookClaimedTurn(outcome: RulebookOutcome): boolean {
  if (outcome.wasRejected) return false;
  return (outcome.operations?.length ?? 0) > 0;
}

export interface StructuralEditEntryInput {
  /** The rulebook's result, read through {@link rulebookClaimedTurn}. */
  readonly rulebook: RulebookOutcome;
  /**
   * The rulebook's OWN edit-intent verdict for this turn, inherited from the
   * caller — never recomputed here (see the header). In the dispatch path this
   * is route-v2's `editIntentDetected`, which is the precondition of the only
   * call site.
   */
  readonly editIntentDetectedByRulebook: boolean;
  /**
   * True iff the referee's hold routing is live for this turn. False means the
   * hold this tool's safety story depends on would not exist, so the tool must
   * not run at all (see the header — a kill switch that removes the hold and
   * leaves the tool applying is worse than none).
   */
  readonly holdSpineActive: boolean;
  /**
   * True when a grounding table could be built from the STRICT persisted graph
   * (A5a). False when it could not — and then the tool does NOT engage: an
   * honest "I can't read your model" beats a tool call grounded in nothing.
   */
  readonly groundingAvailable: boolean;
  /**
   * Guard against re-entry: true once the tool has already composed on this
   * turn. Reject-don't-repair means exactly one tool composition per turn —
   * never a loop that keeps re-asking a model that just produced an ungrounded
   * batch.
   */
  readonly alreadyEngaged?: boolean;
}

export type StructuralEditEntryDecision =
  | { readonly engage: true }
  | {
      readonly engage: false;
      readonly reason:
        | 'hold_spine_inactive'
        | 'rulebook_claimed'
        | 'not_edit_shaped'
        | 'no_grounding'
        | 'already_engaged';
    };

/**
 * The entry decision. Order is deliberate and is itself the contract: the
 * safety gate, then re-entry, then the rulebook's claim, then intent, then
 * grounding. The hold spine comes FIRST because it is the only one of these
 * whose absence makes running the tool actively UNSAFE rather than merely
 * pointless; a claimed turn is never re-examined for intent (the rulebook
 * already owns it); and an unreadable model never reaches the model at all.
 */
export function decideStructuralEditEntry(
  input: StructuralEditEntryInput,
): StructuralEditEntryDecision {
  if (!input.holdSpineActive) {
    return { engage: false, reason: 'hold_spine_inactive' };
  }
  if (input.alreadyEngaged === true) {
    return { engage: false, reason: 'already_engaged' };
  }
  if (rulebookClaimedTurn(input.rulebook)) {
    return { engage: false, reason: 'rulebook_claimed' };
  }
  if (!input.editIntentDetectedByRulebook) {
    return { engage: false, reason: 'not_edit_shaped' };
  }
  if (!input.groundingAvailable) {
    return { engage: false, reason: 'no_grounding' };
  }
  return { engage: true };
}
