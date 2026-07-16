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
import { formatValueWithUnit } from '../tools/handlers/d1-shared/format-confirmation.js';
import { isClaimableByClarificationResume } from '../routing/clarification-resume.js';

const ENTITY_SIBLING_CAP = 4;
const AMBIGUOUS_CANDIDATE_CAP = 5;

/**
 * 1.16 item A2 — stable chip id for the user-consented "extend the scale"
 * chip on `value_exceeds_cap` rejections. Exported so the turn-executor's
 * recoverable-validator commit site can detect the chip on the composed
 * response and persist the matching `set_factor_value` pending action
 * (structured {value, unit, cap}) under the SAME id — the pending-action
 * resumer correlates chip and pending via `chip_id`.
 */
export const RESCALE_EXTEND_CAP_CHIP_ID = 'chip_prompt_rescale_extend_cap';

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
  const entityLabel = safeLabel({
    label: readString(details.proposed_label),
    kind: undefined,
  });
  return {
    body: {
      assistant_text:
        `I wasn't sure what you meant by ${entityLabel}. Try asking about a specific option, or describe what you'd like to change.`,
      suggested_actions: [fallbackPrompt('Try describing what you want to change')],
    },
    template_id: 'kind_mismatch',
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

  // V5 Golden Journey row 7 — Fix B. The `missing_value` rejection
  // branch is for proposals where the `value` parameter was either
  // absent from the proposal or shaped wrong (e.g. LLM emitted
  // operator without a paired value on a "from X to Y" turn). The
  // previous path rendered `sanitiseForUser(undefined) === 'unknown'`,
  // producing "You gave unknown." — a useless leak of an internal
  // sentinel. The new branch renders a help message that guides the
  // user toward supplying a value, without changing the existing
  // "You gave X" template for real invalid scalars.
  if (readString(details.rejection_reason) === 'missing_value') {
    return {
      body: {
        assistant_text:
          `I couldn't tell what value to use. Please tell me the number ` +
          `you want, for example £100,000.`,
        suggested_actions: [
          {
            id: chipId('prompt', 'param-supply-value'),
            label: 'Tell me the value',
            message: `Use a specific value for ${parameter}.`,
          },
        ],
      },
      template_id: 'parameter_invalid_missing_value',
      chip_type: 'text_prompt',
    };
  }

  // Value/unit honesty (set_factor_value): a bare number below 1 on a
  // factor that has a unit reads as a normalised proportion, not a value
  // in that unit. The predicate refused it before mutating; clarify
  // honestly without ever rendering the misleading "£0.3". Unit-aware and
  // NOT currency-specific — `details.unit` is a short symbol ('£', '%',
  // 'people') threaded by the validator. Falls back to unit-neutral copy
  // if the unit is somehow absent.
  if (readString(details.rejection_reason) === 'bare_ratio_on_unit_factor') {
    const unit = readString(details.unit);
    const isPercent = unit === '%';
    const valuePhrase = !unit
      ? 'the value to use'
      : isPercent
        ? 'a percentage'
        : `a value in ${sanitiseForUser(unit)}`;
    const askPhrase = !unit
      ? 'Tell me the value you want, with its unit (for example £6,000, 5%, or 12 months)'
      : isPercent
        ? 'Tell me the percentage you want'
        : `Tell me the amount in ${sanitiseForUser(unit)} you want`;
    return {
      body: {
        assistant_text:
          `That looks like a proportion rather than ${valuePhrase}, so I ` +
          `haven't changed anything. ${askPhrase}, and I'll apply it.`,
        suggested_actions: [
          {
            id: chipId('prompt', 'param-supply-ratio-value'),
            label: 'Tell me the value',
            message: `Use a specific value for ${parameter}.`,
          },
        ],
      },
      template_id: 'parameter_invalid_bare_ratio_on_unit_factor',
      chip_type: 'text_prompt',
    };
  }

  // 1.16 items A1/A2/B — honest copy for the remaining set_factor_value
  // rejection reasons. The validator threads a sanitised, user-readable
  // `details.issue` for every predicate rejection (e.g. "Value £250,000
  // exceeds the factor's cap of £200,000."), but these reasons previously
  // fell through to the generic "'value' needs to be a valid value." —
  // useless copy that told the user nothing about WHY the edit was refused.
  const rejectionReason = readString(details.rejection_reason);
  const issue = readString(details.issue);
  const factorLabel = readString(details.factor_label);

  if (rejectionReason === 'value_exceeds_cap') {
    const chips: SuggestedAction[] = [];
    const honestIssue = sanitiseForUser(issue ?? error.message);
    // A2 — user-consented rescale chip (never auto-applied). Attached only
    // when: the proposal carried an EXPLICIT unit (value_exceeds_cap
    // implies it, but the details may be minimal on legacy emitters), the
    // operator is an absolute 'set' (the suggested cap covers the stated
    // value, not a computed delta), a suggested cap was computed, and the
    // factor label is known. The label matters because the chip's replay
    // message must NAME the factor: the clarification-resume pre-route
    // matches the reply against the pending action's factor label. The
    // message deliberately carries NO digits and NO edit verb so it is
    // claimed by the resume path (which holds the structured {value, unit,
    // cap} on the persisted pending action) rather than by the
    // deterministic value-update path (which would drop the cap).
    const proposedValue = typeof details.value === 'number' ? details.value : undefined;
    const unit = readString(details.unit);
    const suggestedCap = typeof details.suggested_cap === 'number' ? details.suggested_cap : undefined;
    const operator = readString(details.operator) ?? 'set';
    if (
      proposedValue !== undefined &&
      unit !== undefined &&
      suggestedCap !== undefined &&
      suggestedCap >= proposedValue &&
      factorLabel !== undefined &&
      operator === 'set'
    ) {
      const label = safeLabel({ label: factorLabel, kind: undefined });
      const replayMessage = `Extend the scale for ${label} and use the new value.`;
      // PR #413 review FIXUP 2 — degrade-only label gate. The replay is
      // only deterministic when tryClarificationResume can claim it; a
      // label carrying a digit ("Phase 2 Cost") or an edit verb ("Set-up
      // Cost") trips the resumer's negative gate, the click falls to the
      // LLM WITHOUT the cap, and the user loops the same honest failure.
      // Apply the resumer's OWN predicate to the exact rendered message
      // and suppress the chip when it fails — the honest copy and the
      // retry prompt below still ship.
      if (isClaimableByClarificationResume(replayMessage)) {
        chips.push({
          id: RESCALE_EXTEND_CAP_CHIP_ID,
          label: `Set to ${formatValueWithUnit(proposedValue, unit)} and extend the scale`,
          message: replayMessage,
        });
      }
    }
    chips.push({
      id: chipId('prompt', 'param-cap-retry'),
      label: 'Try a different value',
      message: `Use a different value for ${parameter}.`,
    });
    return {
      body: {
        assistant_text:
          `${honestIssue} I haven't changed anything. ` +
          `You can extend the scale to allow it, or give a value within the current range.`,
        suggested_actions: chips,
      },
      template_id: 'parameter_invalid_value_exceeds_cap',
      chip_type: 'text_prompt',
    };
  }

  if (rejectionReason === 'bare_number_outside_cap') {
    return {
      body: {
        assistant_text:
          `${sanitiseForUser(issue ?? error.message)} I haven't changed anything. ` +
          `Tell me the value with its unit, for example £100,000, and I'll apply it.`,
        suggested_actions: [
          {
            id: chipId('prompt', 'param-supply-unit-value'),
            label: 'Tell me the value',
            message: `Use a specific value for ${parameter}.`,
          },
        ],
      },
      template_id: 'parameter_invalid_bare_number_outside_cap',
      chip_type: 'text_prompt',
    };
  }

  if (rejectionReason === 'cap_non_positive') {
    return {
      body: {
        assistant_text:
          `${sanitiseForUser(issue ?? error.message)} I haven't changed anything. ` +
          `Give the value with a sensible scale and I'll apply it.`,
        suggested_actions: [
          {
            id: chipId('prompt', 'param-cap-retry'),
            label: 'Try a different value',
            message: `Use a different value for ${parameter}.`,
          },
        ],
      },
      template_id: 'parameter_invalid_cap_non_positive',
      chip_type: 'text_prompt',
    };
  }

  // Item B — relative-edit honesty. A delta ("increase X by 10%") was
  // refused because the factor has no recorded current value to adjust
  // from. Name the entity and steer toward an absolute set.
  if (rejectionReason === 'delta_no_existing_value') {
    const subject = factorLabel !== undefined
      ? safeLabel({ label: factorLabel, kind: undefined })
      : 'That factor';
    return {
      body: {
        assistant_text:
          `${subject} doesn't have a recorded value yet, so I can't adjust it ` +
          `relative to a current value. Tell me what the value should be, for ` +
          `example £100,000, and I'll set it.`,
        suggested_actions: [
          {
            id: chipId('prompt', 'param-absolute-set'),
            label: 'Set its value',
            message: `Set ${subject} to a specific value.`,
          },
        ],
      },
      template_id: 'parameter_invalid_delta_no_existing_value',
      chip_type: 'text_prompt',
    };
  }

  // General fallback (item A1): when there is no constraint description but
  // the validator supplied a user-readable issue, render the issue rather
  // than the meaningless "'value' needs to be a valid value.".
  if (readString(details.constraint_description) === undefined && issue !== undefined) {
    return {
      body: {
        assistant_text:
          `${sanitiseForUser(issue)} I haven't changed anything. ` +
          `Tell me what you'd like instead and I'll apply it.`,
        suggested_actions: [
          {
            id: chipId('prompt', 'param-retry'),
            label: 'Try a different value',
            message: `Use a different value for ${parameter}.`,
          },
        ],
      },
      template_id: 'parameter_invalid_issue',
      chip_type: 'text_prompt',
    };
  }

  const constraint = sanitiseForUser(details.constraint_description ?? 'a valid value');
  const actual = sanitiseForUser(details.actual_value);
  // V5 edit_graph P0 (task_99f83f0d) — kill the "You gave unknown." leak.
  // `sanitiseForUser` maps undefined/null/empty inputs to the internal
  // 'unknown' sentinel; rendering "You gave unknown." leaks a placeholder
  // that means nothing to the user. This covers PARAMETER_INVALID emission
  // sites that omit `actual_value` entirely (invalid_operator, graph
  // predicates) — not just the `missing_value` branch above. When there is
  // no real value to echo back, drop the clause and keep only the
  // constraint guidance; genuine scalars still render "You gave X".
  const showActual = actual !== 'unknown';
  return {
    body: {
      assistant_text: showActual
        ? `'${parameter}' needs to be ${constraint}. You gave ${actual}.`
        : `'${parameter}' needs to be ${constraint}.`,
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
 * V5 edit_graph P0 containment (task_99f83f0d). The user implied an edit to
 * an OPTION's intervention but the proposal resolved to a `set_factor_value`
 * on the shared factor; the turn-executor refused the mutation and routed
 * this code so we clarify instead of silently changing the factor's own
 * value. No auto-routing chip (which could loop back into the same
 * misroute) — a single text-prompt to disambiguate. Graph is unchanged by
 * the time this composes.
 */
function composeOptionInterventionMisroute(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  // ROADMAP 2.11 / P1-3 — the guard now also refuses adjust_edge_strength
  // proposals for configure-option intent (the live A5/A7 loop wrote edge
  // strength while READING as configuration). The clarify names the right
  // contrast per refused handler. The advised exemplar MUST carry the
  // deterministic gate's own vocabulary ("configure … option") so the
  // promised follow-up routes without the LLM router — pinned by
  // configure-option-copy-detector-contract.test.ts.
  if (readString(details.handler_id) === 'adjust_edge_strength') {
    return {
      body: {
        assistant_text:
          `That looks like setting an option's effect rather than adjusting ` +
          `the strength of a link, so I haven't changed anything. Tell me ` +
          `which option and what it should change, for example 'configure ` +
          `the acquisition option: set Setup Cost to £2m', and I'll write it in.`,
        suggested_actions: [fallbackPrompt('Describe the option\'s effect')],
      },
      template_id: 'option_intervention_misroute',
      chip_type: 'text_prompt',
    };
  }
  const factorLabel = readString(details.factor_label);
  const subject = factorLabel
    ? `the ${safeLabel({ label: factorLabel, kind: undefined })} factor's own value`
    : `the factor's own value`;
  return {
    body: {
      assistant_text:
        `That looks like a change to an option's intervention rather than ` +
        `${subject}, so I haven't changed anything. Tell me whether you ` +
        `meant the factor's value or a specific option's effect, and I'll ` +
        `take it from there.`,
      suggested_actions: [fallbackPrompt('Describe what you want to change')],
    },
    template_id: 'option_intervention_misroute',
    chip_type: 'text_prompt',
  };
}

/**
 * P0-A value/unit fail-closed containment. The user expressed a value whose
 * unit cannot be resolved against the target factor with confidence (e.g.
 * "Set Hiring Cost to 5 agents" — a headcount value on a £ factor, or
 * "50 percent" on a currency factor). The turn-executor refused the mutation
 * and routed this code so we clarify instead of silently coercing the bare
 * number. No auto-routing chip (a replay would drop the same unit and loop) —
 * a single text-prompt to restate the value with a clear unit. The graph is
 * unchanged by the time this composes.
 */
function composeValueUnitUnresolved(error: ValidationError): BranchResult {
  const details = error.details ?? {};
  const factorLabel = readString(details.factor_label);
  const subject = factorLabel
    ? `the ${safeLabel({ label: factorLabel, kind: undefined })} factor`
    : `that factor`;
  return {
    body: {
      assistant_text:
        `I wasn't sure what value to use for ${subject}, so I haven't ` +
        `changed anything. Please tell me the value with its unit, for ` +
        `example £100,000, and I'll apply it.`,
      suggested_actions: [fallbackPrompt('Give the value with its unit')],
    },
    template_id: 'value_unit_unresolved',
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
  OPTION_INTERVENTION_MISROUTE: (e) => composeOptionInterventionMisroute(e),
  VALUE_UNIT_UNRESOLVED: (e) => composeValueUnitUnresolved(e),
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
