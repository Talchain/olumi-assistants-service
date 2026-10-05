/**
 * ⭐ A5 — the Run ledger's contract and the lens replay's history (DL 0df0e1, 5 Oct; lease `output/rc-00351a/A5-LEASE.md`,
 * reader 3). Pure: the durable sets are built through the production reconciler. Reader 2 is PARKED (`run-ledger.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../reconcile-scenario-analysis-facts.js';
import { lensReplayRunsFor, RUN_LEDGER_VERSION, runLedgerFor } from '../run-ledger.js';

const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15';
const run = (label: string, at: string): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: SID, leading_option_id: `opt_${label}`, summary: `Run ${label}`, computed_at: at, enrichment: { analysis_status: 'computed' } },
} as HandlerFact);
const EDIT = { fact_type: 'set_factor_value', fact_version: 1, noop: false, result: { node_id: 'f-churn' } } as unknown as HandlerFact;
const R1 = run('1', '2026-10-04T23:55:32.000Z');
const R2 = run('2', '2026-10-04T23:56:54.000Z');
/** Two LEGITIMATE Runs whose facts are byte-identical, persisted on different rows (Codex #2572 P2). */
const T_OLD = run('t', '2026-10-04T23:50:00.000Z');
const T_NEW = run('t', '2026-10-04T23:50:00.000Z');

/** Each Run's ONE persisted identity: the window and the durable read name the same row (production maps priorFacts
 *  from priorFactsWithTurn, so the window's fact objects ARE the identified ones). */
const ROW = new Map<HandlerFact, { readonly id: string; readonly at: string }>([
  [R1, { id: 'row-r1', at: '2026-10-04T23:55:32.100Z' }],
  [R2, { id: 'row-r2', at: '2026-10-04T23:56:54.100Z' }],
  [T_OLD, { id: 'row-t-old', at: '2026-10-04T23:50:00.100Z' }],
  [T_NEW, { id: 'row-t-new', at: '2026-10-04T23:51:00.100Z' }],
]);
const durable = (newestFirst: readonly HandlerFact[], hotWindowFacts: readonly HandlerFact[], scenarioId = SID) => reconcileScenarioAnalysisFacts({
  scenarioId, hotWindowFacts,
  hotWindowFactsWithIdentity: hotWindowFacts.filter((f) => f.fact_type === 'run_analysis')
    .map((fact) => ({ fact, fact_row_id: ROW.get(fact)!.id, turn_id: `turn-${ROW.get(fact)!.id}`, fact_created_at: ROW.get(fact)!.at })),
  durableRead: { status: 'ok', scenario_id: scenarioId, query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: newestFirst.length,
    facts: newestFirst.map((fact) => ({ fact, fact_row_id: ROW.get(fact)!.id, fact_created_at: ROW.get(fact)!.at })) },
});

describe('runLedgerFor: the scenario\'s Runs from the attested durable set, else the window\'s', () => {
  it('an authoritative durable set is the ledger: every Run, newest first, versioned', () => {
    const ledger = runLedgerFor({ scenarioId: SID, hotWindow: [EDIT], durable: durable([R2, R1], [EDIT]) });
    expect(ledger).toEqual({ version: RUN_LEDGER_VERSION, source: 'scenario', runs: [R2, R1] });
  });

  it.each([
    ['degraded (no durable port)', reconcileScenarioAnalysisFacts({ scenarioId: SID, hotWindowFacts: [R2] })],
    ['absent', undefined],
    ['attested for ANOTHER scenario', durable([R2, R1], [], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16')],
  ])('a durable set that is %s is not the ledger: the window\'s Runs only (today, fail-safe)', (_name, set) => {
    const ledger = runLedgerFor({ scenarioId: SID, hotWindow: [EDIT, R2], durable: set });
    expect(ledger).toEqual({ version: RUN_LEDGER_VERSION, source: 'window', runs: [R2] });
    expect(lensReplayRunsFor(ledger)).toBeUndefined();
  });
});

describe('byte-identical Runs on different rows are two Runs, and the readers never subtract one history from the other', () => {
  it('PRECONDITION: the reconciler keeps both occurrences', () => {
    expect(durable([T_NEW, T_OLD], [EDIT]).status).toBe('complete');
    expect(runLedgerFor({ scenarioId: SID, hotWindow: [EDIT], durable: durable([T_NEW, T_OLD], [EDIT]) }).runs).toHaveLength(2);
  });

  it('RED-on-window: 20 edits and no Run in the window → the lens replay still reads the scenario\'s Runs, newest first', () => {
    const window = Array.from({ length: 20 }, () => EDIT);
    expect(lensReplayRunsFor(runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R2, R1], window) }))).toEqual([R2, R1]);
  });

  it('RED (Codex #2572 r2): the window holds ONE of them → the lens replay reads the ledger\'s BOTH', () => {
    const window = [EDIT, T_NEW];
    const ledger = runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([T_NEW, T_OLD], window) });
    expect(lensReplayRunsFor(ledger)).toEqual([T_NEW, T_OLD]);
  });

  it('CONTROL: no durable authority → no lens replay history of its own (the window, as before)', () => {
    expect(lensReplayRunsFor(runLedgerFor({ scenarioId: SID, hotWindow: [EDIT, R2], durable: undefined }))).toBeUndefined();
  });
});

/**
 * Codex #2572 r2, the CAPPED carrier: the reconciler validates the lookahead page (21 rows) and publishes the newest 20.
 * A window holding the discarded 21st row, byte-identical to a retained one, must not cost the ledger that retained one.
 */
describe('a capped carrier: nothing retained is lost to a window holding the lookahead row', () => {
  const runs = Array.from({ length: 21 }, (_, i) => run(i === 0 || i === 20 ? 'dup' : `c${i}`, i === 0 || i === 20
    ? '2026-10-04T20:00:00.000Z' : `2026-10-04T21:${String(59 - i).padStart(2, '0')}:00.000Z`));
  const rowOf = new Map(runs.map((f, i) => [f, { id: `row-c${String(i).padStart(2, '0')}`, at: `2026-10-04T22:${String(59 - i).padStart(2, '0')}:00.100Z` }]));
  const capped = (hot: readonly HandlerFact[]) => reconcileScenarioAnalysisFacts({
    scenarioId: SID, hotWindowFacts: hot,
    hotWindowFactsWithIdentity: hot.filter((f) => rowOf.has(f)).map((fact) => ({ fact, fact_row_id: rowOf.get(fact)!.id, turn_id: `t-${rowOf.get(fact)!.id}`, fact_created_at: rowOf.get(fact)!.at })),
    durableRead: { status: 'ok', scenario_id: SID, query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: 21,
      facts: runs.map((fact) => ({ fact, fact_row_id: rowOf.get(fact)!.id, fact_created_at: rowOf.get(fact)!.at })) },
  });

  it('PRECONDITION: the carrier is capped at 20 and retains the newest "dup"; the window holds only the discarded one', () => {
    const set = capped([EDIT, runs[20]!]);
    expect(set.status).toBe('capped');
    expect(set.facts).toHaveLength(20);
    expect(set.facts[0]).toEqual(runs[0]);
  });

  it('RED: the lens replay reads all 20 retained Runs (the retained "dup" included)', () => {
    const window = [EDIT, runs[20]!];
    const ledger = runLedgerFor({ scenarioId: SID, hotWindow: window, durable: capped(window) });
    expect(lensReplayRunsFor(ledger)).toHaveLength(20);
    expect(lensReplayRunsFor(ledger)![0]).toEqual(runs[0]);
  });
});
