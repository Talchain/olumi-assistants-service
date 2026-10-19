/**
 * ⭐ ONE RULE FOR AN UNSIZED OLUMI RISK (DL 15 Oct 23:19Z; AIE #94 6177505214). UI's joined witness, capacity (CEE 358132d8): the
 * first Run was held by Olumi's own ‘Specialist availability risk’ (MISSING_FACTOR_LEVEL, no figure). Through the ONE readiness
 * authority and the real Run handler: the Run is admitted, PLoT receives the model without that risk or any link touching it,
 * and the host says what the calculation leaves out in the AIE's exact words. A risk the user stated, or one of unknown origin,
 * keeps today's path and still asks.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { SessionStore } from '../../../session/store.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { runWithBoundAnalysisSnapshot } from '../../../run-analysis-snapshot-binding.js';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import { runOmittedRisks, unsizedOlumiRiskIds, unsizedOlumiRiskLine, UNSIZED_OLUMI_RISK_OMITTED } from '../../../agent-lane/unsized-risk.js';
import { decisionInputLines } from '../../../agent-lane/decision-input-ask.js';
import { risksSaidLeftOutOfTheChance } from '../../../agent-lane/decision-input-ask.js';
import { retainUnsizedOlumiRisks, withoutUnsizedOlumiRisksRecorded } from '../../../agent-lane/unsized-risk.js';
import { readScenarioAnalysis } from '../../../../routes/scenario-graph-analysis-read.js';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/capacity-358132d8-unsized-olumi-risk-graph-20261014.json',
  import.meta.url), 'utf8')) as { scenario_id: string; brief_text: string; graph_text: string; graph_sha256: string };
const RISK = 'specialist_availability_risk';
const graph = (): Json => JSON.parse(FX.graph_text) as Json;
const withRisk = (patch: Json): Json => { const g = graph(); Object.assign(g.nodes.find((n: Json) => n.id === RISK), patch); return g; };
let savedGraph: Json;
const store: SessionStore = {
  ...createNoopSessionStore(),
  loadGraph: async () => structuredClone(savedGraph),
  loadGraphAndBriefText: async () => ({ graph: structuredClone(savedGraph), briefText: FX.brief_text }),
};
vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {},
}));
vi.mock('../../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => {} }));

/** What the Run hands PLoT for the saved model (the engine's reply is not under test, so it stops there). */
async function sentGraph(g: Json): Promise<Json | null> {
  savedGraph = g;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(FX.scenario_id, 'unsized-load', store);
  const run = vi.fn(async () => { throw new Error('stop after the wire'); });
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  await runWithBoundAnalysisSnapshot(undefined as never, () => handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: FX.scenario_id, request_id: 'unsized-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 'unsized-run', scenario_id: FX.scenario_id, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'unsized-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation)).catch(() => undefined);
  const calls = run.mock.calls as unknown as [Json][];
  return calls.length === 1 ? calls[0]![0].graph as Json : null;
}

/**
 * A COMPLETED Run of the saved model through the real handler (the engine's reply minimal, as construction-acyclic's), and the
 * Run fact it stores: what every later reader reads.
 */
async function completedRun(g: Json): Promise<Json> {
  return (await completedRunFact(g)).result as Json;
}

/** The same Run's whole stored fact (what the store persists and a cold read reads back). */
async function completedRunFact(g: Json): Promise<Json> {
  savedGraph = g;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(FX.scenario_id, 'unsized-load', store);
  const run = vi.fn(async (payload: { options: { option_id?: string; id?: string }[] }) => ({ analysis_status: 'computed',
    results: payload.options.map((o, i) => ({ option_id: o.option_id ?? o.id, option_label: String(o.option_id ?? o.id), win_probability: i === 0 ? 0.6 : 0.4 })),
    response_hash: 'hash_unsized', meta: { seed_used: 1 } }));
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  const out = await runWithBoundAnalysisSnapshot(undefined as never, () => handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: FX.scenario_id, request_id: 'unsized-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 'unsized-run', scenario_id: FX.scenario_id, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'unsized-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation)) as Json;
  const fact = (out.handler_facts as Json[] | undefined)?.find((f) => f.fact_type === 'run_analysis');
  if (fact === undefined) throw new Error(`no Run fact: ${JSON.stringify(out).slice(0, 400)}`);
  return fact;
}

