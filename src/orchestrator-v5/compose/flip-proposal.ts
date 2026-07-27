/**
 * V5 P0.2 — flip-threshold → `set_factor_value` proposal builder (Seam 1).
 *
 * Pure. Turns one flip-threshold entry (from `enrichment.flip_thresholds[]`)
 * into a `ProposedChange` the caller emits via `emitProposedChange()`, or
 * skips it. NEVER improvises: when the value cannot be inverted to a
 * user-scale number AND displayed safely, it returns a typed skip.
 *
 * SCALE / INVERSION — governed by the PLoT `value_scale` boundary signal
 * (see `Docs/v5/cee-plot-flip-value-scale-contract.md`):
 *   - `value_scale: "display"` — `flip_value` is ALREADY a user-unit value
 *     (e.g. `6.055 story_points`, build `964fa37`). The user-scale value is
 *     `flip_value` itself; we do NOT multiply by `cap`. The action payload
 *     stores the EXACT value; the chip copy may round to one decimal for
 *     readability and MUST then say "around …" (honest-approximate), so
 *     display === meaning while the executed threshold stays exact.
 *   - `value_scale: "model"` (or absent-but-unambiguous: uncapped, or a
 *     capped value in `[0,1]`) — legacy MODEL-scale. Invert to user-scale
 *     via `rawInput = flip_value * cap` (capped) / `rawInput = flip_value`
 *     (uncapped). Here display === executed EXACTLY (whole numbers only;
 *     no rounding), proven against the real `normaliseFactorValue`.
 *   - absent-and-ambiguous (a capped value outside `[0,1]` with no signal)
 *     or an unrecognised scale → FAIL CLOSED (`ambiguous_scale`): we never
 *     guess whether an out-of-`[0,1]` capped number is model or display.
 *   - `set_factor_value` normalises USER-scale input to model via
 *     `value = rawInput / cap` (capped) or `value = rawInput` (uncapped)
 *     — see `d1-shared/normalise-factor-value.ts`.
 *
 * COPY is provenance-safe: a threshold TEST, never a guarantee. We emit
 * "Test X at N" / "Check whether X at N changes the result." — never
 * "this will flip the result".
 */

import type {
  ProposedChange,
  ProposedChangeContext,
} from '../types/proposed-change.js';
import { emitProposedChange } from './proposed-change.js';
import type { SuggestedAction } from './types.js';
import type { PendingAction } from '../session/pending-action.js';
import { formatFactorValue, formatFactorValueApprox } from './format-factor-value.js';

