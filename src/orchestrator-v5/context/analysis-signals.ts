/**
 * Lane 21 (P0-A) — analysis signal extensions for the ContextPack projection.
 *
 * `AnalysisResponseSummary` (src/orchestrator/context/analysis-compact.ts) is
 * the shared V4/V5 compact shape and deliberately does NOT carry the newer
 * staging-envelope surfaces the orchestrator LLM needs for grounded coaching:
 * evidence-gap VOI, goal-fit scoring basis, and the TOP-LEVEL
 * `enrichment.flip_thresholds[]` (the per-option derivation inside
 * `compactAnalysis` is structurally empty on staging, where `results[]` never
 * carries `factor_sensitivity`). Rather than widening the shared V4 type,
 * this module defines an ADDITIVE intersection type owned by the V5 context
 * layer: producers (analysis-fallback.ts, the turn-executor ingress seam)
 * attach the optional fields; `projectAnalysis` reads them defensively.
 *
 * All values here are RAW (floats allowed) — they live on the handler-facing
 * `ContextPackAnalysis`, never serialised to the LLM directly. Claim-safety
 * doctrine A2 banding happens strictly downstream in
 * `../format/format-analysis-for-context.ts`.
 *
 * Derivation helpers are pure and defensive: they consume the untyped
 * enrichment passthrough (`Record<string, unknown>`) and keep only entries
 * with finite numerics + non-empty labels. Nothing here mutates its input.
 */

import type { AnalysisResponseSummary } from '../../orchestrator/context/analysis-compact.js';

/** Cap for evidence-gap signals carried into the projection. */
export const EVIDENCE_GAP_SIGNAL_CAP = 3;

/** Cap for tipping-point signals carried into the projection. */
export const TIPPING_POINT_SIGNAL_CAP = 3;

/**
 * Lane 30 — cap for per-option goal-fit signals. Numeric parity with
 * `MAX_PROJECTED_OPTIONS` in `./context-pack-assembler.ts` (the assembler
 * imports this module, so the constant cannot be imported from there without
 * a cycle): the goal-fit carriage never needs more entries than the option
 * list it annotates. Parity is pinned FAIL-LOUD (was comment-only, context-
 * audit #1 row #6) by `__tests__/enrichment-manifest.conformance.test.ts` —
 * if `MAX_PROJECTED_OPTIONS` moves, this cap must move with it or the pin
 * goes RED.
 */
export const OPTION_GOAL_FIT_SIGNAL_CAP = 12;

/** Lane 30 fix 3 — cap for per-option outcome signals (same parity note + pin). */
export const OPTION_OUTCOME_SIGNAL_CAP = 12;

/**
 * One factor's tipping information, sourced from the top-level
 * `enrichment.flip_thresholds[]` (staging shape) or, when only the
 * per-option derivation exists, mapped from `summary.flip_thresholds`.
 *
 * `no_flip_within_bounds` is true when the producer explicitly reported
 * that no flip point was found inside the tested range
 * (`flip_reason: 'no_effect_within_bounds'`, `flip_value: null`). That is
 * producer-owned truth worth projecting — it grounds "this result is hard
 * to flip via this factor" — and is NOT the same as "unknown".
 */
export interface TippingPointSignal {
  /**
   * Lane 30 (#369 audit P1) — structural factor id (`factor_id`/`node_id`/
   * `id` off the raw row), carried so the ContextPack projection can
   * suppress option-controlled levers by ID (never by label — labels
   * collide). INTERNAL match key only: never serialised onto the projected
   * `ContextPackAnalysisFlipThreshold`. Null when the raw row carried no
   * id — the consumer FAILS CLOSED on such rows when a controlled-lever
   * set exists. Optional so hand-built legacy signals stay assignable.
   */
  readonly factor_id?: string | null;
  readonly factor_label: string;
  readonly current_value: number | null;
  readonly flip_value: number | null;
  readonly unit: string | null;
  readonly no_flip_within_bounds: boolean;
  /**
   * ROADMAP 2.205 practical resolution (2026-07-31) — THE DISPLAY LICENCE.
   *
   * The producer's own display strings for this factor's current and flip
   * values, carried ONLY when they are display-licensed to the user: see
   * {@link deriveFlipDisplayLicences} for the exact chain. Both present or
   * both absent — a half licence would let the projection say "flips at X"
   * with no anchor, which is a worse claim than the band it replaces.
   *
   * NOT raw floats: these are the strings the producer wrote for the user
   * ("40000 GBP"), not the numbers. The float cage is applied at the display
   * formatter, which is the boundary that owns it.
   */
  readonly current_display?: string | null;
  readonly flip_display?: string | null;
}

