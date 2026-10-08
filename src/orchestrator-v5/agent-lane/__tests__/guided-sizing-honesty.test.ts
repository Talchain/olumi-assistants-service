/**
 * Round 4: executable measurements against the amended case(c), with captured provenance kept intact.
 * Unchanged captures keep their existing estimates. Historical warnings lacking acceptable_links
 * project the SAME captured links into that carrier, exactly as the r1/r2 rows do.
 * Synthetic user answers below exercise the REAL proposer, approval and canonical writer;
 * no stand-in provenance write or graph repair is allowed in this measurement.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { targetNotTestableWarning, targetTestabilityOf } from '../../admission/target-testability.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyEdgeStrengthEdit } from '../../system-events/edge-strength-edit.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { approvalChipsFor } from '../approval-chips.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { placeholderGoalPaths } from '../goal-certainty.js';
import { guidedSizingForRun, guidedSizingSentence } from '../guided-sizing.js';
import { guidedSizingActions, guidedSizingProgressLine } from '../guided-sizing.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import * as estimateProducer from '../olumi-estimates-feeding-result.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { validatedDefinitionForGraph } from '../../goal-target/held-user-links.js';
import { ProposalStore } from '../proposal.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';

type Json = Record<string, any>;
type Pair = { from: string; to: string };
type Answer = Pair & { amount: number; amount_unit: string; per_source_change_unit: string; quote?: string };
const load = (file: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
const draw = load('guided-sizing-draw2.json');
const graphs = load('guided-sizing-honesty-graphs.json');
const pair = (from: string, to: string): Pair => ({ from, to });
const key = (p: Pair): string => `${p.from}→${p.to}`;
const keys = (links: readonly Pair[]): string[] => links.map(key).sort();
const caseC = (graph: Json, evaluated: readonly unknown[]): Pair[] => {
  const verdict = targetTestabilityOf(graph, evaluated);
  return verdict.kind === 'not_testable' ? verdict.failures.find(f => f.case === 'c')?.links ?? [] : [];
};
const options = (graph: Json): string[] => graph.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => n.id);
const placeholders = (graph: Json, evaluated: readonly unknown[]): Pair[] =>
  [...new Map(placeholderGoalPaths(graph, options(graph), [...evaluated]).flatMap(p => p.links).map(l => [key(l), l])).values()];
const sized = (graph: Json, links: readonly Pair[]): Json[] => links.map(link => {
  const edge = graph.edges.find((e: Json) => e.from === link.from && e.to === link.to);
  return { ...link, sizing: linkSizing(edge), strength: edge.strength,
    magnitude: edge.provenance?.magnitude, natural_effect: edge.provenance?.natural_effect };
});

const captures = [
  { name: 'draw-2', graph: draw.graph, run: draw.run, evaluated: [{ node_id: 'mrr', evaluated: true }],
    case_c: [pair('monthly_churn', 'paying_pro_subscribers'), pair('pro_plan_price', 'mrr_lost_to_price_sensitivity')],
    guided: [pair('monthly_churn', 'paying_pro_subscribers'), pair('pro_plan_price', 'mrr_lost_to_price_sensitivity')],
    outside: [],
    natural_residual: [],
    band_residual: [],
    answers: [
      { ...pair('monthly_churn', 'paying_pro_subscribers'), amount: -2, amount_unit: 'subscribers', per_source_change_unit: 'percentage points' },
      { ...pair('pro_plan_price', 'mrr_lost_to_price_sensitivity'), amount: 1, amount_unit: '£/month', per_source_change_unit: '£/month' },
    ] },
  { name: 'D1', graph: graphs.D1.graph, run: load('served-g1b501-draft1-placeholder-target.json').analysis_result, evaluated: [],
    case_c: [pair('starter_tier_mrr', 'monthly_recurring_revenue'), pair('starter_tier_support_cost', 'mrr_lost_to_starter_support_strain')],
    guided: [pair('starter_tier_mrr', 'monthly_recurring_revenue'), pair('starter_tier_support_cost', 'mrr_lost_to_starter_support_strain')],
    outside: [],
    natural_residual: [],
    band_residual: [pair('starter_tier_mrr', 'monthly_recurring_revenue')],
    answers: [
      { ...pair('starter_tier_mrr', 'monthly_recurring_revenue'), amount: 2, amount_unit: '£/month', per_source_change_unit: '£/month',
        quote: 'Every £1 per month increase in Starter tier MRR adds £2 per month to monthly recurring revenue.' },
      { ...pair('starter_tier_support_cost', 'mrr_lost_to_starter_support_strain'), amount: 1, amount_unit: '£/month', per_source_change_unit: '£/month' },
    ] },
  { name: 'booking', graph: graphs.booking.graph, run: load('served-item3-run1-placeholder-target.json').analysis_result, evaluated: [],
    case_c: [pair('online_booking_rollout_disruption', 'monthly_booked_appointments'), pair('online_booking_availability', 'online_booking_rollout_disruption')],
    guided: [pair('online_booking_rollout_disruption', 'monthly_booked_appointments'), pair('online_booking_availability', 'online_booking_rollout_disruption')],
    outside: [],
    natural_residual: [pair('online_booking_rollout_disruption', 'monthly_booked_appointments')],
    band_residual: [],
    answers: [
      { ...pair('online_booking_rollout_disruption', 'monthly_booked_appointments'), amount: -2, amount_unit: 'appointments/month', per_source_change_unit: 'disruptions',
        quote: 'Each online booking rollout disruption reduces Monthly booked appointments by 2 appointments per month.' },
      // The existing gauge reads this answer end to end and writes both path links in one commit.
      { ...pair('online_booking_availability', 'online_booking_rollout_disruption'), amount: -1, amount_unit: 'appointments/month', per_source_change_unit: 'switch' },
    ] },
] as const;

/** Old captures retain their literal warning; only the missing typed membership carrier is projected. */
function runFor(capture: typeof captures[number]): Json {
  const run = structuredClone(capture.run);
  const warnings = run.enrichment.inference_warnings;
  for (const warning of warnings) if (warning.code === 'GOAL_FIGURES_PLACEHOLDER_PATH' && warning.acceptable_links === undefined)
    warning.acceptable_links = structuredClone(warning.links);
  return run;
}
const context = (text: string, link?: Pair) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7',
  authenticated_user_id: null, request_id: 'guided-honesty', user_text: text,
  ...(link ? { grounded_selection: { element_ids: [link.from, link.to], unresolved: 'none' as const },
    grounded_links: [link] } : {}) });

