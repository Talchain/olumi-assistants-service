/**
 * ⭐⭐ "YES, BUT MAKE IT 0.6" — driven end to end through the REAL tool and the
 * REAL controller, because a store primitive nobody calls is not a capability.
 *
 * The harm being closed: an authorised change replays from its STORED
 * operations and never re-reads the user's message. So accepting here would
 * save 0.55 — the number WE offered — and hand back a receipt saying it saved
 * what they asked for. The confirmation predicate is right to refuse a value
 * restatement; amend is the route that honours it instead.
 *
 * ⚠ SCOPE, STATED. The model is SCRIPTED. This proves the machinery is
 * reachable and behaves — it is NOT evidence that a live model reaches for
 * `amends_proposal_id` at the right moment. That needs a live harness and is
 * not claimed here.
 */
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, openProposals } from '../proposal-store.js';
import { ACCEPT_TOOL_NAME, runReplacementTurn } from '../run-replacement-turn.js';
import { createSetOptionEffectTool } from '../propose-tools.js';
import type { EffectGraph } from '../set-option-effect.js';
import type { ProposalStore } from '../proposal-store.js';
import type { ConversationMemory } from '../conversation-memory.js';
import type { ChatWithToolsLike } from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import type { ApplyOperations, ReplacementTurnInput } from '../run-replacement-turn.js';

const GRAPH = {
  nodes: [
    { id: 'd1', kind: 'decision', label: 'Question' },
    { id: 'o1', kind: 'option', label: 'Full Parity' },
    { id: 'f1', kind: 'factor', label: 'Monthly Churn Rate', prior: { distribution: 'uniform', range_min: 0, range_max: 0.2 } },
  ],
  edges: [{ from: 'o1', to: 'f1' }],
} as unknown as EffectGraph;

// ⭐ THE REAL TOOL, not a stand-in. A fixture that mimicked its amends
// passthrough would be testing my model of it rather than it.
const effectTool = createSetOptionEffectTool({ getGraph: () => GRAPH });

type Reply = { content: ToolResponseBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' };
function scripted(replies: Reply[]): ChatWithToolsLike {
  let i = 0;
  return (async () => {
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return r!;
  }) as ChatWithToolsLike;
}
const say = (text: string): Reply => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const call = (name: string, input: Record<string, unknown>): Reply => ({
  content: [{ type: 'tool_use', id: 'tu1', name, input }],
  stop_reason: 'tool_use',
});
const ck = async (): Promise<void> => undefined;

/**
 * ⚠ `idFor` INCLUDES THE TURN ID, because production's does.
 *
 * The sibling suites mint `${purpose}-${index}`, which collides across turns —
 * turn 2's first proposal gets the same id as turn 1's. That fixture cannot
 * express an amendment at all: the store correctly refuses an amendment that
 * reuses the id it replaces, and the refusal fires on the FIXTURE's collision
 * rather than on anything the product would do. Production mints
 * `proposal-<turnId>-<index>` (see `openProposal`'s docblock on stable ids),
 * so this models the real thing rather than the convenient thing.
 */
function baseInput(over: Partial<ReplacementTurnInput> = {}): ReplacementTurnInput {
  const turnId = over.turnId ?? 'turn-1';
  return {
    message: 'hello',
    history: [],
    memory: EMPTY_CONVERSATION_MEMORY,
    proposals: EMPTY_PROPOSAL_STORE,
    modelRevision: 'rev-1',
    workspaceSummary: 'One option, one factor.',
    tools: [effectTool],
    turnId,
    now: '2026-09-21T00:51:00.000Z',
    ...over,
    // After the spread: an override must not be able to desync `idFor` from
    // the turn id it encodes.
    idFor: (purpose: string, i: number) => `${purpose}-${turnId}-${i}`,
  };
}

/** Everything the next turn would load back, THROUGH storage. */
const reload = (r: { memory: ConversationMemory; proposals: ProposalStore }) =>
  JSON.parse(JSON.stringify({ memory: r.memory, proposals: r.proposals })) as {
    memory: ConversationMemory;
    proposals: ProposalStore;
  };

describe('the user changes the number instead of accepting it', () => {
  it('supersedes the offer, reopens the amended one, and finally saves THEIR number', async () => {
    const seen: Parameters<ApplyOperations>[0][] = [];
    const write = vi.fn<ApplyOperations>(async (args) => {
      seen.push(JSON.parse(JSON.stringify(args)));
      return { ok: true as const, receiptId: 'commit-1', newModelRevision: 'rev-2' };
    });

    // ── turn 1: we offer 0.55 ────────────────────────────────────────────
    const t1 = await runReplacementTurn(
      baseInput({ turnId: 'turn-1', message: 'What should Full Parity do to churn?' }),
      {
        chatWithTools: scripted([
          call('set_option_effect', { option_id: 'o1', factor_id: 'f1', value: 0.55 }),
          say('I suggest 0.55. Shall I put that in?'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );
    const offered = openProposals(t1.proposals);
    expect(offered, 'one offer waiting').toHaveLength(1);
    const offerId = offered[0]!.id;

    // ── turn 2: "yes, but make it 0.6" ───────────────────────────────────
    const carried = reload(t1);
    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Yes, but make it 0.6.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call('set_option_effect', {
            option_id: 'o1',
            factor_id: 'f1',
            value: 0.6,
            amends_proposal_id: offerId,
          }),
          say('Changed to 0.6 — shall I save that?'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    // ⛔ NOTHING IS SAVED BY AN AMENDMENT. This is the load-bearing assertion:
    // the tool is `kind: 'propose'`, so the loop cannot let it record consent.
    expect(write, 'amending must never write').not.toHaveBeenCalled();

    const original = t2.proposals.proposals.find((p) => p.id === offerId)!;
    expect(original.status, 'the 0.55 offer is off the table').toBe('superseded');

    const waiting = openProposals(t2.proposals);
    expect(waiting, 'exactly one thing waiting — not both').toHaveLength(1);
    const amendmentId = waiting[0]!.id;
    expect(amendmentId).not.toBe(offerId);
    expect(waiting[0]!.amends).toBe(offerId);
    expect(waiting[0]!.status, 'the amended number goes BACK to the user').toBe('open');

    // ── POSITIVE CONTROL: the superseded offer can no longer be accepted ──
    const stale = await runReplacementTurn(
      baseInput({
        turnId: 'turn-3',
        message: 'go ahead',
        memory: reload(t2).memory,
        proposals: reload(t2).proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: offerId, user_agreement_quote: 'go ahead' }),
          say('...'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );
    expect(write, 'the 0.55 offer must not be savable after amendment').not.toHaveBeenCalled();
    expect(stale.trace?.refusals ?? []).toContain('proposal_not_waiting');

    // ── turn 4: they agree to the AMENDED number ─────────────────────────
    const back = reload(t2);
    const t4 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-4',
        message: 'Yes, save it.',
        memory: back.memory,
        proposals: back.proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: amendmentId, user_agreement_quote: 'Yes, save it.' }),
          say('Saved.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write, 'one write, at the end, for the amended number').toHaveBeenCalledTimes(1);
    expect(t4.applied).toEqual([{ proposalId: amendmentId, receiptId: 'commit-1' }]);

    // ⭐ THE WHOLE POINT: the bytes sent carry the USER'S 0.6, not our 0.55.
    const sent = JSON.stringify(seen[0]!.operations);
    expect(sent).toContain('0.6');
    expect(sent, 'the number we offered must not be what got saved').not.toContain('0.55');
  });
});
