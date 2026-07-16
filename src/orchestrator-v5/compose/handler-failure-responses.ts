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
import {
  buildConfigureOptionChip,
  CONFIGURE_OPTION_GENERIC_CHIP,
} from '../configure-option-copy.js';

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
  const body = composeHandlerFailureBody(error);
  return {
    response: wrapResponse(error, body.body, stage),
    template_id: body.template_id,
    chip_type: body.chip_type,
  };
}

export interface HandlerFailureBranchResult {
  readonly body: FailureComposeResult;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

/**
 * Per-cause composer body — exported so the V5 Phase 2.6 recoverable
 * wrapper (`composeRecoverableHandlerResponse`) can reuse the per-code
 * copy/chip switch without duplicating it. Keeping the switch in one
 * place means new cause-kinds added here automatically flow through both
 * the fatal 500 path and the recoverable 200 path; the recoverable
 * decision is made by `RECOVERABLE_HANDLER_CAUSES` in
 * `recoverable-handler-causes.ts`.
 */
export function composeHandlerFailureBody(
  error: HandlerInvocationFailedError,
): HandlerFailureBranchResult {
  const details = error.details;
  // PLoT typed failure codes (seam item 3): when run-analysis dual-carried a
  // known critique code, surface honest CEE-authored copy for it instead of
  // the generic per-cause copy. Unknown or absent codes fall through to the
  // per-cause branches byte-identically (conscious-promotion doctrine — the
  // same rule as CRITIQUE_BUCKETS' unknown→D default). PLoT's own
  // `plot_user_message` prose is deliberately NEVER rendered: this composer
  // has no label resolver or prose-safety gate, so only the code is trusted.
  if (
    error.cause_kind === 'plot_error' ||
    error.cause_kind === 'analysis_failed' ||
    error.cause_kind === 'analysis_blocked'
  ) {
    const codeKeyed = composePlotCodeKeyedBody(error.cause_kind, details);
    if (codeKeyed !== null) return codeKeyed;
  }
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

    case 'analysis_not_ready': {
      // EP2 (V5 Edit Safety Core): the read-boundary guard blocked an
      // un-analysable persisted graph. Surface the honest, user-safe next step
      // (carried in details.next_step; no internal IDs) + a review chip.
      const nextStep =
        typeof details.next_step === 'string' && details.next_step.trim().length > 0
          ? details.next_step.trim()
          : 'This scenario needs a quick fix before it can be analysed.';
      return {
        body: {
          assistant_text: nextStep,
          suggested_actions: [
            {
              id: 'chip_prompt_fix_before_analysis',
              label: 'Review the model',
              message: 'Help me fix my model so it can be analysed.',
            },
          ],
        },
        template_id: 'analysis_not_ready',
        chip_type: 'text_prompt',
      };
    }

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
      //
      // ROADMAP 2.11 / P1-3: the chips are built from the SHARED
      // configure-option copy module, whose message prefix the route-v2
      // configure-option gate matches deterministically — this chip now
      // provably reaches the edit lane (the chat path that WRITES option
      // interventions), never adjust_edge_strength. Before that gate, this
      // chip's own message live-routed to an edge-strength tweak and looped
      // the user forever (2.11 diagnosis, scenario A A6→A7). The copy also
      // says WHAT to tell the assistant, since the capability is now real.
      const labelUsable = rawLabel !== null && !entityRef.startsWith('that ');
      if (labelUsable) {
        return {
          body: {
            assistant_text:
              `Options exist but don't have effects configured yet. ${entityRef} needs intervention values to proceed. ` +
              `Tell me what ${entityRef} changes and I'll write it into the model.`,
            suggested_actions: [buildConfigureOptionChip(entityRef)],
          },
          template_id: 'options_not_configured_with_label',
          chip_type: 'text_prompt',
        };
      }
      return {
        body: {
          assistant_text:
            "Options exist but don't have effects configured yet. Add intervention values to at least one option to proceed. " +
            "Tell me what one of your options changes and I'll write it into the model.",
          suggested_actions: [{ ...CONFIGURE_OPTION_GENERIC_CHIP }],
        },
        template_id: 'options_not_configured_no_label',
        chip_type: 'text_prompt',
      };
    }

