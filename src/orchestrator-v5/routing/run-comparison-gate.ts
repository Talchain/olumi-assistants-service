/**
 * V5 P0.2 — run-comparison gate (Test 3: "what changed?" / "why did the
 * result change?").
 *
 * Deterministic sibling guard (mirrors `stale-rerun-guard.ts`). It owns
 * the result-sense "what changed?" turn, and is FAIL-CLOSED on freshness
 * (T4 Slice 3): only a confirmed-fresh verdict may ground a comparison.
 *
 *   - freshness === 'fresh' AND >= 2 successful runs: deterministic
 *     prior/current comparison. This is the ONLY verdict that grounds one.
 *   - freshness === 'stale' (the model was edited after the latest run):
 *     lead with re-run guidance. An old comparison is NEVER presented as
 *     the current edited model.
 *   - freshness === 'unknown', or an absent/unavailable authority:
 *     currency cannot be confirmed, so offer an unconfirmed-framed re-run —
 *     WITHOUT asserting the model changed (§1 authority parity of the
 *     merged freshness policy: never claim which state is current).
 *   - freshness === 'none': decline so the downstream guards keep their
 *     behaviour (the state-query guard answers the graph-edit sense of
 *     "what changed?"; the no-analysis guard answers when nothing has run).
 *
 * Policy: Docs/t4/t4-spine-policy-v1.md §1b (unknown ⇒ hold/refuse), §1
 * authority parity, §5 (acknowledge before presenting). The verdict handling
 * is an exhaustive switch with a `never` guard, so fail-closed is structural
 * rather than by convention.
 *
 * PLACEMENT: must run BEFORE the state-query guard, which also matches
 * "what changed?" but answers from `recent_changes` (the graph-edit
 * sense). This gate claims the turn only when a genuine comparison
 * exists (or the model is stale); when it declines, the state-query
 * guard's existing behaviour is unchanged.
 *
 * Pure: no LLM, no DB reads (reuses already-loaded `prior_facts` +
 * `freshness`), no mutation. Copy is British English, plain language, no
 * internal vocab, no raw 0.xx decimals, no IDs.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  classifyAnalyticalIntent,
  hasMutationSignal,
} from './analytical-intent.js';
import {
  compareRuns,
  projectRunFact,
  selectTwoNewestRunAnalysisFacts,
  type RunDelta,
} from '../coaching/compare-runs.js';
import { formatPercentagePoints } from '../format/format-analysis-value.js';

export type RunComparisonFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

export type RunComparisonMode =
  | 'stale'
  | 'unconfirmed'
  | 'compared'
  | 'insufficient_runs'
  | 'incomparable';

export interface RunComparisonSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: 'run_analysis';
}

export type RunComparisonUnmatchedReason =
  | 'empty_message'
  | 'mutation_signal'
  | 'not_what_changed'
  | 'no_runs';

export type RunComparisonGuardResult =
  | {
      readonly matched: true;
      readonly mode: RunComparisonMode;
      readonly assistant_text: string;
      readonly suggested_actions: readonly RunComparisonSuggestedAction[];
      /** Null unless a comparison was actually produced. */
      readonly leading_option_changed: boolean | null;
    }
  | {
      readonly matched: false;
      readonly reason: RunComparisonUnmatchedReason;
    };

export interface RunComparisonGuardInput {
  readonly message: string;
  readonly priorFacts: readonly HandlerFact[];
  readonly freshness: RunComparisonFreshness | null | undefined;
  /**
   * Spine A backstop: factor_ids an option intervenes on. Threaded into
   * `compareRuns` so an option-controlled lever is never reported as having
   * gained/lost influence between runs (the comparator diffs raw `top_drivers`,
   * bypassing `projectTopDrivers`). Omitted / empty ⇒ no suppression.
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  /**
   * F2 CHANGE B — the intent is TYPED (a `what_changed` chip_click), so the
   * caller has ALREADY decided this is a comparison turn. Skip the free-text
   * `classifyAnalyticalIntent` regex, which exists only to disambiguate typed
   * CHAT. The empty-message and mutation-signal fail-safes still apply (a typed
   * pill carries fixed, benign copy — never an edit instruction — so neither
   * fires in practice, but keeping them makes the gate total regardless of
   * caller). Default false ⇒ the free-text path is byte-identical to today.
   */
  readonly forceIntent?: boolean;
}

