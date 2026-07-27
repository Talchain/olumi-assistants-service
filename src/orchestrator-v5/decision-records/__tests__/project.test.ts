/**
 * Decision Records — knowledge-over-time projection + loader (ROADMAP 1.199, P6).
 *
 * Proves the READ slice is bounded + DISCLOSED (the enforced cut fires — a
 * positive control, trap #13), scenario-scoped, provenance-stamped, and
 * fire-safe. The projection is the cut site that makes the coach_converse
 * `older_relevant_facts` policy row honestly `enforced`.
 *
 * 2026-07-25 — the SILENT DROP defect. Verified live on deployed build
 * `55c64ed`: a scenario holding NINE decision records, asked to "list every
 * prior decision … tell me exactly how many there are in total", was answered
 * with eight records, the phrase "the full record", and "That's 8 prior
 * decisions on record." The oldest record was absent and NOTHING disclosed it
 * on any channel — `truncated` was reported `false` and the wire's
 * `truncations` read `[]` while a record was being evicted.
 *
 * The cause was that every count was derived from the POST-cap array, so the
 * disclosure could only ever report char-BUDGET drops — and the measurement
 * lane established the char budget never binds at realistic label lengths, so
 * the ONLY truncation a user could actually experience was the undisclosed one.
 * The tests below pin the USER-VISIBLE shape (what the section text says about
 * the total), not merely an internal counter.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import {
  projectDecisionRecords,
  loadOlderRelevantFactsSection,
} from '../project.js';
import { DECISION_RECORDS_HARD_CAP } from '../store-adapter.js';
import type { DecisionRecordRead, RetrieveDecisionRecordsOpts } from '../store-adapter.js';
import { POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET } from '../../context/context-policy.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';
import { WITHHELD_ANALYSIS_SUMMARY } from '../../compose/withheld-claim-projection.js';
import * as telemetry from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';

function makeRecord(overrides: Partial<DecisionRecordRead> & { option?: string; statement?: string; date?: string } = {}): DecisionRecordRead {
  const { option = 'Hire locally', statement = 'Local hiring leads on win probability (0.62).', date = '2026-07-24', ...rest } = overrides;
  return {
    record_id: rest.record_id ?? `rec_${Math.random().toString(36).slice(2)}`,
    scenario_id: rest.scenario_id ?? 'scen-1',
    created_at: rest.created_at ?? `${date}T10:00:00.000Z`,
    decision: rest.decision ?? { chosen_option_label: option, chosen_option_id: 'opt', graph_hash: 'aag_v1:sha256:x' },
    prediction: rest.prediction ?? { statement, confidence_source: 'model_derived' },
  };
}

/**
 * A store fake that models the LIVE read at the bytes: the SQL applies the
 * LIMIT (so records past it never enter the process) while `count: 'exact'`
 * reports the pre-LIMIT total. Verified against the live staging PostgREST on
 * a 9-record scenario: `…&order=created_at.desc&limit=8` + `Prefer:
 * count=exact` → `HTTP/2 206`, `content-range: 0-7/9`.
 */
function storeHolding(stored: readonly DecisionRecordRead[]) {
  return {
    retrieveRecords: vi.fn(async (_scenarioId: string, opts?: RetrieveDecisionRecordsOpts) => ({
      records: stored.slice(0, opts?.limit ?? stored.length),
      totalCount: stored.length,
    })),
  };
}

