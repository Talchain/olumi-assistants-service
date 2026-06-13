/**
 * V5 post-analysis advice gate / deterministic post-analysis router.
 *
 * Deterministic pre-LLM dispatch surface for post-analysis free-text
 * questions. Owns the single classification matrix for:
 *
 *   advice / next_step / update_advice / improvement
 *     - "How should we improve this?" / "What should we update?"
 *   readiness
 *     - "Why is this only 35% ready?" / "What's blocking the analysis?"
 *   meaning
 *     - "What does this mean?" / "Help me interpret this"
 *   evidence_gap
 *     - "What's missing?" / "What evidence is missing?"
 *   explain_results_free_text
 *     - "Explain the results" / "Walk me through these results" — free-text
 *       equivalent of the explain_results chip (latency Fix 2)
 *   what_would_flip_free_text
 *     - "What would flip this?" / "What would change the outcome?" — free-text
 *       equivalent of the what_would_flip chip (latency Fix 2)
 *
 * The gate ONLY short-circuits when:
 *   - a prior analysis is present AND
 *   - analysis freshness is `'fresh'` (stale/unknown/none falls through) AND
 *   - the user message is one of the supported classes AND
 *   - the message does NOT carry a concrete graph-mutation signal AND
 *   - the per-class required inputs are available
 *
 * When a class matches but its required inputs are missing, the gate
 * returns `matched: false, reason: 'data_unavailable_for_class'` with
 * `advice_class` and `missing_inputs` attached. Callers MUST fall
 * through to Sonnet routing in that case — never emit weak deterministic
 * copy from this surface.
 *
 * Composer copy invariants:
 *   - no `\brecommendations?\b` / `\brecommended\b`
 *   - no `\bthe\s+winners?\b` / `\bwinning\s+(option|probability|side|choice|outcome)\b`
 *   - no raw IDs, no raw decimals, no readiness percentage
 *   The egress guard (`FORBIDDEN_USER_FACING_PHRASES`) is the last line
 *   of defence; this composer must already be clean by construction.
 *
 * Single source of truth for deterministic free-text post-analysis
 * dispatch — do not duplicate the matcher in another file.
 */

import {
  hasSufficientReadinessData,
  summariseReadiness,
  type ReadinessSummary,
} from './readiness-summary.js';
import {
  hasIndependentMutationSignal,
  MUTATION_SIGNAL_PATTERNS,
} from './analytical-intent.js';
import {
  formatPercentagePoints,
  formatProbability,
} from '../format/format-analysis-value.js';
import { formatSensitivityDirection } from '../format/sensitivity-phrases.js';
import type { GraphPatchBlockData } from '../../orchestrator/types.js';
import {
  closenessLead,
  describeRobustnessBand,
  isNearTieByMargin,
  isRawFragile,
  nearTieReasonByMargin,
  quoteLabel,
  type RawRobustnessSignals,
} from '../coaching/robustness-honesty.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import {
  describeValidationPriority,
  isRenderableValidationEdge,
} from '../coaching/validation-priority.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

/**
 * Thin advice-gate wrappers around the shared margin-based helpers in
 * `coaching/robustness-honesty.ts`. Kept in this file so the existing
 * `AdviceGateAnalysis`-typed callsites below stay unchanged and the
 * single source of truth for the threshold/labels lives in one place.
 */
function isNearTie(
  analysis: AdviceGateAnalysis,
  rawRobustness: RawRobustnessSignals | null | undefined,
): boolean {
  return isNearTieByMargin(analysis.margin_pp, rawRobustness);
}

function nearTieReason(
  analysis: AdviceGateAnalysis,
  rawRobustness: RawRobustnessSignals | null | undefined,
): 'margin' | 'override' | null {
  return nearTieReasonByMargin(analysis.margin_pp, rawRobustness);
}

export interface AdviceGateAnalysisOption {
  readonly label: string;
  /**
   * Probability pass-through from the upstream `ContextPackAnalysis`.
   * Optional so existing test fixtures and minimal callers stay valid;
   * the enriched composers omit the probability fragment when this is
   * absent or non-finite. Never recomputed — F.6 invariant.
   */
  readonly probability?: number;
}

export interface AdviceGateAnalysisDriver {
  readonly factor_label: string;
  readonly sensitivity_value?: number;
}

export interface AdviceGateAnalysisFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

export interface AdviceGateAnalysis {
  readonly status?: string;
  readonly leading_option: AdviceGateAnalysisOption | null;
  readonly runner_up?: AdviceGateAnalysisOption | null;
  readonly margin_pp?: number | null;
  readonly robustness_band?: string | null;
  readonly top_drivers: readonly AdviceGateAnalysisDriver[];
  readonly fragile_edges?: readonly AdviceGateAnalysisFragileEdge[];
}

/**
 * Freshness verdict shape (mirrors FreshnessDerivation.freshness from
 * `src/orchestrator-v5/context/freshness.ts`). Narrow union so the
 * module stays free of orchestrator-internal type imports.
 */
export type AdviceGateFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

/**
 * Discriminated class of advice / coaching / readiness question matched
 * from the user message. `advice` is the original PR #173 surface; the
 * remaining classes are added by P0 deterministic post-analysis router.
 */
export type AdviceClass =
  | 'advice'
  | 'next_step'
  | 'update_advice'
  | 'improvement'
  | 'readiness'
  | 'meaning'
  | 'evidence_gap'
  | 'explain_results_free_text'
  | 'what_would_flip_free_text';

export interface AdviceGateInput {
  readonly message: string;
  readonly analysis: AdviceGateAnalysis | null | undefined;
  /**
   * Analysis-ready payload (`computeStructuralReadiness` output) for
   * the current graph. Required by `readiness` and `evidence_gap`
   * classes. Other classes ignore it; absent / null is safe.
   */
  readonly analysisReady?: AnalysisReadyPayload | null | undefined;
  /**
   * Freshness verdict from the turn-executor's analysis-freshness
   * derivation. The gate ONLY short-circuits when freshness is
   * `'fresh'` — stale/unknown/none MUST fall through so the existing
   * stale-aware recovery surfaces can emit a stale-safe response.
   */
  readonly freshness: AdviceGateFreshness | null | undefined;
  /**
   * V5 coaching — verbatim `decision_review` enrichment from the latest
   * successful run_analysis fact (as stored under
   * `result.enrichment.decision_review`). When present, `evidence_gap`
   * prefers `evidence_enhancements[].specific_action` strings and the
   * first `key_assumptions[]` entry as content sources for richer,
   * grounded validation/research advice. Caller threads this from
   * `context.prior_facts` at gate time; current-turn run_analysis facts
   * are not yet in prior_facts when the gate fires (the gate only matches
   * when freshness === 'fresh', which requires a prior fact). Optional /
   * undefined / null is safe — composers fall back to projection-only
   * behaviour.
   */
  readonly decisionReview?: Record<string, unknown> | null | undefined;
  /**
   * Raw robustness signals (`enrichment.robustness.level`,
   * `enrichment.robustness.near_tie.is_tie`) from the latest successful
   * run_analysis fact. Threaded by the turn-executor via
   * `pickLatestRawRobustness` — the same canonical selector as
   * `pickLatestDecisionReview`. Optional: composers fall back to the
   * projected `analysis.robustness_band` and `analysis.margin_pp` when
   * absent. When present, near-tie / fragile detection prefers the raw
   * signal so canonicalisation losses (e.g. `very_low → unknown → null`)
   * cannot silently swap fragile copy for confident copy.
   */
  readonly rawRobustness?: RawRobustnessSignals | null | undefined;
}

export type AdviceGateUnmatchedReason =
  | 'no_analysis'
  | 'not_fresh'
  | 'mutation_signal'
  | 'no_advice_signal'
  | 'empty_message'
  | 'data_unavailable_for_class';

/**
 * Action chip emitted alongside a matched advice-gate response. Shape
 * mirrors `FreshAnalysisFollowupSuggestedAction` in
 * `fresh-analysis-followup-guard.ts` exactly so the turn-executor's
 * `composeDirectAnswerResponse` call site consumes both surfaces with
 * identical spread semantics. `action_type` is constrained to chips
 * whose handlers run deterministically via `dispatchDeterministicChipClick`
 * (no LLM call); no new action types are introduced here.
 */
export interface AdviceGateSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: 'explain_results' | 'what_would_flip';
}

/**
 * Coarse category of WHICH structured source the matched copy was composed
 * from. Additive copy-source diagnostic (non-user-facing) so future traces can
 * prove that structured coaching reached the user surface, and which surface.
 * `decision_review` is the LLM-authored enrichment (only reachable when the
 * auto-fire flag is on); the others are deterministic projections from the
 * raw persisted PLoT analysis — the by-design fallback.
 */
export type AdviceGateCopySource =
  | 'decision_review'
  | 'analysis_projection'
  | 'fragile_edges'
  | 'top_drivers'
  | 'readiness';

export interface AdviceGateMatched {
  readonly matched: true;
  readonly advice_class: AdviceClass;
  readonly assistant_text: string;
  readonly leading_option_label: string;
  readonly top_driver_label: string | null;
  /**
   * Copy-source delivery diagnostics (additive, structural-only — never a
   * label or value). `copy_source` is the dominant source the copy drew from;
   * `coaching_fields_used` lists the projected analysis fields that were
   * present and available to the composer. The turn-executor surfaces these
   * on the `v5.post_analysis_advice_gate` telemetry event and (flag-gated) on
   * the diagnostic trace.
   */
  readonly copy_source: AdviceGateCopySource;
  readonly coaching_fields_used: readonly string[];
  /**
   * Per-class chip set computed at composition time. Always present
   * (possibly empty). Per-class behaviour:
   *   - `explain_results_free_text` / `meaning` / `advice` /
   *     `next_step` / `update_advice` / `improvement` → one
   *     `what_would_flip` chip (natural follow-up).
   *   - `what_would_flip_free_text` → empty (prose already nudges the
   *     user toward changing a factor and re-running).
   *   - `readiness` / `evidence_gap` → empty (preserve PR #173 / PR #178
   *     behaviour).
   */
  readonly suggested_actions: readonly AdviceGateSuggestedAction[];
}