/**
 * One evidence gap from `enrichment.m1_coaching.evidence_gaps[]`.
 * `voi_score` is the producer's normalised [0,1] value-of-information
 * score — banded downstream, never surfaced raw.
 */
export interface EvidenceGapSignal {
  /** Lane 30 (#369 audit P1) — see {@link TippingPointSignal.factor_id}. */
  readonly factor_id?: string | null;
  readonly factor_label: string;
  readonly voi_score: number;
}

/**
 * Goal-fit scoring provenance (PLoT #204). Projects THE FACT that goal fit
 * was scored and its basis — never raw goal-fit probabilities.
 */
export interface GoalFitSignal {
  readonly scored: boolean;
  readonly basis: string | null;
}

/**
 * Lane 30 — one option's goal-fit VALUE, sourced from the per-option
 * `enrichment.option_comparison[].probability_of_joint_goal` (PLoT #204 live
 * shape; delivered alongside `goal_fit_basis`). This is the field whose
 * absence from the ContextPack caused the verified live defect (scenario
 * 90385279): asked how each option looked against a 25% target, the LLM
 * framed WIN probabilities as target-fit ("leads comfortably at 89%") while
 * the delivered `probability_of_joint_goal` was 29.3%.
 *
 * `probability_of_joint_goal` is RAW (a [0,1] float) — it lives on the
 * handler-facing projection only; the display formatter renders it as an
 * integer-percent `target_fit` string, clearly distinguished from win%.
 *
 * `option_id` is the structural match key (the consumer relabels options
 * from the current graph, so label equality is not identity); null only when
 * the enrichment row carried no id at all — the consumer then falls back to
 * label matching.
 */
export interface OptionGoalFitSignal {
  readonly option_id: string | null;
  readonly option_label: string;
  readonly probability_of_joint_goal: number;
}

/**
 * Lane 30 fix 3 — one option's modelled-outcome mean, sourced from the
 * per-option `enrichment.option_comparison[].outcome.mean` (nested staging
 * shape) or the flat `outcome_mean`. RAW float — banded downstream into an
 * `outcome_band` phrase (shared influence-band vocabulary), never surfaced
 * as a number.
 *
 * Derived from the enrichment (NOT from `OptionSummary.outcome_mean`)
 * deliberately: the compact summary DEFAULTS missing outcome means to 0, so
 * a summary-side read cannot distinguish an honest zero from a fabricated
 * default — banding a fabricated 0 as "roughly neutral" would be a false
 * claim. Presence in the raw enrichment row is the honesty predicate.
 */
export interface OptionOutcomeSignal {
  readonly option_id: string | null;
  readonly option_label: string;
  readonly outcome_mean: number;
}

/**
 * Optional signal extensions a producer may attach to an
 * `AnalysisResponseSummary` before it reaches the ContextPack assembler.
 */
export interface AnalysisSummarySignals {
  readonly tipping_points?: readonly TippingPointSignal[];
  readonly evidence_gaps?: readonly EvidenceGapSignal[];
  readonly goal_fit?: GoalFitSignal | null;
  /** Lane 30 — per-option goal-fit values (see {@link OptionGoalFitSignal}). */
  readonly option_goal_fits?: readonly OptionGoalFitSignal[];
  /** Lane 30 fix 3 — per-option modelled-outcome means (see {@link OptionOutcomeSignal}). */
  readonly option_outcomes?: readonly OptionOutcomeSignal[];
  /**
   * Lane 30 fix 3 — top-level ordinal confidence tier (PLoT: derived from
   * `m1_coaching.readiness`; attested values 'strong' | 'fair' |
   * 'needs_work', but the enrichment passthrough is untyped so this stays
   * a string). Already on the compose transport keep-list; rendered as
   * prose by the display formatter.
   */
  readonly confidence_tier?: string | null;
}

