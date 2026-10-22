/**
 * ⭐ CORE ROUTE: THE CORE TURN'S DEPENDENCIES, BUILT IN ONE PLACE (22 Oct 2026; DL: core moves to its own thin route,
 * `routes/core-turn.ts`; port, never rewrite). Moved VERBATIM from `routes/agent-v1-turn.ts`'s core branch, which now calls
 * these, so both routes give `runCoreTurn` the same tools and stores:
 *  · `coreTurnTools`: the SDK turn's typed adapters (`pathBTools`) over the route's primitives;
 *  · `coreTurnStores`: where the scenario's paused run and OpenAI Conversation id are kept;
 *  · `graphReadyEmitter`: the streamed GRAPH_READY frame for a drafted model;
 *  · `CORE_RUN_PRESS_WITHHELD`: the tools a Run press withholds.
 *  · `constructionDeadline`: when the turn's construction call must have ended.
 *  · `coreTurnCapabilities`: the legacy capabilities, built for `routes/core-turn.ts` and used there ONLY for the Run
 *    (`runAnalysis`, the existing Run pipeline and its press guard); propose_link_strengths reaches them through
 *    `dispatchTool` on a legacy scenario only, and the stress variant is `runStressVariant`'s own. Nothing else is used, so
 *    the legacy Run pipeline can be cut out later.
 * The turn's write accounting (`countingDispatch`, `capDispatch`, the fenced doors) is the route's: it is passed in.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../../config/timeouts.js';
import { currentStageEmitter } from '../../cee/unified-pipeline/stage-stream-context.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { buildAppliedGraphWireField } from '../compose/applied-graph-emit.js';
import { modelCritic } from '../agent-lane/core/model-critic.js';
import type { CoreTurnInput } from '../agent-lane/core/sdk-turn.js';
import { coreBudget } from '../agent-lane/model-budgets.js';
import { CONSTRUCTION_TAIL_RESERVE_MS } from '../agent-lane/runtime/construction-deadline.js';
import { dispatchTool, type AgentCapabilities, type AgentLaneMode, type AgentToolContext } from '../agent-lane/runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import type { RecoveredRun } from '../agent-lane/run-operation.js';
import { runStressVariant } from '../handlers/stress-variant-run.js';
import { pathBTools, type PathBToolDeps } from '../path-b/tools/index.js';
import type { OpenAiPausedRun, SessionStore } from '../session/store.js';

/** A `core` Run press permits calculation and reading only: every tool but the reader and the Run (`withheldToolsOf`). The
 *  stress test is withheld too (DL 21 Oct): a press runs and reads; typed turns still offer it, where the person asks. */
export const CORE_RUN_PRESS_WITHHELD: readonly string[] = ['build_model_from_brief', 'propose_change', 'apply_change', 'stress_test', 'offer_public_research'];

/**
 * ⛔ THE CONSTRUCTION CALL ENDS BY ITS OWN DEADLINE, AND A TIMEOUT OF IT IS NEVER RETRIED
 * (DL CHANGES_REQUIRED on #2113 @ 6aa4f3c2).
 *
 * Its only bound was the global undici Agent (`HTTP_CLIENT_TIMEOUT_MS`, 110 s headers timeout), and
 * `onceMoreOnTransportFailure` retried that timeout. At the 12000 ceiling and the measured 76–87
 * output tok/s, a call needing more than ~8.4–9.6k tokens timed out at 110 s, a SECOND paid call
 * started, the browser proxy answered 504 at 125 s, and the server could register a model at ~220 s —
 * after the user had been told the turn failed.
 *
 * The arithmetic, from this request's start (the origin `firstAnalysisDeadline` uses):
 *     browserProxyTimeoutMs          125 000   the browser gives up here
 *   − TURN_RESPONSE_HEADROOM_MS       10 000   the turn's response tail (the V5 turn budget's, as above)
 *   − CONSTRUCTION_TAIL_RESERVE_MS    15 000   what must follow a build inside the turn: registration and
 *                                              the Agent's one narrating hop (~10–15 s — the same hop
 *                                              `FIRST_ANALYSIS_RESERVE_MS` reserves)
 *   = the construction call must have ENDED by start + 100 s.
 * Its abort budget is what remains of that when it starts (a conversation hop comes first), so it is
 * always below 100 s and below the 110 s undici bound. A first analysis cannot start past its own,
 * earlier deadline and says so (`first-analysis.ts`), so it needs no reserve here.
 */
