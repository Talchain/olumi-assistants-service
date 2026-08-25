/**
 * THE DECISION CONSTRAINTS — THE WIRE, PROVEN AT ROUTE LEVEL.
 *
 * ⭐⭐ WHY THIS FILE EXISTS.
 *
 * `compactGraph` (orchestrator/context/graph-compact.ts) produces a
 * `GraphV3Compact` whose shape is exactly `{ nodes, edges, _node_count,
 * _edge_count }` — it has NO constraints field and structurally cannot carry
 * one. On the compact path the assembler therefore builds
 * `ContextPack.graph.constraints` from ONE source and one only:
 *
 *     projectCompactGraph(budgeted.compactedGraph, input.compactedConstraints)
 *                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^
 *
 * and `input.compactedConstraints` is fed by a SINGLE LINE in the highest-churn
 * file in the repo (`turn-executor.ts`, at the `assembleContextPackWithSummary`
 * call). The sibling `projectGraph` branch — the only other producer of that
 * field — is unreachable whenever a graph is present, because the same call
 * passes `graph: compactedGraph ? undefined : graphStateForTurn`, and
 * `compactGraphForContextPack` is UNCONDITIONAL: any non-null graph compacts.
 *
 * So: deleting that one line drops EVERY decision constraint from EVERY routing
 * prompt — and, before this file, left the whole suite green (measured: 32,780
 * of 32,969 passing, the single failure an unrelated load-sensitive timeout).
 * A defended pure function with a dark call site is this estate's chronic
 * failure #1, and the turn-executor comment above the line said so in as many
 * words while nothing pinned it.
 *
 * WHY THE EXISTING COVERAGE DOES NOT CLOSE IT. The only prior test is
 * `compact-graph-for-contextpack.test.ts:161`, which calls `assembleContextPack`
 * DIRECTLY and hand-supplies `compactedConstraints` (~:188). Its own comment
 * claims "Verified end-to-end through assembleContextPack" — that is
 * ASSEMBLER-level, not turn-level. A test that supplies the value cannot observe
 * the wire that carries it. Every other reference in the repo passes
 * `compactedConstraints: null` as inert fixture padding.
 *
 * So this asserts the fact through the REAL chain —
 *
 *     runTurnExecutor(payload)
 *       → buildTurnContext            (loads the PERSISTED graph)
 *       → compactGraphForContextPack  (drops goal_constraints)
 *       → assembleContextPackWithSummary (`compactedConstraints` — THE WIRE)
 *       → formatGraphForContext       (display_graph.constraints, verbatim)
 *       → buildUserMessage            (renames display_graph → graph)
 *       → the bytes the routing adapter actually receives
 *
 * — and reads its evidence off the LLM adapter's captured arguments. Nothing
 * here inspects an intermediate object.
 *
 * ⚠⚠ THE PRECONDITION IS PINNED, NOT ASSUMED, AND THIS IS THE LOAD-BEARING
 * PART. If the turn had NOT taken the compact path, `projectGraph` would read
 * `goal_constraints` straight off the raw graph and every assertion below would
 * pass with the wire cut — a test reaching the right verdict by the wrong path.
 * Each arm therefore asserts, from telemetry, that `graph_compacted === true`
 * BEFORE it asserts anything about the pack. `assertCompactPathTaken` is the
 * reason this file is evidence rather than decoration.
 *
 * BINDING IS BY IDENTITY. Constraints are located by their `id` and checked
 * against an exact `source_quote`, never by a value predicate ("some constraint
 * mentions the budget") that a different object could satisfy. The quotes are
 * deliberately ABSENT from the transcript, so no assertion here can be
 * satisfied by the conversation.
 *
 * SCOPE, STATED HONESTLY (status ladder). This proves what the model RECEIVES.
 * It does NOT prove what the model ANSWERS — that needs a wire/journey witness
 * against the deployed build. Rung reached here: TESTED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

const SCENARIO_ID = randomUUID();

/** Constraint identities. Every assertion binds to THESE, never to a substring. */
const BUDGET_ID = 'c_budget_cap';
const HEADCOUNT_ID = 'c_headcount_freeze';

