/** Shared CEE/DGAI words for a licensed deliverable forecast. */
import { sayDate } from './deadline-date.js';
export function shareGoalChanceWords(deliverable: string, dateIso: string): string {
  return /\blaunch(?:ing)?\b/i.test(deliverable)
    ? `chance of launching by ${sayDate(dateIso)}`
    : `chance of finishing ${deliverable} by ${sayDate(dateIso)}`;
}
