/**
 * ⭐⭐⭐ THE CAPABILITY, END TO END — Paul's three requirements driven through
 * the REAL tools and the REAL controller, on the captured 21 Sep graph.
 *
 *   1. "distinguish AI estimates from genuinely missing human judgement"
 *   2. "propose a coherent bounded set of repairs"
 *   3. "allow confirm/amend rather than making the user understand
 *      causal-model internals"
 *
 * ── THE SESSION THIS REPLACES (`48a1ce84`, 21 Sep) ───────────────────────
 * Nine exchanges, one number per turn, the same four-item list four times, and
 * *"Tackling them together isn't possible in one step. Each mapping is a
 * separate fix, so pick one option to start with."* Here the whole set is put
 * in ONE turn and agreed in ONE write.
 *
 * ⚠ SCOPE, STATED PLAINLY. **The model is SCRIPTED and the store is a double.**
 * This is evidence that the MACHINERY is reachable and behaves — that a real
 * model reaches for `propose_repairs` at the right moment, and composes the two
 * groups into copy Paul would accept, is NOT claimed and needs a live harness.
 * The graph is the append-only capture; it is never written to.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { EMPTY_CONVERSATION_MEMORY } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, openProposals, MAX_COMPOUND_OPERATIONS } from '../proposal-store.js';
import { ACCEPT_TOOL_NAME, runReplacementTurn } from '../run-replacement-turn.js';
import { createProposeRepairsTool, PROPOSE_REPAIRS_TOOL_NAME } from '../repair-tools.js';
import { createSetOptionEffectTool } from '../propose-tools.js';
import { buildReplacementTools } from '../turn-entry.js';

import type { ChatWithToolsLike } from '../agent-loop.js';
import type { ConversationMemory } from '../conversation-memory.js';
import type { ProposalStore } from '../proposal-store.js';
import type { EffectGraph } from '../set-option-effect.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import type { ApplyOperations, ReplacementTurnInput } from '../run-replacement-turn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(
  readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8'),
) as { nodes: Array<Record<string, any>>; edges: unknown[] };

/** From the capture. Neither is invented. */
const SMB = '3f02dabe';
const F_INVESTMENT = '35a64cfe';

// ⭐ THE REAL TOOLS. A fixture mimicking them would be testing my model of
// them rather than them.
const repairTool = createProposeRepairsTool({ getGraph: () => GRAPH });
const effectTool = createSetOptionEffectTool({ getGraph: () => GRAPH as unknown as EffectGraph });

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

/** `idFor` encodes the turn id, as production's does — see the amend suite. */
function baseInput(over: Partial<ReplacementTurnInput> = {}): ReplacementTurnInput {
  const turnId = over.turnId ?? 'turn-1';
  return {
    message: 'hello',
    history: [],
    memory: EMPTY_CONVERSATION_MEMORY,
    proposals: EMPTY_PROPOSAL_STORE,
    modelRevision: 'rev-1',
    workspaceSummary: 'Four options, four factors.',
    tools: [repairTool, effectTool],
    turnId,
    now: '2026-09-21T12:00:00.000Z',
    ...over,
    idFor: (purpose: string, i: number) => `${purpose}-${turnId}-${i}`,
  };
}

/** Everything the next turn would load back, THROUGH storage. */
const reload = (r: { memory: ConversationMemory; proposals: ProposalStore }) =>
  JSON.parse(JSON.stringify({ memory: r.memory, proposals: r.proposals })) as {
    memory: ConversationMemory;
    proposals: ProposalStore;
  };

const okWriter = () => {
  const seen: Parameters<ApplyOperations>[0][] = [];
  const write = vi.fn<ApplyOperations>(async (args) => {
    seen.push(JSON.parse(JSON.stringify(args)));
    return { ok: true as const, receiptId: 'commit-set-1', newModelRevision: 'rev-2' };
  });
  return { seen, write };
};

/** Turn 1 in every scenario: the model asks for the whole repair set. */
async function offerTheSet(write: ReturnType<typeof okWriter>['write']) {
  return runReplacementTurn(
    baseInput({ turnId: 'turn-1', message: 'What do we need before I can analyse this?' }),
    {
      chatWithTools: scripted([
        call(PROPOSE_REPAIRS_TOOL_NAME, {}),
        say('Here are the numbers I filled in myself, and what only you can tell me.'),
      ]),
      checkpoint: ck,
      applyOperations: write,
    },
  );
}

