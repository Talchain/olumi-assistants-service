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
  renderRecentConversationForEdit,
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

  it('renders the shared rolling summary with an explicit working-notes precedence rule', () => {
    const result = serialiseEditContextForLLM(
      makeContext({
        messages: [{ role: 'user', content: 'The current model is the authority.' }],
        conversation_summary: {
          text: 'RESOLVED: Supplier assurance readiness changed from 0.3 to 0.8. [t:accepted]',
          current_to_turn_id: 'accepted-turn',
          lag_turns: 1,
          stale: false,
        },
      }),
    );

    expect(result).toContain('## Conversation Summary — working notes');
    expect(result).toContain('Supplier assurance readiness changed from 0.3 to 0.8.');
    expect(result).toContain('Current Graph, Analysis Summary, FOCUS, and Recent Conversation override');
    expect(result.indexOf('## Conversation Summary')).toBeGreaterThan(
      result.indexOf('## Recent Conversation'),
    );
  });

  it('renders an honest withheld-summary note without inventing summary text', () => {
    const result = serialiseEditContextForLLM(
      makeContext({
        conversation_summary: {
          text: '',
          current_to_turn_id: 'old-watermark',
          lag_turns: 12,
          stale: true,
          note: '(conversation summary withheld: coverage unverifiable)',
        },
      }),
    );

    expect(result).toContain('## Conversation Summary — working notes');
    expect(result).toContain('(conversation summary withheld: coverage unverifiable)');
    expect(result).not.toContain('RESOLVED:');
  });
});
