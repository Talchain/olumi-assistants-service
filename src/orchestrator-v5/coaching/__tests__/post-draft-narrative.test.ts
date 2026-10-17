/**
 * Tests for `buildPostDraftNarrative` — the deterministic post-draft
 * coaching gated-hybrid composer.
 */
import { describe,expect,it } from 'vitest';
// ⭐ DERIVED, not re-spelled: the ask's format hint has ONE owner
// (`routing/missing-value-answer.ts`), so a change to it re-runs these
// assertions rather than leaving a stale copy here (trap 12).

import { UNAUTHORED_DECISION_LABEL } from '../../../cee/draft/records/objective-label.js';









/** An edge from a factor to the goal, pushing it one way. */


/** Any edge, so an INDIRECT path can be built. */


/**
 * An intermediate node, so a factor can reach the goal by more than one route.
 *
 * ⚠ `outcome`, NOT `factor`, and that is load-bearing for these cases. My first
 *   fixture made it a factor, which gave it a direct goal edge of its own — so
 *   it became a legitimate trade-off candidate and the "indirect-only" case
 *   failed for the right reason. The composer collects `option`, `factor` and
 *   `risk`; an `outcome` can carry a path without competing to be named.
 */


/**
 * Helper: most tests only care about the rendered `text` field of the
 * builder result. Kept as a thin adapter so the existing assertions
 * remain readable.
 */




/**
 * ⚠ `provenance: 'from_brief'` IS NOT DECORATION — it is what the producer
 * stamps on a goal genuinely taken from the user's brief, and it is what the
 * opener's quotation gate reads. A goal fixture without it is a shape the
 * projector never emits (it always stamps a verdict), and a suite built on
 * such fixtures certified a gate that fired 0 times out of 6 on the wire.
 * See `tests/unit/cee.goal-inference-attribution.test.ts` for both directions
 * driven through the real projector.
 */















// ───────────────────────────────────────────────────────────────────────
// Gated-hybrid composer — strengthen / bias_finding / coaching_bias_signal
// source priority and `coachingSummary` whole-response replacement.
// ───────────────────────────────────────────────────────────────────────







// ───────────────────────────────────────────────────────────────────────
// validateUncertaintyDriver — explicit pass/fail fixtures.
// Pure heuristic; no graph context required.
// ───────────────────────────────────────────────────────────────────────



// ============================================================================
// Scope A — multi-point coaching + widening_log delivery
// ============================================================================






/** Assert the rendered text survives BOTH egress guards and the clean-copy
 *  helper — proving new copy never trips success-claim / forbidden-phrase
 *  detection and leaks no IDs / internal labels. */










// ============================================================================
// RC4 proportionate remedies (2026-07-15 session RCA) — the em-dash STYLE
// offence must never cost the user the drafted coaching summary. Live
// evidence: turn 1 of the session generated a good coaching summary that the
// gate killed for a single em dash (`coaching_summary_passed_gate:false,
// reject_reason:"em_dash"` → strengthen_item_label fallback). The remedy is
// now an in-place deterministic rewrite; the summary SHIPS.
// This asserts through the real composition path (`buildPostDraftNarrative`
// is what draft-graph-dispatch renders as final user-visible text).
// ============================================================================



/**
 * ⭐⭐ COPY HONESTY WHEN NO DECISION COULD BE DERIVED FROM THE BRIEF.
 *
 * MEASURED DEFECT: three open strategic briefs — each explicitly disclaiming a
 * choice between fixed options — were each organised as 1 `decision` node +
 * 3-5 `option` nodes, and the narrative asserted "I've built a first decision
 * model from your brief" above an "Options compared" block. The MODEL SHAPE is
 * an architectural constraint (`DRAFT_RECORD_STATED_KINDS` has no vocabulary
 * for "a thing under consideration" other than `option`, and a decision-free
 * model is not expressible — `graph-validator.ts:348-382` raises
 * `MISSING_DECISION` at error severity). That is NOT fixed here. What is fixed
 * is the CLAIM ABOUT the model, which was false.
 *
 * ⚠ THE GATE IS `node.label_authored`, NOT `provenance.label_authored`.
 * The projector writes `provenance.label_authored` as an OBJECT field
 * (`projector.ts:3255-3262`), but `NodeV3.provenance` is a bare STRING ENUM
 * (`schemas/cee-v3.ts:255`) and `NodeV3` STRIPS undeclared keys. The object is
 * flattened by `projectNodeProvenance` (`transforms/schema-v3.ts:1183`), which
 * LIFTS the flag to node level, where `NodeV3` declares it
 * (`cee-v3.ts:284`) and it survives to this builder. Reading
 * `provenance.label_authored` here would read a property off a string and get
 * `undefined` on EVERY draft — the gate would fire on all of them, converting
 * "always decides" into "always hedges". Two same-named flags at two levels;
 * the pin below is what stops that distinction rotting.
 */
