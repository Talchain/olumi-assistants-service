/**
 * AC.4 — runtime enum-shape test for V5DeterministicValueUpdate
 * telemetry. Captures emitted payloads across the precheck-reject,
 * ambiguous-quantity, and ok paths and asserts every new field's value
 * is either a member of the locked enum union, a boolean, or null.
 *
 * Belt-and-braces: a separate "no prose" check rejects any new field
 * whose value looks like user text (contains whitespace, contains '.',
 * length > 32). This catches a future regression where someone wires a
 * `specific_issue` or factor label into the payload by accident.
 *
 * Compile-time TypeScript narrowing already gates union drift; this
 * file is the runtime canary that fires if the typed contract drifts
 * silently (e.g. a `as unknown as` cast at the emit site).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

function noopRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue({
        content: [{ type: 'text' as const, text: 'noop' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 } as never,
        model: 'mock',
        latencyMs: 0,
      }),
  };
}

// Locked enum values from `evaluate-factor-value-proposal.ts` +
// `turn-executor.ts` V5DeterministicValueUpdate payload builder. Any
// new value must be added here AND in the predicate's union.
const PROPOSAL_REJECTION_REASONS = new Set<string>([
  'missing_value',
  'non_finite',
  'cap_non_positive',
  'bare_number_outside_cap',
  'value_exceeds_cap',
  'delta_no_existing_value',
  'delta_no_cap_and_no_unit',
]);

const EXECUTION_PRECHECK_RESULT_VALUES = new Set<string>([
  ...PROPOSAL_REJECTION_REASONS,
  'ok',
  'not_checked',
]);

const DOWNGRADE_REASONS = new Set<string | null>([
  null,
  'non_factor_kind',
  'handler_not_executable',
]);

const SKIP_REASONS = new Set<string | null>([
  null,
  'no_edit_verb',
  'no_quantity',
  'no_graph',
  'hypothetical_gate',
  'no_candidate_match',
  'ambiguous_quantity',
]);

type CapturedEvent = { event: string; data: Record<string, unknown> };
let events: CapturedEvent[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

function findDeterministicEvents(): readonly CapturedEvent[] {
  return events.filter((e) => e.event === 'v5.deterministic_value_update');
}

function assertEnumShape(payload: Record<string, unknown>): void {
  // 1. Locked-enum membership for the new fields (AC.4 §1)
  const epr = payload.execution_precheck_result;
  expect(typeof epr === 'string', 'execution_precheck_result must be a string').toBe(true);
  expect(
    EXECUTION_PRECHECK_RESULT_VALUES.has(epr as string),
    `execution_precheck_result not in locked enum: ${String(epr)}`,
  ).toBe(true);

  const failure = payload.failure_reason;
  if (failure !== null) {
    expect(typeof failure === 'string').toBe(true);
    expect(
      PROPOSAL_REJECTION_REASONS.has(failure as string),
      `failure_reason not in locked enum: ${String(failure)}`,
    ).toBe(true);
  }

  // 2. Pre-existing fields still enum-only (regression guard)
  expect(SKIP_REASONS.has(payload.skip_reason as string | null)).toBe(true);
  expect(DOWNGRADE_REASONS.has(payload.downgrade_reason as string | null)).toBe(true);

  // 3. No prose — for every NEW field, the value must NOT look like a
  //    sentence. Three heuristics:
  //      • contains whitespace
  //      • contains '.'
  //      • length > 32
  //    These would catch a regression where a `specific_issue` string,
  //    a factor label, or raw message text leaks into the payload.
  const newFields: ReadonlyArray<keyof typeof payload> = [
    'execution_precheck_result',
    'failure_reason',
  ];
  for (const field of newFields) {
    const v = payload[field as string];
    if (typeof v !== 'string') continue;
    expect(/\s/.test(v), `field ${String(field)} contains whitespace: ${v}`).toBe(false);
    expect(v.includes('.'), `field ${String(field)} contains '.': ${v}`).toBe(false);
    expect(
      v.length <= 32,
      `field ${String(field)} is too long (${v.length}): ${v}`,
    ).toBe(true);
  }

  // 4. Numeric/boolean fields keep their primitive types — defensive
  //    guard against a regression that injects strings.
  expect(typeof payload.cqe_quantity_count).toBe('number');
  expect(typeof payload.matched).toBe('boolean');
}

describe('AC.4 — V5DeterministicValueUpdate telemetry enum shape', () => {
  it('precheck-reject (value_exceeds_cap) — emits enum-only payload', async () => {
    const cappedGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        {
          id: 'fac_budget',
          kind: 'factor',
          label: 'Marketing budget',
          observed_state: {
            value: 0.4,
            raw_value: 40000,
            unit: '£',
            cap: 100000,
          },
        },
      ],
      edges: [],
    };
    await runTurnExecutor(
      payload('Set Marketing budget to £500,000'),
      'req-enum-precheck-reject',
      { routingAdapter: noopRoutingAdapter(), graphState: cappedGraph },
    );
    const ev = findDeterministicEvents();
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      assertEnumShape(e.data);
    }
    // Property: at least ONE captured deterministic event has a
    // non-null failure_reason — proves the "real rejection reason"
    // path is exercised, not just the null defaults.
    const haveNonNullFailure = ev.some((e) => e.data.failure_reason !== null);
    expect(haveNonNullFailure).toBe(true);
    // And that non-null value is in the locked union.
    for (const e of ev) {
      if (e.data.failure_reason !== null) {
        expect(
          PROPOSAL_REJECTION_REASONS.has(e.data.failure_reason as string),
        ).toBe(true);
      }
    }
  });

  it('ambiguous_quantity (multi-quantity) — skip_reason and execution_precheck_result both enum-only', async () => {
    const cappedGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        {
          id: 'fac_budget',
          kind: 'factor',
          label: 'Marketing budget',
          observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
        },
      ],
      edges: [],
    };
    await runTurnExecutor(
      payload(
        'Set Marketing budget to £500,000 — that is 5 times our current £100,000 baseline',
      ),
      'req-enum-ambiguous',
      { routingAdapter: noopRoutingAdapter(), graphState: cappedGraph },
    );
    const ev = findDeterministicEvents();
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      assertEnumShape(e.data);
    }
    const ambig = ev.find((e) => e.data.skip_reason === 'ambiguous_quantity');
    expect(ambig).toBeDefined();
    // Skip case: precheck did not run; execution_precheck_result =
    // 'not_checked'; failure_reason = null. Both still in locked enums.
    expect(ambig?.data.execution_precheck_result).toBe('not_checked');
    expect(ambig?.data.failure_reason).toBeNull();
  });

  it('ok path (single-quantity, in-range absolute) — execution_precheck_result is "ok"', async () => {
    const cappedGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        {
          id: 'fac_budget',
          kind: 'factor',
          label: 'Marketing budget',
          observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
        },
      ],
      edges: [],
    };
    await runTurnExecutor(
      payload('Set Marketing budget to £20,000'),
      'req-enum-ok',
      { routingAdapter: noopRoutingAdapter(), graphState: cappedGraph },
    );
    const ev = findDeterministicEvents();
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      assertEnumShape(e.data);
    }
    const okEvent = ev.find((e) => e.data.execution_precheck_result === 'ok');
    expect(okEvent).toBeDefined();
    expect(okEvent?.data.failure_reason).toBeNull();
  });

  it('no factor labels or raw message text leak into the payload', async () => {
    const cappedGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        {
          id: 'fac_budget',
          kind: 'factor',
          label: 'Marketing budget',
          observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
        },
      ],
      edges: [],
    };
    const rawMessage = 'Set Marketing budget to £500,000';
    await runTurnExecutor(
      payload(rawMessage),
      'req-enum-no-leak',
      { routingAdapter: noopRoutingAdapter(), graphState: cappedGraph },
    );
    const ev = findDeterministicEvents();
    for (const e of ev) {
      for (const [field, value] of Object.entries(e.data)) {
        if (typeof value !== 'string') continue;
        // The factor label "Marketing budget" must not appear in any
        // string-typed field on the new telemetry surface.
        expect(
          value.toLowerCase().includes('marketing budget'),
          `field ${field} leaked the factor label: ${value}`,
        ).toBe(false);
        // The raw message must not appear either (would indicate
        // user-prose leakage).
        expect(
          value.includes(rawMessage),
          `field ${field} leaked the raw message: ${value}`,
        ).toBe(false);
        // Internal banned terms — defence-in-depth against future
        // regressions emitting handler/validator-internal vocabulary.
        const banned = ['validator', 'schema', 'handler', 'dispatcher', 'tool call', 'patch'];
        for (const term of banned) {
          expect(
            value.toLowerCase().includes(term),
            `field ${field} contains banned internal term "${term}": ${value}`,
          ).toBe(false);
        }
      }
    }
  });
});
