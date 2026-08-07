/**
 * ⭐⭐ INV-1 — MUTATION WARRANT (consent parity). ROADMAP 2.652.
 *
 * WITNESSED LIVE on staging CEE `8687a31`, 6 Aug 2026 (walk 2.634 §J7 —
 * `PHASE0-EVIDENCE-2026-07-28/walk-2634-findings-2026-08-07.md`). The user
 * typed a pure READ request:
 *
 *   "Open the analysis panel and show me the option comparison"
 *
 * and the assistant EDITED the model, verbatim: "Added constraint: churn could
 * rise ceiling must be at most 3%." — marked "Applied", NO confirm chip. The
 * repair could not touch the inverted floor constraint it was repairing, so one
 * unevaluable constraint became two, both blamed on "conditions you set".
 *
 * ── THE MECHANISM (traced at `8687a311`) ──────────────────────────────────
 * Constraint writes were never inside ANY consent regime: Sonnet's
 * `tool_choice:"auto"` can emit an execute-class `add_constraint` on a
 * read-shaped utterance; the D1 lifecycle validates then executes immediately;
 * the Graph-Management referee's op vocabulary structurally cannot hold
 * `add_constraint`; and #831's gate is a WITHHELD-consent detector that fires
 * only on negative phrasing and correctly stood down. No guard anywhere asked
 * the affirmative question: did the user request a change AT ALL?
 *
 * ── THE INVARIANT UNDER TEST ──────────────────────────────────────────────
 * A graph-mutating handler may execute only on a turn carrying an AFFIRMATIVE
 * MUTATION WARRANT (message signal · typed mutation chip · confirm-resume). A
 * mutating proposal without one is DEMOTED to the propose-confirm channel —
 * never executed, never dropped.
 *
 * ── WHY THESE ASSERTIONS ARE SHAPED THIS WAY ──────────────────────────────
 * The property is asserted at the PERSISTENCE BOUNDARY (`append`'s `graph`),
 * never on response wording. The witnessed build SAID "Applied" and that was
 * the honest part; the write was the defect. Sibling precedent:
 * `calibration-consent-boundary.test.ts`.
 *
 * TRAP 13 — every "nothing was applied" case is paired with a control running
 * the SAME harness, adapter and graph on a WARRANTED turn, proving the harness
 * can see that exact mutation land.
 *
 * TRAP 19 — the demotion binds to WARRANT-ABSENCE, not to `add_constraint`
 * identity. The discriminating pair is explicit below: a warrantless
 * `set_factor_value` demotes, and a warranted `add_constraint` executes.
 * Graph rows are located by `id` / `node_id`, never by a value predicate
 * another row could satisfy.
 *
 * ⚠ TRAP 13b (a guard agreeing with itself) — two cases in the first draft of
 * this file PASSED AT PRISTINE and were therefore vacuous, and both are
 * repaired here rather than kept:
 *   · the chip assertion passed on ANY chip; it now binds to the proposal chip
 *     by id prefix AND wire action_type AND the persisted pending action.
 *   · the warrantless `set_factor_value` case passed because the message said
 *     "option comparison", which trips `OPTION_INTERVENTION_MISROUTE` in the
 *     validator — the graph was spared by a DIFFERENT guard entirely. It now
 *     uses a read utterance with no option language, and carries its own
 *     positive control.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// THE ACTION BOUNDARY. `append` is the session store's write; `write.graph` is
// `p_graph` on append_turn_atomic. Absent === the turn changed nothing.
// ---------------------------------------------------------------------------
interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  turn_class?: unknown;
  pending_actions?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;
let servedGraph: unknown = null;
let pendingActionsForRead: readonly PendingAction[] = [];

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
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => pendingActionsForRead,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph ?? servedGraph,
    loadGraphAndBriefText: async () => ({
      graph: persistedGraph ?? servedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * CAPTURED VERBATIM from the walk (§J7): a pure read request — no mutation
 * verb, no target, no value. This is the utterance the defect fired on.
 */
const WALK_READ_UTTERANCE = 'Open the analysis panel and show me the option comparison';

