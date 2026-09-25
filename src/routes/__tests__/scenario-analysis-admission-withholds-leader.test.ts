/**
 * THE ADMISSION GOVERNS THE LEADER — on the reload's `leader_claim` and on the
 * typed `analysis_result` block it serves beside it.
 *
 * Served (RC #63 5826475400, confirming Codex 5826448049; hiring S3, an explicit
 * Run on CEE `92b1bf8`): ONE response carried
 *   · `analysis_ready.analysis_admission.permitted_analysis_mode`
 *     = `quantified_provisional` (every estimate machine-authored), and
 *   · `analysis_state.leader_claim` = `{ permitted: true, separation: 'separated' }`,
 *   · a block with `leading_option_id`, a "scored highest … in 43% of runs"
 *     summary and a "… is slightly ahead." `headline_banded`.
 * Two CEE authorities, one response. The cause, by source: the reload read
 * (`scenario-graph-analysis-read.ts`) — which serves the Agent lane's
 * `analysis_state` — never computed the admission, so neither
 * `composeAnalysisStateV1` nor `buildAnalysisResultBlock` could see it.
 *
 * The admission is the CANONICAL one for the reloaded graph
 * (`buildCanonicalAnalysisReadyFromGraph`), read through the ONE predicate the
 * prose chokepoints already use (`analysisReadyPermitsLeaderNaming`). The
 * fixture graphs are the live 4-day-week capture: as captured it admits
 * `comparative_leader` (user-stated confidence); with its brief-extracted
 * observation removed every estimate is machine-authored → `quantified_provisional`.
 * Each case pins that premise before it asserts anything.
 *
 *   RED 1a/1b  reload, provisional, requested, constraint permits, separated
 *              → `admission_withheld` (a); no leader id, no ranking prose,
 *              figures kept (b).
 *   CONTROL 2  the same run under `comparative_leader` → permitted, leader kept.
 *   RED 3a/3b  the finaliser (Conventional path) under the provisional admission:
 *              its `leader_claim` (a) and the block `compose.ts` builds for it (b).
 *   CONTROL 4  no admission to read → unchanged (fail-open, both paths).
 *   CONTROL 5  precedence: a constraint withhold under provisional keeps its own
 *              cause (5a); an unrequested auto-run under provisional names the
 *              admission (5b — RED before the fix, it said "unrequested"); the
 *              same auto-run under comparative_leader stays unrequested (5c).
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => ({
    readRecent,
    readFactsFor,
    readFactsWithTurnFor,
    readScenarioRunAnalysisFactsFor,
    readAnalysisInvalidatedAt,
  }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { buildAnalysisResultBlock, composeDirectAnswerResponse } from '../../orchestrator-v5/compose.js';
import { finaliseV5Response } from '../../orchestrator-v5/response-finaliser.js';
import { deriveDecisionContextGraphHash } from '../../orchestrator-v5/build-turn-context.js';
import { deriveAnalysisFreshness } from '../../orchestrator-v5/context/freshness.js';
import { canonicalStateFromFreshness } from '../../orchestrator-v5/context/canonical-analysis-state.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO = 'abababab-abab-4bab-8bab-abababababab';
const RUN_AT = '2026-09-25T03:38:55.000Z';
const CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';

type Graph = { nodes: Array<Record<string, unknown>>; [k: string]: unknown };

function capture(): Graph {
  const parsed = JSON.parse(readFileSync(CAPTURE, 'utf8')) as { graph: Graph };
  return JSON.parse(JSON.stringify(parsed.graph)) as Graph;
}

/** The capture with its one brief-extracted observation removed: every estimate machine-authored. */
function provisionalGraph(): Graph {
  const graph = capture();
  for (const node of graph.nodes) {
    const observed = node.observed_state as { source?: unknown } | undefined;
    if (observed?.source === 'brief_extraction') delete node.observed_state;
  }
  return graph;
}

function modeOf(graph: unknown): unknown {
  return (buildCanonicalAnalysisReadyFromGraph(graph) as { analysis_admission?: { permitted_analysis_mode?: unknown } } | undefined)
    ?.analysis_admission?.permitted_analysis_mode;
}

