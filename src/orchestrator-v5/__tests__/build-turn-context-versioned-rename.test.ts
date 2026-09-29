import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { config } from '../../config/index.js';
import { buildTurnContext, type BuildTurnContextOptions } from '../build-turn-context.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { assembleContextPack, assembleContextPackWithSummary } from '../context/context-pack-assembler.js';
import { overBudgetCompactGraph, priorTurnsFixture } from '../context/__tests__/context-budget-fixtures.js';
import { RecentMutationSchema } from '../context/context-pack-schema.js';
import { computeGraphIdentityHash, computeVersionAnalysisAffectingHashRecord } from '../context/graph-identity.js';
import type { ModelVersionRecord } from '../model-management/types.js';
import type { IdentifiedHandlerFact } from '../types/handler-fact.js';
import type { CommittedMutationTurnRef } from '../types/recent-mutation-transition.js';
import { buildUserMessage, CONTEXT_BUDGET_INSTRUCTION } from '../routing/route-with-tool-use.js';
import { tryStateQueryGuard } from '../routing/state-query-guard.js';
import { makeMessagePayload } from './fixtures.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../tests/utils/mock-session-store.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const OLD = 'Engineer interruption rate';
const NEW = 'Unplanned engineer interruptions';
const message = 'What did that update do?';
const payload = makeMessagePayload({ scenario_id: SCENARIO, message });
const ref: CommittedMutationTurnRef = {
  conversation_row_id: 'parent-row', source_turn_id: 'source-user-turn',
  scenario_id: SCENARIO, owner_user_id: OWNER, mutation_id: 'accepted-mutation',
};

function version(id: string, label: string, parentId: string | null): ModelVersionRecord {
  const graph: GraphStateIngress = {
    nodes: [{ id: 'factor-load', kind: 'factor', label, observed_state: { value: 0.5 } }],
    edges: [],
  };
  const full = computeGraphIdentityHash(graph);
  const analysis = computeVersionAnalysisAffectingHashRecord(graph);
  if (!full || !analysis) throw new Error('valid fixture hashes required');
  return {
    id, scenario_id: SCENARIO, owner_user_id: OWNER, version_number: parentId ? 2 : 1,
    graph, graph_identity_hash: full.value, analysis_affecting_hash: analysis.value,
    hash_algorithm: full.algorithm, identity_projection_version: full.projection_version,
    identity_normaliser_version: full.normaliser_version, graph_schema_version: full.graph_schema_version,
    mutation_id: parentId ? ref.mutation_id : 'initial-mutation', parent_version_id: parentId,
    root_version_id: 'version-before', actor_kind: 'known', authored_by: OWNER,
    creation_kind: parentId ? 'committed_mutation' : 'initial', source_version_id: null,
    source_turn_id: parentId ? ref.source_turn_id : 'initial-turn', label: null,
    provenance: null, restored_from_version_id: null, created_at: '2026-08-30T14:00:00Z',
  };
}

function receipt(): HandlerFact {
  return {
    fact_type: 'edit_graph', fact_version: 1, noop: false,
    result: {
      status: 'applied', edit_kind: 'parameter_update', operations_count: 1,
      affected_entities: [{ kind: 'factor', label: NEW }],
      graph_hash_before: 'before', graph_hash_after: 'after',
      safe_summary: 'Recorded an edit to the saved model.', impact: 'low', rerun_recommended: false,
    },
  };
}

function setup(options: { lineage?: boolean; before?: string; after?: string } = {}) {
  const parent = version('version-before', options.before ?? OLD, null);
  const child = version('version-after', options.after ?? NEW, parent.id);
  const facts: IdentifiedHandlerFact[] = [{
    fact: receipt(), fact_row_id: 'exact-receipt-row', fact_created_at: '2026-08-30T14:00:01Z',
    ...(options.lineage === false ? {} : { committed_turn_ref: ref }),
  }];
  const reader = {
    getVersionForCommittedTurn: vi.fn(async (_scenario: string, _turn: string, _mutation: string) => ({ status: 'ok' as const, value: child })),
    getVersion: vi.fn(async (_scenario: string, _version: string) => ({ status: 'ok' as const, value: parent })),
  } satisfies NonNullable<BuildTurnContextOptions['mutationVersionReader']>;
  const writes = vi.fn(async () => ({ id: 'unexpected-write' }));
  const durableRead = vi.fn(async () => structuredClone(facts));
  const store = () => createMockSessionStore({
    append: writes,
    countTurns: async () => 41,
    readRecent: async () => Array.from({ length: 20 }, (_, i) => makeSessionTurnRow({
      id: `neutral-${i}`, scenario_id: SCENARIO, turn_id: `neutral-user-${i}`,
    })),
    readFactsWithTurnFor: async () => [],
    readRecentAppliedMutationFactsFor: durableRead,
    loadGraphAndBriefText: async () => ({ graph: structuredClone(child.graph), briefText: null }),
  });
  const read = async () => {
    const context = await buildTurnContext(payload, 'versioned-rename-test', {
      sessionStore: store(), mutationVersionReader: reader,
    });
    const pack = assembleContextPackWithSummary({
      payload, priorTurns: context.prior_turns, priorTurnsTotal: context.prior_turns_total,
      priorFacts: context.prior_facts, priorFactsReadOk: context.prior_facts_read_ok,
    }).contextPack;
    return { context, pack, answer: tryStateQueryGuard({ message, contextPack: pack }) };
  };
  return { facts, parent, child, reader, writes, durableRead, read };
}

