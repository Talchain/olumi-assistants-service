import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { FreshnessDerivation } from '../context/freshness.js';

/**
 * User-facing disclosure for the one claim-safety state in which CEE could
 * not establish whether a persisted analysis exists. This must stay distinct
 * from the healthy `no_analysis_exists` state: unreadable is not absent.
 */
export const ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE =
  "I couldn't check this workspace's saved analysis history right now, so I " +
  "can't safely use its results. Please try again.";

/**
 * Existing canonical fail-weak freshness representation for an unreadable
 * analysis store. Shared by prompt authority and final wire projection so a
 * hot-window `none` verdict cannot reappear as `never_run` after egress copy
 * has already disclosed that the scenario-wide read failed.
 */
export const ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS: FreshnessDerivation =
  Object.freeze({
    freshness: 'unknown',
    reason: 'derivation_failed',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: null,
    computed_at: null,
  });

export type AnalysisAuthorityUnavailableEgressMode =
  | 'substantive_replaced'
  | 'functional_preserved'
  | 'egress_fallback_preserved';

export type AnalysisAuthorityUnavailableDisclosure = {
  readonly response: OlumiResponse;
  readonly mode: AnalysisAuthorityUnavailableEgressMode;
};

/**
 * Fail closed at the response boundary without inventing a text classifier.
 *
 * Functional responses are deterministic receipts, refusals, clarification
 * and recovery copy. Their text and structured payload remain intact before an
 * appended notice. Substantive or unclassified responses may contain arbitrary model
 * prose, including the exact false claim this guard closes ("no analysis has
 * run"). They are therefore replaced wholesale. Omitted answerKind follows
 * the existing route default and is treated as substantive.
 */
export function enforceAnalysisAuthorityUnavailableAtEgress(
  response: OlumiResponse,
  options: {
    readonly answerKind: 'functional' | 'substantive' | undefined;
    readonly egressOk: boolean;
  },
): AnalysisAuthorityUnavailableDisclosure {
  if (options.egressOk && options.answerKind !== 'functional') {
    return {
      response: {
        response_version: response.response_version,
        assistant_text: ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE,
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: response.stage_indicator,
      },
      mode: 'substantive_replaced',
    };
  }

  const assistantText = response.assistant_text ?? '';
  const mode = options.egressOk
    ? 'functional_preserved'
    : 'egress_fallback_preserved';
  return {
    response: {
      ...response,
      assistant_text:
        assistantText === ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE ||
        assistantText.endsWith(`\n\n${ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE}`)
          ? assistantText
          : assistantText.length > 0
          ? `${assistantText}\n\n${ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE}`
          : ANALYSIS_AUTHORITY_UNAVAILABLE_NOTICE,
    },
    mode,
  };
}
