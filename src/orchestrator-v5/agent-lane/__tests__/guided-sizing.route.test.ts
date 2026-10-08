/** Guided sizing through the real Agent reply and its existing link-effect approval door. */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ActionSchema } from '@talchain/schemas/boundary';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { placeholderGoalPaths, placeholderGoalWarning } from '../goal-certainty.js';
import { targetNotTestableWarning, targetTestabilityOf } from '../../admission/target-testability.js';

type Json = Record<string, any>;
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-draw2.json', import.meta.url), 'utf8')) as Json;
let SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c44';
const CODE = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const WORDS = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Pro plan price’ affects ‘MRR lost to price sensitivity’, how strongly ‘Monthly churn’ affects ‘Paying Pro subscribers’ or how strongly ‘Pro plan price’ affects ‘Monthly churn’, so any figure would be a guess. Give a rough strength for each to see the chance.";
const PROGRESS = '2 more to go.';
const LEVEL_ASK = "What's today's level of MRR?";
const PAIRS = [
  ['monthly_churn', 'paying_pro_subscribers'],
  ['pro_plan_price', 'mrr_lost_to_price_sensitivity'],
  ['pro_plan_price', 'monthly_churn'],
] as const;
// The warning's acceptable list is the sole tie order; generated variants list loss before churn.
const ORDERED_PAIRS = [PAIRS[1], PAIRS[0], PAIRS[2]] as const;
const pressId = (from: string, to: string) => `agent-size-link:${encodeURIComponent(from)}:${encodeURIComponent(to)}`;
const label = (from: string, to: string) => `How strongly does ‘${from}’ affect ‘${to}’?`;
const rows = new Map<string, Json>();
const pending = new Map<string, unknown[]>();
let graph: Json;
let result: Json;
let analysisState: Json;
let recent: Json[] = [];
const scripts: Json[] = [];
const modelBodies: string[] = [];
const doorCalls: Json[] = [];
const linkDoorEntries: Json[] = [];
let runCalls = 0;
let omitGraphHash = false;
let graphHashOverride: string | undefined;
// DGAI's pinned @talchain/schemas 0.81.0 boundary rejects an extra key on ANY action.
// ActionSchema and ActionType are byte-identical in P02's 0.81.0 and CEE's 0.82.0 installs.
const WireAction = ActionSchema;
const wirePresses = (body: Json): Json[] => body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-size-link:'));
const assertWireActions = (body: Json): void => {
  for (const action of body.suggested_actions) expect(WireAction.safeParse(action), JSON.stringify(action)).toMatchObject({ success: true });
  for (const press of wirePresses(body)) expect(Object.keys(press).sort()).toEqual(['id', 'label', 'message']);
};

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return (pending.get(sid) ?? []).map(parsePendingAction).filter((x) => x !== null);
  }),
  readRecent: vi.fn(async () => recent),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: Json) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return { id: prior.id, replayedPriorTurn: true as const };
    const row = { id: `row-${rows.size}`, turn_id: w.turn_id, request_hash: w.request_hash,
      assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null };
    rows.set(w.turn_id, row);
    if (!w.turn_id.endsWith(':claim')) pending.set(w.scenario_id, structuredClone(w.pending_actions ?? []));
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
// Observe the real capability's input, then run it unchanged: opening a sizing question supplies no user figure.
vi.mock('../runtime/agent-capabilities.js', async (original) => {
  const actual = await original<typeof import('../runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...input: Parameters<typeof actual.createAgentCapabilities>) => {
    const capabilities = actual.createAgentCapabilities(...input);
    const proposeLinkEffect = capabilities.proposeLinkEffect!;
    return { ...capabilities, proposeLinkEffect: async (...args: Parameters<typeof proposeLinkEffect>) => {
      linkDoorEntries.push({ grounded_selection: args[0].grounded_selection, grounded_links: args[0].grounded_links,
        user_turn_text: args[0].user_turn_text, from_label: args[1].from_label, to_label: args[1].to_label });
      return proposeLinkEffect(...args);
    } };
  } };
});
vi.mock('../../system-events/dispatch.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  commitOptionLevelsInProcess: async (input: Json) => {
    doorCalls.push(input);
    const { applyLinkEffectEdit } = await import('../../system-events/link-effect-edit.js');
    const e = input.link_effect;
    const edited = applyLinkEffectEdit({ persistedGraph: structuredClone(graph), from: e.from, to: e.to,
      effect: e.effect, quote: e.quote, reading_token: e.reading_token,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: e.edge_token },
      ...(e.unit_readings !== undefined ? { unit_readings: e.unit_readings } : {}),
      ...(e.reversal !== undefined ? { reversal: e.reversal } : {}),
      ...(e.link_selected === true ? { link_selected: true } : {}),
    });
    if (edited.kind !== 'mutated') throw new Error(`real link-effect writer refused fixture: ${JSON.stringify(edited)}`);
    graph = edited.mutatedGraph as Json;
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never), receipt: null,
      already_applied: false, committed_levels: [], links_resized: [] };
  },
}));

