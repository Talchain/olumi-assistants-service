/**
 * ⭐ THE AGENT LANE'S AUTOMATIC FIRST ANALYSIS — run ONCE, by Olumi, on the model the Agent just built.
 *
 * Paul's ruling (5812069638): a brief should land on a model WITH a provisional first analysis, the
 * same promise the Conventional lane's post-draft auto-run keeps (`handlers/auto-run-after-draft.ts`).
 * The rules this module enforces, in order, and nothing else:
 *
 *   1. ADMISSION. It fires iff `resolveRunAdmission(revision).willProceed` — the one run authority the
 *      readiness panel and the run path share. A model that cannot run gets NO PLoT call and one
 *      sentence naming what is missing (`firstAnalysisSentence`), never a silent skip.
 *   2. DEADLINE. The build and the run share one ~125 s browser-proxy budget. The dispatcher takes no
 *      external abort signal, so the guard acts BEFORE the start: past the deadline it skips and says so.
 *   3. DEFENCE IN DEPTH. The caller only fires this when the construction committed IN THIS REQUEST
 *      (`built.mutated === true && built.replayed !== true`, see `buildModelFromBrief`). Beneath that, a
 *      persisted run fact for exactly (construction turn K, revision H) suppresses a second run.
 *   4. THE ONE RUN ORCHESTRATION. `dispatchChipClickRunAnalysis` in-process — the SAME
 *      buildTurnContext → run_analysis handler → PLoT → commit chain the Run chip executes — with the
 *      Agent's chip id, so the legacy decision_review (an Anthropic call) stays off.
 *
 * ⛔ AN EXPLICIT RUN NEVER COMES HERE. The typed Run chip (fast path 3) and the Agent's own
 * `run_analysis` go through `/orchestrate/v2/turn` and never read K. Asking for the analysis again is
 * an operation the user made, and nothing may suppress it.
 *
 * It never throws: every failure is an outcome the route can say out loud.
 */
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { config } from '../../config/index.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../../config/timeouts.js';
import { log } from '../../utils/telemetry.js';
import { resolveRunAdmission } from '../tools/handlers/analysis-ready-core.js';
import { loadPriorFactsWithReadState } from '../build-turn-context.js';
import { dispatchChipClickRunAnalysis, type ChipClickAutoRunTrigger } from '../handlers/chip-click-dispatch.js';
import { AGENT_RUN_ANALYSIS_CHIP_ID } from '../handlers/agent-chip-ids.js';
import { RUN_PROVENANCE_ENRICHMENT_KEY } from '../context/run-initiator.js';
import { permittedAnalysisModeFromAnalysisReady } from '../admission/analysis-admission.js';

/**
 * What must remain of the turn budget for a first analysis to START: a worst-case run (~20 s: PLoT
 * measured 13.3-19.4 s on the Agent lane's own runs) plus the Agent's one narrating hop (~10-15 s).
 */
export const FIRST_ANALYSIS_RESERVE_MS = 35_000;

/** The run turn's wire message. The dispatcher stores NO user message for it (the user typed nothing). */
export const FIRST_ANALYSIS_TURN_MESSAGE = 'Run a provisional first analysis of the model just built.';

/**
 * ⭐ THE ONE PLACE THE PROVENANCE TRIGGER IS CHOSEN.
 *
 * ✅ SWITCHED to `{ constructionTurnId }` → `initiated_by: 'auto_post_construction'` once the typed
 * marker landed (#1857: `run-initiator.ts` + `chip-click-dispatch.ts`, schemas 0.58.0). The persisted
 * fact now names the right initiator, and `hasUserSeenRunAnalysisResult` treats it as SEEN (it was
 * delivered in the user's own build response), so the next explicit Run is narrated as a re-run —
 * comparison-free against this confined prior (#1857's coaching guard). The fallback's history:
 *
 * ⚠ WAS A FALLBACK, DELIBERATELY. The right trigger is a `{ constructionTurnId }` initiator
 * (`auto_post_construction`), which needs `run-initiator.ts` and `chip-click-dispatch.ts` — files
 * owned by another lane, with consent pending on #63. Until that lands the existing post-draft
 * trigger carries K in its `draft_turn_id` slot. That is honest about WHAT happened (the server
 * started this run; the user did not ask for it) and it costs two things, both accepted:
 *   1. THE INITIATOR IS MISNAMED: the persisted fact says `initiated_by: 'auto_post_draft'` for a run
 *      that followed an Agent construction, not a Conventional draft.
 *   2. THE NEXT RUN NARRATES AS THE FIRST: `hasUserSeenRunAnalysisResult` treats an `auto_post_draft`
 *      fact as unseen, so the user's next explicit Run takes the FIRST-analysis coaching arm and loses
 *      the "what changed since the last run" delta — although this result WAS delivered in the user's
 *      own response.
 * The switch is this one line (`return { constructionTurnId }`); `recordsFirstAnalysisOf` already
 * reads both spellings.
 */
