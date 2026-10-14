/**
 * ⭐ SYSTEM 2: ONE CONSTRUCTION SOURCE MAP (DL re-plan 14 Oct ~23:0xZ; Paul: "chasing symptoms and making patches"). The drafter
 * emits `statements[]`: for every quantity, condition, timing, measure or current state the brief states, the complete verbatim
 * sentence, the drafted item it is about and the field it states. The host verifies each ONCE against the brief with the one
 * statement verifier (`verifyStatements`), one statement at a time, so a bad quote drops only itself. Admission, the compiler and
 * readiness then read this map instead of one carrier and one matcher per field (`baseline_evidence`, `stated_evidence`,
 * `already_true_evidence`, `effects_at_period_end`, `deadline_words`, the capacity-chain prose), each retired in its own step.
 *
 * A statement the host cannot verify never makes a value the user's: it stays Olumi's reading. Figures come only from the
 * quote's own words (`figuresIn`), never from the drafter's value. Pure.
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { CARDINAL_AMOUNT_SOURCE, parseCardinalAmount } from '../../utils/cardinal-words.js';
import { STATEMENT_FORMS, verifyStatements, type StatementForm, type UserStatement } from './user-statements.js';

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

export interface SourceMap {
  /** Verified statements by subject key (`subjectKey`), in brief order. */
  readonly verified: ReadonlyMap<string, readonly UserStatement[]>;
  readonly refused: readonly { readonly index: number; readonly refusal: string; readonly detail: string }[];
}

const MAX = 60;
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
 * The figures a sentence writes, each as its two ends: every single figure, in digits or spelled ("six mid-weight developers", by
 * the one cardinal parser), and each pair written next to each other low → high ("6-10", "six to ten").
 */
export function figuresWritten(quote: string): readonly { readonly low: number; readonly high: number }[] {
  const spelled = [...quote.matchAll(new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})\\b`, 'gi'))].flatMap((m) => {
    const magnitude = parseCardinalAmount(m[0]);
    return magnitude === null ? [] : [{ magnitude, matchedText: m[0], index: m.index! }];
  });
  const amounts = [...findStatedAmounts(quote), ...spelled].sort((a, b) => a.index - b.index);
  const singles = amounts.map((a) => ({ low: a.magnitude, high: a.magnitude }));
  const pairs = amounts.slice(1).flatMap((b, i) => {
    const a = amounts[i]!;
    const between = quote.slice(a.index + a.matchedText.length, b.index);
    return a.magnitude < b.magnitude && /^\s*(?:-|–|—|to|and)\s*$/i.test(between) ? [{ low: a.magnitude, high: b.magnitude }] : [];
  });
  return [...singles, ...pairs];
}

/** The drafter's `statements`, each verified once against the brief. Anything malformed or unverified is refused, never kept. */
export function sourceMapOf(raw: unknown, brief: string): SourceMap {
  const verified = new Map<string, UserStatement[]>();
  const refused: { index: number; refusal: string; detail: string }[] = [];
  const entries = Array.isArray(raw) ? raw.slice(0, MAX) : [];
  entries.forEach((entry: unknown, index) => {
    const r = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const subject = subjectOf(r['subject']);
    const field = STATEMENT_FIELDS.find((f) => f === r['field']);
    const form = STATEMENT_FORMS.find((f) => f === r['form']);
    if (subject === undefined || field === undefined || form === undefined) {
      refused.push({ index, refusal: 'statement_malformed', detail: 'A statement needs a subject (kind and label), one field and one form.' });
      return;
    }
    const key = subjectKey(subject, field);
    const v = verifyStatements([{ quote: r['quote'], form, value: r['value'], low: r['low'], high: r['high'], qualifier: r['qualifier'], conditions: r['conditions'] }],
      { now: brief }, { subject: { quantity: key }, unit: text(r['unit'], 60) ?? '', forms: STATEMENT_FORMS as readonly StatementForm[], figuresIn: figuresWritten });
    if (v.kind === 'refused') { refused.push({ index, refusal: v.refusal, detail: v.detail }); return; }
    verified.set(key, [...(verified.get(key) ?? []), ...v.statements]);
  });
  return { verified, refused };
}
