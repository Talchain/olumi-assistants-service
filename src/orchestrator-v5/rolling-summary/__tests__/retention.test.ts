/**
 * Context Architecture v2 — S4 rolling summary: DURABLE-MEMORY WRITE GATES.
 *
 * These pin a live defect measured on build 8a06563 (2026-07-25) against the
 * real haiku summariser, 57/57 with a 0/16 control:
 *
 *   a user turn that merely DOUBTS recorded history
 *     → the summariser rewrote `RESOLVED` from eight named decision records to
 *       "(none)"
 *     → assemble.ts stored that as ZERO entries
 *     → inject.ts rendered the bare "(none)" marker, whose documented meaning
 *       for a non-floor summary is "the summariser looked and found none"
 *     → every later turn's ContextPack told the coach, affirmatively, that no
 *       settled history exists.
 *
 * The user-visible consequence is the last step, so the erasure test below
 * follows the value all the way into the injected pack section rather than
 * stopping at an internal string comparison.
 *
 * Sibling defect, same write path (observed once by
 * parallel-briefs/COACH-RECORD-DENIAL-PROBE-2026-07-25.md): the summariser
 * wrote "The assistant acknowledged it cannot back up those names" when the
 * assistant had said no such thing — a USER's challenge persisted as an
 * ASSISTANT's concession.
 *
 * Each test states what it looks like when the guard is removed.
 */

import { describe, it, expect, vi } from 'vitest';

import { assembleSummaryFromParsed } from '../assemble.js';
import { buildSummariserInput } from '../build-input.js';
import type { SummariserTurn } from '../build-input.js';
import { maintainRollingSummaryForCommit } from '../capture.js';
import type { ConversationHistoryReader, MaintainerTurn } from '../capture.js';
import { buildConversationSummarySection } from '../inject.js';
import { parseSummaryOutput } from '../parse-summary.js';
import {
  findErasedSlots,
  findUnwitnessedAssistantAttributions,
} from '../retention.js';
import type { SummariserModel } from '../summariser.js';
import type { RollingSummaryStorePort, UpsertRollingSummaryOutcome } from '../store-adapter.js';
import { SUMMARY_SCHEMA_VERSION } from '../summary-types.js';
import type { RollingSummary } from '../summary-types.js';

const SCENARIO = 'scenario-records';

/** The eight-name record entry — the durable fact the defect destroys. */
const RECORDS_TEXT =
  'Eight prior decisions exist on record (Contractor Surge approved by Marchbanks-Delacroix at the 900-ticket threshold; Do Nothing by Fenwick-Oyelaran; Outsource Tier 1 by Blackthorpe-Sarnaik at 200; Hire Two Agents by Ravensmere-Iwuchukwu).';

