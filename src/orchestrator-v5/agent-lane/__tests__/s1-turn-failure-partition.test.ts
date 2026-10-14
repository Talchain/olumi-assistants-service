/**
 * ⭐ S1, THE TURN FAILURE PARTITION (RCA 14 Oct 16:18Z, scenario c1494f4d; AIE amend #94 6173489813).
 *
 * Served: the model was registered (16:18:16.8Z), then the build tool's read-back of it ran under the turn cache's 5 s
 * read budget. The in-process /graph route shares that budget for its own analysis-fact read; that read hung, the route
 * degraded it to "analysis unavailable" and answered 200 with the saved model at 5,039 ms, but the outer read had thrown
 * `AnalysisReadDeadlineError` 39 ms earlier. No boundary caught a tool's throw, so the turn answered 502 over a saved model.
 *
 * Focused rows on the affected paths (no chaos programme): the draft turn's post-commit read, the one tool boundary
 * every turn type dispatches through, the late answer never cached, and the brand-new scenario's null-graph readback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { dispatchTool, STATE_READ_UNFINISHED, type AgentCapabilities } from '../runtime/agent-tools.js';
import { turnReadCache } from '../turn-read-cache.js';
import { ANALYSIS_REREAD_TIMEOUT_MS, AnalysisReadDeadlineError, withAnalysisReadDeadline } from '../../session/analysis-read-deadline.js';
import { readBackState } from '../../../routes/agent-v1-turn.js';
import { log } from '../../../utils/telemetry.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const GRAPH_PATH = `/assist/v1/scenarios/${SCENARIO}/graph`;
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-s1' };

const CANDIDATE = {
  goal: { metric: 'MRR', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [{ metric: 'Monthly churn', operator: '<', value: 4, unit: '%', provenance: 'explicit' }],
  options: [{ label: 'Raise Pro to £59', provenance: 'explicit', interventions: [] }],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' },
    { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed' },
  ],
  risks: [{ label: 'Churn rises', provenance: 'inferred' }],
  outcomes: [{ label: 'Monthly recurring revenue', provenance: 'inferred' }],
  links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};
const structured: CallStructuredModel = async () => ({ text: JSON.stringify(CANDIDATE) });
const SAVED = [{ id: 'mrr', kind: 'goal', label: 'MRR' }];

/**
 * The /graph route as served: before the model exists it answers at once; after the register, its analysis-fact read
 * (sharing the caller's read scope, as the in-process dispatch does) hangs until the scope is cut, and the route then
 * degrades it and answers the saved model with "analysis unavailable" (`analysis_state: null`). `graphHangs` models a
 * route whose own model read never settles.
 */
