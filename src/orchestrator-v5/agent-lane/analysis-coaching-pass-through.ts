/**
 * Reuse already-produced coaching only while the final readback binds the same
 * result — and, when a run completed THIS turn, add AT MOST ONE run-bound card
 * (contract `run-turn-coaching/v1`): the limit card (`coaching/limit-unchecked-card.ts`)
 * when the readback's typed leader claim is withheld FOR A LIMIT; otherwise the
 * fragile-link challenge (`coaching/fragile-link-challenge.ts`) or, only when the
 * run has no fragile row at all, the no-flagged-link card (`coaching/no-flagged-link-card.ts`).
 *
 * The Runtime integrates with one call and one input: it hands the run response
 * to `captureAnalysis` (with the run's `trigger`), then calls
 * `runTurnCoaching(captured, final)` — or the backwards-compatible
 * `currentAnalysisCoaching`, which returns the same blocks — and appends them
 * beside the readback `analysis_result`.
 */
import { isDeepStrictEqual } from 'node:util';
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';
import { compareAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import {
  buildFragileLinkChallenge,
  isRunTurnTrigger,
  type FragileLinkChallengeInput,
  type RunTurnCoachingEligibility,
  type RunTurnTrigger,
} from '../coaching/fragile-link-challenge.js';
import { buildNoFlaggedLinkCard } from '../coaching/no-flagged-link-card.js';
import { buildLimitUncheckedCard, leaderWithheldForALimit } from '../coaching/limit-unchecked-card.js';
import { graphBoundToHash, limitNodeLabels } from '../coaching/bound-graph.js';
import { buildNearTieCard } from '../coaching/near-tie-card.js';
import { edgeAuthorshipIn } from '../coaching/edge-strength-authorship.js';
import { WITHHELD_NEAR_TIE } from '../compose/analysis-state-v1.js';
import { summaryAsksUserToRepairALimit } from '../coaching/constraint-gap-disclosure.js';

export interface CapturedAnalysis {
  scenario_id: string;
  status: number;
  analysis_state?: unknown;
  analysis_ready?: unknown;
  blocks?: unknown[];
  /** How the run that produced this capture was started. Absent ⇒ no fragile-link card. */
  trigger?: RunTurnTrigger;
}

/** The route's final readback: the one authoritative state the reply carries. */
export interface RunTurnCoachingFinal {
  scenarioId: string;
  graphHash?: string;
  analysisState?: unknown;
  analysisResult?: unknown;
  /**
   * The readback's own graph (the same `readBackState` read as the fields above). A card reads a
   * fact from it ONLY after `coaching/bound-graph.ts` proves its analysis-affecting hash is `graphHash`.
   */
  graph?: unknown;
}

export interface RunTurnCoachingResult {
  readonly blocks: CoachingBlock[];
  readonly eligibility: RunTurnCoachingEligibility;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

interface BoundRun {
  readonly graphHash: string;
  readonly computedAt: string;
  readonly analysisResult: Record<string, unknown>;
  /**
   * True only when the capture's OWN run_state and leader_claim were compared
   * with the readback's. Upstream blocks carry the CAPTURE's content, so they
   * are forwarded only on a full identity; the fragile-link card is built from
   * the READBACK, so a stateless capture may authorise it (reviewer F2).
   */
  readonly fullIdentity: boolean;
}

/**
 * The captured run IS the run the final readback shows, and that run is CURRENT
 * for the readback's graph. Null on any doubt.
 */
/** The run's option labels as its `analysis_ready.options` state them (present on automatic runs too). */
function optionLabelsFromReady(analysisReady: unknown): string[] {
  const options = record(analysisReady)?.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((o) => {
    const label = record(o)?.label;
    return typeof label === 'string' && label.trim().length > 0 ? [label] : [];
  });
}

function bindCapturedRun(captured: CapturedAnalysis, final: RunTurnCoachingFinal): BoundRun | null {
  if (!Array.isArray(captured.blocks)) return null;
  const oldState = record(captured.analysis_state);
  const newState = record(final.analysisState);
  const oldRun = record(oldState?.run_state);
  const newRun = record(newState?.run_state);
  // The READBACK is the freshness authority: its run must be complete and current.
  if (newRun?.kind !== 'complete_current') return null;
  const results = captured.blocks.filter((b) => record(b)?.type === 'analysis_result');
  if (results.length !== 1) return null;
  const oldResult = record(results[0]);
  const newResult = record(final.analysisResult);
  if (oldResult === undefined || newResult?.type !== 'analysis_result') return null;
  // CURRENT: the readback's result was computed against the readback's graph.
  if (typeof final.graphHash !== 'string' || newResult.computed_against_hash !== final.graphHash) return null;
  /**
   * ⭐ A CAPTURE WITH NO `analysis_state` AT ALL (reviewer F2). A run response
   * that states no run_state cannot contradict the readback, so it binds on
   * what it DOES state: its one result, computed against the readback's graph,
   * with the same leader designation — and the readback's own complete_current
   * run and leader_claim govern. A capture that states a run_state which
   * disagrees still refuses below (`oldRun.kind` must be complete_current).
   * Without this, a first-pass runner that hands over the result without the
   * finaliser's state would leave the first experience blank.
   */
  if (captured.analysis_state === undefined) {
    if (oldResult.computed_against_hash !== final.graphHash) return null;
    if (!Object.hasOwn(oldResult, 'leading_option_id') || !Object.hasOwn(newResult, 'leading_option_id')
      || oldResult.leading_option_id !== newResult.leading_option_id) return null;
    if (typeof record(newState?.leader_claim)?.permitted !== 'boolean') return null;
    if (typeof newRun.computed_at !== 'string' || newRun.computed_at.length === 0) return null;
    if (captured.scenario_id !== final.scenarioId) return null;
    return { graphHash: final.graphHash, computedAt: newRun.computed_at, analysisResult: asTheGateLeavesIt(newResult, newState), fullIdentity: false };
  }
  if (oldRun?.kind !== 'complete_current') return null;
  // SAME RUN: the captured run and the readback's run share scenario, hash and time.
  const identity = compareAnalysisRunFactIdentity(
    { scenario_id: captured.scenario_id, graph_hash_at_run: oldResult.computed_against_hash, computed_at: oldRun.computed_at },
    { scenario_id: final.scenarioId, graph_hash_at_run: newResult.computed_against_hash, computed_at: newRun.computed_at },
  );
  // Bind the persisted run and its leader designation, not its display text.
  // The finaliser sanitises enrichment, and the canonical read rebuilds a
  // provisional summary without readiness; neither difference is a new run.
  if (identity.status !== 'match') return null;
  if (!Object.hasOwn(oldResult, 'leading_option_id') || !Object.hasOwn(newResult, 'leading_option_id')
    || !sameLeaderDesignation(oldResult.leading_option_id, newResult.leading_option_id, record(newState?.leader_claim))) return null;
  if (typeof record(oldState?.leader_claim)?.permitted !== 'boolean'
    || typeof record(newState?.leader_claim)?.permitted !== 'boolean'
    || !isDeepStrictEqual(oldState?.leader_claim, newState?.leader_claim)) return null;
  return { graphHash: final.graphHash, computedAt: identity.identity.computed_at, analysisResult: asTheGateLeavesIt(newResult, newState), fullIdentity: true };
}

/**
 * ONE run's leader designation, compared as the two sides actually carry it. The run
 * response passes the v2 send-point gate, which nulls `leading_option_id` whenever the
 * claim is WITHHELD (leading-option-wire-enforcement.ts:659-670); the graph read builds
 * its block from entitlement alone and keeps the fact's id (compose.ts:1275,1348). So an
 * entitled near tie reads null vs "<id>" for the same run — served 25 Sep on CEE 7f9a16d,
 * where the hiring Run got no card (`identity_mismatch`). Accept exactly that edit, and
 * only for a NEAR TIE — the one withheld reason where entitlement holds and only the
 * separation half declined. A constraint-withheld claim nulls BOTH sides (no entitlement),
 * and the "not evaluated" reasons carry no verdict, so any difference there still refuses.
 */
function sameLeaderDesignation(captured: unknown, readback: unknown, claim: Record<string, unknown> | undefined): boolean {
  if (captured === readback) return true;
  return claim?.permitted === false && claim.withheld_reason === WITHHELD_NEAR_TIE
    && captured === null && typeof readback === 'string';
}

/**
 * The readback result with the designation the user is actually shown: under a withheld
 * claim the builders must not read the ungated id (the DSK-P-003 badge asserts a clear
 * winner from it — fragile-link-challenge.ts `runShowsClearWinnerForP003`).
 */
function asTheGateLeavesIt(result: Record<string, unknown>, state: Record<string, unknown> | undefined): Record<string, unknown> {
  if (record(state?.leader_claim)?.permitted === true || typeof result.leading_option_id !== 'string') return result;
  return { ...result, leading_option_id: null };
}

/**
 * Upstream deterministic coaching bound to this hash, verbatim. `strengthen` is
 * NOT forwarded: it is leader-premised, and its fragile-edge action has no
 * agent executor on this lane.
 */
function forwardUpstreamCoaching(blocks: readonly unknown[], graphHash: string): CoachingBlock[] {
  return blocks.flatMap((raw) => {
    const block = record(raw);
    if (block?.type !== 'coaching' || block.source !== 'deterministic_signal'
      || block.freshness !== 'fresh' || block.graph_hash_at_generation !== graphHash
      || block.coaching_kind === 'strengthen') return [];
    const parsed = CoachingBlockSchema.safeParse(raw);
    if (!parsed.success) return [];
    // Preserve producer provenance, target refs and action label/prompt verbatim.
    // Never forward upstream suggested_actions or another analysis_result.
    return [raw as CoachingBlock];
  });
}

function dedupeByBlockId(blocks: readonly CoachingBlock[]): CoachingBlock[] {
  const seen = new Set<string>();
  return blocks.filter((b) => (seen.has(b.block_id) ? false : (seen.add(b.block_id), true)));
}

/**
 * The run turn's coaching: forwarded upstream cards plus AT MOST ONE run-turn
 * card, and why it is or is not there. A run whose leader is withheld FOR A
 * LIMIT gets the limit card and never a link card (one next action; Paul's
 * manual test 1a298d6d). Otherwise the no-flagged-link card is tried ONLY
 * when the fragile-link challenge found no groundable fragile edge, and it
 * refuses itself whenever any fragile row exists, so the two exclude each other.
 * `eligibility` is `{ eligible: true }` for any card; the card type is read
 * from the signal_id prefix.
 */
export function runTurnCoaching(
  captured: CapturedAnalysis | undefined,
  final: RunTurnCoachingFinal,
): RunTurnCoachingResult {
  // (1) a run response was handed over THIS turn, and it succeeded.
  if (captured === undefined || captured.status !== 200) {
    return { blocks: [], eligibility: { eligible: false, reason: 'no_run_this_turn' } };
  }
  // (2) it is the run the readback shows, current for the readback's graph.
  const bound = bindCapturedRun(captured, final);
  const upstream = bound !== null && bound.fullIdentity
    ? dedupeByBlockId(forwardUpstreamCoaching(captured.blocks ?? [], bound.graphHash))
    : [];
  if (!isRunTurnTrigger(captured.trigger)) {
    return { blocks: upstream, eligibility: { eligible: false, reason: 'no_run_this_turn' } };
  }
  if (bound === null) {
    return { blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' } };
  }
  // (2b) ONE next action: when the run's own summary asks the user to repair a
  // limit, that step IS the turn's next action; no run-turn card competes with it.
  if (summaryAsksUserToRepairALimit(bound.analysisResult.summary)) {
    return { blocks: upstream, eligibility: { eligible: false, reason: 'limit_repair_pending' } };
  }
  // The run's own graph, only when its analysis-affecting hash is the bound run's.
  const boundGraph = graphBoundToHash(final.graph, bound.graphHash);
  // (3)–(5) grounding, claim policy, copy — the producer's gates.
  const input: FragileLinkChallengeInput = {
    analysisResult: bound.analysisResult,
    graphHash: bound.graphHash,
    computedAt: bound.computedAt,
    trigger: captured.trigger,
    // The readback's run_state is `complete_current` (⇔ canonical freshness
    // `fresh`) and the hash binding above held — the strictest faithful verdict here.
    freshness: 'fresh',
    optionLabels: optionLabelsFromReady(captured.analysis_ready),
    edgeAuthorship: edgeAuthorshipIn(boundGraph),
  };
  // (2c) ONE next action, TYPED: when the READBACK's leader claim is withheld for
  // a limit, the limit is the decisive caveat — the limit card is the turn's one
  // card and no link card competes with it. Read from the typed claim, never the
  // summary: the automatic first pass replaces the prose (unrequested-analysis-
  // confinement.ts), so the prose gate above is blind there. A refused limit card
  // fails CLOSED (no card), never back to a link card.
  if (leaderWithheldForALimit(final.analysisState)) {
    const limitLabels = boundGraph !== null ? limitNodeLabels(boundGraph) ?? undefined : undefined;
    const limit = buildLimitUncheckedCard(input, limitLabels);
    if (limit.block === null) return { blocks: upstream, eligibility: { eligible: false, reason: limit.reason } };
    return { blocks: dedupeByBlockId([...upstream, limit.block]), eligibility: { eligible: true } };
  }
  const built = buildFragileLinkChallenge(input);
  const chosen = built.block === null && built.reason === 'no_groundable_fragile_edge'
    ? buildNoFlaggedLinkCard(input)
    : built;
  if (chosen.block === null) {
    // (2d) The automatic first pass of a NEAR TIE with no flagged link (AI Quality 5841805590): no link
    // card can speak, so the one move is to ask which difference matters most. Its own gates decide;
    // when it declines, the link path's reason stands.
    const readyOptions = record(captured.analysis_ready)?.options;
    const tie = buildNearTieCard(input, record(record(final.analysisState)?.leader_claim)?.withheld_reason,
      Array.isArray(readyOptions) ? readyOptions.length : null);
    if (tie.block !== null) return { blocks: dedupeByBlockId([...upstream, tie.block]), eligibility: { eligible: true } };
    return { blocks: upstream, eligibility: { eligible: false, reason: chosen.reason } };
  }
  return { blocks: dedupeByBlockId([...upstream, chosen.block]), eligibility: { eligible: true } };
}

/** Backwards-compatible: the blocks of {@link runTurnCoaching}. */
export function currentAnalysisCoaching(
  captured: CapturedAnalysis | undefined,
  final: RunTurnCoachingFinal,
): CoachingBlock[] {
  return runTurnCoaching(captured, final).blocks;
}
