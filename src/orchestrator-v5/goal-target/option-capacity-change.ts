/**
 * ⭐ THE COACHING LOOP (DL, 14 Oct; Paul's legacy brief, served graph de659cfd). An option the deadline forecast cannot size
 * says "Worth discussing: how much it would speed up the work, and from when." (`unsupportedEventOptionWhy`). When the user
 * answers with a new figure for a share of time the option already changes in the model ("it would cut legacy work from 25%
 * to 15%"), that answer resolves the option, on ONE card and ONE press:
 *  - the figure is the user's (an S2 statement, `verifyStatements`); the subject is set from graph identity: the option is
 *    one this forecast holds unresolved, and the share is the one kept-out factor that option already changes;
 *  - Olumi's reading, named on the card, is that the time freed goes to the deliverable, so the team's capacity for it is
 *    (total − new share) ÷ (total − today's share). The press ADOPTS that reading as the declared relation; it stays Olumi's;
 *  - "from now" is Olumi's timing assumption, said as such;
 *  - the press adds one capacity carrier (the existing ratio mechanism, `ratio_source.complement_of`, so the live compiler
 *    re-derives it when the share is edited), its link to the goal and each option's switch, as one registered revision.
 * Pure: the capability does the I/O (`agent-capabilities.ts` `proposeOptionCapacityChange` / `applyOptionCapacityChange`).
 */
import { isDeepStrictEqual } from 'node:util';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { unresolvedEventOptionIds, withCompiledCapacityRatios } from './event-by-date-model.js';
import { deliverableOf, shareByDateGoalForChanceOf } from './share-by-date-run.js';
import { userStatementOf, type UserStatement } from '../agent-lane/user-statements.js';
import { coordinateClausesOf } from '../agent-lane/link-effect-option-statement.js';
import { factorTheUserNamed } from '../agent-lane/stated-by-user.js';
import { effectLeadWords, type EffectLead } from './effect-lead.js';

type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** What the card offers and the press applies, byte for byte. */
export interface ApprovedOptionCapacityChange {
  readonly goal_id: string;
  readonly deliverable: string;
  readonly option_id: string;
  readonly option_label: string;
  readonly factor_id: string;
  readonly factor_label: string;
  readonly unit: string;
  /** The share today, as the model held it when the card was made (the stale gate), and the user's new figure. */
  readonly today: number;
  readonly to: number;
  readonly total: number;
  readonly carrier_id: string;
  readonly carrier_label: string;
  /** The forecast's deadline and the reference date it is counted from, as the other parts hold them. */
  readonly deadline: string;
  readonly reference_date: string;
  readonly statements: readonly UserStatement[];
  /** The timing the user's words give (session 4's ONE lead reader, `effect-lead.ts`); absent = Olumi's "from now". */
  readonly lead?: EffectLead;
  /** The option's switches as stored when the card was made. */
  readonly expected_interventions: Rec;
}

export type OptionCapacityTarget =
  | { readonly kind: 'target'; readonly option: Rec; readonly factor: Rec; readonly deliverable: string; readonly goal_id: string;
      readonly deadline: string; readonly reference_date: string }
  | { readonly kind: 'refused'; readonly refusal: 'not_a_deadline_forecast' | 'deadline_not_held' | 'option_not_unresolved' | 'no_share_to_change' | 'which_share'; readonly detail: string };

