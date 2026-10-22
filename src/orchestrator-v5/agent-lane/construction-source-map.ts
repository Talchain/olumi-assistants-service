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
import { findJoinedRanges } from '../../cee/provenance/stated-amounts.js';
import { figuresWritten, STATEMENT_FORMS, unitWrittenAfter, unknownSpeakerWords, verifyStatements, type StatementForm, type UserStatement } from './user-statements.js';
import { resolveSubject, subjectKey as doorSubjectKey, type DoorSubject } from '../statement-door/subject.js';
import { CONSTRUCTION_ATTEST, userStatementRecord, withUserStatement } from '../statement-door/statements.js';
import { authorshipOf } from '../../cee/provenance/provenance-of.js';
import { wholeStatementIn, quoteIsNotTheUsersClaim } from '../goal-target/input-claim-context.js';
import { readUnitParts, sameUnit, statedTailParts } from './same-unit.js';
import { amountsWrittenIn, figureTheUserWroteFor, figureTheUserWroteForSpan, sameWord, timesTheUserWrote, wordsOf } from './stated-by-user.js';
import { goalTargetIdentity } from './construction-size-gate.js';

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
const GIVEN_KEYS = ['quote', 'field', 'form', 'value', 'low', 'high', 'unit', 'qualifier', 'conditions', 'negated', 'speaker'] as const;
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

/** The one figure reader of a span, now the authorship rule's own (`user-statements.ts`); re-exported for its existing readers. */
export { figuresWritten, statesLossBefore } from './user-statements.js';

/** Two negative ends as the magnitudes they stand for (−6 to −4 → 4 to 6); anything else is no such range. */
function writtenEndsOfNegativeRange(low: unknown, high: unknown): { readonly low: number; readonly high: number } | undefined {
  return typeof low === 'number' && typeof high === 'number' && Number.isFinite(low) && Number.isFinite(high) && low < 0 && high < 0
    ? { low: -high, high: -low } : undefined;
}

/**
 * The drafter's `statements`, each verified once against the brief. Anything malformed, unverified or unchecked is retained whole as
 * unknown. A statement the AI marks `negated` keeps that denial (the verifier's own carrier), so it never reads as a supplied effect.
 */
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
    const v = verifyEntry(r, form, key, brief, false);
    if (v.kind === 'refused') { kept(v.refusal, v.detail, key); return; }
    verified.set(key, [...(verified.get(key) ?? []), ...(field === 'effect' && form === 'range' ? v.statements.map(withOwnRangeUnit) : v.statements)]);
  });
  return { verified, refused };
}

/**
 * One drafted statement through the ONE verifier, with the brief as its words. `claims`: the claim door's rule (claim record spec v2
 * rule 6) — the AI's reading of WHO asserts it is kept (`said_by`: a party it names, or unresolved), its figures, unit and bounds
 * checked exactly as the user's own. Without it a verified statement is the user's own, as before.
 */
function verifyEntry(r: Record<string, unknown>, form: StatementForm, key: string, brief: string, claims: boolean): ReturnType<typeof verifyStatements> {
  const speaker = r['speaker'] !== undefined && r['speaker'] !== null ? { speaker: r['speaker'] } : {};
  const source = claims ? Object.fromEntries((['said_by', 'party', 'relayed_by'] as const).filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, r[k]])) : {};
  return verifyStatements([{ quote: r['quote'], form, value: r['value'], low: r['low'], high: r['high'], qualifier: r['qualifier'],
    conditions: r['conditions'], ...(r['negated'] === true ? { negated: true } : {}), ...speaker, ...source }],
  { now: brief }, { subject: { quantity: key }, unit: text(r['unit'], 60) ?? '', forms: STATEMENT_FORMS as readonly StatementForm[], figuresIn: figuresWritten,
    ...(claims ? { claims: true as const } : {}) });
}

/**
 * ⛔ G3 a735 (BUDDY-A #3356 R1–R6; DL-3 fail-safe core, 17:4xZ: ONE unit authority, never convert): an effect range is the user's
 * range in the AI's unit only where that unit EQUALS the complete unit written at the range's own high end, read by the estate's one
 * tail reader (`statedTailParts`), money included: the same kind, currency, noun, period, denominator, base and qualifiers, all
 * present on both sides alike (scale belongs to the number). A noun with other words is another population ("non-paying visitors"
 * are never "paying visitors"; DL-3's exit on BUDDY-A R7). So "4 and 6 kg per week" is never kg nor kg per day, "£4 to £6 a week"
 * never £ a day, "kg per new client" never kg per client, "£4 to £6 each" never a total £ (BUDDY-A R8), "6 crates" never kg, and a
 * unit written anywhere else in the sentence certifies nothing. Otherwise the range is still recorded, whole, with NO unit: never
 * relabelled, never converted.
 */
