/**
 * ⭐ S-E GOALS — THE ONE GOAL-KIND REGISTRY (lane GOALS, DL 0fd71f, 7 Oct; Science ruling
 * `inflight/science-deadline-ruling-20261007.md` §2, P0).
 *
 * Every producer and consumer of a goal asks THIS module what kind of goal it holds, and so what may be asked, written
 * and said about it. Kinds:
 *  · `chance_of_event` — the goal's unit, or its label with a bare percent unit, names the CHANCE of an event. INVALID as a
 *    quantity: Olumi computes that chance, so it is never propagated, never asked for ("today's level" of it, D-06), and
 *    never given a target. Every goal figure is withheld with ONE sentence, and the one question is the deadline.
 *  · `change`          — a target stated as a change from today (`goal_threshold_frame` `change_abs` / `change_rel`).
 *  · `level`           — everything else: a level to reach or stay within, with or without a deadline (a deadline on a
 *    quantity, "£150k MRR by March", is a horizon on a level, never an event: Science ruling §1 scope).
 *  · `share_by_date` — a forecast pure sum of held share parts, with a fixed date;
 *    recognised only with the graph, since a node cannot attest its incoming links.
 *
 * Chance words are read whole and bounded in the unit, and also in the label when the stored unit is a bare percent.
 * "Risk" in that label names a chance only when followed by "of" or "that", never in a compound risk metric.
 * Science (b)'s rate reader decides whether that segment names a population quantity or a one-off chance: must-fire
 * "% likelihood of on-time launch", "On-time feature-launch probability" in "%"; must-not-fire "% of launch done",
 * "% of customers", "churn %", "Monthly churn probability" in "%".
 */

import { readRateAsQuantity, riskChanceWord } from './rate-as-quantity.js';
import { shareKind } from '../../utils/unit-alphabet.js';
import { readPercentUnit, readUnitParts, words } from '../agent-lane/same-unit.js';
import { eventShareEndpointMatches } from './share-by-date-carrier.js';
import { endsOfGraph, validatedDefinition, withHeldUserLinks } from './held-user-links.js';
import { timeBetween } from './deadline-date.js';
import { statedGoalTargetOf } from './stated-goal-target.js';
import { extraShareMoments, momentsOfTeam, type TeamShare } from './event-by-date-share.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export type GoalKind = 'chance_of_event' | 'change' | 'level' | 'share_by_date';

/**
 * A unit naming a chance: its MEASURE — the head noun, which in English is the LAST word before the first "of", "per",
 * "for", "on", "in", "by" or "to" (a compound is head-final: "launch likelihood"; an of-phrase is head-first: "number of
 * chances") — is likelihood, likeliness, chance(s), probability, odds or "likely". Codex buddy r1 on #2742: "number of
 * chances created per match" is a COUNT (its measure is "number"), never a chance. Brackets and "%" are not words.
 */
export const UNIT_HEAD_CUT = /[ \t]{1,4}(?:of|per|for|on|in|by|to)(?:[ \t]{1,4}|$)/i;
/** A bracketed scale note, bounded: "(0-1)", "(%)", "[0–100%]". */
export const SCALE_NOTE = /\([^()]{0,40}\)|\[[^[\]]{0,40}\]/g;
/** Words that open a clause after a chance word: "probability THAT …", "chance WE …", "chance A user …". */
const CLAUSE_OPENERS = new Set(['that', 'we', 'i', 'you', 'they', 'it', 'a', 'an', 'the', 'our', 'my', 'their', 'each', 'any', 'every']);
export const CHANCE_WORD = /^(?:likelihoods?|likeliness|chances?|probabilit(?:y|ies)|odds|likely)$/i;

