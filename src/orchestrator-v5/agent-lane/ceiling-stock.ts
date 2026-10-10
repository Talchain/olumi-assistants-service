import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { readGoalRecord } from '../goal-target/goal-record.js';
import { readCount, readUnitParts, words } from './same-unit.js';
import { periodNoun } from '../../utils/unit-alphabet.js';
import { ceilingTheUserWroteFor, figureTheUserWroteSpan, figureTheUserWroteForSpan, hasApproximateFigureQualifier } from './stated-by-user.js';
import { sayFigureAsWritten } from './say-figure.js';
import type { IdentityProposal } from './identity-proposal.js';
import { assignEntityRefs } from '../graph/entity-refs.js';

const quantity = z.object({ id: z.string().min(1), raw_value: z.number().finite(), unit: z.string().min(1) }).strict();
/** Server-only pending authority; the canonical writer reattests it against its own graph AND brief. */
export const CeilingStockPendingSchema = z.object({
  stock: quantity, flow: quantity, ceiling: quantity, goal_id: z.string().min(1),
  horizon_months: z.number().int().min(1).max(120), comparator: z.literal('<='),
  coverage: z.enum(['throughout', 'at_month_only']),
  transformation: z.object({ carrier_id: z.string().min(1), zero_id: z.string().min(1),
    carrier_label: z.string().min(1), scale_frame: z.number().finite().positive() }).strict(),
}).strict();
export type CeilingStockPending = z.infer<typeof CeilingStockPendingSchema>;
type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const frame = (n: Rec) => n.observed_state?.cap ?? n.scale_frame;
const levelUnit = (u: unknown) => {
  const p = readUnitParts(u);
  return p !== null && ['count', 'currency'].includes(p.kind) && p.period === null && p.per === null ? p : null;
};
const sameNoun = (a: unknown, b: unknown) => levelUnit(a) !== null && isDeepStrictEqual(levelUnit(a), levelUnit(b));

