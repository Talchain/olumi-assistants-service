/**
 * Replacement conversation layer — composing one turn.
 *
 * This is where the three standalone pieces meet: what the agent loop produced,
 * what the conversation has established, and what is awaiting consent. It is
 * pure, so the rules below are pinned by execution rather than by review.
 *
 * FOUR RULES, EACH FROM A MEASURED FAILURE
 * ----------------------------------------
 *
 * 1. AN UNRESOLVED SAVE SILENCES EVERY CLAIM ABOUT IT.
 *    A proposal whose write was started and never confirmed is neither applied
 *    nor not. The turn must say so and stop, rather than pick a story. Picking
 *    "applied" is the "Updated Monthly Churn Rate" lie; picking "not applied"
 *    invites the retry that double-applies.
 *
 * 2. WHAT THE ASSISTANT PROPOSES IS RECORDED AS A SUGGESTION, NEVER AS A FACT.
 *    Every staged change is written into conversation memory as
 *    `ai_suggestion`. Next turn therefore reads "you suggested X", not "X".
 *    That is the fabrication route closed at the point where it would open.
 *
 * 3. A STAGED CHANGE BECOMES A DURABLE PROPOSAL, BOUND TO THIS REVISION.
 *    "Yes, make that update now" failed on a live session because the offer
 *    had only ever been conversational text. Here it is an object with an id,
 *    bound to the model revision it was made against.
 *
 * 4. A TURN STOPPED BY THE ITERATION CEILING IS NOT PRESENTED AS FINISHED.
 *
 * NO CLOCK, NO RANDOMNESS
 * -----------------------
 * `now` and `idFor` are injected. A module that reads the clock cannot be
 * replayed, and replay is how this layer will be evaluated.
 */

import type { AgentLoopResult } from './agent-loop.js';
import {
  recordItem,
  type ConversationMemory,
} from './conversation-memory.js';
import {
  describeForUser,
  isRetryExhausted,
  needsReconciliation,
  openProposal,
  type Proposal,
  type ProposalStore,
} from './proposal-store.js';

export interface ComposeTurnInput {
  readonly loopResult: AgentLoopResult;
  readonly memory: ConversationMemory;
  readonly proposals: ProposalStore;
  /** The revision the graph is at right now. Proposals bind to it. */
  readonly modelRevision: string;
  readonly turnId: string;
  readonly now: string;
  /** Deterministic id source: (purpose, index) -> id. */
  readonly idFor: (purpose: 'proposal' | 'suggestion', index: number) => string;
}

export interface ComposeTurnResult {
  /** Exactly what the user sees. */
  readonly text: string;
  readonly memory: ConversationMemory;
  readonly proposals: ProposalStore;
  /** Non-empty when a save's outcome is unknown. The caller must resolve these
   *  against the mutation path before the next turn can claim anything. */
  readonly mustReconcile: readonly Proposal[];
  /** Proposal ids opened this turn, in the order they were staged. */
  readonly openedProposalIds: readonly string[];
  /** True when the loop hit its ceiling — the answer is incomplete. */
  readonly incomplete: boolean;
}

/**
 * What the user is told when a save's outcome is genuinely unknown.
 *
 * It states the position plainly and commits to finding out, because the one
 * thing that must not happen is a confident sentence in either direction.
 */
