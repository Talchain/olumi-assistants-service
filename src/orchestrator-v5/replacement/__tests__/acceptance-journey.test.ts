/**
 * ⭐⭐⭐ THE ACCEPTANCE JOURNEY — the sequence the deployed product failed, run
 * end to end against the real controller.
 *
 * ── THE SEQUENCE, AND WHERE IT BROKE ──────────────────────────────────────
 * Manual session `95b92672`, 21 Sep 2026, at 23:51:27 the product produced a
 * full reasoned set of estimates for three options. At 23:51:52 the user said:
 *
 *     "This all looks reasonable. Can you update the model with these estimates?"
 *
 * and received "I could not see how to make that change against your model as
 * it stands, so I have not put anything forward."
 *
 * Settled at the bytes: `not_expressible` means the edit model returned NO TOOL
 * CALL, and the edit lane already receives a five-turn conversation slice — so
 * it HAD the estimates. **A prose offer has nothing to gate.** Of eight attempts
 * to change something in that session, one succeeded. The failure is upstream of
 * persistence: route/context/proposal → intended operation → validated tool call.
 *
 * This journey is the answer to that, and it asserts the whole chain rather than
 * any one link:
 *
 *   1. the agent proposes several concrete estimates
 *   2. the user accepts in ordinary English
 *   3. the proposal SURVIVES the turn boundary
 *   4. native values and intended entities stay BOUND to what was offered
 *   5. valid operations are constructed
 *   6. exactly ONE controlled apply occurs
 *   7. the receipt says exactly what persisted
 *   8. the next turn and a reload agree
 *
 * ── EVERY STATE CROSSING IS JSON ROUND-TRIPPED ────────────────────────────
 * `reload()` serialises and re-parses, so step 3 is a claim about what SURVIVES
 * STORAGE, not about an object kept alive in a closure. A test that passed a
 * live object between turns would prove nothing about the deployed path, where
 * the next turn may land on a different instance.
 *
 * ── AND THE ANTI-FABRICATION CONTROL, WHICH IS THE POINT OF STEP 4 ────────
 * The journey is twinned with its opposite: an acceptance naming numbers the
 * offer does not carry must be REFUSED. Without that twin, "the values are
 * bound" is consistent with a controller that simply re-reads the message —
 * which is the defect that produces a confident wrong write with a receipt
 * attached.
 */
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY, liveItemsOfKind } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, needsReconciliation, openProposals } from '../proposal-store.js';
import { ACCEPT_TOOL_NAME, runReplacementTurn } from '../run-replacement-turn.js';
import { traceAccountsForItsWrite } from '../turn-trace.js';
import { findSuccessClaimHit } from '../../compose/forbidden-user-facing-phrases.js';
import type { ConversationMemory } from '../conversation-memory.js';
import type { ProposalStore } from '../proposal-store.js';
import type { AgentTool, ChatWithToolsLike } from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import type {
  ApplyOperations,
  ReplacementTurnInput,
} from '../run-replacement-turn.js';

