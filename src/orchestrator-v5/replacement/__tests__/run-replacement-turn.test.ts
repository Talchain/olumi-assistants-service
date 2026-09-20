/**
 * ONE CONNECTED JOURNEY, and the ways it is allowed to fail.
 *
 * The headline case walks the sequence that broke in the live sessions:
 *   hold what the user said → offer a change → they agree on a LATER turn →
 *   it saves → the state is reloaded → the product reports it accurately.
 *
 * Everything runs offline: the model is a script and the write path is a
 * fake. No network, no credentials, no spend, no database.
 */

import { describe, expect, it, vi } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY, liveItemsOfKind, recordItem } from '../conversation-memory.js';
import {
  EMPTY_PROPOSAL_STORE,
  MAX_APPLY_ATTEMPTS,
  appliedProposals,
  needsReconciliation,
  openProposals,
  unresolvedProposals,
  withdrawProposal,
  type ProposalStore,
} from '../proposal-store.js';
import type { ConversationMemory } from '../conversation-memory.js';
import type { AgentTool, ChatWithToolsLike } from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import {
  ACCEPT_TOOL_NAME,
  runReplacementTurn,
  type ApplyOperations,
  type ReplacementTurnDeps,
  type ReplacementTurnInput,
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

/** The change the model offers: one option's effect on one factor. */
/** Tests get a working checkpoint; production gets one from the store. A
 *  write is REFUSED without one, which is pinned separately below. */
const ck = async (): Promise<void> => undefined;

const OFFERED_OPS = [
  { op: 'update_node', path: '/nodes/opt-parity/data/interventions/f-churn', value: 0.4 },
];

const proposeParity: AgentTool = {
  kind: 'propose',
  definition: {
    name: 'set_option_effect',
    description: 'propose an option effect',
    input_schema: { type: 'object', properties: {} },
  },
  execute: () => ({
    type: 'proposed',
    summary: 'Set what Full Parity does to Monthly Churn Rate to 0.4',
    operations: OFFERED_OPS,
  }),
};

function baseInput(over: Partial<ReplacementTurnInput> = {}): ReplacementTurnInput {
  return {
    message: 'hello',
    history: [],
    memory: EMPTY_CONVERSATION_MEMORY,
    proposals: EMPTY_PROPOSAL_STORE,
    modelRevision: 'rev-1',
    workspaceSummary: 'Four options, nine factors.',
    tools: [proposeParity],
    turnId: 'turn-1',
    now: '2026-09-20T12:00:00.000Z',
    idFor: (purpose, i) => `${purpose}-${i}`,
    ...over,
  };
}

function okWrite(receiptId = 'receipt-1', newRev?: string): ApplyOperations {
  return async () => ({ ok: true as const, receiptId, ...(newRev ? { newModelRevision: newRev } : {}) });
}

/** Everything the next turn would load back. Round-tripped through JSON so
 *  the test proves the state actually survives being stored. */
function reload(r: { memory: ConversationMemory; proposals: ProposalStore }): {
  memory: ConversationMemory;
  proposals: ProposalStore;
} {
  return JSON.parse(JSON.stringify({ memory: r.memory, proposals: r.proposals }));
}

describe('the connected journey', () => {
  it('holds a fact, offers a change, saves it on a later turn, and reports it accurately after a reload', async () => {
    const seen: Parameters<ApplyOperations>[0][] = [];
    const write: ApplyOperations = async (arg) => {
      seen.push(arg);
      return { ok: true, receiptId: 'receipt-1', newModelRevision: 'rev-2' };
    };

    // ---- TURN 1. The user states something. It is held as HIS fact.
    let memory = recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'f1', kind: 'user_fact', text: 'Churn is 3% a month', source_turn_id: 'turn-1',
      recorded_at: '2026-09-20T12:00:00.000Z',
    });

    // ---- TURN 2. The assistant offers a change. NOTHING is saved.
    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2', memory, message: 'What would full parity do to churn?',
        idFor: (p, i) => `${p}-t2-${i}`,
      }),
      {
        chatWithTools: scripted([
          call('set_option_effect', {}),
          say('If full parity cut churn by 0.4 of its range, that is a big claim — shall I put it in?'),
        ]),
        checkpoint: ck, applyOperations: write,
      },
    );
    expect(seen).toHaveLength(0);
    expect(openProposals(t2.proposals)).toHaveLength(1);
    expect(liveItemsOfKind(t2.memory, 'ai_suggestion')).toHaveLength(1);
    // Not yet a change. This is the distinction the old path collapsed.
    expect(liveItemsOfKind(t2.memory, 'authorised_change')).toHaveLength(0);

    const proposalId = openProposals(t2.proposals)[0]!.id;

    // ---- TURN 3, AFTER A RELOAD. He agrees. It saves.
    const loaded = reload(t2);
    const t3 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-3',
        message: 'Yes, go ahead and make that change.',
        memory: loaded.memory,
        proposals: loaded.proposals,
        idFor: (p, i) => `${p}-t3-${i}`,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: proposalId, user_agreement_quote: 'Yes, go ahead' }),
          say("Done — that's saved."),
        ]),
        checkpoint: ck, applyOperations: write,
      },
    );

    expect(t3.applied).toEqual([{ proposalId, receiptId: 'receipt-1' }]);
    expect(t3.newModelRevision).toBe('rev-2');
    expect(appliedProposals(t3.proposals)).toHaveLength(1);

    // The write received EXACTLY what was offered — not something re-derived
    // from "Yes, go ahead and make that change."
    expect(seen).toHaveLength(1);
    expect(seen[0]?.operations[0]?.detail).toEqual({ operations: OFFERED_OPS });
    expect(seen[0]?.modelRevision).toBe('rev-1');
    expect(seen[0]?.idempotencyKey).toBeTruthy();

    // ---- TURN 4, AFTER ANOTHER RELOAD. The record supports the claim.
    const after = reload(t3);
    const change = liveItemsOfKind(after.memory, 'authorised_change');
    expect(change).toHaveLength(1);
    expect(change[0]?.text).toBe('Set what Full Parity does to Monthly Churn Rate to 0.4');
    expect(change[0]?.proposal_id).toBe(proposalId);
    expect(change[0]?.receipt_id).toBe('receipt-1');
    // And the user's own fact is still his, still distinguishable.
    expect(liveItemsOfKind(after.memory, 'user_fact')[0]?.text).toBe('Churn is 3% a month');

    // The next prompt can therefore state the change and its basis.
    const t4model = scripted([say('Churn is now modelled at 0.4 under full parity.')]);
    await runReplacementTurn(
      baseInput({
        turnId: 'turn-4', message: 'What did we change?', memory: after.memory,
        proposals: after.proposals, modelRevision: 'rev-2',
      }),
      { chatWithTools: t4model, checkpoint: ck, applyOperations: write },
    );
    const prompt = t4model.calls[0]!.system;
    expect(prompt).toContain('THE USER AUTHORISED AND THIS WAS SAVED');
    expect(prompt).toContain('Set what Full Parity does to Monthly Churn Rate to 0.4');
    expect(prompt).toContain('THE USER STATED AS FACT');
  });
});

