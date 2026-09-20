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
  recordUnresolved,
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
  /**
   * Persist the state RIGHT NOW, before a write is sent.
   *
   * ⛔ WITHOUT THIS THE RETRY IS NOT DURABLE, and the whole idempotency
   * argument collapses. The key and the attempt count are recorded in memory
   * by `beginApply`, and the turn's state is only saved when the turn ends —
   * so a crash between sending the write and finishing the turn loses both.
   * The next turn then loads a proposal that never went in flight, mints a
   * FRESH key, and sends the work again. One uncertain write becomes two,
   * which is the exact harm the key exists to prevent.
   *
   * Caught in review (Codex, 20 Sep): "the key and attempt count are saved
   * only after the external write; a crash can lose both and restart the cap
   * with a new key." Correct, and not visible to any offline test, because
   * the fake store cannot crash between two statements.
   *
   * If this is absent, or if it THROWS, no write is sent at all. Refusing to
   * write is always recoverable; writing something we might not remember
   * having written is not.
   */
  readonly checkpoint?: (state: {
    readonly memory: ConversationMemory;
    readonly proposals: ProposalStore;
  }) => Promise<void>;
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
  readonly idFor: (purpose: 'proposal' | 'suggestion' | 'idempotency' | 'remembered', index: number) => string;
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

/**
 * Every digit run in a string, in order. Lexical, not linguistic — this
 * deliberately does no parsing, no unit inference and no arithmetic.
 */
function digitRuns(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? []
}

/**
 * ⛔ DOES THE USER'S MESSAGE NAME A NUMBER THE OFFER DOES NOT?
 *
 * Measured on the DEPLOYED product, 20 Sep: the assistant offered "a limit
 * keeping … at or below 30 … Say the word and I will make it", and the user
 * replied *"Yes, treat it as a 0-1 fraction of revenue at risk, so 30% is 0.3.
 * Please go ahead."* The retired path REFUSED that, and refusing was CORRECT —
 * a held change replays from its stored operations and never re-reads the
 * message, so honouring it as a bare "yes" would have written the offer's own
 * number and silently discarded the user's. This controller has the same
 * exposure and had no equivalent guard: `accept_proposal` required only that
 * the quote be the user's words, and "so 30% is 0.3. Please go ahead" is
 * exactly that.
 *
 * ⚠ DELIBERATELY NOT A PREDICATE OVER ENGLISH. CLAUDE.md's trap 22f records
 * four rounds of oscillation on one such predicate in this estate, and 22c
 * rules that the author's own corpus cannot bound one. So this asks a LEXICAL
 * question with no interpretation in it — is there a digit run here that the
 * offer does not itself contain? — and fails CLOSED. It cannot tell "0.3" the
 * new value from "option 2" the reference, and it does not try: both are
 * refused, and a refusal costs one turn in which the model re-offers at the
 * user's number. A gap, never a lie.
 *
 * The comparison is against the offer's OWN rendered summaries and values, so
 * "yes, 30" against an offer of 30 still accepts.
 */
