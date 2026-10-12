/**
 * ⛔ THE CANVAS EDIT KEEPS THE USER'S FIGURE THROUGH THE DISPATCHED PATH (SYS3 L4, #94 6115410093).
 *
 * Served CEE 50530b5f, marketing journey (`recovery/live/runs/_smoke-rows-marketing`): the option card's editor set
 * "Marketing manager headcount" on "Hire marketing manager" from 1 to 2 people. The card sends the model scale
 * (`option_intervention_edit`, value 0.4 on the factor's declared range of 5). The cell that held `raw_value: 1` was
 * stored as a bare `{ value: 0.4, source: 'user_specified' }`, and the reply said "now has an effect value of 0.4".
 *
 * The writer already reads a canvas level on the factor's declared range (`canvas-level-edit-keeps-the-figure.test.ts`,
 * which calls the writer directly). The dispatched path turned that off for every target (#2919's batch rule), so the
 * served edit lost the figure while that spec stayed green. These cases drive the REAL dispatch over the REAL route,
 * from the captured pre-edit graph.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../../tools/plot-intervention-scale.js';

const CAPTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/marketing-canvas-edit-before-50530b5f.json', import.meta.url)), 'utf8')) as
  { graph_hash: string; graph: { nodes: Record<string, unknown>[] } };
const OPTION = 'hire_marketing_manager';
const FACTOR = 'marketing_manager_headcount';

/** JSONB's object key order (shorter keys first, then bytewise), applied recursively: the cold-reopen read. */
function jsonbRoundTrip(value: unknown): unknown {
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map(k => [k, order((v as Record<string, unknown>)[k])]))
      : v;
  return order(JSON.parse(JSON.stringify(value)));
}

let persisted: unknown = structuredClone(CAPTURE.graph);
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-10-11T23:52:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-10-11T23:52:00.000Z', fact: jsonbRoundTrip(fact) }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
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
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
const { commitOptionLevelsInProcess } = await import('../dispatch.js');

const SCENARIO_ID = 'ef04e3b9-8be1-490f-a6dd-e9d28c29e40e';
let turnCounter = 0;
const turnId = () => `66666666-6666-4666-8666-6666666667${String(++turnCounter).padStart(2, '0')}`;
const currentHash = () => computeAnalysisAffectingGraphHash(persisted as never)!;
const nodeOf = (graph: unknown, id: string) => (graph as { nodes: Record<string, unknown>[] }).nodes.find(n => n.id === id)!;
const cellOf = (graph: unknown) => (nodeOf(graph, OPTION).interventions as Record<string, Record<string, unknown>>)[FACTOR]!;
/** The engine quantity CEE ships to PLoT for that cell (`run_analysis` egress), on the graph's own factor scale map. */
const shipped = (graph: unknown, cell: unknown) =>
  resolveRawInterventionValue(cell, buildFactorScaleMap((graph as { nodes: unknown }).nodes).get(FACTOR));

describe('the canvas edit keeps the user\'s figure through dispatch (served marketing: 1 → 2 people on a range of 5)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    persisted = structuredClone(CAPTURE.graph);
    rows.clear();
  });
  const edit = (value: number) => app.inject({
    method: 'POST', url: '/orchestrate/v2/turn',
    payload: { kind: 'system_event', turn_id: turnId(), scenario_id: SCENARIO_ID, stage: 'analyse',
      event: { kind: 'option_intervention_edit', option_id: OPTION, factor_id: FACTOR, value, base_graph_hash: currentHash() } },
  });

  it('the fixture IS the served pre-edit model: its hash is the base the card sent (f7bfc4f3d1e336ab)', () => {
    expect(computeAnalysisAffectingGraphHash(CAPTURE.graph as never)).toBe(CAPTURE.graph_hash);
    expect(cellOf(CAPTURE.graph)).toMatchObject({ value: 0.2, raw_value: 1, unit: 'people', source: 'cee_hypothesis' });
    expect(nodeOf(CAPTURE.graph, FACTOR)).toMatchObject({ scale_frame: 5 });
  });

  it('RED (served): the card\'s 0.4 is stored WITH the 2 people it shows, as the user\'s, and survives a cold reopen', async () => {
    const res = await edit(0.4);
    expect(res.statusCode, res.body).toBe(200);
    expect(rows.size).toBe(1);
    const reopened = jsonbRoundTrip(persisted);
    expect(cellOf(reopened), JSON.stringify(cellOf(reopened))).toMatchObject({ value: 0.4, raw_value: 2, cap: 5, unit: 'people', source: 'user_specified' });
  });

  it('RED (served): the reply says 2 people, never "an effect value of 0.4"', async () => {
    const res = await edit(0.4);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('now sets \\"Marketing manager headcount\\" to 2');
    expect(res.body).not.toMatch(/effect value of 0\.4/);
  });

  it('EGRESS (the predicted defect, reproduced on CEE\'s side): a bare 0.4 ships 0.4 (`no_cap`); the stored figure ships 2', async () => {
    // The served cell shape: the factor declares only `scale_frame`, so a bare model value passes through unscaled,
    // while the pre-edit cell (raw 1) shipped 1. After the edit PLoT would be sent 0.4, not the user's 2.
    expect(shipped(CAPTURE.graph, { value: 0.4, source: 'user_specified' })).toMatchObject({ value: 0.4, rule: 'no_cap' });
    expect(shipped(CAPTURE.graph, cellOf(CAPTURE.graph))).toMatchObject({ value: 1, rule: 'raw_value_used' });
    const res = await edit(0.4);
    expect(res.statusCode, res.body).toBe(200);
    expect(shipped(persisted, cellOf(persisted))).toMatchObject({ value: 2, rule: 'raw_value_used' });
  });

  it('CONTROL: a same-value repeat on the canvas writes nothing', async () => {
    const res = await edit(0.2);
    expect(res.statusCode, res.body).toBe(200);
    expect(rows.size).toBe(0);
    expect(cellOf(persisted)).toMatchObject({ value: 0.2, raw_value: 1, source: 'cee_hypothesis' });
  });

  it('ADVERSE (#2919 kept): the Agent\'s in-process level with no figure still writes no figure and no range', async () => {
    const r = await commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, turn_id: turnId(), base_graph_hash: currentHash(), links: [],
      levels: [{ option_id: OPTION, factor_id: FACTOR, value: 0.4, author: 'user_specified' }] }, 'req-agent');
    expect(r.status, JSON.stringify(r)).toBe('committed');
    const cell = cellOf(persisted);
    expect(cell).toMatchObject({ value: 0.4, source: 'user_specified' });
    expect('raw_value' in cell || 'cap' in cell, JSON.stringify(cell)).toBe(false);
  });
});
