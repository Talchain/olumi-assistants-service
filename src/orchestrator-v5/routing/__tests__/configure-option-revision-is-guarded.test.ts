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
import { detectConfigureOptionIntent, projectOptionLabels } from '../configure-option-intent.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const {
  option_id: OPTION_ID,
  factor_id: FACTOR_ID,
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
  it('a shared-baseline move leaves the option’s own intervention unchanged', () => {
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
  });
});
