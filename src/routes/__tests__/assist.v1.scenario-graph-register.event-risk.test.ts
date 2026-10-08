/**
 * ⭐ event_risk.v1 (Science 393023 pilot §4; lane EVENT-RISK, DL 0fd71f, 7 Oct 2026): a risk that MAY HAPPEN within
 * a horizon survives the register write, every model writer's re-parse, and the Run loader's parse, so it reaches the
 * /v2/run payload unchanged. A malformed block is REFUSED at the door (422 EVENT_RISK_INVALID), never written.
 *
 * RED on base d738949c: CEE's `NodeV3` is a plain `z.object` that STRIPS undeclared keys, so `GraphV3.safeParse` (the
 * Run loader, build-turn-context.ts, and every model writer) deleted the block. The user's "may happen (5–15%)" then
 * ran as an ordinary node, and nothing refused a malformed one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const SCENARIO = 'c8d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});

const { logWarn, emitFn } = vi.hoisted(() => ({ logWarn: vi.fn(), emitFn: vi.fn() }));
vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn() },
    emit: emitFn,
  };
});

const append = vi.fn();
const loadGraph = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const scenarioExists = vi.fn();
const readCommittedTurn = vi.fn();
const readMostRecentPendingActions = vi.fn();
const store = { append, loadGraph, ensureScenarioExists, getScenarioOwner, scenarioExists, readCommittedTurn, readMostRecentPendingActions };
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
}));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { eventRiskIngressIssues } from '../../schemas/event-risk.js';
import { sentDigest } from '../../orchestrator-v5/tools/handlers/run-input-snapshot.js';
import { eventRiskConstructionBasisTextFor, runWithEventRiskConstruction } from '../../orchestrator-v5/agent-lane/event-risk-construction-context.js';

type Rec = Record<string, unknown>;
const EVENT_RISK = {
  version: 1,
  occurrence: { p_low: 0.05, p_high: 0.15, basis: 'user' },
  horizon: { months: 12 },
  mitigations: [{ factor_id: 'fac_dual_source', occurrence_reduction: 0.7 }],
};
const m = EVENT_RISK.mitigations[0];
const graphWith = (eventRisk?: unknown, onKind = 'risk') => ({
  goal_node_id: 'gross_profit',
  nodes: [
    { id: 'gross_profit', kind: 'goal', label: 'Gross profit', observed_state: { value: 0.8, baseline: 0.8 } },
    { id: 'risk_supplier', kind: onKind, label: 'Key supplier fails', ...(eventRisk === undefined ? {} : { event_risk: eventRisk }) },
    { id: 'dec_supply', kind: 'decision', label: 'How to source' },
    { id: 'fac_dual_source', kind: 'factor', label: 'Dual sourcing in place', category: 'controllable', observed_state: { value: 0 } },
    { id: 'opt_now', kind: 'option', label: 'Status quo', is_baseline: true, interventions: { fac_dual_source: 0 } },
    { id: 'opt_dual', kind: 'option', label: 'Dual-source', interventions: { fac_dual_source: 1 } },
  ],
  edges: [
    { from: 'fac_dual_source', to: 'risk_supplier', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    { from: 'risk_supplier', to: 'gross_profit', strength: { mean: -0.4, std: 0.01 }, exists_probability: 1, effect_direction: 'negative' },
    { from: 'dec_supply', to: 'opt_now', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_supply', to: 'opt_dual', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_now', to: 'fac_dual_source', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_dual', to: 'fac_dual_source', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
});

async function register(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  await app.close();
  return res;
}
const written = () => (append.mock.calls[0]![0] as Rec).graph as Rec;
const node = (g: Rec, id: string) => (g.nodes as Rec[]).find((n) => n.id === id)!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  loadGraph.mockResolvedValue(null);
  append.mockResolvedValue({ id: 'turn-1' });
  readCommittedTurn.mockResolvedValue(null);
  readMostRecentPendingActions.mockResolvedValue([]);
});

describe('event_risk.v1 — carried from the write door to the Run payload', () => {
  it('⭐ the written graph and its persisted read keep `event_risk` verbatim', async () => {
    const res = await register(graphWith(EVENT_RISK));
    expect(res.statusCode, res.body).toBe(200);
    expect(node(projectGraphForPersistence(written() as never) as Rec, 'risk_supplier').event_risk).toEqual(EVENT_RISK);
  });

  it("RED: the Run loader's / every writer's parse (`GraphV3`) keeps it, and the /v2/run payload carries it once", async () => {
    const res = await register(graphWith(EVENT_RISK));
    expect(res.statusCode, res.body).toBe(200);
    const parsed = GraphV3.safeParse(projectGraphForPersistence(written() as never));
    expect(parsed.success).toBe(true);
    const graph = (parsed as { data: Rec }).data;
    expect(node(graph, 'risk_supplier').event_risk).toEqual(EVENT_RISK);
    const payload = { graph, options: [], goal_node_id: 'gross_profit', request_id: 'r-1' };
    expect((JSON.stringify(payload).match(/"event_risk"/g) ?? []).length).toBe(1);
  });

  it('CONTROL (legacy): a graph with no block parses with no `event_risk` key anywhere, and its sent_digest is the one it had', () => {
    const raw = graphWith();
    const parsed = GraphV3.parse(raw) as unknown as Rec;
    for (const n of parsed.nodes as Rec[]) expect('event_risk' in n).toBe(false);
    const asLoaded = { graph: parsed, options: [], goal_node_id: 'gross_profit', request_id: 'r-1' };
    const withBlock = { ...asLoaded, graph: GraphV3.parse(graphWith(EVENT_RISK)) };
    // Contrast in the same run: the block moves the digest, so the probe can see a difference.
    expect(sentDigest(withBlock as Rec)).not.toBe(sentDigest(asLoaded as Rec));
  });

  it('a block malformed ON READ is dropped by the parse, never a reason to make the stored graph unreadable', () => {
    const parsed = GraphV3.safeParse(graphWith({ ...EVENT_RISK, version: 2 }));
    expect(parsed.success).toBe(true);
    expect(node((parsed as { data: Rec }).data, 'risk_supplier').event_risk).toBeUndefined();
  });
});

describe('event_risk.v1 — the write door refuses what it cannot carry (422 EVENT_RISK_INVALID; nothing written)', () => {
  it.each([
    ['p_low above p_high', { ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, p_low: 0.2 } }, 'risk', 'event_risk.occurrence.p_low'],
    ['an unknown key', { ...EVENT_RISK, likelihood: 0.1 }, 'risk', 'event_risk'],
    ['version 2', { ...EVENT_RISK, version: 2 }, 'risk', 'event_risk.version'],
    ['no horizon', { ...EVENT_RISK, horizon: undefined }, 'risk', 'event_risk.horizon'],
    ['a reduction above 1', { ...EVENT_RISK, mitigations: [{ factor_id: 'fac_dual_source', occurrence_reduction: 1.5 }] }, 'risk', 'event_risk.mitigations.0.occurrence_reduction'],
    ['a factor named twice', { ...EVENT_RISK, mitigations: [m, m] }, 'risk', 'event_risk.mitigations'],
    ['a malformed factor id', { ...EVENT_RISK, mitigations: [{ factor_id: 'Dual Source', occurrence_reduction: 0.7 }] }, 'risk', 'event_risk.mitigations.0.factor_id'],
    ['on a factor node', EVENT_RISK, 'factor', 'event_risk'],
  ])('%s', async (_label, block, kind, path) => {
    const issues = eventRiskIngressIssues(graphWith(block, kind).nodes as Rec[]);
    expect(issues.map((i) => i.path)).toContain(path);
    const res = await register(graphWith(block, kind));
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('EVENT_RISK_INVALID');
    expect(append).not.toHaveBeenCalled();
  });

  it('CONTROL: a valid block and a graph with none both pass the door', () => {
    expect(eventRiskIngressIssues(graphWith(EVENT_RISK).nodes as Rec[])).toEqual([]);
    expect(eventRiskIngressIssues(graphWith().nodes as Rec[])).toEqual([]);
  });
});

describe('FIX-1: CEE-only occurrence basis text at client ingress', () => {
  it('snapshots the admitted occurrence so callback mutation cannot change the grant', async () => {
    const eventRisk = { ...EVENT_RISK, horizon: { ...EVENT_RISK.horizon }, occurrence: { ...EVENT_RISK.occurrence, basis: 'olumi' } };
    const graph = graphWith(eventRisk);
    Object.assign(graph.nodes[1]!, { event_risk_basis_text: 'CEE admitted reference class' });
    await runWithEventRiskConstruction(SCENARIO, graph, async () => {
      expect(eventRiskConstructionBasisTextFor(SCENARIO, graph.nodes[1]!)).toBe('CEE admitted reference class');
      eventRisk.horizon.months = 6;
      expect(eventRiskConstructionBasisTextFor(SCENARIO, graph.nodes[1]!)).toBeUndefined();
    });
    expect(eventRiskConstructionBasisTextFor(SCENARIO, graph.nodes[1]!)).toBeUndefined();
  });

  it('closes the construction grant even for async work inherited before completion', async () => {
    const graph = graphWith({ ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, basis: 'olumi' } });
    Object.assign(graph.nodes[1]!, { event_risk_basis_text: 'CEE admitted reference class' });
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let inherited!: Promise<string | undefined>;
    await runWithEventRiskConstruction(SCENARIO, graph, async () => {
      inherited = gate.then(() => eventRiskConstructionBasisTextFor(SCENARIO, graph.nodes[1]!));
      expect(eventRiskConstructionBasisTextFor(SCENARIO, graph.nodes[1]!)).toBe('CEE admitted reference class');
    });
    resume();
    expect(await inherited).toBeUndefined();
  });

  it.each(['user', 'olumi'])('strips client-supplied sidecar even beside a valid %s occurrence', async (basis) => {
    const eventRisk = { ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, basis } };
    const graph = graphWith(eventRisk);
    Object.assign(graph.nodes[1]!, { event_risk_basis_text: 'Client supplied fabricated basis' });
    const res = await register(graph);
    expect(res.statusCode, res.body).toBe(200);
    const risk = node(written(), 'risk_supplier');
    expect(risk.event_risk).toEqual(eventRisk);
    expect(risk.event_risk_basis_text).toBeUndefined();
  });

  it('strips an orphan client sidecar before it can be stored or displayed', async () => {
    const graph = graphWith();
    Object.assign(graph.nodes[1]!, { event_risk_basis_text: 'Client supplied orphan basis' });
    const res = await register(graph);
    expect(res.statusCode, res.body).toBe(200);
    expect(node(written(), 'risk_supplier').event_risk_basis_text).toBeUndefined();
  });

  it('preserves CEE-admitted Olumi text through the same real registration route', async () => {
    const eventRisk = { ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, basis: 'olumi' } };
    const graph = graphWith(eventRisk);
    Object.assign(graph.nodes[1]!, { event_risk_basis_text: 'CEE admitted reference class' });
    const res = await runWithEventRiskConstruction(SCENARIO, graph, () => register(graph));
    expect(res.statusCode, res.body).toBe(200);
    expect(node(written(), 'risk_supplier').event_risk_basis_text).toBe('CEE admitted reference class');
  });

  it.each(['scenario', 'occurrence', 'text', 'node'])('cannot reuse CEE context for a different %s', async (mismatch) => {
    const eventRisk = { ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, basis: 'olumi' } };
    const graph = graphWith(eventRisk);
    Object.assign(graph.nodes[1]!, { event_risk_basis_text: 'CEE admitted reference class' });
    const submitted = structuredClone(graph);
    if (mismatch === 'occurrence') Object.assign(submitted.nodes[1]!, { event_risk: { ...eventRisk, horizon: { months: 6 } } });
    if (mismatch === 'text') Object.assign(submitted.nodes[1]!, { event_risk_basis_text: 'Client replacement' });
    if (mismatch === 'node') {
      Object.assign(submitted.nodes[1]!, { id: 'different_risk' });
      for (const edge of submitted.edges) {
        if (edge.from === 'risk_supplier') edge.from = 'different_risk';
        if (edge.to === 'risk_supplier') edge.to = 'different_risk';
      }
    }
    const res = await runWithEventRiskConstruction(mismatch === 'scenario' ? 'another-scenario' : SCENARIO, graph, () => register(submitted));
    expect(res.statusCode, res.body).toBe(200);
    expect((written().nodes as Rec[]).find((n) => n.kind === 'risk')?.event_risk_basis_text).toBeUndefined();
  });

  it.each(['omitted', 'replaced'])('retains trusted stored basis for an unchanged Olumi occurrence when client text is %s', async (state) => {
    const eventRisk = { ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, basis: 'olumi' } };
    const stored = graphWith(eventRisk);
    Object.assign(stored.nodes[1]!, { event_risk_basis_text: 'Stored CEE reference class' });
    loadGraph.mockResolvedValue(stored);
    const submitted = graphWith(eventRisk);
    if (state === 'replaced') Object.assign(submitted.nodes[1]!, { event_risk_basis_text: 'Client replacement' });
    const res = await register(submitted);
    expect(res.statusCode, res.body).toBe(200);
    expect(node(written(), 'risk_supplier').event_risk_basis_text).toBe('Stored CEE reference class');
  });

  it('clears stored Olumi text when the occurrence is converted to the user basis', async () => {
    const stored = graphWith({ ...EVENT_RISK, occurrence: { ...EVENT_RISK.occurrence, basis: 'olumi' } });
    Object.assign(stored.nodes[1]!, { event_risk_basis_text: 'Stored CEE reference class' });
    loadGraph.mockResolvedValue(stored);
    const res = await register(graphWith(EVENT_RISK));
    expect(res.statusCode, res.body).toBe(200);
    expect(node(written(), 'risk_supplier').event_risk).toEqual(EVENT_RISK);
    expect(node(written(), 'risk_supplier').event_risk_basis_text).toBeUndefined();
  });
});
