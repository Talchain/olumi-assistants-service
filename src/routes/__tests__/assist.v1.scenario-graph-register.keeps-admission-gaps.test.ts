/**
 * B3 joined registration regression — serialized offline route witness.
 * Round2 #2543 @481e14e1: a whole-graph replacement drops every gap carrier,
 * so an unstamped legacy Run resurrects FRESH without an approved clearance.
 * Real Fastify route, persisted projection, ingress read, freshness and Compare.
 * The JSON store double proves only offline write/readback; no RPC/provider claim.
 * Reuses the existing version/result fixtures; all saved Runs below are CONTROLS.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});
vi.mock('../../utils/telemetry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/telemetry.js')>()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
}));
const append = vi.fn(); const loadGraph = vi.fn();
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(),
  scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity,
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { GraphStateIngressSchema } from '../../orchestrator-v5/boundary/request-extensions.js';
import { assignEntityRefs } from '../../orchestrator-v5/graph/entity-refs.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { deriveAnalysisFreshness, selectRunAnalysisFact } from '../../orchestrator-v5/context/freshness.js';
import { RUN_ANALYSIS_PROJECTION_KEY, stampRunAnalysisProjection } from '../../orchestrator-v5/context/analysis-projection-policy.js';
import { bindVersionResults } from '../../orchestrator-v5/model-management/version-result-binding.js';
import { FIX_SCENARIO, versionRecord } from '../../orchestrator-v5/model-management/__tests__/fixtures.js';
import { FROM, factSet, savedRun } from '../../orchestrator-v5/model-management/__tests__/version-result-fixtures.js';

type Rec = Record<string, unknown>;
type Row = Rec & { id: string };
type Graph = Rec & { nodes: Row[]; edges: Rec[]; options?: Row[] };
type Stored = { graph: Graph; facts: HandlerFact[]; write?: Rec };
const OPTION = 'opt-a'; // Existing fixture's Price intervention; opt-b is untouched.
const GAP = { unresolved_targets: ['billable_seat_basis'], user_questions: ['Which subscriptions are billable on this basis?'] };
const PLACEMENTS = [
  { name: 'node', node: true, mirror: false },
  { name: 'mirror', node: false, mirror: true },
  { name: 'both', node: true, mirror: true },
] as const;
let persistedJson: string;
const doc = (): Stored => JSON.parse(persistedJson) as Stored;
const node = (g: Graph): Row => g.nodes.find(n => n.id === OPTION)!;
const mirror = (g: Graph): Row | undefined => g.options?.find(o => o.id === OPTION);
function withoutGaps(g: Graph): Graph {
  const out = structuredClone(g);
  for (const row of [...out.nodes, ...(out.options ?? [])]) {
    delete row.unresolved_targets; delete row.user_questions;
  }
  return out;
}
function graphs(p: typeof PLACEMENTS[number]): { clean: Graph; held: Graph } {
  const graph = structuredClone(FROM.graph) as unknown as Graph;
  delete graph.options;
  if (p.mirror) graph.options = graph.nodes.filter(n => n.kind === 'option').map(n => ({
    id: n.id, label: n.label, status: 'ready', interventions: structuredClone(n.interventions),
  }));
  const clean = assignEntityRefs(projectGraphForPersistence(graph), null).graph;
  const held = structuredClone(clean);
  if (p.node) Object.assign(node(held), structuredClone(GAP));
  if (p.mirror) Object.assign(mirror(held)!, structuredClone(GAP));
  return { clean, held };
}
function legacyRun(clean: Graph, held: Graph, id: string, snapshot: 'absent' | 'noncontradicting'): HandlerFact {
  const fact = savedRun(versionRecord(clean as never), id, '2026-10-03T00:00:00.000Z');
  const result = (fact as unknown as { result: Rec }).result;
  result.graph_hash_at_run = computeAnalysisAffectingGraphHash(held as never, 'legacy');
  delete (result.enrichment as Rec)[RUN_ANALYSIS_PROJECTION_KEY];
  if (snapshot === 'absent') delete result.input_snapshot;
  return fact;
}
const freshness = (graph: Graph, facts: HandlerFact[]) => deriveAnalysisFreshness(facts,
  computeAnalysisAffectingGraphHash(graph as never), undefined, { priorFactsReadOk: true, currentGraph: graph });
const option = (graph: Graph) => buildCanonicalAnalysisReadyFromGraph(graph)!.options.find(o => o.option_id === OPTION)!;
async function register(graph: Graph) {
  const app = Fastify();
  await registerRoute(app); await app.ready();
  try { return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${FIX_SCENARIO}/graph/register`, payload: { graph } }); }
  finally { await app.close(); }
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null); store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null); store.readMostRecentPendingActions.mockResolvedValue([]);
  loadGraph.mockImplementation(async () => doc().graph);
  append.mockImplementation(async (write: Rec) => {
    const prior = doc();
    // The route supplies the real persisted projection; serialization removes
    // every object reference, including pre-register process memory.
    persistedJson = JSON.stringify({ graph: write.graph, facts: [...(write.handler_facts as HandlerFact[]), ...prior.facts], write });
    return { id: 'b3-registration-control-row' };
  });
});

describe('whole-graph registration cannot erase admission evidence and resurrect an old Run', () => {
  for (const p of PLACEMENTS) for (const snapshot of ['absent', 'noncontradicting'] as const) {
    it(`${p.name} carriers, ${snapshot} legacy snapshot: omission preserves the question through cold read and Compare`, async () => {
      const { clean, held } = graphs(p);
      const legacyId = `b3-register-legacy-${p.name}-${snapshot}`;
      const legacy = legacyRun(clean, held, legacyId, snapshot);
      expect(withoutGaps(held)).toEqual(clean);
      expect(projectGraphForPersistence(held)).toEqual(held);
      expect(option(held).status).not.toBe('ready');
      expect(freshness(held, [legacy]).freshness).toBe('stale');
      expect((legacy as unknown as { result: Rec }).result.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(clean as never));
      persistedJson = JSON.stringify({ graph: held, facts: [legacy] });

      // Actual supported whole-graph replacement: same IDs/values/status, both
      // gap keys omitted everywhere, no clearance proposal or approved batch.
      const res = await register(withoutGaps(held));
      expect(res.statusCode, res.body).toBe(200); expect(append).toHaveBeenCalledTimes(1);
      const written = doc().graph;
      expect(withoutGaps(written)).toEqual(clean);
      if (p.node) expect(node(written)).toMatchObject(GAP);
      if (p.mirror) expect(mirror(written)).toMatchObject(GAP);
      if (!p.mirror) expect(written.options).toBeUndefined();
      expect(res.json().graph_hash).toBe(computeAnalysisAffectingGraphHash(written as never));
      expect(doc().write!.scenario_id).toBe(FIX_SCENARIO);

      // Real ingress parse after a serialized store reload must retain BOTH
      // existing field carriers, not merely leave them on the writer candidate.
      const cold = GraphStateIngressSchema.parse(await store.loadGraph(FIX_SCENARIO)) as unknown as Graph;
      expect(cold).toEqual(written);
      expect(option(cold).status).not.toBe('ready');
      const reloadedFacts = doc().facts;
      expect(reloadedFacts).toEqual([legacy]);
      expect((selectRunAnalysisFact(reloadedFacts)!.fact as unknown as { result: Rec }).result.run_id).toBe(legacyId);
      expect(freshness(cold, reloadedFacts).freshness).toBe('stale');

      // Historical legacy compatibility is distinct from current freshness.
      // A later stamped gap-free Run must never bind to the held version.
      const clearVersion = versionRecord(clean as never);
      const heldVersion = versionRecord(cold as never, { id: '33333333-3333-4333-8333-333333333333' });
      const currentId = `b3-register-current-${p.name}-${snapshot}`;
      const current = savedRun(clearVersion, currentId, '2026-10-03T01:00:00.000Z');
      const result = (current as unknown as { result: Rec }).result;
      result.enrichment = stampRunAnalysisProjection(result.enrichment as Rec);
      for (const reverse of [false, true]) {
        const bound = bindVersionResults({ scenarioId: FIX_SCENARIO,
          from: reverse ? clearVersion : heldVersion, to: reverse ? heldVersion : clearVersion,
          factSet: factSet([current, ...reloadedFacts]) });
        expect(bound.kind).toBe('unavailable'); // Unstamped gaps cannot attest their version identity.
      }
    });
  }

  for (const omitted of ['array', 'row'] as const) it(`omitting the mirror ${omitted} retains its admission evidence`, async () => {
    const { held } = graphs(PLACEMENTS[1]); const legacy = legacyRun(held, held, `mirror-${omitted}`, 'absent');
    persistedJson = JSON.stringify({ graph: held, facts: [legacy] });
    const incoming = withoutGaps(held);
    if (omitted === 'array') delete incoming.options;
    else incoming.options = incoming.options!.filter(o => o.id !== OPTION);
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(200); expect(append).toHaveBeenCalledTimes(1);
    expect(mirror(doc().graph)).toMatchObject(GAP);
    expect(option(doc().graph).status).not.toBe('ready');
    expect(freshness(doc().graph, doc().facts).freshness).toBe('stale');
  });

  it('mirror-array omission does not resurrect a different option the caller removed', async () => {
    const { held } = graphs(PLACEMENTS[1]); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const incoming = withoutGaps(held); delete incoming.options;
    incoming.nodes = incoming.nodes.filter(n => n.kind !== 'option' || n.id === OPTION);
    const ids = new Set(incoming.nodes.map(n => n.id));
    incoming.edges = incoming.edges.filter(e => ids.has(String(e.from)) && ids.has(String(e.to)));
    const res = await register(incoming); expect(res.statusCode, res.body).toBe(200);
    expect(doc().graph.options!.map(o => o.id)).toEqual([OPTION]);
    expect(mirror(doc().graph)).toMatchObject(GAP);
  });

  for (const p of PLACEMENTS) it(`${p.name}: explicit clearance is not approved by whole-graph registration`, async () => {
    const { held } = graphs(p); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const bytes = persistedJson; const incoming = structuredClone(held);
    for (const row of [node(incoming), mirror(incoming)].filter((r): r is Row => r !== undefined)) {
      if (Object.hasOwn(row, 'unresolved_targets')) row.unresolved_targets = [];
      if (Object.hasOwn(row, 'user_questions')) row.user_questions = [];
    }
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(409); expect(res.json().details.code).toBe('OPTION_GAP_APPROVAL_REQUIRED');
    expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
  });

  it('a question-only replacement also needs approval although the analytical hash is unchanged', async () => {
    const { held } = graphs(PLACEMENTS[1]); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const bytes = persistedJson; const incoming = structuredClone(held);
    mirror(incoming)!.user_questions = ['A replacement question'];
    expect(computeAnalysisAffectingGraphHash(incoming as never)).toBe(computeAnalysisAffectingGraphHash(held as never));
    const res = await register(incoming); expect(res.statusCode, res.body).toBe(409);
    expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
  });

  it('CONTROL: a truly gap-free legacy Run remains fresh after unchanged registration', async () => {
    const { clean } = graphs(PLACEMENTS[0]);
    const legacy = legacyRun(clean, clean, 'b3-register-genuinely-gap-free', 'noncontradicting');
    persistedJson = JSON.stringify({ graph: clean, facts: [legacy] });
    expect(freshness(clean, [legacy]).freshness).toBe('fresh');
    const res = await register(clean); expect(res.statusCode, res.body).toBe(200);
    const cold = GraphStateIngressSchema.parse(await loadGraph(FIX_SCENARIO)) as unknown as Graph;
    expect(freshness(cold, doc().facts).freshness).toBe('fresh');
    const v = versionRecord(cold as never);
    const bound = bindVersionResults({ scenarioId: FIX_SCENARIO, from: v, to: v, factSet: factSet(doc().facts) });
    expect(bound).toMatchObject({ kind: 'shared', recordedRun: { run_id: 'b3-register-genuinely-gap-free' } });
  });

  // Mutant: return incoming rows from withStoredOptionGapsWhenUnstated.
  it.each(['', '   ', undefined, null, 42, false, {}])('refuses an unusable active mirror label (%j) before append', async label => {
    const { held } = graphs(PLACEMENTS[1]); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const bytes = persistedJson; const incoming = withoutGaps(held);
    if (label === undefined) delete mirror(incoming)!.label;
    else mirror(incoming)!.label = label;
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(409); expect(res.json().details.code).toBe('OPTION_GAP_APPROVAL_REQUIRED');
    expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
  });

  it.each(['nodes', 'options'] as const)('refuses a whitespace id alias on the active %s target', async carrier => {
    const { held } = graphs(PLACEMENTS[1]); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const bytes = persistedJson; const incoming = withoutGaps(held);
    incoming[carrier]!.find(row => row.id === OPTION)!.id = ` ${OPTION} `;
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(409); expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
  });

  // Mutant: do not copy node gap fields in optionEntryFromNode / the registration carrier.
  it.each(['explicit', 'empty array'] as const)('creating a READY mirror via %s preserves an active node gap', async how => {
    const { held } = graphs(PLACEMENTS[0]); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const incoming = withoutGaps(held);
    incoming.options = how === 'empty array' ? [] : incoming.nodes.filter(n => n.kind === 'option').map(n => ({
      id: n.id, label: n.label, status: 'ready', interventions: structuredClone(n.interventions),
    }));
    const res = await register(incoming); expect(res.statusCode, res.body).toBe(200);
    expect(mirror(doc().graph)).toMatchObject(GAP); expect(option(doc().graph).status).toBe('needs_user_mapping');
    const cold = GraphStateIngressSchema.parse(doc().graph) as unknown as Graph;
    expect(option(cold).status).toBe('needs_user_mapping');
  });

  it.each(['baseline', 'kind'] as const)('refuses unapproved admission change by %s', async change => {
    const { held } = graphs(PLACEMENTS[2]); persistedJson = JSON.stringify({ graph: held, facts: [] });
    const bytes = persistedJson; const incoming = withoutGaps(held);
    if (change === 'baseline') mirror(incoming)!.is_baseline = true;
    else node(incoming).kind = 'factor';
    const res = await register(incoming); expect(res.statusCode, res.body).toBe(409);
    expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
  });

  // Mutant: restore duplicate-match early return (unchecked incoming rows).
  for (const carrier of ['nodes', 'options'] as const) for (const side of ['stored', 'incoming'] as const) {
    for (const submitted of ['omit', 'clear', 'replace'] as const) {
      it(`ambiguous ${side} ${carrier}, ${submitted}: refuses the whole registration, including inherited repair`, async () => {
        const { held } = graphs(PLACEMENTS[2]); const incoming = withoutGaps(held);
        const target = (side === 'stored' ? held : incoming)[carrier]!;
        target.push(structuredClone(target.find(row => row.id === OPTION)!));
        if (submitted !== 'omit') for (const row of incoming[carrier]!.filter(r => r.id === OPTION)) {
          row.unresolved_targets = submitted === 'clear' ? [] : ['replacement'];
          row.user_questions = submitted === 'clear' ? [] : ['replacement question'];
        }
        persistedJson = JSON.stringify({ graph: held, facts: [] }); const bytes = persistedJson;
        const res = await register(incoming); expect(res.statusCode, res.body).toBe(409);
        expect(res.json().details.code).toBe('OPTION_GAP_APPROVAL_REQUIRED');
        expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
      });
    }
  }

  it('an explicit false baseline keeps the same admission when a gapped mirror is created', async () => {
    const { held } = graphs(PLACEMENTS[0]);
    const incoming = structuredClone(held);
    incoming.options = incoming.nodes.filter(row => row.kind === 'option').map(row => ({
      id: row.id, label: row.label, status: 'ready', is_baseline: false, interventions: structuredClone(row.interventions),
    }));
    persistedJson = JSON.stringify({ graph: held, facts: [] });
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(200);
    expect(mirror(doc().graph)).toMatchObject(GAP);
    expect(option(doc().graph).status).not.toBe('ready');
  });

  it.each(['nodes', 'options'] as const)('first registration refuses ambiguous %s targets before append', async carrier => {
    const { held } = graphs(PLACEMENTS[2]);
    const incoming = structuredClone(held);
    incoming[carrier]!.push({ ...structuredClone(incoming[carrier]!.find(row => row.id === OPTION)!), id: ` ${OPTION} ` });
    persistedJson = JSON.stringify({ graph: null, facts: [] }); const bytes = persistedJson;
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().details.code).toBe('OPTION_GAP_APPROVAL_REQUIRED');
    expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
  });

  // Mutant: remove the GraphStateIngress carrier validation (passthrough).
  for (const key of ['unresolved_targets', 'user_questions'] as const) {
    for (const carrier of ['nodes', 'options'] as const) for (const registration of ['first', 'added'] as const) {
      it.each([null, 'gap', { gap: 'effect' }, [42], ['valid', null]].map(value => [value]))(`malformed ${key} on ${registration} ${carrier} refuses before append (%j)`, async value => {
        const { clean } = graphs(PLACEMENTS[2]);
        persistedJson = JSON.stringify({ graph: registration === 'first' ? null : clean, facts: [] }); const bytes = persistedJson;
        const incoming = structuredClone(clean);
        const target = registration === 'first' ? incoming[carrier]!.find(r => r.id === OPTION)! : {
          id: 'new-option', ...(carrier === 'nodes' ? { kind: 'option' } : { status: 'ready' }),
          label: 'New option', interventions: structuredClone(node(incoming).interventions),
        };
        if (registration === 'added') incoming[carrier]!.push(target);
        target[key] = value;
        const res = await register(incoming); expect(res.statusCode, res.body).toBe(422);
        expect(res.json().details.code).toBe('GRAPH_CONTRACT_INVALID');
        expect(append).not.toHaveBeenCalled(); expect(persistedJson).toBe(bytes);
      });
    }
  }

});
