/** Shared CEE/DGAI words for a licensed deliverable forecast. */
import { sayDate } from './deadline-date.js';

/** A terminal launch noun or launching with an explicit object names the event. */
export function deliverableIsALaunch(deliverable: string): boolean {
  const words = deliverable.trim().toLowerCase().split(/\s+/u);
  return words.at(-1) === 'launch'
    || (words[0] === 'launching' && words.length > 2 && ['the', 'a', 'an'].includes(words[1]!));
}

export function shareGoalChanceWords(deliverable: string, dateIso: string): string {
  return deliverableIsALaunch(deliverable)
    ? `chance of launching by ${sayDate(dateIso)}`
    : `chance of finishing ${deliverable} by ${sayDate(dateIso)}`;
}
