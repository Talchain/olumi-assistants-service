/**
 * ⭐⭐⭐ A REVISION IS GUARDED THE SAME WAY A FIRST CONFIGURATION IS — RED-first.
 *
 * ⚠⚠ THIS FILE IS RED AT `1690c1f3` AND IS SUPPOSED TO BE. It states the
 * behaviour the fix must produce; it is not a characterisation spec. Its
 * sibling `configure-option-outcome-configured-domain.test.ts` (#1492) pins the
 * CURRENT abstention and is GREEN at the same tip — the two files are the
 * before and after of one behaviour, deliberately kept apart so a reader can
 * see which is which.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * `evaluateConfigureOptionOutcome` (ROADMAP 2.427) returned `not_applicable` on
 * 46 of 46 real captured turns while the shipped intent detector matched 46/46.
 * `option-intervention-write-guard.ts` (ROADMAP 2.1266) takes BOTH its intent
 * and its option identity from that verdict, so when the verdict abstains the
 * WRITE IS UNGUARDED.
 *
 * The cause is the candidate set. `resolveConfigureOptionFacts`
 * (configure-option-clarify.ts) builds it from `outstandingSlotsByOption`, a
 * projection of `deriveMissingEffectPairs`, and declines when nothing is
 * outstanding. **A drafted graph arrives already populated, so every later edit
 * is a REVISION, and a revision has no outstanding slot.** The guard protects
 * the first configuration of a model and never a revision — which is where the
 * harm it was built for actually lives.
 *
 * ── TWO BOUNDS IN SERIES, AND CLEARING ONE CHANGES NOTHING ─────────────────
 * Measured by mutant, not reasoned about (#1492's Mutant A):
 *
 *   BOUND 1  `resolveConfigureOptionFacts` — candidate set = options with an
 *            OUTSTANDING option×factor slot. A configured option is absent, so
 *            resolution declines `no_unconfigured_option` before anything else
 *            runs. Every decline then flattens to `option_not_identified` at
 *            `configure-option-outcome.ts` — a name for a resolution failure
 *            that was never attempted.
 *   BOUND 2  `buildConfigureOptionRecoveryCopy` — the COPY domain bound
 *            (`status !== 'needs_encoding'` ⇒ `option_already_partially_
 *            configured`). Widening the candidate set alone advances the
 *            resolver only as far as this second decline.
 *
 * ── WHY THE FIX IS A SPLIT AND NOT A WIDENING ─────────────────────────────
 * Bound 2 is CORRECT and must stay. The recovery copy asserts *"this option has
 * no effect values yet, so the analysis cannot compare it"* — false of an option
 * already carrying a value. Widening the copy would trade a false success for a
 * false NOTICE: the same harm, opposite sign.
 *
 * So the two bounds guard two DIFFERENT questions that one predicate was
 * answering (CLAUDE.md trap 21, one level below the split 2.427 already made):
 *
 *   *WHICH OPTION DID THE USER NAME?*   → decides whether the WRITE is guarded.
 *                                         A configured option is a perfectly
 *                                         good answer. Bound 1 must go.
 *   *WHAT COPY REPLACES THE RESPONSE?*  → decides what the product SAYS.
 *                                         A configured option has no true
 *                                         sentence here. Bound 2 must stay.
 *
 * The fix therefore clears bound 1 on the RESOLUTION path only, and introduces
 * a verdict that carries protection WITHOUT copy. The product says nothing new
 * about any option; it simply stops letting a wrong-entity write through on a
 * model the user has already configured.
 *
 * ── MEASURED LIVE, 14 Sep 2026, deployed CEE staging `a606a99e` ────────────
 * Two-option graph drafted from one brief (`Hold Pro Plan Monthly Price at £49`
 * is `is_baseline: true`; `Raise It to £59` is not). BOTH options arrive
 * `status: 'ready'` wired to the SAME factor — i.e. zero outstanding slots, the
 * exact state this file is about. Verdicts taken at the STORED object via a
 * separate read turn (`graph_hash` movement AND the targeted option's own
 * intervention value), never from the reply prose:
 *
 *   `Set the <option> option's effect on <factor> to 79%`
 *     baseline option      → on-target   (0.49 → 0.79, hash moved)
 *     non-baseline option  → no change   (0.59 → 0.59, hash unchanged)
 *
 * The non-baseline refusals are HONEST — the model is untouched and the reply
 * says so. They are not this lane's defect. The defect is that on the SAME
 * graph a wrong-entity write would also be unguarded, because no verdict is
 * ever reached.
 */
import { describe, expect, it } from 'vitest';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
} from '../configure-option-intent.js';
import { evaluateConfigureOptionOutcome } from '../configure-option-outcome.js';
import { decideOptionInterventionWrite } from '../option-intervention-write-guard.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const {
  option_id: OPTION_ID,
  factor_id: FACTOR_ID,
  option_label: OPTION_LABEL,
  turn_message: MESSAGE,
} = CAPTURE.provenance;

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

function optionInterventionValue(graph: unknown, optionId: string, factorId: string): unknown {
  const node = (graph as Graph).nodes.find((n) => n.id === optionId);
  const bundle = node?.interventions as Record<string, { value?: unknown }> | undefined;
  return bundle?.[factorId]?.value;
}

