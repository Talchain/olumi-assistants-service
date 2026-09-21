/**
 * Context Architecture v2 — S4-INJECT: the ContextPack `conversation_summary`
 * section (design pack 01 §2 "injected where", 04 §3.1, 05 §S4 inject row).
 *
 * Pins:
 *  - byte-identity: an assembly WITHOUT the section input produces a pack
 *    with NO `conversation_summary` key and identical JSON bytes to an
 *    explicit-undefined input (flag off / maintain → the turn-executor never
 *    supplies the field).
 *  - inject adds EXACTLY the block: deleting the key from a with-summary
 *    pack yields a deep-equal pack to the without-summary assembly.
 *  - placement: `conversation_summary` sits immediately after `conversation`
 *    in the pack literal (01 §2 "adjacent to `conversation`"); the
 *    LLM-facing BELOW-ground-truth ordering is buildUserMessage's pin (see
 *    tests/unit/v5.route-with-tool-use.conversation-summary.test.ts).
 */

import { describe, it, expect } from 'vitest';

import { assembleContextPack } from '../context-pack-assembler.js';
import type { AssembleContextPackInput } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { ContextPackConversationSummary } from '../../rolling-summary/inject.js';

const SECTION: ContextPackConversationSummary = {
  text: [
    'DECISION FRAME: Choosing a supplier.',
    'CONSTRAINTS & PREFERENCES: Keep Maria on the team. [t:aaaaaaaa]',
    'RESOLVED: (none)',
    'OPEN: Which region first?',
  ].join('\n'),
  current_to_turn_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  lag_turns: 1,
  stale: false,
};

function baseInput(): AssembleContextPackInput {
  return {
    payload: makeMessagePayload({ message: 'What should I focus on?' }),
    priorTurns: [],
    priorFacts: [],
  };
}

describe('ContextPack conversation_summary section (S4-inject)', () => {
  it('absent input → no key, byte-identical to explicit undefined', () => {
    const without = assembleContextPack(baseInput());
    const withUndefined = assembleContextPack({
      ...baseInput(),
      conversationSummary: undefined,
    });
    expect('conversation_summary' in without).toBe(false);
    expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(without));
  });

  it('with section → adds EXACTLY the block (delete → deep-equal to without)', () => {
    const without = assembleContextPack(baseInput());
    const withSummary = assembleContextPack({
      ...baseInput(),
      conversationSummary: SECTION,
    });
    expect(withSummary.conversation_summary).toEqual(SECTION);
    const stripped = { ...withSummary } as Record<string, unknown>;
    delete stripped.conversation_summary;
    expect(stripped).toEqual(without);
  });

  it('placement: conversation_summary immediately follows conversation in the pack', () => {
    const withSummary = assembleContextPack({
      ...baseInput(),
      conversationSummary: SECTION,
    });
    const keys = Object.keys(withSummary);
    const conversationIdx = keys.indexOf('conversation');
    expect(conversationIdx).toBeGreaterThan(-1);
    expect(keys[conversationIdx + 1]).toBe('conversation_summary');
  });

  it('schema accepts the section (strict object, note optional)', () => {
    const withSummary = assembleContextPack({
      ...baseInput(),
      conversationSummary: { ...SECTION, stale: true, note: '(summary current to an earlier turn)' },
    });
    const parsed = ContextPackSchema.safeParse(withSummary);
    expect(parsed.success).toBe(true);
  });

  it('schema rejects unknown fields inside the section (strict — no silent drift)', () => {
    const withSummary = assembleContextPack(baseInput());
    const tampered = {
      ...withSummary,
      conversation_summary: { ...SECTION, smuggled: 'x' },
    };
    const parsed = ContextPackSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
  });
});
