/** RC2 Science (h): a recorded minimum is never the link's best guess. */
import { statedRangeSpread } from '../stated-range-spread.js';
import { boundedLinkEffectText, findLinkEffectAmounts } from './link-effect-figures.js';
import { magnitudeNodes, percentLevelIds } from '../../cee/magnitude/frame-defaulted-links.js';
import { resolveMagnitudeFrame } from '../../cee/magnitude/link-effect.js';
import { linkEffectTheUserStated } from './stated-by-user.js';
import { linkEffectEndUnits, linkEffectTargetOf, type LinkEffectStatement } from '../system-events/link-effect-edit.js';
import { unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import type { LinkEffectClarificationPending } from './link-effect-clarification.js';

export interface LinkEffectFloor {
  readonly value: number;
  readonly unit: string;
  readonly reading: 'points' | 'relative' | 'absolute';
  readonly words: string;
  readonly per_source_change: number;
  readonly per_source_change_unit: string;
  readonly reading_answer: string;
  /** Only a stated current level licenses a relative-to-points conversion. */
  readonly relative_base?: number;
  readonly target_label?: string;
}
type Rec = Record<string, unknown>;
const record = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const words = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 2000;

export function isLinkEffectFloor(v: unknown): v is LinkEffectFloor {
  const f = record(v);
  return f !== undefined && finite(f.value) && f.value > 0 && words(f.unit) && words(f.words)
    && finite(f.per_source_change) && f.per_source_change !== 0 && words(f.per_source_change_unit) && words(f.reading_answer)
    && (f.reading === 'points' || f.reading === 'absolute' || f.reading === 'relative')
    && (f.reading !== 'relative' || finite(f.relative_base) && f.relative_base > 0);
}

export function naturalFloorAmount(floor: LinkEffectFloor, value: number): number {
  return floor.reading === 'relative' ? value * floor.relative_base! / 100 : value;
}

export function linkEffectFloorQuestion(floor: LinkEffectFloor): string {
  // AIQ: words pending. Science's sentence, including its question and coverage, is authoritative.
  if (floor.reading === 'points' && floor.value === 1 && /churn/i.test(floor.target_label ?? '')) return "You said churn will rise by at least 1 point. What's your best single guess, and what's the most it could plausibly be?";
  return `You said the effect will be ${floor.words}. What's your best single guess, and what's the most it could plausibly be?`;
}

export function readLinkEffectFloorAnswer(floor: LinkEffectFloor, answer: string):
  { ok: true; guess: number; upper?: number; std?: number }
  | { ok: false; refusal: string; question: string } {
  if (!isLinkEffectFloor(floor) || typeof answer !== 'string' || answer.length > 400) {
    return { ok: false, refusal: 'unreadable_floor', question: 'What is your stated minimum, your best single guess, and the most it could plausibly be, in the same units?' };
  }
  const amounts = findLinkEffectAmounts(answer);
  const first = amounts[0];
  const question = linkEffectFloorQuestion(floor);
  if (first === undefined || amounts.length > 2 || /\?|\b(?:not|no|less than|more than|between)\b/i.test(answer)) {
    return { ok: false, refusal: 'unreadable_floor_answer', question };
  }
  const unitsMatch = (a: typeof first): boolean => floor.reading === 'points' ? a.kind === 'plain'
    : floor.reading === 'relative' ? a.kind === 'plain' || a.kind === 'percent'
      : a.kind === 'plain' || a.kind === 'currency' && unitComparisonKey(a.currencyCode ?? '') === unitComparisonKey(floor.unit);
  if (amounts.some(a => !unitsMatch(a))) return { ok: false, refusal: 'unreadable_floor_answer', question };
  const prefix = answer.slice(0, first.index).trim();
  if (!/^(?:(?:my|the|our)\s+)?(?:(?:best(?:\s+single)?\s+)?(?:guess|estimate)(?:\s+is|\s*:)?\s*)?$/i.test(prefix)) {
    return { ok: false, refusal: 'unreadable_floor_answer', question };
  }
  const second = amounts[1];
  const tail = answer.slice(first.index + first.matchedText.length, second?.index);
  const unit = floor.reading === 'points' ? '(?:percentage\\s+)?points?|pp'
    : floor.reading === 'relative' ? '(?:relative\\s+)?(?:percent|per\\s+cent|%)' : floor.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const firstUnit = new RegExp(`^\\s*(?:${unit})?\\s*[.;,]?\\s*$`, 'i');
  if (second === undefined && !firstUnit.test(tail)) return { ok: false, refusal: 'unreadable_floor_answer', question };
  if (second !== undefined && (!new RegExp(`^\\s*(?:${unit})?\\s*[.;,]?\\s*(?:and\\s+)?(?:the\\s+)?(?:most(?:\\s+it\\s+could\\s+plausibly\\s+be)?|upper(?:\\s+end)?|maximum|at\\s+most)(?:\\s+is|\\s*:)?\\s*$`, 'i').test(tail)
    || !firstUnit.test(answer.slice(second.index + second.matchedText.length)))) {
    return { ok: false, refusal: 'unreadable_floor_answer', question };
  }
  const guess = first.magnitude;
  const upper = second?.magnitude;
  if (guess < floor.value || upper !== undefined && guess > upper) return { ok: false, refusal: 'outside_stated_bounds',
    question: `Your best guess must be at least ${floor.value} ${floor.unit}${upper === undefined ? '' : ` and no more than ${upper} ${floor.unit}`}. What's your best single guess, and what's the most it could plausibly be?` };
  if (upper === undefined) return { ok: true, guess };
  const spread = statedRangeSpread(floor.value, upper, 0.9);
  if (!spread.ok) return { ok: false, refusal: spread.refusal, question };
  return { ok: true, guess, upper, std: spread.std };
}

/** Resolve the unit reading, recording the bound and the actual source change it refers to. */
export function linkEffectFloorFromStatement(graph: unknown, from: string, to: string, quote: string,
  effect: LinkEffectStatement, readingAnswer: string): LinkEffectFloor | null {
  const bound = boundedLinkEffectText(quote);
  if (bound === undefined || !/^(?:at least|no less than|minimum(?: of)?)\b/i.test(bound)) return null;
  const amount = findLinkEffectAmounts(bound)[0];
  // The scanner's bound span ends at the figure; its immediately following unit still settles the reading.
  const statedPoints = /^\s*(?:(?:percentage\s+)?points?|pp)\b/i.test(quote.slice(quote.indexOf(bound) + bound.length));
  if (amount === undefined || amount.magnitude <= 0 || effect.amount !== amount.magnitude) return null;
  const g = record(graph);
  const nodes = Array.isArray(g?.nodes) ? g.nodes.map(record).filter((n): n is Rec => n !== undefined) : [];
  const target = nodes.find(n => n.id === to);
  const relative = /^relative(?:\s+(?:change|increase|decrease))?[.!]?$/i.test(readingAnswer.trim());
  const points = /^(?:(?:one|a|1(?:\.0+)?)\s+)?percentage\s+points?[.!]?$/i.test(readingAnswer.trim())
    || /^(?:absolute|percentage[-\s]point)(?:\s+(?:change|increase|decrease))?[.!]?$/i.test(readingAnswer.trim());
  if (amount.kind === 'percent' && !relative && !points && !statedPoints) return null;
  let per = effect.per_source_change;
  if (/\bthis\s+(?:price\s+)?(?:increase|rise|change)\b/i.test(quote)) {
    const source = nodes.find(n => n.id === from);
    const os = record(source?.observed_state);
    const baseline = os?.raw_value ?? os?.value;
    const changes = finite(baseline) ? nodes.filter(n => n.kind === 'option' && n.is_baseline !== true).flatMap(n => {
      const intervention = record(record(n.interventions)?.[from]);
      if (intervention?.source !== 'user_specified' && intervention?.source !== 'brief_extraction' && intervention?.source !== 'user_override') return [];
      const value = intervention?.raw_value ?? (finite(intervention?.value) && finite(os?.cap) ? intervention.value * os.cap : undefined);
      return finite(value) && value !== baseline ? [value - baseline] : [];
    }) : [];
    const unique = [...new Set(changes)];
    if (unique.length !== 1) return null;
    per = unique[0]!;
  } else {
    // Removing the bound words only checks the source warrant; it never licenses the bound as a size.
    const unbounded = quote.replace(bound, bound.replace(/^(?:at least|no less than|minimum(?: of)?)\s*/i, ''));
    const targetUnit = record(target?.observed_state)?.unit;
    if (linkEffectTheUserStated(unbounded, effect, { source: String(nodes.find(n => n.id === from)?.label ?? ''), target: String(target?.label ?? '') },
      { quantities: nodes.map(n => String(n.label ?? '')), target_units: typeof targetUnit === 'string' ? [targetUnit] : [] }) !== null) return null;
  }
  let base: number | undefined;
  if (relative) {
    const targetWords = String(target?.label ?? '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !/^(?:monthly|daily|rate|level|current)$/.test(w));
    const level = findLinkEffectAmounts(quote).find(a => {
      const clause = quote.slice(0, a.index).split(/[,;.!?]|\b(?:and|while|whereas)\b/i).at(-1) ?? '';
      return a.kind === 'percent' && /\bcurrent\b/i.test(clause) && targetWords.some(w => new RegExp(`\\b${w}\\b`, 'i').test(clause))
        && a.index < quote.indexOf(bound);
    });
    const os = record(target?.observed_state);
    base = level?.magnitude ?? (os?.source === 'user_override' || os?.source === 'brief_extraction' ? os.raw_value as number : undefined);
    if (!finite(base) || base <= 0) return null;
  }
  const reading = relative ? 'relative' : amount.kind === 'percent' || points || statedPoints ? 'points' : 'absolute';
  const unit = reading === 'points' ? 'percentage points' : reading === 'relative' ? '%' : effect.amount_unit;
  const floor: LinkEffectFloor = { value: amount.magnitude, unit, reading,
    words: reading === 'points' ? `at least ${amount.magnitude} ${amount.magnitude === 1 ? 'point' : 'points'}` : `at least ${amount.magnitude}${reading === 'relative' ? '% relative' : ` ${unit}`}`,
    per_source_change: per, per_source_change_unit: effect.per_source_change_unit,
    reading_answer: readingAnswer || unit, target_label: String(target?.label ?? ''), ...(base === undefined ? {} : { relative_base: base }) };
  return isLinkEffectFloor(floor) ? floor : null;
}

/** Only a current, commensurate figure can contradict the recorded floor; a Run changes no size here. */
export function linkEffectFloorDisclosures(graph: unknown, asks: readonly LinkEffectClarificationPending[]): string[] {
  return asks.flatMap(({ action }) => {
    const floor = action.floor;
    if (!isLinkEffectFloor(floor)) return [];
    const found = linkEffectTargetOf(graph, action.from_id, action.to_id);
    if (found.kind !== 'one') return [];
    const strength = record(found.edge.strength);
    const natural = record(record(found.edge.provenance)?.natural_effect);
    if (!finite(strength?.mean)) return [];
    const targetUnit = floor.reading === 'relative' ? 'percentage points' : floor.unit;
    const normalUnit = (u: string): string | undefined => /^(?:%|percentage points?|points?|pp)$/i.test(u.trim()) ? 'points' : unitComparisonKey(u);
    let current: number | undefined;
    if (natural !== undefined && natural.strength_mean === strength.mean && natural.strength_mean_frame === 'edge_strength'
      && finite(natural.amount) && finite(natural.per_source_change) && natural.per_source_change !== 0
      && typeof natural.amount_unit === 'string' && typeof natural.per_source_change_unit === 'string'
      && unitComparisonKey(natural.per_source_change_unit) === unitComparisonKey(floor.per_source_change_unit)
      && normalUnit(natural.amount_unit) === normalUnit(targetUnit)) {
      current = natural.amount * floor.per_source_change / natural.per_source_change;
    } else {
      const g = record(graph);
      const nodes = Array.isArray(g?.nodes) ? g.nodes.map(record).filter((n): n is Rec => n !== undefined) : [];
      const units = linkEffectEndUnits(graph, action.from_id, action.to_id);
      const view = magnitudeNodes(nodes, percentLevelIds(g ?? {}));
      const source = view.get(action.from_id); const target = view.get(action.to_id);
      const sourceFrame = source === undefined ? undefined : resolveMagnitudeFrame(source);
      const targetFrame = target === undefined ? undefined : resolveMagnitudeFrame(target);
      if (units === null || !units.source.own.some(u => unitComparisonKey(u) === unitComparisonKey(floor.per_source_change_unit))
        || !units.target.own.some(u => normalUnit(u) === normalUnit(targetUnit))
        || !finite(sourceFrame) || !finite(targetFrame) || sourceFrame <= 0 || targetFrame <= 0) return [];
      current = strength.mean * floor.per_source_change * targetFrame / sourceFrame;
    }
    if (!finite(current)) return [];
    if (current >= naturalFloorAmount(floor, floor.value)) return [];
    // AIQ: words pending. Science's disclosure is verbatim, substituting labels and the user's bound words.
    return [`Olumi's current figure for how much ‘${action.from_label}’ affects ‘${action.to_label}’ is below your ‘${floor.words}’, so this Run likely understates churn and may flatter the price rise.`];
  });
}