describe('durable versioned rename -> continuing reasoning', () => {
  const originalFlag = config.cee.modelVersionsEnabled;
  beforeEach(() => { config.cee.modelVersionsEnabled = true; });
  afterEach(() => { config.cee.modelVersionsEnabled = originalFlag; });

  it('uses the exact old mutation outside hot20, through fresh context/pack/prompt and effect answer', async () => {
    const f = setup();
    const source = structuredClone({ parent: f.parent, child: f.child, facts: f.facts });
    const first = await f.read();
    const cold = await f.read();
    expect(first.context.prior_facts).toEqual([]);
    expect(first.context.prior_facts.recent_changes_status).toBe('complete');
    expect(first.pack.recent_changes).toEqual([{
      action: 'graph_edited', transition: 'node_label_changed',
      summary: `Renamed "${OLD}" to "${NEW}".`, target_label: NEW,
    }]);
    expect(RecentMutationSchema.safeParse(first.pack.recent_changes[0]).success).toBe(true);
    expect(first.answer).toMatchObject({ matched: true, dispatch: 'with_recent_change' });
    if (!first.answer.matched) throw new Error('effect question must be admitted');
    expect(first.answer.assistant_text).toBe(`From the saved model history: Renamed "${OLD}" to "${NEW}".`);
    expect(cold.answer).toEqual(first.answer);
    const prompt = buildUserMessage(cold.pack, message);
    expect(prompt).toContain(OLD);
    expect(prompt).toContain(NEW);
    expect(prompt).toContain('node_label_changed');
    for (const hidden of [ref.conversation_row_id, ref.source_turn_id, ref.owner_user_id, ref.mutation_id]) {
      expect(prompt).not.toContain(hidden);
    }
    // The existing pack contains its scenario identity; the new edit slice
    // must not add any internal linkage or the unchanged numerical value.
    const editBytes = JSON.stringify(cold.pack.recent_changes);
    for (const hidden of Object.values(ref)) expect(editBytes).not.toContain(hidden);
    expect(editBytes).not.toContain('0.5');
    expect(f.reader.getVersionForCommittedTurn).toHaveBeenCalledWith(SCENARIO, ref.source_turn_id, ref.mutation_id);
    expect(f.reader.getVersion).toHaveBeenCalledWith(SCENARIO, f.parent.id);
    expect(f.durableRead).toHaveBeenCalledTimes(2); // one existing history query per fresh context
    expect(f.writes).not.toHaveBeenCalled();
    expect({ parent: f.parent, child: f.child, facts: f.facts }).toEqual(source);
  });

  it.each(['missing lineage', 'flag off', 'version read throws', 'wrong owner', 'wrong parent', 'extra value change'])(
    'retains the receipt/history and generic safety on %s', async (arm) => {
      const f = setup({ lineage: arm !== 'missing lineage' });
      if (arm === 'flag off') config.cee.modelVersionsEnabled = false;
      if (arm === 'version read throws') f.reader.getVersionForCommittedTurn.mockRejectedValue(new Error('unavailable'));
      if (arm === 'wrong owner') Object.assign(f.child, { owner_user_id: 'foreign-owner' });
      if (arm === 'wrong parent') Object.assign(f.child, { parent_version_id: 'wrong-parent' });
      if (arm === 'extra value change') Object.assign(f.child, { graph: {
        nodes: [{ id: 'factor-load', kind: 'factor', label: NEW, observed_state: { value: 0.9 } }], edges: [],
      } });
      const result = await f.read();
      expect(result.pack.recent_changes_status).toBe('complete');
      expect(result.pack.recent_changes).toHaveLength(1);
      expect(result.pack.recent_changes[0]?.action).toBe('graph_edited');
      expect(result.pack.recent_changes[0]?.transition).toBeUndefined();
      if (!result.answer.matched) throw new Error('expected existing guard');
      expect(result.answer.assistant_text).toContain('without guessing');
      expect(f.writes).not.toHaveBeenCalled();
      if (arm === 'flag off' || arm === 'missing lineage') expect(f.reader.getVersionForCommittedTurn).not.toHaveBeenCalled();
    });

  it('withholds long labels whole rather than presenting a partial label as exact', async () => {
    const f = setup({ before: 'Previous label '.repeat(10), after: 'Updated label '.repeat(10) });
    const { pack, answer } = await f.read();
    expect(pack.recent_changes[0]).toEqual({
      action: 'graph_edited', transition: 'node_label_changed',
      summary: 'Renamed a model element; its exact labels are withheld from this summary.',
      target_label: '',
    });
    expect(RecentMutationSchema.safeParse(pack.recent_changes[0]).success).toBe(true);
    if (!answer.matched) throw new Error('expected admitted effect question');
    expect(answer.assistant_text).not.toContain('Previous label');
    expect(answer.assistant_text).toContain('withheld');
  });

  it('retains the typed rename through actual graph and whole-pack budget cuts', async () => {
    const { context, pack: small } = await setup().read();
    const turns = priorTurnsFixture(22);
    const pack = assembleContextPack({
      payload, priorTurns: turns, priorTurnsTotal: 41,
      priorFacts: context.prior_facts, priorFactsReadOk: context.prior_facts_read_ok,
      compactedGraph: overBudgetCompactGraph(), compactedConstraints: null, analysis: null,
    });
    // Both cuts must actually occur; the typed historical fact is not graph
    // detail and does not inherit the graph's weaker display authority.
    expect(pack.context_budget?.truncations.map(cut => cut.section)).toContain('graph');
    expect(pack.conversation.recent_turns.length).toBeLessThan(turns.length);
    expect(pack.recent_changes).toEqual(small.recent_changes);
    expect(pack.recent_changes_status).toBe('complete');
    const prompt = buildUserMessage(pack, message);
    expect(prompt).toContain(CONTEXT_BUDGET_INSTRUCTION);
    expect(prompt).toContain('node_label_changed');
    expect(prompt).toContain(OLD);
    expect(prompt).toContain(NEW);
    const answer = tryStateQueryGuard({ message, contextPack: pack });
    expect(answer).toEqual(tryStateQueryGuard({ message, contextPack: small }));
  });

  it('keeps byte-identical receipts bound to their distinct occurrence IDs, not payloads', async () => {
    const f = setup();
    const laterRef = { ...ref, source_turn_id: 'later-user-turn', mutation_id: 'later-mutation' };
    const laterChild = {
      ...version('version-later', 'Interruptions under review', f.child.id),
      version_number: 3, source_turn_id: laterRef.source_turn_id, mutation_id: laterRef.mutation_id,
    };
    f.facts.push({
      fact: structuredClone(f.facts[0]!.fact), fact_row_id: 'later-receipt-row',
      fact_created_at: '2026-08-30T14:01:01Z', committed_turn_ref: laterRef,
    });
    expect(f.facts[0]!.fact).toEqual(f.facts[1]!.fact); // deliberately nondiscriminating payloads
    f.reader.getVersionForCommittedTurn.mockImplementation(async (_scenario, turn, mutation) => {
      expect([[ref.source_turn_id, ref.mutation_id], [laterRef.source_turn_id, laterRef.mutation_id]])
        .toContainEqual([turn, mutation]);
      return { status: 'ok', value: turn === laterRef.source_turn_id ? laterChild : f.child };
    });
    f.reader.getVersion.mockImplementation(async (_scenario, id) => ({
      status: 'ok', value: id === f.child.id ? f.child : f.parent,
    }));
    const { pack } = await f.read();
    expect(pack.recent_changes.map(change => change.summary)).toEqual([
      `Renamed "${NEW}" to "Interruptions under review".`,
      `Renamed "${OLD}" to "${NEW}".`,
    ]);
    expect(pack.recent_changes_status).toBe('complete');
    expect(f.reader.getVersionForCommittedTurn).toHaveBeenCalledTimes(2);
    expect(f.writes).not.toHaveBeenCalled();
  });

  it('never treats value-looking labels as numerical before/after values or units', async () => {
    const { answer } = await setup({ before: 'Budget £20k', after: 'Budget £50k' }).read();
    if (!answer.matched) throw new Error('expected admitted effect question');
    expect(answer.assistant_text).toBe('From the saved model history: Renamed "Budget £20k" to "Budget £50k".');
    expect(answer.assistant_text).not.toMatch(/increased|decreased|value|difference/);
  });
});
