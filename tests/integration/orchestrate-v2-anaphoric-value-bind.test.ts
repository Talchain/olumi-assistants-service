/**
 * Spec §4.3 (PR C of the referent stack) — HTTP-boundary witness that a
 * VALUE-BEARING anaphoric edit binds under the register precondition and
 * applies through the deterministic `set_factor_value` path, disclosed.
 *
 * The register is projected from the SAME source the no-op recovery layer
 * reads — the prior assistant message in the session store — so this harness
 * seeds `readRecent` with the bound reply #1362 ships:
 *
 *   turn N,   assistant: "I have not changed the model yet. Taking that as
 *                         Sales Headcount Investment. What value would you like
 *                         it set to?"
 *   turn N+1, user:      "Set it to £100,000."   ← this file's subject
 *
 * The LLM adapter THROWS, so any turn that reaches routing fails loudly and
 * `llmCallTracker` records it. That is the discriminating instrument for the
 * twins: "not claimed" is asserted as "the LLM was reached", never inferred
 * from the absence of a patch.
 *
 * Harness modelled on `orchestrate-v2-deterministic-value-update.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import { parseDeliveredOlumiResponse } from '../helpers/parse-delivered-response.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';

const llmCallTracker = { count: 0 };

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-throwing-adapter',
    chat: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM reached');
    },
    chatWithTools: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM reached');
    },
  }),
  getAdapterWithResolution: (task?: string) => ({
    adapter: {
      name: 'test-throwing-adapter',
      chat: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM reached');
      },
      chatWithTools: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM reached');
      },
    },
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'test-throwing-adapter',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

let mockedRecentRows: SessionTurnWithContent[] = [];
const appendCalls: unknown[] = [];

vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write) => {
          appendCalls.push(write);
          return { id: 'mock-row-id' };
        },
        readRecent: async () => mockedRecentRows,
        readFactsFor: async () => [],
      }),
    resetSessionStoreForTests: () => {},
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');
const { makeSessionTurnRow } = await import('../utils/mock-session-store.js');

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

/** The bound reply #1362 ships, verbatim shape (lead · disclosure · question). */
const PRIOR_BOUND_REPLY =
  'I have not changed the model yet. Taking that as Sales Headcount Investment. '
  + 'What value would you like it set to?';

function priorAssistantTurn(assistantMessage: string | null): SessionTurnWithContent {
  return makeSessionTurnRow({
    id: '55555555-5555-4555-8555-555555555555',
    scenario_id: SCENARIO_ID,
    turn_id: 'prior-turn',
    turn_class: 'direct_answer',
    handler_id: null,
    llm_calls_used: 0,
    user_message: 'Can you update it with the correct range?',
    assistant_message: assistantMessage,
  });
}

function buildGraphState() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
      {
        id: 'fac_shi',
        kind: 'factor',
        label: 'Sales Headcount Investment',
        observed_state: { value: 0.4, raw_value: 80000, unit: '£', cap: 200000 },
      },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Price',
        observed_state: { value: 0.5, raw_value: 50, unit: '£', cap: 100 },
      },
      { id: 'out_mrr', kind: 'outcome', label: 'MRR Growth' },
      { id: 'opt_out', kind: 'option', label: 'Outsource' },
      { id: 'opt_in', kind: 'option', label: 'Insource' },
    ],
    edges: [
      {
        from: 'fac_shi',
        to: 'goal_1',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
    ],
    options: [
      { id: 'opt_out', status: 'ready', interventions: { fac_shi: { value: 90000 } } },
      { id: 'opt_in', status: 'ready', interventions: { fac_shi: { value: 70000 } } },
    ],
    goal_node_id: 'goal_1',
  };
}

function buildRequest(message: string, selectedNodeIds: string[] = []) {
  return {
    kind: 'message' as const,
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
    graph_state: buildGraphState(),
    selected_elements: { node_ids: selectedNodeIds, edge_ids: [] },
  };
}

function patchBlocks(body: unknown): Array<Record<string, unknown>> {
  const blocks = (body as { blocks?: unknown }).blocks;
  return Array.isArray(blocks)
    ? (blocks as Array<Record<string, unknown>>).filter((b) => b.type === 'graph_patch')
    : [];
}