/**
 * The exact recorded quotes. Deliberately NOT present in the transcript below,
 * so an assertion that finds one has found the RECORD and cannot have been
 * satisfied by the conversation.
 */
const BUDGET_QUOTE = 'We cannot spend more than £250,000 on this in the first year.';
const HEADCOUNT_QUOTE = 'No new headcount before April — that one is fixed.';

function budgetConstraint(): Record<string, unknown> {
  return {
    id: BUDGET_ID,
    label: 'Budget ≤ £250k in year one',
    source_quote: BUDGET_QUOTE,
  };
}

function headcountConstraint(): Record<string, unknown> {
  return {
    id: HEADCOUNT_ID,
    label: 'No new headcount before April',
    source_quote: HEADCOUNT_QUOTE,
  };
}

/**
 * The PERSISTED graph the session store returns. `goal_constraints` is the ONE
 * thing that varies between the arms — mutated per test and reset in
 * `beforeEach`, the same pattern the sibling route-level suite uses.
 */
const PERSISTED_GRAPH: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  goal_constraints?: Array<Record<string, unknown>>;
} = {
  nodes: [
    { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
    { id: 'opt_insource', kind: 'option', label: 'Bring support in-house' },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
    {
      id: 'f_ticket_volume',
      kind: 'factor',
      label: 'Monthly ticket volume',
      observed_state: { value: 4200, unit: 'tickets', source: 'user_edited' },
    },
  ],
  edges: [{ from: 'f_ticket_volume', to: 'goal_margin', strength: { mean: -0.3, std: 0.1 } }],
};

/** The prior turn. Its text mentions the SUBJECTS but never the recorded quotes. */
const PRIOR_TURN_USER_MESSAGE = 'We are weighing bringing support in-house.';
const PRIOR_TURN: Record<string, unknown> & { user_message: string | null } = {
  id: 'dddddddd-7a15-4ddd-8ddd-dddddddddddd',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-frame',
  turn_class: 'frame',
  handler_id: null,
  request_hash: 'sha256:prior-frame',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  user_message: PRIOR_TURN_USER_MESSAGE,
  assistant_message: 'Understood — what is holding the decision in place?',
};

vi.mock('../../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit = 20) => [PRIOR_TURN].slice(0, limit),
    countTurns: async () => 1,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readNewestAnalysisFactFor: async () => null,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: PERSISTED_GRAPH,
      briefText: 'Should we bring customer support in-house?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

const THE_QUESTION = 'What are we constrained by on this decision?';

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what the model carries.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

interface TurnObservation {
  /** The exact user message the routing adapter received. */
  readonly prompt: string;
  /** Telemetry captured for the duration of the turn. */
  readonly events: ReadonlyArray<{ name: string; data: Record<string, unknown> }>;
}

async function runTurn(
  message: string,
  clientGraphState?: unknown,
): Promise<TurnObservation> {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  setTestSink((name, data) => {
    events.push({ name, data });
  });
  const { adapter, calls } = textOnlyAdapter();
  try {
    await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      // The CLIENT-supplied `graph_state` wire field, distinct from the
      // persisted graph the store returns. Omitted on the persisted arms.
      ...(clientGraphState === undefined
        ? {}
        : { graphState: clientGraphState as never }),
    });
  } finally {
    setTestSink(() => undefined);
  }
  expect(calls.length, 'the routing adapter was never called — the turn short-circuited before the prompt was built').toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user, 'no user message reached the routing adapter').toBeDefined();
  return {
    prompt: typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content),
    events,
  };
}

/**
 * ⚠⚠ THE PRECONDITION. Without this, every assertion in this file is vacuous:
 * on the NON-compact path `projectGraph` reads `goal_constraints` off the raw
 * graph directly, so the constraints would reach the pack with the
 * `compactedConstraints` wire cut and this suite would stay green over the very
 * defect it exists to catch.
 *
 * Derived from telemetry rather than hand-asserted, and bound to the event NAME
 * constant rather than a copied string literal.
 */
