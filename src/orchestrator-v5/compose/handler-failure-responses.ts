/**
 * Per-cause composer for V5 handler failures.
 *
 * One switch branch per `HandlerInvocationFailedCause`. Every branch returns
 * specific user-facing text plus exactly one chip.
 *
 * Retryability semantics are split from chip UX:
 *   - `error.retryable: boolean` is the SEMANTIC question — "could a retry
 *     plausibly succeed?" — and flows into telemetry.
 *   - The template picks the CHIP independently. A semantically-retryable
 *     failure may still render "Try again in a moment" (softer prompt) when
 *     immediate re-execution isn't the right UX (e.g. opaque infra errors).
 *
 * Unknown cause_kinds hit the exhaustive-never default and fall back to a
 * generic retry action chip, tagged `template_id: 'fallback'` so regression
 * tests can assert no known cause reaches it.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import type {
  HandlerInvocationFailedCause,
  HandlerInvocationFailedError,
} from '../tools/handler-errors.js';

import type {
  ChipType,
  ComposeContext,
  FailureComposeResult,
  SuggestedAction,
} from './types.js';
import { safeLabel, sanitiseForUser } from './helpers.js';

export interface ComposedHandlerFailure {
  readonly response: OlumiResponse;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

export function composeHandlerFailure(
  error: HandlerInvocationFailedError,
  _ctx: ComposeContext,
  stage: StageType,
): ComposedHandlerFailure {
  const body = composeBody(error);
  return {
    response: wrapResponse(error, body.body, stage),
    template_id: body.template_id,
    chip_type: body.chip_type,
  };
}

interface BranchResult {
  readonly body: FailureComposeResult;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

function composeBody(error: HandlerInvocationFailedError): BranchResult {
  const details = error.details;
  switch (error.cause_kind) {
    case 'args_validation_failed':
      return {
        body: {
          assistant_text:
            `Something's wrong with the analysis inputs. ${sanitiseForUser(details.specific_issue ?? 'Please try a simpler request.')}`,
          suggested_actions: [scenarioStatusChip()],
        },
        template_id: 'args_validation_failed',
        chip_type: 'text_prompt',
      };

    case 'scenario_read_failed':
      // Semantically retryable, but we show a soft prompt: re-firing the
      // same run_analysis call won't help if the scenario itself doesn't
      // load. Let Sonnet decide the next turn.
      return {
        body: {
          assistant_text: "I couldn't load your scenario right now.",
          suggested_actions: [softRetryPrompt()],
        },
        template_id: 'scenario_read_failed',
        chip_type: 'text_prompt',
      };

    case 'plot_timeout':
      return {
        body: {
          assistant_text:
            'The analysis is taking longer than usual. Your model might be very complex.',
          suggested_actions: [retryActionChip()],
        },
        template_id: 'plot_timeout',
        chip_type: 'action',
      };

    case 'plot_error':
      // Retryable semantically (service-side issue might clear), but the
      // user sees a softer prompt so Sonnet can inspect the state first.
      return {
        body: {
          assistant_text: 'The analysis service encountered an error. This is on our end.',
          suggested_actions: [softRetryPrompt()],
        },
        template_id: 'plot_error',
        chip_type: 'text_prompt',
      };

    case 'plot_payload_invalid':
      return {
        body: {
          assistant_text:
            `The model has a structural issue the analysis can't handle. ${sanitiseForUser(details.specific_issue ?? 'Check your scenario.')}`,
          suggested_actions: [scenarioStatusChip()],
        },
        template_id: 'plot_payload_invalid',
        chip_type: 'text_prompt',
      };

    case 'plot_unknown':
      return {
        body: {
          assistant_text: 'The analysis service was unreachable. Try again in a moment.',
          suggested_actions: [retryActionChip()],
        },
        template_id: 'plot_unknown',
        chip_type: 'action',
      };

    case 'analysis_not_completed': {
      const status = sanitiseForUser(details.analysis_status ?? 'incomplete');
      return {
        body: {
          assistant_text:
            `The analysis didn't finish (status: ${status}). This can happen with very complex models.`,
          suggested_actions: [scenarioStatusChip()],
        },
        template_id: 'analysis_not_completed',
        chip_type: 'text_prompt',
      };
    }

    // V5 alpha hardening Phase 2.3: PLoT `analysis_status: "blocked"` is
    // a semantically different fatal — the engine decided it cannot
    // answer, rather than crashing. User coaching points at what might
    // need to change to unblock.
    case 'analysis_blocked':
      return {
        body: {
          assistant_text:
            "The analysis engine couldn't proceed with the current scenario. Try simplifying options or constraints, then run again.",
          suggested_actions: [scenarioStatusChip()],
        },
        template_id: 'analysis_blocked',
        chip_type: 'text_prompt',
      };

    // V5 alpha hardening Phase 2.3: PLoT `analysis_status: "failed"` —
    // the engine errored mid-run. Retry chip is appropriate because the
    // fault may be transient.
    case 'analysis_failed':
      return {
        body: {
          assistant_text:
            'The analysis service had a problem running your scenario. Try again in a moment.',
          suggested_actions: [retryActionChip()],
        },
        template_id: 'analysis_failed',
        chip_type: 'action',
      };

    case 'options_not_configured': {
      const rawLabel =
        typeof details.first_option_label === 'string' && details.first_option_label.trim().length > 0
          ? details.first_option_label
          : null;
      const entityRef = safeLabel({ label: rawLabel, kind: 'option' });
      // `safeLabel` rejects id-shaped tokens. If the rawLabel was id-shaped,
      // entityRef will be 'that option' — route to the generic branch so the
      // chip reads naturally ("Configure an option") instead of "Configure
      // that option", which sounds off.
      const labelUsable = rawLabel !== null && !entityRef.startsWith('that ');
      if (labelUsable) {
        return {
          body: {
            assistant_text:
              `Options exist but don't have effects configured yet. ${entityRef} needs intervention values to proceed.`,
            suggested_actions: [
              {
                id: 'chip_prompt_configure_option',
                label: `Configure ${entityRef}`,
                message: `Help me configure ${entityRef}.`,
              },
            ],
          },
          template_id: 'options_not_configured_with_label',
          chip_type: 'text_prompt',
        };
      }
      return {
        body: {
          assistant_text:
            "Options exist but don't have effects configured yet. Add intervention values to at least one option to proceed.",
          suggested_actions: [
            {
              id: 'chip_prompt_configure_option_generic',
              label: 'Configure an option',
              message: 'Help me configure one of my options.',
            },
          ],
        },
        template_id: 'options_not_configured_no_label',
        chip_type: 'text_prompt',
      };
    }

    // V5 D1 mutation handlers — typed recovery for execute-time failures
    // the structural validator could not catch.
    case 'parameter_invalid_at_execute': {
      const issue = sanitiseForUser(details.specific_issue ?? 'The value is ambiguous.');
      return {
        body: {
          assistant_text: `I couldn't apply that change. ${issue}`,
          suggested_actions: [retryActionChip()],
        },
        template_id: 'parameter_invalid_at_execute',
        chip_type: 'action',
      };
    }

    case 'entity_not_found_in_graph':
      return {
        body: {
          assistant_text:
            "I couldn't find that item in the model. It may have been renamed or removed.",
          suggested_actions: [retryActionChip()],
        },
        template_id: 'entity_not_found_in_graph',
        chip_type: 'action',
      };

    case 'entity_kind_mismatch_at_execute':
      return {
        body: {
          assistant_text:
            "That change can't be applied to that kind of item. Try targeting a different entity.",
          suggested_actions: [retryActionChip()],
        },
        template_id: 'entity_kind_mismatch_at_execute',
        chip_type: 'action',
      };

    case 'precondition_unmet_at_execute':
      return {
        body: {
          assistant_text: "I can't make that change yet — the model isn't ready for it.",
          suggested_actions: [retryActionChip()],
        },
        template_id: 'precondition_unmet_at_execute',
        chip_type: 'action',
      };

    case 'graph_invariant_violated':
      return {
        body: {
          assistant_text:
            "Applying that change would have left the model in an invalid state, so it wasn't saved.",
          suggested_actions: [retryActionChip()],
        },
        template_id: 'graph_invariant_violated',
        chip_type: 'action',
      };

    default: {
      const _exhaustive: never = error.cause_kind;
      void _exhaustive;
      return {
        body: {
          assistant_text: "Something unexpected happened. Here's what you can try.",
          suggested_actions: [retryActionChip()],
        },
        template_id: 'fallback',
        chip_type: 'action',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Chip helpers — separate functions per intent, not keyed on `retryable`
// ---------------------------------------------------------------------------

function retryActionChip(): SuggestedAction {
  return {
    id: 'chip_action_retry_analysis',
    label: 'Retry',
    message: 'Run the analysis again.',
    action_type: 'run_analysis',
  };
}

function softRetryPrompt(): SuggestedAction {
  return {
    id: 'chip_prompt_try_again_later',
    label: 'Try again in a moment',
    message: 'Try that again in a moment.',
  };
}

function scenarioStatusChip(): SuggestedAction {
  return {
    id: 'chip_prompt_show_scenario_status',
    label: 'Show scenario status',
    message: 'Show me the current status of my scenario.',
  };
}

// ---------------------------------------------------------------------------
// Response wrapper
// ---------------------------------------------------------------------------

function wrapResponse(
  error: HandlerInvocationFailedError,
  body: FailureComposeResult,
  stage: StageType,
): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: body.assistant_text,
    blocks: [
      {
        type: 'error',
        error_code: 'INTERNAL_ERROR',
        severity: 'error',
        details: {
          failure_origin: 'handler',
          error_code: error.cause_kind satisfies HandlerInvocationFailedCause,
          retryable: error.retryable,
        },
      },
    ],
    suggested_actions: [...body.suggested_actions],
    insights: [],
    stage_indicator: stage,
  };
}
