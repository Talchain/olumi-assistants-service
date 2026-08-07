/**
 * Context Architecture v2 — S4 rolling summary: PURE containment proofs.
 *
 * These tests ARE the safety argument (05 §S4 discipline). Each is written to
 * FAIL on the unguarded version:
 *  - parse-reject: an off-contract summariser output must be rejected, not
 *    written (unguarded = accepted garbage);
 *  - watermark/lag boundary: the window must always cover unabsorbed turns
 *    (unguarded = a hole opens silently);
 *  - regen from FULL history (R1): a turn-1 constraint must survive a regen
 *    at turn >20 (unguarded = the 20-window clamp rebuilds the exact cliff);
 *  - capped-input fallback (R1): even a degraded regen re-reads provenance
 *    anchor turns (unguarded = anchors dropped with the tail);
 *  - provenance resolution (R3): stored source_turn_ids are always real,
 *    resolvable turn ids (unguarded = dangling ordinals).
 */

import { describe, it, expect } from 'vitest';

import { parseSummaryOutput } from '../../src/orchestrator-v5/rolling-summary/parse-summary.js';
import {
  computeSummaryLag,
  isSummaryStale,
} from '../../src/orchestrator-v5/rolling-summary/lag.js';
import {
  buildSummariserInput,
  shouldRegenerate,
} from '../../src/orchestrator-v5/rolling-summary/build-input.js';
import type { SummariserTurn } from '../../src/orchestrator-v5/rolling-summary/build-input.js';
import { assembleSummaryFromParsed } from '../../src/orchestrator-v5/rolling-summary/assemble.js';
import { buildDeterministicFloor } from '../../src/orchestrator-v5/rolling-summary/deterministic-floor.js';
import {
  SUMMARY_HARD_CAP_CHARS,
  SUMMARY_REGEN_INPUT_CHAR_BUDGET,
  SUMMARY_SCHEMA_VERSION,
} from '../../src/orchestrator-v5/rolling-summary/summary-types.js';
import type { RollingSummary } from '../../src/orchestrator-v5/rolling-summary/summary-types.js';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function turn(n: number, opts?: { user?: string; assistant?: string; ms?: number }): SummariserTurn {
  return {
    turn_id: `turn-${n}`,
    created_at: new Date(1_700_000_000_000 + (opts?.ms ?? n) * 1000).toISOString(),
    user_message: opts?.user ?? `user message ${n}`,
    assistant_message: opts?.assistant ?? `assistant message ${n}`,
  };
}

const VALID_OUTPUT = [
  'DECISION FRAME: Choosing a European HQ between Berlin and Paris.',
  'CONSTRAINTS & PREFERENCES: Keep the Berlin office open — non-negotiable. [t1, t3]',
  'RESOLVED: Paris ruled out on cost. [t5]',
  'OPEN: Awaiting the tax comparison. [t8]',
].join('\n');

// ---------------------------------------------------------------------------
// parse-summary — reject off-contract, extract provenance.
// ---------------------------------------------------------------------------

