/**
 * One deterministic projection from typed analysis readiness to user recovery.
 *
 * `analysis_ready.status` owns the recovery class. A blocker may only refine
 * the explicit `needs_user_input` class; it can never turn `blocked`, mapping,
 * or encoding into a value request. This matters for the canonical producer's
 * unreachable-controllable-factor case: it deliberately emits a factor-only
 * `missing_value` blocker while the whole payload says `needs_user_mapping`.
 * The factor-only blocker is useful context, not permission to ask for a
 * fabricated scalar.
 *
 * Both post-draft prose and backend action chips consume this projection. That
 * keeps Run admission and non-ready recovery on the same status vocabulary,
 * while existing configure-option messages remain the route back to human
 * judgement.
 */

import {
  CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX,
  CONFIGURE_OPTION_GENERIC_CHIP,
  buildConfigureOptionChipWithDisplay,
  buildRepairPairChip,
} from '../configure-option-chip-text.js';
import { elideLabelAtWordBoundary } from '../../utils/label-elision.js';
import {
  deriveAskedEffectPair,
  deriveMissingEffectPairs,
} from '../routing/repair-value-binding.js';
import { MISSING_VALUE_ASK_FORMAT_HINT } from '../routing/missing-value-answer.js';

const MAX_LABEL_CHARS = 40;

/**
 * ⭐⭐ THE RUN NUDGE, IN TWO FORMS — AND THE SECOND IS THE HONEST ONE ON AN
 * OPEN BRIEF.
 *
 * `RUN_NEXT_STEP` is the sentence the product has always shipped, and on a
 * genuine decision it is true: the analysis does compare the alternatives the
 * user posed. It is recorded verbatim in the historic reply corpus
 * (`compose/__tests__/fixtures/live-assistant-text-corpus-2026-08-17/`) and is
 * NOT changed here.
 *
 * On the PROVISIONAL path — where `deriveDecisionLabel` could not author a
 * decision label from the brief, so the decision node exists only because the
 * projector always mints one — "see how the options compare" presupposes that
 * these are the alternatives to a decision the user posed. That is the same
 * claim the options heading was changed away from four lines above it
 * (`Options compared` -> `Options on the canvas`, `post-draft-narrative.ts`),
 * merely in the forward-looking tense. `RUN_NEXT_STEP_PROVISIONAL` asserts only
 * where the options are (verifiable on screen) and what the analysis does to
 * them (robustness), not that the user chose between them.
 *
 * ⚠ RECORDED, NOT FIXED: the `blocked` and `review_model` branches below carry
 * the same presupposition in their own words ("before comparing the options").
 * They are out of scope for the lane that added this and are rowed with the
 * upstream extraction gap, not silently left undescribed.
 */
export const RUN_NEXT_STEP =
  'Next, run the analysis to see how the options compare and what could shift the outcome.';
export const RUN_NEXT_STEP_PROVISIONAL =
  'Next, run the analysis to see how the options on the canvas hold up and what could shift the outcome.';

export interface ReadinessRecoveryInput {
  readonly status?: unknown;
  readonly blockers?: ReadonlyArray<unknown> | undefined;
  readonly options?: ReadonlyArray<unknown> | undefined;
}

export interface ReadinessRecoveryNode {
  readonly id?: string;
  readonly kind?: string;
  readonly label?: string;
}

export type ReadinessRecoveryKind =
  | 'run'
  | 'resolve_model_issue'
  | 'map_option'
  | 'encode_option'
  | 'provide_value'
  | 'confirm_value'
  | 'connect_option'
  | 'review_constraint'
  | 'configure_option'
  | 'review_model';

export interface ReadinessRecoveryProjection {
  readonly kind: ReadinessRecoveryKind;
  readonly status: string | null;
  /** DISPLAY form — capped at `MAX_LABEL_CHARS`, as the on-screen sentence needs. */
  readonly optionLabel: string | null;
  /** DISPLAY form — capped at `MAX_LABEL_CHARS`, as the on-screen sentence needs. */
  readonly factorLabel: string | null;
  /**
   * ⭐ THE SAME RESOLUTION, UNCAPPED — a graph FACT rather than a presentation.
   *
   * Not a second lookup: `resolveLabel` produces both at once, so nothing can
   * choose a different entity for the full form than it chose for the display
   * form (CLAUDE.md trap 12 — a second resolution is the thing that drifts).
   * It exists because a chip's MESSAGE is replayed as user text and must name
   * an entity that actually exists; the ellipsis-truncated form does not, and
   * shipping it made the product's own repair chip unroutable.
   */
  readonly optionLabelFull: string | null;
  readonly factorLabelFull: string | null;
  readonly nextStep: string;
}