function assertCompactPathTaken(obs: TurnObservation): void {
  const assembled = obs.events.filter((e) => e.name === TelemetryEvents.ContextPackAssembled);
  expect(
    assembled.length,
    'no `v5.context_pack.assembled` telemetry was captured — the precondition probe is BLIND, so nothing below is proven',
  ).toBeGreaterThan(0);
  expect(
    assembled[assembled.length - 1]!.data.graph_compacted,
    'the turn did NOT take the compact path, so `projectGraph` — not `compactedConstraints` — is the field that carried the constraints; this arm proves nothing about the wire',
  ).toBe(true);
}

/** The serialised pack's `graph` (i.e. `display_graph`), asserted present. */
function graphOf(pack: Record<string, unknown>): {
  nodes?: ReadonlyArray<{ id?: unknown }>;
  constraints?: ReadonlyArray<Record<string, unknown>>;
  counts?: { constraints?: unknown };
} {
  const g = pack.graph;
  expect(g, 'the serialised pack carried no `graph` key at all — the assertions below would be vacuous').toBeDefined();
  return g as ReturnType<typeof graphOf>;
}

/** Locate a constraint BY IDENTITY. Never a value predicate. */
function constraintById(
  pack: Record<string, unknown>,
  id: string,
): Record<string, unknown> | undefined {
  const list = graphOf(pack).constraints;
  expect(Array.isArray(list), 'the serialised `graph.constraints` was not an array').toBe(true);
  return (list ?? []).find((c) => (c as { id?: unknown }).id === id);
}

