/** Q6: per-option limit words and asks name only options this Run recorded as sent. */
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { RunInputSnapshotSchema } from '@talchain/schemas/orchestrator';
import { limitChecksForAgent, type LimitCheck } from '../limit-checks.js';
import { savedRunContextFacts } from '../saved-run-context-facts.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { readStoredOptionParticipation } from '../../tools/handlers/option-participation.js';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';
import { OLUMI_GUESS_LIMIT_REASON } from '../../../orchestrator/context/placeholder-parts.js';
import scenarioGraphRoute from '../../../routes/assist.v1.scenario-graph.js';
import { deriveDecisionContextGraphHash } from '../../build-turn-context.js';
import { stampRunAnalysisProjection } from '../../context/analysis-projection-policy.js';
import type { RecordedRunOptionSet } from '../../tools/handlers/option-participation.js';

const { readStore } = vi.hoisted(() => ({ readStore: {
  scenarioExists: vi.fn(async () => true),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  getScenarioOwner: vi.fn(async () => null),
  loadGraphAndBriefText: vi.fn(),
  readMostRecentPendingActions: vi.fn(async () => []),
  readRecent: vi.fn(async () => [{ id: 'q6-run-row' }]),
  readFactsFor: vi.fn(),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
} }));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => readStore }));
vi.mock('../../../orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const RAISE = 'raise_pro_price_to_59';
const TEST = 'test_54_pro_price';
const KEEP = 'keep_49_price';
const LIMIT = 'agent-lane:monthly_churn_rate:<=';
const HASH = 'a'.repeat(16);
const AT = '2026-10-08T10:00:00.000Z';
const CTX = { scenario_id: '550e8400-e29b-41d4-a716-4466554400e1', authenticated_user_id: null, request_id: 'q6' };
const labels = new Map([[RAISE, 'Raise Pro price to £59'], [TEST, 'Test £54 Pro price'], [KEEP, 'Keep £49']]);
const why = 'it depends on how strongly ‘Pro plan price’ moves ‘Monthly churn rate’, which Olumi estimated.';
const BOTH = `For ‘Raise Pro price to £59’ and ‘Test £54 Pro price’ it isn’t shown: ${why}`;
const SENT_ONLY = `For ‘Raise Pro price to £59’ it isn’t shown: ${why}`;
const LINK_ASK = 'How much does ‘Pro plan price’ change ‘Monthly churn rate’?';

// Minimal graph arranged to reproduce Paul's served Explain wording exactly; no new verdict is derived here.
const graph = {
  nodes: [
    { id: KEEP, kind: 'option', label: labels.get(KEEP), is_baseline: true },
    ...[RAISE, TEST].map(id => ({ id, kind: 'option', label: labels.get(id),
      interventions: { pro_plan_price: { value: id === RAISE ? 0.295 : 0.27, raw_value: id === RAISE ? 59 : 54,
        unit: '£ per subscriber per month', source: id === RAISE ? 'brief_extraction' : 'cee_hypothesis' } } })),
    { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price',
      observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: '£ per subscriber per month', source: 'user_override' } },
    { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', scale_frame: 100,
      observed_state: { value: 0.03, raw_value: 3, unit: '%', source: 'user_override' } },
  ],
  edges: [{ from: 'pro_plan_price', to: 'monthly_churn_rate', strength: { mean: 0.2, std: 0.1 },
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
      amount: 0.1, amount_unit: 'percentage points', per_source_change: 1,
      per_source_change_unit: '£ per subscriber per month', strength_mean: 0.2,
    } } }],
  goal_constraints: [{ constraint_id: LIMIT, node_id: 'monthly_churn_rate', label: 'Monthly churn rate',
    operator: '<=', value: 5, unit: '%', value_frame: 'level', provenance: 'explicit' }],
};
const verdicts: StoredLimitVerdicts = { per_limit: [{ constraint_id: LIMIT, state: 'estimate_only', reason: 'level_olumi_estimate' }],
  joint: { state: 'estimate_only' } };
const state = { run_state: { kind: 'complete_current', computed_at: AT }, leader_claim: { permitted: false } };
const result = () => ({ type: 'analysis_result', computed_against_hash: HASH, enrichment: {} });
const first = (g = graph, rows = verdicts, leftOut?: ReadonlySet<string>): LimitCheck =>
  limitChecksForAgent(g, rows, undefined, leftOut)![0]!;

