/** Shared CEE/DGAI words for a licensed deliverable forecast. */
import { sayDate } from './deadline-date.js';

const HEAD_PREPOSITIONS = new Set(['before', 'after', 'in', 'for', 'of', 'by', 'to', 'on', 'with', 'at', 'from', 'across']);

/** The deliverable's head names the event; later launch references do not. */
export function deliverableIsALaunch(deliverable: string): boolean {
  const words = deliverable.trim().toLowerCase().split(/\s+/u);
  const preposition = words.findIndex(word => HEAD_PREPOSITIONS.has(word));
  const head = preposition < 0 ? words : words.slice(0, preposition);
  return head.at(-1) === 'launch'
    || (head[0] === 'launching' && head.slice(1).some(word => !['the', 'a', 'an', ''].includes(word)));
}

export function shareGoalChanceWords(deliverable: string, dateIso: string): string {
  return deliverableIsALaunch(deliverable)
    ? `chance of launching by ${sayDate(dateIso)}`
    : `chance of finishing ${deliverable} by ${sayDate(dateIso)}`;
}