/** When the construction call must have ended, in a turn that began at `turnStartedAt`. */
export function constructionDeadline(
  turnStartedAt: number,
  proxyTimeoutMs: number = config.proxy.browserProxyTimeoutMs,
): number {
  return turnStartedAt + proxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS - CONSTRUCTION_TAIL_RESERVE_MS;
}

/**
 * The canvas's wire projection of a model graph (`buildAppliedGraphWireField`), or `undefined` for a graph with no nodes. ONE
 * projection for the streamed GRAPH_READY frame and the core turn's COMPLETE `model.graph`, so their ids are equal.
 */
export function appliedGraphWire(raw: unknown): ReturnType<typeof buildAppliedGraphWireField> | undefined {
  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).nodes)
    || ((raw as Record<string, unknown>).nodes as unknown[]).length === 0) return undefined;
  // The same single cast COMPLETE's readback makes (`after.json.graph`).
  const g = raw as GraphV3T;
  return buildAppliedGraphWireField({ ...g, edges: Array.isArray(g.edges) ? g.edges : [] });
}

/** The streamed GRAPH_READY frame for a model graph (nothing outside a streamed turn); through COMPLETE's own projection. */
export function graphReadyEmitter(startedAt: number): (raw: Record<string, unknown>) => void {
  return (raw: Record<string, unknown>): void => {
    const emitStage = currentStageEmitter();
    const graph = emitStage === undefined ? undefined : appliedGraphWire(raw);
    if (emitStage === undefined || graph === undefined) return;
    emitStage({
      kind: 'GRAPH_READY',
      graph,
      schema_version: 'v3',
      elapsed_ms: Date.now() - startedAt,
    });
  };
}

export interface CoreTurnToolsInput {
  /** The turn's tool context (the route's typed-words carrier, with any grounded selection). */
  readonly ctx: AgentToolContext;
  readonly mode: AgentLaneMode;
  /** A scenario whose meaning is its living model (or that has no model yet) changes through the living model only. */
  readonly scenario: 'core' | 'legacy';
  readonly requestId: string;
  readonly message: string;
  /** The route's counting dispatch, decorated with its held-approval writer (`capDispatch`). */
  readonly dispatch: InternalDispatch;
  readonly proposals: PathBToolDeps['proposals'];
  /** When the construction must have ended (`constructionDeadline`). */
  readonly deadlineAt: number;
  /** A Challenge on one card: this turn's note may sit only beside that card. */
  readonly noteOnlyOn?: PathBToolDeps['noteOnlyOn'];
  /** Used ONLY for propose_link_strengths, through `dispatchTool`. */
  readonly capabilities: AgentCapabilities;
  /** The batch levels door, for a legacy scenario's change adapter; a core scenario's changes never reach it. */
  readonly commitOptionLevels?: PathBToolDeps['commitOptionLevels'];
  readonly onModelRegistered: (raw: Record<string, unknown>) => void;
  /** The route's Run pipeline (a Run press's guard included). */
  readonly runAnalysis: PathBToolDeps['runAnalysis'];
  readonly analyseAfterCommit: NonNullable<PathBToolDeps['analyseAfterCommit']>;
  readonly researchShowable: NonNullable<PathBToolDeps['researchShowable']>;
  /** Told when a tool's own receipt AND its successful postimage readback establish a saved change. */
  readonly onVerifiedSave: () => void;
  /** Class 3's one offer for this turn, made by the route, which settles it at the turn's end (`goal-path.ts`). */
  readonly restructure?: PathBToolDeps['restructure'];
}

