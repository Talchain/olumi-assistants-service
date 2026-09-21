/**
 * ⭐⭐⭐ THREE FACTS IN ONE MESSAGE MUST NOT BECOME ONE QUESTION AND NO CHANGES.
 *
 * ── THE WITNESS (`65fdde46`, turn 3) ─────────────────────────────────────
 * Paul wrote, in one message:
 *
 *   "I think Two Developers increases our delivery throughput significantly,
 *    so I would set that as high. I think the hiring salary costs will
 *    probably be a total of £200,000, which is within our budget. If we hire a
 *    senior and midweight to junior, which I think is the right makeup if we
 *    hire two developers, I think that would increase the team's technical
 *    capability by at least 25%"
 *
 * He got back: *"That looks like a change to an option's intervention rather
 * than the Hiring & Salary Cost factor's own value, so I haven't changed
 * anything. Tell me whether you meant the factor's value or a specific
 * option's effect"* — a disambiguation question about something his own words
 * settled ("Two Developers increases…"), with ALL THREE figures discarded.
 * The bundle confirms it: `material_parameters_user_stated: 0`.
 *
 * ── SCOPE, AND IT IS NARROWER THAN IT LOOKS. READ THIS BEFORE THE ASSERTIONS ─
 * **The model is SCRIPTED.** So this file CANNOT and does not claim that a live
 * model reads that sentence correctly, resolves "Two Developers" to an option,
 * or picks 0.8 for "significantly" — asserting any of those would be asserting
 * my own script back to myself. What it proves is that the MACHINERY can carry
 * the shape the failure needed and previously could not:
 *
 *   · several claims from ONE message become ONE set of separately-agreeable
 *     proposals, in one turn;
 *   · every referent is bound BY ID;
 *   · a number that is the model's READING of the user's phrasing travels with
 *     those words attached, visible before anything is written;
 *   · nothing is written until they agree, and then in ONE write.
 *
 * ⚠ THE GRAPH IS THE 21 SEP CAPTURE, which does not contain that bundle's
 * nodes ("Two Developers", "Hiring & Salary Cost"). Paul's message is used
 * verbatim as the user turn because that is the turn under test, and the
 * scripted calls bind to the capture's OWN ids. Label matching is model
 * behaviour and a scripted model cannot evidence it.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { EMPTY_CONVERSATION_MEMORY } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, openProposals } from '../proposal-store.js';
import { ACCEPT_TOOL_NAME, runReplacementTurn } from '../run-replacement-turn.js';
import { createSetOptionEffectTool } from '../propose-tools.js';
import { SYSTEM_PROMPT_DOCTRINE } from '../system-prompt.js';

import type { ChatWithToolsLike } from '../agent-loop.js';
import type { EffectGraph } from '../set-option-effect.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import type { ApplyOperations, ReplacementTurnInput } from '../run-replacement-turn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPH = JSON.parse(
  readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8'),
) as { nodes: Array<Record<string, any>>; edges: unknown[] };

/** Paul's message, verbatim. */
const PAULS_MESSAGE =
  'I think Two Developers increases our delivery throughput significantly, so I would set that as ' +
  'high. I think the hiring salary costs will probably be a total of £200,000, which is within our ' +
  'budget. If we hire a senior and midweight to junior, which I think is the right makeup if we ' +
  'hire two developers, I think that would increase the team\'s technical capability by at least 25%';

/** Three real cells from the capture — one per claim. Bound by id. */
const OPTION = '3f02dabe';
const F_INVESTMENT = '35a64cfe';
const F_CYCLE = 'bc936d4c';
const F_COST = 'd9de63b8';

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
const call = (id: string, name: string, input: Record<string, unknown>): Reply => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
});
const ck = async (): Promise<void> => undefined;

function baseInput(over: Partial<ReplacementTurnInput> = {}): ReplacementTurnInput {
  const turnId = over.turnId ?? 'turn-1';
  return {
    message: 'hello',
    history: [],
    memory: EMPTY_CONVERSATION_MEMORY,
    proposals: EMPTY_PROPOSAL_STORE,
    modelRevision: 'rev-1',
    workspaceSummary: 'Four options, four factors.',
    tools: [effectTool],
    turnId,
    now: '2026-09-21T13:00:00.000Z',
    ...over,
    idFor: (purpose: string, i: number) => `${purpose}-${turnId}-${i}`,
  };
}