    // V5 D1 mutation handlers — typed recovery for execute-time failures
    // the structural validator could not catch.
    //
    // P1.1 follow-up — these four execute-time D1 causes use **text-prompt**
    // chips (no `action_type`), not `retryActionChip()`. Reason:
    // `retryActionChip()` carries `action_type: 'run_analysis'`, and
    // `commitDirectAnswer` derives a pending `run_analysis` action from
    // any chip whose `action_type` is in `CHIP_DERIVABLE_ACTION_TYPES`.
    // For a mutation failure (e.g. an invalid `set_factor_value`), running
    // analysis is the wrong recovery — the user needs to restate the
    // change, not re-run analysis on stale state. Persisting a pending
    // `run_analysis` would also leak into the next-turn ContextPack as a
    // stale chip-derived action. Text-prompt chips bypass
    // `derivePendingActionsFromChips` (it filters via `mapChipKind` which
    // returns null for chips without an `action_type`).
    //
    // P1.2 follow-up — when the D1 handler attached a canonical per-handler
    // user-safe phrase via `D1HandlerError.userGuidance` (surfaced as
    // `details.specific_issue` by error-boundary.ts), the composer uses
    // that phrase as the full assistant_text. The fallback per-cause
    // copy is retained for throws that did not set `userGuidance` and
    // for non-D1 invocations of these cause-kinds.
    case 'parameter_invalid_at_execute': {
      const guidance = readUserGuidance(details);
      return {
        body: {
          assistant_text:
            guidance ??
            `I couldn't apply that change. ${sanitiseForUser(details.specific_issue ?? 'The value is ambiguous.')}`,
          suggested_actions: [restateChangePrompt()],
        },
        template_id: 'parameter_invalid_at_execute',
        chip_type: 'text_prompt',
      };
    }

    case 'entity_not_found_in_graph': {
      const guidance = readUserGuidance(details);
      return {
        body: {
          assistant_text:
            guidance ??
            "I couldn't find that item in the model. It may have been renamed or removed.",
          suggested_actions: [restateTargetPrompt()],
        },
        template_id: 'entity_not_found_in_graph',
        chip_type: 'text_prompt',
      };
    }

    case 'entity_kind_mismatch_at_execute': {
      const guidance = readUserGuidance(details);
      return {
        body: {
          assistant_text:
            guidance ??
            "That change can't be applied to that kind of item. Try targeting a different entity.",
          suggested_actions: [restateTargetPrompt()],
        },
        template_id: 'entity_kind_mismatch_at_execute',
        chip_type: 'text_prompt',
      };
    }

