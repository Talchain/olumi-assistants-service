/**
 * V5 Lane 2 — deterministic chip-quality finalizer.
 *
 * A PURE function applied to the FINAL `suggested_actions` list at the
 * single V5 egress chokepoint (`sanitiseOlumiResponseForEgress`, after the
 * per-string entity-id scrub). It is the comprehensive quality SSOT layered
 * on top of the existing per-branch mechanisms (`chip-generator.ts` `cap()`,
 * `validateAndFilterChips`, `applyChipFloor`, and the in-turn flip dedupe in
 * `turn-executor.ts`), which all remain intact.
 *
 * Guarantees, in order:
 *   1. Classify every chip (telemetry + drop decisions).
 *   2. Drop UNSAFE chips — a leakage token (handler id / schema term /
 *      `prop_`/`chip_`/`graph_hash`/`{"`) in the visible label or message,
 *      or a non-exempt raw-decimal leak. (NOT em dash — see chip-safety.ts.)
 *   3. Drop GENERIC/NOISY chips — blank after scrub, or an unrecognised id
 *      with no `action_type` and no known prompt shape. Conservative by
 *      design: any chip with a valid `action_type` is grounded and is never
 *      dropped as generic.
 *   4. Protect proposals: validated proposal-backed chips (`prop_` id + a
 *      proposal `action_type`) are partitioned to the front so a generic
 *      near-duplicate can never dedupe them away, and they survive the
 *      budget unless unsafe.
 *   5. Dedupe: exact id; normalized-equal label; normalized-equal message;
 *      and same-`action_type` collapse ONLY for known-singleton actions
 *      (run/explain/flip/compare). Multi-target mutation actions
 *      (add_constraint / set_factor_value / adjust_edge_strength) are NOT
 *      collapsed by action_type — two grounded edits targeting different
 *      things both survive. Proposals are exempt from action_type collapse.
 *   6. Budget: at most {@link MAX_CHIPS} (targets 2–3 useful chips). No
 *      padding — an empty safe set yields no chips.
 *
 * Idempotent: a second pass over an already-finalized list drops, dedupes
 * and trims nothing. The chokepoint runs the finalizer up to 4× per
 * response, so the caller guards the aggregate telemetry emit on a real
 * change.
 *
 * Chips are derived from structured state upstream; this layer never reads
 * model response text and never invents or rewrites a chip — it only
 * filters, reorders (proposals-first) and trims.
 */

import { log } from '../../utils/telemetry.js';
import type { SuggestedAction } from './types.js';
import { findChipLeakToken, findChipRawDecimalLeak } from './chip-safety.js';

/** Mirrors `chip-generator.ts` MAX_CHIPS — the useful 2–3 chip budget cap. */
const MAX_CHIPS = 3;

const PROPOSAL_ID_PREFIX = 'prop_';
const KNOWN_GROUNDED_ID_PREFIXES = ['chip_action_', 'chip_prompt_', 'floor_'];

/** Proposal / graph-mutation handler ids. */
const MUTATION_ACTION_TYPES = new Set<string>([
  'add_constraint',
  'set_factor_value',
  'adjust_edge_strength',
]);

/**
 * Actions that are inherently one-per-response (analysis / explanation).
 * Only these are collapsed by `action_type` during dedupe — mutation
 * actions are NOT (different targets are legitimately distinct chips).
 */
const SINGLETON_ACTION_TYPES = new Set<string>([
  'run_analysis',
  'explain_results',
  'explain_result',
  'explain_from_structure',
  'what_would_flip',
  'compare_options',
]);

const RERUN_RE = /rerun|re-run|re_run/i;

export type ChipCategory =
  | 'proposal'
  | 'analysis_followup'
  | 'stale_rerun'
  | 'graph_edit'
  | 'coaching'
  | 'generic'
  | 'unsafe';

