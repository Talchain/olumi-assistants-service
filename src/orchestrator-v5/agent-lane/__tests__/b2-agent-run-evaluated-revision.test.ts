import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { SessionLRUCache } from '../../session/cache.js';
import { SupabaseSessionStore } from '../../session/supabase-store.js';
import { ProposalStore } from '../proposal.js';
const seam = vi.hoisted(() => ({ store: undefined as SessionStore | undefined, plot: { run: vi.fn(), validatePatch: vi.fn() } }));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => seam.store }));
vi.mock('../../tools/registry.js', async (original) => ({ ...await original<Record<string, unknown>>(), getDefaultPlotClient: () => seam.plot }));
const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
const { dispatchChipClickRunAnalysis } = await import('../../handlers/chip-click-dispatch.js');
const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
const scenario = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const graphAt = (value: number) => ({ nodes: [{ id: 'g', kind: 'goal', label: 'Growth' }, { id: 'd', kind: 'decision', label: 'Growth plan' }, ...['a', 'b'].map((id, i) => ({ id, kind: 'option', label: id, interventions: { f: { value: i ? 0.4 : value, source: 'user_specified', target_match: { node_id: 'f', match_type: 'exact_id', confidence: 'high' } } } })), { id: 'f', kind: 'factor', label: 'Capacity', category: 'controllable', observed_state: { value: 0.5 } }], edges: [['d', 'a'], ['d', 'b'], ['a', 'f'], ['b', 'f'], ['f', 'g']].map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })) });
afterEach(() => { vi.restoreAllMocks(); seam.plot.run.mockReset(); });
it.each(['revision', 'legacy', 'non-run'] as const)('real agent capability → production Run dispatcher → serializer: %s', async (row) => {
  let graph = graphAt(0.6); let revision = 41; const hash = computeAnalysisAffectingGraphHash(graph); const writes: SessionTurnWrite[] = []; const calls: Record<string, any>[] = [];
  const serial = new SupabaseSessionStore({ rpc: async (_name: string, args: Record<string, any>) => { calls.push(args); return { data: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', error: null }; } } as unknown as SupabaseClient, new SessionLRUCache({ maxScenarios: 10, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
  seam.store = { ...createNoopSessionStore(), loadGraph: async () => structuredClone(graph), loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: null, ...(row === 'legacy' ? {} : { revision }) }), append: async (write) => { writes.push(write); return serial.append(write); } };
  seam.plot.run.mockImplementation(async (body: Record<string, any>) => { graph = graphAt(0.8); revision = 42; expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(hash); return { meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:b2-agent' }, results: body.options.map((o: Record<string, any>, i: number) => ({ option_id: o.option_id, option_label: o.label, win_probability: i ? 0.4 : 0.6 })), response_hash: 'sha256:b2-agent', analysis_status: 'completed' }; });
  const caps = createAgentCapabilities(async (path, body) => { if (path !== '/orchestrate/v2/turn') return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph) } }; expect(body).toMatchObject({ source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } }); const out = await dispatchChipClickRunAnalysis({ payload: body as never, requestId: 'b2-agent' }); expect(out.outcome).toBe('ok'); return { status: 200, json: out.response as unknown as Record<string, unknown> }; }, new ProposalStore());
  const ctx = { scenario_id: scenario, authenticated_user_id: null, request_id: 'b2-agent' }; if (row === 'non-run') { await caps.getCanonicalState(ctx); expect(writes).toHaveLength(0); expect(calls).toHaveLength(0); return; } await caps.runAnalysis(ctx, { reason: 'Run analysis' });
  const element = calls.flatMap(c => c.p_handler_facts ?? []).find(e => e.payload.result.run_id); expect(element).toBeDefined(); expect(seam.plot.run).toHaveBeenCalledOnce(); expect(revision).toBe(42); expect(element.payload.result.graph_hash_at_run).toBe(hash); if (row === 'legacy') { expect(element).not.toHaveProperty('evaluated_scenario_revision'); expect(writes[0]).not.toHaveProperty('run_evaluated_revisions'); } else { expect(element.evaluated_scenario_revision).toBe(41); expect(writes[0].run_evaluated_revisions).toEqual({ [element.payload.result.run_id]: 41 }); }
});
