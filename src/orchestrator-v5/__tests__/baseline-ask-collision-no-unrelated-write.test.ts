/**
 * ⭐⭐ AN ANSWER TO THE BASELINE QUESTION MUST NOT WRITE ANYWHERE ELSE.
 *
 * WIRE-WITNESSED on the deployed build. The product asked "Roughly what
 * percentage is <target> at right now?" while a second bare-number ask about an
 * option/factor cell was still live. The user answered, and the receipt said:
 *
 *   "'introduce annual contracts with a discount to lock customers in' now has
 *    an effect value of 0.3 on 'Annual Contract Adoption Rate'."
 *
 * confirmed by SERVER READ-BACK, not by the receipt: the graph identity hash
 * moved and a new intervention appeared. The user answered one question and got
 * a number written onto something they were never asked about.
 *
 * ── WHY THIS FILE EXISTS ALONGSIDE THE ROUTING SPEC ───────────────────────
 * `routing/__tests__/baseline-ask-collision-precedence.test.ts` proves the
 * VERDICT. This proves the CONSEQUENCE, at the persistence boundary: it asserts
 * on `append`'s `graph` and reads values back OUT OF THE PERSISTED GRAPH BOUND
 * BY NODE ID, never on response wording. The witnessed build's receipt was the
 * honest part; the write was the defect, so a spec that reads the receipt is
 * measuring the wrong object.
 *
 * ── TRAP 13: EVERY "NOTHING WAS WRITTEN" CASE HAS A POSITIVE CONTROL ──────
 * Each refusal case is paired with a control running the SAME harness, the SAME
 * adapter and the SAME graph with the collision absent, proving this harness can
 * see that exact write land. An absence assertion whose harness cannot observe a
 * presence is vacuous.
 *
 * ── WHAT THE ADAPTER IS FOR, and what it is NOT evidence of ───────────────
 * The mutating adapter reproduces a routing decision of the class the deployed
 * model made. It is deliberately "wrong": the guarantee must hold regardless of
 * what the model decides, because on the witnessed turn the model decided to
 * write. The strongest case here needs no adapter behaviour at all — it uses a
 * THROWING adapter, so "the model was never consulted" is asserted structurally
 * rather than inferred from an outcome. A self-authored adapter is not evidence
 * about the live wire (trap 16-inverse), and no claim here rests on one.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach,describe,expect,it,vi } from 'vitest';

import type { GraphV3T } from '../../schemas/cee-v3.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { PendingAction } from '../session/pending-action.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  pending_actions?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;
let servedGraph: unknown = null;
let pendingActionsForRead: readonly PendingAction[] = [];
let failGraphSave = false;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (failGraphSave && write.graph != null) throw new Error('simulated graph save failure');
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readRecentAppliedMutationFactsFor: async () => [],
    readMostRecentPendingActions: async () => pendingActionsForRead,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => persistedGraph ?? servedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph ?? servedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));


const { formatBaselineAskCollision } = await import(
  '../tools/handlers/d1-shared/format-confirmation.js'
);


const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** The baseline question's target. */
const TARGET_ID = 'f-churn';
const TARGET_LABEL = 'Churn rate';
/** The competing ask's cell — the pair the witnessed turn wrote onto. */
const OPTION_ID = 'o-annual';
const OPTION_LABEL = 'introduce annual contracts with a discount to lock customers in';
const FACTOR_ID = 'f-acar';
const FACTOR_LABEL = 'Annual Contract Adoption Rate';

/** The witnessed answer. Any answer-shaped reply reproduces this; see the routing spec. */


function buildGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-mrr', kind: 'goal', label: 'Reach 250,000 MRR' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: TARGET_LABEL,
        observed_state: { value: 0.05, raw_value: 5, unit: '%', cap: 100 },
      },
      { id: FACTOR_ID, kind: 'factor', label: FACTOR_LABEL },
      { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

const LIVE_UNTIL = '2099-12-31T23:59:59.000Z';
const EMITTED = '2026-08-30T11:00:00.000Z';



function effectPending(): PendingAction {
  return {
    id: `pa-effect-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_configure_option_clarify',
    action: {
      kind: 'elicit_option_effect',
      option_id: OPTION_ID,
      option_label: OPTION_LABEL,
      factor_id: FACTOR_ID,
      factor_label: FACTOR_LABEL,
    },
    preconditions: {},
    expires_at_turn_count: 3,
    expires_at_iso: LIVE_UNTIL,
    emitted_at_iso: EMITTED,
  } as unknown as PendingAction;
}





/**
 * A routing decision of the witnessed class: the user's number is applied to
 * the COMPETING ask's factor, which they were never asked about.
 *
 * ⚠ THE HANDLER CHOICE IS LOAD-BEARING AND WAS CORRECTED BY THE POSITIVE
 * CONTROL, which is the entire reason the control exists. The first draft used
 * `set_factor_value`, and the control REDDED: that proposal trips the
 * validator's `OPTION_INTERVENTION_MISROUTE` on this graph, so the write never
 * landed and the graph was spared by a guard that has nothing to do with this
 * fix. Every absence assertion in this file would have passed at PRISTINE — a
 * whole spec agreeing with itself (trap 13b). `add_constraint` lands here, so
 * the absences below are now about the collision and nothing else.
 */


/** Asserts structurally that the model is never consulted on this turn. */


/** Every graph write this turn made. Empty === the model is untouched. */


/** The persisted graph, or — when the turn wrote nothing — the graph it started from. */


/**
 * TRAP 19 — rows for a node by IDENTITY (`node_id`), never "the row whose value
 * is 30". Read OUT OF THE PERSISTED GRAPH, never out of the receipt.
 */


/** The factor by IDENTITY, never "the node whose value is 0.3". */


/**
 * ⭐⭐ THE DEMOTION IS BOUND BY IDENTITY, NOT BY ITS SENTENCE.
 *
 * These cases used to assert the demotion by quoting its copy — `"You did not
 * ask me to edit the model"`. **#1312 withdrew that clause** (INV-3: the reply
 * must describe what the PRODUCT did, never what the user asked), and three
 * cases here went RED on the sentence while their safety assertions
 * — `graphWrites()` empty, `constraintsOn(...)` empty — kept passing. The harm
 * was still refused; only the words reporting it had moved.
 *
 * A test that pins a sentence another lane owns has moved once and will move
 * again (trap 12). `V5MutationWarrantAbsent` is the demotion's own identity,
 * emitted by this seam at the moment the write is demoted, and it cannot drift
 * with copy. Captured here rather than discarded so the cases can bind to it.
 */
const telemetry: Array<{ readonly name: string }> = [];

/** TRUE when the mutation-warrant gate demoted this turn's write. */


beforeEach(() => {
  appendCalls.length = 0;
  persistedGraph = null;
  servedGraph = buildGraph();
  pendingActionsForRead = [];
  failGraphSave = false;
  telemetry.length = 0;
  setTestSink((name: string) => {
    telemetry.push({ name });
  });
});



/**
 * ⭐⭐ THE OTHER DIRECTION, AT THE SAME TURN BOUNDARY.
 *
 * The block above proves an ELLIPTICAL answer is stopped. This one proves the
 * stop is not indiscriminate: a reply that names its own subject must still
 * reach the lane that binds it, with the very same competing ask live.
 *
 * It matters because the two live in one predicate, and the first version of
 * this transition failed exactly here — it refused the product's OWN offered
 * disambiguating answer, so the user was told what to say and then rejected for
 * saying it. The elliptical block alone cannot see that: every one of its cases
 * points in the same direction.
 *
 * The assertion is the INVERSE of the elliptical case's mechanism, and it is
 * structural for the same reason: being intercepted means the model is never
 * consulted, so `chatWithTools` HAVING been called is the fall-through itself.
 */
describe('a reply that names its own subject is not the collision case', () => {
  /** The product's own offered example, taken from the copy it actually emits. */
  const offeredExample = (() => {
    const copy = formatBaselineAskCollision({
      targetLabel: TARGET_LABEL,
      competing: [effectPending()],
    });
    const m = /for example "([^"]+)"/.exec(copy);
    if (m === null) throw new Error(`collision copy no longer offers an example:\n${copy}`);
    return m[1]!;
  })();

  it("offers an example that is itself subject-bearing — the promise it must keep", () => {
    expect(offeredExample).toBe(`${TARGET_LABEL} is 30%`);
  });






});

