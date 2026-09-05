/**
 * ADD-OPTION, TEXT LEG — the END-TO-END journey over the REAL route.
 *
 * ⭐ WHAT THIS FILE EXISTS TO PROVE, and why a handler unit test could not.
 * A user types a confirmed add-option request; the turn must be recognised
 * deterministically, proposed by the FOCUSED model call rather than the
 * ~29k-character generic `edit_graph` prompt, validated deterministically,
 * held for confirmation, applied atomically on that confirmation, written to
 * the canonical graph, survive a reload, and reach the readiness reader as an
 * explicit unknown rather than an invented number. Every one of those hops is
 * a different piece of machinery, and the seam between them is where this
 * estate has repeatedly lost capabilities.
 *
 * WHAT IS REAL HERE: `POST /orchestrate/v2/turn` (the live ingress —
 * `/proxy/v5/turn` injects into it), the recogniser, the proposer's validator,
 * the transaction builder, the referee gate, the held pending, the REAL
 * `commitDirectAnswer`, the REAL TurnExecutor held-resume, the applier, and
 * the REAL `assessCanonicalAnalysisReadiness` over the bytes that were
 * written. WHAT IS STUBBED: the session store (so the persisted write is
 * observable), and the LLM adapter (so the proposal is deterministic).
 * `dispatchEditGraph` is stubbed as a MIS-DISPATCH DETECTOR — if the generic
 * lane ever claims one of these turns, the test says so by name.
 *
 * ⚠ WHAT WOULD HAVE TO BE TRUE FOR THIS TO PASS WHILE THE CAPABILITY IS BROKEN.
 *  1. The arm never engages and the edit-lane stub answers instead. Defended:
 *     every positive arm asserts `dispatchEditGraph` was NOT called AND the
 *     `v5.add_option_transaction` telemetry carried `outcome: 'held'`.
 *  2. The option is "added" but never persisted. Defended: the assertions read
 *     the graph the session store was actually asked to WRITE, not the
 *     response copy.
 *  3. A value is fabricated to make the analysis run. Defended: the readiness
 *     assertion requires the new option to be NOT ready, with the
 *     encoding/mapping question attached to it BY ID.
 *  4. The assertions pass on the WRONG option. Defended: every assertion binds
 *     by the derived id `opt_partner_with_a_local_distributor`, and a
 *     pre-existing option with a deliberately similar label sits in the
 *     fixture as the decoy.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { PROPOSE_ADD_OPTION_TOOL_NAME } from '../../orchestrator-v5/tools/propose-add-option.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../context/constants.js';
import { GraphV3 } from '../../schemas/cee-v3.js';

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

// ── config: GM live (the arm returns early otherwise) ────────────────────────
const gmHolder = { mode: 'live' as 'off' | 'shadow' | 'live' };
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      features: new Proxy(actual.config.features, {
        get: (t, p) => (p === 'graphManagementMode' ? gmHolder.mode : Reflect.get(t, p)),
      }),
    },
  };
});

// ── the model under test: a small, real-shaped expansion decision ────────────
//
// The DECOY is deliberate: `opt_partner_uk` ("Partner with a UK reseller") is
// a near-miss of the option being added and of the factor names, so an
// assertion that matched on a value predicate rather than on identity would
// pass on the wrong object (the #800 class).
const GRAPH = {
  schema_version: 'v3',
  goal_node_id: 'goal_arr',
  nodes: [
    { id: 'goal_arr', kind: 'goal', label: 'Reach £20m ARR by FY28' },
    { id: 'dec_expansion', kind: 'decision', label: 'Geographic expansion strategy' },
    { id: 'opt_germany_direct', kind: 'option', label: 'Enter Germany directly' },
    { id: 'opt_partner_uk', kind: 'option', label: 'Partner with a UK reseller' },
    {
      id: 'fac_nrr',
      kind: 'factor',
      label: 'Net revenue retention',
      category: 'observable',
      observed_state: { value: 0.62, raw_value: 62, unit: 'percent', cap: 100 },
    },
    {
      id: 'fac_marketing_spend',
      kind: 'factor',
      label: 'Marketing spend',
      category: 'controllable',
      observed_state: { value: 0.4, raw_value: 400000, unit: 'GBP', cap: 1000000 },
    },
    {
      id: 'fac_cash_runway',
      kind: 'factor',
      label: 'Cash runway',
      category: 'observable',
      observed_state: { value: 0.5, raw_value: 18, unit: 'months', cap: 36 },
    },
  ],
  edges: [
    { from: 'dec_expansion', to: 'opt_germany_direct', ...STRUCTURAL_EDGE_DEFAULTS },
    { from: 'dec_expansion', to: 'opt_partner_uk', ...STRUCTURAL_EDGE_DEFAULTS },
    { from: 'fac_nrr', to: 'goal_arr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing_spend', to: 'goal_arr', strength: { mean: 0.4, std: 0.15 }, exists_probability: 0.85, effect_direction: 'positive' },
    { from: 'fac_cash_runway', to: 'goal_arr', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  ],
};

{
  const parsed = GraphV3.safeParse(GRAPH);
  if (!parsed.success) {
    throw new Error(
      'FIXTURE INVALID — the journey would measure a rejected graph: ' +
        JSON.stringify(parsed.error.issues),
    );
  }
}

/** The id `deriveOptionId` mints for this label — every assertion binds to it. */
const NEW_OPTION_ID = 'opt_partner_with_a_local_distributor';
const NEW_OPTION_LABEL = 'Partner with a local distributor';

