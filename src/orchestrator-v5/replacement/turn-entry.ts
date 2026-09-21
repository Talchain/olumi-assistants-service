/**
 * Replacement conversation layer — THE ENTRY POINT.
 *
 * One flag, one branch, one controller for the whole turn. What this file
 * decides is not "which handler runs" but "which product answers", and the
 * two must never both touch a turn.
 *
 * WHY THIS BUILDS ITS OWN RESPONSE INSTEAD OF REUSING `sendFinalised200`
 * ----------------------------------------------------------------------
 * Measured at `3f238b11`: that egress has FIVE layers that can delete the
 * assistant's text outright and three that rewrite it. One of them —
 * `enforceAnalysisAuthorityUnavailableAtEgress` — treats an ABSENT
 * `answerKind` as substantive and wipes text, blocks, chips and insights
 * together. Those layers are a large part of why the current product
 * contributed no content on several measured turns and deleted content on
 * others.
 *
 * Routing a new controller through them would reproduce the defect via the
 * migration itself, and would do it silently, because a wiped response is
 * still a valid response. So this path composes its own body. The claim-safety
 * properties those layers exist to enforce are held HERE instead, structurally:
 * nothing in this layer can name a leading option it did not read from the
 * analysis, because the only route to a figure is a read tool, and nothing can
 * claim a change it did not make, because the only route to that sentence is
 * a receipt.
 *
 * ONE CONTROLLER PER TURN, AND NO FALLBACK AFTER A WRITE MAY HAVE LANDED
 * ----------------------------------------------------------------------
 * If this path throws, the turn fails as this path — it does NOT fall through
 * to the retired routing. A fallback that runs after a save may already have
 * been sent is how you build "updated, then denied" out of the migration.
 * {@link ReplacementTurnFailure} carries what the caller may say.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 * ------------------------------------
 * There is no durable store here. The typed state below has to be persisted
 * by Core — CEE has no free-form slot for it, and the one that looks like
 * a free-form slot is a trap (`v5_handler_facts.payload` is a `.strict()`
 * discriminated union whose unfiltered read THROWS, so one unrecognised row
 * breaks prior-fact loading for the whole scenario on every later turn).
 *
 * So the store is INJECTED and has NO DEFAULT. A process-local fallback was
 * considered and rejected: this service runs more than one instance, so a
 * user's "yes, make that update now" could land on an instance that has never
 * heard of the offer — which is precisely the failure this layer was built to
 * fix, reintroduced as a deployment artefact. Without a store the flag is
 * refused at the branch, loudly, rather than half-working.
 */

import {
  EMPTY_CONVERSATION_MEMORY,
  type ConversationMemory,
} from './conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, type ProposalStore } from './proposal-store.js';
import { createRunAnalysisTool } from './run-analysis-tool.js';
import { createRememberTool } from './remember-tool.js';
import { createSetOptionEffectTool } from './propose-tools.js';
import {
  createAddEdgeTool,
  createAddFactorTool,
  createAddOptionTool,
} from './structure-tools.js';
import { scrubKnownIdentifiers } from './scrub-identifiers.js';
import { detectUnbackedChangeClaim } from './turn-trace.js';
// The REAL detectors the rest of the estate uses — never a local
// re-implementation, which would drift from what actually runs (trap 12).
import { findSuccessClaimHit } from '../compose/forbidden-user-facing-phrases.js';
import { containsStructuralSuccessClaim } from '../routing/mutation-language.js';
import { createReadResultsTool, createReadWorkspaceTool, type AnalysisSnapshot } from './read-tools.js';
import { log } from '../../utils/telemetry.js';

import {
  runReplacementTurn,
  type ApplyOperations,
  type ReplacementTurnResult,
} from './run-replacement-turn.js';
import type { AgentTool, ChatWithToolsLike } from './agent-loop.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { ToolResponseBlock } from '../../adapters/llm/types.js';

/** Everything this layer must carry between turns. Versioned from the start:
 *  a stored blob with no version is a migration you cannot write later. */
export interface ReplacementState {
  readonly version: 1;
  readonly memory: ConversationMemory;
  readonly proposals: ProposalStore;
}