/**
 * ⭐⭐ THE ANSWER MUST LAND, NOT MERELY REACH THE MODEL.
 *
 * Reaching the model was the previous link; this is the outcome. With the
 * reply through, the executor's mutation-warrant gate then DEMOTED the write
 * ("You did not ask me to edit the model"), so the stated baseline still never
 * landed. ⚠ APPENDED, NOT REWRITTEN: that clause was WITHDRAWN by #1312 on
 * 1 Sep 2026 (INV-3 — the reply describes what the product did, never what the
 * user asked). The sentence above is a record of what a dated build actually
 * emitted and is left standing as evidence; the demotion is now observed by its
 * telemetry identity, not by that copy. The gate's message signal is LEXICAL,
 * and measured at this seam with a live baseline question and a competing ask:
 *
 *     "Churn rate is at 30%"  → warrant granted  → the baseline commits
 *     "Churn rate is 30%"     → warrant ABSENT   → demoted, nothing lands
 *
 * One token apart; same question, same target, same value. And the second is
 * the sentence the product ITSELF offers. A user cannot be asked to guess which
 * spelling of their own answer will be accepted.
 *
 * ⚠ THIS WAS AN EXISTING DOWNSTREAM GAP, not a regression introduced upstream:
 * the warrant module is untouched by this branch. The routing repair made it
 * REACHABLE, which is what a correct fix does — and the repair is not finished
 * until the outcome it unblocks actually occurs.
 *
 * THE FIX is a fourth warrant source scoped to the named baseline object and
 * action: a live baseline question whose subject this reply resolved by
 * identity, the `add_constraint` action, and that question's own target node.
 *
 * BOTH DIRECTIONS IN THE SAME RUN, because a whole-turn warrant would be the
 * mirror harm — every numeric sentence licensing any edit. The three
 * `LICENSES NOTHING WIDER` cases are the ones that fail if that happens, and
 * each strips exactly one conjunct of the grant: the object, the authority, and
 * the live question.
 */


/**
 * The state-class the witnessed turn is actually in, derived from the handler's
 * OWN `mintEligible` conjunction rather than assumed: the target is an outcome
 * with an incoming edge and no baseline yet, and the level-framed constraint the
 * question was asked about is already persisted. `buildGraph()` alone carries no
 * edges, so the mint cell cannot fire on it and an assertion about the baseline
 * would have been measuring the fixture instead of the fix.
 */


/** The baseline recorded on a node, by IDENTITY, out of the PERSISTED graph. */








/**
 * ⭐⭐ ONE TARGET, TWO SEMANTIC QUANTITIES — and answering about one is not
 * permission to rewrite the other.
 *
 * The warrant that admits an answer is scoped to (handler, target). That is one
 * scope too coarse: a target carries its BASELINE (where it is now) and its
 * SUCCESS CONSTRAINT (where the user needs it to get to). Measured at the head
 * before this fix, the offered answer "Churn rate is 30%" with a model proposal
 * of 30:
 *
 *   - rewrote the user's own 10% success limit to 30%;
 *   - DROPPED its `value_frame: level`;
 *   - recorded NO baseline at all;
 *   - replied "Updated constraint: Churn rate must be at most 30%."
 *
 * A user answering a question the product asked had their own success criterion
 * silently rewritten — worse than the refusal this branch set out to fix.
 *
 * The two failures share one cause: the frame is inherited only while the value
 * and unit are unchanged, so a turn that "updates" the limit to the answer's
 * number destroys the attestation the baseline mint depends on. Preserving the
 * row is what makes the baseline recordable.
 *
 * BOTH DIRECTIONS, SAME RUN. The explicit-limit-change twin is the counterpart:
 * identical graph, identical handler, entity, unit and proposal value 30 —
 * changing ONLY the message — and it must still write 30%.
 */
