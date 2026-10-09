/**
 * Shared real-route harness. Doubles ONLY: getSessionStore storage port and the internal
 * POST scenario/graph snapshot read port. Fetch is intercepted at the provider boundary;
 * replies are transport fixtures, never a model/projection/capability replacement.
 * Config is configured directly, not mocked. Every unexpected URL throws before I/O.
 */
import { expect, vi } from 'vitest';
import Fastify from 'fastify';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export type Obj = Record<string, unknown>;
export const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export interface Seed {
  scenario_id: string; revision: string; captured_execution_run_id: string;
  captured_run_reference: string; computed_at: string; snapshot: Snapshot;
}
export interface Snapshot extends Obj {
  scenario_id: string; graph: { nodes: Obj[]; edges: Obj[] }; graph_hash: string;
  analysis_state: Obj & { run_state: Obj }; analysis_result: Obj & { enrichment: Obj };
  current_read: Obj; analysis_admission: unknown;
}
export interface Expectations {
  goal_id: string; option_id: string; chance_display: string; driver_sentence: string;
  probability: number; synthetic_scenario_revision: number; synthetic_run_revision: number;
}
export type Turn = 'ordinary-converse' | 'selected-converse' | 'chip-converse' | 'drawn-link' | 'pre-mortem' | 'widen-options' | 'widen-risks' | 'Run-explanation' | 'tool-continuation';
export type Variant = 'run1' | 'run2' | 'withheld' | 'unlicensed-driver' | 'raw-probe' | 'stale' | 'current';
export interface Captured { sentBody: string; sha256: string; body: Obj; payloads: unknown[] }
export interface Witness { calls: Captured[]; state: Obj; response: Obj; seed: Seed; variant: Variant }
const ports = vi.hoisted(() => ({ store: {} as Obj }));
vi.mock('../../../orchestrator-v5/session/index.js', async original => ({
  ...await original<typeof import('../../../orchestrator-v5/session/index.js')>(), getSessionStore: () => ports.store,
}));
export const expected = JSON.parse(readFileSync(new URL('./fixtures/expectations.json', import.meta.url), 'utf8')) as Expectations;
export const seedOf = (name: 'run1' | 'run2'): Seed => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Seed;
/** Opt-in evidence directory for exact provider bodies; unset in CI. */
export const captureDir: string | undefined = process.env.S8_CAPTURE_DIR;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Decode only strings from the exact provider body, including tool-result JSON. */
function payloadsOf(body: Obj): unknown[] {
  const decoded: unknown[] = [];
  for (const input of array(body.input)) {
    const item = object(input);
    const texts = typeof item.output === 'string' ? [item.output]
      : typeof item.content === 'string' ? [item.content] : array(item.content).map(v => object(v).text);
    for (const text of texts) {
      if (typeof text !== 'string') continue;
      const start = text.indexOf('{');
      if (start < 0) continue;
      try { decoded.push(JSON.parse(text.slice(start))); } catch { /* non-JSON instructions/words */ }
    }
  }
  return decoded;
}
export function findState(payloads: unknown[]): Obj {
  for (const p of payloads) {
    const value = object(p);
    if ('graph_revision' in value && 'entities' in value) return value;
    const nested = object(value.canonical_state);
    if ('entities' in nested) return nested;
  }
  // Explain uses the selected Run's own projection, with a different input envelope.
  return object(payloads.find(p => 'request' in object(p) && 'result' in object(p)));
}
export function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  return Object.entries(object(value)).flatMap(([key, v]) => [key, ...keysDeep(v)]);
}
export function valueAt(payloads: unknown[], key: string): unknown[] {
  if (Array.isArray(payloads)) return payloads.flatMap(v => {
    if (Array.isArray(v)) return valueAt(v, key);
    return Object.entries(object(v)).flatMap(([k, x]) => [...(k === key ? [x] : []), ...valueAt([x], key)]);
  });
  return [];
}

