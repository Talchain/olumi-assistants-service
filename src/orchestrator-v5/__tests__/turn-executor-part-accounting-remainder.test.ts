/**
 * Part-accounting conservation law — DETERMINISTIC-lane defence in depth
 * (rehearsal defect A, REHEARSAL-DEFECT-TRIAGE-2026-07-20.md).
 *
 * Route-v2 now stands the value-update suppressor down for mixed
 * value+structural messages so they reach the edit_graph lane — but any
 * mixed message that still reaches the TurnExecutor and auto-dispatches
 * the deterministic set_factor_value path must not swallow its structural
 * half silently. The receipt must name the unserved structural part
 * (DISCLOSED-PARTIAL, same doctrine as #549's compound refusals), and the
 * part-accounting telemetry must record it.
 *
 * Harness mirrors turn-executor-compound-value-update.test.ts (session
 * store mocked; a THROWING routing adapter proves the deterministic path
 * ran with zero LLM calls).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../compose/forbidden-user-facing-phrases.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

const appendCalls: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
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

function graph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      {
        id: 'fac_a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 0.4 },
      },
      { id: 'fac_b', kind: 'factor', label: 'Factor B', observed_state: { value: 0.5 } },
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

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  appendCalls.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function partAccountingEvents(): Event[] {
  return events.filter((e) => e.event === TelemetryEvents.V5EditGraphPartAccounting);
}

describe('deterministic lane — mixed message discloses the structural remainder', () => {
  it('applies the value part AND names the unserved structural part on the receipt', async () => {
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Factor A to 0.6 and add a new factor called Shipping costs'),
      'req-pa-remainder',
      { routingAdapter: throwingRoutingAdapter(), graphState: graph() },
    );

    // The deterministic path ran (no LLM) and the value part applied.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();

    // DISCLOSED-PARTIAL: the receipt names the structural remainder.
    const text = response.assistant_text ?? '';
    expect(text).toContain('Factor A');
    expect(text).toContain('Shipping costs');
    expect(text.toLowerCase()).toMatch(/haven'?t taken forward/);
    expect(findForbiddenPhraseHit(text)).toBeNull();
    // NB: the receipt legitimately claims the APPLIED value change; only
    // the appended remainder notice must not add a new success claim —
    // asserted by sweeping the notice in the module's own unit tests.

    // Telemetry records the deterministic-lane disclosure.
    const pa = partAccountingEvents();
    expect(pa).toHaveLength(1);
    expect(pa[0]!.data.dispatch_path).toBe('deterministic_value_update');
    expect(pa[0]!.data.disclosure_appended).toBe(true);
    expect(pa[0]!.data.parts_uncovered).toBe(1);
  });

  it('GOLDEN PIN: a pure value update carries NO remainder notice and NO accounting event', async () => {
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Factor A to 0.6'),
      'req-pa-pure-value',
      { routingAdapter: throwingRoutingAdapter(), graphState: graph() },
    );
    expect(telemetry.turn_class).toBe('handler');
    const text = response.assistant_text ?? '';
    expect(text).not.toMatch(/haven'?t taken forward/i);
    expect(text).not.toContain('Shipping costs');
    expect(partAccountingEvents()).toHaveLength(0);
  });

  it("GOLDEN PIN: #549's value+value compound is untouched (both apply, no remainder notice)", async () => {
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Factor A to 0.6 and Factor B to 0.8'),
      'req-pa-compound-values',
      { routingAdapter: throwingRoutingAdapter(), graphState: graph() },
    );
    expect(telemetry.turn_class).toBe('handler');
    const text = response.assistant_text ?? '';
    expect(text).toContain('Factor A');
    expect(text).toContain('Factor B');
    expect(text).not.toMatch(/haven'?t taken forward/i);
    expect(partAccountingEvents()).toHaveLength(0);
    // The compound receipt is a success narration — it must stay clean of
    // spurious refusal copy but is entitled to its success claims, so only
    // the forbidden (denial) sweep applies here.
    expect(findForbiddenPhraseHit(text)).toBeNull();
    void findSuccessClaimHit; // imported for parity with sibling suites
  });
});