describe('provisional-decision framing (open brief)', () => {



  /**
   * PRECONDITION PIN (trap 13b). This gate is only meaningful if the producer
   * actually delivers `label_authored` AT NODE LEVEL. If a refactor moved it
   * back under `provenance`, or `NodeV3` stopped declaring it, every gate below
   * would silently read `undefined` and the provisional framing would ship on
   * every draft — with no red anywhere. This asserts the lift, in BOTH
   * directions, so the discrimination itself is pinned rather than assumed.
   */
  it('PIN: the v3 producer lifts provenance.label_authored to node level', async () => {
    const { projectGraphAndOptionsToV3 } = await import('../../../cee/transforms/schema-v3.js');
    const decisionRecord = (authored: boolean) => ({
      id: 'dec1',
      kind: 'decision',
      label: authored ? 'Build our own fleet or partner with couriers' : UNAUTHORED_DECISION_LABEL,
      provenance: {
        provenance_class: 'projector_structural',
        source_quote: 'structural',
        ...(authored ? { label_authored: true } : {}),
      },
    });
    const project = (authored: boolean) => {
      const out = projectGraphAndOptionsToV3(
        { nodes: [decisionRecord(authored)], edges: [] } as never,
        {},
      ) as { graph: { nodes: ReadonlyArray<Record<string, unknown>> } };
      return out.graph.nodes.find((n) => n.kind === 'decision');
    };

    // Authored: the flag arrives at NODE level, and `provenance` has collapsed
    // to the bare string enum — the exact shape this builder reads.
    const authored = project(true);
    expect(authored?.label_authored).toBe(true);
    expect(typeof authored?.provenance).toBe('string');

    // Contrast control: unauthored produces NO flag, so absence is a real
    // signal and not merely a field this probe cannot see.
    expect(project(false)?.label_authored).toBeUndefined();
  });





  /**
   * ⭐ THE OVER-CORRECTION CONTROL. Without this, an "honest" fix that simply
   * degrades EVERY draft to the hedged wording is indistinguishable from a
   * correct one. A genuine decision must be completely untouched.
   */


  /**
   * ⭐⭐ THE CONTROL THIS LANE ORIGINALLY LACKED, AND THE ONE THAT MATTERED.
   *
   * The first cut gated on `label_authored` ALONE. That is not the producer's
   * signature for "could not derive a decision" — it is merely the absence of a
   * RESPONSE-ONLY field, which a hand-built, user-edited or round-tripped graph
   * will also lack while carrying a perfectly good decision. On such a graph the
   * "honest" fix told the user *"I couldn't pin down a single decision in your
   * brief"* about a decision node reading "Launch product?" — swapping one false
   * claim for another.
   *
   * It was caught by an existing integration fixture, NOT by this file: the
   * over-correction control below sets `label_authored: true` explicitly, so it
   * was structurally incapable of observing this class. A control that pins only
   * the shape you imagined is a guard agreeing with itself.
   */


  /**
   * DERIVED PIN AGAINST THE MIRROR (trap 12). `UNAUTHORED_DECISION_LABEL` is a
   * copy of the producer's fallback literal. A copy that nothing checks is the
   * hand-maintained mirror this estate keeps paying for — so ask the producer
   * itself. If `deriveDecisionLabel` ever returns a different placeholder, this
   * REDs instead of the gate silently never firing again.
   */
  it('PIN: the gate\'s placeholder matches what deriveDecisionLabel emits', async () => {
    const { deriveDecisionLabel } = await import(
      '../../../cee/draft/records/objective-label.js'
    );
    const declined = deriveDecisionLabel({
      brief: 'Our burn rate is too high and the team is stretched thin.',
      goalQuotes: [],
    });
    // Contrast control: a brief that DOES pose a choice must author a label,
    // otherwise this pin would pass against a producer that authored nothing.
    const authored = deriveDecisionLabel({
      brief: 'We are deciding whether to build our own fleet or partner with third-party couriers.',
      goalQuotes: [],
    });
    expect(authored.authored).toBe(true);

    expect(declined.authored).toBe(false);
    expect(declined.label).toBe(UNAUTHORED_DECISION_LABEL);
  });

  /**
   * ⭐⭐ THE KNOWN-DROPPED SET, PINNED AS AN EXACT SET OVER A NAMED CORPUS.
   *
   * This lane's gate reads the producer's "I declined to author" signature. It
   * therefore cannot see a brief whose disclaimer or exploratory framing is
   * itself run through the sentence-stripper into a confident label: those set
   * `label_authored` AND carry a non-placeholder label, so they are
   * indistinguishable here BY CONSTRUCTION. The honest fix is upstream, in
   * `deriveDecisionLabel` (`objective-label.ts`), and is deliberately not
   * attempted here.
   *
   * ⚠ WHY A SET AND NOT A CASE. The first version of this pin held ONE member
   * (the negated disclaimer) and asserted it in prose. An independent 36-brief
   * corpus then found a SECOND member the pin was structurally unable to see,
   * because it arrives by a DIFFERENT MECHANISM: not a negation at all, but the
   * ordinary exploratory frame `"figuring out "` (`objective-label.ts:158`,
   * `DELIBERATION_FRAMES`). A pin shaped around "negated disclaimers" could
   * never have caught it. So the pin is now a SET over a corpus, asserted in
   * BOTH directions — it REDs if the set SHRINKS (the producer was fixed: delete
   * the member, the builder starts catching it for free) and if it GROWS (the
   * extraction gap widened). A gap recorded in the suite is honest; a gap
   * invisible to it is how this shipped green in the first place.
   *
   * ⚠ SCOPE OF THE CLAIM. `OPEN_BRIEF_CORPUS` is this file's corpus, not the
   * world: "exactly these" is exact OVER THIS CORPUS. Measured 29 Aug 2026 at
   * the producer. The sibling frames `"working out "` / `"work out "` /
   * `"considering "` in the same list produce the same shape (measured:
   * `"We are working out where our margin actually goes each month."` ->
   * `{ authored: true, label: "Where Margin Actually Goes Each Month" }`); they
   * are recorded with the extraction row rather than asserted here, because
   * whether a `considering `-framed brief poses a decision is a judgement this
   * lane is not entitled to mint.
   */
  const OPEN_BRIEF_CORPUS: ReadonlyArray<{ readonly name: string; readonly brief: string }> = [
    { name: 'negated-disclaimer', brief: 'We are not choosing between fixed options yet.' },
    {
      name: 'exploratory-figuring-out',
      brief: 'We are figuring out what our customers actually value most about the service.',
    },
    { name: 'burn-rate', brief: 'Our burn rate is too high and the team is stretched thin.' },
    { name: 'churn-symptom', brief: 'Churn has climbed for three quarters and nobody agrees on why.' },
    { name: 'morale', brief: 'Morale in the support team has fallen and recruitment is slow.' },
    {
      name: 'no-shortlist',
      brief: 'We have no shortlist yet; we just want to understand the market better.',
    },
  ];

  /** The members of `OPEN_BRIEF_CORPUS` this builder CANNOT catch, and the exact
   *  label each one authors. Both were established by an outside corpus, never
   *  from this lane's head (trap 22). */
  const KNOWN_DROPPED: ReadonlyArray<{ readonly name: string; readonly label: string }> = [
    { name: 'negated-disclaimer', label: 'Choose Between Fixed Options Yet' },
    // ⭐⭐ `exploratory-figuring-out` WAS HERE AND IS NOW CAUGHT — the shrink
    // this set was built to make visible, and it RED here rather than passing
    // in silence. It authored `What Customers Actually Value Most About the
    // Service`: an investigative frame (`figuring out `) whose complement is
    // interrogative (`what …`), i.e. the user's QUESTION title-cased into the
    // decision node. Closed at the producer by `INVESTIGATIVE_FRAMES` +
    // `INTERROGATIVE_COMPLEMENT` in `cee/draft/records/objective-label.ts`,
    // after the same shape was witnessed on the deployed build `a18e194`
    // ("…work out what is actually driving it…" -> "What Is Actually Driving It
    // Before We Commit Budget to a Fix").
    //
    // The scope note above anticipated exactly this: the sibling frames
    // `working out `/`work out ` produce the same shape and were left to the
    // extraction row. They are now all four closed — but ONLY where the
    // complement is interrogative, so `considering `, and a `figure out ` that
    // takes a noun phrase ("figure out our hiring strategy"), still author.
    // That judgement was deliberately NOT minted here, and is not minted now:
    // `considering ` is untouched.
    //
    // `negated-disclaimer` stays: its defect is an unhandled NEGATION ("we are
    // NOT choosing between…"), a different mechanism from this one, and
    // collapsing the two under one fix is the harm trap 21 names.
  ];

  it('KNOWN-DROPPED: exactly these open briefs still author a decision label', async () => {
    const { deriveDecisionLabel } = await import(
      '../../../cee/draft/records/objective-label.js'
    );
    const derived = OPEN_BRIEF_CORPUS.map((c) => ({
      name: c.name,
      ...deriveDecisionLabel({ brief: c.brief, goalQuotes: [] }),
    }));

    // POSITIVE CONTROL (trap 13). An "exactly these" assertion would also hold
    // over a probe that authored NOTHING, or that authored EVERYTHING — so
    // assert the corpus still exhibits both classes before believing the set.
    expect(derived.some((d) => d.authored)).toBe(true);
    expect(derived.some((d) => !d.authored)).toBe(true);

    // (a) SHRINK direction — every pinned member is still dropped, with the
    // exact label it authors.
    for (const member of KNOWN_DROPPED) {
      const observed = derived.find((d) => d.name === member.name);
      expect(observed, `corpus member missing: ${member.name}`).toBeDefined();
      expect(observed?.authored, `${member.name}: expected still-dropped`).toBe(true);
      expect(observed?.label, `${member.name}: label drifted`).toBe(member.label);
    }

    // (b) GROW direction — and nothing ELSE in the corpus is dropped.
    const droppedNow = derived.filter((d) => d.authored).map((d) => d.name).sort();
    expect(droppedNow).toEqual(KNOWN_DROPPED.map((m) => m.name).sort());

    // (c) The caught members are caught for the producer's actual reason — the
    // placeholder literal this builder's gate reads — not incidentally.
    for (const d of derived.filter((x) => !x.authored)) {
      expect(d.label, `${d.name}: expected the placeholder`).toBe(UNAUTHORED_DECISION_LABEL);
    }
  });



  /**
   * The gate is DECISION-NODE-SCOPED, not "absence of a flag". A graph with no
   * decision node at all must not claim a decision was framed provisionally —
   * nothing framed one. This also keeps every pre-existing fixture in this file
   * (none of which carries a decision node) on its original wording.
   */


  /**
   * ⭐ THE RESIDUAL COMPARISON CLAIM, FOUR LINES BELOW THE HEADING THIS PR
   * CHANGED AWAY FROM `Options compared`.
   *
   * `Options compared` was changed because it asserts a comparison of
   * alternatives the user chose between. The next-step nudge assembled
   * immediately below it (`assembleSectionedNarrative` appends
   * `input.nextStep` last) shipped, verbatim on the same provisional path:
   *
   *   "Next, run the analysis to see how the options compare ..."
   *
   * Weaker — forward-looking rather than past-tense — but the same message on
   * the same path, and ungated. It is now selected by the SAME
   * `provisionalDecision` signal, so the two cannot disagree.
   */


  /**
   * ⭐ THE OVER-CORRECTION CONTROL FOR THE NUDGE. Without it, a change that
   * simply retitled the nudge for EVERY draft would be indistinguishable from a
   * gated one — and the historic reply corpus
   * (`compose/__tests__/fixtures/live-assistant-text-corpus-2026-08-17/`)
   * records the old sentence on genuine decisions, where it is true.
   */


  /**
   * The selector is bound to the recovery KIND (`run`), not to a string
   * predicate another branch could satisfy (trap 19). A non-ready readiness on
   * the provisional path must keep its own recovery copy untouched.
   *
   * ⚠ RECORDED, NOT FIXED: the `blocked` and `review_model` branches carry the
   * same presupposition in their own words ("before comparing the options",
   * `readiness-recovery.ts`). They are outside this lane's scope and are rowed
   * with the extraction gap.
   */
  it('CONTROL: the provisional signal only reaches the run nudge', async () => {
    const { buildReadinessNextStep } = await import('../readiness-recovery.js');
    const blocked = { status: 'blocked' as const };
    expect(buildReadinessNextStep(blocked, [], { provisionalDecision: true })).toBe(
      buildReadinessNextStep(blocked, [], { provisionalDecision: false }),
    );
    // Contrast control: the run branch DOES differ, so the equality above is a
    // real scoping result and not a selector that never fires.
    const ready = { status: 'ready' as const, may_run: true }; // R2: admitted Run nudge, independent of strict status.
    expect(buildReadinessNextStep(ready, [], { provisionalDecision: true })).not.toBe(
      buildReadinessNextStep(ready, [], { provisionalDecision: false }),
    );
  });

  /**
   * ⭐ PIN FOR THE `label_authored !== true` CONJUNCT, WHICH WAS UNPINNED.
   *
   * An adversarial review dropped that conjunct from `hasProvisionalDecision`
   * and 164/164 stayed GREEN. It then DEMONSTRATED — not asserted — that the
   * mutant is equivalent on today's producer (48 inputs; contrast control saw
   * 13 authored labels and 0 carrying `label === "Decision"`), so there is no
   * live defect. But the docstring above calls that conjunct load-bearing and
   * NOTHING would RED if the producer ever authored the literal "Decision", or
   * if another writer set the flag on a placeholder label. A guard that cannot
   * fail is not a guard.
   *
   * This fixture is the exact shape the two conjuncts disagree about — the
   * placeholder label WITH the authored flag — so only the flag can decide it.
   * Its discriminating twin is the "unflagged decision with a REAL label"
   * control above, which the OTHER conjunct decides.
   */

});

