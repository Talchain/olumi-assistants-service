/**
 * ⭐ SYSTEM 2: ONE CONSTRUCTION SOURCE MAP (DL re-plan 14 Oct ~23:0xZ; Paul: "chasing symptoms and making patches"). The drafter
 * emits `statements[]`: for every quantity, condition, timing, measure or current state the brief states, the complete verbatim
 * sentence, the drafted item it is about and the field it states. The host verifies each ONCE against the brief with the one
 * statement verifier (`verifyStatements`), one statement at a time, so a bad quote drops only itself. Admission, the compiler and
 * readiness then read this map instead of one carrier and one matcher per field (`baseline_evidence`, `stated_evidence`,
 * `already_true_evidence`, `deadline_words`, the capacity-chain prose), each retired in its own step. A `measure` statement never
 * sets `effects_at_period_end`: only a source-bound reading that ALL current effects are in place at the period's end supports that
 * flag (AIE 6180193788 / 6180604131; T1H's M3). Measurement, target/reference and timing stay separate.
 *
 * AUTHOR (PL AMEND, 14 Oct 22:53Z; the first cause #3133 repaired): a statement verified, and bound by its own clause to THIS
 * subject (step 2's frame check; a key made from drafted labels proposes a binding, never proves it), is the user's; the
 * drafter's own labelled estimate with no brief figure behind it is Olumi's; everything else (a refused or misattributed
 * statement, a brief figure with no statement, an ambiguous label) is UNKNOWN, retained here with its quote and the refusal's
 * reason, never dropped and never turned into Olumi's estimate. Figures come only from the quote's own words (`figuresIn`),
 * never from the drafter's value. `statements` is optional: a missing or malformed list never fails a draft. Pure.
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { CARDINAL_AMOUNT_SOURCE, parseCardinalAmount } from '../../utils/cardinal-words.js';
import { STATEMENT_FORMS, verifyStatements, type StatementForm, type UserStatement } from './user-statements.js';
import { resolveSubject, subjectKey as doorSubjectKey, type DoorSubject } from '../statement-door/subject.js';
import { CONSTRUCTION_ATTEST, userStatementRecord, withUserStatement } from '../statement-door/statements.js';

/**
 * What a statement states about its subject. ⚠ REBASE: the ONE closed list moves to session 4's statement door (DL condition 1),
 * imported here once its PR-0 lands; this branch does not merge with a second list.
 */
export const STATEMENT_FIELDS = ['level', 'target', 'holds_now', 'occurrence', 'lead', 'effect', 'measure', 'relation'] as const;
export type StatementField = typeof STATEMENT_FIELDS[number];
export const SUBJECT_KINDS = ['goal', 'factor', 'option', 'risk', 'link'] as const;
export type SubjectKind = typeof SUBJECT_KINDS[number];

/** The drafted item a statement is about, by the drafter's own labels: the host binds labels to ids after admission. */
export interface DraftedSubject {
  readonly kind: SubjectKind;
  readonly label: string;
  /** A link's target label (`label` is its source). */
  readonly to_label?: string;
  /** An option's value for a factor: `label` is the option, `factor_label` the factor it sets. */
  readonly factor_label?: string;
}

export interface RefusedStatement {
  readonly index: number;
  readonly refusal: string;
  readonly detail: string;
  readonly quote?: string;
  readonly key?: string;
  /** The entry exactly as the drafter gave it (its known keys, plain values only): retained whole, never shortened (AIE 6180604131). */
  readonly given: GivenStatement;
}

/** A drafter entry's own fields, copied as given: a quote is never shortened, a subject keeps every label it named. */
export interface GivenStatement {
  readonly [key: string]: string | number | boolean | null | { readonly [key: string]: string | null } | undefined;
}

export interface SourceMap {
  /** Verified statements by subject key (`subjectKey`), in brief order. */
  readonly verified: ReadonlyMap<string, readonly UserStatement[]>;
  /**
   * Authorship UNKNOWN: every entry the host could not verify, kept WHOLE with why (a refusal, or `not_checked` past the
   * per-draft limit): out of verified numerical use, never out of the reasoning, never relabelled as Olumi's.
   */
  readonly refused: readonly RefusedStatement[];
}

