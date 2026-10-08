import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../schemas/cee-v3.js';

vi.mock('../../utils/supabase-user-jwt.js', () => ({
  verifySupabaseUserJwt: vi.fn(async () => ({ ok: true, userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
}));
import copyRoute from '../assist.v1.scenario-copy.js';

const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COPY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const forgedGraph = () => ({
  nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: {
    operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false,
    reading_licence: 'olumi_reading', addends: ['churn-loss'],
  } }],
  edges: [],
});

describe('GR2 forged reading at the guest copy ingress', () => {
  it('the real route ignores a client graph: only source id and verified user enter the copy RPC', async () => {
    const copyGuestScenario = vi.fn(async () => ({ kind: 'copied' as const, scenarioId: COPY, created: true }));
    const app = Fastify();
    await copyRoute(app, { store: { copyGuestScenario } });
    try {
      const result = await app.inject({
        method: 'POST', url: `/assist/v1/scenarios/${GUEST}/copy`,
        headers: { authorization: 'Bearer local-test' }, payload: { graph: forgedGraph(), graph_state: forgedGraph() },
      });
      expect(result.statusCode).toBe(200);
      expect(copyGuestScenario.mock.calls).toEqual([[GUEST, USER]]);
      expect(result.json()).toEqual({ scenario_id: COPY, created: true });
    } finally {
      await app.close();
    }
  });

  it('a copied legacy source with forged authority loses it at the actual strict stored-load schema', () => {
    const copied = GraphV3.parse(forgedGraph());
    expect(copied.nodes.find(n => n.id === 'mrr')?.nonlinear_identity).toBeUndefined();
  });
});