describe('consent is checked against the actual user turn', () => {
  async function acceptWith(quote: string, message: string, write = okWrite()) {
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: quote }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message, proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, checkpoint: ck, applyOperations: write },
    );
    return { t2, model };
  }

  it('saves when the quote is the user\'s own words', async () => {
    const { t2 } = await acceptWith('yes please do that', 'Yes please do that.');
    expect(t2.applied).toHaveLength(1);
  });

  it('refuses when the model supplies words the user never said', async () => {
    const write = vi.fn(okWrite());
    const { t2, model } = await acceptWith('yes go ahead', 'What would that do to margin?', write);
    expect(t2.applied).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    expect(JSON.stringify(model.calls[1]!.messages)).toContain('not the user\'s words on this turn');
  });

  it('is insensitive to case and spacing, which are not consent signals', async () => {
    const { t2 } = await acceptWith('YES   GO\nahead', 'Yes go ahead, that sounds right.');
    expect(t2.applied).toHaveLength(1);
  });

  it('refuses an empty quote rather than treating it as vacuously present', async () => {
    const { t2 } = await acceptWith('', 'Yes go ahead.');
    expect(t2.applied).toHaveLength(0);
  });
});

describe('the accept tool refuses what it cannot honour, and says what to do instead', () => {
  it('names what IS waiting when the id is wrong', async () => {
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: okWrite(),
    });
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: 'made-up', user_agreement_quote: 'yes' }),
      say('ok'),
    ]);
    await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes', proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, checkpoint: ck, applyOperations: okWrite() },
    );
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('No change with that id is waiting');
    expect(fed).toContain('Full Parity');
  });

  /**
   * Found by a surviving mutant. Removing `markStaleForRevision` left the
   * whole suite green, because the store's own revision check refused the
   * save anyway. But the PROMPT is built from the same store — so without the
   * marking, the model is shown a dead offer as though it were live and will
   * talk about it. Defence in depth is not a reason to leave a layer unpinned.
   */
  it('does not present an offer the model has moved past as still live', async () => {
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: okWrite(),
    });
    const live = scripted([say('x')]);
    await runReplacementTurn(
      baseInput({
        turnId: 't2', message: 'and what about margin?', proposals: t1.proposals,
        memory: t1.memory, modelRevision: 'rev-MOVED',
      }),
      { chatWithTools: live, checkpoint: ck, applyOperations: okWrite() },
    );
    const prompt = live.calls[0]!.system;
    expect(prompt).not.toContain('WAITING ON THEM');

    // But the RECORD that it was suggested survives, and must. The offer
    // going stale is a fact about what can still be agreed to; it does not
    // unsay the suggestion, and a conversation that forgot having raised it
    // would be the context loss this layer exists to fix. Two different
    // things that a coarser assertion would have collapsed.
    expect(prompt).toContain('YOU SUGGESTED (not agreed, not applied)');
    expect(prompt).toContain('Full Parity');

    // Contrast control: at the SAME revision the offer IS presented, so this
    // pair cannot both pass on a prompt that simply stopped showing offers.
    const same = scripted([say('x')]);
    await runReplacementTurn(
      baseInput({
        turnId: 't2b', message: 'and what about margin?', proposals: t1.proposals,
        memory: t1.memory,
      }),
      { chatWithTools: same, checkpoint: ck, applyOperations: okWrite() },
    );
    expect(same.calls[0]!.system).toContain('WAITING ON THEM');
  });

  /**
   * Also found by a surviving mutant. Widening the tool's view from "waiting"
   * to "every proposal" left the suite green, because the store threw on the
   * bad transition and the loop turned the throw into an error tool result.
   * That works, but what the model is handed is an exception message rather
   * than a usable refusal — and a withdrawn change must read as withdrawn.
   */
  it('refuses a withdrawn change in plain terms, without a thrown error reaching the model', async () => {
    const write = vi.fn(okWrite());
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const gone = withdrawProposal(t1.proposals, id);
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: gone, memory: t1.memory }),
      { chatWithTools: model, checkpoint: ck, applyOperations: write },
    );
    expect(t2.applied).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('There is nothing waiting to be agreed to');
    expect(fed).not.toContain('ProposalStateError');
  });

  it('will not save an offer the model has moved past — a stale proposal is not waiting', async () => {
    const write = vi.fn(okWrite());
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory,
        modelRevision: 'rev-MOVED',
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
          say('ok'),
        ]),
        checkpoint: ck, applyOperations: write,
      },
    );
    expect(t2.applied).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('the three save outcomes stay apart', () => {
  async function saveWith(write: ApplyOperations) {
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, checkpoint: ck, applyOperations: write },
    );
    return { t2, model, id };
  }

  it('an affirmative "it did not save" records no change and tells the model so', async () => {
    const { t2, model } = await saveWith(async () => ({ ok: false, reason: 'the graph moved under us' }));
    expect(t2.applied).toHaveLength(0);
    expect(liveItemsOfKind(t2.memory, 'authorised_change')).toHaveLength(0);
    expect(needsReconciliation(t2.proposals)).toHaveLength(0);
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('It did not save');
    expect(fed).toContain('Nothing has changed');
  });

  it('a throw is UNKNOWN — it stays in flight and the model is told not to resolve it', async () => {
    const { t2, model } = await saveWith(async () => { throw new Error('socket hang up'); });
    expect(t2.applied).toHaveLength(0);
    expect(liveItemsOfKind(t2.memory, 'authorised_change')).toHaveLength(0);
    expect(needsReconciliation(t2.proposals)).toHaveLength(1);
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('do not say it saved or that it did not');
  });

  it('a STILL-unresolved save owns the next turn, and spends no model call at all', async () => {
    // The write path is still down on the next turn, so the retry cannot
    // settle it and the outcome stays genuinely unknown. (Handed a HEALTHY
    // write path this turn resolves and proceeds — which is the point of the
    // retry, and is pinned in "an unknown save resolves itself" below.)
    const stillDown = async (): Promise<never> => { throw new Error('socket hang up'); };
    const { t2 } = await saveWith(stillDown as unknown as ApplyOperations);
    const next = scripted([say('this must never be reached')]);
    const t3 = await runReplacementTurn(
      baseInput({
        turnId: 't3', message: 'so did that work?', proposals: t2.proposals, memory: t2.memory,
      }),
      { chatWithTools: next, checkpoint: ck, applyOperations: stillDown as unknown as ApplyOperations },
    );
    expect(next.calls).toHaveLength(0);
    expect(t3.mustReconcile).toHaveLength(1);
    expect(t3.text).toContain('not come back confirmed');
    expect(t3.text).not.toContain('this must never be reached');
  });

  it('a receipt is the only thing that writes an authorised change into the record', async () => {
    const { t2 } = await saveWith(okWrite('receipt-xyz'));
    const change = liveItemsOfKind(t2.memory, 'authorised_change');
    expect(change).toHaveLength(1);
    expect(change[0]?.receipt_id).toBe('receipt-xyz');
  });
});

