/**
 * ⭐⭐ THE OFFER MUST NOT PROMISE WHAT NO ACCEPTANCE CAN RESUME.
 *
 * `buildMutationWarrantDemotionText` closes with "Say the word and I will make
 * it." That sentence is honourable ONLY when the same turn persists an
 * `apply_proposed_change` pending, because acceptance is handled by
 * `tryShortConfirmResume`, which REPLAYS A STORED `inline_patch` and never
 * re-reads the user's message (`deterministic-short-confirm.ts`).
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * Six branches in `turn-executor.ts` feed ONE `commitTurn(..., pending_actions:
 * demotionPending)`. `demotionPending` is non-empty in exactly one of them.
 * Three of the remaining five emitted the full offer copy anyway, so the
 * product told the user it was ready to act and kept nothing for a "yes" to
 * find. This file pins the `no_graph_hash` branch, which is the reachable one:
 * a session with no graph selected for the turn produces a null
 * analysis-affecting hash, the proposal is complete, and the branch DELIBERATELY
 * declines to emit a pending because the drift precondition cannot be built.
 * Declining to emit is correct. Promising anyway is not.
 *
 * ── WHY THE COPY AND NOT THE RECOGNISER (binding) ─────────────────────────
 * ⛔ Widening the confirmation predicate was recommended once and WITHDRAWN in
 * commit `d8a908b3`: a held change replays entirely from its stored patch, so a
 * wider recogniser would apply the OFFER's number and silently discard a value
 * the user restated in their acceptance — with a receipt saying it worked. The
 * recogniser is right to refuse. Nothing here touches it.
 *
 * ── THE PRECEDENT THIS EXTENDS ────────────────────────────────────────────
 * PR #1491 ruled exactly this for the `required_parameter_missing` branch and
 * pinned it (`offer-sufficiency-wiring.test.ts:255-258`): "With no chip and no
 * pending there is nothing to say the word to, so borrowing it here would
 * rebuild the dead end by another door." That remedy was scoped to the instance
 * in hand and never swept its siblings. This is the sweep.
 *
 * ── THE PAIR ──────────────────────────────────────────────────────────────
 * A "does not promise" assertion passes just as well against a harness that
 * cannot promise at all (trap 13). So the SAME adapter, the SAME utterance and
 * the SAME proposal run twice, differing ONLY in whether a graph state is
 * supplied — which is the only input the null-hash branch turns on. The control
 * arm must still emit the chip, the pending AND the promise.
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
import type { PendingAction } from '../session/pending-action.js';

interface AppendWrite {
  graph?: unknown;
  pending_actions?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;
/**
 * ⛔⛔ THIS WAS A `const [] `, AND THAT IS WHY THE FIRST VERSION OF THIS FILE
 * COULD NOT SEE THE DEFECT IT WAS WRITTEN TO CLOSE (trap 22).
 *
 * `context.most_recent_pending_actions` is populated from exactly this store
 * method (`build-turn-context.ts:1441`), and `commitTurn` threads it into every
 * commit as `priorPendingActions` (`turn-executor.ts:1695`). Pinning it to `[]`
 * ran all four original tests in the ONE session state where "nothing is
 * waiting on your reply" happens to be true, so the corpus excluded the only
 * class in which the sentence could be false. It is a `let`, reset per test, so
 * every case in this file can observe the state — and the pair below exercises
 * it.
 */
let mockedPriorPendings: readonly PendingAction[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readRecentAppliedMutationFactsFor: async () => [],
    readMostRecentPendingActions: async () => mockedPriorPendings,
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

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/** A read-shaped utterance: no mutation verb, so the demotion gate is reached. */
const READ_UTTERANCE = 'Open the analysis panel and show me the option comparison';

/** The promise under test, verbatim from `buildMutationWarrantDemotionText`. */
const PROMISE = 'Say the word and I will make it.';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
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
 * ONE adapter for BOTH arms — a COMPLETE `add_constraint` proposal, so
 * `buildWarrantDemotion` returns `ok: true` and the only thing that can differ
 * between the arms is the graph hash.
 */
function completeAddConstraintAdapter() {
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
              { name: 'value', value: 7, source: 'user_explicit' },
            ],
            cited_context_fields: [],
          },
        }),
      ),
  };
}

