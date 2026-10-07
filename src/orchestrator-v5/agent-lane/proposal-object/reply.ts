/**
 * ⭐ S-D — WHAT THE USER SET VS OLUMI'S, AND WHAT HAPPENED TO A HELD CHANGE (design §5, §7). Server-authored, fixed
 * words; every label is quoted user data. British English, no em dash, no contest framing.
 */
import type { StrengthBand } from '@talchain/schemas/boundary';

import type { UserEdit } from './amend.js';

const BAND_WORD: Readonly<Record<StrengthBand, string>> = { slight: 'slight', moderate: 'moderate', strong: 'strong', very_strong: 'very strong' };

/** One sentence per field the user set, then one line naming the links left as Olumi's. */
export function userEditsReceipt(edits: readonly UserEdit[]): string {
  const lines: string[] = [];
  for (const e of edits) {
    if (e.user === null) continue;
    const said = `You set how strongly "${e.from_label}" affects "${e.to_label}": ${BAND_WORD[e.user.band]}`;
    lines.push(e.olumi.source === 'placeholder' ? `${said}. Olumi had only a placeholder there, not an estimate.`
      : e.olumi.source === 'estimate' ? `${said}; Olumi's estimate was ${BAND_WORD[e.olumi.band]}.`
        : `${said}.`);
  }
  const left = (source: 'placeholder' | 'estimate'): string[] =>
    edits.filter((e) => e.user === null && e.olumi.source === source).map((e) => `"${e.from_label}" → "${e.to_label}"`);
  const placeholders = left('placeholder');
  const estimates = left('estimate');
  if (placeholders.length > 0) lines.push(`Left as Olumi's placeholder: ${placeholders.join(', ')}.`);
  if (estimates.length > 0) lines.push(`Left as Olumi's estimate: ${estimates.join(', ')}.`);
  return lines.join(' ');
}

export type HeldLapseReason = 'model_changed' | 'idle' | 'over_cap' | 'gone';

/** A held change that could not be kept is SAID, once, on the turn it goes (never a silent drop, D-08). */
export function heldLapseSentence(name: string | undefined, reason: HeldLapseReason): string {
  const what = name !== undefined ? `The held change to add ${name}` : 'A held change';
  switch (reason) {
    case 'model_changed':
      return `${what} no longer fits the model as it now stands, so it has lapsed; say the word if you still want it.`;
    case 'idle':
      return `${what} has lapsed after a day without an answer; say the word if you still want it.`;
    case 'over_cap':
      return `${what} was set aside because only three changes can wait at once; say the word if you still want it.`;
    case 'gone':
      return `${what} is no longer waiting; say the word if you still want it.`;
  }
}

/** The typed decline's receipt. */
export function heldDeclineSentence(name: string | undefined): string {
  return `Set aside: ${name ?? 'the held change'}. Nothing in the model changed.`;
}

/** An approve-with-edits that could not be applied: nothing written, the proposal still held. */
export function editsRefusedSentence(reason: 'stale' | 'not_held' | 'malformed' | 'refused'): string {
  // Every branch ends the same way on purpose: the user is told nothing changed and the change is still theirs to decide.
  switch (reason) {
    case 'stale':
      return 'The model changed after these values were shown, so nothing was applied. Nothing in the model changed; open the change again to see its current values.';
    case 'not_held':
      return 'That change is no longer waiting, so nothing was applied. Nothing in the model changed.';
    case 'malformed':
    case 'refused':
      return 'Those values could not be applied to this change, so nothing was applied. Nothing in the model changed; the change is still waiting for you.';
  }
}
