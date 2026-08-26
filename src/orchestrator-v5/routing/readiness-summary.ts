/**
 * V5 qualitative readiness summariser for the post-analysis advice gate.
 *
 * Projects the canonical whole-status payload through the shared readiness
 * recovery authority into a short "what is still open" answer.
 *
 * Hard constraint: never echo, claim, or imply a numeric readiness
 * percentage. DGAI computes its own 0-100 score client-side
 * (`computeReadiness()`); recomputing in CEE would drift from what the
 * user sees on screen. The gate answers "why is this only 35% ready?"
 * with WHAT is still open, not WHY a specific number was produced.
 *
 * Pure projection — no new algorithm, no contract changes. Reads what
 * already flows through the turn envelope.
 */

import type { GraphPatchBlockData } from '../../orchestrator/types.js';
import { blockerIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  projectReadinessRecovery,
  type ReadinessRecoveryKind,
} from '../coaching/readiness-recovery.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;
type CanonicalIssue = NonNullable<AnalysisReadyPayload['readiness_issues']>[number];
/**
 * Single canonical recovery item. `description` is user-safe prose produced
 * by `projectReadinessRecovery` from status + blockers.
 *
 * `goal_threshold_missing` is a quarantined compatibility member for historical
 * coaching-state/directive readers and is no longer emitted. `too_few_options`
 * is emitted only by projecting an exact canonical `FEWER_THAN_TWO_OPTIONS`
 * issue; this layer never re-derives option count or whole status. Exact
 * `analysis_ready.status === 'ready'` wins, including the valid
 * ready-without-threshold case.
 */
export interface ReadinessOpenItem {
  readonly kind:
    | 'too_few_options'
    | 'goal_node_missing'
    | 'option_needs_mapping'
    | 'option_needs_encoding'
    | 'goal_threshold_missing'
    | 'model_needs_review';
  readonly description: string;
  readonly option_label?: string;
}

/**
 * What the ContextPack carries. `status` is the canonical
 * `analysis_ready.status` VERBATIM (never re-derived); `open_items` is
 * {@link summariseReadiness}'s projection, which carries both the blocker
 * identity and the user's route out of it.
 */
export interface ContextPackReadinessProjection {
  readonly status: string;
  readonly open_items: readonly ReadinessOpenItem[];
  /**
   * Disclosed truncation — present ONLY when the cap dropped DISTINCT items
   * (never for deduplicated copies, which lose no fact). Same key-absence
   * discipline as `focus.elements_omitted`.
   */
  readonly items_omitted?: number;
}

/**
 * Prompt-budget cap on DISTINCT open items.
 *
 * A judgement, stated as one: the sibling `rest` slot the pack budgets against
 * is capped at 2,500 chars, and the measured worst case ran ~310 chars per
 * item, so 12 keeps this section inside a comparable envelope while still
 * covering roughly two options per blocker kind (the `kind` enum has six
 * members). It is also more items than a user can act on at once, which is the
 * point of the field. Truncation is DISCLOSED, never silent.
 */
export const READINESS_MAX_OPEN_ITEMS = 12;

export interface ReadinessSummary {
  readonly open_items: readonly ReadinessOpenItem[];
  /**
   * User-facing prose summary. Empty string when nothing is open
   * (caller should not surface a readiness response in that case).
   * The composer is deterministic — same inputs always produce the
   * same string.
   */
  readonly prose: string;
}

function recoveryKindToOpenItemKind(
  recoveryKind: Exclude<ReadinessRecoveryKind, 'run'>,
): ReadinessOpenItem['kind'] {
  switch (recoveryKind) {
    case 'map_option':
    case 'connect_option':
    case 'configure_option':
      return 'option_needs_mapping';
    case 'encode_option':
    case 'provide_value':
    case 'confirm_value':
      return 'option_needs_encoding';
    case 'resolve_model_issue':
    case 'review_constraint':
    case 'review_model':
      return 'model_needs_review';
  }
}

function asDescription(nextStep: string): string {
  return nextStep
    .replace(/^Next,\s*/i, '')
    .replace(/[.!?]+$/u, '');
}

/** An issue is usable here only if it carries prose a user could act on. */
function usableIssues(
  issues: AnalysisReadyPayload['readiness_issues'],
): CanonicalIssue[] {
  return Array.isArray(issues)
    ? issues.filter(
        (issue) => issue && typeof issue.message === 'string' && issue.message.trim().length > 0,
      )
    : [];
}