beforeEach(() => {
  // Reset to the state the wire is meant to carry: both constraints recorded.
  PERSISTED_GRAPH.goal_constraints = [budgetConstraint(), headcountConstraint()];
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

describe('route-level — decision constraints reach the routing prompt', () => {
  it('THE WIRE: a persisted goal_constraint arrives in the serialised pack, bound by id and exact source_quote', async () => {
    // PRECONDITION 1 — the fixture genuinely carries the constraints. A fixture
    // that silently lost them would make the pack assertion below unprovable in
    // the other direction, which is how lanes have twice reached a correct
    // verdict by the wrong path.
    expect(
      PERSISTED_GRAPH.goal_constraints?.map((c) => c.id),
      'the persisted fixture does not carry the constraints — nothing downstream could be evidence',
    ).toEqual([BUDGET_ID, HEADCOUNT_ID]);

    const obs = await runTurn(THE_QUESTION);

    // PRECONDITION 2 — the compact path was actually taken (see the helper).
    assertCompactPathTaken(obs);

    const pack = observeSerialisedPack(obs.prompt);
    const budget = constraintById(pack, BUDGET_ID);

    expect(
      budget,
      `no constraint with id "${BUDGET_ID}" reached the prompt — the \`compactedConstraints\` line in turn-executor.ts is cut, and every decision constraint is now invisible to the model`,
    ).toBeDefined();
    // Bound by IDENTITY: the exact recorded quote on the constraint carrying
    // that exact id. No other object in the pack can satisfy both.
    expect(budget!.source_quote).toBe(BUDGET_QUOTE);
  });

  it('EVERY constraint survives, not just the first — both ids and both quotes, plus the count', async () => {
    const obs = await runTurn(THE_QUESTION);
    assertCompactPathTaken(obs);

    const pack = observeSerialisedPack(obs.prompt);

    expect(constraintById(pack, BUDGET_ID)?.source_quote).toBe(BUDGET_QUOTE);
    expect(constraintById(pack, HEADCOUNT_ID)?.source_quote).toBe(HEADCOUNT_QUOTE);
    // `counts.constraints` is derived by projectCompactGraph from the SAME
    // array, so it must agree — a truncating change that dropped one would
    // otherwise leave the count telling the model a different story.
    expect(graphOf(pack).counts?.constraints).toBe(2);
  });

  it('POSITIVE CONTROL — the compact graph itself reaches the prompt, so an absent constraint would be a decision and not an empty pack', async () => {
    const obs = await runTurn(THE_QUESTION);
    assertCompactPathTaken(obs);

    const pack = observeSerialisedPack(obs.prompt);
    const nodeIds = (graphOf(pack).nodes ?? []).map((n) => n.id);

    // Without this, the twin below would pass just as happily if the graph were
    // missing from the prompt entirely, proving nothing about `constraints`.
    expect(nodeIds).toContain('goal_margin');
    expect(nodeIds).toContain('opt_insource');
  });

  it('THE DISCRIMINATOR: constraints present vs absent produce DIFFERENT packs from the same graph and the same transcript', async () => {
    const withConstraints = await runTurn(THE_QUESTION);
    assertCompactPathTaken(withConstraints);
    const withList = graphOf(observeSerialisedPack(withConstraints.prompt)).constraints;

    // OPPOSITE-DIRECTION TWIN. Same nodes, same edges, same conversation — only
    // the recorded constraints are gone.
    delete PERSISTED_GRAPH.goal_constraints;
    const withoutConstraints = await runTurn(THE_QUESTION);
    assertCompactPathTaken(withoutConstraints);
    const withoutPack = observeSerialisedPack(withoutConstraints.prompt);
    const withoutList = graphOf(withoutPack).constraints;

    // Sameness across inputs that ought to differ is evidence about the
    // instrument, not the world. If these agreed, `graph.constraints` would be
    // reading nothing and the pin would prove nothing.
    expect(withoutList).not.toEqual(withList);
    expect(withList).toHaveLength(2);
    expect(withoutList).toEqual([]);
    expect(graphOf(withoutPack).counts?.constraints).toBe(0);
    // And the graph really is still in play on the twin — the difference is the
    // constraints, not a vanished graph.
    expect((graphOf(withoutPack).nodes ?? []).map((n) => n.id)).toContain('goal_margin');
  });

  it('the recorded quotes are NOT reachable from the transcript, so the assertions above are about the RECORD', async () => {
    const obs = await runTurn(THE_QUESTION);
    const pack = observeSerialisedPack(obs.prompt);

    // The conversation genuinely is on the pack (positive control) …
    expect(obs.prompt).toContain(PRIOR_TURN_USER_MESSAGE);
    // … and it does NOT contain the quotes, so a `toContain(BUDGET_QUOTE)`
    // style assertion could never have been satisfied by the conversation.
    // Only the constraints array carries them.
    const packWithoutGraph = { ...pack };
    delete packWithoutGraph.graph;
    expect(JSON.stringify(packWithoutGraph)).not.toContain(BUDGET_QUOTE);
    expect(JSON.stringify(packWithoutGraph)).not.toContain(HEADCOUNT_QUOTE);
  });
});

/**
 * AUTHORITY ORDER, DOCUMENTED DELIBERATELY.
 *
 * `compactedConstraints` reads `graphStateForTurn`, which is REQUEST-FIRST
 * (`turn-executor.ts:2004`) — and that is CORRECT here, unlike its neighbour
 * `goalTarget`: constraints describe the graph the model is REASONING OVER,
 * whereas `goal_target` is a claim about what is SAVED. The two sit three lines
 * apart with deliberately opposite authority orders, which is exactly the shape
 * that gets "tidied" into agreement by a later reader. This arm makes that
 * tidying RED.
 */
describe('route-level — the constraints follow the graph being reasoned over', () => {
  function clientGraph(): Record<string, unknown> {
    return {
      nodes: [
        { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
        { id: 'opt_outsource', kind: 'option', label: 'Outsource to a vendor' },
      ],
      edges: [],
      goal_constraints: [
        { id: 'c_client_only', label: 'Vendor must be UK-based', source_quote: 'The vendor has to be UK-based.' },
      ],
    };
  }

  it('a client-supplied graph_state carries ITS constraints, because it is the graph in play', async () => {
    const obs = await runTurn(THE_QUESTION, clientGraph());
    assertCompactPathTaken(obs);

    const pack = observeSerialisedPack(obs.prompt);

    // Bound by identity to the client constraint's id.
    expect(constraintById(pack, 'c_client_only')?.source_quote).toBe(
      'The vendor has to be UK-based.',
    );
    // POSITIVE CONTROL that the client graph really is the one in play: it
    // carries two nodes where the persisted fixture carries four. Without this,
    // the assertion above could not distinguish "request-first" from "the
    // persisted graph happened to be replaced".
    expect(graphOf(pack).nodes).toHaveLength(2);
    // And the persisted graph's constraints are correspondingly NOT present —
    // the two arms are genuinely reading different graphs.
    expect(constraintById(pack, BUDGET_ID)).toBeUndefined();
  });
});
