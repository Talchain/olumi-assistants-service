/**
 * ROADMAP 2.1361 — the no-op branch answers TWO questions, driven through the
 * REAL handler.
 *
 * The unit spec beside the composer proves the predicates. This one proves the
 * WIRING: that `handleEditGraph`'s empty-operations branch actually reaches
 * them, on the four messages a real user sent to the deployed build on
 * 4 Sep 2026 and received one identical sentence for.
 *
 * ⭐ RED-FIRST, BY CONSTRUCTION. Every assertion below is about the four
 * replies being DIFFERENT from each other and different from the witnessed
 * sentence. At pristine they are byte-identical — `PRISTINE_WITNESSED_TEXT` is
 * the exact string the deployed build emitted — so the whole describe block
 * fails before the fix and passes after. `reproduces the witnessed collapse`
 * is the historic record of what that sentence was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You are editing a graph.',
    meta: { source: 'default', prompt_version: 'v2' },
  }),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return false;
              if (ceeProp === 'patchBudgetEnabled') return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import { buildEditClarifyFallbackParts } from '../../../../src/orchestrator-v5/compose/edit-clarify-response.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';

/**
 * ⚠ HISTORIC RECORD — the exact sentence the deployed build emitted for all
 * four messages on 4 Sep 2026. Append-only: this is evidence of what the
 * product once said, not a fixture to keep current (CLAUDE.md trap 14b).
 */
const PRISTINE_WITNESSED_TEXT =
  "I haven't changed anything from that. Tell me the specific factor, edge, option, or value to change, and I'll apply it directly.";

const WITNESSED_MESSAGES = {
  W1: 'Change the uncertainty range for Team coordination overhead to low',
  W2: 'Change the team coordination overhead to low.',
  W3: 'Do you think we should add the risk about spending money on the resource and still not hitting our launch date?',
  W4: 'Do you agree that we should add this as a risk?',
} as const;

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Launch on time' },
        // ⚠ `observed_state` IS LOAD-BEARING HERE AND WAS MISSING. Without it
        // nothing in the payload says what scale this factor is on, and the
        // composer must not claim one — so the band assertions below were
        // being made against a graph that cannot honestly produce a band. A
        // factor the user has been shown a LEVEL for has a value; this is that
        // factor. (The undeclared case is not lost: `factor_morale` below
        // carries it, and is asserted separately.)
        {
          id: 'factor_tco',
          kind: 'factor',
          label: 'Team coordination overhead',
          observed_state: { value: 0.3 },
        },
        // The dominant real class — 403 of 491 nodes carry no observed_state.
        { id: 'factor_morale', kind: 'factor', label: 'Team morale' },
        // A measured factor, at the real path. The witnessed graph had none,
        // and its absence is why a £ factor could be told it was 0-1.
        {
          id: 'factor_spend',
          kind: 'factor',
          label: 'Marketing spend',
          observed_state: { value: 0.5, raw_value: 500000, unit: '£' },
        },
        { id: 'opt_lead', kind: 'option', label: 'Hire a Tech Lead' },
        // ⭐⭐ A SCHEMA-VALID OPTION THAT CARRIES A VALUE. `opt_lead` above has
        // none, and that absence is the only reason an option was ever spared
        // a factor-value chip: with no `observed_state` it resolves to the
        // unknown-scale branch, which emits none. `NodeV3Schema` puts
        // `observed_state` on the NODE, not on a factor-shaped subtype, so
        // this shape is valid — and `risk` and `outcome` nodes in the shipped
        // `src/**/*.json` corpus already carry one (1/95 and 3/81 measured).
        {
          id: 'opt_ai',
          kind: 'option',
          label: 'Deploy the AI chatbot',
          observed_state: { value: 0.3 },
        },
      ],
      edges: [
        {
          from: 'factor_tco',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1,
          effect_direction: 'negative',
        },
      ],
    },
    messages: [{ role: 'user', content: 'x' }],
    scenario_id: '11111111-2222-3333-4444-555555555555',
    framing: { stage: 'evaluate' },
    analysis_response: null,
  } as unknown as ConversationContext;
}

function makeNoOpAdapter(): LLMAdapter {
  return {
    name: 'mock',
    model: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ operations: [], removed_edges: [], warnings: [] }),
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    chatWithTools: vi.fn(),
  } as unknown as LLMAdapter;
}

async function replyFor(message: string): Promise<string> {
  const result = await handleEditGraph(makeContext(), message, makeNoOpAdapter(), 'req', 'turn');
  return result.assistantText ?? '';
}

