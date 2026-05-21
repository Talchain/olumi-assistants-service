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

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

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

export interface AdviceGateMatched {
  readonly matched: true;
  readonly advice_class: AdviceClass;
  readonly assistant_text: string;
  readonly leading_option_label: string;
  readonly top_driver_label: string | null;
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
  // Validation/research family. The workstream's analysis-complete moment
  // asks the user to plan confidence-building work after a fresh analysis:
  // "what should we validate / research / test", "how do we build
  // confidence", "what evidence should we gather". These sit in
  // `evidence_gap` rather than a sibling class because the available
  // grounding signals are the same (fragile_edges + top_drivers), and the
  // class-requirement table already accepts either readiness data OR
  // top_drivers via the mixed predicate below. Subject/verb word-order
  // alternation handles "what should we validate" and "what we should
  // validate"; the bare "to" branch covers "what to validate".
  //
  // "what (should|would|could|can|do|might) we|i|you|us validate"
  // "what we|i|you|us (should|would|could|can|do|might) validate"
  // "what to validate"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+(?:(?:should|would|could|can|do|might)\s+(?:we|i|you|us)|(?:we|i|you|us)\s+(?:should|would|could|can|do|might)|to)\s+validate\b/i,
  },
  // "what (should|would|could|can|do|might) we|i|you|us research"
  // "what we|i|you|us (should|would|could|can|do|might) research"
  // "what to research"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+(?:(?:should|would|could|can|do|might)\s+(?:we|i|you|us)|(?:we|i|you|us)\s+(?:should|would|could|can|do|might)|to)\s+research\b/i,
  },
  // "validate further" / "research further" — catches the spec's
  // "validate or research further" idiom even without a leading "what".
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:validate|research)\s+further\b/i,
  },
  // "how (do|can|should|would|might) we|i|you|us build confidence"
  // "how to build confidence"
  {
    advice_class: 'evidence_gap',
    pattern: /\bhow\s+(?:(?:do|can|should|would|might)\s+(?:we|i|you|us)?\s*|to\s+)build\s+confidence\b/i,
  },
  // "what assumptions should we test" / "what should we test"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+(?:assumptions?\s+)?(?:should|would|could|do|might)\s+(?:we|i|you|us)\s+test\b/i,
  },
  // "what evidence should we gather" / "what evidence would help|change|matter"
  {
    advice_class: 'evidence_gap',
    pattern: /\bwhat\s+evidence\s+(?:(?:should|would|could|might)\s+(?:we|i|you|us)\s+gather|would\s+(?:help|change|matter))\b/i,
  },
  // Disjunction safety net: catches the spec's long-form composite
  // ("recommendations for what we should validate or research further to
  // build confidence in our decision") via the literal disjunction even
  // when no other pattern in the family fires.
  {
    advice_class: 'evidence_gap',
    pattern: /\b(?:validate\s+or\s+research|research\s+or\s+validate)\b/i,
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
 * True when `top_drivers[0]` exists AND its `factor_label` is a non-
 * empty trimmed string. Bare `top_drivers.length > 0` is insufficient:
 * the existing gap-list fall-through interpolates the label directly
 * ("the strongest sensitivity is on `<label>`"), so a whitespace-only
 * label would emit `"sensitivity is on   "`. Used by both the
 * availability gate (so we don't match the class on an unrenderable
 * driver) and the composer's gap-list fall-through.
 */
function hasRenderableTopDriver(analysis: AdviceGateAnalysis): boolean {
  return hasNonEmptyLabel(analysis.top_drivers[0]?.factor_label);
}

/**
 * True when `fragile_edges[0]` exists AND BOTH endpoint labels are
 * non-empty trimmed strings. Both endpoints are interpolated into
 * prose (`"the link from <from> to <to>"`); a blank label on either
 * side would emit a malformed sentence. Treats renderable fragile
 * edges as a first-class grounding signal for `evidence_gap` —
 * sufficient on its own, even without readiness data or top drivers.
 */
function hasRenderableFragileEdge(analysis: AdviceGateAnalysis): boolean {
  const edge = analysis.fragile_edges?.[0];
  if (edge === undefined) return false;
  return hasNonEmptyLabel(edge.from_label) && hasNonEmptyLabel(edge.to_label);
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
  // evidence_gap accepts ANY renderable grounding signal — readiness
  // data, a renderable top driver, OR a renderable fragile edge. Each
  // is sufficient on its own because each can independently produce a
  // grounded answer:
  //   - readiness     → open_items / blockers prose
  //   - top_driver    → "sensitivity is on <label>" gap bullet OR
  //                     "place to gather evidence is <label>" lead
  //   - fragile_edge  → "link from <from> to <to> is fragile" bullet OR
  //                     "worth validating the link" lead
  // Renderability (non-empty trimmed labels) is enforced here so a
  // whitespace-only label can't satisfy the gate and then cause the
  // composer to emit malformed prose downstream.
  if (cls === 'evidence_gap') {
    const haveReadiness = hasSufficientReadinessData(analysisReady);
    const haveDrivers = hasRenderableTopDriver(analysis);
    const haveFragileEdge = hasRenderableFragileEdge(analysis);
    if (!haveReadiness && !haveDrivers && !haveFragileEdge) {
      missing.push('analysis_ready_or_top_drivers_or_fragile_edge');
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

  const assistantText = composeForClass(matchedClass, {
    leadingLabel,
    topDriverLabel,
    analysis,
    analysisReady: input.analysisReady ?? undefined,
    message,
  });

  return {
    matched: true,
    advice_class: matchedClass,
    assistant_text: assistantText,
    leading_option_label: leadingLabel,
    top_driver_label: topDriverLabel,
    suggested_actions: suggestedActionsForClass(matchedClass),
  };
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
  /**
   * Trimmed user message. Only `composeEvidenceGap` consults it today: it
   * re-classifies the matched `evidence_gap` message into a validation-
   * aware sub-flavour (validate / research / confidence / test /
   * assumption tokens) and leads with a validation recommendation
   * grounded in `top_drivers` + `fragile_edges`. No new advice class —
   * the dispatch surface stays single-source-of-truth.
   */
  readonly message: string;
}

function composeForClass(cls: AdviceClass, input: ComposeInput): string {
  switch (cls) {
    case 'advice':
    case 'next_step':
    case 'update_advice':
      return composeAdvice(input.leadingLabel, input.topDriverLabel, input.analysis);
    case 'improvement':
      return composeImprovement(input.leadingLabel, input.topDriverLabel, input.analysis);
    case 'meaning':
      return composeMeaning(input.leadingLabel, input.topDriverLabel, input.analysis);
    case 'readiness':
      return composeReadiness(input.analysisReady);
    case 'evidence_gap':
      return composeEvidenceGap(input.message, input.analysis, input.analysisReady);
    case 'explain_results_free_text':
      return composeExplainResults(
        input.leadingLabel,
        input.analysis,
      );
    case 'what_would_flip_free_text':
      return composeWhatWouldFlip(
        input.leadingLabel,
        input.analysis,
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

function composeAdvice(
  leadingLabel: string,
  topDriverLabel: string | null,
  analysis: AdviceGateAnalysis,
): string {
  const probability = probabilityFragment(analysis.leading_option?.probability);
  const opener = `Based on this model, the analysis currently favours ${leadingLabel}${probability}.`;
  const margin = marginPpString(analysis.margin_pp);
  const runnerLabel = analysis.runner_up?.label;
  const marginClause =
    margin && runnerLabel
      ? ` It sits ahead of ${runnerLabel} by ${margin}.`
      : '';
  if (topDriverLabel) {
    return `${opener}${marginClause} The biggest thing to examine next is ${topDriverLabel}, because it could change the result.`;
  }
  return `${opener}${marginClause} Let me know which factor you'd like to look at next.`;
}

function composeImprovement(
  leadingLabel: string,
  topDriverLabel: string | null,
  analysis: AdviceGateAnalysis,
): string {
  const probability = probabilityFragment(analysis.leading_option?.probability);
  const opener = `Based on this model, the analysis currently favours ${leadingLabel}${probability}.`;
  const robustness = analysis.robustness_band
    ? ` The robustness band is ${analysis.robustness_band}, so smaller adjustments may not move the picture much.`
    : '';
  if (topDriverLabel) {
    return `${opener} To improve confidence here, the most useful thing to examine is ${topDriverLabel}, because it has the most influence on the result.${robustness}`;
  }
  // `improvement` requires a top driver per CLASS_REQUIREMENTS, so this
  // branch is unreachable in normal flow. Kept as a defensive default.
  return `${opener} To improve confidence, look at the most influential factor for this decision.${robustness}`;
}

function composeMeaning(
  leadingLabel: string,
  topDriverLabel: string | null,
  analysis: AdviceGateAnalysis,
): string {
  // Vocabulary aligns with the workstream brief — "currently favours"
  // opener and "appears to be driven by" attribution avoid the
  // winner/leader-adjacent framing the previous wording carried
  // ("doing most of the work to make it the leader"). The downstream
  // "reflects the model you've built so far" sentence is preserved so
  // existing regression tests continue to match.
  const probability = probabilityFragment(analysis.leading_option?.probability);
  const margin = marginPpString(analysis.margin_pp);
  const runnerLabel = analysis.runner_up?.label;
  const marginSentence =
    margin && runnerLabel
      ? ` It sits ahead of ${runnerLabel} by ${margin}.`
      : '';
  if (topDriverLabel) {
    return `Based on this model, the analysis currently favours ${leadingLabel}${probability}, and the result appears to be driven by ${topDriverLabel}.${marginSentence} The result reflects the model you've built so far, not a forecast.`;
  }
  return `Based on this model, the analysis currently favours ${leadingLabel}${probability}, given the model you've built so far.${marginSentence} The result reflects your current setup, not a forecast.`;
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

/**
 * Validation-flavour detector. Returns true when the matched message
 * carries a confidence-building intent — i.e. the user is asking which
 * evidence / assumptions to validate, research, or test, rather than
 * which evidence is missing. The two sub-flavours share class
 * (`evidence_gap`) and grounding data (`top_drivers`, `fragile_edges`,
 * `analysisReady`); only the composer lead differs.
 *
 * Token set deliberately narrow: tokens that already steer the family's
 * patterns above (validate / research / test / confidence / assumption).
 * "Test" is anchored to a word boundary so noise like "fastest" or
 * "latest" can't trip the flavour.
 */
const VALIDATION_FLAVOUR_RE = /\b(?:validate|research|confidence|test|assumptions?)\b/i;

function composeEvidenceGap(
  message: string,
  analysis: AdviceGateAnalysis,
  analysisReady: AnalysisReadyPayload | undefined,
): string {
  // Validation-aware lead. When the matched message asks about
  // validation / research / confidence-building, lead with the
  // recommendation grounded in `top_drivers[0]` and (if present) the
  // first fragile edge. Re-uses the gate's existing inputs; no new
  // dispatch surface, no new advice class. Falls through to the
  // existing gap-list behaviour when neither grounding signal is
  // available, so degrade-gracefully matches the rest of the file.
  if (VALIDATION_FLAVOUR_RE.test(message)) {
    const parts: string[] = [];
    const topDriverLabel = analysis.top_drivers[0]?.factor_label;
    const fragileEdge = analysis.fragile_edges?.[0];
    if (topDriverLabel && topDriverLabel.trim().length > 0) {
      parts.push(
        `The most useful place to gather evidence is ${topDriverLabel}. That's where new data would change the analysis the most.`,
      );
    }
    if (fragileEdge) {
      parts.push(
        `It's also worth validating the link from "${fragileEdge.from_label}" to "${fragileEdge.to_label}", which the analysis is most sensitive to.`,
      );
    }
    if (parts.length > 0) return parts.join(' ');
    // Neither lead applies — fall through to the gap-list behaviour
    // below so the response remains grounded.
  }

  const gaps: string[] = [];
  if (analysisReady && hasSufficientReadinessData(analysisReady)) {
    const summary = summariseReadiness(analysisReady);
    for (const item of summary.open_items) {
      gaps.push(item.description);
    }
  }
  if (analysis.fragile_edges && analysis.fragile_edges.length > 0) {
    for (const edge of analysis.fragile_edges.slice(0, 2)) {
      gaps.push(
        `the link from "${edge.from_label}" to "${edge.to_label}" is fragile, so the analysis is sensitive to its true strength`,
      );
    }
  }
  if (gaps.length === 0 && hasRenderableTopDriver(analysis)) {
    // Fallback: name the top driver as the place evidence matters most.
    // Gated on `hasRenderableTopDriver` (non-empty trimmed label) — a
    // bare `length > 0` would emit "sensitivity is on   " when the
    // label is whitespace-only.
    const top = analysis.top_drivers[0].factor_label;
    gaps.push(
      `the strongest sensitivity is on ${top}, so that's where more evidence would change the analysis the most`,
    );
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

function composeExplainResults(
  leadingLabel: string,
  analysis: AdviceGateAnalysis,
): string {
  // Driver presence is guaranteed by CLASS_REQUIREMENTS; runner-up,
  // margin, robustness and per-driver sensitivity are all optional and
  // degrade gracefully (composer omits the surrounding clause when
  // missing). Numerics are pass-through only — F.6 invariant.
  const driverA = analysis.top_drivers[0];
  const driverB = analysis.top_drivers[1];
  const runnerLabel = analysis.runner_up?.label;
  const margin = marginPpString(analysis.margin_pp);
  const sentences: string[] = [];
  sentences.push(
    `Based on this model, the analysis currently favours ${leadingLabel}${probabilityFragment(analysis.leading_option?.probability)}.`,
  );
  if (runnerLabel && margin) {
    sentences.push(
      `That sits ahead of ${runnerLabel} by ${margin}, so the lead is meaningful rather than marginal.`,
    );
  } else if (runnerLabel) {
    sentences.push(
      `${runnerLabel} sits in second place${probabilityFragment(analysis.runner_up?.probability)}.`,
    );
  }
  if (driverA && driverB) {
    sentences.push(
      `The result appears to be driven by ${driverA.factor_label}${driverDirectionFragment(driverA)}, and ${driverB.factor_label}${driverDirectionFragment(driverB)}.`,
    );
  } else if (driverA) {
    sentences.push(
      `The result appears to be driven by ${driverA.factor_label}${driverDirectionFragment(driverA)}.`,
    );
  }
  if (analysis.robustness_band) {
    sentences.push(
      `The robustness band is ${analysis.robustness_band}, so this view should hold under reasonable variation.`,
    );
  }
  sentences.push('Small changes to the strongest factor can shift the picture.');
  return sentences.join(' ');
}

function composeWhatWouldFlip(
  leadingLabel: string,
  analysis: AdviceGateAnalysis,
): string {
  // Top driver presence is guaranteed by CLASS_REQUIREMENTS; runner-up,
  // margin, robustness and per-driver sensitivity are optional and
  // degrade gracefully. Numerics pass-through only — F.6 invariant.
  const driverA = analysis.top_drivers[0];
  const driverB = analysis.top_drivers[1];
  const runnerLabel = analysis.runner_up?.label;
  const margin = marginPpString(analysis.margin_pp);
  const sentences: string[] = [];
  sentences.push(
    `Based on this model, ${leadingLabel} currently appears to be the favoured option${probabilityFragment(analysis.leading_option?.probability)}.`,
  );
  if (runnerLabel && margin) {
    sentences.push(
      `For ${runnerLabel} to overtake it, the lead of ${margin} would need to close.`,
    );
  } else if (runnerLabel) {
    sentences.push(
      `${runnerLabel} is the most likely contender to overtake it.`,
    );
  }
  if (driverA && driverB) {
    // 2-driver branch: name both as the highest-leverage levers; the per-
    // driver sensitivity-direction clauses are appended individually so
    // a missing sensitivity_value drops cleanly rather than rendering
    // "has little effect on the lead" when the value is unknown.
    const directionA = driverDirectionFragment(driverA);
    const directionB = driverDirectionFragment(driverB);
    const directionSentence =
      directionA && directionB
        ? ` Today ${driverA.factor_label}${directionA}; ${driverB.factor_label}${directionB}.`
        : directionA
          ? ` Today ${driverA.factor_label}${directionA}.`
          : directionB
            ? ` Today ${driverB.factor_label}${directionB}.`
            : '';
    sentences.push(
      `Movement on ${driverA.factor_label} or ${driverB.factor_label} would shift this result the most.${directionSentence}`,
    );
  } else if (driverA) {
    // Single-driver branch keeps "the factor most likely to flip" phrasing
    // so the existing `most\s+(likely|sensitive)` regression test stays green.
    sentences.push(
      `The factor most likely to flip the analysis is ${driverA.factor_label}${driverDirectionFragment(driverA)}.`,
    );
  }
  if (analysis.robustness_band) {
    sentences.push(
      `The robustness band is currently ${analysis.robustness_band}, so smaller changes are unlikely to flip the outcome on their own.`,
    );
  }
  sentences.push(
    'Try changing its value or strength and re-running to see where the leading option moves.',
  );
  return sentences.join(' ');
}