describe('read-only is stated, not discovered', () => {
  it('offers no accept tool and tells the model saving is unavailable', async () => {
    const model = scripted([say('I can talk this through but not save it.')]);
    await runReplacementTurn(baseInput({ turnId: 't1' }), { chatWithTools: model });
    expect(model.calls[0]!.tools.map((t) => t.name)).not.toContain(ACCEPT_TOOL_NAME);
    expect(model.calls[0]!.system).toContain('NOT AVAILABLE ON THIS TURN');
    expect(model.calls[0]!.system).toContain('saving a change to the model on this turn');
  });

  it('still proposes, so the conversation is not degraded to read-only advice', async () => {
    const r = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
    });
    expect(openProposals(r.proposals)).toHaveLength(1);
  });
});

describe('one save per agreement', () => {
  it('a second accept of the same proposal in one turn cannot double-apply', async () => {
    const write = vi.fn(okWrite());
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const twice: Reply = {
      content: [
        { type: 'tool_use', id: 'a', name: ACCEPT_TOOL_NAME, input: { proposal_id: id, user_agreement_quote: 'yes' } },
        { type: 'tool_use', id: 'b', name: ACCEPT_TOOL_NAME, input: { proposal_id: id, user_agreement_quote: 'yes' } },
      ],
      stop_reason: 'tool_use',
    };
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes', proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: scripted([twice, say('done')]), checkpoint: ck, applyOperations: write },
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(t2.applied).toHaveLength(1);
    expect(appliedProposals(t2.proposals)).toHaveLength(1);
  });
});

/**
 * A CONVERSATION MUST NEVER GET PERMANENTLY STUCK.
 *
 * This was a real defect in this file, found by asking what had been built
 * that is WORSE than what it replaces, and reproduced by execution: a thrown
 * save left the proposal `apply_in_flight` with nothing able to resolve it,
 * so every later turn — five of them, with a perfectly healthy write path —
 * returned the reconciliation notice. A bricked conversation is worse than
 * the product being replaced.
 *
 * The resolution uses the mechanism already built: `beginApply` records the
 * idempotency key BEFORE the write, so a retry under that same key is safe
 * by construction. That is the entire reason the key is written first.
 */