/** One entry read defensively from `enrichment.flip_thresholds[]`. */
export interface FlipEntry {
  readonly factor_id: string;
  readonly factor_label: string;
  /**
   * The value at which the result flips. `null` ⇒ no flip found. The SCALE of
   * this number is governed by {@link FlipEntry.value_scale}: when `"display"`
   * it is already a user-unit value (e.g. `6.055 story_points`); when `"model"`
   * or absent-but-in-`[0,1]` it is the legacy model-scale value.
   */
  readonly flip_value: number | null | undefined;
  readonly direction?: string | null;
  readonly unit?: string | null;
  /**
   * PLoT's authoritative scale signal for `flip_value` / `current_value`:
   *   - `"display"` — already a user-unit value; do NOT multiply by `cap`.
   *   - `"model"`   — normalised `[0,1]`; invert via `× cap` (legacy).
   *   - absent      — legacy; treated as model-scale only when unambiguous
   *                   (uncapped, or capped value in `[0,1]`).
   * See `Docs/v5/cee-plot-flip-value-scale-contract.md`.
   */
  readonly value_scale?: string | null;
  /**
   * PLoT's reason a `flip_value` is `null`. The honest `what_would_flip`
   * copy ladder reads `'no_effect_within_bounds'` to say no single-factor
   * tipping point was found within the tested range — instead of implying
   * a flip exists. `null` when not provided. (Additive: existing
   * proposal-seam consumers do not read it.)
   */
  readonly flip_reason?: string | null;
  /**
   * Whether this entry's `margin_sensitivity` block carries EVIDENCE of
   * real movement — NOT mere presence. PLoT emits a `margin_sensitivity`
   * object that reports `movement: 'none'` / `strongest_delta: null` when
   * probing found no movement, so the key being present is not support.
   * `true` only when `margin_sensitivity.movement` is a non-empty value
   * other than `'none'`, or `strongest_delta_abs > 0`. Gates the
   * "small changes could flip the result" copy. (Additive.)
   */
  readonly margin_supports_flip?: boolean;
  /**
   * IDENTITY of the option PLoT computed would lead if this factor crossed its
   * tipping point. `null` when no flip was found (PLoT emits the key on EVERY
   * row — `DenormalisedFlipThreshold.alternative_winner_id: string | null` — so
   * absent means a pre-contract producer, not "no winner"). This is the
   * AUTHORITATIVE identity; never re-derive it from a label.
   */
  readonly alternative_winner_id?: string | null;
  /**
   * PLoT's DISPLAY label for {@link FlipEntry.alternative_winner_id}. Carried
   * alongside the id, never instead of it.
   *
   * ⚠ It is NOT safe to treat this as a display name on its own: PLoT's
   * `resolveLabel` (`src/lib/flip-threshold-denormaliser.ts`) falls back to
   * **the raw option id** when the id is absent from its `options` list
   * (`return option?.label ?? optionId`). A label-only reader therefore cannot
   * tell a real label from an echoed internal token. Use
   * {@link resolveAlternativeWinner}, which anchors on the id and refuses to
   * hand back an unsafe display.
   */
  readonly alternative_winner_label?: string | null;
}

/** The factor's graph node info needed to invert + display safely. */
export interface FactorNodeInfo {
  readonly cap?: number | null;
  readonly unit?: string | null;
}

export type FlipProposalSkipReason =
  | 'no_flip_value'
  | 'factor_not_in_graph'
  | 'empty_label'
  | 'cap_non_positive'
  | 'model_value_out_of_range'
  | 'display_value_exceeds_cap'
  | 'ambiguous_scale'
  | 'unrenderable_value';

export type FlipProposalResult =
  | { readonly ok: true; readonly proposal: ProposedChange }
  | { readonly ok: false; readonly reason: FlipProposalSkipReason };

/**
 * Build a safe `set_factor_value` ProposedChange from one flip entry, or
 * return a typed skip. The caller passes the factor's graph node info
 * (cap/unit from `observed_state`) so the model→user inversion uses the
 * SAME cap the handler will normalise against at execute time (the
 * graph-hash precondition on the pending action guards against drift).
 */
export function buildFlipProposal(
  entry: FlipEntry,
  node: FactorNodeInfo | undefined,
): FlipProposalResult {
  const flip = entry.flip_value;
  if (flip === null || flip === undefined || !Number.isFinite(flip)) {
    return { ok: false, reason: 'no_flip_value' };
  }
  if (!node) {
    return { ok: false, reason: 'factor_not_in_graph' };
  }
  const label = entry.factor_label?.trim() ?? '';
  if (label.length === 0) {
    return { ok: false, reason: 'empty_label' };
  }

  const unit = entry.unit ?? node.unit ?? null;
  const cap = node.cap ?? null;
  // Cap-positivity is scale-independent and must hold for either path.
  if (cap !== null && !(cap > 0)) {
    return { ok: false, reason: 'cap_non_positive' };
  }

  const scale = classifyValueScale(entry.value_scale, flip, cap);
  if (scale === 'ambiguous') {
    return { ok: false, reason: 'ambiguous_scale' };
  }
  return scale === 'display'
    ? buildFromDisplayScale(flip, unit, cap, label, entry.factor_id)
    : buildFromModelScale(flip, unit, cap, label, entry.factor_id);
}