async function naturalDoor(capture: typeof captures[number], guided: readonly Pair[]): Promise<Json> {
  let graph = structuredClone(capture.graph) as Json;
  const store = new ProposalStore();
  const attempts: Json[] = [];
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`offline measurement forbids dispatch ${path}`);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const le = input.link_effect!;
    const result = applyLinkEffectEdit({ persistedGraph: graph, from: le.from, to: le.to, effect: le.effect,
      quote: le.quote, reading_token: le.reading_token,
      expected: { graph_hash: input.base_graph_hash, edge_token: le.edge_token },
      unit_readings: le.unit_readings, reversal: le.reversal, link_selected: le.link_selected, frameRefit: true });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') throw new Error(result.reason);
    graph = result.mutatedGraph as Json;
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null,
      already_applied: false, committed_levels: [], links_resized: [] };
  };
  const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { commitOptionLevels });
  for (const link of guided) {
    const answer = capture.answers.find(a => key(a) === key(link))! as Answer;
    const label = (id: string) => graph.nodes.find((n: Json) => n.id === id).label as string;
    const quote = answer.quote ?? `Every 1 ${answer.per_source_change_unit} increase in ${label(link.from)} ${answer.amount < 0 ? 'reduces' : 'increases'} ${label(link.to)} by ${Math.abs(answer.amount)} ${answer.amount_unit}.`;
    const prepared = await caps.proposeLinkEffect!(context(quote, link), { from_label: label(link.from), to_label: label(link.to),
      amount: answer.amount, amount_unit: answer.amount_unit, per_source_change: 1,
      per_source_change_unit: answer.per_source_change_unit, quote }) as Json;
    if (prepared.ok !== true) { attempts.push({ ...link, result: 'refused', refusal: prepared.refusal, detail: prepared.detail }); continue; }
    const proposalId = String(prepared.proposal_id);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: proposalId }],
      id => ({ proposal: store.get(id), result: prepared as never }))[0]!;
    const approved = await caps.authoriseChange({ ...context(card.message), typed_approval_of: proposalId, typed_approval_words: card.message },
      { proposal_id: proposalId }) as Json;
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, mutated: true, applied: true });
    attempts.push({ ...link, result: 'committed', quote });
  }
  return { graph, attempts, case_c: caseC(graph, capture.evaluated), placeholder_path: placeholders(graph, capture.evaluated),
    stored_guided: sized(graph, guided) };
}

