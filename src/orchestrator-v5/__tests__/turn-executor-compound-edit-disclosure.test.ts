/**
 * POC-BOARD 5b — compound tunable edit: honest disclosure, not silent drop.
 *
 * CONFIRMED-LIVE defect (STEP0 trust-spine, build 6fd24d9, raw
 * `s1-06-multitunable-hold.json`): a two-op tunable edit — "Set X to 70% AND
 * set Y to 80%" — routed to `turn_executor`, applied ONLY the first
 * `set_factor_value` and SILENTLY dropped the second (DB-verified: the second
 * factor unchanged, `graph_patch` carried one op, assistant_text named only the
 * first change, no disclosure).
 *
 * Root cause: the V5 router's `tryInterpret` picked `content.find(tool_use)` —
 * block[0] — so every extra `olumi_action` the model emitted in the same
 * response was discarded with no trace. The scope-fenced fix (multi-apply would
 * need the commit/atomic path owned by PR #500/#501) keeps one op per turn but
 * makes the drop HONEST: the router surfaces the extra actions on
 * `droppedActions`, and the execute-success compose path discloses them.
 *
 * This end-to-end test drives the LLM-routed path with a mock adapter that
 * returns TWO `set_factor_value` tool_use blocks and asserts:
 *   1. the FIRST op applies (committed graph updated),
 *   2. the SECOND op is NOT applied (unchanged — one op per turn preserved),
 *   3. the response DISCLOSES the un-applied change by name (the honesty fix).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const appendCalls: Array<{
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  turn_class?: unknown;
}> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: {
      graph?: unknown;
      handler_id?: unknown;
      handler_facts?: unknown;
      turn_class?: unknown;
    }) => {
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

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({ turn_id: TURN_ID, scenario_id: SCENARIO_ID, message });
}

/** Two distinct £ factors, each with a resolved current value. */
function buildTwoFactorGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-marketing',
        kind: 'factor',
        label: 'Marketing Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      {
        id: 'f-sales',
        kind: 'factor',
        label: 'Sales Budget',
        observed_state: { value: 0.5, raw_value: 50000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  } as GraphV3T;
}

function setProposal(id: string, label: string, rawValue: number): Record<string, unknown> {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id,
        kind: 'node',
        label,
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'value', value: { value: rawValue, unit: '£' }, operator: 'set', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    },
  };
}

/** A routing adapter returning MULTIPLE olumi_action tool_use blocks at once.
 *  `orientationText`, when supplied, is prepended as the model's leading text
 *  block — it becomes the composed response's orientation (compose.ts joins
 *  orientation + confirmation + coaching), letting a test drive the exact
 *  user-facing prose STEP 6.6 evaluates. */
function mockMultiActionAdapter(inputs: Record<string, unknown>[], orientationText?: string) {
  const content: ToolResponseBlock[] = [];
  if (orientationText) content.push({ type: 'text', text: orientationText });
  content.push(
    ...inputs.map((input, i) => ({
      type: 'tool_use' as const,
      id: `tu-${i + 1}`,
      name: OLUMI_ACTION_TOOL_NAME,
      input,
    })),
  );
  const result: ChatWithToolsResult = {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 40 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('POC-BOARD 5b — compound tunable edit discloses the dropped op', () => {
  it('applies the first set, leaves the second UNCHANGED, and DISCLOSES the un-applied change by name', async () => {
    const routingAdapter = mockMultiActionAdapter([
      setProposal('f-marketing', 'Marketing Budget', 45000),
      setProposal('f-sales', 'Sales Budget', 60000),
    ]);

    const { response, telemetry } = await runTurnExecutor(
      payload('set marketing budget to £45,000 and set sales budget to £60,000'),
      'req-compound-edit',
      { routingAdapter, graphState: buildTwoFactorGraph() },
    );

    // The turn executes the FIRST op.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    expect(appendCalls).toHaveLength(1);
    const committed = appendCalls[0]!.graph as GraphV3T;
    const marketing = committed.nodes.find((n) => n.id === 'f-marketing');
    const sales = committed.nodes.find((n) => n.id === 'f-sales');

    // (1) first op applied.
    expect(marketing?.observed_state?.raw_value).toBe(45000);
    // (2) second op NOT applied — one op per turn (unchanged from ingress).
    expect(sales?.observed_state?.raw_value).toBe(50000);

    // (3) HONESTY: the response names the un-applied change and does not
    // present it as done. Pre-fix this was silent (assistant_text named only
    // the first change).
    const text = response.assistant_text ?? '';
    expect(text).toContain('Sales Budget');
    expect(text.toLowerCase()).toMatch(/haven'?t applied|other change/);
    // It must NOT claim the dropped value was set.
    expect(text).not.toContain('£60,000');
  });

  it('a single-op set applies with NO spurious disclosure', async () => {
    const routingAdapter = mockMultiActionAdapter([
      setProposal('f-marketing', 'Marketing Budget', 45000),
    ]);

    const { response, telemetry } = await runTurnExecutor(
      payload('set marketing budget to £45,000'),
      'req-single-edit',
      { routingAdapter, graphState: buildTwoFactorGraph() },
    );

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    const text = response.assistant_text ?? '';
    expect(text).not.toMatch(/haven'?t applied/i);
    expect(text).not.toContain('Sales Budget');
  });
});

// ---------------------------------------------------------------------------
// P2 (5b review) — the disclosure copy must not itself trip the STEP 6.6
// structural-claim monitor when the FIRST (applied) op is a NON-mutating
// execute handler.
//
// When block[0] mutates (set_factor_value, above), STEP 6.6 short-circuits to
// `pass` (handlerEmittedMutatedGraph === true), so the disclosure wording is
// never scored — which is exactly why the two-set tests above could not catch
// this. The bug lives on the OTHER shape: a compound whose first op is
// run_analysis / what_would_flip / explain (handlerEmittedMutatedGraph false),
// where classifyStructuralClaim DOES score the composed text. The pre-fix copy
// ended "…and I'll make that change too"; "make" is in the broad edit-verb
// list, so that turn emitted a spurious `V5StructuralSuccessClaimCandidateMiss`.
// ---------------------------------------------------------------------------

/** A graph with options (so run_analysis is dispatchable) plus the two factors. */
function buildGraphWithOptions(): GraphStateIngress {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-marketing',
        kind: 'factor',
        label: 'Marketing Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      {
        id: 'f-sales',
        kind: 'factor',
        label: 'Sales Budget',
        observed_state: { value: 0.5, raw_value: 50000, unit: '£', cap: 100000 },
      },
      { id: 'opt_a', kind: 'option', label: 'Launch' },
      { id: 'opt_b', kind: 'option', label: 'Hold' },
    ],
    edges: [],
    options: [
      { id: 'opt_a', status: 'ready', interventions: { 'f-marketing': { value: 1 } } },
      { id: 'opt_b', status: 'ready', interventions: { 'f-marketing': { value: 0 } } },
    ],
  } as GraphStateIngress;
}

/** A valid, NON-mutating run_analysis execute proposal (block[0]). */
function runAnalysisProposal(): Record<string, unknown> {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'run_analysis',
      entity: {
        id: 'opt_a',
        kind: 'option',
        label: 'Launch',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [],
      cited_context_fields: [],
    },
  };
}

