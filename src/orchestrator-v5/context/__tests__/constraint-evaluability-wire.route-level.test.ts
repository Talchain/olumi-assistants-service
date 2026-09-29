/**
 * THE EVALUABILITY VERDICT — THE WIRE, PROVEN AT ROUTE LEVEL.
 *
 * ⭐⭐ WHY THIS FILE EXISTS.
 *
 * #1484 made the WRITE-TIME constraint receipt say when a limit's target node
 * records no number, so the analysis cannot evaluate it. It did not, and could
 * not, reach the SECOND production call site of the same receipt copy:
 * `context/recent-changes.ts:425` re-renders `formatConstraintAdded` into
 * `ContextPack.recent_changes` on EVERY LATER TURN, from a site that holds no
 * graph. So the routing model was re-grounded on an unqualified "Added
 * constraint: …" for the rest of the conversation — which is why the product
 * goes on to restate a limit it had already, correctly, disclaimed.
 *
 * The verdict now travels: `collectNotCheckableConstraintIds` is derived in
 * `turn-executor.ts` beside `compactedConstraints` and passed to the assembler
 * as `notCheckableConstraintIds`. That is ONE LINE in the highest-churn file in
 * the repo, and cutting it does NOT remove a `recent_changes` entry — it
 * silently strips the qualification, restoring the pre-#1484 product with
 * nothing red. This file is what makes that line fail loud.
 *
 * ⚠⚠ THE PRECONDITION IS PINNED, NOT ASSUMED, AND IT IS THE LOAD-BEARING PART.
 * The assembler ALSO declares a `graph` input, and a future reader could
 * reasonably believe the verdict could be derived from it instead. It could
 * not: `turn-executor.ts` passes `graph: compactedGraph ? undefined :
 * contextGraphForReasoning`, and `compactGraphForContextPack` returns `absent`
 * ONLY for a null/undefined graph — so on every turn that HAS a graph the
 * assembler's `graph` is `undefined`. (The sibling
 * `decision-constraints-wire.route-level.test.ts` establishes the same fact for
 * the constraints wire, independently and for its own reasons.) Each arm
 * therefore asserts from telemetry that the turn took the COMPACT path BEFORE
 * it asserts anything about the pack — so this suite is evidence that the
 * verdict arrives on the path production actually takes.
 *
 * BINDING IS BY IDENTITY. The two limits below are located by their own
 * `constraint_id`s and distinguished by their persisted labels. They differ in
 * EXACTLY ONE respect — whether the node they point at records a number — so an
 * arm satisfied by the wrong object would have to be satisfied by an object
 * carrying the opposite verdict. Neither label appears in the transcript, so no
 * assertion here can be met by the conversation.
 *
 * SCOPE, STATED HONESTLY (status ladder). This proves what the model RECEIVES.
 * It does NOT prove what the model ANSWERS — that needs a wire/journey witness
 * against the deployed build. Rung reached here: TESTED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import { formatConstraintAdded } from '../../tools/handlers/d1-shared/format-confirmation.js';
import { RECENT_CHANGES_SUMMARY_MAX_CHARS } from '../recent-changes.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

const { storeDraftGraphMock } = vi.hoisted(() => ({
  storeDraftGraphMock: vi.fn(async () => undefined),
}));

const SCENARIO_ID = randomUUID();

/** Identities. Every assertion binds to THESE. */
const CHURN_CONSTRAINT_ID = 'gc-11111111-1111-4111-8111-111111111111';
const COST_CONSTRAINT_ID = 'gc-22222222-2222-4222-8222-222222222222';
const CHURN_NODE_ID = 'risk_churn';
const COST_NODE_ID = 'f_support_cost';

/**
 * The persisted labels. Deliberately absent from the transcript below, so an
 * assertion that finds one has found the RECORD.
 */
const CHURN_LABEL = 'Churn must not exceed 7% for more than 3 months';
const COST_LABEL = 'Support cost must be at most 250000';

/**
 * The persisted graph. `risk_churn` is the measured 44e349fa shape — the limit's
 * target records NOTHING on any of the nine quantity fields. `f_support_cost`
 * is the contrast and records a number, in the same graph, on the same turn.
 */