describe('an unknown save resolves itself on the next turn', () => {
  async function stuck(): Promise<{ proposals: ProposalStore; memory: ConversationMemory; id: string }> {
    const boom: ApplyOperations = async () => { throw new Error('socket hang up'); };
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: boom,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
          say('ok'),
        ]),
        checkpoint: ck, applyOperations: boom,
      },
    );
    expect(needsReconciliation(t2.proposals)).toHaveLength(1);
    return { proposals: t2.proposals, memory: t2.memory, id };
  }

  it('retries under the SAME idempotency key — which is why the key is written before the write', async () => {
    const before = await stuck();
    const keyAtRest = needsReconciliation(before.proposals)[0]!.idempotency_key;
    const seen: string[] = [];
    const healthy: ApplyOperations = async (a) => { seen.push(a.idempotencyKey); return { ok: true, receiptId: 'r-late' }; };
    await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'an ordinary question', proposals: before.proposals, memory: before.memory }),
      { chatWithTools: scripted([say('a normal answer')]), checkpoint: ck, applyOperations: healthy },
    );
    expect(seen).toEqual([keyAtRest]);
  });

  it('a resolved save lets the turn proceed normally — no notice, and the model IS called', async () => {
    const before = await stuck();
    const model = scripted([say('a normal answer')]);
    const r = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'an ordinary question', proposals: before.proposals, memory: before.memory }),
      { chatWithTools: model, checkpoint: ck, applyOperations: okWrite('r-late') },
    );
    expect(r.text).toBe('a normal answer');
    expect(r.text).not.toContain('not come back confirmed');
    expect(needsReconciliation(r.proposals)).toHaveLength(0);
    expect(model.calls).toHaveLength(1);
  });

  it('the late receipt is recorded, so the record can substantiate the change', async () => {
    const before = await stuck();
    const r = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'q', proposals: before.proposals, memory: before.memory }),
      { chatWithTools: scripted([say('x')]), checkpoint: ck, applyOperations: okWrite('r-late') },
    );
    expect(r.applied).toEqual([{ proposalId: before.id, receiptId: 'r-late' }]);
    const change = liveItemsOfKind(r.memory, 'authorised_change');
    expect(change).toHaveLength(1);
    expect(change[0]?.receipt_id).toBe('r-late');
  });

  it('an affirmative "it did not land" also unsticks it, without recording a change', async () => {
    const before = await stuck();
    const r = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'q', proposals: before.proposals, memory: before.memory }),
      {
        chatWithTools: scripted([say('a normal answer')]),
        checkpoint: ck, applyOperations: async () => ({ ok: false, reason: 'the graph moved under us' }),
      },
    );
    expect(needsReconciliation(r.proposals)).toHaveLength(0);
    expect(r.applied).toHaveLength(0);
    expect(liveItemsOfKind(r.memory, 'authorised_change')).toHaveLength(0);
    expect(r.text).toBe('a normal answer');
  });

  it('a retry that throws again stays unknown and says so — but is tried again, not abandoned', async () => {
    const before = await stuck();
    let attempts = 0;
    const flaky: ApplyOperations = async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('still down');
      return { ok: true, receiptId: 'r-eventual' };
    };
    const t3 = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'q', proposals: before.proposals, memory: before.memory }),
      { chatWithTools: scripted([say('never reached')]), checkpoint: ck, applyOperations: flaky },
    );
    expect(t3.text).toContain('not come back confirmed');
    expect(needsReconciliation(t3.proposals)).toHaveLength(1);

    const t4 = await runReplacementTurn(
      baseInput({ turnId: 't4', message: 'q again', proposals: t3.proposals, memory: t3.memory }),
      { chatWithTools: scripted([say('recovered')]), checkpoint: ck, applyOperations: flaky },
    );
    expect(t4.text).toBe('recovered');
    expect(needsReconciliation(t4.proposals)).toHaveLength(0);
    expect(attempts).toBe(2);
  });

  it('with NO write path it cannot retry, and still refuses to guess — the honest stuck state', async () => {
    const before = await stuck();
    const r = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'q', proposals: before.proposals, memory: before.memory }),
      { chatWithTools: scripted([say('never reached')]) },
    );
    expect(r.text).toContain('not come back confirmed');
    expect(needsReconciliation(r.proposals)).toHaveLength(1);
  });
});

/**
 * THE RETRY IS BOUNDED, because its safety rests on a precondition this layer
 * cannot check.
 *
 * Retrying under the original idempotency key is safe only if the write path
 * honours that key. That is a property of another module — declared as a hard
 * precondition on `ApplyOperations` and asked for explicitly in the Core
 * request — and asserting properties of other modules is a mistake this
 * account has been caught making. So it gets a blast radius: a write path
 * that silently ignores the key costs at most three attempts, not one per
 * turn for the life of the conversation.
 */