/** The summary shape `projectAnalysis` actually consumes. */
export type AnalysisResponseSummaryWithSignals = AnalysisResponseSummary &
  AnalysisSummarySignals;

// ---------------------------------------------------------------------------
// Derivations from the raw enrichment passthrough (staging envelope shape)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readLabel(entry: Record<string, unknown>): string | null {
  const candidates = [entry.factor_label, entry.label];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return null;
}

/**
 * Lane 30 (#369 audit P1) — read the structural factor id off a raw
 * enrichment row. TRUE ids only (`factor_id`/`node_id`/`id`); a label is
 * never promoted to an id (labels collide — a label-as-id would let a
 * lever's label suppress an unrelated factor, or fail to suppress the
 * lever). Null when the row carries none.
 */
function readFactorId(entry: Record<string, unknown>): string | null {
  const candidates = [entry.factor_id, entry.node_id, entry.id];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return null;
}

/**
 * ROADMAP 2.205 practical resolution (2026-07-31) — the flip-point DISPLAY
 * LICENCE, derived at the bytes rather than assumed.
 *
 * THE RULE (adjudicated; orchestrator, Paul veto open): *a number already
 * display-licensed to the USER on the same turn is speakable by the coach —
 * same licence, same register. The Tier-3 deny continues to bind any value NOT
 * shown to the user.* This function is the "shown to the user" half; it must
 * therefore be a TRACE, never a guess.
 *
 * THE CHAIN, hop by hop:
 *   1. `enrichment.decision_review.flip_thresholds[]` is the array
 *      `buildFlipThresholdCards` (compose/phase3-blocks.ts:1799) consumes.
 *   2. For each row it composes a `review_card` whose BODY is that row's
 *      `narrative`, verbatim (`:1843`).
 *   3. The producing prompt (prompts/defaults.ts:1412-1424) ORDERS that
 *      narrative to restate the values: *"Frame as 'If [factor_label] moves
 *      from [current] to [flip], the result changes.' Include the unit if
 *      provided"* — and orders `current_display` / `flip_display` to carry
 *      `current_value` / `flip_value` *"as-is, appended with unit … Do not
 *      round, abbreviate … Output the number exactly as provided."*
 *   4. CEE's own byte-check note records the consequence:
 *      *"buildFlipThresholdCards ships narratives the prompt ORDERS to restate
 *      unrounded flip values"* (phase3-blocks.ts:1476-1478).
 *
 * So a row with a non-empty `narrative` put those digits on the user's screen,
 * and `current_display` / `flip_display` are their structured form.
 *
 * FAIL-CLOSED, in every direction that matters:
 *   - the JOIN IS ON THE DETERMINISTIC `factor_id`. The caller keys this map
 *     with the id off PLoT's own `enrichment.flip_thresholds[]` row, so a
 *     producer that invented a factor_id simply fails to join and licenses
 *     nothing. Labels are never used — labels collide.
 *   - `narrative` must be non-empty: it is the necessary condition for a card
 *     to exist at all, and it is the carrier the user actually reads.
 *   - both display strings must be present and non-empty. Bounded at
 *     {@link FLIP_DISPLAY_MAX_CHARS} — a producer-authored string of arbitrary
 *     length must not be able to move the display-analysis char budget.
 *   - first occurrence per factor wins (the producer orders by importance).
 *
 * ⚠ ONE RESIDUAL, STATED RATHER THAN PAPERED OVER. `buildFlipThresholdCards`
 * ALSO drops a row when `lookup.get(factor_id)` misses the canonical graph
 * (`:1827-1836`). This function cannot see that lookup — it has the enrichment,
 * not the graph. So a factor present in PLoT's deterministic array but absent
 * from the graph the pack is built over (analysis older than the graph) would
 * be licensed here while its card was dropped. The join direction contains the
 * common case (a fabricated id never joins); this residual is graph-drift only,
 * and it is a narrowing of the card set, not of the value's truth. Reported,
 * not improvised around: closing it means threading the node lookup into pack
 * assembly, which is a larger change than this one.
 */
