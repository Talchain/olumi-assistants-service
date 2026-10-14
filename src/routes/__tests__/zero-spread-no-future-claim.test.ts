/**
 * ⛔ CAPACITY JUDGE POST3010 ROW 3 (14 Oct; PL #94 6135017311): a zero-spread option's withheld cell said a FUTURE EVENT —
 * "Falls short of 100 tickets per week if today’s figures hold." (AIE packet 247cd85a numeric_scope[2] forbids it). The fact
 * the cell has is `zeroSpread`, true on equal low and high deciles (PL 05:25Z: never "every run the same"). The line is stored
 * with each Run; on reopen ONLY that retired plain variant, recognised by identity with the Run's own stored target, is said
 * with the current line. The carrier's rates line and §(o′)'s horizon line stay the historical Run's own.
 *
 * Corpus: the served `/graph` read after turn 01 (`tests/fixtures/zero-spread/…`, verbatim): its stored Run, graph and goal
 * certainty, through the read's own cell projector (`projectCanonicalAnalysisCells`) and the real producer.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectCanonicalAnalysisCells } from '../canonical-analysis-view.js';
import {
  GOAL_CHANCE_LICENSED, goalChanceLicenceForAgent, goalChanceLicenceOf, ZERO_SPREAD_LINE, ZERO_SPREAD_NEEDS_MONTHLY_CHANGES,
} from '../../orchestrator-v5/goal-target/goal-chance-licence.js';

type Rec = Record<string, any>;
const READ = (JSON.parse(readFileSync('tests/fixtures/zero-spread/served-capacity-post3010-read01-20261014.json', 'utf8')) as Rec).body as Rec;
const KEEP = 'keep_current_staffing';
const SERVED_LINE = 'Falls short of 100 tickets per week if today’s figures hold.';
const LINE = 'Chance not shown: this result reports a very narrow central range or a very small spread. '
  + 'That alone does not establish certainty. Review whether the model captures the uncertainties that matter for this option.';
const licenceRecord = (result: Rec): Rec => (result.enrichment.inference_warnings as Rec[]).find((w) => w.code === GOAL_CHANCE_LICENSED)!;
const cells = (result: Rec) => projectCanonicalAnalysisCells(result as never, READ.graph, READ.analysis_goal_certainty);
const FUTURE = /falls short|meets\b|if today.s (figures|rates) hold/i;

describe('capacity post3010 row 3: a zero-spread cell says no future event', () => {
  it('precondition (served): the stored Run said the future event, for the status quo that every draw put at one value', () => {
    expect(licenceRecord(READ.analysis_result).withheld_reason_by_option).toEqual({ [KEEP]: { line: SERVED_LINE, side: 'falls_short', reason: 'zero_spread' } });
    expect(READ.canonical_analysis_view.options[0]).toMatchObject({ option_id: KEEP, cell: { kind: 'withheld', why: SERVED_LINE } });
    const keep = (READ.analysis_result.enrichment.option_comparison as Rec[]).find((r) => r.option_id === KEEP)!;
    expect([keep.outcome.p10, keep.outcome.p90]).toEqual([0.16, 0.16]);
  });

  it('REOPEN: the served stored Run, through the read’s own cell projector, says the one line and no future event', () => {
    const projected = cells(READ.analysis_result);
    expect(projected.find((c) => c.option_id === KEEP)!.cell).toEqual({ kind: 'withheld', reasons: [{ code: 'zero_spread', message: LINE }],
      face: 'Chance not shown yet', why: LINE });
    expect(JSON.stringify(projected)).not.toMatch(FUTURE);
    // The typed finding is kept as data (its side), never said.
    expect(goalChanceLicenceForAgent(READ.analysis_result as never)?.withheld_reason_by_option?.[KEEP]).toEqual({ reason: 'zero_spread', side: 'falls_short', line: LINE });
    // CONTRAST: the other option's cell is exactly what was served.
    expect(projected.find((c) => c.option_id === 'add_one_specialist')!.cell).toEqual(READ.canonical_analysis_view.options[1].cell);
  });

  it('CONTRAST: a Run that stored §(o′)’s own line (a stated horizon, no monthly carrier) keeps it', () => {
    const stored = structuredClone(READ.analysis_result) as Rec;
    licenceRecord(stored).withheld_reason_by_option[KEEP].line = ZERO_SPREAD_NEEDS_MONTHLY_CHANGES;
    expect(cells(stored).find((c) => c.option_id === KEEP)!.cell).toMatchObject({ why: ZERO_SPREAD_NEEDS_MONTHLY_CHANGES });
  });

  it('CONTRAST: a Run that stored the carrier’s rates line keeps its own figures and period', () => {
    const stored = structuredClone(READ.analysis_result) as Rec;
    const rates = 'Falls short of 100 tickets per week by month 3 if today’s rates hold.';
    licenceRecord(stored).withheld_reason_by_option[KEEP].line = rates;
    expect(cells(stored).find((c) => c.option_id === KEEP)!.cell).toMatchObject({ why: rates });
  });

  it('CONTRAST (identity, not a pattern): a plain line that is not this Run’s own target words is kept as stored', () => {
    const stored = structuredClone(READ.analysis_result) as Rec;
    const other = 'Falls short of 120 tickets per week if today’s figures hold.';
    licenceRecord(stored).withheld_reason_by_option[KEEP].line = other;
    expect(cells(stored).find((c) => c.option_id === KEEP)!.cell).toMatchObject({ why: other });
  });

  it('PRODUCER: the served Run’s own records (Keep’s unearned exact 0 restored, as transport stripped it) write the one line', () => {
    const envelope = structuredClone(READ.analysis_result.enrichment) as Rec;
    (envelope.option_comparison as Rec[]).find((r) => r.option_id === KEEP)!.probability_of_goal = 0;
    const licence = goalChanceLicenceOf(envelope, READ.graph, 'weekly_support_capacity');
    expect(licence?.withheld_reason_by_option?.[KEEP]).toEqual({ reason: 'zero_spread', side: 'falls_short', line: LINE });
    expect(JSON.stringify(licence)).not.toMatch(FUTURE);
    expect(ZERO_SPREAD_LINE).toBe(LINE);
    // AIE 281e8b3d: no claim of equality or zero variance the predicate's std arm does not prove.
    expect(LINE).not.toMatch(/\bsame\b|every run|no (spread|uncertainty|variance)/i);
  });

  it('PRODUCER (the std arm, Codex r1’s reproduction): an option whose deciles differ inside the noise tolerance gets the same line, true for it too', () => {
    // The status quo is read by its own reference rule first (unequal deciles: "moved"); the std arm is reached by an option.
    const ADD = 'add_one_specialist';
    const envelope = structuredClone(READ.analysis_result.enrichment) as Rec;
    const add = (envelope.option_comparison as Rec[]).find((r) => r.option_id === ADD)!;
    add.probability_of_goal = 0;
    Object.assign(add.outcome, { p10: 0.1599999995, p50: 0.16, p90: 0.1600000005, mean: 0.16, std: 5e-10 });
    expect(add.outcome.p10).not.toBe(add.outcome.p90);
    const licence = goalChanceLicenceOf(envelope, READ.graph, 'weekly_support_capacity');
    expect(licence?.withheld_reason_by_option?.[ADD]).toEqual(expect.objectContaining({ reason: 'zero_spread', line: LINE }));
  });
});
