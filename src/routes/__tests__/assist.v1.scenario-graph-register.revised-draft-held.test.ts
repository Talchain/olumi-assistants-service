import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/**
 * ⭐ AIE B34 (6119577581) — THE REAL REGISTER ROUTE STORES THE WHOLE APPROVED REVISED DRAFT.
 *
 * The capability confirms a replacement only when the read-back is the acknowledged graph AND that graph holds every
 * component of the approved candidate unchanged (`approvedGraphHeld`, over the canonical identity normaliser). This spec is
 * that check's positive control on the AUTHORITATIVE path: Paul's L20 revised-draft candidate (the capability's own,
 * bound by `restated-goal-revised-draft.test.ts`), registered through the REAL `/graph/register` route over a stateful
 * store double on the SERVED early draft (`marketing-020148Z-draft-before-L20.json`), with both CAS hashes:
 *   - the acknowledgement names the stored bytes, and the stored graph holds the whole candidate: nothing removed or
 *     changed, the route's only additions its own `ref` on each node;
 *   - CONTRAST: the route's own persistence projection made to drop one link → still acknowledged and read back as stored,
 *     and the check refuses it.
 */
import { readFileSync } from 'node:fs';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef, dropLink } = vi.hoisted(() => ({ storeRef: { value: null as object | null }, dropLink: { value: false } }));
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionStore: () => withScenarioRevision(storeRef.value!) };
});
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});
// The CONTRAST only: the route's own projection drops the advertising → conversion link before it hashes and stores.
vi.mock('../../orchestrator-v5/persisted-graph-projection.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { projectGraphForPersistence: (g: unknown, o: unknown) => unknown }>();
  return { ...actual, projectGraphForPersistence: (g: unknown, o: unknown) => {
    const out = actual.projectGraphForPersistence(g, o) as { edges?: { from?: string; to?: string }[] };
    return dropLink.value && Array.isArray(out.edges)
      ? { ...out, edges: out.edges.filter((e) => !(e.from === 'advertising_spend' && e.to === 'conversion_rate')) } : out;
  } };
});

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash, normaliseGraphForIdentity } from '../../orchestrator-v5/context/graph-identity.js';
import { approvedGraphHeld } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/marketing-020148Z-draft-before-L20.json', import.meta.url), 'utf8')) as { scenario_id: string; brief_text: string; graph: Rec };
const DRAFT = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/marketing-l20-revised-draft-candidate.json', import.meta.url), 'utf8')) as { operation_id: string; candidate: Rec };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function register() {
  resolveUserIdentity.mockResolvedValue({ mode: 'off' });
  const row = { graph: clone(FX.graph) as unknown };
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => { row.graph = clone(write.graph); return { id: 'turn-1' }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: FX.brief_text })),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const r = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${FX.scenario_id}/graph/register`, payload: {
    graph: clone(DRAFT.candidate), expected_graph_hash: computeAnalysisAffectingGraphHash(FX.graph as never),
    expected_graph_identity_hash: computeGraphIdentityHash(FX.graph as never)?.value, operation_id: DRAFT.operation_id } });
  await app.close();
  return { r, stored: row.graph as Rec };
}

describe('the real register route stores the whole approved revised draft (AIE B34)', () => {
  afterEach(() => { dropLink.value = false; });

  it('acknowledged = stored; the stored graph holds the whole candidate; the only additions are the route\'s node refs', async () => {
    const { r, stored } = await register();
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect((r.json() as { graph_identity_hash: { value: string } }).graph_identity_hash.value).toBe(computeGraphIdentityHash(stored as never)?.value);
    expect(approvedGraphHeld(DRAFT.candidate, stored)).toBe(true);
    // Exact preservation: without the route's own node refs, the stored graph IS the candidate under the canonical normaliser.
    const withoutRefs = { ...stored, nodes: (stored.nodes as Rec[]).map(({ ref: _ref, ...n }) => n) };
    expect((stored.nodes as Rec[]).every((n) => typeof n.ref === 'string')).toBe(true);
    expect(normaliseGraphForIdentity(withoutRefs as never)?.graph).toEqual(normaliseGraphForIdentity(DRAFT.candidate as never)?.graph);
  });

  it('CONTRAST: the route drops a link before it acknowledges → acknowledged and stored agree, and the check refuses it', async () => {
    dropLink.value = true;
    const { r, stored } = await register();
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect((r.json() as { graph_identity_hash: { value: string } }).graph_identity_hash.value).toBe(computeGraphIdentityHash(stored as never)?.value);
    expect((stored.edges as Rec[]).some((e) => e.from === 'advertising_spend' && e.to === 'conversion_rate')).toBe(false);
    expect(approvedGraphHeld(DRAFT.candidate, stored)).toBe(false);
  });
});