/** The existing amount authority binds the value; this separate recogniser reads CURRENT/LIMIT/net roles. */
export function recogniseCeilingStock(graph: unknown, brief: string | null | undefined): CeilingStockPending | null {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || typeof brief !== 'string') return null;
  const nodes: Rec[] = graph.nodes.filter(rec), goals = nodes.filter(n => n.kind === 'goal');
  const goal = goals[0], h = goal && readGoalRecord(graph, goal.id)?.horizon?.months;
  if (goals.length !== 1 || goal.nonlinear_identity != null || goal.goal_stock_reading === 'one_off'
    || h === undefined || h < 1 || h > 120 || goal.observed_state != null
    || ['user_stated', 'user_ratified'].includes(classifyValueSource(goal.threshold_source))
    || graph.goal_constraints?.some((r: Rec) => r.node_id === goal.id && r.provenance === 'explicit')) return null;
  const rows = nodes.flatMap(n => {
    const os = n.observed_state;
    if (n.kind !== 'factor' || !rec(os) || classifyValueSource(os.source) !== 'user_stated'
      || typeof os.raw_value !== 'number' || !Number.isFinite(os.raw_value) || typeof os.unit !== 'string') return [];
    const span = figureTheUserWroteSpan(Math.abs(os.raw_value), os.unit, brief);
    if (span === null) return [];
    // Sentence boundaries do not split thousands separators or decimal figures.
    const left = brief.slice(0, span.start), right = brief.slice(span.end);
    const start = [...left.matchAll(/[.!?](?=\s)|[;\n]/g)].at(-1)?.index;
    const end = right.search(/[.!?](?=\s|$)|[;\n]/);
    const sentence = brief.slice(start === undefined ? 0 : start + 1, end < 0 ? brief.length : span.end + end);
    const parsed = readUnitParts(os.unit);
    if (parsed === null || !['count', 'currency'].includes(parsed.kind) || (parsed.noun !== null
      && !parsed.noun.every(w => words(right.replace(/[.!?;,]/g, ' ')).slice(0, 3).some(s => readCount(s)?.includes(w))))) return [];
    if (parsed.kind === 'currency' && figureTheUserWroteForSpan(Math.abs(os.raw_value), os.unit, brief,
      { target: [String(n.label)], others: [], strict: true, requireNamed: true }) === null) return [];
    return [{ n, sentence, span, q: { id: String(n.id), raw_value: os.raw_value, unit: os.unit } }];
  });
  const limits = rows.filter(r => levelUnit(r.q.unit) !== null && ceilingTheUserWroteFor(r.q.raw_value, r.q.unit, brief));
  if (limits.length !== 1) return null;
  const limit = limits[0]!;
  const stocks = rows.filter(r => sameNoun(r.q.unit, limit.q.unit)
    && /\b(?:at the moment|today|currently|now|current|we have|we hold)\b/i.test(r.sentence)
    && !/\b(?:want|aim|target|ceiling|limit|capacity|at most|under|below|maximum)\b/i.test(r.sentence));
  const flows = rows.filter(r => {
    const tokens = words(r.q.unit), p = readUnitParts(r.q.unit);
    const negativeWords = /(?:[-−]\s*|\bminus\s*)$/i.test(brief.slice(0, r.span.start))
      || /\b(?:loss|losing|lost|decrease|decreasing|decline|declining|shrinking)\b/i.test(r.sentence);
    return !negativeWords && p?.period === 'month' && isDeepStrictEqual(readUnitParts(tokens.slice(0, -2).join(' ')), levelUnit(limit.q.unit))
      && periodNoun(tokens.at(-1) ?? '') === 'month' && ['/', 'per', 'a', 'each', 'every'].includes(tokens.at(-2) ?? '')
      && /\bnet(?:\s+(?:change|growth|gain|increase|loss|decrease)(?:\s+of)?)?(?:\s+(?:about|around|roughly|approximately))?\s*[+-]?\s*$/i.test(brief.slice(0, r.span.start))
      && /(?:\b(?:every|each|per|a)\s+|\/\s*)month\b/i.test(r.sentence);
  });
  if (stocks.length !== 1 || flows.length !== 1) return null;
  const stock = stocks[0]!, flow = flows[0]!;
  // This extension admits non-negative additions only; the old signed-flow refusal remains intact.
  if (stock.q.raw_value < 0 || flow.q.raw_value < 0 || limit.q.raw_value < stock.q.raw_value
    || !sameNoun(goal.goal_threshold_unit, stock.q.unit)
    || [stock, flow].some(r => graph.edges.some((e: Rec) => e.to === r.q.id))
    || [stock, flow].some(r => typeof frame(r.n) !== 'number' || !Number.isFinite(frame(r.n)) || frame(r.n) <= 0)) return null;
  const carrier_id = `${goal.id}_ceiling_stock_at_month_${h}`, zero_id = `${carrier_id}_net_zero_rate`;
  if (nodes.some(n => n.id === carrier_id || n.id === zero_id)) return null;
  const uncertain = hasApproximateFigureQualifier(brief.slice(0, flow.span.start), brief.slice(flow.span.end))
    || flow.n.observed_state.likely_range !== undefined;
  return { goal_id: goal.id, stock: stock.q, flow: flow.q, ceiling: limit.q, horizon_months: h, comparator: '<=',
    coverage: uncertain ? 'at_month_only' : 'throughout', transformation: { carrier_id, zero_id,
      carrier_label: `${String(stock.n.label).replace(/\s+(?:today|now|currently)$/i, '')} at month ${h}`,
      scale_frame: 2 * Math.max(frame(stock.n) + frame(flow.n) * h, limit.q.raw_value) } };
}

export function ceilingStockWords(graph: unknown, p: CeilingStockPending): string {
  const label = rec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((n: Rec) => n.id === p.goal_id)?.label : '';
  const bound = sayFigureAsWritten(p.ceiling.raw_value, p.ceiling.unit);
  const coverage = p.coverage === 'throughout' ? 'under the ceiling throughout' : `at month ${p.horizon_months} only`;
  return `Olumi reads ‘${label}’ as ‘${p.transformation.carrier_label}’ at or under ${bound} if nothing changes (${coverage}). Is that how you work it out?`;
}
export function proposeCeilingStock(graph: unknown, brief: string | null | undefined): IdentityProposal | null {
  const p = recogniseCeilingStock(graph, brief);
  if (p === null) return null;
  const words = ceilingStockWords(graph, p);
  return words.length > 400 ? null : { outcome_id: p.goal_id, operation: 'sum', factor_ids: [p.transformation.carrier_id], words, ceiling_stock: p };
}