function namesANumberTheOfferDoesNot(
  message: string,
  operations: readonly { readonly summary: string; readonly value?: unknown }[],
): boolean {
  const inMessage = digitRuns(message)
  if (inMessage.length === 0) return false
  const offered = new Set(
    operations.flatMap((o) => [
      ...digitRuns(o.summary),
      ...(o.value === undefined || o.value === null ? [] : digitRuns(String(o.value))),
    ]),
  )
  return inMessage.some((d) => !offered.has(d))
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
      // The incremented attempt count must reach disk before the retry goes
      // out, for the same reason the key must: otherwise a crash resets the
      // cap and the bound is not a bound.
      if (deps.checkpoint === undefined) break;
      try {
        await deps.checkpoint({ memory, proposals });
      } catch {
        break;
      }

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
    // ⛔ ABANDON WHAT WE HAVE STOPPED CHECKING, so the turn is not owned by it
    // forever.
    //
    // `isRetryExhausted` stops the retry but left the proposal
    // `apply_in_flight`, so `needsReconciliation` kept returning it and the
    // short-circuit below owned EVERY later turn — same notice, no model call,
    // no way out. The notice even invited the user to answer, and nothing ever
    // read the answer. The mechanism built to stop the product lying ended up
    // bricking the conversation instead. Returned as a P1 by the independent
    // reviewer, and correct.
    //
    // Moving to the terminal `unresolved` claims nothing about whether the
    // write landed — which remains genuinely unknown — while letting the
    // conversation continue.
    for (const p of needsReconciliation(proposals)) {
      if (isRetryExhausted(p)) proposals = recordUnresolved(proposals, p.id, { at: input.now });
    }
    outstanding = needsReconciliation(proposals);
  }

  // Only a save whose outcome is STILL unknown owns the turn. Nothing is
  // asked of the model: spending a call to produce prose that will be
  // discarded is waste, and any prose it produced would be written without
  // knowing what happened.
  if (outstanding.length > 0) {
    const composed = composeTurn({
      loopResult: { text: '', proposed: [], accepted: [], remembered: [], toolsCalled: [], iterations: 0, haltedAtCeiling: false },
      memory,
      proposals,
      modelRevision: input.modelRevision,
      turnId: input.turnId,
      now: input.now,
      idFor: input.idFor,
    });
    return { ...composed, toolsCalled: [], iterations: 0, applied };
  }

  // Write attempts this turn has COMMITTED TO DISPATCHING, as distinct from
  // `applied`, which counts successful returns and also carries prior turns'
  // reconciled writes. Reserved before the write leaves — see the refusal.
  let acceptedThisTurn = 0;
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
            // Checked FIRST, before a single state change. Without somewhere
            // durable to record that a save has started, nothing may be
            // authorised, put in flight, or sent — leaving a proposal marked
            // in-flight for a write that was never sent is its own small lie.
            if (deps.checkpoint === undefined) {
              return {
                type: 'refused',
                content:
                  'I cannot save that safely right now — there is no way to record that I have started, ' +
                  'so a failure could lose track of whether it went through. Nothing has changed. ' +
                  'Tell the user you cannot save at the moment.',
              };
            }
            // ⛔⛔ ONE TURN, ONE WRITE — A PROPERTY OF THE APPLIER, NOT A
            // PREFERENCE, AND THE SECOND WRITE FAILS SILENTLY AND TOTALLY.
            //
            // The conversational applier is `append_turn_atomic_v4/v5`, whose
            // idempotency is `ON CONFLICT (scenario_id, turn_id) DO NOTHING`.
            // Read at the migration bytes
            // (`20260806120000_v5_turn_fence_first_write_exemption.sql`), the
            // conflict arm does this:
            //
            //   ON CONFLICT (scenario_id, turn_id) DO NOTHING
            //   RETURNING id INTO v_turn_id;
            //   IF NOT FOUND THEN
            //     SELECT id INTO v_turn_id FROM v5_conversation_turns ...
            //     RETURN v_turn_id;        <-- everything below is SKIPPED
            //
            // Below that RETURN sit the `UPDATE scenarios SET graph`, the
            // handler-facts insert loop and the brief update. So a SECOND
            // append under the same turn id does not merely return the first
            // call's receipt: its graph, its facts and its brief are never
            // written at all, and the call hands back a valid-looking row id.
            // The model would then be told the second change was saved, on a
            // turn where it reached nothing — the "Updated Monthly Churn Rate"
            // lie this whole layer exists to kill, regenerated at the
            // database.
            //
            // The right end state is ONE apply carrying BOTH operation sets.
            // That is not built. Until it is, refusing the second accept is
            // the honest behaviour: the user is told plainly that one change
            // went through and the other needs another turn, which is a
            // smaller harm than a confident false receipt.
            //
            // ⚠ IT LIVES IN THE TOOL, NOT THE PROMPT, DELIBERATELY. Two
            // identical four-turn runs at temperature 0 diverged materially on
            // this branch, so anything that must hold EVERY time cannot be a
            // sentence the model is asked to respect.
            // ⚠ SCOPED TO WRITE ATTEMPTS THIS TURN DISPATCHED, not to `applied.length`.
            // The reconciliation block above ALSO pushes to `applied` when it
            // resolves a PRIOR turn's in-flight proposal — under that prior
            // turn's idempotency key, i.e. a different `(scenario_id, turn_id)`.
            // Keying on `applied.length` therefore refused a legitimate FIRST
            // accept on this turn, with copy that said a change had "already
            // been saved on this turn" when none had. Found by adversarial
            // review; the guard was over-broad relative to its own stated
            // justification, which is about a second append under ONE turn id.
            if (acceptedThisTurn > 0) {
              return {
                type: 'refused',
                content:
                  'ONE CHANGE PER TURN. A change has already been saved on this turn, and a second ' +
                  'save would not reach the model — it would look like it had. Tell the user which ' +
                  'change was saved, that the other has NOT been, and offer to make it next.',
              };
            }

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

            // ⛔ AN ACCEPTANCE THAT NAMES ITS OWN NUMBER IS NOT AN ACCEPTANCE
            // OF THIS OFFER. See `namesANumberTheOfferDoesNot` for the measured
            // case and for why this asks a lexical question rather than a
            // linguistic one.
            if (namesANumberTheOfferDoesNot(input.message, target.operations)) {
              return {
                type: 'refused',
                content:
                  `The user's message names a number this offer does not carry, so agreeing to the ` +
                  `offer as it stands would save MY value and discard THEIRS. Nothing has been saved. ` +
                  `Offer the change again at the number they gave, and let them agree to that.`,
              };
            }

            const summary = target.operations.map((o) => o.summary).join('; ');

            // ⛔ THE ROLLBACK POINT. Everything from here to the checkpoint is
            // state this turn has NOT yet earned the right to keep: the
            // authorisation, the attempt count and the in-flight marker all
            // presuppose a durable record that the save started. If the
            // checkpoint refuses, this snapshot is restored so the proposal
            // goes back to being an unaccepted offer — which is what the
            // refusal text tells the user, and what this tool's own opening
            // comment already required ("leaving a proposal marked in-flight
            // for a write that was never sent is its own small lie").
            const beforeAuthorise = proposals;

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

            // ⛔ THE TURN'S ONE WRITE ATTEMPT IS RESERVED HERE — BEFORE DISPATCH,
            // NOT AFTER A SUCCESSFUL RETURN.
            //
            // A receipt count is not an attempt guard, and this is the second
            // time that distinction has been got wrong on this branch. The
            // first version counted `applied.length`, which increments only on
            // success; so if accept A sent its write and THREW, the catch below
            // returned a refused tool result with the count still zero, the
            // agent loop carried on through the remaining tool calls, and an
            // already-offered B could be accepted too — both minting the same
            // key index. An exactly-once writer would then hand A's receipt
            // back for B's different operations and this controller would
            // record B as applied. That is the "Updated Monthly Churn Rate" lie
            // with a receipt attached.
            //
            // Reserving at the point of COMMITMENT closes it for all three
            // outcomes — ok, affirmative failure, and unknown — because the
            // question the guard must answer is "has this turn already
            // dispatched a write?", not "has one already succeeded?".
            acceptedThisTurn += 1;

            // Durability barrier. The key is in `proposals` now; it must be
            // on disk BEFORE the write leaves, or a crash loses it.
            try {
              await deps.checkpoint({ memory, proposals });
            } catch {
              // ⛔ ROLL BACK, OR THE REFUSAL BELOW IS FALSE WITHIN ONE TURN.
              //
              // `beginApply` has already moved the proposal to in-flight. Left
              // there, `needsReconciliation` returns it: with a writer injected
              // a LATER turn dispatches the write this turn told the user it had
              // not sent, and with no writer injected the reconciliation notice
              // owns every later turn and the conversation is stuck — a save
              // that never left, reported forever as one whose outcome is
              // unknown. Nothing was dispatched, so there is nothing to
              // reconcile and no uncertainty to carry; the honest state is the
              // one before the user's "yes" was acted on, and the offer stands
              // for them to accept again.
              //
              // The turn's write reservation is deliberately NOT released. It
              // answers "has this turn committed to dispatching?", and a second
              // accept after a store that just refused us is a risk this turn
              // has no way to price. Refusing it is a gap; admitting it would be
              // a second uncertain write.
              proposals = beforeAuthorise;
              return {
                type: 'refused',
                content:
                  'I could not record that I was about to save, so I have not sent it. Nothing has ' +
                  'changed. Tell the user the save did not go through and they can try again.',
              };
            }

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

  // What the user established this turn goes into the record BEFORE the turn
  // is composed, so a later reader sees it alongside everything else from
  // this turn rather than a turn late. Ids are deterministic and injected.
  loopResult.remembered.forEach((batch, batchIndex) => {
    batch.items.forEach((item, itemIndex) => {
      memory = recordItem(memory, {
        id: input.idFor('remembered', batchIndex * 100 + itemIndex),
        kind: item.kind,
        text: item.text,
        source_turn_id: input.turnId,
        recorded_at: input.now,
        ...(item.supersedes === undefined ? {} : { supersedes: item.supersedes }),
      });
    });
  });

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
