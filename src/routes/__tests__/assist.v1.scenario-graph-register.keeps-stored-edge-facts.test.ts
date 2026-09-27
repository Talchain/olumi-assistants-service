/**
 * ⭐ A RE-REGISTER KEEPS THE STORED CEE-OWNED FACTS OF AN UNCHANGED EDGE.
 *
 * SERVED, CEE staging `dd456fe`, scratch scenario `01500753` (captures in `__fixtures__/register-erasure-dd456fe.json`,
 * generated from the raw files, never hand-copied): register → the user's `edge_strength_edit` to 0.7 → a UI-shaped
 * re-register (the UI's `buildRegistrationGraph` rebuilds every edge from a fixed key list:
 * `from, to, strength{mean,std}, exists_probability, effect_direction, edge_type` + `origin`). The edited edge lost
 * `exists_defaulted`, `std_defaulted`, `provenance` and `provenance_display`; the untouched Olumi edge lost `defaulted`
 * and `provenance`. Numbers unchanged, nodes byte-identical, and the analysis `graph_hash` unchanged
 * (`f49ba1e65f9efc0c`), so the loss was SILENT: only the identity hash moved.
 *
 * THE RULE (`withStoredEdgeFactsWhenUnstated`, beside `withStoredLimitsWhenUnstated`): for each submitted edge that
 * matches exactly one stored edge (`from` + `to`, and `id` when both carry one) AND whose analysis-affecting numbers
 * are equal (`strength.mean`, `strength.std`, `exists_probability`, `effect_direction`, exact), carry the stored
 * value of each CEE-owned edge field the submission OMITS. A field the caller sent is kept as sent. The field set is
 * `CEE_OWNED_EDGE_FIELDS`, DERIVED in `field-safety.ts` (never a hand list here).
 *
 * THE PATH: the REAL `/graph/register` route (Fastify inject) over a stateful session-store double, the REAL
 * `applyEdgeStrengthEdit` writer for the user's edit, the REAL persistence projection and the REAL analysis and
 * identity hashes. Every edge is found by its endpoint pair (exactly one) and every fact asserted by its literal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as unknown } }));
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionStore: () => storeRef.value };
});
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { applyEdgeStrengthEdit } from '../../orchestrator-v5/system-events/edge-strength-edit.js';
import { CEE_OWNED_EDGE_FIELDS, PIPELINE_OWNED_ROOTS } from '../../orchestrator-v5/graph-management/field-safety.js';
import { EdgeV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
type Edge = Rec & { from: string; to: string; strength: { mean: number; std?: number } };
type Graph = Rec & { nodes: Rec[]; edges: Edge[] };
type Hashes = { graph_hash: string; graph_identity_hash: { value: string } };
interface Capture {
  scenario_id: string;
  served_build: string;
  register_request: { graph: Graph; expected_graph_identity_hash: null };
  register_response: Hashes;
  edit_turn_request: Rec & { event: Rec };
  read_after_edit: Hashes & { graph: Graph };
  ui_reregister_request: { graph: Graph };
  ui_reregister_response: Hashes;
  read_after_reregister: Hashes & { graph: Graph };
}

const CAPTURE = JSON.parse(
  readFileSync(join(process.cwd(), 'src/routes/__tests__/__fixtures__/register-erasure-dd456fe.json'), 'utf8'),
) as Capture;
const SCENARIO = CAPTURE.scenario_id;
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
/** The edge the user edited, and the Olumi default nobody touched (the witness's TARGET and CONTRAST). */
const TARGET = { from: 'fac_marketing', to: 'out_demand' } as const;
const CONTRAST = { from: 'out_demand', to: 'goal_revenue' } as const;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A session store double the REAL register route writes and reads: one stored row. */
function world(initial: Graph | null) {
  const row = { graph: (initial === null ? null : clone(initial)) as unknown };
  const appends: unknown[] = [];
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => {
      appends.push(clone(write.graph));
      row.graph = clone(write.graph);
      return { id: `turn-${appends.length}` };
    }),
    loadGraph: vi.fn(async () => (row.graph === null ? null : clone(row.graph))),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  return { row, appends, stored: (): Graph => row.graph as Graph };
}

const apps: FastifyInstance[] = [];
async function post(body: unknown) {
  const app = Fastify();
  apps.push(app);
  await registerRoute(app);
  await app.ready();
  return app.inject({
    method: 'POST',
    url: `/assist/v1/scenarios/${SCENARIO}/graph/register`,
    payload: clone(body) as Rec,
  });
}

/** Exactly one edge on the endpoint pair — never `.find()` over a duplicate. */
function edgeOf(graph: Graph, pair: { from: string; to: string }): Edge {
  const hits = graph.edges.filter((e) => e.from === pair.from && e.to === pair.to);
  expect(hits, `${pair.from}→${pair.to}`).toHaveLength(1);
  return hits[0]!;
}

