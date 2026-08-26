/**
 * Context Architecture v2 — S4-INJECT: routing-prompt serialisation of the
 * rolling summary (design pack 01 §2, 04 §3.1 [R2], 05 §S4 inject row).
 *
 * Pins:
 *  1. BYTE-IDENTITY (maintain): with no `conversation_summary` on the pack,
 *     structurally remove the independently pinned graph-authority delta and
 *     require the remaining bytes to match the historical pre-S4 golden.
 *  2. Inject-mode adds EXACTLY the block: the serialised prompt is the
 *     baseline prompt with (a) the `conversation_summary` section appended
 *     BELOW the ground-truth `analysis`/`graph` sections in the llmFacing
 *     JSON, and (b) the code-owned facts-beat-summary precedence
 *     instruction appended after the JSON — nothing else changes.
 *  3. The precedence instruction is present ONLY when the section is
 *     present (i.e. only at inject), and carries the 04 §3.1 sentence
 *     verbatim: "the structured state is correct".
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import {
  BRIEF_INSTRUCTION,
  buildUserMessage,
  GRAPH_CONTEXT_INSTRUCTION,
  SUMMARY_PRECEDENCE_INSTRUCTION,
} from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { ContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ContextPackConversationSummary } from '../../src/orchestrator-v5/rolling-summary/inject.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';

// ---------------------------------------------------------------------------
// Fixture — MUST stay byte-for-byte in sync with the golden probe that
// captured PRE_CHANGE_SHA256 on the unmodified base (see PR body).
// ---------------------------------------------------------------------------

const PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 't-golden',
  scenario_id: 'scn-golden',
  message: 'What should I focus on?',
  turn_class: 'decide',
  stage: 'analyse',
};

function baselinePack(): ContextPack {
  return assembleContextPack({
    payload: PAYLOAD,
    priorTurns: [
      {
        // Base-field completion (review fixup): projectConversation reads ONLY
        // turn_id/turn_class/handler_id/created_at/user_message/assistant_message
        // (context-pack-assembler), so the added fields are inert — the golden
        // bytes are unchanged. 'coach' is serialised into the prompt and pinned
        // by the sha256 golden — the VALUE must not change (byte-preserving cast).
        id: 'row-2',
        scenario_id: 'scn-golden',
        user_id: null,
        request_hash: 'sha256:test',
        response_emitted: true,
        llm_calls_used: 0,
        duration_ms: 0,
        turn_id: 'turn-2',
        turn_class: 'coach' as SessionTurnWithContent['turn_class'],
        handler_id: null,
        created_at: '2026-07-10T10:01:00.000Z',
        user_message: 'Second question',
        assistant_message: 'Second answer',
      },
      {
        id: 'row-1',
        scenario_id: 'scn-golden',
        user_id: null,
        request_hash: 'sha256:test',
        response_emitted: true,
        llm_calls_used: 0,
        duration_ms: 0,
        turn_id: 'turn-1',
        turn_class: 'coach' as SessionTurnWithContent['turn_class'],
        handler_id: null,
        created_at: '2026-07-10T10:00:00.000Z',
        user_message: 'First question',
        assistant_message: 'First answer',
      },
    ],
    priorFacts: [],
    brief: 'Choose a supplier for the new product line.',
    graphContext: { status: 'unavailable' },
  });
}

/** Historical pre-S4 sha256. The mandatory graph-authority delta is removed
 * structurally before this is asserted, preserving the original evidence. */
const PRE_CHANGE_SHA256 =
  '0b7ddf441acc5c9367ed845a7525b1bbe65f87087544e9324ff6764c282a6348';

function subtractGraphAuthorityDelta(
  message: string,
  expectedStatus: 'canonical' | 'provisional' | 'absent' | 'unavailable',
): string {
  const marker = `\n\n${GRAPH_CONTEXT_INSTRUCTION}`;
  const jsonStart = message.indexOf('{');
  const jsonEnd = message.indexOf(marker);
  expect(jsonStart).toBeGreaterThan(-1);
  expect(jsonEnd).toBeGreaterThan(jsonStart);
  const parsed = JSON.parse(message.slice(jsonStart, jsonEnd)) as Record<string, unknown>;
  expect(parsed.graph_context).toEqual({ status: expectedStatus });
  delete parsed.graph_context;
  return (
    message.slice(0, jsonStart) +
    JSON.stringify(parsed, null, 2) +
    message.slice(jsonEnd + marker.length)
  );
}