function fixture(variant: Variant): Seed {
  const seed = structuredClone(seedOf(variant === 'run1' ? 'run1' : 'run2'));
  const s = seed.snapshot, e = s.analysis_result.enrichment;
  // These identity carriers are deliberately SYNTHETIC contract probes, not captured DB facts.
  // Known execution ids and hashes remain the prior run1/run2 capture values.
  s.selected_run_id = seed.captured_execution_run_id;
  s.scenario_revision = expected.synthetic_scenario_revision;
  s.selected_run_revision = expected.synthetic_run_revision;
  s.selected_goal_id = expected.goal_id;
  if (variant === 'withheld') {
    const licence = array(e.inference_warnings).map(object).find(w => w.code === 'GOAL_CHANCE_LICENSED');
    if (!licence) throw new Error('capture has no licence');
    e.inference_warnings = [...array(e.inference_warnings), { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', option_ids: [expected.option_id], message: 'CONTRACT withheld option', severity: 'warning' }];
  }
  if (variant === 'unlicensed-driver') {
    const licence = array(e.inference_warnings).map(object).find(w => w.code === 'GOAL_CHANCE_LICENSED');
    if (!licence) throw new Error('capture has no licence');
    delete licence.driver_by_option;
    licence.no_driver_by_option = { keep_49_price: 'below_resolution', raise_price_to_59: 'none' };
    // Raw resolved rows remain in option_comparison: they may not become a licensed sentence.
  }
  if (variant === 'raw-probe' || variant === 'current' || variant === 'stale') {
    e.pct_by_option = { raise_price_to_59: 987654321 };
    e.driver_by_option = { raise_price_to_59: 'CONTRACT_RAW_DRIVER_987654321' };
    e.warnings = [{ message: 'CONTRACT_RAW_WARNING_987654321' }];
    e.flip_thresholds = [{ factor_id: 'monthly_pro_churn', factor_label: 'Monthly Pro churn', current_value: 3, flip_value: 4.2, value_scale: 'display', unit: '%' }];
    e.flip_thresholds_status = 'computed';
  }
  if (variant === 'stale') {
    // A genuinely changed analysis-affecting graph (not a swapped hash string alone).
    const edge = s.graph.edges.find(v => typeof object(v.strength).mean === 'number');
    if (!edge) throw new Error('capture has no sized edge');
    edge.strength = { ...object(edge.strength), mean: Number(object(edge.strength).mean) + 0.137 };
    s.scenario_revision = expected.synthetic_scenario_revision + 1;
    s.analysis_state = { ...s.analysis_state, run_state: { ...s.analysis_state.run_state, kind: 'complete_stale', cause: 'graph_changed' }, requires_rerun: true, usable_for_prose: false, usable_for_followup: false, usable_for_chips: false };
    const ready = object(s.current_read.analysis_ready);
    s.current_read = { ...s.current_read, analysis_ready: { ...ready, freshness: 'stale', freshness_reason: 'graph_changed' } };
  }
  return seed;
}

export async function capture(turn: Turn, variant: Variant, options: {
  expectedProviderCalls?: number;
  storage?: Obj;
  readSnapshot?: (snapshot: Snapshot) => Promise<Obj>;
} = {}): Promise<Witness> {
  vi.resetModules();
  const { config } = await import('../../../config/index.js');
  config.auth.requireUserJwt = false;
  config.proxy.agentLaneEnabled = true;
  config.proxy.agentLanePreview = false;
  const { agentV1TurnRoute } = await import('../../agent-v1-turn.js');
  const { computeAnalysisAffectingGraphHash } = await import('../../../orchestrator-v5/context/graph-hash.js');
  const { GraphStateIngressSchema } = await import('../../../orchestrator-v5/boundary/request-extensions.js');
  const { planPickChipId } = await import('../../../orchestrator-v5/agent-lane/method-turn/method-turn.js');
  const seed = fixture(variant), snapshot = seed.snapshot;
  if (variant === 'stale') {
    const changedHash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(snapshot.graph));
    if (changedHash === null) throw new Error('stale capture has no graph hash');
    snapshot.graph_hash = changedHash;
    expect(snapshot.graph_hash).not.toBe(seed.revision);
    expect(snapshot.analysis_result.computed_against_hash).toBe(seed.revision);
  }
  const read = <T>(value: T) => vi.fn(async () => structuredClone(value));
  ports.store = {
    readRecent: read([]), readFactsFor: read([]), readFactsWithTurnFor: read([]),
    readScenarioRunAnalysisFactsFor: read({ facts: [], total_count: 0 }),
    readMostRecentPendingActions: read([]), readLatestAnswerOffers: read(null),
    readCommittedTurn: read(null), readGuidanceHistory: read({}),
    readExistingScenario: read({ userId: null, graph: snapshot.graph, briefText: null, analysisInvalidatedAt: null, revision: snapshot.scenario_revision }),
    append: read({ id: 'context-contract-memory-only' }),
    ...options.storage,
  };
  const calls: Captured[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body?: unknown } | undefined) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') throw new Error(`NETWORK FORBIDDEN: ${String(url)}`);
    if (typeof init?.body !== 'string') throw new Error('expected exact serialized body');
    const sentBody = init.body, body = JSON.parse(sentBody) as Obj;
    calls.push({ sentBody, sha256: sha(sentBody), body, payloads: payloadsOf(body) });
    const output = turn === 'tool-continuation' && calls.length === 1
      ? [{ type: 'function_call', call_id: 'contract-read-1', name: 'get_canonical_state', arguments: '{}' }]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Offline contract reply.' }] }];
    return new Response(JSON.stringify({ status: 'completed', output }), { status: 200 });
  }));
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:scenario/graph', async req => {
    expect(object(req.params).scenario).toBe(seed.scenario_id);
    return options.readSnapshot ? options.readSnapshot(structuredClone(snapshot)) : structuredClone(snapshot);
  });
  await app.register(agentV1TurnRoute);
  const payload: Obj = { kind: 'message', scenario_id: seed.scenario_id, agent_session_id: `sess_${seed.scenario_id}`, message: 'What does this mean for my decision?' };
  if (turn === 'selected-converse') payload.selected_elements = [{ id: 'monthly_pro_churn', kind: 'factor', label: 'Monthly Pro churn' }];
  if (turn === 'chip-converse') payload.chip = { id: 'agent-talk-it-through', action_type: 'discuss' };
  if (turn === 'drawn-link') payload.chip = { id: 'agent-drawn-link:pro_price>monthly_pro_churn' };
  if (turn === 'pre-mortem') { payload.chip = { id: planPickChipId(expected.option_id) }; payload.message = 'Run a pre-mortem on Raise price to £59.'; }
  if (turn === 'widen-options') { payload.chip = { id: 'ask:widen' }; payload.message = 'What other ways could we reach the goal?'; }
  if (turn === 'widen-risks') { payload.chip = { id: 'ask:risks' }; payload.message = 'What risks should we consider?'; }
  if (turn === 'Run-explanation') { payload.chip = { id: seed.captured_run_reference }; payload.message = 'Explain this result'; }
  try {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(res.statusCode, res.body).toBe(200);
    const response = JSON.parse(res.body) as Obj;
    if (turn === 'Run-explanation' && variant === 'stale') expect(calls).toHaveLength(0);
    else expect(calls).toHaveLength(options.expectedProviderCalls ?? (turn === 'tool-continuation' ? 2 : 1));
    // Evidence capture is opt-in (S8_CAPTURE_DIR); CI writes nothing.
    const dir = captureDir === undefined ? undefined : `${captureDir}/provider/${turn}/${variant}`;
    if (dir !== undefined) mkdirSync(dir, { recursive: true });
    calls.forEach((c, i) => {
      if (dir !== undefined) {
        writeFileSync(`${dir}/${i + 1}.sentBody.json`, c.sentBody);
        writeFileSync(`${dir}/${i + 1}.sha256`, `${c.sha256}\n`);
      }
      expect(JSON.parse(c.sentBody)).toEqual(c.body);
      expect(c.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
    if (dir !== undefined) writeFileSync(`${dir}/route-response.json`, res.body);
    const state = findState(calls.flatMap(c => c.payloads));
    return { calls, state, response, seed, variant };
  } finally { await app.close(); vi.unstubAllGlobals(); }
}