export const FLIP_DISPLAY_MAX_CHARS = 40;

/** One factor's display-licensed current/flip pair. */
export interface FlipDisplayLicence {
  readonly current_display: string;
  readonly flip_display: string;
}

function readLicensedDisplay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > FLIP_DISPLAY_MAX_CHARS) return null;
  return trimmed;
}

export function deriveFlipDisplayLicences(
  enrichment: Record<string, unknown>,
): Map<string, FlipDisplayLicence> {
  const out = new Map<string, FlipDisplayLicence>();
  const dr = asRecord(enrichment.decision_review);
  if (dr === null) return out;
  const rows = dr.flip_thresholds;
  if (!Array.isArray(rows)) return out;

  for (const item of rows) {
    const row = asRecord(item);
    if (row === null) continue;
    const factorId = readFactorId(row);
    if (factorId === null || out.has(factorId)) continue;
    // The card's BODY. No narrative ⇒ `buildFlipThresholdCards` drops the row
    // (`:1819`) ⇒ nothing was shown ⇒ no licence. Length is deliberately NOT
    // bounded here: the narrative is a PREDICATE, never carried into the pack.
    const narrative = typeof row.narrative === 'string' ? row.narrative.trim() : '';
    if (narrative.length === 0) continue;
    const currentDisplay = readLicensedDisplay(row.current_display);
    const flipDisplay = readLicensedDisplay(row.flip_display);
    if (currentDisplay === null || flipDisplay === null) continue;
    out.set(factorId, { current_display: currentDisplay, flip_display: flipDisplay });
  }
  return out;
}

/**
 * Derive tipping-point signals from the TOP-LEVEL `enrichment.flip_thresholds[]`
 * (the staging shape — entries carry `{factor_id, factor_label, current_value,
 * flip_value, unit, flip_reason}`; `flip_value` is null when no flip exists in
 * the tested range). Entries are kept when they either carry a finite
 * current+flip pair (a real tipping point) or an explicit
 * `no_effect_within_bounds` reason (a producer-attested no-flip). Everything
 * else — malformed rows, unlabelled rows — is dropped. Deduped by label,
 * first occurrence wins (upstream orders by importance). Capped at
 * {@link TIPPING_POINT_SIGNAL_CAP}.
 */
export function deriveTippingPointsFromTopLevel(
  enrichment: Record<string, unknown>,
): TippingPointSignal[] {
  const raw = enrichment.flip_thresholds;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // ROADMAP 2.205 practical resolution — the display licence, keyed by the
  // DETERMINISTIC factor_id of the row we are about to project.
  const licences = deriveFlipDisplayLicences(enrichment);

  const out: TippingPointSignal[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const label = readLabel(entry);
    if (label === null || seen.has(label)) continue;

    const currentValue =
      typeof entry.current_value === 'number' && Number.isFinite(entry.current_value)
        ? entry.current_value
        : null;
    const flipValue =
      typeof entry.flip_value === 'number' && Number.isFinite(entry.flip_value)
        ? entry.flip_value
        : typeof entry.flip_threshold === 'number' && Number.isFinite(entry.flip_threshold)
          ? entry.flip_threshold
          : null;
    const noFlip =
      flipValue === null && entry.flip_reason === 'no_effect_within_bounds';

    // Keep only rows that assert something: a real flip pair, or an explicit
    // producer-attested no-flip. Ambiguous rows (flip null, no reason) are
    // dropped rather than projected as a claim.
    const hasFlipPair = currentValue !== null && flipValue !== null;
    if (!hasFlipPair && !noFlip) continue;

    const unit = typeof entry.unit === 'string' && entry.unit.length > 0 ? entry.unit : null;
    const factorId = readFactorId(entry);
    // A producer-attested no-flip has no flip value to display, so it gets no
    // licence regardless of what decision_review wrote: "flips at X" alongside
    // "no flip point found within the tested range" would be two states in one
    // entry. Only a REAL flip pair can carry the pair.
    const licence = hasFlipPair && factorId !== null ? licences.get(factorId) : undefined;
    seen.add(label);
    out.push({
      factor_id: factorId,
      factor_label: label,
      current_value: currentValue,
      flip_value: flipValue,
      unit,
      no_flip_within_bounds: noFlip,
      ...(licence !== undefined
        ? { current_display: licence.current_display, flip_display: licence.flip_display }
        : {}),
    });
    if (out.length >= TIPPING_POINT_SIGNAL_CAP) break;
  }
  return out;
}