const SECTION: ContextPackConversationSummary = {
  text: [
    'DECISION FRAME: Choosing a supplier for the new product line.',
    'CONSTRAINTS & PREFERENCES: Keep Maria on the team. [t:aaaaaaaa]',
    'RESOLVED: (none)',
    'OPEN: Which region first?',
  ].join('\n'),
  current_to_turn_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  lag_turns: 1,
  stale: false,
};

function withSummary(pack: ContextPack): ContextPack {
  return { ...pack, conversation_summary: SECTION };
}

describe('buildUserMessage — conversation_summary (S4-inject)', () => {
  it('no section on the pack → byte-identical to the pre-change baseline (off + maintain)', () => {
    const out = buildUserMessage(baselinePack(), PAYLOAD.message);
    expect(out).not.toContain('conversation_summary');
    expect(out).not.toContain(SUMMARY_PRECEDENCE_INSTRUCTION);
    expect(out).toContain('"graph_context": {');
    expect(out).toContain('"status": "unavailable"');
    expect(out.split(GRAPH_CONTEXT_INSTRUCTION)).toHaveLength(2);
    expect(out.split(BRIEF_INSTRUCTION)).toHaveLength(2);
    const beforeGraphAuthority = subtractGraphAuthorityDelta(out, 'unavailable');
    expect(beforeGraphAuthority.length).toBe(2535);
    expect(createHash('sha256').update(beforeGraphAuthority).digest('hex')).toBe(
      PRE_CHANGE_SHA256,
    );
  });

  it('section present → adds EXACTLY the block + instruction, below ground-truth state', () => {
    const base = buildUserMessage(baselinePack(), PAYLOAD.message);
    const out = buildUserMessage(withSummary(baselinePack()), PAYLOAD.message);

    // The block appears exactly once…
    expect(out.match(/"conversation_summary":/g)).toHaveLength(1);
    // …BELOW the ground-truth sections: after the LAST llmFacing keys
    // (`analysis`, `graph` are re-appended at the end by the destructure
    // rebuild — the summary section must serialise after BOTH).
    const summaryIdx = out.indexOf('"conversation_summary":');
    expect(summaryIdx).toBeGreaterThan(out.lastIndexOf('"analysis":'));
    expect(summaryIdx).toBeGreaterThan(out.lastIndexOf('"graph":'));

    // The precedence instruction appears exactly once, after the JSON and
    // before the user turn.
    const instrIdx = out.indexOf(SUMMARY_PRECEDENCE_INSTRUCTION);
    expect(instrIdx).toBeGreaterThan(summaryIdx);
    expect(instrIdx).toBeLessThan(out.indexOf('## User turn'));

    // "Adds EXACTLY the block": reconstruct the expected output from the
    // baseline — swap the serialised JSON for one carrying the section as
    // its final key, and insert the instruction before '## User turn'.
    const baseJson = base.slice(
      base.indexOf('{'),
      base.indexOf(`\n\n${GRAPH_CONTEXT_INSTRUCTION}`),
    );
    const parsed = JSON.parse(baseJson) as Record<string, unknown>;
    const expectedJson = JSON.stringify(
      { ...parsed, conversation_summary: SECTION },
      null,
      2,
    );
    const expected = base
      .replace(baseJson, expectedJson)
      .replace('\n\n## User turn', `\n\n${SUMMARY_PRECEDENCE_INSTRUCTION}\n\n## User turn`);
    expect(out).toBe(expected);
  });

  it('the instruction defers to graph_context and preserves stamp hygiene', () => {
    expect(SUMMARY_PRECEDENCE_INSTRUCTION).toContain('follow `graph_context`');
    expect(SUMMARY_PRECEDENCE_INSTRUCTION).toContain('canonical structured state wins');
    expect(SUMMARY_PRECEDENCE_INSTRUCTION).toContain('working notes');
    // Never echo provenance stamps / turn identifiers into user-facing text.
    expect(SUMMARY_PRECEDENCE_INSTRUCTION.toLowerCase()).toContain('never');
  });

  it('stale section: the note rides the serialised block (in-band disclosure)', () => {
    const stale: ContextPackConversationSummary = {
      ...SECTION,
      lag_turns: 6,
      stale: true,
      note: '(summary current to an earlier turn; the latest 6 turns are shown verbatim in the conversation section)',
    };
    const out = buildUserMessage(
      { ...baselinePack(), conversation_summary: stale },
      PAYLOAD.message,
    );
    expect(out).toContain('current to an earlier turn');
  });
});
