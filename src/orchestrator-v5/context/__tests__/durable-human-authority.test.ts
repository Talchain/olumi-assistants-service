import { verifiedOptionSetting } from '../../agent-lane/verified-option-setting.js';
import type { CandidateModel } from '../../agent-lane/admit-model.js';
import { withOriginalReceipt } from '../../agent-lane/__tests__/fixtures/original-receipt.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GraphV3, OptionV3 } from '../../../schemas/cee-v3.js';
import { _resetConfigCache } from '../../../config/index.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import type { IdentifiedHandlerFact } from '../../types/handler-fact.js';
import { __setUseAppendV6ForTest } from '../../session/supabase-store.js';
import { executeOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { readDurableHumanAuthority, DurableHandlerFactSchema, resolveDurableHumanAuthority, HUMAN_APPROVAL_READ_LIMIT } from '../durable-human-authority.js';
import { transformOptionToAnalysisReady } from '../../../cee/transforms/analysis-ready.js';
import { decideOptionCostAsk } from '../../coaching/decide-option-cost-ask.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { bindWriteCaller } from '../../ownership/door-ownership.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function graph() {
  return projectGraphForPersistence(GraphV3.parse({
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Choose service plan' },
      { id: 'goal', kind: 'goal', label: 'Service quality', goal_threshold: 0.8 },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly service spend',
        observed_state: { value: 0.4, raw_value: 400, cap: 1000, unit: 'GBP per month', source: 'user_override' } },
      ...['opt_raise', 'opt_hold'].map((id, i) => ({ id, kind: 'option', label: i ? 'Hold' : 'Pilot',
        interventions: { fac_churn: { value: i ? 0.7 : 0.2, raw_value: i ? 700 : 200,
          unit: 'GBP per month', source: 'cee_hypothesis',
          target_match: { node_id: 'fac_churn', match_type: 'exact_id', confidence: 'high' } } } })),
    ],
    edges: [['decision', 'opt_raise'], ['decision', 'opt_hold'], ['opt_raise', 'fac_churn'], ['opt_hold', 'fac_churn'], ['fac_churn', 'goal']]
      .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    goal_constraints: [{ constraint_id: 'gc_u2', node_id: 'fac_churn', operator: '<=', value: 500,
      unit: 'GBP per month', value_frame: 'level', provenance: 'explicit', label: 'Monthly service spend limit' }],
  }));
}
/** The actual atomic writer runs; only the database/transport is replaced by serialized storage. */
function storage(failWrite = false, legacy = false) {
  const initial = graph();
  if (legacy) initial.nodes.find(n => n.id === 'opt_raise')!.interventions!.fac_churn.source = 'user_specified';
  let bytes = JSON.stringify(initial), revision = 3;
  let saved: SessionTurnWrite | undefined;
  const fresh = () => createMockSessionStore({
    loadGraphAndBriefText: async () => ({ graph: JSON.parse(bytes), briefText: null, revision }),
    loadGraph: async () => JSON.parse(bytes),
    getScenarioOwner: async () => OWNER,
    append: async write => {
      if (failWrite) throw new Error('Write failed');
      if (write.expectedRevision !== revision) throw new Error('Stale revision');
      saved = JSON.parse(JSON.stringify(write));
      bytes = JSON.stringify(write.graph); revision += 1;
      return { id: 'row-approved' };
    },
    readRecent: async () => saved ? [makeSessionTurnRow({ id: 'row-approved', scenario_id: SCENARIO,
      user_id: OWNER, turn_id: saved.turn_id, turn_class: saved.turn_class, handler_id: saved.handler_id,
      request_hash: saved.request_hash })] : [],
    readFactsWithTurnFor: async () => (saved?.handler_facts ?? []).map(fact => ({ fact,
      turn_id: 'row-approved', fact_created_at: '2026-10-11T10:00:00Z' })),
    readRecentAppliedMutationFactsFor: async () => entries(),
  });
  const entries = (): IdentifiedHandlerFact[] => (saved?.handler_facts ?? []).map((fact, i) => ({
    fact: DurableHandlerFactSchema.parse(JSON.parse(JSON.stringify(fact))),
    fact_row_id: `fact-${i}`, fact_created_at: '2026-10-11T10:00:00Z',
    ...(saved?.modelVersion ? { committed_turn_ref: { scenario_id: SCENARIO, source_turn_id: saved.turn_id,
      owner_user_id: OWNER, conversation_row_id: 'row-approved', mutation_id: saved.modelVersion.mutation_id } } : {}),
  }));
  return { fresh, entries, current: () => GraphV3.parse(JSON.parse(bytes)), revision: () => revision,
    saved: () => saved, change: (mutate: (g: ReturnType<typeof graph>) => void) => {
      const g = graph(); Object.assign(g, JSON.parse(bytes)); mutate(g); bytes = JSON.stringify(g);
    } };
}
async function approved(failWrite = false, permission = true, legacy = false) {
  const db = storage(failWrite, legacy), before = db.current();
  const out = await runWithProviderPolicy({ allowed: new Set(), calls: [], route: 'durable-proof', truncated: false }, () => bindWriteCaller({ userId: OWNER, verified: permission }, () => executeOptionInterventionEdit({ optionId: 'opt_raise', factorId: 'fac_churn',
    modelValue: 0.45, figure: { raw_value: 450, cap: 1000, unit: 'GBP per month' },
    expectedGraphHash: computeAnalysisAffectingGraphHash(before)!, scenarioId: SCENARIO, turnId: TURN,
    requestId: 'approval', requestHash: 'checked-operation', stage: 'analyse', freshness: 'fresh', hasExistingAnalysis: false }, db.fresh())));
  return { db, out };
}
function ask(g: ReturnType<typeof graph>, authority: Awaited<ReturnType<typeof readDurableHumanAuthority>>) {
  return decideOptionCostAsk({ notDecisionGrade: true, humanAuthority: authority,
    ratified: [{ node_id: 'fac_churn', unit: 'GBP per month' }],
    nodes: g.nodes, options: g.nodes.filter(n => n.id === 'opt_raise') });
}
beforeEach(() => { vi.stubEnv('OLUMI_ENV', 'staging'); vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  _resetConfigCache(); __setUseAppendV6ForTest(true); });
afterEach(() => { __setUseAppendV6ForTest(false); vi.unstubAllEnvs(); _resetConfigCache(); });