/**
 * The exhaustive issue record for a payload whose producer does not emit
 * `readiness_issues` — recovered from `blockers`, which every producer does.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — ONE PAYLOAD, TWO PRODUCERS, TWO SHAPES
 *
 * `analysis_ready` is built two ways and they disagree in SHAPE (measured on a
 * four-valueless-factor graph, both producers driven):
 *
 *   canonical (`buildCanonicalAnalysisReadyFromGraph`)
 *       8 blockers · 8 readiness_issues · repair_proposal PRESENT
 *   pipeline  (`cee/transforms/analysis-ready.ts`)
 *       8 blockers · 0 readiness_issues · repair_proposal ABSENT
 *
 * `cee/transforms/analysis-ready.ts` never computes either field (zero
 * occurrences of both names; contrast control `blockers` = 20 in the same
 * sweep), and `extractAnalysisReady` (`orchestrator/tools/draft-graph.ts`) is a
 * NAMED-FIELD RE-PROJECTION that names `blockers` but not the other two — the
 * same mechanism that already lost `may_run`, by that function's own comment.
 *
 * The cost, wire-witnessed twice: `summariseReadiness` gated its multi-item
 * branch on `repair_proposal`, fell through to the single-recovery projection,
 * and told a user *"One factor still has no value set"* while FOUR had none —
 * understating the remaining work by 4× on a blocked analysis. The truncation
 * was SILENT because the collapse happens BEFORE the cap that discloses
 * (`items_omitted` never fires; the loss is upstream of the guard).
 *
 * ⭐ NOT A SECOND COUNTER — THE COUNT WAS ALREADY IN THE PAYLOAD. `blockers`
 * survives both paths intact, carrying `factor_label` on every entry. That is
 * precisely why the provenance surface reported all four correctly from the
 * same state: it never reads `readiness_issues` at all. This function does not
 * classify, count or re-derive anything — it routes each blocker through
 * {@link blockerIssue}, the canonical mapper, which is EXPORTED for exactly
 * this reason ("two mappers would be two authorities on what
 * `missing_connection` means"). A local blocker→issue mapping here would be
 * that second authority.
 *
 * ⚠ NEVER ON A `ready` PAYLOAD. Mirrors `appendSemanticIssues`, which returns
 * early on exact status `ready` for the same reason: advisory blockers can
 * co-exist with a ready verdict, and minting open items from them would invent
 * work the canonical authority says is not there — turning an under-report into
 * an over-report, which is the worse failure of the two.
 */
function issuesFromBlockers(analysisReady: AnalysisReadyPayload): CanonicalIssue[] {
  if (analysisReady.status === 'ready') return [];
  const blockers = Array.isArray(analysisReady.blockers) ? analysisReady.blockers : [];
  const mapped: CanonicalIssue[] = [];
  for (const [ordinal, blocker] of blockers.entries()) {
    const issue = blockerIssue(blocker, ordinal, analysisReady.status);
    if (issue !== null) mapped.push(issue as CanonicalIssue);
  }
  return usableIssues(mapped);
}

/**
 * Project canonical readiness into one qualitative recovery. Returns an empty
 * `open_items` array (and empty prose) only when the shared projection admits
 * Run from exact status `ready`.
 *
 * REPLACED legacy authority: this function used to independently infer
 * readiness from `options.length`, per-option statuses, and goal-threshold
 * presence. That reconstructed a second whole-model verdict and could both
 * miss a canonical unreachable-factor blocker and invent a threshold blocker
 * on a payload whose canonical status was ready. The shared projection owns
 * both classification and copy now; this layer only maps its recovery family
 * to the stable low-cardinality presentation tag consumed downstream.
 */
export function summariseReadiness(
  analysisReady: AnalysisReadyPayload,
): ReadinessSummary {
  // A multi-blocker assessment is already exhaustive and user-safe. Preserve
  // every item instead of collapsing back to the historical first-blocker
  // projection. The established targeted projection remains byte-for-byte for
  // zero/one issue, so ordinary edits are unaffected.
  const declaredIssues = usableIssues(analysisReady.readiness_issues);
  // ⭐ THE EXHAUSTIVE RECORD IS NOT ALWAYS IN THE SAME FIELD — see
  // `issuesFromBlockers`. When the declared array is absent the blockers ARE the
  // record, and reading only the declared one understates the open work.
  const derivedIssues = declaredIssues.length > 0 ? [] : issuesFromBlockers(analysisReady);
  const canonicalIssues = declaredIssues.length > 0 ? declaredIssues : derivedIssues;
  const hasSpecificStructuralRecovery = canonicalIssues.some(
    (issue) => issue.code === 'NO_GOAL' || issue.code === 'FEWER_THAN_TWO_OPTIONS',
  );
  if (
    (analysisReady.repair_proposal && canonicalIssues.length >= 2)
    // The pipeline-shaped payload has no `repair_proposal` to gate on, so the
    // derived record gates on itself. Deliberately a SEPARATE disjunct rather
    // than a relaxation of the one above: the declared-array path keeps its
    // exact previous condition, so the canonical shape is byte-for-byte
    // unchanged and only the shape that was collapsing can move.
    || derivedIssues.length >= 2
    || hasSpecificStructuralRecovery
  ) {
    const openItems: ReadinessOpenItem[] = canonicalIssues
      .filter((issue) => issue.repairability === 'human_input_required')
      .map((issue) => ({
        kind:
          issue.code === 'NO_GOAL'
            ? 'goal_node_missing'
            : issue.code === 'FEWER_THAN_TWO_OPTIONS'
              ? 'too_few_options'
              : issue.category === 'option_mapping'
                ? 'option_needs_mapping'
                : issue.category === 'option_values' || issue.category === 'numeric_integrity'
                  ? 'option_needs_encoding'
                  : 'model_needs_review',
        description: asDescription(issue.message),
        ...(issue.option_label ? { option_label: issue.option_label } : {}),
      }));
    return { open_items: openItems, prose: composeReadinessProse(openItems) };
  }
  const recovery = projectReadinessRecovery(analysisReady);
  if (recovery.kind === 'run') return { open_items: [], prose: '' };
  const openItems: ReadinessOpenItem[] = [{
    kind: recoveryKindToOpenItemKind(recovery.kind),
    description: asDescription(recovery.nextStep),
    ...(recovery.optionLabel ? { option_label: recovery.optionLabel } : {}),
  }];
  return { open_items: openItems, prose: composeReadinessProse(openItems) };
}