const OMISSION = 'This calculation covers the modelled effects only. ‘Specialist availability risk’ is Olumi’s unsized risk suggestion and is '
  + 'not included in this calculation; its likelihood and impact remain unresolved.';
const asksFor = (g: Json): Json[] => (resolveRunAdmission(g).assessment.issues as unknown as Json[]).filter((i) => i.factor_id === RISK);

describe('an unsized Olumi risk never holds the Run; it is left out and said once (capacity, UI joined witness 358132d8)', () => {
  it('PRECONDITION: the served capacity model, byte-pinned; the risk is Olumi’s (ai_inferred), with no figure, feeding capacity', () => {
    expect(createHash('sha256').update(FX.graph_text, 'utf8').digest('hex')).toBe(FX.graph_sha256);
    const r = graph().nodes.find((n: Json) => n.id === RISK);
    expect(r).toMatchObject({ kind: 'risk', provenance: 'ai_inferred', label: 'Specialist availability risk' });
    expect(r.observed_state).toBeUndefined();
  });

  it('⭐ RED→GREEN: may_run, PLoT receives no risk and no link touching it, and the host says what is left out', async () => {
    const g = graph();
    expect([...unsizedOlumiRiskIds(g)]).toEqual([RISK]);
    const admission = resolveRunAdmission(g);
    expect(admission.willProceed, JSON.stringify(admission.assessment.issues)).toBe(true);
    expect(asksFor(g)).toEqual([]);
    const sent = await sentGraph(g);
    expect(sent, 'the Run is admitted and calls PLoT').not.toBeNull();
    expect((sent!.nodes as Json[]).map((n) => n.id)).not.toContain(RISK);
    expect((sent!.edges as Json[]).filter((e) => e.from === RISK || e.to === RISK)).toEqual([]);
    expect((sent!.nodes as Json[]).map((n) => n.id)).toContain('additional_specialist_capacity');
    // No goal period on capacity: the AIE's line, with no occurrence ask (no horizon is invented).
    expect(unsizedOlumiRiskLine(g, RISK, false)).toBe(OMISSION);
    expect(unsizedOlumiRiskLine(g, RISK, true)).toBe(OMISSION.replace('This calculation covers', 'These chances cover'));
    // The Run reply's own left-out lines carry it beside a shown chance: from the Run's own record (#3167 fix-forward, below).
    expect([...risksSaidLeftOutOfTheChance(g, [{ option_id: 'add_one_specialist', kind: 'figure' } as never],
      [{ node_id: RISK, label: 'Specialist availability risk', reason: 'unsized_olumi_risk' }])]).toContain(RISK);
  });

  it('⛔ CONTRAST: the user’s own risk keeps today’s path: it still asks, and the Run waits', () => {
    const g = withRisk({ provenance: 'user_set' });
    expect(unsizedOlumiRiskIds(g).size).toBe(0);
    expect(asksFor(g).map((i) => i.code)).toEqual(['MISSING_FACTOR_LEVEL']);
    expect(resolveRunAdmission(g).willProceed).toBe(false);
  });

  it('⛔ CONTRAST (AIE): a risk of unknown origin is never Olumi’s by a missing stamp: it still asks', () => {
    const g = withRisk({ provenance: undefined });
    expect(unsizedOlumiRiskIds(g).size).toBe(0);
    expect(asksFor(g).map((i) => i.code)).toEqual(['MISSING_FACTOR_LEVEL']);
  });

  it('CONTRAST: sized by the user’s own figure, the same risk and its link are sent', async () => {
    const g = withRisk({ observed_state: { value: 0.3, raw_value: 30, unit: '%', source: 'user' } });
    expect(unsizedOlumiRiskIds(g).size).toBe(0);
    const sent = await sentGraph(g);
    expect(sent).not.toBeNull();
    expect((sent!.edges as Json[]).filter((e) => e.from === RISK).map((e) => e.to)).toEqual(['additional_specialist_capacity']);
  });
});

/**
 * ⭐ #3167 FIX-FORWARD (PL 6135017311 @00:49Z; AIE 6180618773 T9): what a Run left out is a fact of THAT Run, recorded with it
 * and read back by every reader (the reply's lines, the review, the licence, the AI); never today's model's predicate.
 */
