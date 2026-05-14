/**
 * V5 post-analysis advice gate.
 *
 * Deterministic pre-LLM gate: when a successful prior analysis is present
 * AND the user's message is an advice/coaching question AND the message
 * does NOT carry any concrete graph-mutation signal, short-circuit
 * routing to a `text_only`-style direct answer composed from the
 * existing analysis projection. Mirrors the chip-click bypass and the
 * state-query guard.
 *
 * Goal: stop the canonical misroute where "How do you recommend we
 * update the decision based on this?" reaches `edit_graph`, returns
 * zero operations, and surfaces the no-op denial copy. The legitimate
 * graph-edit path (`Set delivery risk to 0.7`, `Remove the cost
 * factor`, `Change the edge from A to B`) must NOT be blocked — the
 * mutation-signal patterns guard against that.
 *
 * Composer copy contract (Paul's correction):
 *   "Based on the analysis, [leading option] is currently ahead.
 *    The biggest thing to examine next is [top driver / top
 *    sensitivity], because it could change the result."
 * No "recommendation". No raw IDs. No raw decimals.
 */

export interface AdviceGateAnalysisOption {
  readonly label: string;
}

export interface AdviceGateAnalysisDriver {
  readonly factor_label: string;
}

export interface AdviceGateAnalysis {
  readonly status?: string;
  readonly leading_option: AdviceGateAnalysisOption | null;
  readonly top_drivers: readonly AdviceGateAnalysisDriver[];
}

/**
 * Freshness verdict shape (mirrors FreshnessDerivation.freshness from
 * `src/orchestrator-v5/context/freshness.ts`). The gate accepts a
 * narrow union so the module stays free of orchestrator-internal type
 * imports.
 */
export type AdviceGateFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

export interface AdviceGateInput {
  readonly message: string;
  readonly analysis: AdviceGateAnalysis | null | undefined;
  /**
   * Freshness verdict from the turn-executor's analysis-freshness
   * derivation. The gate ONLY short-circuits when freshness is
   * `'fresh'` — any stale/unknown/none state must fall through so the
   * normal routing path (or the existing state-query / stale-aware
   * recovery surfaces) can emit a stale-safe response. Without this
   * guard the gate would happily claim "X is currently ahead" using a
   * projection that no longer matches the live graph.
   */
  readonly freshness: AdviceGateFreshness | null | undefined;
}

export type AdviceGateUnmatchedReason =
  | 'no_analysis'
  | 'no_leading_option'
  | 'not_fresh'
  | 'mutation_signal'
  | 'no_advice_signal'
  | 'empty_message';

export interface AdviceGateMatched {
  readonly matched: true;
  readonly assistant_text: string;
  readonly leading_option_label: string;
  readonly top_driver_label: string | null;
}

export interface AdviceGateUnmatched {
  readonly matched: false;
  readonly reason: AdviceGateUnmatchedReason;
}

export type AdviceGateResult = AdviceGateMatched | AdviceGateUnmatched;

/**
 * Mutation-signal patterns. If ANY pattern fires, the gate yields control
 * to normal routing (which validates and dispatches edit_graph for real
 * mutations). Patterns are written narrowly so coaching questions that
 * happen to use a mutation verb without a concrete target ("What should
 * we update based on this?") still pass through to the advice path.
 */
const MUTATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  // Mutation verb + a "to <value>" tail (covers `set X to 0.7`,
  // `change X to high`, `adjust risk to 0.5`).
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\bto\s+\S+/i,
  // Mutation verb + a bare numeric (`set delivery risk 0.7`, `raise to 70%`).
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\b\d+(?:\.\d+)?%?\b/i,
  // Add/insert/create + (a|an|new|another) + entity ("add a new factor").
  /\b(?:add|insert|create)\s+(?:a|an|new|another)\s+\S+/i,
  // Remove/delete/drop + (the|that|this|my|our) + entity.
  /\b(?:remove|delete|drop)\s+(?:the|that|this|my|our)\s+\S+/i,
  // Edge direction phrasing ("the edge from A to B", "from A to B").
  /\bfrom\s+\S+\s+to\s+\S+/i,
  // Line-leading imperative verbs ("Set …", "Remove …", "Add …").
  /^\s*(?:set|remove|delete|drop|add|create|insert)\b/im,
];

