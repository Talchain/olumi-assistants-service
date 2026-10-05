/**
 * ⭐ A5 — the Run ledger's contract, and the first user-visible sentence it restores (DL 0df0e1, 5 Oct; lease
 * `output/rc-00351a/A5-LEASE.md`). Pure: the durable sets are built through the production reconciler.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../reconcile-scenario-analysis-facts.js';
import { lensReplayRunsFor, RUN_LEDGER_VERSION, runLedgerFor, withLedgerRuns } from '../run-ledger.js';
import { bindRecentMutationHistoryToPriorFacts, readRecentMutationHistoryFromPriorFacts } from '../reconcile-recent-mutation-facts.js';
import { createSetFactorValueHandler, STALENESS_NARRATIVE } from '../../tools/handlers/set-factor-value.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { ProposalAction } from '../../routing/types.js';

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
    expect(withLedgerRuns([EDIT, R2], ledger)).toEqual([EDIT, R2]);
  });
});

describe('withLedgerRuns: the window, then each Run it has lost', () => {
  it('RED-on-spread: the window\'s carried recent-mutation history survives the merge, unchanged', () => {
    const window = bindRecentMutationHistoryToPriorFacts(Array.from({ length: 20 }, () => EDIT), {
      recent_mutation_facts: [EDIT], recent_changes_status: 'complete',
    } as never);
    const out = withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R1], window) }));
    expect(out).toEqual([...window, R1]);
    expect(readRecentMutationHistoryFromPriorFacts(out)).toEqual(readRecentMutationHistoryFromPriorFacts(window));
    expect(readRecentMutationHistoryFromPriorFacts(out)).not.toBeNull();
  });

  it('RED-on-window: 20 edits and no Run in the window → the window, then the lost Runs newest first', () => {
    const window = Array.from({ length: 20 }, () => EDIT);
    const out = withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R2, R1], window) }));
    expect(out).toEqual([...window, R2, R1]);
  });

  it('a window that holds ANY Run is the window itself — nothing is merged Run by Run (Codex #2572 r2)', () => {
    const window = [EDIT, R2];
    expect(durable([R2, R1], window).status).toBe('complete'); // the ledger IS the durable set: the merge is declined, not unavailable
    expect(withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R2, R1], window) }))).toBe(window);
  });

  it('nothing lost → the window itself (same reference)', () => {
    const window = [EDIT, R2, R1];
    expect(durable([R2, R1], window).status).toBe('complete');
    expect(withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R2, R1], window) }))).toBe(window);
  });
});

/**
 * THE USER-VISIBLE SENTENCE (reader 2): the REAL value-edit handler, handed what the dispatch now hands it after 20
 * board edits with no Run, says the last analysis is out of date. Handed the window alone (today), it does not.
 */
describe('a value edit after 20 quiet rows still says the last analysis is out of date', () => {
  const proposal = {
    handler_id: 'set_factor_value',
    entity: { id: 'f-churn', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'value', value: { value: 5, unit: '%', cap: 100 }, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  } as unknown as ProposalAction;
  const invoke = async (priorFacts: readonly HandlerFact[]) => createSetFactorValueHandler()({
    context: { session_id: SID, stage: 'frame', request_id: 'req-a5', prior_turns: [], prior_facts: priorFacts, scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
    payload: { kind: 'message', scenario_id: SID, turn_id: 'turn-a5', stage: 'frame', message: 'set churn to 5%' } as unknown as HandlerInvocation['payload'],
    requestId: 'req-a5', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: buildD1Fixture(),
  } as HandlerInvocation);
  const window = Array.from({ length: 20 }, () => EDIT);

  it('RED: the window plus the ledger\'s lost Run → the staleness sentence', async () => {
    const out = await invoke(withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R1], window) })));
    expect(out.assistant_text).toContain(STALENESS_NARRATIVE.trim());
  });

  it('CONTROL: the window alone (today\'s input) → no staleness sentence', async () => {
    const out = await invoke(window);
    expect(out.assistant_text).not.toContain(STALENESS_NARRATIVE.trim());
  });
});

describe('byte-identical Runs on different rows are two Runs, and the readers never subtract one history from the other', () => {
  it('PRECONDITION: the reconciler keeps both occurrences', () => {
    expect(durable([T_NEW, T_OLD], [EDIT]).status).toBe('complete');
    expect(runLedgerFor({ scenarioId: SID, hotWindow: [EDIT], durable: durable([T_NEW, T_OLD], [EDIT]) }).runs).toHaveLength(2);
  });

  it('a window with no Run carries BOTH occurrences, in persisted order', () => {
    const window = [EDIT, EDIT];
    expect(withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([T_NEW, T_OLD], window) })))
      .toEqual([EDIT, EDIT, T_NEW, T_OLD]);
  });

  it('RED (Codex #2572 r2): the window holds ONE of them → the lens replay reads the ledger\'s BOTH, the value edit the window', () => {
    const window = [EDIT, T_NEW];
    const ledger = runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([T_NEW, T_OLD], window) });
    expect(lensReplayRunsFor(ledger)).toEqual([T_NEW, T_OLD]);
    expect(withLedgerRuns(window, ledger)).toBe(window);
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

  it('RED: the lens replay reads all 20 retained Runs (the retained "dup" included); the value edit reads the window', () => {
    const window = [EDIT, runs[20]!];
    const ledger = runLedgerFor({ scenarioId: SID, hotWindow: window, durable: capped(window) });
    expect(lensReplayRunsFor(ledger)).toHaveLength(20);
    expect(lensReplayRunsFor(ledger)![0]).toEqual(runs[0]);
    expect(withLedgerRuns(window, ledger)).toBe(window);
  });
});