const identityOf = (g: unknown) => computeGraphIdentityHash(g as never)?.value;
const analysisHashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as never);

/** The UI-shaped re-register body, with the TARGET edge edited by `patch`. */
function uiBodyWithTarget(patch: (edge: Edge) => void): { graph: Graph } {
  const body = clone(CAPTURE.ui_reregister_request);
  patch(edgeOf(body.graph, TARGET));
  return body;
}

/** The served post-edit TARGET and CONTRAST edges, as the read route returned them (capture 4). */
const SERVED_TARGET_AFTER_EDIT = edgeOf(clone(CAPTURE.read_after_edit.graph), TARGET);
const SERVED_CONTRAST_AFTER_EDIT = edgeOf(clone(CAPTURE.read_after_edit.graph), CONTRAST);

beforeEach(() => {
  resolveUserIdentity.mockReset();
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER });
});
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

/**
 * Steps 1–3 of the served witness, in-process: register (capture 1) → the user's `edge_strength_edit` through the
 * REAL writer, persisted in the projected form → the UI-shaped re-register (capture 5).
 */
async function replayWitness() {
  const w = world(null);

  const first = await post(CAPTURE.register_request);
  expect(first.statusCode, first.body).toBe(200);

  const payload = OrchestratorTurnPayloadSchema.parse(clone(CAPTURE.edit_turn_request)) as SystemEventTurnPayload;
  if (payload.kind !== 'system_event' || payload.event.kind !== 'edge_strength_edit') {
    throw new Error('capture 3 is not an edge_strength_edit system event');
  }
  const edit = await applyEdgeStrengthEdit({
    payload,
    event: payload.event,
    requestId: 'req-register-erasure-edit',
    persistedGraph: clone(w.row.graph),
  });
  if (edit.kind !== 'mutated') throw new Error(`the edit did not apply: ${edit.reason}`);
  w.row.graph = projectGraphForPersistence(clone(edit.mutatedGraph), { scenarioId: SCENARIO });
  const beforeReregister = clone(w.stored());

  const second = await post(CAPTURE.ui_reregister_request);
  expect(second.statusCode, second.body).toBe(200);
  return { w, first, beforeReregister, second };
}

describe('the replay is the served witness (fidelity preconditions)', () => {
  it('captures are from served dd456fe; the UI-shaped TARGET edge carries only the buildRegistrationGraph keys', () => {
    expect(CAPTURE.served_build).toBe('dd456fe');
    expect(Object.keys(edgeOf(CAPTURE.ui_reregister_request.graph, TARGET)).sort()).toEqual(
      ['edge_type', 'effect_direction', 'exists_probability', 'from', 'strength', 'to'],
    );
    // The served erasure itself (capture 6): the four facts are gone after the UI-shaped re-register.
    const erased = edgeOf(CAPTURE.read_after_reregister.graph, TARGET);
    for (const f of ['exists_defaulted', 'std_defaulted', 'provenance', 'provenance_display']) {
      expect(erased, f).not.toHaveProperty(f);
    }
  });

  it('the in-process register and edit reproduce the served bytes and hashes (captures 1 and 4)', async () => {
    const { first, beforeReregister } = await replayWitness();
    expect(first.json().graph_hash).toBe(CAPTURE.register_response.graph_hash);
    expect(first.json().graph_identity_hash.value).toBe(CAPTURE.register_response.graph_identity_hash.value);
    expect(beforeReregister).toEqual(CAPTURE.read_after_edit.graph);
    expect(analysisHashOf(beforeReregister)).toBe(CAPTURE.read_after_edit.graph_hash);
    expect(identityOf(beforeReregister)).toBe(CAPTURE.read_after_edit.graph_identity_hash.value);
  });
});

describe('(a) the served witness, replayed: a UI-shaped re-register keeps the stored CEE-owned edge facts', () => {
  it("the edited edge keeps exists_defaulted, std_defaulted, provenance and provenance_display; the untouched Olumi edge keeps defaulted and provenance", async () => {
    const { w } = await replayWitness();
    const target = edgeOf(w.stored(), TARGET);
    expect(target.exists_defaulted).toBe(true);
    expect(target.std_defaulted).toBe(true);
    expect(target.provenance).toEqual({ source: 'user_specified' });
    expect(target.provenance_display).toBe('user_set');
    expect(target).toEqual(SERVED_TARGET_AFTER_EDIT);

    const contrast = edgeOf(w.stored(), CONTRAST);
    expect(contrast.defaulted).toBe(true);
    expect(contrast.provenance).toEqual({ source: 'cee_hypothesis', reasoning: 'model reason text: demand drives revenue' });
    expect(contrast).toEqual(SERVED_CONTRAST_AFTER_EDIT);
  });

  it('a failed read of the stored graph degrades to today: the register proceeds, nothing is carried', async () => {
    const w = world(CAPTURE.read_after_edit.graph);
    (storeRef.value as { loadGraph: ReturnType<typeof vi.fn> }).loadGraph.mockRejectedValue(new Error('read failed'));
    const res = await post(CAPTURE.ui_reregister_request);
    expect(res.statusCode, res.body).toBe(200);
    expect(edgeOf(w.stored(), TARGET)).toEqual(edgeOf(CAPTURE.ui_reregister_request.graph, TARGET));
  });
});