/**
 * A second read utterance, deliberately free of option language. The walk's own
 * sentence trips the validator's OPTION_INTERVENTION_MISROUTE on a
 * `set_factor_value` proposal, which would spare the graph for a reason that
 * has nothing to do with warrants (trap 13b).
 */
const PLAIN_READ_UTTERANCE = 'Show me how the model looks right now.';

function payload(message: string, overrides: Partial<MessageTurnPayload> = {}): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    ...overrides,
  });
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

/**
 * Reproduces the WITNESSED routing decision: `tool_choice:"auto"` emitted an
 * execute-class `add_constraint` on a read-shaped utterance. Keeping the model
 * this "wrong" is deliberate — the guarantee must hold regardless of what the
 * model decides, because on the witnessed turn the model decided to mutate.
 */
function witnessedAddConstraintAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'add_constraint',
            entity: {
              id: 'f-churn',
              kind: 'node',
              label: 'Customer Churn Rate',
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [
              { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
              { name: 'value', value: 3, source: 'user_explicit' },
              { name: 'unit', value: '%', source: 'user_explicit' },
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

/** The trap-19 twin: a DIFFERENT mutating handler, same warrant question. */
function witnessedSetFactorValueAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () =>
        mkToolUseResult({
          intent_class: 'execute',
          action: {
            handler_id: 'set_factor_value',
            entity: {
              id: 'f-churn',
              kind: 'node',
              label: 'Customer Churn Rate',
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [
              { name: 'value', value: { value: 2, unit: '%' }, source: 'user_explicit' },
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

/** Fails the test if the LLM is consulted at all. */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on this path');
      }),
  };
}

/** The walk's own graph shape: a percentage-scaled churn factor. */
function buildChurnGraph(extra: Record<string, unknown> = {}): GraphV3T {
  return {
    nodes: [
      { id: 'g-mrr', kind: 'goal', label: 'Reach 250,000 MRR' },
      {
        id: 'f-churn',
        kind: 'factor',
        label: 'Customer Churn Rate',
        observed_state: { value: 0.05, raw_value: 5, unit: '%', cap: 100 },
      },
      { id: 'o-outbound', kind: 'option', label: 'Expand Outbound Sales' },
    ],
    edges: [],
    ...extra,
  } as unknown as GraphV3T;
}

/**
 * The walk's actual mid-arc state: the drafter's INVERTED floor is already on
 * the model. `add_constraint`'s idempotency key is `(node_id, operator)`, so an
 * `at_most` proposal cannot update this `>=` row — it can only append beside
 * it. That is the INV-2 case.
 */
function buildChurnGraphWithInvertedFloor(): GraphV3T {
  return buildChurnGraph({
    goal_constraints: [
      {
        constraint_id: 'c-churn-floor',
        node_id: 'f-churn',
        operator: '>=',
        value: 3,
        unit: '%',
        label: 'churn could rise floor',
      },
    ],
  });
}

/** Every graph write this turn made. Empty === the model is untouched. */
function graphWrites(): AppendWrite[] {
  return appendCalls.filter((c) => c.graph !== undefined && c.graph !== null);
}

/** TRAP 19: bind by IDENTITY (`node_id === 'f-churn'`), never by value. */
function churnConstraints(graph: unknown): Array<Record<string, unknown>> {
  const rows = (graph as { goal_constraints?: unknown }).goal_constraints;
  return Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>).filter((r) => r.node_id === 'f-churn')
    : [];
}

/** TRAP 19: the churn factor by id, never "the node whose value is 2". */
function churnRawValue(graph: unknown): number | undefined {
  const nodes = (graph as { nodes?: Array<Record<string, unknown>> }).nodes ?? [];
  const node = nodes.find((n) => n.id === 'f-churn') as
    | { observed_state?: { raw_value?: number } }
    | undefined;
  return node?.observed_state?.raw_value;
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

function warrantEvents(layer: string): SinkEvent[] {
  return events.filter(
    (e) => e.event === 'v5.turn_executor.mutation_warrant_absent' && e.data.layer === layer,
  );
}

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  persistedGraph = null;
  servedGraph = null;
  pendingActionsForRead = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('INV-1 — a graph-mutating handler executes only on an affirmative mutation warrant', () => {
  it('⭐ THE WITNESSED DEFECT (walk §J7) — the read utterance that routed to add_constraint writes NOTHING to the graph', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(payload(WALK_READ_UTTERANCE), 'req-warrant-walk', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    // ⭐ THE GUARANTEE, at the persistence boundary.
    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();
    // …and the gate is the reason, not some unrelated validator refusal.
    expect(warrantEvents('step2_gate')).toHaveLength(1);
    expect(warrantEvents('step2_gate')[0]!.data.handler_id).toBe('add_constraint');
  });

  it('⭐ THE WITNESSED DEFECT (walk §J7) — the proposal is DEMOTED to a proposal chip and a persisted pending, not dropped', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    const { response } = await runTurnExecutor(payload(WALK_READ_UTTERANCE), 'req-warrant-chip', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    // Bind to THE PROPOSAL CHIP by identity, not to "some chip exists": the
    // stable `prop_` handle AND the wire action_type of the demoted intent.
    const chips = response.suggested_actions ?? [];
    const proposalChip = chips.find(
      (c) => c.id.startsWith('prop_') && c.action_type === 'add_constraint',
    );
    expect(proposalChip).toBeDefined();

    // Chip and pending are emitted atomically — a chip with no pending is an
    // offer the resumer cannot honour, and a pending with no chip is a zombie.
    const committedPendings = appendCalls.flatMap((c) =>
      Array.isArray(c.pending_actions) ? (c.pending_actions as Array<Record<string, unknown>>) : [],
    );
    const proposalPending = committedPendings.find(
      (p) => (p as { chip_id?: unknown }).chip_id === proposalChip!.id,
    );
    expect(proposalPending).toBeDefined();
    expect(
      ((proposalPending as { action?: { inline_patch?: { handler_id?: unknown } } }).action
        ?.inline_patch?.handler_id),
    ).toBe('add_constraint');

    // The witnessed build said "Applied". A demoted turn must not.
    expect(response.assistant_text.toLowerCase()).not.toContain('applied');
    expect(response.assistant_text.toLowerCase()).toContain('nothing has been changed');
    // No internal vocabulary reaches the user.
    expect(response.assistant_text).not.toContain('add_constraint');
    expect(proposalChip!.label).not.toContain('add_constraint');
  });

  it('TRAP 13 POSITIVE CONTROL — the SAME adapter and graph on a WARRANTED message DOES apply the constraint', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(
      payload('Add a constraint that churn must be at most 3%.'),
      'req-warrant-control',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    // If this is ever 0 the negative assertions above prove nothing.
    expect(graphWrites()).toHaveLength(1);
    expect(churnConstraints(graphWrites()[0]!.graph)).toHaveLength(1);
    expect(warrantEvents('step2_gate')).toHaveLength(0);
  });

  it('WARRANT SOURCE 1 — a CONSTRAINT phrasing the canonical mutation-signal list does not carry ("Keep churn below 3%.") still executes', async () => {
    // This is the corpus doing its job (CLAUDE.md trap 12d): the canonical
    // `MUTATION_SIGNAL_PATTERNS` recognises "set X to N" and "add a Y" and no
    // constraint phrasing at all, so without the hand-written extension this
    // legitimate edit would demote to a chip.
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(payload('Keep churn below 3%.'), 'req-warrant-constraint-phrase', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    expect(graphWrites()).toHaveLength(1);
    expect(churnConstraints(graphWrites()[0]!.graph)).toHaveLength(1);
  });

  it('WARRANT SOURCE 2 — a TYPED MUTATION CHIP CLICK is a warrant even though its message carries no signal', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(
      payload('Do that.', {
        source: 'chip_click',
        chip: { id: 'chip-x', action_type: 'add_constraint' },
      }),
      'req-warrant-typed-chip',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    expect(graphWrites()).toHaveLength(1);
    expect(warrantEvents('step2_gate')).toHaveLength(0);
  });

  it('WARRANT SOURCE 2 CONTROL — the SAME message with NO typed chip demotes, proving the chip TYPE is what granted it', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(payload('Do that.'), 'req-warrant-typed-chip-control', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    expect(graphWrites()).toHaveLength(0);
    expect(warrantEvents('step2_gate')).toHaveLength(1);
  });

  it('WARRANT SOURCE 3 — a CONFIRM-RESUME of a proposal the user was offered executes on a bare "yes" (no signal in the message at all)', async () => {
    const graph = buildChurnGraph();
    servedGraph = graph;
    const graphHash =
      computeAnalysisAffectingGraphHash(
        graph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      ) ?? 'h_unset';
    const proposalId = 'prop_bbbbbbbbbbbb';
    pendingActionsForRead = [
      {
        id: `pa-${randomUUID()}`,
        scenario_id: SCENARIO_ID,
        chip_id: proposalId,
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: proposalId,
          inline_patch: {
            handler_id: 'add_constraint',
            params: { constraint_type: 'at_most', value: 3, unit: '%' },
            target_entity_ids: ['f-churn'],
          },
          public_label: 'Add this limit',
          public_message: 'Add that limit to my model.',
        },
        preconditions: { graph_hash: graphHash },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-08-07T11:00:00.000Z',
      } as PendingAction,
    ];

    // "yes" carries no mutation signal and no typed chip. If it executes, the
    // ONLY thing that could have authorised it is the confirm-resume source.
    await runTurnExecutor(payload('yes'), 'req-warrant-confirm-resume', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: graph,
    });

    expect(graphWrites()).toHaveLength(1);
    expect(churnConstraints(graphWrites()[0]!.graph)).toHaveLength(1);
    expect(warrantEvents('step2_gate')).toHaveLength(0);
  });
});

describe('INV-1 — TRAP 19: the demotion binds to WARRANT-ABSENCE, not to a handler identity', () => {
  it('DISCRIMINATING PAIR (a) — a warrantless set_factor_value demotes too', async () => {
    const routingAdapter = witnessedSetFactorValueAdapter();

    await runTurnExecutor(payload(PLAIN_READ_UTTERANCE), 'req-warrant-sfv', {
      routingAdapter,
      graphState: buildChurnGraph(),
    });

    expect(graphWrites()).toHaveLength(0);
    expect(warrantEvents('step2_gate')).toHaveLength(1);
    expect(warrantEvents('step2_gate')[0]!.data.handler_id).toBe('set_factor_value');
  });

  it('DISCRIMINATING PAIR (a) CONTROL — the SAME set_factor_value adapter and graph on a warranted message DOES write the value', async () => {
    // Without this the case above proves only that SOMETHING stopped the
    // write. The walk's own utterance trips OPTION_INTERVENTION_MISROUTE for
    // this handler; `PLAIN_READ_UTTERANCE` does not, and this control is what
    // proves it does not.
    const routingAdapter = witnessedSetFactorValueAdapter();

    await runTurnExecutor(
      payload('Set Customer Churn Rate to 2%.'),
      'req-warrant-sfv-control',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    expect(graphWrites()).toHaveLength(1);
    expect(churnRawValue(graphWrites()[0]!.graph)).toBe(2);
  });

  it('DISCRIMINATING PAIR (b) — a WARRANTED add_constraint still executes (the gate is not "add_constraint never applies")', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(
      payload('Churn must be at most 3%.'),
      'req-warrant-pair-b',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    expect(graphWrites()).toHaveLength(1);
  });
});

/**
 * ⭐⭐ LAYER 2 — THE COMMIT BACKSTOP, WITH LAYER 1 BYPASSED.
 *
 * CLAUDE.md trap 13c: an unobserved guard is indistinguishable from an absent
 * one, and a survivor is a claim that must be DEMONSTRATED. Every case above
 * is stopped by LAYER 1, so LAYER 2 would survive the whole file untested —
 * exactly the hole the calibration suite found in its own withheld backstop.
 *
 * These reach LAYER 2 the same way that suite does: route to a handler that is
 * REGISTERED and routable but deliberately NOT in `GRAPH_MUTATING_HANDLER_IDS`,
 * and inject a handler for it that emits a `mutated_graph`. That is precisely
 * the situation the backstop exists for — a mutating route LAYER 1's
 * enumeration does not know about.
 */
describe('INV-1 LAYER 2 — the commit backstop, with LAYER 1 bypassed', () => {
  /**
   * A warrantless message that still REACHES the routing adapter. Measured:
   * 'Explain the results.' never gets there — the deterministic analytical
   * guards claim it upstream — so a LAYER-2 assertion built on it would pass
   * by testing nothing (trap 13). 'Run the analysis.' carries no edit verb and
   * no mutation signal, and the calibration suite already establishes that it
   * reaches the adapter on this harness.
   */
  const LAYER2_WARRANTLESS_MESSAGE = 'Run the analysis.';

  /** A `run_analysis` handler that (wrongly) mutates the graph. */
  async function mutatingUnlistedRegistry(mutated: unknown) {
    const { getDefaultRegistry } = await import('../tools/registry.js');
    const overridden = new Map(getDefaultRegistry());
    overridden.set('run_analysis', (async () => ({
      assistant_text: 'Done.',
      handler_facts: [],
      llm_calls_used: 0,
      mutated_graph: mutated,
    })) as never);
    return overridden;
  }

  /** A `run_analysis` handler that does NOT mutate — the adoption case. */
  async function nonMutatingUnlistedRegistry() {
    const { getDefaultRegistry } = await import('../tools/registry.js');
    const overridden = new Map(getDefaultRegistry());
    overridden.set('run_analysis', (async () => ({
      assistant_text: 'Done.',
      handler_facts: [],
      llm_calls_used: 0,
    })) as never);
    return overridden;
  }

  function runAnalysisAdapter() {
    return {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () =>
          mkToolUseResult({
            intent_class: 'execute',
            action: {
              handler_id: 'run_analysis',
              entity: {
                id: 'o-outbound',
                kind: 'option',
                label: 'Expand Outbound Sales',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [],
              cited_context_fields: ['graph.options'],
            },
          }),
        ),
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

  it('⭐ THE BACKSTOP BITES — a warrantless turn persists no graph even though LAYER 1 does not know this handler mutates', async () => {
    await runTurnExecutor(payload(LAYER2_WARRANTLESS_MESSAGE), 'req-warrant-layer2', {
      routingAdapter: runAnalysisAdapter(),
      graphState: buildChurnGraph(),
      handlerRegistry: (await mutatingUnlistedRegistry(mutatedChurnGraph())) as never,
    });

    // LAYER 1 let this through by construction — `run_analysis` is not in
    // GRAPH_MUTATING_HANDLER_IDS — so this can only be the commit strip.
    expect(warrantEvents('step2_gate')).toHaveLength(0);
    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();
    // …and the strip is observable, not silent.
    expect(warrantEvents('commit_backstop')).toHaveLength(1);
  });

  it('TRAP 13 POSITIVE CONTROL — the identical turn on a WARRANTED message DOES persist, proving the harness reaches the commit path', async () => {
    await runTurnExecutor(
      payload('Update the model and run the analysis.'),
      'req-warrant-layer2-control',
      {
        routingAdapter: runAnalysisAdapter(),
        graphState: buildChurnGraph(),
        handlerRegistry: (await mutatingUnlistedRegistry(mutatedChurnGraph())) as never,
      },
    );

    expect(graphWrites()).toHaveLength(1);
    expect(churnRawValue(graphWrites()[0]!.graph)).toBe(3);
    expect(warrantEvents('commit_backstop')).toHaveLength(0);
  });

  it('⚠ THE SCOPING CONJUNCT — graph ADOPTION on a warrantless read turn is NOT stripped', async () => {
    // The load-bearing distinction, and the reason LAYER 2 cannot simply strip
    // every warrantless graph the way the withheld backstop does. The commit
    // chokepoint's case A ("no persisted model + incoming graph_state + no
    // mutation → ADOPT") persists the user's model on a turn that changed
    // nothing. Stripping that would silently refuse to save a user's graph on
    // their first read turn — a regression far worse than the defect.
    await runTurnExecutor(payload(LAYER2_WARRANTLESS_MESSAGE), 'req-warrant-adoption', {
      routingAdapter: runAnalysisAdapter(),
      graphState: buildChurnGraph(),
      handlerRegistry: (await nonMutatingUnlistedRegistry()) as never,
    });

    expect(graphWrites()).toHaveLength(1);
    // Adopted UNCHANGED — churn is still at its original 5%, so this is an
    // adoption and not a mutation that happened to slip through.
    expect(churnRawValue(graphWrites()[0]!.graph)).toBe(5);
    expect(warrantEvents('commit_backstop')).toHaveLength(0);
  });
});

describe('INV-1 — the withheld-consent gate keeps precedence (#831 must not regress)', () => {
  it('a message that BOTH asks for the change and withholds consent is answered as WITHHELD, not demoted', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    await runTurnExecutor(
      payload('Keep churn below 3%, but show me before applying it.'),
      'req-warrant-withhold-precedence',
      { routingAdapter, graphState: buildChurnGraph() },
    );

    // Nothing written either way — but the RECORD must say withheld, because
    // that is the more specific true fact about the turn.
    expect(graphWrites()).toHaveLength(0);
    const withheld = events.filter(
      (e) =>
        e.event === 'v5.turn_executor.calibration_consent_withheld' &&
        e.data.layer === 'step2_gate',
    );
    expect(withheld).toHaveLength(1);
    expect(warrantEvents('step2_gate')).toHaveLength(0);
  });
});

describe('INV-2 — a repair that cannot touch the defective row discloses that it survives (ROADMAP 2.659 rider)', () => {
  it('the walk arc: proposing an at_most ceiling beside an inverted at_least floor discloses the floor would REMAIN', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    const { response } = await runTurnExecutor(
      payload(WALK_READ_UTTERANCE),
      'req-warrant-inv2',
      { routingAdapter, graphState: buildChurnGraphWithInvertedFloor() },
    );

    expect(graphWrites()).toHaveLength(0);
    // The walk's complaint was not that a constraint appeared — it was that the
    // broken one stayed and nothing said so.
    expect(response.assistant_text).toContain('churn could rise floor');
    expect(response.assistant_text.toLowerCase()).toContain('stay in place');
  });

  it('CONTROL — a SAME-OPERATOR proposal updates in place, so no residual is disclosed (the disclosure is not unconditional)', async () => {
    const routingAdapter = witnessedAddConstraintAdapter();

    const { response } = await runTurnExecutor(
      payload(WALK_READ_UTTERANCE),
      'req-warrant-inv2-control',
      {
        routingAdapter,
        graphState: buildChurnGraph({
          goal_constraints: [
            {
              constraint_id: 'c-churn-ceiling',
              node_id: 'f-churn',
              // SAME operator as the at_most proposal → updates in place.
              operator: '<=',
              value: 5,
              unit: '%',
              label: 'churn ceiling',
            },
          ],
        }),
      },
    );

    expect(graphWrites()).toHaveLength(0);
    expect(response.assistant_text.toLowerCase()).not.toContain('stay in place');
  });
});

/**
 * ⭐⭐ ROADMAP 2.663 (F-B) — OFFER ACCEPTANCE IS A WARRANT.
 *
 * WITNESSED (consent-witness walk, CEE `bb33751`): the demotion above emits an
 * offer, the user accepts it in their own words, and the gate answers "You did
 * not ask me to edit the model." That is the demotion's own dead end — the
 * consent loop offer → yes → "you did not ask me" — and it is closed by
 * WIDENING WARRANT SOURCE 3 (confirm-resume), never by weakening the gate.
 *
 * The unit-level vocabulary lives in
 * `routing/__tests__/short-confirm-offer-reference.test.ts`. THIS file asserts
 * the property that matters at the persistence boundary: the acceptance turn
 * WRITES, and the gate stands down because a pending was consumed — not
 * because the message was re-classified as a mutation request.
 */
describe('INV-1 / 2.663 F-B — accepting the assistant’s own offer carries the warrant', () => {
  function seedDemotedProposal(graph: GraphV3T): void {
    servedGraph = graph;
    const graphHash =
      computeAnalysisAffectingGraphHash(
        graph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      ) ?? 'h_unset';
    pendingActionsForRead = [
      {
        id: `pa-${randomUUID()}`,
        scenario_id: SCENARIO_ID,
        chip_id: 'prop_offeraccept0',
        action: {
          kind: 'apply_proposed_change',
          proposal_ref: 'prop_offeraccept0',
          inline_patch: {
            handler_id: 'add_constraint',
            params: { constraint_type: 'at_most', value: 3, unit: '%' },
            target_entity_ids: ['f-churn'],
          },
          public_label: 'Add this limit',
          public_message: 'Add that limit to my model.',
        },
        preconditions: { graph_hash: graphHash },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-08-07T11:00:00.000Z',
      } as PendingAction,
    ];
  }

  it('⭐ THE WITNESSED DEAD END — "Yes, please rephrase … as you offered earlier." now APPLIES the held offer', async () => {
    const graph = buildChurnGraph();
    seedDemotedProposal(graph);

    await runTurnExecutor(
      payload('Yes, please rephrase the churn constraint as you offered earlier.'),
      'req-offer-accept-witnessed',
      { routingAdapter: throwingRoutingAdapter(), graphState: graph },
    );

    // TRAP 19 — the constraint lands on f-churn BY ID, not "a constraint exists".
    expect(graphWrites()).toHaveLength(1);
    expect(churnConstraints(graphWrites()[0]!.graph)).toHaveLength(1);
    // The gate stood down because a pending was CONSUMED (warrant source 3),
    // which is the only reason available: the throwing adapter proves no LLM
    // reclassified the utterance, and the message carries no mutation signal.
    expect(warrantEvents('step2_gate')).toHaveLength(0);
  });

  it('⭐ the generic form the row names — "Yes, please do what you offered." — applies it too', async () => {
    const graph = buildChurnGraph();
    seedDemotedProposal(graph);

    await runTurnExecutor(
      payload('Yes, please do what you offered.'),
      'req-offer-accept-generic',
      { routingAdapter: throwingRoutingAdapter(), graphState: graph },
    );

    expect(graphWrites()).toHaveLength(1);
    expect(churnConstraints(graphWrites()[0]!.graph)).toHaveLength(1);
    expect(warrantEvents('step2_gate')).toHaveLength(0);
  });

  it('⭐ CONTROL — the SAME back-reference on a READ-shaped ask writes NOTHING (2.652 must not run backwards)', async () => {
    const graph = buildChurnGraph();
    seedDemotedProposal(graph);

    // Read intent present, and the back-reference verb is one the pattern DOES
    // recognise (`offered`) — an earlier draft said "described", which the
    // back-reference set never matched, so the control was blocked by
    // vocabulary rather than by the guard it names (trap 13b; mutant M4
    // survived it). If the widened vocabulary ever swallows this, a held
    // mutation applies on a turn that asked to LOOK.
    await runTurnExecutor(
      payload('Yes, show me the option comparison as you offered earlier.'),
      'req-offer-accept-read-control',
      { routingAdapter: witnessedAddConstraintAdapter(), graphState: graph },
    );

    expect(graphWrites()).toHaveLength(0);
  });

  it('⭐ CONTROL — an acceptance naming its OWN value does not resume the held proposal', async () => {
    const graph = buildChurnGraph();
    seedDemotedProposal(graph);

    // The held proposal is 3%. Resuming it here would apply 3% while the user
    // typed 5% — a wrong-target mutation wearing the clothes of consent.
    await runTurnExecutor(
      payload('Yes, set churn to 5% as you offered earlier.'),
      'req-offer-accept-quantity-control',
      { routingAdapter: throwingRoutingAdapter(), graphState: graph },
    );

    // The throwing adapter means "did not resume" is the only survivable
    // outcome; a resume would have written 3%.
    expect(churnConstraints(persistedGraph ?? {})).toHaveLength(0);
  });
});