function buildChurnGraph(): GraphV3T {
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
  } as unknown as GraphV3T;
}

/** TRAP 19 — bind by the stable `prop_` handle and the wire action_type. */
function proposalChips(response: {
  suggested_actions?: readonly { id: string; action_type?: string }[];
}) {
  return (response.suggested_actions ?? []).filter(
    (c) => c.id.startsWith('prop_') && c.action_type === 'add_constraint',
  );
}

/**
 * The thing an acceptance would have to find. Bound by `action.kind`, which is
 * what `tryShortConfirmResume` matches on — not by "something was stored".
 */
function committedPendings(): Array<Record<string, unknown>> {
  return appendCalls.flatMap((c) =>
    Array.isArray(c.pending_actions) ? (c.pending_actions as Array<Record<string, unknown>>) : [],
  );
}

function committedPendingKinds(): string[] {
  return appendCalls
    .flatMap((c) =>
      Array.isArray(c.pending_actions) ? (c.pending_actions as Array<Record<string, unknown>>) : [],
    )
    .map((p) => String((p as { action?: { kind?: unknown } }).action?.kind));
}

function committedProposalPendings(): Array<Record<string, unknown>> {
  return appendCalls
    .flatMap((c) =>
      Array.isArray(c.pending_actions) ? (c.pending_actions as Array<Record<string, unknown>>) : [],
    )
    .filter((p) => (p as { action?: { kind?: unknown } }).action?.kind === 'apply_proposed_change');
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

function demotionOutcomes(): unknown[] {
  return events
    .filter(
      (e) =>
        e.event === 'v5.turn_executor.mutation_warrant_absent' && e.data.layer === 'step2_gate',
    )
    .map((e) => e.data.demotion);
}

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  persistedGraph = null;
  mockedPriorPendings = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('an offer with no resumable pending must not close with a promise', () => {
  it('⭐ CONTROL (trap 13) — WITH a graph, the harness DOES emit the chip, the pending AND the promise', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-control', {
      routingAdapter: completeAddConstraintAdapter(),
      graphState: buildChurnGraph(),
    });

    // If any of these is ever wrong, every negative assertion below proves nothing.
    expect(demotionOutcomes()).toEqual(['offered']);
    expect(proposalChips(response)).toHaveLength(1);
    expect(committedProposalPendings()).toHaveLength(1);
    // ⭐ THE DISCRIMINATING HALF: the promise SURVIVES where it is honourable.
    // Without this, a fix that simply deleted the sentence everywhere would pass.
    expect(response.assistant_text).toContain(PROMISE);
  });

  it('⭐ THE FIX — with NO graph the branch declines to emit a pending, so the promise is withdrawn', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-nohash', {
      routingAdapter: completeAddConstraintAdapter(),
      // No `graphState`: `currentAnalysisGraphHashForTurn` is null, so the
      // proposal's drift precondition cannot be built and the branch refuses.
    });

    // The branch is the reason, NAMED — not some unrelated validator refusal.
    expect(demotionOutcomes()).toEqual(['emit_refused:no_graph_hash']);
    // Nothing an acceptance could resume was stored…
    expect(proposalChips(response)).toHaveLength(0);
    expect(committedProposalPendings()).toHaveLength(0);
    // …so the product must not say it is waiting to be told to act.
    expect(response.assistant_text).not.toContain(PROMISE);
    expect(response.assistant_text).not.toContain('Say the word');
  });

  it('the withdrawn offer still discloses the no-write FIRST and still names a move', async () => {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-copy', {
      routingAdapter: completeAddConstraintAdapter(),
    });

    const text = response.assistant_text;
    // The no-write disclosure is the invariant PR #1583/INV-3 protects; the fix
    // must not cost it. Also proves the egress forbidden-phrase guard did not
    // swallow the reply and replace it with the neutral fallback.
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    expect(text).toContain('tell me what you would like changed');
    // INV-3: it asserts nothing about what the user did or did not ask for.
    expect(text).not.toMatch(
      /\byou\s+(?:did\s+not|didn['’]t|have\s+not|haven['’]t|never)\s+(?:ask|request|say|state|tell|mention)/i,
    );
    // No internal vocabulary reaches the user.
    expect(text).not.toContain('add_constraint');
    expect(text).not.toContain('graph_hash');
    expect(text.toLowerCase()).not.toContain('applied');
  });

  it('NO SUBSTITUTE CHIP fills the gap left by the withdrawn offer', async () => {
    // Withdrawing an affordance is a chance to introduce an unrelated one; a
    // sibling lane witnessed exactly that on deployed staging. Pin the measurement.
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-nosub', {
      routingAdapter: completeAddConstraintAdapter(),
    });
    expect(response.suggested_actions ?? []).toEqual([]);
  });
});

