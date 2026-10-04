import { createProposal } from '../../../src/orchestrator-v5/agent-lane/proposal.js';
/**
 * ⛔ A COMPOUND APPROVAL IS ONE COMMIT (Canonical #70 5849037691: "the last two-commit path in the Agent lane").
 * A starting point — Olumi's starting values AND an option's level — was approved as ONE user operation, yet
 * `applyCompound` wrote the values through `/graph/register` and THEN the links and levels through the door: a refused
 * level left the values written (`partially_applied`, two receipts). This drives the Agent's own propose → approve
 * through the REAL in-process door (`commitOptionLevelsInProcess` with `values`, CEE #2031) and asserts ONE commit and
 * ONE receipt on success, and NOTHING written — the value included — when a level is refused.
 *
 * Known-bad control: RED with the consumer reverted — the values go through `/graph/register` as their own commit
 * (two rows on success), and a refused level leaves that value written (`partially_applied`).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { optionGapsHeld } from '../../../src/orchestrator-v5/agent-lane/unmodelled-mechanisms.js';
import { approvalChipsFor } from '../../../src/orchestrator-v5/agent-lane/approval-chips.js';

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';
const RAISE = 'Raise to £59 at release';

/** A priced model with no churn figure yet: a starting point needs churn's value AND the raise option's level. */
function pricingGraph() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'goal_mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.1 },
        { id: 'opt_raise', kind: 'option', label: RAISE, provenance: 'ai_inferred', interventions: {} },
        { id: 'fac_price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month', source: 'user_override' } },
        { id: 'fac_churn', kind: 'factor', label: 'Monthly churn rate' },
        // Joined to the option the REVERSE way: a level on it cannot be written (the door's own refusal fixture).
        { id: 'fac_backwards', kind: 'factor', label: 'Word of mouth', observed_state: { value: 0.3, source: 'brief_extraction' } },
      ],
      edges: [['opt_raise', 'fac_price'], ['fac_price', 'goal_mrr'], ['fac_churn', 'goal_mrr'], ['fac_backwards', 'opt_raise']]
        .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

let persisted: unknown = pricingGraph();
let receiptFor: ((write: Record<string, unknown>) => Record<string, unknown>) | undefined;
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    // The door verifies its OWN row and fact through these (as `route-v2-option-intervention-edit.test.ts` models them).
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-26T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-26T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id, ...(receiptFor !== undefined ? { modelVersionReceipt: receiptFor(write) } : {}) };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};

