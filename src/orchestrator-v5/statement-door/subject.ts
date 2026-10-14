/**
 * ⭐ SYSTEM 1: ONE STATEMENT DOOR (DL systems re-plan 14 Oct, design approved 22:49Z). Every user statement the model records is
 * about ONE subject: a graph identity (goal, factor, option, risk or link) plus ONE field from a closed set shared with SYSTEM 2's
 * construction map (agreed with PROMPT 14 Oct). Range, bound and likely end are FORMS of a statement (`StatementForm`; a likely end
 * is a bound with its qualifier), never fields. An option's setting of a node is `level` on {option_id, node}. A subject is resolved
 * by graph identity only (ids); a label is looked up exactly once, by `resolveSubject`, and never guessed. Pure.
 */
export const STATEMENT_FIELDS = ['level', 'target', 'holds_now', 'occurrence', 'lead', 'effect', 'measure', 'relation'] as const;
export type StatementField = (typeof STATEMENT_FIELDS)[number];
export const SUBJECT_KINDS = ['goal', 'factor', 'option', 'risk', 'link'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** The ONE subject a statement is about. `to_id` names a link's target; `option_id` the option that sets `id` (its `level` there, or its `effect`). */
export interface DoorSubject {
  readonly kind: SubjectKind;
  readonly id: string;
  readonly to_id?: string;
  readonly option_id?: string;
  readonly field: StatementField;
}

/** A subject as the Agent or the drafter names it: ids where known, else exact labels. */
export interface SubjectRef {
  readonly kind?: unknown;
  readonly id?: unknown;
  readonly label?: unknown;
  readonly to_id?: unknown;
  readonly to_label?: unknown;
  readonly option_id?: unknown;
  readonly option_label?: unknown;
  readonly field?: unknown;
}

export type SubjectResolution =
  | { readonly kind: 'resolved'; readonly subject: DoorSubject; readonly label: string }
  | { readonly kind: 'unresolved'; readonly reason: 'unknown_field' | 'unknown_kind' | 'not_found' | 'ambiguous' };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const NODE_KIND: Readonly<Record<Exclude<SubjectKind, 'link'>, readonly string[]>> = { goal: ['goal'], factor: ['factor'], option: ['option'], risk: ['risk'] };

/** One key per subject, for maps and the readiness ask that names it. */
export const subjectKey = (s: DoorSubject): string => [s.kind, s.id, s.to_id ?? '', s.option_id ?? '', s.field].join('|');
export const isStatementField = (v: unknown): v is StatementField => typeof v === 'string' && (STATEMENT_FIELDS as readonly string[]).includes(v);

/** The subject by graph identity: an id that exists with that kind, else ONE node whose label is exactly the given one. */
export function resolveSubject(graph: unknown, ref: SubjectRef): SubjectResolution {
  if (!isStatementField(ref.field)) return { kind: 'unresolved', reason: 'unknown_field' };
  if (typeof ref.kind !== 'string' || !(SUBJECT_KINDS as readonly string[]).includes(ref.kind)) return { kind: 'unresolved', reason: 'unknown_kind' };
  const kind = ref.kind as SubjectKind;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const nodeOf = (id: unknown, label: unknown, kinds?: readonly string[]): Rec | 'ambiguous' | undefined => {
    const of = (n: Rec): boolean => kinds === undefined || kinds.includes(String(n.kind));
    const byId = str(id) === undefined ? undefined : nodes.filter((n) => n.id === str(id) && of(n));
    if (byId !== undefined) return byId.length === 1 ? byId[0] : undefined;
    const byLabel = str(label) === undefined ? [] : nodes.filter((n) => typeof n.label === 'string' && n.label.trim() === str(label) && of(n));
    return byLabel.length > 1 ? 'ambiguous' : byLabel[0];
  };
  const option = ref.option_id !== undefined || ref.option_label !== undefined ? nodeOf(ref.option_id, ref.option_label, ['option']) : undefined;
  if (option === 'ambiguous') return { kind: 'unresolved', reason: 'ambiguous' };
  if ((ref.option_id !== undefined || ref.option_label !== undefined) && option === undefined) return { kind: 'unresolved', reason: 'not_found' };
  const withOption = option === undefined ? {} : { option_id: String(option.id) };
  if (kind === 'link') {
    const from = nodeOf(ref.id, ref.label), to = nodeOf(ref.to_id, ref.to_label);
    if (from === 'ambiguous' || to === 'ambiguous') return { kind: 'unresolved', reason: 'ambiguous' };
    if (from === undefined || to === undefined || !edges.some((e) => e.from === from.id && e.to === to.id)) return { kind: 'unresolved', reason: 'not_found' };
    return { kind: 'resolved', label: `${String(from.label)} → ${String(to.label)}`,
      subject: { kind, id: String(from.id), to_id: String(to.id), ...withOption, field: ref.field } };
  }
  const node = nodeOf(ref.id, ref.label, NODE_KIND[kind]);
  if (node === 'ambiguous') return { kind: 'unresolved', reason: 'ambiguous' };
  if (node === undefined) return { kind: 'unresolved', reason: 'not_found' };
  return { kind: 'resolved', label: String(node.label), subject: { kind, id: String(node.id), ...withOption, field: ref.field } };
}
