/**
 * ⭐⭐ THE GUARD IS WIRED — the two witnessed wrong writes never reach the graph,
 * and the chip that offered one is never minted.
 *
 * A resolver nothing routes to is dark code (CLAUDE.md trap 16), and the unit
 * spec beside `outstanding-effect-ask-misroute.ts` proves only that the module
 * answers correctly. THIS spec asserts the property at the PERSISTENCE BOUNDARY
 * — `append`'s `graph` — through the real `runTurnExecutor`, exactly as its
 * sibling `mutation-warrant-consent-parity.test.ts` does, and for the same
 * reason: the witnessed build's WORDS were partly honest; the WRITE was the
 * defect.
 *
 * ── THE FIXTURE IS CAPTURED, NOT AUTHORED (trap 16: *a fixture you wrote
 * yourself is not evidence about the wire*). `witness-2026-08-18/
 * model-compiler-option-effect.json` is a real drafted graph from a deployed
 * fresh-guest journey. It carries eight outstanding `MISSING_OPTION_VALUE`
 * pairs and option → factor edges whose `strength.mean` is **1** — the same
 * shape the 20 Aug browser witness saw written down to 0.6.
 *
 * ── EVERY REFUSAL HAS A POSITIVE CONTROL (trap 13). The "no chip was offered"
 * and "nothing was written" assertions each sit beside a run of the SAME
 * harness, SAME adapter and SAME graph that DOES produce the chip / DOES land
 * the write, so an assertion cannot pass because the harness went blind.
 *
 * ── AND AN OPPOSITE-DIRECTION TWIN (trap 22b). The factor arm's twin is the
 * load-bearing one: the SAME factor, the SAME value, WITHOUT effect framing,
 * must still be written. Measured at this tip, the two messages differ only in
 * the classifier's own trigger — `effect_vocab` vs `option_value_set`.
 */
import { readFileSync } from 'node:fs';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';


import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { setTestSink } from '../../utils/telemetry.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../routing/mutation-consent.js';
import { resolveOptionEffectWrite } from '../routing/option-effect-write.js';
import { deriveMissingEffectPairs } from '../routing/repair-value-binding.js';
import { isProposedChangeActionType } from '../types/proposed-change.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  pending_actions?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;
/** Pendings the store hands back — seeded from a REAL demotion, never authored. */
let pendingActionsForRead: readonly unknown[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => pendingActionsForRead,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));






// ---------------------------------------------------------------------------
// THE CAPTURED GRAPH AND ITS IDENTITIES.
// ---------------------------------------------------------------------------
interface WitnessFixture {
  readonly ids: {
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
    readonly two_option_factor_id: string;
    readonly two_option_factor_label: string;
  };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}
const J18 = JSON.parse(
  readFileSync(
    new URL('./fixtures/witness-2026-08-18/model-compiler-option-effect.json', import.meta.url),
    'utf8',
  ),
) as WitnessFixture;

const OPTION_ID = J18.ids.option_id;
const FACTOR_ID = J18.ids.factor_id;
/** The outstanding pair, in the handler's own `from→to` edge spelling. */

/** A factor → outcome link. Nothing is outstanding on it (asserted below). */


/**
 * Two captured outstanding cells, used for the stale-A / current-B identity
 * regression. Keeping B on its own captured factor makes the B→B opposite
 * independent of whether B actually has an edge to stale A's factor.
 */



















function graph(): GraphV3T {
  return JSON.parse(JSON.stringify(J18.draft_graph)) as GraphV3T;
}

/**
 * The witnessed defect-A utterance shape: an OPINION carrying a number, no
 * imperative — so INV-1 finds no mutation warrant and the proposal is DEMOTED
 * to the "Adjust this link" chip rather than executed.
 */

/** Defect B, effect-framed with the option referred to only by a pronoun. */

/** Defect B's TWIN: the same factor, the same value, an ordinary baseline edit. */


/**
 * The chip literal the browser witness captured, verbatim. Bound as a string
 * because it is the user-visible artefact under test — `warrant-demotion.ts`'s
 * `CHIP_COPY.adjust_edge_strength.label`, the estate's only producer of it.
 */




/**
 * A turn arriving on the ROUTING flag the UI actually sets. Used ONLY to prove
 * this guard does NOT read it — see the Calibrate regression below.
 *
 * WARNING: `source: 'chip_click'` is NOT provenance. The UI promotes any turn
 * carrying a CEE-routable `action_type` to this value regardless of what the
 * caller said (`buildPayload.ts:155`); exactly ONE production call site sets the
 * literal, against a contrast control of 21 for `source: 'chip'`. User-authored
 * text ships under it every day.
 */


/**
 * Emit a REAL demotion and hand back its chip copy plus the pending the product
 * actually persisted. Nothing here is authored: both are whatever
 * `emitProposedChange` produced on a warrantless mutating turn.
 */



/**
 * A FACTOR-KIND node with NO outstanding effect ask — the positive-control
 * target.
 *
 * ⚠ The first choice here was `ce6b11d2`, which is an **outcome**: the write was
 * refused by the unrelated `non_factor_kind` downgrade, so the control "passed"
 * for a reason that had nothing to do with this guard. Derived from the fixture
 * instead of chosen by eye — the only factor-kind node outside the outstanding
 * set.
 */