describe('#3167 fix-forward: THIS Run\'s omission is recorded with it, and read from it', () => {
  const CELLS = [{ option_id: 'add_one_specialist', kind: 'figure' } as never];
  const atRest = (omittedRisks: unknown): Json => ({ restingText: '', questionsToggle: false, awaitingApproval: false, builtOrRan: true,
    chanceCells: CELLS, ...(omittedRisks === undefined ? {} : { omittedRisks }) });

  it('⭐ RED (a new Run): the stored Run fact records the risk it left out (id, label then, reason, scope)', async () => {
    const result = await completedRun(graph());
    const w = ((result.enrichment as Json).inference_warnings as Json[]).filter((x) => x.code === UNSIZED_OLUMI_RISK_OMITTED);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ source: 'cee', scope: 'modelled_effects_only', node_ids: [RISK] });
    expect(runOmittedRisks(result)).toEqual([{ node_id: RISK, label: 'Specialist availability risk', reason: 'unsized_olumi_risk' }]);
    // The reply's left-out lines and the review read THAT record.
    const omitted = runOmittedRisks(result);
    expect([...risksSaidLeftOutOfTheChance(graph(), CELLS, omitted)]).toContain(RISK);
    expect(decisionInputLines(graph(), atRest(omitted) as never)).toContain(OMISSION.replace('This calculation covers', 'These chances cover'));
  });

  it('⭐ RED (an old Run): the risk sized SINCE still shows that Run\'s own omission, by its label then', async () => {
    const result = await completedRun(graph());
    // Since that Run: the user sized the risk AND renamed it. Today's predicate no longer leaves it out.
    const today = withRisk({ label: 'Specialist hiring risk', observed_state: { value: 0.3, raw_value: 30, unit: '%', source: 'user' } });
    expect(unsizedOlumiRiskIds(today).size).toBe(0);
    const lines = decisionInputLines(today, atRest(runOmittedRisks(result)) as never);
    expect(lines).toContain(OMISSION.replace('This calculation covers', 'These chances cover'));
    expect(lines.join(' ')).not.toContain('Specialist hiring risk');
  });

  it('⛔ CONTRAST: a Run that recorded no omission (older, or none) claims none, whatever today\'s model would leave out', () => {
    const g = graph();
    expect(unsizedOlumiRiskIds(g).size).toBe(1);
    expect([...risksSaidLeftOutOfTheChance(g, CELLS, undefined)]).not.toContain(RISK);
    expect(decisionInputLines(g, atRest(undefined) as never).join(' ')).not.toContain('Specialist availability risk');
  });

  it('⛔ CONTRAST: a Run with nothing to leave out records nothing', async () => {
    const result = await completedRun(withRisk({ observed_state: { value: 0.3, raw_value: 30, unit: '%', source: 'user' } }));
    expect(runOmittedRisks(result)).toBeUndefined();
  });
});

/**
 * ⭐ STEP 8b (DL-3, 18 Oct; AIE R2 `step8_science.unfigured_risk`: "this Run omission IDs/reasons/scope retained and shown").
 * Since #3351 admission PERSISTS the omission on the saved model (`retainUnsizedOlumiRisks`). The Run's participation guard then
 * drops that risk BEFORE the recorded projection (`analysable-option-gate.ts`), which saw nothing to remove, so the stored Run
 * kept only a count ("N parts … kept out") and every `runOmittedRisks` reader saw none (served 9d17caa6, outbox/step8b-probes).
 * Real path: the admission writer marks the saved model → the production snapshot loader → the real Run handler → its stored
 * fact through the store's own contract → a COLD read (`readScenarioAnalysis`, the scenario-graph route's leg).
 */