describe('handleEditGraph no-op — the witnessed collapse, and its repair', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSITIVE CONTROL — the pristine composer still emits the witnessed sentence verbatim, so the comparisons below are anchored to something real', () => {
    const parts = buildEditClarifyFallbackParts([
      { id: 'factor_tco', kind: 'factor', label: 'Team coordination overhead' },
    ]);
    expect(parts.text).toBe(PRISTINE_WITNESSED_TEXT);
  });

  it('RED-FIRST SIGNATURE — the four witnessed messages get THREE replies, split along the two questions', async () => {
    // ⚠ THREE, NOT FOUR, AND THE NUMBER IS THE POINT. An earlier draft of this
    // assertion demanded four distinct replies and went RED — correctly. W3 and
    // W4 are the SAME failure (a deliberation answered as an edit-refusal) and
    // giving one class one reply is the design, not a shortfall. What must be
    // distinct is the CLASSES: the two edits differ from each other because the
    // product understood different things from them, and both differ from the
    // question class.
    const [w1, w2, w3, w4] = await Promise.all(
      [
        WITNESSED_MESSAGES.W1,
        WITNESSED_MESSAGES.W2,
        WITNESSED_MESSAGES.W3,
        WITNESSED_MESSAGES.W4,
      ].map((m) => replyFor(m)),
    );
    expect(new Set([w1, w2, w3, w4]).size).toBe(3);
    expect(w3).toBe(w4); // one class, one answer
    expect(w1).not.toBe(w2); // two understandings, two answers
    expect(w1).not.toBe(w3);
    expect(w2).not.toBe(w3);
  });

  it('RED-FIRST SIGNATURE — not one of the four still receives the witnessed sentence', async () => {
    for (const [key, message] of Object.entries(WITNESSED_MESSAGES)) {
      const text = await replyFor(message);
      expect(text, `${key} still emits the witnessed copy`).not.toBe(PRISTINE_WITNESSED_TEXT);
    }
  });

  it('RED-FIRST SIGNATURE — the two QUESTIONS are not told to name a factor, edge, option and value', async () => {
    for (const message of [WITNESSED_MESSAGES.W3, WITNESSED_MESSAGES.W4]) {
      const text = await replyFor(message);
      expect(text).not.toMatch(/specific factor, edge, option, or value/i);
      expect(text).toMatch(/question/i);
    }
  });

  it('RED-FIRST SIGNATURE — the two EDITS are told what was understood, by the label they used', async () => {
    for (const message of [WITNESSED_MESSAGES.W1, WITNESSED_MESSAGES.W2]) {
      const text = await replyFor(message);
      expect(text).toContain('Team coordination overhead');
      expect(text).not.toMatch(/specific factor, edge, option, or value/i);
    }
  });

  it('RED-FIRST SIGNATURE — W1 is told the uncertainty range is not editable at all', async () => {
    const text = await replyFor(WITNESSED_MESSAGES.W1);
    expect(text).toMatch(/uncertainty range isn't something I can edit/i);
  });

  it('RED-FIRST SIGNATURE — W2 is given the band, and the product does not pick the number', async () => {
    const text = await replyFor(WITNESSED_MESSAGES.W2);
    expect(text).toMatch(/covers a range of values/i);
    expect(text).toMatch(/never gave me/i);
  });

  it('the two edits now carry clickable value offers — the turn ends somewhere that can write', async () => {
    const result = await handleEditGraph(
      makeContext(),
      WITNESSED_MESSAGES.W2,
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    // ⚠ THE FIELD NAME IS `suggestedActions`. An earlier draft read
    // `recoveryChips ?? []` — a name the result does not carry — and the `??`
    // turned a missing field into an empty array, i.e. an assertion that could
    // only ever measure nothing. It went RED and that is why this reads the
    // real field with no defaulting.
    const chips = result.suggestedActions;
    expect(chips).toBeDefined();
    expect(chips!.length).toBeGreaterThan(0);
    for (const c of chips!) {
      expect(c.prompt).toMatch(/^Set Team coordination overhead to \d/);
    }
  });

  it('EVERY no-op turn keeps an affordance — an empty chip list is the dead end Lane 22 already fixed', async () => {
    // ⚠ THIS TEST EXISTS BECAUSE THE FIRST VERSION OF THE FIX BROKE IT, and an
    // EXISTING telemetry test caught it, not this lane's own kit: the composer
    // emits chips only where the user's words bound a value, so the
    // `named_target_no_value` branch shipped ZERO chips and
    // `deterministic_chips_emitted` fell to 0. An empty offer now means "I have
    // no offer of my own", and the generic label chips (which carry no number)
    // still ship. Both halves are asserted: chips exist, and none of them
    // invents a number the user did not bound.
    for (const message of [
      ...Object.values(WITNESSED_MESSAGES),
      'Change this',
      'Change Team coordination overhead',
    ]) {
      const result = await handleEditGraph(
        makeContext(),
        message,
        makeNoOpAdapter(),
        'req',
        'turn',
      );
      expect(result.suggestedActions, `no affordance for: ${message}`).toBeDefined();
      expect(result.suggestedActions!.length, `no affordance for: ${message}`).toBeGreaterThan(0);
    }
  });

  it('⭐ WIRING — an OPTION carrying a value is offered no factor-value chip, and still keeps an affordance', async () => {
    // The counterexample proven through the REAL handler, not the composer
    // alone. Two halves, and the second is the one the composer spec is
    // structurally blind to: the composer returns an EMPTY chip list and
    // `edit-graph.ts` substitutes the generic label chips, so "no numeric
    // offer" must not become the chip-less dead end Lane 22 already fixed.
    const message = 'Change Deploy the AI chatbot to low.';
    const result = await handleEditGraph(
      makeContext(),
      message,
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    const text = result.assistantText ?? '';

    // We still say which node we understood — the fix is not a silent drop.
    expect(text).toContain('Deploy the AI chatbot');
    // ...and we make no claim about a scale, and promise no value write that
    // `set_factor_value` would refuse.
    expect(text).not.toMatch(/0–1 scale/);
    expect(text).not.toMatch(/Give me the value and I'll write it/);

    // No chip writes a number into an option.
    const chips = result.suggestedActions ?? [];
    for (const c of chips) {
      const m = (c as { message?: string; prompt?: string }).message ?? (c as { prompt?: string }).prompt ?? '';
      expect(m, `chip offers a value on an option: ${m}`).not.toMatch(
        /Set Deploy the AI chatbot to [0-9]/,
      );
    }
    // The affordance survives.
    expect(chips.length, 'the option branch became a chip-less dead end').toBeGreaterThan(0);
  });

  it('⭐ WIRING — OPPOSITE DIRECTION: a real FACTOR still gets its numeric offer through the same handler', async () => {
    // A guard that closes the option case by suppressing chips on real factors
    // would be a worse defect than the one it fixes. Same handler, same graph,
    // opposite expectation — a probe that answered the same for both would
    // prove nothing about the discrimination.
    const result = await handleEditGraph(
      makeContext(),
      WITNESSED_MESSAGES.W2,
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    const chips = result.suggestedActions ?? [];
    const numericOffers = chips.filter((c) =>
      /Set Team coordination overhead to [0-9]/.test(
        (c as { message?: string; prompt?: string }).message ??
          (c as { prompt?: string }).prompt ??
          '',
      ),
    );
    expect(numericOffers.length).toBeGreaterThan(0);
  });

  it('⭐ WIRING — a £ factor is never told it is on a 0–1 scale, and is offered no bare number', async () => {
    // The F1 harm, proven through the REAL handler rather than the composer
    // alone. Before the field-path fix this reply claimed a 0-1 scale on a
    // £-denominated factor and offered a chip writing 0.1 into it.
    const result = await handleEditGraph(
      makeContext(),
      'Change Marketing spend to low',
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    expect(result.assistantText).toMatch(/measured in £/i);
    expect(result.assistantText).not.toMatch(/0–1 scale/);
    for (const c of result.suggestedActions ?? []) {
      expect(c.prompt, `bare number offered on a £ factor: ${c.prompt}`).not.toMatch(
        /^Set Marketing spend to \d/,
      );
    }
  });

  it('⭐ WIRING — a factor whose scale nothing declares gets no scale claim and no number', async () => {
    // 403 of 491 real nodes are this class. Asserted through the handler so a
    // regression in the call-site projection shows up here too.
    const result = await handleEditGraph(
      makeContext(),
      'Change Team morale to low',
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    expect(result.assistantText).toContain('Team morale');
    expect(result.assistantText).not.toMatch(/0–1 scale/);
    for (const c of result.suggestedActions ?? []) {
      expect(c.prompt).not.toMatch(/^Set Team morale to \d/);
    }
    // …and it still keeps an affordance.
    expect(result.suggestedActions!.length).toBeGreaterThan(0);
  });

  it('a number is offered ONLY where the user’s own words bounded one', async () => {
    // W2 said "low", so the band bounds the offer → numbers are allowed.
    const bounded = await handleEditGraph(
      makeContext(),
      WITNESSED_MESSAGES.W2,
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    expect(bounded.suggestedActions!.some((c) => /\d/.test(c.prompt))).toBe(true);
    // This one bounds nothing → not one chip may carry a number.
    const unbounded = await handleEditGraph(
      makeContext(),
      'Change Team coordination overhead',
      makeNoOpAdapter(),
      'req',
      'turn',
    );
    expect(unbounded.suggestedActions!.some((c) => /\d/.test(c.prompt))).toBe(false);
  });

  it('KNOWN-DROPPED still lands on the pristine copy — the fallback is preserved, not replaced', async () => {
    // "Change this" names no node, so the composer grounds nothing and the
    // caller keeps its existing copy. That is the status quo, deliberately.
    const text = await replyFor('Change this');
    expect(text).toBe(PRISTINE_WITNESSED_TEXT);
  });

  it('a PRESERVED LLM clarifying question still wins — this change is scoped to the fallback branch', async () => {
    const q = 'Which factor did you mean — the one driving cost, or the one driving time?';
    const adapter = {
      name: 'mock',
      model: 'mock',
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          operations: [],
          removed_edges: [],
          warnings: [],
          coaching: { summary: q },
        }),
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      chatWithTools: vi.fn(),
    } as unknown as LLMAdapter;
    const result = await handleEditGraph(
      makeContext(),
      WITNESSED_MESSAGES.W2,
      adapter,
      'req',
      'turn',
    );
    expect(result.noOpClarificationPreserved).toBe(true);
    expect(result.assistantText).toBe(q);
  });
});
