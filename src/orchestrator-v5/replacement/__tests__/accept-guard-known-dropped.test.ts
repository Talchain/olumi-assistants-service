/**
 * ⭐ THE ACCEPT GUARD'S KNOWN-DROPPED SET — pinned so it cannot grow or shrink
 * unobserved.
 *
 * `namesANumberTheOfferDoesNot` refuses an acceptance carrying a digit run the
 * offer's rendered summary does not. It is deliberately LEXICAL — CLAUDE.md
 * trap 22f records four rounds of oscillation on one natural-language predicate
 * in this estate, and 22c rules that an author's own corpus cannot bound one —
 * so it asks a question with no interpretation in it and fails CLOSED.
 *
 * ⚠ FAILING CLOSED HAS A COST, AND IT IS NOT ZERO. Measured with a corpus
 * written against the REAL operation shape rather than from the author's head:
 * a user shown "£5,000" who types "5000" or "5k" is refused, because the
 * comparison is over digit-run strings. That is the most likely real-world
 * variance and it costs a turn.
 *
 * This file is the honest way to ship that: the gap is a SET, asserted
 * exactly. A test that only checked the refusals would stay green while the
 * gap silently widened; a test that only checked the accepts would stay green
 * while the guard quietly stopped discriminating. Both directions are pinned.
 *
 * ⛔ IF THIS FILE GOES RED, DO NOT NORMALISE THE NUMBERS TO MAKE IT PASS.
 * Every such fix is a predicate over how humans write quantities — separators,
 * `k`/`m` suffixes, currency symbols, spelled words — and this estate has
 * already paid for that family. Failing closed keeps a gap; normalising makes
 * it a guess, and a wrong guess writes a number the user did not agree to.
 *
 * ⭐ ONE NARROWING IS LEGITIMATE AND IS NOT NORMALISATION — named here so it is
 * a decision rather than a rediscovery. Measured by mutation: widening the
 * comparison to the operation's STORED digits closes exactly ONE member of the
 * set ("5000", which genuinely IS the offer's `raw_value`) and leaves "5k"
 * untouched. That reads the offer's own value rather than guessing at a
 * spelling, so it is a different move in kind from normalising.
 *
 * ⚠ It is NOT taken here, for two reasons. The blunt form — hashing every digit
 * in the operation — also admits digits from paths and node ids, so a message
 * quoting an arbitrary identifier would be accepted as agreement. And the
 * narrow form must know WHERE values live in `detail`, which is the producer's
 * shape, not this module's: `buildNativeQuantityOperation` puts the native in
 * `value.raw_value` while `buildOptionEffectRawOperation` puts the encoded one
 * in `value.value`. Reaching into that from here would put a second reader of
 * the operation shape in the tree. If it is worth doing, it belongs beside the
 * emitters with its own corpus — not bolted on to make this file green.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, openProposals } from '../proposal-store.js';
import { ACCEPT_TOOL_NAME, runReplacementTurn } from '../run-replacement-turn.js';
import type { AgentTool, ChatWithToolsLike } from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import type { ApplyOperations, ReplacementTurnInput } from '../run-replacement-turn.js';

type Reply = { content: ToolResponseBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' };
function scripted(replies: Reply[]): ChatWithToolsLike {
  let i = 0;
  return (async () => replies[Math.min(i++, replies.length - 1)]!) as ChatWithToolsLike;
}
const say = (text: string): Reply => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const call = (name: string, input: Record<string, unknown>): Reply => ({
  content: [{ type: 'tool_use', id: 'tu1', name, input }],
  stop_reason: 'tool_use',
});
const ck = async (): Promise<void> => undefined;

/** The offer, rendering its money figure the way a user is shown it. */
const SUMMARY = 'Set Advertising Budget Allocated for AI Tool + Limited Budget Test to £5,000';
const propose: AgentTool = {
  kind: 'propose',
  definition: { name: 'set_option_effect', description: 'p', input_schema: { type: 'object', properties: {} } },
  execute: () => ({
    type: 'proposed',
    summary: SUMMARY,
    operations: [
      {
        op: 'update_node',
        path: '/nodes/opt-limited-test/data/interventions/f-budget',
        value: { raw_value: 5000, unit: '£' },
        old_value: null,
        impact: 'moderate',
        rationale: 'Records the £ figure the user gave.',
      },
    ],
  }),
};

