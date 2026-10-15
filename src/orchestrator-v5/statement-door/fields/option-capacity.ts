/**
 * ⭐ SYSTEM 1 M5 — AN OPTION'S NEW SHARE OF TIME, on the ONE statement door (DL systems re-plan 14 Oct 22:50Z: "M5 effect plus option
 * capacity change = HIRING"). The coaching loop's answer ("it would cut legacy work from 25% to 15%") is the user's statement of
 * the level the option sets a share of time to: subject {kind: 'factor', id: share, option_id, field: 'level'}, the SAME subject
 * readiness asks with for an unsized option (`analysis-ready-helper` MISSING_OPTION_VALUE `statement_subject`). The figure is the
 * user's; Olumi's freed-time reading and its timing are assumptions said on the card, and the press adopts them (`derives`).
 *
 * The row reads the figure with the share's own reader (`shareFiguresFor`, never a new matcher) and writes through the
 * `option_capacity` member: the existing registered revision (`withOptionCapacityChange`), read back by `optionCapacityChangeHeld`.
 * ⛔ AIE 6182987896 (exact AMENDs): the statement binds the option (by the actual question it answers) AND the share (it names
 * it), in the share's own population and unit, against today's held figure; a range, a bound, a negated or a conditional
 * statement stays honestly unsupported in this point-only row (never its low end), its words kept. The assumption, missing
 * timing and receipt are the AIE's words, with the real operands only. Pure.
 */
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { factorTheUserNamed } from '../../agent-lane/stated-by-user.js';
import { coordinateClausesOf } from '../../agent-lane/link-effect-option-statement.js';
import { effectLeadFromStatements, effectLeadWords } from '../../goal-target/effect-lead.js';
import { sayDate } from '../../goal-target/deadline-date.js';
import { OPTION_TIMING_UNRESOLVED } from '../../goal-target/share-by-date-run.js';
import { CONDITIONAL, NEGATED } from './risk.js';
import {
  freedTimeRatio, optionCapacityChangeHeld, optionCapacityTarget, otherSharesOf, planOptionCapacityChange, shareFiguresFor,
  withOptionCapacityChange, type ApprovedOptionCapacityChange,
} from '../../goal-target/option-capacity-change.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import type { DoorSubject } from '../subject.js';
import type { FieldWriter } from '../write.js';