/** The exact postimage, recomputed from canonical authority; no free-form node/target edit is admitted. */
export function ceilingStockPostimage(graph: unknown, p: CeilingStockPending, brief: string | null | undefined): Rec | null {
  if (!isDeepStrictEqual(recogniseCeilingStock(graph, brief), p) || !rec(graph)) return null;
  const next = structuredClone(graph), { carrier_id, zero_id, carrier_label, scale_frame } = p.transformation;
  const goal = next.nodes.find((n: Rec) => n.id === p.goal_id);
  next.nodes.push({ id: zero_id, kind: 'factor', category: 'observable', label: 'Share leaving each month (read as a net change)',
    observed_state: { value: 0, raw_value: 0, unit: '%', source: 'user_confirmed' }, scale_frame: 100 },
  { id: carrier_id, kind: 'outcome', label: carrier_label, scale_frame, nonlinear_identity: { operation: 'accumulation',
    factor_ids: [p.stock.id, zero_id, p.flow.id], horizon_months: p.horizon_months, rate_scale: 0.01, stated_in_brief: true } });
  for (const [from, to] of [[p.stock.id, carrier_id], [p.flow.id, carrier_id], [zero_id, carrier_id], [carrier_id, p.goal_id]]) {
    next.edges.push({ from, to, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', definitional: true } });
  }
  Object.assign(goal, { nonlinear_identity: { operation: 'sum', factor_ids: [carrier_id], stated_in_brief: true },
    goal_direction: p.comparator, goal_threshold_raw: p.ceiling.raw_value, goal_threshold_unit: p.ceiling.unit,
    goal_threshold_frame: 'level', goal_threshold_cap: scale_frame, goal_threshold: p.ceiling.raw_value / scale_frame,
    threshold_source: 'user', success_threshold: p.ceiling.raw_value });
  next.goal_constraints = (next.goal_constraints ?? []).filter((r: Rec) => r.node_id !== p.goal_id);
  next.goal_constraints.push({ node_id: p.goal_id, label: goal.label, operator: p.comparator, value: p.ceiling.raw_value,
    unit: p.ceiling.unit, value_frame: 'level', provenance: 'explicit', constraint_id: `agent-lane:${p.goal_id}:<=` });
  return assignEntityRefs(next, graph).graph;
}

export function ceilingStockRecorded(graph: unknown, p: CeilingStockPending): boolean {
  if (!rec(graph) || !Array.isArray(graph.nodes)) return false;
  const n = (id: string) => graph.nodes.find((v: Rec) => v.id === id);
  const goal = n(p.goal_id), carrier = n(p.transformation.carrier_id);
  return goal?.goal_direction === p.comparator && goal.goal_threshold_raw === p.ceiling.raw_value
    && goal.goal_threshold_unit === p.ceiling.unit && goal.goal_horizon_months === p.horizon_months
    && goal.goal_threshold_cap === p.transformation.scale_frame && goal.threshold_source === 'user'
    && goal.success_threshold === p.ceiling.raw_value && carrier?.scale_frame === p.transformation.scale_frame
    && [p.stock, p.flow, p.ceiling].every(q => n(q.id)?.observed_state?.raw_value === q.raw_value && n(q.id)?.observed_state?.unit === q.unit)
    && isDeepStrictEqual(goal.nonlinear_identity, { operation: 'sum', factor_ids: [p.transformation.carrier_id], stated_in_brief: true })
    && isDeepStrictEqual(carrier?.nonlinear_identity, { operation: 'accumulation', factor_ids: [p.stock.id, p.transformation.zero_id, p.flow.id],
      horizon_months: p.horizon_months, rate_scale: 0.01, stated_in_brief: true })
    && n(p.transformation.zero_id)?.observed_state?.source === 'user_confirmed';
}
