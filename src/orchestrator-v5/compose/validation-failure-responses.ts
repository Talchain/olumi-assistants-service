/**
 * Per-code composer for V5 validation failures.
 *
 * One switch branch per reachable `ValidationErrorCode`. Each branch yields
 * a short user-facing `assistant_text` plus one or more `SuggestedAction`s
 * — every path returns at least one chip so the user always has a next
 * step (§7 quality contract).
 *
 * All dynamic interpolations pass through `safeLabel` (for entity labels;
 * capped at 60 chars inside the helper) or `sanitiseForUser` (for
 * free-text internal fields; capped at 100 chars inside the helper).
 * Enum-bearing fields (EntityKind) are validated by `pickKind` before use.
 * Entity IDs never appear in output.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import type { ValidationError, ValidationErrorCode } from '../routing/validator.js';
import type { EntityKind } from '../routing/types.js';
import { log } from '../../utils/telemetry.js';

import type {
  ChipType,
  ComposeContext,
  FailureComposeResult,
  SuggestedAction,
} from './types.js';
import {
  curatedHandlerChips,
  safeLabel,
  sanitiseForUser,
  type EntityLike,
} from './helpers.js';

const ENTITY_SIBLING_CAP = 4;
const AMBIGUOUS_CANDIDATE_CAP = 5;

export interface ComposedValidationFailure {
  readonly response: OlumiResponse;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

/**
 * Build an OlumiResponse for a validation failure. `template_id` and
 * `chip_type` flow into the failure_response telemetry so an integration
 * test can assert "no reachable code hit the fallback" and that every path
 * attaches a typed chip.
 *
 * V5 alpha hardening note: after Phase 2.2, this composer is the
 * **impossible-state safety net** — every recoverable validator code is
 * routed through `composeRecoverableValidationResponse` (clean body, no
 * error block) and committed as a direct_answer turn. This function
 * continues to ship the error-block wrapper so a future unknown code (or
 * a compile-time-exhaustiveness bug) still fails loudly with a typed
 * 500 rather than a silent no-op.
 */
export function composeValidationFailure(
  error: ValidationError,
  ctx: ComposeContext,
  stage: StageType,
): ComposedValidationFailure {
  const result = composeBody(error, ctx);
  return {
    response: wrapResponse(error, result.body, stage),
    template_id: result.template_id,
    chip_type: result.chip_type,
  };
}