export interface AdviceGateUnmatched {
  readonly matched: false;
  readonly reason: AdviceGateUnmatchedReason;
  /**
   * Populated when reason === 'data_unavailable_for_class': the class
   * that matched against the message text and the inputs that were
   * required but absent. Threaded into telemetry so dashboards can
   * see which class is producing fall-throughs.
   */
  readonly advice_class?: AdviceClass;
  readonly missing_inputs?: readonly string[];
}

export type AdviceGateResult = AdviceGateMatched | AdviceGateUnmatched;

/**
 * Mutation-signal patterns: if ANY pattern fires, the gate yields control
 * to normal routing (which validates and dispatches edit_graph for real
 * mutations). The pattern array now lives in `./analytical-intent.ts` so
 * sibling guards (stale-rerun, no-analysis, edit_graph no-op recovery)
 * share the same negative gate. Behaviour is identical to PR #173 — the
 * patterns themselves are unchanged.
 */

interface ClassPattern {
  readonly advice_class: AdviceClass;
  readonly pattern: RegExp;
}

/**
 * Per-class advice patterns. Ordered by specificity — more specific
 * classes (`readiness`, `meaning`, `evidence_gap`, the free-text chip
 * equivalents) are evaluated BEFORE the broader `advice` / `next_step`
 * patterns so a message like "what does the readiness mean?" routes to
 * `readiness` rather than to `meaning`.
 *
 * Patterns are intentionally narrow — they target the exact phrasings
 * the user brief lists. False positives are caught by the
 * mutation-signal precedence rule above and by the per-class
 * data-availability fallback below.
 */
