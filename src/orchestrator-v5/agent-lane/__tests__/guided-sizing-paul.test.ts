/**
 * Round 6 truth row, Paul's literal fixture. Identity Yes reuses the route row's
 * assertion helper and the real proposer/approval/canonical writer. The graph
 * transport is local, as in guided-sizing-honesty.test.ts; no model or engine.
 * Exact product operands do not create a guided list. Follow the real predicates
 * on that same stored graph; point percentages below are AUTHOR word fixtures,
 * conditional on an evaluated, licensed Run, never newly computed results.
 */
import { describe, expect, it } from 'vitest';
import paul from './fixtures/goal-reach-paul-graph-632b92b9.json';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { assertIdentityYes, WORDS } from '../../../routes/__tests__/helpers/goal-reach-confirm-reading.js';
import { convertingOlumiEstimate, targetNotTestableWarning, targetTestabilityOf } from '../../admission/target-testability.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { endsOfGraph, validatedDefinition, validatedDefinitionForGraph } from '../../goal-target/held-user-links.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { applyIdentityConfirmEdit } from '../../system-events/identity-confirm-edit.js';
import { approvalChipsFor } from '../approval-chips.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { placeholderGoalPaths, placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { guidedSizingActions, guidedSizingForRun, guidedSizingProgressLine } from '../guided-sizing.js';
import { ProposalStore } from '../proposal.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { olumiEstimatesFeedingResult } from '../olumi-estimates-feeding-result.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';

type Json = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400a5';
const pairs = [
  { from: 'pro_plan_price', to: 'mrr' },
  { from: 'pro_paying_subscribers', to: 'mrr' },
];
const context = (text: string) => ({ scenario_id: SCENARIO,
  authenticated_user_id: null, request_id: 'guided-paul-r6', user_text: text });
const hashOf = (graph: Json) => computeAnalysisAffectingGraphHash(graph as never)!;

