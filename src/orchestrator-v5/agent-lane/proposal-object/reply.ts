/**
 * ⭐ S-D — WHAT THE USER SET VS OLUMI'S, AND WHAT HAPPENED TO A HELD CHANGE (design §5, §7). Server-authored, fixed
 * words; every label is quoted user data. British English, no em dash, no contest framing.
 */
import type { StrengthBand } from '@talchain/schemas/boundary';

import type { UserEdit, LinkUserEdit } from './amend.js';
import { sayFigureAsWritten } from '../say-figure.js';

const BAND_WORD: Readonly<Record<StrengthBand, string>> = { slight: 'slight', moderate: 'moderate', strong: 'strong', very_strong: 'very strong' };

// AIQ: words pending
export const PLAIN_APPROVAL_SUPERSEDED = 'Nothing changed. That card is out of date: the change it shows has been replaced. Use the newest card for it.';

/** One sentence per field the user set, then one line naming the links left as Olumi's. */
export function userEditsReceipt(edits: readonly UserEdit[]): string {
  const lines: string[] = [];
  for (const e of edits) {
    if (e.kind === 'factor_value') {
      if (e.user !== null) lines.push(`You set "${e.label}" to ${sayFigureAsWritten(e.user.value, e.unit)}; Olumi's estimate was ${sayFigureAsWritten(e.olumi.value, e.unit)}.`);
      else if (e.olumi.source === 'estimate') lines.push(`Left as Olumi's estimate: "${e.label}" (${sayFigureAsWritten(e.olumi.value, e.unit)}).`);
      continue;
    }
    if (e.user === null) continue;
    const said = `You set how strongly "${e.from_label}" affects "${e.to_label}": ${BAND_WORD[e.user.band]}`;
    lines.push(e.olumi.source === 'placeholder' ? `${said}. Olumi had only a placeholder there, not an estimate.`
      : e.olumi.source === 'estimate' ? `${said}; Olumi's estimate was ${BAND_WORD[e.olumi.band]}.`
        : `${said}.`);
  }
  const left = (source: 'placeholder' | 'estimate'): string[] =>
    edits.filter((e): e is LinkUserEdit => e.kind !== 'factor_value' && e.user === null && e.olumi.source === source).map((e) => `"${e.from_label}" → "${e.to_label}"`);
  const placeholders = left('placeholder');
  const estimates = left('estimate');
  if (placeholders.length > 0) lines.push(`Left as Olumi's placeholder: ${placeholders.join(', ')}.`);
  if (estimates.length > 0) lines.push(`Left as Olumi's estimate: ${estimates.join(', ')}.`);
  return lines.join(' ');
}

export type HeldLapseReason = 'model_changed' | 'idle' | 'over_cap' | 'gone' | 'superseded';

/** A held change that could not be kept is SAID, once, on the turn it goes (never a silent drop, D-08). */
export function heldLapseSentence(name: string | undefined, reason: HeldLapseReason): string {
  const what = name ?? 'A held change';
  switch (reason) {
    case 'model_changed':
      return `${what} no longer fits the model as it now stands, so it has lapsed; say the word if you still want it.`;
    case 'idle':
      return `${what} has lapsed after a day without an answer; say the word if you still want it.`;
    case 'over_cap':
      return `${what} was set aside because only three changes can wait at once; say the word if you still want it.`;
    // 'superseded', a newer card for the same targets (DL 7 Oct, f48e3e67): said, never silent; never "the same change"
    // (PR 4, P03: it was not).
    case 'gone':
    case 'superseded':
      return `${what} is no longer waiting; say the word if you still want it.`;
  }
}

/** The press that asks the Agent to prepare a card under review again, on the model as it is now (never an approval). */
const REVIEW_CHIP_PREFIX = 'agent-review-proposal:';
const REVIEW_THIS_CHANGE = 'Review this change';
export function reviewedProposalOf(chipId: unknown): string | undefined {
  return typeof chipId === 'string' && chipId.startsWith(REVIEW_CHIP_PREFIX) ? chipId.slice(REVIEW_CHIP_PREFIX.length) : undefined;
}
/** "A", "A" and "B", "A", "B" and "C". */
const namesSaid = (names: readonly string[]): string => {
  const q = names.map((n) => `"${n}"`);
  return q.length <= 1 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q.at(-1)}`;
};
/** `replaced`: the part a correction replaced (`heldCardReplaced`); the review then asks for the kept part only. */
export function reviewChipFor(proposalId: string, change: string | undefined, replaced: readonly string[] = []): { id: string; label: string; message: string; detail?: string } {
  const what = change?.trim().replace(/\.$/, '');
  const without = replaced.length > 0 ? `, without ${namesSaid(replaced)}, which my correction replaced` : '';
  return { id: `${REVIEW_CHIP_PREFIX}${proposalId}`, label: REVIEW_THIS_CHANGE,
    message: what !== undefined && what !== '' ? `Show me this change again on the model as it is now${without}: "${what}".` : `Show me this change again on the model as it is now${without}.`,
    ...(what !== undefined && what !== '' ? { detail: what } : {}) };
}

/** A correction replaced part of a held card (`retireCorrectedHolds`): said once, naming the replaced and the kept part. */
export function heldCorrectedSentence(change: string | undefined, replaced: readonly string[], kept: readonly string[]): string {
  const what = change?.trim().replace(/\.$/, '');
  const card = what !== undefined && what !== '' ? `the held change "${what}"` : 'a held change';
  return `Your correction replaces ${namesSaid(replaced)} in ${card}, so that change waits for your review; nothing was applied. `
    + `Its other part (${namesSaid(kept)}) can be prepared again with ${REVIEW_THIS_CHANGE}.`;
}

/**
 * ⭐ NO SILENT LAPSE (PR-2): a held change whose own subject moved is KEPT for review and said once — never "lapsed". The
 * user's intent stays visible; nothing is applied until it is prepared again on the model as it is now and approved.
 */
export function heldReviewSentence(name: string | undefined): string {
  return `Model changed: review this change. ${name ?? 'A held change'} was prepared before the model changed, so it waits for your review; nothing was applied.`;
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