export interface ReadinessRecoveryChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

interface ReadinessBlockerLite {
  readonly option_id?: string;
  readonly option_label?: string;
  readonly factor_id?: string;
  readonly factor_label?: string;
  readonly blocker_type?: 'missing_value' | 'ambiguous_value' | 'missing_connection' | 'constraint_dropped';
  readonly suggested_action?: 'add_value' | 'confirm_value' | 'add_edge' | 'review_constraint';
}

interface ReadinessOptionLite {
  readonly id?: string;
  readonly option_id?: string;
  readonly label?: string;
  readonly status?: 'ready' | 'needs_user_mapping' | 'needs_encoding';
}

// N26: the local label truncator that used to live here is DELETED. It
// appended an ellipsis but was bracket-unaware, so on the 18 Aug witness it
// emitted `double down on enterprise sales (higher…`, which
// `configure-option-chip-text.ts` chipped into
// `Configure double down on enterprise sales (higher…`. An ellipsis does not
// close a bracket. Label elision has exactly one owner in CEE —
// `src/utils/label-elision.ts`.

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asBlocker(value: unknown): ReadinessBlockerLite | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const blockerType = readString(candidate.blocker_type);
  const suggestedAction = readString(candidate.suggested_action);
  return {
    option_id: readString(candidate.option_id) ?? undefined,
    option_label: readString(candidate.option_label) ?? undefined,
    factor_id: readString(candidate.factor_id) ?? undefined,
    factor_label: readString(candidate.factor_label) ?? undefined,
    blocker_type:
      blockerType === 'missing_value'
      || blockerType === 'ambiguous_value'
      || blockerType === 'missing_connection'
      || blockerType === 'constraint_dropped'
        ? blockerType
        : undefined,
    suggested_action:
      suggestedAction === 'add_value'
      || suggestedAction === 'confirm_value'
      || suggestedAction === 'add_edge'
      || suggestedAction === 'review_constraint'
        ? suggestedAction
        : undefined,
  };
}

function asOption(value: unknown): ReadinessOptionLite | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const status = readString(candidate.status);
  return {
    id: readString(candidate.id) ?? undefined,
    option_id: readString(candidate.option_id) ?? undefined,
    label: readString(candidate.label) ?? undefined,
    status:
      status === 'ready' || status === 'needs_user_mapping' || status === 'needs_encoding'
        ? status
        : undefined,
  };
}

/**
 * ONE resolution, both forms. `display` is what the on-screen sentence uses;
 * `full` is the entity's real label, which is what any replayed message must
 * carry. Returning them together is what makes it structurally impossible for
 * a chip to name a different entity than the prose does.
 */
interface ResolvedLabel {
  readonly full: string;
  readonly display: string;
}

function resolveLabel(
  nodes: readonly ReadinessRecoveryNode[],
  kind: 'option' | 'factor',
  id: string | undefined,
  suppliedLabel: string | undefined,
): ResolvedLabel | null {
  if (id) {
    const graphLabel = nodes.find(
      (node) => node.id === id && node.kind === kind && typeof node.label === 'string',
    )?.label;
    if (graphLabel?.trim()) return asResolvedLabel(graphLabel.trim());
  }
  return suppliedLabel?.trim() ? asResolvedLabel(suppliedLabel.trim()) : null;
}

/**
 * ⭐ BOTH FIXES, COMPOSED — #1041 (N26) and this lane close the SAME defect
 * class from opposite ends and neither supersedes the other.
 *
 * #1041 made the DISPLAY cut honest: `elideLabelAtWordBoundary` is CEE's one
 * owner of "which prefix of a user label may we show", and it is bracket-aware,
 * so the on-screen sentence no longer reads `…enterprise sales (higher…`.
 * This lane makes the MESSAGE honest: a chip's message is replayed as user text
 * and must name an entity that EXISTS, so it carries `full` — no elision at all.
 *
 * Taking either side wholesale would have re-opened the other's defect: #1041's
 * elider alone still feeds a cut label into a replayed message, and this lane's
 * `full` alone leaves the display cut mid-bracket. One resolution, two forms.
 */
function asResolvedLabel(full: string): ResolvedLabel {
  return { full, display: elideLabelAtWordBoundary(full, MAX_LABEL_CHARS) };
}

function display(label: ResolvedLabel | null): string | null {
  return label === null ? null : label.display;
}

function full(label: ResolvedLabel | null): string | null {
  return label === null ? null : label.full;
}

function optionFactorPair(option: string, factor: string): string {
  return ` for "${option}" on "${factor}"`;
}

