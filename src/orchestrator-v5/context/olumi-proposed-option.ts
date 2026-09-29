/**
 * ⭐ THE ONE PREDICATE: is this option Olumi's proposal, held out of the ordinary comparison until the user adopts it?
 * (DL #72 5887534233; MG 5887738387: construction writes `proposed_by: 'olumi'` on the option node, never `'user'`, so
 * this is a presence test and a graph with no proposed option is byte-identical.) Runtime's post-gate Run filter and the
 * adopt writer read THIS function, never the field directly; the analysis hash sees the field through the published
 * vocabulary (schemas 0.64.0). Runtime owns its body. A leaf module: it imports nothing.
 */
export const OLUMI_PROPOSED_BY = 'olumi' as const;

export function isOlumiProposedOption(option: unknown): boolean {
  return option !== null && typeof option === 'object' && !Array.isArray(option)
    && (option as { proposed_by?: unknown }).proposed_by === OLUMI_PROPOSED_BY;
}
