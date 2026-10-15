/**
 * ⭐ M3b — WHEN EVERY EFFECT IS IN PLACE: the user's forecast, on the ONE statement door (AIE #94 6180193788 §2; DL 14 Oct 23:06Z,
 * AMEND 23:49Z). Served hiring r4 (CEE e7f95dc6): Paul wrote "All of these effects would be fully in place by month 3." and only
 * the drafter could write `effects_at_period_end`; the judge read the timing as lost.
 *
 * The forecast is about the GOAL (field `lead`). It sets `effects_at_period_end` only when the user's statement(s), with their
 * context, establish ALL of it:
 *  - EVERY current option effect: each link leaving a factor an option sets, on the goal's path. "All of these effects" covers
 *    the effects the user gave (their own links); an effect that is Olumi's is covered only when the user answered the timing
 *    ask that names it (`timingAskOf`);
 *  - the SAME time reference as the target ("from today" / "after launch" in their words, or the ask they answered);
 *  - the target's END POINT: fully in place by exactly the target's month. Earlier does not prove it still holds at the end,
 *    and a month count alone never fixes its reference.
 * Whatever is missing is asked once, in the timing ask's words (never a refusal of what they said; their words are kept).
 * A later month is recorded as theirs, with the flag left false: no fallback reads it as "not stated".
 * The recorded forecast carries a fingerprint of the effects, the options' settings, the target and the reference
 * (`timingFingerprintOf`); when any of them changes, the forecast is stale and the flag reads false again
 * (`goalTargetBasisIn`). The month and the scope are the Agent's reading of the user's own words inside the quote (`reading_words`). Pure.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { provenanceOf } from '../../../cee/provenance/provenance-of.js';
import type { UserStatement } from '../../agent-lane/user-statements.js';
import { sayDate } from '../../goal-target/deadline-date.js';
import { goalDeadlineFromRecord } from '../../goal-target/goal-kind.js';
import { effectsBasisWords, goalTargetBasisOf, periodEndWords, type GoalTargetBasis } from '../../goal-target/goal-target-basis.js';
import {
  answeredBasisOf, applyGoalReadingEdit, goalReadingProjectionOf, type ApprovedGoalReading, type GoalReadingProjection,
} from '../../goal-target/goal-reading-write.js';
import type { StatementAsk } from '../ask.js';
import type { DoorReading } from '../read.js';
import type { RoleRow } from '../role-table.js';
import { holdsUserStatement, userStatementOnNode, userStatementRecord, type UserStatementRecord } from '../statements.js';
import { subjectKey, type DoorSubject } from '../subject.js';
import type { FieldWriter } from '../write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const TIMING_SIGNED_BY = '6180193788';

const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const edgesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : []);
const labelOf = (graph: unknown, id: unknown): string => String(nodesOf(graph).find((n) => n.id === id)?.label ?? id);

/** The options whose effects the target is read with: every option but carrying on as now and those set aside. */
function effectOptions(graph: unknown): Rec[] {
  return nodesOf(graph).filter((n) => n.kind === 'option' && n.is_baseline !== true && n.option_status !== 'removed'
    && n.option_status !== 'infeasible' && typeof n.id === 'string').sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Every current option effect on the goal: each link leaving a factor an option sets, whose target reaches the goal. */
export function optionEffectsOn(graph: unknown, goalId: string): Rec[] {
  const set = new Set(effectOptions(graph).flatMap((o) => (isRec(o.interventions) ? Object.keys(o.interventions) : [])));
  const edges = edgesOf(graph).filter((e) => e.origin !== 'repair');
  const reaches = new Set<unknown>([goalId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (reaches.has(e.to) && !reaches.has(e.from)) { reaches.add(e.from); grew = true; }
  }
  return edges.filter((e) => typeof e.from === 'string' && set.has(e.from) && reaches.has(e.to))
    .sort((a, b) => `${String(a.from)}>${String(a.to)}`.localeCompare(`${String(b.from)}>${String(b.to)}`));
}

interface HeldTiming {
  readonly goal: Rec;
  readonly basis: GoalTargetBasis;
  readonly projection: GoalReadingProjection;
  readonly effects: readonly Rec[];
}
function heldTiming(graph: unknown, goalId: string): HeldTiming | undefined {
  const goal = nodesOf(graph).find((n) => n.kind === 'goal' && n.id === goalId);
  const basis = goalTargetBasisOf(goal);
  const projection = goalReadingProjectionOf(graph, goalId);
  const effects = optionEffectsOn(graph, goalId);
  // A target read at its end, with at least one option effect for the forecast to be about.
  if (goal === undefined || basis === undefined || projection === undefined || basis.period_kind !== 'at_end' || effects.length === 0) return undefined;
  return { goal, basis, projection, effects };
}

/** JSON with every object's keys sorted: the same meaning read back from storage or a Run's copy gives the same text. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isRec(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** What a recorded forecast was about: the effects, the options' settings, the target and its reference. Any change → stale. */
export function timingFingerprintOf(graph: unknown, goalId: string): string | undefined {
  const h = heldTiming(graph, goalId);
  if (h === undefined) return undefined;
  const effects = h.effects.map((e) => [e.from, e.to, e.strength ?? null, e.exists_probability ?? null, e.effect_direction ?? null]);
  const options = effectOptions(graph).map((o) => [o.id, o.interventions ?? null]);
  const t = h.projection.target;
  const target = [t?.raw ?? null, t?.unit ?? null, t?.frame ?? null, t?.comparator ?? null, h.basis.reference, h.basis.period_months];
  return createHash('sha256').update(canonical({ effects, options, target })).digest('hex').slice(0, 32);
}

const listed = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const effectWords = (graph: unknown, e: Rec): string => `‘${labelOf(graph, e.from)}’ on ‘${labelOf(graph, e.to)}’`;
const referenceWords = (basis: GoalTargetBasis): string => (basis.reference === 'launch' ? 'after launch' : 'from today');
const endWords = (graph: unknown, goalId: string, basis: GoalTargetBasis): string => {
  const deadline = goalDeadlineFromRecord(graph, goalId);
  return `${periodEndWords(basis)} ${referenceWords(basis)}${deadline !== undefined && basis.reference === 'today' ? ` (${sayDate(deadline)})` : ''}`;
};

/** The ONE timing ask (`ask.ts`): every current option effect and the target's own end point. An answer to it binds all three. */
export function timingAskOf(graph: unknown, goalId: string): StatementAsk | undefined {
  const h = heldTiming(graph, goalId);
  if (h === undefined) return undefined;
  return { subject: { kind: 'goal', id: goalId, field: 'lead' },
    words: `Would all of these effects be fully in place by ${endWords(graph, goalId, h.basis)}: ${listed(h.effects.map((e) => effectWords(graph, e)))}?` };
}

const UNIVERSAL = /\b(?:all|every|each|both)\b/i;
const plain = (t: string): string => t.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
/** The reading words are the user's own, a run of the verified quote (never Olumi's paraphrase). */
const inQuote = (words: string, quote: string): boolean => words.trim() !== '' && plain(quote).includes(plain(words));
const FROM_TODAY = /\b(?:from (?:today|now)|from this month)\b/i;
const AFTER_LAUNCH = /\b(?:after|from|post)[ -](?:the )?launch\b/i;
/** The one month the reading words state (digits only: the figure is the user's, never a word Olumi turned into one). */
function monthIn(words: string): number | undefined {
  const figures = [...words.matchAll(/(?<![\d.])(\d{1,2})(?![\d.])/g)].map((m) => Number(m[1]));
  return figures.length === 1 && figures[0]! > 0 && figures[0]! <= 60 ? figures[0] : undefined;
}

/** What the statements establish, and what is still missing (each named once, for the ONE ask). */
interface TimingReading {
  readonly month: number;
  readonly reference: 'today' | 'launch' | undefined;
  readonly covers: 'all' | 'yours';
  readonly answeredAsk: boolean;
}
type TimingVerdict = { readonly kind: 'complete'; readonly r: TimingReading; readonly later: boolean } | { readonly kind: 'missing'; readonly what: readonly string[] };

/** The statements' timing against the held target: complete (in place at the end, or later), or exactly what is missing. */
function timingVerdict(graph: unknown, h: HeldTiming, r: TimingReading): TimingVerdict {
  const missing: string[] = [];
  const reference = r.answeredAsk ? h.basis.reference : r.reference;
  if (reference === undefined) missing.push(`whether month ${r.month} is ${referenceWords(h.basis)} or ${h.basis.reference === 'launch' ? 'from today' : 'after launch'}`);
  else if (reference !== h.basis.reference) missing.push(`the effects by ${periodEndWords(h.basis)} ${referenceWords(h.basis)}, which is when this target is evaluated`);
  const theirs = h.effects.filter((e) => provenanceOf({ link: e }).origin === 'human');
  const notCovered = r.answeredAsk || r.covers !== 'all' ? [] : h.effects.filter((e) => !theirs.includes(e));
  if (!r.answeredAsk && notCovered.length > 0) missing.push(`whether it also covers ${listed(notCovered.map((e) => effectWords(graph, e)))} (Olumi’s estimate${notCovered.length > 1 ? 's' : ''}, not yours)`);
  if (r.covers === 'yours' && !r.answeredAsk) missing.push('whether it covers every option’s effect');
  if (missing.length === 0 && r.month < h.basis.period_months) missing.push(`whether they would still be fully in place at ${periodEndWords(h.basis)}`);
  return missing.length > 0 ? { kind: 'missing', what: missing } : { kind: 'complete', r, later: r.month > h.basis.period_months };
}

/** The user's recorded forecast for the goal: in place, later, or stale (its effects, options, target or reference moved). */
export type HumanEffectsTiming =
  | { readonly kind: 'in_place'; readonly month: number; readonly record: UserStatementRecord }
  | { readonly kind: 'later'; readonly month: number; readonly record: UserStatementRecord }
  | { readonly kind: 'stale'; readonly record: UserStatementRecord };
export function humanEffectsTimingOf(graph: unknown, goalId: string): HumanEffectsTiming | undefined {
  const goal = nodesOf(graph).find((n) => n.kind === 'goal' && n.id === goalId);
  const record = userStatementOnNode(goal, subjectKey({ kind: 'goal', id: goalId, field: 'lead' }));
  const month = record?.attest?.month;
  if (record === undefined || typeof month !== 'number') return undefined;
  if (record.attest?.fingerprint !== timingFingerprintOf(graph, goalId)) return { kind: 'stale', record };
  return record.attest?.later === true ? { kind: 'later', month, record } : { kind: 'in_place', month, record };
}

/**
 * The goal's held reading as a chance may use it: `goalTargetBasisOf`, except that a recorded human forecast that is stale, or
 * that puts the effects after the target's end, never leaves `effects_at_period_end` true. With no recorded forecast the reading
 * is unchanged (the drafter's reading stays Olumi's).
 */
export function goalTargetBasisIn(graph: unknown, goal: unknown): GoalTargetBasis | undefined {
  const basis = goalTargetBasisOf(goal);
  if (basis === undefined || !basis.effects_at_period_end || !isRec(goal) || typeof goal.id !== 'string') return basis;
  const human = humanEffectsTimingOf(graph, goal.id);
  return human === undefined || human.kind === 'in_place' ? basis : { ...basis, effects_at_period_end: false };
}

const quoteOf = (s: UserStatement): string => `“${s.quote}”`;
const said = (s: readonly UserStatement[]): string => s.map(quoteOf).join(' and ');

/** The AIE's chance-adjacent disclosure (6180193788 §2), only where THIS reading used the user's current forecast. */
export function timingBasisNote(graph: unknown, goalId: string, basis: GoalTargetBasis): string | undefined {
  const human = humanEffectsTimingOf(graph, goalId);
  const h = heldTiming(graph, goalId);
  if (human?.kind !== 'in_place' || h === undefined || !basis.effects_at_period_end) return undefined;
  return `Timing basis: you stated ${said(human.record.statements)}. This calculation reads ${listed(h.effects.map((e) => effectWords(graph, e)))} at `
    + `${periodEndWords(basis)} on that forecast. It does not model when they arrive.`;
}

/** The withhold's words where the user's recorded forecast puts the effects after the target's end (never "not stated"). */
export function laterTimingWords(graph: unknown, goalId: string, basis: GoalTargetBasis): string | undefined {
  const human = humanEffectsTimingOf(graph, goalId);
  return human?.kind === 'later' ? `You said they would be fully in place by month ${human.month} ${referenceWords(basis)}, after that.` : undefined;
}

/** The reading of ONE statement's words: its month, its reference and its scope; the ask it answered is the context. */
function readWords(quote: string, words: string | undefined): Omit<TimingReading, 'answeredAsk'> | { readonly refused: string } {
  const w = typeof words === 'string' ? words.trim().replace(/[.,;:!?]+$/, '') : '';
  const month = w === '' ? undefined : monthIn(w);
  if (month === undefined || w.length > 200 || !inQuote(w, quote)) {
    return { refused: `Give reading_words: the user’s own words for when the effects are fully in place, with its one month figure, copied from “${quote}”.` };
  }
  return { month, reference: FROM_TODAY.test(w) ? 'today' : AFTER_LAUNCH.test(w) ? 'launch' : undefined, covers: UNIVERSAL.test(w) ? 'all' : 'yours' };
}

/** The reading across the statements: the one that states the month, plus any answer to the timing ask. */
function readingOf(statements: readonly UserStatement[], words: string | undefined, graph: unknown, goalId: string): TimingReading | undefined {
  const dated = statements.filter((s) => s.form === 'upper_bound');
  if (dated.length !== 1) return undefined;
  const r = readWords(dated[0]!.quote, words);
  if ('refused' in r) return undefined;
  const ask = timingAskOf(graph, goalId)?.words;
  return { ...r, answeredAsk: ask !== undefined && statements.some((s) => s.answering === ask) };
}

export function timingAssumptions(statements: readonly UserStatement[], subject: DoorSubject, graph: unknown, words?: string): string[] {
  const h = heldTiming(graph, subject.id);
  const r = h === undefined ? undefined : readingOf(statements, words, graph, subject.id);
  const v = h === undefined || r === undefined ? undefined : timingVerdict(graph, h, r);
  if (h === undefined || v?.kind !== 'complete') return [];
  return [`This target is evaluated at ${endWords(graph, subject.id, h.basis)}.`,
    'It describes the effects at that point; it does not say they operate throughout the preceding window or that their arrival has been simulated.',
    ...(v.later ? [`That is after ${periodEndWords(h.basis)}, so no chance at ${periodEndWords(h.basis)} can rest on it.`] : [])];
}

export function timingRecordedWords(statements: readonly UserStatement[], subject: DoorSubject, _label: string, graph: unknown, words?: string): string {
  const h = heldTiming(graph, subject.id);
  const r = h === undefined ? undefined : readingOf(statements, words, graph, subject.id);
  const v = h === undefined || r === undefined ? undefined : timingVerdict(graph, h, r);
  if (h === undefined || v?.kind !== 'complete') return `Recorded your forecast: ${said(statements)}.`;
  const what = `${listed(h.effects.map((e) => effectWords(graph, e)))} would be fully in place by month ${v.r.month} ${referenceWords(h.basis)}`;
  if (v.later) return `Recorded your forecast: ${what}. That is after ${periodEndWords(h.basis)}, so no chance at ${periodEndWords(h.basis)} rests on it.`;
  const assumed = effectsBasisWords({ ...h.basis, effects_at_period_end: true });
  return `Recorded your forecast: ${what}. The saved target reading uses it for ${periodEndWords(h.basis)}.${assumed === undefined ? '' : ` ${assumed}`}`;
}

export const TIMING_ROW: RoleRow = {
  field: 'lead',
  unit: 'months',
  forms: ['upper_bound', 'describes'],
  carrier: 'goal_reading',
  maxStatements: 2,
  signed_by: TIMING_SIGNED_BY,
  applies: (subject) => subject.kind === 'goal',
  get writer() { return TIMING_WRITER; },
  read: (quote, subject, graph, words) => {
    const h = heldTiming(graph, subject.id);
    if (h === undefined) return { refused: 'The goal has no target read at its end, with an option effect, for this timing to be about.' };
    // The answer to the timing ask ("Yes, from today, all of them") carries no month of its own: it is read with the dated one.
    if (words === undefined && !/\d/.test(quote)) return { form: 'describes' };
    const r = readWords(quote, words);
    if ('refused' in r) return r;
    return { form: 'upper_bound', high: r.month, words: words!.trim().replace(/[.,;:!?]+$/, '') };
  },
  readingWords: (statements, subject, _label, graph, words) => {
    const h = heldTiming(graph, subject.id);
    const r = h === undefined ? undefined : readingOf(statements, words, graph, subject.id);
    if (h === undefined || r === undefined) return '';
    return `your forecast that ${listed(h.effects.map((e) => effectWords(graph, e)))} would be fully in place by month ${r.month} ${referenceWords(h.basis)}`;
  },
  assumptions: timingAssumptions,
  recordedWords: timingRecordedWords,
  bindsWhole: (quote, subject, graph, words) => {
    const goals = nodesOf(graph).filter((n) => n.kind === 'goal');
    return goals.length === 1 && goals[0]!.id === subject.id && typeof words === 'string' && UNIVERSAL.test(words) && inQuote(words.trim().replace(/[.,;:!?]+$/, ''), quote);
  },
  incomplete: (statements, subject, graph, words) => {
    const h = heldTiming(graph, subject.id);
    const ask = timingAskOf(graph, subject.id)?.words;
    const r = h === undefined ? undefined : readingOf(statements, words, graph, subject.id);
    if (h === undefined || ask === undefined) return 'The goal has no target read at its end for this timing to be about.';
    if (r === undefined) return `Olumi could not read one month from those words. Ask only this, exactly: “${ask}”`;
    const v = timingVerdict(graph, h, r);
    return v.kind === 'missing' ? `Not yet clear: ${listed(v.what as string[])}. Ask only this, exactly: “${ask}”` : undefined;
  },
};

/** The read-back: the reading the card showed with the flag it set, and the user's words recorded (JSON payload only). */
export function timingHolds(payload: ApprovedGoalReading, after: unknown): boolean {
  const node = nodesOf(after).find((n) => n.id === payload.goal_id);
  const said = payload.user_statement;
  return node !== undefined && isRec(payload.expected_basis) && said !== undefined
    && isDeepStrictEqual(node.goal_target_basis, answeredBasisOf(payload.expected_basis, payload.members))
    && holdsUserStatement(after, said.record, said.subject);
}

export const TIMING_WRITER: FieldWriter = {
  approve: (reading: DoorReading, graph: unknown) => {
    const h = heldTiming(graph, reading.subject.id);
    const r = h === undefined ? undefined : readingOf(reading.statements, reading.words, graph, reading.subject.id);
    const v = h === undefined || r === undefined ? undefined : timingVerdict(graph, h, r);
    const fingerprint = timingFingerprintOf(graph, reading.subject.id);
    if (h === undefined || v === undefined || fingerprint === undefined || !isRec(h.goal.goal_target_basis)) return { refused: 'timing_not_applicable' };
    // Only a complete reading is written; what is missing is asked first (`timingMissing`).
    if (v.kind === 'missing') return { refused: 'timing_incomplete' };
    const members = { effects_at_period_end: !v.later };
    const record = userStatementRecord(reading.subject, reading.statements, new Date().toISOString(), { fingerprint, month: v.r.month, later: v.later });
    const payload: ApprovedGoalReading = { goal_id: reading.subject.id, expected_basis: h.goal.goal_target_basis, expected_goal: h.projection, members,
      user_statement: { subject: reading.subject, record } };
    const written = applyGoalReadingEdit(graph, payload);
    if (written.kind === 'refused') return { refused: written.reason };
    return { member: 'goal_reading', payload, holds: (after: unknown) => timingHolds(payload, after) };
  },
};