async function inspectorDoor(capture: typeof captures[number], guided: readonly Pair[]): Promise<Json> {
  let graph = structuredClone(capture.graph) as Json;
  const attempts: Json[] = [];
  for (const [index, link] of guided.entries()) {
    const edge = graph.edges.find((e: Json) => e.from === link.from && e.to === link.to);
    const payload = OrchestratorTurnPayloadSchema.parse({ kind: 'system_event',
      scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', turn_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
      stage: 'analyse', event: { kind: 'edge_strength_edit', ...link, intent: 'set', magnitude: 0.3, band: 'moderate',
        direction_intent: 'preserve', expected: { mean: edge.strength.mean, effect_direction: edge.effect_direction } } }) as SystemEventTurnPayload;
    if (payload.event.kind !== 'edge_strength_edit') throw new Error('wrong inspector event');
    const result = await applyEdgeStrengthEdit({ payload, event: payload.event, requestId: 'guided-honesty', persistedGraph: graph });
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind === 'mutated') graph = result.mutatedGraph as Json;
    attempts.push({ ...link, result: result.kind });
  }
  return { graph, attempts, case_c: caseC(graph, capture.evaluated), placeholder_path: placeholders(graph, capture.evaluated),
    stored_guided: sized(graph, guided) };
}

describe.each(captures)('GUIDED HONESTY amended diagnostic: $name', capture => {
  let measurement: Json;
  beforeAll(async () => {
    const run = runFor(capture);
    const draft = guidedSizingForRun(run, capture.graph)!;
    const guided = draft.links.map(({ from, to }) => ({ from, to }));
    const initialC = caseC(capture.graph, capture.evaluated);
    const outside = initialC.filter(link => !guided.some(g => key(g) === key(link)));
    measurement = { capture: capture.name, graph_source: capture.name === 'draw-2' ? draw.capture.graph_source : graphs[capture.name].capture.graph_source,
      initial_case_c: initialC, original_placeholder_path: placeholders(capture.graph, capture.evaluated), guided,
      case_c_minus_guided: outside, already_sized_outside: sized(capture.graph, outside),
      natural: await naturalDoor(capture, guided), inspector: await inspectorDoor(capture, guided) };
    process.stdout.write(`HONESTY_MEASUREMENT ${JSON.stringify(measurement, (key, value) => key === 'graph' ? undefined : value)}\n`);
  });

  it('(a): the converting estimates no longer sit outside the guided placeholders in case(c)', () => {
    expect(keys(measurement.initial_case_c)).toEqual(keys(capture.case_c));
    expect(keys(measurement.guided)).toEqual(keys(capture.guided));
    expect(keys(measurement.original_placeholder_path)).toEqual(keys(capture.guided));
    expect(keys(measurement.case_c_minus_guided)).toEqual(keys(capture.outside));
    expect(measurement.already_sized_outside).toEqual([]);
  });

  it('(b), propose_link_effect → approved canonical commit: PLACEHOLDER_PATH clears, only refused conversion remains in case(c)', () => {
    expect(keys(measurement.natural.attempts)).toEqual(keys(capture.guided));
    expect(keys(measurement.natural.case_c)).toEqual(keys(capture.natural_residual));
    expect(measurement.natural.placeholder_path).toEqual([]);
    expect(measurement.natural.case_c).toHaveLength(capture.natural_residual.length);
  });

  it('(b), inspector → adjust_edge_strength: PLACEHOLDER_PATH clears, only the non-converting goal-end band remains in case(c)', () => {
    expect(keys(measurement.inspector.attempts)).toEqual(keys(capture.guided));
    expect(keys(measurement.inspector.case_c)).toEqual(keys(capture.band_residual));
    expect(measurement.inspector.placeholder_path).toEqual([]);
    expect(measurement.inspector.case_c).toHaveLength(capture.band_residual.length);
    expect(measurement.inspector.stored_guided.every((e: Json) => e.sizing === 'user' && e.natural_effect === undefined)).toBe(true);
  });

  it('composition: existing level ask then exact guided words, no leftover case(c) clause; NOT honesty acceptance', () => {
    const said = goalChanceWithheldForAgent(runFor(capture), capture.graph)?.say;
    const level = capture.name === 'draw-2' ? "What's today's level of MRR? " : '';
    expect(said).toBe(`${level}${guidedSizingSentence(capture.guided.length)}`);
    expect(said).not.toContain('a size for the link');
  });
});

