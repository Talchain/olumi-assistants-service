/**
 * Round 3 P1: executable measurements, NOT a claim that the approved words are honest.
 * Unchanged captures keep their existing estimates. Historical warnings lacking acceptable_links
 * project the SAME captured links into that carrier, exactly as the r1/r2 rows do.
 * Synthetic user answers below exercise the REAL proposer, approval and canonical writer;
 * no stand-in provenance write or graph repair is allowed in this measurement.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyEdgeStrengthEdit } from '../../system-events/edge-strength-edit.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { approvalChipsFor } from '../approval-chips.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { placeholderGoalPaths } from '../goal-certainty.js';
import { guidedSizingForRun, guidedSizingSentence } from '../guided-sizing.js';
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
    case_c: [pair('monthly_churn', 'paying_pro_subscribers'), pair('pro_plan_price', 'mrr_lost_to_price_sensitivity'), pair('pro_plan_price', 'monthly_churn')],
    guided: [pair('monthly_churn', 'paying_pro_subscribers'), pair('pro_plan_price', 'mrr_lost_to_price_sensitivity')],
    outside: [pair('pro_plan_price', 'monthly_churn')],
    natural_residual: [pair('pro_plan_price', 'monthly_churn')],
    band_residual: [pair('pro_plan_price', 'monthly_churn')],
    answers: [
      { ...pair('monthly_churn', 'paying_pro_subscribers'), amount: -2, amount_unit: 'subscribers', per_source_change_unit: 'percentage points' },
      { ...pair('pro_plan_price', 'mrr_lost_to_price_sensitivity'), amount: 1, amount_unit: '£/month', per_source_change_unit: '£/month' },
    ] },
  { name: 'D1', graph: graphs.D1.graph, run: load('served-g1b501-draft1-placeholder-target.json').analysis_result, evaluated: [],
    case_c: [pair('starter_tier_mrr', 'monthly_recurring_revenue'), pair('starter_monthly_price', 'starter_tier_mrr'),
      pair('starter_tier_support_cost', 'mrr_lost_to_starter_support_strain'), pair('starter_subscribers', 'starter_tier_support_cost'),
      pair('starter_support_cost_per_subscriber', 'starter_tier_support_cost')],
    guided: [pair('starter_tier_mrr', 'monthly_recurring_revenue'), pair('starter_tier_support_cost', 'mrr_lost_to_starter_support_strain')],
    outside: [pair('starter_monthly_price', 'starter_tier_mrr'), pair('starter_subscribers', 'starter_tier_support_cost'),
      pair('starter_support_cost_per_subscriber', 'starter_tier_support_cost')],
    natural_residual: [pair('starter_monthly_price', 'starter_tier_mrr'), pair('starter_subscribers', 'starter_tier_support_cost'),
      pair('starter_support_cost_per_subscriber', 'starter_tier_support_cost')],
    band_residual: [pair('starter_tier_mrr', 'monthly_recurring_revenue'), pair('starter_monthly_price', 'starter_tier_mrr'),
      pair('starter_subscribers', 'starter_tier_support_cost'), pair('starter_support_cost_per_subscriber', 'starter_tier_support_cost')],
    answers: [
      { ...pair('starter_tier_mrr', 'monthly_recurring_revenue'), amount: 2, amount_unit: '£/month', per_source_change_unit: '£/month',
        quote: 'Every £1 per month increase in Starter tier MRR adds £2 per month to monthly recurring revenue.' },
      { ...pair('starter_tier_support_cost', 'mrr_lost_to_starter_support_strain'), amount: 1, amount_unit: '£/month', per_source_change_unit: '£/month' },
    ] },
  { name: 'booking', graph: graphs.booking.graph, run: load('served-item3-run1-placeholder-target.json').analysis_result, evaluated: [],
    case_c: [pair('receptionist_headcount', 'monthly_booked_appointments'), pair('online_booking_availability', 'monthly_booked_appointments'),
      pair('additional_evening_opening_hours', 'monthly_booked_appointments'), pair('online_booking_rollout_disruption', 'monthly_booked_appointments'),
      pair('online_booking_availability', 'online_booking_rollout_disruption')],
    guided: [pair('online_booking_rollout_disruption', 'monthly_booked_appointments'), pair('online_booking_availability', 'online_booking_rollout_disruption')],
    outside: [pair('receptionist_headcount', 'monthly_booked_appointments'), pair('online_booking_availability', 'monthly_booked_appointments'),
      pair('additional_evening_opening_hours', 'monthly_booked_appointments')],
    natural_residual: [pair('receptionist_headcount', 'monthly_booked_appointments'), pair('online_booking_availability', 'monthly_booked_appointments'),
      pair('additional_evening_opening_hours', 'monthly_booked_appointments'), pair('online_booking_rollout_disruption', 'monthly_booked_appointments')],
    band_residual: [pair('receptionist_headcount', 'monthly_booked_appointments'), pair('online_booking_availability', 'monthly_booked_appointments'),
      pair('additional_evening_opening_hours', 'monthly_booked_appointments')],
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
  return { attempts, case_c: caseC(graph, capture.evaluated), placeholder_path: placeholders(graph, capture.evaluated),
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
  return { attempts, case_c: caseC(graph, capture.evaluated), placeholder_path: placeholders(graph, capture.evaluated),
    stored_guided: sized(graph, guided) };
}

describe.each(captures)('GUIDED HONESTY diagnostic: $name (approval words STOP)', capture => {
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
    process.stdout.write(`HONESTY_MEASUREMENT ${JSON.stringify(measurement)}\n`);
  });

  it('(a): measured case(c) minus guided by endpoint, every outside link already has an estimate', () => {
    expect(keys(measurement.initial_case_c)).toEqual(keys(capture.case_c));
    expect(keys(measurement.guided)).toEqual(keys(capture.guided));
    expect(keys(measurement.original_placeholder_path)).toEqual(keys(capture.guided));
    expect(keys(measurement.case_c_minus_guided)).toEqual(keys(capture.outside));
    expect(measurement.already_sized_outside.every((e: Json) => e.sizing === 'olumi_estimate' && e.natural_effect !== undefined)).toBe(true);
  });

  it('(b), propose_link_effect → approved canonical commit: PLACEHOLDER_PATH clears, case(c) remains RED', () => {
    expect(keys(measurement.natural.attempts)).toEqual(keys(capture.guided));
    expect(keys(measurement.natural.case_c)).toEqual(keys(capture.natural_residual));
    expect(measurement.natural.placeholder_path).toEqual([]);
    expect(measurement.natural.case_c.length).toBeGreaterThan(0);
  });

  it('(b), inspector → adjust_edge_strength: PLACEHOLDER_PATH clears, case(c) remains RED', () => {
    expect(keys(measurement.inspector.attempts)).toEqual(keys(capture.guided));
    expect(keys(measurement.inspector.case_c)).toEqual(keys(capture.band_residual));
    expect(measurement.inspector.placeholder_path).toEqual([]);
    expect(measurement.inspector.case_c.length).toBeGreaterThan(0);
    expect(measurement.inspector.stored_guided.every((e: Json) => e.sizing === 'user' && e.natural_effect === undefined)).toBe(true);
  });

  it('composition: existing level ask then exact guided words, no leftover case(c) clause; NOT honesty acceptance', () => {
    const said = goalChanceWithheldForAgent(runFor(capture), capture.graph)?.say;
    const level = capture.name === 'draw-2' ? "What's today's level of MRR? " : '';
    expect(said).toBe(`${level}${guidedSizingSentence(capture.guided.length)}`);
    expect(said).not.toContain('a size for the link');
  });
});
