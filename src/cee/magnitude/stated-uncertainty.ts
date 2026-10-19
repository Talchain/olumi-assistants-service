/**
 * ⭐ STEP 8 PRODUCER — A SUPPORTED UNCERTAINTY FOR THE USER'S OWN PHYSICAL SIZE ON ONE LINK (DL-3, 19 Oct; AIE
 * `prompt/AIE-PHYSICAL-UNCERTAINTY-PRODUCER-MAPPING-AND-CARD-20261019-v1.json`, sha256 df3304b7…).
 *
 * WHY. #3443 withholds a chance resting on a user's size whose spread nobody supported, and asks "What evidence tells us how much
 * this effect could vary?" (AIE `point_uncertainty` 564fe768). This is where a supported answer lands, so that ask is never a dead
 * end. The size is never moved, traded for a band or replaced by a centre: only its uncertainty is recorded.
 *
 * WHAT IS SUPPORTED (AIE `accepted_input_shapes`): an explicit standard deviation of the same quantity, unit and source change;
 * or explicit quantiles with an explicit tail allocation, read with a symmetric bell-shaped (Normal) interpretation, whose
 * implied centre agrees with the retained size. NOT a bare "90% sure it is between", bounds, most-likely/worst/best, or band
 * words: those keep the withhold (`UNSUPPORTED_UNCERTAINTY_WORDS`) or ask only the missing facts (`missingIntervalMeaningWords`).
 *
 * THE RECORD rides the size it belongs to (`natural_effect.uncertainty`), so it goes whenever a writer drops or replaces
 * `natural_effect`; the writer's attestation (`std_defaulted: false`) is written with it and only with it. A reader that drops
 * the record (an older pin) sees no support: the chance stays withheld.
 *
 * THE MAPPING is the AIE's: σ = (U − L) / (Φ⁻¹(pU) − Φ⁻¹(pL)), centre = L − σ·Φ⁻¹(pL); and the link's spread on its strength frame
 * is |k|·σ through the SAME conversion the size uses (`convertLinkEffect`, k = sourceFrame / (p · targetFrame)). The engine
 * samples a link's strength as an unbounded Normal(mean, std) whenever the link is in the draw (ISL `_sample_edge_strength`), so
 * the card's percentages describe the effect given the link is present. Nothing is clamped or floored to fit: a spread outside
 * what the engine and writer can hold is refused, with the AIE's words.
 *
 * Pure.
 */
import { inverseStandardNormal } from '../../orchestrator-v5/stated-range-spread.js';
import { pluraliseUnit } from '../../orchestrator-v5/agent-lane/say-figure.js';
import type { convertLinkEffect } from './link-effect.js';
import { userFigureHeld } from './user-figure-held.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** The uncertainty recorded for the user's size on one link (`provenance.natural_effect.uncertainty`). */
export interface StatedUncertainty {
  readonly stated_as: 'standard_deviation' | 'normal_quantiles';
  /** The standard deviation in the size's own unit (`natural_effect.amount_unit`), on the same source change. */
  readonly sd: number;
  /** `normal_quantiles` only: the lower and upper values and their cumulative probabilities. */
  readonly lower?: number;
  readonly p_lower?: number;
  readonly upper?: number;
  readonly p_upper?: number;
  /** The engine samples a Normal; whether the source stated that shape or adopted Olumi's provisional approximation. */
  readonly distribution: 'normal';
  readonly distribution_origin: 'stated' | 'olumi_provisional';
  /** Whose assessment: `you` (the user's own, verified literally), or `OLUMI_READING_ASSESSOR` with `read_by`. */
  readonly assessor: string;
  /**
   * ⭐ OLUMI'S READING (DL-3 ruling 19 Oct, Paul's show-label rule): the figures are the user's words, but the host could not verify
   * literally that the user stated this link's spread (another speaker, a cut statement, a link it does not name). Saved and shown
   * as Olumi's reading, never the user's, never attested.
   */
  readonly read_by?: 'olumi';
  /** What the assessment is based on, in the words it was given. */
  readonly basis: string;
  /** The words that state the uncertainty. */
  readonly source_quote: string;
}

