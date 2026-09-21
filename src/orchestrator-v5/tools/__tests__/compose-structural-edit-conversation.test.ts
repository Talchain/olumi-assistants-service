/**
 * ROADMAP 1.33, SECOND LEG — the structural composer must see the prior turns.
 *
 * ── THE DEFECT THESE PIN ──────────────────────────────────────────────────
 * `composeStructuralEdit` was called with `messages: [{role:'user', content:
 * input.message}]` — the current utterance ALONE — while the deterministic
 * rulebook on the SAME dispatch, from the SAME `ConversationContext` object,
 * received `## Recent Conversation` via `serialiseEditContextForLLM`. So a
 * request whose object lived in an earlier turn ("update the model with THESE
 * ESTIMATES") was resolvable by one edit-lane LLM and not by the other, and
 * the user read *"I could not see how to make that change against your model
 * as it stands"* (`not_expressible`).
 *
 * ── HOW THESE BIND, AND WHY IT IS NOT A LENGTH CHECK ──────────────────────
 * CLAUDE.md trap 19: an assertion must bind to its object by IDENTITY, never
 * by a predicate another object could satisfy. "The prompt got longer" would
 * pass on any padding at all, so every case here asserts the EXACT earlier
 * turn's sentence — a string that exists nowhere else in the payload — and one
 * case asserts its ABSENCE, so the pair discriminates rather than agreeing.
 *
 * ── THE DISCRIMINATING MUTANT PAIR (trap 19's proof obligation) ───────────
 * ⚠ THIS MATRIX WAS REWRITTEN WHEN THE PAYLOAD CONTROL WAS STRENGTHENED, AND
 * THE ORIGINAL VERSION OF IT WAS FALSIFIED BY RUNNING IT. It said that
 * restoring `content: input.message` must leave the byte-identical control
 * GREEN — true of a control that read `messages[0].content` alone. The control
 * now also asserts the WITH-history contrast, so that mutant REDs it too, and
 * correctly: a bare user message under a system prompt that names "## Recent
 * Conversation" IS the defect. MEASURED at this tip, not predicted:
 *
 *   M1  re-fuse the history instruction into the system prompt (the shipped
 *       defect)                        → payload control + ONE PREDICATE RED
 *   M2  never append it, even WITH history
 *                                      → payload control + ONE PREDICATE RED
 *       (M1/M2 push in OPPOSITE directions, so the control demonstrably reads
 *        `system` both ways and its negatives are not a one-sided assertion)
 *   M3  restore `content: input.message`
 *                                      → all 3 history cases RED, payload
 *                                        control + ONE PREDICATE RED
 *   M4  add an unrelated field (`top_p`) to the payload
 *                                      → payload control RED on the key
 *                                        enumeration; all 3 history cases GREEN
 *
 * M4 is the GREEN half that discharges trap 19: it moves the payload without
 * touching the history, and the history cases do not notice — so they bind to
 * the HISTORY, not to "the payload changed at all". M3 is the RED half.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { composeStructuralEdit } from '../compose-structural-edit.js';
import {
  buildStructuralEditGrounding,
  PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
} from '../propose-structural-edit.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';
import * as telemetry from '../../../utils/telemetry.js';

const GRAPH = buildReadyGraph();

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

/**
 * The CURRENT turn — deliberately referential. On its own it names no value
 * and no node: "these estimates" is resolvable only from the turn before.
 */
const CURRENT_MESSAGE = 'This all looks reasonable. Can you update the model with these estimates?';

/**
 * The ANTECEDENT — the assistant turn that actually carried the numbers.
 * This exact string appears nowhere else in the composer's payload (asserted
 * below against the no-history control), which is what makes it an identity
 * binding rather than a value predicate.
 */
const PRIOR_ASSISTANT_TURN =
  'Here is what I would suggest: set Marketing spend to 0.7 and give it a link to Revenue.';
const PRIOR_USER_TURN = 'What numbers would you put on the marketing side?';

const CONVERSATION = [
  { role: 'user' as const, content: PRIOR_USER_TURN },
  { role: 'assistant' as const, content: PRIOR_ASSISTANT_TURN },
];

const GROUNDED_PAYLOAD = {
  operations: [
    {
      op: 'update_node',
      path: 'f-spend',
      target_label: 'Marketing spend',
      value: { observed_state: { value: 0.7 } },
    },
  ],
};

function toolUseResult(input: unknown) {
  return {
    content: [
      {
        type: 'tool_use' as const,
        id: 'tu_1',
        name: PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
        input: input as Record<string, unknown>,
      },
    ],
    stop_reason: 'tool_use' as const,
    usage: { input_tokens: 10, output_tokens: 10 },
    model: 'test-model',
    latencyMs: 1,
  };
}

