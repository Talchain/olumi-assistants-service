/** Pure declaration validation and dual-carrier preparation. Never writes or grants consent. */
import { isDeepStrictEqual } from 'node:util';

export const UNMODELLED_MECHANISMS_MAX = 5;
export const UNMODELLED_MECHANISM_MAX_CHARS = 80;
type Dict = Record<string, unknown>;
const record = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);
export type MechanismDeclaration =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly mechanisms: readonly string[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Presence is checked by the caller: an explicitly present undefined is invalid, never a clear. */
export function parseUnmodelledMechanisms(raw: unknown, present: boolean): MechanismDeclaration {
  if (!present) return { kind: 'absent' };
  if (!Array.isArray(raw)) return { kind: 'invalid', reason: 'mechanisms_not_array' };
  if (raw.length > UNMODELLED_MECHANISMS_MAX) return { kind: 'invalid', reason: 'too_many_mechanisms' };
  const mechanisms: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length > UNMODELLED_MECHANISM_MAX_CHARS) {
      return { kind: 'invalid', reason: 'invalid_mechanism' };
    }
    const noun = entry.replace(/\s+/g, ' ').trim();
    if (noun === '') return { kind: 'invalid', reason: 'blank_mechanism' };
    const key = noun.toLowerCase();
    if (!seen.has(key)) { seen.add(key); mechanisms.push(noun); }
  }
  return { kind: 'valid', mechanisms }; // Only a literally valid [] reaches a clear.
}

export interface ApprovedOptionGap { readonly optionId: string; readonly mechanisms: readonly string[]; readonly operands?: Dict }
export function parseOptionGapDeclarations(raw: unknown, present: boolean):
  | { readonly kind: 'valid'; readonly declarations: readonly ApprovedOptionGap[] }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!present) return { kind: 'valid', declarations: [] };
  if (!Array.isArray(raw)) return { kind: 'invalid', reason: 'option_gaps_not_array' };
  const declarations: ApprovedOptionGap[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!record(entry) || typeof entry.optionId !== 'string' || entry.optionId === '' || seen.has(entry.optionId)) {
      return { kind: 'invalid', reason: 'invalid_option_gap_target' };
    }
    const parsed = parseUnmodelledMechanisms(entry.mechanisms, Object.hasOwn(entry, 'mechanisms'));
    if (parsed.kind !== 'valid') return { kind: 'invalid', reason: parsed.kind === 'invalid' ? parsed.reason : 'missing_mechanisms' };
    if (Object.hasOwn(entry, 'operands') && !record(entry.operands)) return { kind: 'invalid', reason: 'invalid_gap_operands' };
    seen.add(entry.optionId);
    declarations.push({ optionId: entry.optionId, mechanisms: parsed.mechanisms,
      ...(Object.hasOwn(entry, 'operands') ? { operands: structuredClone(entry.operands) as Dict } : {}) });
  }
  return { kind: 'valid', declarations };
}


/** Re-read approved operation bytes strictly; contradictory duplicate declarations never use first-wins. */
export function parseOptionGapsOfLevelOps(ops: readonly { readonly op: string; readonly path: string; readonly value?: unknown }[]):
  | { readonly kind: 'valid'; readonly declarations: readonly ApprovedOptionGap[] }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const byId = new Map<string, ApprovedOptionGap>();
  for (const op of ops) {
    if (op.op !== 'set_option_intervention') continue;
    const value = record(op.value) ? op.value : {};
    const parsed = parseUnmodelledMechanisms(value.unmodelled_mechanisms, Object.hasOwn(value, 'unmodelled_mechanisms'));
    if (parsed.kind === 'absent') continue;
    if (parsed.kind === 'invalid') return parsed;
    const pair = op.path.split('::');
    if (pair.length !== 2 || pair.some(id => id === '')) return { kind: 'invalid', reason: 'invalid_option_gap_target' };
    const optionId = pair[0]!;
    const prior = byId.get(optionId);
    if (prior !== undefined && !isDeepStrictEqual(prior.mechanisms, parsed.mechanisms)) {
      return { kind: 'invalid', reason: 'conflicting_option_gap_declarations' };
    }
    byId.set(optionId, { optionId, mechanisms: parsed.mechanisms });
  }
  return { kind: 'valid', declarations: [...byId.values()] };
}

export function optionGapFields(label: string, mechanisms: readonly string[]): Dict {
  return mechanisms.length === 0 ? {} : {
    unresolved_targets: [...mechanisms],
    user_questions: mechanisms.map(m => `"${label}" does not yet model ${m}. What does ${m} change, and by how much?`),
  };
}
export function optionGapCardWords(label: string, mechanisms: readonly string[]): string {
  return mechanisms.length === 0
    ? `${label}: clear its listed unresolved model gaps`
    : `${label}: record unresolved model gaps: ${mechanisms.join('; ')}`;
}
/** Readers trim carrier ids. A writer must reject aliases, not choose one of them. */
function optionCarrierCohort(graph: unknown, optionId: string): { node: Dict; mirrors: Dict[] } | null {
  if (optionId === '' || optionId !== optionId.trim() || !record(graph)
    || !Array.isArray(graph.nodes) || !graph.nodes.every(record)) return null;
  if (Object.hasOwn(graph, 'options') && (!Array.isArray(graph.options) || !graph.options.every(record))) return null;
  const matches = (row: Dict): boolean => typeof row.id === 'string' && row.id.trim() === optionId;
  const nodes = (graph.nodes as Dict[]).filter(matches);
  const mirrors = Array.isArray(graph.options) ? (graph.options as Dict[]).filter(matches) : [];
  if (nodes.length !== 1 || nodes[0]!.kind !== 'option' || mirrors.length > 1
    || [...nodes, ...mirrors].some(row => row.id !== optionId)) return null;
  return { node: nodes[0]!, mirrors };
}
/** Exact pre-approval operands from the canonical read, including mirror-only fields.
 * This is a projection of that read, never a separate store or permission authority. */