const okWriter = () => {
  const seen: Parameters<ApplyOperations>[0][] = [];
  const write = vi.fn<ApplyOperations>(async (args) => {
    seen.push(JSON.parse(JSON.stringify(args)));
    return { ok: true as const, receiptId: 'commit-3-claims', newModelRevision: 'rev-2' };
  });
  return { seen, write };
};

/** Three claims harvested from one message, in one turn. */
async function harvestThree(write: ReturnType<typeof okWriter>['write']) {
  return runReplacementTurn(baseInput({ turnId: 'turn-1', message: PAULS_MESSAGE }), {
    chatWithTools: scripted([
      // Qualitative: "increases … significantly, so I would set that as high"
      call('t1', 'set_option_effect', {
        option_id: OPTION,
        factor_id: F_CYCLE,
        value: 0.8,
        user_words: 'increases our delivery throughput significantly, so I would set that as high',
      }),
      // A native figure the user gave: "a total of £200,000"
      call('t2', 'set_option_effect', {
        option_id: OPTION,
        factor_id: F_COST,
        value: 0.4,
        user_words: 'the hiring salary costs will probably be a total of £200,000',
      }),
      // A percentage: "increase … technical capability by at least 25%"
      call('t3', 'set_option_effect', {
        option_id: OPTION,
        factor_id: F_INVESTMENT,
        value: 0.25,
        user_words: "increase the team's technical capability by at least 25%",
      }),
      say('Here is what I took from that — three things. Have I read them right?'),
    ]),
    checkpoint: ck,
    applyOperations: write,
  });
}

describe('the doctrine tells the model to take all of it', () => {
  it('forbids the two moves that produced the failure', () => {
    // The prompt is the only mechanism for "harvest everything" — the loop
    // already allows several tool calls per turn, and `operationsToApplyBatch`
    // already makes them one write. Nothing instructed it to.
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('ONE MESSAGE CAN CARRY SEVERAL FACTS');
    expect(SYSTEM_PROMPT_DOCTRINE).toMatch(/Never ask them to clarify something their message already settles/);
    expect(SYSTEM_PROMPT_DOCTRINE).toMatch(/A claim in words counts as much as a claim in numbers/);
    expect(SYSTEM_PROMPT_DOCTRINE).toMatch(/generous in reading and strict in committing/i);
    // Positive control: a phrase that is NOT in the doctrine, so the matches
    // above are not passing against something that matches anything.
    expect(SYSTEM_PROMPT_DOCTRINE).not.toContain('ONE MESSAGE CAN CARRY SEVERAL OPINIONS');
  });
});