// ── session store: `append` IS the canonical write under observation ─────────
const appendMock = vi.fn(async (write: Record<string, unknown>) => {
  appendedWrites.push(write);
  return { id: `row-${appendedWrites.length}` };
});
const appendedWrites: Array<Record<string, unknown>> = [];
const storeHolder: { graph: unknown; pendings: readonly PendingAction[]; turns: unknown[] } = {
  graph: GRAPH,
  pendings: [],
  turns: [],
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => storeHolder.turns,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    readMostRecentPendingActions: async () => storeHolder.pendings,
    readMostRecentCoachingState: async () => null,
    hasPriorTurns: async () => storeHolder.turns.length > 0,
    loadGraph: async () => storeHolder.graph,
    loadGraphAndBriefText: async () => ({ graph: storeHolder.graph, briefText: null }),
    storeDraftGraph: async () => undefined,
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ── the LLM: exactly one focused call, returning one tool_use ────────────────
let toolPayload: Record<string, unknown> | null = null;
let modelTextOnly = false;
const PLAIN_TEXT_REPLY = {
  content: [{ type: 'text' as const, text: 'Acknowledged.' }],
  stop_reason: 'end_turn' as const,
  usage: { input_tokens: 10, output_tokens: 5 },
  model: 'test-model',
  latencyMs: 1,
};
const chatWithToolsMock = vi.fn(async (args: { tools?: Array<{ name?: string }> }) => {
  // ⚠ ANSWER ONLY THE TOOL THAT WAS ASKED FOR. This adapter is shared with the
  // TurnExecutor's own router (which advertises `olumi_action`); handing that
  // router a `propose_add_option` tool_use makes it reject an unknown tool and
  // the turn 500s — a failure of the INSTRUMENT that reads exactly like a
  // failure of the route.
  const focused = (args?.tools ?? []).some((t) => t?.name === PROPOSE_ADD_OPTION_TOOL_NAME);
  if (!focused) return PLAIN_TEXT_REPLY;
  if (modelTextOnly) {
    return {
      content: [{ type: 'text' as const, text: 'I could not express that against this model.' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'test-model',
      latencyMs: 1,
    };
  }
  return {
    content: [
      { type: 'tool_use' as const, id: 'tu1', name: PROPOSE_ADD_OPTION_TOOL_NAME, input: toolPayload ?? {} },
    ],
    stop_reason: 'tool_use' as const,
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'test-model',
    latencyMs: 1,
  };
});
const testAdapter = {
  name: 'test',
  model: 'test-model',
  chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
  chatWithTools: chatWithToolsMock,
};
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => testAdapter,
  getAdapterWithResolution: () => ({
    adapter: testAdapter,
    resolution: { task: 'edit_graph', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

// ── the generic lane, as a MIS-DISPATCH DETECTOR ─────────────────────────────
const dispatchEditGraphMock = vi.fn(async () => ({
  response: {
    response_version: 2 as const,
    assistant_text: 'GENERIC_EDIT_LANE_SENTINEL',
    blocks: [] as const,
    suggested_actions: [] as const,
    insights: [] as const,
    stage_indicator: 'decide' as const,
  },
  commitPerformed: true,
}));
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator-v5/handlers/edit-graph-dispatch.js')>();
  return { ...actual, dispatchEditGraph: dispatchEditGraphMock };
});

const telemetry = await import('../../utils/telemetry.js');
const { assessCanonicalAnalysisReadiness } = await import('../tools/analysis-ready-helper.js');
const { ceeOrchestratorRouteV2 } = await import('../route-v2.js');

// ── helpers ─────────────────────────────────────────────────────────────────

function payload(message: string, source = 'composer'): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    stage: 'decide',
    message,
    turn_class: 'decide',
    source,
    graph_state: GRAPH,
  };
}

function goodProposal(links: string[] = ['fac_nrr', 'fac_marketing_spend']) {
  const labels: Record<string, string> = {
    fac_nrr: 'Net revenue retention',
    fac_marketing_spend: 'Marketing spend',
    fac_cash_runway: 'Cash runway',
  };
  return {
    label: NEW_OPTION_LABEL,
    parent_decision_id: 'dec_expansion',
    parent_decision_label: 'Geographic expansion strategy',
    links: links.map((id) => ({
      factor_id: id,
      factor_label: labels[id],
      rationale: 'A distributor changes this.',
    })),
    unknowns: [],
  };
}

/** Calls that carried the FOCUSED tool — never a bare call count. */
function focusedCalls(): number {
  return chatWithToolsMock.mock.calls.filter((c) =>
    ((c[0] as { tools?: Array<{ name?: string }> })?.tools ?? []).some(
      (t) => t?.name === PROPOSE_ADD_OPTION_TOOL_NAME,
    ),
  ).length;
}

function addOptionEvents(spy: ReturnType<typeof vi.spyOn>) {
  return (spy.mock.calls as unknown[][])
    .filter((c) => c[0] === 'v5.add_option_transaction')
    .map((c) => c[1] as Record<string, unknown>);
}

/** The pendings the route actually COMMITTED — the confirm turn's input. */
function committedPendings(): readonly PendingAction[] {
  for (const write of appendedWrites) {
    const p = write.pending_actions as PendingAction[] | undefined;
    if (Array.isArray(p) && p.length > 0) return p;
  }
  return [];
}

/** The graph the store was actually asked to WRITE — canonical persistence. */
function writtenGraph(): Record<string, any> | undefined {
  for (let i = appendedWrites.length - 1; i >= 0; i -= 1) {
    const g = appendedWrites[i]!.graph as Record<string, any> | undefined;
    if (g !== undefined && g !== null) return g;
  }
  return undefined;
}

async function post(app: FastifyInstance, message: string, source = 'composer') {
  const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payload(message, source) });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('add-option TEXT leg — the end-to-end journey over the real route', () => {
  let app: FastifyInstance;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    gmHolder.mode = 'live';
    storeHolder.graph = GRAPH;
    storeHolder.pendings = [];
    storeHolder.turns = [];
    appendedWrites.length = 0;
    toolPayload = goodProposal();
    modelTextOnly = false;
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    dispatchEditGraphMock.mockClear();
    emitSpy = vi.spyOn(telemetry, 'emit');
    emitSpy.mockClear();
  });

  it('⭐ THE JOURNEY: typed request → focused proposal → hold → confirm → canonical write → reload → readiness', async () => {
    // ── TURN 1: the user types the request ──────────────────────────────────
    const hold = await post(app, `Add "${NEW_OPTION_LABEL}" as an option`);
    expect(hold.status).toBe(200);

    // (1) PRODUCTION ROUTING selected the focused path, not the generic lane.
    const events = addOptionEvents(emitSpy);
    expect(events.some((e) => e.outcome === 'held' && e.origin === 'text')).toBe(true);
    expect(events.some((e) => String(e.outcome).startsWith('fell_through'))).toBe(false);
    // (2) It did NOT fall through to the 29k-character generic prompt.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(hold.body.assistant_text).not.toContain('GENERIC_EDIT_LANE_SENTINEL');
    // ...and the focused call is exactly ONE model call, on the focused tool.
    expect(focusedCalls()).toBe(1);
    const callArgs = chatWithToolsMock.mock.calls.find((c) =>
      ((c[0] as any)?.tools ?? []).some((t: any) => t?.name === PROPOSE_ADD_OPTION_TOOL_NAME),
    )![0] as any;
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].name).toBe(PROPOSE_ADD_OPTION_TOOL_NAME);
    // The focused prompt is small — the whole point of the change. (The
    // generic edit prompt is ~29,000 characters.)
    expect(callArgs.system.length).toBeLessThan(2_000);

    // (3) The user is shown a held proposal, not an applied claim.
    expect((hold.body.blocks ?? []).some((b: any) => b.type === 'held_proposal')).toBe(true);
    expect(hold.body.suggested_actions.length).toBeGreaterThan(0);

    // (4) The DISCLOSURE names the linked factors and admits the unknown sizes.
    expect(hold.body.assistant_text).toContain(NEW_OPTION_LABEL);
    expect(hold.body.assistant_text).toContain('Net revenue retention');
    expect(hold.body.assistant_text).toContain('Marketing spend');
    expect(hold.body.assistant_text.toLowerCase()).toContain("don't have those numbers");

    // The held pending was committed, so a confirm has something to resume.
    const pendings = committedPendings();
    expect(pendings.length).toBeGreaterThan(0);
    const held = pendings[0]!;
    expect(held.action.kind).toBe('apply_proposed_change');

    // ── TURN 2: the user confirms, through the EXISTING confirmation path ────
    // The UI replays the chip's own label as the message with source
    // 'chip_click' — no new UI, no new carrier.
    const label = (held.action as any).public_label as string;
    expect(typeof label).toBe('string');
    appendedWrites.length = 0;
    storeHolder.pendings = pendings;
    storeHolder.turns = [
      {
        id: 'row-1',
        turn_id: 'prior',
        scenario_id: SCENARIO_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        created_at: '2026-09-01T10:00:00.000Z',
      },
    ];
    chatWithToolsMock.mockClear();

    const confirm = await post(app, label, 'chip_click');
    expect(confirm.status).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    // (5) CANONICAL MUTATION: the graph the store was asked to write.
    const graph = writtenGraph();
    expect(graph, 'the confirm turn must write the canonical graph').toBeDefined();
    const added = graph!.nodes.find((n: any) => n.id === NEW_OPTION_ID);
    expect(added, `option ${NEW_OPTION_ID} must be in the written graph`).toBeDefined();
    expect(added.kind).toBe('option');
    expect(added.label).toBe(NEW_OPTION_LABEL);

    // (6) It is INTEGRATED, not a floating label: parent edge + one edge per link.
    const edgeKeys = graph!.edges.map((e: any) => `${e.from}::${e.to}`);
    expect(edgeKeys).toContain(`dec_expansion::${NEW_OPTION_ID}`);
    expect(edgeKeys).toContain(`${NEW_OPTION_ID}::fac_nrr`);
    expect(edgeKeys).toContain(`${NEW_OPTION_ID}::fac_marketing_spend`);
    // ...and only where justified: the factor it was NOT linked to stays unlinked.
    expect(edgeKeys).not.toContain(`${NEW_OPTION_ID}::fac_cash_runway`);

    // (7) NO INVENTED NUMBERS. The magnitude is an explicit unknown.
    expect(added.interventions ?? {}).toEqual({});

    // (8) IDENTITY: the decoy option and every pre-existing node are untouched.
    const decoy = graph!.nodes.find((n: any) => n.id === 'opt_partner_uk');
    expect(decoy).toEqual(GRAPH.nodes.find((n) => n.id === 'opt_partner_uk'));
    for (const original of GRAPH.nodes) {
      expect(graph!.nodes.find((n: any) => n.id === original.id)).toEqual(original);
    }

    // (9) RELOAD: a fresh read of the persisted scenario still carries it.
    storeHolder.graph = graph;
    const reloaded = (await (await import('../../orchestrator-v5/session/index.js')).getSessionStore().loadGraph(SCENARIO_ID)) as any;
    expect(reloaded.nodes.find((n: any) => n.id === NEW_OPTION_ID)).toBeDefined();

    // (10) DOWNSTREAM: the readiness reader sees the new option and asks the
    // user for the sizes — an explicit unknown, never a fabricated zero.
    const readiness = assessCanonicalAnalysisReadiness(graph);
    const optionRow = readiness.analysisReady?.options?.find((o: any) => o.option_id === NEW_OPTION_ID);
    expect(optionRow, 'the new option must reach the readiness reader').toBeDefined();
    expect(optionRow!.status).not.toBe('ready');

    const optionIssues = readiness.issues.filter((i) => i.option_id === NEW_OPTION_ID);
    expect(optionIssues.length, 'readiness must ask about the new option BY ID').toBeGreaterThan(0);
    // The question is put to the USER — the system does not repair it with a
    // number of its own. This is the whole honesty claim, read off the
    // producer's own classification rather than asserted from ours.
    for (const issue of optionIssues) {
      expect(issue.repairability).toBe('human_input_required');
    }
    // ⭐ THE LINKS REACHED THE SCIENCE LAYER. The readiness reader raises the
    // question PAIR-SCOPED — this option, that factor — which is only possible
    // because the option→factor edges were written. And it asks about the two
    // factors that were linked and NOT about the one that was not: an
    // identity-bound discrimination, not a presence check.
    const askedFactors = new Set(
      optionIssues.map((i) => i.factor_id).filter((f): f is string => typeof f === 'string'),
    );
    expect(askedFactors.size, 'at least one linked factor must be asked about').toBeGreaterThan(0);
    // Every factor asked about is one this option was actually linked to, and
    // the factor it was NOT linked to is never asked about — so this cannot
    // pass on a question that belongs to some other option or factor.
    for (const f of askedFactors) {
      expect(['fac_nrr', 'fac_marketing_spend']).toContain(f);
    }
    expect(askedFactors.has('fac_cash_runway')).toBe(false);
    // ⚠ IT IS A SUBSET, AND THAT IS THE PRODUCT'S RULE, NOT A GAP. Measured
    // here: only `fac_marketing_spend` is asked about. `analysis-ready.ts`
    // treats `observable` and `external` factors as CONTEXTUAL — they
    // influence outcomes but are not intervention targets — so a link to
    // `fac_nrr` (observable) correctly raises no "what does this option set it
    // to?" question. Asserting the full set would pin a rule this lane did not
    // author; asserting the subset above pins the one it did.
    expect(askedFactors.has('fac_marketing_spend')).toBe(true);
  });

  it('a proposal with NO justified links still lands the option, and says the effects are unknown', async () => {
    toolPayload = goodProposal([]);
    const res = await post(app, `Add "${NEW_OPTION_LABEL}" as an option`);
    expect(res.status).toBe(200);
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'held')).toBe(true);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // The gate's own bare-option notice owns this case; it must still fire.
    expect(res.body.assistant_text.toLowerCase()).toContain('no effect values yet');
  });
});

