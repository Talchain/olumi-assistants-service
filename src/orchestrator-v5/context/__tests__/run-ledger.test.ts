/**
 * ⭐ A5 — the Run ledger's contract, and the first user-visible sentence it restores (DL 0df0e1, 5 Oct; lease
 * `output/rc-00351a/A5-LEASE.md`). Pure: the durable sets are built through the production reconciler.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../reconcile-scenario-analysis-facts.js';
import { RUN_LEDGER_VERSION, runLedgerFor, withLedgerRuns } from '../run-ledger.js';
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

/** Each Run's ONE persisted identity: the window and the durable read name the same row (production maps priorFacts
 *  from priorFactsWithTurn, so the window's fact objects ARE the identified ones). */
const ROW = new Map<HandlerFact, { readonly id: string; readonly at: string }>([
  [R1, { id: 'row-r1', at: '2026-10-04T23:55:32.100Z' }],
  [R2, { id: 'row-r2', at: '2026-10-04T23:56:54.100Z' }],
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

  it('a Run still in the window is never carried twice; the older lost one follows', () => {
    const window = [EDIT, R2];
    expect(durable([R2, R1], window).status).toBe('complete'); // the ledger is the durable set, so dedupe is exercised
    const out = withLedgerRuns(window, runLedgerFor({ scenarioId: SID, hotWindow: window, durable: durable([R2, R1], window) }));
    expect(out).toEqual([EDIT, R2, R1]);
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