function withOwnRangeUnit(st: UserStatement): UserStatement {
  if (typeof st.low !== 'number' || typeof st.high !== 'number' || st.unit === undefined || st.unit.trim() === '') return st;
  const joined = findJoinedRanges(st.quote).find((r) => r.low.magnitude === st.low && r.high.magnitude === st.high);
  const written = joined === undefined ? null : statedTailParts(st.quote, joined.high);
  const claimed = readUnitParts(st.unit);
  // Each part as the reader typed it, as `sameUnit` compares it: an unnamed denominator ("£4 to £6 each", []) is never none (null).
  return written !== null && claimed !== null && written.kind === claimed.kind && written.code === claimed.code && written.period === claimed.period
    && (['noun', 'per', 'base', 'qualifiers'] as const).every((part) => JSON.stringify(written[part]) === JSON.stringify(claimed[part]))
    ? st : { ...st, unit: '' };
}

/**
 * ⭐⭐ THE ONE AUTHORSHIP OWNER FOR A DRAFTED FIGURE (TL 11:51Z SYSTEM RULING, S2/O4; G3 #3 b0f78e1d, BUDDY-A #3290 B1).
 * Whose VALUE a drafted figure is, decided once, from the AI's statements as verified against the user's own words
 * (`sourceMapOf`), never from the draft's own flags (`provenance`, `baseline_known`, `explicit`):
 *  · `'user'`: a verified statement states that figure for that subject and field (a point or a bound), and no
 *    other subject's verified statement claims the same figure in the same sentence (C4 rule 2);
 *  · `'unverified'`: the AI made a statement for that subject and field, and none verifies this figure: its origin is
 *    UNKNOWN, never the user's and never Olumi's;
 *  · `'unclaimed'`: the AI made no statement for it (a structural setting, or a figure the AI produced itself);
 *  · `undefined`: a draft recorded before SYSTEM 2 (no `statements`), which keeps its recorded path.
 * Which subject and role the figure has stays the AI's reading.
 */
export type FigureSource = 'user' | 'unverified' | 'unclaimed';
/**
 * Qualitative introduction uses the SAME verified source map, not the drafter's provenance flag.
 * ⭐ ONE BINDER (DL-3 22:53Z + RULING 23:12Z; BUDDY-A #3327 B1 and its 22:59Z AMEND): a reading the host cannot check against the
 * words is OLUMI'S READING of the user's words, never the user's statement of it:
 *  · no statement makes a risk the user's at construction: a figure the quote writes proves the number, not its subject or role,
 *    and a figure-free reading (holds_now, describes, any other form) is Olumi's. Nor does `retained` (words the drafter attached to the
 *    subject outside its statements, a risk's `already_true_evidence`). A whole sentence of the user's there keeps the subject
 *    unverified human material, its words kept in `claimed`; never Olumi's estimate;
 *  · `holdsNowReading` is that reading's whole quote, for the door's card (the card IS the ask; only the press adopts it, as
 *    Olumi's reading). A sentence another subject's verified statement claims gives none (the one cross-subject check).
 */
export function subjectSource(model: unknown, brief: string | undefined, subject: DraftedSubject, retained: readonly string[] = []): {
  readonly author: ReturnType<typeof authorshipOf>;
  readonly statements: readonly { readonly field: StatementField; readonly statement: UserStatement }[];
  readonly claimed: readonly GivenStatement[];
  readonly holdsNowReading?: string;
} {
  const entries = draftStatements(model);
  const kept: GivenStatement[] = retained.map((quote) => ({ quote }));
  const usersWords = (q: string): boolean => typeof brief === 'string' && wholeStatementIn(brief, q) && !quoteIsNotTheUsersClaim(brief, q);
  const listed = Array.isArray(entries) && typeof brief === 'string'
    && !entries.some((e) => e === null || typeof e !== 'object' || Array.isArray(e) || subjectOf((e as Record<string, unknown>).subject) === undefined);
  const map = listed ? sourceMapOf(entries, brief as string) : undefined;
  const ownKeys = new Set(STATEMENT_FIELDS.map(field => subjectKey(subject, field)));
  // The one cross-subject check, as `figureSource`'s (TL 09:18Z AMENDED 10:49Z): a rival is ONLY another subject's verified statement
  // on the same sentence that gives it a FIGURE. One sentence describing several subjects (Support says…; Sales believes…) is no rival.
  const rivalled = (q: string): boolean => map !== undefined && [...map.verified].some(([key, other]) => !ownKeys.has(key)
    && other.some(o => o.quote === q && (o.low !== undefined || o.high !== undefined)));
  const statements = map === undefined ? []
    : STATEMENT_FIELDS.flatMap(field => (map.verified.get(subjectKey(subject, field)) ?? []).map(statement => ({ field, statement })));
  const reading = [...statements.filter(({ statement: st }) => st.form === 'holds_now' && st.negated !== true).map(({ statement: st }) => st.quote),
    ...retained.filter(usersWords)].find((q) => !rivalled(q));
  const out = <T extends object>(r: T) => ({ ...r, ...(reading !== undefined ? { holdsNowReading: reading } : {}) });
  const unverifiedHuman = (claimed: readonly GivenStatement[]) =>
    out({ author: authorshipOf({ nodeTag: 'unverified_brief' }), statements, claimed: [...claimed, ...kept] });
  const keptWords = retained.some(usersWords);
  const unknown = (claimed: readonly GivenStatement[] = []) => (keptWords ? unverifiedHuman(claimed)
    : out({ author: authorshipOf({ words: { verified: false, unknown: true } }), statements: [], claimed: [...claimed, ...kept] }));
  // A list with an entry that names no subject is not a complete source: its claims are unknown, never "nobody claimed it".
  if (map === undefined) return unknown();
  const keyOf = (s: DraftedSubject) => subjectKey(s, 'level');
  const claims = (entries as unknown[]).filter((entry): entry is Record<string, unknown> => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const sub = subjectOf((entry as Record<string, unknown>).subject);
    return sub !== undefined && keyOf(sub) === keyOf(subject);
  });
  const claimed = claims.map(givenOf);
  if (claims.length === 0) {
    return keptWords ? unverifiedHuman(claimed)
      : out({ author: authorshipOf({ words: { verified: false, unknown: false, sourceComplete: true } }), statements: [], claimed: [...claimed, ...kept] });
  }
  // ⭐ GREEN CORE (DL-3 stop rule; BUDDY-A #3327 R2 + R3 B1): for a risk, NO construction statement verifies the user. A figure the
  // quote writes proves the number, not that it is THIS risk's chance (a budget figure read as an occurrence), and a
  // figure-free reading is Olumi's. The user's whole words stay human material, unverified; their chance is recorded only by the
  // door's own occurrence card, on their press.
  // Known human words (or only Olumi's holds-now reading) remain human material, never an Olumi estimate.
  return claims.some(c => typeof c.quote === 'string' && usersWords(c.quote)) || keptWords ? unverifiedHuman(claimed) : unknown(claimed);
}

