/**
 * Wave-2 ask 1 (UI-SEM-085) — the SINGLE source of the producer-owned
 * guidance signals (`category` + `priority` at 0.19.0; `signal_code` + `signal`
 * at 0.20.0/0.21.0, ROADMAP 1.120 residual).
 *
 * Why one module: the UI measured `category` AND `signal_code` as 100%
 * UI-invented on the live path (10/10 blocks). `category`/`priority` were
 * defaulted client-side; `signal_code` was INVENTED from `block.type`
 * ('review_card' / 'coaching' — block TYPES, not codes), so it matched no real
 * detector code (MISSING_BASE_RATE, …). These fields are now emitted by CEE on
 * every guidance-bearing block, and EVERY build site derives them HERE — a
 * per-site literal would be a hand-maintained mirror, the platform's dominant
 * defect class.
 *
 * Contract (restating the schema docs):
 *   - `category` is the canonical four-value guidance class
 *     (`must_fix | should_fix | could_fix | technique`). Code-keyed.
 *   - `priority` is a COARSE 0–100 urgency score derived 1:1 from category.
 *   - `signal_code` is a STABLE machine-readable code naming the producer
 *     SIGNAL (detector CLASS) that generated the item — SCREAMING_SNAKE_CASE
 *     per the platform's code-keyed families. Distinct from `signal_id` (the
 *     per-instance dedupe identity). Derived from card_kind / coaching_kind /
 *     the evidence detector — NOT from severity (severity is display-class,
 *     not provenance: a `narrative` and an `evidence_priority` card can share a
 *     severity yet come from different signals).
 *   - `signal` is a SHORT display line stating what TRIGGERED the item. Emitted
 *     only where a deterministic, non-fabricated line exists for EVERY instance
 *     of the code; otherwise the field is absent (code-only). We NEVER author a
 *     per-kind caption that restates the block type or asserts a graph claim
 *     that may not hold instance-to-instance.
 *
 * Exhaustiveness is compile-enforced two ways: the category switches
 * `never`-check their inputs, and the code maps are keyed `Record<CardKind, …>`
 * / `Record<CoachingKind, …>` over unions DERIVED from the schema — so a new
 * card_kind or coaching_kind on the wire fails the build HERE rather than
 * silently taking a default (fail-loud on drift, never assume-good).
 */

import type {
  CoachingBlock,
  GuidanceCategoryLiteral,
  Phase3BlockSeverityLiteral,
  ReviewCardBlock,
} from '@talchain/schemas/boundary';

/**
 * The discriminating kind unions, DERIVED from the schema block types (not
 * hand-listed): if the schema gains a `card_kind` / `coaching_kind`, the
 * `Record<…>` code maps below fail to compile until it is given a code.
 */
type CardKind = ReviewCardBlock['card_kind'];
type CoachingKind = CoachingBlock['coaching_kind'];

/** The single category → priority map (the 1:1 derivation the schema doc states). */
export const PRIORITY_BY_CATEGORY: Readonly<Record<GuidanceCategoryLiteral, number>> = {
  must_fix: 90,
  should_fix: 70,
  could_fix: 50,
  technique: 30,
};