/**
 * ⚠ The label must MATCH the id. Passing the outstanding factor's label with a
 * different id tripped `ENTITY_RESOLUTION_AMBIGUOUS` ("Did you mean … or …?"),
 * so the control read as a refusal for a reason that had nothing to do with this
 * guard — a control failing for the wrong reason is as useless as one passing
 * for the wrong reason.
 */








/** Every graph write this turn made. Empty === the model is untouched. */


/** Any node's own value, by IDENTITY. */


/** TRAP 19 — the factor by IDENTITY, never "the node whose value is 0.8". */


/** The edge's strength, by IDENTITY (`from`/`to`), never by position. */


/**
 * ⭐⭐ IS THE PAIR STILL OUTSTANDING, ACCORDING TO PERSISTED STATE?
 *
 * Re-derived from the graph the turn actually persisted, through the SAME
 * canonical readiness the on-screen blocker is composed from. This is the
 * question the witnessed "Applied" badge could not answer: on defect A the
 * receipt said applied while `options_ready` stayed 0/4, and the only way to
 * catch that is to read the outcome back out of persistence rather than trust
 * the handler's return value.
 */


/** The persisted graph, or — when the turn wrote nothing — the graph it started from. */


beforeEach(() => {
  pendingActionsForRead = [];
  appendCalls.length = 0;
  persistedGraph = null;
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});













describe('⭐⭐ THE CORRECTION CHIP CARRIES THE OPTION IT NAMED — it does not re-resolve at click time', () => {
  const OTHER_OPTION_ID = '939d4630';

  /** The click-time graph: OPT is satisfied, so a DIFFERENT option is now the
   * unique outstanding one on the same factor. This is the dangerous window —
   * not the fully-stale case, which already declines. */
  function shiftedGraph(): GraphV3T {
    const g = graph() as unknown as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    const tmpl = g.edges.find((e) => e.from === OPTION_ID && e.to === FACTOR_ID)!;
    (g.nodes.find((n) => n.id === OPTION_ID) as Record<string, unknown>).interventions = {
      [FACTOR_ID]: 0.42,
    };
    g.edges.push({ ...tmpl, from: OTHER_OPTION_ID, to: FACTOR_ID });
    return g as unknown as GraphV3T;
  }

  it('POSITIVE CONTROL — the click-time graph really has shifted (else the test proves nothing)', () => {
    const outstanding = deriveMissingEffectPairs(
      buildCanonicalAnalysisReadyFromGraph(shiftedGraph()),
    ).filter((p) => p.factorId === FACTOR_ID);
    expect(outstanding.map((p) => p.optionId)).toEqual([OTHER_OPTION_ID]);
  });



  it('⭐⭐ DISCRIMINATING TWIN — the option-LESS form binds the WRONG option on the same graph', () => {
    // This is the defect the fix removes, kept as a live discriminator. Without
    // it the assertion above could pass on a graph where both forms agree, and
    // the identity carriage would be proving nothing.
    const optionLess = `Set the option's effect on ${J18.ids.factor_label} to 0.8.`;
    expect(resolveOptionEffectWrite({ message: optionLess, graph: shiftedGraph() })).toMatchObject({
      matched: true,
      optionId: OTHER_OPTION_ID,
    });
  });

  it('⚠ KNOWN-DROPPED, MEASURED: a DELETED option still re-resolves rather than declining', () => {
    // Pinned as an honest gap rather than left invisible (trap 22f). Once the
    // option node is gone, nothing in the sentence is recognisable as an option
    // reference, so rule 3b's "no option was named" conjunct holds and it binds
    // the sole remaining outstanding option. The receipt is still truthful about
    // what it wrote (`formatOptionEffectWriteAck` names it), so this is a wrong
    // write with an honest ack, not the witnessed shape.
    //
    // Closing it needs a chip that PINS `optionId` and a resume that binds by
    // it — new pending-action machinery, not a predicate tweak. This test REDs
    // if that lands, which is the point: the gap cannot be silently fixed or
    // silently widened.
    const g = graph() as unknown as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    const tmpl = g.edges.find((e) => e.from === OPTION_ID && e.to === FACTOR_ID)!;
    g.nodes = g.nodes.filter((n) => n.id !== OPTION_ID);
    g.edges = g.edges.filter((e) => e.from !== OPTION_ID && e.to !== OPTION_ID);
    g.edges.push({ ...tmpl, from: OTHER_OPTION_ID, to: FACTOR_ID });
    const full = `Set the ${J18.ids.option_label} option's effect on ${J18.ids.factor_label} to 0.8.`;
    expect(
      resolveOptionEffectWrite({ message: full, graph: g as unknown as GraphV3T }),
    ).toMatchObject({ matched: true, optionId: OTHER_OPTION_ID });
  });
});

