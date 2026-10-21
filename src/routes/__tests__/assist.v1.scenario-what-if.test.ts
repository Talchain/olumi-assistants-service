/**
 * POST /assist/v1/scenarios/:scenario_id/what-if: the body is canvas value gestures (`SystemEventSchema`), the answer says
 * nothing was saved. Owner admission is pinned by scenario-ownership-rows.test.ts; the run by what-if-run.test.ts.
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const ran = vi.hoisted(() => ({ calls: [] as unknown[], result: null as unknown }));
vi.mock('../../orchestrator-v5/handlers/what-if-run.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runWhatIf: vi.fn(async (p: unknown) => { ran.calls.push(p); return ran.result; }),
}));
vi.mock('../../orchestrator-v5/build-turn-context.js', () => ({ loadPersistedScenarioStateStrict: vi.fn(async () => ({ graph: {} })) }));

const { default: route } = await import('../assist.v1.scenario-what-if.js');
const SID = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const HASH = 'a'.repeat(64);
const VALUE = { kind: 'factor_value_edit', target_id: 'f', value: 0.7 };

async function post(body: unknown, id = SID) {
  const app = Fastify();
  await route(app);
  const r = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${id}/what-if`, payload: body as never });
  await app.close();
  return r;
}

describe('the what-if route', () => {
  it('a held value gesture runs; the answer carries persisted:false and no internal kind', async () => {
    ran.calls = [];
    ran.result = { kind: 'ran', persisted: false, changes_applied: [{ index: 0, target: { node_id: 'f' } }], changes_refused: [], variants: [] };
    const r = await post({ changes: [VALUE], crux: true, base_graph_hash: HASH });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ persisted: false, changes_applied: [{ index: 0, target: { node_id: 'f' } }], changes_refused: [], variants: [] });
    expect(ran.calls).toEqual([expect.objectContaining({ crux: true, changes: [VALUE], baseGraphHash: HASH })]);
  });

  it('a refusal is a 200 with its reason and persisted:false', async () => {
    ran.result = { kind: 'refused', reason: 'stale_base' };
    const r = await post({ changes: [VALUE] });
    expect([r.statusCode, r.json()]).toEqual([200, { persisted: false, refusal: 'stale_base', changes_refused: [] }]);
  });

  it.each([
    ['no changes', { changes: [] }],
    ['a structural gesture', { changes: [{ kind: 'structural_rename', node_id: 'f', label: 'x', expected_label: 'f' }] }],
    ['an unknown member', { changes: [VALUE], save: true }],
    ['too many changes', { changes: Array.from({ length: 7 }, () => VALUE) }],
  ])('%s → 400, nothing run', async (_, body) => {
    ran.calls = [];
    const r = await post(body);
    expect(r.statusCode).toBe(400);
    expect(ran.calls).toHaveLength(0);
  });

  it('a non-UUID scenario id → the family\'s 404 before the body is read', async () => {
    ran.calls = [];
    expect((await post({ changes: [VALUE] }, 'not-a-uuid')).statusCode).toBe(404);
    expect(ran.calls).toHaveLength(0);
  });
});