/** The engine's floor (ISL `StrengthDistribution.std > 0.001`) and the writer's ceiling (`AdjustEdgeStrengthStdSchema`). */
const ENGINE_STD_MIN = 0.001;
const WRITER_STD_MAX = 0.5;
const SAME = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The AIE's quantile equations, or `undefined` unless 0 < pL < pU < 1 and L < U. */
export function normalQuantilesSd(q: { readonly lower: number; readonly p_lower: number; readonly upper: number; readonly p_upper: number }):
  { readonly sd: number; readonly centre: number } | undefined {
  const { lower, p_lower: pL, upper, p_upper: pU } = q;
  if (![lower, pL, upper, pU].every(finite) || !(pL > 0 && pL < pU && pU < 1) || !(lower < upper)) return undefined;
  const sd = (upper - lower) / (inverseStandardNormal(pU) - inverseStandardNormal(pL));
  const centre = lower - sd * inverseStandardNormal(pL);
  return finite(sd) && sd > 0 && finite(centre) ? { sd, centre } : undefined;
}

/** The size's centre agrees with the retained size (the AIE: never silently replaced by the implied centre). */
export function centreAgrees(centre: number, amount: number): boolean {
  return finite(centre) && finite(amount) && SAME(centre, amount);
}

/**
 * The link's spread on its strength frame: |k|·σ through the same conversion the size uses, or `undefined` when the frames do
 * not reproduce the stored size (not bound) or the spread falls outside what the engine and the writer hold. Never clamped.
 */
export function linkSpreadOf(
  sd: number,
  size: { readonly amount: number; readonly per_source_change: number; readonly strength_mean: number },
  frames: { readonly target: number | undefined; readonly source: number | undefined } | null,
  /** The size's own conversion (`convertLinkEffect`), passed in so the support reader stays outside link-effect's import cycle. */
  convert: typeof convertLinkEffect,
): number | undefined {
  if (frames === null || !finite(sd) || sd <= 0) return undefined;
  const beta = convert(size.amount, size.per_source_change, frames.target, frames.source);
  if (beta === null || !SAME(beta, size.strength_mean)) return undefined;
  const spread = convert(sd, size.per_source_change, frames.target, frames.source);
  if (spread === null) return undefined;
  const std = Math.abs(spread);
  return std > ENGINE_STD_MIN && std <= WRITER_STD_MAX ? std : undefined;
}

/** The size this link still carries as the user's, on a stored mean that is not clamped (`userFigureHeld`), or `undefined`. */
export function currentUserSize(edge: unknown): { readonly amount: number; readonly per_source_change: number; readonly strength_mean: number;
  readonly amount_unit: string; readonly per_source_change_unit: string } | undefined {
  if (userFigureHeld(edge) === null) return undefined;
  const ne = isRec(edge) && isRec(edge.provenance) && isRec(edge.provenance.natural_effect) ? edge.provenance.natural_effect : undefined;
  const mean = isRec(edge) && isRec(edge.strength) ? edge.strength.mean : undefined;
  const amount = ne?.amount; const per = ne?.per_source_change; const written = ne?.strength_mean;
  if (!finite(amount) || amount === 0 || !finite(per) || per === 0 || !finite(written) || !finite(mean) || !SAME(written, mean)) return undefined;
  const amountUnit = typeof ne?.amount_unit === 'string' ? ne.amount_unit : undefined;
  const perUnit = typeof ne?.per_source_change_unit === 'string' ? ne.per_source_change_unit : undefined;
  if (amountUnit === undefined || perUnit === undefined) return undefined;
  return { amount, per_source_change: per, strength_mean: written, amount_unit: amountUnit, per_source_change_unit: perUnit };
}

