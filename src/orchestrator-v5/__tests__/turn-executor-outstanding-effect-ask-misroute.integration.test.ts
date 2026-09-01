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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { deriveMissingEffectPairs } from '../routing/repair-value-binding.js';

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
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** The asked pair, bound BY IDENTITY everywhere below — never by a value. */
const ASKED_OPTION = 'o-launch';
const ASKED_FACTOR = 'f-quality';
const ASKED_FACTOR_LABEL = 'Product quality';

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

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(
  impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>,
) {
  return { chatWithTools: vi.fn(impl as never) };
}

/**
 * The proposal the DEPLOYED router actually produced for "Set it to a third."
 * — a `set_factor_value` on the ASKED FACTOR carrying an invented 0.33. The
 * binder had already declined to turn "a third" into a number; this is the
 * downstream path choosing one anyway.
 */
const WRONG_SLOT_PROPOSAL = {
  intent_class: 'execute',
  action: {
    handler_id: 'set_factor_value',
    entity: {
      id: ASKED_FACTOR,
      kind: 'node',
      label: ASKED_FACTOR_LABEL,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value: 0.33, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: ['graph.nodes'],
  },
};

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

describe('a wrong-slot factor write is refused at the turn level', () => {
  it('⭐⭐ NO SUCCESS CLAIM, and the graph is byte-unchanged on the asked factor', async () => {
    const graph = buildOutstandingEffectAskGraph();
    const factorBefore = JSON.stringify(graph.nodes.find((n) => n.id === ASKED_FACTOR));

    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(WRONG_SLOT_PROPOSAL));
    const payload = makeMessagePayload({
      turn_id: 'e1e1e1e1-eeee-4eee-8eee-e1e1e1e1e1e1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'Set it to a third.',
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-oea-refuse', {
      routingAdapter,
      graphState: graph,
    });

    // ── (a) NO SUCCESS CLAIM ────────────────────────────────────────────────
    // No handler ran: the refusal happens at the execute chokepoint, BEFORE
    // dispatch, so there is no receipt to derive in the first place.
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.stages_completed).not.toContain('execute');

    // Nothing reached the UI as an applied change.
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toBeUndefined();

    // The witnessed success sentence — and the invented number inside it — must
    // not be composable. Bound to the ASKED FACTOR'S LABEL, not to a substring
    // another factor could satisfy.
    expect(response.assistant_text.toLowerCase()).toContain("haven't changed anything");
    expect(response.assistant_text).not.toContain(`Updated ${ASKED_FACTOR_LABEL}`);
    expect(response.assistant_text).not.toContain('33%');
    expect(response.assistant_text).not.toContain('0.33');

    // Nothing was COMMITTED as this handler.
    for (const call of appendCalls) {
      expect(call.handler_id).not.toBe('set_factor_value');
    }

    // ── CANONICAL READBACK: the asked factor is byte-identical ──────────────
    // This is the limb a predicate spec cannot reach, and it is the whole
    // point: the defect was a real write to a real field.
    expect(JSON.stringify(graph.nodes.find((n) => n.id === ASKED_FACTOR))).toBe(factorBefore);
    expect(graph.nodes.find((n) => n.id === ASKED_FACTOR)?.observed_state?.value).toBe(0.7);
  });

  it('⭐⭐ THE PENDING REQUEST IS NOT CLEARED — the same pair is still outstanding, by identity', async () => {
    const graph = buildOutstandingEffectAskGraph();
    const before = outstandingPairIds(graph);
    expect(before).toContain(`${ASKED_OPTION}::${ASKED_FACTOR}`);

    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(WRONG_SLOT_PROPOSAL));
    const payload = makeMessagePayload({
      turn_id: 'e2e2e2e2-eeee-4eee-8eee-e2e2e2e2e2e2',
      scenario_id: TEST_SCENARIO_ID,
      message: 'Set it to a third.',
    });

    await runTurnExecutor(payload, 'req-oea-pending', { routingAdapter, graphState: graph });

    // The obligation survives BY IDENTITY. A refusal that quietly satisfied the
    // ask would be the same lie one level down: the user would believe the
    // model holds their number when it does not.
    const after = outstandingPairIds(graph);
    expect(after).toContain(`${ASKED_OPTION}::${ASKED_FACTOR}`);
    expect(after).toEqual(before);

    // And the option's own interventions never acquired the asked factor.
    const option = graph.nodes.find((n) => n.id === ASKED_OPTION) as
      | { interventions?: unknown }
      | undefined;
    const interventions = JSON.stringify(option?.interventions ?? null);
    expect(interventions).not.toContain(ASKED_FACTOR);
  });
});

describe('the opposite direction still lands', () => {
  it('⭐⭐ TWIN: a bindable baseline edit on the SAME asked factor still applies and commits', async () => {
    const graph = buildOutstandingEffectAskGraph();
    // The ask is outstanding on this very factor — the twin must survive it.
    expect(outstandingPairIds(graph)).toContain(`${ASKED_OPTION}::${ASKED_FACTOR}`);

    const payload = makeMessagePayload({
      turn_id: 'e3e3e3e3-eeee-4eee-8eee-e3e3e3e3e3e3',
      scenario_id: TEST_SCENARIO_ID,
      message: `set ${ASKED_FACTOR_LABEL} to 0.4`,
    });

    const { response, telemetry } = await runTurnExecutor(payload, 'req-oea-twin', {
      routingAdapter: throwingRoutingAdapter,
      graphState: graph,
    });

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.stages_completed).toContain('execute');
    expect(response.blocks.find((b) => b.type === 'graph_patch')).toMatchObject({
      operation: 'set_factor_value',
      target_id: ASKED_FACTOR,
      status: 'applied',
    });

    // CANONICAL READBACK on the committed graph — the transition landed on the
    // intended entity and field, which is what makes this a success.
    const committed = appendCalls[0]?.graph as GraphV3T;
    expect(committed.nodes.find((n) => n.id === ASKED_FACTOR)?.observed_state?.value).toBe(0.4);
  });
});
