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
  buildConfigureOptionChip,
} from '../configure-option-chip-text.js';

const MAX_LABEL_CHARS = 40;

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
  readonly optionLabel: string | null;
  readonly factorLabel: string | null;
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

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

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

function resolveLabel(
  nodes: readonly ReadinessRecoveryNode[],
  kind: 'option' | 'factor',
  id: string | undefined,
  suppliedLabel: string | undefined,
): string | null {
  if (id) {
    const graphLabel = nodes.find(
      (node) => node.id === id && node.kind === kind && typeof node.label === 'string',
    )?.label;
    if (graphLabel?.trim()) return truncate(graphLabel.trim(), MAX_LABEL_CHARS);
  }
  return suppliedLabel?.trim() ? truncate(suppliedLabel.trim(), MAX_LABEL_CHARS) : null;
}

function optionFactorPair(option: string, factor: string): string {
  return ` for "${option}" on "${factor}"`;
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
  if (status === 'ready') {
    return {
      kind: 'run',
      status,
      optionLabel: null,
      factorLabel: null,
      nextStep: 'Next, run the analysis to see how the options compare and what could shift the outcome.',
    };
  }

  if (status === 'blocked') {
    return {
      kind: 'resolve_model_issue',
      status,
      optionLabel: null,
      factorLabel: null,
      nextStep: 'Next, resolve the model issue shown before comparing the options.',
    };
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
    return {
      kind: 'map_option',
      status,
      optionLabel,
      factorLabel: blockerFactorLabel,
      nextStep: optionLabel
        ? `Next, configure "${optionLabel}" by choosing which factor it changes and by how much.`
        : 'Next, configure the unresolved mapping by choosing which option changes which factor and by how much.',
    };
  }

  if (status === 'needs_encoding') {
    return {
      kind: 'encode_option',
      status,
      optionLabel,
      factorLabel: blockerFactorLabel,
      nextStep: optionLabel
        ? `Next, choose how "${optionLabel}" should be represented on the effect scale before comparing the options.`
        : 'Next, choose how the unresolved option should be represented on the effect scale.',
    };
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
        return {
          kind: 'provide_value',
          status,
          optionLabel: blockerOptionLabel,
          factorLabel,
          nextStep: `Next, choose the missing effect value${optionFactorPair(blockerOptionLabel, factorLabel)} so the comparison can be prepared.`,
        };
      }
      if ((action === 'ambiguous_value' || action === 'confirm_value') && blockerOptionLabel && factorLabel) {
        return {
          kind: 'confirm_value',
          status,
          optionLabel: blockerOptionLabel,
          factorLabel,
          nextStep: `Next, confirm the effect value${optionFactorPair(blockerOptionLabel, factorLabel)} so the comparison can be prepared.`,
        };
      }
      if ((action === 'missing_connection' || action === 'add_edge') && blockerOptionLabel && factorLabel) {
        return {
          kind: 'connect_option',
          status,
          optionLabel: blockerOptionLabel,
          factorLabel,
          nextStep: `Next, connect "${blockerOptionLabel}" to "${factorLabel}" so the comparison can be prepared.`,
        };
      }
      if (action === 'constraint_dropped' || action === 'review_constraint') {
        const context = blockerOptionLabel && factorLabel
          ? ` for "${blockerOptionLabel}" involving "${factorLabel}"`
          : blockerOptionLabel
            ? ` for "${blockerOptionLabel}"`
            : factorLabel
              ? ` involving "${factorLabel}"`
              : '';
        return {
          kind: 'review_constraint',
          status,
          optionLabel: blockerOptionLabel,
          factorLabel,
          nextStep: `Next, review the constraint${context} before comparing the options.`,
        };
      }
    }

    return {
      kind: 'configure_option',
      status,
      optionLabel,
      factorLabel: blockerFactorLabel,
      nextStep: optionLabel
        ? `Next, configure "${optionLabel}" by choosing which factor it changes and by how much.`
        : 'Next, configure the unresolved option by choosing its factor and effect.',
    };
  }

  return {
    kind: 'review_model',
    status,
    optionLabel,
    factorLabel: blockerFactorLabel,
    nextStep: 'Next, review the model and fill any gaps before comparing the options.',
  };
}

export function buildReadinessNextStep(
  analysisReady: ReadinessRecoveryInput | null | undefined,
  nodes: readonly ReadinessRecoveryNode[] = [],
): string {
  return projectReadinessRecovery(analysisReady, nodes).nextStep;
}

/**
 * Build the sole conversational recovery chip for a non-ready state. Run is
 * deliberately returned as `null`; executable Run chips stay at their
 * registry-aware call sites and must check exact `status === 'ready'`.
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
      if (recovery.optionLabel) return buildConfigureOptionChip(recovery.optionLabel);
      if (recovery.factorLabel) {
        return {
          id: 'chip_prompt_map_factor_to_option',
          label: `Map "${recovery.factorLabel}" to an option`,
          message: `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}which option should affect "${recovery.factorLabel}".`,
        };
      }
      return {
        id: 'chip_prompt_map_option_to_factor',
        label: 'Map an option to factors',
        message: `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}which options should affect the unresolved factors.`,
      };
    case 'encode_option':
    case 'provide_value':
    case 'confirm_value':
    case 'connect_option':
    case 'configure_option':
      return recovery.optionLabel
        ? buildConfigureOptionChip(recovery.optionLabel)
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
