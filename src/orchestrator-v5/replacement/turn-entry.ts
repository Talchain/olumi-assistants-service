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
import { createSetOptionEffectTool } from './propose-tools.js';
import { createReadResultsTool, createReadWorkspaceTool, type AnalysisSnapshot } from './read-tools.js';
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
 * Core's contract. Two calls, both keyed by scenario.
 *
 * `save` must be durable and visible to every instance before the next turn
 * can start, because the next turn's "yes" depends on it. An optimistic local
 * cache is fine; a local-only store is not.
 */
export interface ReplacementStateStore {
  load(scenarioId: string): Promise<ReplacementState>;
  save(scenarioId: string, state: ReplacementState): Promise<void>;
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
  readonly state: ReplacementState;
  readonly applied: ReplacementTurnResult['applied'];
  readonly mustReconcile: ReplacementTurnResult['mustReconcile'];
  readonly toolsCalled: readonly string[];
  readonly incomplete: boolean;
  readonly newModelRevision?: string;
}

/**
 * Thrown when this controller cannot complete the turn.
 *
 * `mayHaveWritten` is the field that matters. When it is true the caller must
 * NOT retry, must NOT fall back to another controller, and must not tell the
 * user either that it saved or that it did not — the next turn reconciles.
 */
export class ReplacementTurnFailure extends Error {
  readonly mayHaveWritten: boolean;
  constructor(message: string, mayHaveWritten: boolean) {
    super(message);
    this.name = 'ReplacementTurnFailure';
    this.mayHaveWritten = mayHaveWritten;
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
 * Run one turn on the replacement controller.
 *
 * Loads state, runs the turn, saves state, returns what the route should send.
 * The save happens BEFORE the response is returned: a reply that references a
 * proposal the next turn cannot find is the "Yes, make that update now"
 * failure, and the ordering is the whole guard against it.
 */
export async function handleReplacementTurn(
  input: ReplacementEntryInput,
  deps: ReplacementEntryDeps,
): Promise<ReplacementEntryResult> {
  const loaded = await deps.state.load(input.scenarioId);
  const prior = decodeReplacementState(loaded);

  const tools: AgentTool[] = [
    createReadWorkspaceTool({ getGraph: input.getGraph, requestId: input.requestId }),
    createReadResultsTool({ getAnalysis: input.getAnalysis }),
    createSetOptionEffectTool({ getGraph: input.getGraph }),
    ...(deps.proposeTools ?? []),
  ];

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
      ...(deps.applyOperations === undefined ? {} : { applyOperations: deps.applyOperations }),
      ...(deps.maxIterations === undefined ? {} : { maxIterations: deps.maxIterations }),
    },
  );

  const next: ReplacementState = {
    version: 1,
    memory: result.memory,
    proposals: result.proposals,
  };

  try {
    await deps.state.save(input.scenarioId, next);
  } catch (err) {
    // A save that did not land means the next turn cannot honour a "yes", and
    // — worse — cannot see a proposal whose write DID land. If anything was
    // applied this turn, that is an unknown the caller must not paper over.
    throw new ReplacementTurnFailure(
      `the conversation state did not save: ${err instanceof Error ? err.message : String(err)}`,
      result.applied.length > 0,
    );
  }

  return {
    assistantText: result.text,
    state: next,
    applied: result.applied,
    mustReconcile: result.mustReconcile,
    toolsCalled: result.toolsCalled,
    incomplete: result.incomplete,
    ...(result.newModelRevision === undefined ? {} : { newModelRevision: result.newModelRevision }),
  };
}
