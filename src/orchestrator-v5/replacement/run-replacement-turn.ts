/**
 * Replacement conversation layer — ONE CONNECTED TURN.
 *
 * This is the piece the standalone modules were built for: state in, a reply
 * out, and along the way the whole consent chain — offer, agree, save,
 * receipt — with every step recorded in a form the next turn can read.
 *
 * THE JOURNEY IT HAS TO SURVIVE
 * ------------------------------
 *   hold what the user said  →  offer one supported change  →  they agree on a
 *   LATER turn  →  it saves  →  reload  →  the product reports, accurately,
 *   what was saved.
 *
 * Every link in that chain failed in the live sessions, and the last one
 * failed in both directions on the same day: a change announced that never
 * happened, and a change denied that had.
 *
 * WHERE THE SAVE HAPPENS, AND WHY IT IS INSIDE THE TURN
 * -----------------------------------------------------
 * The write runs inside the `accept` tool, not after the loop. That is
 * deliberate: the model then learns the real outcome and can write a true
 * sentence about it in the same breath. Doing it afterwards would force the
 * reply to be composed before the outcome was known, which is precisely the
 * position from which a model guesses "I've updated it".
 *
 * The safety property is NOT "the loop cannot write". It is stronger and more
 * specific: A WRITE CAN ONLY EVER BE THE OPERATIONS OF A PROPOSAL THE USER
 * HAS ALREADY BEEN SHOWN, taken from the store unchanged. There is no code
 * path here that composes an operation after the user has agreed to
 * something.
 *
 * WHAT THE CONSENT CHECK DOES AND DOES NOT COVER — STATED PLAINLY
 * ---------------------------------------------------------------
 * `accept_proposal` requires the model to quote the user's own words of
 * agreement, and refuses unless that quote appears verbatim in THIS turn's
 * message. That is a substring check, on purpose: a natural-language
 * "did they say yes?" predicate is the shape this estate has already
 * oscillated on for four rounds, and it would be the wrong instrument here.
 *
 *   IT PREVENTS: the model accepting its own proposal on a turn where the
 *   user never addressed it — the realistic failure, and the one that
 *   produces a write out of enthusiasm.
 *
 *   IT DOES NOT PREVENT: a model that quotes accurately and interprets
 *   dishonestly. "don't do that" is a substring of a message containing it.
 *   Nothing at this layer catches that; what catches it is that the operation
 *   is the user's own, visible, previously-offered one, so the blast radius
 *   is a change they have already seen and can reverse.
 *
 * INJECTION
 * ---------
 * The model call and the write path are both injected, so this whole function
 * runs offline against fakes — no network, no provider credentials, no spend,
 * and no database. Core owns the real write; this owns what may be sent to it.
 */

import {
  runAgentLoop,
  type AgentLoopResult,
  type AgentTool,
  type ChatWithToolsLike,
} from './agent-loop.js';
import { recordItem, type ConversationMemory } from './conversation-memory.js';
import {
  authoriseProposal,
  beginApply,
  isRetryExhausted,
  markStaleForRevision,
  needsReconciliation,
  openProposals,
  operationsToApply,
  recordApplied,
  recordApplyAttempt,
  recordApplyFailed,
  type ProposalOperation,
  type ProposalStore,
} from './proposal-store.js';
import { buildSystemPrompt } from './system-prompt.js';
import { composeTurn, type ComposeTurnResult } from './turn-composer.js';
import type { ToolResponseBlock } from '../../adapters/llm/types.js';

/**
 * Core's authoritative write. Three outcomes, kept apart on purpose.
 *
 * A thrown error means UNKNOWN and is handled as such — the proposal stays in
 * flight and the next turn retries under the same key.
 *
 * ⛔⛔ THE ONE REQUIREMENT THIS LAYER CANNOT ENFORCE, AND DEPENDS ON ABSOLUTELY
 * ─────────────────────────────────────────────────────────────────────────
 * **THE IMPLEMENTATION MUST BE IDEMPOTENT UNDER `idempotencyKey`.** Two calls
 * carrying the same key must perform the work AT MOST ONCE, and the second
 * must return the SAME receipt as the first rather than applying again.
 *
 * This is not a nicety. When a save's outcome is unknown, every later turn
 * retries under the key recorded before the original write. If the key is
 * ignored, that turns ONE uncertain write into a REPEATED one — strictly
 * worse than the defect the retry was added to fix, and silent.
 *
 * ⚠ It is also a claim about somebody else's module, made before that module
 * exists, which is a mistake this account has made before and been caught
 * making. So it is stated here as a hard precondition rather than assumed,
 * and it is stated again in
 * `output/session-analysis-20260920/CORE-PERSISTENCE-REQUEST.md`.
 *
 * IF YOUR WRITE PATH CANNOT HONOUR THE KEY, DO NOT PASS `applyOperations`.
 * With it absent this layer proposes but never saves, says so in the prompt,
 * and keeps an unknown save honestly unresolved rather than retrying into a
 * duplicate. A degraded product beats a product that silently writes twice.
 */
