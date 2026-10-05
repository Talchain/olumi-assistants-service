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
 * `stableFactKey`, `reconcile-scenario-analysis-facts.ts` `identifiedSnapshotIncludes`). So, per stable encoding, the
 * window holds AT MOST as many occurrences as the ledger, and the ledger Runs the window has lost are the MULTISET
 * difference ({@link ledgerRunsBeyondWindow}): two legitimate Runs can be byte-identical on different rows (the
 * reconciler keeps both), and a set difference would silently drop the older one (Codex #2572 P2). No Run is carried
 * twice; none is lost.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
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
 * What a Run-history reader reads: the window's own facts (every type, in order), then each ledger Run the window has
 * lost, appended. Appended is not proven older (see {@link ledgerRunsBeyondWindow}), so this merged array serves only a
 * reader that asks whether a Run exists and prefers the window's own (reader 2's `set_factor_value`). A `window`
 * ledger adds nothing.
 *
 * ⛔ The window array can CARRY the turn's reconciled recent-mutation history as non-enumerable properties
 * (`bindRecentMutationHistoryToPriorFacts`); a plain spread would drop it, and its readers would then read "no history".
 * So a carried history is re-bound, unchanged, onto the result.
 */
export function withLedgerRuns(hotWindow: readonly HandlerFact[], ledger: RunLedgerV1): readonly HandlerFact[] {
  const lost = ledgerRunsBeyondWindow(hotWindow, ledger);
  if (lost.length === 0) return hotWindow;
  const merged = [...hotWindow, ...lost];
  const history = readRecentMutationHistoryFromPriorFacts(hotWindow);
  return history === null ? merged : bindRecentMutationHistoryToPriorFacts(merged, history);
}

/**
 * The ledger Runs the window does not hold, in ledger order (newest first): each ledger occurrence of an encoding past
 * the number of times the window holds it. A `window` ledger has none.
 *
 * ⚠ ONLY FOR A READER THAT ORDERS RUNS BY THEIR OWN TIMES. The reconciler proves the window's Runs are in the ledger,
 * not that the ones it lacks are older than every window row (a Run persisted after the window was read). A reader that
 * takes Run boundaries from ARRAY POSITION — `deriveJudgementSignals` — must keep the window alone (Codex #2572 P2), so
 * the lens replay takes these on their own input (`compose.ts` `lensReplayRunsBeyondWindow`).
 */
export function ledgerRunsBeyondWindow(hotWindow: readonly HandlerFact[], ledger: RunLedgerV1): readonly HandlerFact[] {
  if (ledger.source === 'window') return [];
  const held = new Map<string, number>();
  for (const f of hotWindow) {
    if (!isRun(f)) continue;
    const key = stableStringify(f);
    held.set(key, (held.get(key) ?? 0) + 1);
  }
  const beyond: HandlerFact[] = [];
  for (const f of ledger.runs) {
    const key = stableStringify(f);
    const remaining = held.get(key) ?? 0;
    if (remaining > 0) held.set(key, remaining - 1);
    else beyond.push(f);
  }
  return beyond;
}
