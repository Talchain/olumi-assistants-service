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
 * `stableFactKey`, `reconcile-scenario-analysis-facts.ts` `identifiedSnapshotIncludes`). So the readers never merge the
 * two histories Run by Run (Codex #2572 r1/r2): the lens replay reads the ledger's Runs instead of the window's
 * ({@link lensReplayRunsFor}), and the value edit adds them only to a window that holds no Run ({@link withLedgerRuns}).
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  bindRecentMutationHistoryToPriorFacts,
  readRecentMutationHistoryFromPriorFacts,
} from './reconcile-recent-mutation-facts.js';
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
 * Reader 2's input (`set_factor_value`, which asks only whether a Run exists and which is the newest successful one):
 * the window itself while it holds ANY Run; once it holds none — A5's measured case, 20 rows with no Run — the window
 * followed by the ledger's Runs, in the ledger's own (persisted, newest-first) order. Nothing is merged with the
 * window's own Runs, so no occurrence can be miscounted and no chronology reconciled (Codex #2572 r2: a multiset
 * difference miscounts a capped carrier's lookahead row; appending reverses tied or absent times). A `window` ledger
 * adds nothing.
 *
 * ⛔ The window array can CARRY the turn's reconciled recent-mutation history as non-enumerable properties
 * (`bindRecentMutationHistoryToPriorFacts`); a plain spread would drop it, and its readers would then read "no history".
 * So a carried history is re-bound, unchanged, onto the result.
 */
export function withLedgerRuns(hotWindow: readonly HandlerFact[], ledger: RunLedgerV1): readonly HandlerFact[] {
  if (ledger.source === 'window' || ledger.runs.length === 0 || hotWindow.some(isRun)) return hotWindow;
  const merged = [...hotWindow, ...ledger.runs];
  const history = readRecentMutationHistoryFromPriorFacts(hotWindow);
  return history === null ? merged : bindRecentMutationHistoryToPriorFacts(merged, history);
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