describe('one message, three claims, one set', () => {
  it('opens three separately-agreeable proposals in ONE turn and writes nothing', async () => {
    const { write } = okWriter();
    const t1 = await harvestThree(write);

    const waiting = openProposals(t1.proposals);
    expect(waiting, 'all three claims, not one').toHaveLength(3);
    expect(t1.toolsCalled.filter((n) => n === 'set_option_effect')).toHaveLength(3);
    expect(write, 'nothing is written while they are still reading it back').not.toHaveBeenCalled();
    expect(t1.applied).toEqual([]);

    // ⭐ EVERY REFERENT BOUND BY ID — never by a label another node could match.
    const staged = waiting.map((p) => JSON.stringify(p.operations));
    for (const factorId of [F_CYCLE, F_COST, F_INVESTMENT]) {
      expect(
        staged.some((s) => s.includes(`/nodes/${OPTION}/data/interventions/${factorId}`)),
        `the claim about ${factorId} is bound to option ${OPTION} by id`,
      ).toBe(true);
    }
    // And no claim landed on a factor's own baseline.
    for (const s of staged) expect(s).not.toMatch(new RegExp(`/nodes/${F_COST}/(?!data/interventions)`));
  });

  it('shows the reading back in the user\'s own words, before anything commits', async () => {
    const { write } = okWriter();
    const t1 = await harvestThree(write);
    const summaries = openProposals(t1.proposals)
      .flatMap((p) => p.operations.map((o) => o.summary))
      .join(' | ');

    // ⛔ THE PROPERTY THAT MAKES GENEROUS EXTRACTION SAFE. The number 0.8 is
    // the model's reading of "as high"; it must never travel as if Paul said
    // it. His words ride on the summary — which is both what he is shown and
    // what the accept guard compares his reply against.
    expect(summaries).toContain('my reading of "increases our delivery throughput significantly');
    expect(summaries).toContain('a total of £200,000');
    expect(summaries).toContain("technical capability by at least 25%");
    expect(write).not.toHaveBeenCalled();
  });

  it('CONTRAST — a value the user gave in that form carries no "my reading of"', async () => {
    // Without this, "my reading of" would be equally satisfied by a tool that
    // stamps every proposal with it, and the distinction it exists to draw —
    // their number versus my reading — would be lost.
    const { write } = okWriter();
    const t = await runReplacementTurn(
      baseInput({ turnId: 'turn-1', message: 'Set that one to 0.6.' }),
      {
        chatWithTools: scripted([
          call('t1', 'set_option_effect', { option_id: OPTION, factor_id: F_CYCLE, value: 0.6 }),
          say('Offered.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );
    const summary = openProposals(t.proposals).flatMap((p) => p.operations.map((o) => o.summary)).join(' ');
    expect(summary).toContain('0.6');
    expect(summary, "their own figure is not labelled as mine").not.toContain('my reading of');
  });

  it('all three are saved together, in ONE write under ONE receipt', async () => {
    const { seen, write } = okWriter();
    const t1 = await harvestThree(write);
    const ids = openProposals(t1.proposals).map((p) => p.id);
    const carried = JSON.parse(JSON.stringify({ memory: t1.memory, proposals: t1.proposals }));

    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Yes, you have read all three right.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call('a1', ACCEPT_TOOL_NAME, {
            proposal_id: ids[0],
            also_accept_ids: ids.slice(1),
            user_agreement_quote: 'Yes, you have read all three right.',
          }),
          say('All three saved.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    // ⭐ THE SHAPE THE ORIGINAL FAILURE COULD NOT PRODUCE: three facts in,
    // three changes out, one write, one receipt, nothing discarded.
    expect(write).toHaveBeenCalledTimes(1);
    expect(seen[0]!.operations).toHaveLength(3);
    expect(t2.applied).toHaveLength(3);
    expect(new Set(t2.applied.map((a) => a.receiptId))).toEqual(new Set(['commit-3-claims']));
    expect(openProposals(t2.proposals)).toHaveLength(0);
  });

  it('they can correct ONE reading and keep the other two', async () => {
    // "No — capability is more like 40%." The other two readings were right and
    // must not be thrown away with the one that was not.
    const { write } = okWriter();
    const t1 = await harvestThree(write);
    const waiting = openProposals(t1.proposals);
    const wrongOne = waiting.find((p) =>
      p.operations.some((o) => JSON.stringify(o).includes(`/interventions/${F_INVESTMENT}`)),
    )!;
    const carried = JSON.parse(JSON.stringify({ memory: t1.memory, proposals: t1.proposals }));

    const t2 = await runReplacementTurn(
      baseInput({
        turnId: 'turn-2',
        message: 'Two of those are right, but capability is more like 40 percent.',
        memory: carried.memory,
        proposals: carried.proposals,
      }),
      {
        chatWithTools: scripted([
          call('t1', 'set_option_effect', {
            option_id: OPTION,
            factor_id: F_INVESTMENT,
            value: 0.4,
            amends_proposal_id: wrongOne.id,
            user_words: 'capability is more like 40 percent',
          }),
          say('Changed that one.'),
        ]),
        checkpoint: ck,
        applyOperations: write,
      },
    );

    expect(write, 'amending never writes').not.toHaveBeenCalled();
    expect(t2.proposals.proposals.find((p) => p.id === wrongOne.id)!.status).toBe('superseded');
    const after = openProposals(t2.proposals);
    expect(after, 'the two correct readings survive alongside the corrected one').toHaveLength(3);
    expect(after.some((p) => p.amends === wrongOne.id)).toBe(true);
  });
});
