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
  appliedProposals,
  needsReconciliation,
  openProposals,
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
        applyOperations: write,
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
        applyOperations: write,
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
      { chatWithTools: t4model, applyOperations: write },
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
      applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: quote }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message, proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, applyOperations: write },
    );
    return { t2, model, id };
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
      applyOperations: okWrite(),
    });
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: 'made-up', user_agreement_quote: 'yes' }),
      say('ok'),
    ]);
    await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes', proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, applyOperations: okWrite() },
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
      applyOperations: okWrite(),
    });
    const live = scripted([say('x')]);
    await runReplacementTurn(
      baseInput({
        turnId: 't2', message: 'and what about margin?', proposals: t1.proposals,
        memory: t1.memory, modelRevision: 'rev-MOVED',
      }),
      { chatWithTools: live, applyOperations: okWrite() },
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
      { chatWithTools: same, applyOperations: okWrite() },
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
      applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const gone = withdrawProposal(t1.proposals, id);
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: gone, memory: t1.memory }),
      { chatWithTools: model, applyOperations: write },
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
      applyOperations: write,
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
        applyOperations: write,
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
      applyOperations: write,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const model = scripted([
      call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
      say('ok'),
    ]);
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      { chatWithTools: model, applyOperations: write },
    );
    return { t2, model };
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
      { chatWithTools: next, applyOperations: stillDown as unknown as ApplyOperations },
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
      applyOperations: write,
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
      { chatWithTools: scripted([twice, say('done')]), applyOperations: write },
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
      applyOperations: boom,
    });
    const id = openProposals(t1.proposals)[0]!.id;
    const t2 = await runReplacementTurn(
      baseInput({ turnId: 't2', message: 'yes go ahead', proposals: t1.proposals, memory: t1.memory }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'yes go ahead' }),
          say('ok'),
        ]),
        applyOperations: boom,
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
      { chatWithTools: scripted([say('a normal answer')]), applyOperations: healthy },
    );
    expect(seen).toEqual([keyAtRest]);
  });

  it('a resolved save lets the turn proceed normally — no notice, and the model IS called', async () => {
    const before = await stuck();
    const model = scripted([say('a normal answer')]);
    const r = await runReplacementTurn(
      baseInput({ turnId: 't3', message: 'an ordinary question', proposals: before.proposals, memory: before.memory }),
      { chatWithTools: model, applyOperations: okWrite('r-late') },
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
      { chatWithTools: scripted([say('x')]), applyOperations: okWrite('r-late') },
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
        applyOperations: async () => ({ ok: false, reason: 'the graph moved under us' }),
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
      { chatWithTools: scripted([say('never reached')]), applyOperations: flaky },
    );
    expect(t3.text).toContain('not come back confirmed');
    expect(needsReconciliation(t3.proposals)).toHaveLength(1);

    const t4 = await runReplacementTurn(
      baseInput({ turnId: 't4', message: 'q again', proposals: t3.proposals, memory: t3.memory }),
      { chatWithTools: scripted([say('recovered')]), applyOperations: flaky },
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