/** A run_analysis handler that succeeds WITHOUT a mutated_graph (non-mutating).
 *  `assistantText` is unused by compose for the top-level string (the analysis
 *  narrative rides a block), but is kept for parity with the real handler. */
function makeRunAnalysisRegistry(): HandlerRegistry {
  const fact: HandlerFact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran the analysis on your scenario.',
      computed_at: '2026-07-17T01:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
    },
  } as HandlerFact;
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis on your scenario.',
    handler_facts: [fact],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

function analysePayload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

describe('POC-BOARD 5b — compound disclosure is inert to the STEP 6.6 monitor (P2)', () => {
  it('run_analysis (non-mutating) + a dropped edit: discloses the drop, emits NO candidate-miss / swap event', async () => {
    const routingAdapter = mockMultiActionAdapter([
      runAnalysisProposal(), // block[0] — non-mutating execute (applied)
      setProposal('f-sales', 'Sales Budget', 60000), // block[1] — dropped edit
    ]);

    // NB: the message must NOT itself read as a direct "set X to N" command, or
    // the deterministic value-update pre-route intercepts BEFORE routing and the
    // injected compound never runs. The dropped op is supplied by the mock
    // adapter (block[1]), not by the message text — so a plain analysis ask is
    // the faithful driver for "the model emitted run_analysis + an extra edit".
    const { response, telemetry } = await runTurnExecutor(
      analysePayload('please run the analysis'),
      'req-compound-nonmut-first',
      { routingAdapter, handlerRegistry: makeRunAnalysisRegistry(), graphState: buildGraphWithOptions() },
    );

    // Sanity: the execute path ran and committed (the handler succeeded).
    expect(telemetry.failure_type).toBeNull();

    // POSITIVE PRESENCE — the disclosure DID fire; without this the absence
    // assertion below would be vacuous (it must be scoring the disclosed text).
    const text = response.assistant_text ?? '';
    expect(text.toLowerCase()).toMatch(/haven'?t applied/);
    expect(text).toContain('Sales Budget');

    // THE FIX — the reworded disclosure carries no broad/mutation edit verb, so
    // STEP 6.6 scores the composed text `pass`: no spurious monitor, no swap.
    const candidateMiss = events.filter(
      (e) => e.event === TelemetryEvents.V5StructuralSuccessClaimCandidateMiss,
    );
    expect(candidateMiss).toHaveLength(0);
    const swapped = events.filter(
      (e) => e.event === TelemetryEvents.V5StructuralSuccessClaimSwapped,
    );
    expect(swapped).toHaveLength(0);
  });

  it('positive control: a run_analysis turn whose prose carries broad edit language DOES emit candidate-miss (the monitor is reachable in this harness)', async () => {
    // Same NON-mutating execute turn, single op (no dropped action) — but the
    // model's leading orientation text carries the exact pre-fix phrasing.
    // "I'll make …" trips containsBroadStructuralClaimLanguage, so STEP 6.6
    // MUST emit the candidate-miss here. This proves the assertion above can
    // SEE the event (CLAUDE.md: an absence check needs a positive control).
    const routingAdapter = mockMultiActionAdapter(
      [runAnalysisProposal()],
      "I'll make that change too.",
    );

    const { response } = await runTurnExecutor(
      analysePayload('run the analysis'),
      'req-broad-control',
      { routingAdapter, handlerRegistry: makeRunAnalysisRegistry(), graphState: buildGraphWithOptions() },
    );

    // The broad phrase reached the composed prose (guards against a silent
    // sanitiser strip that would make the control vacuous).
    expect(response.assistant_text ?? '').toContain("I'll make that change");

    const candidateMiss = events.filter(
      (e) => e.event === TelemetryEvents.V5StructuralSuccessClaimCandidateMiss,
    );
    expect(candidateMiss).toHaveLength(1);
  });
});