/** True when a goal unit names the chance of an event (Science ruling §2). Units over 200 characters are not read. */
export function unitNamesAChance(unit: unknown): boolean {
  if (typeof unit !== 'string' || unit.length > 200) return false;
  const cut = UNIT_HEAD_CUT.exec(unit);
  // Codex buddy r2 on #2742: a scale annotation in brackets ("probability (0-1)", "likelihood (0–100%)") is never the measure.
  const measure = (cut === null ? unit : unit.slice(0, cut.index)).replace(SCALE_NOTE, ' ')
    .replace(/[()[\]%,.;:]/g, ' ').trim();
  const words = measure.split(/[ \t]+/).filter((w) => w !== '');
  if (words.length > 0 && CHANCE_WORD.test(words[words.length - 1]!)) return true;
  // P17: a chance word opening a clause is the measure too ("probability we hit the launch date", "the chance a trial
  // user converts"); before, the clause's last word was read as the head and the goal read as a plain level.
  // A counted per-unit clause ("chances the team creates per match") stays a level. DL-approved r2: a singular chance
  // with an event clause and non-period denominator ("chance the launch slips per management") must reach the reader.
  if (cut !== null && cut[0].trim().toLowerCase() === 'per') {
    return words.some((w) => CHANCE_WORD.test(w)) && readRateAsQuantity(unit).kind === 'chance';
  }
  return words.some((w, i) => CHANCE_WORD.test(w) && CLAUSE_OPENERS.has((words[i + 1] ?? '').toLowerCase()));
}

/**
 * P17: a RATE goal measured in a chance-named unit ("probability (%)", "conversion probability per visitor") is a share.
 * For the unit-family check a figure in pounds, people or months is never it, so the unit reads as a percent rate. Only
 * for a unit written in % ("probability (%)", "% churn probability") is a stated percent figure the rate's own; a 0–1
 * or bare "probability" unit keeps its own words (a "5%" is then refused, never silently re-scaled). The denominator
 * stays on that percent rate: today's "% per month" is never re-read as "% per year".
 */
export function rateUnitForFamily(unit: unknown): string | undefined {
  return unitNamesAChance(unit) && typeof unit === 'string' ? ratePercentFrame(unit) ?? '%' : undefined;
}
export function rateUnitInPercent(unit: unknown, stated: unknown): string | undefined {
  // A bare percent or a percent RATE is re-read. Subject words in the stated unit keep the own-unit path (buddy r2).
  const percent = readPercentUnit(stated);
  if (percent === null || percent.base !== null) return undefined;
  const statedRate = readUnitParts(`rate ${(percent.qualifiers ?? []).join(' ')}`);
  if (statedRate?.kind !== 'count' || statedRate.noun?.join(' ') !== 'rate') return undefined;
  if (!unitNamesAChance(unit) || typeof unit !== 'string') return undefined;
  return ratePercentFrame(unit, true);
}

/** Read the stored rate's denominator through the full unit reader, with its chance measure and scale kept separate. */
function ratePercentFrame(unit: string, requireExplicitPercent = false): string | undefined {
  let explicitPercent = false;
  const ws = words(unit.replace(SCALE_NOTE, (note) => {
    const scale = note.slice(1, -1).trim();
    const percent = readPercentUnit(scale);
    if (percent !== null && percent.base === null && percent.qualifiers === null) explicitPercent = true;
    // Existing numeric scale notes ("[0–100%]") name the percent scale, too; a 0–1 annotation never does.
    if (scale.endsWith('%')) {
      const bounds = scale.slice(0, -1).replaceAll('–', '-').replaceAll('—', '-').split('-');
      if (bounds.length === 2 && Number(bounds[0]) === 0 && Number(bounds[1]) === 100) explicitPercent = true;
    }
    return ' ';
  }));
  const measure: string[] = [];
  for (let i = 0; i < ws.length; i += 1) {
    let scaleLength = Math.min(3, ws.length - i);
    while (scaleLength > 0 && shareKind(ws.slice(i, i + scaleLength).join(' ')) === null) scaleLength -= 1;
    const scaleKind = scaleLength > 0 ? shareKind(ws.slice(i, i + scaleLength).join(' ')) : null;
    if (scaleKind === 'points') return undefined;
    if (scaleKind === 'percent') { explicitPercent = true; i += scaleLength - 1; }
    else measure.push(ws[i]!);
  }
  if (requireExplicitPercent && !explicitPercent) return undefined;
  const rate = readUnitParts(measure.join(' '));
  if (rate?.kind !== 'count') return undefined;
  return `%${rate.per !== null && rate.per.length > 0 ? ` per ${rate.per.join(' ')}` : ''}`
    + `${rate.period !== null ? ` per ${rate.period}` : ''}`;
}