/**
 * ⭐⭐ THE OPENER MADE A CLAIM ABOUT THE USER'S BRIEF, AND IT WAS THE FIRST
 * THING ANYONE READ.
 *
 * ── THE MEASURED DEFECT (16 signed-in runs / 84 turns, deployed build) ──────
 *   "I couldn't pin down a single decision in your brief, so I've framed one
 *    provisionally."
 *
 * fired on **7 of 9 drafts**, including briefs that literally open
 * *"Should we A, or B, or C?"* — and the product then built a perfectly good
 * model of that decision, which makes the sentence self-evidently wrong to the
 * one person qualified to judge it.
 *
 * ── WHY THE FIX IS COPY AND NOT CLASSIFICATION ─────────────────────────────
 * The sentence is TRUE of our extractor: `deriveDecisionLabel` did decline. It
 * is FALSE as the user reads it, because it is phrased as a finding about
 * THEIR brief. Widening the extractor is the opposite-direction harm of the
 * change that stopped the product falsely CLAIMING a decision on briefs posing
 * none (18/18 → 1/18 on an independent corpus); that win is not for sale, and
 * the predicate's breadth is rowed (ROADMAP 2.1341) precisely because "one
 * more rule" on it oscillates.
 *
 * So the opener now describes **what this builder did** — it framed the
 * decision itself, provisionally — and invites correction. That claim is
 * verifiable HERE, in this function, on every input, and it cannot be false in
 * either direction:
 *   · brief posed a decision and extraction declined → we framed it, so true;
 *   · brief posed none                              → we framed it, so true.
 *
 * ⚠ WHAT THE OLD SENTENCE GOT RIGHT AND THE NEW ONE MUST KEEP: it never said
 * "your brief contained no decision". Neither does this. The failure was not
 * that the claim was negative about the brief in form — it is that a sentence
 * whose subject is the brief READS as a verdict on the brief whatever its
 * modality. The fix is to change the subject, not to soften the verb.
 */


