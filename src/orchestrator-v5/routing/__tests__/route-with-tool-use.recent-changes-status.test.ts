import { describe, expect, it } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import { observeSerialisedPack } from '../../context/__tests__/observe-serialised-pack.js';
import {
  buildUserMessage,
  RECENT_CHANGES_INSTRUCTION,
} from '../route-with-tool-use.js';

const MESSAGE = 'What did that update do?';

function basePack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 'turn-recent-status',
      scenario_id: '00000000-0000-4000-8000-0000000000d1',
      message: MESSAGE,
    }),
    priorTurns: [],
    priorFacts: [],
  });
}

describe('recent_changes_status model-facing contract', () => {
  it.each(['complete', 'capped', 'degraded'] as const)(
    'carries %s into exact prompt bytes with the code-owned instruction',
    (status) => {
      const prompt = buildUserMessage(
        { ...basePack(), recent_changes_status: status },
        MESSAGE,
      );
      const serialised = observeSerialisedPack(prompt);

      expect(serialised.recent_changes_status).toBe(status);
      expect(prompt).toContain(`"recent_changes_status": "${status}"`);
      expect(prompt.split(RECENT_CHANGES_INSTRUCTION)).toHaveLength(2);
      expect(prompt).toContain('Only `complete` with an empty list licences');
      expect(prompt).toContain('Conversation turns and rolling summaries are not');
    },
  );

  it('normalises a legacy/direct omission to degraded in actual prompt bytes', () => {
    const { recent_changes_status: _omitted, ...legacyPack } = basePack();
    void _omitted;

    const prompt = buildUserMessage(legacyPack as ContextPack, MESSAGE);
    const serialised = observeSerialisedPack(prompt);

    expect(serialised.recent_changes_status).toBe('degraded');
    expect(prompt).not.toContain('"recent_changes_status": "complete"');
    expect(prompt.split(RECENT_CHANGES_INSTRUCTION)).toHaveLength(2);
  });
});