export interface BranchResult {
  readonly body: FailureComposeResult;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

/**
 * Per-code body composer. Extracted from the prior switch statement so each
 * branch is independently testable and the dispatch layer is a data map
 * (`VALIDATION_COMPOSERS`) that the TypeScript compiler verifies is
 * exhaustive against `ValidationErrorCode`.
 */
type BranchComposerFn = (error: ValidationError, ctx: ComposeContext) => BranchResult;

function composeHandlerNotFound(error: ValidationError, ctx: ComposeContext): BranchResult {
  const chips = curatedHandlerChips(ctx.handlerRegistry).map(
    (h): SuggestedAction => ({
      id: chipId('action', h.handler_id),
      label: h.label,
      message: `${h.label}.`,
      action_type: h.handler_id as SuggestedAction['action_type'],
    }),
  );
  if (chips.length > 0) {
    return {
      body: {
        assistant_text:
          "I don't recognise that action. Here's what I can help with right now.",
        suggested_actions: chips,
      },
      template_id: 'handler_not_found',
      chip_type: 'action',
    };
  }
  return {
    body: {
      assistant_text:
        "I don't recognise that action. Here's what I can help with right now.",
      suggested_actions: [fallbackPrompt('Tell me what you would like to do')],
    },
    template_id: 'handler_not_found',
    chip_type: 'text_prompt',
  };
}

function composeEntityResolutionAmbiguous(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  const kind = pickKind(details.entity_kind);
  const candidates = readCandidates(details.candidates);
  if (candidates.length > 0) {
    const chips = candidates.slice(0, AMBIGUOUS_CANDIDATE_CAP).map(
      (c, i): SuggestedAction => {
        const label = safeLabel({ label: c.label, kind: kind ?? undefined });
        return {
          id: chipId('entity', `${kind ?? 'item'}-${i}`),
          label,
          message: `I meant ${label}.`,
        };
      },
    );
    return {
      body: {
        assistant_text: `Which ${kind ?? 'item'} do you mean?`,
        suggested_actions: chips,
      },
      template_id: 'ambiguous_with_candidates',
      chip_type: 'entity_suggestion',
    };
  }
  return {
    body: {
      assistant_text: `I need more detail. Which ${kind ?? 'item'} do you mean?`,
      suggested_actions: [fallbackPrompt('Tell me which one')],
    },
    template_id: 'ambiguous_no_candidates',
    chip_type: 'text_prompt',
  };
}

function composeEntityKindMismatch(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  const proposedKind = pickKind(details.proposed_kind);
  const resolvedKind = pickKind(details.resolved_kind);
  const accepted = readAcceptedKinds(details.accepted_kinds);
  const entityLabel = safeLabel({
    label: readString(details.proposed_label),
    kind: proposedKind ?? undefined,
  });
  if (resolvedKind) {
    return {
      body: {
        assistant_text:
          `${entityLabel} is a ${resolvedKind} in your model, not a ${proposedKind ?? 'that kind'}.`,
        suggested_actions: [fallbackPrompt('Try describing what you want to change')],
      },
      template_id: 'kind_mismatch_graph',
      chip_type: 'text_prompt',
    };
  }
  const accept = accepted[0];
  return {
    body: {
      assistant_text:
        `${entityLabel} is a ${proposedKind ?? 'different kind'}, not a ${accept ?? 'matching kind'}.`,
      suggested_actions: [fallbackPrompt('Try describing what you want to change')],
    },
    template_id: 'kind_mismatch_structural',
    chip_type: 'text_prompt',
  };
}

function composeEntityNotFound(error: ValidationError, ctx: ComposeContext): BranchResult {
  const details = error.details ?? {};
  const kind = pickKind(details.entity_kind);
  const entityLabel = safeLabel({
    label: readString(details.entity_label),
    kind: kind ?? undefined,
  });
  const graph = ctx.graph;
  if (graph && kind) {
    const siblings = graph.listEntitiesByKind(kind).slice(0, ENTITY_SIBLING_CAP);
    if (siblings.length > 0) {
      const chips = siblings.map(
        (s, i): SuggestedAction => {
          const label = safeLabel({ label: s.label, kind });
          return {
            id: chipId('entity', `nf-${i}`),
            label,
            message: `I meant ${label}.`,
          };
        },
      );
      return {
        body: {
          assistant_text:
            `I can't find ${entityLabel} in your model. Did you mean one of these?`,
          suggested_actions: chips,
        },
        template_id: 'entity_not_found_with_siblings',
        chip_type: 'entity_suggestion',
      };
    }
  }
  return {
    body: {
      assistant_text: `I can't find ${entityLabel} in your model.`,
      suggested_actions: [fallbackPrompt('Try describing what you want')],
    },
    template_id: 'entity_not_found_no_siblings',
    chip_type: 'text_prompt',
  };
}

function composeEntityResolutionSuspicious(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  const kind = pickKind(details.entity_kind);
  const chosen = readLabelBearer(details.chosen, kind);
  const closer = readLabelBearer(details.closer_candidate, kind);
  const chosenLabel = safeLabel(chosen);
  const closerLabel = safeLabel(closer);
  const chips: SuggestedAction[] = [
    {
      id: chipId('entity', 'chosen'),
      label: chosenLabel,
      message: `I meant ${chosenLabel}.`,
    },
    {
      id: chipId('entity', 'closer'),
      label: closerLabel,
      message: `I meant ${closerLabel}.`,
    },
  ];
  return {
    body: {
      assistant_text:
        `Did you mean ${chosenLabel} or ${closerLabel}? They're both in your model.`,
      suggested_actions: chips,
    },
    template_id: 'resolution_suspicious',
    chip_type: 'entity_suggestion',
  };
}

function composePreconditionUnmet(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  const reason = readString(details.reason);
  const handlerId = readString(details.handler_id);
  if (handlerId === 'run_analysis' && reason === 'no_options_defined') {
    return {
      body: {
        assistant_text:
          'The analysis needs at least one option to compare. Add your first option to get started.',
        suggested_actions: [
          {
            id: chipId('prompt', 'add-option'),
            label: 'Add an option',
            message: 'I want to add an option to my scenario.',
          },
        ],
      },
      template_id: 'precondition_no_options',
      chip_type: 'text_prompt',
    };
  }
  return {
    body: {
      assistant_text: "I can't run that yet. A prerequisite isn't met.",
      suggested_actions: [fallbackPrompt('Tell me what you would like to do')],
    },
    template_id: 'precondition_generic',
    chip_type: 'text_prompt',
  };
}

function composeParameterInvalid(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  // `parameter` is a free-string field from the proposal; sanitise before
  // interpolating. constraint/actual are already sanitised.
  const parameter = sanitiseForUser(readString(details.parameter) ?? 'that value');
  const constraint = sanitiseForUser(details.constraint_description ?? 'a valid value');
  const actual = sanitiseForUser(details.actual_value);
  return {
    body: {
      assistant_text:
        `'${parameter}' needs to be ${constraint}. You gave ${actual}.`,
      suggested_actions: [
        {
          id: chipId('prompt', 'param-retry'),
          label: 'Try a different value',
          message: `Use a different value for ${parameter}.`,
        },
      ],
    },
    template_id: 'parameter_invalid',
    chip_type: 'text_prompt',
  };
}

/**
 * Composer map — `Record<ValidationErrorCode, BranchComposerFn>` with
 * TypeScript exhaustiveness. Adding a new code to the `ValidationErrorCode`
 * union without adding an entry here is a compile error (see
 * `assertComposersExhaustive` below). Correction 8 of the V5 alpha
 * hardening plan.
 */
export const VALIDATION_COMPOSERS: Readonly<Record<ValidationErrorCode, BranchComposerFn>> = {
  HANDLER_NOT_FOUND: composeHandlerNotFound,
  ENTITY_RESOLUTION_AMBIGUOUS: (e) => composeEntityResolutionAmbiguous(e),
  ENTITY_KIND_MISMATCH: (e) => composeEntityKindMismatch(e),
  ENTITY_NOT_FOUND: composeEntityNotFound,
  ENTITY_RESOLUTION_SUSPICIOUS: (e) => composeEntityResolutionSuspicious(e),
  PRECONDITION_UNMET: (e) => composePreconditionUnmet(e),
  PARAMETER_INVALID: (e) => composeParameterInvalid(e),
};

/**
 * Public entry point shared by both the 200 recoverable wrapper and the
 * 500 impossible-state wrapper. Runtime fallback: if an unknown code
 * somehow arrives (e.g. a future change widens the union without
 * updating the map), log fatal and emit a generic body so the safety-
 * net 500 path has something to wrap. Correction 8.
 */
export function composeBody(error: ValidationError, ctx: ComposeContext): BranchResult {
  const composer = VALIDATION_COMPOSERS[error.code];
  if (composer) return composer(error, ctx);

  // Unknown code — should be impossible under correct compile. Log the
  // violation with enough context to debug without leaking user text.
  log.error(
    {
      event: 'assert_unknown_validation_code',
      validation_error_code: String(error.code),
      known_codes: Object.keys(VALIDATION_COMPOSERS),
    },
    'V5 validator outcome: unknown code — compile-time exhaustiveness broken',
  );
  return {
    body: {
      assistant_text:
        "Something unexpected happened on our side. Your request wasn't processed.",
      suggested_actions: [fallbackPrompt('Try again in a moment')],
    },
    template_id: 'unknown_validation_code',
    chip_type: 'text_prompt',
  };
}

// ---------------------------------------------------------------------------
// Response wrapper
// ---------------------------------------------------------------------------

// Validator error codes that are genuinely transient — retrying the
// same input could succeed because some server-side state may change
// between attempts. Everything NOT in this set is a deterministic input
// fault (the user / routing LLM sent something the server cannot act
// on); retrying unchanged inputs will always fail and retryable=true
// would mislead clients into pointless retry loops.
//
// Today this set is empty: all 7 validator codes
// (HANDLER_NOT_FOUND, ENTITY_NOT_FOUND, ENTITY_KIND_MISMATCH,
//  ENTITY_RESOLUTION_AMBIGUOUS, ENTITY_RESOLUTION_SUSPICIOUS,
//  PARAMETER_INVALID, PRECONDITION_UNMET)
// are deterministic input faults. If a future validator code IS
// transient (e.g. a graph lookup that depends on a race condition),
// add it here. The empty Set is kept to preserve the shape — adding
// a transient code later requires exactly one line change, not a
// design.
const TRANSIENT_VALIDATOR_CODES: ReadonlySet<ValidationError['code']> = new Set<ValidationError['code']>();

function wrapResponse(
  error: ValidationError,
  body: FailureComposeResult,
  stage: StageType,
): OlumiResponse {
  // v5-exclusive-cee P0 follow-up: HANDLER_NOT_FOUND surfaces as the typed
  // FEATURE_NOT_ENABLED wire code (via UNSUPPORTED_ACTION internal class)
  // so clients can distinguish a declared-but-unbuilt action from a
  // generic internal bug. All other validator failures keep the existing
  // INTERNAL_ERROR wire code — their semantics are client-correctable
  // (entity ambiguity, missing options, etc.) and don't benefit from a
  // permanent "feature not enabled" framing.
  const wireCode = error.code === 'HANDLER_NOT_FOUND'
    ? ('FEATURE_NOT_ENABLED' as const)
    : ('INTERNAL_ERROR' as const);
  // Retryability: default false. All validator codes today are
  // deterministic input faults; retrying unchanged inputs always fails.
  // A future transient validator code would opt in via the
  // TRANSIENT_VALIDATOR_CODES set. (v5-exclusive-cee P1 follow-up —
  // the prior default was `true unless HANDLER_NOT_FOUND`, which
  // mislabelled ENTITY_NOT_FOUND / PRECONDITION_UNMET / etc. as
  // retryable and risked the client into pointless retry loops.)
  const retryable = TRANSIENT_VALIDATOR_CODES.has(error.code);
  return {
    response_version: 2,
    assistant_text: body.assistant_text,
    blocks: [
      {
        type: 'error',
        error_code: wireCode,
        severity: 'error',
        details: {
          failure_origin: 'validator',
          error_code: error.code,
          retryable,
          ...(error.code === 'HANDLER_NOT_FOUND' && error.details
            ? {
                reason: 'handler_not_registered',
                handler_id: error.details.handler_id,
              }
            : {}),
        },
      },
    ],
    suggested_actions: [...body.suggested_actions],
    insights: [],
    stage_indicator: stage,
  };
}

// ---------------------------------------------------------------------------
// Small typed detail readers
// ---------------------------------------------------------------------------

const ENTITY_KIND_VALUES: readonly EntityKind[] = [
  'node',
  'edge',
  'option',
  'goal',
  'constraint',
];

function pickKind(value: unknown): EntityKind | null {
  return typeof value === 'string' && (ENTITY_KIND_VALUES as readonly string[]).includes(value)
    ? (value as EntityKind)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readCandidates(value: unknown): EntityLike[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v !== null && typeof v === 'object')
    .map((raw) => {
      const record = raw as Record<string, unknown>;
      return {
        label: typeof record.label === 'string' ? record.label : null,
      } satisfies EntityLike;
    });
}

function readAcceptedKinds(value: unknown): readonly EntityKind[] {
  if (!Array.isArray(value)) return [];
  const out: EntityKind[] = [];
  for (const v of value) {
    const k = pickKind(v);
    if (k) out.push(k);
  }
  return out;
}

function readLabelBearer(value: unknown, kind: EntityKind | null): EntityLike | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    label: typeof record.label === 'string' ? record.label : null,
    kind: kind ?? undefined,
  };
}

function chipId(scope: 'action' | 'entity' | 'prompt', discriminator: string): string {
  return `chip_${scope}_${discriminator}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function fallbackPrompt(label: string): SuggestedAction {
  return {
    id: chipId('prompt', label),
    label,
    message: `${label}.`,
  };
}
