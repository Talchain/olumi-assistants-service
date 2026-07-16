/**
 * ROADMAP 2.63 C2 — unit pins for the explicit-generate brief assembler's
 * deterministic priority order and its chip-canned-text refusal. Route-level
 * wiring is pinned in route-v2-explicit-generate.test.ts.
 */
import { describe, it, expect } from 'vitest';

import {
  assembleExplicitGenerateBrief,
  type AssembleExplicitGenerateBriefInput,
} from '../assemble-explicit-generate-brief.js';
import {
  DRAFT_GRAPH_MAX_BRIEF_LENGTH,
} from '../../../schemas/assist.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

const BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';
const CANNED = 'Yes, build the model now please'; // 31 chars, fails the shape regex

function turn(userMessage: string | null): SessionTurnWithContent {
  return { user_message: userMessage } as unknown as SessionTurnWithContent;
}

function input(
  overrides: Partial<AssembleExplicitGenerateBriefInput>,
): AssembleExplicitGenerateBriefInput {
  return {
    message: CANNED,
    source: 'chip_click',
    persistedBriefText: null,
    recentTurns: [],
    ...overrides,
  };
}

describe('assembleExplicitGenerateBrief — priority order', () => {
  it('1. a brief-shaped message wins outright (trimmed)', () => {
    const out = assembleExplicitGenerateBrief(
      input({ message: `  ${BRIEF}  `, persistedBriefText: 'Should we do something else entirely with the budget?' }),
    );
    expect(out).toEqual({ brief: BRIEF, source: 'message' });
  });

  it('2. persisted brief_text beats recent turns and the unshaped message', () => {
    const out = assembleExplicitGenerateBrief(
      input({
        source: 'composer',
        persistedBriefText: BRIEF,
        recentTurns: [turn('Whether to expand into the EU market next quarter or wait?')],
      }),
    );
    expect(out).toEqual({ brief: BRIEF, source: 'persisted_brief' });
  });

  it('3. the most recent brief-shaped USER turn is recovered (short/null turns skipped)', () => {
    const out = assembleExplicitGenerateBrief(
      input({ recentTurns: [turn('thanks'), turn(null), turn(BRIEF)] }),
    );
    expect(out).toEqual({ brief: BRIEF, source: 'recent_turn' });
  });

  it('4. an unshaped >=30-char TYPED message drafts (the flag bypasses the shape regex)', () => {
    const typed = 'Compare a senior tech lead against two junior developers for our team';
    const out = assembleExplicitGenerateBrief(input({ message: typed, source: 'composer' }));
    expect(out).toEqual({ brief: typed, source: 'message_unshaped' });
  });

  it("4a. a chip's canned text NEVER becomes the brief, even at >=30 chars", () => {
    // CANNED is 31 chars — over the length floor — but chip_click is barred
    // from message_unshaped: a canned confirm label carries no decision.
    expect(assembleExplicitGenerateBrief(input({}))).toBeNull();
  });

  it('returns null when nothing usable exists anywhere', () => {
    const out = assembleExplicitGenerateBrief(
      input({
        message: 'yes',
        source: 'composer',
        persistedBriefText: '   ',
        recentTurns: [turn('ok'), turn(null)],
      }),
    );
    expect(out).toBeNull();
  });

  it('caps an over-long assembled brief at the draft pipeline Zod max', () => {
    const long = 'Should we expand? ' + 'x'.repeat(7000);
    const out = assembleExplicitGenerateBrief(input({ message: long, source: 'composer' }));
    expect(out?.source).toBe('message');
    expect(out?.brief.length).toBe(DRAFT_GRAPH_MAX_BRIEF_LENGTH);
  });
});
