/**
 * ROADMAP 2.684 — THE COMPOSER'S BUDGET IS THE TURN'S REMAINING TIME, AND THE
 * PLUMBING THAT CARRIES IT IS ITSELF UNDER TEST.
 *
 * ── WHY THIS FILE EXISTS AND WHY IT IS NOT A UNIT TEST ────────────────────
 *
 * The budget ARITHMETIC is pinned in `budget-timeout-invariants.test.ts`, where
 * it belongs. This file pins the thing that has now failed twice: whether the
 * derived number ever reaches the call.
 *
 * #829 shipped a 60,000 literal inside `compose-structural-edit.ts`. #842
 * replaced it with a correct derivation in the same file. NEITHER shipped a
 * caller that passed a budget — the dispatcher passed no `timeoutMs` and no
 * `signal` on both occasions — and in both cases the module-local default was
 * silently the whole bound. A unit test of the resolver was green throughout.
 * It was green again on the day witness #3 measured the composer dying at
 * 5.008s on staging.
 *
 * That is CLAUDE.md trap 3b in its general form: every instrument agreed with
 * every other instrument, and none of them touched the path a user loads. So
 * the assertions here are deliberately end-to-end through `dispatchEditGraph`
 * against the adapter's real `CallOpts`, plus one source assertion on the ONE
 * production call site, because a plumbing defect is invisible to any test that
 * starts downstream of the plumbing.
 *
 * ── BOUND BY IDENTITY, NOT BY A PREDICATE (trap 19) ───────────────────────
 * "The composer got some timeout" is satisfied by the defect. Every assertion
 * below binds the observed `timeoutMs` to the SPECIFIC baseline that produced
 * it, and the discriminating pair (§2) is what proves the consumed-time term is
 * real rather than incidental.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn(),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
    loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { getAdapter } from '../../../adapters/llm/router.js';
import { loadPersistedGraphStrict } from '../../build-turn-context.js';
import { _resetConfigCache } from '../../../config/index.js';
import { getTurnExecutorBudgets } from '../../budgets.js';
import { COMPOSER_POST_CALL_RESERVE_MS } from '../../tools/compose-structural-edit.js';
import { MIN_TIMEOUT_MS } from '../../../config/timeouts.js';
import {
  STRUCTURAL_EDIT_DECLINE_COPY,
  STRUCTURAL_EDIT_DECLINE_CLASSES,
} from '../structural-edit-decline-answers.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUB_REQUEST = {} as FastifyRequest;

/** A frozen clock, so every budget assertion below is an equality, not a range. */
const FIXED_NOW_MS = 1_800_000_000_000;

/**
 * ⭐ THE WITNESS'S OWN NUMBER (witness #3, attempt w3a1).
 *
 * boundary.request 09:56:52.280 → composer entry 09:57:55.353. Sixty-two
 * seconds of edit_graph + repair had already been spent when the composer was
 * dispatched. This is the term no static ceiling — #842's included — can see.
 */
const WITNESSED_CONSUMED_BEFORE_COMPOSER_MS = 62_000;

const GRAPH = {
  nodes: [
    { id: 'dec_mrr', kind: 'decision', label: 'MRR Growth Strategy' },
    { id: 'goal_mrr', kind: 'goal', label: 'Reach £250,000 MRR' },
    { id: 'fac_churn', kind: 'factor', label: 'Customer Churn Rate' },
  ],
  edges: [{ from: 'dec_mrr', to: 'goal_mrr' }],
};

/** The rulebook refuses on budget — the only turn shape that reaches the tool. */
function rulebookBudgetRejected(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'the rulebook dead end',
    latencyMs: 12,
    appliedGraph: null,
    wasRejected: true,
    suggestedActions: [],
    diagnostics: {
      failure_code: 'budget_exceeded',
      validation_outcome: 'budget_exceeded',
      branch_taken: 'rejection',
      branch_reason: 'patch_budget_exceeded',
      failure_branch: 'patch_budget',
    } as unknown as EditGraphResult['diagnostics'],
  };
}

/**
 * A composer that RETURNS NOTHING USABLE on purpose.
 *
 * These cases are about the `CallOpts` the call receives, not about what comes
 * back, and a `no_tool_call` return keeps every case on one short path.
 */
function adapterSpy() {
  return {
    name: 'stub',
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'no tool call' }],
    }),
  };
}

