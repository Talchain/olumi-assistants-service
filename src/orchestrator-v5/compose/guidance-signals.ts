/**
 * Wave-2 ask 1 (UI-SEM-085, @talchain/schemas 0.19.0) — the SINGLE source of
 * the producer-owned `category` + `priority` guidance signals.
 *
 * Why one module: the UI measured `category` and `signal_code` as
 * 100% UI-invented on the live path (10/10 blocks defaulted client-side)
 * because no producer contract existed. These two fields are now emitted on
 * every guidance-bearing block CEE produces, and EVERY build site derives
 * them here — a per-site literal would be a hand-maintained mirror, the
 * platform's dominant defect class.
 *
 * Contract (restating the 0.19.0 schema doc):
 *   - `category` is the canonical four-value guidance class
 *     (`must_fix | should_fix | could_fix | technique`). Code-keyed: the
 *     consumer maps values to its own copy.
 *   - `priority` is a COARSE 0–100 urgency score, higher = more urgent,
 *     derived 1:1 from category — ties are expected and normal. It is NOT a
 *     display order: feeds order by `priority_rank` ascending; budget /
 *     filter / style by `priority` and `category`.
 *
 * Exhaustiveness is compile-enforced: the switches below `never`-check their
 * inputs, so a new coaching kind or severity member fails the build here
 * rather than silently taking a default (fail-loud on drift, never
 * assume-good).
 */

import type {
  GuidanceCategoryLiteral,
  Phase3BlockSeverityLiteral,
} from '@talchain/schemas/boundary';

/** The single category → priority map (the 1:1 derivation the schema doc states). */
export const PRIORITY_BY_CATEGORY: Readonly<Record<GuidanceCategoryLiteral, number>> = {
  must_fix: 90,
  should_fix: 70,
  could_fix: 50,
  technique: 30,
};

export interface GuidanceSignals {
  readonly category: GuidanceCategoryLiteral;
  readonly priority: number;
}

function signalsOf(category: GuidanceCategoryLiteral): GuidanceSignals {
  return { category, priority: PRIORITY_BY_CATEGORY[category] };
}

/**
 * Signals for a severity-bearing guidance block (review_card / evidence).
 * The mapping is the ratified severity → category correspondence:
 * critical → must_fix, warning → should_fix, info → could_fix.
 */
export function guidanceSignalsForSeverity(
  severity: Phase3BlockSeverityLiteral,
): GuidanceSignals {
  switch (severity) {
    case 'critical':
      return signalsOf('must_fix');
    case 'warning':
      return signalsOf('should_fix');
    case 'info':
      return signalsOf('could_fix');
    default: {
      const exhaustive: never = severity;
      return exhaustive;
    }
  }
}

/**
 * Severity + derived signals in ONE spread, for severity-bearing block
 * candidates: `...severityWithSignals('warning')` emits `severity`,
 * `category` and `priority` from a single argument, so a build site cannot
 * state a severity and a category that disagree.
 */
export function severityWithSignals(
  severity: Phase3BlockSeverityLiteral,
): { severity: Phase3BlockSeverityLiteral } & GuidanceSignals {
  return { severity, ...guidanceSignalsForSeverity(severity) };
}

/**
 * CoachingBlock coaching_kind vocabulary (v1.3 §1.2). Kept as a local type
 * alias of the schema enum's members so the exhaustiveness check below
 * fails the BUILD when the schema gains a kind this map does not cover.
 */
type CoachingKind =
  | 'orientation'
  | 'widening'
  | 'bias_signal'
  | 'strengthen'
  | 'assumption_check'
  | 'calibration_prompt';

/**
 * Signals for a CoachingBlock (no severity field — `category` is its only
 * producer-owned severity-class signal):
 *   - `orientation` — lifecycle/freshness nudges (the stale-rerun block):
 *     should_fix — acting on it gates every other insight's freshness.
 *   - `bias_signal` — a detected reasoning bias: should_fix.
 *   - `widening` / `strengthen` / `assumption_check` — could_fix
 *     improvements to an already-usable model.
 *   - `calibration_prompt` — a thinking technique, not a defect: technique.
 */
export function guidanceSignalsForCoachingKind(kind: CoachingKind): GuidanceSignals {
  switch (kind) {
    case 'orientation':
    case 'bias_signal':
      return signalsOf('should_fix');
    case 'widening':
    case 'strengthen':
    case 'assumption_check':
      return signalsOf('could_fix');
    case 'calibration_prompt':
      return signalsOf('technique');
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