/**
 * ⭐⭐ HOW MUCH IS LEFT — the sentence that turns a symptom fix into an outcome
 * fix, and the reason it does NOT batch the write.
 *
 * MEASURED, wire-level, on the same deployed build this lane was briefed
 * against (15-journey battery, controls firing throughout):
 *
 *   recovery clears the blocker it asked about   9 of 10  (90%)
 *   recovery terminates in a RUN                 1 of 10  (10%)
 *
 * The gap is not the parser and not the wording. Drafts carry **3, 4, 4, 5, 7
 * and 8** missing effect values and the affordance surfaces **exactly one**, so
 * a user who answers perfectly clears one of eight, is asked one more question
 * that looks identical to the last, and has no way to know whether they are
 * one step from a run or seven. **That is trap 23 in the live product: the
 * metric the fix is aimed at moves and the user is still stuck.**
 *
 * ⚠⚠ AND THIS IS WHY IT NAMES A COUNT RATHER THAN LISTING THE PAIRS. A batched
 * ASK is fine; a batched, ORDER-GUESSED WRITE is banned, and the two are one
 * edit apart. If this sentence listed every outstanding pair, a user reading a
 * list of eight and replying "60%" would have their figure bound to
 * `blockers[0]` — the head — by `deriveOnScreenEffectAsk`, because that reader's
 * whole justification is that a bare figure's only antecedent is THE ONE
 * QUESTION ON SCREEN. Listing the set destroys that justification and silently
 * converts an unambiguous bind into a guess about which factor the user meant.
 * A misbind is worse than a refusal.
 *
 * So: exactly one question stays live, and the user is told how many follow.
 * They can finish, and nothing has to guess.
 *
 * ⭐ DERIVED FROM THE ONE OWNER of "which pairs is the product saying it has no
 * value for" (`deriveMissingEffectPairs`), never counted here — a second count
 * would disagree with the blocker copy about exactly the pairs under dispute
 * (trap 12).
 *
 * ⚠ SILENT AT ONE, deliberately: "and 0 more after this" is noise, and the
 * single-blocker case is the one that actually ends in a run.
 */
function describeRemainingEffectValues(
  analysisReady: ReadinessRecoveryInput | null | undefined,
): string {
  const remaining = deriveMissingEffectPairs(analysisReady as { blockers?: unknown }).length;
  if (remaining <= 1) return '';
  const others = remaining - 1;
  return others === 1
    ? ' There is 1 more effect value to set after this one, and I will ask for it next.'
    : ` There are ${others} more effect values to set after this one — I will ask for them one at a time.`;
}

/**
 * Project a typed readiness payload into its sole deterministic recovery.
 * Exact `ready` is the only branch that returns Run copy.
 */