/** A share of time the model holds today: a kept-out factor with a figure strictly between 0 and its total, in a "%" unit. */
function shareToday(factor: Rec | undefined): { readonly value: number; readonly unit: string; readonly total: number } | undefined {
  const os = factor?.observed_state, raw = num(os?.raw_value), unit = typeof os?.unit === 'string' ? os.unit.trim() : '';
  const total = num(os?.cap) ?? 100;
  // The freed-time reading is about the team's TIME: a plain percentage or a percentage "of" a whole of time ("% of developer
  // time"), never "% of budget" (PL 14 Oct: the share's population is bound, not assumed). The percent family is the unit
  // authority's (`classifyUnitScaleClass`), never a bare spelling here; its prefix layer reads "percentage points" as percent, and
  // a change in points is not a share of time, so points stay out.
  const percent = classifyUnitScaleClass(unit) === 'percent' && !/\bpoints?\b/i.test(unit);
  const ofTime = percent && (/^(?:%|percent|per cent|pct|percentage)$/i.test(unit)
    || /^(?:%|percent|per cent)\s*of\b.*\b(?:time|hours?|capacity|effort|working week|days?)\b/i.test(unit));
  return raw !== undefined && ofTime && total === 100 && raw > 0 && raw < total ? { value: raw, unit, total } : undefined;
}

/** The option (one this forecast holds unresolved) and the one share of time it already changes in the model. */
export function optionCapacityTarget(graph: unknown, optionId: string, factorId?: string): OptionCapacityTarget {
  const share = shareByDateGoalForChanceOf(graph);
  if (share === null || !rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { kind: 'refused', refusal: 'not_a_deadline_forecast', detail: 'This model has no deadline forecast for an option to act through. Nothing was prepared.' };
  }
  const option = graph.nodes.find((n: Rec) => n.id === optionId && n.kind === 'option');
  if (option === undefined || !unresolvedEventOptionIds(graph).includes(optionId)) {
    return { kind: 'refused', refusal: 'option_not_unresolved', detail: 'That option already has a way to act in the deadline forecast, or is not in this model, so nothing was prepared.' };
  }
  const changed = graph.edges.filter((e: Rec) => e.from === optionId).map((e: Rec) => graph.nodes.find((n: Rec) => n.id === e.to))
    .filter((n: Rec | undefined): n is Rec => n?.kind === 'factor' && n.analysis_participation === 'retained_excluded' && shareToday(n) !== undefined);
  const chosen = factorId === undefined ? (changed.length === 1 ? changed[0] : undefined) : changed.find((n: Rec) => n.id === factorId);
  if (chosen === undefined) {
    return changed.length > 1 && factorId === undefined
      ? { kind: 'refused', refusal: 'which_share', detail: `‘${String(option.label)}’ changes more than one share of time in this model (${changed.map((n: Rec) => `‘${String(n.label)}’`).join(', ')}). Ask which one the user's figure is for. Nothing was prepared.` }
      : { kind: 'refused', refusal: 'no_share_to_change', detail: `‘${String(option.label)}’ doesn't change a share of time this model holds today, so a new figure can't be applied to it yet. Nothing was prepared.` };
  }
  const deliverable = deliverableOf(share);
  // The reference the forecast's parts are counted from: another part's, else the team time's own (`withEventShareDate`).
  const reference = graph.nodes.map((n: Rec) => n.observed_state?.extra_share_by_date?.reference_date).find((d: unknown) => typeof d === 'string')
    ?? graph.nodes.find((n: Rec) => n.id === share.team_part_id)?.observed_state?.stated_time?.reference_date;
  if (typeof share.deadline !== 'string' || typeof reference !== 'string') {
    return { kind: 'refused', refusal: 'deadline_not_held', detail: 'The deadline and the team\'s own time must be held before an option can act through it. Nothing was prepared.' };
  }
  return { kind: 'target', option, factor: chosen, deliverable, goal_id: String(share.goal.id), deadline: share.deadline, reference_date: reference };
}

