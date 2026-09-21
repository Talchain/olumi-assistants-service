/**
 * Context Architecture v2 — S4 rolling summary: SUPERSESSION VISIBILITY (D1).
 *
 * ── The defect these pin ────────────────────────────────────────────────────
 *
 * Carry-forward (assemble.ts) repairs the measured 57/57 erasure: a pass that
 * empties a retention-required slot has its prior entries restored, and the
 * pass still lands. That repair was SILENT. A restored entry was
 * byte-indistinguishable from one the latest pass confirmed, so:
 *
 *   C4 — a LEGITIMATE WITHDRAWAL is overridden. The summariser correctly
 *        empties CONSTRAINTS because the user withdrew the constraint; the
 *        repair restores the withdrawn figure WITH ITS ORIGINAL PROVENANCE,
 *        and the next prompt asserts it to the coach as current fact. The
 *        trigger is EMPTYING, not correcting.
 *
 *   The rewrite twin — a correction (`500k` → `350k`) lands cleanly and leaves
 *        NO supersession record. Nothing in the stored summary separates "the
 *        user corrected this" from "the summariser dropped the old fact and
 *        invented a replacement".
 *
 * ── What this slice does, and its honest bound ──────────────────────────────
 *
 * It makes correction and withdrawal EXPRESSIBLE (summariser.ts prompt rules)
 * and carry-forward VISIBLE (the `carried_forward` stamp + the injected
 * qualifier). It does NOT and cannot force the model to notice a
 * contradiction, and — because CONSTRAINTS stores at most ONE entry per slot
 * per pass — no code-side check can prove a correction was RECORDED rather
 * than a fact silently DROPPED. The durable fix is per-entry CONSTRAINTS
 * storage, which is out of scope here and rowed separately.
 *
 * Each test says what it looks like when its guard is removed.
 */

import { describe, it, expect, vi } from 'vitest';

import { assembleSummaryFromParsed } from '../assemble.js';
import { maintainRollingSummaryForCommit } from '../capture.js';
import type { ConversationHistoryReader, MaintainerTurn } from '../capture.js';
import { buildConversationSummarySection, CARRIED_FORWARD_QUALIFIER } from '../inject.js';
import { parseSummaryOutput } from '../parse-summary.js';
import { findErasedSlots } from '../retention.js';
import { SUMMARISER_SYSTEM_PROMPT } from '../summariser.js';
import type { SummariserModel } from '../summariser.js';
import type { RollingSummaryStorePort, UpsertRollingSummaryOutcome } from '../store-adapter.js';
import { parseStoredRollingSummary, SUMMARY_SCHEMA_VERSION } from '../summary-types.js';
import type { RollingSummary } from '../summary-types.js';

const SCENARIO = 'scenario-supersession';

/** The durable constraint under test — a figure the user stated at turn-3. */
const BUDGET_500K = 'Hard budget cap of 500k for the quarter.';