export const EMPTY_REPLACEMENT_STATE: ReplacementState = {
  version: 1,
  memory: EMPTY_CONVERSATION_MEMORY,
  proposals: EMPTY_PROPOSAL_STORE,
};

/**
 * An opaque optimistic-concurrency token for one scenario's stored row.
 *
 * Compared for EQUALITY only. Never parsed, ordered, or done arithmetic on —
 * a caller that reads meaning into it has built a second, undeclared contract
 * with whatever produced it.
 */
export type ReplacementStateRevision = string;

/**
 * What a read returns: the state, and the token that read saw.
 *
 * `revision` is `null` when and only when NO ROW EXISTED at read time. It is
 * NOT null for a row we could not decode — an unrecognised row still has a
 * revision, and a recovery save must UPDATE it rather than try to create a
 * row that is already there.
 */
export interface LoadedReplacementState {
  readonly state: ReplacementState;
  readonly revision: ReplacementStateRevision | null;
}

/**
 * The stored row moved between the read this write was built from and the
 * write itself. Another turn for this scenario got there first.
 *
 * Thrown by `save`, NOT by `load`, and deliberately distinct from
 * `ReplacementStateStoreError`: a conflict means the database worked
 * perfectly and refused a stale write, which is a different fact about the
 * world from "the database was unreachable" and leads to different words for
 * the user. Declared here, beside the contract it belongs to, rather than in
 * the adapter — the semantics are the contract's, and the adapter imports
 * this file already.
 */
export class ReplacementStateConflictError extends Error {
  readonly scenarioId: string;
  readonly expectedRevision: ReplacementStateRevision | null;

  constructor(
    scenarioId: string,
    expectedRevision: ReplacementStateRevision | null,
    options?: ErrorOptions,
  ) {
    super(
      `conversation state for scenario ${scenarioId} was written by another turn ` +
        `(this write was built from revision ${expectedRevision ?? 'NONE (first turn)'})`,
      options,
    );
    this.name = 'ReplacementStateConflictError';
    this.scenarioId = scenarioId;
    this.expectedRevision = expectedRevision;
  }
}

/**
 * Core's contract. Two calls, both keyed by scenario.
 *
 * `save` must be durable and visible to every instance before the next turn
 * can start, because the next turn's "yes" depends on it. An optimistic local
 * cache is fine; a local-only store is not.
 *
 * ⛔⛔ WHY THIS IS COMPARE-AND-SWAP AND NOT AN UNCONDITIONAL UPSERT
 * ─────────────────────────────────────────────────────────────────────────
 * The first version of this contract was last-writer-wins, and its safety
 * was ASSERTED from the existence of the turn fence rather than measured.
 * The assertion is refuted at the bytes: `admitCurrentTurnFence`
 * (`turn-fence-prehandler.ts:128-150`) returns `Promise<void>`, records a
 * generation and NEVER ABORTS, and `turn-fence.ts:23-28` scopes enforcement
 * to "ONLY writes that carry a graph". It claims a generation; it does not
 * hold a lock across these two upserts. So two turns for one scenario can
 * both read, and the older snapshot can overwrite the newer one — destroying
 * a remembered fact, an open proposal, or a completed receipt, silently and
 * with both writes reporting success. Reproduced by execution before this
 * contract was changed.
 *
 * Hence: every write carries the token its state was READ under, and a store
 * MUST refuse it if the row has moved since. A store that ignores
 * `expectedRevision` satisfies the types and reintroduces the defect, so the
 * spec pins the refusal with a discriminating pair (stale token rejected /
 * current token accepted against the SAME store) rather than with a rejection
 * test alone — a store that rejects everything is worthless and passes the
 * rejection test.
 */
export interface ReplacementStateStore {
  load(scenarioId: string): Promise<LoadedReplacementState>;
  /**
   * Write `state` if and only if the row still carries `expectedRevision`
   * (or, when that is `null`, if and only if no row exists yet).
   *
   * Returns the NEW token, so a caller that saves twice in one turn — which
   * the checkpoint makes ordinary — can chain its own writes without
   * conflicting with itself.
   *
   * @throws {ReplacementStateConflictError} the row moved; nothing was written.
   * @throws Error transport/permission failure; whether anything was written
   *   is unknown, and the caller must treat it as such.
   */
  save(
    scenarioId: string,
    state: ReplacementState,
    expectedRevision: ReplacementStateRevision | null,
  ): Promise<ReplacementStateRevision>;
}