export interface ApplyOperations {
  (input: {
    readonly proposalId: string;
    /** MUST make the call idempotent — see the contract above. Retried
     *  verbatim on every turn until the outcome is known. */
    readonly idempotencyKey: string;
    readonly operations: readonly ProposalOperation[];
    readonly modelRevision: string;
  }): Promise<
    | { readonly ok: true; readonly receiptId: string; readonly newModelRevision?: string }
    | { readonly ok: false; readonly reason: string }
  >;
}

export interface ReplacementTurnDeps {
  readonly chatWithTools: ChatWithToolsLike;
  /** Absent means read-only: no `accept_proposal` tool is offered at all, and
   *  the prompt says so rather than letting the model discover it. */
  readonly applyOperations?: ApplyOperations;
  readonly maxIterations?: number;
}

export interface ReplacementTurnInput {
  readonly message: string;
  /** Prior turns, already in the provider's shape. */
  readonly history: Array<{ role: 'user' | 'assistant'; content: string | ToolResponseBlock[] }>;
  readonly memory: ConversationMemory;
  readonly proposals: ProposalStore;
  /** The revision the graph is at NOW. Anything offered against an older one
   *  is stale and must be put again. */
  readonly modelRevision: string;
  /** The model on screen in plain language, or null when there is none yet. */
  readonly workspaceSummary: string | null;
  /** Read and propose tools. The accept tool is built here, not passed in —
   *  it is the one tool whose behaviour this module must guarantee. */
  readonly tools: readonly AgentTool[];
  /** Stated in the prompt so a refusal is accurate rather than invented. */
  readonly unavailable?: readonly string[];
  readonly turnId: string;
  readonly now: string;
  readonly idFor: (purpose: 'proposal' | 'suggestion' | 'idempotency', index: number) => string;
}

export interface ReplacementTurnResult extends ComposeTurnResult {
  readonly toolsCalled: readonly string[];
  /** Model round-trips this turn. Reported as `llm_calls_used`. */
  readonly iterations: number;
  /** Proposals that actually persisted this turn, with their receipts. The
   *  only honest basis for an "I changed X" sentence anywhere downstream. */
  readonly applied: readonly { readonly proposalId: string; readonly receiptId: string }[];
  /** Set when a save landed and the write path reported a new revision. */
  readonly newModelRevision?: string;
}

/** Whitespace- and case-insensitive containment. Nothing cleverer. */
function quotedFromMessage(quote: string, message: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  return q.length > 0 && norm(message).includes(q);
}

export const ACCEPT_TOOL_NAME = 'accept_proposal';