describe('parseSummaryOutput', () => {
  it('parses a valid four-slot output and extracts provenance ordinals', () => {
    const r = parseSummaryOutput(VALID_OUTPUT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const constraints = r.slots.find((s) => s.slot === 'CONSTRAINTS')!;
    expect(constraints.text).toBe('Keep the Berlin office open — non-negotiable.');
    expect(constraints.refs).toEqual(['t1', 't3']);
    expect(r.slots.find((s) => s.slot === 'RESOLVED')!.refs).toEqual(['t5']);
    expect(r.slots.find((s) => s.slot === 'FRAME')!.text).toContain('European HQ');
  });

  it('REJECTS output missing the FRAME slot (keep-prior guard)', () => {
    const noFrame = ['CONSTRAINTS & PREFERENCES: x [t1]', 'RESOLVED: y', 'OPEN: z'].join('\n');
    const r = parseSummaryOutput(noFrame);
    expect(r).toEqual({ ok: false, reason: 'missing_frame' });
  });

  it('REJECTS preamble / content before the first label', () => {
    const r = parseSummaryOutput('Here is your summary:\nDECISION FRAME: x');
    expect(r).toEqual({ ok: false, reason: 'content_before_label' });
  });

  it('REJECTS a duplicated slot', () => {
    const dup = ['DECISION FRAME: a', 'DECISION FRAME: b'].join('\n');
    expect(parseSummaryOutput(dup)).toEqual({ ok: false, reason: 'duplicate_slot' });
  });

  it('REJECTS output over the hard cap (bloat)', () => {
    const bloated = `DECISION FRAME: ${'x'.repeat(SUMMARY_HARD_CAP_CHARS + 10)}`;
    expect(parseSummaryOutput(bloated)).toEqual({ ok: false, reason: 'over_cap' });
  });

  it('REJECTS empty output', () => {
    expect(parseSummaryOutput('   \n  ')).toEqual({ ok: false, reason: 'empty' });
  });
});

// ---------------------------------------------------------------------------
// Watermark / lag — the staleness invariant boundary.
// ---------------------------------------------------------------------------

describe('computeSummaryLag / isSummaryStale (watermark invariant)', () => {
  function summaryAt(t: SummariserTurn): RollingSummary {
    return {
      text: 'x',
      slots: [],
      updated_turn_id: t.turn_id,
      updated_turn_created_at: t.created_at,
      version: 1,
      generator: 'incremental',
      schema_version: SUMMARY_SCHEMA_VERSION,
    };
  }

  it('null summary ⇒ lag equals the whole window', () => {
    const window = [turn(5), turn(4), turn(3)]; // newest-first
    expect(computeSummaryLag(null, window)).toBe(3);
  });

  it('counts only turns after the watermark (the watermark turn is absorbed)', () => {
    const window = [turn(5), turn(4), turn(3)]; // newest-first
    // summary covers turn 3 ⇒ turns 4 and 5 are unabsorbed ⇒ lag 2.
    expect(computeSummaryLag(summaryAt(turn(3)), window)).toBe(2);
  });

  it('lag 1 for the normal post-commit case (summary through N, turn N+1 live)', () => {
    const window = [turn(9), turn(8)];
    expect(computeSummaryLag(summaryAt(turn(8)), window)).toBe(1);
  });

  it('BOUNDARY: window depth 8 covers lag ≤ 7; discloses at lag 8 (stale summary at the window edge)', () => {
    // Exactly 8 turns newer than the watermark, window depth 8.
    const newest = Array.from({ length: 8 }, (_, i) => turn(20 - i)); // turns 20..13 newest-first
    const stale = summaryAt(turn(12)); // watermark below all 8
    const lag = computeSummaryLag(stale, newest);
    expect(lag).toBe(8);
    expect(isSummaryStale(lag, 8)).toBe(true); // hole would open → must disclose
    expect(isSummaryStale(7, 8)).toBe(false); // lag 7 is still fully covered
  });

  it('same-ms sibling of the watermark turn counts as unabsorbed (conservative)', () => {
    const a = turn(3, { ms: 100 });
    const b = { ...turn(4, { ms: 100 }) }; // same created_at as a, different turn_id
    const window = [b, a]; // newest-first, both same ms
    // watermark = a; b shares the ms but is not a ⇒ counted (safe over-disclosure).
    expect(computeSummaryLag(summaryAt(a), window)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Regeneration horizon (R1) — full history, not the 20-window.
// ---------------------------------------------------------------------------

describe('buildSummariserInput — regeneration from FULL history (R1)', () => {
  it('shouldRegenerate fires at the N-turn horizon, first-ever, and schema drift', () => {
    const prior: RollingSummary = {
      text: 'x', slots: [], updated_turn_id: 't', updated_turn_created_at: turn(1).created_at,
      version: 1, generator: 'regen', schema_version: SUMMARY_SCHEMA_VERSION,
    };
    expect(shouldRegenerate(1, null)).toBe(true); // first-ever
    expect(shouldRegenerate(20, prior)).toBe(true); // horizon
    expect(shouldRegenerate(25, prior)).toBe(false); // incremental in between
    expect(shouldRegenerate(10, { ...prior, schema_version: 0 })).toBe(true); // schema drift
  });

  it('a regen at turn 25 STILL contains the turn-1 constraint (not clamped to 20)', () => {
    const turns: SummariserTurn[] = [
      turn(1, { user: 'Whatever we choose, we must keep the Berlin office open — non-negotiable.' }),
      ...Array.from({ length: 24 }, (_, i) => turn(i + 2)),
    ];
    const input = buildSummariserInput({ mode: 'regen', priorSummary: null, chronologicalTurns: turns });
    // The full history is shown — all 25 TURNS, and turn-1's constraint is in
    // the prompt. Assert on distinct turns, not on ordinal count: since
    // 2026-07-25 an ordinal labels one UTTERANCE, so each of these turns
    // (which carry both a user and an assistant message) consumes two. The
    // claim under test is coverage of the full history, not the label count.
    expect(new Set([...input.ordinalMap.values()].map((v) => v.turn_id)).size).toBe(25);
    expect(input.userMessage).toContain('keep the Berlin office open');
    expect(input.cappedFallback).toBe(false);
    expect(input.watermark?.turn_id).toBe('turn-25');
  });

  it('capped-input fallback keeps the verbatim tail AND provenance-cited anchor turns', () => {
    // Make each turn large so the full history exceeds the input budget.
    const big = 'z'.repeat(6000);
    const turns: SummariserTurn[] = Array.from({ length: 60 }, (_, i) =>
      turn(i + 1, {
        user: i === 0 ? `Budget is capped at 120000. ${big}` : `msg ${i + 1} ${big}`,
        assistant: big,
      }),
    );
    // sanity: full history really is over budget
    const totalChars = turns.reduce(
      (n, t) => n + (t.user_message?.length ?? 0) + (t.assistant_message?.length ?? 0),
      0,
    );
    expect(totalChars).toBeGreaterThan(SUMMARY_REGEN_INPUT_CHAR_BUDGET);

    const prior: RollingSummary = {
      text: 'DECISION FRAME: x\nCONSTRAINTS & PREFERENCES: budget cap',
      slots: [
        { slot: 'FRAME', entries: [{ text: 'x', source_turn_ids: [] }] },
        { slot: 'CONSTRAINTS', entries: [{ text: 'budget cap', source_turn_ids: ['turn-1'] }] },
        { slot: 'RESOLVED', entries: [] },
        { slot: 'OPEN', entries: [] },
      ],
      updated_turn_id: 'turn-40',
      updated_turn_created_at: turns[39]!.created_at,
      version: 4,
      generator: 'regen',
      schema_version: SUMMARY_SCHEMA_VERSION,
    };
    const input = buildSummariserInput({ mode: 'regen', priorSummary: prior, chronologicalTurns: turns });
    expect(input.cappedFallback).toBe(true);
    // Anchor turn-1 (provenance-cited) survives even though it is far outside
    // the last-20 tail — this is the whole point of the fallback (R1).
    expect(input.userMessage).toContain('Budget is capped at 120000');
    // The verbatim tail (turn 60) is present too.
    expect(input.userMessage).toContain('msg 60');
    // A mid turn NOT cited and outside the tail (e.g. turn 10) is dropped.
    expect(input.userMessage).not.toContain('msg 10 ');
  });

  it('a char-capped regen that drops the OLDEST (unabsorbed) turns does NOT advance the watermark past them (Codex finding 4)', () => {
    // 30 large turns exceed the input budget → capped fallback keeps only the
    // verbatim tail (SUMMARY_INPUT_TAIL_TURNS = 20 → turns 11-30). With NO
    // prior summary (nothing pre-absorbed) and no citations, turns 1-10 are
    // DROPPED and were never seen by the model. Pre-fix the watermark still
    // advanced to the newest turn (turn-30), silently marking the dropped
    // turns 1-10 as absorbed — the next incremental pass would never re-read
    // them (a maintain-path memory hole). Post-fix: with the oldest turn
    // dropped there is no honestly-absorbed prefix, so the watermark is null
    // and the maintainer keeps the prior rather than write a false-complete
    // summary.
    const big = 'z'.repeat(8000);
    const turns: SummariserTurn[] = Array.from({ length: 30 }, (_, i) =>
      turn(i + 1, { user: `msg ${i + 1} ${big}`, assistant: big }),
    );
    const total = turns.reduce(
      (n, t) => n + (t.user_message?.length ?? 0) + (t.assistant_message?.length ?? 0),
      0,
    );
    expect(total).toBeGreaterThan(SUMMARY_REGEN_INPUT_CHAR_BUDGET);

    const input = buildSummariserInput({ mode: 'regen', priorSummary: null, chronologicalTurns: turns });
    expect(input.cappedFallback).toBe(true);
    // The tail (turn 30) is shown; a dropped older turn (turn 5) is not.
    expect(input.userMessage).toContain('msg 30 ');
    expect(input.userMessage).not.toContain('msg 5 ');
    // The watermark must NOT claim turn-30 absorbed — turns 1-10 were dropped.
    expect(input.watermark).toBeNull();
  });

  it('a char-capped regen advances the watermark only up to the newest turn with no UNABSORBED dropped turn behind it (Codex finding 4)', () => {
    // Steady state: a REAL prior summary already absorbed through turn-5. The
    // capped regen keeps the tail (turns 11-30) but DROPS turns 6-10 — which
    // sit ABOVE the prior watermark and were never absorbed. The watermark
    // must cap at turn-5 (the prior-absorbed boundary), NOT advance to turn-30,
    // so the next incremental pass still re-reads turns 6-10.
    const big = 'z'.repeat(8000);
    const turns: SummariserTurn[] = Array.from({ length: 30 }, (_, i) =>
      turn(i + 1, { user: `msg ${i + 1} ${big}`, assistant: big }),
    );
    const prior: RollingSummary = {
      text: 'DECISION FRAME: x',
      slots: [
        { slot: 'FRAME', entries: [{ text: 'x', source_turn_ids: [] }] },
        { slot: 'CONSTRAINTS', entries: [] },
        { slot: 'RESOLVED', entries: [] },
        { slot: 'OPEN', entries: [] },
      ],
      updated_turn_id: 'turn-5',
      updated_turn_created_at: turns[4]!.created_at,
      version: 3,
      generator: 'regen',
      schema_version: SUMMARY_SCHEMA_VERSION,
    };
    const input = buildSummariserInput({ mode: 'regen', priorSummary: prior, chronologicalTurns: turns });
    expect(input.cappedFallback).toBe(true);
    expect(input.watermark?.turn_id).toBe('turn-5');
  });

  it('incremental mode shows only the turns after the prior watermark', () => {
    const turns = Array.from({ length: 6 }, (_, i) => turn(i + 1));
    const prior: RollingSummary = {
      text: 'x', slots: [], updated_turn_id: 'turn-4', updated_turn_created_at: turns[3]!.created_at,
      version: 2, generator: 'incremental', schema_version: SUMMARY_SCHEMA_VERSION,
    };
    const input = buildSummariserInput({ mode: 'incremental', priorSummary: prior, chronologicalTurns: turns });
    // Only turns 5 and 6 are after the watermark. Asserted on distinct turn
    // ids rather than ordinal count — an ordinal labels one UTTERANCE since
    // 2026-07-25, so these two two-speaker turns consume four labels. What is
    // under test is WHICH turns are shown.
    expect(new Set([...input.ordinalMap.values()].map((v) => v.turn_id))).toEqual(
      new Set(['turn-5', 'turn-6']),
    );
    expect(input.userMessage).toContain('user message 5');
    expect(input.userMessage).toContain('user message 6');
    expect(input.userMessage).not.toContain('user message 3');
  });
});

// ---------------------------------------------------------------------------
// Assembly + provenance resolution (R3).
// ---------------------------------------------------------------------------

describe('assembleSummaryFromParsed — provenance resolves to real turn ids (R3)', () => {
  it('resolves ordinal refs to turn ids and drops unresolvable ones', () => {
    const parsed = parseSummaryOutput(VALID_OUTPUT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ordinalMap = new Map([
      ['t1', { turn_id: 'real-1', created_at: 'x' }],
      ['t3', { turn_id: 'real-3', created_at: 'x' }],
      ['t5', { turn_id: 'real-5', created_at: 'x' }],
      // t8 deliberately absent → must be dropped, never dangling.
    ]);
    const summary = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap,
      watermark: { turn_id: 'real-8', created_at: 'ts' },
      version: 3,
      generator: 'regen',
    });
    const constraints = summary.slots.find((s) => s.slot === 'CONSTRAINTS')!;
    expect(constraints.entries[0]!.source_turn_ids).toEqual(['real-1', 'real-3']);
    const open = summary.slots.find((s) => s.slot === 'OPEN')!;
    expect(open.entries[0]!.source_turn_ids).toEqual([]); // t8 dropped, not dangling
    // Rendered text is clean prose (no [tN] stamps leak into the coach-facing block).
    expect(summary.text).not.toMatch(/\[t\d+\]/);
    expect(summary.updated_turn_created_at).toBe('ts');
    expect(summary.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Deterministic floor — never empty, never blocks.
// ---------------------------------------------------------------------------

describe('buildDeterministicFloor', () => {
  it('seeds FRAME from the brief first two sentences + goal label', () => {
    const floor = buildDeterministicFloor({
      briefText: 'We need a new CRM. Budget matters a lot. And more text after.',
      goalLabel: 'Pick a CRM',
      watermark: { turn_id: 'w', created_at: 'ts' },
      version: 1,
    });
    expect(floor.generator).toBe('floor');
    expect(floor.text).toContain('We need a new CRM. Budget matters a lot.');
    expect(floor.text).toContain('Goal: Pick a CRM.');
    expect(floor.updated_turn_created_at).toBe('ts');
  });

  it('is NEVER empty even with no brief and no goal (falls back to latest message)', () => {
    const floor = buildDeterministicFloor({
      briefText: null,
      goalLabel: null,
      watermark: { turn_id: 'w', created_at: 'ts' },
      version: 1,
      latestUserMessage: 'Help me decide between two vendors.',
    });
    expect(floor.text).toContain('Help me decide between two vendors.');
    expect(floor.slots.find((s) => s.slot === 'FRAME')!.entries[0]!.text.length).toBeGreaterThan(0);
  });

  it('degrades to a non-empty placeholder when everything is absent', () => {
    const floor = buildDeterministicFloor({
      briefText: '',
      goalLabel: '',
      watermark: { turn_id: 'w', created_at: 'ts' },
      version: 1,
      latestUserMessage: '',
    });
    expect(floor.text).toContain('A decision is under discussion.');
  });
});