const PERSISTED_GRAPH: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  goal_constraints: Array<Record<string, unknown>>;
} = {
  nodes: [
    { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
    { id: 'opt_insource', kind: 'option', label: 'Bring support in-house' },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
    { id: CHURN_NODE_ID, kind: 'risk', label: 'Subscriber Churn Rate' },
    {
      id: COST_NODE_ID,
      kind: 'factor',
      label: 'Support cost',
      observed_state: { value: 180000, unit: 'GBP', source: 'user_edited' },
    },
  ],
  edges: [{ from: COST_NODE_ID, to: 'goal_margin', strength: { mean: -0.3, std: 0.1 } }],
  goal_constraints: [
    {
      constraint_id: CHURN_CONSTRAINT_ID,
      node_id: CHURN_NODE_ID,
      operator: '<=',
      value: 7,
      unit: '%',
      label: CHURN_LABEL,
      provenance: 'explicit',
    },
    {
      constraint_id: COST_CONSTRAINT_ID,
      node_id: COST_NODE_ID,
      operator: '<=',
      value: 250000,
      label: COST_LABEL,
      provenance: 'explicit',
    },
  ],
};

function addConstraintFact(constraintId: string, nodeId: string, label: string, value: number): HandlerFact {
  return {
    fact_type: 'add_constraint',
    fact_version: 1,
    noop: false,
    result: {
      // The CONSTRAINT id — `add-constraint.ts:975` writes
      // `target_id: newConstraint.constraint_id`, not the node id.
      target_id: constraintId,
      status: 'applied',
      before: null,
      after: {
        constraint_id: constraintId,
        node_id: nodeId,
        operator: '<=',
        value,
        label,
        provenance: 'explicit',
      },
    },
  };
}

/** Newest-first, matching `SessionStore.readFactsFor`'s `created_at DESC`. */
const PRIOR_FACTS: HandlerFact[] = [
  addConstraintFact(COST_CONSTRAINT_ID, COST_NODE_ID, COST_LABEL, 250000),
  addConstraintFact(CHURN_CONSTRAINT_ID, CHURN_NODE_ID, CHURN_LABEL, 7),
];

/** Drives the explicit `ok_absent` canonical-read arm. Reset in `beforeEach`. */
let SUPPRESS_PERSISTED_GRAPH = false;

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
  user_message: 'We are weighing bringing support in-house.',
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
    readFactsFor: async () => PRIOR_FACTS,
    readFactsWithTurnFor: async () => [],
    readNewestAnalysisFactFor: async () => null,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: storeDraftGraphMock,
    loadGraph: async () => (SUPPRESS_PERSISTED_GRAPH ? null : PERSISTED_GRAPH),
    loadGraphAndBriefText: async () => ({
      graph: SUPPRESS_PERSISTED_GRAPH ? null : PERSISTED_GRAPH,
      briefText: 'Should we bring customer support in-house?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

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
  readonly prompt: string;
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
      ...(clientGraphState === undefined ? {} : { graphState: clientGraphState as never }),
    });
  } finally {
    setTestSink(() => undefined);
  }
  expect(
    calls.length,
    'the routing adapter was never called — the turn short-circuited before the prompt was built',
  ).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user, 'no user message reached the routing adapter').toBeDefined();
  return {
    prompt: typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content),
    events,
  };
}

/**
 * ⚠⚠ THE PRECONDITION. Without it this file proves nothing about production:
 * on the NON-compact path the assembler's own `graph` input is populated, and
 * an arm could be read as evidence that the verdict can be derived there. It
 * cannot — that path is unreachable whenever a graph exists.
 *
 * Derived from telemetry, bound to the event NAME constant rather than a copied
 * string literal.
 */
function assertCompactPathTaken(obs: TurnObservation): void {
  const assembled = obs.events.filter((e) => e.name === TelemetryEvents.ContextPackAssembled);
  expect(
    assembled.length,
    'no `v5.context_pack.assembled` telemetry was captured — the precondition probe is BLIND, so nothing below is proven',
  ).toBeGreaterThan(0);
  expect(
    assembled[assembled.length - 1]!.data.graph_compacted,
    'the turn did NOT take the compact path, so the assembler held a populated `graph` input and this arm says nothing about the production wire',
  ).toBe(true);
}

/** The serialised pack's `recent_changes`, asserted non-empty. */
function recentChangesOf(pack: Record<string, unknown>): Array<Record<string, unknown>> {
  const rc = pack.recent_changes;
  expect(
    Array.isArray(rc) && rc.length > 0,
    'the serialised pack carried no `recent_changes` entries — every assertion below would be vacuous',
  ).toBe(true);
  return rc as Array<Record<string, unknown>>;
}

function entryLabelled(
  entries: Array<Record<string, unknown>>,
  label: string,
): Record<string, unknown> {
  const found = entries.find((e) => e.target_label === label);
  expect(found, `no recent_changes entry carried target_label ${JSON.stringify(label)}`).toBeDefined();
  return found!;
}