const carriers = [
  ['olumi_proposed', 'excluded_olumi_proposed'],
  ['infeasible', 'excluded_infeasible'],
  ['removed', 'excluded_removed'],
  ['not_analysable', null],
] as const;

/** Read the production graph route, projecting the stored fact; never inject a snapshot into its display block. */
async function storedRunRead(reason: typeof carriers[number][0] | undefined, sent = false): Promise<Record<string, unknown>> {
  const carrier = carriers.find(([r]) => r === reason);
  const hash = deriveDecisionContextGraphHash(graph)!;
  const snapshot = reason === 'not_analysable' ? RunInputSnapshotSchema.parse({
    snapshot_version: 1, sent_digest: 'b'.repeat(64), goal: null,
    options: [KEEP, RAISE, TEST].filter(id => sent || id !== TEST)
      .map(option_id => ({ option_id, label: labels.get(option_id), settings: [] })),
    options_not_sent: sent ? [] : [{ option_id: TEST, label: labels.get(TEST), reason }],
    factors: [], constraints: [], links: [],
  }) : undefined;
  const participation = carrier === undefined ? undefined
    : sent || carrier[1] === null ? [] : [{ option_id: TEST, state: carrier[1] }];
  const storedResult = { scenario_id: CTX.scenario_id, leading_option_id: null, summary: 'The model was analysed.',
    graph_hash_at_run: hash, computed_at: AT,
    constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unevaluated', ...verdicts },
    enrichment: stampRunAnalysisProjection({ analysis_status: 'computed' }),
    ...(snapshot === undefined ? {} : { input_snapshot: snapshot }),
    ...(participation === undefined ? {} : { option_participation: participation }),
  };
  readStore.loadGraphAndBriefText.mockResolvedValue({ graph, briefText: 'Compare Pro pricing.' });
  readStore.readFactsFor.mockResolvedValue([{ fact_type: 'run_analysis', fact_version: 1, noop: false, result: storedResult }]);
  const app = Fastify({ logger: false });
  await app.register(scenarioGraphRoute);
  await app.ready();
  try {
    const reply = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${CTX.scenario_id}/graph`, payload: {} });
    expect(reply.statusCode).toBe(200);
    const body = reply.json() as Record<string, unknown>;
    expect(body.analysis_result, 'control: the canonical reader delivered THIS selected Run').not.toBeNull();
    expect(body.analysis_result).not.toHaveProperty('input_snapshot');
    expect(body.analysis_run_option_set).toMatchObject({
      leftOut: reason === undefined || sent ? [] : [{ option_id: TEST, label: labels.get(TEST), reason }],
    });
    if (reason === 'not_analysable') expect(body.analysis_option_participation).toEqual([]);
    else if (participation !== undefined) expect(body.analysis_option_participation).toEqual(participation);
    return body;
  } finally { await app.close(); }
}

describe('Q6 limit checks use the Run’s recorded sent option set', () => {
  it('RED: Paul’s exact Explain clause loses test_54 when this Run left it out', () => {
    const row = first(graph, verdicts, new Set([TEST]));
    expect(row.say).toBe(SENT_ONLY);
    expect(row.withheld_for).toEqual(['Raise Pro price to £59']);
    expect(row.ask).toBe(LINK_ASK);
  });

  it('CONTROL: £54 sent, or exclusion unrecorded, preserves the exact clause naming both', () => {
    expect(first(graph, verdicts, new Set()).say).toBe(BOTH);
    expect(first().say).toBe(BOTH);
  });

  it('all named options left out removes the entire guessed clause and its ask', () => {
    const row = first(graph, verdicts, new Set([RAISE, TEST]));
    expect(row.say).toBe('');
    expect(row).not.toHaveProperty('ask');
    expect(row).not.toHaveProperty('withheld_for');
  });

  it('the row’s own sentence is unchanged when every guessed option was left out', () => {
    const rows: StoredLimitVerdicts = { per_limit: [{ constraint_id: LIMIT, state: 'unscored', reason: OLUMI_GUESS_LIMIT_REASON }],
      joint: { state: 'unscored' } };
    expect(first(graph, rows, new Set([RAISE, TEST])).say).toBe('‘Monthly churn rate’ isn’t shown for any option.');
    expect(first(graph, rows, new Set([RAISE, TEST]))).not.toHaveProperty('ask');
  });

  it('why clauses, their per-option asks, and withheld_for also drop left-out options, preserving the row sentence', () => {
    const placeholder = structuredClone(graph);
    placeholder.edges[0]!.provenance.magnitude = 'olumi_placeholder';
    const rows: StoredLimitVerdicts = { per_limit: [{ constraint_id: LIMIT, state: 'scored' }], joint: { state: 'scored' } };
    const ownSentence = '‘Monthly churn rate’ was checked against the figures in your model.';
    expect(first(placeholder, rows, new Set([TEST]))).toEqual({ constraint_id: LIMIT, limit: 'Monthly churn rate', state: 'scored',
      say: ownSentence + ' For ‘Raise Pro price to £59’ it couldn’t be checked: that option moves it through a link Olumi hasn’t sized in this limit’s units.',
      ask: LINK_ASK, withheld_for: ['Raise Pro price to £59'] });
    expect(first(placeholder, rows, new Set([RAISE, TEST]))).toEqual({ constraint_id: LIMIT, limit: 'Monthly churn rate',
      state: 'scored', say: ownSentence });
  });

  it.each(carriers)('saved/Explain reads production %s carrier from the SAME stored fact, with its sent twin', async reason => {
    for (const sent of [false, true]) {
      const body = await storedRunRead(reason, sent);
      const facts = savedRunContextFacts(CTX.scenario_id, {
        graph_hash: body.graph_hash as string, analysis_state: body.analysis_state, analysis_result: body.analysis_result,
        raw: body.graph, limit_verdicts: verdicts,
        option_participation: readStoredOptionParticipation(body.analysis_option_participation),
        run_option_set: body.analysis_run_option_set as RecordedRunOptionSet,
      }, { leader_may_be_named: false });
      expect((facts.limit_checks as { limits: LimitCheck[] }).limits[0]!.say).toBe(sent ? BOTH : SENT_ONLY);
    }
  });

  it('saved/Explain caller does not infer exclusion from graph authorship or a missing record', () => {
    const proposed = { ...graph, nodes: graph.nodes.map(n => n.id === TEST ? { ...n, proposed_by: 'olumi' } : n) };
    const facts = savedRunContextFacts(CTX.scenario_id, { graph_hash: HASH, analysis_state: state, analysis_result: result(),
      raw: proposed, limit_verdicts: verdicts }, { leader_may_be_named: false });
    expect((facts.limit_checks as { limits: LimitCheck[] }).limits[0]!.say).toBe(BOTH);
  });

  it.each(carriers)('runAnalysis reads production %s carrier from its canonical post-Run read, with its sent twin', async reason => {
    for (const sent of [false, true]) {
      const body = await storedRunRead(reason, sent);
      const dispatch: InternalDispatch = async path => {
        if (path.endsWith('/graph')) return { status: 200, json: body };
        if (path === '/orchestrate/v2/turn') return { status: 200, json: { assistant_text: '', analysis_state: body.analysis_state,
          analysis_ready: { status: 'ready', may_run: true }, blocks: [body.analysis_result] } };
        throw new Error(`unexpected dispatch ${path}`);
      };
      const reply = await createAgentCapabilities(dispatch, new ProposalStore()).runAnalysis(CTX, { reason: 'Run it.' });
      expect((reply.limit_checks as { limits: LimitCheck[] }).limits[0]!.say).toBe(sent ? BOTH : SENT_ONLY);
    }
  });

  it('runAnalysis preserves every option when the selected production fact records no exclusion', async () => {
    const body = await storedRunRead(undefined);
    const dispatch: InternalDispatch = async path => path.endsWith('/graph') ? { status: 200, json: body }
      : { status: 200, json: { assistant_text: '', analysis_state: body.analysis_state, blocks: [body.analysis_result] } };
    const reply = await createAgentCapabilities(dispatch, new ProposalStore()).runAnalysis(CTX, { reason: 'Run it.' });
    expect((reply.limit_checks as { limits: LimitCheck[] }).limits[0]!.say).toBe(BOTH);
  });
});