export function projectReadinessRecovery(
  analysisReady: ReadinessRecoveryInput | null | undefined,
  nodes: readonly ReadinessRecoveryNode[] = [],
): ReadinessRecoveryProjection {
  const status = readString(analysisReady?.status) ?? null;
  const project = (
    kind: ReadinessRecoveryKind,
    optionLabel: ResolvedLabel | null,
    factorLabel: ResolvedLabel | null,
    nextStep: string,
  ): ReadinessRecoveryProjection => ({
    kind,
    status,
    optionLabel: display(optionLabel),
    factorLabel: display(factorLabel),
    optionLabelFull: full(optionLabel),
    factorLabelFull: full(factorLabel),
    nextStep,
  });

  if (status === 'ready') {
    return project('run', null, null, RUN_NEXT_STEP);
  }

  if (status === 'blocked') {
    return project(
      'resolve_model_issue',
      null,
      null,
      'Next, resolve the model issue shown before comparing the options.',
    );
  }

  const nonReadyOptions = analysisReady?.options
    ?.map(asOption)
    .filter((option): option is ReadinessOptionLite => option !== null && option.status !== 'ready')
    ?? [];
  const statusMatchedOption = status === 'needs_user_mapping' || status === 'needs_encoding'
    ? nonReadyOptions.find((option) => option.status === status)
    : undefined;
  const nonReadyOption = statusMatchedOption ?? nonReadyOptions[0];
  const optionLabel = nonReadyOption
    ? resolveLabel(
        nodes,
        'option',
        nonReadyOption.id ?? nonReadyOption.option_id,
        nonReadyOption.label,
      )
    : null;
  const firstBlocker = asBlocker(analysisReady?.blockers?.[0]);
  const blockerFactorLabel = firstBlocker
    ? resolveLabel(nodes, 'factor', firstBlocker.factor_id, firstBlocker.factor_label)
    : null;

  // Whole status wins over the blocker class. In particular, the canonical
  // unreachable-factor blocker is factor-only `missing_value`, but its payload
  // status is mapping and therefore stays mapping here.
  if (status === 'needs_user_mapping') {
    return project(
      'map_option',
      optionLabel,
      blockerFactorLabel,
      optionLabel
        ? `Next, configure "${optionLabel.display}" by choosing which factor it changes and by how much.`
        : 'Next, configure the unresolved mapping by choosing which option changes which factor and by how much.',
    );
  }

  if (status === 'needs_encoding') {
    return project(
      'encode_option',
      optionLabel,
      blockerFactorLabel,
      optionLabel
        ? `Next, choose how "${optionLabel.display}" should be represented on the effect scale before comparing the options.`
        : 'Next, choose how the unresolved option should be represented on the effect scale.',
    );
  }

  if (status === 'needs_user_input') {
    if (firstBlocker) {
      const blockerOptionLabel = resolveLabel(
        nodes,
        'option',
        firstBlocker.option_id,
        firstBlocker.option_label,
      );
      const factorLabel = blockerFactorLabel;
      const action = firstBlocker.blocker_type ?? firstBlocker.suggested_action;
      if ((action === 'missing_value' || action === 'add_value') && blockerOptionLabel && factorLabel) {
        return project(
          'provide_value',
          blockerOptionLabel,
          factorLabel,
          // ⭐ THE ASK NOW SAYS WHAT AN ANSWER LOOKS LIKE. The leading clause is
          // unchanged; the hint is APPENDED, and it is imported from the module
          // that DECIDES acceptance rather than spelled here, so the product
          // cannot advertise a phrasing its own binder refuses (P8). See
          // `routing/missing-value-answer.ts::MISSING_VALUE_ASK_FORMAT_HINT`.
          `Next, choose the missing effect value${optionFactorPair(blockerOptionLabel.display, factorLabel.display)} so the comparison can be prepared. ${MISSING_VALUE_ASK_FORMAT_HINT}`
          + describeRemainingEffectValues(analysisReady),
        );
      }
      if ((action === 'ambiguous_value' || action === 'confirm_value') && blockerOptionLabel && factorLabel) {
        return project(
          'confirm_value',
          blockerOptionLabel,
          factorLabel,
          `Next, confirm the effect value${optionFactorPair(blockerOptionLabel.display, factorLabel.display)} so the comparison can be prepared.`,
        );
      }
      if ((action === 'missing_connection' || action === 'add_edge') && blockerOptionLabel && factorLabel) {
        return project(
          'connect_option',
          blockerOptionLabel,
          factorLabel,
          `Next, connect "${blockerOptionLabel.display}" to "${factorLabel.display}" so the comparison can be prepared.`,
        );
      }
      if (action === 'constraint_dropped' || action === 'review_constraint') {
        const context = blockerOptionLabel && factorLabel
          ? ` for "${blockerOptionLabel.display}" involving "${factorLabel.display}"`
          : blockerOptionLabel
            ? ` for "${blockerOptionLabel.display}"`
            : factorLabel
              ? ` involving "${factorLabel.display}"`
              : '';
        return project(
          'review_constraint',
          blockerOptionLabel,
          factorLabel,
          `Next, review the constraint${context} before comparing the options.`,
        );
      }
    }

    return project(
      'configure_option',
      optionLabel,
      blockerFactorLabel,
      optionLabel
        ? `Next, configure "${optionLabel.display}" by choosing which factor it changes and by how much.`
        : 'Next, configure the unresolved option by choosing its factor and effect.',
    );
  }

  return project(
    'review_model',
    optionLabel,
    blockerFactorLabel,
    'Next, review the model and fill any gaps before comparing the options.',
  );
}

export interface ReadinessNextStepOptions {
  /**
   * TRUE when the caller's decision node exists only because the projector
   * always mints one — see `hasProvisionalDecision` in `post-draft-narrative.ts`,
   * which is the sole owner of that determination. Selection is bound to the
   * recovery KIND (`run`), never to a substring of the sentence, so a future
   * branch that happens to mention options cannot be caught by it.
   */
  readonly provisionalDecision?: boolean;
}

export function buildReadinessNextStep(
  analysisReady: ReadinessRecoveryInput | null | undefined,
  nodes: readonly ReadinessRecoveryNode[] = [],
  options: ReadinessNextStepOptions = {},
): string {
  const recovery = projectReadinessRecovery(analysisReady, nodes);
  if (options.provisionalDecision === true && recovery.kind === 'run') {
    return RUN_NEXT_STEP_PROVISIONAL;
  }
  return recovery.nextStep;
}

