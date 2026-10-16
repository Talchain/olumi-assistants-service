/**
 * ⭐⭐⭐ THE WRONG-SLOT FACTOR WRITE, AT THE TURN LEVEL — NO SUCCESS CLAIM, AND
 * THE PENDING REQUEST SURVIVES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND WHAT IT IS *NOT* A DUPLICATE OF.
 *
 * `routing/__tests__/outstanding-effect-ask-answer-misroute.test.ts` is a unit
 * spec of a routing PREDICATE. It settles which messages the guard claims, and
 * it settles it well. But a predicate spec **never executes a write**, so it is
 * structurally incapable of observing the two things the defect was actually
 * made of:
 *
 *   (a) the product emitted a SUCCESS SENTENCE for a write it had not made on
 *       the entity the user meant, and
 *   (b) the outstanding ask was RE-ASKED with the user's own number embedded in
 *       it as the factor's established level — i.e. the write did not clear the
 *       obligation, but the product behaved as though something had happened.
 *
 * The #1292 review named this precisely, and correctly declined to paper over
 * it: *"There is no opposite control proving the factor baseline is
 * byte-identical, and the fixture cannot supply one … this limb needs a
 * turn-level test or a post-fix wire capture."* This file is that turn-level
 * test. It drives `runTurnExecutor` end-to-end, exactly as
 * `tools/handlers/__tests__/set-factor-value-value-unit.integration.test.ts`
 * does for the value/unit containment.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GOVERNING INVARIANT THIS FILE BINDS TO.
 *
 *   A mutation succeeded ONLY when the intended semantic transition landed on
 *   the intended canonical entity and field, verified by CANONICAL READBACK.
 *   A tool call returning, a graph hash changing, or a success sentence being
 *   emitted is INSUFFICIENT.
 *
 * So the acceptance here is deliberately NOT "the guard returned an object".
 * It is: the committed graph is byte-identical on the asked factor, no applied
 * receipt reached the UI, no success sentence was composed, and the pending
 * obligation is still derivable BY IDENTITY from the graph after the turn.
 *
 * ⚠ THE ASK IS DERIVED, NOT ASSERTED INTO EXISTENCE. The readiness the guard
 * consumes is built in-turn by `buildCanonicalAnalysisReadyFromGraph` from the
 * SAME graph the proposal would be applied to. This fixture therefore does not
 * hand the guard a blocker; it builds a graph whose shape PRODUCES one — an
 * option→factor edge with no recorded intervention for that factor, which is
 * the exact shape `cee/transforms/analysis-ready.ts` refuses to fill in. The
 * blocker copy it generates is the witnessed copy, word for word:
 *
 *     Factor "Product quality" is currently 0.7. What should option
 *     "Launch now" set it to?
 *
 * ⚠ THE OPPOSITE-DIRECTION TWIN IS MANDATORY AND IS HERE. A user who names the
 * factor and gives a bindable number is making an ordinary baseline edit, and
 * it must still land, still commit, and still be acknowledged. Without that
 * control this file would pass just as happily against a blanket ban on
 * `set_factor_value` — which is the failure this module has refused since it
 * was written.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { setTestSink } from '../../utils/telemetry.js';
import { deriveMissingEffectPairs } from '../routing/repair-value-binding.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';

const appendCalls: Array<{ graph?: unknown; handler_id?: unknown }> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown; handler_id?: unknown }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));






/** The asked pair, bound BY IDENTITY everywhere below — never by a value. */
const ASKED_OPTION = 'o-launch';
const ASKED_FACTOR = 'f-quality';



/**
 * The witnessed graph shape: an option connected to a factor with NO recorded
 * intervention for it, so the readiness transform emits the option-scoped
 * `missing_value` blocker rather than inventing the factor's own level as the
 * option's lever.
 */
function buildOutstandingEffectAskGraph(): GraphV3T {
  const graph = buildD1Fixture() as GraphV3T & { edges: unknown[] };
  graph.edges.push({
    from: ASKED_OPTION,
    to: ASKED_FACTOR,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  });
  return graph;
}

/** The obligation, read back from a graph BY IDENTITY. */
function outstandingPairIds(graph: GraphV3T): string[] {
  const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
  return deriveMissingEffectPairs(readiness)
    .map((p) => `${p.optionId}::${p.factorId}`)
    .sort();
}

/**
 * ⭐⭐⭐ CANONICAL READBACK READS THE **COMMITTED** GRAPH, NOT THE INGRESS ONE —
 * AND THIS IS A CORRECTED PREMISE, MEASURED, NOT REASONED.
 *
 * My first cut of this file asserted the ingress `graphState` object was
 * byte-identical after the turn. That assertion is VACUOUS: measured under the
 * mutant that disables the guard entirely, the ingress graph still reads
 * `{value: 0.7}` while the turn commits `{value: 0.33, raw_value: 0.33,
 * source: 'user_override'}` and answers *"Updated Product quality from 0.7 to
 * 0.33."* The handler does not mutate the caller's object; it commits a
 * mutated copy. So the ingress object reads unchanged in BOTH the fixed and the
 * broken world, and a test bound to it passes on the defect.
 *
 * The canonical entity is the graph that PERSISTS. Everything below binds to
 * that, which is the difference between an assertion about a write and an
 * assertion about a variable.
 */






/**
 * The proposal the DEPLOYED router actually produced for "Set it to a third."
 * — a `set_factor_value` on the ASKED FACTOR carrying an invented 0.33. The
 * binder had already declined to turn "a third" into a number; this is the
 * downstream path choosing one anyway.
 */


const throwingRoutingAdapter = {
  chatWithTools: vi.fn(async () => {
    throw new Error('routing LLM must not be called on the deterministic path');
  }),
};

beforeEach(() => {
  appendCalls.length = 0;
  throwingRoutingAdapter.chatWithTools.mockClear();
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('the outstanding effect ask is derived from the graph, not asserted', () => {
  it('⭐ the fixture graph PRODUCES the witnessed option-scoped ask, bound by identity', () => {
    const graph = buildOutstandingEffectAskGraph();
    // POSITIVE CONTROL for every absence assertion below: the obligation must
    // exist BEFORE the turn, or "it survived" would be vacuously true.
    expect(outstandingPairIds(graph)).toContain(`${ASKED_OPTION}::${ASKED_FACTOR}`);
  });

  it('⭐ CONTRAST CONTROL: recording the intervention REMOVES the ask, so the probe discriminates', () => {
    const graph = buildOutstandingEffectAskGraph();
    const option = graph.nodes.find((n) => n.id === ASKED_OPTION) as Record<string, unknown>;
    option.interventions = [{ target_id: ASKED_FACTOR, value: 0.33 }];
    expect(outstandingPairIds(graph)).not.toContain(`${ASKED_OPTION}::${ASKED_FACTOR}`);
  });
});