/** The graph/approval witness is captured. 46% is an AUTHOR word fixture, never a newly computed engine result. */
function pointWordRun(graph: Json): Json {
  const ids = options(graph);
  return withGoalChanceLicence({ option_comparison: ids.map((option_id, i) => ({ option_id,
    ...(i < 2 ? { probability_of_goal: i === 0 ? 0.46 : 0.45 } : {}) })), inference_warnings: [] }, graph, 'mrr');
}

function estimatesFor(graph: Json) {
  const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph,
    analysisState: undefined, analysisResult: undefined, leaderLicensed: false, identityEvaluations: captures[0].evaluated });
  return estimateProducer.olumiEstimatesFeedingResult({
    validatedDefinitionForLink: validatedDefinitionForGraph(graph),
    goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'],
  });
}

describe('GUIDED HONESTY round 4: the displayed point pays for relaxed case(c)', () => {
  const capture = captures[0];
  const byDoor: Record<string, Json> = {};
  beforeAll(async () => {
    // Size precisely the TWO captured placeholders, never the residual Olumi estimate.
    byDoor.natural = await naturalDoor(capture, capture.guided);
    byDoor.inspector = await inspectorDoor(capture, capture.guided);
  });

  it.each(['natural', 'inspector'])('draw-2 through %s: both placeholders and case(c) clear; RC4-backed point counts 1 estimated link, excluding the validated definition', door => {
    const measured = byDoor[door]!;
    expect(measured.attempts.map((a: Json) => a.result)).toEqual(['committed', 'committed'].map(s => door === 'inspector' ? 'mutated' : s));
    expect(measured.placeholder_path).toEqual([]);
    expect(measured.case_c).toEqual([]);
    // Science RC4: the loss→MRR link is validated arithmetic, so only the residual churn size is estimated.
    expect(estimatesFor(measured.graph).links.map(item => item.id)).toEqual([
      'pro_plan_price->monthly_churn',
    ]);
    const run = pointWordRun(measured.graph);
    const lines = goalChanceScreenLinesForAgent(run, measured.graph, true);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.chance).toBe('‘Raise Pro price to £59’: about 46% chance of meeting your goal, in this model, using Olumi\'s estimates for 1 link (see Check estimates).');
    const reply = withScreenLinesOwed('This Run is ready.', lines);
    expect(reply.text).toContain(lines[0]!.chance);
    expect(reply.text).toContain('using Olumi\'s estimates for 1 link (see Check estimates)');
  });

  it('MUTANT: relaxed case(c), but the narrator gave the unlabelled chance → RED', () => {
    const graph = byDoor.natural!.graph;
    const lines = goalChanceScreenLinesForAgent(pointWordRun(graph), graph, true);
    expect(lines).toHaveLength(2);
    const bare = '‘Raise Pro price to £59’: about 46% chance of meeting your goal, in this model.';
    const text = withScreenLinesOwed(bare, [lines[0]!]).text;
    expect(text).toContain('using Olumi\'s estimates for 1 link (see Check estimates)');
    expect(text).not.toContain(bare);
  });

  it('MUTANT: placeholder with an estimate tag and a natural effect is STILL a placeholder → RED', () => {
    const graph = structuredClone(byDoor.natural!.graph);
    const link = capture.guided[0]!;
    const edge = graph.edges.find((e: Json & Pair) => key(e) === key(link));
    edge.provenance.magnitude = 'olumi_estimate';
    edge.provenance.mean_projected = true;
    expect(linkSizing(edge)).toBe('placeholder');
    expect(keys(caseC(graph, capture.evaluated))).toContain(key(link));
    expect(keys(placeholders(graph, capture.evaluated))).toContain(key(link));
  });

  it('MUTANT: estimate without its converting natural effect stays in case(c) → RED', () => {
    const graph = structuredClone(byDoor.natural!.graph);
    const residual = pair('pro_plan_price', 'monthly_churn');
    const edge = graph.edges.find((e: Json & Pair) => key(e) === key(residual));
    delete edge.provenance.natural_effect;
    expect(linkSizing(edge)).toBe('olumi_estimate');
    expect(keys(caseC(graph, capture.evaluated))).toContain(key(residual));
  });

  it.each([1, 7])('MUTANT: k from any non-RC4 count → RED (producer sentinel %i differs from graph and value counts)', k => {
    const graph = byDoor.natural!.graph;
    const base = estimatesFor(graph);
    const sentinel = { ...base, count: 19, values: Array.from({ length: 12 }, (_, i) => ({ kind: 'value' as const,
      id: `sentinel-value-${i}`, label: 'Sentinel value', goal_distance: 0 })), links: Array.from({ length: k }, (_, i) => ({
      kind: 'link' as const, id: `sentinel-link-${i}`, label: 'Sentinel link', goal_distance: 0 })) };
    const spy = vi.spyOn(estimateProducer, 'olumiEstimatesFeedingResult').mockReturnValue(sentinel);
    try {
      const run = pointWordRun(graph); // RC4 attribution is stored by the Run producer, before either renderer reads it.
      const lines = goalChanceScreenLinesForAgent(run, graph, true);
      expect(spy).toHaveBeenCalled();
      expect(lines[0]!.chance).toBe(`‘Raise Pro price to £59’: about 46% chance of meeting your goal, in this model, using Olumi's estimates for ${k} ${k === 1 ? 'link' : 'links'} (see Check estimates).`);
    } finally { spy.mockRestore(); }
  });
});