// ----------------------------------------------------------------------------
// signal_code — the producer-owned signal registry (ROADMAP 1.120 / UI-SEM-085).
//
// Distinctly named `GUIDANCE_SIGNAL_CODES` (NOT `SIGNAL_CODES`) so it can never
// be conflated with the legacy `src/orchestrator/types/guidance-item.ts`
// `SIGNAL_CODES` registry — that path's codes key the dead V2 `guidance_items`
// surface, and two same-named registries would be exactly the same-named-twins
// hazard this platform has been bitten by. Where a legacy code means the SAME
// thing as a V5 signal, we deliberately reuse its STRING value (FRAGILE_RESULT,
// LOW_OPTION_COUNT, STRENGTHEN_ITEM) so there are never two names for one
// meaning; where the V5 taxonomy has no legacy twin, the code is new.
//
// SCREAMING_SNAKE_CASE by the schema's documented convention (signed off by the
// UI workstream 20 Jul 2026); the schema stores an open string and does NOT
// validate casing (the vocabulary stays producer-owned).
export const GUIDANCE_SIGNAL_CODES = {
  // ReviewCard signals (post-analysis decision_review enricher) ---------------
  /** review_card `narrative` — the "How the analysis reads" summary card. NEW. */
  ANALYSIS_NARRATIVE: 'ANALYSIS_NARRATIVE',
  /** review_card `pre_mortem` — a surfaced pre-mortem failure scenario. NEW
   *  (distinct from the legacy TECHNIQUE_PRE_MORTEM, a content-free run-exercise
   *  offer: this card carries the actual failure prose). */
  PRE_MORTEM: 'PRE_MORTEM',
  /** review_card `flip_threshold` — distance-to-flip of the recommendation. NEW. */
  FLIP_THRESHOLD: 'FLIP_THRESHOLD',
  /** review_card `bias` AND coaching `bias_signal` — a detected cognitive bias.
   *  ONE code for both surfaces (post-analysis card + draft-time nudge): same
   *  signal class, so the UI keys one bias icon/grouping off it. NEW. */
  COGNITIVE_BIAS: 'COGNITIVE_BIAS',
  /** review_card `robustness` — result fragility. Legacy twin: reuses the
   *  guidance-item.ts FRAGILE_RESULT value (identical meaning). */
  FRAGILE_RESULT: 'FRAGILE_RESULT',
  /** review_card `evidence_priority` AND evidence blocks — a high-value evidence
   *  gap on a factor (both read decision_review `evidence_enhancements`). ONE
   *  code for both surfaces. NEW (considered legacy HIGH_INFLUENCE_LOW_CONFIDENCE
   *  but rejected — that is a narrower, differently-triggered signal). */
  EVIDENCE_GAP: 'EVIDENCE_GAP',
  /** review_card `assumption` AND coaching `assumption_check` — a load-bearing
   *  assumption to confirm (both read decision_review `key_assumptions`). ONE
   *  code for both surfaces. NEW. */
  ASSUMPTION_CHECK: 'ASSUMPTION_CHECK',
  /** review_card `scenario_context` — a what-if scenario worth considering. NEW. */
  SCENARIO_CONTEXT: 'SCENARIO_CONTEXT',
  // Coaching signals ----------------------------------------------------------
  /** coaching `orientation` (stale-rerun nudge) — the persisted analysis is
   *  stale because the graph changed since it ran. NEW (distinct from the
   *  legacy ANALYSIS_CACHE_SKIPPED, a cache-size informational). */
  STALE_ANALYSIS: 'STALE_ANALYSIS',
  /** coaching `calibration_prompt` — a decision-quality calibration prompt. NEW. */
  CALIBRATION_PROMPT: 'CALIBRATION_PROMPT',
  /** coaching `widening` — widen a thin option set. Legacy twin: reuses the
   *  guidance-item.ts LOW_OPTION_COUNT value. (Taxonomy-complete; no live V5
   *  emitter today — see the emitter note on SIGNAL_CODE_BY_COACHING_KIND.) */
  LOW_OPTION_COUNT: 'LOW_OPTION_COUNT',
  /** coaching `strengthen` — an LLM-identified area to reinforce. Legacy twin:
   *  reuses the guidance-item.ts STRENGTHEN_ITEM value. (No live V5 emitter today.) */
  STRENGTHEN_ITEM: 'STRENGTHEN_ITEM',
} as const;

export type GuidanceSignalCode = (typeof GUIDANCE_SIGNAL_CODES)[keyof typeof GUIDANCE_SIGNAL_CODES];

/**
 * card_kind → signal_code. `Record<CardKind, …>` is exhaustive by construction:
 * a schema card_kind with no code fails the build here.
 */
const SIGNAL_CODE_BY_CARD_KIND: Readonly<Record<CardKind, GuidanceSignalCode>> = {
  narrative: GUIDANCE_SIGNAL_CODES.ANALYSIS_NARRATIVE,
  pre_mortem: GUIDANCE_SIGNAL_CODES.PRE_MORTEM,
  flip_threshold: GUIDANCE_SIGNAL_CODES.FLIP_THRESHOLD,
  bias: GUIDANCE_SIGNAL_CODES.COGNITIVE_BIAS,
  robustness: GUIDANCE_SIGNAL_CODES.FRAGILE_RESULT,
  evidence_priority: GUIDANCE_SIGNAL_CODES.EVIDENCE_GAP,
  assumption: GUIDANCE_SIGNAL_CODES.ASSUMPTION_CHECK,
  scenario_context: GUIDANCE_SIGNAL_CODES.SCENARIO_CONTEXT,
};

/**
 * coaching_kind → signal_code. Exhaustive over the schema union. `widening`
 * and `strengthen` are mapped for taxonomy-completeness (and to reuse their
 * legacy twins) but have no live V5 emitter today — the four emitted kinds are
 * orientation / bias_signal / assumption_check / calibration_prompt.
 */
const SIGNAL_CODE_BY_COACHING_KIND: Readonly<Record<CoachingKind, GuidanceSignalCode>> = {
  orientation: GUIDANCE_SIGNAL_CODES.STALE_ANALYSIS,
  widening: GUIDANCE_SIGNAL_CODES.LOW_OPTION_COUNT,
  bias_signal: GUIDANCE_SIGNAL_CODES.COGNITIVE_BIAS,
  strengthen: GUIDANCE_SIGNAL_CODES.STRENGTHEN_ITEM,
  assumption_check: GUIDANCE_SIGNAL_CODES.ASSUMPTION_CHECK,
  calibration_prompt: GUIDANCE_SIGNAL_CODES.CALIBRATION_PROMPT,
};

/**
 * The evidence detector (`rankEvidenceSources` / decision_review
 * `evidence_enhancements`) has no kind discriminator — it is a single signal
 * class, and it shares EVIDENCE_GAP with the `evidence_priority` review card
 * (both name the same underlying gap).
 */
