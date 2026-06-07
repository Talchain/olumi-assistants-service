/**
 * V5 Lane 2 — deterministic chip curation at the egress finaliser.
 *
 * A single, pure, idempotent pass that runs over `response.suggested_actions`
 * at the universal V5 egress chokepoint (`finaliseV5Response`). Every 200-OK V5
 * dispatch path (turn_executor, chip_click, draft_graph, edit_graph,
 * system_event, frame_no_brief_guard) converges there, so this is the one place
 * that guarantees the wire chip set is grounded, safe, de-duplicated, budgeted,
 * and free of internal vocabulary — regardless of which composer produced it.
 *
 * Policy (in order):
 *   1. Malformed drop      — blank id / label / message.
 *   2. Copy-unsafe drop    — internal leak token, prose jargon, or (for
 *                            non-exempt chips) a bare model-scale decimal.
 *   3. Dedupe              — exact id, then near-duplicate (normalised
 *                            label+message+action_type), proposal/pending-
 *                            preferring on collision.
 *   4. Budget              — at most `maxChips`, NEVER dropping a proposal,
 *                            chip-derivable action chip, or disambiguation
 *                            choice-set member (see divergence-safety below).
 *
 * Conservative by design: this pass is purely SUBTRACTIVE. It never invents a
 * chip, never reorders the surviving set, and never suppresses a deliberate
 * grounded fallback prompt the rule engine chose to emit. An empty input stays
 * empty (no filler) — the chip-generator floor already prefers honest-empty.
 *
 * Divergence-safety (why certain chips are protected from dedupe/budget):
 * pending actions are persisted at COMMIT, BEFORE this finaliser runs. The
 * commit path derives them from `response.suggested_actions` for chips whose
 * `action_type ∈ CHIP_DERIVABLE_ACTION_TYPES` (`derive-pending-actions.ts`),
 * and proposal chips (`prop_` ids) carry an `apply_proposed_change` pending
 * action via explicit emit. If egress curation dropped such a chip after its
 * pending action was persisted, the displayed chips would diverge from
 * persisted resume state — the hidden-state mismatch Branch A exists to
 * prevent. So curation MUST NOT dedupe-lose or budget-trim a proposal or a
 * chip-derivable action chip. The only removals that can touch them are the
 * malformed / copy-unsafe / decimal egress checks, which never fire on them in
 * practice (proposal copy is whole-number and safety-filtered at emit; derivable
 * action chips carry hardcoded-safe copy) — asserted by tests. Disambiguation
 * choice-sets carry no pending action but are budget-protected so the
 * "which one did you mean?" UX is never truncated.
 *
 * Telemetry: this module is PURE — it returns content-free `suppressions`
 * records; the caller emits the `v5.chip.suppressed` log. No chip label,
 * message, user-authored, or graph-derived text is ever returned for logging.
 */

import { CHIP_DERIVABLE_ACTION_TYPES, type PendingActionKind } from '../session/pending-action.js';

import { findForbiddenPhraseHit } from './forbidden-user-facing-phrases.js';
import { SAFETY_FORBIDDEN_TOKENS } from './proposed-change.js';
import type { SuggestedAction } from './types.js';

/** Wire budget for next-action chips. Mirrors chip-generator `MAX_CHIPS`. */
export const DEFAULT_MAX_CHIPS = 3;

export type ChipSuppressionReason =
  | 'malformed'
  | 'copy_unsafe'
  | 'duplicate'
  | 'near_duplicate'
  | 'budget_trimmed';

/** Closed-enum chip category for content-free telemetry. */
export type ChipCategory = 'proposal' | 'disambiguation' | 'next_action' | 'unknown';

/**
 * Content-free record of a single suppression. Carries NO user-facing or
 * graph-derived text — only a closed-enum reason, a closed-enum category, and
 * the (closed-enum, handler-id) `action_type` when present. Safe to log.
 */
export interface ChipSuppression {
  readonly reason: ChipSuppressionReason;
  readonly category: ChipCategory;
  readonly action_type?: string;
}

export interface CurateChipsOptions {
  /** Budget for non-protected (next-action) chips. Defaults to 3. */
  readonly maxChips?: number;
}

export interface CurateChipsResult {
  readonly chips: readonly SuggestedAction[];
  readonly suppressions: readonly ChipSuppression[];
}

// ─── Category predicates (id-prefix / action_type based) ────────────────────

/** Proposal chip (`apply_proposed_change` family). Carries a pending action. */
function isProposalChip(chip: SuggestedAction): boolean {
  return typeof chip.id === 'string' && chip.id.startsWith('prop_');
}

/** Entity disambiguation chip ("which did you mean?"). User-authored labels. */
function isDisambiguationChip(chip: SuggestedAction): boolean {
  return typeof chip.id === 'string' && chip.id.startsWith('chip_entity_');
}