export function figureSource(model: unknown, brief: string | undefined, subject: DraftedSubject, field: StatementField, value: number): FigureSource | undefined {
  const m = model !== null && typeof model === 'object' ? model as { statements?: unknown } : {};
  if (!Array.isArray(m.statements)) return undefined;
  const key = subjectKey(subject, field);
  const drafted = draftStatements(model);
  const claimed = (Array.isArray(drafted) ? drafted : []).some((e) => {
    const r = e !== null && typeof e === 'object' && !Array.isArray(e) ? e as Record<string, unknown> : {};
    const sub = subjectOf(r['subject']);
    return sub !== undefined && r['field'] === field && subjectKey(sub, field) === key;
  });
  if (!claimed) return 'unclaimed';
  if (typeof brief !== 'string' || !Number.isFinite(value)) return 'unverified';
  // A point holds both ends equal and a bound one end; an end of a stated RANGE is never the user's single figure (AIE range
  // disposition), so a figure the drafter took from one end stays unverified. SIGNED: the verifier owns the sign ("losing a net
  // 15" verifies −15; "we lose 15" does not, #3243), so a figure whose sign differs from the verified one is never theirs.
  const states = (st: UserStatement): boolean => st.negated !== true
    && (typeof st.low === 'number' && typeof st.high === 'number' ? st.low === st.high && st.low === value
      : typeof st.low === 'number' ? st.low === value : typeof st.high === 'number' && st.high === value);
  const map = sourceMapOf(drafted, brief);
  // ⭐ ONE QUANTITY READ TWICE IS NO RIVAL, ONLY AT ONE OWNED OCCURRENCE (PROMPT-INT first-loss trace; Codex pair AMEND; Codex #3439
  // BLOCK + Buddy-A occurrence design). An option's setting and the link FROM the factor it sets are one quantity read twice ("hiring a
  // contractor would add 60 tickets a week") only at ONE occurrence the option provably owns: the one reader binds it to the option's
  // own name (strict, never inside another speaker's words), its clause names no other option, its complete written quantity is the
  // setting's (its unit as written after it, never a range end, no distributive before it: "each temp adds 30" is per temp), and the
  // user writes that figure only there in the sentence, so the carried link can be reading nothing else. Anything else stays a rival
  // (base): swapped figures, another quantity's figure, another period, a range end, a speaker's quotation, a per-unit figure.
  const carried = subject.kind === 'option' && subject.factor_label !== undefined ? `link|${norm(subject.factor_label)}|` : undefined;
  const raw = model as { options?: { label?: unknown }[]; factors?: { label?: unknown }[]; goal?: { metric?: unknown } };
  const optionLabels = (raw.options ?? []).map((o) => o?.label).filter((l): l is string => typeof l === 'string' && l.trim() !== '');
  const labels = [...new Set([...(Array.isArray(drafted) ? drafted : []).flatMap((e) => {
    const sub = subjectOf(e !== null && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>)['subject'] : undefined);
    return sub === undefined ? [] : [sub.label, sub.factor_label, sub.to_label];
  }), ...optionLabels, ...(raw.factors ?? []).map((f) => f?.label), raw.goal?.metric]
    .filter((l): l is string => typeof l === 'string' && l.trim() !== ''))];
  const ownWords = wordsOf(subject.label);
  const ownedOccurrence = (st: UserStatement): boolean => {
    if (carried === undefined) return false;
    const at = figureTheUserWroteForSpan(value, st.unit, st.quote,
      { target: [subject.label], others: labels.filter((l) => l !== subject.label), strict: true })?.start ?? null;
    const amount = at === null ? undefined : amountsWrittenIn(st.quote).find((a) => a.index === at);
    if (at === null || amount === undefined) return false;
    const from = Math.max(...['.', ';', ',', ':', '!', '?', '\n'].map((c) => st.quote.lastIndexOf(c, at - 1))) + 1;
    const stop = st.quote.slice(at).search(/[.;,:!?\n]/);
    const clause = wordsOf(st.quote.slice(from, stop < 0 ? st.quote.length : at + stop));
    const namesAnother = optionLabels.some((l) => l !== subject.label
      && wordsOf(l).some((w) => !ownWords.some((x) => sameWord(x, w)) && clause.some((c) => sameWord(c, w))));
    const written = statedTailParts(st.quote, amount), claimed = readUnitParts(st.unit);
    return !namesAnother && written !== null && claimed !== null && JSON.stringify(written) === JSON.stringify(claimed)
      && !findJoinedRanges(st.quote).some((r) => r.low.index === at || r.high.index === at)
      && !/\b(?:each|every|per)\b/i.test(st.quote.slice(from, at)) && timesTheUserWrote(value, st.unit, st.quote) === 1;
  };
  return (map.verified.get(key) ?? []).some((st) => {
    if (!states(st)) return false;
    const owned = ownedOccurrence(st);
    return [...map.verified.entries()].every(([other, said]) => other === key || !said.some((o) => o.quote === st.quote && states(o)
      && !(owned && other.startsWith(carried!) && sameUnit(o.unit, st.unit))));
  }) ? 'user' : 'unverified';
}