/** The percentage figures a clause writes: "25%", "15 per cent", and the first end of "from 25 to 15%". Never a bare count. */
export function sharePercentsIn(clause: string): number[] {
  const out = [...clause.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*(?:%|per ?cent\b)/gi)].map((m) => Number(m[1]));
  for (const m of clause.matchAll(/\bfrom\s+(\d{1,3}(?:\.\d+)?)\s+(?:down\s+)?to\s+\d{1,3}(?:\.\d+)?\s*(?:%|per ?cent\b)/gi)) out.push(Number(m[1]));
  return [...new Set(out)].filter((v) => v > 0 && v < 100);
}
const words = (t: string): string[] => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/**
 * ⛔ PL (14 Oct, #3142, wrong-number class): the figures a statement gives for THIS share, bound through S2's figure reader.
 * QUANTITY: a percentage only ("in 3 months" is timing, handed to the lead reader, never a 3%). SUBJECT: from the clauses that
 * name the share (the lane's label reader, scoped to the model's other shares), else from clauses with no timing in them.
 * POPULATION: a "% of …" that names a different whole ("15% of revenue") is not this share's figure.
 */
export function shareFiguresFor(factorLabel: string, unit: string, otherShares: readonly string[]): (quote: string) => { low: number; high: number }[] {
  const whole = words(unit.replace(/^%\s*(?:of)?/i, '')).concat(words(factorLabel));
  return (quote: string) => {
    const clauses = coordinateClausesOf(quote);
    const naming = clauses.filter((c) => factorTheUserNamed(factorLabel, c, { options: [], others: otherShares }));
    const pool = naming.length > 0 ? naming : clauses.filter((c) => !/\b(?:days?|weeks?|months?|years?)\b/i.test(c));
    return pool.flatMap((c) => sharePercentsIn(c).filter((v) => {
      const of = new RegExp(`(?<![\\d.])${v}\\s*(?:%|per ?cent)\\s+of\\s+([^,.;:!?]{1,40})`, 'i').exec(c)?.[1];
      return of === undefined || words(of).some((w) => whole.includes(w));
    })).map((v) => ({ low: v, high: v }));
  };
}

/** The model's other kept-out shares an option could mean (the label reader's scope). */
export function otherSharesOf(graph: Rec, factorId: string): string[] {
  return graph.nodes.filter((n: Rec) => n.id !== factorId && n.kind === 'factor' && shareToday(n) !== undefined).map((n: Rec) => String(n.label));
}

/** The capacity carrier's id: the option's own slot, or the next free one. */
function carrierIdFor(graph: Rec, optionId: string): string {
  const slot = /^event_option_(\d+)$/.exec(optionId)?.[1];
  const taken = new Set(graph.nodes.map((n: Rec) => n.id));
  if (slot !== undefined && !taken.has(`event_capacity_${slot}`)) return `event_capacity_${slot}`;
  let i = graph.nodes.length + 1;
  while (taken.has(`event_capacity_${i}`)) i += 1;
  return `event_capacity_${i}`;
}

export type OptionCapacityPlan =
  | { readonly kind: 'plan'; readonly approved: ApprovedOptionCapacityChange }
  | { readonly kind: 'refused'; readonly refusal: 'not_today' | 'not_lower' | 'two_new_figures'; readonly detail: string };

/**
 * The plan from the verified statement (form `point`, its figure the user's new share). Any other figure the quote writes must
 * be today's share as the model holds it ("from 25% to 15%"); a different one is a disagreement Olumi asks about, never picks.
 */