/**
 * ⭐⭐ THE MODEL IS ONE OF SEVERAL THE SYSTEM COULD HAVE BUILT, AND NOTHING
 * SAID SO.
 *
 * ── THE MEASURED FACT, AND WHY THERE IS NO FIX FOR IT ──────────────────────
 * The same brief produces materially different models: 5 of 5 runs gave
 * distinct option sets, and the journeys inverted
 * (retain 66% → 45% → blocked → 75% → CLOSE 52%). The request was
 * BYTE-IDENTICAL every time (`temperature: 0`, same prompt hash) and the
 * analysis solver is bit-identical to 16 significant figures, so every bit of
 * that variance is in the DRAFT. The Anthropic API exposes no seed parameter
 * and temperature is already 0: this is a property of the system, not a defect
 * with a fix.
 *
 * ── THE TRUTHFULNESS GAP THIS CLOSES ───────────────────────────────────────
 * The product hedges honestly WITHIN a model. Nothing told a user their model
 * was one of several. Two colleagues comparing notes each saw honest hedging
 * and no hint that their models differ — and they WILL compare notes.
 *
 * ── WHERE IT SITS, AND WHY NOT AT THE TOP ──────────────────────────────────
 * Read together with the opener above, a variance note in block 1 would open
 * every draft with two hedges in a row. It is the CLOSING frame instead —
 * after the content, BEFORE the call to action, so the last thing the reader
 * takes away is still the next step. On the verbatim-summary path there is no
 * builder-composed call to action, so it closes the reply.
 */