describe('projectDecisionRecords — bounded, disclosed, provenance-stamped', () => {
  it('projects records newest-first with option + rationale + [date] provenance', () => {
    const records = [
      makeRecord({ option: 'Ship in Q3', statement: 'Q3 ship maximises revenue capture.', date: '2026-07-24' }),
      makeRecord({ option: 'Hire locally', statement: 'Local hiring leads on robustness.', date: '2026-07-20' }),
    ];
    const p = projectDecisionRecords(records, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, records.length, true);
    expect(p).not.toBeNull();
    expect(p!.includedCount).toBe(2);
    expect(p!.truncated).toBe(false);
    expect(p!.text).toContain('Ship in Q3');
    expect(p!.text).toContain('Hire locally');
    expect(p!.text).toContain('[2026-07-24]');
    expect(p!.text).toContain('Q3 ship maximises revenue capture.');
  });

  it('a turn-1 durable decision appears in the projection (acceptance-style)', () => {
    const turn1 = makeRecord({ option: 'Bootstrap first', statement: 'DURABLE-CONSTRAINT: keep runway ≥ 18 months.', date: '2026-07-01' });
    const laterNoise = Array.from({ length: 3 }, (_, i) =>
      makeRecord({ option: `Option ${i}`, statement: `later decision ${i}`, date: `2026-07-${10 + i}` }),
    );
    const all = [...laterNoise, turn1];
    const p = projectDecisionRecords(all, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, all.length, true);
    expect(p!.text).toContain('DURABLE-CONSTRAINT: keep runway ≥ 18 months.');
  });

  it('POSITIVE CONTROL — the enforced cut FIRES: over-budget records are dropped + DISCLOSED, and the text stays within budget', () => {
    // 8 records each ~220 chars of rationale — far over a tiny budget.
    const many = Array.from({ length: DECISION_RECORDS_HARD_CAP }, (_, i) =>
      makeRecord({ option: `Decision ${i}`, statement: 'x'.repeat(300), date: `2026-07-0${(i % 9) + 1}` }),
    );
    const tinyBudget = 600;
    const p = projectDecisionRecords(many, tinyBudget, many.length, true)!;
    expect(p.includedCount).toBeLessThan(DECISION_RECORDS_HARD_CAP); // some were dropped
    expect(p.truncated).toBe(true);
    expect(p.text).toContain('INCOMPLETE'); // disclosure present
    expect(p.text.length).toBeLessThanOrEqual(tinyBudget); // never exceeds budget
  });

  it('caps at DECISION_RECORDS_HARD_CAP even if more are passed — AND says so', () => {
    // Strengthened 2026-07-25: asserting only `includedCount <= CAP` let the
    // silent-cap defect live underneath a green test. The cap firing is fine;
    // the cap firing INVISIBLY is the defect.
    const tooMany = Array.from({ length: DECISION_RECORDS_HARD_CAP + 5 }, (_, i) =>
      makeRecord({ option: `D${i}`, statement: `s${i}`, date: '2026-07-24' }),
    );
    const p = projectDecisionRecords(tooMany, 100_000, tooMany.length, true)!;
    expect(p.includedCount).toBeLessThanOrEqual(DECISION_RECORDS_HARD_CAP);
    expect(p.totalCount).toBe(DECISION_RECORDS_HARD_CAP + 5);
    expect(p.truncated).toBe(true);
    expect(p.text).toContain(`the true total is ${DECISION_RECORDS_HARD_CAP + 5}`);
  });

  it('returns null ONLY when the scenario genuinely holds no records', () => {
    expect(projectDecisionRecords([], 3_000, 0, true)).toBeNull();
  });

  it('records that exist but cannot be RENDERED are disclosed as not-shown, never treated as non-existent', () => {
    // Pre-fix these produced `null` → the whole section vanished → the coach
    // believed the scenario had no decision history. Two records exist; the
    // count the coach can state must be 2, not 0.
    const unusable = [
      makeRecord({ decision: { chosen_option_id: 'opt', graph_hash: 'x' } }), // no label
      makeRecord({ prediction: { confidence_source: 'model_derived' } }), // no statement
    ];
    const p = projectDecisionRecords(unusable, 3_000, unusable.length, true)!;
    expect(p).not.toBeNull();
    expect(p.includedCount).toBe(0);
    expect(p.totalCount).toBe(2);
    expect(p.truncated).toBe(true);
    expect(p.text).toContain('the true total is 2');
  });

  it('caps a runaway single rationale so it cannot eat the whole budget', () => {
    const p = projectDecisionRecords([makeRecord({ statement: 'y'.repeat(5_000) })], 3_000, 1, true)!;
    expect(p.truncated).toBe(true);
    expect(p.text).toContain('…');
    expect(p.text.length).toBeLessThanOrEqual(3_000);
  });
});

// ---------------------------------------------------------------------------
// CLAIM SAFETY (ROADMAP 1.231, second channel).
// ---------------------------------------------------------------------------

/**
 * The projector's own level. The wired proof — that the turn's verdict actually
 * REACHES this parameter, and that the result lands in the bytes
 * `buildUserMessage` hands the model — is
 * `__tests__/claim-safety-hoist-and-input-gate-route-level.test.ts`, because a
 * unit test of a projection can never tell you the projection is wired
 * (TESTING-DISCIPLINE rule 3).
 *
 * WHY THIS SECTION IS A CLAIM-SAFETY SURFACE AT ALL, which is not obvious from
 * the field name: `prediction.statement` is the run_analysis fact's
 * `result.summary` VERBATIM and `decision.chosen_option_label` is that fact's
 * LEADING OPTION (capture.ts), so a "decision record" is a persisted
 * leading-option claim wearing a different name.
 */