describe('the retry is bounded', () => {
  it('sends a save at most MAX_APPLY_ATTEMPTS times, however many turns pass', async () => {
    let sends = 0;
    const alwaysDown: ApplyOperations = async () => { sends += 1; throw new Error('down'); };

    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: alwaysDown,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    let st = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
          say('ok'),
        ]),
        checkpoint: ck, applyOperations: alwaysDown,
      },
    );
    // Ten further turns. Without the cap this would be twelve sends.
    for (let n = 3; n <= 12; n += 1) {
      st = await runReplacementTurn(
        baseInput({ turnId: `t${n}`, message: 'q', proposals: st.proposals, memory: st.memory }),
        { chatWithTools: scripted([say('never reached')]), checkpoint: ck, applyOperations: alwaysDown },
      );
    }
    expect(sends).toBe(MAX_APPLY_ATTEMPTS);

    // ⛔ THIS ASSERTION USED TO PIN THE BRICKING AS CORRECT, and that is worth
    // recording rather than quietly rewriting.
    //
    // It read:
    //   expect(st.text).toContain('not come back confirmed');
    //   expect(needsReconciliation(st.proposals)).toHaveLength(1);
    //
    // i.e. after the cap, the proposal was STILL in flight and the notice was
    // STILL owning the turn — on turn twelve, and on every turn after it, with
    // no model call. The test was true of the code and the code was wrong: an
    // independent reviewer returned it as a P1, because the notice also
    // invited the user to answer and nothing ever read the answer.
    //
    // Bounded is not the same as resolved — that part was right, and it still
    // holds below: the outcome is never claimed in either direction. What
    // changed is that an abandoned save stops owning the conversation.
    expect(unresolvedProposals(st.proposals)).toHaveLength(1);
    expect(needsReconciliation(st.proposals)).toHaveLength(0);
    expect(appliedProposals(st.proposals)).toHaveLength(0);
    // The conversation is back: the final turn reached the model.
    expect(st.text).toBe('never reached');
    expect(st.iterations).toBeGreaterThan(0);
  });

  it('CONTRAST: a path that recovers within the cap still resolves — the cap does not break the retry', async () => {
    let sends = 0;
    const recovers: ApplyOperations = async () => {
      sends += 1;
      if (sends < MAX_APPLY_ATTEMPTS) throw new Error('down');
      return { ok: true, receiptId: 'r-eventual' };
    };
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: recovers,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    let st = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
          say('ok'),
        ]),
        checkpoint: ck, applyOperations: recovers,
      },
    );
    // Attempt 1 was the accept itself and attempt 2 the first retry, both
    // thrown; attempt 3 is the last the cap allows, and it succeeds. The
    // boundary is deliberately exercised at exactly MAX_APPLY_ATTEMPTS — a
    // cap that resolved comfortably inside its own limit would not prove
    // the limit is off-by-one correct.
    st = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'q', proposals: st.proposals, memory: st.memory }),
      { chatWithTools: scripted([say('never reached')]), checkpoint: ck, applyOperations: recovers },
    );
    expect(st.text).toContain('not come back confirmed');

    st = await runReplacementTurn(
      baseInput({ turnId: 't4', message: 'q', proposals: st.proposals, memory: st.memory }),
      { chatWithTools: scripted([say('recovered')]), checkpoint: ck, applyOperations: recovers },
    );
    expect(sends).toBe(MAX_APPLY_ATTEMPTS);
    expect(st.text).toBe('recovered');
    expect(needsReconciliation(st.proposals)).toHaveLength(0);
    expect(st.applied).toHaveLength(1);
  });
});

/**
 * THE DURABILITY BARRIER — caught in review (Codex, 20 Sep), and invisible to
 * every offline test before it, because a fake store cannot crash between
 * two statements.
 *
 * `beginApply` records the idempotency key in memory; the turn's state is
 * saved when the turn ENDS. So a crash between sending the write and
 * finishing the turn loses the key, the next turn mints a fresh one, and the
 * work is sent twice — the exact harm the key exists to prevent.
 *
 * The key must therefore be on disk BEFORE the write leaves, and if it
 * cannot be, no write is sent. Refusing to write is recoverable; writing
 * something we might not remember writing is not.
 */
/**
 * ⛔ THE MEASURED FAILURE, BROUGHT BACK FROM THE DEPLOYED PRODUCT.
 *
 * 20 Sep, staging, this controller's flag OFF. The assistant offered a limit
 * "at or below 30 … Say the word and I will make it", and the user replied:
 *
 *   "Yes, treat it as a 0-1 fraction of revenue at risk, so 30% is 0.3.
 *    Please go ahead."
 *
 * The retired path refused it, and a code trace settled that refusing was
 * CORRECT: a held change replays from its stored operations and never re-reads
 * the message, so honouring that as a bare "yes" writes the OFFER's number and
 * discards the USER's. This controller had the same exposure and no equivalent
 * guard — its only test was that the quote be the user's own words, and that
 * sentence passes it.
 */
describe("an acceptance that names its own number is not agreement to THIS offer", () => {
  async function acceptWith(message: string, quote: string) {
    const write = vi.fn(okWrite());
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: quote }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message, proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, checkpoint: ck, applyOperations: write },
    );
    return { t2, model, write, id };
  }

  it('refuses the walk\'s real message and sends NO write', async () => {
    const { t2, model, write } = await acceptWith(
      'Yes, treat it as a 0-1 fraction of revenue at risk, so 30% is 0.3. Please go ahead.',
      'Please go ahead',
    );
    expect(write).not.toHaveBeenCalled();
    expect(t2.applied).toHaveLength(0);
    // The offer is still there to be re-made at the user's number, not withdrawn.
    expect(openProposals(t2.proposals)).toHaveLength(1);
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('names a number this offer does not carry');
  });

  it('CONTRAST: a bare agreement with no number of its own still saves', async () => {
    const { t2, write } = await acceptWith('yes go ahead', 'yes go ahead');
    expect(write).toHaveBeenCalledTimes(1);
    expect(t2.applied).toHaveLength(1);
  });

  it("CONTRAST: naming the OFFER'S OWN number is agreement, not a restatement", async () => {
    // `OFFERED_OPS` carries 0.4 and the summary renders it, so this is the
    // user repeating the offer back — the guard must not fire on that.
    const { t2, write } = await acceptWith('yes, set it to 0.4', 'yes, set it to 0.4');
    expect(write).toHaveBeenCalledTimes(1);
    expect(t2.applied).toHaveLength(1);
  });

  it('refuses an ordinal too, and says so honestly rather than guessing', async () => {
    // "option 2" is a REFERENCE, not a value — and this guard cannot tell the
    // two apart, by design. Pinned so the cost of that choice is visible and
    // cannot be mistaken for an oversight.
    const { t2, write } = await acceptWith('yes, option 2', 'yes, option 2');
    expect(write).not.toHaveBeenCalled();
    expect(openProposals(t2.proposals)).toHaveLength(1);
    expect(t2.applied).toHaveLength(0);
  });
});