describe('GUIDED PATH round 6 — Paul 632b92b9, without graph repair', () => {
  it('identity Yes → N=0; derived level, converting estimates and evaluated identity → RC4-labelled point words', async () => {
    let graph: Json = structuredClone(paul);
    let graphWrites = 0;
    const store = new ProposalStore();
    const dispatch: InternalDispatch = async path => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: hashOf(graph) } };
      throw new Error(`Paul row forbids dispatch ${path}`);
    };
    const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      expect(input.identity_confirm, 'only the identity Yes may write').toBeDefined();
      const result = applyIdentityConfirmEdit({ persistedGraph: graph,
        ...input.identity_confirm!, expected_graph_hash: input.base_graph_hash });
      expect(result.kind, JSON.stringify(result)).toBe('mutated');
      if (result.kind !== 'mutated') throw new Error(`STOP identity Yes: ${result.reason}`);
      graph = result.mutatedGraph as Json;
      graphWrites += 1;
      return { status: 'committed', graph_hash: hashOf(graph), receipt: null,
        already_applied: false, committed_levels: [], links_resized: [] };
    };
    const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { commitOptionLevels });
    const prepared = await caps.proposeIdentity!(context(WORDS)) as Json;
    expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true, mutated: false });
    const toolCalls = [{ name: 'propose_identity', ok: true, mutated: false, proposal_id: String(prepared.proposal_id) }];
    const card = { _agent: { tool_calls: toolCalls },
      suggested_actions: approvalChipsFor(toolCalls, id => ({ proposal: store.get(id), result: prepared as never })) };
    await assertIdentityYes(card, async (id, message) => {
      const proposalId = id.slice('agent-approve-proposal:'.length);
      const result = await caps.authoriseChange({ ...context(message),
        typed_approval_of: proposalId, typed_approval_words: message }, { proposal_id: proposalId }) as Json;
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: true, applied: true });
      return { ...result, _agent: { tool_calls: [{ name: 'authorise_change' }] } };
    }, id => store.get(id), () => graphWrites, () => graph);
    const optionIds = graph.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => n.id);
    const paths = unsizedLeaderGoalPaths(graph, optionIds);
    const verdict = targetTestabilityOf(graph);
    const placeholderWarning = paths.length > 0
      ? placeholderGoalWarning(graph, paths, 'GOAL_FIGURES_PLACEHOLDER_PATH') : null;
    const targetWarning = targetNotTestableWarning(graph, verdict, optionIds, 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    const run = { enrichment: { inference_warnings: [placeholderWarning, targetWarning].filter(Boolean) } };
    const draft = guidedSizingForRun(run, graph);
    const actions = guidedSizingActions(draft, graph);
    const actualHeader = goalChanceWithheldForAgent(run, graph)?.say ?? null;
    const physical = graph.edges.filter((e: Json) => linkSizing(e) === 'placeholder')
      .map(({ from, to }: Json) => ({ from, to }));
    // FIRST post-Yes assertion: the two physical placeholders are exact operands,
    // not unsized causal links. No list, sizing press, header or progress is owed.
    expect({ physical, paths, N: draft?.total ?? 0, list: draft?.links ?? [], actions, header: actualHeader })
      .toEqual({ physical: pairs, paths: [], N: 0, list: [], actions: [], header: null });
    expect(draft).toBeUndefined();
    expect(guidedSizingProgressLine(graph)).toBeNull();
    expect(graph.edges, 'the real Yes must not repair or resize any edge').toEqual(paul.edges);

    // (a), P45 confirmedProductHasLevels: no goal baseline is stored, but the
    // confirmed operands supply 49 × 8000 £/month. P5 still belongs to the Run.
    const goal = graph.nodes.find((n: Json) => n.id === 'mrr');
    expect(goal.observed_state?.baseline).toBeUndefined();
    expect(goal.nonlinear_identity).toEqual({ operation: 'product', factor_ids: pairs.map(p => p.from), stated_in_brief: true });
    const levels = pairs.map(p => graph.nodes.find((n: Json) => n.id === p.from).observed_state);
    expect(levels.map(l => [l.raw_value, l.unit])).toEqual([[49, '£/subscriber/month'], [8000, 'subscribers']]);
    expect(levels[0]!.raw_value * levels[1]!.raw_value).toBe(392000);
    expect(verdict).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
    expect(targetWarning).toBeNull();

    // (c): all three stored estimates convert; identities/definitions do not
    // turn these into an invented guided journey.
    const ends = endsOfGraph(graph);
    const estimates = graph.edges.filter((e: Json) => linkSizing(e) === 'olumi_estimate');
    const conversionRows = estimates.map((e: Json) => ({ id: `${e.from}->${e.to}`,
      converts: convertingOlumiEstimate(e, graph), definition_unit: validatedDefinition(e, ends(e)) ?? null }));
    expect(conversionRows).toEqual([
      { id: 'pro_plan_price->monthly_churn_rate', converts: true, definition_unit: null },
      { id: 'monthly_churn_rate->mrr_lost_to_price_driven_churn', converts: true, definition_unit: null },
      { id: 'mrr_lost_to_price_driven_churn->mrr', converts: true, definition_unit: '£/month' },
    ]);

    // F1b placeholderGoalPaths needs the Run's evaluation, even after Yes. The
    // actual run-withhold producer uses unsizedLeaderGoalPaths (already [] above).
    const noEvaluation = placeholderGoalPaths(graph, optionIds);
    expect(noEvaluation).toEqual([
      { option_id: 'raise_pro_price_to_59', links: [pairs[0]] },
      { option_id: 'test_54_pro_price', links: [pairs[0]] },
      { option_id: 'cfae7d0a', links: [pairs[1]] },
    ]);
    const evaluations = [{ node_id: 'mrr', evaluated: true }];
    expect(placeholderGoalPaths(graph, optionIds, evaluations)).toEqual([]);

    // Same graph, author-supplied Run figures for copy testing only. No graph
    // alone promises a point: no licence/evaluation result is manufactured as fact.
    expect(goalChanceScreenLinesForAgent(run, graph, true)).toEqual([]);
    const wordRun = withGoalChanceLicence({ identity_evaluations: evaluations,
      option_comparison: optionIds.map((option_id: string) => ({ option_id,
        ...(option_id === 'raise_pro_price_to_59' ? { probability_of_goal: 0.46 }
          : option_id === 'test_54_pro_price' ? { probability_of_goal: 0.45 } : {}) })),
      inference_warnings: [] }, graph, 'mrr');
    const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph,
      analysisState: undefined, analysisResult: wordRun, leaderLicensed: false, identityEvaluations: evaluations });
    const candidates = signals['model.goal_path_links'].filter(l => l.link_sizing === 'olumi_estimate');
    expect(candidates.map(l => l.link_id)).toEqual(conversionRows.map(l => l.id));
    const census = olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(graph),
      goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] });
    expect(census.links.map(l => l.id)).toEqual(conversionRows.slice(0, 2).map(l => l.id));
    expect(census.links).toHaveLength(2);
    const points = goalChanceScreenLinesForAgent(wordRun, graph, true);
    expect(points.map(p => p.chance)).toEqual([
      "‘Raise Pro price to £59’: about 46% chance of meeting your goal, in this model, using Olumi's estimates for 2 links (see Check estimates).",
      "‘Test £54 Pro price’: about 45% chance of meeting your goal, in this model, using Olumi's estimates for 2 links (see Check estimates).",
    ]);
    expect(points.map(p => p.olumi_estimate_link_count)).toEqual([2, 2]);
    const reply = withScreenLinesOwed('This Run is ready.', points);
    for (const point of points) expect(reply.text).toContain(point.chance);
    expect(goalChanceWithheldForAgent(wordRun, graph)).toBeUndefined();
    expect(graphWrites).toBe(1);
    expect(graph.edges).toEqual(paul.edges);

    // Negative P45 control: removing a raw operand level on a COPY restores (a).
    const missingLevel = structuredClone(graph);
    delete missingLevel.nodes.find((n: Json) => n.id === 'pro_paying_subscribers').observed_state.raw_value;
    expect(targetTestabilityOf(missingLevel)).toMatchObject({ kind: 'not_testable',
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
    process.stdout.write(`PAUL_GUIDED_R6 ${JSON.stringify({ graph_writes: graphWrites, physical_placeholders: physical,
      N: draft?.total ?? 0, verdict, conversionRows, placeholder_without_evaluation: noEvaluation,
      placeholder_with_evaluation: placeholderGoalPaths(graph, optionIds, evaluations),
      k_before: candidates.length, k_after: census.links.length, counted_link_ids: census.links.map(l => l.id),
      point_evidence: 'author word fixture; conditional on an evaluated licensed Run', points })}\n`);
  });
});