/**
 * Chip whose `action_type` seeds a pending action via
 * `derivePendingActionsFromChips` (`run_analysis` / `what_would_flip`).
 */
function isPendingBearingActionChip(chip: SuggestedAction): boolean {
  const at = chip.action_type;
  return typeof at === 'string' && CHIP_DERIVABLE_ACTION_TYPES.has(at as PendingActionKind);
}

/** Any chip that may carry a persisted pending action (divergence-sensitive). */
function isPendingBearing(chip: SuggestedAction): boolean {
  return isProposalChip(chip) || isPendingBearingActionChip(chip);
}

/** Protected from dedupe-loss AND budget-trim. */
function isBudgetProtected(chip: SuggestedAction): boolean {
  return isPendingBearing(chip) || isDisambiguationChip(chip);
}

/**
 * Exempt from the bare-decimal check: chips whose copy is drawn from
 * user-authored graph labels (disambiguation candidates, edit-clarify factor /
 * option chips). A user option literally named "Plan 2.5" must not be dropped
 * for its decimal. These chips remain subject to internal leak-token checks.
 */
function isDecimalExempt(chip: SuggestedAction): boolean {
  return (
    isDisambiguationChip(chip) ||
    (typeof chip.id === 'string' && chip.id.startsWith('edit_clarify_'))
  );
}

function chipCategory(chip: SuggestedAction): ChipCategory {
  if (isProposalChip(chip)) return 'proposal';
  if (isDisambiguationChip(chip)) return 'disambiguation';
  if (
    typeof chip.action_type === 'string' ||
    (typeof chip.id === 'string' &&
      (chip.id.startsWith('chip_') ||
        chip.id.startsWith('floor_') ||
        chip.id.startsWith('edit_clarify_')))
  ) {
    return 'next_action';
  }
  return 'unknown';
}

function safeActionType(chip: SuggestedAction): string | undefined {
  return typeof chip.action_type === 'string' ? chip.action_type : undefined;
}

function suppression(chip: SuggestedAction, reason: ChipSuppressionReason): ChipSuppression {
  const at = safeActionType(chip);
  return at !== undefined
    ? { reason, category: chipCategory(chip), action_type: at }
    : { reason, category: chipCategory(chip) };
}

// ─── Copy safety ────────────────────────────────────────────────────────────

/**
 * Chip-oriented forbidden-token list: the proposal safety tokens MINUS the em
 * dash. Em dash is a typographic constraint for machine-authored proposal copy
 * only — live rule-engine chips legitimately use it ("Cancel — keep model
 * unchanged"; the decide-stage pre-mortem prompt). Proposal copy is still em-
 * dash-filtered upstream at emit (`emitProposedChange`), so excluding it here is
 * safe and prevents dropping legitimate chips. Pre-lowercased for substring
 * matching.
 */
const CHIP_SAFETY_TOKENS: readonly string[] = SAFETY_FORBIDDEN_TOKENS.filter(
  (t) => t !== '—',
).map((t) => t.toLowerCase());

/**
 * Display-formatted decimals that are SAFE to show: currency-prefixed
 * (£1.50, $2.00, €3.14), percent-suffixed (12.5%), and recognised short-unit
 * suffixes (mirrors `format-factor-value.ts`: percent / time units, plus common
 * magnitude suffixes). Global so `replace` strips every occurrence.
 */
const DISPLAY_DECIMAL_RE =
  /[£$€]\s?\d[\d,]*\.\d+|\d[\d,]*\.\d+\s?%|\d[\d,]*\.\d+\s?(?:k|m|bn|tn|pct|percent|hours?|hrs?|days?|weeks?|wks?|months?|quarters?|years?|yrs?|pts?|x)\b/gi;

/**
 * True when `text` contains a BARE decimal (e.g. `0.4732`) — a decimal not in a
 * recognised display format. Catches model-scale value leaks while allowing
 * vetted display values. We strip the display-formatted decimals first, then
 * test for any remaining decimal.
 */
function hasBareDecimal(text: string): boolean {
  const stripped = text.replace(DISPLAY_DECIMAL_RE, ' ');
  return /\d*\.\d+/.test(stripped);
}

/** Internal leak token (handler ids, prop_/chip_, graph_hash, JSON, zod, …) or prose jargon. */
function hasLeakToken(text: string): boolean {
  const lower = text.toLowerCase();
  if (CHIP_SAFETY_TOKENS.some((t) => lower.includes(t))) return true;
  return findForbiddenPhraseHit(text) !== null;
}

/**
 * True when chip copy must not reach the wire. The leak-token + prose-jargon
 * check ALWAYS applies; the bare-decimal check applies only to non-exempt
 * (machine-authored) chips. Exported for direct unit testing.
 */
