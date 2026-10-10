import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { readGoalRecord } from '../goal-target/goal-record.js';
import { readCount, readUnitParts, statedTailParts, words } from './same-unit.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { ceilingTheUserWroteFor, figureTheUserWroteForSpan, hasApproximateFigureQualifier, countsInWords } from './stated-by-user.js';
import { sayFigureAsWritten } from './say-figure.js';
import type { IdentityProposal } from './identity-proposal.js';
import { assignEntityRefs } from '../graph/entity-refs.js';

const quantity = z.object({ id: z.string().min(1), raw_value: z.number().finite(), unit: z.string().min(1) }).strict();
/** Server-only pending authority; the canonical writer reattests it against its own graph AND brief. */
export const CeilingStockPendingSchema = z.object({
  stock: quantity, flow: quantity, ceiling: quantity, goal_id: z.string().min(1),
  horizon_months: z.number().int().min(1).max(120), comparator: z.literal('<='),
  coverage: z.enum(['throughout', 'at_month_only']),
  ceiling_comparator_words: z.literal('at most'), flow_approximate: z.boolean(),
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

// This is the DL's closed hedge set, not an expanding interpretation vocabulary.
const HEDGE = /\b(?:if|unless|when|once|would|could|might|may|unknown|unclear|proposed|planned|forecast|expect|hope|aim|target)\b/i;
const COUNTING_WORDS = new Set(['sign-ups', 'signups', 'joiners', 'new', 'riders', 'members', 'customers',
  'people', 'leaving', 'leavers', 'cancellations', 'and', 'joining']);

/** A count's own noun, with at most one modifier. A drafter label cannot extend this grammar. */
function levelTail(tail: string, unit: string): boolean {
  const p = levelUnit(unit), tokens = words(tail);
  if (p === null) return false;
  if (tail !== '' && !/^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(tail)) return false;
  if (p.kind === 'currency') return tokens.length <= 1;
  const noun = p.noun;
  return noun !== null && tokens.length >= noun.length && tokens.length <= noun.length + 1
    && noun.every((w, i) => readCount(tokens[tokens.length - noun.length + i])?.includes(w));
}
function ceilingContinuation(clause: string, h: number): boolean {
  if (clause === 'without breaking its maintenance targets') return true;
  const duration = /^over (?:the next )?(.+) months$/iu.exec(clause)?.[1];
  if (duration === undefined) return false;
  const amounts = [...findStatedAmounts(duration), ...countsInWords(duration)];
  return amounts.length === 1 && amounts[0]!.magnitude === h && amounts[0]!.matchedText === duration;
}
function ceilingTail(tail: string, unit: string, h: number): boolean {
  const parts = /^(.*?)(?:\s+(over .+|without breaking .+))?$/iu.exec(tail)!;
  return (parts[2] === undefined || ceilingContinuation(parts[2], h)) && levelTail(parts[1]!, unit);
}
/** Only the amount's literal inclusive wording can license an inclusive comparator. */
function ceilingComparator(before: string): { words: 'at most'; comparator: '<=' } | null {
  const matched = /^(?:our depot can service|we can service|we must hold) (.+)$/i.exec(before);
  const literal = matched?.[1]?.toLowerCase();
  if (literal !== 'at most') return null;
  return { words: literal, comparator: '<=' };
}
function netAddition(before: string): boolean {
  const prefix = /^counting ([^,]+),\s*/i.exec(before);
  if (prefix !== null && !prefix[1]!.toLowerCase().split(/\s+/).every(w => COUNTING_WORDS.has(w))) return false;
  return /^we (?:are gaining|gain) a net(?:\s+(?:about|around|roughly|approximately))?$/i.test(before.slice(prefix?.[0].length ?? 0));
}

export { isConfirmedCeilingStockCarrier, confirmedCeilingStockOf } from './ceiling-stock-carrier.js';

/** The existing amount authority binds the value; this separate recogniser reads CURRENT/LIMIT/net roles. */
export function recogniseCeilingStock(graph: unknown, brief: string | null | undefined): CeilingStockPending | null {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || typeof brief !== 'string') return null;
  const nodes: Rec[] = graph.nodes.filter(rec), goals = nodes.filter(n => n.kind === 'goal');
  const goal = goals[0], h = goal && readGoalRecord(graph, goal.id)?.horizon?.months;
  if (goals.length !== 1 || goal.nonlinear_identity != null || goal.goal_stock_reading === 'one_off'
    || h === undefined || h < 1 || h > 120 || goal.observed_state != null
    || ['user_stated', 'user_ratified'].includes(classifyValueSource(goal.threshold_source))
    || graph.goal_constraints?.some((r: Rec) => r.node_id === goal.id && r.provenance === 'explicit')) return null;
  const writtenAmounts = findStatedAmounts(brief);
  const rows = nodes.flatMap(n => {
    const os = n.observed_state;
    if (n.kind !== 'factor' || !rec(os) || classifyValueSource(os.source) !== 'user_stated'
      || typeof os.raw_value !== 'number' || !Number.isFinite(os.raw_value) || typeof os.unit !== 'string') return [];
    const parsed = readUnitParts(os.unit);
    if (parsed === null || !['count', 'currency'].includes(parsed.kind)) return [];
    // Every candidate must bind to exactly one writing, never to keywords elsewhere in its sentence.
    const matches = writtenAmounts.flatMap(amount => {
      const owner = brief.slice(0, amount.index).match(/\bour ([\p{L}]+) can service [\p{L}\s]+$/iu)?.[1] ?? '';
      const span = figureTheUserWroteForSpan(Math.abs(os.raw_value), os.unit, brief,
        { target: [String(n.label), owner], others: nodes.filter(o => o.id !== n.id && o.kind === 'factor' && Math.abs(o.observed_state?.raw_value) === Math.abs(os.raw_value)).map(o => String(o.label)),
          rivals: nodes.filter(o => o.id !== n.id && Math.abs(o.observed_state?.raw_value) === Math.abs(os.raw_value) && isDeepStrictEqual(readUnitParts(o.observed_state?.unit), parsed)).map(o => String(o.label)),
          strict: true, requireNamed: true, at: amount.index });
      if (span === null) return [];
      const left = brief.slice(0, span.start), right = brief.slice(span.end);
      const start = [...left.matchAll(/[.!?](?=\s)|[;\n]/g)].at(-1)?.index;
      // A quote/introduction on the preceding nonempty line cannot be first-person evidence for this organisation.
      const priorLine = left.slice(0, left.lastIndexOf('\n')).trimEnd();
      if (left.includes('\n') && priorLine.endsWith(':')) return [];
      const before = brief.slice(start === undefined ? 0 : start + 1, span.start).trim();
      const end = right.search(/[.!?](?=\s|$)|\n/);
      const sentenceTail = (end < 0 ? right : right.slice(0, end)).trim();
      const clauses = sentenceTail.split(',').map(c => c.trim());
      if (clauses.slice(1).some(c => HEDGE.test(c))) return [];
      if (clauses.slice(1).some(c => /^(?:over|without breaking)\b/i.test(c) && !ceilingContinuation(c, h))) return [];
      // The first clause is consumed by the role grammar; subsequent unhedged clauses are not borrowed as role proof.
      const tail = clauses[0]!;
      const stated = statedTailParts(brief, amount);
      if (stated === null || stated.kind !== parsed.kind || stated.code !== parsed.code
        || (parsed.noun !== null && !parsed.noun.every(w => stated.noun?.includes(w)))) return [];
      return [{ n, before, tail, stated, span, q: { id: String(n.id), raw_value: os.raw_value, unit: os.unit } }];
    });
    return matches.length === 1 ? matches : [];
  });
  // Deliberately narrow affirmative grammar. The subject and present-tense predicate must lead THIS writing.
  // No arbitrary preamble or remainder is admitted: conditional, forecast, historical and third-party readings abstain.
  const limits = rows.flatMap(r => {
    const literal = ceilingComparator(r.before);
    return levelUnit(r.q.unit) !== null && literal !== null
      && ceilingTheUserWroteFor(r.q.raw_value, r.q.unit, brief, { target: [String(r.n.label), r.before.match(/^our ([\p{L}]+)/iu)?.[1] ?? ''], others: [], strict: true })
      && ceilingTail(r.tail, r.q.unit, h) ? [{ ...r, literal }] : [];
  });
  if (limits.length !== 1) return null;
  const limit = limits[0]!;
  const stocks = rows.filter(r => sameNoun(r.q.unit, limit.q.unit)
    && /^(?:(?:at the moment|today|currently|now)\s+)?we (?:have|hold)$/i.test(r.before)
    && r.stated.period === null && r.stated.per === null);
  const flows = rows.filter(r => {
    const p = readUnitParts(r.q.unit);
    const monthly = /^(.*?)(?:\s+)?(?:every|each|per|a) month$/iu.exec(r.tail);
    return netAddition(r.before)
      && p?.period === 'month' && isDeepStrictEqual({ ...p, period: null }, levelUnit(limit.q.unit))
      && r.stated.period === 'month' && r.stated.per === null
      && monthly !== null && levelTail(monthly[1]!.trim(), limit.q.unit);
  });
  if (stocks.length !== 1 || flows.length !== 1 || !levelTail(stocks[0]!.tail, stocks[0]!.q.unit)) return null;
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
  return { goal_id: goal.id, stock: stock.q, flow: flow.q, ceiling: limit.q, horizon_months: h, comparator: limit.literal.comparator,
    ceiling_comparator_words: limit.literal.words, flow_approximate: uncertain, coverage: 'at_month_only', transformation: { carrier_id, zero_id,
      carrier_label: `${String(stock.n.label).replace(/\s+(?:today|now|currently)$/i, '')} at month ${h}`,
      scale_frame: 2 * Math.max(frame(stock.n) + frame(flow.n) * h, limit.q.raw_value) } };
}

export function ceilingStockWords(graph: unknown, p: CeilingStockPending): string {
  const label = rec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((n: Rec) => n.id === p.goal_id)?.label : '';
  const bound = sayFigureAsWritten(p.ceiling.raw_value, p.ceiling.unit);
  const stock = sayFigureAsWritten(p.stock.raw_value, p.stock.unit);
  const flow = sayFigureAsWritten(p.flow.raw_value, p.ceiling.unit);
  const flowPhrase = p.flow_approximate ? `a net of roughly ${flow} a month` : `a net ${flow} a month`;
  return `Olumi reads ‘${label}’ as ‘${p.transformation.carrier_label}’ at or under ${bound} (${bound} included; you said ‘${p.ceiling_comparator_words} ${bound}’), checked at month ${p.horizon_months} only, assuming ${stock} today and ${flowPhrase} continue. Is that how you work it out?`;
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
