/**
 * ⭐ CALIBRATION CONSENT BOUNDARY — the highest-value trust fix on the board.
 *
 * WITNESSED LIVE on staging CEE `e82738b2` by an independent simulated-user
 * review (5 Aug 2026). Evidence:
 *   PHASE0-EVIDENCE-2026-07-28/codex-simulated-user-review-2026-08-05.md §2.1
 *   .../codex-deep-review-2026-08-05-raw/calibration-leak.yml
 *   .../codex-simulated-user-2026-08-05-raw/root/02b-calibration-refusals.snapshot.yml
 *
 * The user typed (CAPTURED VERBATIM — see PROMPT_A / PROMPT_B below):
 *
 *   "I think monthly churn staying below 3% in December is pretty likely.
 *    Please set that estimate and show me the number you will use before
 *    applying it."
 *
 * and the deployed system:
 *   1. APPLIED 3% as the factor's value — an UNCONFIRMED mutation, and the
 *      wrong number: 3% was the user's THRESHOLD, "pretty likely" was the
 *      probability;
 *   2. rendered its own routing deliberation into the user-visible reply
 *      ("...This is a clear set_factor_value request with an explicit value,
 *      so I'll route it...");
 *   3. then, on the follow-up, stated "The model is unchanged so far." —
 *      FALSE; it had just written 3% into Monthly Churn Rate.
 *
 * In sibling sessions the SAME phrase was refused on two visibly
 * percentage-scaled factors with "...doesn't currently carry a percentage
 * scale in your model", while the UI showed `0% -> 100%` and 35%.
 *
 * ── WHY THESE ASSERTIONS ARE SHAPED THIS WAY ──────────────────────────────
 * The consent property is asserted at the **PERSISTENCE BOUNDARY**, never on
 * response wording. `appendCalls` is the session store's `append` write — the
 * only way a turn's graph reaches `scenarios.graph`. A test that asserted
 * "the reply says nothing changed" is exactly the defect: the deployed build
 * SAID nothing changed while the row had already moved.
 *
 * TRAP 13 (a negative assertion needs a positive control): every
 * "nothing was applied" case below is paired with a control that runs the
 * SAME harness, SAME adapter and SAME graph WITHOUT the consent phrase and
 * proves the harness can see a mutation land.
 *
 * TRAP 19 (bind by identity): the mutated node is located by `id`
 * ('f-churn'), never by a value predicate another node could satisfy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

// ---------------------------------------------------------------------------
// THE ACTION BOUNDARY. `append` is the session store's write; `write.graph`
// is `p_graph` on append_turn_atomic. If it is absent the turn changed
// nothing. This mock is the only oracle these tests trust.
// ---------------------------------------------------------------------------
interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  turn_class?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        persistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { getDefaultRegistry } = await import('../tools/registry.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// ---------------------------------------------------------------------------
// CAPTURED PROMPTS — copied byte-for-byte out of the review snapshots. Note
// PROMPT_B's curly quotes: they are what the user's browser sent.
// ---------------------------------------------------------------------------
const PROMPT_A =
  'I think monthly churn staying below 3% in December is pretty likely. Please set that estimate and show me the number you will use before applying it.';
const PROMPT_B =
  'No - that is not what I meant. Please undo that change. By ‘pretty likely’ I mean the probability that churn stays below 3%. What numerical probability does ‘pretty likely’ map to? Do not change the graph until I confirm.';
/** The refusal case, captured from 02-calibration-thinking.snapshot.yml. */
const PROMPT_REFUSED = 'Set AI Chatbot Deployment to pretty likely.';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
  });
}

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore !== undefined) content.push({ type: 'text', text: textBefore });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

/**
 * The routing adapter reproduces the WITNESSED live routing decision: the
 * model read "below 3%" as an explicit set_factor_value and emitted the
 * deliberation as leading text. Keeping the LLM this "wrong" is deliberate —
 * the guarantee under test must hold regardless of what the model decides.
 */
function witnessedRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () =>
        mkToolUseResult(
          {
            intent_class: 'execute',
            action: {
              handler_id: 'set_factor_value',
              entity: {
                id: 'f-churn',
                kind: 'node',
                label: 'Monthly Churn Rate',
                resolution_status: 'resolved',
                resolution_method: 'label_match',
              },
              parameters: [
                { name: 'value', value: { value: 3, unit: '%' }, source: 'user_explicit' },
              ],
              cited_context_fields: [],
            },
          },
          "The user wants churn set to below 3%. There's a parsed quantity of 3% already extracted. This is a clear set_factor_value request with an explicit value, so I'll route it.",
        ),
      ),
  };
}

/** A routing adapter that FAILS the test if the LLM is consulted at all. */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on this path');
      }),
  };
}

/** Monthly Churn Rate: a visibly percentage-scaled factor currently at 5%. */
function buildChurnGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-churn',
        kind: 'factor',
        label: 'Monthly Churn Rate',
        observed_state: { value: 0.05, raw_value: 5, unit: '%', cap: 100 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/** The refusal-case graph: a percentage-scaled factor the system denied had one. */
function buildChatbotGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-csat', kind: 'goal', label: 'Customer Satisfaction' },
      {
        id: 'f-chatbot',
        kind: 'factor',
        label: 'AI Chatbot Deployment',
        observed_state: { value: 0.35, raw_value: 35, unit: '%', cap: 100 },
      },
      { id: 'o-ship', kind: 'option', label: 'Ship it' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/** Every graph write this turn made. Empty === the model is untouched. */
function graphWrites(): AppendWrite[] {
  return appendCalls.filter((c) => c.graph !== undefined && c.graph !== null);
}

function churnRawValue(graph: unknown): number | undefined {
  const nodes = (graph as { nodes?: Array<Record<string, unknown>> }).nodes ?? [];
  // TRAP 19: bind by IDENTITY. `id === 'f-churn'`, never "the node whose
  // value is 3" — another node could satisfy that.
  const node = nodes.find((n) => n.id === 'f-churn') as
    | { observed_state?: { raw_value?: number } }
    | undefined;
  return node?.observed_state?.raw_value;
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  persistedGraph = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('CALIBRATION CONSENT BOUNDARY: "show me before applying" is enforced by the action layer', () => {
  it('CAPTURED PROMPT A — the witnessed unconfirmed mutation: nothing is written to the graph, and the mapped 70% is shown', async () => {
    const routingAdapter = witnessedRoutingAdapter();

    const { response } = await runTurnExecutor(payload(PROMPT_A), 'req-consent-a', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    // ⭐ THE GUARANTEE. Asserted at the persistence boundary, not on prose.
    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();

    // The mapped probability IS surfaced — "pretty likely" is 0.70. It is
    // reported as a PROBABILITY, never proposed as the factor's value; the
    // 2.627 block below owns that distinction.
    expect(response.assistant_text).toContain('70%');

    // Neither number in the sentence may be presented as the value we are
    // about to store: 3% is the user's THRESHOLD and 70% is a probability
    // ABOUT it (ROADMAP 2.627 — the second half of this pair was missing
    // when the PR was first reviewed, and the product offered 70%).
    expect(response.assistant_text).not.toMatch(/set .{0,60}to 3%/i);
    expect(response.assistant_text).not.toMatch(/set .{0,60}to 70%/i);

    // No routing/deliberation text may reach the user.
    expect(response.assistant_text).not.toContain('set_factor_value');
    expect(response.assistant_text.toLowerCase()).not.toContain("i'll route it");
    expect(response.assistant_text.toLowerCase()).not.toContain('parsed quantity');
  });

  it('POSITIVE CONTROL for prompt A (trap 13) — the SAME harness, adapter and graph without the consent phrase DOES apply the mutation', async () => {
    const routingAdapter = witnessedRoutingAdapter();

    await runTurnExecutor(payload('Set Monthly Churn Rate to 3%.'), 'req-consent-a-control', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    // If this is ever 0 the negative assertions above prove nothing.
    expect(graphWrites()).toHaveLength(1);
    expect(churnRawValue(graphWrites()[0]!.graph)).toBe(3);
  });

  it('CAPTURED PROMPT B — "Do not change the graph until I confirm" holds, and the question is answered with 70%', async () => {
    const routingAdapter = witnessedRoutingAdapter();

    const { response } = await runTurnExecutor(payload(PROMPT_B), 'req-consent-b', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();
    expect(response.assistant_text).toContain('70%');
  });

  it('EVENT PROBABILITY vs THRESHOLD — the value offered is 0.70 (the probability), never 0.03 (the threshold)', async () => {
    const routingAdapter = witnessedRoutingAdapter();

    const { response } = await runTurnExecutor(payload(PROMPT_A), 'req-consent-threshold', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    const proposed = events.filter(
      (e) => e.event === 'v5.turn_executor.calibration_consent_withheld',
    );
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.data.probability_value).toBe(0.7);
    expect(proposed[0]!.data.threshold_value).toBe(0.03);
    expect(proposed[0]!.data.matched_phrase).toBe('pretty likely');
    // The user's threshold is acknowledged as a threshold, not swallowed.
    expect(response.assistant_text).toContain('3%');
  });

  it('THE REFUSAL CASE — "Set <percentage factor> to pretty likely" is answered deterministically with 70%, with NO LLM call and NO false claim that the factor lacks a percentage scale', async () => {
    const routingAdapter = throwingRoutingAdapter();

    const { response } = await runTurnExecutor(payload(PROMPT_REFUSED), 'req-consent-refusal', {
      routingAdapter,
      graphState: buildChatbotGraph(),
    });

    // Deterministic: the LLM is never consulted, so it cannot leak
    // deliberation and cannot invent a scale claim.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(response.assistant_text).toContain('70%');
    expect(response.assistant_text.toLowerCase()).not.toContain('percentage scale');
    // Still consent-safe: a bare "set to pretty likely" is a proposal, and the
    // user has not seen the number yet.
    expect(graphWrites()).toHaveLength(0);
  });

  it('POSITIVE CONTROL for the refusal case (trap 13) — the same graph accepts an ordinary numeric set, proving the harness can see this factor mutate', async () => {
    const routingAdapter = {
      chatWithTools: vi
        .fn<
          (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
        >()
        .mockImplementation(async () =>
          mkToolUseResult({
            intent_class: 'execute',
            action: {
              handler_id: 'set_factor_value',
              entity: {
                id: 'f-chatbot',
                kind: 'node',
                label: 'AI Chatbot Deployment',
                resolution_status: 'resolved',
                resolution_method: 'label_match',
              },
              parameters: [
                { name: 'value', value: { value: 70, unit: '%' }, source: 'user_explicit' },
              ],
              cited_context_fields: [],
            },
          }),
        ),
    };

    await runTurnExecutor(payload('Set AI Chatbot Deployment to 70%.'), 'req-refusal-control', {
      routingAdapter,
      graphState: buildChatbotGraph(),
    });

    expect(graphWrites()).toHaveLength(1);
    const nodes = (graphWrites()[0]!.graph as { nodes: Array<Record<string, unknown>> }).nodes;
    const chatbot = nodes.find((n) => n.id === 'f-chatbot') as {
      observed_state?: { raw_value?: number };
    };
    expect(chatbot.observed_state?.raw_value).toBe(70);
  });

  it('THE GUARANTEE IS NOT HANDLER-SPECIFIC — a withheld-consent turn routed to a DIFFERENT mutating handler also writes nothing', async () => {
    // adjust_edge_strength is a separate mutated_graph producer. If the
    // guarantee lived only in the set_factor_value path this would apply.
    //
    // ⚠ THIS TEST PASSED AT PRISTINE and was therefore VACUOUS as first
    // written (CLAUDE.md trap 13b — "a guard agreeing with itself"). It is
    // load-bearing only in company with the control immediately below,
    // which proves the SAME message, adapter and graph DO mutate when the
    // consent clause is removed.
    const { routingAdapter, graph } = edgeStrengthCase();

    await runTurnExecutor(
      payload('Change that link to 0.8, but show me before applying it.'),
      'req-consent-edge',
      { routingAdapter, graphState: graph },
    );

    expect(graphWrites()).toHaveLength(0);
  });

  it('POSITIVE CONTROL for the edge case (trap 13b) — the SAME edge turn without the consent clause DOES write, so the assertion above is not vacuous', async () => {
    const { routingAdapter, graph } = edgeStrengthCase();

    await runTurnExecutor(payload('Change that link to 0.8.'), 'req-consent-edge-control', {
      routingAdapter,
      graphState: graph,
    });

    expect(graphWrites()).toHaveLength(1);
    const edges = (graphWrites()[0]!.graph as { edges: Array<Record<string, unknown>> }).edges;
    // TRAP 19: located by IDENTITY (from/to pair), never by strength value.
    const edge = edges.find((e) => e.from === 'f-churn' && e.to === 'g-revenue') as {
      strength?: { mean?: number };
    };
    expect(edge.strength?.mean).toBeCloseTo(0.8, 10);
  });
});

/**
 * ⭐⭐ LAYER 2 IN ISOLATION — the commit backstop, exercised on a path
 * LAYER 1 cannot see.
 *
 * WHY THIS EXISTS, and it is the most important thing the mutation kit
 * taught this lane: mutant `M2_disable_commit_backstop` (deleting the
 * `consentDirective.withheld` condition from `commitTurn`'s graph strip)
 * SURVIVED the whole suite above. Not because the backstop is redundant —
 * because LAYER 1 stops every mutation before commit on every path those
 * tests drive, so LAYER 2 was never observed. An unobserved guard is
 * indistinguishable from an absent one (CLAUDE.md trap 13c: a survivor is
 * a claim, and a claim must be demonstrated).
 *
 * These tests reach LAYER 2 by routing to a handler id that is REGISTERED
 * and routable but deliberately NOT in `GRAPH_MUTATING_HANDLER_IDS`, and
 * injecting a handler for it that emits a `mutated_graph`. That is exactly
 * the situation the backstop exists for: a mutating route the STEP 2 gate's
 * enumeration does not know about.
 */
/**
 * ⚠ MESSAGE CHANGED 2026-08-07 (ROADMAP 2.652 / INV-1), and the change is
 * deliberately shared by BOTH tests in this block so the consent clause stays
 * the ONLY variable between them.
 *
 * The pair used to read 'Run the analysis.' / 'Run the analysis, but show me
 * the numbers before applying anything.'. INV-1 added a second commit-closure
 * backstop that strips a HANDLER-MUTATED graph on a turn where the user asked
 * for no change — and 'Run the analysis.' asks for no change, so the CONTROL
 * (which relies on a deliberately-misbehaving `run_analysis` handler emitting a
 * `mutated_graph`) stopped persisting for the new reason instead of the old one.
 *
 * Adding a mutation request to both messages restores the control's premise
 * without weakening either test: the control still proves the harness reaches
 * the commit path with this unlisted handler, and the backstop test still
 * proves the WITHHELD strip fires, because the consent clause remains the sole
 * difference. Exempting `run_analysis` from the warrant backstop by name was
 * the alternative and was rejected — that is the hand-maintained list this
 * estate keeps being bitten by (CLAUDE.md trap 12).
 */
const LAYER2_CONTROL_MESSAGE = 'Update the model and run the analysis.';

describe('LAYER 2 — the commit backstop, with LAYER 1 bypassed', () => {
  /** A `run_analysis` handler that (wrongly) mutates the graph. */
  function mutatingUnlistedHandlerRegistry(mutated: unknown) {
    const base = getDefaultRegistry();
    const overridden = new Map(base);
    overridden.set('run_analysis', (async () => ({
      assistant_text: 'Done.',
      handler_facts: [],
      llm_calls_used: 0,
      mutated_graph: mutated,
    })) as never);
    return overridden;
  }

  function runAnalysisProposal() {
    return {
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'o-launch',
          kind: 'option',
          label: 'Launch',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.options'],
      },
    };
  }

  /** The graph such a handler would try to persist: churn moved 5% -> 3%. */
  function mutatedChurnGraph(): unknown {
    const g = buildChurnGraph() as unknown as {
      nodes: Array<{ id: string; observed_state?: { value: number; raw_value: number } }>;
    };
    const churn = g.nodes.find((n) => n.id === 'f-churn')!;
    churn.observed_state = { ...churn.observed_state!, value: 0.03, raw_value: 3 };
    return g;
  }

  it('POSITIVE CONTROL (trap 13) — WITHOUT a consent clause the unlisted mutating handler DOES persist, proving the harness reaches the commit path at all', async () => {
    const mutated = mutatedChurnGraph();
    const routingAdapter = {
      chatWithTools: vi
        .fn<
          (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
        >()
        .mockImplementation(async () => mkToolUseResult(runAnalysisProposal())),
    };

    await runTurnExecutor(payload(LAYER2_CONTROL_MESSAGE), 'req-layer2-control', {
      routingAdapter,
      graphState: buildChurnGraph(),
      handlerRegistry: mutatingUnlistedHandlerRegistry(mutated) as never,
    });

    expect(graphWrites()).toHaveLength(1);
    expect(churnRawValue(graphWrites()[0]!.graph)).toBe(3);
  });

  it('⭐ THE BACKSTOP BITES — the identical turn WITH a consent clause persists no graph, even though LAYER 1 does not know this handler mutates', async () => {
    const mutated = mutatedChurnGraph();
    const routingAdapter = {
      chatWithTools: vi
        .fn<
          (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
        >()
        .mockImplementation(async () => mkToolUseResult(runAnalysisProposal())),
    };

    await runTurnExecutor(
      payload(`${LAYER2_CONTROL_MESSAGE} But show me the numbers before applying anything.`),
      'req-layer2-backstop',
      {
        routingAdapter,
        graphState: buildChurnGraph(),
        handlerRegistry: mutatingUnlistedHandlerRegistry(mutated) as never,
      },
    );

    // LAYER 1 let this through by construction — `run_analysis` is not in
    // GRAPH_MUTATING_HANDLER_IDS — so this assertion can only be satisfied
    // by the commit-closure strip.
    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();

    // ...and the strip is observable, not silent.
    const backstopEvents = events.filter(
      (e) =>
        e.event === 'v5.turn_executor.calibration_consent_withheld' &&
        e.data.layer === 'commit_backstop',
    );
    expect(backstopEvents).toHaveLength(1);
  });
});

/**
 * ⭐⭐ ROADMAP 2.627 — THE NUMBER THE PRODUCT OFFERS MUST BE A NUMBER IT CAN
 * STATE THE SEMANTICS OF.
 *
 * The consent guarantee above holds. The review that measured it found the
 * OFFER wrong, and named why every instrument here missed it: "every
 * instrument was pointed at whether the number is SHOWN and none at whether
 * the number is RIGHT" (CLAUDE.md trap 13c — a mutation kit measures whether
 * a test can DETECT a change; nothing in it can measure whether the
 * expectation is TRUE).
 *
 * DERIVED FROM THE PRODUCER, NOT FROM THIS LANE'S READING OF IT:
 *   - `belief-elicitation/index.ts` declares `CERTAINTY_TERMS` as
 *     "natural language probability expressions -> normalized 0-1 values",
 *     consumed by `elicitBelief` for `target_type: 'prior' | 'edge_weight'`.
 *     0.70 is therefore P(event), never a factor's level.
 *   - `calibration-semantics.ts` itself declares the classification:
 *     "churn staying below 3% is pretty likely" asserts P(churn < 3%) ~ 0.70.
 *
 * So for that sentence the factor's value is NEITHER 0.03 NOR 0.70, and one
 * probability about one threshold does not determine one. Converting it into
 * a point value requires a distributional assumption the user never made.
 *
 * ── WHY THE ASSERTIONS ARE END-TO-END, NOT COPY CHECKS ────────────────────
 * The defect was not only in the sentence. The confirm chip's replay message
 * ("Set Monthly Churn Rate to 70%.") carries no threshold marker and no
 * probability phrase, so REPLAYING IT travels the ordinary numeric path and
 * writes 0.70. A test that only read the sentence would have passed while
 * one click still moved the user's model. These tests therefore REPLAY every
 * suggested action the turn offers and assert at the SAME persistence
 * boundary the consent tests use.
 */
describe('2.627 — a probability-of-threshold utterance offers no point value', () => {
  /**
   * Replay a chip's message as its own turn and report what it wrote.
   * `throwingRoutingAdapter` is deliberate: a replay that needs the LLM is
   * not "the ordinary numeric path", and the throw makes that visible
   * instead of silently passing.
   */
  async function replay(message: string, requestId: string): Promise<AppendWrite[]> {
    appendCalls.length = 0;
    persistedGraph = null;
    await runTurnExecutor(payload(message), requestId, {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildChurnGraph(),
    });
    return graphWrites();
  }

  it('POSITIVE CONTROL (trap 13) — the replay harness CAN see a write, so the absence assertion below is not vacuous', async () => {
    const writes = await replay('Set Monthly Churn Rate to 70%.', 'req-2627-replay-control');
    expect(writes).toHaveLength(1);
    expect(churnRawValue(writes[0]!.graph)).toBe(70);
  });

  it('⭐ NO ACTION THE TURN OFFERS MAY WRITE A VALUE — every suggested action, replayed, writes nothing', async () => {
    const { response } = await runTurnExecutor(payload(PROMPT_A), 'req-2627-offer', {
      routingAdapter: witnessedRoutingAdapter(),
      graphState: buildChurnGraph(),
    });

    const actions = response.suggested_actions ?? [];
    for (const [i, action] of actions.entries()) {
      const message = (action as { message?: string }).message;
      if (typeof message !== 'string' || message.trim().length === 0) continue;
      const writes = await replay(message, `req-2627-offer-replay-${i}`);
      expect(
        writes,
        `suggested action ${(action as { id?: string }).id} replayed as "${message}" wrote a graph`,
      ).toHaveLength(0);
    }
  });

  it('⭐ THE SENTENCE OFFERS NO VALUE EITHER — neither the probability nor the threshold is proposed as the factor value', async () => {
    const { response } = await runTurnExecutor(payload(PROMPT_A), 'req-2627-sentence', {
      routingAdapter: witnessedRoutingAdapter(),
      graphState: buildChurnGraph(),
    });

    // The witnessed-review defect, verbatim: "Confirm and I will set Monthly
    // Churn Rate to 70%." 70% is P(churn < 3%); it is not churn.
    expect(response.assistant_text).not.toMatch(/set .{0,60}to 70%/i);
    // The pre-existing sibling defect the PR already refused: 3% is the bound.
    expect(response.assistant_text).not.toMatch(/set .{0,60}to 3%/i);
  });

  it('what WAS learned is stated, and what is missing is asked for', async () => {
    const { response } = await runTurnExecutor(payload(PROMPT_A), 'req-2627-elicit', {
      routingAdapter: witnessedRoutingAdapter(),
      graphState: buildChurnGraph(),
    });

    // Both numbers survive, each named as what it is — dropping them would
    // discard the only thing the user did tell us.
    expect(response.assistant_text).toContain('70%');
    expect(response.assistant_text).toContain('3%');
    // ...and the turn ends by asking for the value it does not have.
    expect(response.assistant_text).toContain('?');
  });

  /**
   * ⭐⭐ THE SECOND ENTRY POINT, and the mutation kit is the only reason it is
   * here.
   *
   * `M8_preroute_mints_own_chip` (restoring the locally-minted chip at the
   * CALIBRATION PRE-ROUTE) SURVIVED the whole suite. Not because the pre-route
   * is safe — because nothing drove it with a `probability_of_threshold`
   * message. Every threshold case above carries a consent clause and is
   * answered by the STEP 2 gate; every pre-route case above is
   * `probability_only`, where a chip is correct. So the pre-route's threshold
   * branch was UNOBSERVED, and an unobserved guard is indistinguishable from
   * an absent one (CLAUDE.md trap 13b — a guard agreeing with itself because
   * it only looks where nothing is hidden).
   *
   * This message reaches the pre-route: it names the factor by its FULL label
   * (so `resolveFactorLabelForConsentPreview` resolves it — the captured
   * prompt says "monthly churn", which does not match "Monthly Churn Rate"
   * and is why that prompt never took this path), carries an edit verb, a
   * threshold and a probability phrase — and NO consent clause, so the
   * withheld-consent gate is not what is being tested here.
   */
  const PROMPT_PREROUTE_THRESHOLD =
    'Set Monthly Churn Rate on the basis that staying below 3% is pretty likely.';

  it('⭐ THE PRE-ROUTE TOO — a threshold utterance with NO consent clause is answered without an LLM, offers no value, and writes nothing', async () => {
    const routingAdapter = throwingRoutingAdapter();

    const { response } = await runTurnExecutor(
      payload(PROMPT_PREROUTE_THRESHOLD),
      'req-2627-preroute',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    // Proves the PRE-ROUTE served this turn, not the STEP 2 gate: the gate
    // sits downstream of routing, and routing here would throw.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();

    expect(graphWrites()).toHaveLength(0);
    expect(response.suggested_actions ?? []).toHaveLength(0);
    expect(response.assistant_text).not.toMatch(/set .{0,60}to 70%/i);
    expect(response.assistant_text).not.toMatch(/set .{0,60}to 3%/i);
  });

  it('POSITIVE CONTROL for the pre-route (trap 13b) — the SAME route with a `probability_only` message DOES offer a chip, so the emptiness above is a decision, not a dead path', async () => {
    const routingAdapter = throwingRoutingAdapter();

    const { response } = await runTurnExecutor(
      payload('Set Monthly Churn Rate to pretty likely.'),
      'req-2627-preroute-control',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    const actions = response.suggested_actions ?? [];
    expect(actions).toHaveLength(1);
    expect((actions[0] as { id?: string }).id).toBe('chip_prompt_calibration_confirm');
    expect((actions[0] as { message?: string }).message).toBe('Set Monthly Churn Rate to 70%.');
  });

  it('DISCRIMINATING PAIR (trap 19) — the sibling `probability_only` classification is UNTOUCHED and still offers 70%', async () => {
    // If the fix were a blanket "never offer a calibration value" it would
    // pass every assertion above and silently destroy the working half. This
    // is the GREEN half of the pair.
    const routingAdapter = throwingRoutingAdapter();
    const { response } = await runTurnExecutor(payload(PROMPT_REFUSED), 'req-2627-pair-green', {
      routingAdapter,
      graphState: buildChatbotGraph(),
    });

    expect(response.assistant_text).toMatch(/set .{0,60}to 70%/i);
    const chip = (response.suggested_actions ?? []).find(
      (a) => (a as { id?: string }).id === 'chip_prompt_calibration_confirm',
    );
    expect(chip, 'the probability_only confirm chip must survive').toBeDefined();
    expect((chip as { message?: string }).message).toBe('Set AI Chatbot Deployment to 70%.');
  });
});

/**
 * Shared fixture for the pair above — identical inputs, one clause apart.
 *
 * The adapter's return type is spelled out rather than inferred through
 * `ReturnType<typeof vi.fn>`, which widens to `Mock<Procedure | Constructable>`
 * and drops the call signature `runTurnExecutor` requires. `pnpm typecheck`
 * cannot see it (tsconfig.build.json excludes tests); the separate
 * `Typecheck Drift` CI check can, and did — CLAUDE.md trap 2's refinement.
 */
function edgeStrengthCase(): {
  routingAdapter: {
    chatWithTools: (
      args: ChatWithToolsArgs,
      opts: { requestId: string },
    ) => Promise<ChatWithToolsResult>;
  };
  graph: GraphV3T;
} {
  const routingAdapter = {
    chatWithTools: vi
      .fn<
        (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'adjust_edge_strength',
            entity: {
              id: 'f-churn->g-revenue',
              kind: 'edge',
              label: 'Monthly Churn Rate -> Revenue',
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [{ name: 'strength', value: 0.8, source: 'user_explicit' }],
            cited_context_fields: [],
          },
        }),
      ),
  };

  const graph = buildChurnGraph() as unknown as { nodes: unknown[]; edges: unknown[] };
  graph.edges = [
    {
      from: 'f-churn',
      to: 'g-revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ];

  return { routingAdapter, graph: graph as unknown as GraphV3T };
}