/**
 * Decide whether `flip_value` is on the user-display scale or the legacy
 * model scale. `value_scale` is authoritative; when absent we fall back to
 * the only unambiguous legacy case (uncapped, where model === user, or a
 * capped value already inside `[0,1]`). Anything else fails closed.
 */
function classifyValueScale(
  valueScale: string | null | undefined,
  flip: number,
  cap: number | null,
): 'display' | 'model' | 'ambiguous' {
  const s = typeof valueScale === 'string' ? valueScale.trim().toLowerCase() : '';
  if (s === 'display') return 'display';
  if (s === 'model') return 'model';
  if (s.length > 0) return 'ambiguous'; // present but unrecognised → fail closed
  // Absent (legacy / pre-contract). Uncapped: model === user, so the value is
  // unambiguous. Capped: legacy model values live in [0,1]; a capped value
  // outside [0,1] with no signal could be an unsignalled display value, so we
  // refuse to guess.
  if (cap === null) return 'model';
  return flip >= 0 && flip <= 1 ? 'model' : 'ambiguous';
}

/**
 * Legacy MODEL-scale path. `flip` is normalised `[0,1]` for a capped factor;
 * invert to user-scale and render EXACTLY (whole numbers only — never round).
 */
function buildFromModelScale(
  flip: number,
  unit: string | null,
  cap: number | null,
  label: string,
  factorId: string,
): FlipProposalResult {
  let rawInput: number;
  if (cap !== null) {
    // A capped factor's model value lives in [0, 1]; anything else is not on
    // the scale we expect — skip rather than invert into an out-of-range raw.
    if (flip < 0 || flip > 1) return { ok: false, reason: 'model_value_out_of_range' };
    rawInput = flip * cap;
  } else {
    rawInput = flip; // uncapped: model value === user value
  }

  const rendered = formatFactorValue(rawInput, unit);
  if (rendered === null) {
    // Includes the non-integer case: the exact formatter skips rather than
    // rounding, so a fractional user-scale value never gets emitted here.
    return { ok: false, reason: 'unrenderable_value' };
  }

  // Execute the EXACT value the user sees (display === execution; the
  // formatter guarantees a whole number, never a rounded one).
  const execRaw = rendered.value;
  const params: Readonly<Record<string, unknown>> =
    cap !== null
      ? { value: { value: execRaw, cap } } // capped: handler stores model = execRaw / cap
      : { value: execRaw }; // uncapped: handler stores model = execRaw

  return {
    ok: true,
    proposal: {
      intent: 'set_factor_value',
      label: `Test ${label} at ${rendered.display}`,
      message: `Check whether ${label} at ${rendered.display} changes the result.`,
      params,
      target_entity_ids: [factorId],
    },
  };
}

/**
 * DISPLAY-scale path (PLoT `value_scale: "display"`). `flip` is ALREADY the
 * user-unit value (e.g. `6.055 story_points`) — do NOT multiply by `cap`. The
 * action payload stores the EXACT value; the chip copy rounds to one decimal
 * for readability and says "around …" whenever rounding changed it, so the
 * executed threshold stays precise while the wording is honest.
 */
function buildFromDisplayScale(
  flip: number,
  unit: string | null,
  cap: number | null,
  label: string,
  factorId: string,
): FlipProposalResult {
  if (cap !== null) {
    // The exact user value must round-trip through the handler's cap-range
    // guard (user ∈ [0, cap] ⟺ model ∈ [0,1]); a display value above cap would
    // be rejected at execute, so skip it now rather than emit an un-appliable
    // proposal.
    if (flip < 0 || flip > cap) return { ok: false, reason: 'display_value_exceeds_cap' };
  } else if (flip < 0) {
    return { ok: false, reason: 'unrenderable_value' };
  }

  const approx = formatFactorValueApprox(flip, unit);
  if (approx === null) {
    return { ok: false, reason: 'unrenderable_value' };
  }

  // Store the EXACT (unrounded) user value; the displayed value is only copy.
  const params: Readonly<Record<string, unknown>> =
    cap !== null ? { value: { value: flip, cap } } : { value: flip };

  const phrase = approx.approximate ? `around ${approx.display}` : approx.display;
  return {
    ok: true,
    proposal: {
      intent: 'set_factor_value',
      label: `Test ${label} at ${phrase}`,
      message: `Check whether ${label} at ${phrase} changes the result.`,
      params,
      target_entity_ids: [factorId],
    },
  };
}

