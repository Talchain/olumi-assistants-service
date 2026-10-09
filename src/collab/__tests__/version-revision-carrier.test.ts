import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCollabStore } from '../store.js';
const mocks = vi.hoisted(() => ({ saveVersion: vi.fn() }));
vi.mock('../../orchestrator-v5/model-management/index.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/model-management/index.js')>()),
  getModelManagementService: () => ({ saveVersion: mocks.saveVersion }),
}));
const graph = { nodes: [{ id: 'factor', kind: 'factor', label: 'Capacity' }], edges: [] };
function fixture(revision: unknown) {
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn(async () => ({ error: null, data: { graph, user_id: 'owner', current_model_version_id: null, revision } }));
  const chain = { select, eq, maybeSingle };
  select.mockReturnValue(chain); eq.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  return { store: new SupabaseCollabStore({ from } as never), from, select, eq, maybeSingle };
}
beforeEach(() => { mocks.saveVersion.mockReset(); mocks.saveVersion.mockResolvedValue({ status: 'ok', value: { version_id: 'minted' } }); });
describe('collab round mint revision carrier', () => {
  it.each([0, 19])('passes revision %s from its own graph/head SELECT', async revision => {
    const f = fixture(revision);
    expect(await f.store.createModelVersion({ scenario_id: 'scenario', provenance: 'elicitation_round_mint' })).toEqual({ model_version_id: 'minted' });
    expect(f.select).toHaveBeenCalledExactlyOnceWith('graph, user_id, current_model_version_id, revision');
    expect(f.eq).toHaveBeenCalledExactlyOnceWith('id', 'scenario');
    expect(f.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mocks.saveVersion).toHaveBeenCalledExactlyOnceWith({ scenario_id: 'scenario', graph, expected_revision: revision,
      expected_head_version_id: null, provenance: 'elicitation_round_mint', label: 'Panel round' });
  });
  it.each([undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '19'])('refuses unreadable revision %s before minting', async revision => {
    const f = fixture(revision);
    await expect(f.store.createModelVersion({ scenario_id: 'scenario', provenance: 'elicitation_round_mint' })).rejects.toThrow('revision');
    expect(mocks.saveVersion).not.toHaveBeenCalled();
  });
  it('retains the existing generic handling of a revision conflict', async () => {
    mocks.saveVersion.mockResolvedValue({ status: 'conflict', conflict: { kind: 'revision_conflict', expected: 19, current: 20 } });
    await expect(fixture(19).store.createModelVersion({ scenario_id: 'scenario', provenance: 'elicitation_round_mint' }))
      .rejects.toThrow('collab store: could not pin a model version for this round (conflict).');
  });
});