export function planOptionCapacityChange(graph: Rec, target: Extract<OptionCapacityTarget, { kind: 'target' }>, statements: readonly UserStatement[],
  lead?: EffectLead): OptionCapacityPlan {
  const share = shareToday(target.factor)!;
  const point = statements.find((s) => s.form === 'point' && s.negated !== true && num(s.low) !== undefined);
  const to = num(point?.low)!;
  const figures = shareFiguresFor(String(target.factor.label), share.unit, otherSharesOf(graph, String(target.factor.id)));
  const others = new Set(statements.flatMap((s) => figures(s.quote).map((f) => f.low)).filter((v) => v !== to));
  const label = String(target.factor.label), optionLabel = String(target.option.label);
  if ([...others].some((v) => v !== share.value)) {
    return { kind: 'refused', refusal: 'not_today', detail: `The user's words give ${[...others].join(' and ')}${share.unit.startsWith('%') ? '%' : ''} as today's figure, but the model holds ‘${label}’ at ${share.value}${share.unit} today. Ask which one holds before changing ‘${optionLabel}’. Nothing was prepared.` };
  }
  if (!(to < share.value)) {
    return { kind: 'refused', refusal: 'not_lower', detail: `${to}% is not below today's ${share.value}% for ‘${label}’, so ‘${optionLabel}’ would free no time for ${target.deliverable}, and this forecast doesn't yet model an option that slows the team down. Nothing was prepared.` };
  }
  const carrier_id = carrierIdFor(graph, String(target.option.id));
  return { kind: 'plan', approved: {
    goal_id: target.goal_id, deliverable: target.deliverable, option_id: String(target.option.id), option_label: optionLabel,
    factor_id: String(target.factor.id), factor_label: label, unit: share.unit, today: share.value, to, total: share.total,
    carrier_id, carrier_label: `${optionLabel} frees time for ${target.deliverable}`, deadline: target.deadline, reference_date: target.reference_date,
    statements, expected_interventions: structuredClone(rec(target.option.interventions) ? target.option.interventions : {}),
    ...(lead !== undefined ? { lead } : {}),
  } };
}

/** capacity with the option ÷ capacity today, on Olumi's freed-time reading. */
export const freedTimeRatio = (a: Pick<ApprovedOptionCapacityChange, 'today' | 'to' | 'total'>): number => (a.total - a.to) / (a.total - a.today);