function priorWithBudget(): RollingSummary {
  return {
    text: [
      'DECISION FRAME: Absorbing a support ticket surge across four options.',
      `CONSTRAINTS & PREFERENCES: ${BUDGET_500K}`,
      'RESOLVED: The four options are agreed.',
      'OPEN: Whether to add a fifth option.',
    ].join('\n'),
    slots: [
      {
        slot: 'FRAME',
        entries: [
          { text: 'Absorbing a support ticket surge across four options.', source_turn_ids: [] },
        ],
      },
      { slot: 'CONSTRAINTS', entries: [{ text: BUDGET_500K, source_turn_ids: ['turn-3'] }] },
      {
        slot: 'RESOLVED',
        entries: [{ text: 'The four options are agreed.', source_turn_ids: ['turn-4'] }],
      },
      {
        slot: 'OPEN',
        entries: [{ text: 'Whether to add a fifth option.', source_turn_ids: ['turn-7'] }],
      },
    ],
    updated_turn_id: 'turn-8',
    updated_turn_created_at: new Date(1_700_000_000_000 + 8 * 1000).toISOString(),
    version: 8,
    generator: 'incremental',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}

/** The summariser output when the user WITHDRAWS the budget cap: it correctly
 *  empties CONSTRAINTS. This is C4's trigger — emptying, not correcting. */
const WITHDRAWING_OUTPUT = [
  'DECISION FRAME: Absorbing a support ticket surge across four options.',
  'CONSTRAINTS & PREFERENCES: (none)',
  'RESOLVED: The four options are agreed. [t1]',
  'OPEN: Whether to add a fifth option. [t1]',
].join('\n');

/** The summariser output when the user CORRECTS the figure. Lands cleanly. */
const REWRITING_OUTPUT = [
  'DECISION FRAME: Absorbing a support ticket surge across four options.',
  'CONSTRAINTS & PREFERENCES: Hard budget cap of 350k for the quarter. [t1]',
  'RESOLVED: The four options are agreed. [t1]',
  'OPEN: Whether to add a fifth option. [t1]',
].join('\n');

/** The output the new prompt rule ASKS for on a correction: the superseded
 *  value stays visible in the entry. */
const MARKED_CORRECTION_OUTPUT = [
  'DECISION FRAME: Absorbing a support ticket surge across four options.',
  'CONSTRAINTS & PREFERENCES: Hard budget cap of 350k for the quarter (was 500k; superseded). [t1]',
  'RESOLVED: The four options are agreed. [t1]',
  'OPEN: Whether to add a fifth option. [t1]',
].join('\n');

function assembleFrom(raw: string, prior: RollingSummary | null): RollingSummary {
  const parsed = parseSummaryOutput(raw);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('fixture did not parse');
  return assembleSummaryFromParsed({
    parsedSlots: parsed.slots,
    ordinalMap: new Map([['t1', { turn_id: 'turn-9', created_at: 'ts', speaker: 'user' as const }]]),
    watermark: { turn_id: 'turn-9', created_at: 'ts' },
    version: 9,
    generator: 'incremental',
    ...(prior === null ? {} : { priorForRetention: prior }),
  });
}

/** The REAL persistence round-trip: the store writes the object to JSONB and
 *  reads it back through `parseStoredRollingSummary`. Every consumer —
 *  inject.ts included — sees the summary through this, and a bare `z.object`
 *  STRIPS undeclared keys silently, so a stamp that is not declared in the
 *  schema would vanish here with no error. Asserting through the round-trip is
 *  what binds the test to the shipped read path rather than to memory. */
function throughStore(summary: RollingSummary): RollingSummary {
  const stored = parseStoredRollingSummary(JSON.parse(JSON.stringify(summary)));
  expect(stored).not.toBeNull();
  return stored!;
}

function entryFor(summary: RollingSummary, slot: 'CONSTRAINTS' | 'RESOLVED' | 'OPEN' | 'FRAME') {
  return summary.slots.find((b) => b.slot === slot)!.entries;
}

// ---------------------------------------------------------------------------
// (a) CARRY-FORWARD IS NO LONGER SILENT — RED at pristine.
// ---------------------------------------------------------------------------

describe('a carried-forward entry cannot masquerade as freshly confirmed', () => {
  it('stamps the restored entry and renders it QUALIFIED in the injected block, through the store round-trip', () => {
    // Unguarded (pristine): the restored 500k entry renders byte-identically to
    // one the user restated this turn, so the prompt asserts a possibly
    // withdrawn figure to the coach as current fact.
    const written = assembleFrom(WITHDRAWING_OUTPUT, priorWithBudget());

    // The repair still fires — the record survives (that guarantee is unchanged).
    const constraints = entryFor(written, 'CONSTRAINTS');
    expect(constraints).toHaveLength(1);
    expect(constraints[0]!.text).toBe(BUDGET_500K);
    // ...and it is now MARKED as a repair, not as a confirmation.
    expect(constraints[0]!.carried_forward).toBe(true);

    // Survives storage: the stamp is declared in RollingSummaryEntrySchema, so
    // the read path keeps it instead of stripping it.
    const stored = throughStore(written);
    expect(entryFor(stored, 'CONSTRAINTS')[0]!.carried_forward).toBe(true);

    // The user-visible half: what the coach is handed on the next turn.
    const section = buildConversationSummarySection(stored, 0, 8);
    expect(section.text).toContain(BUDGET_500K);
    expect(section.text).toContain(CARRIED_FORWARD_QUALIFIER);
    // The qualifier rides INSIDE the slot line — the four-slot block's line
    // count is an invariant another module (withheld-history-redaction.ts)
    // asserts, so a qualifier on its own line would break a guard elsewhere.
    const constraintLine = section.text
      .split('\n')
      .find((l) => l.startsWith('CONSTRAINTS & PREFERENCES: '))!;
    expect(constraintLine).toContain(CARRIED_FORWARD_QUALIFIER);
    expect(section.text.split('\n')).toHaveLength(4);
  });

  it('CONTROL — a freshly-written entry is NOT stamped and NOT qualified', () => {
    // The discriminator for the "stamp everything" mutant: if the stamp were
    // unconditional, every entry in every summary would be disclaimed as
    // unconfirmed and the disclosure would carry no information at all.
    const written = assembleFrom(REWRITING_OUTPUT, priorWithBudget());
    const constraints = entryFor(written, 'CONSTRAINTS');
    expect(constraints).toHaveLength(1);
    expect(constraints[0]!.carried_forward).toBeUndefined();

    const section = buildConversationSummarySection(throughStore(written), 0, 8);
    expect(section.text).toContain('350k');
    expect(section.text).not.toContain(CARRIED_FORWARD_QUALIFIER);
    // Every other slot on the SAME summary is fresh too — a slot-scoped
    // (rather than entry-scoped) mutant is caught here.
    expect(entryFor(written, 'RESOLVED')[0]!.carried_forward).toBeUndefined();
    expect(entryFor(written, 'OPEN')[0]!.carried_forward).toBeUndefined();
  });

  it('reaches the coach through the real maintainer, not just the pure assembler', async () => {
    const store = new RecordingStore(priorWithBudget());
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-9',
      persistedRowId: 'row-9',
      historyReader: historyReader([WITHDRAWAL_TURN]),
      summaryStore: store,
      model: fakeModel(WITHDRAWING_OUTPUT),
    });
    expect(store.upsertSummary).toHaveBeenCalledTimes(1);
    const written = store.upsertSummary.mock.calls[0]![1];
    const section = buildConversationSummarySection(throughStore(written), 0, 8);
    expect(section.text).toContain(BUDGET_500K);
    expect(section.text).toContain(CARRIED_FORWARD_QUALIFIER);
  });
});