describe('durable checked human cell authority', () => {
  it('checked apply -> atomic receipt -> cold reload -> metadata, no re-ask, next Run scoring', async () => {
    const { db, out } = await approved(); expect(out.kind).toBe('committed');
    expect(db.saved()?.modelVersion).toBeDefined();
    const g = db.current(), original = JSON.stringify(g);
    const authority = await readDurableHumanAuthority(db.fresh(), g, SCENARIO, db.revision());
    expect(authority).toStrictEqual([{ optionId: 'opt_raise', factorId: 'fac_churn' }]);
    expect(g.nodes.find(n => n.id === 'opt_raise')!.interventions!.fac_churn)
      .toMatchObject({ value: 0.45, raw_value: 450, unit: 'GBP per month', source: 'user_specified' });
    expect(transformOptionToAnalysisReady(OptionV3.parse({ ...g.nodes.find(n => n.id === 'opt_raise'), status: 'ready' }), 0, false, authority)
      .extraction_metadata?.source).toBe('user_specified');
    expect(ask(g, authority)).toBeNull();
    expect(ask(g, [])?.option_id).toBe('opt_raise');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'next-run', db.fresh());
    expect(snapshot.humanAuthority).toStrictEqual(authority);
    const payload = makeMessagePayload({ scenario_id: SCENARIO, stage: 'analyse', message: 'Run analysis' });
    const context = await buildTurnContext(payload, 'next-run', { sessionStore: db.fresh() });
    expect(context.humanAuthority).toStrictEqual(authority);
    const result = await runWithProviderPolicy({ allowed: new Set(), calls: [], route: 'durable-proof', truncated: false }, () => createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run: async () => JSON.parse(readFileSync('tests/fixtures/cross-service/c50-level-demo/U2.plot-response.json', 'utf8')),
        validatePatch: async () => ({ kind: 'success', data: {} }) } })({ payload, context,
      requestId: 'next-run', signal: new AbortController().signal, orientationText: '' }));
    const fact = result.handler_facts.find(f => f.fact_type === 'run_analysis');
    if (fact?.fact_type !== 'run_analysis') throw new Error('Run did not produce a fact');
    expect(fact.result.constraint_verdict).toMatchObject({ per_limit: [{ constraint_id: 'gc_u2', state: 'scored' }] });
    expect(JSON.stringify(db.current())).toBe(original);
  });
  for (const [name, mutate] of [
    ['value', (g: ReturnType<typeof graph>) => { g.nodes.find(n => n.id === 'opt_raise')!.interventions!.fac_churn.value = 0.46; }],
    ['native unit/period', (g: ReturnType<typeof graph>) => { g.nodes.find(n => n.id === 'opt_raise')!.interventions!.fac_churn.unit = 'GBP per year'; }],
    ['factor frame', (g: ReturnType<typeof graph>) => { g.nodes.find(n => n.id === 'fac_churn')!.observed_state!.cap = 2000; }],
    ['condition', (g: ReturnType<typeof graph>) => { Object.assign(g.nodes.find(n => n.id === 'opt_raise')!.interventions!.fac_churn, { basis: 'Subject to approval' }); }],
  ] as const) it(`changed ${name} cannot inherit the old approval`, async () => {
    const { db } = await approved(); db.change(mutate);
    expect(await readDurableHumanAuthority(db.fresh(), db.current(), SCENARIO, db.revision())).toStrictEqual([]);
  });
  it('a rival/sibling, stale revision or other lineage borrows no authority', async () => {
    const { db } = await approved(), g = db.current();
    const authority = await readDurableHumanAuthority(db.fresh(), g, SCENARIO, db.revision());
    expect(authority.some(p => p.optionId === 'opt_hold')).toBe(false);
    expect(resolveDurableHumanAuthority(g, SCENARIO, db.revision() + 1, db.entries(), true)).toStrictEqual([]);
    expect(resolveDurableHumanAuthority(g, 'another-scenario', db.revision(), db.entries(), true)).toStrictEqual([]);
    const facts = db.entries().map(f => ({ ...f, committed_turn_ref: { ...f.committed_turn_ref!, source_turn_id: 'another-operation' } }));
    expect(resolveDurableHumanAuthority(g, SCENARIO, db.revision(), facts, true)).toStrictEqual([]);
  });
  it('absent, truncated, failed or malformed history is unknown, not approval', async () => {
    const { db } = await approved(), g = db.current();
    for (const store of [ {}, { readRecentAppliedMutationFactsFor: async () => [] },
      { readRecentAppliedMutationFactsFor: async () => { throw new Error('Unavailable'); } },
      { readRecentAppliedMutationFactsFor: async () => Array.from({ length: HUMAN_APPROVAL_READ_LIMIT }, () => db.entries()[0]!) } ])
      expect(await readDurableHumanAuthority(store, g, SCENARIO, db.revision())).toStrictEqual([]);
    const malformed = db.entries().map(f => ({ ...f, fact_row_id: '' }));
    expect(resolveDurableHumanAuthority(g, SCENARIO, db.revision(), malformed, true)).toStrictEqual([]);
  });
  it('a legacy stamp is unproved; a new checked human change creates its own durable proof', async () => {
    const legacy = storage(false, true);
    expect(await readDurableHumanAuthority(legacy.fresh(), legacy.current(), SCENARIO, legacy.revision())).toStrictEqual([]);
    const { db, out } = await approved(false, true, true);
    expect(out.kind).toBe('committed');
    expect(await readDurableHumanAuthority(db.fresh(), db.current(), SCENARIO, db.revision()))
      .toStrictEqual([{ optionId: 'opt_raise', factorId: 'fac_churn' }]);
  });
  it('failed commit or absent permission identity produces no durable authority', async () => {
    for (const [fail, permission] of [[true, true], [false, false]] as const) {
      const { db, out } = await approved(fail, permission);
      expect(out.kind).not.toBe('committed');
      expect(await readDurableHumanAuthority(db.fresh(), db.current(), SCENARIO, db.revision())).toStrictEqual([]);
    }
  });
  it('signed sibling checks use the same factor, never unrelated sibling frames', () => {
    const quote = 'Should we cut our list price 15% or raise it 10%?';
    const base: CandidateModel = {
      goal: { metric: 'Market share', value: 30, operator: '>=', unit: '%', horizon_months: null, provenance: 'explicit' },
      constraints: [], risks: [], outcomes: [], links: [],
      factors: [{ label: 'List price change', role: 'controllable', baseline_known: true, baseline_value: 0,
        unit: '%', provenance: 'inferred' }, { label: 'Promo spend', role: 'controllable', baseline_known: true,
        baseline_value: 10000, unit: 'GBP', provenance: 'inferred' }],
      options: [{ label: 'Cut List Price 15%', provenance: 'explicit', changes: [], interventions: [
        { factor_label: 'Promo spend', value: 20000, value_kind: 'absolute', unit: 'GBP', provenance: 'ai_proposed' }] },
      { label: 'Raise List Price 10%', provenance: 'explicit', changes: [], interventions: [
        { factor_label: 'List price change', value: 10, value_kind: 'absolute', unit: '%', provenance: 'explicit' }] }],
    };
    const model = withOriginalReceipt(base, quote, quote, [['List price change', 10]]);
    const option = model.options[1]!, iv = option.interventions![0]!;
    expect(verifiedOptionSetting(model, option, iv, quote)).toBe(true);
  });
  it('a coordinated hires-per-month receipt still refuses a point count', () => {
    const bank = JSON.parse(readFileSync('src/orchestrator-v5/goal-target/__tests__/fixtures/event-b3-d2-20261008.json', 'utf8'));
    const model: CandidateModel = JSON.parse(bank.output_text);
    const quote = 'Should we hire two senior engineers or four junior engineers a month?';
    for (const option of model.options) for (const iv of option.interventions ?? []) {
      if (!['Senior engineers hired', 'Junior engineers hired'].includes(iv.factor_label)) continue;
      const claim = { ...iv, stated_evidence: { quote, start: 0, end: quote.length, amount_start: 0,
        option_quote: quote, option_start: 0, option_end: quote.length } };
      expect(verifiedOptionSetting(model, option, claim, quote)).toBe(false);
    }
  });
  it('legacy bare stamp remains unproved; role substitution cannot parse as an approval', async () => {
    const { db } = await approved(), g = db.current();
    const fact = db.entries()[0]!.fact;
    const json = JSON.parse(JSON.stringify(fact)); delete json.result.human_approval;
    expect(resolveDurableHumanAuthority(g, SCENARIO, db.revision(), [{ ...db.entries()[0]!, fact: DurableHandlerFactSchema.parse(json) }], true)).toStrictEqual([]);
    const wrong = JSON.parse(JSON.stringify(fact)); wrong.result.human_approval.cells[0].role = 'current_observation';
    expect(DurableHandlerFactSchema.safeParse(wrong).success).toBe(false);
  });
});