/** A well-formed record, internally consistent and agreeing with the retained size, or `undefined`. */
export function statedUncertaintyOf(raw: unknown, amount: number): StatedUncertainty | undefined {
  if (!isRec(raw) || raw.distribution !== 'normal') return undefined;
  const origin = raw.distribution_origin === 'stated' ? 'stated' as const
    : raw.distribution_origin === 'olumi_provisional' ? 'olumi_provisional' as const : undefined;
  const assessor = text(raw.assessor); const basis = text(raw.basis); const quote = text(raw.source_quote);
  const sd = raw.sd;
  if (origin === undefined || assessor === undefined || basis === undefined || quote === undefined || !finite(sd) || sd <= 0) return undefined;
  const common = { sd, distribution: 'normal' as const, distribution_origin: origin, assessor, basis, source_quote: quote,
    ...(raw.read_by === 'olumi' ? { read_by: 'olumi' as const } : {}) };
  if (raw.stated_as === 'standard_deviation') return { stated_as: 'standard_deviation', ...common };
  const lower = raw.lower; const pLower = raw.p_lower; const upper = raw.upper; const pUpper = raw.p_upper;
  if (raw.stated_as !== 'normal_quantiles' || !finite(lower) || !finite(pLower) || !finite(upper) || !finite(pUpper)) return undefined;
  const fit = normalQuantilesSd({ lower, p_lower: pLower, upper, p_upper: pUpper });
  if (fit === undefined || !SAME(fit.sd, sd) || !centreAgrees(fit.centre, amount)) return undefined;
  return { stated_as: 'normal_quantiles', ...common, lower, p_lower: pLower, upper, p_upper: pUpper };
}

/**
 * The writer recorded a supported uncertainty for the size this link still holds, AND its spread is the one that record maps to
 * on the link's current frame (|strength_mean / amount| is the size's own k while `natural_effect` is current). The flag alone,
 * a record alone, a stale spread or a clamped size is no support.
 */
export function statedUncertaintyAttested(edge: unknown): boolean {
  const record = isRec(edge) && edge.std_defaulted === false ? recordedSpreadOf(edge) : undefined;
  return record !== undefined && record.read_by === undefined;
}

/**
 * The record this link holds for the size it still holds, when its spread is the one that record maps to on the link's current
 * frame, whoever's it is (the user's own, or Olumi's reading): else `undefined`. No flag is read.
 */
export function recordedSpreadOf(edge: unknown): StatedUncertainty | undefined {
  const size = isRec(edge) ? currentUserSize(edge) : undefined;
  if (!isRec(edge) || size === undefined) return undefined;
  const ne = isRec(edge.provenance) && isRec(edge.provenance.natural_effect) ? edge.provenance.natural_effect : undefined;
  const record = statedUncertaintyOf(ne?.uncertainty, size.amount);
  const std = isRec(edge.strength) ? edge.strength.std : undefined;
  return record !== undefined && finite(std) && SAME(std, record.sd * Math.abs(size.strength_mean / size.amount)) ? record : undefined;
}

// ── The AIE's exact product strings (`exact_words`), with the actual values substituted ─────────────────────────────────────

const fmt = (n: number): string => `${n < 0 ? '−' : ''}${Number.isInteger(n) ? Math.abs(n).toLocaleString('en-GB') : String(Math.abs(Number(n.toPrecision(6))))}`;
const pct = (p: number): string => `${fmt(Math.round(p * 1e6) / 1e4)}%`;

/** `button`. */
export const UNCERTAINTY_SAVE_BUTTON = 'Save uncertainty';

/** `unsupported_representation`. */
export const UNSUPPORTED_UNCERTAINTY_WORDS = 'I’ve kept your size, range and source. This calculation cannot yet represent that uncertainty without changing its meaning, so I can’t give a supported chance from it. We can still examine the stated assumptions and what evidence would test them.';

/**
 * `missing_interval_meaning`, asking only what is missing (`ask_scope`): the tail allocation (with the bell-shaped question the
 * AIE pairs with it) and the basis. `undefined` when nothing is missing.
 */
export function missingIntervalMeaningWords(a: { readonly probability: number; readonly lower: number; readonly upper: number;
  readonly tailsMissing: boolean; readonly basisMissing: boolean }): string | undefined {
  if (!a.tailsMissing && !a.basisMissing) return undefined;
  const tail = (1 - a.probability) / 2;
  const tails = a.tailsMissing
    ? ` Does the ${pct(a.probability)} mean ${pct(tail)} below ${fmt(a.lower)} and ${pct(tail)} above ${fmt(a.upper)}, and is a symmetric bell-shaped approximation appropriate for this effect?`
    : '';
  return `I’ve kept your range and its source.${tails}${a.basisMissing ? ' What is that assessment based on?' : ''}`;
}