/** The unit the goal is measured in: its target's unit, else its level's. */
export function goalUnitOf(goal: Rec): string | undefined {
  const own = goal.goal_threshold_unit;
  if (typeof own === 'string' && own.trim() !== '') return own;
  const os = isRec(goal.observed_state) ? goal.observed_state.unit : undefined;
  return typeof os === 'string' && os.trim() !== '' ? os : undefined;
}

/**
 * The kind of a goal node (see the header). EVERY unit the goal carries is read — its target's and its level's — so a
 * chance in one is never masked by a plain "%" in the other (Codex buddy r1 on #2742).
 */
export function goalKindOf(goal: unknown, graph?: unknown): GoalKind {
  // A node alone cannot prove a pure sum. Call with the graph (or goal + graph)
  // to classify S2a; existing node-only consumers retain their behaviour.
  if (isRec(goal) && Array.isArray(goal.nodes)) {
    graph = goal;
    goal = soleGoalOf(graph);
  }
  if (!isRec(goal)) return 'level';
  const os = isRec(goal.observed_state) ? goal.observed_state.unit : undefined;
  const chanceUnits = [goal.goal_threshold_unit, os].filter(unitNamesAChance) as string[];
  // P17, Science ruling (b): a population RATE written as a probability ("churn probability", "conversion probability per
  // visitor") is a quantity. Read each unit and the label independently: subjects and denominators never cross a join.
  // Rules 1 and 2 precede either chance rule, so any segment's quantity reading wins over rules 3/4 elsewhere.
  if (chanceUnits.length > 0
    // Each part is cut to 401 characters BEFORE the classifier receives it; an over-long segment falls to rule 4.
    && ![...chanceUnits, typeof goal.label === 'string' ? goal.label : '']
      .map((t) => readRateAsQuantity(t.slice(0, 401))).some((r) => r.kind === 'quantity')) {
    return 'chance_of_event';
  }
  // Outside-corpus P17: a bare percent carries no subject, so a chance word in the LABEL must reach the same reader.
  // Keep named-unit readings above intact; within the label, Science (b)'s quantity rules still precede chance rules.
  const unit = goalUnitOf(goal);
  const label = typeof goal.label === 'string' ? goal.label.slice(0, 401) : '';
  if (chanceUnits.length === 0 && unit !== undefined && shareKind(unit) === 'percent'
    && label.toLowerCase().split(/[^a-z]+/i).some((w, i, ws) => CHANCE_WORD.test(w) || riskChanceWord(ws, i))
    && readRateAsQuantity(label).kind === 'chance') {
    return 'chance_of_event';
  }
  const share = graph === undefined ? null : shareByDateGoalOf(graph);
  if (share !== null && share.goal.id === goal.id) return 'share_by_date';
  const frame = goal.goal_threshold_frame;
  return frame === 'change_abs' || frame === 'change_rel' ? 'change' : 'level';
}

/** Anchored and bounded; a percent SHARE of a named deliverable, never a chance. */
export const SHARE_BY_DATE_UNIT = /^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}[\p{L}][\p{L}\p{N} '\u2019-]{0,180}$/iu;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** S1-shaped ISO date plus calendar validity (no new date grammar). */
export function isShareCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || goalDeadlineOf({ goal_horizon: { deadline: v } }) !== v) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** CEE + shared ObservedState are passthrough. Keep the user's original bounds
 * on the PART, never on the goal or in a range re-expressed as uniform share.
 * reference_date pins the S1 calendar calculation; no implicit clock reading.
 */
export function statedTeamShareOf(node: unknown, deadline: string, goalUnit: string): TeamShare | null {
  if (!isRec(node) || !isRec(node.observed_state)) return null;
  const c = node.observed_state.stated_time;
  if (!isRec(c) || c.deadline !== deadline || !isShareCalendarDate(c.reference_date)
    || !finite(c.low) || !finite(c.high) || c.high < c.low) return null;
  const D = timeBetween(c.reference_date, deadline, 'months');
  if (D <= 0) return null;
  if (c.quantity === 'months_to_finish' && c.unit === 'months' && c.low > 0) {
    return { quantity: c.quantity, D, low: c.low, high: c.high };
  }
  if (c.quantity === 'share_per_month' && c.low >= 0 && c.unit === `${goalUnit} per month`) {
    return { quantity: c.quantity, D, low: c.low / 100, high: c.high / 100 };
  }
  return null;
}

