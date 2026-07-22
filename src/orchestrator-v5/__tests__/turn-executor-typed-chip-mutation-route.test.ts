/**
 * S2-L3 — typed-chip mutation route (chip.parameters → validated-proposal path)
 * route-level pins.
 *
 * MUTATION-CHECK BY CONSTRUCTION (trap-11 / R-4): each "routed" case uses a
 * message the deterministic TEXT parser CANNOT resolve (no quantity in the
 * copy) and an LLM adapter that WOULD commit a DIFFERENT value if reached. So:
 *   - with the typed-chip pre-route wired, the committed graph carries the
 *     chip.parameters value and the LLM adapter is never called;
 *   - revert the wiring and the same turn either falls to the LLM (committing
 *     the DIFFERENT value) or produces no handler execute — the assertion flips
 *     RED. The read is therefore proven to CHANGE behaviour, not decorate it.
 *
 * The fall-through case proves an un-routable typed chip (malformed parameters)
 * degrades to the existing text/LLM path — the #634 un-routed-intent contract.
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

const appendCalls: Array<{ graph?: unknown; handler_id?: unknown; turn_class?: unknown }> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown; handler_id?: unknown; turn_class?: unknown }) => {
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

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** £ factor with a resolved current value: raw £40,000 (value 0.4, cap 100k). */
function buildBudgetGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  };
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

/** An LLM adapter that would commit a DIFFERENT absolute value (£99,999). */
function llmSetsDifferentValue() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () =>
      mkToolUseResult({
        intent_class: 'execute',
        action: {
          handler_id: 'set_factor_value',
          entity: {
            id: 'f-budget',
            kind: 'node',
            label: 'Budget',
            resolution_status: 'resolved',
            resolution_method: 'context_inference',
          },
          parameters: [
            { name: 'value', value: { value: 99999, unit: '£' }, operator: 'set', source: 'user_explicit' },
          ],
          cited_context_fields: [],
        },
      }),
    );
  return { adapter: { chatWithTools }, chatWithTools };
}

/** A chip_click message turn carrying a typed mutation chip. */
function chipTurn(chip: MessageTurnPayload['chip'], message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    source: 'chip_click',
    message,
    chip,
  });
}

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('typed set_factor_value chip → chip.parameters routed into the proposal path', () => {
  it('commits the CHIP value (not the LLM value) and never calls the LLM', async () => {
    const { adapter, chatWithTools } = llmSetsDifferentValue();
    const { response, telemetry } = await runTurnExecutor(
      // Message carries NO number, so the deterministic text parser cannot
      // resolve it — only the typed chip.parameters can. This is what makes the
      // check discriminating (revert the wiring → LLM's £99,999 wins).
      chipTurn(
        { action_type: 'set_factor_value', parameters: { target_id: 'f-budget', value: 42000, unit: '£', operator: 'set' } },
        'Set the budget from the canvas',
      ),
      'req-typed-chip-sfv',
      { routingAdapter: adapter, graphState: buildBudgetGraph() },
    );

    // The proposal lifecycle ran as a handler execute.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.stages_completed).toContain('execute');

    // The committed graph carries the CHIP value — £42,000 — proving the read.
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    const budget = committed.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(42000);

    // The LLM was never consulted (zero-LLM deterministic route).
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.llm_calls_used).toBe(0);
    expect(response.assistant_text.length).toBeGreaterThan(0);

    // Telemetry: the typed-chip route fired with outcome 'routed'.
    const routed = events.filter((e) => e.event === 'v5.typed_chip_mutation_route');
    expect(routed).toHaveLength(1);
    expect(routed[0]!.data).toMatchObject({ action_type: 'set_factor_value', outcome: 'routed' });
  });

  it('reads a DIFFERENT chip value into a DIFFERENT committed value (positive control)', async () => {
    const { adapter, chatWithTools } = llmSetsDifferentValue();
    await runTurnExecutor(
      chipTurn(
        { action_type: 'set_factor_value', parameters: { target_id: 'f-budget', value: 55000, unit: '£', operator: 'set' } },
        'Set the budget from the canvas',
      ),
      'req-typed-chip-sfv-2',
      { routingAdapter: adapter, graphState: buildBudgetGraph() },
    );
    const committed = appendCalls[0]!.graph as GraphV3T;
    expect(committed.nodes.find((n) => n.id === 'f-budget')?.observed_state?.raw_value).toBe(55000);
    expect(chatWithTools).not.toHaveBeenCalled();
  });
});