/**
 * ⭐⭐⭐ THE CLASS THE FIRST VERSION OF THIS FILE COULD NOT SEE.
 *
 * The block above pins what THIS BRANCH kept. The withdrawal copy originally
 * went further and asserted "…so nothing is waiting on your reply…", which is a
 * claim about what THE COMMIT PERSISTS — and those are different sets:
 *
 *   turn-executor.ts:1695   every `commitTurn` threads
 *                           `priorPendingActions: context.most_recent_pending_actions`
 *   commit.ts:1289-1310     `finalPendings = [...chipDerivedPending, ...survivingPrior]`
 *   commit.ts:565-571       the hash-invalidation rule needs a NON-EMPTY
 *                           `currentGraphHash`; the `no_graph_hash` branch has
 *                           none, so a prior proposal is never invalidated there
 *
 * So on the very branch this file pins, a prior `apply_proposed_change` survives
 * the demotion commit untouched and `tryShortConfirmResume` will still resolve a
 * bare "yes" against it. Trap 21 inside the remedy: the guard answers "did THIS
 * branch keep anything?" and the sentence answered "is anything waiting?".
 *
 * ⛔ THE REMEDY WAS TO DELETE THE CLAIM, NOT TO WIDEN THE SET. Measured on the
 * journey below with `[...demotionPending, ...context.most_recent_pending_actions]`
 * fed to the guard: it then KEEPS the promise, so turn 2 said "a limit keeping
 * "Customer Churn Rate" at or below 7 … Say the word and I will make it." and the
 * "yes" returned "Added constraint: Customer Acquisition Cost must be at most
 * 500 GBP." — a promise about one change honoured by writing another, with a
 * receipt. That is the `d8a908b3` class. A sentence that makes no claim about a
 * set cannot be wrong about one.
 */