function priorWithRecords(): RollingSummary {
  return {
    text: [
      'DECISION FRAME: Absorbing a support ticket surge across four options.',
      'CONSTRAINTS & PREFERENCES: Hard budget cap of 80k for the quarter.',
      `RESOLVED: ${RECORDS_TEXT}`,
      'OPEN: Whether to add a fifth option.',
    ].join('\n'),
    slots: [
      { slot: 'FRAME', entries: [{ text: 'Absorbing a support ticket surge across four options.', source_turn_ids: [] }] },
      { slot: 'CONSTRAINTS', entries: [{ text: 'Hard budget cap of 80k for the quarter.', source_turn_ids: ['turn-3'] }] },
      { slot: 'RESOLVED', entries: [{ text: RECORDS_TEXT, source_turn_ids: ['turn-4'] }] },
      { slot: 'OPEN', entries: [{ text: 'Whether to add a fifth option.', source_turn_ids: ['turn-7'] }] },
    ],
    updated_turn_id: 'turn-8',
    updated_turn_created_at: new Date(1_700_000_000_000 + 8 * 1000).toISOString(),
    version: 8,
    generator: 'incremental',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}

function mkTurn(n: number, user: string, assistant: string): MaintainerTurn {
  return {
    turn_id: `turn-${n}`,
    created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    user_message: user,
    assistant_message: assistant,
  };
}

/** The measured trigger: the user doubts the records; the assistant concedes
 *  nothing (this reply is verbatim from the source probe document). */
const CHALLENGE_TURN = mkTurn(
  9,
  'I think your last answer was made up. Can you actually back up any of those names, or were you inventing them?',
  'No analysis has been run on your model yet. Your model has 4 options set up and is ready to analyse.',
);

function historyReader(newestFirst: MaintainerTurn[]): ConversationHistoryReader {
  return { readRecent: vi.fn(async () => newestFirst) };
}
function fakeModel(text: string): SummariserModel {
  return { summarise: vi.fn(async () => ({ text })) };
}
class RecordingStore implements RollingSummaryStorePort {
  loadSummary = vi.fn<(id: string) => Promise<RollingSummary | null>>(async () => this.prior);
  upsertSummary = vi.fn<(id: string, s: RollingSummary) => Promise<UpsertRollingSummaryOutcome>>(
    async () => ({ applied: true, regressed: false, current_watermark: 'x' }),
  );
  constructor(public prior: RollingSummary | null) {}
}

/** What the real haiku summariser emitted on the challenge turn, 57/57. */
const ERASING_OUTPUT = [
  'DECISION FRAME: Absorbing a support ticket surge across four options.',
  'CONSTRAINTS & PREFERENCES: Hard budget cap of 80k for the quarter. [t1]',
  'RESOLVED: (none)',
  'OPEN: What the four options are; whether to add a fifth option. [t2, t3]',
].join('\n');

// ---------------------------------------------------------------------------
// GATE 1 — non-erasure, followed to the USER-VISIBLE consequence.
// ---------------------------------------------------------------------------

describe('durable memory is not erased by a user challenging it', () => {
  it('the erased summary, if written, TELLS THE COACH no settled history exists (the consequence being prevented)', () => {
    // This test does not exercise the guard — it establishes WHY the guard
    // exists, by running the erased summary through the real injector and
    // reading what the coach would be handed.
    const parsed = parseSummaryOutput(ERASING_OUTPUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const erasedSummary = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap: new Map(),
      watermark: { turn_id: 'turn-9', created_at: 'ts' },
      version: 9,
      generator: 'incremental',
    });
    const section = buildConversationSummarySection(erasedSummary, 0, 8);

    // The pack section injected on every subsequent turn.
    expect(section.text).toContain('RESOLVED: (none)');
    expect(section.text).not.toContain('Marchbanks-Delacroix');
    // ...and the bare "(none)" is an ASSERTION, not a silence: inject.ts uses
    // "(none captured yet)" precisely when it must NOT claim coverage.
    expect(section.text).not.toContain('(none captured yet)');
  });

  it('CARRIES the eight records forward instead of erasing them — and the pass still lands', async () => {
    // Unguarded: upsertSummary is called with a summary whose RESOLVED slot has
    // zero entries, and the eight names are gone from durable memory forever.
    // Guarded: the write still happens (the model's OPEN/FRAME work is kept and
    // the watermark advances — freezing the summary whenever a user expresses
    // doubt would be its own harm), but RESOLVED is restored from the prior.
    const store = new RecordingStore(priorWithRecords());
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-9',
      persistedRowId: 'row-9',
      historyReader: historyReader([CHALLENGE_TURN]),
      summaryStore: store,
      model: fakeModel(ERASING_OUTPUT),
    });
    expect(store.upsertSummary).toHaveBeenCalledTimes(1);
    const written = store.upsertSummary.mock.calls[0]![1];
    const resolved = written.slots.find((s) => s.slot === 'RESOLVED')!;
    expect(resolved.entries).toHaveLength(1);
    expect(resolved.entries[0]!.text).toContain('Marchbanks-Delacroix');
    // Provenance survives the carry-forward too — not just the prose.
    expect(resolved.entries[0]!.source_turn_ids).toEqual(['turn-4']);
    // The rest of the pass is NOT discarded: the model's new OPEN lands.
    expect(written.slots.find((s) => s.slot === 'OPEN')!.entries[0]!.text).toContain('four options');
    expect(written.updated_turn_id).toBe('turn-9');
  });

  it('and the coach therefore still reads the eight records, not "(none)"', async () => {
    // The user-visible half: what the injector projects into the next turn's
    // ContextPack, built from what was actually written above.
    const store = new RecordingStore(priorWithRecords());
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-9',
      persistedRowId: 'row-9',
      historyReader: historyReader([CHALLENGE_TURN]),
      summaryStore: store,
      model: fakeModel(ERASING_OUTPUT),
    });
    const written = store.upsertSummary.mock.calls[0]![1];
    const section = buildConversationSummarySection(written, 0, 8);
    expect(section.text).toContain('Marchbanks-Delacroix');
    expect(section.text).not.toContain('RESOLVED: (none)');
  });

  it('findErasedSlots names RESOLVED and CONSTRAINTS but never OPEN (answering a question SHOULD empty OPEN)', () => {
    const parsed = parseSummaryOutput(
      [
        'DECISION FRAME: f',
        'CONSTRAINTS & PREFERENCES: (none)',
        'RESOLVED: (none)',
        'OPEN: (none)',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(findErasedSlots(priorWithRecords(), parsed.slots).sort()).toEqual([
      'CONSTRAINTS',
      'RESOLVED',
    ]);
  });

  it('carry-forward does NOT resurrect OPEN — an answered question legitimately empties it', () => {
    const parsed = parseSummaryOutput(
      [
        'DECISION FRAME: f',
        'CONSTRAINTS & PREFERENCES: Hard budget cap of 80k for the quarter. [t1]',
        `RESOLVED: ${RECORDS_TEXT} [t1]`,
        'OPEN: (none)',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap: new Map(),
      watermark: { turn_id: 'turn-9', created_at: 'ts' },
      version: 9,
      generator: 'incremental',
      priorForRetention: priorWithRecords(),
    });
    expect(s.slots.find((b) => b.slot === 'OPEN')!.entries).toEqual([]);
    expect(s.text).toContain('OPEN: (none)');
  });

  it('allows the legitimate transitions: OPEN emptying, and a slot that was already empty', () => {
    const prior = priorWithRecords();
    const parsed = parseSummaryOutput(
      [
        'DECISION FRAME: f',
        'CONSTRAINTS & PREFERENCES: Hard budget cap of 80k for the quarter. [t1]',
        `RESOLVED: ${RECORDS_TEXT} [t2]`,
        'OPEN: (none)',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(findErasedSlots(prior, parsed.slots)).toEqual([]);
  });

  it('does not fire when there is no prior summary (nothing to erase)', () => {
    const parsed = parseSummaryOutput(
      ['DECISION FRAME: f', 'CONSTRAINTS & PREFERENCES: (none)', 'RESOLVED: (none)', 'OPEN: (none)'].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(findErasedSlots(null, parsed.slots)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GATE 2 — an assistant attribution must be witnessed by provenance.
// ---------------------------------------------------------------------------

describe('a user’s challenge is never persisted as an assistant’s concession', () => {
  /** Speaker-scoped ordinals for the challenge turn: t1 = the user's words,
   *  t2 = the assistant's. Built by the real input builder. */
  function challengeOrdinalMap() {
    const turns: SummariserTurn[] = [
      {
        turn_id: CHALLENGE_TURN.turn_id,
        created_at: CHALLENGE_TURN.created_at,
        user_message: CHALLENGE_TURN.user_message!,
        assistant_message: CHALLENGE_TURN.assistant_message!,
      },
    ];
    return buildSummariserInput({ mode: 'regen', priorSummary: null, chronologicalTurns: turns })
      .ordinalMap;
  }

  it('the input hands the model ONE speaker per ordinal — it cannot cite a two-speaker unit', () => {
    // Unguarded: a single [t1] covered "USER: …" AND "ASSISTANT: …", so no
    // stored entry could ever say which speaker a claim came from.
    const map = challengeOrdinalMap();
    expect([...map.values()].map((v) => v.speaker)).toEqual(['user', 'assistant']);
    expect(map.size).toBe(2);
  });

  /**
   * The ordinals the MAINTAINER will actually build for this pass, derived
   * from the real input builder rather than hard-coded — in incremental mode
   * the prior summary's cited turns consume the first ordinals (provenance
   * carry), so the challenge turn's user/assistant labels are not t1/t2.
   * Deriving them keeps the test honest if that layout ever changes.
   */
  function maintainerOrdinals(): { user: string; assistant: string } {
    const input = buildSummariserInput({
      mode: 'incremental',
      priorSummary: priorWithRecords(),
      chronologicalTurns: [
        {
          turn_id: CHALLENGE_TURN.turn_id,
          created_at: CHALLENGE_TURN.created_at,
          user_message: CHALLENGE_TURN.user_message!,
          assistant_message: CHALLENGE_TURN.assistant_message!,
        },
      ],
    });
    const entries = [...input.ordinalMap.entries()];
    const user = entries.find(([, v]) => v.speaker === 'user')![0];
    const assistant = entries.find(([, v]) => v.speaker === 'assistant')![0];
    return { user, assistant };
  }

  it('REJECTS "the assistant acknowledged …" when only the USER’s utterance is cited', async () => {
    // The source document's observed v9, cited to the USER's ordinal — the
    // exact combination the defect produced. Unguarded: this is written to
    // durable memory and read as history by every later turn.
    const { user } = maintainerOrdinals();
    const INVERTED = [
      'DECISION FRAME: Absorbing a support ticket surge across four options.',
      `CONSTRAINTS & PREFERENCES: Hard budget cap of 80k for the quarter. [${user}]`,
      `RESOLVED: ${RECORDS_TEXT} The assistant acknowledged it cannot back up those names. [${user}]`,
      `OPEN: Whether to add a fifth option. [${user}]`,
    ].join('\n');
    const store = new RecordingStore(priorWithRecords());
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-9',
      persistedRowId: 'row-9',
      historyReader: historyReader([CHALLENGE_TURN]),
      summaryStore: store,
      model: fakeModel(INVERTED),
    });
    expect(store.upsertSummary).not.toHaveBeenCalled();
  });

  it('ALLOWS a true assistant attribution — the assistant’s own utterance is cited', async () => {
    const { user, assistant } = maintainerOrdinals();
    const WITNESSED = [
      'DECISION FRAME: Absorbing a support ticket surge across four options.',
      `CONSTRAINTS & PREFERENCES: Hard budget cap of 80k for the quarter. [${user}]`,
      `RESOLVED: ${RECORDS_TEXT} The assistant confirmed no analysis has been run yet. [${assistant}]`,
      `OPEN: The user has challenged whether those names are genuine. [${user}]`,
    ].join('\n');
    const store = new RecordingStore(priorWithRecords());
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-9',
      persistedRowId: 'row-9',
      historyReader: historyReader([CHALLENGE_TURN]),
      summaryStore: store,
      model: fakeModel(WITNESSED),
    });
    expect(store.upsertSummary).toHaveBeenCalledTimes(1);
  });

  it('does not fire on an entry with no speaker-scoped citation (unknown is not guilt)', () => {
    const parsed = parseSummaryOutput(
      [
        'DECISION FRAME: f',
        'CONSTRAINTS & PREFERENCES: c [t1]',
        'RESOLVED: The assistant acknowledged it cannot back up those names.',
        'OPEN: (none)',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(findUnwitnessedAssistantAttributions(parsed.slots, new Map())).toEqual([]);
  });

  it('derives source_speakers from provenance, not from the prose', () => {
    const map = challengeOrdinalMap();
    const parsed = parseSummaryOutput(
      ['DECISION FRAME: f', 'CONSTRAINTS & PREFERENCES: c [t1]', 'RESOLVED: r [t2]', 'OPEN: (none)'].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap: map,
      watermark: { turn_id: 'turn-9', created_at: 'ts' },
      version: 9,
      generator: 'regen',
    });
    expect(s.slots.find((b) => b.slot === 'CONSTRAINTS')!.entries[0]!.source_speakers).toEqual(['user']);
    expect(s.slots.find((b) => b.slot === 'RESOLVED')!.entries[0]!.source_speakers).toEqual(['assistant']);
  });
});
