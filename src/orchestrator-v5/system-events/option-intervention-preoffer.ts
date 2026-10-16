import { prepareOptionInterventionBatchExecution } from './option-intervention-edit.js';

type Preparation = Awaited<ReturnType<typeof prepareOptionInterventionBatchExecution>>;

export type OptionInterventionPreoffer =
  | { readonly offer: true; readonly prepared: Extract<Preparation, { kind: 'candidate' }> }
  | { readonly offer: false; readonly refusal: Exclude<Preparation, { kind: 'candidate' }>; readonly detail: string };

const REFUSAL_DETAIL: Readonly<Record<string, string>> = {
  value_scope_mismatch: 'The proposed value does not preserve the saved quantity, unit or author. '
    + 'Give the value in the unit the saved option or factor already holds, as get_canonical_state shows it; never relabel what is counted.',
  level_frame_mismatch: 'The proposed level does not match its amount and range. Read the saved factor and propose the level in its own units.',
  option_gap_without_level_anchor: 'An option gap has no level in this proposal. Include that option’s level and its gaps together before offering it.',
  links_mismatch: 'The proposed links do not match the complete change. Read the saved model and propose the levels with exactly their declared links.',
  stale_graph: 'The model has changed. Read its current state and propose the complete change again.',
};

/**
 * An offer is the native door's complete in-memory candidate, never a value-only preview.
 * This performs no write or approval; the native door prepares again against its current saved base on approval.
 */
export async function preOfferOptionInterventions(
  ...args: Parameters<typeof prepareOptionInterventionBatchExecution>
): Promise<OptionInterventionPreoffer> {
  const prepared = await prepareOptionInterventionBatchExecution(...args);
  if (prepared.kind === 'candidate') return { offer: true, prepared };
  return {
    offer: false,
    refusal: prepared,
    detail: prepared.kind === 'unchanged'
      ? 'The saved model already holds this change; no approval card is needed.'
      : REFUSAL_DETAIL[prepared.reason]
        ?? 'This change could not be prepared against the saved model. Read its current state and propose the complete change again.',
  };
}