/**
 * ⭐ G3 (TL 10:49Z: ranges are a kept protection; unseen 1663fe34): the range the AI's own VERIFIED statement gives a directed
 * link's effect ("…reckons it would cut scrap by 1.5 to 2.5 percentage points"), when the link's size is one of its ends, so
 * the size is said WITH that range (A4: one end, read as a floor or ceiling), never as a single figure. The host's range
 * reader missed it there (the figure reads as about "scrap", the goal, not the camera). The text is the range as the
 * sentence writes it, else its ends; the A4 sentence quotes it as written and names the end the model uses. `null`: no such
 * statement; `undefined`: a draft without statements.
 * ⛔ BUDDY-A #3356 R1 B1: an end is this link's size only in the unit that size is in. The statement's unit, written straight after
 * the range, must be the target's operative unit (`unit`, read by `sameUnit`): "between 4 and 6 lb a day" never makes −4 kg the
 * user's. Otherwise no end is claimed; the range stays recorded on the link with its own unit (construction's record).
 */
export function linkEffectRangeEnd(model: unknown, brief: string, from: string, to: string, amount: number, unit: string | undefined): StatedRangeOfLink | null | undefined {
  const m = model !== null && typeof model === 'object' ? model as { statements?: unknown } : {};
  if (!Array.isArray(m.statements)) return undefined;
  if (!Number.isFinite(amount) || amount === 0) return null;
  const size = Math.abs(amount);
  const said = sourceMapOf(draftStatements(model), brief).verified.get(subjectKey({ kind: 'link', label: from, to_label: to }, 'effect')) ?? [];
  for (const st of said) {
    if (st.form !== 'range' || st.negated === true || typeof st.low !== 'number' || typeof st.high !== 'number') continue;
    const low = Math.min(Math.abs(st.low), Math.abs(st.high));
    const high = Math.max(Math.abs(st.low), Math.abs(st.high));
    const end = size === low ? 'low' : size === high ? 'high' : null;
    if (end === null || !(low < high)) continue;
    // The verifier's own reader of a unit written after a figure (a whole word: "m" is never "mm", BUDDY-A #3356 R2), at THIS
    // range's own high end (R3: never another figure equal to it, "… 4 and 6 mm … a platform 6 metres high").
    const joined = findJoinedRanges(st.quote).find((r) => r.low.magnitude === low && r.high.magnitude === high);
    if (joined === undefined || typeof st.unit !== 'string' || !unitWrittenAfter(st.quote, high, st.unit, joined.high.index)
      || typeof unit !== 'string' || !sameUnit(st.unit, unit)) continue;
    // ⛔ BUDDY-A #3297 B1: the WHOLE verified quote, never a clause cut at punctuation. A shorter "clause" dropped its speaker
    // and condition ("The supplier estimates that, if the pilot succeeds, …" became only the numbers' clause) and was still
    // said "as the brief puts it"; the AIE disposition keeps the full attributed range with its speaker and conditions.
    return { low, high, text: rangeTextAsWritten(st, low, high), end, reported: st.quote };
  }
  return null;
}