export function isChipCopyUnsafe(text: string, decimalExempt: boolean): boolean {
  if (typeof text !== 'string') return false;
  if (hasLeakToken(text)) return true;
  if (!decimalExempt && hasBareDecimal(text)) return true;
  return false;
}

// ─── Dedupe key ─────────────────────────────────────────────────────────────

function normalise(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?…]+$/u, '');
}

/**
 * Near-duplicate key. Includes `action_type` so an executable chip is never
 * merged with a same-copy prompt chip — merging them would drop the
 * deterministic-bypass variant (and could orphan its pending action).
 */
function nearDupKey(chip: SuggestedAction): string {
  return `${normalise(chip.label)} ${normalise(chip.message)} ${chip.action_type ?? ''}`;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ─── The curation pass ──────────────────────────────────────────────────────

/**
 * Curate a turn's chips for egress. Pure and idempotent: re-running on the
 * output yields the same chips and zero suppressions. Returned chips keep the
 * exact strict shape `{ id, label, message, action_type? }` (no added fields)
 * so the egress `OlumiResponseSchema.parse` is unaffected.
 */
export function curateChips(
  chips: readonly SuggestedAction[],
  opts: CurateChipsOptions = {},
): CurateChipsResult {
  const maxChips = opts.maxChips ?? DEFAULT_MAX_CHIPS;
  const suppressions: ChipSuppression[] = [];

  if (!Array.isArray(chips) || chips.length === 0) {
    return { chips: [], suppressions };
  }

  // 1. Malformed.
  const wellFormed: SuggestedAction[] = [];
  for (const chip of chips) {
    if (chip == null || !isNonBlank(chip.id) || !isNonBlank(chip.label) || !isNonBlank(chip.message)) {
      if (chip != null) suppressions.push(suppression(chip, 'malformed'));
      continue;
    }
    wellFormed.push(chip);
  }

  // 2. Copy-unsafe (applies to all chips, incl. proposals — "unless unsafe").
  const safe: SuggestedAction[] = [];
  for (const chip of wellFormed) {
    const exempt = isDecimalExempt(chip);
    if (isChipCopyUnsafe(chip.label, exempt) || isChipCopyUnsafe(chip.message, exempt)) {
      suppressions.push(suppression(chip, 'copy_unsafe'));
      continue;
    }
    safe.push(chip);
  }

  // 3. Dedupe — exact id, then near-duplicate (proposal/pending-preferring).
  const seenIds = new Set<string>();
  const keyToIndex = new Map<string, number>();
  const kept: SuggestedAction[] = [];
  for (const chip of safe) {
    if (seenIds.has(chip.id)) {
      // Exact-id duplicate: the surviving identical-id chip still matches any
      // persisted pending action's chip_id, so dropping the dup is safe.
      suppressions.push(suppression(chip, 'duplicate'));
      continue;
    }
    const key = nearDupKey(chip);
    const existingIndex = keyToIndex.get(key);
    if (existingIndex !== undefined) {
      const existing = kept[existingIndex];
      if (isPendingBearing(chip) && !isPendingBearing(existing)) {
        // Prefer the pending-bearing / proposal chip: swap in place so a
        // pending-bearing chip is never the one dropped on a collision.
        suppressions.push(suppression(existing, 'near_duplicate'));
        seenIds.delete(existing.id);
        seenIds.add(chip.id);
        kept[existingIndex] = chip;
      } else {
        // Keep-first (or keep the existing pending-bearing chip); drop incoming.
        suppressions.push(suppression(chip, 'near_duplicate'));
      }
      continue;
    }
    seenIds.add(chip.id);
    keyToIndex.set(key, kept.length);
    kept.push(chip);
  }

  // 4. Budget — protected chips are never trimmed; fill remaining from the
  //    non-protected tail in original order.
  if (kept.length <= maxChips) {
    return { chips: kept, suppressions };
  }
  const protectedChips: SuggestedAction[] = [];
  const trimmable: SuggestedAction[] = [];
  for (const chip of kept) {
    if (isBudgetProtected(chip)) protectedChips.push(chip);
    else trimmable.push(chip);
  }
  const slots = Math.max(0, maxChips - protectedChips.length);
  const keptIds = new Set<string>([
    ...protectedChips.map((c) => c.id),
    ...trimmable.slice(0, slots).map((c) => c.id),
  ]);
  for (const chip of trimmable.slice(slots)) {
    suppressions.push(suppression(chip, 'budget_trimmed'));
  }
  // Preserve original (kept) order; never reorder the surviving set.
  return { chips: kept.filter((c) => keptIds.has(c.id)), suppressions };
}