export function firstAnalysisAutoRunTrigger(constructionTurnId: string): ChipClickAutoRunTrigger {
  return { constructionTurnId };
}

/** When a first analysis may no longer START in a turn that began at `turnStartedAt`. */
export function firstAnalysisDeadline(
  turnStartedAt: number,
  proxyTimeoutMs: number = config.proxy.browserProxyTimeoutMs,
): number {
  return turnStartedAt + proxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS - FIRST_ANALYSIS_RESERVE_MS;
}

/**
 * Does this persisted fact record the first analysis of construction K on revision H?
 *
 * Bound by IDENTITY on both halves: a fact for another revision, another construction, or a
 * user-initiated run (no provenance) never suppresses one. Reads the fallback's `draft_turn_id` slot
 * AND the future `construction_turn_id`, so switching the trigger needs no second edit here. K is a
 * `graph_registration:`-prefixed id, so it cannot collide with a real draft turn's UUID.
 */
export function recordsFirstAnalysisOf(fact: HandlerFact, constructionTurnId: string, revisionHash: string): boolean {
  if (fact.fact_type !== 'run_analysis') return false;
  const result = fact.result as { graph_hash_at_run?: unknown; enrichment?: Record<string, unknown> };
  if (result.graph_hash_at_run !== revisionHash) return false;
  const provenance = result.enrichment?.[RUN_PROVENANCE_ENRICHMENT_KEY];
  if (provenance === null || typeof provenance !== 'object') return false;
  const p = provenance as { construction_turn_id?: unknown; draft_turn_id?: unknown };
  return p.construction_turn_id === constructionTurnId || p.draft_turn_id === constructionTurnId;
}

export type FirstAnalysisOutcome =
  | { readonly ran: true; readonly runTurnId: string; readonly blocks: readonly unknown[]; readonly analysisReady?: unknown }
  | { readonly ran: false; readonly reason: 'not_admissible'; readonly nextStep: string }
  | { readonly ran: false; readonly reason: 'no_time' }
  | { readonly ran: false; readonly reason: 'already_ran_for_construction' }
  | { readonly ran: false; readonly reason: 'refused'; readonly nextStep: string; readonly runTurnId: string }
  | { readonly ran: false; readonly reason: 'failed'; readonly dispatchOutcome: string };

/** What the construction hands the runner: the committed revision and its identity. */
export interface FirstAnalysisInput {
  readonly scenarioId: string;
  /** K — `registrationTurnId(scenario, constructionOperationId(scenario, brief))`. */
  readonly constructionTurnId: string;
  /** The persisted graph as read back after the construction. */
  readonly revisionGraph: unknown;
  /** H — the analysis-affecting hash of that read, the family `graph_hash_at_run` is in. */
  readonly revisionHash: string;
  readonly requestId: string;
}

export interface FirstAnalysisParams extends FirstAnalysisInput {
  readonly deadlineAt: number;
  /** Called immediately before the run is dispatched — the route counts it as a write. */
  readonly onDispatch?: () => void;
  /** Test seam — production uses the one chip-click run orchestration. */
  readonly dispatchRunAnalysis?: typeof dispatchChipClickRunAnalysis;
  /** Test seam — production uses the one observational prior-facts read. */
  readonly readPriorFacts?: typeof loadPriorFactsWithReadState;
}

const hasAnalysisResult = (blocks: readonly unknown[]): boolean =>
  blocks.some((b) => (b as { type?: unknown } | null)?.type === 'analysis_result');