/** The words the sentence writes for the range, with the unit it writes straight after them ("1.5 to 2.5 percentage points"). */
function rangeTextAsWritten(st: UserStatement, low: number, high: number): string {
  const joined = findJoinedRanges(st.quote).find((r) => r.low.magnitude === low && r.high.magnitude === high);
  const after = joined === undefined ? '' : st.quote.slice(joined.high.index + joined.high.matchedText.length);
  const unitAfter = st.unit !== undefined && st.unit !== '' && after.toLowerCase().startsWith(` ${st.unit.toLowerCase()}`)
    ? after.slice(0, st.unit.length + 1) : '';
  return joined === undefined ? `${low} to ${high}${st.unit ? ` ${st.unit}` : ''}` : `${joined.text}${unitAfter}`;
}

/**
 * ⭐ A STATED RANGE SIZES ITS LINK (TL 16:48Z SCIENCE + SYSTEM RULING; G3 #4/#5 class): the range the AI's own VERIFIED
 * statement gives a directed link the drafter left UNSIZED ("…thinks it could add somewhere between 5 and 9 occupancy
 * points"), as a whole (`end: 'whole'`): the link's uncertain effect, never one of its ends or its midpoint as the user's
 * figure. Magnitudes; the link's own direction is the sign. One verified range only (two ranges for one link say nothing
 * single). `null`: none; `undefined`: a draft without statements. Pure.
 */
export function linkEffectStatedRange(model: unknown, brief: string, from: string, to: string): StatedWholeRangeOfLink | null | undefined {
  const m = model !== null && typeof model === 'object' ? model as { statements?: unknown } : {};
  if (!Array.isArray(m.statements)) return undefined;
  const said = (sourceMapOf(draftStatements(model), brief).verified.get(subjectKey({ kind: 'link', label: from, to_label: to }, 'effect')) ?? [])
    .filter((st) => st.form === 'range' && st.negated !== true && typeof st.low === 'number' && typeof st.high === 'number');
  if (said.length !== 1) return null;
  const st = said[0]!;
  const low = Math.min(Math.abs(st.low!), Math.abs(st.high!));
  const high = Math.max(Math.abs(st.low!), Math.abs(st.high!));
  if (!(low < high) || Math.sign(st.low!) !== Math.sign(st.high!)) return null;
  // "between 4 and 7 …" is said as written: the joined reader's text starts at the low figure.
  const text = rangeTextAsWritten(st, low, high);
  const at = st.quote.indexOf(text);
  const between = at >= 0 && /\bbetween\s+$/iu.test(st.quote.slice(0, at)) ? 'between ' : '';
  return { low, high, text: `${between}${text}`, end: 'whole', reported: st.quote };
}
/**
 * ⛔ G3 a735 (PL 13:22Z; BUDDY-A #3356 R1–R5): the user's range for THIS link that is NOT in the edge's operative unit by complete-unit
 * equality (`sameUnit`): a different unit written at the range ("4 to 6 lb" on a kilogram link; "4 and 6 kg per week" on kg per day),
 * or none ("4 and 6 mm … a platform 6 metres high" is never metres). An Olumi size taken from it is a figure in the wrong unit. Ends
 * as magnitudes; the whole quote. `null`: none; `undefined`: a draft without statements.
 */
export function linkEffectRangeInOtherUnit(model: unknown, brief: string, from: string, to: string, unit: string | undefined)
  : { readonly low: number; readonly high: number; readonly quote: string } | null | undefined {
  const m = model !== null && typeof model === 'object' ? model as { statements?: unknown } : {};
  if (!Array.isArray(m.statements)) return undefined;
  // A link with no unit of its own has no other unit to compare with: nothing is set aside on a guess.
  if (typeof unit !== 'string' || unit.trim() === '') return null;
  const key = subjectKey({ kind: 'link', label: from, to_label: to }, 'effect');
  // A verified range carries the unit its own words write (`withOwnRangeUnit`), or none: anything but this link's unit is other.
  for (const st of sourceMapOf(draftStatements(model), brief).verified.get(key) ?? []) {
    if (st.form !== 'range' || st.negated === true || typeof st.low !== 'number' || typeof st.high !== 'number' || sameUnit(st.unit, unit)) continue;
    return { low: Math.min(Math.abs(st.low), Math.abs(st.high)), high: Math.max(Math.abs(st.low), Math.abs(st.high)), quote: st.quote };
  }
  return null;
}
/** A link size's stated range, as `natural_effect.stated_range` holds it (A4), with the whole verified sentence that reports it. */
export type StatedRangeOfLink = { readonly low: number; readonly high: number; readonly text: string; readonly end: 'low' | 'high'; readonly reported: string };
/** The range the user stated for a link nobody sized, as a WHOLE (never one of its ends as the size), as written. */
export type StatedWholeRangeOfLink = { readonly low: number; readonly high: number; readonly text: string; readonly end: 'whole'; readonly reported: string };