describe('a starting point — values and a level — is ONE commit or NONE, through the real door', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => {
    persisted = pricingGraph();
    rows.clear();
    receiptFor = (write) => ({
      mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', version_number: 7,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
      parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-compound',
      graph: write.graph, source_turn_id: write.turn_id,
    });
  });

  /**
   * The Agent over this harness. Reads return the persisted graph. `/graph/register` is the whole-graph writer it is on
   * staging: it persists the caller's graph as its OWN commit (a row) — so a second write path is visible as a second row.
   */
  const agent = (opts: { beforeCommit?: () => void; afterCommit?: () => void } = {}) => {
    const store = new ProposalStore();
    const d = async (path: string, body?: unknown) => {
      if (path.endsWith('/graph/register')) {
        const b = body as { graph: unknown; expected_graph_hash?: string; operation_id?: string };
        if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== currentHash()) return { status: 409, json: { code: 'GRAPH_STALE' } };
        persisted = b.graph;
        rows.set(`register/${String(b.operation_id)}`, { id: `row-${rows.size + 1}`, write: { scenario_id: SCENARIO_ID, turn_id: String(b.operation_id), graph: b.graph } });
        return { status: 200, json: { graph_hash: currentHash() } };
      }
      return { status: 200, json: { graph: persisted, graph_hash: currentHash() } };
    };
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: async (input) => {
        opts.beforeCommit?.();
        const result = await commitOptionLevelsInProcess(input, 'req-agent');
        opts.afterCommit?.();
        return result;
      },
    });
    return { caps, store, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: 'Use a starting point.' } };
  };
  const nodeOf = (id: string) => (persisted as { nodes: { id: string; observed_state?: Record<string, unknown>; interventions?: Record<string, Record<string, unknown>> }[] }).nodes.find((n) => n.id === id)!;

  it('RED: success — churn\'s starting value and the raise option\'s level land in ONE commit, with ONE receipt', async () => {
    const { caps, ctx } = agent();
    const before = currentHash();
    const p = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 5, unit: '%', basis: 'a typical SaaS churn' }],
      option_levels: [{ option_label: RAISE, factor_label: 'Pro plan monthly price', value: 59, basis: 'the option\'s own name' }],
    });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'the values and the level are ONE commit').toBe(1);
    expect(currentHash()).not.toBe(before);
    expect(nodeOf('fac_churn').observed_state, 'the starting value is on the model').toBeDefined();
    expect(nodeOf('opt_raise').interventions?.fac_price?.value).toBe(59 / 200);
    expect((out.receipts as unknown[] | undefined)?.length, JSON.stringify(out.receipts)).toBe(1);
  });

  it('RED: a refused level → NOTHING is written, the starting value included (never partially applied)', async () => {
    const { caps, ctx } = agent();
    const before = JSON.stringify(persisted);
    const p = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 5, unit: '%', basis: 'a typical SaaS churn' }],
      option_levels: [
        { option_label: RAISE, factor_label: 'Pro plan monthly price', value: 59, basis: 'the option\'s own name' },
        { option_label: RAISE, factor_label: 'Word of mouth', value: 0.4, basis: 'a guess' },
      ],
    });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.mutated, JSON.stringify(out)).toBe(false);
    expect(out.refusal).not.toBe('partially_applied');
    expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted), 'the model is exactly as approved against').toBe(before);
  });

  const GAP = { unresolved_targets: ['billable seat basis'], user_questions: ['Which seats are billable?'] };
  type GappedGraph = { nodes: (Record<string, unknown> & { id: string })[]; options?: (Record<string, unknown> & { id: string })[] };
  const carriers = () => {
    const graph = persisted as GappedGraph;
    return [graph.nodes.find(n => n.id === 'opt_raise')!, ...(graph.options ?? []).filter(o => o.id === 'opt_raise')];
  };
  function withGap(where: 'both' | 'mirror' | 'node' = 'both') {
    const graph = structuredClone(pricingGraph()) as unknown as GappedGraph;
    const node = graph.nodes.find(n => n.id === 'opt_raise')!;
    node.interventions = { fac_price: { value: 0.245, source: 'cee_hypothesis', target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' } } };
    persisted = projectGraphForPersistence(graph);
    const rows = carriers();
    if (where !== 'mirror') Object.assign(rows[0]!, structuredClone(GAP));
    if (where !== 'node') Object.assign(rows[1]!, structuredClone(GAP));
    expect(projectGraphForPersistence(persisted)).toEqual(persisted);
  }
  const clearLevel = () => ({ option_label: RAISE, factor_label: 'Pro plan monthly price', value: 49, basis: 'Keep the same level; resolve the stated gap', unmodelled_mechanisms: [] as string[] });

  it.each([
    ['81 characters', ['x'.repeat(81)]], ['six entries', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['non-string', [42]], ['blank', [' ']], ['non-array', 'effect'], ['mixed', ['valid', null]],
    ['null', null], ['present undefined', undefined],
  ])('malformed %s refuses the entire starting-point offer before any proposal or write', async (_name, value) => {
    withGap('mirror'); const before = JSON.stringify(persisted);
    const { caps, store, ctx } = agent(); const put = vi.spyOn(store, 'put');
    const level = { ...clearLevel(), unmodelled_mechanisms: value };
    const result = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 5, unit: '%', basis: 'a starting assumption' }],
      option_levels: [clearLevel(), level as never],
    });
    expect(result.ok).toBe(false); expect(put).not.toHaveBeenCalled(); expect(rows.size).toBe(0);
    expect(JSON.stringify(persisted)).toBe(before);
  });

  it('conflicting repeated declarations refuse before either starting-point half is proposed', async () => {
    withGap(); const { caps, store, ctx } = agent(); const put = vi.spyOn(store, 'put');
    const result = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 5, unit: '%', basis: 'a starting assumption' }],
      option_levels: [clearLevel(), { ...clearLevel(), unmodelled_mechanisms: ['another effect'] }],
    });
    expect(result).toMatchObject({ ok: false, refusal: 'conflicting_option_gap_declarations' });
    expect(put).not.toHaveBeenCalled(); expect(rows.size).toBe(0);
  });

  it.each(['both', 'mirror', 'node'] as const)('same-level %s clearance carries exact operands on the card and lands through ONE real commit/receipt', async where => {
    withGap(where); const before = structuredClone(persisted) as GappedGraph;
    const { caps, store, ctx } = agent();
    const offered = await caps.proposeOptionInterventions(ctx, { interventions: [clearLevel()] });
    expect(offered.ok, JSON.stringify(offered)).toBe(true); expect(rows.size).toBe(0);
    const proposal = store.get(String(offered.proposal_id))!;
    expect(proposal.operations[0]?.value).toMatchObject({ unmodelled_mechanisms: [] });
    expect(proposal.public_label).toContain(RAISE); expect(proposal.public_label).toContain(GAP.unresolved_targets[0]);
    expect(proposal.public_label).toContain(GAP.user_questions[0]);
    const [chip] = approvalChipsFor([{ name: 'propose_option_interventions', ok: true, mutated: false, proposal_id: proposal.proposal_id }], () => ({ proposal, result: offered }));
    expect(chip?.detail).toBe(proposal.public_label);
    const result = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, applied: true, public_label: proposal.public_label });
    expect(rows.size).toBe(1); expect(result.receipts).toHaveLength(1);
    expect(optionGapsHeld(persisted, [{ optionId: 'opt_raise', mechanisms: [] }])).toBe(true);
    for (const row of [...before.nodes, ...(before.options ?? [])]) if (row.id === 'opt_raise') {
      delete row.unresolved_targets; delete row.user_questions;
    }
    expect(persisted).toEqual(before); // In particular, the unchanged cell keeps its source.
    const retry = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    expect(retry).toMatchObject({ applied: true, already_applied: true }); expect(rows.size).toBe(1);
  });

  it('malformed approved operation bytes refuse before any compound part is prepared or written', async () => {
    withGap(); const { caps, ctx, store } = agent();
    const offered = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 5, unit: '%', basis: 'a starting assumption' }],
      option_levels: [clearLevel()],
    });
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    const proposal = store.get(String(offered.proposal_id))!;
    // Emulate an older producer's malformed but integrity-bound stored proposal,
    // so the operation validator (rather than the tamper guard) must refuse it.
    const { proposal_id: _oldId, ...content } = structuredClone(proposal);
    const operation = content.operations.find(o => o.op === 'set_option_intervention')!;
    (operation.value as Record<string, unknown>).unmodelled_mechanisms = ['valid', null];
    store.discard(proposal.proposal_id);
    const malformed = store.put(createProposal(content));
    const before = structuredClone(persisted);
    const result = await caps.authoriseChange(ctx, { proposal_id: malformed.proposal_id });
    expect(result).toMatchObject({ applied: false, mutated: false, reason: 'invalid_mechanism' });
    expect(persisted).toEqual(before); expect(rows.size).toBe(0);
    expect(store.outstanding(SCENARIO_ID, 'user-a')).toHaveLength(1);
  });

  it('a changed question after offer refuses even though the analytical hash is unchanged', async () => {
    withGap(); const { caps, ctx } = agent();
    const p = await caps.proposeOptionInterventions(ctx, { interventions: [clearLevel()] });
    const hash = currentHash(); carriers()[1]!.user_questions = ['A different retained question'];
    expect(currentHash()).toBe(hash);
    expect(await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) }))
      .toMatchObject({ applied: false, reason: 'gap_statement_changed_since_approval' });
    expect(rows.size).toBe(0);
  });

  it('a changed question between approval read and writer read refuses before append', async () => {
    withGap(); const { caps, ctx } = agent({ beforeCommit: () => { carriers()[1]!.user_questions = ['Concurrent question']; } });
    const p = await caps.proposeOptionInterventions(ctx, { interventions: [clearLevel()] });
    const result = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(result).toMatchObject({ applied: false, mutated: false }); expect(rows.size).toBe(0);
    expect(carriers()[1]!.user_questions).toEqual(['Concurrent question']);
  });

  it('stale mirror after the commit never marks the proposal applied', async () => {
    withGap(); const { caps, ctx, store } = agent({ afterCommit: () => { Object.assign(carriers()[1]!, GAP); } });
    const p = await caps.proposeOptionInterventions(ctx, { interventions: [clearLevel()] });
    const result = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(result).toMatchObject({ applied: false, refusal: 'not_verified' });
    expect(store.outstanding(SCENARIO_ID, 'user-a')).toHaveLength(1);
  });

  it('a non-empty declaration and a numerical change use the same ONE compound door', async () => {
    withGap(); const { caps, ctx } = agent();
    const p = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 5, unit: '%', basis: 'a starting assumption' }],
      option_levels: [{ ...clearLevel(), value: 59, unmodelled_mechanisms: ['  support   demand ', 'Support demand'] }],
    });
    expect(p.ok, JSON.stringify(p)).toBe(true); expect(String(p.public_label)).toContain('support demand');
    const result = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(result, JSON.stringify(result)).toMatchObject({ applied: true }); expect(rows.size).toBe(1);
    expect(optionGapsHeld(persisted, [{ optionId: 'opt_raise', mechanisms: ['support demand'] }])).toBe(true);
  });

});