describe('GUIDED HONESTY round 4: D1 non-converting band uses the same guided list', () => {
  const capture = captures[1];
  const band = pair('starter_tier_mrr', 'monthly_recurring_revenue');
  const words = "How much does ‘Starter tier MRR’ change ‘monthly recurring revenue’, in £/month? Olumi has it as a band, which can't be turned into your goal's units.";

  it('AUTHOR estimate twin of D1: band follows the remaining placeholder, keeps case(c), and names the existing end-unit reader’s unit', () => {
    const graph = structuredClone(capture.graph);
    // The stored D1 edge is a placeholder. This explicit class twin exercises an Olumi ESTIMATE with the same band.
    const edge = graph.edges.find((e: Json & Pair) => key(e) === key(band));
    expect(linkSizing(edge)).toBe('placeholder');
    edge.provenance.magnitude = 'olumi_estimate';
    const draft = guidedSizingForRun(runFor(capture), graph)!;
    expect(draft.total).toBe(1);
    expect(draft.links.map(key)).toHaveLength(2);
    expect(key(draft.links[1]!)).toBe(key(band));
    expect(keys(caseC(graph, capture.evaluated))).toContain(key(band));
    const action = guidedSizingActions(draft, graph).find(a => key(a.parameters) === key(band));
    expect(action?.label).toBe(words);
    expect(action?.message).toBe(words);
  });

  it('only a non-converting link: no N=0 header or placeholder progress; the same press remains', async () => {
    // The real inspector turns both stored placeholders into user bands. The goal-end band still refuses conversion.
    const measured = await inspectorDoor(capture, capture.guided);
    const graph = measured.graph;
    const warning = targetNotTestableWarning(graph, targetTestabilityOf(graph), options(graph), 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    expect(warning).not.toBeNull();
    const run = { enrichment: { inference_warnings: [warning] } };
    const draft = guidedSizingForRun(run, graph)!;
    expect(draft).toBeDefined();
    expect(draft.total).toBe(0);
    expect(keys(draft.links)).toEqual([key(band)]);
    expect(guidedSizingActions(draft, graph)[0]?.label).toBe(words);
    expect(goalChanceWithheldForAgent(run, graph)?.say ?? '').not.toContain('Not shown yet: 0 links');
    expect(guidedSizingProgressLine(graph)).toBeNull();
  });
});
