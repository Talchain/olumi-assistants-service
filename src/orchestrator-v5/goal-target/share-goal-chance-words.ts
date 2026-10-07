/** Shared CEE/DGAI words for a licensed deliverable forecast. */
import { sayDate } from './deadline-date.js';
export function shareGoalChanceWords(deliverable: string, dateIso: string): string {
  return `chance of finishing ${deliverable} by ${sayDate(dateIso)}`;
}