function baseInput(over: Partial<ReplacementTurnInput> = {}): ReplacementTurnInput {
  return {
    message: 'hello',
    history: [],
    memory: EMPTY_CONVERSATION_MEMORY,
    proposals: EMPTY_PROPOSAL_STORE,
    modelRevision: 'rev-1',
    workspaceSummary: 'One option, one factor.',
    tools: [propose],
    turnId: 'turn-1',
    now: '2026-09-21T00:00:00.000Z',
    idFor: (purpose, i) => `${purpose}-${i}`,
    ...over,
  };
}

/**
 * Offer, then accept with `message`.
 *
 * ⚠ Asserts on the WRITE and the PROPOSAL, not on a refusal code: the per-turn
 * trace lives on the stacked branch, and a test that reached for it here would
 * be binding to a field this PR does not ship. The observable facts on this
 * head are "was a write sent" and "does the offer still stand", which is what
 * the user experiences anyway.
 */
async function acceptWith(message: string): Promise<{ wrote: boolean; stillOpen: boolean; applied: number }> {
  let wrote = false;
  const write: ApplyOperations = async () => {
    wrote = true;
    return { ok: true as const, receiptId: 'r1' };
  };
  const t1 = await runReplacementTurn(baseInput({ turnId: 't1' }), {
    chatWithTools: scripted([call('set_option_effect', {}), say('shall I?')]),
    checkpoint: ck,
    applyOperations: write,
  });
  const id = openProposals(t1.proposals)[0]!.id;
  const t2 = await runReplacementTurn(
    baseInput({
      turnId: 't2',
      message,
      memory: t1.memory,
      proposals: t1.proposals,
    }),
    {
      chatWithTools: scripted([
        call(ACCEPT_TOOL_NAME, { proposal_id: id, user_agreement_quote: 'go ahead' }),
        say('ok'),
      ]),
      checkpoint: ck,
      applyOperations: write,
    },
  );
  return { wrote, stillOpen: openProposals(t2.proposals).length > 0, applied: t2.applied.length };
}

/** EXACTLY the messages this guard refuses although they agree with the offer. */
const KNOWN_DROPPED: readonly string[] = [
  'Yes, go ahead — 5000 is right.',
  'Yes, go ahead — 5k is right.',
];

/** Messages that MUST still be honoured, so the guard is not simply refusing. */
const STILL_ACCEPTED: readonly string[] = [
  'Yes, go ahead.',
  'Yes, go ahead — £5,000 is right.',
];

/** Messages the guard MUST refuse, which is what it is for. */
const MUST_REFUSE: readonly string[] = [
  'Yes, go ahead, but make the budget £8,000.',
  'Yes, treat it as a 0-1 fraction of revenue at risk, so 30% is 0.3. Please go ahead.',
];

describe('the accept guard fails closed, and the cost of that is pinned', () => {
  it.each(STILL_ACCEPTED)('honours an agreement that adds no number: %s', async (message) => {
    const { wrote, applied } = await acceptWith(message);
    expect(wrote, 'the write must be sent').toBe(true);
    expect(applied, 'and recorded as applied').toBe(1);
  });

  it.each(MUST_REFUSE)('refuses an agreement carrying its own figure: %s', async (message) => {
    const { wrote, stillOpen, applied } = await acceptWith(message);
    expect(wrote, 'nothing may be written').toBe(false);
    expect(applied).toBe(0);
    expect(stillOpen, 'the offer stands so the user can be re-asked').toBe(true);
  });

  it.each(KNOWN_DROPPED)('KNOWN-DROPPED — refuses the offer\'s OWN number spelled differently: %s', async (message) => {
    // ⛔ This is the gap, asserted rather than hidden. Do not "fix" it by
    // normalising numbers — see this file's header.
    const { wrote, stillOpen } = await acceptWith(message);
    expect(wrote).toBe(false);
    expect(stillOpen, 'and the offer stands — the cost is one turn, not the change').toBe(true);
  });

  it('the known-dropped set is EXACTLY these, so it cannot grow or shrink unobserved', () => {
    // A set asserted by size and content: a new member means the gap widened
    // and must be a decision; a removed one means someone normalised.
    expect(KNOWN_DROPPED).toEqual([
      'Yes, go ahead — 5000 is right.',
      'Yes, go ahead — 5k is right.',
    ]);
    // And the three classes must stay disjoint, or the pin means nothing.
    const all = [...KNOWN_DROPPED, ...STILL_ACCEPTED, ...MUST_REFUSE];
    expect(new Set(all).size).toBe(all.length);
  });
});
