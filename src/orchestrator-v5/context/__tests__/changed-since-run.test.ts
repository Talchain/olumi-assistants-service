/**
 * P48 (audit #27) — `changed_since_run`: what changed in the model since the last Run, by id.
 * Rows are bound by identity (exact ids, exact Run id), each with a same-family control that must stay unmarked.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  CHANGED_SINCE_RUN_READ_LIMIT,
  idsOfReceipt,
  newestRunBoundary,
  projectChangedSinceRun,
  readChangedSinceRun,
  type ChangedSinceRunReads,
} from '../changed-since-run.js';
import type { IdentifiedHandlerFact } from '../../types/handler-fact.js';

const RUN_AT = '2026-10-07T20:00:00.000Z';
let row = 0;
const at = (iso: string, fact: HandlerFact): IdentifiedHandlerFact => ({ fact, fact_row_id: `row-${row++}`, fact_created_at: iso });

const factorValue = (nodeId: string, noop = false) => ({
  fact_type: 'set_factor_value', fact_version: 1, noop,
  result: { target_id: nodeId, status: noop ? 'noop' : 'applied', before: { value: 1 }, after: { value: 2 } },
}) as unknown as HandlerFact;
const linkStrength = (from: string, to: string, refit: Array<{ from: string; to: string }> = []) => ({
  fact_type: 'adjust_edge_strength', fact_version: 1, noop: false,
  result: { target_id: `${from}→${to}`, status: 'applied', before: { from, to }, after: { from, to, strength: { mean: 0.5 }, ...(refit.length ? { frame_refit: refit } : {}) } },
}) as unknown as HandlerFact;
const limit = (nodeId: string) => ({
  fact_type: 'add_constraint', fact_version: 1, noop: false,
  result: { target_id: 'con_1', status: 'applied', before: null, after: { constraint_id: 'con_1', node_id: nodeId, operator: '<=', value: 200000 } },
}) as unknown as HandlerFact;
const editGraph = (entities: unknown[]) => ({
  fact_type: 'edit_graph', fact_version: 1, noop: false,
  result: { edit_kind: 'add_node', status: 'applied', operations_count: 1, affected_entities: entities, graph_hash_before: null, graph_hash_after: null, safe_summary: 'Added a risk.', impact: 'low', rerun_recommended: true },
}) as unknown as HandlerFact;
const runFact = (runId?: string) => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { ...(runId !== undefined ? { run_id: runId } : {}), graph_hash_at_run: 'aaaa', computed_at: RUN_AT },
}) as unknown as HandlerFact;

const BOUNDARY = { run_id: 'run_b', created_at: RUN_AT };

describe('projectChangedSinceRun', () => {
  it('marks exactly the factor changed AFTER the Run; one changed before it stays unmarked', () => {
    const out = projectChangedSinceRun([
      at('2026-10-07T20:05:00.000Z', factorValue('fac_price')),
      at('2026-10-07T19:55:00.000Z', factorValue('fac_cost')),
    ], BOUNDARY, false);
    expect(out).toEqual({ version: 1, since_run_id: 'run_b', node_ids: ['fac_price'], links: [], unattributed_changes: 0, complete: true });
  });

  it('a change recorded in the same instant as the Run belongs to that Run (not marked)', () => {
    const out = projectChangedSinceRun([at(RUN_AT, factorValue('fac_price'))], BOUNDARY, false);
    expect(out.node_ids).toEqual([]);
  });

  it('a newer Run clears every mark: the same receipts against a later boundary mark nothing', () => {
    const facts = [at('2026-10-07T20:05:00.000Z', factorValue('fac_price'))];
    expect(projectChangedSinceRun(facts, BOUNDARY, false).node_ids).toEqual(['fac_price']);
    const later = projectChangedSinceRun(facts, { run_id: 'run_c', created_at: '2026-10-07T20:10:00.000Z' }, false);
    expect(later.node_ids).toEqual([]);
    expect(later.since_run_id).toBe('run_c');
  });

  it('a link-strength edit marks its link and every link the frame refit moved', () => {
    const out = projectChangedSinceRun([
      at('2026-10-07T20:05:00.000Z', linkStrength('fac_price', 'out_rev', [{ from: 'fac_vol', to: 'out_rev' }])),
    ], BOUNDARY, false);
    expect(out.links).toEqual([{ from: 'fac_price', to: 'out_rev' }, { from: 'fac_vol', to: 'out_rev' }]);
    expect(out.node_ids).toEqual([]);
  });

  it('a limit marks its target node, never the constraint id', () => {
    const out = projectChangedSinceRun([at('2026-10-07T20:05:00.000Z', limit('fac_cost'))], BOUNDARY, false);
    expect(out.node_ids).toEqual(['fac_cost']);
  });

  it('an edit_graph receipt naming labels only is COUNTED, never matched by label', () => {
    const out = projectChangedSinceRun([
      at('2026-10-07T20:05:00.000Z', editGraph([{ kind: 'risk', label: 'Oven breaks down' }])),
      at('2026-10-07T20:04:00.000Z', factorValue('fac_price')),
    ], BOUNDARY, false);
    expect(out.unattributed_changes).toBe(1);
    expect(out.node_ids).toEqual(['fac_price']);
  });

  it('an edit_graph receipt carrying ids (schemas field) marks those ids', () => {
    const out = projectChangedSinceRun([
      at('2026-10-07T20:05:00.000Z', editGraph([{ kind: 'risk', label: 'Oven', id: 'risk_oven' }, { kind: 'edge', label: 'link', from: 'risk_oven', to: 'out_rev' }])),
    ], BOUNDARY, false);
    expect(out.node_ids).toEqual(['risk_oven']);
    expect(out.links).toEqual([{ from: 'risk_oven', to: 'out_rev' }]);
    expect(out.unattributed_changes).toBe(0);
  });

  it('a noop receipt marks nothing; its applied twin does', () => {
    expect(projectChangedSinceRun([at('2026-10-07T20:05:00.000Z', factorValue('fac_price', true))], BOUNDARY, false).node_ids).toEqual([]);
    expect(projectChangedSinceRun([at('2026-10-07T20:05:00.000Z', factorValue('fac_price', false))], BOUNDARY, false).node_ids).toEqual(['fac_price']);
  });

  it('a full window that never reaches the Run is NOT complete; one that reaches it is', () => {
    const facts = [at('2026-10-07T20:05:00.000Z', factorValue('fac_price'))];
    expect(projectChangedSinceRun(facts, BOUNDARY, true).complete).toBe(false);
    expect(projectChangedSinceRun([...facts, at('2026-10-07T19:00:00.000Z', factorValue('fac_cost'))], BOUNDARY, true).complete).toBe(true);
  });

  it('no Run yet: every applied receipt is since', () => {
    const out = projectChangedSinceRun([at('2026-10-07T20:05:00.000Z', factorValue('fac_price'))], null, false);
    expect(out.since_run_id).toBeNull();
    expect(out.node_ids).toEqual(['fac_price']);
  });
});

describe('idsOfReceipt', () => {
  it('names no ids for a fact outside the receipt class', () => {
    expect(idsOfReceipt(runFact('run_b'))).toBeNull();
  });
});

describe('newestRunBoundary', () => {
  it('takes the newest Run that carries an id', () => {
    expect(newestRunBoundary([
      at('2026-10-07T20:10:00.000Z', runFact()),
      at(RUN_AT, runFact('run_b')),
      at('2026-10-07T19:00:00.000Z', runFact('run_a')),
    ])).toEqual({ run_id: 'run_b', created_at: RUN_AT });
  });
});

describe('readChangedSinceRun', () => {
  const storeWith = (runFacts: IdentifiedHandlerFact[], receipts: IdentifiedHandlerFact[] | Error) => ({
    readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: runFacts, total_count: runFacts.length })),
    readRecentAppliedMutationFactsFor: vi.fn(async () => { if (receipts instanceof Error) throw receipts; return receipts; }),
  }) as unknown as ChangedSinceRunReads;

  it('reads the Run page and the receipts and projects them', async () => {
    const store = storeWith([at(RUN_AT, runFact('run_b'))], [at('2026-10-07T20:05:00.000Z', factorValue('fac_price'))]);
    const out = await readChangedSinceRun(store, 's1');
    expect(out?.node_ids).toEqual(['fac_price']);
    expect(store.readRecentAppliedMutationFactsFor).toHaveBeenCalledWith('s1', CHANGED_SINCE_RUN_READ_LIMIT);
  });

  it('a failed read answers undefined (the key is omitted), never an empty set', async () => {
    expect(await readChangedSinceRun(storeWith([], new Error('db')), 's1')).toBeUndefined();
  });

  it('Runs recorded but none with an id: undefined, never "everything ever changed"', async () => {
    const store = storeWith([at(RUN_AT, runFact())], [at('2026-10-07T19:05:00.000Z', factorValue('fac_price'))]);
    expect(await readChangedSinceRun(store, 's1')).toBeUndefined();
  });

  it('a store without the reads answers undefined', async () => {
    expect(await readChangedSinceRun({} as ChangedSinceRunReads, 's1')).toBeUndefined();
  });
});
