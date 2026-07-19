/**
 * O-1 — ONE batch-mutation lifecycle for compound value updates.
 *
 * RED-first reproductions of three EXECUTED defects on the deployed head
 * (Codex F4 / F2 / F12), all rooted in the same defect class: the compound
 * pre-route promoted part 0 into the ordinary lifecycle (validateToolCall +
 * raw-message unit-family guard + value precheck) while parts 1..N called the
 * `set_factor_value` handler directly, bypassing all of it.
 *
 *   F4 — unit-family guard skipped for later parts: "Set Factor A to 0.6 and
 *        Marketing Budget to 5 agents" stored £5 into a £ factor and confirmed
 *        it. Reversed order → correctly refused (and dropped the valid part).
 *        Order decided correctness.
 *   F2 — pairing by document order over ALL numbers: "Using the 2026 forecast,
 *        set Factor A to current plan and Factor B to 0.8" durably set
 *        Factor A to 2026.
 *   F12 — a primary refusal stopped everything without naming later parts;
 *        once the primary succeeded, the chain caught EVERY thrown value as
 *        "value invalid" — an infrastructure error mid-batch was narrated as
 *        the user's fault.
 *
 * The fix: one shared batch preflight (kind + validateToolCall + segment-
 * scoped unit-family guard) that EVERY part passes through before ANY
 * execution, DISCLOSED-PARTIAL application (apply valid parts, refuse invalid
 * ones BY NAME with reasons), span-based label↔quantity pairing, and typed
 * error discipline in the chain (refuse only parameter-invalid classes;
 * rethrow abort/timeout/infrastructure).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';

const appendCalls: Array<{ graph?: unknown }> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    loadGraph: async () => null,
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { createSetFactorValueHandler } = await import('../tools/handlers/set-factor-value.js');
const { applyCompoundValueUpdateChain } = await import('../compound-value-update-chain.js');

const SCENARIO_ID = 'abababab-abab-4bab-8bab-abababababab';
const TURN_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

/** Factor A untyped; Marketing Budget a £ factor with a real current value. */
function unitGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_a', kind: 'factor', label: 'Factor A' },
      {
        id: 'fac_mb',
        kind: 'factor',
        label: 'Marketing Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
    ],
    edges: [],
  };
}

/** Factor A untyped; Adoption Rate a capped factor for which bare 250 is invalid. */
function capGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_a', kind: 'factor', label: 'Factor A' },
      {
        id: 'fac_ar',
        kind: 'factor',
        label: 'Adoption Rate',
        observed_state: { value: 0.5, raw_value: 50, unit: '%', cap: 100 },
      },
    ],
    edges: [],
  };
}

function twoFactorGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_a', kind: 'factor', label: 'Factor A' },
      { id: 'fac_b', kind: 'factor', label: 'Factor B' },
    ],
    edges: [],
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when pre-route matches');
      }),
  };
}

/** A routing adapter that returns a benign text-only (converse) response —
 *  for messages the fixed detector must DECLINE so the LLM owns them. */
