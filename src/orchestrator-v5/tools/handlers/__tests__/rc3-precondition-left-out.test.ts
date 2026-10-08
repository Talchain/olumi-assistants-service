/**
 * RC3 a′: a SERVER-stamped option precondition stays on the canvas and leaves the Run. The real loader and handler
 * must send byte-identical inputs to the graph without it. Same shape without identity, bad option identity, any
 * incident edge (including bidirected), or a named limit must never receive that exemption.
 *
 * Base: the captured pricing graph and served Run used by the A7 journey. Added risk is constructed, not live evidence.
 * Rows are unexecuted here: BRIEF's sysctl load check is blocked, so the author owns tests and mutant execution.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { validateGraphStructure } from '../../../../orchestrator/graph-structure-validator.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { inertRiskBranch, preconditionRiskIds, withoutPreconditionRisks } from '../../../../graph/inert-risk.js';
import { structuralFacts } from '../../../agent-lane/structural-facts.js';
import { decisionInputLines } from '../../../agent-lane/decision-input-ask.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { sentDigest } from '../run-input-snapshot.js';

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-00000000ac33';
const RISK_ID = 'risk_feature_release_slips';
const RISK_LABEL = 'Feature release slips';
const OPTION_ID = '59_price';
const OPTION_LABEL = 'Raise Pro price to £59';
const clone = <T>(x: T): T => structuredClone(x);
const baseline = (): Json => {
  const g = clone(M1.graph);
  g.nodes.find((n: Json) => n.id === OPTION_ID).label = OPTION_LABEL;
  return g;
};
const withRisk = (stamp: unknown = { option_id: OPTION_ID }): Json => {
  const g = baseline();
  g.nodes.push({ id: RISK_ID, kind: 'risk', label: RISK_LABEL, ...(stamp === undefined ? {} : { relies_on: stamp }) });
  return g;
};
const limitsOf = (g: Json): string[] => (g.goal_constraints ?? []).map((c: Json) => c.node_id);
const leftOut = (g: Json): Set<string> => inertRiskBranch(g.nodes, g.edges, limitsOf(g));
const disclosure = `‘${RISK_LABEL}’: ‘${OPTION_LABEL}’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.`;

async function runOn(graph: Json) {
  const before = JSON.stringify(graph);
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: async () => ({ graph: clone(graph), briefText: M1._provenance.brief_text }),
    loadGraph: async () => clone(graph),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'rc3-load', store as never);
  const run = vi.fn(async () => clone(M1.plot_body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'rc3-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 'rc3-turn', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'rc3-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis') as Json;
  expect(fact).toBeDefined();
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  expect(JSON.stringify(graph), 'never change the saved canvas graph').toBe(before);
  return { payload: (run.mock.calls as unknown as [Json][])[0]![0], result: fact.result as Json, snapshot };
}

describe('RC3 a′ identity-keyed readiness and Run exclusion', () => {
  it('rc3-readiness-left-out: readiness unchanged; real loader → handler sends byte-identical Run inputs without it', async () => {
    const plain = baseline();
    const stamped = withRisk();
    const before = assessCanonicalAnalysisReadiness(plain);
    const after = assessCanonicalAnalysisReadiness(stamped);
    expect(before.safeToAnalyse, 'baseline really runs').toBe(true);
    expect(after.safeToAnalyse).toBe(before.safeToAnalyse);
    expect(after.blockingIssues).toEqual(before.blockingIssues);
    expect(validateGraphStructure(stamped as never).valid, 'apply/edit referee permits the server-stamped Add').toBe(true);
    expect([...leftOut(stamped)]).toContain(RISK_ID);
    const controlRun = await runOn(plain);
    const stampedRun = await runOn(stamped);
    expect(JSON.stringify(stampedRun.payload)).toBe(JSON.stringify(controlRun.payload));
    expect(sentDigest(stampedRun.payload)).toBe(sentDigest(controlRun.payload));
    expect((stampedRun.snapshot.graph as Json).nodes.find((n: Json) => n.id === RISK_ID).relies_on).toEqual({ option_id: OPTION_ID });
    // The compute never receives it, and CEE's result has no driver, sensitivity or worth-checking row naming it.
    expect(JSON.stringify(stampedRun.payload)).not.toContain(RISK_ID);
    expect(JSON.stringify(stampedRun.result)).not.toContain(RISK_ID);
    expect(JSON.stringify(stampedRun.result)).not.toContain(RISK_LABEL);
    const facts = structuralFacts(stamped.nodes, stamped.edges, limitsOf(stamped));
    expect(facts.entities_with_no_connections).not.toContain(RISK_LABEL);
    expect(facts.entities_that_cannot_reach_goal).not.toContain(RISK_LABEL);
  });

  it('rc3-unstamped-control: exactly the same zero-edge shape remains an orphan and blocks readiness', () => {
    const unstamped = withRisk();
    delete unstamped.nodes.find((n: Json) => n.id === RISK_ID).relies_on;
    expect(leftOut(unstamped).has(RISK_ID)).toBe(false);
    expect(assessCanonicalAnalysisReadiness(unstamped).safeToAnalyse).toBe(false);
    expect(validateGraphStructure(unstamped as never, { leaveOutInertRisks: true }).violations)
      .toContainEqual(expect.objectContaining({ code: 'ORPHAN_NODE', detail: expect.stringContaining(RISK_ID) }));
    expect(withoutPreconditionRisks(unstamped)).toBe(unstamped);
    expect(structuralFacts(unstamped.nodes, unstamped.edges, limitsOf(unstamped)).entities_with_no_connections).toContain(RISK_LABEL);
  });

  it.each(['pro_plan_price', 'absent_option'])('rc3-stamp-bad-option: %s is not an existing option, so still blocks', (option_id) => {
    const invalid = withRisk({ option_id });
    expect(leftOut(invalid).has(RISK_ID)).toBe(false);
    expect(assessCanonicalAnalysisReadiness(invalid).safeToAnalyse).toBe(false);
    expect(withoutPreconditionRisks(invalid)).toBe(invalid);
  });

  it('rc3-stamp-with-limit: a named limit prevents the exemption', () => {
    const g = withRisk();
    expect(preconditionRiskIds(g.nodes, g.edges, [RISK_ID]).has(RISK_ID)).toBe(false);
    expect(inertRiskBranch(g.nodes, g.edges, [RISK_ID]).has(RISK_ID)).toBe(false);
    g.goal_constraints.push({ constraint_id: 'release_limit', node_id: RISK_ID, operator: '<=', value: 0.1 });
    expect(withoutPreconditionRisks(g)).toBe(g);
  });

  it.each([
    ['incoming', { from: 'pro_plan_price', to: RISK_ID }],
    ['outgoing (M2)', { from: RISK_ID, to: 'mrr' }],
    ['bidirected', { from: 'pro_plan_price', to: RISK_ID, edge_type: 'bidirected' }],
  ])('rc3-stamp-with-edge: %s makes it ineligible, including K3 historical dead-end exemption', (_name, edge) => {
    const g = withRisk();
    g.edges.push({ ...edge, strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' });
    expect(leftOut(g).has(RISK_ID)).toBe(false);
    expect(withoutPreconditionRisks(g)).toBe(g);
    if (edge.from !== RISK_ID) expect(validateGraphStructure(g as never, { leaveOutInertRisks: true }).valid).toBe(false);
  });

  it('rc3-disclosure: the host names the affected option and model limitation, never asks for a goal direction', () => {
    const g = withRisk();
    const at = { restingText: 'Your results are ready.', questionsToggle: false, awaitingApproval: false, builtOrRan: true };
    const lines = decisionInputLines(g, at).filter((line) => line.includes(RISK_LABEL));
    expect(lines).toEqual([disclosure]);
    expect(lines.join(' ')).not.toMatch(/driven by|affects every option alike|whether it raises or lowers/);
    expect(decisionInputLines(g, { ...at, builtOrRan: false }).filter((line) => line.includes(RISK_LABEL))).toEqual([]);
  });

  it('rc3-projection-identity: eligibility reads the saved graph before another projection removes an option or edge', () => {
    const stamped = withRisk();
    const optionRemoved = { ...stamped, nodes: stamped.nodes.filter((n: Json) => n.id !== OPTION_ID) };
    expect((withoutPreconditionRisks(optionRemoved, stamped).nodes as Json[]).some((n) => n.id === RISK_ID)).toBe(false);
    const originallyLinked = withRisk();
    originallyLinked.edges.push({ from: 'pro_plan_price', to: RISK_ID });
    const edgesRemoved = { ...originallyLinked, edges: originallyLinked.edges.filter((e: Json) => e.to !== RISK_ID) };
    expect(withoutPreconditionRisks(edgesRemoved, originallyLinked)).toBe(edgesRemoved);
  });

  it('rc3-raw-identity-control: malformed stamps, noncanonical IDs and duplicate node identities never qualify', () => {
    for (const stamp of [null, '59_price', { option_id: OPTION_ID, extra: true }, { option_id: 59 }]) {
      expect(leftOut(withRisk(stamp)).has(RISK_ID)).toBe(false);
    }
    const noncanonical = withRisk({ option_id: 'Raise Price' });
    noncanonical.nodes.push({ id: 'Raise Price', kind: 'option', label: 'Invalid raw option' });
    expect(leftOut(noncanonical).has(RISK_ID)).toBe(false);
    for (const id of [OPTION_ID, RISK_ID]) {
      const duplicate = withRisk();
      duplicate.nodes.push(clone(duplicate.nodes.find((n: Json) => n.id === id)));
      expect(leftOut(duplicate).has(RISK_ID)).toBe(false);
    }
  });
});