export async function runReplacementTurn(
  input: ReplacementTurnInput,
  deps: ReplacementTurnDeps,
): Promise<ReplacementTurnResult> {
  // The model may have moved since an offer was made. Mark first, so the
  // prompt never shows a stale offer as live and the accept tool cannot take
  // one. `apply_in_flight` is untouched by this — see the store.
  let proposals = markStaleForRevision(input.proposals, input.modelRevision);
  let memory = input.memory;

  const applied: { proposalId: string; receiptId: string }[] = [];
  let newModelRevision: string | undefined;

  // ── RESOLVING AN UNKNOWN SAVE ───────────────────────────────────────────
  //
  // ⚠ THIS BLOCK EXISTS BECAUSE ITS ABSENCE BRICKED THE CONVERSATION, and it
  // was found by asking "what have I built that is WORSE than what it
  // replaces?" rather than by review.
  //
  // As first written, a thrown save left the proposal `apply_in_flight`
  // forever. Nothing could resolve it: `recordApplied` needs a receipt,
  // `recordApplyFailed` needs an affirmative failure, and the only caller of
  // either was the accept tool — which is reached through the agent loop,
  // which this function returned before ever running. Reproduced by
  // execution: after the throw, FIVE later turns with a perfectly healthy
  // write path each returned the reconciliation notice and the proposal was
  // still outstanding. A permanently stuck conversation is a worse product
  // than the one being replaced.
  //
  // The resolution is the mechanism already built for it. `beginApply`
  // recorded an idempotency key BEFORE the write, so retrying with THAT SAME
  // KEY is safe by construction: a write path honouring the key either
  // returns the original receipt or performs the work exactly once. That is
  // the entire reason the key is written before the mutation rather than
  // after.
  //
  // So every turn retries, and each retry can only move the proposal towards
  // a definite answer. A still-thrown retry stays unknown and is tried again
  // next turn — unresolved, but never stuck.
  let outstanding = needsReconciliation(proposals);
  if (outstanding.length > 0 && deps.applyOperations !== undefined) {
    for (const p of outstanding) {
      if (p.idempotency_key === undefined) continue;
      // Bounded. The retry is safe only if the write path honours the key,
      // which this layer cannot check — so a precondition it depends on and
      // cannot verify gets a blast radius rather than a free loop.
      if (isRetryExhausted(p)) continue;
      proposals = recordApplyAttempt(proposals, p.id);
      const summary = p.operations.map((o) => o.summary).join('; ');
      try {
        const outcome = await deps.applyOperations({
          proposalId: p.id,
          idempotencyKey: p.idempotency_key,
          operations: p.operations,
          modelRevision: p.model_revision,
        });
        if (outcome.ok) {
          proposals = recordApplied(proposals, p.id, {
            receipt_id: outcome.receiptId,
            applied_at: input.now,
          });
          applied.push({ proposalId: p.id, receiptId: outcome.receiptId });
          if (outcome.newModelRevision !== undefined) newModelRevision = outcome.newModelRevision;
          memory = recordItem(memory, {
            id: `change-${p.id}`,
            kind: 'authorised_change',
            text: summary,
            source_turn_id: input.turnId,
            recorded_at: input.now,
            proposal_id: p.id,
            receipt_id: outcome.receiptId,
          });
        } else {
          proposals = recordApplyFailed(proposals, p.id, {
            reason: outcome.reason,
            failed_at: input.now,
          });
        }
      } catch {
        // Still unknown. Left in flight deliberately: the next turn retries
        // under the same key. Swallowed rather than thrown because a
        // reconciliation failure must not also destroy this turn.
      }
    }
    outstanding = needsReconciliation(proposals);
  }

  // Only a save whose outcome is STILL unknown owns the turn. Nothing is
  // asked of the model: spending a call to produce prose that will be
  // discarded is waste, and any prose it produced would be written without
  // knowing what happened.
  if (outstanding.length > 0) {
    const composed = composeTurn({
      loopResult: { text: '', proposed: [], accepted: [], toolsCalled: [], iterations: 0, haltedAtCeiling: false },
      memory,
      proposals,
      modelRevision: input.modelRevision,
      turnId: input.turnId,
      now: input.now,
      idFor: input.idFor,
    });
    return { ...composed, toolsCalled: [], iterations: 0, applied };
  }

  const acceptTool: AgentTool | null =
    deps.applyOperations === undefined
      ? null
      : {
          kind: 'accept',
          definition: {
            name: ACCEPT_TOOL_NAME,
            description:
              'Record that the user has agreed to a change you previously offered, and save it. ' +
              'Only for a change already put to them and still waiting — it saves exactly what was ' +
              'shown and nothing else. If they want something different, offer that instead.',
            input_schema: {
              type: 'object',
              properties: {
                proposal_id: { type: 'string', description: 'The waiting change they agreed to.' },
                user_agreement_quote: {
                  type: 'string',
                  description:
                    "The user's own words agreeing, copied exactly from their latest message.",
                },
              },
              required: ['proposal_id', 'user_agreement_quote'],
            },
          },
          execute: async (raw) => {
            const proposalId = typeof raw.proposal_id === 'string' ? raw.proposal_id : '';
            const quote = typeof raw.user_agreement_quote === 'string' ? raw.user_agreement_quote : '';

            const waiting = openProposals(proposals);
            const target = waiting.find((p) => p.id === proposalId);
            if (target === undefined) {
              return {
                type: 'refused',
                content:
                  waiting.length === 0
                    ? 'There is nothing waiting to be agreed to. If you want to make a change, offer it first.'
                    : `No change with that id is waiting. Waiting: ${waiting
                        .map((p) => `${p.id} (${p.operations.map((o) => o.summary).join('; ')})`)
                        .join(', ')}.`,
              };
            }

            if (!quotedFromMessage(quote, input.message)) {
              return {
                type: 'refused',
                content:
                  'Those are not the user\'s words on this turn, so this is not agreement I can act on. ' +
                  'Quote what they actually said, or ask them directly.',
              };
            }

            const summary = target.operations.map((o) => o.summary).join('; ');

            proposals = authoriseProposal(proposals, proposalId, {
              authorised_in_turn: input.turnId,
              authorised_at: input.now,
              current_model_revision: input.modelRevision,
            });

            // Bound to what was OFFERED. Not re-derived from the conversation.
            const bound = operationsToApply(proposals, proposalId);
            const idempotencyKey = input.idFor('idempotency', applied.length);
            proposals = recordApplyAttempt(proposals, proposalId);
            proposals = beginApply(proposals, proposalId, {
              idempotency_key: idempotencyKey,
              apply_started_at: input.now,
              current_model_revision: input.modelRevision,
            });

            let outcome: Awaited<ReturnType<ApplyOperations>>;
            try {
              outcome = await deps.applyOperations!({
                proposalId,
                idempotencyKey,
                operations: bound.operations,
                modelRevision: bound.model_revision,
              });
            } catch (err) {
              // UNKNOWN. It stays in flight; the next turn reconciles. The
              // model is told exactly this, so it cannot resolve it either way.
              return {
                type: 'refused',
                content:
                  `The save was sent and did not come back — I do not know whether it landed ` +
                  `(${err instanceof Error ? err.message : String(err)}). Tell the user plainly ` +
                  `that you are checking, and do not say it saved or that it did not.`,
              };
            }

            if (!outcome.ok) {
              proposals = recordApplyFailed(proposals, proposalId, {
                reason: outcome.reason,
                failed_at: input.now,
              });
              return {
                type: 'refused',
                content: `It did not save: ${outcome.reason}. Nothing has changed. Tell the user what happened.`,
              };
            }

            proposals = recordApplied(proposals, proposalId, {
              receipt_id: outcome.receiptId,
              applied_at: input.now,
            });
            applied.push({ proposalId, receiptId: outcome.receiptId });
            if (outcome.newModelRevision !== undefined) newModelRevision = outcome.newModelRevision;

            // The ONLY place an `authorised_change` is ever written, and it
            // carries both ids — the memory module refuses it without them.
            memory = recordItem(memory, {
              id: `change-${proposalId}`,
              kind: 'authorised_change',
              text: summary,
              source_turn_id: input.turnId,
              recorded_at: input.now,
              proposal_id: proposalId,
              receipt_id: outcome.receiptId,
            });

            return {
              type: 'accepted',
              proposal_id: proposalId,
              summary,
              content:
                `SAVED. "${summary}" is now part of the model. You may tell the user it is done. ` +
                `This is the only circumstance in which you may say that.`,
            };
          },
        };

  const system = buildSystemPrompt({
    memory,
    proposals,
    workspaceSummary: input.workspaceSummary,
    unavailable:
      deps.applyOperations === undefined
        ? [...(input.unavailable ?? []), 'saving a change to the model on this turn']
        : input.unavailable,
  });

  const loopResult: AgentLoopResult = await runAgentLoop(
    {
      system,
      messages: [...input.history, { role: 'user', content: input.message }],
      tools: acceptTool === null ? input.tools : [...input.tools, acceptTool],
    },
    { chatWithTools: deps.chatWithTools, ...(deps.maxIterations === undefined ? {} : { maxIterations: deps.maxIterations }) },
  );

  const composed = composeTurn({
    loopResult,
    memory,
    proposals,
    modelRevision: newModelRevision ?? input.modelRevision,
    turnId: input.turnId,
    now: input.now,
    idFor: input.idFor,
  });

  return {
    ...composed,
    toolsCalled: loopResult.toolsCalled,
    iterations: loopResult.iterations,
    applied,
    ...(newModelRevision === undefined ? {} : { newModelRevision }),
  };
}