describe('nothing is written until the intention to write is durable', () => {
  async function acceptWithCheckpoint(
    checkpoint: ReplacementTurnDeps['checkpoint'],
    write: ApplyOperations,
  ) {
    const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
      checkpoint: ck, applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, ...(checkpoint === undefined ? {} : { checkpoint }), applyOperations: write },
    );
    return { t2, model, id };
  }

  it('sends NO write when there is no way to record having started, and changes NOTHING', async () => {
    const write = vi.fn(okWrite());
    const { t2, model } = await acceptWithCheckpoint(undefined, write);
    expect(write).not.toHaveBeenCalled();
    expect(t2.applied).toHaveLength(0);
    // Checked before any state change, so the proposal is not left marked
    // in-flight for a write that never went — that would be its own lie.
    expect(needsReconciliation(t2.proposals)).toHaveLength(0);
    expect(openProposals(t2.proposals)).toHaveLength(1);
    expect(JSON.stringify(model.calls[1]!.messages)).toContain('cannot save that safely');
  });

  it('sends NO write when the checkpoint fails, and says nothing changed', async () => {
    const write = vi.fn(okWrite());
    const { t2, model } = await acceptWithCheckpoint(async () => { throw new Error('disk gone'); }, write);
    expect(write).not.toHaveBeenCalled();
    expect(t2.applied).toHaveLength(0);
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('could not record that I was about to save');
    expect(fed).toContain('Nothing has changed');
  });

  /**
   * ⛔ THE SAME REQUIREMENT AS THE NO-CHECKPOINT CASE ABOVE, WHICH THIS PATH
   * DID NOT MEET. `beginApply` runs before the checkpoint, so a checkpoint
   * that THREW left the proposal in flight for a write that never left. The
   * refusal above says "Nothing has changed" and was true of the graph and
   * false of the state in the same turn.
   */
  it('leaves NOTHING in flight when the checkpoint fails — the offer simply stands', async () => {
    const { t2, id } = await acceptWithCheckpoint(async () => { throw new Error('disk gone'); }, okWrite());
    expect(needsReconciliation(t2.proposals)).toHaveLength(0);
    expect(openProposals(t2.proposals)).toHaveLength(1);
    // Bound by IDENTITY: the SAME offer is still acceptable, not a new one a
    // value predicate would also have matched.
    expect(openProposals(t2.proposals)[0]!.id).toBe(id);
  });

  /**
   * The consequence, measured rather than reasoned: with the proposal left in
   * flight, `needsReconciliation` returns it and the SHORT-CIRCUIT at the top
   * of the next turn owns that turn — no model call, and a notice about an
   * unknown save for a write that was never sent. With no writer injected
   * (the posture at this head) nothing can ever resolve it.
   */
  it('and the NEXT turn is an ordinary turn, not a reconciliation notice', async () => {
    const { t2 } = await acceptWithCheckpoint(async () => { throw new Error('disk gone'); }, okWrite());
    const next = scripted([say('a normal answer')]);
    const t3 = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'what were we saying?', ...reload(t2) }),
      { chatWithTools: next, checkpoint: ck },
    );
    expect(next.calls).toHaveLength(1);
    expect(t3.text).toContain('a normal answer');
  });

  it('checkpoints BEFORE the write, with the key already recorded', async () => {
    const order: string[] = [];
    let keyAtCheckpoint: string | undefined;
    const checkpoint: ReplacementTurnDeps['checkpoint'] = async ({ proposals }) => {
      order.push('checkpoint');
      keyAtCheckpoint = needsReconciliation(proposals)[0]?.idempotency_key;
    };
    const write: ApplyOperations = async (a) => {
      order.push('write');
      // The key the write carries must be the one already persisted.
      expect(keyAtCheckpoint).toBe(a.idempotencyKey);
      return { ok: true, receiptId: 'r1' };
    };
    const { t2 } = await acceptWithCheckpoint(checkpoint, write);
    expect(order).toEqual(['checkpoint', 'write']);
    expect(keyAtCheckpoint).toBeTruthy();
    expect(t2.applied).toHaveLength(1);
  });

  it('CONTRAST: with a working checkpoint the save proceeds exactly as before', async () => {
    const { t2 } = await acceptWithCheckpoint(ck, okWrite('r-ok'));
    expect(t2.applied).toHaveLength(1);
    expect(t2.applied[0]?.receiptId).toBe('r-ok');
  });
});