export interface ShareByDateGoal {
  readonly goal: Rec;
  readonly deadline: string;
  readonly threshold_raw: number;
  readonly cap: 100;
  readonly team_part_id: string;
  readonly parts: readonly { readonly from: string; readonly to: string }[];
}

/** Fail closed: only the held pure sum attests ISL's samples as full share.
 * S2a supports one independent active extra-capacity switch per option. Other sums
 * retain today's frame until their exact convolution is supported.
 */
export function shareByDateGoalOf(graph: unknown): ShareByDateGoal | null {
  const goal = soleGoalOf(graph);
  if (!isRec(graph) || goal === undefined || typeof goal.id !== 'string') return null;
  const deadline = goalDeadlineOf(goal), unit = goal.goal_threshold_unit;
  if (!isShareCalendarDate(deadline) || typeof unit !== 'string' || unit.length > 200
    || !SHARE_BY_DATE_UNIT.test(unit) || unitNamesAChance(unit)
    || !finite(goal.goal_threshold_raw) || goal.goal_threshold_raw <= 0 || goal.goal_threshold_raw > 100
    || goal.goal_threshold_cap !== 100 || goal.goal_threshold_frame !== 'level'
    || statedGoalTargetOf(graph, goal)?.held !== '>=' || goal.intercept !== undefined
    || goal.nonlinear_identity !== undefined || goal.analysis_participation === 'retained_excluded') return null;
  const os = isRec(goal.observed_state) ? goal.observed_state : {};
  if (os.value !== undefined || os.raw_value !== undefined || os.std !== undefined || os.baseline !== undefined) return null;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  if (new Set(nodes.map(n => n.id)).size !== nodes.length) return null;
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const inbound = edges.filter(e => e.to === goal.id);
  // S2b's definitional goal must retain its admission-owned carrier; label coincidence cannot replace it.
  if (goal.threshold_source === 'definitional' && !inbound.some(e => eventShareEndpointMatches(e, nodes.find(n => n.id === e.from), goal))) return null;
  if (inbound.length === 0 || new Set(inbound.map(e => e.from)).size !== inbound.length) return null;
  const endsOf = endsOfGraph(graph);
  // Attest the same held projection sent by Run, by link identity. A stored
  // spread may be replaced by the user's stated range on that projection.
  const heldGraph = withHeldUserLinks(graph);
  const heldEdges = Array.isArray(heldGraph.edges) ? heldGraph.edges.filter(isRec) : [];
  const teams: string[] = [];
  const options = nodes.filter(n => n.kind === 'option');
  if (options.length === 0) return null;
  for (const e of inbound) {
    const held = heldEdges.find(l => l.from === e.from && l.to === e.to);
    if (held === undefined || !isRec(held.strength)) return null;
    const source = nodes.find(n => n.id === e.from);
    if (source === undefined || source.kind !== 'factor' || typeof source.id !== 'string'
      || source.intercept !== undefined || source.nonlinear_identity !== undefined || e.edge_type === 'bidirected'
      || source.analysis_participation === 'retained_excluded' || source.prior !== undefined
      || !isRec(source.observed_state) || !isRec(e.strength)) return null;
    const sourceId = source.id;
    const setting = (o: Rec): unknown => {
      const v = isRec(o.interventions) ? o.interventions[sourceId] : undefined;
      return isRec(v) ? v.value : v;
    };
    const team = statedTeamShareOf(source, deadline, unit);
    if (team !== null) {
      if (source.observed_state.unit !== unit || validatedDefinition(e, endsOf(e)) === undefined
        || e.strength.mean !== 1 || held.strength.mean !== 1 || held.strength.std !== 0.01
        || held.exists_probability !== 1 || edges.some(l => l.to === source.id)
        || options.some(o => isRec(o.interventions) && sourceId in o.interventions)) return null;
      const expected = momentsOfTeam(team);
      if (!finite(source.observed_state.value) || Math.abs(source.observed_state.value - expected.mean) > 0.0005
        || (source.observed_state.std === undefined ? expected.sd > 0
          : !finite(source.observed_state.std) || source.observed_state.std < 0
            || Math.abs(source.observed_state.std - expected.sd) > 0.0005)) return null;
      teams.push(source.id);
      continue;
    }
    // The option's extra share rides on its switch -> goal STRENGTH, exactly
    // as Science's ISL harness. A natural size alone cannot supply lead time.
    const c = source.observed_state.extra_share_by_date;
    const ne = isRec(e.provenance) && isRec(e.provenance.natural_effect) ? e.provenance.natural_effect : undefined;
    if (!isRec(c) || c.deadline !== deadline || !isShareCalendarDate(c.reference_date)
      || c.unit !== `${unit} per month` || !finite(c.monthly_share) || c.monthly_share < 0 || c.monthly_share > 100
      || !finite(c.lead_low) || c.lead_low < 0 || !finite(c.lead_high) || c.lead_high < c.lead_low
      || source.observed_state.value !== 0 || source.observed_state.std !== undefined
      || ne?.amount_unit !== unit || ne.per_source_change !== 1 || ne.strength_mean !== e.strength.mean
      || e.exists_probability !== 1 || edges.some(l => l.to === source.id && (
        // Only option -> switch structure is allowed here; the team part remains a root.
        !options.some(o => o.id === l.from) || l.edge_type === 'bidirected'
        || !isRec(l.strength) || l.strength.mean !== 1
        || l.exists_probability !== 1 || l.effect_direction !== 'positive'))
      || options.some(o => setting(o) !== 0 && setting(o) !== 1)) return null;
    const D = timeBetween(c.reference_date, deadline, 'months');
    if (D <= 0) return null;
    const expected = extraShareMoments(c.monthly_share / 100, D, c.lead_low, c.lead_high);
    if (!finite(e.strength.mean) || !finite(e.strength.std) || Math.abs(e.strength.mean - expected.mean) > 0.0005
      || Math.abs(e.strength.std - expected.sd) > 0.0005
      || !finite(held.strength.mean) || !finite(held.strength.std) || held.exists_probability !== 1
      || Math.abs(held.strength.mean - expected.mean) > 0.0005
      || Math.abs(held.strength.std - expected.sd) > 0.0005) return null;
  }
  if (teams.length !== 1 || options.some(o => inbound.filter(e => {
    const settings = isRec(o.interventions) ? o.interventions : {};
    const v = settings[e.from as string];
    return e.from !== teams[0] && (isRec(v) ? v.value : v) === 1;
  }).length > 1)) return null;
  return { goal, deadline, threshold_raw: goal.goal_threshold_raw, cap: 100, team_part_id: teams[0]!,
    parts: inbound.map(e => ({ from: e.from as string, to: e.to as string })) };
}