/**
 * The user's sentences the AI bound as the goal's TARGET with `figure` (its `{goal, target}` statements, each verified by the one
 * rule), each with the AI's own reading of its sentence (`form`): G3 (TL 10:49Z) holds
 * a ceiling's direction from that reading, never from a host word reader.
 *
 * ⭐ QUANTITY BINDING CONTRACT (PR-A rows 1/2/11; outbox/QUANTITY-BINDING-CONTRACT-20261018.md v2). A figure binds to the goal only
 * with its own SIGN, never by absolute value:
 *  · LEVEL frame: the statement's verified figure, as its words write it (a negative only where they write one), equals `figure`.
 *  · CHANGE frame (`change_rel`/`change_abs`): the AI's statement carries its SIGNED change ("cut … by 20%" as −20). The verifier
 *    checks the literal magnitude its span writes; the bind takes the AI's signed reading, in the goal's own comparator
 *    (`BOUND_FORM`: a floor is a lower bound, a ceiling an upper bound; a point fits either), and it must equal `figure`. "Increase
 *    … by at least 20%" (+20, a floor) is never a −20 ceiling. The figure's occurrence must also be THIS goal's by the one
 *    occurrence reader (`figureTheUserWroteFor` with the model's quantities), as the held target already reads it: "cut the
 *    promotion budget by at least 20%" never gives the 20% to order turnaround.
 * The bind is the one verdict every reader takes: the target's authorship (`threshold_source`), its direction, its unit reading
 * and the goal's own provenance at admission.
 */
export function goalTargetStatements(model: unknown, brief: string, figure: number): readonly UserStatement[] | undefined {
  const m = model !== null && typeof model === 'object'
    ? model as { statements?: unknown; goal?: { metric?: unknown; frame?: unknown; operator?: unknown; unit?: unknown }; factors?: unknown; outcomes?: unknown; risks?: unknown }
    : {};
  if (!Array.isArray(m.statements)) return undefined;
  const metric = typeof m.goal?.metric === 'string' ? m.goal.metric : '';
  if (metric.trim() === '' || !Number.isFinite(figure)) return [];
  const map = sourceMapOf(m.statements, brief);
  const key = subjectKey({ kind: 'goal', label: metric }, 'target');
  // TL 09:18Z (2), AMENDED 10:49Z: a rival is ONLY another of the AI's own verified statements on the same sentence that gives
  // that figure to another subject or field ("We have a budget of £40,000." as the budget's level and the goal's target). No
  // unit comparison, mention count or text scan (BUDDY-A B1 R1/R2 on #3284): the AI's own labels decide, and the card offers
  // Olumi's reading for one click wherever they compete, so the user's figure is never lost and never mis-authored.
  // A rival claims the WRITTEN figure (its literal magnitude), whatever sign either reading gives it.
  const writes = (n: number | undefined): boolean => typeof n === 'number' && Math.abs(n) === Math.abs(figure);
  const rivalled = (quote: string): boolean => [...map.verified.entries()].some(([other, statements]) => other !== key
    && statements.some((s) => s.quote === quote && (writes(s.low) || writes(s.high))));
  const frame = m.goal?.frame;
  if (frame !== 'change_rel' && frame !== 'change_abs') {
    return (map.verified.get(key) ?? []).filter((s) => s.negated !== true && (s.low === figure || s.high === figure) && !rivalled(s.quote));
  }
  const comparator = typeof m.goal?.operator === 'string' ? BOUND_FORM[m.goal.operator] : undefined;
  const unit = m.goal?.unit;
  const labels = (v: unknown): string[] => (Array.isArray(v) ? v : []).flatMap((q: unknown) => {
    const l = q !== null && typeof q === 'object' ? (q as { label?: unknown }).label : undefined;
    return typeof l === 'string' && l.trim() !== '' && norm(l) !== norm(metric) ? [l] : [];
  });
  const scope = { target: [metric], others: [...labels(m.factors), ...labels(m.outcomes), ...labels(m.risks)] };
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const out: UserStatement[] = [];
  for (const entry of m.statements as unknown[]) {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined;
    const subject = subjectOf(r?.['subject']);
    if (r === undefined || subject === undefined || r['field'] !== 'target' || subjectKey(subject, 'target') !== key || r['negated'] === true) continue;
    const form = r['form'];
    // The AI's signed reading of the sentence (a point, one bound's figure, or a range end), and the literal its words must write.
    if (form === 'range') {
      if (num(r['low']) !== figure && num(r['high']) !== figure) continue;
    } else {
      if (num(r['value']) !== figure) continue;
      if (form !== 'point' && (comparator === undefined || form !== comparator)) continue;
    }
    const ends = writtenEndsOfNegativeRange(r['low'], r['high']);
    const literal = form === 'range' ? (ends !== undefined ? { ...r, ...ends } : r) : { ...r, value: Math.abs(figure) };
    const st = (sourceMapOf([r], brief).verified.get(key) ?? sourceMapOf([literal], brief).verified.get(key))?.[0];
    if (st === undefined || rivalled(st.quote)) continue;
    if (!figureTheUserWroteFor(Math.abs(figure), unit, st.quote, scope)) continue;
    out.push(st);
  }
  return out;
}