beforeEach(() => {
  SUPPRESS_PERSISTED_GRAPH = false;
  storeDraftGraphMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the constraint evaluability verdict reaches the routing prompt', () => {
  it('qualifies the limit whose target records nothing, and only that one', async () => {
    const obs = await runTurn('What should we weigh up here?');
    assertCompactPathTaken(obs);

    const entries = recentChangesOf(observeSerialisedPack(obs.prompt));

    // The measured defect: this entry used to reach the model as a bare
    // "Added constraint: …" on every turn after the write.
    expect(entryLabelled(entries, CHURN_LABEL).constraint_not_checkable).toBe(
      'target_records_no_value',
    );

    // ⭐ THE CONTRAST, IN THE SAME PACK. A wire that stamped everything, or a
    // verdict derived from the COMPACT graph (which drops every quantity field
    // and would therefore report both limits unevaluable), fails here and
    // passes the assertion above.
    expect(entryLabelled(entries, COST_LABEL).constraint_not_checkable).toBeUndefined();
  });

  it('does not touch the receipt copy the entry carries', async () => {
    const obs = await runTurn('What should we weigh up here?');
    assertCompactPathTaken(obs);

    const entries = recentChangesOf(observeSerialisedPack(obs.prompt));

    // The EXPECTATION IS DERIVED FROM THE PRODUCER, not transcribed from it —
    // a hand-copied sentence here would be a mirror of the copy it is meant to
    // pin, and would drift the moment the receipt was reworded.
    const rendered = formatConstraintAdded({
      targetLabel: CHURN_LABEL,
      operator: '<=',
      value: 7,
    });

    // ⭐ AND THIS IS WHY THE VERDICT NEEDS ITS OWN FIELD. The receipt for this
    // perfectly ordinary limit ALREADY overruns the projection's character
    // budget and is truncated — so there is no room to append a qualification
    // to `summary`, and an attempt to do so would eat the receipt it qualifies.
    expect(rendered.length).toBeGreaterThan(RECENT_CHANGES_SUMMARY_MAX_CHARS);

    expect(entryLabelled(entries, CHURN_LABEL).summary).toBe(
      `${rendered.slice(0, RECENT_CHANGES_SUMMARY_MAX_CHARS - 1)}…`,
    );
  });

  it('claims nothing when the canonical read found no graph', async () => {
    // ⚠ FAIL TOWARD TODAY'S BEHAVIOUR. A turn that read no saved model has not
    // established that anything is unevaluable; it has established that it
    // could not look. Absence of the key is UNKNOWN, never "this limit is fine".
    SUPPRESS_PERSISTED_GRAPH = true;
    const obs = await runTurn('What should we weigh up here?');

    const entries = recentChangesOf(observeSerialisedPack(obs.prompt));
    for (const entry of entries) {
      expect(entry.constraint_not_checkable).toBeUndefined();
    }
  });

  it('will not speak from a provisional request graph, only from the saved model', async () => {
    // ⭐⭐ THE VERDICT IS ABOUT THE SAVED MODEL, AND THIS ARM IS WHAT MAKES THAT
    // A MEASUREMENT RATHER THAN A COMMENT.
    //
    // With an explicit `ok_absent` canonical read, a validated non-empty request
    // graph is licensed as PROVISIONAL reasoning context — so the selector has
    // nodes and constraints in hand and the verdict is perfectly computable.
    // It must still say nothing: this claim tells a user their limit will be
    // ignored, and nobody has committed the graph it would be read off. Same
    // canonical-only rule as `selection` and `goal_target`.
    //
    // Without this arm, deleting the `status === 'canonical'` gate in
    // `turn-executor.ts` is a surviving mutant.
    SUPPRESS_PERSISTED_GRAPH = true;
    const obs = await runTurn('What should we weigh up here?', PERSISTED_GRAPH);

    const assembled = obs.events.filter((e) => e.name === TelemetryEvents.ContextPackAssembled);
    expect(
      assembled.length,
      'no `v5.context_pack.assembled` telemetry — the precondition probe is BLIND',
    ).toBeGreaterThan(0);
    // The precondition: the request graph really was taken as provisional. If
    // the selection had come out `unavailable`, this arm would pass for the
    // wrong reason (no graph at all) and prove nothing about the gate.
    expect(
      assembled[assembled.length - 1]!.data.graph_context_status,
      'the request graph was NOT admitted as provisional, so this arm does not exercise the canonical-only gate',
    ).toBe('provisional');

    const entries = recentChangesOf(observeSerialisedPack(obs.prompt));
    expect(entryLabelled(entries, CHURN_LABEL).constraint_not_checkable).toBeUndefined();
  });
});
