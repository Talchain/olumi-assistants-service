/**
 * ⭐ THE HEADLINE'S LEAD NAMES THE GOAL'S QUANTITY, NEVER "YOUR GOAL" (Science d5 #87 6008575410 + 6008589328 + the
 * label-first ruling on WORDING c6's lease 6009413360).
 *
 * The share in the lead is a per-run ranking on the goal's QUANTITY. Since 6 Oct "your goal" reads as the TARGET
 * ("chance of meeting your goal"), so "scored highest against your goal in N% of runs" tied a run share to the target —
 * which the same turn's interpret reply correctly denies. One ladder:
 *   1. the goal has a unit (it is a quantity): "{X} gave the {highest|lowest} {goal label} in N% of runs of this model";
 *   2. the label OPENS with an aim verb (d5's list, plus an optional the/our/your) and the goal has a unit: strip the
 *      verb and use rung 1 with the remainder ("Reduce churn" → "the lowest churn");
 *   3. otherwise: "{X} was supported by N% of runs of this model" — direction-free and guard-sanctioned.
 * "lowest" only when THIS Run sent `minimise` (the caller's own payload), so the word is the direction ISL ranked by.
 *
 * Fail-to-rung-3 by construction: rung 3 is true of every Run, so any doubt about the quantity (no unit, a direction or
 * stasis word left inside it, a label the content defences refuse, one too long for the budget) drops to it.
 */
import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import { deriveGoalIntent } from './objective-contradiction.js';

/** d5's aim verbs, at the START of the label only, with an optional determiner. */
const AIM_VERB_OPENING_RE =
  /^(?:reduce|cut|lower|decrease|minimi[sz]e|increase|grow|raise|boost|maximi[sz]e|improve)\s+(?:(?:the|our|your)\s+)?/i;

/**
 * A label that OPENS with any other aim or action verb ("Sustain revenue", "Hit £1m ARR", "Win market share") cannot be
 * read as a quantity, and only d5's list is safe to strip, so it drops to rung 3 (Codex buddy #2646 r1 F1). Opening-only:
 * mid-label these are often nouns ("Social media reach", "Meetings booked").
 */
const UNSTRIPPABLE_VERB_OPENING_RE =
  /^(?:sustain|preserve|protect|safeguard|optimi[sz]e|retain|secure|ensure|achieve|reach|hit|meet|attain|deliver|drive|expand|accelerate|enhance|strengthen|eliminate|limit|cap|control|manage|stay|remain|win|gain|get|make|build|launch|beat|exceed|double|triple|halve|keep|maintain|hold|stabili[sz]e|avoid|prevent|target|aim)\b/i;

/**
 * A direction or stasis word INSIDE the quantity ("Churn reduction", "Keep costs stable") would make "the lowest
 * {quantity}" say something else, so it drops to rung 3. Wider than the opening list on purpose: here a false hit
 * costs only the quantity's name, never a true sentence.
 */
const RESIDUAL_AIM_RE =
  /\b(?:reduc|cut|lower|decreas|minimi[sz]|increas|grow|growth|rais|boost|maximi[sz]|improv|keep|maintain|hold|stabili[sz]|avoid|prevent|sustain|preserv|optimi[sz]|retain|safeguard|target|goal)\w*/i;

/** The quantity's budget, shared with the length caps that admit the lead. */
export const LEAD_QUANTITY_MAX_CHARS = 48;

export interface LeadQuantity {
  readonly extreme: 'highest' | 'lowest';
  readonly quantity: string;
}

/** Sentence case for a quantity read mid-sentence; an acronym ("MRR", "NPS score") keeps its capitals. */
function midSentence(quantity: string): string {
  return /^[A-Z][a-z]/.test(quantity) ? quantity.charAt(0).toLowerCase() + quantity.slice(1) : quantity;
}

/** Rung 1/2's quantity and extreme, or `null` for rung 3. */
export function resolveLeadQuantity(args: {
  readonly goalLabel: unknown;
  readonly goalUnit: unknown;
  readonly minimised: boolean;
}): LeadQuantity | null {
  if (typeof args.goalUnit !== 'string' || args.goalUnit.trim() === '') return null;
  if (typeof args.goalLabel !== 'string') return null;
  const label = sanitiseLabel(args.goalLabel, '');
  if (label === null) return null;
  const quantity = label.replace(AIM_VERB_OPENING_RE, '').trim();
  if (quantity.length === 0 || quantity.length > LEAD_QUANTITY_MAX_CHARS) return null;
  if (UNSTRIPPABLE_VERB_OPENING_RE.test(quantity)) return null;
  if (RESIDUAL_AIM_RE.test(quantity) || deriveGoalIntent(quantity).direction !== 'undetermined') return null;
  if (!passesAssistantTextContentDefences(quantity)) return null;
  return { extreme: args.minimised ? 'lowest' : 'highest', quantity: midSentence(quantity) };
}