describe('un-routable typed mutation chip falls through benignly (#634 contract)', () => {
  it('malformed chip.parameters → falls through to the LLM path, telemetry records the skip', async () => {
    const { adapter, chatWithTools } = llmSetsDifferentValue();
    const { telemetry } = await runTurnExecutor(
      // No `value` in parameters → reader returns parameters_invalid → the turn
      // must NOT be routed by the typed path; it falls through to the LLM.
      chipTurn(
        { action_type: 'set_factor_value', parameters: { target_id: 'f-budget' } },
        'Set the budget from the canvas',
      ),
      'req-typed-chip-fallthrough',
      { routingAdapter: adapter, graphState: buildBudgetGraph() },
    );

    // The LLM WAS consulted — proving benign fall-through (not a hard block).
    expect(chatWithTools).toHaveBeenCalledTimes(1);
    expect(telemetry.llm_calls_used).toBeGreaterThan(0);

    // Telemetry: the typed-chip route recorded the classified fall-through.
    const routed = events.filter((e) => e.event === 'v5.typed_chip_mutation_route');
    expect(routed).toHaveLength(1);
    expect(routed[0]!.data).toMatchObject({
      action_type: 'set_factor_value',
      outcome: 'fell_through:parameters_invalid',
    });
  });

  it('a non-mutation typed chip is never claimed by this route (no event, no crash)', async () => {
    const { adapter } = llmSetsDifferentValue();
    await runTurnExecutor(
      chipTurn(
        { action_type: 'compare_options', parameters: {} },
        'Compare the options',
      ),
      'req-typed-chip-nonmutation',
      { routingAdapter: adapter, graphState: buildBudgetGraph() },
    );
    // compare_options is not a mutation action_type → the pre-route guard never
    // enters, so it emits nothing. (It routes elsewhere; we only assert this
    // route stays silent.)
    expect(events.filter((e) => e.event === 'v5.typed_chip_mutation_route')).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// P1 — the SILENT WRONG-VALUE COMMIT (A2 live probe, build eb792d8).
//
// A typed set_factor_value chip carried `value: "one hundred and forty"` (a
// STRING) plus a rendered copy that also read "…one hundred and forty". The
// typed reader CORRECTLY rejected the string (plain z.number()) and emitted
// `fell_through:parameters_invalid` — but the turn then fell through to the
// deterministic TEXT value-update parser, which ran the CQE word-number
// pre-pass over the CHIP COPY ("one" → "1"), matched the factor by label, and
// silently committed value **1** with ZERO LLM calls. That is the exact "typed
// chip re-inferred from its copy" class S2 exists to kill — S2 only prevented
// it on the reader-SUCCESS path. A malformed typed mutation chip must reach the
// LLM, never have its copy re-parsed by the deterministic value updater.
//
// Both cases below are MUTATION-CHECKED BY CONSTRUCTION: the message copy DOES
// resolve to a deterministic quantity (word-number 1), so with the fix reverted
// the value updater fires and the assertions flip RED (committed value 1, LLM
// never called).
// ────────────────────────────────────────────────────────────────────────────

/** Unitless count factor at 130 — A2's "Support Ticket Load" scenario shape. */
function buildTicketGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-rev', kind: 'goal', label: 'Revenue' },
      {
        id: 'fac_support_load',
        kind: 'factor',
        label: 'Support Ticket Load',
        observed_state: { value: 130, raw_value: 130 },
      },
      { id: 'o-x', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/** LLM that would commit a DISTINCTIVE value (777) on the ticket factor. */
function llmSetsTicketValue777() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () =>
      mkToolUseResult({
        intent_class: 'execute',
        action: {
          handler_id: 'set_factor_value',
          entity: {
            id: 'fac_support_load',
            kind: 'node',
            label: 'Support Ticket Load',
            resolution_status: 'resolved',
            resolution_method: 'context_inference',
          },
          parameters: [
            { name: 'value', value: 777, operator: 'set', source: 'user_explicit' },
          ],
          cited_context_fields: [],
        },
      }),
    );
  return { adapter: { chatWithTools }, chatWithTools };
}

/** LLM that answers with TEXT only — no tool_use, so no mutation is committed. */
function llmTextOnly() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [{ type: 'text', text: 'Which value did you mean?' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
      model: 'test',
      latencyMs: 5,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

describe('P1 — malformed typed set_factor_value chip must not re-parse its own copy', () => {
  it('string value + resolvable copy → reaches the LLM, commits the LLM value (NOT the copy-derived 1)', async () => {
    const { adapter, chatWithTools } = llmSetsTicketValue777();
    const { telemetry } = await runTurnExecutor(
      // A2's verbatim shape: value is a STRING; the copy also carries the
      // word-form value, so the deterministic text parser CAN resolve it to 1.
      chipTurn(
        {
          action_type: 'set_factor_value',
          parameters: { target_id: 'fac_support_load', value: 'one hundred and forty' },
        },
        'Update Support Ticket Load to one hundred and forty',
      ),
      'req-typed-chip-string-value',
      { routingAdapter: adapter, graphState: buildTicketGraph() },
    );

    // The typed reader classified the malformed spec (contract telemetry).
    const routed = events.filter((e) => e.event === 'v5.typed_chip_mutation_route');
    expect(routed).toHaveLength(1);
    expect(routed[0]!.data).toMatchObject({
      action_type: 'set_factor_value',
      outcome: 'fell_through:parameters_invalid',
    });

    // The turn reached the LLM (benign fall-through) — the copy was NOT
    // deterministically re-parsed into a silent commit.
    expect(chatWithTools).toHaveBeenCalledTimes(1);
    expect(telemetry.llm_calls_used).toBeGreaterThan(0);

    // The committed value is the LLM's 777 — never the copy-derived 1.
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    const load = committed.nodes.find((n) => n.id === 'fac_support_load');
    expect(load?.observed_state?.raw_value).toBe(777);
    expect(load?.observed_state?.raw_value).not.toBe(1);
  });

  it('positive control: string value + non-mutating LLM → graph value stays 130 (never silently 1)', async () => {
    const { adapter, chatWithTools } = llmTextOnly();
    const { response } = await runTurnExecutor(
      chipTurn(
        {
          action_type: 'set_factor_value',
          parameters: { target_id: 'fac_support_load', value: 'one hundred and forty' },
        },
        'Update Support Ticket Load to one hundred and forty',
      ),
      'req-typed-chip-string-value-pc',
      { routingAdapter: adapter, graphState: buildTicketGraph() },
    );

    // 200-class outcome (no failure), fall-through telemetry present.
    expect(response.assistant_text.length).toBeGreaterThan(0);
    const routed = events.filter((e) => e.event === 'v5.typed_chip_mutation_route');
    expect(routed[0]!.data).toMatchObject({ outcome: 'fell_through:parameters_invalid' });

    // The LLM was consulted and committed nothing → the factor is UNCHANGED at
    // 130. Pre-fix, the deterministic text parser commits value 1 here.
    expect(chatWithTools).toHaveBeenCalledTimes(1);
    const commit = appendCalls.find((c) => {
      const g = c.graph as GraphV3T | undefined;
      return g?.nodes?.some((n) => n.id === 'fac_support_load');
    });
    const committedLoad = (commit?.graph as GraphV3T | undefined)?.nodes.find(
      (n) => n.id === 'fac_support_load',
    );
    // Either no mutation commit landed at all, or if one did it still reads 130.
    expect(committedLoad?.observed_state?.raw_value ?? 130).toBe(130);
  });

  it('does NOT break the legitimate chat path: a real composer message still parses via CQE deterministically', async () => {
    // The gate is CHIP-SCOPED. A genuine user utterance typed into the composer
    // (source !== chip_click/chip) is NOT a typed mutation chip, so the flag is
    // never set and the deterministic text value-update path runs UNCHANGED —
    // the same CQE extraction it always did (word-number "one" → 1 here). This
    // pins that the fix suppresses ONLY the chip-copy re-parse, never the real
    // text lane. (The "one hundred and forty" → 1 CQE behaviour is a separate,
    // pre-existing quirk this fix deliberately does not touch.)
    const { chatWithTools } = llmSetsTicketValue777();
    await runTurnExecutor(
      makeMessagePayload({
        turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        scenario_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        stage: 'analyse',
        source: 'composer',
        message: 'set support ticket load to one hundred and forty',
      }),
      'req-composer-legit-text',
      { routingAdapter: { chatWithTools }, graphState: buildTicketGraph() },
    );

    // No typed-chip route event (this is not a chip turn).
    expect(events.filter((e) => e.event === 'v5.typed_chip_mutation_route')).toHaveLength(0);
    // The deterministic text path owned the turn (unchanged) — LLM not called,
    // and it committed the CQE-derived value exactly as before the fix.
    expect(chatWithTools).not.toHaveBeenCalled();
    const committed = appendCalls[0]?.graph as GraphV3T | undefined;
    const load = committed?.nodes.find((n) => n.id === 'fac_support_load');
    expect(load?.observed_state?.raw_value).toBe(1);
  });
});