    case 'precondition_unmet_at_execute': {
      const guidance = readUserGuidance(details);
      return {
        body: {
          assistant_text:
            guidance ?? "I can't make that change yet — the model isn't ready for it.",
          suggested_actions: [scenarioStatusChip()],
        },
        template_id: 'precondition_unmet_at_execute',
        chip_type: 'text_prompt',
      };
    }

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
// PLoT typed-failure-code copy map (seam item 3)
// ---------------------------------------------------------------------------
//
// Code-keyed honest copy for PLoT's typed failure envelope (PLoT #212). Keys
// are `details.plot_primary_code` values dual-carried by run-analysis.
// Retryability register per PLoT's guidance: timeout / network / engine /
// internal failures say "try again" (Retry action chip is safe here — this is
// the analysis path, so a pending run_analysis is the RIGHT derived action,
// unlike the D1 mutation causes above); GRAPH_TOO_COMPLEX / ISL_REJECTED /
// DUPLICATE_EDGE_CONFLICT need a model change, so a bare retry would
// reproduce the failure and they get text-prompt chips instead.
//
// Copy discipline: CEE-authored only, style-guard compliant (no em dashes,
// no "recommended"/"winner"), no entity IDs, no interpolation of upstream
// prose. New PLoT codes are NOT auto-surfaced — add them here consciously.
interface PlotCodeCopy {
  readonly assistant_text: string;
  readonly chip: () => SuggestedAction;
  readonly chip_type: ChipType;
}

const PLOT_FAILURE_CODE_COPY: Readonly<Record<string, PlotCodeCopy>> = {
  GRAPH_TOO_COMPLEX: {
    assistant_text:
      'Your model is too complex for the analysis engine right now. Try simplifying it, for example by removing some factors or connections, then run again.',
    chip: simplifyModelPrompt,
    chip_type: 'text_prompt',
  },
  DUPLICATE_EDGE_CONFLICT: {
    assistant_text:
      'Two connections in your model conflict with each other. Removing the duplicated connection will let the analysis run.',
    chip: scenarioStatusChip,
    chip_type: 'text_prompt',
  },
  ISL_TIMEOUT: {
    assistant_text:
      'The analysis timed out before finishing. This can happen with complex models. Try again in a moment.',
    chip: retryActionChip,
    chip_type: 'action',
  },
  ISL_NETWORK_ERROR: {
    assistant_text:
      "We couldn't reach the analysis engine. This is on our end, not a problem with your model. Try again in a moment.",
    chip: retryActionChip,
    chip_type: 'action',
  },
  ISL_ERROR: {
    assistant_text:
      'The analysis engine hit a problem while running your scenario. Your model is unaffected. Try again in a moment.',
    chip: retryActionChip,
    chip_type: 'action',
  },
  ISL_REJECTED: {
    assistant_text:
      "The analysis engine couldn't process your model as it stands. Adjusting the model, for example simplifying options or checking factor values, may help.",
    chip: scenarioStatusChip,
    chip_type: 'text_prompt',
  },
  PLOT_INTERNAL_ERROR: {
    assistant_text:
      'Something went wrong on our side while preparing your analysis. Your model is unaffected. Try again in a moment.',
    chip: retryActionChip,
    chip_type: 'action',
  },
};

/**
 * Compose the code-keyed body when `details.plot_primary_code` names a known
 * PLoT failure code. Returns null for unknown/absent codes so the per-cause
 * branches keep their byte-identical generic copy. `template_id` is
 * `<cause_kind>_<code>` (e.g. `plot_error_graph_too_complex`) so tests pin
 * the routing without string-matching prose.
 */
function composePlotCodeKeyedBody(
  causeKind: 'plot_error' | 'analysis_failed' | 'analysis_blocked',
  details: { readonly plot_primary_code?: unknown } & Record<string, unknown>,
): HandlerFailureBranchResult | null {
  const code = details.plot_primary_code;
  if (typeof code !== 'string' || code.length === 0) return null;
  const copy = PLOT_FAILURE_CODE_COPY[code];
  if (copy === undefined) return null;
  return {
    body: {
      assistant_text: copy.assistant_text,
      suggested_actions: [copy.chip()],
    },
    template_id: `${causeKind}_${code.toLowerCase()}`,
    chip_type: copy.chip_type,
  };
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

// Seam item 3 — text-prompt chip for complexity-class PLoT failures.
// Deliberately no `action_type`: a bare re-run reproduces the failure, the
// user needs a model change first (same reasoning as the D1 chips below).
function simplifyModelPrompt(): SuggestedAction {
  return {
    id: 'chip_prompt_simplify_model',
    label: 'Simplify my model',
    message: 'Help me simplify my model so it can be analysed.',
  };
}

// P1.1 follow-up — text-prompt chips for D1 execute-time recoverable
// causes. Deliberately omit `action_type` so
// `derivePendingActionsFromChips` (compose/derive-pending-actions.ts)
// filters them out via `mapChipKind`, preventing a stale pending
// `run_analysis` from being persisted on a mutation failure.
function restateChangePrompt(): SuggestedAction {
  return {
    id: 'chip_prompt_restate_change',
    label: 'Tell me what to change',
    message: "Tell me what you'd like to change.",
  };
}

function restateTargetPrompt(): SuggestedAction {
  return {
    id: 'chip_prompt_restate_target',
    label: "Show what's in my model",
    message: "Show me what's in my model.",
  };
}

// P1.2 follow-up — read the canonical per-handler user-safe phrase set by
// a D1 handler via `D1HandlerError.userGuidance` (surfaced through
// `error-boundary.ts` as `details.specific_issue`). Returns the
// sanitised phrase when set; `null` so the caller falls back to its
// per-cause hardcoded copy. The sanitiser strips stack-trace fragments
// and truncates; callers must still ensure the source phrase contains
// no handler IDs / parameter names / enum literals (see
// `handler_user_guidance.ts` constants).
function readUserGuidance(
  details: { readonly specific_issue?: string } & Record<string, unknown>,
): string | null {
  const raw = details.specific_issue;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return sanitiseForUser(raw);
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