/**
 * ⭐⭐ THE OFFER IS GONE — AND THE PRODUCT SAYS SO INSTEAD OF GUESSING.
 *
 * #1067 gated the factor arm on a CONSUMED PENDING ACTION, which is genuine
 * provenance, and stated the residual it left in prose. This battery closes it,
 * from a REAL round trip: every chip message below comes out of
 * `emitRealDemotion`, never out of my head.
 *
 * ⚠ AND IT CORRECTS THE MECHANISM THE RESIDUAL NAMED. The bound is NOT
 * `isExpired`: a WALL-EXPIRED pending that is still carried forward is still
 * resumed (pinned below), because the label-pick resume filters
 * `most_recent_pending_actions` on KIND ONLY. The turn that WRITES is the one
 * where the pending is ABSENT — carry-forward drops the row once
 * `expires_at_turn_count` is spent, and `readMostRecentPendingActions` reads
 * only the most recent turn. So the guard asks neither question: it asks
 * whether ANY pending was consumed.
 */
describe('⭐⭐ THE EXPIRED OFFER — a chip whose offer is gone is declined, never honoured', () => {
  /** The real pending with only the CLOCK moved — still carried, wall-expired. */














  /**
   * ⭐⭐⭐ THE COVERAGE UNION — the ONE way this guard degrades in silence.
   *
   * The scope conjunct is `isProposedChangeActionType` and the estate's set of
   * handlers that can MUTATE THE GRAPH is `GRAPH_MUTATING_HANDLER_IDS`
   * (`routing/mutation-consent.ts:87`). They are **two hand-maintained lists**
   * that happen to hold the same three members today, and **nothing fails loud
   * if the mutating set grows**. Add a fourth graph-mutating handler tomorrow
   * and this guard silently UNDER-COVERS it: the false-`Applied` route reopens
   * on that handler, and no test anywhere REDs.
   *
   * ⭐ THIS IS THE SAME DISCIPLINE APPLIED ONE LEVEL OVER. The recogniser spec
   * beside `warrant-demotion.ts` refuses to derive its corpus from `CHIP_COPY`
   * because that would be *the constant agreeing with itself*; it asserts a
   * DERIVED union against the producer instead. Here the producer of the
   * obligation is `GRAPH_MUTATING_HANDLER_IDS` — both lists live in this repo
   * and are importable, so this is genuinely derivable and NOT a third mirror
   * (CLAUDE.md trap 12d: derivation moves the risk, so the completeness check
   * must come from a source the guard does not own).
   *
   * ⚠ THE DIRECTION IS DELIBERATE AND IS **⊇**, NOT **=**. Every graph-mutating
   * handler must be admitted by the scope predicate. The converse is NOT
   * asserted: the predicate is allowed to admit a handler that is not (yet)
   * graph-mutating, because over-scoping this guard costs a clarify turn on a
   * content-free sentence, while under-scoping it writes a field the user never
   * named and badges it "Applied". Asserting equality would RED on a harmless
   * divergence and teach the next reader to loosen it.
   */
  it('⭐⭐⭐ COVERAGE UNION — the scope predicate admits EVERY graph-mutating handler', () => {
    // ⚠ THE VACUITY CONTROL IS A **COUNT**, NOT A MEMBERSHIP LIST, AND THE
    // FIRST DRAFT OF THIS TEST GOT IT WRONG IN A WAY WORTH RECORDING. It
    // asserted `[...GRAPH_MUTATING_HANDLER_IDS].sort()` against three hardcoded
    // strings — which is (a) a THIRD copy of a list this test exists to stop
    // mirroring, and (b) self-defeating: growing the set is exactly the
    // mutation this test must catch, and that literal would have RED first, so
    // the union loop below would never have run under it. A control that
    // pre-empts its own discriminator asserts nothing (trap 13b).
    //
    // The membership of the set is owned by `routing/__tests__/
    // mutation-consent.test.ts`. What THIS test needs is only that the loop was
    // not empty — asserted by counting iterations, which cannot mirror anything.
    expect(GRAPH_MUTATING_HANDLER_IDS.size).toBeGreaterThan(0);

    // THE UNION. Bound by identity to each member, named in the failure message.
    let checked = 0;
    for (const handlerId of GRAPH_MUTATING_HANDLER_IDS) {
      expect(
        isProposedChangeActionType(handlerId),
        `${handlerId} can MUTATE THE GRAPH but the expired-offer guard's scope `
          + 'predicate does not admit it — the false-"Applied" route is reopened '
          + 'for that handler. Add it to isProposedChangeActionType, or justify '
          + 'the exception at the bytes.',
      ).toBe(true);
      checked += 1;
    }
    expect(checked, 'the union loop asserted nothing').toBe(GRAPH_MUTATING_HANDLER_IDS.size);

    // CONTRAST CONTROL — without it, a predicate rewritten to `return true`
    // would satisfy the union above while scoping the guard to everything.
    // `explain_from_structure` is the same handler the SCOPE PIN above drives
    // through the real executor, so the two agree by construction.
    expect(isProposedChangeActionType('explain_from_structure')).toBe(false);
    expect(GRAPH_MUTATING_HANDLER_IDS.has('explain_from_structure')).toBe(false);
  });


});