describe('(b) CONTRAST: a changed number is a new statement, so that edge carries nothing', () => {
  const CHANGES: ReadonlyArray<readonly [string, (e: Edge) => void]> = [
    ['strength.mean 0.7 → 0.5', (e) => { e.strength.mean = 0.5; }],
    ['strength.mean 0.7 → 0.7000001 (exact, not tolerant)', (e) => { e.strength.mean = 0.7000001; }],
    ['strength.std 0.35 → 0.3', (e) => { e.strength.std = 0.3; }],
    ['exists_probability 0.8 → 0.75', (e) => { e.exists_probability = 0.75; }],
  ];
  it.each(CHANGES)('%s: the TARGET stands exactly as sent, and the unchanged CONTRAST still carries', async (_label, change) => {
    const w = world(CAPTURE.read_after_edit.graph);
    const body = uiBodyWithTarget(change);
    const res = await post(body);
    expect(res.statusCode, res.body).toBe(200);

    const contrast = edgeOf(w.stored(), CONTRAST);
    expect(contrast.defaulted).toBe(true);
    expect(contrast.provenance).toEqual({ source: 'cee_hypothesis', reasoning: 'model reason text: demand drives revenue' });

    const target = edgeOf(w.stored(), TARGET);
    expect(target).toEqual(edgeOf(body.graph, TARGET));
    for (const f of CEE_OWNED_EDGE_FIELDS) expect(target, f).not.toHaveProperty(f);
  });
});

describe('(c) an ambiguous match carries nothing', () => {
  /** A second stored TARGET pair with the SAME numbers, as Olumi's default. */
  const STORED_DUPLICATE: Edge = {
    ...clone(SERVED_TARGET_AFTER_EDIT),
    provenance: { source: 'cee_hypothesis', reasoning: 'a duplicate copy of the link' },
    defaulted: true,
  };
  for (const k of ['exists_defaulted', 'std_defaulted', 'provenance_display']) delete STORED_DUPLICATE[k];

  it('two STORED edges share fac_marketing → out_demand: the one submitted edge carries nothing; the CONTRAST still carries', async () => {
    const stored = clone(CAPTURE.read_after_edit.graph);
    stored.edges.push(clone(STORED_DUPLICATE));
    const w = world(stored);
    const res = await post(CAPTURE.ui_reregister_request);
    expect(res.statusCode, res.body).toBe(200);

    expect(edgeOf(w.stored(), CONTRAST).defaulted).toBe(true);
    const target = edgeOf(w.stored(), TARGET);
    expect(target).toEqual(edgeOf(CAPTURE.ui_reregister_request.graph, TARGET));
    for (const f of CEE_OWNED_EDGE_FIELDS) expect(target, f).not.toHaveProperty(f);
  });

  it('two SUBMITTED edges share fac_marketing → out_demand: neither is handed the one stored edge\'s facts; the CONTRAST still carries', async () => {
    const w = world(CAPTURE.read_after_edit.graph);
    const body = clone(CAPTURE.ui_reregister_request);
    body.graph.edges.push(clone(edgeOf(body.graph, TARGET)));
    const res = await post(body);
    expect(res.statusCode, res.body).toBe(200);

    expect(edgeOf(w.stored(), CONTRAST).defaulted).toBe(true);
    const targets = w.stored().edges.filter((e) => e.from === TARGET.from && e.to === TARGET.to);
    expect(targets).toHaveLength(2);
    for (const t of targets) {
      for (const f of CEE_OWNED_EDGE_FIELDS) expect(t, f).not.toHaveProperty(f);
    }
  });
});

describe('(d) a field the caller sends is kept as sent, never overwritten', () => {
  it("the caller's provenance stands; the fields it omitted are still carried", async () => {
    const SENT = { source: 'user_specified', reasoning: "Set from last year's campaign data" };
    const w = world(CAPTURE.read_after_edit.graph);
    const res = await post(uiBodyWithTarget((e) => { e.provenance = clone(SENT); }));
    expect(res.statusCode, res.body).toBe(200);

    const target = edgeOf(w.stored(), TARGET);
    expect(target.provenance).toEqual(SENT);
    expect(target.exists_defaulted).toBe(true);
    expect(target.std_defaulted).toBe(true);
    expect(target.provenance_display).toBe('user_set');
  });
});

