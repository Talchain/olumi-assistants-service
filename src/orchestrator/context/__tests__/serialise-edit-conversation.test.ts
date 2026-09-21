/**
 * ROADMAP 1.33 — edit-lane conversation starvation.
 *
 * Unit tests for `renderRecentConversationForEdit` and the
 * `serialiseEditContextForLLM` conversation section it feeds. Pins:
 *
 *  1. Empty `context.messages` → no `## Recent Conversation` section (matches
 *     pre-fix behaviour when there is genuinely no prior-turn history).
 *  2. Non-empty `context.messages` → rendered as a bounded `## Recent
 *     Conversation` section, in the given order.
 *  3. Overflow beyond `maxChars` drops the OLDEST messages first and
 *     discloses the drop — never a silent, undisclosed truncation.
 */

import { describe, it, expect } from 'vitest';
import {
  EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS,
  renderRecentConversationForEdit,
  renderRecentConversationForEditWithMeta,
  serialiseEditContextForLLM,
} from '../serialise.js';
import type { ConversationContext } from '../../types.js';

function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scen-1',
    ...overrides,
  };
}

describe('renderRecentConversationForEdit', () => {
  it('returns empty string for no messages', () => {
    expect(renderRecentConversationForEdit([])).toBe('');
  });

  it('renders role: content lines in the given order, undisclosed when within budget', () => {
    const rendered = renderRecentConversationForEdit([
      { role: 'user', content: 'Focus on marketing spend.' },
      { role: 'assistant', content: 'Got it - marketing spend is the focus factor.' },
    ]);
    expect(rendered).toBe(
      'user: Focus on marketing spend.\nassistant: Got it - marketing spend is the focus factor.',
    );
    expect(rendered).not.toContain('omitted');
  });

  it('drops the OLDEST messages first and discloses the drop when over maxChars', () => {
    const messages = [
      { role: 'user' as const, content: 'A'.repeat(100) },
      { role: 'assistant' as const, content: 'B'.repeat(100) },
      { role: 'user' as const, content: 'C'.repeat(100) },
    ];
    const rendered = renderRecentConversationForEdit(messages, 150);

    // Oldest ('A'...) dropped first; most recent ('C'...) survives.
    expect(rendered).not.toContain('A'.repeat(100));
    expect(rendered).toContain('C'.repeat(100));
    expect(rendered).toMatch(/^\(\d+ earlier turns? omitted for length\)\n/);
  });

  it('never drops the last remaining message even if it alone exceeds maxChars', () => {
    const rendered = renderRecentConversationForEdit(
      [{ role: 'user', content: 'X'.repeat(500) }],
      100,
    );
    expect(rendered).toContain('X'.repeat(500));
  });

  /**
   * The renderer's DEFAULT cap is the exported constant — pinned by BEHAVIOUR,
   * because a default parameter cannot be read directly.
   *
   * ⚠ WHY THIS EXISTS. The default was a bare `4000` literal sitting beside
   * `EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS = 4000`, a SEPARATE literal of the
   * same value. The conformance suite pins the policy replica to the exported
   * constant; NOTHING pinned this renderer's default to it. The structural edit
   * composer calls this renderer with ONE argument, so it inherits the default
   * — move the exported constant and the composer silently keeps 4,000 with no
   * red anywhere. CLAUDE.md trap 12, inside the argument that invoked trap 12.
   *
   * ⚠ AND IT IS DERIVED FROM THE CONSTANT, NOT FROM 4000. Both corpora are
   * sized off `EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS`, so the pair brackets
   * the boundary at ±1 and bites in BOTH directions: a default LOWER than the
   * constant REDs the at-cap case, a default HIGHER REDs the over-cap case.
   * A test written against the literal `4000` would agree with the drift.
   */
  describe('the default cap is EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS, not a second literal', () => {
    /** Two lines whose joined length is EXACTLY `EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS + delta`. */
    function corpusOfJoinedLength(delta: number) {
      // `user: ` (6) + c1 + '\n' (1) + `assistant: ` (11) + c2  ⇒ 18 + c1 + c2
      const HEADS = 'user: '.length + 1 + 'assistant: '.length;
      const first = 'A'.repeat(10);
      const second = 'B'.repeat(EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS + delta - HEADS - 10);
      return [
        { role: 'user' as const, content: first },
        { role: 'assistant' as const, content: second },
      ];
    }

    it('EXACTLY at the constant ⇒ no drop (a default BELOW the constant REDs here)', () => {
      const atCap = corpusOfJoinedLength(0);
      // Positive control on the fixture itself: the corpus really is the size
      // this case is named for, so the assertion below is about the cap and
      // not about a mis-sized input (CLAUDE.md trap 13b — pin the precondition).
      const meta = renderRecentConversationForEditWithMeta(
        atCap,
        EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS,
      );
      expect(meta.originalChars).toBe(EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS);

      // No cap argument — this is the default under test.
      const defaulted = renderRecentConversationForEditWithMeta(atCap);
      expect(defaulted.dropped).toBe(0);
      expect(renderRecentConversationForEdit(atCap)).not.toMatch(/omitted for length/);
    });

    it('ONE char over the constant ⇒ drops the oldest (a default ABOVE the constant REDs here)', () => {
      const overCap = corpusOfJoinedLength(1);
      const meta = renderRecentConversationForEditWithMeta(
        overCap,
        EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS,
      );
      expect(meta.originalChars).toBe(EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS + 1);

      const defaulted = renderRecentConversationForEditWithMeta(overCap);
      expect(defaulted.dropped).toBe(1);
      expect(renderRecentConversationForEdit(overCap)).toMatch(
        /^\(1 earlier turn omitted for length\)\n/,
      );
    });

    it('the defaulted call and the explicit-constant call are byte-identical', () => {
      // Direct binding, and not a vacuous one: the two cases above prove the
      // boundary sits at the constant, so this proves the default PATH is the
      // same path rather than merely agreeing on one input.
      for (const delta of [0, 1, -1, 500]) {
        const corpus = corpusOfJoinedLength(delta);
        expect(renderRecentConversationForEditWithMeta(corpus)).toStrictEqual(
          renderRecentConversationForEditWithMeta(corpus, EDIT_CONTEXT_CONVERSATION_DEFAULT_CHARS),
        );
      }
    });
  });
});

describe('serialiseEditContextForLLM — conversation section', () => {
  it('omits "## Recent Conversation" when context.messages is empty', () => {
    const result = serialiseEditContextForLLM(makeContext({ messages: [] }));
    expect(result).not.toContain('## Recent Conversation');
  });

  it('includes "## Recent Conversation" with the prior turns when present', () => {
    const result = serialiseEditContextForLLM(
      makeContext({
        messages: [
          { role: 'user', content: "Let's focus on marketing spend as the main lever." },
          { role: 'assistant', content: 'Got it - marketing spend is now the focus factor.' },
        ],
      }),
    );
    expect(result).toContain('## Recent Conversation');
    expect(result).toContain("Let's focus on marketing spend as the main lever.");
    expect(result).toContain('Got it - marketing spend is now the focus factor.');
  });
});