describe('a withdrawal must not claim anything about what the SESSION is holding', () => {
  /**
   * The words that make a claim about session state. Bound as STRINGS the user
   * would read, not via the exported constant — a guard that imports the
   * constant it is checking agrees with itself (trap 13b).
   */
  const SESSION_STATE_CLAIMS = ['nothing is waiting', 'waiting on your reply'] as const;

  /** Mint a real prior proposal by running the offer turn WITH a graph. */
  async function mintLiveProposal(requestId: string): Promise<PendingAction[]> {
    const { response } = await runTurnExecutor(payload(READ_UTTERANCE), requestId, {
      routingAdapter: completeAddConstraintAdapter(),
      graphState: buildChurnGraph(),
    });
    // PRECONDITION PIN — if minting ever stops working, every arm below would
    // silently collapse into "no prior pending" and agree for the wrong reason.
    expect(demotionOutcomes()).toEqual(['offered']);
    expect(response.assistant_text).toContain(PROMISE);
    const minted = committedProposalPendings() as unknown as PendingAction[];
    expect(minted).toHaveLength(1);
    return minted;
  }

  it('⭐ THE DISCRIMINATING PAIR — two arms differing ONLY in a live prior pending', async () => {
    // ── mint, then reset so the pair starts from an identical observation ──
    const prior = await mintLiveProposal('req-owp-pair-mint');
    events = [];
    appendCalls.length = 0;
    persistedGraph = null;

    // ── ARM A: nothing live from an earlier turn ──
    mockedPriorPendings = [];
    const armA = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-pair-a', {
      routingAdapter: completeAddConstraintAdapter(),
    });
    const armADemotion = demotionOutcomes();
    const armAPersisted = committedPendingKinds();

    events = [];
    appendCalls.length = 0;
    persistedGraph = null;

    // ── ARM B: identical in every respect EXCEPT a live prior proposal ──
    mockedPriorPendings = prior;
    const armB = await runTurnExecutor(payload(READ_UTTERANCE), 'req-owp-pair-b', {
      routingAdapter: completeAddConstraintAdapter(),
    });
    const armBDemotion = demotionOutcomes();
    const armBPersisted = committedPendingKinds();

    // ── PRECONDITION PIN (trap 13b) — the arms must genuinely differ in the
    // ── set the COMMIT persists, or the assertions below are a tautology.
    expect(armADemotion).toEqual(['emit_refused:no_graph_hash']);
    expect(armBDemotion).toEqual(['emit_refused:no_graph_hash']);
    expect(armAPersisted).toEqual([]);
    expect(armBPersisted).toEqual(['apply_proposed_change']);

    // ── THE CLAIM: neither arm says anything about what is waiting, so the
    // ── copy cannot be false in the arm where something is.
    for (const [arm, text] of [
      ['A', armA.response.assistant_text],
      ['B', armB.response.assistant_text],
    ] as const) {
      for (const claim of SESSION_STATE_CLAIMS) {
        expect(text, `arm ${arm} must make no claim about session state`).not.toContain(claim);
      }
      // …and the promise stays withdrawn in BOTH. This is what REDs if anyone
      // "fixes" the guard by feeding it the persisted set: arm B would keep a
      // promise about a change this turn did not keep.
      expect(text, `arm ${arm} must not promise to act on a "yes"`).not.toContain(PROMISE);
    }
  });

  it('⭐ THE JOURNEY — a withdrawal must not deny a pending that a bare "yes" then honours', async () => {
    // ── T1: the product offers WITH a graph and mints the pending itself.
    const minted = await mintLiveProposal('req-owp-journey-t1');

    // ── T2: same session, no usable graph for the turn. The branch declines to
    // ── emit — and the commit carries the T1 proposal forward regardless.
    events = [];
    appendCalls.length = 0;
    persistedGraph = null;
    mockedPriorPendings = minted;
    const t2 = await runTurnExecutor(payload('Remind me what the options are'), 'req-owp-journey-t2', {
      routingAdapter: completeAddConstraintAdapter(),
    });
    const t2Persisted = committedPendings() as unknown as PendingAction[];

    // PRECONDITION PIN — the branch is named, and something IS waiting.
    expect(demotionOutcomes()).toEqual(['emit_refused:no_graph_hash']);
    expect(t2Persisted.map((p) => p.action.kind)).toEqual(['apply_proposed_change']);

    // ── T3: a bare "yes", with the graph back.
    events = [];
    appendCalls.length = 0;
    mockedPriorPendings = t2Persisted;
    const t3 = await runTurnExecutor(payload('yes'), 'req-owp-journey-t3', {
      routingAdapter: completeAddConstraintAdapter(),
      graphState: buildChurnGraph(),
    });

    // PRECONDITION PIN — the "yes" really does land a write. Without this the
    // T2 assertion below would pass just as well against a session where
    // nothing was ever resumable (trap 13).
    expect(appendCalls.some((c) => c.graph !== undefined && c.graph !== null)).toBe(true);
    expect(t3.response.assistant_text).toContain('Customer Churn Rate');

    // ── THE CLAIM: given that write, T2 must not have denied that anything
    // ── was waiting. A denial with a write behind it moves the user's model.
    for (const claim of SESSION_STATE_CLAIMS) {
      expect(t2.response.assistant_text).not.toContain(claim);
    }
    // The withdrawal itself is still made — this is not "put the promise back".
    expect(t2.response.assistant_text).not.toContain(PROMISE);
    expect(t2.response.assistant_text).toContain('could not put it forward');
  });
});