/**
 * Derive evidence-gap signals from `enrichment.m1_coaching.evidence_gaps[]`
 * (staging shape — entries carry `{factor_label, voi_score, ...}` with
 * `voi_score` normalised to [0,1]). Keeps only labelled entries with a
 * finite non-negative `voi_score`; preserves upstream order (already ranked
 * by VOI); deduped by label; capped at {@link EVIDENCE_GAP_SIGNAL_CAP}.
 */
export function deriveEvidenceGapsFromEnrichment(
  enrichment: Record<string, unknown>,
): EvidenceGapSignal[] {
  const coaching = asRecord(enrichment.m1_coaching);
  if (coaching === null) return [];
  const raw = coaching.evidence_gaps;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const out: EvidenceGapSignal[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const label = readLabel(entry);
    if (label === null || seen.has(label)) continue;
    const voi =
      typeof entry.voi_score === 'number' && Number.isFinite(entry.voi_score) && entry.voi_score >= 0
        ? entry.voi_score
        : null;
    if (voi === null) continue;
    seen.add(label);
    out.push({ factor_id: readFactorId(entry), factor_label: label, voi_score: voi });
    if (out.length >= EVIDENCE_GAP_SIGNAL_CAP) break;
  }
  return out;
}

const GOAL_FIT_NOTE_CODE = 'CONSTRAINT_GOALFIT_MODELLED_BASIS';

/**
 * Scan an array of note/critique-shaped entries for the goal-fit basis code.
 */
function notesCarryGoalFitCode(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some((item) => {
    if (typeof item === 'string') return item === GOAL_FIT_NOTE_CODE;
    const entry = asRecord(item);
    if (entry === null) return false;
    return entry.code === GOAL_FIT_NOTE_CODE;
  });
}

/**
 * Read a `goal_fit_basis`-shaped record and return its `scored_from` string
 * when present.
 */
function readGoalFitBasis(value: unknown): GoalFitSignal | null {
  const basis = asRecord(value);
  if (basis === null) return null;
  const scoredFrom =
    typeof basis.scored_from === 'string' && basis.scored_from.trim().length > 0
      ? basis.scored_from
      : null;
  return { scored: true, basis: scoredFrom };
}

/**
 * Derive the goal-fit scoring provenance (PLoT #204) from the enrichment.
 * Sources, in priority order:
 *   1. top-level `enrichment.goal_fit_basis.scored_from`
 *   2. per-option `option_comparison[].goal_fit_basis` /
 *      `option_comparison[].constraint_delivery.goal_fit_basis`
 *   3. a `CONSTRAINT_GOALFIT_MODELLED_BASIS` code in top-level
 *      `notes[]` / `critiques[]` (basis defaults to
 *      'modelled_outcome_distribution' — the only basis that note attests)
 *
 * Returns null when nothing attests that goal fit was scored — the
 * projection then omits the field entirely (no fabricated claim).
 */
export function deriveGoalFitFromEnrichment(
  enrichment: Record<string, unknown>,
): GoalFitSignal | null {
  const topLevel = readGoalFitBasis(enrichment.goal_fit_basis);
  if (topLevel !== null) return topLevel;

  const oc = enrichment.option_comparison;
  if (Array.isArray(oc)) {
    for (const item of oc) {
      const entry = asRecord(item);
      if (entry === null) continue;
      const direct = readGoalFitBasis(entry.goal_fit_basis);
      if (direct !== null) return direct;
      const delivery = asRecord(entry.constraint_delivery);
      if (delivery !== null) {
        const nested = readGoalFitBasis(delivery.goal_fit_basis);
        if (nested !== null) return nested;
      }
    }
  }

  if (notesCarryGoalFitCode(enrichment.notes) || notesCarryGoalFitCode(enrichment.critiques)) {
    return { scored: true, basis: 'modelled_outcome_distribution' };
  }

  return null;
}