const RERUN_ACTION: RunComparisonSuggestedAction = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

const STALE_TEXT =
  'The model has changed since the last analysis, so the earlier results no longer reflect it. '
  + 'Re-run the analysis to see what has actually changed in the outcome.';

// Unconfirmed-freshness copy (freshness === 'unknown', or an absent authority).
// Currency cannot be confirmed — a legacy fact missing its run-time hash, an
// unhashable current graph, or no verdict at all. Unlike STALE_TEXT it must NOT
// assert the model has changed (we do not know that): §1 authority-parity of the
// merged freshness policy forbids claiming which state is current. Reuses the
// shipped `buildAnalysisUnconfirmedTemplate` lead clause verbatim so the two
// unconfirmed surfaces cannot drift, tailored to the comparison register.
const UNCONFIRMED_TEXT =
  `The last analysis may be out of date because I can't confirm it still `
  + `matches the current model, so I can't reliably compare the runs yet. `
  + `Re-run the analysis to see the current result.`;

const INSUFFICIENT_RUNS_TEXT =
  'There is only one analysis run so far, so there is nothing to compare yet. '
  + 'Run the analysis again after a change and I can show you what moved.';

const INCOMPARABLE_TEXT =
  'I could not line up the last two runs cleanly enough to compare them. '
  + 'Re-running the analysis is the most reliable way to see the current result.';

/**
 * Plain-language robustness band phrasing. Re-derived locally rather than
 * imported from `coaching/robustness-honesty.ts` to keep this gate
 * decoupled; band-map consolidation is a tracked follow-up. Aligned with
 * the routing-prompt TERMINOLOGY_MAP wording (no "robustness" token).
 */
function bandPhrase(level: string): string | null {
  switch (level) {
    case 'fragile':
      return 'sensitive to your assumptions';
    case 'moderate':
      return 'moderately stable';
    case 'stable':
      return 'stable';
    case 'highly_stable':
      return 'very stable';
    default:
      return null;
  }
}

function composeComparison(delta: RunDelta): string {
  const parts: string[] = [];

  if (delta.leading_option_changed) {
    parts.push(
      `The leading option has changed. ${delta.prior_leading_label} came out ahead before, and ${delta.current_leading_label} now leads.`,
    );
  } else {
    parts.push(`${delta.current_leading_label} still leads.`);
  }

  if (delta.margin_direction === 'widened') {
    parts.push(
      `Its lead has widened by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`,
    );
  } else if (delta.margin_direction === 'narrowed') {
    parts.push(
      `Its lead has narrowed by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`,
    );
  } else if (delta.margin_direction === 'unchanged') {
    parts.push('The size of its lead is essentially unchanged.');
  }

  if (delta.robustness_changed) {
    const now = bandPhrase(delta.current_band);
    const before = bandPhrase(delta.prior_band);
    if (now && before) {
      parts.push(`The result is now ${now}, where before it was ${before}.`);
    }
  }

  const mover = delta.driver_rank_changes[0];
  if (mover) {
    const moreInfluential = mover.to_rank < mover.from_rank;
    parts.push(
      `${mover.factor_label} now has ${moreInfluential ? 'more' : 'less'} influence on the outcome than before.`,
    );
  }

  parts.push('If you want to test this further, ask what would change the result.');
  return parts.join(' ');
}