const LEAD = 'opt_full_rollout';
const LEAD_LABEL = 'Full 4-Day Week Rollout';
const RANKING_SUMMARY = `${LEAD_LABEL} scored highest against your goal in 43% of runs of this model.`;
const HEADLINE = `${LEAD_LABEL} is slightly ahead.`;
const WIN = { opt_full_rollout: 0.43, opt_phased: 0.35, opt_status_quo: 0.22 };

function runFact(graph: Graph, opts: { mayName: boolean; auto: boolean }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: RUN_AT,
      graph_hash_at_run: deriveDecisionContextGraphHash(graph),
      leading_option_id: LEAD, summary: RANKING_SUMMARY,
      win_probabilities: WIN,
      constraint_verdict: {
        may_name_leading_option: opts.mayName,
        constraint_verdict_state: opts.mayName ? 'evaluated_feasible' : 'evaluated_infeasible',
      },
      enrichment: {
        analysis_status: 'completed',
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        decision_brief: { headline_banded: { band: 'slightly_ahead', text: HEADLINE } },
        ...(opts.auto ? { run_provenance: { initiated_by: 'auto_post_draft' } } : {}),
      },
    },
  });
}

type Fact = ReturnType<typeof runFact>;

async function reload(graph: Graph, fact: Fact, id: string) {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: `row-${id}`, fact_created_at: RUN_AT }],
    total_count: 1,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: graph as unknown as GraphStateIngress, requestId: id });
}

function headlineOf(block: unknown): unknown {
  return (block as { enrichment?: { decision_brief?: { headline_banded?: unknown } } } | null)
    ?.enrichment?.decision_brief?.headline_banded;
}

function expectNoLeaderProse(block: unknown): void {
  const b = block as { leading_option_id?: unknown; summary?: unknown; win_probabilities?: unknown };
  expect(b.leading_option_id, 'the block names no leader').toBeNull();
  expect(String(b.summary)).not.toMatch(/scored highest/i);
  expect(String(b.summary)).not.toContain(LEAD_LABEL);
  const headline = headlineOf(block) as { text?: unknown } | undefined;
  if (headline !== undefined) expect(String(headline.text)).not.toMatch(/ahead/i);
  // KEEP the provisional numeric comparison.
  expect(b.win_probabilities, 'the figures are kept').toEqual(WIN);
}