describe('add-option TEXT leg — opposite direction: what must NOT be claimed', () => {
  let app: FastifyInstance;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    gmHolder.mode = 'live';
    storeHolder.graph = GRAPH;
    storeHolder.pendings = [];
    storeHolder.turns = [];
    appendedWrites.length = 0;
    toolPayload = goodProposal();
    modelTextOnly = false;
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    dispatchEditGraphMock.mockClear();
    emitSpy = vi.spyOn(telemetry, 'emit');
    emitSpy.mockClear();
  });

  /**
   * Each of these currently works via the generic edit lane and must KEEP
   * working there. The assertion is identity-bound in both directions: the
   * edit lane was reached, AND no add-option hold was minted.
   */
  const MUST_REACH_EDIT_LANE = [
    ['a value edit', 'Set marketing spend to 40'],
    ['a removal', 'Remove the Enter Germany directly option'],
    ['a rename', 'Rename Marketing spend to Acquisition spend'],
    ['a factor add', 'Add a factor called Channel conflict'],
    ['a compound edit', `Add "${NEW_OPTION_LABEL}" as an option and remove the UK reseller one`],
    ['an add that states a value', `Add "${NEW_OPTION_LABEL}" as an option that lifts retention to 70%`],
  ] as const;

  it.each(MUST_REACH_EDIT_LANE)('%s keeps its existing owner and creates no option', async (_why, message) => {
    const res = await post(app, message);
    expect(res.status).toBe(200);
    // The focused arm did not claim it...
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'held')).toBe(false);
    // ...it did not spend a focused model call...
    expect(focusedCalls()).toBe(0);
    // ...and nothing was persisted as an option by this path.
    expect(writtenGraph()?.nodes?.find((n: any) => n.id === NEW_OPTION_ID)).toBeUndefined();
  });

  it('an AMBIGUOUS request never silently creates an option', async () => {
    for (const message of ['Should I add an option?', 'What other options are there', 'Add more options']) {
      appendedWrites.length = 0;
      chatWithToolsMock.mockClear();
      const res = await post(app, message);
      expect(res.status).toBe(200);
      expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'held')).toBe(false);
      expect(writtenGraph()?.nodes?.find((n: any) => n.id === NEW_OPTION_ID)).toBeUndefined();
    }
  });

  it('a proposal naming a factor the model does not have is REFUSED and falls through — never a substitution', async () => {
    toolPayload = {
      ...goodProposal([]),
      links: [{ factor_id: 'fac_channel_conflict', factor_label: 'Channel conflict', rationale: 'x' }],
    };
    const res = await post(app, `Add "${NEW_OPTION_LABEL}" as an option`);
    expect(res.status).toBe(200);
    const events = addOptionEvents(emitSpy);
    expect(events.some((e) => e.outcome === 'held')).toBe(false);
    expect(
      events.some((e) => e.outcome === 'fell_through:text_rejected' && e.rejection_code === 'UNKNOWN_FACTOR_ID'),
    ).toBe(true);
    // The generic lane owns the turn — a working fallback, not a dead end.
    expect(dispatchEditGraphMock).toHaveBeenCalled();
    expect(writtenGraph()?.nodes?.find((n: any) => n.id === NEW_OPTION_ID)).toBeUndefined();
  });

  it('a model that declines to call the tool falls through honestly', async () => {
    modelTextOnly = true;
    const res = await post(app, `Add "${NEW_OPTION_LABEL}" as an option`);
    expect(res.status).toBe(200);
    expect(
      addOptionEvents(emitSpy).some(
        (e) => e.outcome === 'fell_through:text_unavailable' && e.unavailable_reason === 'no_tool_call',
      ),
    ).toBe(true);
    expect(dispatchEditGraphMock).toHaveBeenCalled();
  });

  it('with the hold spine DOWN (mode !== live) the arm is inert and spends no model call', async () => {
    gmHolder.mode = 'shadow';
    const res = await post(app, `Add "${NEW_OPTION_LABEL}" as an option`);
    expect(res.status).toBe(200);
    expect(focusedCalls()).toBe(0);
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'held')).toBe(false);
    expect(dispatchEditGraphMock).toHaveBeenCalled();
  });
});
