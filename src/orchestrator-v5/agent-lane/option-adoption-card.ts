import type { StructuredProposal } from './proposal.js';

export const ADOPT_OPTION_OP = 'adopt_option' as const;

export type OptionAdoptionReading = { readonly option_id: string; readonly words: string };

/** The stored card reading, never reconstructed from the Agent's reply. */
export function optionAdoptionReadingOf(proposal: StructuredProposal): OptionAdoptionReading | undefined {
  const op = Array.isArray(proposal.operations) && proposal.operations.length === 1 && proposal.operations[0]!.op === ADOPT_OPTION_OP
    ? proposal.operations[0]! : undefined;
  const value = op?.value;
  if (op === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const reading = value as { option_id?: unknown; words?: unknown };
  return reading.option_id === op.path && typeof reading.words === 'string' && reading.words.trim() !== ''
    ? { option_id: op.path, words: reading.words } : undefined;
}

export const optionAdoptionApproveMessage = (words: string): string => `Yes — ${words}`;

/** Restore the displayed reading only when the durable button still says exactly what the stored proposal says. */
export function readingOfOptionAdoptionApproval(message: unknown, proposal: StructuredProposal): string | undefined {
  const reading = optionAdoptionReadingOf(proposal);
  return reading !== undefined && message === optionAdoptionApproveMessage(reading.words) ? reading.words : undefined;
}

/** A short, explicit reading of the saved option's authorship and the one change approval makes. */
export function optionAdoptionWords(label: string): string | undefined {
  const words = `Add “${label}” to the comparison? Olumi suggested this option. Adding it records your choice to include it; missing values still need to be set.`;
  return words.length <= 400 ? words : undefined;
}