export async function runFirstAnalysisAfterConstruction(params: FirstAnalysisParams): Promise<FirstAnalysisOutcome> {
  const dispatchRunAnalysis = params.dispatchRunAnalysis ?? dispatchChipClickRunAnalysis;
  const readPriorFacts = params.readPriorFacts ?? loadPriorFactsWithReadState;
  const logBase = { request_id: params.requestId, scenario_id: params.scenarioId, construction_turn_id: params.constructionTurnId };
  try {
    // 1. Admission — the real predicate, deliberately not injectable.
    const admission = resolveRunAdmission(params.revisionGraph);
    if (!admission.willProceed) {
      return { ran: false, reason: 'not_admissible', nextStep: admission.blockedNextStep ?? '' };
    }
    // 2. Deadline — decided before anything starts; the dispatch cannot be aborted from here.
    if (Date.now() > params.deadlineAt) return { ran: false, reason: 'no_time' };
    // 3. (K, H) — a degraded read proceeds: a duplicate is the cheap harm, no result the expensive one.
    const prior = await readPriorFacts(params.scenarioId, params.requestId);
    if (prior.status === 'ok' && prior.facts.some((f) => recordsFirstAnalysisOf(f, params.constructionTurnId, params.revisionHash))) {
      return { ran: false, reason: 'already_ran_for_construction' };
    }
    // 4. The ONE run orchestration, as a new server-initiated turn.
    const payload: MessageTurnPayload = {
      kind: 'message',
      scenario_id: params.scenarioId,
      turn_id: randomUUID(),
      stage: 'analyse',
      turn_class: 'decide',
      source: 'chip_click',
      message: FIRST_ANALYSIS_TURN_MESSAGE,
      chip: { id: AGENT_RUN_ANALYSIS_CHIP_ID, action_type: 'run_analysis' },
    };
    params.onDispatch?.();
    const result = await dispatchRunAnalysis({
      payload,
      requestId: `${params.requestId}:first-analysis`,
      autoRun: firstAnalysisAutoRunTrigger(params.constructionTurnId),
    });
    const response = result.response as { blocks?: unknown; assistant_text?: unknown } | undefined;
    const blocks = Array.isArray(response?.blocks) ? (response.blocks as readonly unknown[]) : [];
    if (result.outcome === 'ok' && hasAnalysisResult(blocks)) {
      return { ran: true, runTurnId: payload.turn_id, blocks, ...(result.analysisReady !== undefined ? { analysisReady: result.analysisReady } : {}) };
    }
    if (result.outcome === 'ok' || result.outcome === 'handler_recovered') {
      // The dispatcher's own admission is the authority: it answered, and did not produce a result.
      // Only a RECOVERED refusal's words say what is missing; an `ok` receipt opens with the auto-run
      // disclosure ("I ran a first analysis…") and must never be quoted as the reason it did not run.
      const said = result.outcome === 'handler_recovered' && typeof response?.assistant_text === 'string'
        ? response.assistant_text.trim()
        : '';
      return { ran: false, reason: 'refused', nextStep: said, runTurnId: payload.turn_id };
    }
    return { ran: false, reason: 'failed', dispatchOutcome: result.outcome };
  } catch (err) {
    log.warn({ ...logBase, err: err instanceof Error ? err.message : String(err) }, 'agent-lane: first analysis failed — the model stands, the user is told and offered Run');
    return { ran: false, reason: 'failed', dispatchOutcome: 'threw' };
  }
}

/**
 * The ONE sentence Olumi (not the Agent) says when the first analysis did not run. `null` when it ran,
 * or when an analysis of this exact revision already exists. Never names a remedy that is not a
 * control on screen: the Run chip and the next-step chip are offered by the route beside it.
 */
export function firstAnalysisSentence(outcome: FirstAnalysisOutcome): string | null {
  if (outcome.ran) return null;
  const withStop = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
  switch (outcome.reason) {
    case 'not_admissible':
    case 'refused':
      return outcome.nextStep.trim() !== ''
        ? `The first analysis could not run yet: ${withStop(outcome.nextStep.trim())}`
        : 'The first analysis could not run yet, because the model is not complete enough to compare its options.';
    case 'no_time':
      return 'Building the model used most of this turn, so the first analysis has not run yet.';
    case 'failed':
      return 'The first analysis could not be completed this time; nothing in the model was changed.';
    case 'already_ran_for_construction':
      return null;
  }
}

/** The typed leader permission, as the Agent is given it. Absent is never permission. */
export interface ClaimPermissions {
  readonly leader_may_be_named: boolean;
  readonly withheld_reason?: string;
  readonly permitted_analysis_mode: string | null;
}

/**
 * `leader_claim.permitted` CONJOINED with `permitted_analysis_mode === 'comparative_leader'` — the
 * conjunction the admission's own consumer note prescribes. Read, never re-derived: both halves come
 * from the canonical producers' published verdicts.
 */