function textRoutingAdapter(text: string) {
  const result: ChatWithToolsResult = {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 5,
  };
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

type CommittedNode = { id: string; observed_state?: { value?: number; raw_value?: number } };

function committedNodes(): CommittedNode[] {
  const commitWrite = appendCalls.find(
    (w) => (w as { graph?: { nodes?: unknown[] } }).graph !== undefined,
  ) as { graph?: { nodes?: CommittedNode[] } } | undefined;
  return commitWrite?.graph?.nodes ?? [];
}

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// F4 — the skipped unit-family guard must protect EVERY part, not just part 0.
// ---------------------------------------------------------------------------

describe('O-1 F4 — unit-family guard runs for every part (batch preflight)', () => {
  it('"Set Factor A to 0.6 and Marketing Budget to 5 agents" → A applied, £5 REFUSED by name, budget unchanged', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Factor A to 0.6 and Marketing Budget to 5 agents'),
      'req-f4-forward',
      { routingAdapter, graphState: unitGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.failure_type).toBeNull();

    const nodes = committedNodes();
    // The valid part applies.
    expect(nodes.find((n) => n.id === 'fac_a')?.observed_state?.value).toBe(0.6);
    // THE DEFECT: pre-fix, Marketing Budget became £5. It must stay £40,000.
    expect(nodes.find((n) => n.id === 'fac_mb')?.observed_state?.raw_value).toBe(40000);

    // DISCLOSED-PARTIAL: the refused part is named, with a reason.
    const text = response.assistant_text ?? '';
    expect(text).toContain('Factor A');
    expect(text).toMatch(/couldn'?t set Marketing Budget/i);
    // And the £5 write is not confirmed.
    expect(text).not.toMatch(/Marketing Budget to £?5\b/);
  });

  it('REVERSED order "Set Marketing Budget to 5 agents and Factor A to 0.6" → same outcome (order must not decide)', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Marketing Budget to 5 agents and Factor A to 0.6'),
      'req-f4-reversed',
      { routingAdapter, graphState: unitGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.failure_type).toBeNull();

    const nodes = committedNodes();
    // Pre-fix: the refused primary killed the whole turn and Factor A was
    // silently dropped. Post-fix the valid part still applies.
    expect(nodes.find((n) => n.id === 'fac_a')?.observed_state?.value).toBe(0.6);
    expect(nodes.find((n) => n.id === 'fac_mb')?.observed_state?.raw_value).toBe(40000);

    const text = response.assistant_text ?? '';
    expect(text).toContain('Factor A');
    expect(text).toMatch(/couldn'?t set Marketing Budget/i);
  });
});

// ---------------------------------------------------------------------------
// F2 — pairing must bind a quantity to the segment AFTER its label, never by
// global document order over all numbers.
// ---------------------------------------------------------------------------

describe('O-1 F2 — span-based label↔quantity pairing', () => {
  it('"Using the 2026 forecast, set Factor A to current plan and Factor B to 0.8" → Factor A must NOT become 2026', async () => {
    // "current plan" is not a number; the leading 2026 is context. The
    // deterministic path cannot resolve Factor A's value, so it must decline
    // and let the LLM own the message (clarify / interpret "current plan").
    const routingAdapter = textRoutingAdapter('Which value should Factor A take?');
    const { telemetry } = await runTurnExecutor(
      payload('Using the 2026 forecast, set Factor A to current plan and Factor B to 0.8'),
      'req-f2-stray-date',
      { routingAdapter, graphState: twoFactorGraph() },
    );

    expect(telemetry?.failure_type).toBeNull();
    const nodes = committedNodes();
    // THE DEFECT: pre-fix, global positional pairing set Factor A to 2026.
    expect(nodes.find((n) => n.id === 'fac_a')?.observed_state?.value).not.toBe(2026);
    // The message fell through to routing (the detector declined to guess).
    expect(routingAdapter.chatWithTools).toHaveBeenCalled();
  });

  it('leading stray number with clean per-label values → BOTH pair correctly and apply', async () => {
    // Same leading-date shape, but every label has exactly one value in its
    // own segment: the stray 2026 must be ignored, not force a bail (and
    // never be paired). Pre-fix the count gate bailed this to the LLM.
    const routingAdapter = throwingRoutingAdapter();
    const { telemetry } = await runTurnExecutor(
      payload('Using the 2026 forecast, set Factor A to 0.5 and Factor B to 0.8'),
      'req-f2-clean-pair',
      { routingAdapter, graphState: twoFactorGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.failure_type).toBeNull();
    const nodes = committedNodes();
    expect(nodes.find((n) => n.id === 'fac_a')?.observed_state?.value).toBe(0.5);
    expect(nodes.find((n) => n.id === 'fac_b')?.observed_state?.value).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// F12 — order symmetry + error discipline.
// ---------------------------------------------------------------------------

/** Extract the refused factor labels from the receipt ("I couldn't set X …"). */
function refusedLabelsFrom(text: string): string[] {
  const out: string[] = [];
  const re = /couldn'?t set ([^—.]+?) —/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push(
      ...m[1]!
        .split(/,| and /)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }
  return out.sort();
}

describe('O-1 F12 — order symmetry: same input set → same applied set + same named refusals', () => {
  type GraphStateArg = NonNullable<Parameters<typeof runTurnExecutor>[2]>['graphState'];

  interface Fixture {
    readonly name: string;
    readonly orderA: string;
    readonly orderB: string;
    readonly graph: () => GraphStateArg;
    readonly expectApplied: ReadonlyArray<{ id: string; value: number }>;
    readonly expectUnchangedRaw: ReadonlyArray<{ id: string; raw_value: number }>;
    readonly expectRefused: readonly string[];
  }

  const fixtures: Fixture[] = [
    {
      name: 'incompatible unit (F4 pair)',
      orderA: 'Set Factor A to 0.6 and Marketing Budget to 5 agents',
      orderB: 'Set Marketing Budget to 5 agents and Factor A to 0.6',
      graph: unitGraph,
      expectApplied: [{ id: 'fac_a', value: 0.6 }],
      expectUnchangedRaw: [{ id: 'fac_mb', raw_value: 40000 }],
      expectRefused: ['Marketing Budget'],
    },
    {
      name: 'value invalid (bare number outside cap)',
      orderA: 'Set Factor A to 0.6 and Adoption Rate to 250',
      orderB: 'Set Adoption Rate to 250 and Factor A to 0.6',
      graph: capGraph,
      expectApplied: [{ id: 'fac_a', value: 0.6 }],
      expectUnchangedRaw: [{ id: 'fac_ar', raw_value: 50 }],
      expectRefused: ['Adoption Rate'],
    },
    {
      name: 'both valid (regression pin)',
      orderA: 'Set Factor A to 0.6 and Factor B to 0.8',
      orderB: 'Set Factor B to 0.8 and Factor A to 0.6',
      graph: twoFactorGraph,
      expectApplied: [
        { id: 'fac_a', value: 0.6 },
        { id: 'fac_b', value: 0.8 },
      ],
      expectUnchangedRaw: [],
      expectRefused: [],
    },
  ];

  it.each(fixtures)(
    '$name — both clause orders produce identical applied and refused sets',
    async ({ orderA, orderB, graph, expectApplied, expectUnchangedRaw, expectRefused }) => {
      const receipts: string[] = [];
      for (const [i, message] of [orderA, orderB].entries()) {
        appendCalls.length = 0;
        const routingAdapter = throwingRoutingAdapter();
        const { response, telemetry } = await runTurnExecutor(
          payload(message),
          `req-f12-sym-${i}`,
          { routingAdapter, graphState: graph() },
        );
        expect(routingAdapter.chatWithTools, message).not.toHaveBeenCalled();
        expect(telemetry?.failure_type, message).toBeNull();

        const nodes = committedNodes();
        for (const a of expectApplied) {
          expect(nodes.find((n) => n.id === a.id)?.observed_state?.value, message).toBe(a.value);
        }
        for (const u of expectUnchangedRaw) {
          expect(
            nodes.find((n) => n.id === u.id)?.observed_state?.raw_value,
            message,
          ).toBe(u.raw_value);
        }
        const text = response.assistant_text ?? '';
        expect(refusedLabelsFrom(text), message).toEqual([...expectRefused].sort());
        receipts.push(text);
      }
      // Identical named refusals across orders (set equality asserted above
      // per order; this pins the two orders against each other).
      expect(refusedLabelsFrom(receipts[0]!)).toEqual(refusedLabelsFrom(receipts[1]!));
    },
  );
});

describe('O-1 F12 — an infrastructure error mid-batch is NOT blamed on the user', () => {
  it('part 2 handler throws a transport error → turn fails as infrastructure, no partial success receipt, no commit', async () => {
    // Real handler for the first call; a transport-shaped failure on the
    // second. Pre-fix the chain caught this as "value invalid", committed the
    // first part, and blamed the user for an infrastructure fault.
    const real = createSetFactorValueHandler();
    let calls = 0;
    const flaky: HandlerFn = async (invocation) => {
      calls += 1;
      if (calls >= 2) {
        throw new Error('ECONNRESET — simulated infrastructure failure');
      }
      return real(invocation);
    };
    const handlerRegistry: HandlerRegistry = new Map([['set_factor_value', flaky]]);

    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Factor A to 0.6 and Factor B to 0.8'),
      'req-f12-infra',
      { routingAdapter, graphState: twoFactorGraph(), handlerRegistry },
    );

    // Positive control: the failure was injected on part 2.
    expect(calls).toBe(2);

    // The turn surfaces an infrastructure failure — it does NOT narrate a
    // user-fault refusal and does NOT confirm a partial batch as success.
    expect(telemetry?.failure_type).not.toBeNull();
    const text = response.assistant_text ?? '';
    expect(text).not.toMatch(/isn'?t valid/i);

    // No partial graph commit rides a success receipt.
    const commitWrite = appendCalls.find(
      (w) => (w as { graph?: unknown }).graph !== undefined,
    );
    expect(commitWrite).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Chain-module error discipline (unit level): abort is honoured and rethrown;
// only typed parameter-invalid errors become named refusals.
// ---------------------------------------------------------------------------

describe('O-1 — compound chain error discipline (unit)', () => {
  function chainPart(id: string, label: string, value: number) {
    return {
      candidate: { id, label, score: 1, source: 'substring' as const, labelMatchIndex: 0 },
      quantity: {
        raw_text: String(value),
        value,
        unit: null,
        direction: null,
        multiplier: null,
        operator: 'set' as const,
        comparator: null,
        range_min: null,
        range_max: null,
        approximate: false,
        source: 'cqe' as const,
      },
      segmentText: `to ${value}`,
    };
  }

  const primaryOutcome = {
    assistant_text: 'Updated Factor A to 0.6.',
    handler_facts: [],
    llm_calls_used: 0,
    mutated_graph: { nodes: [], edges: [] },
  };

  function chainParams(handlerFn: HandlerFn, signal: AbortSignal) {
    return {
      primaryOutcome,
      remainingUpdates: [chainPart('fac_b', 'Factor B', 0.8)],
      handlerFn,
      message: 'Set Factor A to 0.6 and Factor B to 0.8',
      context: {} as never,
      payload: {} as never,
      requestId: 'req-chain-unit',
      scenarioId: SCENARIO_ID,
      signal,
    };
  }

  it('an already-aborted signal rejects BEFORE any part executes', async () => {
    const ac = new AbortController();
    ac.abort();
    const handlerFn = vi.fn<HandlerFn>();
    await expect(
      applyCompoundValueUpdateChain(chainParams(handlerFn as unknown as HandlerFn, ac.signal)),
    ).rejects.toThrow();
    expect(handlerFn).not.toHaveBeenCalled();
  });

  it('a non-parameter error thrown by a part RETHROWS (never a named refusal)', async () => {
    const handlerFn: HandlerFn = async () => {
      throw new Error('socket hang up');
    };
    await expect(
      applyCompoundValueUpdateChain(chainParams(handlerFn, new AbortController().signal)),
    ).rejects.toThrow('socket hang up');
  });
});