describe('a revision to an already-configured option is guarded', () => {
  /**
   * ⭐ THE FIXTURE'S OWN PRECONDITION, PINNED IN-TEST (trap 13b).
   *
   * Every assertion below is only about a REVISION while the named option
   * really does already carry an effect value. If a later edit to the fixture
   * emptied it, the assertions would silently become claims about a FIRST
   * configuration — the case that already worked — and would pass by testing
   * the wrong thing.
   */
  it('the capture really is a revision: the named option already carries a value', () => {
    expect(optionInterventionValue(CAPTURE.before, OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(detectConfigureOptionIntent(
      MESSAGE,
      projectOptionLabels(CAPTURE.before.nodes as never),
    ).matched).toBe(true);
  });

  /**
   * ⭐⭐ THE BEHAVIOUR THIS LANE OWES. The option the user named is resolvable
   * even though nothing is outstanding, and the verdict says the write did not
   * land FOR THAT OPTION — by identity (trap 19), never "an op landed".
   *
   * `not_honoured_no_copy` rather than `not_honoured`: the recovery copy's
   * domain still excludes a configured option, and this verdict deliberately
   * carries no `factorLabels`, so no consumer can compose a sentence from it.
   * The write is protected; the product says nothing new.
   */
  it('reaches a write-protecting verdict for the SAME wrong-entity write', () => {
    const verdict = evaluateConfigureOptionOutcome({
      message: MESSAGE,
      before: CAPTURE.before,
      after: CAPTURE.after,
    });

    expect(verdict.status).toBe('not_honoured_no_copy');
    expect(verdict.status === 'not_honoured_no_copy' && verdict.optionId).toBe(OPTION_ID);
    expect(verdict.status === 'not_honoured_no_copy' && verdict.optionLabel).toBe(OPTION_LABEL);
    // The copy domain bound is intact, and the verdict says which bound it hit
    // rather than flattening it (the `option_not_identified` catch-all is the
    // second defect #1492 pinned).
    expect(
      verdict.status === 'not_honoured_no_copy' && verdict.copyDeclineReason,
    ).toBe('option_already_partially_configured');
    // No copy material is carried at all, so a consumer cannot accidentally
    // compose the untrue sentence.
    expect(Object.keys(verdict).sort()).toEqual(
      ['copyDeclineReason', 'optionId', 'optionLabel', 'status'],
    );
  });

  /**
   * ⭐⭐ THE POINT OF THE LANE, AT THE CONSUMER. `decideOptionInterventionWrite`
   * takes its intent AND its option identity from the verdict above, so a
   * verdict is the whole difference between a guarded revision and an
   * unguarded one.
   *
   * ⚠ THE CAPTURE'S OWN WRITE IS AN **EDGE** WRITE, which the write guard
   * correctly allows (`no_baseline_write` — an edge move is not the shared
   * baseline being rewritten). So the witnessed 2.1266 shape is CONSTRUCTED
   * here from the same capture: the factor's shared `observed_state` moved in
   * place of the option's effect value. Both preconditions are pinned in-test
   * so this cannot decay into agreeing with itself.
   */
  it('the write guard now withholds a shared-baseline write on a revision', () => {
    const after = JSON.parse(JSON.stringify(CAPTURE.before)) as Graph;
    const factor = after.nodes.find((n) => n.id === FACTOR_ID)!;
    const observedBefore = (
      (CAPTURE.before as unknown as Graph).nodes.find((n) => n.id === FACTOR_ID)!
        .observed_state as { value: number } | undefined
    )?.value;
    factor.observed_state = { ...(factor.observed_state as object), value: 0.79 };

    // PRECONDITIONS: the baseline really moved, and the named option's own
    // effect value did NOT. Without both, the assertion below asserts nothing.
    expect(observedBefore).not.toBe(0.79);
    expect(optionInterventionValue(after, OPTION_ID, FACTOR_ID)).toBe(0.49);

    const verdict = decideOptionInterventionWrite({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('withhold');
    expect(verdict.verdict === 'withhold' && verdict.optionId).toBe(OPTION_ID);
  });

  /**
   * ⭐⭐ NEGATIVE CONTROL 1 — AN AMBIGUOUS SUBJECT IS STILL REFUSED.
   *
   * A guard that stops abstaining but also stops discriminating is worse than
   * abstention: it converts honest refusals into silent wrong-entity writes.
   * A message naming no option must reach no verdict, exactly as today.
   */
  it('names no option ⇒ still no verdict', () => {
    const verdict = evaluateConfigureOptionOutcome({
      message: 'Set the effect to 79%.',
      before: CAPTURE.before,
      after: CAPTURE.after,
    });
    expect(verdict.status).toBe('not_applicable');
  });

  /**
   * ⭐⭐ NEGATIVE CONTROL 2 — A WRITE THAT DID LAND FOR THE NAMED OPTION IS
   * NEVER CALLED UNHONOURED. The widening must not manufacture a failure out
   * of a successful revision: that is the inverse harm, and it is the one the
   * P1 note in `configure-option-outcome.ts` already records as reachable.
   */
  it('a revision that LANDS on the named option is honoured, not withheld', () => {
    const after = JSON.parse(JSON.stringify(CAPTURE.before)) as Graph;
    const node = after.nodes.find((n) => n.id === OPTION_ID)!;
    (node.interventions as Record<string, { value: number }>)[FACTOR_ID] = { value: 0.79 };

    const verdict = evaluateConfigureOptionOutcome({
      message: MESSAGE,
      before: CAPTURE.before,
      after,
    });
    expect(verdict.status).toBe('honoured');
    expect(verdict.status === 'honoured' && verdict.optionId).toBe(OPTION_ID);
  });
});