/** The one goal node of a graph, when there is exactly one. */
export function soleGoalOf(graph: unknown): Rec | undefined {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goals = nodes.filter((n) => n.kind === 'goal');
  return goals.length === 1 ? goals[0] : undefined;
}

/** The deadline the goal holds (`goal_horizon.deadline`, YYYY-MM-DD), if any. */
export function goalDeadlineOf(goal: unknown): string | undefined {
  const h = isRec(goal) && isRec(goal.goal_horizon) ? goal.goal_horizon : undefined;
  const d = h?.deadline;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

/**
 * The ONE sentence for a goal measured as a chance (Science ruling §2, verbatim), and, when the goal already holds its
 * date, what is still missing. Never a question: the one question is the host's (`chanceGoalDeadlineAsk`), said once.
 */
export function chanceGoalSentence(deadlineSaid: string | undefined): string {
  const lead = 'Olumi works out the chance of meeting your deadline; it needs the date and what must be done by then.';
  return deadlineSaid === undefined
    ? lead
    : `${lead} The deadline is ${deadlineSaid}; the model does not yet say what must be done by then, so no option has a chance yet.`;
}

/** The ending every host deadline ask carries, so every selector and replay reader recognises it (`isDecisionInputAsk`). */
export const DEADLINE_ASK_ENDING = "I'll propose it as your deadline.";

/** The one question for a chance goal with no date (ruling §4: the date first). */
export function chanceGoalDeadlineAsk(goalLabel: string): string {
  return `What is the deadline for "${goalLabel}"? A date or a time from now is fine, for example "6 months"; ${DEADLINE_ASK_ENDING}`;
}