describe('one turn, one write — the applier makes a second save silently lossy', () => {
  /**
   * The conversational applier's idempotency is
   * `ON CONFLICT (scenario_id, turn_id) DO NOTHING`, and its conflict arm
   * RETURNs before `UPDATE scenarios SET graph` and before the handler-facts
   * insert loop (`20260806120000_v5_turn_fence_first_write_exemption.sql`).
   *
   * So a second append under one turn id writes NOTHING and hands back a
   * valid-looking row id. The adversarial review found this as "two accepts in
   * one turn share one idempotency key"; the real applier makes it worse than
   * the review could see, because the loss is total and silent rather than a
   * mis-attributed receipt.
   *
   * Pinned as a REFUSAL rather than prompt wording: two identical four-turn
   * runs at temperature 0 diverged materially on this branch, so anything that
   * must hold every time cannot be a sentence the model is asked to respect.
   */
  /** One tool, a DIFFERENT change each time it is called — the agent loop
   *  refuses two tools sharing a name, and two distinct proposals is the
   *  precondition this case needs. */
  function alternatingOffer(): AgentTool {
    let n = 0;
    return {
      kind: 'propose',
      definition: {
        name: 'set_option_effect',
        description: 'propose an option effect',
        input_schema: { type: 'object', properties: {} },
      },
      execute: () => {
        n += 1;
        return {
          type: 'proposed',
          summary: `Set what Full Parity does to factor ${n} to 0.${n}`,
          operations: [
            { op: 'update_node', path: `/nodes/opt-parity/data/interventions/f-${n}`, value: 0.4 },
          ],
        };
      },
    };
  }

  it('saves the first accept and REFUSES the second, naming what did not land', async () => {
    // Turn 1 — two distinct changes are offered and left waiting.
    const t1 = await runReplacementTurn(
      baseInput({
        message: 'what would full parity do?',
        tools: [alternatingOffer()],
      }),
      {
        chatWithTools: scripted([
          call('set_option_effect', {}),
          { content: [{ type: 'tool_use', id: 'tu2', name: 'set_option_effect', input: {} }], stop_reason: 'tool_use' },
          say('I have put both to you.'),
        ]),
        checkpoint: ck,
        applyOperations: okWrite(),
      },
    );
    const waiting = openProposals(t1.proposals);
    expect(waiting.length, 'two distinct offers must be waiting for the case to exist').toBe(2);

    // Turn 2 — the user agrees to both, and the model accepts both in one reply.
    const writes: Parameters<ApplyOperations>[0][] = [];
    const model = scripted([
          {
            content: [
              { type: 'tool_use', id: 'a1', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[0]!.id, user_agreement_quote: 'yes, do both please' } },
              { type: 'tool_use', id: 'a2', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[1]!.id, user_agreement_quote: 'yes, do both please' } },
            ],
            stop_reason: 'tool_use',
          },
      say('Done what I could.'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({
        message: 'yes, do both please',
        turnId: 'turn-2',
        ...reload(t1),
      }),
      {
        chatWithTools: model,
        checkpoint: ck,
        applyOperations: async (arg) => {
          writes.push(arg);
          return { ok: true, receiptId: `receipt-${writes.length}` };
        },
      },
    );

    // THE PROPERTY: exactly one write leaves, however many accepts the model emits.
    expect(writes.length, 'a second append on one turn id would write nothing at all').toBe(1);
    expect(appliedProposals(t2.proposals).length).toBe(1);

    // And the second proposal is still WAITING — not applied, not lost.
    expect(openProposals(t2.proposals).length).toBe(1);

    // The refusal reaches the MODEL as a tool result — it is not on the
    // returned turn, which is why this reads the recorded request rather than
    // the response. The model has to be told which change did not land, or it
    // cannot tell the user the truth about it.
    const fedBack = JSON.stringify(model.calls.at(-1)?.messages ?? []);
    expect(fedBack).toContain('ONE CHANGE PER TURN');
    expect(fedBack).toContain('has NOT been');
  });

  it('CONTROL — a single accept in a turn still saves normally', async () => {
    // Without this the assertion above would pass on a tool that had simply
    // stopped accepting anything, which would be a different defect.
    const t1 = await runReplacementTurn(baseInput({ message: 'what would parity do?' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('Offered.')]),
      checkpoint: ck,
      applyOperations: okWrite(),
    });
    const waiting = openProposals(t1.proposals);
    expect(waiting.length).toBe(1);

    const writes: Parameters<ApplyOperations>[0][] = [];
    const single = scripted([
      { content: [{ type: 'tool_use', id: 'a1', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[0]!.id, user_agreement_quote: 'yes please' } }], stop_reason: 'tool_use' },
      say('Saved.'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ message: 'yes please', turnId: 'turn-2', ...reload(t1) }),
      {
        chatWithTools: single,
        checkpoint: ck,
        applyOperations: async (arg) => {
          writes.push(arg);
          return { ok: true, receiptId: 'receipt-1' };
        },
      },
    );
    expect(writes.length).toBe(1);
    expect(appliedProposals(t2.proposals).length).toBe(1);
    expect(JSON.stringify(single.calls.at(-1)?.messages ?? [])).not.toContain('ONE CHANGE PER TURN');
  });
});

