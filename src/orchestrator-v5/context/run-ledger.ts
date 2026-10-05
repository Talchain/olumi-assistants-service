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
 * `stableFactKey`, `reconcile-scenario-analysis-facts.ts` `identifiedSnapshotIncludes`), so a Run's stable encoding
 * names it in both histories and {@link withLedgerRuns} never carries one Run twice.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
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
 * What a Run-history reader reads: the window's own facts (every type, in order), then each ledger Run the window has
 * lost. Those are older than every window row, so newest-first order holds. A `window` ledger adds nothing.
 */
export function withLedgerRuns(hotWindow: readonly HandlerFact[], ledger: RunLedgerV1): readonly HandlerFact[] {
  if (ledger.source === 'window') return hotWindow;
  const held = new Set(hotWindow.filter(isRun).map((f) => stableStringify(f)));
  const lost = ledger.runs.filter((f) => !held.has(stableStringify(f)));
  return lost.length === 0 ? hotWindow : [...hotWindow, ...lost];
}