describe('POST /orchestrate/v2/turn — §4.3 value-bearing anaphoric edit binds under the register precondition', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });
  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });
  beforeEach(() => {
    events = [];
    appendCalls.length = 0;
    mockedRecentRows = [];
    llmCallTracker.count = 0;
  });

  it('⭐ "Set it to £100,000." after the bound reply → set_factor_value on fac_shi, disclosed FIRST, no LLM call', async () => {
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = parseDeliveredOlumiResponse(body);

    expect(llmCallTracker.count).toBe(0);

    const patch = parsed.blocks.find((b) => b.type === 'graph_patch') as
      | { operation?: string; target_id?: string }
      | undefined;
    expect(patch).toBeDefined();
    expect(patch?.operation).toBe('set_factor_value');
    // BIND BY IDENTITY — the node id, not "some factor".
    expect(patch?.target_id).toBe('fac_shi');

    // The disclosure is its OWN sentence, and it is the FIRST one.
    const sentences = parsed.assistant_text.split(/(?<=[.?!])\s+/);
    expect(sentences[0]).toBe('Taking that as Sales Headcount Investment.');
    expect(parsed.assistant_text).toContain('Sales Headcount Investment');
    expect(parsed.assistant_text).toMatch(/£100,000|£100000/);
    expect(parsed.assistant_text).not.toMatch(/\bfac_shi\b/);

    const preRoute = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRoute?.data.matched).toBe(true);
    expect(preRoute?.data.dispatch).toBe('set_factor_value');
  });

  it('the same message with a BARE number ("Set it to 100000.") applies too — the shared value predicate accepts a bare number inside a £ factor\'s cap', async () => {
    // The bare-number-on-a-unit-factor decision belongs to the shared value
    // predicate (`evaluateFactorValueProposal`), which this PR does not change.
    // Measured at this head: `{ rawInput: 100000, operator: 'set', factorCap:
    // 200000, factorUnit: '£', inputHasUnit: false }` → `{ ok: true }`, so the
    // proposal is synthesised and executed, and the receipt follows the
    // disclosure.
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to 100000.'),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    const patch = patchBlocks(body)[0];
    expect(patch?.operation).toBe('set_factor_value');
    expect(patch?.target_id).toBe('fac_shi');
    const sentences = String(body.assistant_text).split(/(?<=[.?!])\s+/);
    expect(sentences[0]).toBe('Taking that as Sales Headcount Investment.');
    const preRoute = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRoute?.data.matched).toBe(true);
    expect(preRoute?.data.dispatch).toBe('set_factor_value');
    expect(preRoute?.data.execution_precheck_result).toBe('ok');
    expect(preRoute?.data.candidate_sources).toEqual(['register']);
  });

  it('a bound value the predicate REJECTS ("Set it to 12%." on a £ factor) is refused with the disclosure first, no write, no LLM', async () => {
    // Measured at this head: the same predicate returns
    // `{ ok: false, reason: 'unit_mismatch' }` for `12 %` against a `£` factor.
    // The proposal is still synthesised (the precheck records the reason and
    // STEP 2 rejects through the recoverable-validator path), and the recovery
    // copy does not name the node — so the disclosure must lead it.
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to 12%.'),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    expect(patchBlocks(body)).toEqual([]);
    const text = String(body.assistant_text ?? '');
    const sentences = text.split(/(?<=[.?!])\s+/);
    expect(sentences[0]).toBe('Taking that as Sales Headcount Investment.');
    expect(text).toMatch(/£/);
    const preRoute = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRoute?.data.dispatch).toBe('set_factor_value');
    expect(preRoute?.data.execution_precheck_result).toBe('unit_mismatch');
  });

  it('the NEXT turn: the disclosed receipt is what the following register reads, so "Set it to 90000." binds the same factor again', async () => {
    // No deterministic claim recorder exists at this head — the register is
    // projected from the persisted `assistant_message` by label match — so the
    // receipt naming the label IS the record the next turn resolves against.
    mockedRecentRows = [
      priorAssistantTurn(
        'Taking that as Sales Headcount Investment. Updated Sales Headcount Investment from £80,000 to £100,000.',
      ),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to 90000.'),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const patch = patchBlocks(JSON.parse(res.body))[0];
    expect(patch?.operation).toBe('set_factor_value');
    expect(patch?.target_id).toBe('fac_shi');
  });

  // ── TWINS: 0 or >1 candidates ⇒ today's behaviour, byte-for-byte the LLM route ──

  it('TWIN — the prior reply names TWO eligible referents → not claimed, the LLM is reached', async () => {
    mockedRecentRows = [
      priorAssistantTurn('Do you mean Sales Headcount Investment or Price? Which one should change?'),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.'),
    });
    expect(llmCallTracker.count).toBeGreaterThanOrEqual(1);
    expect(patchBlocks(JSON.parse(res.body))).toEqual([]);
  });

  it('TWIN — no prior assistant message at all → not claimed, the LLM is reached', async () => {
    mockedRecentRows = [];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.'),
    });
    expect(llmCallTracker.count).toBeGreaterThanOrEqual(1);
    expect(patchBlocks(JSON.parse(res.body))).toEqual([]);
  });

  it('TWIN — the prior reply names only an OUTCOME (ineligible kind) → not claimed, the LLM is reached', async () => {
    mockedRecentRows = [priorAssistantTurn('MRR Growth is the outcome most exposed here. Shall we look at it?')];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.'),
    });
    expect(llmCallTracker.count).toBeGreaterThanOrEqual(1);
    expect(patchBlocks(JSON.parse(res.body))).toEqual([]);
  });

  it('TWIN — a canvas selection of ANOTHER node withdraws the claim → the LLM is reached', async () => {
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.', ['fac_price']),
    });
    expect(llmCallTracker.count).toBeGreaterThanOrEqual(1);
    expect(patchBlocks(JSON.parse(res.body))).toEqual([]);
  });

  it('CONTRAST — selecting the bound node itself does not withdraw the claim', async () => {
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.', ['fac_shi']),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const patch = patchBlocks(JSON.parse(res.body))[0];
    expect(patch?.target_id).toBe('fac_shi');
  });

  it('TWIN — a value-less anaphoric edit ("Update it.") is NOT this path\'s: the executor never runs it and nothing is written', async () => {
    // Measured in this harness at this head: "Update it." is claimed by
    // route-v2's pre-LLM vague-edit intercept (`v5.edit_graph.intercepted_vague_edit`)
    // BEFORE the executor, so no `v5.deterministic_value_update` event exists
    // for the turn and the LLM is not reached either. What this twin pins is
    // the negative that matters here: no patch, no disclosure, and no
    // deterministic value-update claim on a value-less pronoun edit.
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update it.'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(patchBlocks(body)).toEqual([]);
    expect(String(body.assistant_text ?? '')).not.toContain('Taking that as');
    const preRoute = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRoute).toBeUndefined();
    expect(events.some((e) => e.event === 'v5.edit_graph.intercepted_vague_edit')).toBe(true);
  });

  // ── a bound OPTION: the executor's kind gate refuses, honestly and disclosed ──

  it('a bound OPTION ("Taking that as Outsource.") is refused by the kind gate, with the disclosure first and no write', async () => {
    mockedRecentRows = [
      priorAssistantTurn('I have not changed the model yet. Taking that as Outsource. What value would you like it set to?'),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Set it to £100,000.'),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    expect(patchBlocks(body)).toEqual([]);
    const text = String(body.assistant_text ?? '');
    const sentences = text.split(/(?<=[.?!])\s+/);
    expect(sentences[0]).toBe('Taking that as Outsource.');
    expect(text).toMatch(/Outsource is an option, not a factor/);
    const preRoute = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRoute?.data.dispatch).toBe('refuse_non_factor_kind');
  });

  // ── a VALUE-ONLY reply: ask naming the candidate, never apply ──

  it('"100000" after the bound reply → ASKS naming Sales Headcount Investment, chip carries the value, pending persisted, no write, no LLM', async () => {
    mockedRecentRows = [priorAssistantTurn(PRIOR_BOUND_REPLY)];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('100000'),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    expect(patchBlocks(body)).toEqual([]);
    expect(String(body.assistant_text)).toContain('Sales Headcount Investment');
    expect(String(body.assistant_text)).toContain('?');
    const chips = (body.suggested_actions ?? []) as Array<{ id: string; label: string; message: string }>;
    expect(chips.map((c) => c.id)).toEqual(['chip_clarify_factor_0']);
    expect(chips[0]?.message).toBe('Set Sales Headcount Investment to 100,000.');
    const preRoute = events.find((e) => e.event === 'v5.deterministic_value_update');
    expect(preRoute?.data.dispatch).toBe('clarify');
    // The pending the chip resumes names the bound factor by id.
    const writes = JSON.stringify(appendCalls);
    expect(writes).toContain('"factor_id":"fac_shi"');
  });

  it('EXPOSURE, pinned — a bare quantity answering a question that was NOT a value question, when the prior reply named exactly one factor, is ASKED about that factor (no write, no LLM)', async () => {
    // This path cannot see which question the number answers; the register
    // precondition (one eligible candidate in the last assistant message) is
    // the only gate the spec names. The outcome is a question that writes
    // nothing and a pending that resumes only on an explicit confirm or chip.
    // Pinned so the exposure is visible in the suite rather than discovered.
    mockedRecentRows = [
      priorAssistantTurn('Price is the factor your analysis is most sensitive to. How confident are you in that?'),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('50%'),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    expect(patchBlocks(body)).toEqual([]);
    expect(String(body.assistant_text)).toContain('Price');
    expect(String(body.assistant_text)).toContain('?');
    const chips = (body.suggested_actions ?? []) as Array<{ id: string; message: string }>;
    expect(chips.map((c) => c.id)).toEqual(['chip_clarify_factor_0']);
    expect(chips[0]?.message).toBe('Set Price to 50%.');
  });

  it('TWIN — "100000" with no prior assistant message → not claimed, the LLM is reached', async () => {
    mockedRecentRows = [];
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('100000'),
    });
    expect(llmCallTracker.count).toBeGreaterThanOrEqual(1);
  });
});