function baseInput(
  chatWithTools: unknown,
  conversation: readonly { role: 'user' | 'assistant'; content: string }[],
) {
  return {
    adapter: { name: 'test', chatWithTools } as never,
    grounding: grounding(),
    message: CURRENT_MESSAGE,
    conversation,
    maxPatchOperations: 15,
    requestId: 'req-1',
    scenarioId: 'scn-1',
    timeoutMs: 60_000,
  };
}

/** The shape of the object handed to `adapter.chatWithTools`. */
type ComposerPayload = {
  system: string;
  messages: { role: string; content: string }[];
  tools: { name: string; description: string }[];
  tool_choice: unknown;
  temperature: number;
  maxTokens: number;
};

/**
 * EVERY field the adapter was handed — the WHOLE payload, not one field of it.
 *
 * ⚠ This helper exists because the control below is NAMED "the payload" and
 * originally asserted only `messages[0].content` (CLAUDE.md trap 13b: a guard
 * whose NAME claims more than its assertion reads, which made it read as
 * stronger evidence than it was). `system` is part of the payload and moved on
 * 100% of structural-edit turns while that control passed.
 */
async function sentPayload(
  conversation: readonly { role: 'user' | 'assistant'; content: string }[],
): Promise<ComposerPayload> {
  const spy = vi.fn().mockResolvedValue(toolUseResult(GROUNDED_PAYLOAD));
  const outcome = await composeStructuralEdit(baseInput(spy, conversation));
  // POSITIVE CONTROL, inline: every assertion below is about the CONTENT of a
  // call, so a harness that made no call would make all of them vacuous
  // (CLAUDE.md trap 13).
  expect(spy, 'the composer must have called the adapter exactly once').toHaveBeenCalledTimes(1);
  expect(outcome.status).toBe('composed');
  return spy.mock.calls[0]![0] as ComposerPayload;
}

