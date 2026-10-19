import { ANALYSIS_PROJECTION_VERSION, RUN_ANALYSIS_PROJECTION_KEY } from './graph-identity.js';

export { RUN_ANALYSIS_PROJECTION_KEY } from './graph-identity.js';

/**
 * ⭐ STEP 8 (Codex R1 #3452 BLOCK 2; PL 12:38 19 Oct: "capture the validated original response ONCE, before EVERY policy projection"):
 * the engine's validated response, kept whole in the saved Run whenever a projection withheld something it evaluated, so a later
 * display (Paul's show-and-label rule) projects from the one evaluated authority. INTERNAL: never transported (the transport
 * keep-list does not name it) and never read by the AI projection; the public enrichment beside it is the projection.
 */
export const RUN_EVALUATED_RESPONSE_KEY = '__cee_evaluated_response';

/** Whether `projected` no longer holds a number the engine `evaluated` for an option, or a pooled conditional row: a withhold. */
export function projectionWithheldEvaluated(evaluated: unknown, projected: unknown): boolean {
  const rec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const rows = (r: unknown, key: string): Record<string, unknown>[] => (rec(r) && Array.isArray(r[key]) ? (r[key] as unknown[]).filter(rec) : []);
  const lost = (a: unknown, b: unknown): boolean => (typeof a === 'number' ? typeof b !== 'number'
    : rec(a) ? Object.entries(a).some(([k, v]) => lost(v, rec(b) ? b[k] : undefined)) : false);
  const after = new Map(rows(projected, 'option_comparison').map((r) => [r.option_id, r]));
  return rows(evaluated, 'option_comparison').some((r) => lost(r, after.get(r.option_id)))
    || rows(evaluated, 'conditional_probabilities').length > rows(projected, 'conditional_probabilities').length;
}

export function stampRunAnalysisProjection(enrichment: Record<string, unknown>): Record<string, unknown> {
  return { ...enrichment, [RUN_ANALYSIS_PROJECTION_KEY]: ANALYSIS_PROJECTION_VERSION };
}

function optionCarriers(graph: unknown): Record<string, unknown>[] {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return [];
  const raw = graph as Record<string, unknown>;
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  return [
    ...(Array.isArray(raw.nodes) ? raw.nodes.filter(record).filter(node => node.kind === 'option') : []),
    ...(Array.isArray(raw.options) ? raw.options.filter(record) : []),
  ];
}

/** Nonempty or malformed target carriers need a stamp, even on a shadowed
 * mirror or a held baseline; an empty array carries no unresolved effect. */
export function runAnalysisProjectionNeedsStamp(graph: unknown): boolean {
  return optionCarriers(graph).some(option =>
    ['unresolved_targets', 'user_questions'].some(key =>
      Object.prototype.hasOwnProperty.call(option, key)
      && (!Array.isArray(option[key]) || option[key].some(value => typeof value !== 'string')
        || (key === 'unresolved_targets' && option[key].length > 0))));
}