/** The postimage: one carrier, its link to the goal, every option's switch on it (this option's on), compiled and sized. */
export function withOptionCapacityChange(graph: unknown, a: ApprovedOptionCapacityChange): Rec {
  const g = structuredClone(graph) as Rec;
  g.nodes.push({ id: a.carrier_id, kind: 'factor', category: 'controllable', label: a.carrier_label, provenance: 'ai_inferred',
    observed_state: { value: 0, source: 'cee_inference', extra_share_by_date: {
      capacity_ratio: freedTimeRatio(a), unit: `% of ${a.deliverable} per month`,
      // The timing the user's words gave, as session 4's reader holds it (whose each part is); else Olumi's "from now".
      ...(a.lead !== undefined ? { lead_low: a.lead.lead_low, lead_high: a.lead.lead_high, lead_statements: a.lead.lead_statements.map((st) => structuredClone(st)),
        lead_reading: structuredClone(a.lead.lead_reading) } : { lead_low: 0, lead_high: 0 }),
      deadline: a.deadline, reference_date: a.reference_date,
      ratio_basis: { capacity: a.deliverable, relation: 'freed_time', source: { label: a.factor_label, unit: a.unit, today: a.today, withOption: a.to } },
      // `factor_ids` names this carrier, which holds no figure: a compiler without the freed-time branch (a revert) reads it as
      // unreadable and withholds, never r = 1 (a silent copy of carrying on).
      ratio_source: { factor_ids: [a.carrier_id], set_ids: [a.factor_id], settings: { [a.factor_id]: a.to }, complement_of: { source_id: a.factor_id, total: a.total } },
      // The relation is Olumi's reading, adopted by the user's press: positive evidence for the relation, never their authorship.
      ratio_relation: { kind: 'freed_time', reading: 'olumi', adopted_by: 'user_press' },
      statements: a.statements.map((s) => structuredClone(s)) } } });
  g.edges.push({ from: a.carrier_id, to: a.goal_id, exists_probability: 1, effect_direction: 'positive',
    strength: { mean: 0.5, std: 0.125 }, defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
  for (const o of g.nodes.filter((n: Rec) => n.kind === 'option')) {
    o.interventions = { ...(rec(o.interventions) ? o.interventions : {}), [a.carrier_id]: { value: o.id === a.option_id ? 1 : 0 } };
    g.edges.push({ from: o.id, to: a.carrier_id, exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive' });
  }
  return withCompiledCapacityRatios(g);
}

/** The stored model holds exactly this change: the carrier, its user figure and statements, every switch, and the option acting. */
export function optionCapacityChangeHeld(graph: unknown, a: ApprovedOptionCapacityChange): boolean {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return false;
  const carrier = graph.nodes.find((n: Rec) => n.id === a.carrier_id), c = carrier?.observed_state?.extra_share_by_date;
  if (!rec(c) || c.ratio_relation?.kind !== 'freed_time' || c.ratio_source?.settings?.[a.factor_id] !== a.to
    || c.ratio_source?.complement_of?.source_id !== a.factor_id || c.ratio_source_unreadable === true) return false;
  const stored = (Array.isArray(c.statements) ? c.statements : []).map(userStatementOf);
  if (stored.length !== a.statements.length || !stored.every((s, i) => s !== undefined && isDeepStrictEqual(s, userStatementOf(a.statements[i])))) return false;
  if (a.lead !== undefined ? !(c.lead_low === a.lead.lead_low && c.lead_high === a.lead.lead_high && isDeepStrictEqual(c.lead_reading, a.lead.lead_reading))
    : !(c.lead_low === 0 && c.lead_high === 0)) return false;
  if (!graph.edges.some((e: Rec) => e.from === a.carrier_id && e.to === a.goal_id)) return false;
  const options = graph.nodes.filter((n: Rec) => n.kind === 'option');
  return options.every((o: Rec) => o.interventions?.[a.carrier_id]?.value === (o.id === a.option_id ? 1 : 0)
    && graph.edges.some((e: Rec) => e.from === o.id && e.to === a.carrier_id))
    && !unresolvedEventOptionIds(graph).includes(a.option_id);
}

/** The card stands while what it was offered against does: the option still unresolved with the same switches, the share unchanged. */
export function optionCapacityChangeStillApplies(a: ApprovedOptionCapacityChange, graph: unknown): boolean {
  const target = optionCapacityTarget(graph, a.option_id, a.factor_id);
  if (target.kind !== 'target') return false;
  const share = shareToday(target.factor);
  // ⛔ PL (14 Oct): the card's MEANING, not only its bytes: the goal and deliverable, the deadline and reference, the share's
  // unit and whole, and the relation (the option still changes this share). Any change refreshes the card; nothing is written.
  return target.goal_id === a.goal_id && target.deliverable === a.deliverable && target.deadline === a.deadline
    && target.reference_date === a.reference_date && share?.unit === a.unit && share?.total === a.total && share?.value === a.today
    && isDeepStrictEqual(rec(target.option.interventions) ? target.option.interventions : {}, a.expected_interventions)
    && !(graph as Rec).nodes.some((n: Rec) => n.id === a.carrier_id);
}

/** The one card, in plain words: the user's figure, Olumi's two assumptions and its timing, and what the model gains. */
export function optionCapacityChangeCard(a: ApprovedOptionCapacityChange): string {
  const quotes = a.statements.map((s) => `“${s.quote}”`).join(', then ');
  const pct = Math.round(freedTimeRatio(a) * 100);
  const unit = a.unit.startsWith('%') ? a.unit : ` ${a.unit}`;
  const timing = a.lead !== undefined ? effectLeadWords(a.lead) : 'Olumi assumes this takes effect from now; say if it would start later.';
  return `Use this for ‘${a.option_label}’? You said ${quotes}. Olumi reads this as: the option sets ‘${a.factor_label}’ to ${a.to}${unit} `
    + `(${a.today}${unit} today). Olumi also assumes that all the rest of the team’s time (${a.total - a.today}% today) goes to ${a.deliverable}, `
    + `so freeing ${a.today - a.to} points raises the team’s capacity for it to about ${pct}% of today’s. ${timing} `
    + `The model gains one part, ‘${a.carrier_label}’, linked to the goal.`;
}