const CLASS_PATTERNS: readonly ClassPattern[] = [
  // ── readiness ────────────────────────────────────────────────────
  // "why is this only 35% ready" / "why is the readiness so low"
  {
    advice_class: 'readiness',
    pattern: /\bwhy\s+(?:is|are)\s+(?:this|the\s+(?:graph|model|decision|analysis|score))\s+(?:only|just|so)?\s*\d+\s*%?\s*ready\b/i,
  },
  // bare "why ... ready" — "why isn't this ready"
  {
    advice_class: 'readiness',
    pattern: /\bwhy\s+(?:is|isn['’]?t|aren['’]?t|isn\s+t|aren\s+t|are\s+not|is\s+not)\b[^.?!\n]{0,40}\bready\b/i,
  },
  // "why is the readiness …" / "why is readiness …"
  {
    advice_class: 'readiness',
    pattern: /\bwhy\s+is\s+(?:the\s+)?readiness\b/i,
  },
  // "what's blocking" / "what is blocking" / "what's stopping" / "what is preventing"
  {
    advice_class: 'readiness',
    pattern: /\bwhat['’]?s?\s+(?:blocking|stopping|preventing|missing\s+for|holding\s+up)\b/i,
  },
  // "why can't we run" / "why can't this run"
  {
    advice_class: 'readiness',
    pattern: /\bwhy\s+can['’]?t\s+(?:we|this|you|i|it)\b[^.?!\n]{0,40}\brun\b/i,
  },
  // "what needs to happen before" / "what's needed to run" / "what does it need"
  {
    advice_class: 'readiness',
    pattern: /\bwhat\s+(?:needs\s+to\s+happen|is\s+needed|does\s+(?:it|this|the\s+model)\s+need)\b/i,
  },
  // "what's left to do" — readiness-class
  {
    advice_class: 'readiness',
    pattern: /\bwhat['’]?s?\s+left\s+to\s+do\b/i,
  },

  // ── explain_results_free_text (latency Fix 2 — must precede `meaning` ─
  //     because "walk me through the analysis" is more specific than the
  //     bare `walk me through` pattern used for meaning).
  // "explain the results" / "explain these results" / "explain the analysis"
  {
    advice_class: 'explain_results_free_text',
    pattern: /\bexplain\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i,
  },
  // "walk me through (the|these) results"
  {
    advice_class: 'explain_results_free_text',
    pattern: /\bwalk\s+me\s+through\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i,
  },
  // "tell me about (the|these) results"
  {
    advice_class: 'explain_results_free_text',
    pattern: /\btell\s+me\s+about\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i,
  },
  // "what drove (this|that|the) (result|outcome|analysis|finding|answer)"
  // New: gives the advice gate primary ownership of the present-tense
  // "what drove" phrasing so the answer is composed inline rather than
  // deferred to the fresh-followup catch-net's recap-and-chip.
  {
    advice_class: 'explain_results_free_text',
    pattern: /\bwhat\s+drove\s+(?:this|that|the)\s+(?:result|outcome|analysis|finding|answer)\b/i,
  },
  // "why is <X> ahead / leading / in front / on top / the leader / the favourite"
  // The brief lists "Why is Option A leading?" as a target phrase the
  // advice gate must own, so "leading" sits in the predicate alongside
  // the narrower set. The companion change in `analytical-intent.ts`
  // broadens the shared `what_drove` classifier predicate the same way,
  // so the sibling guards (stale-rerun, no-analysis, advice-gate
  // data-unavailable fallback) all classify "leading" phrasings
  // consistently — no more LLM-router fall-through for the brief's
  // canonical questions in any freshness state.
  {
    advice_class: 'explain_results_free_text',
    pattern: /\bwhy\s+is\b[^.?!\n]{1,40}\b(?:ahead|leading|in\s+front|on\s+top|the\s+leader|the\s+favourite|the\s+favorite)\b/i,
  },

  // ── meaning ──────────────────────────────────────────────────────
  // "what does this mean" / "what does that mean" / "what does the analysis mean"
  {
    advice_class: 'meaning',
    pattern: /\bwhat\s+do(?:es)?\s+(?:this|that|it|the\s+(?:analysis|result|outcome|number|score|finding|chart))\s+mean\b/i,
  },
  // "how should I read this" / "how do I interpret this"
  {
    advice_class: 'meaning',
    pattern: /\bhow\s+(?:should|do)\s+(?:i|we)\s+(?:read|interpret|understand)\b/i,
  },
  // "help me interpret" / "help me understand"
  {
    advice_class: 'meaning',
    pattern: /\bhelp\s+me\s+(?:interpret|understand|make\s+sense\s+of|read)\b/i,
  },
  // "walk me through (this|these|the|what)" — meaning, not advice. Narrower
  // than the `explain_results_free_text` pattern above (which already
  // matched "walk me through the results/analysis").
  {
    advice_class: 'meaning',
    pattern: /\bwalk\s+me\s+through\b/i,
  },
  // "explain (this|that|what's going on|what happened)" — narrow meaning sense
  {
    advice_class: 'meaning',
    pattern: /\bexplain\s+(?:this|that|what['’]?s\s+going\s+on|what\s+happened|the\s+(?:reasoning|logic))\b/i,
  },

  // ── what_would_flip_free_text (latency Fix 2 — free-text equivalent of the chip) ─
  // "what would flip (this|the result|the outcome|things)"
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+would\s+flip\b/i,
  },
  // "what would change (the result|the outcome|things|the leading option|the analysis)"
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+would\s+change\s+(?:the\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i,
  },
  // "what would tip (this|the balance|the result)"
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+would\s+tip\b/i,
  },
  // "what would it take to (change|flip|reverse)"
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+would\s+it\s+take\s+to\s+(?:change|flip|reverse|move)\b/i,
  },
  // V5 post-analysis contract v1 (review round-4) — mirror of the
  // classifier's "how (another) option (win|look better|come ahead)"
  // pattern. Pre-round-4, this lived ONLY in `INTENT_PATTERNS`, so the
  // fresh path missed it here and routed via fresh-followup-guard's
  // catch-net (which delegates to the classifier) — same deterministic
  // outcome but with thinner recap copy instead of the richer
  // what_would_flip_free_text composer. Mirroring restores symmetry
  // between fresh and stale paths.
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bhow\s+(?:could|can|would)\s+(?:another\s+)?option\s+(?:win|look\s+better|come\s+(?:out\s+)?ahead)\b/i,
  },
  // "what would/does/might need/have to change/happen/move/shift/differ"
  // New: mirrors a `WHAT_WOULD_FLIP_STRIP_PATTERNS` entry in
  // analytical-intent.ts so the advice gate's mutation-precedence
  // strip-and-recheck logic continues to align. Captures the canonical
  // "what would need to change for another option to look better?"
  // phrasing the fresh-followup guard currently catches.
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+(?:would|do(?:es)?|might)\s+(?:need|have)\s+to\s+(?:change|happen|move|shift|differ)\b/i,
  },
  // V5 post-analysis contract v1 (review rounds 2 + 3) — `could/might/would`
  // modal cousins. These previously lived ONLY in
  // analytical-question-guard.ts ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS
  // (which covers the V4 route-v2 edit-dispatch path); the V5 advice gate
  // anchored every flip-pattern on `what would CHANGE` (only "change",
  // narrow noun set), so phrases like "What could change the outcome?",
  // "What would move the result?", "What might shift the analysis?", or
  // "How would the outcome change?" were falling through here to the
  // broad routing LLM. Round-3 widening adds `would` alongside
  // `could/might` so every modal alternation matches the analytical-
  // question-guard grammar. Mirrored shape with the matching
  // INTENT_PATTERNS.what_would_flip + WHAT_WOULD_FLIP_STRIP_PATTERNS
  // entries in analytical-intent.ts so fresh-gate matching, stale-rerun-
  // guard matching, and the mutation-precedence strip-and-recheck all
  // stay symmetric.
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+(?:could|might|would)\s+change\s+(?:the\s+(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|verdict|winner|winners)|things)\b/i,
  },
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bwhat\s+(?:might|could|would)\s+(?:shift|move|alter|affect|tip|change)\s+(?:the\s+)?(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)\b/i,
  },
  {
    advice_class: 'what_would_flip_free_text',
    pattern: /\bhow\s+(?:could|might|can|would)\s+(?:the\s+)?(?:result|results|outcome|outcomes|leading\s+option|analysis|ranking|order|balance|things|verdict|winner|winners)\s+(?:change|shift|move|flip|differ|reverse)\b/i,
  },

  // ── evidence_gap ─────────────────────────────────────────────────
  // "what's missing" / "what is missing" — broader than the readiness
  // "what's missing for" phrasing above (which routes to readiness).
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat['’]?s?\s+missing\b(?!\s+for)/i,
  },
  // "what evidence is missing" / "what data is missing" / "what's the gap"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+(?:evidence|data|information|info)\s+(?:is|are)\s+(?:missing|absent|lacking)\b/i,
  },
  // "what gaps" / "what's the gap" / "any gaps"
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:what\s+gaps?|what['’]?s?\s+the\s+gaps?|any\s+gaps?)\b/i,
  },
  // "anything I'm missing" / "anything we're missing" / "anything missing"
  {
    advice_class: 'evidence_gap',
    pattern: /\banything\s+(?:i['’]?m|we['’]?re|missing|else)\s*(?:missing)?\b/i,
  },
  // "what haven't we covered" / "what didn't we cover" — accept past-
  // participle / past-tense suffixes via `\w*` so "covered" / "considered"
  // / "accounted for" all match without a bare-stem boundary issue.
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+(?:haven['’]?t|didn['’]?t|hasn['’]?t)\s+(?:we|i)\b[^.?!\n]{0,40}\b(?:cover|consider|include|account)\w*\b/i,
  },
  // V5 coaching — validation / research / confidence-building / assumption-
  // testing. Closes the gap where questions like "What should we validate?",
  // "How do we build confidence?", "What assumptions should we test?" fell
  // through every guard to the LLM router (~11s) with edit_graph misroute
  // risk. Patterns are intentionally narrow: validation verbs (validate,
  // verify, confirm, etc.) are required, so generic "What should I change?"
  // continues to route to the broader `advice` class. Concrete mutations
  // ("Set/Change X to Y") are rejected by MUTATION_SIGNAL_PATTERNS before
  // reaching the classifier.

  // "what should we validate" — modal-first order
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:what|anything)\s+(?:should|could|can|might|do|would)\s+(?:we|i|you)\s+(?:validate|verify|confirm|de[-\s]?risk)\b/i,
  },
  // "anything we should validate" — pronoun-first order
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:what|anything)\s+(?:we|i|you)\s+(?:should|could|can|might|need\s+to|have\s+to)\s+(?:validate|verify|confirm|de[-\s]?risk)\b/i,
  },
  // "what should we research" / "how should we investigate"
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:what|how)\s+(?:should|do|can|could|might|would)\s+(?:we|i|you)\s+(?:research|investigate|explore|look\s+into)\b/i,
  },
  // "how do we build confidence" / "how can we increase confidence"
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:how|what)\s+(?:do|can|should|could|might|would)\s+(?:we|i|you)\s+(?:build|increase|raise|strengthen|grow|improve)\s+(?:our\s+|the\s+|more\s+)?confidence\b/i,
  },
  // "what evidence should we gather" / "what data could we collect"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+(?:evidence|data|information|info|signal|signals|proof)\s+(?:should|could|can|might|would|do)\s+(?:we|i|you)\s+(?:gather|collect|seek|pull|find|look\s+for|need|want)\b/i,
  },
  // "what assumptions should we test" / "what assumptions do we need to verify"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+assumptions?\s+(?:should|could|can|might|do|would)\s+(?:we|i|you)\s+(?:need\s+to\s+|have\s+to\s+|want\s+to\s+|like\s+to\s+)?(?:test|verify|check|question|challenge|tested|verified)\b/i,
  },
  // "Do you have any recommendations on what we should validate or research..."
  // — exact target phrasing from the workstream brief.
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:any\s+)?recommendations?\s+(?:on|for|to|about)\s+(?:what|how)\b[^.?!\n]{0,60}\b(?:validate|research|verify|test|investigate|confirm|gather)\b/i,
  },

  // ── improvement (must precede the broader 'how should we' advice pattern) ─
  // "what should we improve" / "what can we improve" / "what could be improved"
  {
    advice_class: 'improvement',
    pattern: /\bwhat\s+(?:should|can|could|might|would)\s+(?:we|i|you)\s+improve\b/i,
  },
  // "what could be improved" / "what can be improved"
  {
    advice_class: 'improvement',
    pattern: /\bwhat\s+(?:could|can)\s+be\s+improved\b/i,
  },
  // "how can this be improved" / "how can we improve"
  {
    advice_class: 'improvement',
    pattern: /\bhow\s+(?:can|could|might|should|do)\s+(?:we|i|you|this|it)\b[^.?!\n]{0,40}\bimprove(?:d)?\b/i,
  },
  // "how to improve" / "ways to improve"
  {
    advice_class: 'improvement',
    pattern: /\b(?:how|ways?)\s+to\s+improve\b/i,
  },

  // ── update_advice (must precede broader 'how should we' advice) ─
  // "how should we update this" / "how do we update this"
  {
    advice_class: 'update_advice',
    pattern: /\bhow\s+(?:should|do|would|can|might)\s+(?:we|i|you)\s+update\s+(?:this|that|it|the\s+(?:model|graph|decision|analysis))\b/i,
  },
  // "what would you update" / "what should we update"
  {
    advice_class: 'update_advice',
    pattern: /\bwhat\s+(?:would|should|could|do)\s+you\s+update\b/i,
  },
  // "should we change anything based on" / "should we update based on"
  {
    advice_class: 'update_advice',
    pattern: /\bshould\s+(?:we|i)\s+(?:change|update|adjust|revise)\s+(?:anything|something|this|the\s+(?:model|graph|decision))\b/i,
  },
  // "how do you recommend we update" — canonical c952 misroute (kept here
  // so the broader 'how should we' below also matches; this entry just
  // pins it to update_advice for telemetry clarity).
  {
    advice_class: 'update_advice',
    pattern: /\bhow\s+do\s+you\s+recommend\s+(?:we|i|us)\s+update\b/i,
  },
  // V5 post-analysis contract v1 — imperative change-advice. Closes the
  // "Tell me what to change" gap where the message falls through to the
  // broad routing LLM and risks an `edit_graph` misroute. Verb-object
  // anchored on the right; never bare `\btell\s+me\b` (which would
  // match off-topic chat). Mutation precedence (MUTATION_SIGNAL_PATTERNS
  // above) still rejects "Tell me what to change Pricing to £100" before
  // classification, so concrete edits route to the value-update gate.
  {
    advice_class: 'update_advice',
    pattern: /\btell\s+me\s+what\s+(?:to|i\s+(?:should|need\s+to|can|could|might))\s+(?:change|update|adjust|fix|improve|edit)\b/i,
  },
  // "show me what to change" / "show me what i should update"
  {
    advice_class: 'update_advice',
    pattern: /\bshow\s+me\s+what\s+(?:to|i\s+should)\s+(?:change|update|adjust|fix|improve|edit)\b/i,
  },

  // ── next_step ────────────────────────────────────────────────────
  // "next step(s)" / "what's the next step"
  {
    advice_class: 'next_step',
    pattern: /\bnext\s+steps?\b/i,
  },
  // "what's next" / "what comes next"
  {
    advice_class: 'next_step',
    pattern: /\bwhat['’]?s?\s+(?:next|comes\s+next|the\s+next)\b/i,
  },
  // "where should we start" / "where do we go next"
  {
    advice_class: 'next_step',
    pattern: /\bwhere\s+(?:should|do)\s+(?:we|i|you)\s+(?:start|go\s+next|begin)\b/i,
  },

  // ── advice (broadest — must be LAST) ─────────────────────────────
  // "how should we / I / you …"
  {
    advice_class: 'advice',
    pattern: /\bhow\s+(?:should|do|would|can|might)\s+(?:we|i|you)\b/i,
  },
  // "what should we / I / you …"
  {
    advice_class: 'advice',
    pattern: /\bwhat\s+should\s+(?:we|i|you)\b/i,
  },
  // "what would you (recommend | suggest | advise | think | do)"
  {
    advice_class: 'advice',
    pattern: /\bwhat\s+(?:would|do)\s+you\s+(?:recommend|suggest|advise|think|do)\b/i,
  },
  // "what factor / driver / thing / aspect / area / step / move …"
  {
    advice_class: 'advice',
    pattern: /\bwhat\s+(?:factor|driver|thing|aspect|area|step|move)s?\b/i,
  },
  // "what's the best / right / most important / the priority"
  {
    advice_class: 'advice',
    pattern: /\bwhat['’]?s?\s+(?:the\s+best|the\s+right|most\s+important|the\s+priority)\b/i,
  },
  // "where should we focus / look"
  {
    advice_class: 'advice',
    pattern: /\bwhere\s+should\s+(?:we|i|you)\s+(?:focus|look)\b/i,
  },
  // "any suggestions / ideas / advice / thoughts"
  {
    advice_class: 'advice',
    pattern: /\bany\s+(?:suggestions?|ideas?|advice|thoughts)\b/i,
  },
  // "can you recommend / suggest / advise / help me think"
  {
    advice_class: 'advice',
    pattern: /\bcan\s+you\s+(?:recommend|suggest|advise|help\s+me\s+think)\b/i,
  },
  // V5 post-analysis contract v1 — bare-interrogative change-advice
  // shapes. Same family as the imperative update_advice patterns above;
  // labeled `advice` because these are generic "what do I do?" framings
  // without explicit update context.
  // "what do I change?" / "what do we adjust?"
  {
    advice_class: 'advice',
    pattern: /\bwhat\s+do\s+(?:i|we)\s+(?:change|update|adjust|fix|edit)\b/i,
  },
  // "what needs to change" / "what needs changing" / "what needs to be updated"
  {
    advice_class: 'advice',
    pattern: /\bwhat\s+needs\s+(?:to\s+(?:change|be\s+(?:changed|updated|adjusted|fixed))|changing|updating|adjusting)\b/i,
  },
  // "help me figure out what to change" / "help me decide what to update".
  // Verbs (figure out / decide / work out) are distinct from the
  // `meaning` class's "help me (interpret|understand|make sense of|read)"
  // earlier in the array, so no cross-class collision.
  {
    advice_class: 'advice',
    pattern: /\bhelp\s+me\s+(?:figure\s+out|decide|work\s+out)\s+what\s+to\s+(?:change|update|adjust|fix|improve|edit)\b/i,
  },
  // "give me something to change" / "give me a starting point to update"
  {
    advice_class: 'advice',
    pattern: /\bgive\s+me\s+(?:something|a\s+starting\s+point|a\s+place\s+to\s+start)\s+to\s+(?:change|update|adjust|fix|improve)\b/i,
  },
  // "what's worth changing" / "what is worth updating"
  {
    advice_class: 'advice',
    pattern: /\bwhat['’]?s\s+worth\s+(?:changing|updating|adjusting|fixing|improving|editing)\b/i,
  },
];

/**
 * Per-class required-input table. The gate consults this AFTER pattern
 * matching: if a class fires but its required inputs are absent, the
 * gate returns `data_unavailable_for_class` and the caller falls
 * through to Sonnet. Never emit weak deterministic copy from a class
 * whose data is missing.
 */
interface ClassRequirements {
  readonly needs_leading_option: boolean;
  readonly needs_top_driver: boolean;
  readonly needs_runner_up: boolean;
  readonly needs_analysis_ready: boolean;
  readonly needs_fragile_edges: boolean;
}

const CLASS_REQUIREMENTS: Readonly<Record<AdviceClass, ClassRequirements>> = {
  advice: {
    needs_leading_option: true,
    needs_top_driver: false,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  next_step: {
    needs_leading_option: true,
    needs_top_driver: false,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  update_advice: {
    needs_leading_option: true,
    needs_top_driver: false,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  improvement: {
    needs_leading_option: true,
    needs_top_driver: true,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  meaning: {
    needs_leading_option: true,
    needs_top_driver: false,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  readiness: {
    needs_leading_option: false,
    needs_top_driver: false,
    needs_runner_up: false,
    needs_analysis_ready: true,
    needs_fragile_edges: false,
  },
  evidence_gap: {
    needs_leading_option: false,
    needs_top_driver: false,
    needs_runner_up: false,
    // Either readiness data OR top_drivers data is enough — see the
    // mixed predicate inside the gate.
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  explain_results_free_text: {
    needs_leading_option: true,
    needs_top_driver: true,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
  what_would_flip_free_text: {
    needs_leading_option: true,
    needs_top_driver: true,
    needs_runner_up: false,
    needs_analysis_ready: false,
    needs_fragile_edges: false,
  },
};

/**
 * Defence-in-depth label-presence check. The composer interpolates
 * `leading_option.label` and `top_drivers[0].factor_label` directly
 * into prose without a length guard, so an empty / whitespace-only
 * label would yield awkward double-spacing in user-facing copy.
 * Treat empty / whitespace-only labels as "missing input" so the gate
 * falls through cleanly via `data_unavailable_for_class` rather than
 * emitting malformed prose. Production ContextPack assembly normalises
 * labels, so this branch is rare — but the contract should be tight.
 */
function hasNonEmptyLabel(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * True when `top_drivers[0]` exists AND its `factor_label` is a
 * non-empty trimmed string. Bare `top_drivers.length > 0` is
 * insufficient: the gap-list fall-through interpolates the label
 * directly ("the strongest sensitivity is on `<label>`"), so a
 * whitespace-only label would emit `"sensitivity is on   "`.
 *
 * Used by the gap-list fall-through inside `composeEvidenceGap` and
 * by the per-class availability check so the renderability gate is
 * uniform across the file.
 */
function hasRenderableTopDriver(analysis: AdviceGateAnalysis): boolean {
  return hasRenderableTopDriverLabel(analysis);
}

/**
 * Projection-shaped variant of {@link hasRenderableTopDriver}: true when the
 * supplied analysis projection exposes a renderable top driver
 * (`top_drivers[0].factor_label` is a non-empty trimmed string). Accepts the
 * minimal structural shape shared by `AdviceGateAnalysis` and the ContextPack
 * analysis projection so call sites can report `top_driver_present` from the
 * SAME projection that powers `leading_option_present` — rather than from
 * whether a particular advice class happened to consume a driver label (which
 * left the telemetry reporting `false` on every non-match even when the
 * projection carried drivers).
 */
export function hasRenderableTopDriverLabel(
  analysis:
    | { readonly top_drivers?: ReadonlyArray<{ readonly factor_label?: string | null }> }
    | null
    | undefined,
): boolean {
  return hasNonEmptyLabel(analysis?.top_drivers?.[0]?.factor_label);
}

/**
 * True when a renderable SECOND driver exists. Used by the evidence-gap
 * fallback to name the two highest-leverage factors (where more evidence
 * matters most) instead of one, when the projection carries them. Same
 * non-empty-label contract as {@link hasRenderableTopDriver}.
 */
function hasRenderableSecondDriver(analysis: AdviceGateAnalysis): boolean {
  return hasNonEmptyLabel(analysis.top_drivers[1]?.factor_label);
}

/**
 * Per-edge renderability check. Both endpoint labels are interpolated
 * into prose (`"the link from <from> to <to>"`); a blank label on
 * either side would emit a malformed sentence. Delegates to the shared
 * predicate in `coaching/validation-priority.ts` so the advice-gate and
 * handler-projection surfaces can never drift on what "renderable" means.
 */
function isRenderableFragileEdge(
  edge: AdviceGateAnalysisFragileEdge,
): boolean {
  return isRenderableValidationEdge(edge);
}

/**
 * Filtered view of `fragile_edges` keeping only entries whose endpoint
 * labels are renderable. The composer iterates this list instead of
 * the raw array so blank-labelled edges can never reach assistant text
 * — even when the gate has passed via another signal (readiness or
 * top driver) and a degraded `fragile_edges[0]` would otherwise leak
 * through the slice-based loop.
 *
 * Returns an empty array when the source array is absent or all
 * entries are unrenderable; callers can use `.length` for presence
 * checks safely.
 */
function renderableFragileEdges(
  analysis: AdviceGateAnalysis,
): readonly AdviceGateAnalysisFragileEdge[] {
  return analysis.fragile_edges?.filter(isRenderableFragileEdge) ?? [];
}

function evaluateAvailability(
  cls: AdviceClass,
  analysis: AdviceGateAnalysis,
  analysisReady: AnalysisReadyPayload | null | undefined,
): readonly string[] {
  const reqs = CLASS_REQUIREMENTS[cls];
  const missing: string[] = [];
  if (
    reqs.needs_leading_option
    && (analysis.leading_option == null
      || !hasNonEmptyLabel(analysis.leading_option.label))
  ) {
    missing.push('leading_option');
  }
  if (
    reqs.needs_top_driver
    && (analysis.top_drivers.length === 0
      || !hasNonEmptyLabel(analysis.top_drivers[0]?.factor_label))
  ) {
    missing.push('top_driver');
  }
  if (
    reqs.needs_runner_up
    && (analysis.runner_up == null
      || !hasNonEmptyLabel(analysis.runner_up.label))
  ) {
    missing.push('runner_up');
  }
  if (reqs.needs_analysis_ready && !hasSufficientReadinessData(analysisReady)) {
    missing.push('analysis_ready');
  }
  // evidence_gap accepts either readiness data OR a renderable top
  // driver — fail only when BOTH are missing. The driver check uses
  // `hasRenderableTopDriver` (non-empty trimmed `factor_label`) so a
  // whitespace-only label can't satisfy the gate and then make the
  // gap-list fall-through emit "sensitivity is on   ". Matches the
  // existing renderability contract for `needs_top_driver` classes
  // above. Predicate semantics unchanged ('analysis_ready_or_top_drivers'
  // key retained) — this is a strictly defensive tightening on what
  // counts as "top driver available".
  if (cls === 'evidence_gap') {
    const haveReadiness = hasSufficientReadinessData(analysisReady);
    const haveDrivers = hasRenderableTopDriver(analysis);
    if (!haveReadiness && !haveDrivers) {
      missing.push('analysis_ready_or_top_drivers');
    }
  }
  return missing;
}

export function tryPostAnalysisAdviceGate(
  input: AdviceGateInput,
): AdviceGateResult {
  const analysis = input.analysis;
  if (!analysis) {
    return { matched: false, reason: 'no_analysis' };
  }
  // Leading-option presence is no longer a pre-class signal: it lives
  // in the per-class CLASS_REQUIREMENTS table and falls out of
  // `evaluateAvailability()` as `missing_inputs: ['leading_option']`
  // when a class that needs it doesn't have one. Classes that DON'T
  // need a leading option (readiness, evidence_gap) proceed with no
  // special-casing. Single uniform contract — every "missing input"
  // surfaces through `data_unavailable_for_class` so dashboards see
  // the class + the specific missing field.
  if (input.freshness !== 'fresh') {
    return { matched: false, reason: 'not_fresh' };
  }
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }

  // Classify first so the narrow `what_would_flip_free_text` mutation-
  // overlap exception (mirroring PR #187 fresh-followup guard) can apply.
  let matchedClass: AdviceClass | null = null;
  for (const cp of CLASS_PATTERNS) {
    if (cp.pattern.test(message)) {
      matchedClass = cp.advice_class;
      break;
    }
  }

  // Mutation precedence: concrete edits MUST reach edit_graph dispatch.
  // The broad MUTATION_SIGNAL_PATTERNS rejection applies to every class
  // EXCEPT `what_would_flip_free_text`, which keeps the analytical
  // capture when the mutation signal is fully explained by flip-pattern
  // overlap (e.g. "change ... to look better" inside the canonical
  // "what would need to change ... look better" phrasing).
  // `hasIndependentMutationSignal` (PR #187) strips every
  // `what_would_flip` pattern span before re-checking the verb-to-X
  // mutation pattern, so a separate edit clause survives the strip and
  // forces mutation precedence even within the exception. Net result:
  // mutation precedence is preserved bit-for-bit for every existing
  // test, AND the new "what would need to change for another option to
  // look better?" phrasing falls correctly through to the advice gate
  // composer rather than being misread as an edit.
  for (const re of MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) {
      const allowFlipException =
        matchedClass === 'what_would_flip_free_text'
        && !hasIndependentMutationSignal(message);
      if (!allowFlipException) {
        return { matched: false, reason: 'mutation_signal' };
      }
      break;
    }
  }

  if (matchedClass === null) {
    return { matched: false, reason: 'no_advice_signal' };
  }

  // Per-class data-availability check. `evaluateAvailability` enforces
  // every requirement on the table — including `needs_leading_option`
  // for the classes that need it. A missing leading_option falls out
  // here as `missing_inputs: ['leading_option']` so the telemetry
  // contract is uniform across every "missing input" failure mode.
  const missing = evaluateAvailability(
    matchedClass,
    analysis,
    input.analysisReady,
  );
  if (missing.length > 0) {
    return {
      matched: false,
      reason: 'data_unavailable_for_class',
      advice_class: matchedClass,
      missing_inputs: missing,
    };
  }

  const leadingLabel = analysis.leading_option?.label ?? '';
  const topDriverLabel = analysis.top_drivers[0]?.factor_label ?? null;

  const composeInput: ComposeInput = {
    leadingLabel,
    topDriverLabel,
    analysis,
    analysisReady: input.analysisReady ?? undefined,
    decisionReview: input.decisionReview ?? undefined,
    rawRobustness: input.rawRobustness ?? undefined,
  };
  const assistantText = composeForClass(matchedClass, composeInput);
  const { copy_source, coaching_fields_used } = describeCopySource(matchedClass, composeInput);

  return {
    matched: true,
    advice_class: matchedClass,
    assistant_text: assistantText,
    leading_option_label: leadingLabel,
    top_driver_label: topDriverLabel,
    suggested_actions: suggestedActionsForClass(matchedClass),
    copy_source,
    coaching_fields_used,
  };
}

/**
 * Derive the copy-source delivery diagnostic for a matched class. Pure,
 * additive, non-user-facing — mirrors the branch conditions the composers use
 * so a trace can prove which structured source the copy drew from. Returns
 * structural-only data (no labels, no values). For `evidence_gap` it re-checks
 * the same precedence the composer applies (decision_review → readiness gaps →
 * fragile edges → top driver → projection); the re-check is a cheap pure call.
 */
function describeCopySource(
  cls: AdviceClass,
  input: ComposeInput,
): { copy_source: AdviceGateCopySource; coaching_fields_used: readonly string[] } {
  const a = input.analysis;
  const fields: string[] = [];
  if (hasNonEmptyLabel(a.leading_option?.label)) fields.push('leading_option');
  if (hasNonEmptyLabel(a.runner_up?.label)) fields.push('runner_up');
  if (typeof a.margin_pp === 'number' && Number.isFinite(a.margin_pp)) fields.push('margin_pp');
  if (hasNonEmptyLabel(a.robustness_band ?? undefined)) fields.push('robustness_band');
  if (hasRenderableTopDriver(a)) fields.push('top_drivers');
  if (renderableFragileEdges(a).length > 0) fields.push('fragile_edges');
  if (input.rawRobustness != null) fields.push('raw_robustness');

  let copy_source: AdviceGateCopySource;
  if (cls === 'readiness') {
    copy_source = 'readiness';
  } else if (cls === 'evidence_gap') {
    if (extractValidationGuidanceFromDecisionReview(input.decisionReview) != null) {
      copy_source = 'decision_review';
      fields.push('decision_review');
    } else if (
      input.analysisReady
      && hasSufficientReadinessData(input.analysisReady)
      && summariseReadiness(input.analysisReady).open_items.length > 0
    ) {
      copy_source = 'readiness';
    } else if (renderableFragileEdges(a).length > 0) {
      copy_source = 'fragile_edges';
    } else if (hasRenderableTopDriver(a)) {
      copy_source = 'top_drivers';
    } else {
      copy_source = 'analysis_projection';
    }
  } else if (cls === 'what_would_flip_free_text') {
    // Mirror the composer precedence: a named flip threshold (decision_review)
    // → the fragile edge it points at → the top driver → bare projection.
    if (deriveFlipStatus(input.decisionReview).kind === 'flip_found') {
      copy_source = 'decision_review';
      fields.push('decision_review');
    } else if (renderableFragileEdges(a).length > 0) {
      copy_source = 'fragile_edges';
    } else if (hasRenderableTopDriver(a)) {
      copy_source = 'top_drivers';
    } else {
      copy_source = 'analysis_projection';
    }
  } else if (cls === 'explain_results_free_text' || cls === 'meaning') {
    // The interpretation twins now name the specific fragile assumption when
    // fragile_edges are renderable, then fall back to the top driver, then bare
    // projection. Mirror that precedence so the diagnostic reports the richest
    // structured source the copy drew from (content-free; no labels/values).
    if (renderableFragileEdges(a).length > 0) {
      copy_source = 'fragile_edges';
    } else if (hasRenderableTopDriver(a)) {
      copy_source = 'top_drivers';
    } else {
      copy_source = 'analysis_projection';
    }
  } else {
    copy_source = 'analysis_projection';
  }
  return { copy_source, coaching_fields_used: fields };
}

/**
 * Per-class chip set. Reuses the existing `what_would_flip` chip the
 * fresh-followup guard already emits (PR #187) so DGAI rendering and
 * the deterministic chip-click dispatch path stay aligned. No new
 * action types.
 */
const WHAT_WOULD_FLIP_CHIP: AdviceGateSuggestedAction = Object.freeze({
  id: 'chip_action_what_would_flip',
  label: 'What could change the outcome?',
  message: 'What could change the outcome of this analysis?',
  action_type: 'what_would_flip' as const,
});

function suggestedActionsForClass(
  cls: AdviceClass,
): readonly AdviceGateSuggestedAction[] {
  switch (cls) {
    case 'explain_results_free_text':
    case 'meaning':
    case 'advice':
    case 'next_step':
    case 'update_advice':
    case 'improvement':
      return [WHAT_WOULD_FLIP_CHIP];
    case 'what_would_flip_free_text':
    case 'readiness':
    case 'evidence_gap':
      return [];
  }
}

interface ComposeInput {
  readonly leadingLabel: string;
  readonly topDriverLabel: string | null;
  readonly analysis: AdviceGateAnalysis;
  readonly analysisReady: AnalysisReadyPayload | undefined;
  readonly decisionReview: Record<string, unknown> | undefined;
  readonly rawRobustness: RawRobustnessSignals | null | undefined;
}

function composeForClass(cls: AdviceClass, input: ComposeInput): string {
  switch (cls) {
    case 'advice':
    case 'next_step':
    case 'update_advice':
      return composeAdvice(input.leadingLabel, input.topDriverLabel, input.analysis);
    case 'improvement':
      return composeImprovement(
        input.leadingLabel,
        input.topDriverLabel,
        input.analysis,
        input.rawRobustness,
      );
    case 'meaning':
      return composeMeaning(
        input.leadingLabel,
        input.topDriverLabel,
        input.analysis,
        input.rawRobustness,
      );
    case 'readiness':
      return composeReadiness(input.analysisReady);
    case 'evidence_gap':
      return composeEvidenceGap(input.analysis, input.analysisReady, input.decisionReview);
    case 'explain_results_free_text':
      return composeExplainResults(
        input.leadingLabel,
        input.analysis,
        input.rawRobustness,
      );
    case 'what_would_flip_free_text':
      return composeWhatWouldFlip(
        input.leadingLabel,
        input.analysis,
        input.rawRobustness,
        input.decisionReview,
      );
  }
}

/**
 * Probability-fragment helper. Returns a trailing comma-prefixed clause
 * (", with a probability of NN%") when the value is finite and in the
 * `[0, 1]` range, empty string otherwise. Centralising the guard here
 * keeps every enriched composer aligned on the same degrade-gracefully
 * contract: if the upstream projection does not carry probability, the
 * fragment is silently omitted rather than rendering "Not available".
 */
function probabilityFragment(p: number | undefined): string {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return '';
  return `, with a probability of ${formatProbability(p)}`;
}

/**
 * Margin-fragment helper. Returns a formatted percentage-points string
 * only when the value is finite; null otherwise so callers decide how
 * to phrase the surrounding sentence.
 */
function marginPpString(margin: number | null | undefined): string | null {
  if (typeof margin !== 'number' || !Number.isFinite(margin)) return null;
  return formatPercentagePoints(margin);
}

/**
 * Driver sensitivity-direction fragment. Returns the prose phrase only
 * when sensitivity_value is finite; otherwise empty string so the
 * surrounding sentence drops the clause cleanly.
 */
function driverDirectionFragment(d: AdviceGateAnalysisDriver): string {
  if (typeof d.sensitivity_value !== 'number' || !Number.isFinite(d.sensitivity_value)) return '';
  return `, which ${formatSensitivityDirection(d.sensitivity_value)}`;
}

/**
 * The single fragile-assumption sentence shared by the post-analysis composers
 * (`explain_results` / `meaning` / `what_would_flip`). Quotes both endpoint
 * labels; makes NO causal/sign claim — `fragile_edges` carry no direction, so
 * this stays direction-honest by construction. The sentence is itself the
 * "what to check", so `meaning` can name the assumption without a separate
 * action block. Single source of truth so the three composers never drift.
 */
function describeFragileAssumption(edge: AdviceGateAnalysisFragileEdge): string {
  return `The most useful thing to check is the link from ${quoteLabel(edge.from_label)} to ${quoteLabel(edge.to_label)}: whether it holds as strongly as the model currently assumes.`;
}

/**
 * Near-tie / closeness standing line shared by the interpretation twins
 * (`explain_results` / `meaning`) so both read identically. Preserves the
 * established `explain_results` wording (now with quoted labels): the margin
 * path states the inclusive sub-1pp phrasing; the raw-override path stays
 * generic ("treats them as a near-tie") because the margin may be wider than
 * 1pp. Returns null when the result is not a near-tie or there is no runner-up
 * to compare, so the caller emits its own clear-lead opener.
 */
function interpretationCloseness(
  leadingLabel: string,
  runnerLabel: string | null | undefined,
  tieReason: 'margin' | 'override' | null,
): string | null {
  if (tieReason === null) return null;
  if (typeof runnerLabel !== 'string' || runnerLabel.trim().length === 0) return null;
  const lead = quoteLabel(leadingLabel);
  const runner = quoteLabel(runnerLabel);
  return tieReason === 'margin'
    ? `The result is effectively tied: ${lead} and ${runner} are separated by one percentage point or less.`
    : `The result is effectively tied: the analysis treats ${lead} and ${runner} as a near-tie.`;
}

/**
 * Concrete "what to check next" Propose line shared across the post-analysis
 * composers. The fragile path strengthens the named link; otherwise it names
 * the most influential factor (the projection's top driver) when available,
 * falling back to a neutral re-run prompt. Never implies that a single change
 * will flip the result. The two constants are also reused verbatim by
 * `composeWhatWouldFlip` so the phrasing has one home.
 */
const STRENGTHEN_LINK_NEXT_STEP =
  'Strengthen the evidence behind that link, then re-run to see whether the lead holds.';
const RERUN_INFLUENTIAL_NEXT_STEP =
  'Re-run after adjusting the most influential factor to see whether the lead holds.';

function interpretationNextStep(
  hasNamedFragileEdge: boolean,
  topDriverLabel: string | null,
): string {
  if (hasNamedFragileEdge) return STRENGTHEN_LINK_NEXT_STEP;
  return topDriverLabel !== null
    ? `Re-run after revisiting ${quoteLabel(topDriverLabel)}, the factor with the most influence here, to see whether the lead holds.`
    : RERUN_INFLUENTIAL_NEXT_STEP;
}

// The "what to validate" sentence (beat 5) now lives in
// `coaching/validation-priority.ts` (shared with the LLM `explain_results`
// handler path — V5-LANE-B-STRUCTURAL-01). `describeValidationPriority` is
// imported above and used verbatim by `composeExplainResults`, so this
// composer's output is byte-for-byte unchanged by the extraction. See the
// shared module for the in-flow vs standalone variant distinction.

function composeAdvice(
  leadingLabel: string,
  topDriverLabel: string | null,
  analysis: AdviceGateAnalysis,
): string {
  // Readability sectioning: opener + margin form the lead paragraph; the
  // closing actionable sentence is lifted into a `What to check next`
  // bullet so the scannable next-step lands on its own line. The phrase
  // wording inside the bullet is unchanged so existing `.toContain`
  // pinning continues to match.
  const probability = probabilityFragment(analysis.leading_option?.probability);
  const opener = `Based on this model, the analysis currently favours ${leadingLabel}${probability}.`;
  const margin = marginPpString(analysis.margin_pp);
  const runnerLabel = analysis.runner_up?.label;
  const marginClause =
    margin && runnerLabel
      ? ` It sits ahead of ${runnerLabel} by ${margin}.`
      : '';
  const lead = `${opener}${marginClause}`;
  const nextStep = topDriverLabel
    ? `The biggest thing to examine next is ${topDriverLabel}, because it could change the result.`
    : "Let me know which factor you'd like to look at next.";
  return `${lead}\n\nWhat to check next\n• ${nextStep}`;
}

function composeImprovement(
  leadingLabel: string,
  topDriverLabel: string | null,
  analysis: AdviceGateAnalysis,
  rawRobustness: RawRobustnessSignals | null | undefined,
): string {
  // Readability sectioning: opener + robustness qualifier form the lead
  // paragraph; the "most useful thing to examine" sentence is lifted
  // into a `What to check next` bullet. Phrase wording is unchanged so
  // existing `.toContain('To improve confidence')` style pinning keeps
  // matching.
  const probability = probabilityFragment(analysis.leading_option?.probability);
  const opener = `Based on this model, the analysis currently favours ${leadingLabel}${probability}.`;
  // Suppress the "smaller adjustments may not move the picture much"
  // stability claim when the result is a near-tie or raw robustness is
  // fragile — on such results, smaller adjustments WOULD move the
  // picture, and the original copy reads as misleading confidence.
  const nearTie = isNearTie(analysis, rawRobustness);
  const rawFragile = isRawFragile(rawRobustness);
  // Plain-language stability sentence — never the raw band token or the
  // phrase "robustness band". The hedged "may not move the picture much" line
  // is acceptable for stable / moderate bands; fragile is handled above and a
  // canonical fragile band is excluded here so it never reads as a stability
  // claim.
  const stabilityPhrase = describeRobustnessBand(analysis.robustness_band);
  const robustness =
    nearTie || rawFragile
      ? ' The picture appears fragile, so even small adjustments could shift it.'
      : stabilityPhrase !== null && analysis.robustness_band !== 'fragile'
        ? ` This result looks ${stabilityPhrase}, so smaller adjustments may not move the picture much.`
        : '';
  const lead = `${opener}${robustness}`;
  const nextStep = topDriverLabel
    ? `To improve confidence here, the most useful thing to examine is ${topDriverLabel}, because it has the most influence on the result.`
    // `improvement` requires a top driver per CLASS_REQUIREMENTS, so this
    // branch is unreachable in normal flow. Kept as a defensive default.
    : 'To improve confidence, look at the most influential factor for this decision.';
  return `${lead}\n\nWhat to check next\n• ${nextStep}`;
}

function composeMeaning(
  leadingLabel: string,
  topDriverLabel: string | null,
  analysis: AdviceGateAnalysis,
  rawRobustness: RawRobustnessSignals | null | undefined,
): string {
  // Vocabulary aligns with the workstream brief — "currently favours"
  // opener and "appears to be driven by" attribution avoid the
  // winner/leader-adjacent framing the previous wording carried.
  //
  // Near-tie honesty (shared with explain_results): on a sub-1pp margin OR a
  // raw near_tie override, lead with the closeness line and DO NOT assert the
  // result is "driven by" a single factor — a near-tie is not confidently
  // single-driver. Off near-tie, the interpretive attribution is preserved.
  //
  // Grounding: when a specific fragile assumption exists it is named (that
  // sentence is itself the "what to check"), so `meaning` stays interpretive —
  // no `What to check next` action block. The closing meta-statement remains
  // its own paragraph.
  const tieReason = nearTieReason(analysis, rawRobustness);
  const probability = probabilityFragment(analysis.leading_option?.probability);
  const margin = marginPpString(analysis.margin_pp);
  const runnerLabel = analysis.runner_up?.label;
  const topEdge = renderableFragileEdges(analysis)[0];
  const sentences: string[] = [];

  const closeness = interpretationCloseness(leadingLabel, runnerLabel, tieReason);
  if (closeness !== null) {
    sentences.push(closeness);
    if (topDriverLabel) {
      sentences.push(`The order could shift with movement on ${quoteLabel(topDriverLabel)}.`);
    }
  } else {
    const marginSentence =
      margin && runnerLabel ? ` It sits ahead of ${quoteLabel(runnerLabel)} by ${margin}.` : '';
    if (topDriverLabel) {
      sentences.push(
        `Based on this model, the analysis currently favours ${quoteLabel(leadingLabel)}${probability}, and the result appears to be driven by ${quoteLabel(topDriverLabel)}.${marginSentence}`,
      );
    } else {
      sentences.push(
        `Based on this model, the analysis currently favours ${quoteLabel(leadingLabel)}${probability}, given the model you've built so far.${marginSentence}`,
      );
    }
  }

  if (topEdge) {
    sentences.push(describeFragileAssumption(topEdge));
  }

  const lead = sentences.join(' ');
  const closer =
    topDriverLabel !== null || closeness !== null
      ? "The result reflects the model you've built so far, not a forecast."
      : 'The result reflects your current setup, not a forecast.';
  return `${lead}\n\n${closer}`;
}

function composeReadiness(
  analysisReady: AnalysisReadyPayload | undefined,
): string {
  // Guarded by data-availability check; readiness payload is present
  // here.
  const summary: ReadinessSummary = summariseReadiness(analysisReady!);
  if (summary.prose.length > 0) return summary.prose;
  // Defensive: structural readiness reported nothing open. Surface a
  // neutral, non-prescriptive line — the readiness percentage shown in
  // DGAI may come from a different scorer, so we don't claim "all set".
  return "Looking at the model structure here, the core pieces are in place. If the readiness score you're seeing is still low, it's likely picking up something outside the structural checks — let me know which factor you'd like to dig into.";
}

function composeEvidenceGap(
  analysis: AdviceGateAnalysis,
  analysisReady: AnalysisReadyPayload | undefined,
  decisionReview: Record<string, unknown> | undefined,
): string {
  // V5 coaching: prefer decision_review.evidence_enhancements when the
  // enricher has attached usable content. evidence_enhancements carries
  // grounded `specific_action` strings keyed by factor; key_assumptions
  // surfaces an assumption worth testing. Both are passthrough from the
  // LLM v11 schema; treat the payload as `unknown` and validate shape
  // defensively so a malformed or partial enrichment falls back cleanly
  // to the projection-only behaviour below.
  const fromDR = extractValidationGuidanceFromDecisionReview(decisionReview);
  if (fromDR != null) return fromDR;

  const gaps: string[] = [];
  if (analysisReady && hasSufficientReadinessData(analysisReady)) {
    const summary = summariseReadiness(analysisReady);
    for (const item of summary.open_items) {
      gaps.push(item.description);
    }
  }
  // Iterate over the renderability-filtered view so blank-labelled
  // edges can't leak into the gap list. Bare `fragile_edges.slice(0, 2)`
  // would emit `the link from "" to "B" is fragile...` if `[0]` had a
  // missing label and the gate had passed via another signal.
  const filteredEdges = renderableFragileEdges(analysis);
  if (filteredEdges.length > 0) {
    for (const edge of filteredEdges.slice(0, 2)) {
      gaps.push(
        `the link from "${edge.from_label}" to "${edge.to_label}" is fragile, so the analysis is sensitive to its true strength`,
      );
    }
  }
  if (gaps.length === 0 && hasRenderableTopDriver(analysis)) {
    // Fallback: name where evidence matters most. The first sentence is
    // byte-identical to the historical single-driver copy (gated on
    // `hasRenderableTopDriver` so a whitespace-only label can't emit
    // "sensitivity is on   "). When a renderable SECOND driver exists, add it
    // as a second gap so the two highest-leverage factors both surface — this
    // is the deterministic stand-in for "evidence priorities" when the
    // decision_review enrichment is unavailable (the by-design phase3 path).
    // It makes NO direction claim, so it is direction-honest by construction
    // and never re-derives a driver's sign.
    // Trim at extraction so rendered copy never carries incidental upstream
    // whitespace, and the dedup compare below operates on clean labels.
    // `hasRenderable*Driver` already rejects whitespace-only labels, so the
    // trimmed value is always non-empty here.
    const top = analysis.top_drivers[0]!.factor_label.trim();
    gaps.push(
      `the strongest sensitivity is on ${top}, so that's where more evidence would change the analysis the most`,
    );
    if (hasRenderableSecondDriver(analysis)) {
      const second = analysis.top_drivers[1]!.factor_label.trim();
      // Defensive: skip the second-driver line when it would name the same
      // factor twice. Compare case-folded (labels already trimmed) so
      // whitespace / case variants of the same display label are caught. The
      // projection sorts distinct factors by |sensitivity|; this only guards
      // the rare shared-label edge case.
      if (second.toLowerCase() !== top.toLowerCase()) {
        gaps.push(
          `${second} is the next most sensitive factor, so it's the second place where more evidence would help`,
        );
      }
    }
  }
  if (gaps.length === 0) {
    return "Looking at the analysis, there aren't obvious structural gaps right now. If you have a specific factor you're uncertain about, let me know and we can look at it together.";
  }
  if (gaps.length === 1) {
    return `The biggest open gap right now is: ${gaps[0]}.`;
  }
  const bullets = gaps.map((g) => `• ${g}`).join('\n');
  return `The biggest open gaps right now are:\n${bullets}`;
}

/**
 * V5 coaching — extract validation/research guidance from a
 * `decision_review` enrichment payload. Returns deterministic prose when
 * at least one `evidence_enhancements[].specific_action` is a non-empty
 * string; otherwise returns `null` so `composeEvidenceGap` falls back to
 * projection-only behaviour.
 *
 * Copy-safety:
 *   - opener: "To build confidence in this analysis, the most useful
 *     things to check are:" — no `recommend*` / no `winner*` / no
 *     sentence-leading instructional `Set/Updated/...` verbs (would trip
 *     the false-success guard per feedback_success_claim_regex_instructional_set).
 *   - per-item prose is sourced verbatim from the LLM `specific_action`
 *     string (already sanitised by the decision_review enricher's
 *     egress filter); we do NOT reword it.
 *   - one optional `key_assumptions[0]` line, appended only when the
 *     first entry is a non-empty string.
 *
 * Defensive shape parsing: the enrichment is a `Record<string, unknown>`
 * passthrough, so every field is validated with `readRecord` / `isNonEmpty
 * String` before use. A malformed enrichment returns `null` and never
 * leaks raw payloads.
 */
function extractValidationGuidanceFromDecisionReview(
  decisionReview: Record<string, unknown> | undefined,
): string | null {
  if (decisionReview == null) return null;
  const enhancements = readRecord(decisionReview['evidence_enhancements']);
  const actions: string[] = [];
  if (enhancements != null) {
    for (const key of Object.keys(enhancements)) {
      const entry = readRecord(enhancements[key]);
      if (entry == null) continue;
      const action = entry['specific_action'];
      if (isNonEmptyString(action)) {
        actions.push(action.trim());
      }
      if (actions.length >= 2) break;
    }
  }
  const assumptionsRaw = decisionReview['key_assumptions'];
  const firstAssumption = Array.isArray(assumptionsRaw)
    ? assumptionsRaw.find(isNonEmptyString)?.trim() ?? null
    : null;
  if (actions.length === 0 && firstAssumption == null) return null;

  const lines: string[] = [];
  if (actions.length > 0) {
    lines.push('To build confidence in this analysis, the most useful things to check are:');
    for (const a of actions) {
      lines.push(`• ${a}`);
    }
  }
  if (firstAssumption != null) {
    const intro = actions.length === 0
      ? 'One assumption worth testing first: '
      : 'One assumption worth testing alongside this: ';
    lines.push(`${intro}${firstAssumption}`);
  }
  return lines.join('\n');
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function composeExplainResults(
  leadingLabel: string,
  analysis: AdviceGateAnalysis,
  rawRobustness: RawRobustnessSignals | null | undefined,
): string {
  // Driver presence is guaranteed by CLASS_REQUIREMENTS; runner-up, margin,
  // robustness, per-driver sensitivity and fragile edges are optional and
  // degrade gracefully. Numerics are pass-through only — F.6 invariant.
  //
  // GQPV shape (parity with composeWhatWouldFlip): Ground (standing + drivers +
  // the specific fragile assumption when present) → Quantify (probability,
  // margin, robustness band — display-ready) → one robustness caveat → a
  // concrete re-run Propose on EVERY path. Option/driver labels are quoted so
  // "and"-containing labels stay readable.
  //
  // Near-tie honesty (shared interpretationCloseness): on |margin_pp| <= 1.0 OR
  // a raw near_tie override, suppress the "meaningful rather than marginal"
  // assertion and the confident stability claim. The margin path states the
  // inclusive sub-1pp phrasing; the override path stays generic ("treats them
  // as a near-tie") so we never claim a sub-1pp gap we cannot back.
  const tieReason = nearTieReason(analysis, rawRobustness);
  const nearTie = tieReason !== null;
  const rawFragile = isRawFragile(rawRobustness);
  const driverA = analysis.top_drivers[0];
  const driverB = analysis.top_drivers[1];
  const runnerLabel = analysis.runner_up?.label;
  const margin = marginPpString(analysis.margin_pp);
  const topEdge = renderableFragileEdges(analysis)[0];
  const topDriverLabel = hasNonEmptyLabel(driverA?.factor_label)
    ? driverA.factor_label
    : null;
  const sentences: string[] = [];

  // 1/2. Standing — leader and confidence (shared near-tie honesty, quoted; else a quoted clear lead).
  const closeness = interpretationCloseness(leadingLabel, runnerLabel, tieReason);
  if (closeness !== null) {
    sentences.push(closeness);
  } else {
    sentences.push(
      `Based on this model, the analysis currently favours ${quoteLabel(leadingLabel)}${probabilityFragment(analysis.leading_option?.probability)}.`,
    );
    if (runnerLabel && margin) {
      sentences.push(
        `That sits ahead of ${quoteLabel(runnerLabel)} by ${margin}, so the lead is meaningful rather than marginal.`,
      );
    } else if (runnerLabel) {
      sentences.push(
        `${quoteLabel(runnerLabel)} sits in second place${probabilityFragment(analysis.runner_up?.probability)}.`,
      );
    }
  }

  // 3. Why it leads — drivers (quoted). Near-tie softens "driven by" to "could shift".
  if (driverA && driverB) {
    sentences.push(
      nearTie
        ? `The order could shift with movement on ${quoteLabel(driverA.factor_label)}${driverDirectionFragment(driverA)}, or on ${quoteLabel(driverB.factor_label)}${driverDirectionFragment(driverB)}.`
        : `The result appears to be driven by ${quoteLabel(driverA.factor_label)}${driverDirectionFragment(driverA)}, and ${quoteLabel(driverB.factor_label)}${driverDirectionFragment(driverB)}.`,
    );
  } else if (driverA) {
    sentences.push(
      nearTie
        ? `The order could shift with movement on ${quoteLabel(driverA.factor_label)}${driverDirectionFragment(driverA)}.`
        : `The result appears to be driven by ${quoteLabel(driverA.factor_label)}${driverDirectionFragment(driverA)}.`,
    );
  }

  // 4. What is fragile — name the specific fragile assumption when evidence
  //    exists (shared with what_would_flip / meaning). No sign/causal claim —
  //    direction-honest.
  if (topEdge) {
    sentences.push(describeFragileAssumption(topEdge));
  }

  // 5. What to validate: the single piece of evidence that would most improve
  //    confidence. Points at the named fragile link when one exists, else the
  //    most-weighted factor; omitted when neither is renderable (mirrors the
  //    next-step fallback ladder, so no new required input is introduced).
  const validation = describeValidationPriority(topEdge != null, topDriverLabel);
  if (validation !== null) {
    sentences.push(validation);
  }

  // Robustness caveat — a conditional aside between beats 5 and 6 (not one of
  //    the numbered rhetorical beats): prefer the raw fragile signal over the
  //    projected band; suppress confident stability copy on near-tie / raw-fragile.
  if (nearTie || rawFragile) {
    sentences.push(
      'The picture appears fragile, so even small adjustments to the strongest factor could change which option leads.',
    );
  } else {
    // Plain-language stability copy sourced from the SSOT describeRobustnessBand.
    // Bind once and omit the sentence if it is unexpectedly null. Fragile /
    // unknown bands produce no sentence here.
    const stabilityPhrase = describeRobustnessBand(analysis.robustness_band);
    if (stabilityPhrase !== null) {
      if (analysis.robustness_band === 'stable' || analysis.robustness_band === 'highly_stable') {
        sentences.push(
          `This result looks ${stabilityPhrase}, so this view should hold under reasonable variation.`,
        );
      } else if (analysis.robustness_band === 'moderate') {
        sentences.push(
          `This result looks ${stabilityPhrase}, but it is worth checking the main assumptions before deciding.`,
        );
      }
    }
  }

  // 6. Next action — a concrete re-run Propose on EVERY path; previously the
  //    near-tie / fragile path emitted no next step at all. Point the next step at whatever
  //    the body emphasised: when a fragile link was NAMED above
  //    (describeFragileAssumption fires on any path with a renderable edge),
  //    strengthen THAT link so priorities don't read split ("check the link …
  //    but revisit the driver"); otherwise revisit the most influential factor.
  //    Never implies a single change flips the result.
  const lead = sentences.join(' ');
  const nextStep = interpretationNextStep(topEdge != null, topDriverLabel);
  return `${lead}\n\nWhat to check next\n• ${nextStep}`;
}

/**
 * Reliable flip signal for the what-would-flip composer.
 *
 * `'flip_found'` is the ONLY reliable verdict we can read: a non-empty
 * `decision_review.flip_thresholds` means the review surfaced at least one
 * single-factor threshold. We never infer "no flip exists" from an empty /
 * absent array — empty conflates "no flip in range" with "flip not computed"
 * (`factor_sensitivity[].flip_threshold` is number-or-absent; the prompt emits
 * `[]` for both cases). So everything else collapses to `'unknown'` and the
 * composer stays honest-by-default (no flip claim either way).
 *
 * A factor is only named when its label is a clean DISPLAY label
 * ({@link isCleanFactorLabel}) — the raw `factor_label` on the review payload
 * is not guaranteed canonical, so an ID-shaped / blank label downgrades to
 * `'unknown'` (omit the sentence) rather than risk leaking a token.
 */
type FlipStatus =
  | { readonly kind: 'flip_found'; readonly factor_label: string }
  | { readonly kind: 'unknown' };

function isCleanFactorLabel(label: unknown): label is string {
  if (typeof label !== 'string') return false;
  const trimmed = label.trim();
  if (trimmed.length === 0) return false;
  if (!/[a-z]/i.test(trimmed)) return false; // must carry an actual word
  if (isSlugShapedEntityId(trimmed)) return false; // reject ID-shaped tokens
  return true;
}

function deriveFlipStatus(
  decisionReview: Record<string, unknown> | undefined,
): FlipStatus {
  if (decisionReview == null) return { kind: 'unknown' };
  const thresholds = decisionReview['flip_thresholds'];
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    return { kind: 'unknown' };
  }
  for (const raw of thresholds) {
    const entry = readRecord(raw);
    if (entry === null) continue;
    const label = entry['factor_label'];
    if (isCleanFactorLabel(label)) {
      return { kind: 'flip_found', factor_label: label.trim() };
    }
  }
  // Non-empty but no clean/safe label to name → omit the flip sentence.
  return { kind: 'unknown' };
}

function composeWhatWouldFlip(
  leadingLabel: string,
  analysis: AdviceGateAnalysis,
  rawRobustness: RawRobustnessSignals | null | undefined,
  decisionReview: Record<string, unknown> | undefined,
): string {
  // Top driver presence is guaranteed by CLASS_REQUIREMENTS; runner-up,
  // margin, robustness and fragile edges are optional and degrade
  // gracefully. Numerics pass-through only — F.6 invariant.
  //
  // Copy shape: (1) closeness/standing → (2) the specific fragile assumption
  // worth checking → (3) an optional, provenance-safe flip-threshold pointer →
  // (4) exactly ONE consolidated caveat → (5) a re-run nudge that never
  // implies a single change flips the result.
  const tieReason = nearTieReason(analysis, rawRobustness);
  const nearTie = tieReason !== null;
  const rawFragile = isRawFragile(rawRobustness);
  // A canonicalised 'fragile' band is itself the upstream's fragility verdict
  // even when the raw signal is absent on older facts.
  const fragileSignal = nearTie || rawFragile || analysis.robustness_band === 'fragile';
  const runnerLabel = analysis.runner_up?.label;
  const margin = marginPpString(analysis.margin_pp);
  const topEdge = renderableFragileEdges(analysis)[0];
  const driverA = analysis.top_drivers[0];
  const flip = deriveFlipStatus(decisionReview);
  const sentences: string[] = [];

  // 1. Closeness / standing — lead with closeness on a near-tie, otherwise a
  //    quoted clear-lead opener. Option labels are quoted so "and"-containing
  //    labels stay readable.
  const closeness = closenessLead({
    leadingLabel,
    runnerLabel,
    tieReason,
    marginPp: analysis.margin_pp,
  });
  if (closeness !== null) {
    sentences.push(closeness);
  } else {
    sentences.push(
      `Based on this model, ${quoteLabel(leadingLabel)} currently leads${probabilityFragment(analysis.leading_option?.probability)}.`,
    );
    if (runnerLabel && margin) {
      sentences.push(
        `For ${quoteLabel(runnerLabel)} to overtake it, the lead of ${margin} would need to close.`,
      );
    } else if (runnerLabel) {
      sentences.push(
        `${quoteLabel(runnerLabel)} is the most likely contender to overtake it.`,
      );
    }
  }

  // 2. Name the specific fragile assumption when evidence exists. No
  //    direction/sign claim — `fragile_edges` carries none, so this stays
  //    direction-honest by construction. Falls back to the single most
  //    influential factor (top driver is guaranteed by CLASS_REQUIREMENTS)
  //    with NO flip claim when no fragile edge is available.
  if (topEdge) {
    sentences.push(describeFragileAssumption(topEdge));
  } else if (driverA) {
    sentences.push(
      `The factor with the most influence on the result is ${quoteLabel(driverA.factor_label)}.`,
    );
  }

  // 3. Optional, provenance-safe flip-threshold pointer — only when the review
  //    surfaced a named single-factor threshold with a clean label. We never
  //    assert the result WILL change; we point at a signal to inspect.
  if (flip.kind === 'flip_found') {
    sentences.push(
      `One threshold signal to inspect is ${quoteLabel(flip.factor_label)}.`,
    );
  }

  // 4. Exactly one consolidated caveat. The if/else-if makes stacking
  //    structurally impossible: a fragile/near-tie result gets the single
  //    "provisional" caveat; an otherwise-stable result gets the stability
  //    reassurance; moderate / unknown bands get nothing.
  if (fragileSignal) {
    sentences.push(
      topEdge
        ? 'Treat the lead as provisional until that assumption is strengthened.'
        : 'Treat the lead as provisional until the key assumptions are checked.',
    );
  } else {
    const stabilityPhrase = describeRobustnessBand(analysis.robustness_band);
    if (
      stabilityPhrase !== null
      && (analysis.robustness_band === 'stable' || analysis.robustness_band === 'highly_stable')
    ) {
      sentences.push(
        `This result looks ${stabilityPhrase}, so smaller changes are unlikely to change which option leads.`,
      );
    }
  }

  // 5. Re-run nudge — reframed so it never implies a single change flips the
  //    result. Points at strengthening the named link when fragile, otherwise
  //    a neutral re-run prompt.
  const lead = sentences.join(' ');
  const nextStep =
    fragileSignal && topEdge ? STRENGTHEN_LINK_NEXT_STEP : RERUN_INFLUENTIAL_NEXT_STEP;
  return `${lead}\n\nWhat to check next\n• ${nextStep}`;
}
