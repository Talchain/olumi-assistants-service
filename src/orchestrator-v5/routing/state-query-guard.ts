/**
 * V5 — deterministic state-query guard for the named "what just changed?"
 * follow-ups.
 *
 * Layered with the `recent_changes` ContextPack projection: that fix
 * (information starvation) lets Sonnet answer state-queries correctly in
 * the general case; this guard is the deterministic floor for the exact
 * named misroute class so it can never recur even if the LLM regresses.
 *
 * Behaviour:
 *   1. Match the user message against a tight allowlist of state-query
 *      phrases — "what changed?", "what update did you make?",
 *      "I can't see it", "did you change it?", "what just changed?", etc.
 *   2. If matched AND `recent_changes` is non-empty, return a
 *      `direct_answer` dispatch with deterministic copy that quotes the
 *      most recent change's summary verbatim (so the answer is grounded
 *      in the persisted handler fact, not a fabricated summary).
 *   3. If matched AND `recent_changes` is empty, return a "no recent
 *      changes" dispatch that owns the state-query without falling to
 *      `edit_graph`. The user gets honest copy — "I haven't applied
 *      anything in this session." — instead of the legacy denial.
 *   4. If not matched, return `{ matched: false }` and the lifecycle
 *      proceeds to the LLM.
 *
 * The guard never touches handlers, never mutates state, never calls an
 * LLM. It only synthesises the assistant text + chips so the
 * TurnExecutor's existing direct-answer compose path can take it from
 * there.
 *
 * British English, no internal terms ("model" not "graph"). The copy
 * is intentionally short and unambiguous so a follow-up after this
 * dispatch ("OK, run the analysis") routes cleanly.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { ContextPack } from '../context/context-pack-assembler.js';
import type { RecentMutation } from '../context/recent-changes.js';
import type { SuggestedAction } from '../compose/types.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';
import type { HandlerValidationRegistry } from './validator.js';

export type StateQueryGuardOutcome =
  | { readonly matched: false }
  | {
      readonly matched: true;
      readonly dispatch: 'with_recent_change';
      readonly assistant_text: string;
      readonly recent_change: RecentMutation;
      readonly recent_change_count: number;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'no_recent_changes';
      readonly assistant_text: string;
    };

/**
 * Allowlist phrase pattern. Each alternative is anchored loosely to
 * tolerate punctuation and trailing whitespace, but not so loosely that
 * sentences containing these phrases incidentally match. Matching is
 * case-insensitive.
 *
 * Phrases covered — strict subset of the user-brief named follow-up
 * class. Each alternative MUST contain a CHANGE-WORD or VISIBILITY-WORD
 * so that generic session questions ("What did you do?",
 * "show me what you did") do NOT trigger the deterministic floor —
 * those go to the LLM with the `recent_changes` ContextPack projection
 * still grounding the answer.
 *
 * The named-follow-up class (per user brief):
 *   - "what changed?" / "what's changed" / "what has changed" /
 *     "what just changed?"
 *   - "what update did you make?" / "what change did you make?"
 *   - "what did you change/update/add" — change-word anchored
 *   - "did you change/update/apply/add" — change-word anchored
 *   - "I can't see it" / "I can't see this constraint"
 *   - "where is it?" / "where did it go?"
 *   - "show me what you added/changed/updated" — change-word anchored
 *
 * Pattern grammar: each alternative is independent. The "did you" /
 * "what did you" / "show me what you" prefixes REQUIRE a follow-on
 * change-word (`change`, `update`, `add`, `apply`, `added`,
 * `changed`, `updated`). Generic verbs (`do`, `did`) are deliberately
 * NOT in the alternation — keep the gate narrow.
 */