export function reconciliationNotice(pending: readonly Proposal[]): string {
  const one = pending.length === 1;
  const list = pending.map((p) => `“${p.operations.map((o) => o.summary).join('; ')}”`).join(', ');
  const opening =
    `Before anything else: ${one ? 'a change I started saving' : 'some changes I started saving'} ` +
    `${one ? 'has' : 'have'} not come back confirmed — ${list}. ` +
    `I will not tell you ${one ? 'it' : 'they'} landed or ${one ? 'it' : 'they'} didn't until I know, ` +
    `because guessing either way risks telling you something untrue or saving it twice. `;

  // ⚠ THE ENDING HAS TO MATCH WHAT IS ACTUALLY STILL HAPPENING.
  //
  // This notice used to end "Let me confirm what actually happened first" in
  // every case. Once the retry cap was added that became a LIE in exactly the
  // situation where honesty matters most: the attempts are exhausted, nothing
  // is still checking, and the sentence promises otherwise. A notice whose
  // whole purpose is to refuse to say something untrue cannot end on one.
  //
  // Caught by reading the text back against the code after the cap landed,
  // which is the check that should follow every behaviour change to a
  // module that talks to the user.
  const exhausted = pending.every((p) => isRetryExhausted(p));
  return exhausted
    ? opening +
        `I have tried to confirm ${one ? 'it' : 'them'} several times and cannot get an answer, so I have ` +
        `stopped trying rather than risk saving ${one ? 'it' : 'them'} twice. Please check whether the change ` +
        `is there, and tell me — I will take your word for it and carry on from whichever it is.`
    : opening + `I am checking what actually happened, and will tell you as soon as I know.`;
}

const INCOMPLETE_NOTICE =
  'I stopped part-way through working this out rather than run on indefinitely, ' +
  'so treat the above as unfinished — ask me to continue and I will pick it up.';

/**
 * Compose the turn.
 *
 * Deliberately does NOT try to repair or rewrite the model's prose. The old
 * path had five separate egress rewriters between the model and the user, and
 * measurably destroyed correct answers — one was discarded for containing the
 * words "The user". What this does instead is add what the record requires and
 * refuse to let an unresolved save pass silently.
 */
export function composeTurn(input: ComposeTurnInput): ComposeTurnResult {
  const { loopResult, modelRevision, turnId, now, idFor } = input;

  const pending = needsReconciliation(input.proposals);

  // RULE 1 — an unresolved save is the only thing this turn may be about.
  // Staging further changes on top of an unknown write is how a double-apply
  // gets built, so nothing new is opened while one is outstanding.
  if (pending.length > 0) {
    return {
      text: reconciliationNotice(pending),
      memory: input.memory,
      proposals: input.proposals,
      mustReconcile: pending,
      openedProposalIds: [],
      incomplete: false,
    };
  }

  let memory = input.memory;
  let proposals = input.proposals;
  const openedProposalIds: string[] = [];

  loopResult.proposed.forEach((staged, index) => {
    const proposalId = idFor('proposal', index);

    // RULE 3 — durable, bound to this revision.
    proposals = openProposal(proposals, {
      id: proposalId,
      operations: [{ kind: staged.tool, summary: staged.summary, detail: { operations: staged.operations } }],
      model_revision: modelRevision,
      proposed_at: now,
      proposed_in_turn: turnId,
    });
    openedProposalIds.push(proposalId);

    // RULE 2 — recorded as a suggestion, never as a fact.
    memory = recordItem(memory, {
      id: idFor('suggestion', index),
      kind: 'ai_suggestion',
      text: staged.summary,
      source_turn_id: turnId,
      recorded_at: now,
    });
  });

  // RULE 4 — an unfinished turn says so.
  const text = loopResult.haltedAtCeiling
    ? [loopResult.text, INCOMPLETE_NOTICE].filter((s) => s.trim().length > 0).join('\n\n')
    : loopResult.text;

  return {
    text,
    memory,
    proposals,
    mustReconcile: [],
    openedProposalIds,
    incomplete: loopResult.haltedAtCeiling,
  };
}

/**
 * The line offered alongside a pending proposal, in plain language.
 *
 * The live product showed a user its raw internal status — "The held change
 * 'Set this value' has lapsed because the model changed" — and then could not
 * explain it when he asked what it meant.
 */
export function describePendingProposal(p: Proposal): string {
  const what = p.operations.map((o) => o.summary).join('; ');
  return `${what} — ${describeForUser(p)}`;
}