const SIGNAL_CODE_EVIDENCE: GuidanceSignalCode = GUIDANCE_SIGNAL_CODES.EVIDENCE_GAP;

/**
 * Display `signal` lines, keyed by signal_code so the line is bound to the
 * signal CLASS. Emitted ONLY where a short, deterministic line describes what
 * triggered EVERY instance of the code without authoring a new claim; any code
 * absent here is emitted code-only (the honest default). This copy is
 * display-safe by construction (fixed producer strings — no ids, no doctrine
 * prose) and is subject to UI/A2 copy sign-off with the rest of the vocabulary.
 */
const SIGNAL_LINE_BY_CODE: Partial<Readonly<Record<GuidanceSignalCode, string>>> = {
  // The stale-rerun nudge is emitted ONLY when the source analysis's graph hash
  // differs from the current scenario hash (freshness:'stale'), so this line is
  // deterministically true for every instance. (`orientation` ⇒ the stale-rerun
  // block is the sole emitter of STALE_ANALYSIS today.)
  [GUIDANCE_SIGNAL_CODES.STALE_ANALYSIS]: 'Graph changed since the last analysis',
};

/** `signal_code` plus `signal` iff a deterministic line exists for the code. */
function provenanceOf(
  code: GuidanceSignalCode,
): { signal_code: GuidanceSignalCode } | { signal_code: GuidanceSignalCode; signal: string } {
  const signal = SIGNAL_LINE_BY_CODE[code];
  return signal === undefined ? { signal_code: code } : { signal_code: code, signal };
}

export interface GuidanceSignals {
  readonly category: GuidanceCategoryLiteral;
  readonly priority: number;
}

/** GuidanceSignals plus the signal provenance every emitted block now carries. */
export interface GuidanceSignalsWithProvenance extends GuidanceSignals {
  readonly signal_code: GuidanceSignalCode;
  readonly signal?: string;
}

function signalsOf(category: GuidanceCategoryLiteral): GuidanceSignals {
  return { category, priority: PRIORITY_BY_CATEGORY[category] };
}

/**
 * Signals for a severity-bearing guidance block (review_card / evidence).
 * The mapping is the ratified severity → category correspondence:
 * critical → must_fix, warning → should_fix, info → could_fix. This is the
 * category/priority primitive; signal_code is layered on top per block family
 * (see reviewCardSignals / evidenceSignals), because it is card_kind-derived,
 * not severity-derived.
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
 * ReviewCard: severity + its derived category/priority + the card_kind-derived
 * signal provenance, in ONE spread. `...reviewCardSignals('bias', 'warning')`
 * emits `severity`, `category`, `priority`, `signal_code` (+ `signal` where
 * defined) from a single call, so a build site cannot state a severity and a
 * category that disagree, nor a card_kind and a signal_code that disagree.
 */
export function reviewCardSignals(
  cardKind: CardKind,
  severity: Phase3BlockSeverityLiteral,
): { severity: Phase3BlockSeverityLiteral } & GuidanceSignalsWithProvenance {
  return {
    severity,
    ...guidanceSignalsForSeverity(severity),
    ...provenanceOf(SIGNAL_CODE_BY_CARD_KIND[cardKind]),
  };
}

/**
 * EvidenceBlock: severity + derived category/priority + the single evidence
 * signal_code, in ONE spread (mirrors reviewCardSignals for the kind-less
 * evidence family).
 */
export function evidenceSignals(
  severity: Phase3BlockSeverityLiteral,
): { severity: Phase3BlockSeverityLiteral } & GuidanceSignalsWithProvenance {
  return {
    severity,
    ...guidanceSignalsForSeverity(severity),
    ...provenanceOf(SIGNAL_CODE_EVIDENCE),
  };
}

/**
 * Signals for a CoachingBlock (no severity field — `category` is its only
 * producer-owned severity-class signal), including the coaching_kind-derived
 * signal provenance:
 *   - `orientation` — lifecycle/freshness nudges (the stale-rerun block):
 *     should_fix — acting on it gates every other insight's freshness.
 *   - `bias_signal` — a detected reasoning bias: should_fix.
 *   - `widening` / `strengthen` / `assumption_check` — could_fix
 *     improvements to an already-usable model.
 *   - `calibration_prompt` — a thinking technique, not a defect: technique.
 */
export function guidanceSignalsForCoachingKind(
  kind: CoachingKind,
): GuidanceSignalsWithProvenance {
  let category: GuidanceCategoryLiteral;
  switch (kind) {
    case 'orientation':
    case 'bias_signal':
      category = 'should_fix';
      break;
    case 'widening':
    case 'strengthen':
    case 'assumption_check':
      category = 'could_fix';
      break;
    case 'calibration_prompt':
      category = 'technique';
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  return { ...signalsOf(category), ...provenanceOf(SIGNAL_CODE_BY_COACHING_KIND[kind]) };
}
