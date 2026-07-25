/**
 * The decision-record sanction, moved into code.
 *
 * ## The drift this removes
 *
 * On 2026-07-25 two lanes, twenty minutes apart and unaware of each other,
 * shipped OPPOSITE statements about the same ContextPack field:
 *
 *  - 14:31, `9e3b065a` (#690) — `older_relevant_facts` gained, in its own
 *    bytes, `"[INCOMPLETE — N decisions are on record … Do not describe this
 *    list as complete; if asked how many decisions are on record, the true
 *    total is N.]"`
 *  - ~15:00 — PMS-served orchestrator prompt v120 (`adcc5128d4e6e6bc`,
 *    verified on the live wire) says of that same field: *"it is the complete
 *    set you hold, so if a decision is not listed say plainly that it is not
 *    among your records"*.
 *
 * Both reached the model on the same request. v120's acceptance evidence (438
 * offline replays) predated the disclosure, so the completeness clause was
 * never measured against the field it describes.
 *
 * A sanction kept in step BY HAND, in a different system on a different
 * release cadence, is the estate's dominant defect shape. These tests pin the
 * structural property that makes drift impossible: the instruction is emitted
 * by the SAME condition that puts the section on the pack, from the same
 * commit as the projection that writes it — the pattern already used for
 * `COACHING_CONTEXT_INSTRUCTION` and `SUMMARY_PRECEDENCE_INSTRUCTION`.
 */

import { describe, it, expect } from 'vitest';

import {
  buildUserMessage,
  OLDER_RELEVANT_FACTS_INSTRUCTION,
} from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { ContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

const PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 't-orf',
  scenario_id: 'scn-orf',
  message: 'What did I decide about the hiring threshold?',
  turn_class: 'decide',
  stage: 'analyse',
};

/** Verbatim shape of a capped section as `projectDecisionRecords` emits it. */
const CAPPED_SECTION = [
  'Prior decisions recorded on this scenario (most recent first):',
  '- [2026-07-20] Chose "Hire two seniors": clears the queue by Q4.',
  '',
  '[INCOMPLETE — 9 decisions are on record for this scenario; the 8 most recent are shown above and 1 older one is not shown. Do not describe this list as complete; if asked how many decisions are on record, the true total is 9.]',
].join('\n');

function pack(olderRelevantFacts?: string): ContextPack {
  return assembleContextPack({
    payload: PAYLOAD,
    priorTurns: [],
    priorFacts: [],
    analysis: null,
    ...(olderRelevantFacts !== undefined ? { olderRelevantFacts } : {}),
  });
}

describe('older_relevant_facts — code-owned sanction', () => {
  it('is appended whenever the section is on the pack', () => {
    const prompt = buildUserMessage(pack(CAPPED_SECTION), PAYLOAD.message);
    expect(prompt).toContain(OLDER_RELEVANT_FACTS_INSTRUCTION);
  });

  it('is ABSENT when the section is absent — no section, no instruction', () => {
    const prompt = buildUserMessage(pack(undefined), PAYLOAD.message);
    expect(prompt).not.toContain(OLDER_RELEVANT_FACTS_INSTRUCTION);
    expect(prompt).not.toContain('## Decision records');
  });

  it('emission is driven by the SAME condition that carries the section — the anti-drift property', () => {
    // Not "a string exists somewhere": the instruction's presence must track
    // the field's presence exactly, in both directions. That coupling is what
    // a hand-typed PMS clause cannot have.
    for (const section of [CAPPED_SECTION, undefined]) {
      const prompt = buildUserMessage(pack(section), PAYLOAD.message);
      expect(prompt.includes(OLDER_RELEVANT_FACTS_INSTRUCTION)).toBe(section !== undefined);
      expect(prompt.includes('"older_relevant_facts"')).toBe(section !== undefined);
    }
  });

  it('contradicts the v120 clause it replaces, on the exact point that was wrong', () => {
    // v120: "it is the complete set you hold". The section can be partial and
    // says so; the instruction must defer to the section, not to a constant.
    expect(OLDER_RELEVANT_FACTS_INSTRUCTION).not.toContain('the complete set you hold');
    expect(OLDER_RELEVANT_FACTS_INSTRUCTION).toContain('possibly partial');
    expect(OLDER_RELEVANT_FACTS_INSTRUCTION).toContain(
      'If it carries an `[INCOMPLETE …]` line, that line is authoritative',
    );
    // The completeness reading survives, but CONDITIONALLY — it is what the
    // 438-replay v120 evidence actually established, and it is still correct
    // when no [INCOMPLETE …] line is present.
    expect(OLDER_RELEVANT_FACTS_INSTRUCTION).toContain(
      'not among your records rather than inferring one',
    );
  });

  it('states NO count of its own — a second owner of the number is the defect', () => {
    // The section's own [INCOMPLETE …] line owns the numbers. If this constant
    // carried one it would be a hand-maintained mirror of the store, which is
    // exactly what is being removed.
    expect(OLDER_RELEVANT_FACTS_INSTRUCTION).not.toMatch(/\d/);
  });

  it('does not disturb the section itself — the [INCOMPLETE …] bytes still reach the model', () => {
    const prompt = buildUserMessage(pack(CAPPED_SECTION), PAYLOAD.message);
    expect(prompt).toContain('the true total is 9');
  });
});