beforeEach(() => {
  vi.clearAllMocks();
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('the admission governs the reload\'s leader_claim and the typed block', () => {
  it('premise: the capture admits comparative_leader; stripped of its brief observation it is quantified_provisional', () => {
    expect(modeOf(capture())).toBe('comparative_leader');
    expect(modeOf(provisionalGraph())).toBe('quantified_provisional');
  });

  it('RED 1a — leader_claim: a requested, permitted, separated run under a provisional admission is admission_withheld', async () => {
    const graph = provisionalGraph();
    const result = await reload(graph, runFact(graph, { mayName: true, auto: false }), 'adm-red-1a');
    expect(result.analysis_state?.run_state.kind, 'premise: a current run').toBe('complete_current');
    expect(result.analysis_state?.leader_claim.separation, 'premise: the arms separate').toBe('separated');
    expect(result.analysis_state?.leader_claim.permitted).toBe(false);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('admission_withheld');
  });

  it('RED 1b — the typed block beside it carries no leader id and no ranking prose, and keeps the figures', async () => {
    const graph = provisionalGraph();
    const result = await reload(graph, runFact(graph, { mayName: true, auto: false }), 'adm-red-1b');
    expect(result.analysis_state?.run_state.kind, 'premise: a current run').toBe('complete_current');
    expectNoLeaderProse(result.analysis_result);
  });

  it('CONTROL 2 — the same run under comparative_leader is permitted and keeps its leader', async () => {
    const graph = capture();
    const result = await reload(graph, runFact(graph, { mayName: true, auto: false }), 'adm-control-2');
    expect(result.analysis_state?.run_state.kind, 'premise: a current run').toBe('complete_current');
    expect(result.analysis_state?.leader_claim.permitted).toBe(true);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBeUndefined();
    const block = result.analysis_result as { leading_option_id?: unknown; summary?: unknown };
    expect(block.leading_option_id).toBe(LEAD);
    expect(block.summary).toBe(RANKING_SUMMARY);
    expect((headlineOf(block) as { text?: unknown }).text).toBe(HEADLINE);
  });

  function finaliseProvisional() {
    const graph = provisionalGraph();
    const analysisReady = buildCanonicalAnalysisReadyFromGraph(graph);
    expect(modeOf(graph), 'premise').toBe('quantified_provisional');
    const fact = runFact(graph, { mayName: true, auto: false });
    const hash = deriveDecisionContextGraphHash(graph);
    const freshness = deriveAnalysisFreshness([fact], hash, undefined, { priorFactsReadOk: true });
    const block = buildAnalysisResultBlock(fact, analysisReady);
    const out = finaliseV5Response(composeDirectAnswerResponse({
      assistant_text: 'Here is where the analysis stands.', stage: 'analyse', answerKind: 'substantive',
      blocks: [block],
    }), {
      scenarioId: SCENARIO, analysisReady: analysisReady as never, freshness,
      canonicalState: canonicalStateFromFreshness(freshness, {}), priorFacts: [fact], mayNameLeadingOption: true,
    } as never);
    return { block, out };
  }

  it('RED 3a — the finaliser (Conventional path) reads the same admission off its analysisReady', () => {
    const { out } = finaliseProvisional();
    expect(out.analysis_state?.leader_claim.separation, 'premise: the arms separate').toBe('separated');
    expect(out.analysis_state?.leader_claim.permitted).toBe(false);
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe('admission_withheld');
  });

  it('RED 3b — the block the Conventional composer builds with that analysisReady names no leader', () => {
    const { block } = finaliseProvisional();
    expectNoLeaderProse(block);
  });

  it('CONTROL 4a — reload: a graph whose admission stands down (not structurally analysable) is unchanged', async () => {
    const graph: Graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
    const admission = (buildCanonicalAnalysisReadyFromGraph(graph) as { analysis_admission?: { structurally_analysable?: unknown } } | undefined)
      ?.analysis_admission;
    expect(admission?.structurally_analysable ?? false, 'premise: nothing to read a mode from').not.toBe(true);
    const result = await reload(graph, runFact(graph, { mayName: true, auto: false }), 'adm-control-4a');
    expect(result.analysis_state?.leader_claim.permitted).toBe(true);
    expect((result.analysis_result as { leading_option_id?: unknown }).leading_option_id).toBe(LEAD);
  });

  it('CONTROL 4b — finaliser: an analysisReady with no analysis_admission is unchanged', () => {
    const graph = provisionalGraph();
    const fact = runFact(graph, { mayName: true, auto: false });
    const hash = deriveDecisionContextGraphHash(graph);
    const freshness = deriveAnalysisFreshness([fact], hash, undefined, { priorFactsReadOk: true });
    const analysisReady = { status: 'ready' as const, goal_node_id: 'goal_4day_success', options: [] };
    const block = buildAnalysisResultBlock(fact, analysisReady);
    const out = finaliseV5Response(composeDirectAnswerResponse({
      assistant_text: 'Here is where the analysis stands.', stage: 'analyse', answerKind: 'substantive',
      blocks: [block],
    }), {
      scenarioId: SCENARIO, analysisReady: analysisReady as never, freshness,
      canonicalState: canonicalStateFromFreshness(freshness, {}), priorFacts: [fact], mayNameLeadingOption: true,
    } as never);
    expect(out.analysis_state?.leader_claim.permitted).toBe(true);
    expect(block.leading_option_id).toBe(LEAD);
    expect(block.summary).toBe(RANKING_SUMMARY);
  });

  it('CONTROL 5a — precedence: a constraint withhold under a provisional admission keeps its own cause', async () => {
    const graph = provisionalGraph();
    const result = await reload(graph, runFact(graph, { mayName: false, auto: false }), 'adm-control-5a');
    expect(result.analysis_state?.leader_claim.permitted).toBe(false);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('CONTROL 5b — precedence: an unrequested auto-run under a provisional admission names the admission', async () => {
    const graph = provisionalGraph();
    const result = await reload(graph, runFact(graph, { mayName: true, auto: true }), 'adm-control-5b');
    expect(result.analysis_state?.leader_claim.permitted).toBe(false);
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('admission_withheld');
  });

  it('CONTROL 5c — contrast for 5b: the same unrequested auto-run under comparative_leader stays unrequested_analysis_withheld', async () => {
    const graph = capture();
    const result = await reload(graph, runFact(graph, { mayName: true, auto: true }), 'adm-control-5c');
    expect(result.analysis_state?.leader_claim.withheld_reason).toBe('unrequested_analysis_withheld');
  });
});
