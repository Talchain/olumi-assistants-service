import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProposalStore } from '../proposal.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/empty-gaps-served-2919.json', import.meta.url), 'utf8'));
const served = fixture.served;
const exact = JSON.parse(fixture.raw_arguments) as { interventions: Record<string, unknown>[]; whole_request: boolean };
const ctx = { scenario_id: served.scenario_id, authenticated_user_id: 'user-a', request_id: 'empty-gaps-2919', user_text: fixture.message };
const llm = vi.fn(() => { throw new Error('Live LLM calls forbidden'); });
vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({ loadGraph: async () => served.graph, loadGraphAndBriefText: async () => ({ graph: served.graph, briefText: null }),
    readMostRecentPendingActions: async () => [], readFactsFor: async () => [], readRecent: async () => [], readFactsWithTurnFor: async () => [],
    append: async () => { throw new Error('Session writes forbidden'); }, getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    ensureScenarioExists: async (_s: string, userId: string) => ({ user_id: userId }) }),
  resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {},
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llm, chatWithTools: llm }),
  getAdapterWithResolution: () => ({ adapter: { name: 'test', model: 'test-model', chat: llm, chatWithTools: llm },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' } }), getMaxTokensFromConfig: () => undefined,
}));
let createAgentCapabilities: typeof import('../runtime/agent-capabilities.js').createAgentCapabilities;
beforeAll(async () => { ({ createAgentCapabilities } = await import('../runtime/agent-capabilities.js')); });
afterAll(() => { expect(llm).not.toHaveBeenCalled(); });
const ordinary = exact.interventions.map(level => Object.fromEntries(Object.entries(level).filter(([key]) =>
  !['likely_low', 'likely_high', 'range_meaning', 'range_user_stated', 'unmodelled_mechanisms'].includes(key))));