/** The single user-message string the adapter was actually handed. */
async function sentUserContent(
  conversation: readonly { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const args = await sentPayload(conversation);
  expect(args.messages).toHaveLength(1);
  expect(args.messages[0]!.role).toBe('user');
  return args.messages[0]!.content;
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

describe('structural composer — prior-turn context (ROADMAP 1.33 second leg)', () => {
  it("forwards the earlier turn's own words, not merely a longer prompt", async () => {
    const content = await sentUserContent(CONVERSATION);

    // IDENTITY. The exact antecedent sentence, verbatim — the only thing that
    // makes "these estimates" resolvable. Padding, a summary, or the graph
    // grounding table would all fail this.
    expect(content).toContain(PRIOR_ASSISTANT_TURN);
    expect(content).toContain(PRIOR_USER_TURN);
    // And the request itself is still there — a fix that REPLACED the message
    // with the history would be a different defect.
    expect(content).toContain(CURRENT_MESSAGE);
  });

  it('the request is LAST, after the history — antecedent first, instruction adjacent to the tool call', async () => {
    const content = await sentUserContent(CONVERSATION);
    const historyAt = content.indexOf(PRIOR_ASSISTANT_TURN);
    const requestAt = content.indexOf(CURRENT_MESSAGE);
    expect(historyAt).toBeGreaterThanOrEqual(0);
    expect(requestAt).toBeGreaterThanOrEqual(0);
    expect(requestAt).toBeGreaterThan(historyAt);
  });

  it('labels the history so the model can tell antecedent from instruction', async () => {
    const content = await sentUserContent(CONVERSATION);
    expect(content).toContain('## Recent Conversation');
    expect(content).toContain('## The change to make');
  });

  it('DISCRIMINATING CONTROL — NO history ⇒ the WHOLE payload (system AND messages) is byte-identical to the bare request', async () => {
    // This is the half that proves the assertions above bind to the HISTORY.
    // It passes both before and after the fix; if it ever fails, the fix has
    // started changing turns that were never starved.
    //
    // ⚠ IT ASSERTS THE PAYLOAD, BECAUSE THAT IS WHAT IT IS NAMED FOR. The
    // first version of this case read `messages[0].content` alone while the
    // `system` field moved on every single turn, so a first-turn edit was told
    // the request lives under "## The change to make" and earlier turns under
    // "## Recent Conversation" — with NEITHER header in the message it was
    // handed. At temperature 0 with tool_choice 'auto' that is a live route to
    // `no_tool_call` → `not_expressible`, i.e. the exact dead end this change
    // exists to remove, newly reachable on the turn class the change promised
    // would not move.
    const bare = await sentPayload([]);
    const withHistory = await sentPayload(CONVERSATION);

    // (1) THE PAYLOAD, not a field of it. Enumerating the keys is what stops a
    //     field added later from slipping past a control whose name claims the
    //     whole object.
    expect(Object.keys(bare).sort()).toStrictEqual([
      'maxTokens',
      'messages',
      'system',
      'temperature',
      'tool_choice',
      'tools',
    ]);

    // (2) messages — exact, and no headers anywhere in it.
    expect(bare.messages).toStrictEqual([{ role: 'user', content: CURRENT_MESSAGE }]);
    expect(bare.messages[0]!.content).not.toContain(PRIOR_ASSISTANT_TURN);

    // (3) system — THE FIELD THE ORIGINAL CONTROL NEVER READ. Bound by
    //     IDENTITY to the two exact header strings, not to a length or a
    //     prefix: re-fusing the history instruction back into the base prompt
    //     would restore them and RED here.
    expect(bare.system).not.toContain('## Recent Conversation');
    expect(bare.system).not.toContain('## The change to make');

    // (4) every remaining field byte-identical across the two calls — history
    //     may move `system` and `messages`, and NOTHING else.
    expect(bare.tools).toStrictEqual(withHistory.tools);
    expect(bare.tool_choice).toStrictEqual(withHistory.tool_choice);
    expect(bare.temperature).toBe(withHistory.temperature);
    expect(bare.maxTokens).toBe(withHistory.maxTokens);

    // (5) the history instruction is ADDITIVE and CONDITIONAL — the
    //     with-history system prompt is the bare one plus exactly one appended
    //     block. This is a SECOND, independent discriminator on the same
    //     defect that needs no production export: re-fuse the two constants
    //     and `appended` becomes '', REDing here as well as at (3).
    expect(withHistory.system.startsWith(bare.system)).toBe(true);
    const appended = withHistory.system.slice(bare.system.length);
    expect(appended).toContain('## Recent Conversation');
    expect(appended).toContain('## The change to make');

    // CONTRAST CONTROL (CLAUDE.md trap 13e) — the negatives at (3) are not
    // blind assertions: the same two strings ARE present when there IS
    // history, in BOTH fields. A payload reader that had silently stopped
    // reading `system` would fail here rather than agreeing with (3).
    expect(withHistory.system).toContain('## Recent Conversation');
    expect(withHistory.system).toContain('## The change to make');
    expect(withHistory.messages[0]!.content).toContain('## Recent Conversation');
    expect(withHistory.messages[0]!.content).toContain('## The change to make');
  });

  it('ONE PREDICATE — system and message agree about the headers on EVERY conversation shape', async () => {
    // The invariant the fix actually rests on, asserted over the input space
    // rather than over the one input that motivated it: the system prompt may
    // name "## Recent Conversation" IF AND ONLY IF the user message carries
    // it. The shipped defect was precisely the two fields disagreeing.
    //
    // ⚠ The blank-content pair is in this corpus because it is the near-miss
    // that decides the SHAPE of the gate, and it does NOT behave the way it
    // looks: MEASURED at this tip, `renderRecentConversationForEdit` returns
    // '' only for an EMPTY array — a blank-content pair renders
    // "user: \nassistant: " (18 chars) and therefore takes the history branch.
    // So `conversation.length > 0` and `recent.length > 0` coincide today, and
    // this case pins the AGREEMENT rather than asserting a divergence that
    // does not exist. It REDs if either predicate is changed without the other.
    const corpus: readonly (readonly { role: 'user' | 'assistant'; content: string }[])[] = [
      [],
      CONVERSATION,
      [{ role: 'user', content: '' }, { role: 'assistant', content: '' }],
      [{ role: 'user', content: PRIOR_USER_TURN }],
    ];

    let withHeaders = 0;
    for (const conversation of corpus) {
      const payload = await sentPayload(conversation);
      const inSystem = payload.system.includes('## Recent Conversation');
      const inMessage = payload.messages[0]!.content.includes('## Recent Conversation');
      expect(
        inSystem,
        `system and message must agree for conversation of length ${conversation.length}`,
      ).toBe(inMessage);
      if (inSystem) withHeaders += 1;
    }

    // CONTRAST CONTROL (trap 13e) — the loop is not agreeing vacuously by
    // finding the header nowhere: 3 of the 4 shapes DO carry it, and exactly
    // one (the empty array) does not.
    expect(withHeaders).toBe(3);
  });

  it('the history is not smuggled into the grounding — ids still come only from the tool', async () => {
    // A conversation naming a node that does not exist must not become a
    // groundable id: the grounding table is built from the PERSISTED graph
    // alone (A5(a)), and the validator rejects the batch whole.
    const spy = vi.fn().mockResolvedValue(toolUseResult(GROUNDED_PAYLOAD));
    await composeStructuralEdit(
      baseInput(spy, [{ role: 'assistant', content: 'We could add a factor called f-invented.' }]),
    );
    const args = spy.mock.calls[0]![0] as { tools: { description: string }[] };
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]!.description).not.toContain('f-invented');
    // Contrast control: the grounding table IS present and IS being read, so
    // the negative above is not a blind assertion.
    expect(args.tools[0]!.description).toContain('f-spend');
  });
});