export interface ChipFinalizeReport {
  readonly input: number;
  readonly output: number;
  readonly dropped_unsafe: number;
  /** Subset of `dropped_unsafe` that were dropped for a raw-decimal leak. */
  readonly dropped_raw_decimal: number;
  readonly dropped_generic: number;
  readonly deduped: number;
  readonly proposal_protected: number;
  readonly over_budget_trimmed: number;
}

export interface ChipFinalizeResult {
  readonly chips: readonly SuggestedAction[];
  readonly report: ChipFinalizeReport;
}

interface MutableReport {
  input: number;
  output: number;
  dropped_unsafe: number;
  dropped_raw_decimal: number;
  dropped_generic: number;
  deduped: number;
  proposal_protected: number;
  over_budget_trimmed: number;
}

interface ClassifiedChip {
  readonly chip: SuggestedAction;
  readonly cat: ChipCategory;
}

function strField(chip: SuggestedAction, key: 'id' | 'label' | 'message'): string {
  const v = (chip as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

function actionTypeOf(chip: SuggestedAction): string | null {
  const at = (chip as { action_type?: unknown }).action_type;
  return typeof at === 'string' && at.length > 0 ? at : null;
}

function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:\s]+$/u, '');
}

function isKnownGroundedId(id: string): boolean {
  return KNOWN_GROUNDED_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * A *validated* proposal-backed chip: the `prop_` id prefix AND a proposal
 * `action_type`. Used both for the budget/dedupe protection category and
 * the raw-decimal exemption — never trusts the `prop_` prefix alone.
 */
function isValidatedProposalChip(chip: SuggestedAction): boolean {
  const id = strField(chip, 'id');
  const at = actionTypeOf(chip);
  return id.startsWith(PROPOSAL_ID_PREFIX) && at !== null && MUTATION_ACTION_TYPES.has(at);
}

function classify(chip: SuggestedAction): ChipCategory {
  const label = strField(chip, 'label');
  const message = strField(chip, 'message');
  const id = strField(chip, 'id');
  const at = actionTypeOf(chip);
  const validatedProposal = isValidatedProposalChip(chip);

  // 1. Unsafe — leakage token in visible copy (label/message only; the id
  //    is a machine field and is never scanned, else every `chip_*`/`prop_*`
  //    chip would self-flag).
  if (findChipLeakToken(label) !== null || findChipLeakToken(message) !== null) {
    return 'unsafe';
  }
  // 2. Unsafe — non-exempt raw-decimal leak.
  if (findChipRawDecimalLeak(label, message, { isValidatedProposal: validatedProposal })) {
    return 'unsafe';
  }
  // 3. Generic — blank after scrub.
  if (isBlank(label) || isBlank(message)) return 'generic';

  // 4. Validated proposal-backed.
  if (validatedProposal) return 'proposal';

  // 5. Executable chips — any valid action_type is grounded (never generic).
  if (at !== null) {
    if (at === 'run_analysis' && RERUN_RE.test(id)) return 'stale_rerun';
    if (
      at === 'explain_results' ||
      at === 'explain_result' ||
      at === 'what_would_flip' ||
      at === 'explain_from_structure' ||
      at === 'compare_options'
    ) {
      return 'analysis_followup';
    }
    if (MUTATION_ACTION_TYPES.has(at)) return 'graph_edit';
    return 'analysis_followup';
  }

  // 6. Prompt chips (no action_type) with a known grounded id family.
  if (isKnownGroundedId(id)) {
    if (RERUN_RE.test(id)) return 'stale_rerun';
    if (id.includes('explore') || id.includes('flip')) return 'analysis_followup';
    return 'coaching';
  }

  // 7. Unrecognised id, no action_type, not a known prompt → generic/noisy.
  return 'generic';
}

function dropReason(chip: SuggestedAction): 'egress_leak_token' | 'raw_decimal' {
  const label = strField(chip, 'label');
  const message = strField(chip, 'message');
  if (findChipLeakToken(label) !== null || findChipLeakToken(message) !== null) {
    return 'egress_leak_token';
  }
  return 'raw_decimal';
}

function dedupe(items: readonly ClassifiedChip[], report: MutableReport): ClassifiedChip[] {
  const out: ClassifiedChip[] = [];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const seenMessages = new Set<string>();
  const seenSingletonActions = new Set<string>();

  for (const item of items) {
    const id = strField(item.chip, 'id');
    const nLabel = normalizeText(strField(item.chip, 'label'));
    const nMessage = normalizeText(strField(item.chip, 'message'));
    const at = actionTypeOf(item.chip);
    const isProposal = item.cat === 'proposal';

    if (id !== '' && seenIds.has(id)) {
      report.deduped++;
      continue;
    }
    if (nLabel !== '' && seenLabels.has(nLabel)) {
      report.deduped++;
      continue;
    }
    if (nMessage !== '' && seenMessages.has(nMessage)) {
      report.deduped++;
      continue;
    }
    // Same-action collapse: singleton actions only, proposals exempt.
    if (
      !isProposal &&
      at !== null &&
      SINGLETON_ACTION_TYPES.has(at) &&
      seenSingletonActions.has(at)
    ) {
      report.deduped++;
      continue;
    }

    if (id !== '') seenIds.add(id);
    if (nLabel !== '') seenLabels.add(nLabel);
    if (nMessage !== '') seenMessages.add(nMessage);
    if (!isProposal && at !== null && SINGLETON_ACTION_TYPES.has(at)) {
      seenSingletonActions.add(at);
    }
    out.push(item);
  }

  return out;
}

/**
 * Deterministic chip-quality finalizer. See module header for the ordered
 * guarantees. Pure: no I/O beyond a structured `log.warn` per dropped chip
 * (no user copy logged — chip ids and a reason class only).
 */
export function finalizeChips(chips: readonly SuggestedAction[]): ChipFinalizeResult {
  const report: MutableReport = {
    input: chips.length,
    output: 0,
    dropped_unsafe: 0,
    dropped_raw_decimal: 0,
    dropped_generic: 0,
    deduped: 0,
    proposal_protected: 0,
    over_budget_trimmed: 0,
  };

  // Phase A — classify, drop unsafe + generic (input order preserved).
  const kept: ClassifiedChip[] = [];
  for (const chip of chips) {
    const cat = classify(chip);
    if (cat === 'unsafe') {
      report.dropped_unsafe++;
      const reason = dropReason(chip);
      if (reason === 'raw_decimal') report.dropped_raw_decimal++;
      log.warn(
        { event: 'v5.chip.suppressed', reason, chip_id: strField(chip, 'id') || null },
        'V5 egress chip-finalizer: chip dropped (unsafe)',
      );
      continue;
    }
    if (cat === 'generic') {
      report.dropped_generic++;
      log.warn(
        { event: 'v5.chip.suppressed', reason: 'generic_noisy', chip_id: strField(chip, 'id') || null },
        'V5 egress chip-finalizer: chip dropped (generic/noisy)',
      );
      continue;
    }
    kept.push({ chip, cat });
  }

  // Phase B — partition proposals to the front (stable) so a generic
  // near-duplicate can never dedupe a proposal away, and proposals win the
  // budget.
  const proposalsFirst: ClassifiedChip[] = [
    ...kept.filter((i) => i.cat === 'proposal'),
    ...kept.filter((i) => i.cat !== 'proposal'),
  ];

  // Phase C — dedupe (exact id + near-duplicate, keep first).
  const deduped = dedupe(proposalsFirst, report);

  // Phase D — proposal-protected budget. Proposals are already first, so a
  // top-N slice keeps them; count protection + over-budget.
  const finalItems = deduped.slice(0, MAX_CHIPS);
  const trimmed = deduped.slice(MAX_CHIPS);
  report.over_budget_trimmed = trimmed.length;
  report.proposal_protected = finalItems.filter((i) => i.cat === 'proposal').length;

  const out = finalItems.map((i) => i.chip);
  report.output = out.length;

  return { chips: out, report };
}