type Rec = Record<string, any>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * The AIE-signed science table (6180618773, as M4's rows cite it) governs this row's meaning: the figure is the user's, the
 * freed-time relation and its timing stay Olumi's disclosed assumptions, and no capacity is counted twice (T8). The words are the
 * coaching-loop card's, sent to the AIE for AMEND (#94 6182596562; DL 15 Oct: ship, fix forward on its AMEND).
 */
export const OPTION_CAPACITY_SIGNED_BY = '6180618773';
const TIMED = /\b(?:days?|weeks?|months?|years?)\b/i;
const NUM = String.raw`\d{1,3}(?:\.\d+)?\s*(?:%|per ?cent\b)?`;
/** A range ("between 10 and 15%", "10–15%") or a bound ("under 15%", "at most 15%") on the new share: not a point. */
const RANGE = new RegExp(String.raw`\bbetween\s+${NUM}\s+and\s+\d|(?<!from\s)\b\d{1,3}(?:\.\d+)?\s*%?\s*(?:-|–|—)\s*\d{1,3}(?:\.\d+)?\s*(?:%|per ?cent\b)`, 'i');
// "up to" is a bound ("up to 15%"), not where a share goes ("would go up to 30%").
const BOUND = new RegExp(String.raw`\b(?:under|below|less than|at most|no more than|(?<!\b(?:go|goes|going|went|gone|come|comes|move|moves|rise|rises)\s)up to|at least|over|above|more than|no less than)\s+${NUM}`, 'i');
const APPROX = /\b(?:about|around|roughly|approximately)\s+\d/i;

const targetOf = (subject: DoorSubject, graph: unknown) => (subject.kind === 'factor' && subject.option_id !== undefined && subject.to_id === undefined
  ? optionCapacityTarget(graph, subject.option_id, subject.id) : undefined);

/**
 * The plan the card offers, from the verified statements: the share's new figure, and the timing the same words give (session 4's
 * ONE lead reader, `effect-lead.ts`, over the user's verified quotes). Any doubt is refused with its reason; the words are kept.
 */
export function optionCapacityPlanOf(subject: DoorSubject, graph: unknown, statements: readonly UserStatement[]):
  { readonly approved: ApprovedOptionCapacityChange } | { readonly refused: string } {
  const target = targetOf(subject, graph);
  if (target === undefined || target.kind !== 'target') return { refused: target?.detail ?? 'This is not an option’s share of time in the deadline forecast.' };
  const quotes = statements.map((s) => s.quote);
  const timed = quotes.filter((q) => TIMED.test(q));
  const lead = timed.length === 0 ? undefined : effectLeadFromStatements({ now: timed.join('\n') }, subject.option_id!, timed);
  if (lead?.kind === 'refused') return { refused: lead.detail };
  const plan = planOptionCapacityChange(graph as Rec, target, statements, lead?.lead);
  if (plan.kind === 'refused') return { refused: plan.detail };
  if (!optionCapacityChangeHeld(withOptionCapacityChange(graph, plan.approved), plan.approved)) {
    return { refused: `Olumi couldn't apply this figure to ‘${plan.approved.option_label}’ as the model stands. Say so plainly.` };
  }
  return { approved: plan.approved };
}

const unitOf = (a: ApprovedOptionCapacityChange): string => (a.unit.startsWith('%') ? a.unit : ` ${a.unit}`);

/** Olumi's reading, as the card says it: the option sets the share to the user's figure (and today's, for comparison), with the qualifier said. */
export function optionCapacityReadingWords(a: ApprovedOptionCapacityChange): string {
  const about = a.statements.some((st) => st.qualifier === 'about') ? 'about ' : '';
  return `‘${a.option_label}’ sets ‘${a.factor_label}’ to ${about}${a.to}${unitOf(a)} (${a.today}${unitOf(a)} today)`;
}

/**
 * Each separate Olumi assumption, said once (AIE 6182987896, exact, real operands only): the allocation-to-pace reading, the
 * timing (the lead reader's words, else the AIE's unresolved sentence), and the numerical carrier with its window. No limitation
 * is invented: the model holds none beyond these, so the AIE's "with {limitations}" clause has nothing to name and is not said.
 */
export function optionCapacityAssumptions(a: ApprovedOptionCapacityChange): string[] {
  const pct = Math.round(freedTimeRatio(a) * 100);
  const u = unitOf(a);
  return [`Olumi proposes treating all team time outside ‘${a.factor_label}’ as time on ‘${a.deliverable}’. Under that assumption, this change `
    + `increases allocated time for the same work from ${a.total - a.today}${u} to ${a.total - a.to}${u}, or about ${pct}% of its previous amount. `
    + 'To model faster delivery, Olumi also assumes pace changes in proportion to that allocated time.',
  a.lead !== undefined ? effectLeadWords(a.lead) : OPTION_TIMING_UNRESOLVED,
  `The model gains one part, ‘${a.carrier_label}’: with this option, the team’s capacity for ‘${a.deliverable}’ is about ${pct}% of today’s, `
    + `counted once in the deadline forecast to ${sayDate(a.deadline)}${a.lead === undefined ? ', and this option’s chance waits for that timing' : ''}.`];
}

/** The receipt (AIE 6182987896, exact), said only after the read-back holds the change; it promises no chance. */
export const optionCapacityRecordedWords = (a: Pick<ApprovedOptionCapacityChange, 'option_label'>): string =>
  `Saved ‘${a.option_label}’ with your stated share of time and the shown Olumi assumptions kept distinct.`;

const planned = (subject: DoorSubject, graph: unknown, statements: readonly UserStatement[]): ApprovedOptionCapacityChange | undefined => {
  const p = optionCapacityPlanOf(subject, graph, statements);
  return 'approved' in p ? p.approved : undefined;
};

export const OPTION_CAPACITY_ROW: RoleRow = {
  field: 'level',
  unit: '%',
  forms: ['point'],
  carrier: 'option_capacity',
  maxStatements: 2,
  signed_by: OPTION_CAPACITY_SIGNED_BY,
  quantity: 'share_of_time',
  // Only an option's share of time the deadline forecast holds unresolved: never a factor's own level, never another option's setting.
  applies: (subject, graph) => targetOf(subject, graph)?.kind === 'target',
  get writer() { return OPTION_CAPACITY_WRITER; },
  read: (quote, subject, graph) => {
    const target = targetOf(subject, graph);
    if (target === undefined || target.kind !== 'target') return { refused: target?.detail ?? 'This is not an option’s share of time in the deadline forecast.' };
    // A timing-only statement ("from month 3") is the option's lead, read with the figure's statement by the lead reader.
    const label = String(target.factor.label), others = otherSharesOf(graph as Rec, String(target.factor.id));
    const today = Number(target.factor.observed_state.raw_value);
    // ⛔ AIE 6182987896: bound to the SHARE by its own words (the option is bound by the question the statement answers).
    const naming = coordinateClausesOf(quote).filter((c) => factorTheUserNamed(label, c, { options: [], others }));
    if (naming.length === 0) return { refused: `“${quote}” does not name ‘${label}’, so it is not bound to that share. Ask only which share it is about.` };
    const said = naming.join(' ');
    if (NEGATED.test(said) || CONDITIONAL.test(said)) {
      return { refused: `“${quote}” is negated or conditional, and this card records only a plain new figure for ‘${label}’, so it is kept as said, not recorded.` };
    }
    if (RANGE.test(said) || BOUND.test(said)) {
      return { refused: `“${quote}” gives a range or a bound for ‘${label}’, and this card records only one new figure, so it is kept as said and stays unsupported here; no end of it is used as the figure.` };
    }
    const figures = shareFiguresFor(label, String(target.factor.observed_state.unit), others)(quote);
    const fresh = [...new Set(figures.map((f) => f.low))].filter((v) => v !== today);
    // "from 20% to 15%": the figure the words move the share TO is the new one; the other is checked against today's by the plan.
    const to = fresh.length > 1 ? [...quote.matchAll(/\bto\s+(\d{1,3}(?:\.\d+)?)\s*(?:%|per ?cent\b)/gi)].map((m) => Number(m[1])).filter((v) => fresh.includes(v)) : fresh;
    if (fresh.length === 0) return { refused: `“${quote}” gives no new figure for ‘${String(target.factor.label)}’.` };
    if (to.length !== 1) return { refused: `“${quote}” gives more than one new figure for ‘${String(target.factor.label)}’ (${fresh.join(' and ')}). Ask which one ‘${String(target.option.label)}’ would set it to.` };
    return { form: 'point', low: to[0]!, high: to[0]!, ...(APPROX.test(said) ? { qualifier: 'about' } : {}) };
  },
  readingWords: (statements, subject, _label, graph) => {
    const a = planned(subject, graph, statements);
    return a === undefined ? '' : optionCapacityReadingWords(a);
  },
  assumptions: (statements, subject, graph) => {
    const a = planned(subject, graph, statements);
    return a === undefined ? [] : optionCapacityAssumptions(a);
  },
  incomplete: (statements, subject, graph) => {
    const p = optionCapacityPlanOf(subject, graph, statements);
    return 'refused' in p ? p.refused : undefined;
  },
  // The freed-time relation and its timing are Olumi's reading, adopted by the press: its button is "Use this reading".
  derives: true,
  recordedWords: (statements, subject, label, graph) => optionCapacityRecordedWords(planned(subject, graph, statements)
    ?? { option_label: String((isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((n: Rec) => n.id === subject.option_id)?.label : undefined) ?? label) }),
};

/** The adapter onto the `option_capacity` member: the plan, as the card offers it, is the payload; the read-back holds it exactly. */
export const OPTION_CAPACITY_WRITER: FieldWriter = {
  approve: (reading: DoorReading, graph: unknown) => {
    const p = optionCapacityPlanOf(reading.subject, graph, reading.statements);
    if ('refused' in p) return { refused: p.refused };
    return { member: 'option_capacity', payload: JSON.parse(JSON.stringify(p.approved)) as unknown };
  },
  holds: (write, after) => isRec(write.payload) && typeof write.payload.option_id === 'string'
    && optionCapacityChangeHeld(after, write.payload as ApprovedOptionCapacityChange),
};