/**
 * ⭐ QUANTITY BINDING CONTRACT (PR-A rows 3–4; Codex #3412 r1 SIMPLER-ALTERNATIVE): a retry never changes the user's verified target.
 * The FIRST draft's verified target is kept WHOLE, by the existing adoption equality (`goalTargetIdentity`: quantity, comparator,
 * signed figure, unit and frame), and its authorship by the first draft's own statements, which must still bind the retry's goal
 * (`goalTargetStatements`, the one binder). Where a redraft re-chose the goal and the first draft verified a target for that quantity
 * only as a statement, the statement's own terms are kept: its signed figure (the binder), comparator (`BOUND_FORM`) and unit
 * (`sameUnit`); a frame it never stated is not invented. Conditions are kept by `keepsEveryGoalCondition`. `true` where the first
 * draft verified no target for the retry goal's quantity: nothing of the user's is at stake. Pure.
 */
export function keepsTheFirstVerifiedTarget(first: unknown, retry: unknown, brief: string): boolean {
  type Goal = { metric?: unknown; operator?: unknown; value?: unknown; unit?: unknown; frame?: unknown };
  const f = first !== null && typeof first === 'object' ? first as { statements?: unknown; goal?: Goal } : {};
  const r = retry !== null && typeof retry === 'object' ? retry as { goal?: Goal } : {};
  if (!Array.isArray(f.statements)) return true;
  const firstMetric = typeof f.goal?.metric === 'string' ? f.goal.metric : '';
  const metric = typeof r.goal?.metric === 'string' ? r.goal.metric : '';
  const firstOwn = typeof f.goal?.value === 'number' ? goalTargetStatements(first, brief, f.goal.value) ?? [] : [];
  // The first goal's own verified target: its full terms, by the one adoption key.
  if (firstOwn.length > 0 && (r.goal === undefined || goalTargetIdentity({ ...f.goal, metric: firstMetric }) !== goalTargetIdentity({ ...r.goal, metric }))) return false;
  // The first draft's raw target entries on the retry goal's quantity, each taken as the retry goal's: the user's figure as the AI first
  // read it (a goal's own target only where it bound; a re-chosen quantity's target where the one rule verified it).
  const entries = (f.statements as unknown[]).flatMap((entry) => {
    const e = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined;
    const subject = subjectOf(e?.['subject']);
    if (e === undefined || subject === undefined || e['field'] !== 'target' || e['negated'] === true || norm(subject.label) !== norm(metric)) return [];
    const magnitude = typeof e['value'] === 'number' ? { ...e, value: Math.abs(e['value']) } : e;
    if (subject.kind === 'goal' ? firstOwn.length === 0
      : subject.kind !== 'factor' || (sourceMapOf([e], brief).verified.size === 0 && sourceMapOf([magnitude], brief).verified.size === 0)) return [];
    return [{ ...e, subject: { kind: 'goal', label: metric, to_label: null, factor_label: null } }];
  });
  if (entries.length === 0) return true;
  const value = r.goal?.value;
  const comparator = typeof r.goal?.operator === 'string' ? BOUND_FORM[r.goal.operator] : undefined;
  const bound = typeof value === 'number' ? goalTargetStatements({ ...(retry as object), statements: entries }, brief, value) ?? [] : [];
  return bound.length > 0 && bound.every((st) => sameUnit(st.unit, r.goal?.unit) && (st.form === 'point' || st.form === comparator));
}

/**
 * ⭐ AIE 6183705670 (1), the admission first loss: a draft's verified statements are RECORDED on their subjects at construction,
 * as the statement door records a press (`user_statements`, one record per subject, `withUserStatement`), so the saved model, a
 * cold reopen and the AI's working input hold the user's own sentences, not only the authorship they decided. Each entry is
 * verified on its own, exactly as `sourceMapOf` does, and bound to a graph subject ONLY by the door's resolver (ids, else one
 * exact label; never guessed). An option's setting of a factor is the door's `{factor, option_id}`. An entry whose subject does
 * not resolve, or that is refused, records nothing and stays in the map, unknown (never Olumi's), except words the brief writes
 * verbatim that are refused only as not whole: those are recorded with speaker unknown (`unknownSpeakerWords`). Pure.
 */