export function tryRunComparisonGate(
  input: RunComparisonGuardInput,
): RunComparisonGuardResult {
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }
  // Concrete edit instructions are never a comparison question.
  if (hasMutationSignal(message)) {
    return { matched: false, reason: 'mutation_signal' };
  }
  // F2 CHANGE B — a typed `what_changed` pill (`forceIntent`) has already
  // declared the intent; the free-text regex is skipped (it is for typed-chat
  // disambiguation only). The free-text path is unchanged.
  if (!input.forceIntent && classifyAnalyticalIntent(message) !== 'what_changed') {
    return { matched: false, reason: 'not_what_changed' };
  }

  // Freshness gate — FAIL-CLOSED (T4 Slice 3). Only a CONFIRMED-fresh verdict
  // may ground a confident prior/current comparison; every other verdict —
  // including `unknown` and an absent/unavailable authority — leads with a
  // re-run offer instead of comparison prose. Per the merged freshness policy
  // (Docs/t4/t4-spine-policy-v1.md): §1b unknown ⇒ hold/refuse; §1 authority
  // parity — never claim which analysis state is current; §5 acknowledge before
  // presenting. The exhaustive `switch` + `never` guard makes the fail-closed
  // posture structural: a future verdict cannot silently reach the comparison
  // path. An absent verdict (null/undefined) is authority-unavailable and is
  // treated as `unknown` (hold), never as an implicit pass.
  const verdict: RunComparisonFreshness = input.freshness ?? 'unknown';
  switch (verdict) {
    case 'none':
      // No analysis at all → decline so the no-analysis guard owns the turn
      // with its richer "nothing has run yet" guidance.
      return { matched: false, reason: 'no_runs' };
    case 'stale':
      // Hash diverged: the model is KNOWN to have changed after the latest run,
      // so the positive "has changed" claim is honest. Never present an old
      // comparison as the current model — lead with re-run guidance.
      return {
        matched: true,
        mode: 'stale',
        assistant_text: STALE_TEXT,
        suggested_actions: [RERUN_ACTION],
        leading_option_changed: null,
      };
    case 'unknown':
      // Currency cannot be confirmed (legacy fact missing its run-time hash, an
      // unhashable current graph, or an absent authority). We must NOT assert
      // the model changed — we do not know that (§1 parity) — so offer an
      // unconfirmed-framed re-run rather than a confident comparison.
      return {
        matched: true,
        mode: 'unconfirmed',
        assistant_text: UNCONFIRMED_TEXT,
        suggested_actions: [RERUN_ACTION],
        leading_option_changed: null,
      };
    case 'fresh':
      break; // confirmed current → the only verdict that may ground a comparison
    default: {
      // Compile-time exhaustiveness: adding a verdict without a branch above
      // fails to type-check here.
      const _exhaustive: never = verdict;
      void _exhaustive;
      // Runtime belt: an out-of-type value still fails closed to unconfirmed.
      return {
        matched: true,
        mode: 'unconfirmed',
        assistant_text: UNCONFIRMED_TEXT,
        suggested_actions: [RERUN_ACTION],
        leading_option_changed: null,
      };
    }
  }

  // From here the verdict is CONFIRMED fresh.
  const pair = selectTwoNewestRunAnalysisFacts(input.priorFacts);
  if (!pair) {
    // Exactly one successful run — fresh, but nothing to compare yet.
    return {
      matched: true,
      mode: 'insufficient_runs',
      assistant_text: INSUFFICIENT_RUNS_TEXT,
      suggested_actions: [],
      leading_option_changed: null,
    };
  }

  const prior = projectRunFact(pair.prior);
  const current = projectRunFact(pair.current);
  if (!prior || !current) {
    return {
      matched: true,
      mode: 'incomparable',
      assistant_text: INCOMPARABLE_TEXT,
      suggested_actions: [],
      leading_option_changed: null,
    };
  }

  const delta = compareRuns(prior, current, input.interventionControlledFactorIds);
  if (!delta.comparable) {
    return {
      matched: true,
      mode: 'incomparable',
      assistant_text: INCOMPARABLE_TEXT,
      suggested_actions: [],
      leading_option_changed: null,
    };
  }

  return {
    matched: true,
    mode: 'compared',
    assistant_text: composeComparison(delta),
    suggested_actions: [],
    leading_option_changed: delta.leading_option_changed,
  };
}
