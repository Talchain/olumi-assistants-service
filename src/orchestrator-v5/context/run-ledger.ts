/**
 * ⭐ A5 — THE SCENARIO'S RUN LEDGER (DL 0df0e1, 5 Oct 2026; lease `output/rc-00351a/A5-LEASE.md`).
 *
 * A turn reads two histories: the HOT WINDOW (the handler facts on its newest 20 turn rows) and the reconciled
 * DURABLE set (the scenario's newest {@link SCENARIO_ANALYSIS_FACT_CAP} `run_analysis` facts, never pruned). After
 * 20 turn rows with no Run (≈12 min at a demo's pace) the window holds no Run at all, and every reader that asks the
 * window "has this model been analysed?" answers no while the badge, which reads the durable set, says stale.
 *
 * This is the ONE versioned projection those readers take instead: the scenario's Runs, newest first, from the
 * durable set when the reconciler attests it as reasoning authority, else the window's own Runs (today's behaviour,
 * fail-safe). Pure; no read, no write, no migration — the durable set is already loaded on every turn.
 *
 * Identity: the reconciler admits a durable set only when every window Run is in it byte-equal (`fact_row_id` and
 * `stableFactKey`, `reconcile-scenario-analysis-facts.ts` `identifiedSnapshotIncludes`). So the reader never merges the
 * two histories Run by Run (Codex #2572 r1/r2): the lens replay reads the ledger's Runs instead of the window's
 * ({@link lensReplayRunsFor}).
 *
 * ⏸ PARKED, reader 2 (the value edit's "This makes the last analysis stale."; Codex #2572 r3): handing the edit writer
 * an aged-out Run newly claims staleness on a value restored to the analysed one, and lets that Run's enrichment claim
 * inertness about a model that has changed since. Its fix is a typed post-commit freshness for the sentence, and Run
 * existence separated from enrichment authority — not more history.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  isReconciledScenarioAnalysisFactSet,
  isScenarioAnalysisReasoningAuthority,
  type ScenarioAnalysisFactSet,
} from './reconcile-scenario-analysis-facts.js';

export const RUN_LEDGER_VERSION = 'run_ledger.v1' as const;

export interface RunLedgerV1 {
  readonly version: typeof RUN_LEDGER_VERSION;
  /** `scenario`: the attested durable set. `window`: the durable set is not authoritative, so only the window's Runs. */
  readonly source: 'scenario' | 'window';
  /** Every `run_analysis` fact the ledger holds, in the order its source stores them (newest first). */
  readonly runs: readonly HandlerFact[];
}

const isRun = (f: HandlerFact): boolean => f.fact_type === 'run_analysis';

export function runLedgerFor(input: {
  readonly scenarioId: string;
  readonly hotWindow: readonly HandlerFact[];
  readonly durable: ScenarioAnalysisFactSet | undefined;
}): RunLedgerV1 {
  const durable = input.durable;
  if (isReconciledScenarioAnalysisFactSet(durable, input.scenarioId) && isScenarioAnalysisReasoningAuthority(durable)) {
    return { version: RUN_LEDGER_VERSION, source: 'scenario', runs: durable.facts.filter(isRun) };
  }
  return { version: RUN_LEDGER_VERSION, source: 'window', runs: input.hotWindow.filter(isRun) };
}

/**
 * Reader 3's input: the Run history the lens replay reads INSTEAD of the window — the ledger's Runs, in persisted order,
 * when the durable set is reasoning authority; otherwise `undefined` (the replay reads the window, as before). The
 * reconciler proves the window's Runs are in it, so it is the window's history and more, in the order the rows were
 * written. Never merged into the window: `deriveJudgementSignals` takes Run boundaries from array position and keeps
 * the window alone (Codex #2572 P2).
 */
export function lensReplayRunsFor(ledger: RunLedgerV1): readonly HandlerFact[] | undefined {
  return ledger.source === 'scenario' ? ledger.runs : undefined;
}
