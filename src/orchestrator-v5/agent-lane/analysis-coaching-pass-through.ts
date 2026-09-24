/**
 * Reuse already-produced coaching only while the final readback binds the same
 * result — and, when a run completed THIS turn, add the one run-bound
 * fragile-link challenge (`coaching/fragile-link-challenge.ts`,
 * contract `run-turn-coaching/v1`).
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
  type RunTurnCoachingEligibility,
  type RunTurnTrigger,
} from '../coaching/fragile-link-challenge.js';

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
}

/**
 * The captured run IS the run the final readback shows, and that run is CURRENT
 * for the readback's graph. Null on any doubt.
 */
function bindCapturedRun(captured: CapturedAnalysis, final: RunTurnCoachingFinal): BoundRun | null {
  if (!Array.isArray(captured.blocks)) return null;
  const oldState = record(captured.analysis_state);
  const newState = record(final.analysisState);
  const oldRun = record(oldState?.run_state);
  const newRun = record(newState?.run_state);
  if (oldRun?.kind !== 'complete_current' || newRun?.kind !== 'complete_current') return null;
  const results = captured.blocks.filter((b) => record(b)?.type === 'analysis_result');
  if (results.length !== 1) return null;
  const oldResult = record(results[0]);
  const newResult = record(final.analysisResult);
  if (oldResult === undefined || newResult?.type !== 'analysis_result') return null;
  // CURRENT: the readback's result was computed against the readback's graph.
  if (typeof final.graphHash !== 'string' || newResult.computed_against_hash !== final.graphHash) return null;
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
    || oldResult.leading_option_id !== newResult.leading_option_id) return null;
  if (typeof record(oldState?.leader_claim)?.permitted !== 'boolean'
    || typeof record(newState?.leader_claim)?.permitted !== 'boolean'
    || !isDeepStrictEqual(oldState?.leader_claim, newState?.leader_claim)) return null;
  return { graphHash: final.graphHash, computedAt: identity.identity.computed_at, analysisResult: newResult };
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
 * The run turn's coaching: forwarded upstream cards plus AT MOST ONE
 * fragile-link challenge, and why the challenge is or is not there.
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
  const upstream = bound !== null ? dedupeByBlockId(forwardUpstreamCoaching(captured.blocks ?? [], bound.graphHash)) : [];
  if (!isRunTurnTrigger(captured.trigger)) {
    return { blocks: upstream, eligibility: { eligible: false, reason: 'no_run_this_turn' } };
  }
  if (bound === null) {
    return { blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' } };
  }
  // (3)–(5) grounding, claim policy, copy — the producer's gates.
  const built = buildFragileLinkChallenge({
    analysisResult: bound.analysisResult,
    graphHash: bound.graphHash,
    computedAt: bound.computedAt,
    trigger: captured.trigger,
    // run_state `complete_current` on both sides ⇔ canonical freshness `fresh`,
    // and the hash binding above held — the strictest faithful verdict here.
    freshness: 'fresh',
  });
  if (built.block === null) {
    return { blocks: upstream, eligibility: { eligible: false, reason: built.reason } };
  }
  return { blocks: dedupeByBlockId([...upstream, built.block]), eligibility: { eligible: true } };
}

/** Backwards-compatible: the blocks of {@link runTurnCoaching}. */
export function currentAnalysisCoaching(
  captured: CapturedAnalysis | undefined,
  final: RunTurnCoachingFinal,
): CoachingBlock[] {
  return runTurnCoaching(captured, final).blocks;
}