/**
 * ⭐⭐ WHAT A DIRECT EDGE MAY AND MAY NOT ESTABLISH.
 *
 * The first version of the opposition check read ONLY the direct factor→goal
 * edge. That was my own defect repeated one level in: I had replaced "two
 * labels exist" with "one direct edge exists" and again claimed more than the
 * model supports. Two independently reproduced counterexamples:
 *
 *   · a factor whose direct edge is +0.2 but whose fuller path runs
 *     +1 → −1 is not proven positive, so the pair is unearned;
 *   · a direct edge with `exists_probability: 0` establishes nothing at all.
 *
 * ⚠ THESE CASES EXIST BECAUSE MY OWN SUITE COULD NOT SEE EITHER DEFECT. Both
 *   mutations — deleting the existence check, deleting the indirect veto —
 *   SURVIVED 183/183 until these were added. A corpus that shares the code's
 *   blind spot cannot see the code's defect, and the fix would have been
 *   unguarded in this repo while passing everything in it.
 */



/**
 * ⭐⭐ A TRUNCATED WALK IS NOT A NEGATIVE RESULT.
 *
 * The depth bound existed to stop a cyclic or dense graph making the walk the
 * cost. But hitting it returned an empty set of contradicting paths, and the
 * caller read that as "no contradiction exists" when it meant "none was LOOKED
 * FOR beyond here". Reproduced by review: a chain positive at every hop except
 * a final negative one, lying past the lookahead, left a direct +0.2 standing
 * as an unqualified sign — so the product claimed a trade-off the fuller model
 * refutes.
 *
 * ⚠ THIS CASE EXISTS BECAUSE MY OWN SUITE COULD NOT SEE IT. Deleting the
 *   truncation guard SURVIVED 188/188. It is the third time today a reviewer's
 *   corpus caught what mine could not, and it is the same class as the two
 *   before it: an incomplete search reported as an absence.
 */
