import type { StructuredProposal } from './proposal.js';

export const ADOPT_OPTION_OP = 'adopt_option' as const;

export type OptionAdoptionReading = { readonly option_id: string; readonly words: string };

/** The stored card reading, never reconstructed from the Agent's reply. */
export function optionAdoptionReadingOf(proposal: StructuredProposal): OptionAdoptionReading | undefined {
  const op = proposal.operations.length === 1 && proposal.operations[0]!.op === ADOPT_OPTION_OP
    ? proposal.operations[0]! : undefined;
  const value = op?.value as { option_id?: unknown; words?: unknown } | undefined;
  return op !== undefined && value?.option_id === op.path && typeof value.words === 'string'
    && value.words.trim() !== '' ? { option_id: op.path, words: value.words } : undefined;
}

export const optionAdoptionApproveMessage = (words: string): string => `Yes — ${words}`;

/** A short, explicit reading of the saved option's authorship and the one change approval makes. */
export function optionAdoptionWords(label: string): string | undefined {
  const words = `Add “${label}” to the comparison? Olumi suggested this option. Adding it records your choice to include it; missing values still need to be set.`;
  return words.length <= 400 ? words : undefined;
}
