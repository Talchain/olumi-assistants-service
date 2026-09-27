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
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';
import { compareAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import {
  isRunTurnTrigger,
  type FragileLinkChallengeInput,
  type RunTurnCoachingEligibility,
  type RunTurnTrigger,
} from '../coaching/fragile-link-challenge.js';
import { graphBoundToHash } from '../coaching/bound-graph.js';
import { selectNextMove, type NextMove, type NextMoveCaveat } from '../coaching/next-move.js';
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
  /** The run turn's own run-over-run consequence block, as its finaliser stamped it (absent on a turn that has none). */
  run_delta?: unknown;
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
  /**
   * The selected run's own constraint verdict state, from the SAME graph read (`readBackState`
   * `constraintVerdictState`, CEE #1958: bound to the fact `analysisResult` came from). `null` = not recorded.
   * Never derived here from `withheld_reason`.
   */
  constraintVerdictState?: string | null;
  /**
   * The `LeaderLimitRisk[]` for the SAME fact, read at graph-read time where the full PLoT body exists
   * (`readLeaderLimitRisksFromResult`, constraint-feasibility.ts #1960; carried as `analysis_leader_limit_risks` by
   * Canonical's graph read, 5843920234). The readback's `analysis_result` is the transport block, which has no
   * `constraint_results`, so the predicate cannot run here. Absent → the leader-limit-risk leg is inert.
   */
  leaderLimitRisks?: unknown;
}

export interface RunTurnCoachingResult {
  readonly blocks: CoachingBlock[];
  readonly eligibility: RunTurnCoachingEligibility;
}

/** C4 (`runTurnNextMove`): the same blocks and eligibility, plus the typed move, its caveats and the science brief. */
export interface RunTurnNextMoveResult extends RunTurnCoachingResult {
  /** The run's one typed next move (its block is the run-turn card in `blocks`). Null when a bound run has none. */
  readonly nextMove: NextMove | null;
  /** What the reply must say once and never spend as the move (a limit unchecked for a cause the user cannot close). */
  readonly caveats: readonly NextMoveCaveat[];
  /** The ≤1k science brief Runtime's lean TurnContext carries in place of the raw result (5855043957); null unbound. */
  readonly scienceBrief: ScienceBrief | null;
}

/**
 * ⭐ C4 — THE SCIENCE BRIEF (Runtime hook, #70 5855043957), in place of the raw `analysis_result` JSON the Agent
 * re-derives from today (P3C C5). It carries ONLY what AI Quality ruled coach-safe on Paul's runs (5855170731): the
 * move, the caveats, and whether the leader is withheld and why. No engine number: none is coach-safe today, and the
 * "no single assumption" line is structural in the additive engine, so `decision_sensitivity` is not carried.
 */
export interface ScienceBrief {
  readonly next_move: {
    readonly kind: NextMove['kind'];
    readonly capability: string;
    readonly target_ids: readonly string[];
    readonly title: string;
    readonly body: string;
    readonly action_label: string | null;
  } | null;
  readonly caveats: readonly { readonly title: string; readonly body: string }[];
  /** The READBACK's typed leader claim: may the leader be named, and if not, the typed reason. */
  readonly leader: { readonly may_be_named: boolean; readonly withheld_reason: string | null };
}

