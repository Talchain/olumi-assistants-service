/**
 * Score ONE reply: classify it, measure the final text (and the model's share of
 * it, as an estimate), run the seven checks, and record served-behaviour
 * observations that are not about the wording at all.
 */
import { CHECK_NAMES, leaderClaimsIn, runChecks, type CheckName, type CheckResult } from './checks.js';
import { classify, type CaseClass, type ClassifyContext, type RerunKind } from './classify.js';
import { buildOptionMatchers } from './options.js';
import { countsOf, splitServerText, type SplitBasis } from './text.js';
import { ranAnalysisThisTurn, runBlockedThisTurn, viewOf, type ReplyView } from './wire.js';

/** "Up to about 90 words by default" — a soft default, not a cap. Used only to report the share above it. */
export const DEFAULT_WORDS_SOFT = 90;

export interface TurnKey {
  readonly capture: string;
  readonly build: string;
  readonly scenario: string;
  readonly turn: string;
  readonly index: number;
}

export interface TurnMetrics {
  readonly finalWords: number;
  readonly finalSentences: number;
  readonly bullets: number;
  readonly finalQuestions: number;
  /** ESTIMATE — the model's share after the server's own paragraphs are peeled off; see text.ts. */
  readonly modelWordsEstimate: number;
  readonly modelQuestionsEstimate: number;
  readonly splitBasis: SplitBasis;
  readonly serverStatusPresent: boolean;
  readonly serverTextHead: string | null;
  readonly writeClaimsRemoved: number | null;
  readonly chipCount: number;
  readonly chipLabels: readonly string[];
}

export interface TurnFacets {
  readonly leaderPermitted: boolean | null;
  readonly withheldReason: string | null;
  readonly permittedAnalysisMode: string | null;
  /** Runtime PR-B's rule, mirrored for reporting only: permitted AND mode comparative_leader. */
  readonly leaderMayBeNamedPrB: boolean | null;
  readonly ranAnalysis: boolean;
  readonly runBlocked: boolean;
  readonly robustness: string | null;
  readonly nearTie: boolean | null;
  readonly fastPath: string | null;
  readonly exitPath: string | null;
  readonly replayed: boolean;
  readonly providerCalls: number | null;
  readonly tools: readonly string[];
}

export interface TurnObservations {
  /** Served behaviour, not wording: an approval or a canvas edit turn that ran the analysis. */
  readonly analysisRanOnApprovalOrEdit: boolean;
  /** The analysis_result block's own summary names a leader while leader_claim.permitted=false (rendering not established by a capture). */
  readonly blockSummaryNamesLeaderWhileWithheld: boolean | null;
}

export interface TurnScore {
  readonly key: TurnKey;
  readonly cls: CaseClass;
  readonly userAction: ClassifyContext['userAction'];
  readonly domain: ClassifyContext['domain'];
  /** Conversation context derived from the surrounding turns (load.ts), recorded so a fixture can replay it. */
  readonly context: { readonly rerunKind: RerunKind | null; readonly nextApprovalRan: boolean | null };
  readonly facets: TurnFacets;
  readonly metrics: TurnMetrics;
  readonly checks: Record<CheckName, CheckResult>;
  readonly observations: TurnObservations;
}

export interface ScoreContext extends ClassifyContext {
  readonly nextApprovalRan: boolean | null;
}

const NO_REPLY_CHECKS = (): Record<CheckName, CheckResult> =>
  Object.fromEntries(
    CHECK_NAMES.map((c) => [c, { check: c, verdict: 'NOT_DECIDABLE', reason: 'no reply body (HTTP error or empty text)', vacuous: false, findings: [] }]),
  ) as unknown as Record<CheckName, CheckResult>;

export function scoreView(v: ReplyView, key: TurnKey, ctx: ScoreContext): TurnScore {
  const cls = classify(v, ctx);
  const split = splitServerText(v);
  const final = countsOf(v.text);
  const model = countsOf(split.modelText);
  const matchers = buildOptionMatchers(v.optionLabels);
  const others = v.nodes.filter((n) => n.kind !== 'option').map((n) => n.label);
  const ran = ranAnalysisThisTurn(v);
  return {
    key,
    cls,
    userAction: ctx.userAction,
    domain: ctx.domain,
    context: { rerunKind: ctx.rerunKind ?? null, nextApprovalRan: ctx.nextApprovalRan },
    facets: {
      leaderPermitted: v.leaderClaim?.permitted ?? null,
      withheldReason: v.leaderClaim?.withheldReason ?? null,
      permittedAnalysisMode: v.permittedAnalysisMode,
      leaderMayBeNamedPrB:
        v.leaderClaim?.permitted == null || v.permittedAnalysisMode === null
          ? null
          : v.leaderClaim.permitted === true && v.permittedAnalysisMode === 'comparative_leader',
      ranAnalysis: ran,
      runBlocked: runBlockedThisTurn(v),
      robustness: v.robustnessLevel,
      nearTie: v.nearTie,
      fastPath: v.fastPath,
      exitPath: v.exitPath,
      replayed: v.replayed,
      providerCalls: v.providerCalls,
      tools: v.toolCalls.map((t) => t.name),
    },
    metrics: {
      finalWords: final.words,
      finalSentences: final.sentences,
      bullets: final.bullets,
      finalQuestions: final.questions,
      modelWordsEstimate: model.words,
      modelQuestionsEstimate: model.questions,
      splitBasis: split.basis,
      serverStatusPresent: split.serverText.trim() !== '',
      serverTextHead: split.serverText.trim() === '' ? null : split.serverText.trim().slice(0, 80),
      writeClaimsRemoved: v.writeClaimsRemoved,
      chipCount: v.chips.length,
      chipLabels: v.chips.map((c) => c.label),
    },
    checks: cls === 'no_reply' ? NO_REPLY_CHECKS() : runChecks(v, split, { cls, nextApprovalRan: ctx.nextApprovalRan }),
    observations: {
      analysisRanOnApprovalOrEdit: (cls === 'approval_chip' || cls === 'approval_typed' || cls === 'edit_no_run') && ran,
      blockSummaryNamesLeaderWhileWithheld:
        v.blockSummary === null || v.leaderClaim?.permitted !== false
          ? null
          : leaderClaimsIn(v.blockSummary, matchers, others).length > 0,
    },
  };
}

export function scoreWire(wire: unknown, http: number | null, key: TurnKey, ctx: ScoreContext): TurnScore {
  return scoreView(viewOf(wire, http), key, ctx);
}