function fixture(three = true): void {
  graph = structuredClone(FIXTURE.graph);
  result = structuredClone(FIXTURE.analysis_result);
  analysisState = structuredClone(FIXTURE.analysis_state);
  if (three) {
    const edge = graph.edges.find((e: Json) => e.from === PAIRS[2][0] && e.to === PAIRS[2][1]);
    edge.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true };
    edge.defaulted = true;
    const warning = placeholderGoalWarning(graph,
      placeholderGoalPaths(graph, ['raise_pro_price_to_59'], [{ node_id: 'mrr', evaluated: true }]), CODE);
    result.enrichment.inference_warnings = result.enrichment.inference_warnings.map((w: Json) => w.code === CODE ? warning : w);
  }
}

describe('GUIDED PATH reply wiring and the existing sizing commit door', () => {
  let app: FastifyInstance;
  const say = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is the reading for your approval.' }] }] };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = String(init?.body ?? '');
      modelBodies.push(body);
      return new Response(JSON.stringify(body.includes('"propose_link_effect"') ? (scripts.shift() ?? say) : say), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    const read = () => ({ graph, ...(!omitGraphHash ? { graph_hash: graphHashOverride ?? computeAnalysisAffectingGraphHash(graph as never) } : {}),
      analysis_state: analysisState, analysis_ready: FIXTURE.analysis_ready, analysis_result: result,
      analysis_identity_evaluated_node_ids: ['mrr'], analysis_goal_certainty: [] });
    app.post('/assist/v1/scenarios/:id/graph', async () => read());
    app.post('/orchestrate/v2/turn', async () => {
      runCalls += 1;
      result.computed_against_hash = computeAnalysisAffectingGraphHash(graph as never);
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
        ...(!omitGraphHash ? { graph_hash: read().graph_hash } : {}), blocks: [result], analysis_ready: FIXTURE.analysis_ready, analysis_state: analysisState };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    // The real process proposal store survives requests; independent rows own distinct scenarios.
    SCENARIO = randomUUID();
    fixture(); rows.clear(); pending.clear(); recent = []; scripts.length = 0; modelBodies.length = 0; doorCalls.length = 0; linkDoorEntries.length = 0; runCalls = 0; omitGraphHash = false; graphHashOverride = undefined;
  });
  const turn = async (message: string, extra: Json = {}): Promise<Json> => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, agent_session_id: `sess_${SCENARIO}`, turn_id: randomUUID(), message, ...extra,
    } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as Json;
    assertWireActions(body);
    return body;
  };
  const run = (extra: Json = {}) => turn('Run analysis', { source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, ...extra });

  it('DRAW-2 three-placeholder variant: exact words, unchanged level ask, 3 directness-ordered identity presses and root hook', async () => {
    const body = await run();
    expect(body.assistant_text).toContain(LEVEL_ASK);
    expect(body.assistant_text).not.toContain('Give a rough strength');
    const presses = body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-size-link:'));
    const nodeLabel = (id: string) => graph.nodes.find((n: Json) => n.id === id).label;
    expect(presses.map((c: Json) => ({ id: c.id, label: c.label }))).toEqual(ORDERED_PAIRS.map(([from, to]) => ({
      id: pressId(from, to), label: label(nodeLabel(from), nodeLabel(to)),
    })));
    expect(body.guided_sizing).toEqual({ v: 1, total: 3,
      graph_hash: body.graph_hash, run_key: body.narration.run_key,
      links: ORDERED_PAIRS.map(([from, to], order) => ({
      from, to, from_label: nodeLabel(from), to_label: nodeLabel(to), order,
      press: { id: presses[order].id, parameters: { from, to } },
    })) });
    expect(body.graph_hash).toMatch(/^[0-9a-f]{16}$/u);
    expect(body.guided_sizing.graph_hash).toBe(body.graph_hash);
    expect(Object.keys(body.guided_sizing).sort()).toEqual(['graph_hash', 'links', 'run_key', 'total', 'v']);
    for (const link of body.guided_sizing.links) expect(Object.keys(link).sort()).toEqual(['from', 'from_label', 'order', 'press', 'to', 'to_label']);
    expect(JSON.stringify(body.guided_sizing)).not.toMatch(/"(?:nodes|edges|operations|strength|graph|patch)"/u);
  });

  it('original served capture: ONE warning owns N=2, despite the target prose naming 3', async () => {
    SCENARIO = FIXTURE.capture.scenario_id;
    fixture(false);
    const body = await run();
    expect(body.assistant_text).toContain(LEVEL_ASK);
    expect(body.assistant_text).not.toContain('Give a rough strength');
    expect(body.guided_sizing.total).toBe(2);
    expect(body.graph_hash).toMatch(/^[0-9a-f]{16}$/u);
    expect(body.guided_sizing.graph_hash).toBe(body.graph_hash);
    expect(body.guided_sizing.run_key).toBe('861eaaa775233b0f');
    expect(body.guided_sizing.run_key).toBe(body.narration.run_key);
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-size-link:')).map((c: Json) => c.id))
      .toEqual(PAIRS.slice(0, 2).map(([from, to]) => pressId(from, to)));
  });

  it('P02 strict wire contract: every suggested action parses; a leaked parameters mutant rejects the whole list', async () => {
    const body = await run();
    expect(z.array(WireAction).safeParse(body.suggested_actions)).toMatchObject({ success: true });
    const press = wirePresses(body)[0]!;
    const leaked = body.suggested_actions.map((action: Json) => action.id === press.id
      ? { ...action, parameters: body.guided_sizing.links[0].press.parameters } : action);
    expect(z.array(WireAction).safeParse(leaked), 'RED mutant: one extra action key rejects the entire turn action list')
      .toMatchObject({ success: false });
    for (const link of body.guided_sizing.links) {
      expect(link.press.parameters).toEqual({ from: link.from, to: link.to });
      expect(Object.keys(body.suggested_actions.find((action: Json) => action.id === link.press.id)).sort())
        .toEqual(['id', 'label', 'message']);
    }
  });

  it('P02 missing top-level graph_hash: guided_sizing fails closed despite an otherwise usable stored Run', async () => {
    omitGraphHash = true;
    const body = await run();
    expect(body.graph_hash).toBeUndefined();
    expect(body.guided_sizing).toBeUndefined();
  });

  it.each(['not-a-graph-hash', '0123456789abcdef0123456789abcdef'])('P02 malformed graph_hash %s cannot bind a guided_sizing hook', async (hash) => {
    graphHashOverride = hash;
    const body = await run();
    expect(body.guided_sizing).toBeUndefined();
  });

  it('P02 graph identity mutant: a hook using another valid 16-hex token fails the byte-for-byte route invariant', async () => {
    const body = await run();
    const routeHashInvariant = (candidate: Json): void => {
      expect(candidate.graph_hash).toMatch(/^[0-9a-f]{16}$/u);
      expect(candidate.guided_sizing.graph_hash).toBe(candidate.graph_hash);
    };
    routeHashInvariant(body);
    const otherHash = body.graph_hash === '0000000000000000' ? '1111111111111111' : '0000000000000000';
    const mutant = { ...body, guided_sizing: { ...body.guided_sizing, graph_hash: otherHash } };
    expect(() => routeHashInvariant(mutant), 'RED mutant: valid shape, wrong token').toThrow();
  });

  it('DL 3b: derived level present, no TARGET_NOT_TESTABLE: guided words and presses alone', async () => {
    graph.nodes.find((n: Json) => n.id === 'mrr').observed_state = { value: 9800, raw_value: 9800, unit: '£/month' };
    result.enrichment.inference_warnings = result.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    const body = await run();
    expect(body.assistant_text).toContain(WORDS);
    expect(body.assistant_text).not.toContain("What's today's level");
    expect(body.guided_sizing.links).toHaveLength(3);
  });

  it('stored edge ids reach the inspector parameters and hook presses unchanged', async () => {
    for (let i = 0; i < PAIRS.length; i++) {
      const [from, to] = PAIRS[i]!;
      graph.edges.find((e: Json) => e.from === from && e.to === to).id = `held-edge-${i}`;
    }
    const body = await run();
    expect(body.guided_sizing.graph_hash).toBe(body.graph_hash);
    expect(body.guided_sizing.run_key).toBe(body.narration.run_key);
    for (const link of body.guided_sizing.links) {
      const press = body.suggested_actions.find((p: Json) => p.id === link.press.id);
      expect(link.press).toEqual({ id: press.id, parameters: { from: link.from, to: link.to, edge_id: link.id } });
      expect(press.parameters).toBeUndefined();
      expect(link.id).toMatch(/^held-edge-/u);
      const selected = await turn(press.message, { source: 'chip', chip: { id: press.id } });
      expect(selected._grounded_selection).toEqual({ element_ids: [], unresolved: 'none' });
      expect(selected._agent.tool_calls.some((c: Json) => c.mutated)).toBe(false);
    }
  });

  it('one acceptable list survives a second warning list dropping a link', async () => {
    const warning = result.enrichment.inference_warnings.find((w: Json) => w.code === CODE);
    warning.links = warning.links.slice(0, 2);
    expect(warning.acceptable_links).toHaveLength(3);
    const body = await run();
    expect(body.guided_sizing.total).toBe(3);
    expect(body.guided_sizing.links.map((l: Json) => [l.from, l.to])).toEqual(ORDERED_PAIRS.map(pair => [...pair]));
  });

  it('typed Run replay preserves the same hook and identity presses without another Run', async () => {
    const turnId = randomUUID();
    const first = await run({ turn_id: turnId });
    const calls = runCalls;
    const replay = await run({ turn_id: turnId });
    expect(first.guided_sizing.total).toBe(3);
    expect(replay.guided_sizing).toEqual(first.guided_sizing);
    const presses = (body: Json) => body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-size-link:'));
    expect(replay.assistant_text).toBe(first.assistant_text);
    expect(presses(replay)).toEqual(presses(first));
    expect(runCalls).toBe(calls);
  });

  it('stale Explain A live and replay cannot expose current Run B guided hook or presses', async () => {
    const runA = await run();
    const explainA = runA.suggested_actions.find((action: Json) => action.id.startsWith('agent-explain-run:'));
    expect(explainA).toBeDefined();
    // A newer fact for the same graph changes only the selected Run's typed timestamp identity.
    analysisState.run_state.computed_at = '2026-10-08T05:00:00.000Z';
    result.computed_at = '2026-10-08T05:00:00.000Z';
    const turnId = randomUUID();
    const press = () => turn(explainA.message, { source: 'chip', chip: { id: explainA.id }, turn_id: turnId });
    const unavailable = await press();
    const replay = await press();
    for (const body of [unavailable, replay]) {
      expect(body.assistant_text).toContain('I can’t explain that result as current. Check the current results before asking again.');
      expect(body.guided_sizing).toBeUndefined();
      expect(body.suggested_actions.some((action: Json) => action.id.startsWith('agent-size-link:'))).toBe(false);
    }
  });

  it('a producer warning with 4 path links survives finalisation with every press and N=4', async () => {
    graph.nodes.push({ id: 'additional_revenue_driver', label: 'Additional revenue driver', kind: 'factor',
      observed_state: { value: 1, unit: '£/month', raw_value: 1, source: 'user' } });
    graph.edges.push({ from: 'pro_plan_price', to: 'additional_revenue_driver', strength: { mean: 0.2, std: 0.01 },
      provenance: { source: 'user_specified', magnitude: 'user_stated' } });
    graph.edges.push({ from: 'additional_revenue_driver', to: 'mrr', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true }, defaulted: true });
    const warning = placeholderGoalWarning(graph,
      placeholderGoalPaths(graph, ['raise_pro_price_to_59'], [{ node_id: 'mrr', evaluated: true }]), CODE)!;
    expect(warning.links).toHaveLength(4);
    result.enrichment.inference_warnings = result.enrichment.inference_warnings.map((w: Json) => w.code === CODE ? warning : w);
    const body = await run();
    expect(body.assistant_text).toContain(LEVEL_ASK);
    expect(body.assistant_text).not.toContain('Give a rough strength');
    expect(body.guided_sizing.total).toBe(4);
    const expectedPairs = [['additional_revenue_driver', 'mrr'], ...ORDERED_PAIRS];
    expect(body.guided_sizing.links.map((link: Json) => [link.from, link.to])).toEqual(expectedPairs);
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-size-link:')).map((c: Json) => c.id))
      .toEqual(expectedPairs.map(([from, to]) => pressId(from!, to!)));
  });

  it('GP review P2: forged ingress edge_id cannot redirect a chip encoded for another pair', async () => {
    for (const edge of graph.edges) edge.id = `edge:${edge.from}:${edge.to}`;
    const body = await run();
    const press = wirePresses(body).find(p => p.id === pressId(...PAIRS[0]))!;
    const unrelated = graph.edges.find((e: Json) => e.from === PAIRS[1][0] && e.to === PAIRS[1][1]);
    modelBodies.length = 0;
    await turn(press.message, { source: 'chip', chip: { id: press.id,
      parameters: { from: PAIRS[0][0], to: PAIRS[0][1], edge_id: unrelated.id } } });
    const agentBody = modelBodies.find(b => b.includes('"propose_link_effect"'))!;
    const parsed = JSON.parse(agentBody);
    const selected = parsed.input.map((m: Json) => Array.isArray(m.content) ? m.content.map((c: Json) => c.text).join(' ') : m.content)
      .find((content: unknown) => typeof content === 'string' && content.includes('SELECTED ON THE CANVAS'));
    expect(selected).toContain(PAIRS[0][0]);
    expect(selected).toContain(PAIRS[0][1]);
    expect(selected).not.toContain(unrelated.id);
    expect(doorCalls).toHaveLength(0);
  });

  it('r9 chip RED: a stored arrow id on another same-labelled edge cannot redirect the encoded endpoint pair', async () => {
    const [from, to] = PAIRS[0];
    const source = graph.nodes.find((node: Json) => node.id === from);
    const target = graph.nodes.find((node: Json) => node.id === to);
    graph.nodes.push({ ...structuredClone(source), id: 'other_source' }, { ...structuredClone(target), id: 'other_target' });
    graph.edges.push({ id: `${from}->${to}`, from: 'other_source', to: 'other_target', strength: { mean: 0.5, std: 0.125 },
      provenance: { magnitude: 'olumi_placeholder' } });
    const read = await run();
    const press = wirePresses(read).find(action => action.id === pressId(from, to))!;
    expect(press).toBeDefined();
    scripts.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: randomUUID(), arguments: JSON.stringify({
      from_label: source.label, to_label: target.label, amount: -2, amount_unit: 'subscribers',
      per_source_change: 1, per_source_change_unit: 'percentage points', quote: press.message,
    }) }] });
    const opened = await turn(press.message, { source: 'chip', chip: { id: press.id } });
    expect(linkDoorEntries).toHaveLength(1);
    expect(linkDoorEntries[0].grounded_links).toEqual([{ from, to }]);
    expect(linkDoorEntries[0].grounded_selection).toEqual({ element_ids: [], unresolved: 'none' });
    expect(opened._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_link_effect', ok: false,
      mutated: false, refusal: 'quote_not_verbatim' })]);
    expect(doorCalls).toHaveLength(0);
  });

  it.each(['missing', 'ambiguous'])('r9 chip unresolved %s endpoint pair is refused before any ordinary model or door', async mismatch => {
    const read = await run();
    const press = wirePresses(read).find(action => action.id === pressId(...PAIRS[0]))!;
    const edge = graph.edges.find((e: Json) => e.from === PAIRS[0][0] && e.to === PAIRS[0][1]);
    if (mismatch === 'missing') graph.edges = graph.edges.filter((e: Json) => e !== edge);
    else graph.edges.push({ ...structuredClone(edge), id: 'another-same-endpoint-edge' });
    modelBodies.length = 0;
    const opened = await turn(press.message, { source: 'chip', chip: { id: press.id } });
    expect(modelBodies).toHaveLength(0);
    expect(linkDoorEntries).toHaveLength(0);
    expect(opened._agent.tool_calls).toEqual([]);
    expect(opened.assistant_text).toContain('That sizing could not be checked against the current model. Nothing was changed.');
  });

  it('a press binds its edge ids into canonical selection; labels do not select a different link', async () => {
    const body = await run();
    const press = body.suggested_actions.find((c: Json) => c.id === pressId(...PAIRS[0]));
    expect(press).toBeDefined();
    modelBodies.length = 0;
    await turn(press.message, { source: 'chip', chip: { id: press.id } });
    const agentBody = modelBodies.find((b) => b.includes('"propose_link_effect"'));
    expect(agentBody).toBeDefined();
    expect(agentBody).toContain('SELECTED ON THE CANVAS');
    expect(agentBody).toContain('monthly_churn');
    expect(agentBody).toContain('paying_pro_subscribers');
    expect(doorCalls, 'a sizing press asks; only an approved figure writes').toHaveLength(0);
  });

  it('a legacy label-only question cannot close a current endpoint press', async () => {
    recent = [{ turn_id: 'prior-ask', request_hash: 'agent_turn:prior-ask',
      assistant_message: 'How much does ‘Monthly churn’ change ‘Paying Pro subscribers’?' }];
    const body = await run();
    expect(body.suggested_actions.some((c: Json) => c.id === pressId(...PAIRS[0]))).toBe(true);
  });

  it.each([false, true])('N=0 conversion press survives final wire and respects its exact closed question (%s)', async closed => {
    fixture(false);
    // Explicit author variant: the two placeholder links have been sized; the existing price estimate is now a band.
    for (const [from, to] of PAIRS.slice(0, 2)) {
      const edge = graph.edges.find((e: Json) => e.from === from && e.to === to);
      edge.provenance = { source: 'user_specified', magnitude: 'user_stated' };
    }
    const band = graph.edges.find((e: Json) => e.from === PAIRS[2][0] && e.to === PAIRS[2][1]);
    delete band.provenance.natural_effect;
    const opts = graph.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => n.id);
    result.enrichment.inference_warnings = [targetNotTestableWarning(graph, targetTestabilityOf(graph), opts, 'GOAL_FIGURES_TARGET_NOT_TESTABLE')];
    const words = "How much does ‘Pro plan price’ change ‘Monthly churn’, in percentage points? Olumi has it as a band, which can't be turned into your goal's units.";
    if (closed) {
      const digest = createHash('sha256').update(`chip:${JSON.stringify([pressId(...PAIRS[2]), null])}`).digest('hex').slice(0, 32);
      recent = [{ turn_id: 'closed-band', request_hash: `agent_turn:closed-band#chip:${digest}`, assistant_message: words }];
    }
    const body = await run();
    expect(body.assistant_text).not.toContain("The chance isn't shown yet:");
    expect(body.guided_sizing.total).toBe(0);
    const presses = wirePresses(body);
    expect(presses.map(p => p.label)).toEqual(closed ? [] : [words]);
    expect(body.guided_sizing.links).toHaveLength(closed ? 0 : 1);
    if (!closed) {
      expect(body.guided_sizing.links[0]).toMatchObject({ from: PAIRS[2][0], to: PAIRS[2][1], nonconverting: true });
      scripts.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: randomUUID(), arguments: JSON.stringify({
        from_label: 'Pro plan price', to_label: 'Monthly churn', amount: 0.03, amount_unit: 'percentage points',
        per_source_change: 1, per_source_change_unit: '£/month', quote: presses[0]!.message,
      }) }] });
      await turn(presses[0]!.message, { source: 'chip', chip: { id: presses[0]!.id } });
      expect(linkDoorEntries.at(-1)?.grounded_links).toEqual([{ from: PAIRS[2][0], to: PAIRS[2][1] }]);
      expect(doorCalls).toHaveLength(0);
    }
  });

  const sizeThroughDoor = async (from: string, to: string, fromLabel: string, toLabel: string,
    amount: number, amountUnit: string, sourceUnit: string, words: string): Promise<Json> => {
    const writesBefore = doorCalls.length;
    scripts.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: randomUUID(), arguments: JSON.stringify({
      from_label: fromLabel, to_label: toLabel, amount, amount_unit: amountUnit,
      per_source_change: 1, per_source_change_unit: sourceUnit, quote: words,
    }) }] });
    const prepared = await turn(words, { selected_elements: { node_ids: [], edge_ids: [`${from}->${to}`] } });
    expect(prepared._agent.tool_calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'propose_link_effect', ok: true, mutated: false }),
    ]));
    const card = prepared.suggested_actions.find((c: Json) => c.id.startsWith('agent-approve-proposal:'));
    expect(card, JSON.stringify(prepared._agent)).toBeDefined();
    const approved = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(approved._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(doorCalls).toHaveLength(writesBefore + 1);
    expect(doorCalls[writesBefore].link_effect).toMatchObject({ from, to });
    return approved;
  };

  it('P02 chip.id + literal message alone reaches real propose_link_effect with the exact duplicate-label edge and records no figure', async () => {
    for (const id of PAIRS[0]) {
      const original = graph.nodes.find((node: Json) => node.id === id);
      graph.nodes.push({ ...structuredClone(original), id: `${id}_same_label` });
    }
    const read = await run();
    const press = read.suggested_actions.find((action: Json) => action.id === pressId(...PAIRS[0]));
    expect(press).toBeDefined();
    scripts.push({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: randomUUID(), arguments: JSON.stringify({
      from_label: 'Monthly churn', to_label: 'Paying Pro subscribers', amount: -2, amount_unit: 'subscribers',
      per_source_change: 1, per_source_change_unit: 'percentage points', quote: press.message,
    }) }] });
    const opened = await turn(press.message, { source: 'chip', chip: { id: press.id } });
    expect(opened._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_link_effect', ok: false,
      mutated: false, refusal: 'quote_not_verbatim' })]);
    expect(linkDoorEntries).toHaveLength(1);
    expect(linkDoorEntries[0].grounded_links).toEqual([expect.objectContaining({ from: 'monthly_churn', to: 'paying_pro_subscribers' })]);
    expect(linkDoorEntries[0].grounded_selection).toEqual({ element_ids: [], unresolved: 'none' });
    expect(linkDoorEntries[0].user_turn_text, 'a product question is not the user stating a figure').toBe('');
    expect(doorCalls).toHaveLength(0);
    expect(graph.edges.find((edge: Json) => edge.from === 'monthly_churn' && edge.to === 'paying_pro_subscribers').provenance.magnitude)
      .toBe('olumi_placeholder');
  });

  it('duplicate labels: a normal composer answer and selected edge prepare and size the original through the same door', async () => {
    for (const id of PAIRS[0]) {
      const original = graph.nodes.find((node: Json) => node.id === id);
      graph.nodes.push({ ...structuredClone(original), id: `${id}_same_label` });
    }
    const approved = await sizeThroughDoor('monthly_churn', 'paying_pro_subscribers', 'Monthly churn', 'Paying Pro subscribers',
      -2, 'subscribers', 'percentage points', 'Every 1 percentage point increase in Monthly churn loses 2 Paying Pro subscribers.');
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0].link_effect).toMatchObject({ from: 'monthly_churn', to: 'paying_pro_subscribers' });
    expect(JSON.stringify(approved._agent)).not.toContain('ambiguous_entity');
    expect(graph.edges.find((edge: Json) => edge.from === 'monthly_churn' && edge.to === 'paying_pro_subscribers').provenance)
      .toMatchObject({ magnitude: 'user_stated' });
    expect(graph.edges.some((edge: Json) => edge.from.endsWith('_same_label') || edge.to.endsWith('_same_label'))).toBe(false);
  });

  it('AFTER ONE: an actual link-effect approval commit reads the stored graph for M=2', async () => {
    const afterOne = await sizeThroughDoor('pro_plan_price', 'monthly_churn', 'Pro plan price', 'Monthly churn',
      0.03, 'percentage points', '£/month', 'Every £1 per month increase in Pro plan price increases Monthly churn by 0.03 percentage points.');
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0].link_effect).toMatchObject({ from: 'pro_plan_price', to: 'monthly_churn' });
    // R13 P1-3: the two offered sizing presses are the ONE ask for these same links.
    expect(afterOne.assistant_text.match(/a size for the links from|Roughly how much does/gu) ?? []).toHaveLength(0);
    expect(wirePresses(afterOne).map(p => p.id)).toEqual([
      pressId('monthly_churn', 'paying_pro_subscribers'),
      pressId('pro_plan_price', 'mrr_lost_to_price_sensitivity'),
    ]);
    expect(afterOne.assistant_text).toContain(PROGRESS);
    expect(afterOne.guided_sizing.remaining).toBe(2);
    expect(afterOne.guided_sizing.progress_line).toBe(PROGRESS);
    expect(afterOne.assistant_text.match(/\d+ more to go(?:; with 1 left, Olumi can show a range)?\./u)?.[0]).toBe(afterOne.guided_sizing.progress_line);
    expect(afterOne.graph_hash).toMatch(/^[0-9a-f]{16}$/u);
    expect(afterOne.guided_sizing.graph_hash).toBe(afterOne.graph_hash);
    for (const link of afterOne.guided_sizing.links) {
      const press = afterOne.suggested_actions.find((p: Json) => p.id === link.press.id);
      expect(link.press).toEqual({ id: press.id, parameters: { from: link.from, to: link.to } });
      expect(press.parameters).toBeUndefined();
    }
  });

  it('GP review P1: the approval door keeps M inside the selected Run when an excluded option has two other links', async () => {
    graph.nodes.push({ id: 'excluded', kind: 'option', label: 'Excluded option', interventions: { extra: { value: 2 } } },
      { id: 'extra', kind: 'factor', label: 'Excluded factor', observed_state: { value: 1, unit: '£/month' } },
      { id: 'extra2', kind: 'factor', label: 'Excluded factor 2', observed_state: { value: 1, unit: '£/month' } });
    graph.edges.push({ from: 'excluded', to: 'extra', exists_probability: 1, effect_direction: 'positive', strength: { mean: 1, std: 0.01 } },
      { from: 'extra', to: 'extra2', exists_probability: 1, effect_direction: 'positive', strength: { mean: 0.5, std: 0.125 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } },
      { from: 'extra2', to: 'mrr', exists_probability: 1, effect_direction: 'positive', strength: { mean: 0.5, std: 0.125 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    const afterOne = await sizeThroughDoor('pro_plan_price', 'monthly_churn', 'Pro plan price', 'Monthly churn',
      0.03, 'percentage points', '£/month', 'Every £1 per month increase in Pro plan price increases Monthly churn by 0.03 percentage points.');
    expect(afterOne.assistant_text).toContain(PROGRESS);
    expect(afterOne.assistant_text).not.toContain('4 more to go');
    expect(afterOne.guided_sizing.remaining).toBe(2);
    expect(afterOne.guided_sizing.links.some((l: Json) => l.from.startsWith('extra'))).toBe(false);
  });

  it('GP review P1: recorded same-label chip history closes only its exact directed edge', async () => {
    for (const n of graph.nodes) if (PAIRS.some(([f, t]) => f === n.id || t === n.id)) n.label = 'Same label';
    const first = await run();
    const pressed = wirePresses(first)[0]!;
    const opened = await turn(pressed.message, { source: 'chip', chip: { id: pressed.id } });
    const openedRow = [...rows.values()].find(row => row.assistant_message === opened.assistant_text)!;
    recent = [openedRow];
    const next = await run();
    expect(wirePresses(next).map(p => p.id)).toEqual(wirePresses(first).slice(1).map(p => p.id));
    expect(next.guided_sizing.links.map((l: Json) => l.press.id)).toEqual(wirePresses(next).map(p => p.id));
  });

  it('AFTER TWO: the independent M=1 row has no progress line after two actual approval commits', async () => {
    await sizeThroughDoor('pro_plan_price', 'monthly_churn', 'Pro plan price', 'Monthly churn',
      0.03, 'percentage points', '£/month', 'Every £1 per month increase in Pro plan price increases Monthly churn by 0.03 percentage points.');
    const afterTwo = await sizeThroughDoor('monthly_churn', 'paying_pro_subscribers', 'Monthly churn', 'Paying Pro subscribers',
      -2, 'subscribers', 'percentage points', 'Every 1 percentage point increase in Monthly churn loses 2 Paying Pro subscribers.');
    expect(doorCalls).toHaveLength(2);
    expect(afterTwo.assistant_text).not.toMatch(/more to go; with 1 left, Olumi can show a range/u);
    expect(afterTwo.guided_sizing).toBeUndefined();
  });

  it('CONTROL: no PLACEHOLDER_PATH produces no guided words, press or hook', async () => {
    result.enrichment.inference_warnings = result.enrichment.inference_warnings.filter((w: Json) => w.code !== CODE);
    const body = await run();
    expect(body.assistant_text).not.toContain("The chance isn't shown yet:");
    expect(body.suggested_actions.some((c: Json) => c.id.startsWith('agent-size-link:'))).toBe(false);
    expect(body.guided_sizing).toBeUndefined();
  });
});