export function scienceBriefOf(
  nextMove: NextMove | null,
  caveats: readonly NextMoveCaveat[],
  analysisState: unknown,
): ScienceBrief {
  const claim = record(record(analysisState)?.leader_claim);
  return {
    next_move: nextMove === null ? null : {
      kind: nextMove.kind,
      capability: nextMove.capability,
      target_ids: nextMove.target_ids,
      title: nextMove.block.title,
      body: nextMove.block.body,
      action_label: nextMove.block.action_label ?? null,
    },
    caveats: caveats.map((c) => ({ title: c.block.title, body: c.block.body })),
    leader: {
      // Fail closed: only an explicit `permitted: true` names the leader.
      may_be_named: claim?.permitted === true,
      withheld_reason: typeof claim?.withheld_reason === 'string' ? claim.withheld_reason : null,
    },
  };
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
 * ⭐ WHAT CHANGED SINCE THE LAST RUN, on the Agent route (DL #70 5849261529). The Agent's Run is the conventional run
 * turn, whose finaliser builds `run_delta` from the post-dispatch fact window and states the producer's refusal as
 * `analysis_ready.run_delta_absence_reason`. Both are that turn's own words, carried here and never re-derived — and
 * ONLY when the run they describe IS the run the response shows, under the same leader claim the delta was built
 * under (`bindCapturedRun`, full identity). A newer run, another graph, or any doubt carries neither.
 */
export function runDeltaBoundToReadback(
  captured: CapturedAnalysis | undefined,
  final: RunTurnCoachingFinal,
): { run_delta?: unknown; run_delta_absence_reason?: string } {
  if (captured === undefined || captured.status !== 200) return {};
  if (bindCapturedRun(captured, final)?.fullIdentity !== true) return {};
  const reason = record(captured.analysis_ready)?.run_delta_absence_reason;
  return {
    ...(record(captured.run_delta) !== undefined ? { run_delta: captured.run_delta } : {}),
    ...(typeof reason === 'string' && reason !== '' ? { run_delta_absence_reason: reason } : {}),
  };
}

/**
 * The bound block onto the response, as the conventional finaliser puts it there: `run_delta` at the top level, and
 * the refusal reason inside the response's OWN `analysis_ready` (the readback's, stamped), never a fabricated carrier.
 */
export function withRunDelta<T extends Record<string, unknown>>(
  body: T,
  bound: { run_delta?: unknown; run_delta_absence_reason?: string },
): T {
  const carrier = record(body.analysis_ready);
  return {
    ...body,
    ...(bound.run_delta !== undefined ? { run_delta: bound.run_delta } : {}),
    ...(bound.run_delta_absence_reason !== undefined && carrier !== undefined
      ? { analysis_ready: { ...carrier, run_delta_absence_reason: bound.run_delta_absence_reason } }
      : {}),
  };
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
  // ⭐ THE PERMISSION, NOT THE REASON STRING (AX2, DL #70 5850777104; R&C 5850798620). The Run response's claim is the
  // V5 finaliser's, whose C46 cause is caller-stated and stated by no route-v2 caller, so on a product brief it reads
  // `constraint_verdict_withheld`; the graph read judges the SAME fact on the graph the run analysed and names
  // `nonlinear_identity_sign_unproven`. Deep equality dropped the card on every such explicit Run (served
  // f-20260926T225029Z/04,/09: identity_mismatch; every Run reading the constraint token kept it). The run's identity
  // is decided above (scenario, hash, time); the card reads the permission and the designation, so those bind.
  const oldPermitted = record(oldState?.leader_claim)?.permitted;
  const newPermitted = record(newState?.leader_claim)?.permitted;
  if (typeof oldPermitted !== 'boolean' || typeof newPermitted !== 'boolean' || oldPermitted !== newPermitted) return null;
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
  const { blocks, eligibility } = runTurnNextMove(captured, final);
  return { blocks, eligibility };
}

/** {@link runTurnCoaching}, plus the C4 move, its caveats and the science brief (Runtime's C1 hook). Total. */
export function runTurnNextMove(
  captured: CapturedAnalysis | undefined,
  final: RunTurnCoachingFinal,
): RunTurnNextMoveResult {
  const none = { nextMove: null, caveats: [], scienceBrief: null } as const;
  // (1) a run response was handed over THIS turn, and it succeeded.
  if (captured === undefined || captured.status !== 200) {
    return { blocks: [], eligibility: { eligible: false, reason: 'no_run_this_turn' }, ...none };
  }
  // (2) it is the run the readback shows, current for the readback's graph.
  const bound = bindCapturedRun(captured, final);
  const upstream = bound !== null && bound.fullIdentity
    ? dedupeByBlockId(forwardUpstreamCoaching(captured.blocks ?? [], bound.graphHash))
    : [];
  if (!isRunTurnTrigger(captured.trigger)) {
    return { blocks: upstream, eligibility: { eligible: false, reason: 'no_run_this_turn' }, ...none };
  }
  if (bound === null) {
    return { blocks: [], eligibility: { eligible: false, reason: 'identity_mismatch' }, ...none };
  }
  // (2b) ONE next action: when the run's own summary asks the user to repair a
  // limit, that step IS the turn's next action; no run-turn card competes with it.
  if (summaryAsksUserToRepairALimit(bound.analysisResult.summary)) {
    return { blocks: upstream, eligibility: { eligible: false, reason: 'limit_repair_pending' }, ...none };
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
  // (2b')–(2d) ONE next move, chosen by what it lets the user do (C4, `coaching/next-move.ts`): the card IS the move;
  // a limit the user cannot close is a caveat for the reply, never the move.
  const selection = selectNextMove({
    input,
    analysisReady: captured.analysis_ready,
    analysisState: final.analysisState,
    constraintVerdictState: final.constraintVerdictState,
    leaderLimitRisks: final.leaderLimitRisks,
    boundGraph,
  });
  const scienceBrief = scienceBriefOf(selection.move, selection.caveats, final.analysisState);
  if (selection.move === null) {
    return {
      blocks: upstream,
      eligibility: { eligible: false, reason: selection.reason ?? 'no_groundable_fragile_edge' },
      nextMove: null,
      caveats: selection.caveats,
      scienceBrief,
    };
  }
  return {
    blocks: dedupeByBlockId([...upstream, selection.move.block]),
    eligibility: { eligible: true },
    nextMove: selection.move,
    caveats: selection.caveats,
    scienceBrief,
  };
}

/** Backwards-compatible: the blocks of {@link runTurnCoaching}. */
export function currentAnalysisCoaching(
  captured: CapturedAnalysis | undefined,
  final: RunTurnCoachingFinal,
): CoachingBlock[] {
  return runTurnCoaching(captured, final).blocks;
}