describe('⛔ an exhausted save must stop owning the turn — the bricking the cap created', () => {
  /**
   * `isRetryExhausted` stopped the retry but left the proposal
   * `apply_in_flight`, so `needsReconciliation` returned it on EVERY later
   * turn, the controller short-circuited before the agent loop, and the user
   * got the same notice forever with no model call. The notice even invited
   * them to answer, and nothing read the answer.
   *
   * Returned as a P1 by the independent reviewer. The mechanism built to stop
   * the product lying was bricking the conversation instead.
   */
  it('gives up after the cap, moves to `unresolved`, and the NEXT turn runs normally', async () => {
    const alwaysThrows: ApplyOperations = async () => {
      throw new Error('the write path is down');
    };

    // Turn 1 — offer, and accept so the proposal goes in flight and throws.
    const t1 = await runReplacementTurn(baseInput({ message: 'what would parity do?' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('Offered.')]),
      checkpoint: ck,
      applyOperations: okWrite(),
    });
    const waiting = openProposals(t1.proposals);
    expect(waiting.length).toBe(1);

    let state = reload(t1);
    const t2 = await runReplacementTurn(
      baseInput({ message: 'yes please', turnId: 'turn-2', ...state }),
      {
        chatWithTools: scripted([
          { content: [{ type: 'tool_use', id: 'a1', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[0]!.id, user_agreement_quote: 'yes please' } }], stop_reason: 'tool_use' },
          say('Checking.'),
        ]),
        checkpoint: ck,
        applyOperations: alwaysThrows,
      },
    );
    expect(needsReconciliation(t2.proposals).length).toBe(1);

    // Turns 3..N — the retry keeps throwing until the cap is reached.
    state = reload(t2);
    let last = t2;
    for (let n = 3; n <= 3 + MAX_APPLY_ATTEMPTS; n++) {
      last = await runReplacementTurn(
        baseInput({ message: 'any news?', turnId: `turn-${n}`, ...state }),
        { chatWithTools: scripted([say('normal answer')]), checkpoint: ck, applyOperations: alwaysThrows },
      );
      state = reload(last);
    }

    // THE PROPERTY: it is abandoned, not still in flight, and it claims
    // NEITHER outcome.
    const abandoned = unresolvedProposals(last.proposals);
    expect(abandoned.length).toBe(1);
    expect(appliedProposals(last.proposals).length).toBe(0);
    expect(needsReconciliation(last.proposals).length).toBe(0);

    // AND THE CONVERSATION IS BACK: a later turn reaches the model and answers
    // the user, instead of replaying the notice with zero iterations.
    const after = await runReplacementTurn(
      baseInput({ message: 'so what about pricing?', turnId: 'turn-99', ...reload(last) }),
      { chatWithTools: scripted([say('A real answer about pricing.')]), checkpoint: ck, applyOperations: alwaysThrows },
    );
    expect(after.iterations).toBeGreaterThan(0);
    expect(after.text).toBe('A real answer about pricing.');
    expect(after.text).not.toContain('Before anything else');
  });

  it('CONTRAST — before the cap it DOES still own the turn, which is correct', async () => {
    // Without this the assertion above would pass on a controller that had
    // simply stopped reconciling at all — a different defect, not a fix.
    const t1 = await runReplacementTurn(baseInput({ message: 'what would parity do?' }), {
      chatWithTools: scripted([call('set_option_effect', {}), say('Offered.')]),
      checkpoint: ck,
      applyOperations: okWrite(),
    });
    const waiting = openProposals(t1.proposals);
    const t2 = await runReplacementTurn(
      baseInput({ message: 'yes please', turnId: 'turn-2', ...reload(t1) }),
      {
        chatWithTools: scripted([
          { content: [{ type: 'tool_use', id: 'a1', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[0]!.id, user_agreement_quote: 'yes please' } }], stop_reason: 'tool_use' },
          say('Checking.'),
        ]),
        checkpoint: ck,
        applyOperations: async () => { throw new Error('down'); },
      },
    );
    const t3 = await runReplacementTurn(
      baseInput({ message: 'any news?', turnId: 'turn-3', ...reload(t2) }),
      { chatWithTools: scripted([say('should not be reached')]), checkpoint: ck, applyOperations: async () => { throw new Error('down'); } },
    );
    expect(t3.iterations).toBe(0);
    expect(unresolvedProposals(t3.proposals).length).toBe(0);
  });
});

describe('⛔ the turn\'s write attempt is reserved BEFORE dispatch, not after success', () => {
  it('a first write that THROWS still blocks a second acceptance in the same turn', async () => {
    // The first version of this guard counted `applied.length`, which
    // increments only on success. So an uncertain first write left the count
    // at zero, the loop carried on, and a second acceptance minted the SAME
    // key index — an exactly-once writer would then return the first's receipt
    // for the second's different operations. Returned as a P1 by the
    // independent reviewer.
    function alternating(): AgentTool {
      let n = 0;
      return {
        kind: 'propose',
        definition: { name: 'set_option_effect', description: 'p', input_schema: { type: 'object', properties: {} } },
        execute: () => {
          n += 1;
          return { type: 'proposed', summary: `change ${n}`, operations: [{ op: 'update_node', path: `/n/${n}`, value: 0.4 }] };
        },
      };
    }
    const t1 = await runReplacementTurn(
      baseInput({ message: 'two things', tools: [alternating()] }),
      {
        chatWithTools: scripted([
          call('set_option_effect', {}),
          { content: [{ type: 'tool_use', id: 't2', name: 'set_option_effect', input: {} }], stop_reason: 'tool_use' },
          say('Both offered.'),
        ]),
        checkpoint: ck,
        applyOperations: okWrite(),
      },
    );
    const waiting = openProposals(t1.proposals);
    expect(waiting.length).toBe(2);

    const keys: string[] = [];
    const model = scripted([
      {
        content: [
          { type: 'tool_use', id: 'a1', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[0]!.id, user_agreement_quote: 'yes to both' } },
          { type: 'tool_use', id: 'a2', name: ACCEPT_TOOL_NAME, input: { proposal_id: waiting[1]!.id, user_agreement_quote: 'yes to both' } },
        ],
        stop_reason: 'tool_use',
      },
      say('Done what I could.'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ message: 'yes to both', turnId: 'turn-2', ...reload(t1) }),
      {
        chatWithTools: model,
        checkpoint: ck,
        applyOperations: async (a) => {
          keys.push(a.idempotencyKey);
          throw new Error('uncertain');   // the FIRST write throws
        },
      },
    );

    // THE PROPERTY: exactly one write was dispatched, however many the model
    // accepted — so two proposals can never share one key index.
    expect(keys.length).toBe(1);
    expect(new Set(keys).size).toBe(1);
    // The second is untouched: not applied, not in flight.
    expect(appliedProposals(t2.proposals).length).toBe(0);
    expect(needsReconciliation(t2.proposals).length).toBe(1);
    expect(JSON.stringify(model.calls.at(-1)?.messages ?? [])).toContain('ONE CHANGE PER TURN');
  });
});