/**
 * A stored blob is data from outside this process and is treated as such.
 * Anything unrecognised reads as empty rather than throwing — the opposite of
 * the handler-facts trap, where a strict parse on an unfiltered read takes
 * the whole scenario down.
 */
export function decodeReplacementState(raw: unknown): ReplacementState {
  if (raw === null || typeof raw !== 'object') return EMPTY_REPLACEMENT_STATE;
  const o = raw as Partial<ReplacementState>;
  if (o.version !== 1) return EMPTY_REPLACEMENT_STATE;
  const items = (o.memory as ConversationMemory | undefined)?.items;
  const proposals = (o.proposals as ProposalStore | undefined)?.proposals;
  if (!Array.isArray(items) || !Array.isArray(proposals)) return EMPTY_REPLACEMENT_STATE;
  return { version: 1, memory: { items }, proposals: { proposals } };
}

export interface ReplacementEntryDeps {
  readonly chatWithTools: ChatWithToolsLike;
  readonly state: ReplacementStateStore;
  /** Absent means this turn cannot save. Said in the prompt, not discovered. */
  readonly applyOperations?: ApplyOperations;
  /** Change tools BEYOND the standard set. `set_option_effect` is always
   *  present — its absence is what ended a live session, so it is not a thing
   *  a call site can forget to pass. */
  readonly proposeTools?: readonly AgentTool[];
  readonly maxIterations?: number;
}

export interface ReplacementEntryInput {
  readonly scenarioId: string;
  readonly message: string;
  readonly history: Array<{ role: 'user' | 'assistant'; content: string | ToolResponseBlock[] }>;
  readonly getGraph: () => GraphStateIngress | null | undefined;
  readonly getAnalysis: () => AnalysisSnapshot | null | undefined;
  /** The graph's current revision. Proposals bind to it. */
  readonly modelRevision: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly now: string;
}

export interface ReplacementEntryResult {
  readonly assistantText: string;
  /** The turn's decision chain. Exposed as well as logged so a caller — or a
   *  test — can assert on it without parsing a log line. */
  readonly trace: ReplacementTurnResult['trace'];
  readonly state: ReplacementState;
  readonly applied: ReplacementTurnResult['applied'];
  readonly mustReconcile: ReplacementTurnResult['mustReconcile'];
  readonly toolsCalled: readonly string[];
  readonly iterations: number;
  readonly incomplete: boolean;
  readonly newModelRevision?: string;
}

/**
 * Thrown when this controller cannot complete the turn.
 *
 * `mayHaveWritten` is the field that matters. When it is true the caller must
 * NOT retry, must NOT fall back to another controller, and must not tell the
 * user either that it saved or that it did not — the next turn reconciles.
 *
 * `stateConflict` says WHY, and the two answer different questions, so they
 * are named apart rather than folded together: `mayHaveWritten` is about the
 * GRAPH (did a mutation go out?), `stateConflict` is about the CONVERSATION
 * STATE (was this turn's snapshot stale?). A conflict with nothing in flight
 * is the benign case — another turn for this scenario won, this turn's
 * thinking is lost, and the user should be told to say it again. A conflict
 * with something in flight is the dangerous one, and `mayHaveWritten` is what
 * carries that.
 */
export class ReplacementTurnFailure extends Error {
  readonly mayHaveWritten: boolean;
  /** True when the save was refused because the row had moved, rather than
   *  because the store could not be reached. */
  readonly stateConflict: boolean;
  constructor(message: string, mayHaveWritten: boolean, stateConflict = false) {
    super(message);
    this.name = 'ReplacementTurnFailure';
    this.mayHaveWritten = mayHaveWritten;
    this.stateConflict = stateConflict;
  }
}