/** `missing_interval_meaning`'s basis question for a standard deviation (no range to keep): asks only the missing basis. */
export const missingBasisWords = 'I’ve kept your size and its source. What is that assessment based on?';

/** The sentence the user's size was stated in (its conditions), when the link keeps it. */
export function sizeQuoteOf(edge: unknown): string | undefined {
  return isRec(edge) && isRec(edge.provenance) ? text(edge.provenance.source_quote) : undefined;
}

/** The size as the card and receipt say it: the figure in its full unit, and the user's own sentence (its conditions). */
export function sizeWords(size: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number;
  readonly per_source_change_unit: string }, quote: string | undefined): string {
  const per = size.per_source_change === 1 ? pluraliseUnit(size.per_source_change_unit, 1) : `${fmt(size.per_source_change)} ${size.per_source_change_unit}`;
  return `${fmt(size.amount)} ${size.amount_unit} per ${per}${quote !== undefined ? ` (“${quote}”)` : ''}`;
}

/** The assessor an Olumi reading is recorded under (`read_by: 'olumi'`). */
export const OLUMI_READING_ASSESSOR = 'olumi_reading';
const sourceOf = (u: StatedUncertainty): string => (u.read_by === 'olumi' ? 'Olumi’s reading of the' : u.assessor === 'you' ? 'your' : `${u.assessor}’s`);
/** ⚠ DRAFT words, pending the AIE (#94 6268847822 item 3): an Olumi reading is labelled as such, never the user's assessment. */
const OLUMI_READING_LABEL = ' This is Olumi’s reading, not an assessment you stated.';
const readingLabel = (u: StatedUncertainty): string => (u.read_by === 'olumi' ? OLUMI_READING_LABEL : '');
const shapeOf = (u: StatedUncertainty, centre: number): string => u.distribution_origin === 'stated'
  ? `a symmetric bell-shaped distribution centred on ${fmt(centre)}`
  : `a symmetric bell-shaped approximation centred on ${fmt(centre)}`;

/** `confirmation_card_direct_sd` / `confirmation_card_central_normal` (its percentages generalised to the stated quantiles). */
export function uncertaintyCardWords(effect: string, size: string, u: StatedUncertainty, unit: string, centre: number): string {
  if (u.stated_as === 'standard_deviation') {
    return `Keep ${effect} at ${size}. Record ${sourceOf(u)} uncertainty assessment: standard deviation ${fmt(u.sd)} ${unit}, using ${shapeOf(u, centre)}${u.distribution_origin === 'olumi_provisional' ? ' (a provisional approximation)' : ''}, based on ${u.basis}.${readingLabel(u)} Calculations using it remain conditional on these assumptions.`;
  }
  const l = u.lower as number; const h = u.upper as number; const pL = u.p_lower as number; const pU = u.p_upper as number;
  return `Keep ${effect} at ${size}. Record ${sourceOf(u)} assessment: ${pct(pL)} below ${fmt(l)}, ${pct(pU - pL)} between ${fmt(l)} and ${fmt(h)}, and ${pct(1 - pU)} above ${fmt(h)}. Use ${shapeOf(u, centre)}, based on ${u.basis}.${readingLabel(u)} This remains a provisional modelling assumption.`;
}

/** `receipt_after_confirmed_exact_readback`: said only once the saved link reads back exactly as approved. */
export function uncertaintyReceiptWords(effect: string, size: string, u: StatedUncertainty, centre: number): string {
  return `Saved ${u.read_by === 'olumi' ? 'Olumi’s reading of the uncertainty' : 'the uncertainty assessment'} for ${effect}. Its size remains ${size}. Calculations using it remain conditional on ${shapeOf(u, centre)}, based on ${u.basis}.${readingLabel(u)}`;
}