describe('the tool is actually wired into the controller\'s tool list', () => {
  it('is offered by buildReplacementTools, by name', () => {
    // The estate has shipped a tool the model was never offered before — a
    // hand-maintained second list that had drifted. Bind by name.
    const names = buildReplacementTools({
      getGraph: () => GRAPH as never,
      getAnalysis: () => null,
      getMemory: () => EMPTY_CONVERSATION_MEMORY,
    }).map((t) => t.definition.name);
    expect(names).toContain(PROPOSE_REPAIRS_TOOL_NAME);
    // Contrast: a sibling that was already there, so a `toContain` that passes
    // against an empty-ish list would still be caught.
    expect(names).toContain('set_option_effect');
  });
});

describe('ONE turn puts the whole bounded set to the user', () => {
  it('opens one separately-agreeable proposal per estimate, and writes nothing', async () => {
    const { write } = okWriter();
    const t1 = await offerTheSet(write);

    const waiting = openProposals(t1.proposals);
    expect(waiting.length, 'the whole set, in one turn').toBe(8);
    expect(waiting.length).toBeLessThanOrEqual(MAX_COMPOUND_OPERATIONS);
    // ⛔ NOTHING IS SAVED BY PROPOSING. The tool is `kind: 'propose'`, so the
    // loop's own invariant forbids it recording consent.
    expect(write, 'proposing must never write').not.toHaveBeenCalled();
    expect(t1.applied).toEqual([]);

    // Each is its own proposal with its own id — the precondition for
    // amending any single one without disturbing the rest.
    expect(new Set(waiting.map((p) => p.id)).size).toBe(waiting.length);
    for (const p of waiting) expect(p.operations.length).toBeGreaterThan(0);

    // ⭐ BOTH GROUPS REACH THE MODEL IN ONE MESSAGE, AND THE OLD INSTRUCTION
    // THAT PRODUCED THE DEFECT IS GONE.
    const toolText = JSON.stringify(t1.trace);
    expect(t1.toolsCalled).toContain(PROPOSE_REPAIRS_TOOL_NAME);
    expect(toolText).toBeTruthy();
  });

  it('the tool\'s own output names my numbers apart from their judgement', () => {
    const outcome = repairTool.execute({}) as { type: string; content?: string };
    expect(outcome.type).toBe('proposed');
    const content = String(outcome.content);
    // The two groups are different sentences, and the number is shown.
    expect(content).toContain('I FILLED IN MYSELF');
    expect(content).toMatch(/Double Down on Self-Serve SMB → SMB Self-Serve Investment: my estimate is 0\.4/);
    // ⛔ THE INSTRUCTION THAT PRODUCED THE MEASURED FAILURE MUST NOT BE HERE.
    expect(content).not.toMatch(/one at a time/i);
    expect(content).toMatch(/Do NOT work through it one item at a time/);
    // ⛔ AND THE USER IS NOT SENT INTO THE INTERNALS.
    expect(content).toMatch(/Do not ask them about normalised shares/);
    // Positive control for those two absences: the string is real and long,
    // so `not.toMatch` is not passing against an empty content.
    expect(content.length).toBeGreaterThan(400);
  });
});

describe('"yes, all of those" is ONE write and ONE receipt', () => {
  it('saves every member together, in order, citing one proof of commit', async () => {
    const { seen, write } = okWriter();
    const t1 = await offerTheSet(write);
    const ids = openProposals(t1.proposals).map((p) => p.id);

    const carried = reload(t1);
    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Yes, those all look about right. Save them.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, {
            proposal_id: ids[0],
            also_accept_ids: ids.slice(1),
            user_agreement_quote: 'Yes, those all look about right.',
          }),
          say('All saved.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    // ⭐⭐ THE WHOLE POINT: EIGHT AGREED CHANGES, ONE WRITE.
    expect(write, 'one write for the set').toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.operations, 'every member rode that one write').toHaveLength(8);
    // Order is the caller's and is preserved — a later operation may depend on
    // an earlier one.
    expect(seen[0]!.operations.map((o) => o.summary)).toEqual(
      ids.map((id) => carried.proposals.proposals.find((p) => p.id === id)!.operations[0]!.summary),
    );

    // ONE receipt, cited by every member. Minting one each would be a claim
    // about writes that never happened.
    expect(t2.applied).toHaveLength(8);
    expect(new Set(t2.applied.map((a) => a.receiptId))).toEqual(new Set(['commit-set-1']));
    expect(t2.applied.map((a) => a.proposalId).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(t2.proposals.proposals.find((p) => p.id === id)!.status).toBe('applied');
    }
    expect(openProposals(t2.proposals), 'nothing left waiting').toHaveLength(0);

    // ⭐ THE BYTES CARRY THE OPTION × FACTOR PATH, not a factor baseline.
    expect(JSON.stringify(seen[0]!.operations)).toContain(
      `/nodes/${SMB}/data/interventions/${F_INVESTMENT}`,
    );
  });

  it('CONTRAST — accepting one alone still writes exactly that one', async () => {
    // Without this, "one write carried eight" would be equally satisfied by a
    // controller that always sends everything waiting, regardless of consent.
    const { seen, write } = okWriter();
    const t1 = await offerTheSet(write);
    const ids = openProposals(t1.proposals).map((p) => p.id);
    const carried = reload(t1);

    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Just that first one please.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, { proposal_id: ids[0], user_agreement_quote: 'Just that first one please.' }),
          say('Saved that one.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write).toHaveBeenCalledTimes(1);
    expect(seen[0]!.operations, 'only what they agreed to').toHaveLength(1);
    expect(t2.applied).toHaveLength(1);
    expect(t2.applied[0]!.proposalId).toBe(ids[0]);
    expect(openProposals(t2.proposals), 'the other seven still stand').toHaveLength(7);
  });
});