/** Read the option identity fields off an `option_comparison[]` entry. */
function readOptionIdentity(
  entry: Record<string, unknown>,
): { id: string | null; label: string | null } {
  const id =
    typeof entry.option_id === 'string' && entry.option_id.trim().length > 0
      ? entry.option_id
      : typeof entry.id === 'string' && entry.id.trim().length > 0
        ? entry.id
        : null;
  const labelRaw = [entry.option_label, entry.label].find(
    (c): c is string => typeof c === 'string' && c.trim().length > 0,
  );
  return { id, label: labelRaw ?? null };
}

/**
 * Lane 30 fix 3 — derive the top-level confidence tier. Non-empty string
 * only; anything else (absent, blank, non-string) returns null so the
 * projection omits the field rather than fabricating a tier.
 */
export function deriveConfidenceTierFromEnrichment(
  enrichment: Record<string, unknown>,
): string | null {
  const raw = enrichment.confidence_tier;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Lane 30 fix 3 — derive per-option modelled-outcome means from
 * `enrichment.option_comparison[]`. Reads the nested `outcome.mean` (live
 * staging shape) or the flat `outcome_mean`; keeps finite numbers only. A
 * row with NO outcome data is dropped — never defaulted to 0 (see
 * {@link OptionOutcomeSignal}). Identity, dedupe and cap rules mirror
 * {@link deriveOptionGoalFitsFromEnrichment}.
 */
export function deriveOptionOutcomesFromEnrichment(
  enrichment: Record<string, unknown>,
): OptionOutcomeSignal[] {
  const raw = enrichment.option_comparison;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const out: OptionOutcomeSignal[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const outcomeObj = asRecord(entry.outcome);
    const mean =
      typeof entry.outcome_mean === 'number' && Number.isFinite(entry.outcome_mean)
        ? entry.outcome_mean
        : outcomeObj !== null &&
            typeof outcomeObj.mean === 'number' &&
            Number.isFinite(outcomeObj.mean)
          ? outcomeObj.mean
          : null;
    if (mean === null) continue;
    const { id, label } = readOptionIdentity(entry);
    if (id === null && label === null) continue;
    const dedupeKey = id !== null ? `id:${id}` : `label:${label}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ option_id: id, option_label: label ?? id!, outcome_mean: mean });
    if (out.length >= OPTION_OUTCOME_SIGNAL_CAP) break;
  }
  return out;
}

/**
 * Lane 30 — derive per-option goal-fit signals from
 * `enrichment.option_comparison[]` (PLoT #204 live shape: entries carry
 * `probability_of_joint_goal` + `goal_fit_basis`; see the staging capture in
 * `acceptance-evidence/goal-fit/`). Defensive rules:
 *
 *   - `probability_of_joint_goal` must be a finite number in [0,1] —
 *     anything else drops the row (no false probability is ever projected).
 *   - a row must carry SOME option identity (`option_id`/`id` or
 *     `option_label`/`label`); unidentifiable rows are dropped.
 *   - deduped by id (or label when id is absent), first occurrence wins.
 *   - capped at {@link OPTION_GOAL_FIT_SIGNAL_CAP}.
 *
 * Values stay RAW here (handler-facing carriage); percent-string banding is
 * the display formatter's job.
 */
export function deriveOptionGoalFitsFromEnrichment(
  enrichment: Record<string, unknown>,
): OptionGoalFitSignal[] {
  const raw = enrichment.option_comparison;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const out: OptionGoalFitSignal[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const value = entry.probability_of_joint_goal;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      continue;
    }
    const { id, label } = readOptionIdentity(entry);
    if (id === null && label === null) continue;
    const dedupeKey = id !== null ? `id:${id}` : `label:${label}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      option_id: id,
      option_label: label ?? id!,
      probability_of_joint_goal: value,
    });
    if (out.length >= OPTION_GOAL_FIT_SIGNAL_CAP) break;
  }
  return out;
}