describe('projectDecisionRecords — the withheld-claim gate (ROADMAP 1.231)', () => {
  /** The live c5 fact summary (scenario f63ccb45, staging), labels remapped. */
  const LEADER_STATEMENT =
    'Double Down on SMB currently leads by 17 percentage points, but treat this as ' +
    'provisional: the result is sensitive to Sales Win Rate.';
  const LEADER_FREE_STATEMENT = 'Logged after the budget review; re-checked against the plan.';

  it('a leader-asserting rationale is SUBSTITUTED and the designation is DROPPED', () => {
    const p = projectDecisionRecords(
      [makeRecord({ option: 'Double Down on SMB', statement: LEADER_STATEMENT })],
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      1,
      false,
    )!;
    expect(p.text).not.toContain('17 percentage points');
    expect(p.text).not.toContain('currently leads');
    expect(p.text).not.toContain('Double Down on SMB');
    expect(p.text).not.toContain('Chose "');
    // Read with the PRODUCTION alarm's own vocabulary rather than by
    // inspection, so this test and the residue meter cannot drift apart.
    expect(textNamesLeadingOption(p.text)).toBe(false);
    // The SHARED substitution (#721's), not a second copy of it.
    expect(p.text).toContain(WITHHELD_ANALYSIS_SUMMARY);
    // NEVER SILENT, and never a vanished record: the provenance stamp and the
    // honest count survive, so the coach still knows a decision exists and when.
    expect(p.text).toContain('[2026-07-24]');
    expect(p.includedCount).toBe(1);
    expect(p.totalCount).toBe(1);
  });

  it('ANTI-OVER-SUPPRESSION: a leader-FREE rationale survives BYTE-IDENTICAL', () => {
    expect(
      textNamesLeadingOption(LEADER_FREE_STATEMENT),
      'the control statement must itself be leader-free or this arm re-tests the leak',
    ).toBe(false);
    const p = projectDecisionRecords(
      [makeRecord({ option: 'Hire locally', statement: LEADER_FREE_STATEMENT })],
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      1,
      false,
    )!;
    expect(p.text).toContain(LEADER_FREE_STATEMENT);
    expect(p.text).not.toContain(WITHHELD_ANALYSIS_SUMMARY);
  });

  it('POSITIVE CONTROL: a PERMITTED turn is byte-identical to the ungated projection', () => {
    // The whole gate must be conditional. Same record, opposite verdict.
    const records = [makeRecord({ option: 'Double Down on SMB', statement: LEADER_STATEMENT })];
    const permitted = projectDecisionRecords(
      records,
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      1,
      true,
    )!;
    const withheld = projectDecisionRecords(
      records,
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      1,
      false,
    )!;
    expect(permitted.text).toContain(`Chose "Double Down on SMB": ${LEADER_STATEMENT}`);
    expect(permitted.text).toContain('17 percentage points');
    // NON-VACUITY: the two arms must actually differ, or both assertions above
    // could be satisfied by a projector that ignores the parameter entirely.
    expect(withheld.text).not.toBe(permitted.text);
  });

  it('the RATIONALE CAP is applied to the SUBSTITUTED text, not to what it replaced', () => {
    // Capping first would measure a budget against content that is then
    // replaced — and a substituted rationale over the cap would ship uncapped.
    const p = projectDecisionRecords(
      [makeRecord({ option: 'Double Down on SMB', statement: `${LEADER_STATEMENT} ${'z'.repeat(5_000)}` })],
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      1,
      false,
    )!;
    expect(p.text).toContain(WITHHELD_ANALYSIS_SUMMARY);
    expect(p.text).not.toContain('zzz');
    // The substitution is well under the cap, so nothing was cut.
    expect(p.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The silent-drop defect (live on build 55c64ed, 2026-07-25).
// ---------------------------------------------------------------------------

describe('projectDecisionRecords — a record dropped BEFORE the process saw it is still counted', () => {
  /** What the SQL `LIMIT 8` actually hands back when NINE are stored. */
  const readEightOfNine = Array.from({ length: DECISION_RECORDS_HARD_CAP }, (_, i) =>
    makeRecord({ option: `Option ${i + 2}`, statement: `Rationale ${i + 2}.`, date: '2026-07-24' }),
  );

  it('THE DEFECT — 9 stored / 8 read: the section states the TRUE total 9 and never reads as complete', () => {
    const p = projectDecisionRecords(
      readEightOfNine,
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      9,
      true,
    )!;
    // The internal counters (pre-fix: totalCount 8, truncated FALSE — not a
    // missing signal, an affirmatively false one).
    expect(p.includedCount).toBe(8);
    expect(p.totalCount).toBe(9);
    expect(p.truncated).toBe(true);
    // The USER-VISIBLE shape — this is the text the coach reads and answers
    // from. Pre-fix it carried no disclosure of any kind, and the coach
    // answered "That's 8 prior decisions on record."
    expect(p.text).toContain('INCOMPLETE');
    expect(p.text).toContain('9 decisions are on record');
    expect(p.text).toContain('the 8 most recent are shown above');
    expect(p.text).toContain('1 older one is not shown');
    expect(p.text).toContain('Do not describe this list as complete');
    expect(p.text).toContain('the true total is 9');
    // And it must not be possible to read the count as 8.
    expect(p.text).not.toContain('the true total is 8');
  });

  it('NEGATIVE CONTROL — 8 stored / 8 read: NO disclosure, truncated false (the new line DISCRIMINATES)', () => {
    const p = projectDecisionRecords(
      readEightOfNine,
      POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      DECISION_RECORDS_HARD_CAP,
      true,
    )!;
    expect(p.includedCount).toBe(8);
    expect(p.totalCount).toBe(8);
    expect(p.truncated).toBe(false);
    expect(p.text).not.toContain('INCOMPLETE');
    expect(p.text).not.toContain('not shown');
  });

  it('scales past the cap: 40 stored / 8 read states 40, not "at least 9"', () => {
    const p = projectDecisionRecords(readEightOfNine, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, 40, true)!;
    expect(p.totalCount).toBe(40);
    expect(p.text).toContain('40 decisions are on record');
    expect(p.text).toContain('32 older ones are not shown');
  });

  it('the longer disclosure still fits: the section NEVER exceeds its declared budget', () => {
    // Sweep the label length across the char-budget breakeven the measurement
    // lane located (between 95 and 120 chars) and past it.
    for (const labelChars of [18, 55, 95, 120, 200, 500, 2_500]) {
      const stored = Array.from({ length: DECISION_RECORDS_HARD_CAP }, (_, i) =>
        makeRecord({ option: 'L'.repeat(labelChars), statement: `s${i}`.repeat(80), date: '2026-07-24' }),
      );
      const p = projectDecisionRecords(stored, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, 9, true);
      expect(p).not.toBeNull();
      expect(p!.text.length).toBeLessThanOrEqual(POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET);
      // JSON-serialised too — that is what the budget telemetry measures.
      expect(JSON.stringify(p!.text).length).toBeLessThanOrEqual(
        POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      );
      // And whatever fired, the true total is stated.
      expect(p!.text).toContain('the true total is 9');
    }
  });

  it('a single pathological label no longer erases the whole memory surface silently', () => {
    // Pre-fix: a ≥2600-char option label on the NEWEST record made the first
    // candidate line overflow, the loop broke immediately, `included` was 0 and
    // the function returned null — seven healthy records lost, disclosure NONE.
    const stored = [
      makeRecord({ option: 'X'.repeat(2_900), statement: 'runaway label' }),
      ...Array.from({ length: 7 }, (_, i) => makeRecord({ option: `Sane ${i}`, statement: `s${i}` })),
    ];
    const p = projectDecisionRecords(stored, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, 8, true);
    expect(p).not.toBeNull();
    expect(p!.totalCount).toBe(8);
    expect(p!.text).toContain('the true total is 8');
    expect(p!.text.length).toBeLessThanOrEqual(POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET);
  });

  it('a miscounting caller cannot produce a NEGATIVE omission', () => {
    const p = projectDecisionRecords(readEightOfNine, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET, 3, true)!;
    expect(p.totalCount).toBe(8); // clamped to what we were actually handed
    expect(p.truncated).toBe(false);
    expect(p.text).not.toContain('INCOMPLETE');
  });
});

describe('loadOlderRelevantFactsSection — fire-safe read + project', () => {
  let emitSpy: MockInstance<typeof telemetry.emit>;
  beforeEach(() => {
    emitSpy = vi.spyOn(telemetry, 'emit');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the projection when the store yields records', async () => {
    const store = storeHolding([makeRecord({ option: 'Chosen X', statement: 'because Y' })]);
    const p = await loadOlderRelevantFactsSection({ store, scenarioId: 'scen-1', charBudget: 3_000, mayNameLeadingOption: true });
    expect(p?.text).toContain('Chosen X');
    // The loader hard-caps the read.
    expect(store.retrieveRecords).toHaveBeenCalledWith('scen-1', { limit: DECISION_RECORDS_HARD_CAP });
  });

  it('returns undefined when the scenario has no records (pack key absent → byte-identity)', async () => {
    const store = storeHolding([]);
    expect(await loadOlderRelevantFactsSection({ store, scenarioId: 'scen-1', charBudget: 3_000, mayNameLeadingOption: true })).toBeUndefined();
  });

  it('NEVER throws — a store read fault degrades to undefined (the turn is unaffected)', async () => {
    const store = { retrieveRecords: vi.fn(async () => { throw new Error('supabase down'); }) };
    await expect(
      loadOlderRelevantFactsSection({ store, scenarioId: 'scen-1', charBudget: 3_000, mayNameLeadingOption: true }),
    ).resolves.toBeUndefined();
  });

  it('END-TO-END — 9 stored behind a LIMIT of 8: the section the coach reads discloses the true 9', async () => {
    const stored = Array.from({ length: 9 }, (_, i) =>
      makeRecord({ option: `Option ${i + 1}`, statement: `Rationale ${i + 1}.` }),
    );
    const store = storeHolding(stored);
    const p = await loadOlderRelevantFactsSection({
      store,
      scenarioId: 'scen-9',
      charBudget: POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      mayNameLeadingOption: true,
    });
    expect(p).toBeDefined();
    expect(p!.includedCount).toBe(8);
    expect(p!.totalCount).toBe(9);
    expect(p!.truncated).toBe(true);
    expect(p!.text).toContain('the true total is 9');
    // Only 8 rows were ever fetched — the 9th's payload never entered the
    // process, so this is a count-only signal, not an over-read.
    expect(store.retrieveRecords).toHaveBeenCalledWith('scen-9', { limit: DECISION_RECORDS_HARD_CAP });
  });

  it('TELEMETRY FIRES — the drop reaches v5.context_truncation at the cut site', async () => {
    const stored = Array.from({ length: 9 }, (_, i) =>
      makeRecord({ option: `Option ${i + 1}`, statement: `Rationale ${i + 1}.` }),
    );
    await loadOlderRelevantFactsSection({
      store: storeHolding(stored),
      scenarioId: 'scen-9',
      charBudget: POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      mayNameLeadingOption: true,
      requestId: 'req-9',
    });
    const cuts = emitSpy.mock.calls
      .filter(([event]) => event === TelemetryEvents.V5ContextTruncation)
      .map(([, payload]) => payload as Record<string, unknown>)
      .filter((p) => p.section === 'older_relevant_facts');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].site).toBe('decision-records.loadOlderRelevantFactsSection');
    expect(cuts[0].strategy).toBe('record_drop');
    expect(cuts[0].original_records).toBe(9);
    expect(cuts[0].kept_records).toBe(8);
    expect(cuts[0].disclosed).toBe(true);
    expect(cuts[0].scenario_id).toBe('scen-9');
    expect(cuts[0].request_id).toBe('req-9');
    // Chars are NOT fabricated for records that never entered the process:
    // equal chars + unequal records is exactly "a record cut, not a char cut".
    expect(cuts[0].original_chars).toBe(cuts[0].kept_chars);
  });

  it('TELEMETRY DISCRIMINATES — 8 stored / 8 read emits NO truncation', async () => {
    const stored = Array.from({ length: 8 }, (_, i) =>
      makeRecord({ option: `Option ${i + 1}`, statement: `Rationale ${i + 1}.` }),
    );
    await loadOlderRelevantFactsSection({
      store: storeHolding(stored),
      scenarioId: 'scen-8',
      charBudget: POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET,
      mayNameLeadingOption: true,
    });
    const cuts = emitSpy.mock.calls
      .filter(([event]) => event === TelemetryEvents.V5ContextTruncation)
      .map(([, payload]) => payload as Record<string, unknown>)
      .filter((p) => p.section === 'older_relevant_facts');
    expect(cuts).toHaveLength(0);
  });
});
