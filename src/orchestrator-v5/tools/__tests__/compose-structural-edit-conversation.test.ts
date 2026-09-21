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
 * Restore `content: input.message` and:
 *   · `forwards the earlier turn's own words`        must RED
 *   · `the request is LAST, after the history`       must RED
 *   · `NO history ⇒ payload byte-identical`          must stay GREEN
 * The third is what proves the first two bind to the HISTORY rather than to
 * "the content changed at all": a mutant that broke the no-history path would
 * be caught by a different assertion, and one that only pads would leave the
 * contains-check red.
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

/** The single user-message string the adapter was actually handed. */
async function sentUserContent(
  conversation: readonly { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const spy = vi.fn().mockResolvedValue(toolUseResult(GROUNDED_PAYLOAD));
  const outcome = await composeStructuralEdit(baseInput(spy, conversation));
  // POSITIVE CONTROL, inline: every assertion below is about the CONTENT of a
  // call, so a harness that made no call would make all of them vacuous
  // (CLAUDE.md trap 13).
  expect(spy, 'the composer must have called the adapter exactly once').toHaveBeenCalledTimes(1);
  expect(outcome.status).toBe('composed');
  const args = spy.mock.calls[0]![0] as {
    messages: { role: string; content: string }[];
  };
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

  it('DISCRIMINATING CONTROL — NO history ⇒ the payload is byte-identical to the bare request', async () => {
    // This is the half that proves the assertions above bind to the HISTORY.
    // It passes both before and after the fix; if it ever fails, the fix has
    // started changing turns that were never starved.
    const content = await sentUserContent([]);
    expect(content).toBe(CURRENT_MESSAGE);
    expect(content).not.toContain(PRIOR_ASSISTANT_TURN);
    expect(content).not.toContain('## Recent Conversation');
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
