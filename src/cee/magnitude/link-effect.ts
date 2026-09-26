/**
 * ⭐ THE MAGNITUDE CONTRACT — a causal link's size, read on its TARGET's own frame.
 *
 * MG design `MAGNITUDE-CONTRACT-DESIGN.md` (26 Sep), decisions D2–D8. Pure, total, no I/O.
 *
 * ⛔ THE DEFECT (served, Paul's T3, #70 5844762506). Admission gave every drafted link the same frame-blind
 * ±0.5. On a churn factor measured 0–100% with 4% today, "releasing AI lowers churn" therefore meant about
 * −50 points: on local ISL the leading option's median churn was −41.7%, with 81.5% of its draws below 0%.
 *
 * The drafter now states each link's size in natural units (D1): `effect_amount` is the change in the TARGET's
 * own unit (points for a percentage), caused by `effect_per_source_change` of the SOURCE in its own unit (1 for
 * switching a yes/no on). This module turns that into a strength and decides what the edge may carry:
 *
 *   D2  β = (amount / F_T) / (per_change / F_S), with F read from ONE frame authority (`resolveMagnitudeFrame`).
 *       A frame that does not resolve makes the size unknown.
 *   D3  σ = |β| / 2 when nobody stated a spread. It is Olumi's, and the caller's ledger says so.
 *   D4  In domain when a target with a KNOWN baseline b on a BOUNDED domain keeps its ±2σ band inside that
 *       domain across the source's swing [d⁻, d⁺]: b + (β ± 2σ)·d ∈ D.
 *   D5  Olumi's out-of-domain estimate is NOT used and NOT clamped: the D6 placeholder replaces it, and a
 *       question quoting the estimate in natural units is asked.
 *   D6  An unknown size gets sign · min(0.5, headroom / (4·|d|)), σ = |β| / 2. With no bounded domain, no known
 *       baseline or no swing, today's ±0.5 / 0.125 is kept unchanged (there is nothing to check it against).
 *   D7  The user's own size is kept exactly as stated, even out of domain, and asked about.
 *   D8  |β| > 1 cannot be represented (the engine truncates to [−1, 1]), so it is asked about, never cut silently.
 *
 * ⚠ WHAT THIS DOES NOT DO. It never rewrites a stored graph (D10 is a later PR), never touches the engine, and
 * never blocks readiness itself: a readiness reader for D7's conflict belongs to the readiness owner.
 */

import { STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';
import type { EdgeProvenanceV3T } from '../../schemas/cee-v3.js';
import { classifyUnitScaleClass, unitPinnedScaleFrame } from '../draft/records/unit-scale-class.js';
import { readCurrencyUnitWithQualifiers } from '../provenance/stated-amounts.js';
import { recoverScaleFrame } from '../../orchestrator-v5/tools/handlers/d1-shared/scale-frame.js';
import { isPercentWithPeriod } from '../../orchestrator-v5/agent-lane/admit-constraint.js';

/** Who sized a link (D9). Declared once, on `EdgeProvenanceV3.magnitude`. */
export type MagnitudeAuthor = NonNullable<EdgeProvenanceV3T['magnitude']>;

/**
 * A node as these rules read it: the graph fields that carry its frame and level, plus every level an option
 * sets on it (normalised, as `interventions` stores them).
 */
export interface MagnitudeNode {
  readonly label: string;
  readonly kind?: string;
  readonly scale_frame?: unknown;
  readonly observed_state?: {
    readonly value?: unknown;
    readonly raw_value?: unknown;
    readonly cap?: unknown;
    readonly unit?: unknown;
    readonly baseline?: unknown;
    readonly source?: unknown;
    readonly extractionType?: unknown;
  };
  readonly goal_threshold_cap?: unknown;
  readonly goal_threshold_unit?: unknown;
  /** The unit the drafter gave this quantity, for a node whose graph fields carry none. */
  readonly unit?: string | null;
  readonly option_levels: readonly number[];
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const aboveOne = (x: unknown): x is number => finite(x) && x > 1;
const text = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() !== '' ? x : undefined);

/** The node's unit: its observed state's, then (for a goal) its target's, then the drafter's. */
export function unitOf(node: MagnitudeNode): string | undefined {
  return text(node.observed_state?.unit)
    ?? (node.kind === 'goal' ? text(node.goal_threshold_unit) : undefined)
    ?? text(node.unit);
}

/**
 * ⭐ D2's ONE FRAME AUTHORITY, in the design's order: `scale_frame` → `observed_state.cap` (for a goal, its
 * threshold cap, §4) → `recoverScaleFrame` → `unitPinnedScaleFrame` → 1 when every level the node holds is
 * already in [0, 1]. `undefined` when none resolves, which makes the size unknown.
 */
export function resolveMagnitudeFrame(node: MagnitudeNode): number | undefined {
  if (aboveOne(node.scale_frame)) return node.scale_frame;
  const os = node.observed_state ?? {};
  if (aboveOne(os.cap)) return os.cap;
  if (node.kind === 'goal' && aboveOne(node.goal_threshold_cap)) return node.goal_threshold_cap;
  const recovered = recoverScaleFrame({ value: os.value, raw_value: os.raw_value });
  if (recovered !== undefined) return recovered;
  const raw = finite(os.raw_value) ? os.raw_value : finite(os.value) ? os.value : undefined;
  if (raw !== undefined) {
    const pinned = unitPinnedScaleFrame(unitOf(node), Math.abs(raw));
    if (pinned !== undefined) return pinned;
  }
  const levels = [...(finite(os.value) ? [os.value] : []), ...node.option_levels.filter(finite)];
  if (levels.length > 0 && levels.every((v) => v >= 0 && v <= 1)) return 1;
  return undefined;
}

/** A level domain on the node's frame (normalised). `hi` may be `Infinity`. */
export interface LevelDomain { readonly lo: number; readonly hi: number }
const UNIT_INTERVAL: LevelDomain = { lo: 0, hi: 1 };

/**
 * The domain a target's level lives in, by unit class (design §4), or `null` when it is unbounded:
 *  · a percentage LEVEL (`isPercentWithPeriod`) on a pinned 100 frame (or already a proportion) → [0, 1];
 *  · a currency amount (the estate's one currency vocabulary) → [0, ∞);
 *  · anything else already on frame 1 (a fraction) → [0, 1];
 *  · percentage points, basis points, a "% change" or an unrecognised unit → unbounded (never questioned).
 *
 * ⚠ A COUNT READS AS UNBOUNDED HERE. The design puts counts on [0, ∞), but the estate has no count vocabulary
 * and the design forbids an inline list, so a count is left unchecked rather than guessed. The PR says so.
 */
export function levelDomain(unit: string | undefined, frame: number): LevelDomain | null {
  const cls = classifyUnitScaleClass(unit);
  if (cls === 'percentage_points' || cls === 'basis_points') return null;
  if (cls === 'percent') return unit !== undefined && isPercentWithPeriod(unit) && (frame === 100 || frame === 1) ? UNIT_INTERVAL : null;
  if (unit !== undefined && readCurrencyUnitWithQualifiers(unit).kind === 'currency') return { lo: 0, hi: Infinity };
  return frame === 1 ? UNIT_INTERVAL : null;
}

/**
 * The target's KNOWN level (normalised), or `undefined`. Olumi's own estimate of the level (`cee_inference`,
 * `extractionType: 'inferred'`) is not a known baseline, so D4 does not run against it.
 */
export function knownBaseline(node: MagnitudeNode): number | undefined {
  const os = node.observed_state;
  if (os === undefined || os.source === 'cee_inference' || os.extractionType === 'inferred') return undefined;
  if (finite(os.baseline)) return os.baseline;
  return finite(os.value) ? os.value : undefined;
}

/**
 * The level the model HOLDS for a target, whoever set it — Olumi's estimate included. Only ever used to SIZE a
 * placeholder to the target's frame (PR1b), never to judge a stated size (that is `knownBaseline`).
 */
export function heldBaseline(node: MagnitudeNode): number | undefined {
  const os = node.observed_state;
  if (os === undefined) return undefined;
  if (finite(os.baseline)) return os.baseline;
  return finite(os.value) ? os.value : undefined;
}

/** A source no option moves (a mediator) may still range over its whole normalised frame: the conservative swing. */
export const FULL_RANGE_SWING: Swing = { lo: -1, hi: 1 };

/** The source's model swing: the normalised change from where it stands to each level an option sets. */
export interface Swing { readonly lo: number; readonly hi: number }

/**
 * `null` when no option moves the source, as for a mediated quantity: its swing is not in the model, so the
 * per-edge bound cannot run (design §4, "per-edge bound skipped").
 *
 * A source with no level of its own stands at 0, the level the engine gives it.
 */
export function sourceSwing(node: MagnitudeNode): Swing | null {
  const levels = node.option_levels.filter(finite);
  if (levels.length === 0) return null;
  const own = node.observed_state?.value;
  const base = finite(own) ? own : 0;
  let lo = 0;
  let hi = 0;
  for (const v of levels) {
    lo = Math.min(lo, v - base);
    hi = Math.max(hi, v - base);
  }
  return lo === 0 && hi === 0 ? null : { lo, hi };
}

/** D2: β, or `null` when the statement or either frame cannot be read. */
export function convertLinkEffect(
  amount: number, perSourceChange: number, targetFrame: number | undefined, sourceFrame: number | undefined,
): number | null {
  if (!finite(amount) || !finite(perSourceChange) || perSourceChange === 0) return null;
  if (targetFrame === undefined || sourceFrame === undefined) return null;
  const beta = (amount / targetFrame) / (perSourceChange / sourceFrame);
  return Number.isFinite(beta) ? beta : null;
}

/** D4: the span of b + (β ± 2σ)·d over the swing's two ends (and no change at all). */
export function domainBand(baseline: number, beta: number, sigma: number, swing: Swing): LevelDomain {
  let lo = baseline;
  let hi = baseline;
  for (const d of [swing.lo, swing.hi]) {
    for (const s of [beta - 2 * sigma, beta + 2 * sigma]) {
      const v = baseline + s * d;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return { lo, hi };
}

/** Representation error only; the design's own boundary case (2|β|·|d| = headroom) is in domain. */
const DOMAIN_EPSILON = 1e-12;
export const withinDomain = (band: LevelDomain, domain: LevelDomain): boolean =>
  band.lo >= domain.lo - DOMAIN_EPSILON && band.hi <= domain.hi + DOMAIN_EPSILON;

/** D6: sign · min(0.5, headroom / (4·|d|)), the headroom taken on the side each end of the swing pushes towards. */
export function frameAwarePlaceholder(sign: 1 | -1, baseline: number, domain: LevelDomain, swing: Swing): number {
  let size: number = STRENGTH_DEFAULT_SIGNATURE.mean;
  for (const d of [swing.lo, swing.hi]) {
    if (d === 0) continue;
    const headroom = sign * d > 0 ? domain.hi - baseline : baseline - domain.lo;
    size = Math.min(size, headroom / (4 * Math.abs(d)));
  }
  return sign * size;
}

export interface LinkStatement {
  readonly direction: 'positive' | 'negative';
  readonly effect_amount?: number | null;
  readonly effect_per_source_change?: number | null;
  /** True when the USER stated the size (never overridden, D7). */
  readonly user_stated: boolean;
}

/**
 * ⭐ THE NATURAL SIZE ON THE EDGE (`provenance.natural_effect`). `amount` of the target (in `unit`) per
 * `per_source_change` of the source (in `source_unit`), as ADMITTED: the placeholder's own value when Olumi's
 * placeholder stands in. `strength_mean` is the signed β it was written for — the staleness key: a reader says the
 * natural phrase ONLY while the edge's mean still equals it, so a copy left behind by a later edit never speaks.
 */
export interface NaturalEffect {
  readonly amount: number;
  /** Each number names its own warrant (CEE's value-warrant guard): a level-scoped `unit` would not say which it attests. */
  readonly amount_unit: string;
  readonly per_source_change: number;
  readonly per_source_change_unit: string;
  readonly strength_mean: number;
  /** `strength_mean` is on the edge's normalised strength frame, never in natural units. */
  readonly strength_mean_frame: 'edge_strength';
}

/** Why a stated size is not what the edge carries, or why it is asked about. */
export type LinkSizeProblem = 'out_of_domain' | 'not_representable' | 'unconvertible' | 'sign_conflict';

export interface LinkSizing {
  /**
   * `unchanged` is today's projection, ±0.5 / 0.125, written exactly as before (no stamp): D6 with nothing to check
   * against, or R6's target with no frame.
   */
  readonly outcome: 'unchanged' | 'estimate' | 'user_stated' | 'placeholder';
  readonly mean: number;
  readonly std: number;
  /** D9. Absent on `unchanged`, which stays byte-identical to today's edge. */
  readonly magnitude?: MagnitudeAuthor;
  /** The stated size in natural units, as the ledger and the questions say it. */
  readonly statement?: string;
  /** The stated size read on the two frames (β), when it converted. */
  readonly stated_strength?: number;
  /**
   * The size the edge CARRIES, said in natural units (contract #70 5845713522 + R&C 5845818897), for the canvas band.
   * Present only when the edge is sized (`estimate`, `user_stated`, `placeholder`) and both frames resolve.
   */
  readonly natural_effect?: NaturalEffect;
  readonly problem?: LinkSizeProblem;
  /** Asked where the user always sees it (`open_questions`). */
  readonly question?: string;
}

const fmt = (x: number): string => String(Number(x.toPrecision(6)));

function isSwitch(node: MagnitudeNode, frame: number | undefined): boolean {
  if (frame !== 1) return false;
  const os = node.observed_state ?? {};
  const levels = [...(finite(os.value) ? [os.value] : []), ...node.option_levels.filter(finite)];
  return levels.length > 0 && levels.every((v) => v === 0 || v === 1);
}

const isPercentLevel = (node: MagnitudeNode, frame: number | undefined): boolean => {
  const unit = unitOf(node);
  return frame === 100 && unit !== undefined && isPercentWithPeriod(unit);
};

function amountWords(amount: number, target: MagnitudeNode, frame: number | undefined): string {
  const n = Math.abs(amount);
  if (isPercentLevel(target, frame)) return `${fmt(n)} point${n === 1 ? '' : 's'}`;
  const unit = unitOf(target);
  return `${fmt(n)}${unit === undefined ? '' : ` ${unit}`}`;
}

function levelWords(level: number, target: MagnitudeNode, frame: number): string {
  const raw = level * frame;
  if (isPercentLevel(target, frame)) return `${fmt(raw)}%`;
  const unit = unitOf(target);
  return `${fmt(raw)}${unit === undefined ? '' : ` ${unit}`}`;
}

function statementWords(
  amount: number, perSourceChange: number, source: MagnitudeNode, target: MagnitudeNode,
  sourceFrame: number | undefined, targetFrame: number | undefined,
): string {
  const unit = unitOf(source);
  const cause = isSwitch(source, sourceFrame) && perSourceChange === 1
    ? `switching on "${source.label}"`
    : `${perSourceChange > 0 ? 'raising' : 'lowering'} "${source.label}" by ${fmt(Math.abs(perSourceChange))}${unit === undefined ? '' : ` ${unit}`}`;
  return `${cause} ${amount < 0 ? 'lowers' : 'raises'} "${target.label}" by ${amountWords(amount, target, targetFrame)}`;
}

const round6 = (x: number): number => Number(x.toPrecision(6));

/** The unit words the natural size is said in: points for a percentage level, "switch" for a yes/no. */
const targetUnitWords = (t: MagnitudeNode, frame: number | undefined): string =>
  isPercentLevel(t, frame) ? 'percentage points' : (unitOf(t) ?? '');
const sourceUnitWords = (s: MagnitudeNode, frame: number | undefined): string =>
  isSwitch(s, frame) ? 'switch' : (unitOf(s) ?? '');

/**
 * The natural size of a strength β the edge carries. A stated size keeps its own `per_source_change`; a placeholder
 * is said per the farthest option move of the source (its swing end with the larger reach). `undefined` when either
 * frame does not resolve, or no source change is known to say it per.
 */
export function naturalEffectOf(
  beta: number, source: MagnitudeNode, target: MagnitudeNode, statedPer: number | undefined,
): NaturalEffect | undefined {
  const targetFrame = resolveMagnitudeFrame(target);
  const sourceFrame = resolveMagnitudeFrame(source);
  if (targetFrame === undefined || sourceFrame === undefined || !finite(beta)) return undefined;
  let per = statedPer;
  if (per === undefined) {
    const swing = sourceSwing(source);
    if (swing === null) return undefined;
    const d = Math.abs(swing.hi) >= Math.abs(swing.lo) ? swing.hi : swing.lo;
    per = d * sourceFrame;
  }
  if (!finite(per) || per === 0) return undefined;
  // D2 inverted: amount / F_T = β · (per / F_S).
  const amount = beta * targetFrame * (per / sourceFrame);
  if (!finite(amount)) return undefined;
  return {
    amount: round6(amount),
    amount_unit: targetUnitWords(target, targetFrame),
    per_source_change: round6(per),
    per_source_change_unit: sourceUnitWords(source, sourceFrame),
    strength_mean: beta,
    strength_mean_frame: 'edge_strength',
  };
}

const HOW_MUCH = (s: MagnitudeNode, t: MagnitudeNode): string => `How much does "${s.label}" change "${t.label}"?`;
const NOT_REPRESENTABLE = 'which is more than the analysis can represent on the ranges these two are measured on';

/**
 * ⭐ D2–D8 FOR ONE LINK. The caller supplies both ends; nothing here reads the rest of the graph.
 *
 * A link with no stated size and nothing to check it against comes back `unchanged`, exactly today's edge, so a
 * draft that states no sizes registers as it always did except where a bounded, known-baseline target lets D6
 * size the placeholder to its frame.
 */
export function sizeLink(link: LinkStatement, source: MagnitudeNode, target: MagnitudeNode): LinkSizing {
  const sign: 1 | -1 = link.direction === 'negative' ? -1 : 1;
  const targetFrame = resolveMagnitudeFrame(target);
  const sourceFrame = resolveMagnitudeFrame(source);
  const amount = link.effect_amount;
  const per = link.effect_per_source_change;
  const stated = finite(amount) && finite(per);
  const beta = stated ? convertLinkEffect(amount, per, targetFrame, sourceFrame) : null;
  const statement = stated ? statementWords(amount, per, source, target, sourceFrame, targetFrame) : undefined;
  const who = link.user_stated ? 'You said' : 'Olumi estimated that';
  // The natural size of what the edge CARRIES; never of an estimate set aside (the placeholder's own is said instead).
  const natural = (b: number, statedPer: number | undefined): { natural_effect?: NaturalEffect } => {
    const n = naturalEffectOf(b, source, target, statedPer);
    return n === undefined ? {} : { natural_effect: n };
  };

  const baseline = knownBaseline(target);
  const domain = targetFrame === undefined ? null : levelDomain(unitOf(target), targetFrame);
  const swing = sourceSwing(source);
  const check = baseline !== undefined && domain !== null && swing !== null && withinDomain({ lo: baseline, hi: baseline }, domain)
    ? { baseline, domain, swing, frame: targetFrame as number }
    : null;
  const today = (c: NonNullable<typeof check>): string => levelWords(c.baseline, target, c.frame);
  /**
   * ⭐ PR1b (#70 5848092404, served CEE 4202cda). D6 SIZES a placeholder; it asserts nothing about the target. So it
   * needs only SOME baseline on a bounded target — Olumi's own estimate included — and a swing: the options' own, or the
   * source's FULL normalised range when no option moves it (a mediator, the served norm into churn). D4, which judges a
   * STATED size, stays known-baseline only (`check` above).
   */
  const held = baseline ?? heldBaseline(target);
  const sizeCheck = check ?? (held !== undefined && domain !== null && withinDomain({ lo: held, hi: held }, domain)
    ? { baseline: held, domain, swing: swing ?? FULL_RANGE_SWING, frame: targetFrame as number }
    : null);

  let problem: LinkSizeProblem | undefined;
  if (stated && beta === null) problem = 'unconvertible';
  else if (beta !== null && (beta === 0 || Math.sign(beta) !== sign)) problem = 'sign_conflict';

  if (beta !== null && problem === undefined) {
    const sigma = Math.abs(beta) / 2;
    const outOfDomain = check !== null && !withinDomain(domainBand(check.baseline, beta, sigma, check.swing), check.domain);
    const issue: LinkSizeProblem | undefined = outOfDomain ? 'out_of_domain' : Math.abs(beta) > 1 ? 'not_representable' : undefined;
    if (link.user_stated) {
      // D7: kept exactly as stated, whatever the frame says; asked about when it cannot hold.
      const question = issue === 'out_of_domain'
        ? `You said ${statement}, but "${target.label}" is ${today(check!)} today, so that cannot hold across your options. `
          + `It is kept exactly as you said it. Should the size of that effect change, or today's level of "${target.label}"?`
        : issue === 'not_representable'
          ? `You said ${statement}, ${NOT_REPRESENTABLE}: it would be cut short. It is kept exactly as you said it. Is that the size you meant?`
          : undefined;
      return {
        outcome: 'user_stated', mean: beta, std: sigma, magnitude: 'user_stated', statement, stated_strength: beta,
        ...natural(beta, per as number),
        ...(issue !== undefined ? { problem: issue, question: question! } : {}),
      };
    }
    if (issue === undefined) {
      return { outcome: 'estimate', mean: beta, std: sigma, magnitude: 'olumi_estimate', statement, stated_strength: beta, ...natural(beta, per as number) };
    }
    // D5 / D8: Olumi's estimate is set aside — never clamped to the boundary.
    problem = issue;
  }

  // D6. A placeholder is sized to the frame only where D4 can run; at a bound with no room on the side the link
  // pushes towards, none can be, and today's projection is kept (and asked about).
  const placeholder = sizeCheck === null ? null : frameAwarePlaceholder(sign, sizeCheck.baseline, sizeCheck.domain, sizeCheck.swing);
  const sized = placeholder !== null && Number.isFinite(placeholder) && placeholder !== 0;
  const standIn = sized ? `a placeholder sized to keep "${target.label}" within its range` : 'a placeholder';

  const question = (() => {
    if (problem === 'out_of_domain') {
      return `Olumi estimated that ${statement}, but "${target.label}" is ${today(check!)} today, so that cannot hold across your `
        + `options and was not used: ${standIn} stands in for it. ${HOW_MUCH(source, target)}`;
    }
    if (problem === 'not_representable') {
      return `Olumi estimated that ${statement}, ${NOT_REPRESENTABLE}, so it was not used: ${standIn} stands in for it. ${HOW_MUCH(source, target)}`;
    }
    if (sizeCheck === null) return undefined;
    if (problem === 'unconvertible') {
      return `${who} ${statement}, but that could not be read on the ranges the two are measured on, so ${standIn} stands in for it. `
        + HOW_MUCH(source, target);
    }
    if (problem === 'sign_conflict') {
      return `${who} ${statement}, which runs the other way from the link's own direction, so it was not used: ${standIn} stands in `
        + `for it. Which way, and by how much, does "${source.label}" change "${target.label}"?`;
    }
    return `${HOW_MUCH(source, target)} Nobody has said, so Olumi uses ${standIn} until you do.`;
  })();
  const said = {
    ...(statement !== undefined ? { statement } : {}),
    ...(beta !== null ? { stated_strength: beta } : {}),
    ...(problem !== undefined ? { problem } : {}),
    ...(question !== undefined ? { question } : {}),
  };

  if (sized) {
    return { outcome: 'placeholder', mean: placeholder, std: Math.abs(placeholder) / 2, magnitude: 'olumi_placeholder', ...said, ...natural(placeholder, undefined) };
  }
  return { outcome: 'unchanged', mean: sign * STRENGTH_DEFAULT_SIGNATURE.mean, std: STRENGTH_DEFAULT_SIGNATURE.std, ...said };
}