export function optionGapOperands(graph: unknown, optionId: string): Dict | null {
  const cohort = optionCarrierCohort(graph, optionId);
  if (cohort === null || !record(graph)) return null;
  const { node, mirrors } = cohort;
  const fields = (row: Dict): Dict => Object.fromEntries(['unresolved_targets', 'user_questions']
    .filter(key => Object.hasOwn(row, key)).map(key => [key, structuredClone(row[key])]));
  return { node: { label: node.label, ...fields(node) },
    ...(Object.hasOwn(graph, 'options') ? { options: mirrors.map(fields) } : {}) };
}

/** Full named consent statement; empty, absent and shadowed operands remain distinct. */
export function optionGapApprovalWords(label: string, mechanisms: readonly string[], operands: Dict): string {
  const node = operands.node as Dict;
  const mirrors = operands.options as Dict[] | undefined;
  const describe = (row: Dict): string => ['unresolved_targets', 'user_questions']
    .filter(key => Object.hasOwn(row, key)).map(key => `${key === 'unresolved_targets' ? 'gaps' : 'questions'} ${JSON.stringify(row[key])}`).join(', ') || 'no listed gaps or questions';
  return `${optionGapCardWords(label, mechanisms)}. Current statement: ${describe(node)}`
    + (mirrors?.length ? `; matching option statement: ${describe(mirrors[0]!)}` : '') + '.';
}

function replaceFields(row: Dict, fields: Dict): Dict {
  const { unresolved_targets: _targets, user_questions: _questions, ...rest } = row;
  return { ...rest, ...fields }; // Status, raw values and every other member stay untouched.
}

/** The entire approved list is validated before a clone. No top-level options array is invented. */
export function applyOptionGapDeclarations(graph: unknown, declarations: readonly ApprovedOptionGap[]):
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'prepared'; readonly graph: unknown; readonly changed: boolean } {
  if (!record(graph) || !Array.isArray(graph.nodes) || !graph.nodes.every(record)) return { kind: 'refused', reason: 'gap_graph_unavailable' };
  if (Object.hasOwn(graph, 'options') && (!Array.isArray(graph.options) || !graph.options.every(record))) return { kind: 'refused', reason: 'invalid_option_mirror' };
  const validated = parseOptionGapDeclarations(declarations, true);
  if (validated.kind === 'invalid') return { kind: 'refused', reason: validated.reason };
  for (const d of validated.declarations) {
    if (optionCarrierCohort(graph, d.optionId) === null) {
      return { kind: 'refused', reason: 'ambiguous_option_gap_target' };
    }
  }
  const next = structuredClone(graph);
  for (const d of validated.declarations) {
    const { node, mirrors } = optionCarrierCohort(next, d.optionId)!;
    const label = typeof node.label === 'string' ? node.label : d.optionId;
    const fields = optionGapFields(label, d.mechanisms);
    for (const row of [node, ...mirrors]) {
      const replacement = replaceFields(row, fields);
      delete row.unresolved_targets; delete row.user_questions;
      Object.assign(row, replacement);
    }
  }
  return { kind: 'prepared', graph: next, changed: !isDeepStrictEqual(next, graph) };
}

/** No acceptance by node alone: both fields on every matching carrier must match the approved postimage. */
export function optionGapsHeld(graph: unknown, declarations: readonly ApprovedOptionGap[]): boolean {
  if (!record(graph) || !Array.isArray(graph.nodes)) return false;
  if (Object.hasOwn(graph, 'options') && !Array.isArray(graph.options)) return false;
  return declarations.every(d => {
    const cohort = optionCarrierCohort(graph, d.optionId);
    if (cohort === null) return false;
    const { node, mirrors } = cohort;
    const expected = optionGapFields(typeof node.label === 'string' ? node.label : d.optionId, d.mechanisms);
    return [node, ...mirrors].every(row => ['unresolved_targets', 'user_questions'].every(key =>
      Object.hasOwn(row, key) === Object.hasOwn(expected, key) && isDeepStrictEqual(row[key], expected[key])));
  });
}

/** Restoring just the approved gap fields must recover the entire pre-state. */
export function optionGapPostimageIsScoped(before: unknown, after: unknown, declarations: readonly ApprovedOptionGap[]): boolean {
  if (!record(before) || !record(after) || !Array.isArray(before.nodes) || !Array.isArray(after.nodes)) return false;
  const restored = structuredClone(after);
  for (const d of declarations) {
    const prior = optionCarrierCohort(before, d.optionId);
    const current = optionCarrierCohort(restored, d.optionId);
    if (prior === null || current === null || prior.mirrors.length !== current.mirrors.length) return false;
    const was = [prior.node, ...prior.mirrors];
    const now = [current.node, ...current.mirrors];
    for (let i = 0; i < was.length; i += 1) {
      for (const key of ['unresolved_targets', 'user_questions']) {
        if (Object.hasOwn(was[i]!, key)) now[i]![key] = structuredClone(was[i]![key]);
        else delete now[i]![key];
      }
    }
  }
  return isDeepStrictEqual(restored, before);
}