/**
 * The ContextPack's readiness projection — status + the OPEN ITEMS behind it.
 *
 * WHY THIS EXISTS. The ContextPack already carried a readiness STATUS and a
 * blocker COUNT (`coaching_context.readiness_status` /
 * `.actionable_blocker_count`). It never carried the blocker IDENTITY, so the
 * model could know that something was blocking and still be unable to name
 * WHAT — which is how the assistant came to tell a user *"so nothing there is
 * blocking analysis"* while two factors were the only blockers.
 *
 * NOT A SECOND AUTHORITY. Every value here is taken VERBATIM from the
 * canonical readiness payload and from {@link summariseReadiness} (which
 * itself delegates to `projectReadinessRecovery`). This function classifies
 * nothing, counts nothing, and re-derives nothing — it is a projection, and
 * the moment it starts deciding readiness it becomes the drift this estate
 * keeps paying for.
 *
 * ⚠ `open_items: []` DOES NOT MEAN "MAY RUN". The canonical projection filters
 * out auto-repairable issues, so an empty list co-exists with a non-ready
 * `status`. That is exactly why `status` is carried ALONGSIDE the items rather
 * than a derived boolean: a consumer that reads emptiness as permission
 * re-creates the defect one level down.
 *
 * Returns `null` when there is no canonical payload to project — the caller
 * omits the pack key entirely, so an unknown readiness stays UNKNOWN instead
 * of serialising as an absence of blockers.
 */
export function projectContextPackReadiness(
  analysisReady: AnalysisReadyPayload | null | undefined,
): ContextPackReadinessProjection | null {
  if (!analysisReady) return null;
  const status = analysisReady.status;
  if (typeof status !== 'string' || status.trim().length === 0) return null;

  // DEDUPE FIRST, THEN CAP — in that order, so the cap spends its budget on
  // DISTINCT items rather than on copies. Measured on a 25-node graph in
  // exactly the state this field exists to describe: 49 items / 7,745 chars,
  // of which 24 were exact byte-duplicates carrying no identity at all (12x
  // "…leave a node with no connections", 12x "An option has no factor
  // connections…"). Un-deduped and uncapped that was 51% of the whole pack, on
  // every turn regardless of what the user asked — and the only
  // ceiling-cuttable section is `conversation`, so unbounded readiness growth
  // silently EVICTS THE USER'S CONVERSATION HISTORY.
  //
  // The identity is the whole triple: two items of the same `kind` about
  // DIFFERENT options are different facts and both survive. Canonical order is
  // preserved (first occurrence wins) — this filters, it never reorders.
  //
  // Precedent: `coaching-state.ts` (the estate's only other presenter of this
  // same array) already dedupes it for the same reason. The canonical owner is
  // NOT changed — `summariseReadiness` still returns everything; this is a
  // prompt-budget projection over its output.
  const seen = new Set<string>();
  const distinct: ReadinessOpenItem[] = [];
  for (const item of summariseReadiness(analysisReady).open_items) {
    const identity = JSON.stringify([item.kind, item.description, item.option_label ?? null]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    distinct.push(item);
  }
  const open_items = distinct.slice(0, READINESS_MAX_OPEN_ITEMS);
  const omitted = distinct.length - open_items.length;
  return {
    status,
    open_items,
    // DISCLOSED truncation, and it counts CAP-DROPPED items only. Deduplicated
    // copies are deliberately NOT counted as omissions: they carried no
    // distinct fact, so reporting them as withheld would overstate the loss —
    // and the instruction forbids the model stating a blocker COUNT anyway.
    ...(omitted > 0 ? { items_omitted: omitted } : {}),
  };
}

function composeReadinessProse(items: readonly ReadinessOpenItem[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) {
    return `Here's what's still open before this can run cleanly: ${items[0].description}.`;
  }
  const lead = "Here's what's still open before this can run cleanly:";
  const bullets = items.map((it) => `• ${it.description}`).join('\n');
  return `${lead}\n${bullets}`;
}

/**
 * Predicate variant for the gate's data-availability fallback path.
 * Returns true when the payload is structured enough for the gate to
 * compose meaningful readiness prose. False on empty / missing inputs
 * so the gate can route to the `data_unavailable_for_class` branch.
 */
export function hasSufficientReadinessData(
  analysisReady: AnalysisReadyPayload | null | undefined,
): analysisReady is AnalysisReadyPayload {
  if (!analysisReady) return false;
  if (!Array.isArray(analysisReady.options)) return false;
  return true;
}