/**
 * Build the sole conversational recovery chip for a non-ready state. Run is
 * deliberately returned as `null`; executable Run chips stay at their
 * registry-aware call sites and must check exact `status === 'ready'`.
 *
 * ⭐⭐ THE `provide_value` BRANCH IS THE REPAIR LOOP'S AFFORDANCE, AND IT IS
 * MINTED FROM IDENTITY, NOT FROM A LABEL.
 *
 * It used to return `buildConfigureOptionChip(recovery.optionLabel)` — an
 * option name and nothing else, and (before this change) an ellipsis-truncated
 * one. Witnessed 19 Aug 2026 on deployed UI `aa916511` / CEE `7abed98`: the
 * product offered `chip_prompt_configure_option` for a pair the user had
 * ALREADY set, the click made no progress, and the following turn carried no
 * affordance at all. A chip naming one option leaves the model to pick which of
 * that option's factors was meant — and it picked a resolved one.
 *
 * `deriveAskedEffectPair` is the estate's one owner of "which slot is the
 * product asking about" (`routing/repair-value-binding.ts`), read off the head
 * of the SAME blocker list `projectReadinessRecovery` composes `nextStep` from
 * — line for line the element at `:194`/`:242` above. So the chip and the
 * sentence beneath it cannot name different slots, and the chip inherits the
 * candidate set's three guarantees rather than re-checking them: a resolved
 * pair has no blocker, an edgeless pair is never given one, and a pair the
 * product is not asking about is not in the list.
 *
 * ⚠ SAFE-BIASED FALLBACK. `deriveAskedEffectPair` requires the head blocker to
 * carry FULL identity (option and factor, id and label); `provide_value` only
 * requires resolvable labels. Where they disagree the pre-existing chip is
 * returned unchanged, so this can add identity but never remove an affordance.
 */
export function buildReadinessRecoveryChip(
  analysisReady: ReadinessRecoveryInput | null | undefined,
  nodes: readonly ReadinessRecoveryNode[] = [],
): ReadinessRecoveryChip | null {
  const recovery = projectReadinessRecovery(analysisReady, nodes);
  switch (recovery.kind) {
    case 'run':
      return null;
    case 'resolve_model_issue':
      return {
        id: 'chip_prompt_resolve_model_issue',
        label: 'Resolve model issue',
        message: 'Help me resolve the model issue that is blocking analysis.',
      };
    case 'map_option':
      if (recovery.optionLabelFull && recovery.optionLabel) {
        return buildConfigureOptionChipWithDisplay(recovery.optionLabelFull, recovery.optionLabel);
      }
      if (recovery.factorLabelFull && recovery.factorLabel) {
        return {
          id: 'chip_prompt_map_factor_to_option',
          label: `Map "${recovery.factorLabel}" to an option`,
          message: `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}which option should affect "${recovery.factorLabelFull}".`,
        };
      }
      return {
        id: 'chip_prompt_map_option_to_factor',
        label: 'Map an option to factors',
        message: `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}which options should affect the unresolved factors.`,
      };
    case 'provide_value': {
      const asked = deriveAskedEffectPair(analysisReady);
      if (asked !== null) {
        // FULL labels for the replayed message (it must name real entities);
        // the display form for the chip LABEL is the SAME string cut with the
        // SAME budget and the SAME canonical elider this module already uses
        // for its prose — so the chip and the sentence beneath it cannot cut
        // one label two ways (F4). No second budget is introduced anywhere.
        return buildRepairPairChip(
          asked.optionLabel,
          asked.factorLabel,
          elideLabelAtWordBoundary(asked.factorLabel, MAX_LABEL_CHARS),
        );
      }
      return recovery.optionLabelFull && recovery.optionLabel
        ? buildConfigureOptionChipWithDisplay(recovery.optionLabelFull, recovery.optionLabel)
        : { ...CONFIGURE_OPTION_GENERIC_CHIP };
    }
    case 'encode_option':
    case 'confirm_value':
    case 'connect_option':
    case 'configure_option':
      return recovery.optionLabelFull && recovery.optionLabel
        ? buildConfigureOptionChipWithDisplay(recovery.optionLabelFull, recovery.optionLabel)
        : { ...CONFIGURE_OPTION_GENERIC_CHIP };
    case 'review_constraint':
      return {
        id: 'chip_prompt_review_model_constraint',
        label: 'Review model constraint',
        message: 'Help me review the unresolved constraint before analysis.',
      };
    case 'review_model':
      return {
        id: 'chip_prompt_review_model_gaps',
        label: 'Review model gaps',
        message: 'Help me review what is still missing from the model before analysis.',
      };
  }
}