/** How many entries one draft has checked; the rest are retained unchecked (`not_checked`), never dropped. */
const MAX = 60;
const GIVEN_KEYS = ['quote', 'field', 'form', 'value', 'low', 'high', 'unit', 'qualifier', 'conditions'] as const;
const plain = (v: unknown): v is string | number | boolean | null => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
function givenOf(r: Record<string, unknown>): GivenStatement {
  const out: Record<string, GivenStatement[string]> = {};
  for (const k of GIVEN_KEYS) if (plain(r[k])) out[k] = r[k] as string | number | boolean | null;
  const sub = r['subject'];
  if (sub !== null && typeof sub === 'object' && !Array.isArray(sub)) {
    out['subject'] = Object.fromEntries(Object.entries(sub as Record<string, unknown>).filter(([, v]) => v === null || typeof v === 'string')) as { [key: string]: string | null };
  }
  return out;
}
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : undefined);
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** One key per subject and field: the same key a readiness ask and the statement door use. */
export function subjectKey(subject: DraftedSubject, field: StatementField): string {
  return [subject.kind, norm(subject.label), norm(subject.to_label ?? ''), norm(subject.factor_label ?? ''), field].join('|');
}

function subjectOf(v: unknown): DraftedSubject | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const kind = SUBJECT_KINDS.find((k) => k === r['kind']);
  const label = text(r['label'], 200);
  if (kind === undefined || label === undefined) return undefined;
  const to = text(r['to_label'], 200);
  const factor = text(r['factor_label'], 200);
  if (kind === 'link' && to === undefined) return undefined;
  return { kind, label, ...(kind === 'link' ? { to_label: to } : {}), ...(kind === 'option' && factor !== undefined ? { factor_label: factor } : {}) };
}

/**
 * The figures a sentence writes: every single figure, in digits or spelled ("six mid-weight developers", by the one cardinal
 * parser). No two figures are paired into a range here: "cut legacy 25% to 15%" or "six developers and 25% legacy" are not
 * ranges, and literal membership cannot tell them apart (AIE 6180604131). Step 2's clause-governed subject/frame check
 * (factorLevelSpans + sameFrame, DL-adopted) decides which figure, or which pair, governs a subject; until then a range is not
 * verified and stays unknown, retained.
 */