export function claimPermissionsFrom(analysisState: unknown, analysisReady: unknown): ClaimPermissions {
  const claim = (analysisState as { leader_claim?: { permitted?: unknown; withheld_reason?: unknown } } | null | undefined)?.leader_claim;
  const mode = permittedAnalysisModeFromAnalysisReady(analysisReady);
  return {
    leader_may_be_named: claim?.permitted === true && mode === 'comparative_leader',
    ...(typeof claim?.withheld_reason === 'string' && claim.withheld_reason !== '' ? { withheld_reason: claim.withheld_reason } : {}),
    permitted_analysis_mode: mode,
  };
}

/** The Phase 3 blocks a run may carry to the user. `ui_directive` and the run's own result are not among them. */
const COACHING_BLOCK_TYPES: ReadonlySet<string> = new Set(['review_card', 'coaching', 'evidence', 'exercise']);

/**
 * ⛔ A RUN'S COACHING IS SHOWN ONLY BESIDE THE RESULT IT CAME FROM.
 *
 * The readback is the authority for what the response shows (`readBackState`): its `analysis_result` is
 * present only on a fresh verdict for the current graph. A coaching block is included only when it was
 * generated against THAT revision (`graph_hash_at_generation === readback graph_hash`), the readback
 * carries a result, and the run state is `complete_current`. An action-bearing block additionally needs
 * `usable_for_chips`. Nothing is manufactured: a block the run did not produce cannot appear.
 */
export function bindRunBlocksToReadback(
  runBlocks: readonly unknown[],
  readback: { readonly graphHash: string | undefined; readonly analysisState: unknown; readonly analysisResult: unknown },
): unknown[] {
  if (readback.graphHash === undefined || readback.analysisResult === undefined) return [];
  const state = readback.analysisState as { run_state?: { kind?: unknown }; usable_for_chips?: unknown } | undefined;
  if (state?.run_state?.kind !== 'complete_current') return [];
  const chipsUsable = state.usable_for_chips === true;
  return runBlocks.filter((b) => {
    const block = b as { type?: unknown; graph_hash_at_generation?: unknown; action_intent?: unknown; action_label?: unknown; action_prompt?: unknown } | null;
    if (block === null || typeof block !== 'object' || typeof block.type !== 'string') return false;
    if (!COACHING_BLOCK_TYPES.has(block.type)) return false;
    if (block.graph_hash_at_generation !== readback.graphHash) return false;
    const actionBearing = block.action_intent !== undefined || block.action_label !== undefined || block.action_prompt !== undefined;
    return !actionBearing || chipsUsable;
  });
}

/**
 * What the Agent is told about the first analysis, in the build result it narrates from. Compact on
 * purpose: the full payload reaches the user through the response's blocks, not the model's context.
 * `summary` is the READBACK's (the confined, user-facing one), never the run's own receipt, which has
 * not passed the wire's claim gates.
 */
export function describeFirstAnalysisForAgent(
  outcome: FirstAnalysisOutcome,
  after: { readonly analysisState: unknown; readonly analysisResult: unknown; readonly analysisAdmission: unknown },
): Record<string, unknown> {
  const permissions = claimPermissionsFrom(after.analysisState, { analysis_admission: after.analysisAdmission });
  const summary = (after.analysisResult as { summary?: unknown } | undefined)?.summary;
  const summaryField = typeof summary === 'string' && summary !== '' ? { summary } : {};
  if (outcome.ran) {
    return {
      ran: true,
      provisional: true,
      ...summaryField,
      claim_permissions: permissions,
      note: 'Olumi ran this first analysis itself, on the model just built. Nobody has confirmed any of it yet: '
        + 'describe it as a provisional first pass to argue with, not an answer.',
    };
  }
  if (outcome.reason === 'already_ran_for_construction') {
    return {
      ran: false,
      reason: outcome.reason,
      provisional: true,
      ...summaryField,
      claim_permissions: permissions,
      note: 'Olumi already ran the first analysis of exactly this model, so it was not run twice. '
        + 'Describe it as a provisional first pass to argue with, not an answer.',
    };
  }
  return {
    ran: false,
    reason: outcome.reason,
    ...(outcome.reason === 'not_admissible' || outcome.reason === 'refused' ? { next_step: outcome.nextStep } : {}),
    claim_permissions: permissions,
    note: 'No analysis ran on this turn. Olumi tells the user why beneath your reply; do not describe any result.',
  };
}