/** The SDK turn's tools: the typed adapters over the route's primitives, each call recorded once. */
export function coreTurnTools(i: CoreTurnToolsInput): CoreTurnInput['tools'] {
  return (onCall) => pathBTools({ dispatch: i.dispatch, proposals: i.proposals, critique: modelCritic(coreBudget()), deadlineAt: i.deadlineAt,
    ...(i.noteOnlyOn !== undefined ? { noteOnlyOn: i.noteOnlyOn } : {}), ...(i.restructure !== undefined ? { restructure: i.restructure } : {}),
    proposeLinkStrengths: (c, a) => dispatchTool('propose_link_strengths', JSON.stringify(a), { ...i.ctx, ...c }, i.capabilities, i.mode),
    ...(i.commitOptionLevels !== undefined ? { commitOptionLevels: i.commitOptionLevels } : {}), onModelRegistered: (raw) => i.onModelRegistered(raw),
    runAnalysis: i.runAnalysis,
    analyseAfterCommit: i.analyseAfterCommit,
    // TRACK 3: each stress variant on the one Run path, in memory, discarded (`handlers/stress-variant-run.ts`).
    // The research offer's gate: the final egress's own chip rule on this route's readback (fail closed).
    researchShowable: i.researchShowable,
    runStressVariant: (v) => runStressVariant({ ...v, requestId: `${i.requestId}:stress`,
      payload: { kind: 'message', scenario_id: i.ctx.scenario_id, turn_id: randomUUID(), stage: 'analyse', turn_class: 'decide', source: 'composer', message: i.message } }) }, i.ctx, i.mode,
    (row, result) => {
      // Only the adapter's own receipt AND successful postimage readback establish a saved change.
      if (result.ok && result.mutated && (result.receipts?.length ?? 0) > 0) i.onVerifiedSave();
      onCall(row, { ...result });
    }, i.scenario);
}

type CoreTurnStoreReaders = Pick<SessionStore, 'readOpenAiPausedRun' | 'saveOpenAiPausedRun' | 'takeOpenAiPausedRun'
  | 'readOpenAiConversationId' | 'claimOpenAiConversationId'>;

/** Where the scenario's paused run and its ONE OpenAI Conversation id are kept; absent from a store that cannot hold them. */
export function coreTurnStores(store: CoreTurnStoreReaders): Pick<CoreTurnInput, 'pausedRunStore' | 'conversationStore'> {
  return {
    // A run paused for the person's approval is saved on the scenario, so the press (any later request) resumes it.
    ...(typeof store.readOpenAiPausedRun === 'function' && typeof store.saveOpenAiPausedRun === 'function'
      && typeof store.takeOpenAiPausedRun === 'function' ? {
      pausedRunStore: {
        read: (sid: string) => store.readOpenAiPausedRun!(sid),
        save: (sid: string, run: OpenAiPausedRun) => store.saveOpenAiPausedRun!(sid, run),
        take: (sid: string, id: string) => store.takeOpenAiPausedRun!(sid, id),
      } } : {}),
    // The scenario's ONE OpenAI Conversation id is saved on the scenario, so a reopen continues it. A store without it
    // stops the turn (CoreStateUnavailableError → 503 below): never a Conversation the next turn could not find.
    ...(typeof store.readOpenAiConversationId === 'function' && typeof store.claimOpenAiConversationId === 'function' ? {
      conversationStore: {
        read: (sid: string) => store.readOpenAiConversationId!(sid),
        claim: (sid: string, id: string) => store.claimOpenAiConversationId!(sid, id),
      } } : {}),
  };
}

/**
 * The capabilities `routes/core-turn.ts` runs the Run on: the existing pipeline over the route's counting dispatch, the
 * request's own Run operation (or the restore's recorded Run) and the turn's deadline. Used for `runAnalysis` only.
 */
export function coreTurnCapabilities(dispatch: InternalDispatch, proposals: PathBToolDeps['proposals'],
  run: { readonly recoveredRun?: RecoveredRun; readonly runOperationId?: string; readonly deadlineAt: number }): AgentCapabilities {
  return createAgentCapabilities(dispatch, proposals, undefined, 'core', undefined, { turnAuthority: true, ...run });
}