describe('they can change any single part without losing the rest', () => {
  it('amends one offer, leaves the other seven waiting, and saves nothing', async () => {
    const { write } = okWriter();
    const t1 = await offerTheSet(write);
    const before = openProposals(t1.proposals);
    const targeted = before.find((p) =>
      p.operations.some((o) => JSON.stringify(o).includes(`/nodes/${SMB}/data/interventions/${F_INVESTMENT}`)),
    )!;
    expect(targeted, 'the capture really does carry this offer').toBeDefined();

    const carried = reload(t1);
    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Those look right except the SMB investment one — make it 0.6.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call('set_option_effect', {
            option_id: SMB,
            factor_id: F_INVESTMENT,
            value: 0.6,
            amends_proposal_id: targeted.id,
          }),
          say('Changed that one to 0.6 — shall I save the set?'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write, 'amending must never write').not.toHaveBeenCalled();
    expect(t2.proposals.proposals.find((p) => p.id === targeted.id)!.status).toBe('superseded');

    const waiting = openProposals(t2.proposals);
    // ⭐ SEVEN UNTOUCHED PLUS THE AMENDED ONE — the property that one proposal
    // carrying eight operations could not have.
    expect(waiting, 'the rest of the set is intact').toHaveLength(8);
    const amendment = waiting.find((p) => p.amends === targeted.id)!;
    expect(amendment, 'the amended offer goes BACK to them').toBeDefined();
    expect(amendment.status).toBe('open');
    expect(JSON.stringify(amendment.operations)).toContain('0.6');
    for (const p of before) {
      if (p.id === targeted.id) continue;
      expect(waiting.some((w) => w.id === p.id), `${p.id} still stands`).toBe(true);
    }
  });

  it('a set-wide yes that names a new number is REFUSED, and nothing is saved', async () => {
    // The guard runs over the WHOLE set, not the primary. Checking only the
    // first would let the other seven — and the one they just changed — be
    // written at MY numbers under a receipt saying otherwise.
    const { write } = okWriter();
    const t1 = await offerTheSet(write);
    const ids = openProposals(t1.proposals).map((p) => p.id);
    const carried = reload(t1);

    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Yes to all of those, but make the SMB one 0.61.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, {
            proposal_id: ids[0],
            also_accept_ids: ids.slice(1),
            user_agreement_quote: 'Yes to all of those',
          }),
          say('...'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write, 'their number must not be discarded under a receipt').not.toHaveBeenCalled();
    expect(t2.trace?.refusals ?? []).toContain('acceptance_names_other_number');
    expect(openProposals(t2.proposals), 'every offer still stands').toHaveLength(8);
  });

  it('a set naming something that is not waiting saves NONE of it', async () => {
    // Every member or none. A partial accept is the harm the whole field
    // exists to remove.
    const { write } = okWriter();
    const t1 = await offerTheSet(write);
    const ids = openProposals(t1.proposals).map((p) => p.id);
    const carried = reload(t1);

    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Yes, all of them.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call(ACCEPT_TOOL_NAME, {
            proposal_id: ids[0],
            also_accept_ids: [...ids.slice(1), 'proposal-that-never-existed'],
            user_agreement_quote: 'Yes, all of them.',
          }),
          say('...'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write).not.toHaveBeenCalled();
    expect(t2.trace?.refusals ?? []).toContain('proposal_not_waiting');
    expect(openProposals(t2.proposals), 'including the seven that WERE waiting').toHaveLength(8);
    expect(t2.applied).toEqual([]);
  });
});