describe('STEP 8b: a risk admission already kept out is still recorded with THIS Run, and read back cold', () => {
  const RECORD = [{ node_id: RISK, label: 'Specialist availability risk', reason: 'unsized_olumi_risk' }];
  const marked = (g: Json = graph()): Json => retainUnsizedOlumiRisks(g as { nodes: unknown[] }) as Json;
  const omissionWarnings = (result: Json): Json[] =>
    (((result.enrichment as Json).inference_warnings ?? []) as Json[]).filter((x) => x.code === UNSIZED_OLUMI_RISK_OMITTED);

  it('PRECONDITION: the admission writer persists the omission on this risk alone, and PLoT receives neither it nor its link', async () => {
    const g = marked();
    expect(g.nodes.filter((n: Json) => n.analysis_participation === 'retained_excluded').map((n: Json) => n.id).sort())
      .toEqual([RISK, 'specialist_productivity_shortfall']);
    expect(graph().nodes.find((n: Json) => n.id === RISK).analysis_participation, 'the served model predates the mark').toBeUndefined();
    const sent = await sentGraph(g);
    expect(sent, 'the Run is admitted and calls PLoT').not.toBeNull();
    expect((sent!.nodes as Json[]).map((n) => n.id)).not.toContain(RISK);
    expect((sent!.edges as Json[]).filter((e) => e.from === RISK || e.to === RISK)).toEqual([]);
  });

  it('⭐ RED: the stored Run fact records that risk (id, label then, reason, scope), exactly as an unmarked one', async () => {
    // The reason is the risk's CLASS (Olumi's unsized suggestion), never who kept it out: the mark reads the same whoever set it.
    const result = await completedRun(marked());
    const w = omissionWarnings(result);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ source: 'cee', scope: 'modelled_effects_only', node_ids: [RISK] });
    expect(runOmittedRisks(result)).toEqual(RECORD);
    // One record, whichever step kept it out: the unmarked model's Run records the same thing.
    expect(runOmittedRisks(await completedRun(graph()))).toEqual(RECORD);
  });

  it('⭐ RED (cold readback): the omission survives the store contract and the scenario read, by id and reason', async () => {
    const g = marked();
    const fact = RunAnalysisHandlerFactSchema.parse(JSON.parse(JSON.stringify(await completedRunFact(g))));
    const saved = { ...store };
    Object.assign(store, createNoopSessionStore({ facts: [fact as never], priorTurns: [{ id: 'unsized-run-row' } as never] }),
      { loadGraph: saved.loadGraph, loadGraphAndBriefText: saved.loadGraphAndBriefText });
    try {
      const read = await readScenarioAnalysis({ scenarioId: FX.scenario_id, graph: structuredClone(g), requestId: 'unsized-cold-read' });
      expect(read.analysis_state?.run_state, 'a current read of THIS Run').toMatchObject({ kind: 'complete_current' });
      expect(runOmittedRisks(read.analysis_result)).toEqual(RECORD);
    } finally {
      Object.assign(store, saved);
    }
  });

  it('⭐ RED (identity): of everything the guard keeps out, only the unsized Olumi risk is recorded, never the user\'s factor', async () => {
    // The guard drops three nodes here: Olumi's unlinked suggestion, the user's own factor, and the unsized Olumi risk root.
    const g = marked();
    for (const n of g.nodes as Json[]) if (n.id === 'existing_team_capacity') n.analysis_participation = 'retained_excluded';
    expect(runOmittedRisks(await completedRun(g))).toEqual(RECORD);
  });

  it('⛔ CONTRAST (pair, Codex): sized since it was marked, the risk is not recorded as unsized, though it stays kept out', async () => {
    const g = marked();
    Object.assign(g.nodes.find((n: Json) => n.id === RISK), { observed_state: { value: 0.3, raw_value: 30, unit: '%', source: 'user' } });
    expect(unsizedOlumiRiskIds(g).size).toBe(0);
    expect(runOmittedRisks(await completedRun(g))).toBeUndefined();
  });

  it('⛔ CONTRAST (pair, Codex): a refused Run records nothing; a duplicated id is never recorded', async () => {
    const g = marked();
    g.nodes.find((n: Json) => n.kind === 'goal').analysis_participation = 'retained_excluded';
    // The goal kept out: the Run is refused (readiness says so first), so no Run fact and no omission record exist.
    await expect(completedRunFact(g)).rejects.toThrow(/not analysis-ready|no Run fact/);
    const twice = marked(); twice.nodes.push({ ...twice.nodes.find((n: Json) => n.id === RISK) });
    expect(withoutUnsizedOlumiRisksRecorded({ nodes: [], edges: [] }, twice, [RISK]).omitted).toEqual([]);
  });

  it('⛔ CONTRAST: a risk the user stated and kept out is never recorded as Olumi’s omission', async () => {
    const users = withRisk({ provenance: 'user_set', analysis_participation: 'retained_excluded' });
    expect(unsizedOlumiRiskIds(users).size).toBe(0);
    expect(runOmittedRisks(await completedRun(users))).toBeUndefined();
  });
});