/**
 * Read PLoT's `value_scale` from a flip-threshold row. The contract permits it
 * at the row top level; the current PLoT build (`964fa37`) nests it under
 * `margin_sensitivity.value_scale`, so we check both. Top level wins.
 * Returns null when neither is a string.
 */
function readValueScale(r: Record<string, unknown>): string | null {
  if (typeof r.value_scale === 'string') return r.value_scale;
  const ms = r.margin_sensitivity;
  if (ms && typeof ms === 'object') {
    const nested = (ms as Record<string, unknown>).value_scale;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

/**
 * Does a flip-threshold row's `margin_sensitivity` carry EVIDENCE of real
 * movement? Presence alone is not enough — PLoT emits a `margin_sensitivity`
 * object that reports `movement: 'none'` / `strongest_delta: null` when
 * probing found no movement (observed live on staging build `cef69b0`,
 * scenario `e22aa97b`). The honest-copy gate (do not imply "small changes
 * could flip the result") must therefore read the CONTENT, not the key.
 */
function readMarginSupportsFlip(r: Record<string, unknown>): boolean {
  const ms = r.margin_sensitivity;
  if (!ms || typeof ms !== 'object') return false;
  const m = ms as Record<string, unknown>;
  const movement = typeof m.movement === 'string' ? m.movement.toLowerCase().trim() : null;
  if (movement !== null && movement.length > 0 && movement !== 'none') return true;
  const strongestAbs =
    typeof m.strongest_delta_abs === 'number' ? m.strongest_delta_abs : null;
  return strongestAbs !== null && Number.isFinite(strongestAbs) && strongestAbs > 0;
}

/**
 * Read `enrichment.flip_thresholds[]` defensively into typed FlipEntry[].
 * Tolerates the opaque enrichment shape; drops malformed rows.
 */
export function readFlipEntries(enrichment: unknown): FlipEntry[] {
  if (!enrichment || typeof enrichment !== 'object') return [];
  const arr = (enrichment as Record<string, unknown>).flip_thresholds;
  if (!Array.isArray(arr)) return [];
  const out: FlipEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const factorId = typeof r.factor_id === 'string' ? r.factor_id : null;
    const factorLabel = typeof r.factor_label === 'string' ? r.factor_label : null;
    if (!factorId || !factorLabel) continue;
    out.push({
      factor_id: factorId,
      factor_label: factorLabel,
      flip_value: typeof r.flip_value === 'number' ? r.flip_value : null,
      direction: typeof r.direction === 'string' ? r.direction : null,
      unit: typeof r.unit === 'string' ? r.unit : null,
      value_scale: readValueScale(r),
      flip_reason: typeof r.flip_reason === 'string' ? r.flip_reason : null,
      margin_supports_flip: readMarginSupportsFlip(r),
      alternative_winner_id:
        typeof r.alternative_winner_id === 'string' ? r.alternative_winner_id : null,
      alternative_winner_label:
        typeof r.alternative_winner_label === 'string' ? r.alternative_winner_label : null,
    });
  }
  return out;
}

/**
 * The option PLoT computed would lead if a factor crossed its tipping point,
 * carried as IDENTITY + an optional safe display name.
 */
export interface AlternativeWinner {
  /** Authoritative identity. Always a non-empty string. Never user-facing. */
  readonly id: string;
  /**
   * Safe user-facing name, or `null` when none could be established. `null`
   * does NOT mean "no winner" — the identity is still known; it means we have
   * nothing we may safely print, so the caller must not name the option.
   */
  readonly display: string | null;
}

/**
 * Resolve one flip entry's alternative winner, anchored on the ID.
 *
 * Why this is not "read the label":
 *  - The ID is the identity. Without a non-empty `alternative_winner_id` there
 *    is no attested target at all, so we return `null` even when a label is
 *    present — a label alone never establishes which option PLoT meant.
 *  - PLoT's `resolveLabel` falls back to **the raw option id** when the id is
 *    missing from its options list, so `alternative_winner_label === id` is the
 *    producer's "I could not resolve this" signal, not a display name. Printing
 *    it would leak an internal token into user prose. We detect that exact
 *    shape and withhold the display while KEEPING the identity.
 *
 * Pure. Returns `null` when the entry carries no usable winner identity.
 */
export function resolveAlternativeWinner(entry: FlipEntry): AlternativeWinner | null {
  const id = typeof entry.alternative_winner_id === 'string' ? entry.alternative_winner_id.trim() : '';
  if (id.length === 0) return null;

  const rawLabel =
    typeof entry.alternative_winner_label === 'string' ? entry.alternative_winner_label.trim() : '';
  // Empty, or PLoT's id-echo fallback ⇒ no safe display name.
  const display = rawLabel.length > 0 && rawLabel !== id ? rawLabel : null;
  return { id, display };
}

/**
 * Resolve the SINGLE alternative winner that a set of flip entries agrees on,
 * or `null` when they do not agree / none is safely nameable.
 *
 * Agreement is decided on the **ID**, never the label. Two options may share a
 * display label (the collision case UI #492's resolver had to handle), so a
 * label-only reader would fold two distinct targets into one and name a winner
 * the analysis never attested. Distinct ids ⇒ no single target ⇒ `null`.
 *
 * Returns `null` unless every entry that carries an identity carries the SAME
 * identity, and that identity has a safe display name.
 */
export function resolveAgreedAlternativeWinner(
  entries: readonly FlipEntry[],
): AlternativeWinner | null {
  const winners = entries
    .map(resolveAlternativeWinner)
    .filter((w): w is AlternativeWinner => w !== null);
  if (winners.length === 0) return null;

  const first = winners[0]!;
  // Identity agreement, on the id — a shared label across different ids is a
  // COLLISION, not agreement.
  if (winners.some((w) => w.id !== first.id)) return null;
  // Identity is agreed; we may only NAME it when a safe display exists. Prefer
  // the first non-null display among the agreeing rows.
  const display = winners.find((w) => w.display !== null)?.display ?? null;
  if (display === null) return null;
  return { id: first.id, display };
}

/** Overall flip-evidence verdict across an analysis's flip thresholds. */
export type FlipOverallStatus =
  | 'concrete' // ≥1 entry has a finite flip_value (a real single-factor tipping point exists)
  | 'no_practical_flip' // entries exist, ALL null with reason 'no_effect_within_bounds'
  | 'insufficient_data' // entries exist but null without that reason (no verdict)
  | 'none'; // no flip thresholds at all

/**
 * Compact, honest summary of `enrichment.flip_thresholds[]` for the
 * deterministic `what_would_flip` composer. `overall_status` drives the
 * copy ladder; `margin_supports_flip` (true only when ≥1 entry carries
 * real margin movement) gates the "small changes could flip" claim.
 */
export interface FlipSummary {
  readonly overall_status: FlipOverallStatus;
  readonly entries: readonly FlipEntry[];
  readonly margin_supports_flip: boolean;
}

/**
 * Derive a {@link FlipSummary} from already-read {@link FlipEntry}[]. Pure.
 * Mirrors the legacy deterministic engine's per-entry flip_status derivation
 * (`src/orchestrator/deterministic/actions/what-would-flip.ts`) at the
 * summary level. Returns `'none'` for an empty list so the composer can
 * distinguish "no flip data" (fall back to current behaviour) from
 * "flip data says nothing flips" (`'no_practical_flip'`).
 */
export function summariseFlipEntries(entries: readonly FlipEntry[]): FlipSummary {
  const margin_supports_flip = entries.some((e) => e.margin_supports_flip === true);
  if (entries.length === 0) {
    return { overall_status: 'none', entries, margin_supports_flip };
  }
  const hasConcrete = entries.some(
    (e) => typeof e.flip_value === 'number' && Number.isFinite(e.flip_value),
  );
  if (hasConcrete) {
    return { overall_status: 'concrete', entries, margin_supports_flip };
  }
  const allNoEffect = entries.every((e) => e.flip_reason === 'no_effect_within_bounds');
  return {
    overall_status: allNoEffect ? 'no_practical_flip' : 'insufficient_data',
    entries,
    margin_supports_flip,
  };
}

/**
 * P0b-1 — drop option-controlled levers from a {@link FlipSummary} so the
 * "what would flip / the clearest one to test" prose cannot name a lever as a
 * thing to validate, test or act on. Authority is structural `factor_id`
 * membership (the #308 union set, `collectInterventionControlledFactorIds`),
 * never the label. Re-summarises the kept entries via {@link summariseFlipEntries}
 * so `overall_status` / `margin_supports_flip` stay consistent — e.g. dropping
 * the only concrete entry demotes `'concrete'`, and dropping all entries yields
 * `'none'`, letting the composer fall back to its pre-flip behaviour. Pure; no
 * entry values are mutated. Empty controlled set ⇒ returned unchanged.
 */
export function filterFlipSummaryEntries(
  summary: FlipSummary,
  controlledFactorIds: ReadonlySet<string>,
): FlipSummary {
  if (controlledFactorIds.size === 0) return summary;
  const kept = summary.entries.filter((e) => {
    const id = typeof e.factor_id === 'string' ? e.factor_id.trim() : '';
    return !(id.length > 0 && controlledFactorIds.has(id));
  });
  if (kept.length === summary.entries.length) return summary;
  return summariseFlipEntries(kept);
}

/**
 * Select the single best flip entry to propose: the first entry that
 * builds a safe proposal. (Entries arrive in the analysis's own
 * importance order; we do not re-rank.) Returns the proposal + the
 * source entry, or null when none are safely proposable.
 */
export function selectFlipProposal(
  entries: readonly FlipEntry[],
  nodeLookup: (factorId: string) => FactorNodeInfo | undefined,
): { proposal: ProposedChange; entry: FlipEntry } | null {
  for (const entry of entries) {
    const result = buildFlipProposal(entry, nodeLookup(entry.factor_id));
    if (result.ok) return { proposal: result.proposal, entry };
  }
  return null;
}

export type FlipEmitResult =
  | { readonly status: 'emitted'; readonly chip: SuggestedAction; readonly pending: PendingAction }
  | { readonly status: 'no_proposal' }
  | { readonly status: 'unsafe_copy' }
  | { readonly status: 'unknown_intent' };

/**
 * End-to-end emit orchestration for the `what_would_flip` seam, factored
 * out of the turn-executor so it is unit-testable WITHOUT the full turn
 * harness:
 *   read `enrichment.flip_thresholds[]` → selectFlipProposal →
 *   emitProposedChange (chip + apply_proposed_change pending).
 *
 * Returns a discriminated result the caller turns into telemetry. The
 * caller merges `chip` into the turn's suggested_actions (deduped, within
 * the chip budget) and `pending` into the committed pending_actions.
 */
export function buildFlipProposalEmit(
  enrichment: unknown,
  nodeLookup: (factorId: string) => FactorNodeInfo | undefined,
  ctx: ProposedChangeContext,
): FlipEmitResult {
  const sel = selectFlipProposal(readFlipEntries(enrichment), nodeLookup);
  if (!sel) return { status: 'no_proposal' };
  const emitted = emitProposedChange(sel.proposal, ctx);
  if (emitted.status === 'success') {
    return { status: 'emitted', chip: emitted.chip, pending: emitted.pending };
  }
  if (emitted.status === 'unsafe_copy') return { status: 'unsafe_copy' };
  return { status: 'unknown_intent' };
}