type Reply = { content: ToolResponseBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' };

function scripted(replies: Reply[]): ChatWithToolsLike & { calls: Parameters<ChatWithToolsLike>[0][] } {
  const calls: Parameters<ChatWithToolsLike>[0][] = [];
  let i = 0;
  const fn = (async (args: Parameters<ChatWithToolsLike>[0]) => {
    calls.push({ ...args, messages: JSON.parse(JSON.stringify(args.messages)) });
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return r!;
  }) as ChatWithToolsLike & { calls: Parameters<ChatWithToolsLike>[0][] };
  (fn as { calls: unknown }).calls = calls;
  return fn;
}

const say = (text: string): Reply => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const call = (name: string, input: Record<string, unknown>): Reply => ({
  content: [{ type: 'tool_use', id: 'tu1', name, input }],
  stop_reason: 'tool_use',
});

const ck = async (): Promise<void> => undefined;

/**
 * SEVERAL estimates in ONE proposal — the session's actual shape (one option
 * needing values on three factors), and the shape a single prose offer has to
 * become before anything can accept it.
 *
 * ⛔⛔ THE OPERATION SHAPE IS THE PRODUCER'S, AND I GOT IT WRONG TWICE.
 *
 * v1 staged `value: 5000, unit: '£'` — a NATIVE magnitude in the `value` slot —
 * and this test ASSERTED it surviving verbatim, i.e. it pinned a corruption as
 * the desired behaviour. `native-quantity-operation.ts`: *"it names the field
 * `value`, which is the ENCODED magnitude the engine computes on. Writing a
 * native `95000` there would move a `[0,1]` intervention to 95,000 and corrupt
 * the causal model."*
 *
 * v2 moved the native to `value: { raw_value, unit }` — correct for the NATIVE
 * emitter, and still not what THIS layer produces. Measured end to end against
 * the real `applyOperations` adapter, that shape is REFUSED unless the target
 * factor carries `observed_state.cap`, and I reported it as a cross-lane defect
 * before checking what the tool emits. It was a shape I typed, not one the
 * product makes.
 *
 * ⭐ WHAT THE REPLACEMENT LAYER ACTUALLY EMITS, read at its own bytes:
 * `replacement/set-option-effect.ts` takes `value: number` — documented
 * *"Normalised effect in [0, 1] … this tool does not invent one"* — and emits
 * `buildOptionEffectRawOperation` (`routing/option-effect-write.ts:1434`),
 * which is `value: { value: n }`, a whole-object replacement. **Every operation
 * this controller stages carries an ENCODED value.** So the applier's
 * `deriveValue` short-circuits on its first line and no cap is ever consulted —
 * which is why the corrected shape below commits against a factor carrying a
 * cap, a `scale_frame`, or neither.
 *
 * ⚠ AND THE QUESTION THAT SURVIVES, STATED RATHER THAN FIXED: this layer has no
 * way to express a NATIVE magnitude. A user who says "£5,000" needs the number
 * converted to `[0,1]` before it reaches the tool, and the tool's own docblock
 * puts that on the conversation. Whether the model is given the factor's scale
 * to do that is a real question and is NOT settled here.
 *
 * The lesson, three times in one night: a fixture I write agrees with my model
 * of the producer, and my model of the producer is the thing under test.
 */
const OFFERED_OPS = [
  {
    op: 'update_node',
    path: '/nodes/opt-limited-test/data/interventions/f-quality',
    value: { value: 0.55 },
    old_value: null,
    impact: 'moderate',
    rationale: 'Sets the effect value the user gave for AI Tool + Limited Budget Test on Campaign Strategic Quality.',
  },
  {
    op: 'update_node',
    path: '/nodes/opt-limited-test/data/interventions/f-budget',
    value: { value: 0.05 },
    old_value: null,
    impact: 'moderate',
    rationale: 'Sets the effect value the user gave for AI Tool + Limited Budget Test on Advertising Budget Allocated.',
  },
  {
    op: 'update_node',
    path: '/nodes/opt-limited-test/data/interventions/f-time',
    value: { value: 0.15 },
    old_value: null,
    impact: 'moderate',
    rationale: 'Sets the effect value the user gave for AI Tool + Limited Budget Test on Founder Time Commitment.',
  },
];

const OFFER_SUMMARY =
  'Set what AI Tool + Limited Budget Test does to Campaign Strategic Quality (0.55), ' +
  'Advertising Budget Allocated (0.05) and Founder Time Commitment (0.15)';

const proposeEstimates: AgentTool = {
  kind: 'propose',
  definition: {
    name: 'set_option_effect',
    description: 'propose option effects',
    input_schema: { type: 'object', properties: {} },
  },
  execute: () => ({ type: 'proposed', summary: OFFER_SUMMARY, operations: OFFERED_OPS }),
};

function baseInput(over: Partial<ReplacementTurnInput> = {}): ReplacementTurnInput {
  return {
    message: 'hello',
    history: [],
    memory: EMPTY_CONVERSATION_MEMORY,
    proposals: EMPTY_PROPOSAL_STORE,
    modelRevision: 'rev-1',
    workspaceSummary: 'Five options, three factors.',
    tools: [proposeEstimates],
    turnId: 'turn-1',
    now: '2026-09-21T00:51:00.000Z',
    idFor: (purpose, i) => `${purpose}-${i}`,
    ...over,
  };
}

/** Everything the next turn would load back, through storage. */
function reload(r: { memory: ConversationMemory; proposals: ProposalStore }): {
  memory: ConversationMemory;
  proposals: ProposalStore;
} {
  return JSON.parse(JSON.stringify({ memory: r.memory, proposals: r.proposals }));
}

/** The user's own words, verbatim from the session. */
const ORDINARY_ENGLISH = 'This all looks reasonable. Can you update the model with these estimates?';

describe('the acceptance journey the deployed product could not complete', () => {
  it('proposes estimates, accepts them in ordinary English, applies once, and agrees after a reload', async () => {
    const seen: Parameters<ApplyOperations>[0][] = [];
    const write = vi.fn<ApplyOperations>(async (args) => {
      seen.push(JSON.parse(JSON.stringify(args)));
      return { ok: true as const, receiptId: 'commit-7a1', newModelRevision: 'rev-2' };
    });

    // ── 1. the agent proposes several concrete estimates ──────────────────
    const t1 = await runReplacementTurn(
      baseInput({ turnId: 'turn-1', message: 'Can you help me generate estimates for all of these?' }),
      { chatWithTools: scripted([call('set_option_effect', {}), say('Here are three estimates. Shall I put them in?')]),
        checkpoint: ck, applyOperations: write },
    );
    const offered = openProposals(t1.proposals);
    expect(offered, 'one proposal, staged by one tool call').toHaveLength(1);
    // ⭐ The three estimates ride as the DETAIL of one staged operation. That
    // is the contract: the TOOL CALL is the operation, the patch is its detail
    // — and the native magnitudes survive verbatim, which is what a prose offer
    // cannot do and why the session's accepted estimates went nowhere.
    expect(offered[0]!.operations).toHaveLength(1);
    expect(offered[0]!.operations[0]!.kind).toBe('set_option_effect');
    expect(offered[0]!.operations[0]!.detail).toEqual({ operations: OFFERED_OPS });
    expect(write, 'proposing must never write').not.toHaveBeenCalled();
    const proposalId = offered[0]!.id;

    // ── 3. the proposal survives the turn boundary, THROUGH STORAGE ───────
    const carried = reload(t1);
    expect(openProposals(carried.proposals).map((p) => p.id)).toEqual([proposalId]);

    // ── 2. the user accepts in ordinary English ───────────────────────────
    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: ORDINARY_ENGLISH,
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: proposalId, user_agreement_quote: 'update the model with these estimates' }),
          say('Done — those three are in.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    // ── 6. exactly ONE controlled apply ───────────────────────────────────
    expect(write, 'one turn, one write').toHaveBeenCalledTimes(1);

    // ── 4 + 5. the operations sent are the ones OFFERED, byte for byte ────
    // Bound by identity to the offer, never re-derived from the message: the
    // native £5,000 and the entity path both survive unchanged.
    // Byte-identical to what was staged.
    expect(seen[0]!.operations).toEqual(offered[0]!.operations);
    expect(seen[0]!.operations[0]!.detail).toEqual({ operations: OFFERED_OPS });
    // ⭐ THE VALUE IS IN THE SLOT THE WRITER READS IT FROM, and it is an OBJECT
    // carrying an ENCODED model value — what `buildOptionEffectRawOperation`
    // emits and what this layer can actually produce. The negative half is what
    // stops a native magnitude being put back into that slot, which is the
    // shape that corrupts the causal model.
    const budgetOp = (seen[0]!.operations[0]!.detail as { operations: Array<Record<string, unknown>> })
      .operations.find((o) => String(o.path).endsWith('f-budget'))!;
    expect(budgetOp.value).toEqual({ value: 0.05 });
    expect(budgetOp.value).not.toHaveProperty('raw_value');
    expect(seen[0]!.proposalId).toBe(proposalId);
    expect(seen[0]!.modelRevision).toBe('rev-1');
    expect(seen[0]!.idempotencyKey, 'a key the writer can dedupe on').toBeTruthy();

    // ── 7. the receipt says exactly what persisted ────────────────────────
    expect(t2.applied).toEqual([{ proposalId, receiptId: 'commit-7a1' }]);
    expect(t2.newModelRevision).toBe('rev-2');
    const changes = liveItemsOfKind(t2.memory, 'authorised_change');
    expect(changes, 'exactly one recorded change').toHaveLength(1);
    expect(changes[0]!.text, 'the receipt names the OFFER, not the message').toBe(OFFER_SUMMARY);
    expect(changes[0]!.proposal_id).toBe(proposalId);
    expect(changes[0]!.receipt_id).toBe('commit-7a1');

    // ⭐ AND WHAT THE USER ACTUALLY READS — the half an internal assertion
    // cannot see. Everything above is state; this is the product speaking.
    // The accept tool licenses the claim explicitly ("You may tell the user it
    // is done. This is the ONLY circumstance in which you may say that"), so on
    // a committed turn the reply is allowed to say so.
    expect(t2.text, 'the user is told something').not.toBe('');

    // ── 8. the next turn and a reload agree ───────────────────────────────
    const after = reload(t2);
    expect(needsReconciliation(after.proposals), 'nothing left unresolved').toHaveLength(0);
    expect(openProposals(after.proposals), 'the offer is spent, not still open').toHaveLength(0);
    const t3 = await runReplacementTurn(
      baseInput({ turnId: 'turn-3', message: 'did that save?', modelRevision: 'rev-2', ...after }),
      { chatWithTools: scripted([say('Yes — all three are in the model.')]), checkpoint: ck, applyOperations: write },
    );
    expect(write, 'no second write on a later turn').toHaveBeenCalledTimes(1);
    expect(liveItemsOfKind(t3.memory, 'authorised_change')[0]!.receipt_id).toBe('commit-7a1');

    // ── the observability contract, over the same journey ─────────────────
    expect(t2.trace.correlation_id, 'one id spanning the turn').toBe('turn-2');
    expect(t2.trace.controller).toBe('replacement');
    expect(t2.trace.accepted_proposal_id).toBe(proposalId);
    expect(t2.trace.intended_operation_kinds).toEqual(['set_option_effect']);
    expect(t2.trace.tools_called).toContain(ACCEPT_TOOL_NAME);
    expect(t2.trace.refusals).toEqual([]);
    expect(t2.trace.write_attempted).toBe(true);
    expect(t2.trace.write_committed).toBe(true);
    expect(t2.trace.receipt_id).toBe('commit-7a1');
    expect(t2.trace.new_model_revision).toBe('rev-2');
    expect(t2.trace.outcome).toBe('completed');
    expect(traceAccountsForItsWrite(t2.trace)).toBe(true);
  });

  /**
   * ⛔ THE ANTI-FABRICATION TWIN, and the reason step 4 is a real assertion
   * rather than a restatement of the fixture.
   *
   * The session's other failure was the mirror of this: a held change replays
   * from its stored patch and never re-reads the message, so honouring an
   * acceptance that RESTATES a value would write the offer's number and discard
   * the user's — with a receipt attached. The offer's operations must be what
   * is written, and an acceptance carrying its own figures must be refused
   * rather than reinterpreted.
   */
  it('REFUSES an acceptance that names numbers the offer does not carry, and writes nothing', async () => {
    const write = vi.fn<ApplyOperations>(async () => ({ ok: true as const, receiptId: 'must-not-happen' }));
    const t1 = await runReplacementTurn(
      baseInput({ turnId: 'turn-1' }),
      { chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]), checkpoint: ck, applyOperations: write },
    );
    const proposalId = openProposals(t1.proposals)[0]!.id;

    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        // Same agreement, but it carries a figure the offer does not.
        message: 'Yes, go ahead, but make the budget £8,000.',
        ...reload(t1),
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: proposalId, user_agreement_quote: 'Yes, go ahead' }),
          say('I have not changed anything yet.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write, 'nothing may be written').not.toHaveBeenCalled();
    expect(t2.applied).toHaveLength(0);
    expect(openProposals(t2.proposals), 'the offer still stands').toHaveLength(1);
    // ⭐⭐ AND THE USER IS NOT TOLD IT SAVED. This is the layer's whole purpose,
    // and it was previously unasserted — every other check here is about state,
    // which a user never sees. The oracle is the repo's OWN success-claim
    // detector (`findSuccessClaimHit`), not a phrase list written here: a list
    // of my own would go stale the day the copy is reworded, and would be the
    // hand-maintained mirror this estate pays for (trap 12).
    expect(
      findSuccessClaimHit(t2.text),
      `the reply must not claim a save that did not happen: ${JSON.stringify(t2.text)}`,
    ).toBeNull();
    // The record says WHY, by code — the thing the estate could not reconstruct.
    expect(t2.trace.refusals).toContain('acceptance_names_other_number');
    expect(t2.trace.write_attempted).toBe(false);
    expect(traceAccountsForItsWrite(t2.trace)).toBe(true);
  });

  /**
   * The third case the record exists for: a write that was SENT and did not
   * come back. The outcome is genuinely unknown, and the invariant is that the
   * turn still ACCOUNTS for it — attempted, not committed, with a reason.
   */
  it('accounts for a dispatched write whose outcome never returned', async () => {
    const write = vi.fn<ApplyOperations>(async () => { throw new Error('socket closed'); });
    const t1 = await runReplacementTurn(
      baseInput({ turnId: 'turn-1' }),
      { chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]), checkpoint: ck, applyOperations: write },
    );
    const proposalId = openProposals(t1.proposals)[0]!.id;
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 'turn-2', message: ORDINARY_ENGLISH, ...reload(t1) }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: proposalId, user_agreement_quote: 'update the model with these estimates' }),
          say('I am checking.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(t2.trace.write_attempted).toBe(true);
    expect(t2.trace.write_committed).toBe(false);
    expect(t2.trace.refusals).toContain('write_outcome_unknown');
    expect(t2.trace.receipt_id).toBeNull();
    // ⭐ The invariant that makes the record worth keeping: a dispatched write
    // never ends unexplained. `write_attempted && !write_committed` with no
    // reason is the shape in which a user's change disappears and nobody can
    // say what happened.
    expect(traceAccountsForItsWrite(t2.trace)).toBe(true);
    expect(t2.applied, 'nothing may be claimed as applied').toHaveLength(0);
    // ⭐⭐ THE HARDEST CASE, AND THE ONE THE WHOLE LAYER EXISTS FOR: the write
    // was SENT and the outcome is unknown. The user must be told neither that
    // it landed nor that it did not.
    expect(
      findSuccessClaimHit(t2.text),
      `an unknown outcome must not read as a save: ${JSON.stringify(t2.text)}`,
    ).toBeNull();
    expect(t2.text, 'and the turn must say something, not go silent').not.toBe('');
  });
});