const STATE_QUERY_PATTERNS: readonly RegExp[] = [
  // "what changed", "what's changed", "what has changed", "what just changed"
  /\bwhat(?:'s|\s+(?:has|just))?\s+changed\b/i,
  // "what update did you make", "what updates did you make",
  // "what change did you make", "what changes did you make"
  /\bwhat\s+(?:update|change)s?\s+did\s+you\s+make\b/i,
  // "what did you change/update/add" — change-word required.
  // Generic "what did you do" deliberately excluded so generic
  // session questions ("What did you do?") fall through to the LLM.
  /\bwhat\s+did\s+you\s+(?:change|update|add)\b/i,
  // "did you change/update/apply/add" — change-word required.
  /\bdid\s+you\s+(?:change|update|apply|add)\b/i,
  // "I can't see it", "I cannot see this", "I can't see this constraint",
  // "I can't see the £50k constraint" (\S+ tolerates currency / unit
  // glyphs after "the").
  /\bi\s+(?:can(?:'t|not)|cant)\s+see\s+(?:it|this|the\s+\S+)\b/i,
  // "where is it", "where's it", "where did it go", "where's the £50k cap"
  /\bwhere(?:'s|\s+is|\s+did)\s+(?:it|this|that|the\s+\S+)\b/i,
  // "show me what you added/changed/updated" — change-word required.
  // Generic "show me what you did" deliberately excluded.
  /\bshow\s+me\s+what\s+you\s+(?:added|changed|updated)\b/i,
];

/**
 * Post-mutation complaint / visibility patterns (V5 WS1 / G6 proof 4).
 *
 * Distinct from the named-follow-up `STATE_QUERY_PATTERNS` allowlist above:
 * these phrases only make sense AFTER a successful mutation, so the guard
 * fires them only when `recent_changes` is non-empty. With no recent
 * mutation they fall through to the LLM (which can ask for context).
 *
 * Worked example backing this set: scenario
 * `425c8c71-ff9d-485d-ac59-cbaa811fe09d` (manual test 2026-05-07) showed a
 * successful `set_factor_value` followed by *"I'm not seeing that update on
 * the factor"* routing to V4 `edit_graph` and failing with
 * `STRUCTURAL_VALIDATION_FAILED`. This pattern set is the deterministic
 * floor that prevents that misroute. See Docs/v5/v5-cordon.md and
 * DL-2026-05-07-15.
 *
 * Negative-control behaviour required by the brief:
 *   - "add a constraint about cost being below 50000" must NOT match here.
 *   - The patterns are intentionally narrow on the structural shape of a
 *     post-mutation complaint, not on edit verbs alone.
 */
const POST_MUTATION_COMPLAINT_PATTERNS: readonly RegExp[] = [
  // "I'm not seeing that update", "I am not seeing the change",
  // "I'm not seeing that update on the factor". Multi-word labels
  // ("the customer churn") work without explicit support because the
  // pattern has no terminator after `\S+` — extra label words trail.
  /\bi(?:'m|\s+am)\s+not\s+seeing\s+(?:the|that|my|this)\s+\S+/i,
  // "did that apply", "did it apply", "did my change apply",
  // "did the update apply". Multi-word labels ("did the total cost
  // apply?") supported via `(?:\s+\S+){0,2}` after the leading noun.
  /\bdid\s+(?:that|it|my\s+\S+(?:\s+\S+){0,2}|the\s+\S+(?:\s+\S+){0,2})\s+apply\b/i,
  // "the value didn't change", "the customer churn didn't apply",
  // "the constraint did not apply"
  /\bthe\s+\S+(?:\s+\S+){0,2}\s+(?:didn'?t|did\s+not)\s+(?:change|update|apply|reflect)\b/i,
  // "is that reflected", "is the change reflected", "is the total cost
  // reflected". Allows up to three label words between determiner and
  // `reflected`.
  /\bis\s+(?:that|the|this|my|it)\s+(?:\S+\s+){0,3}reflected\b/i,
  // "why can't I see the change", "why cannot I see the customer
  // churn". Multi-word labels work because the pattern has no
  // terminator after `\S+`.
  /\bwhy\s+can(?:'t|not)\s+i\s+see\s+(?:the|my|this|that)\s+\S+/i,
  // "the change isn't showing", "the customer churn isn't showing"
  /\bthe\s+\S+(?:\s+\S+){0,2}\s+(?:isn'?t|is\s+not|aren'?t|are\s+not)\s+show(?:ing|n)\b/i,
  // "is the update applied", "is the customer churn applied yet"
  /\bis\s+(?:the|that|my|this)\s+\S+(?:\s+\S+){0,2}\s+applied(?:\s+yet)?\b/i,
  // "that didn't work", "that did not seem to work"
  /\bthat\s+(?:didn'?t|did\s+not)\s+(?:seem\s+to\s+)?work\b/i,
];

/**
 * Compound-edit bail-out gate, applied UNIVERSALLY before any guard
 * match (legacy {@link STATE_QUERY_PATTERNS} OR new
 * {@link POST_MUTATION_COMPLAINT_PATTERNS}).
 *
 * Rationale (P1 review fix, second pass): all guard patterns match
 * substrings, and the primary {@link EDIT_VERB_PATTERN} negative gate
 * deliberately excludes `add` / `change` / `update` so that legitimate
 * state-query phrases ("did you change it?", "what update did you
 * make?") still fire. That exclusion creates a false-positive risk for
 * compound turns regardless of which pattern set hits first:
 *   - *"did that apply? add a constraint below 50000"* (post-mutation +
 *     edit)
 *   - *"what changed? add a constraint below 50000"* (legacy +
 *     edit)
 *   - *"did you add it? add another option"* (legacy + edit)
 *   - *"where did it go? change confidence to 0.9"* (legacy + edit)
 *
 * The guard should claim standalone complaint / readback turns only.
 * If a clearly-imperative fresh-edit signal is present anywhere in the
 * message, fall through to normal routing where the LLM and downstream
 * pre-routes can disambiguate the compound intent.
 *
 * The patterns below detect an unambiguous imperative edit signal:
 * `add/create <article> <noun>` or `change/update/set <noun> to <value>`.
 * Pronouns ("add it", "update it") are intentionally not matched — those
 * appear in legitimate state-query phrases ("did you add it?", "did you
 * update it?") and the legacy patterns own them.
 */
const FRESH_EDIT_BAIL_OUT_PATTERNS: readonly RegExp[] = [
  // "add a constraint", "add another factor", "add the option",
  // "create an option" — and the article-less form "add constraint"
  // / "add risk for capacity" that natural-language users frequently
  // type. The article group is now optional. The negative lookbehind
  // on `did you ` preserves interrogative state-queries such as "did
  // you add a constraint?" — those are owned by the legacy
  // STATE_QUERY_PATTERNS and must keep matching.
  /(?<!did\s+you\s+)\b(?:add|create|make)\s+(?:(?:a|an|another|the|some)\s+)?\S+/i,
  // "change X to Y", "update X to Y", "set X to Y" — value-update
  // imperatives. Supports multi-word noun phrases ("set the budget
  // to 100k", "set total cost to 50k", "set the total cost to 50k")
  // via `(?:\s+\S+){0,2}` after the leading noun. The negative
  // lookbehind preserves the existing refined-gate fixtures where
  // digit-bearing state-queries like "did you change it to £50k?"
  // and "did you set the budget to 100k?" must still match the
  // legacy pattern (the "to <value>" tail is a value reference in
  // an interrogative, not a fresh-edit imperative).
  /(?<!did\s+you\s+)\b(?:change|update|set)\s+\S+(?:\s+\S+){0,2}\s+to\s+\S+/i,
];

/**
 * Negative gate — imperative edit verbs that signal the user wants a
 * NEW change rather than asking about an old one.
 *
 * Deliberately NARROWER than `EDIT_VERB_OR_QUANTITY_PATTERN` in
 * `deterministic-short-confirm.ts`: the words `change`, `update`,
 * `make`, and `add` appear in legitimate state-query phrases ("what
 * update did you make?", "did you change it?"), so they are excluded
 * here. Imperative edit verbs that don't have a state-query reading
 * stay in.
 *
 * **Digits are NOT a negative signal.** A digit alone ("did you change
 * it to £50k?", "I can't see the £50k constraint") is part of a
 * legitimate state-query referring to a prior value. Edit commands
 * with digits ("Set churn to 5%", "Increase budget to £100,000") are
 * caught by the imperative-verb part of this gate, so dropping the
 * standalone digit guard widens the deterministic floor without
 * inviting false-positive matches on actual edit commands.
 */
const EDIT_VERB_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|adjust|replace|simplif|rebuild|remove)\b/i;

export interface TryStateQueryGuardInput {
  readonly message: string;
  readonly contextPack: Pick<ContextPack, 'recent_changes'>;
}

export function tryStateQueryGuard(
  input: TryStateQueryGuardInput,
): StateQueryGuardOutcome {
  // Negative gate first — cheapest. A message with an imperative edit
  // verb is almost always a fresh edit request, not a state-query.
  if (EDIT_VERB_PATTERN.test(input.message)) {
    return { matched: false };
  }
  const recent = input.contextPack.recent_changes;
  // Two phrase classes:
  //   - STATE_QUERY_PATTERNS: legacy named follow-ups ("what changed",
  //     "did you update", etc.). Fire regardless of recent_changes — the
  //     `no_recent_changes` dispatch returns honest copy when the user
  //     asks about something that hasn't happened.
  //   - POST_MUTATION_COMPLAINT_PATTERNS: visibility complaints that only
  //     make sense AFTER a mutation ("I'm not seeing that update", "did
  //     that apply"). Fire ONLY when recent_changes is non-empty; with
  //     no recent mutation they fall through to the LLM, which can ask
  //     for context rather than asserting nothing happened.
  const stateQueryMatched = STATE_QUERY_PATTERNS.some((pat) => pat.test(input.message));
  const postMutationCandidate =
    recent.length > 0 &&
    POST_MUTATION_COMPLAINT_PATTERNS.some((pat) => pat.test(input.message));
  if (!stateQueryMatched && !postMutationCandidate) {
    return { matched: false };
  }
  // Universal compound-edit bail-out — applies to BOTH the legacy
  // state-query patterns and the new post-mutation complaint patterns
  // (P1 review fix, second pass). If a clearly-imperative fresh-edit
  // signal appears anywhere in the message — "what changed? add a
  // constraint" or "did you add it? add another option" — the guard
  // declines the turn so the LLM can handle the compound intent. The
  // bail-out runs after the positive matches so it only fires on
  // messages the guard would otherwise claim.
  if (FRESH_EDIT_BAIL_OUT_PATTERNS.some((pat) => pat.test(input.message))) {
    return { matched: false };
  }

  if (recent.length === 0) {
    return {
      matched: true,
      dispatch: 'no_recent_changes',
      assistant_text: NO_RECENT_CHANGES_TEXT,
    };
  }

  const head = recent[0]!;
  return {
    matched: true,
    dispatch: 'with_recent_change',
    assistant_text: composeRecentChangeAnswer(head, recent.length),
    recent_change: head,
    recent_change_count: recent.length,
  };
}

/**
 * Deterministic answer copy. The leading sentence quotes the most
 * recent mutation's summary verbatim so the response is grounded in the
 * persisted handler fact (i.e. the answer references the actual £50k
 * value, not a generic safe phrase). Suffix is short and asks the user
 * to confirm whether they want to follow up with an analysis run.
 *
 * British English; no em dashes; no internal terms.
 */
function composeRecentChangeAnswer(head: RecentMutation, totalCount: number): string {
  const tail =
    totalCount > 1
      ? ' If you want to see the earlier changes from this session, just ask.'
      : '';
  return `${head.summary}${tail}`;
}

// V5 stale-aware explain recovery — neutral honest copy that contains
// no FORBIDDEN_USER_FACING_PHRASES entry. The previous wording
// ("I haven't applied any changes in this session yet…") matched the
// brief's hard-fail phrase verbatim and surfaced as the V5 Golden
// Journey dl7-edit-graph denial-of-edit symptom whenever recent_changes
// was empty (whether from an H5 missed commit or a legitimate
// no-edits state). The replacement is honest about the absence of
// recorded edits without contradicting an upstream mutation the
// runtime might have missed.
const NO_RECENT_CHANGES_TEXT =
  "I don't have a record of recent edits in this conversation. " +
  "If you'd like to make a change, tell me what to update and I'll do it directly.";

/**
 * Compose the state-query continuity chip INLINE for the
 * state-query guard's dispatch path.
 *
 * Why this lives here, not in `chip-generator.ts`: the chip-generator's
 * post-mutation rule is intentionally scoped to the CURRENT turn's
 * `handlerFacts`. Reading `priorFacts` there would surface a stale
 * "Run analysis" chip on EVERY subsequent converse turn until the
 * user reruns analysis — noise the user wouldn't expect.
 *
 * The state-query guard knows it just dispatched a deterministic
 * answer about recent_changes, so it owns the follow-up chip choice:
 *   - Prior successful run_analysis exists AND freshness === 'stale'
 *     (graph hash diverged because the mutation invalidated it) →
 *     "Run analysis again".
 *   - No prior run_analysis fact (model never analysed) AND model is
 *     structurally ready → "Run analysis".
 *   - Otherwise (fresh analysis, or model not ready) → no chip; the
 *     user has the answer and no useful next step requires a chip.
 *
 * Returns at most one chip. Empty array when no chip is appropriate.
 */
export interface ComposeStateQueryChipInput {
  readonly recentChangeCount: number;
  readonly priorFacts: readonly HandlerFact[];
  readonly analysisFreshness: 'fresh' | 'stale' | 'unknown' | 'none' | undefined;
  readonly analysisReadyStatus: string | undefined;
  readonly validationRegistry: HandlerValidationRegistry;
}

export function composeStateQueryChip(
  input: ComposeStateQueryChipInput,
): readonly SuggestedAction[] {
  if (input.recentChangeCount === 0) return [];
  if (input.analysisReadyStatus !== 'ready') return [];
  // The chip points at run_analysis; suppress when that handler is
  // not registered (test overrides, future flag-gated builds).
  if (input.validationRegistry.run_analysis == null) return [];

  const hasPriorRunAnalysis = input.priorFacts.some(isSuccessfulRunAnalysisFact);
  if (hasPriorRunAnalysis && input.analysisFreshness === 'stale') {
    return [
      {
        id: 'chip_action_rerun_analysis_after_state_query',
        label: 'Run analysis again',
        message: 'Run the analysis again.',
        action_type: 'run_analysis',
      },
    ];
  }
  if (!hasPriorRunAnalysis) {
    return [
      {
        id: 'chip_action_run_analysis_after_state_query',
        label: 'Run analysis',
        message: 'Run the analysis.',
        action_type: 'run_analysis',
      },
    ];
  }
  return [];
}
