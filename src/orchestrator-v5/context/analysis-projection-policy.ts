import { ANALYSIS_PROJECTION_VERSION, RUN_ANALYSIS_PROJECTION_KEY } from './graph-identity.js';

export { RUN_ANALYSIS_PROJECTION_KEY } from './graph-identity.js';

export function stampRunAnalysisProjection(enrichment: Record<string, unknown>): Record<string, unknown> {
  return { ...enrichment, [RUN_ANALYSIS_PROJECTION_KEY]: ANALYSIS_PROJECTION_VERSION };
}

/**
 * ⭐ STEP 8 (Codex R2 #3443 P1; AIE 764e9c72 / cc9fbadf: "keep the raw saved Run"): the engine's evaluated result exactly as it
 * stood before the recorded-support projection withheld the claims that rest on an unsupported spread, kept whole in the
 * saved Run. INTERNAL: never transported (the transport keep-list does not name it) and never read by the AI projection; the
 * public enrichment beside it is the projection every surface reads.
 */
export const RUN_EVALUATED_BEFORE_SUPPORT_KEY = '__cee_evaluated_before_support';

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