let adapter: ReturnType<typeof adapterSpy>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockReset();
  (getAdapter as MockedFunction<typeof getAdapter>).mockReset();
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockReset();
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockResolvedValue(
    GRAPH as never,
  );
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  adapter = adapterSpy();
  (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue(adapter as never);
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
    rulebookBudgetRejected(),
  );
  // Freeze the clock. The dispatcher reads `Date.now()` for its own baseline and
  // for the budget derivation; pinning it turns every assertion below into an
  // exact equality instead of a tolerance, which is what lets the discriminating
  // pair in §2 mean anything.
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

async function runTurn(requestStartMs?: number) {
  return dispatchEditGraph({
    payload: {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'analyse' as const,
      message:
        "Add three new options: 'Acquire a smaller competitor', 'Raise prices 10%', and 'Launch an annual plan discount'. Connect each to the MRR goal, and add a distinct risk factor for each of the three.",
      turn_class: 'frame' as const,
      source: 'composer' as const,
    },
    requestId: 'req-2684',
    request: STUB_REQUEST,
    graphState: GRAPH as unknown as GraphStateIngress,
    analysisState: null,
    ...(requestStartMs !== undefined ? { requestStartMs } : {}),
  });
}

/** The `timeoutMs` the composer's model call actually received. */
function observedComposerTimeoutMs(): number {
  const calls = adapter.chatWithTools.mock.calls;
  expect(calls).toHaveLength(1);
  const opts = calls[0]![1] as { timeoutMs?: number };
  expect(typeof opts.timeoutMs).toBe('number');
  return opts.timeoutMs!;
}

// ===========================================================================
// §1 — THE BUDGET REACHES THE CALL AT ALL
// ===========================================================================

describe('2.684 §1 — the derived budget reaches the composer`s CallOpts', () => {
  it('P1-1 a fresh turn hands the composer the whole turn minus the post-call reserve', async () => {
    const { turn_ms } = getTurnExecutorBudgets();
    await runTurn(FIXED_NOW_MS);

    // ⚠ AN EQUALITY, NOT A BOUND. "greater than 60,000" would pass for #842's
    // static 80,000 as readily as for the real remaining time, and #842 is the
    // defect. Only the exact identity distinguishes them.
    expect(observedComposerTimeoutMs()).toBe(turn_ms - COMPOSER_POST_CALL_RESERVE_MS);
  });

  it('P1-2 and that budget outlives BOTH witnessed kills (60.0s and 5.0s)', async () => {
    await runTurn(FIXED_NOW_MS);
    const observed = observedComposerTimeoutMs();
    expect(observed).toBeGreaterThan(60_000); // #829's literal, witnessed 2/2
    expect(observed).toBeGreaterThan(5_000); // #842 on the deployed env, witnessed 2/2
  });
});

// ===========================================================================
// §2 — THE CONSUMED-TIME TERM, PROVED BY A DISCRIMINATING PAIR
// ===========================================================================

describe('2.684 §2 — what the turn already spent is charged to the composer', () => {
  it('P2-1 62s consumed of the turn is 62s the composer does not get', async () => {
    const { turn_ms } = getTurnExecutorBudgets();
    await runTurn(FIXED_NOW_MS - WITNESSED_CONSUMED_BEFORE_COMPOSER_MS);

    expect(observedComposerTimeoutMs()).toBe(
      turn_ms - WITNESSED_CONSUMED_BEFORE_COMPOSER_MS - COMPOSER_POST_CALL_RESERVE_MS,
    );
  });

  it('P2-2 ⭐ DISCRIMINATING PAIR — the delta between two turns is EXACTLY the delta in what they spent', async () => {
    // Neither run alone proves the consumed term is live: a static ceiling
    // produces a plausible number on both. The DIFFERENCE is the discriminator,
    // and it is the assertion that goes RED the moment the term is dropped.
    await runTurn(FIXED_NOW_MS);
    const fresh = observedComposerTimeoutMs();

    adapter.chatWithTools.mockClear();
    await runTurn(FIXED_NOW_MS - WITNESSED_CONSUMED_BEFORE_COMPOSER_MS);
    const consumed = observedComposerTimeoutMs();

    expect(fresh - consumed).toBe(WITNESSED_CONSUMED_BEFORE_COMPOSER_MS);
  });

  it('P2-3 a turn that has spent almost everything gets almost nothing, not a comfortable default', async () => {
    const { turn_ms } = getTurnExecutorBudgets();
    // Leave exactly the floor plus the reserve.
    const spent = turn_ms - COMPOSER_POST_CALL_RESERVE_MS - MIN_TIMEOUT_MS;
    await runTurn(FIXED_NOW_MS - spent);
    expect(observedComposerTimeoutMs()).toBe(MIN_TIMEOUT_MS);
  });
});