/**
 * Advice-intent patterns. Hits when the user is asking for guidance,
 * a next step, what to examine, or what to look at — without a
 * concrete mutation target. Coverage is intentionally broad; the
 * mutation-signal gate above protects against false positives.
 */
const ADVICE_PATTERNS: readonly RegExp[] = [
  // "How should we / I / you (improve | update | change | decide | …)"
  /\bhow\s+(?:should|do|would|can|might)\s+(?:we|i|you)\b/i,
  // "What should we / I / you (do | examine | look at | …)"
  /\bwhat\s+should\s+(?:we|i|you)\b/i,
  // "What would you (recommend | suggest | advise | think | do)"
  /\bwhat\s+(?:would|do)\s+you\s+(?:recommend|suggest|advise|think|do)\b/i,
  // "What factor / driver / thing / aspect / area / step / move should …"
  /\bwhat\s+(?:factor|driver|thing|aspect|area|step|move)s?\b/i,
  // "What's next / best / right / most important / the priority"
  /\bwhat['’]?s?\s+(?:next|the\s+best|the\s+right|most\s+important|the\s+priority)\b/i,
  // "Where should we / I / you (look | focus | start | go next)"
  /\bwhere\s+should\s+(?:we|i|you)\b/i,
  // "Any (suggestions | ideas | advice | thoughts)"
  /\bany\s+(?:suggestions?|ideas?|advice|thoughts)\b/i,
  // "Can you (recommend | suggest | advise | help me think)"
  /\bcan\s+you\s+(?:recommend|suggest|advise|help\s+me\s+think)\b/i,
  // "Next step(s)" / "what's the next step"
  /\bnext\s+steps?\b/i,
];

export function tryPostAnalysisAdviceGate(
  input: AdviceGateInput,
): AdviceGateResult {
  const analysis = input.analysis;
  if (!analysis) {
    return { matched: false, reason: 'no_analysis' };
  }
  if (!analysis.leading_option) {
    return { matched: false, reason: 'no_leading_option' };
  }
  // Freshness gate (review correction): only short-circuit when the
  // analysis projection actually matches the current graph. After an
  // edit invalidates the cached run, "X is currently ahead" is
  // misleading — fall through so the stale-aware recovery surfaces
  // and/or normal routing can deal with the staleness.
  if (input.freshness !== 'fresh') {
    return { matched: false, reason: 'not_fresh' };
  }
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }

  // Mutation signal takes precedence — never short-circuit a real edit.
  for (const re of MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) {
      return { matched: false, reason: 'mutation_signal' };
    }
  }

  let isAdvice = false;
  for (const re of ADVICE_PATTERNS) {
    if (re.test(message)) {
      isAdvice = true;
      break;
    }
  }
  if (!isAdvice) {
    return { matched: false, reason: 'no_advice_signal' };
  }

  const leadingLabel = analysis.leading_option.label;
  const topDriverLabel = analysis.top_drivers[0]?.factor_label ?? null;
  return {
    matched: true,
    assistant_text: composeAdvicePrompt(leadingLabel, topDriverLabel),
    leading_option_label: leadingLabel,
    top_driver_label: topDriverLabel,
  };
}

function composeAdvicePrompt(
  leadingLabel: string,
  topDriverLabel: string | null,
): string {
  // Composer-template invariant: the deterministic prose contains no
  // banned tokens. Verified via the egress audit in
  // `FORBIDDEN_USER_FACING_PHRASES` — neither `recommendation` nor
  // `the winner` nor `winning <X>` appears in either branch.
  //
  // Soft edge case (deferred — review round 2): if a user-authored
  // option / factor label itself contains a banned token (e.g. a
  // user named their option "My Recommendation"), the finaliser-level
  // egress guard will rewrite the whole assistant_text to the neutral
  // fallback. The user would then see a generic acknowledgement
  // instead of a coaching answer. Not blocking — if this surfaces in
  // staging manual tests, layer a display-safe label transform here
  // (strip / quote the matched token in the user label before
  // interpolation) without changing the gate's matching logic.
  if (topDriverLabel) {
    return `Based on the analysis, ${leadingLabel} is currently ahead. The biggest thing to examine next is ${topDriverLabel}, because it could change the result.`;
  }
  return `Based on the analysis, ${leadingLabel} is currently ahead. Let me know which factor you'd like to look at next.`;
}