describe('(e) the carry does not move the analysis hash; the identity returns to the pre-re-register identity', () => {
  it('analysis hash = served f49ba1e65f9efc0c = the uncarried bytes; identity = the pre-re-register identity (a03eddd6…), not the served erasing one (fd474f78…)', async () => {
    const { w, beforeReregister, second } = await replayWitness();
    const uncarried = projectGraphForPersistence(clone(CAPTURE.ui_reregister_request.graph), { scenarioId: SCENARIO });

    // Analysis space: unmoved by the carry (the analysis projection is a whitelist that excludes every carried field).
    expect(second.json().graph_hash).toBe(CAPTURE.ui_reregister_response.graph_hash);
    expect(analysisHashOf(w.stored())).toBe(analysisHashOf(uncarried));
    expect(analysisHashOf(w.stored())).toBe(CAPTURE.read_after_edit.graph_hash);

    // Identity space: the stored graph is the pre-re-register graph again.
    expect(second.json().graph_identity_hash.value).toBe(CAPTURE.read_after_edit.graph_identity_hash.value);
    expect(second.json().graph_identity_hash.value).not.toBe(CAPTURE.ui_reregister_response.graph_identity_hash.value);
    expect(identityOf(w.stored())).toBe(identityOf(beforeReregister));
    expect(w.stored()).toEqual(beforeReregister);
  });
});

describe('(f) an id-bearing edge is matched by id', () => {
  const withId = (g: Graph, pair: { from: string; to: string }, id: string) => { edgeOf(g, pair).id = id; return g; };

  it('stored and submitted carry the SAME id: the facts carry', async () => {
    const w = world(withId(clone(CAPTURE.read_after_edit.graph), TARGET, 'e_mkt_demand'));
    const res = await post(uiBodyWithTarget((e) => { e.id = 'e_mkt_demand'; }));
    expect(res.statusCode, res.body).toBe(200);
    const target = edgeOf(w.stored(), TARGET);
    expect(target.exists_defaulted).toBe(true);
    expect(target.provenance).toEqual({ source: 'user_specified' });
  });

  it('both carry an id and the ids DIFFER: that edge carries nothing; the CONTRAST still carries', async () => {
    const w = world(withId(clone(CAPTURE.read_after_edit.graph), TARGET, 'e_mkt_demand'));
    const res = await post(uiBodyWithTarget((e) => { e.id = 'e_something_else'; }));
    expect(res.statusCode, res.body).toBe(200);
    expect(edgeOf(w.stored(), CONTRAST).defaulted).toBe(true);
    const target = edgeOf(w.stored(), TARGET);
    for (const f of CEE_OWNED_EDGE_FIELDS) expect(target, f).not.toHaveProperty(f);
  });

  it('two stored edges share the endpoint pair but carry distinct ids: the id picks the one, and ITS facts carry', async () => {
    const stored = withId(clone(CAPTURE.read_after_edit.graph), TARGET, 'e_user');
    stored.edges.push({
      ...clone(SERVED_TARGET_AFTER_EDIT),
      id: 'e_olumi',
      provenance: { source: 'cee_hypothesis', reasoning: 'the other copy' },
      defaulted: true,
    });
    const w = world(stored);
    const res = await post(uiBodyWithTarget((e) => { e.id = 'e_user'; }));
    expect(res.statusCode, res.body).toBe(200);
    const target = edgeOf(w.stored(), TARGET);
    expect(target.id).toBe('e_user');
    expect(target.provenance).toEqual({ source: 'user_specified' });
    expect(target.exists_defaulted).toBe(true);
    expect(target).not.toHaveProperty('defaulted');
  });
});

describe('the field set has ONE authority: field-safety derives it', () => {
  it('CEE_OWNED_EDGE_FIELDS = every EdgeV3-declared key the owned union names (pinned, so a change is noticed)', () => {
    const edgeKeys = new Set(Object.keys(EdgeV3.shape));
    for (const f of CEE_OWNED_EDGE_FIELDS) {
      expect(edgeKeys.has(f), f).toBe(true);
      expect(PIPELINE_OWNED_ROOTS.has(f.toLowerCase()), f).toBe(true);
    }
    expect([...CEE_OWNED_EDGE_FIELDS].sort()).toEqual(
      ['defaulted', 'exists_defaulted', 'origin', 'provenance', 'provenance_display', 'std_defaulted', 'validation'],
    );
    // Contrast: the analysis-affecting and identity keys are NOT CEE-owned, so they are never carried.
    for (const k of ['from', 'to', 'strength', 'exists_probability', 'effect_direction', 'edge_type']) {
      expect(CEE_OWNED_EDGE_FIELDS, k).not.toContain(k);
    }
  });
});