// ===========================================================================
// §3 — EXHAUSTION IS AN HONEST DECLINE, NOT A DOOMED CALL
// ===========================================================================

describe('2.684 §3 — no time left means no call', () => {
  it('P3-1 ⭐ the composer is NOT called when the deadline has passed', async () => {
    // The behaviour witness #3 measured, inverted. Before this change the
    // budget floored at 5,000 and the call went out regardless — two users, two
    // guaranteed UpstreamTimeoutErrors, 5.0s each, nothing learned.
    const { turn_ms } = getTurnExecutorBudgets();
    await runTurn(FIXED_NOW_MS - turn_ms - 10_000);
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
  });

  it('P3-2 and the user is told the compose_unavailable sentence, bound by IDENTITY', async () => {
    const { turn_ms } = getTurnExecutorBudgets();
    const result = await runTurn(FIXED_NOW_MS - turn_ms - 10_000);
    const text = result.response.assistant_text ?? '';

    // Looked up in the producer's own table — never a "looks honest" predicate
    // that several of the six sentences would satisfy (trap 19).
    expect(text).toBe(STRUCTURAL_EDIT_DECLINE_COPY.compose_unavailable.text);

    // …and it is NOT any of the other five. Without this the assertion above
    // would still hold if two classes ever shared copy, and the class that
    // actually fired would be unobservable.
    for (const cls of STRUCTURAL_EDIT_DECLINE_CLASSES) {
      if (cls === 'compose_unavailable') continue;
      expect(text).not.toBe(STRUCTURAL_EDIT_DECLINE_COPY[cls].text);
    }
  });

  it('P3-3 CONTROL — the same turn one millisecond inside the deadline DOES call', async () => {
    // The positive control for §3. Without it, "the composer was not called"
    // would pass for a harness that can never reach the composer at all — the
    // vacuity that trap 13 exists to catch.
    const { turn_ms } = getTurnExecutorBudgets();
    const spent = turn_ms - COMPOSER_POST_CALL_RESERVE_MS - MIN_TIMEOUT_MS;
    await runTurn(FIXED_NOW_MS - spent);
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// §4 — THE MOUNT PATH ITSELF
// ===========================================================================

describe('2.684 §4 — the ONE production call site threads the request baseline', () => {
  /**
   * ⭐⭐ WHY A SOURCE ASSERTION, AND WHY IT IS NOT A MIRROR.
   *
   * `requestStartMs` is optional on `DispatchEditGraphParams` — not because a
   * caller may reasonably omit it, but because 128 test call sites predate it
   * and making it required would have bought a compile-time guarantee with a
   * diff nobody could review. The cost of that choice is a silent fallback: if
   * `route-v2.ts` ever stops passing it, the composer quietly measures from the
   * dispatcher's own start, over-estimates what is left, and NOTHING goes red —
   * which is precisely the shape of the defect this row exists to kill.
   *
   * This is the fail-loud replacement for the guarantee we did not take. It
   * derives the call site from the source rather than restating anything about
   * it, so it cannot drift the way a comment saying "keep these in sync" drifts.
   * Deleting the argument in `route-v2.ts` turns it RED — mutant M4 proves that.
   */
  it('P4-1 route-v2 passes requestStartMs into dispatchEditGraph', () => {
    const source = readFileSync(
      join(__dirname, '../../../orchestrator/route-v2.ts'),
      'utf-8',
    );
    const callIndex = source.indexOf('await dispatchEditGraph({');
    expect(callIndex).toBeGreaterThan(-1);
    const callBlock = source.slice(callIndex, source.indexOf('});', callIndex));
    expect(callBlock).toContain('requestStartMs');
  });

  it('P4-2 the baseline it passes is the ROUTE`s start, not a fresh clock reading', () => {
    // `requestStartMs: Date.now()` at the call site would satisfy P4-1 while
    // discarding everything pre-flight spent — the same class of error as
    // measuring from the dispatcher. Bind to the identity of the baseline.
    const source = readFileSync(
      join(__dirname, '../../../orchestrator/route-v2.ts'),
      'utf-8',
    );
    const callIndex = source.indexOf('await dispatchEditGraph({');
    const callBlock = source.slice(callIndex, source.indexOf('});', callIndex));
    expect(callBlock).toContain('requestStartMs: routeStartedAt');
  });
});