function servedRoute(opts: { graphHangs?: boolean } = {}) {
  let registered = false;
  const graphReads: number[] = [];
  const inner: InternalDispatch = async (path) => {
    if (path.endsWith('/graph/register')) { registered = true; return { status: 200, json: {} }; }
    if (path !== GRAPH_PATH) return { status: 200, json: {} };
    graphReads.push(Date.now());
    if (!registered) return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'before' } };
    if (opts.graphHangs) return new Promise(() => {});
    const analysis = await withAnalysisReadDeadline((signal) => new Promise<'read'>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('analysis_fact_query_failed')));
    })).catch(() => 'unavailable' as const);
    return { status: 200, json: { graph: { nodes: SAVED, edges: [] }, graph_hash: 'after', analysis_state: analysis === 'read' ? {} : null } };
  };
  return { cache: turnReadCache(inner, GRAPH_PATH), graphReads };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('S1: the draft turn\'s read-back after the model is saved', () => {
  it('⭐ RED→GREEN: the route\'s own degraded answer arrives inside the budget, so the build reports the saved model', async () => {
    const { cache } = servedRoute();
    const caps = createAgentCapabilities(cache.dispatch, new ProposalStore(), structured);
    let settled: Record<string, unknown> | Error | undefined;
    const run = dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'a brief' }), ctx, caps)
      .then((r) => { settled = r; }, (e: Error) => { settled = e; });
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    await run;
    expect(settled).not.toBeInstanceOf(Error);
    expect(settled).toMatchObject({ ok: true, mutated: true, confirmed_entities: 1, graph_revision: 'after' });
  });

  it('⭐ RED→GREEN: a read that never settles ends the tool call, not the turn: outcome unknown, never saved or failed', async () => {
    const { cache } = servedRoute({ graphHangs: true });
    const caps = createAgentCapabilities(cache.dispatch, new ProposalStore(), structured);
    let settled: Record<string, unknown> | Error | undefined;
    const run = dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'a brief' }), ctx, caps)
      .then((r) => { settled = r; }, (e: Error) => { settled = e; });
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    await run;
    expect(settled).not.toBeInstanceOf(Error);
    expect(settled).toMatchObject({ ok: false, mutated: false, refusal: STATE_READ_UNFINISHED, outcome_unknown: true });
    // Nothing confirmed from a read that never finished, and no claim about a Run.
    expect(settled).not.toHaveProperty('confirmed_entities');
    expect(JSON.stringify(settled)).not.toMatch(/\bno run\b|never (been )?(run|analysed)/i);
  });

  it('a late degraded answer is returned to its reader but never kept: the next reader reads again', async () => {
    const { cache, graphReads } = servedRoute();
    await cache.dispatch(`/assist/v1/scenarios/${SCENARIO}/graph/register`, {});
    const first = cache.dispatch(GRAPH_PATH, {});
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    expect(await first).toMatchObject({ status: 200, json: { graph_hash: 'after', analysis_state: null } });
    const second = cache.dispatch(GRAPH_PATH, {});
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    await second;
    expect(graphReads).toHaveLength(2);
  });
});

describe('S1: one tool boundary for every turn type that dispatches a tool', () => {
  const throwing = (err: Error) => new Proxy({}, { get: () => async () => { throw err; } }) as unknown as AgentCapabilities;
  const CALLS: readonly [string, string][] = [
    ['build_model_from_brief', JSON.stringify({ brief: 'a brief' })], // draft
    ['authorise_change', JSON.stringify({ proposal_id: 'p-1' })], // approve
    ['run_analysis', '{}'], // Run
    ['get_canonical_state', '{}'], // chat
  ];
  it.each(CALLS)('%s: a read that did not finish becomes a typed result, and is logged', async (name, args) => {
    const warn = vi.spyOn(log, 'warn');
    const r = await dispatchTool(name, args, ctx, throwing(new AnalysisReadDeadlineError()));
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: STATE_READ_UNFINISHED, outcome_unknown: true });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'agent_lane.tool_read_unfinished', tool: name }), expect.any(String));
  });
  it('CONTRAST: any other error keeps its own handling in the route (thrown, not absorbed)', async () => {
    const other = new Error('model read failed');
    await expect(dispatchTool('authorise_change', JSON.stringify({ proposal_id: 'p-1' }), ctx, throwing(other))).rejects.toBe(other);
  });
});

describe('S1: a brand-new scenario reads back with no model', () => {
  it('⭐ RED→GREEN: `graph: null` is no model, not a failed readback', async () => {
    const warn = vi.spyOn(log, 'warn');
    const read = await readBackState(async () => ({ status: 200, json: { graph: null, graph_hash: 'h-empty' } }), SCENARIO);
    expect(warn.mock.calls.filter(([fields]) => (fields as { event?: unknown }).event === 'agent_lane.state_readback_failed')).toHaveLength(0);
    expect(read.graphHash).toBe('h-empty');
    expect(read.draftGraph).toBeUndefined();
  });
  it('CONTRAST: a readback that really fails still says so', async () => {
    const warn = vi.spyOn(log, 'warn');
    await readBackState(async () => { throw new Error('graph read failed'); }, SCENARIO);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'agent_lane.state_readback_failed' }), expect.any(String));
  });
});