const base = new URL('./fixtures/empty-gaps-controls-base.json', import.meta.url);
type Graph = { nodes: Record<string, unknown>[]; options?: Record<string, unknown>[] };
async function propose(levels = exact.interventions, graph: Graph = structuredClone(served.graph), starting = false) {
  const before = JSON.stringify({ graph, levels });
  const store = new ProposalStore();
  const read = vi.fn(async (path: string) => { expect(path).toContain('/graph'); return { status: 200, json: { ...served, graph } }; });
  const caps = createAgentCapabilities(read as never, store, undefined, 'full');
  const result = starting ? await caps.proposeStartingPoint(ctx, { option_levels: levels } as never)
    : await caps.proposeOptionInterventions(ctx, { ...exact, interventions: levels } as never);
  expect(JSON.stringify({ graph, levels })).toBe(before);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(1);
  const proposal = store.get(String(result.proposal_id));
  expect(proposal).toBeDefined();
  return { result, proposal: proposal! };
}
function noGapOperations(proposal: Awaited<ReturnType<typeof propose>>['proposal']) {
  expect(proposal.operations).toHaveLength(2);
  for (const op of proposal.operations) {
    expect(op.value).not.toHaveProperty('unmodelled_mechanisms');
    expect(op.value).not.toHaveProperty('gap_operands');
  }
  expect(proposal.public_label).not.toMatch(/clear its listed|Current statement/);
}
function withExisting(carrier: 'node' | 'mirror', field: 'unresolved_targets' | 'user_questions'): Graph {
  const graph: Graph = structuredClone(served.graph);
  const row = carrier === 'node' ? graph.nodes.find(n => n.id === 'trial')!
    : (graph.options = [{ id: 'trial', label: 'Trial' }])[0]!;
  row[field] = [field === 'unresolved_targets' ? 'supplier learning' : 'What does supplier learning change?'];
  return graph;
}
describe('empty gap declarations on empty carriers and unclaimed empty ranges', () => {
  it('E1: verbatim served arguments and text produce one mixed-authorship proposal without gap or range words', async () => {
    const { result, proposal } = await propose();
    expect(result.public_label).toBe('Full sets Duration to 20 days; Trial sets Duration to 0.3 days');
    noGapOperations(proposal);
    expect(result).not.toHaveProperty('ranges_not_recorded');
    expect(result).not.toHaveProperty('detail');
    expect(result.interventions).toEqual([
      expect.objectContaining({ option: 'Full', stated_by: 'olumi_estimate' }),
      expect.objectContaining({ option: 'Trial', stated_by: 'user' }),
    ]);
  });
  it('E2 / E2b / E3b: non-empty declarations, clears on existing carriers, and claimed-zero disclosure are byte-identical to base', async () => {
    const controls = [];
    for (const starting of [false, true]) {
      controls.push(await propose(ordinary.map(level => ({ ...level, unmodelled_mechanisms: ['supplier learning'] })), undefined, starting));
      for (const carrier of ['node', 'mirror'] as const) for (const field of ['unresolved_targets', 'user_questions'] as const) {
        const control = await propose(ordinary.map(level => level.option_label === 'Trial' ? { ...level, unmodelled_mechanisms: [] } : level), withExisting(carrier, field), starting);
        expect(control.proposal.public_label).toContain('Trial: clear its listed unresolved model gaps');
        expect(control.proposal.public_label).toContain('supplier learning');
        expect(control.proposal.operations.find(op => op.path === 'trial::duration')?.value).toHaveProperty('unmodelled_mechanisms', []);
        controls.push(control);
      }
      const claimed = await propose(ordinary.map(level => ({ ...level, likely_low: 0, likely_high: 0, range_meaning: 'other', range_user_stated: true })), undefined, starting);
      expect(claimed.result.ranges_not_recorded).toHaveLength(2);
      expect(claimed.result.detail).toContain('Ask the user to restate their likely range in their own words');
      controls.push(claimed);
    }
    const bytes = JSON.stringify(controls);
    if (process.env.EMPTY_GAPS_CAPTURE_BASE === '1') writeFileSync(base, bytes + '\n');
    expect(bytes).toBe(readFileSync(base, 'utf8').trimEnd());
  });
  it.each([false, true])('E3: unclaimed zeros or absent ends equal no range fields, starting=%s', async starting => {
    const expected = JSON.stringify(await propose(ordinary, undefined, starting));
    for (const ends of [{ likely_low: 0, likely_high: 0 }, {}]) for (const flag of [false, undefined]) {
      const actual = await propose(ordinary.map(level => ({ ...level, ...ends, range_meaning: 'other', ...(flag === undefined ? {} : { range_user_stated: flag }) })), undefined, starting);
      expect(actual.result).not.toHaveProperty('ranges_not_recorded');
      expect(actual.result).not.toHaveProperty('detail');
      expect(JSON.stringify(actual)).toBe(expected);
    }
  });
  it('E4: starting-point delegation of the exact capture has the same no-op operations and label', async () => {
    const direct = await propose(ordinary);
    const starting = await propose(exact.interventions, undefined, true);
    noGapOperations(starting.proposal);
    expect(starting.proposal).toEqual(direct.proposal);
    expect(starting.result).not.toHaveProperty('ranges_not_recorded');
    expect(starting.result).not.toHaveProperty('detail');
    expect(starting.result.interventions).toEqual(direct.result.interventions);
  });
  it.each([false, true])('H4: an unclaimed non-zero likely range is omitted with disclosure and the level proceeds unchanged, starting=%s', async starting => {
    const expected = await propose(ordinary, undefined, starting);
    const actual = await propose(ordinary.map(level => level.option_label === 'Full'
      ? { ...level, likely_low: 5, likely_high: 20, range_meaning: 'likely_range', range_user_stated: false }
      : level), undefined, starting);
    for (const op of actual.proposal.operations) expect(op.value).not.toHaveProperty('likely_range');
    expect(actual.proposal).toEqual(expected.proposal);
    expect(actual.result.interventions).toEqual(expected.result.interventions);
    const reason = 'No likely range was recorded: a range is recorded only when the user gave it (range_user_stated), never one Olumi proposed.';
    expect(actual.result.ranges_not_recorded).toEqual([{ option: 'Full', factor: 'Duration', reason }]);
    expect(actual.result.detail).toBe(`Full / Duration: ${reason}`);
    const { ranges_not_recorded: _ranges, detail: _detail, ...withoutDisclosure } = actual.result;
    expect(withoutDisclosure).toEqual(expected.result);
  });
  it.each([false, true])('empty node and mirror arrays behave as omitted declarations, starting=%s', async starting => {
    const graph: Graph = structuredClone(served.graph);
    for (const node of graph.nodes.filter(n => n.kind === 'option')) Object.assign(node, { unresolved_targets: [], user_questions: [] });
    graph.options = graph.nodes.filter(n => n.kind === 'option').map(n => ({ id: n.id, unresolved_targets: [], user_questions: [] }));
    const expected = await propose(ordinary, graph, starting);
    const actual = await propose(ordinary.map(level => ({ ...level, unmodelled_mechanisms: [] })), graph, starting);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
    noGapOperations(actual.proposal);
  });
});