export function withConstructionStatements<G extends { nodes: unknown[] }>(graph: G, raw: unknown, brief: string, recordedAt: string): G {
  const entries = (Array.isArray(raw) ? raw : []).slice(0, MAX);
  const groups = new Map<string, { subject: DoorSubject; statements: UserStatement[] }>();
  for (const entry of entries) {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const drafted = subjectOf(r['subject']);
    const field = STATEMENT_FIELDS.find((f) => f === r['field']);
    if (drafted === undefined || field === undefined) continue;
    if (drafted.kind === 'risk') {
      // The user's words are recorded on a risk they are human material for. A holds-now reading is Olumi's, carried only by its card
      // (`already_true_quote`), and a risk's chance only by the door's occurrence card: never a construction record of either.
      if (field === 'holds_now' || field === 'occurrence') continue;
      const source = subjectSource({ statements: entries }, brief, drafted);
      if (source.author.origin !== 'human') continue;
    }
    const map = sourceMapOf([entry], brief);
    // ⭐ CLAIM RECORD (plan converged step 2; DL-3 lease 18 Oct): a claim the AI reads as ANOTHER speaker's, or cannot place, keeps
    // its owner and its bounds at construction — that party's range, unit and figures, checked exactly as the user's own, never the
    // user's and never flattened to words. Only where that reading does not verify do the words fall back to speaker unknown.
    const form = STATEMENT_FORMS.find((f) => f === r['form']);
    const reported = map.refused[0]?.refusal === 'statement_not_found' && form !== undefined
      && (r['speaker'] === 'other' || r['speaker'] === 'unknown' || r['said_by'] === 'party' || r['said_by'] === 'unknown')
      ? verifyEntry(r, form, subjectKey(drafted, field), brief, true) : undefined;
    // ⛔ A LABEL IS FOR A CARD (gate → label, 63f15228): the claim door now labels words or a figure it cannot find instead of refusing
    // them, for a card the user sees and approves. Construction shows no card, so such a reading falls back exactly as a refusal did:
    // a party's figure their words do not write is never recorded as theirs.
    const claimed = reported?.kind === 'verified' && reported.statements.every((st) => st.checks === undefined
      || (st.checks.words_found && st.checks.figure_found && st.checks.unit_found))
      ? reported.statements.map((st) => (field === 'effect' && form === 'range' ? withOwnRangeUnit(st) : st)) : undefined;
    // ⛔ DL-3 16:14Z (#3363 R3; first loss P07/P09): words the brief writes verbatim, refused ONLY as not a whole statement there, are
    // kept with speaker unknown instead of dropped. Every other refusal still records nothing.
    const unknown = claimed === undefined && map.refused[0]?.refusal === 'statement_not_found'
      ? unknownSpeakerWords(r['quote'], brief, { quantity: subjectKey(drafted, field) }) : undefined;
    const said = claimed ?? (unknown !== undefined ? [unknown] : [...map.verified.values()].flat());
    if (said.length === 0) continue;
    const ref = drafted.kind === 'option' && drafted.factor_label !== undefined
      ? { kind: 'factor', label: drafted.factor_label, option_label: drafted.label, field }
      : { kind: drafted.kind, label: drafted.label, ...(drafted.to_label !== undefined ? { to_label: drafted.to_label } : {}), field };
    const resolved = resolveSubject(graph, ref);
    if (resolved.kind !== 'resolved') continue;
    const key = doorSubjectKey(resolved.subject);
    const group = groups.get(key) ?? { subject: resolved.subject, statements: [] };
    group.statements.push(...said);
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
 * operator), never from the sentence's words.
 * ⭐ G3 a735 (DL-3 GO 17 Oct; CONTRACT A): a LINK's effect range written with two negative ends, on a link the SAME draft draws
 * `negative`, is the magnitudes its words write (−6 to −4 → 4 to 6): the link's direction carries the sign, as every range reader
 * reads it (`linkEffectRangeEnd`, `linkEffectStatedRange`). Served: the AI wrote "would cut leakage by between 3 and 5" as −5 to −3,
 * the verifier (ends as written, positive) refused it whole, and the user's range reached no record and no reader. A range signed
 * against its own link's direction, on no drawn link, or across zero is returned as given (and refused, as before).
 * Every other entry is returned as given. Pure.
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
  const drawnNegative = new Set((Array.isArray(m['links']) ? m['links'] : []).flatMap((l: unknown) => {
    const r = l !== null && typeof l === 'object' ? l as Record<string, unknown> : {};
    return r['direction'] === 'negative' && typeof r['from'] === 'string' && typeof r['to'] === 'string' ? [`${norm(r['from'])}|${norm(r['to'])}`] : [];
  }));
  if (limits.length === 0 && drawnNegative.size === 0) return raw;
  return raw.map((entry: unknown) => {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined;
    const subject = subjectOf(r?.['subject']);
    if (r !== undefined && subject?.kind === 'link' && subject.to_label !== undefined && r['field'] === 'effect' && r['form'] === 'range'
      && drawnNegative.has(`${norm(subject.label)}|${norm(subject.to_label)}`)) {
      const ends = writtenEndsOfNegativeRange(r['low'], r['high']);
      return ends === undefined ? entry : { ...r, ...ends };
    }
    if (r === undefined || subject === undefined || r['field'] !== 'level' || r['form'] !== 'point' || subject.factor_label !== undefined) return entry;
    const limit = limits.find((l) => l.metric === norm(subject.label) && l.value === r['value']);
    return limit === undefined ? entry : { ...r, form: limit.form };
  });
}