export function figuresWritten(quote: string): readonly { readonly low: number; readonly high: number }[] {
  const spelled = [...quote.matchAll(new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})\\b`, 'gi'))].flatMap((m) => {
    const magnitude = parseCardinalAmount(m[0]);
    return magnitude === null ? [] : [{ magnitude, matchedText: m[0], index: m.index! }];
  });
  const amounts = [...findStatedAmounts(quote), ...spelled].sort((a, b) => a.index - b.index);
  return amounts.flatMap((a) => [{ low: a.magnitude, high: a.magnitude },
    ...(a.magnitude > 0 && statesLossBefore(quote, a.index) ? [{ low: -a.magnitude, high: -a.magnitude }] : [])]);
}

/**
 * ⭐ S4 NET LOSS (DL 15 Oct 06:43Z, unseen brief R4): "we're losing a net 15 members a month" states 15 AND, read as a net flow, −15:
 * the same figure with the opposite direction word, where the words state a NET flow. The drafter's −15 was refused as no figure of the quote, so the user's own
 * net loss was admitted as Olumi's unverified, unscaled guess and blocked every Run. A figure written straight after a loss
 * direction is also stated as its negative; with no such words a negative stays refused, as before. Which reading a subject
 * takes (a net change at −15, or a count of losses at 15) is the binder's, never this list's.
 */
// AIE 6187351293 (2a scope): the loss words are literal source support for a NET reading only. "We lose 15 members a month"
// can be a gross count of 15 lost (positive, with a negative effect downstream), so only a net flow states −15.
const LOSS_BEFORE = /\b(?:(?:losing|lose|loses|lost) (?:a )?net|(?:a )?net (?:loss|outflow|decline|drop) of|(?:a )?deficit of)(?: (?:about|around|roughly|nearly|almost|some|over))?\s*$/iu;
export function statesLossBefore(quote: string, index: number): boolean {
  return LOSS_BEFORE.test(quote.slice(0, index));
}

/** The drafter's `statements`, each verified once against the brief. Anything malformed, unverified or unchecked is retained whole as unknown. */
export function sourceMapOf(raw: unknown, brief: string): SourceMap {
  const verified = new Map<string, UserStatement[]>();
  const refused: RefusedStatement[] = [];
  const entries = Array.isArray(raw) ? raw : [];
  entries.forEach((entry: unknown, index) => {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const given = givenOf(r);
    const subject = subjectOf(r['subject']);
    const field = STATEMENT_FIELDS.find((f) => f === r['field']);
    const form = STATEMENT_FORMS.find((f) => f === r['form']);
    const quote = typeof r['quote'] === 'string' && r['quote'].trim() !== '' ? r['quote'] : undefined;
    const kept = (refusal: string, detail: string, key?: string): void => {
      refused.push({ index, refusal, detail, ...(quote !== undefined ? { quote } : {}), ...(key !== undefined ? { key } : {}), given });
    };
    if (index >= MAX) {
      kept('not_checked', `Only the first ${MAX} statements of a draft are checked; this one is retained unchecked, its authorship unknown.`);
      return;
    }
    if (subject === undefined || field === undefined || form === undefined) {
      kept('statement_malformed', 'A statement needs a subject (kind and label), one field and one form.');
      return;
    }
    const key = subjectKey(subject, field);
    const v = verifyStatements([{ quote: r['quote'], form, value: r['value'], low: r['low'], high: r['high'], qualifier: r['qualifier'], conditions: r['conditions'] }],
      { now: brief }, { subject: { quantity: key }, unit: text(r['unit'], 60) ?? '', forms: STATEMENT_FORMS as readonly StatementForm[], figuresIn: figuresWritten });
    if (v.kind === 'refused') { kept(v.refusal, v.detail, key); return; }
    verified.set(key, [...(verified.get(key) ?? []), ...v.statements]);
  });
  return { verified, refused };
}

/**
 * ⭐ S2 C4 (TL 6208664188 rule 1; DL-3 09:05Z DRASTIC CUT): the user's sentences the AI itself bound as the goal's TARGET with
 * `figure` (its `{goal, target}` statements, each verified here as a whole sentence of the brief that writes that figure). A
 * figure found elsewhere in the brief is the user's statement about its own subject, never this goal's target by membership.
 * `undefined` only for a draft recorded before SYSTEM 2 (no `statements`; the sent schema requires them), which keeps its bytes.
 */
export function goalTargetSentences(model: unknown, brief: string, figure: number): readonly string[] | undefined {
  const m = model !== null && typeof model === 'object' ? model as { statements?: unknown; goal?: { metric?: unknown } } : {};
  if (!Array.isArray(m.statements)) return undefined;
  const metric = typeof m.goal?.metric === 'string' ? m.goal.metric : '';
  if (metric.trim() === '' || !Number.isFinite(figure)) return [];
  const states = (n: number | undefined): boolean => typeof n === 'number' && Math.abs(n) === Math.abs(figure);
  const map = sourceMapOf(m.statements, brief);
  const key = subjectKey({ kind: 'goal', label: metric }, 'target');
  // TL 09:18Z (2): a sentence whose figure the AI ALSO read as another subject's or field's ("We have a budget of £40,000." as the
  // budget's level and the goal's target) has a competing reading; it is not the user's target, and the card offers Olumi's.
  const rivalled = (quote: string): boolean => [...map.verified.entries()].some(([other, statements]) => other !== key
    && statements.some((s) => s.quote === quote && (states(s.low) || states(s.high))));
  return (map.verified.get(key) ?? []).filter((s) => s.negated !== true && (states(s.low) || states(s.high)) && !rivalled(s.quote))
    .map((s) => s.quote);
}

/**
 * ⭐ AIE 6183705670 (1), the admission first loss: a draft's verified statements are RECORDED on their subjects at construction,
 * as the statement door records a press (`user_statements`, one record per subject, `withUserStatement`), so the saved model, a
 * cold reopen and the AI's working input hold the user's own sentences, not only the authorship they decided. Each entry is
 * verified on its own, exactly as `sourceMapOf` does, and bound to a graph subject ONLY by the door's resolver (ids, else one
 * exact label; never guessed). An option's setting of a factor is the door's `{factor, option_id}`. An entry whose subject does
 * not resolve, or that is refused, records nothing and stays in the map, unknown (never Olumi's). Pure.
 */
export function withConstructionStatements<G extends { nodes: unknown[] }>(graph: G, raw: unknown, brief: string, recordedAt: string): G {
  const entries = (Array.isArray(raw) ? raw : []).slice(0, MAX);
  const groups = new Map<string, { subject: DoorSubject; statements: UserStatement[] }>();
  for (const entry of entries) {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const drafted = subjectOf(r['subject']);
    const field = STATEMENT_FIELDS.find((f) => f === r['field']);
    if (drafted === undefined || field === undefined) continue;
    const verified = [...sourceMapOf([entry], brief).verified.values()].flat();
    if (verified.length === 0) continue;
    const ref = drafted.kind === 'option' && drafted.factor_label !== undefined
      ? { kind: 'factor', label: drafted.factor_label, option_label: drafted.label, field }
      : { kind: drafted.kind, label: drafted.label, ...(drafted.to_label !== undefined ? { to_label: drafted.to_label } : {}), field };
    const resolved = resolveSubject(graph, ref);
    if (resolved.kind !== 'resolved') continue;
    const key = doorSubjectKey(resolved.subject);
    const group = groups.get(key) ?? { subject: resolved.subject, statements: [] };
    group.statements.push(...verified);
    groups.set(key, group);
  }
  let out = graph as G & Record<string, unknown>;
  for (const { subject, statements } of groups.values()) {
    out = (withUserStatement(out, userStatementRecord(subject, statements, recordedAt, CONSTRUCTION_ATTEST), subject) ?? out) as G & Record<string, unknown>;
  }
  return out;
}

const BOUND_FORM: Readonly<Record<string, StatementForm>> = { '<=': 'upper_bound', '<': 'upper_bound', '>=': 'lower_bound', '>': 'lower_bound' };
/**
 * ⭐ A draft's statements, as every reader takes them (DL 15 Oct, marketing e2e S4): a statement the drafter filed as a POINT level
 * of a subject for which the SAME draft declares a limit (`constraints[]`, role limit) with that exact figure is that limit's
 * bound, never today's level: "Our budget for the year is £100,000." beside the limit `Total annual campaign spend <= 100000`
 * is the level's upper bound. The role comes from the draft's own declared limit (the shared constraint contract: role and
 * operator), never from the sentence's words. Every other entry is returned as given. Pure.
 */
export function draftStatements(model: unknown): unknown {
  const m = model !== null && typeof model === 'object' ? model as Record<string, unknown> : {};
  const raw = m['statements'];
  if (!Array.isArray(raw)) return raw;
  const limits = (Array.isArray(m['constraints']) ? m['constraints'] : []).flatMap((c: unknown) => {
    const r = c !== null && typeof c === 'object' ? c as Record<string, unknown> : {};
    const form = typeof r['operator'] === 'string' ? BOUND_FORM[r['operator']] : undefined;
    return r['role'] === 'limit' && form !== undefined && typeof r['metric'] === 'string' && typeof r['value'] === 'number'
      ? [{ metric: norm(r['metric']), value: r['value'], form }] : [];
  });
  if (limits.length === 0) return raw;
  return raw.map((entry: unknown) => {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined;
    const subject = subjectOf(r?.['subject']);
    if (r === undefined || subject === undefined || r['field'] !== 'level' || r['form'] !== 'point' || subject.factor_label !== undefined) return entry;
    const limit = limits.find((l) => l.metric === norm(subject.label) && l.value === r['value']);
    return limit === undefined ? entry : { ...r, form: limit.form };
  });
}