/**
 * A one-line description of the model, for the prompt's standing context.
 *
 * Deliberately thin: the detail lives behind `read_workspace`, so the model
 * fetches it when it needs it rather than being handed a wall of state every
 * turn. The old path's single budgeted pack is what made a turn's context
 * both too large and, where it mattered, empty.
 */
export function summariseWorkspace(graph: GraphStateIngress | null | undefined): string | null {
  if (graph == null || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    const kind = typeof n.kind === 'string' ? n.kind : 'unknown';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`);
  return `The model currently holds ${parts.join(', ')}. Use read_workspace for the detail — do not guess at labels or values.`;
}

/**
 * The tools this controller offers, in one place.
 *
 * ⛔ EXTRACTED BECAUSE THE SECOND COPY WAS ALREADY WRONG. The live harness
 * hand-listed them, and its own comment records the first time that drifted:
 * `remember` was wired here and missing there, so a live run showed the model
 * never calling it and the obvious reading — "it ignores the tool" — was
 * wrong. It was never offered one. At the time of this extraction the harness
 * was missing FOUR of the eight, including `run_analysis` and all three
 * structure tools, so every live judgement about what the model does with them
 * was a judgement about tools it could not see.
 *
 * A hand-maintained mirror fails silently and always reads as green. There is
 * now nothing to keep in step: both callers call this.
 */
export function buildReplacementTools(args: {
  readonly getGraph: ReplacementEntryInput['getGraph'];
  readonly getAnalysis: ReplacementEntryInput['getAnalysis'];
  /** Read fresh on each call — the record grows during a turn. */
  readonly getMemory: () => ConversationMemory;
  readonly requestId?: string;
  readonly proposeTools?: readonly AgentTool[];
}): AgentTool[] {
  return [
    createReadWorkspaceTool({ getGraph: args.getGraph, requestId: args.requestId }),
    createReadResultsTool({ getAnalysis: args.getAnalysis }),
    // Unconditional. Without it the durable record holds only what the
    // ASSISTANT did, and "retain new evidence" — the first increment's whole
    // promise — has no mechanism behind it.
    createRememberTool({ getMemory: args.getMemory }),
    createSetOptionEffectTool({ getGraph: args.getGraph }),
    // Also unconditional. A user must always be able to ask for the analysis,
    // and the tool itself decides whether running one is warranted — it
    // refuses when the model is not ready (returning the checker's own open
    // questions) and when a current result already exists (pointing at
    // read_results instead of spending again).
    createRunAnalysisTool({ getGraph: args.getGraph, getAnalysis: args.getAnalysis }),
    // The structure tools, also unconditional. A model that can read the
    // workspace and set an effect but cannot add the node the user just named
    // has to answer "I can't do that" to the most ordinary request there is —
    // the same shape of dead end `set_option_effect` was built to close. All
    // three propose only; none can write.
    createAddFactorTool({ getGraph: args.getGraph }),
    createAddOptionTool({ getGraph: args.getGraph }),
    createAddEdgeTool({ getGraph: args.getGraph }),
    ...(args.proposeTools ?? []),
  ];
}

/**
 * Run one turn on the replacement controller.
 *
 * Loads state, runs the turn, saves state, returns what the route should send.
 * The save happens BEFORE the response is returned: a reply that references a
 * proposal the next turn cannot find is the "Yes, make that update now"
 * failure, and the ordering is the whole guard against it.
 *
 * TWO SAVE POINTS, TWO DIFFERENT ANSWERS TO A CONFLICT
 * ─────────────────────────────────────────────────────────────────────────
 * Both carry the token this turn read. They are NOT the same situation and
 * must not be handled as one:
 *
 *   1. THE PRE-DISPATCH CHECKPOINT — a conflict here happens BEFORE anything
 *      leaves. The save throws, `run-replacement-turn.ts` catches it and
 *      returns a refusal to the model, and NO WRITE IS DISPATCHED. The turn
 *      still completes and still answers; the user is told, in the model's
 *      own reply, that the save did not go through, nothing has changed, and
 *      they can ask again. Nothing is uncertain, because nothing was sent.
 *
 *   2. THE END-OF-TURN SAVE — a conflict here happens AFTER the turn has run,
 *      so a write may already have gone out under a checkpoint that
 *      succeeded. This throws {@link ReplacementTurnFailure} with
 *      `stateConflict: true`, and with `mayHaveWritten` set from whether a
 *      write is applied or in flight. When `mayHaveWritten` is false the
 *      honest thing to tell the user is that this reply could not be
 *      remembered and they should say it again; when it is true the caller
 *      must say NEITHER that it saved nor that it did not, and must not
 *      retry — the next turn reconciles against the winner's state.
 *
 * ⚠ NOT SETTLED BY THIS CHANGE: no caller reads `mayHaveWritten` yet.
 * `route-v2.ts` does not catch {@link ReplacementTurnFailure} at all, so both
 * cases currently surface as a failed turn. The distinction is carried
 * correctly on the error; turning it into two different user-visible
 * sentences is a route-layer change and is NOT done here.
 */
export async function handleReplacementTurn(
  input: ReplacementEntryInput,
  deps: ReplacementEntryDeps,
): Promise<ReplacementEntryResult> {
  const loaded = await deps.state.load(input.scenarioId);
  const prior = decodeReplacementState(loaded.state);

  // The token every write this turn is built from. It advances on each
  // successful save so the turn does not conflict with itself, and it
  // DELIBERATELY does not advance on a failed one: a snapshot that lost a
  // race is stale for the rest of the turn, so the end-of-turn save must
  // conflict too rather than quietly overwrite the winner.
  let revision: ReplacementStateRevision | null = loaded.revision;

  const tools: AgentTool[] = buildReplacementTools({
    getGraph: input.getGraph,
    getAnalysis: input.getAnalysis,
    getMemory: () => prior.memory,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(deps.proposeTools === undefined ? {} : { proposeTools: deps.proposeTools }),
  });

  const result = await runReplacementTurn(
    {
      message: input.message,
      history: input.history,
      memory: prior.memory,
      proposals: prior.proposals,
      modelRevision: input.modelRevision,
      workspaceSummary: summariseWorkspace(input.getGraph()),
      tools,
      turnId: input.turnId,
      now: input.now,
      idFor: (purpose, i) => `${purpose}-${input.turnId}-${i}`,
    },
    {
      chatWithTools: deps.chatWithTools,
      // The durability barrier. Called before any write leaves, so the
      // idempotency key is on disk before the work is sent. Without it no
      // write is sent at all — see `ReplacementTurnDeps.checkpoint`.
      //
      // ⛔ AND THIS IS NOW ALSO THE CONCURRENCY BARRIER. A conflict here
      // THROWS, and `run-replacement-turn.ts` turns a throwing checkpoint
      // into a refusal that sends NOTHING — which is the correct answer to
      // "another turn moved this scenario under us": the proposal we were
      // about to authorise was read from a snapshot that no longer exists,
      // so dispatching against it would apply a change the user agreed to
      // in a state that has since changed. Refusing to write is always
      // recoverable; the user is told the save did not go through and can
      // ask again, on a turn that will load the winner's state.
      checkpoint: async ({ memory, proposals }) => {
        revision = await deps.state.save(
          input.scenarioId,
          { version: 1, memory, proposals },
          revision,
        );
      },
      ...(deps.applyOperations === undefined ? {} : { applyOperations: deps.applyOperations }),
      ...(deps.maxIterations === undefined ? {} : { maxIterations: deps.maxIterations }),
    },
  );

  // ⭐⭐ THE RECORD IS EMITTED HERE, AT THE INTEGRATION BOUNDARY, and not by
  // the controller — which deliberately owns no sink, so its record cannot be
  // switched off independently of it.
  //
  // ⚠ AND IT IS EMITTED BEFORE THE FINAL SAVE, on purpose. A save that fails
  // throws out of this function; emitting afterwards would lose the record of
  // exactly the turn hardest to reconstruct. The trace describes what the turn
  // DID, which is already settled by this point — including the write and its
  // receipt — so nothing in it depends on the save landing.
  //
  // Field-by-field rather than a spread: this object is a wire contract for
  // whoever reads the logs, and a spread would silently start shipping any
  // field a later change adds to the trace, including one that should not
  // leave the process.
  // Identifiers out, by identity against THIS graph — never by a pattern over
  // English. The shared egress scrub matches a pattern and was measured
  // rewriting nine of seventeen ordinary business sentences into
  // ungrammatical text; see scrub-identifiers.ts.
  //
  // ⚠ HOISTED ABOVE THE EMISSION DELIBERATELY. The record below measures what
  // the reply CLAIMED, and the claim must be read off the text the USER reads
  // — i.e. after scrubbing — not off the raw model output. `scrubKnownIdentifiers`
  // is pure, so moving it earlier changes nothing but the order.
  const assistantText = scrubKnownIdentifiers(result.text, input.getGraph() ?? null);

  // ⭐⭐ WHAT THE REPLY CLAIMED, AGAINST WHAT THE TURN CAN PROVE. A reply may
  // not assert a change was made unless the turn holds a commit proof, and the
  // proof is `receipt_id`. This does NOT suppress or rewrite the claim —
  // choosing what the product says instead is a copy decision. It records it,
  // so the remedy has a measurement to be judged against rather than a story.
  // ⚠ A FLOOR, NOT A COUNT: both detectors are pattern-based and the
  // known-missed set is pinned in `__tests__/unbacked-change-claim.test.ts`.
  // Null here means "no pattern matched", never "the reply was honest".
  const unbackedChangeClaim = detectUnbackedChangeClaim(assistantText, result.trace, {
    findSuccessClaimHit,
    containsStructuralSuccessClaim,
  });

  log.info(
    {
      event: 'v5.replacement.turn',
      scenario_id: input.scenarioId,
      correlation_id: result.trace.correlation_id,
      controller: result.trace.controller,
      model_revision: result.trace.model_revision,
      proposals_open: result.trace.proposals_open,
      proposals_in_flight: result.trace.proposals_in_flight,
      accepted_proposal_id: result.trace.accepted_proposal_id,
      intended_operation_kinds: result.trace.intended_operation_kinds,
      tools_called: result.trace.tools_called,
      refusals: result.trace.refusals,
      write_attempted: result.trace.write_attempted,
      write_committed: result.trace.write_committed,
      receipt_id: result.trace.receipt_id,
      new_model_revision: result.trace.new_model_revision,
      iterations: result.trace.iterations,
      outcome: result.trace.outcome,
      // The measured floor on this layer's own dishonesty. See above.
      claimed_change_without_receipt: unbackedChangeClaim,
    },
    'replacement: turn decision chain',
  );

  const next: ReplacementState = {
    version: 1,
    memory: result.memory,
    proposals: result.proposals,
  };

  try {
    await deps.state.save(input.scenarioId, next, revision);
  } catch (err) {
    // A save that did not land means the next turn cannot honour a "yes", and
    // — worse — cannot see a proposal whose write DID land. If anything was
    // applied this turn, that is an unknown the caller must not paper over.
    //
    // ⛔ `applied` ALONE IS NOT THE RIGHT TEST, and it was the test here
    // before. `applied` holds writes with RECEIPTS. A write whose outcome is
    // UNKNOWN has no receipt and never enters it — it sits in
    // `mustReconcile`, and that is precisely the case where a write may have
    // landed. Reading only `applied` reported `mayHaveWritten: false` on the
    // one state that exists to mean "we do not know". Both are checked now,
    // and the second is the load-bearing one.
    const mayHaveWritten = result.applied.length > 0 || result.mustReconcile.length > 0;
    const stateConflict = err instanceof ReplacementStateConflictError;
    throw new ReplacementTurnFailure(
      stateConflict
        ? `the conversation state was not saved: another turn for this scenario wrote it while ` +
          `this one was running, so this turn's state is stale and was refused`
        : `the conversation state did not save: ${err instanceof Error ? err.message : String(err)}`,
      mayHaveWritten,
      stateConflict,
    );
  }

  return {
    assistantText,
    trace: result.trace,
    state: next,
    applied: result.applied,
    mustReconcile: result.mustReconcile,
    toolsCalled: result.toolsCalled,
    iterations: result.iterations,
    incomplete: result.incomplete,
    ...(result.newModelRevision === undefined ? {} : { newModelRevision: result.newModelRevision }),
  };
}