// ---------------------------------------------------------------------------
// (b) THE MARKER SURVIVES THE PIPELINE — green by construction, stated.
// ---------------------------------------------------------------------------

describe('a marked correction survives parse → assemble → inject intact', () => {
  it('keeps "(was 500k; superseded)" as text while still extracting the citation', () => {
    // GREEN-BY-CONSTRUCTION, and said so deliberately: this required no parser
    // change. PROVENANCE_RE matches only [tN]-shaped SQUARE brackets, so a
    // parenthesised marker is ordinary prose to it. The test exists because
    // that property is what makes the prompt rule shippable at all — if it
    // ever stops holding (a parser widened to strip parentheticals, say), the
    // supersession record is silently destroyed in transit and nothing else
    // would notice.
    const parsed = parseSummaryOutput(MARKED_CORRECTION_OUTPUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const constraintSlot = parsed.slots.find((s) => s.slot === 'CONSTRAINTS')!;
    expect(constraintSlot.text).toContain('(was 500k; superseded)');
    expect(constraintSlot.refs).toEqual(['t1']); // the [t1] stamp was still consumed

    const written = assembleFrom(MARKED_CORRECTION_OUTPUT, priorWithBudget());
    const entry = entryFor(written, 'CONSTRAINTS')[0]!;
    expect(entry.text).toContain('(was 500k; superseded)');
    expect(entry.source_turn_ids).toEqual(['turn-9']); // resolved, not dropped

    const section = buildConversationSummarySection(throughStore(written), 0, 8);
    expect(section.text).toContain('350k');
    expect(section.text).toContain('(was 500k; superseded)');
    // A correction is NOT a carry-forward: it is this pass's own work.
    expect(section.text).not.toContain(CARRIED_FORWARD_QUALIFIER);
  });
});

// ---------------------------------------------------------------------------
// (c) CHARACTERISATION — C4's mechanics, measured, so the follow-up lane
//     inherits behaviour rather than a description of it.
// ---------------------------------------------------------------------------

describe('CHARACTERISATION: what carry-forward can and cannot see today', () => {
  it('fires on EMPTYING — so a legitimate withdrawal is overridden, and the stale provenance rides along', () => {
    // This is C4 stated as an executable fact, not a claim. It is NOT a
    // regression test for a fix: the override still happens. What changed in
    // this slice is only that it is now disclosed.
    const parsed = parseSummaryOutput(WITHDRAWING_OUTPUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // The gate SEES the emptying...
    expect(findErasedSlots(priorWithBudget(), parsed.slots)).toEqual(['CONSTRAINTS']);

    // ...and cannot tell "the summariser dropped durable memory" from "the
    // user withdrew the constraint": both arrive as the identical empty slot.
    const written = assembleFrom(WITHDRAWING_OUTPUT, priorWithBudget());
    const entry = entryFor(written, 'CONSTRAINTS')[0]!;
    expect(entry.text).toBe(BUDGET_500K); // the withdrawn figure returns
    expect(entry.source_turn_ids).toEqual(['turn-3']); // wearing turn-3's provenance,
    // which is a real turn where the user DID state it — the provenance is not
    // fabricated, it is STALE, and that is precisely why it reads as fresh.
    expect(written.updated_turn_id).toBe('turn-9'); // on a summary stamped at turn-9
  });

  it('is SILENT on a rewrite — nothing distinguishes "user corrected" from "summariser dropped and invented"', () => {
    // The rewrite twin. No gate fires, no stamp is written, and the superseded
    // value is simply gone. This is the defect per-entry CONSTRAINTS storage
    // exists to fix; the prompt rule in (b) is the only lever available here
    // and it is SOFT — the model may or may not comply.
    const parsed = parseSummaryOutput(REWRITING_OUTPUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(findErasedSlots(priorWithBudget(), parsed.slots)).toEqual([]); // no signal

    const written = assembleFrom(REWRITING_OUTPUT, priorWithBudget());
    const entry = entryFor(written, 'CONSTRAINTS')[0]!;
    expect(entry.text).toBe('Hard budget cap of 350k for the quarter.');
    expect(entry.carried_forward).toBeUndefined(); // not a repair — a clean write
    // The whole stored summary retains NO trace of the value it replaced.
    expect(JSON.stringify(written)).not.toContain('500k');
  });

  it('CONSTRAINTS holds at most ONE entry on a fresh pass — so partial loss is invisible', () => {
    // The structural reason no code-side check can certify a correction: three
    // stated facts collapse into a single entry, and a pass that keeps one of
    // them is byte-indistinguishable from a pass that was given one.
    const written = assembleFrom(
      [
        'DECISION FRAME: f',
        'CONSTRAINTS & PREFERENCES: Budget cap 350k. Must ship by Q3. No redundancies. [t1]',
        'RESOLVED: The four options are agreed. [t1]',
        'OPEN: (none)',
      ].join('\n'),
      priorWithBudget(),
    );
    expect(entryFor(written, 'CONSTRAINTS')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (d) THE PROMPT RULES EXIST IN THE SERVED PROMPT — pinned by identity.
// ---------------------------------------------------------------------------

describe('the summariser prompt can express correction and withdrawal', () => {
  it('carries the correction rule verbatim, with its worked form', () => {
    // Bound to the exact instruction text, not to a regex over keywords: the
    // claim being pinned is that THIS instruction is in the prompt the model
    // is served, and a fuzzy matcher would keep passing after the sentence was
    // rewritten into something that no longer asks for the old value.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      'When the user CORRECTS a constraint they stated earlier, rewrite the entry and keep the old value visible in it, in the form: "Budget is 350k (was 500k; superseded) [t12]"',
    );
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      'a bare new number is indistinguishable from an invented one',
    );
  });

  it('carries the withdrawal rule verbatim, and forbids expressing it by emptying', () => {
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      'When a constraint is WITHDRAWN or no longer applies, never express that by emptying the slot.',
    );
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      '"Constraint withdrawn: the 500k budget cap no longer applies [t14]"',
    );
  });

  it('leaves Doctrine P and the two existing gates’ rules intact', () => {
    // The new rules are ADDITIVE. If a later edit trims the prompt, this is
    // what notices that the load-bearing older rules went with them.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      'Do NOT include probabilities, percentages, scores, or any numeric analysis values',
    );
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      'A user questioning, doubting or challenging something already recorded does NOT delete it.',
    );
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      "Each [tN] label marks ONE speaker's words",
    );
  });
});

// ---------------------------------------------------------------------------
// Harness (idiom copied from retention.test.ts).
// ---------------------------------------------------------------------------

function mkTurn(n: number, user: string, assistant: string): MaintainerTurn {
  return {
    turn_id: `turn-${n}`,
    created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    user_message: user,
    assistant_message: assistant,
  };
}

const WITHDRAWAL_TURN = mkTurn(
  9,
  'Forget the budget cap — finance have lifted it, it no longer applies.',
  'Understood. I have noted that the budget cap no longer constrains the options.',
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
