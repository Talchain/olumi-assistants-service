import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { readRunAnalysisOccurrence } from '../types/handler-fact.js';
import { RUN_QUESTION_EVIDENCE_KEY } from '../tools/handlers/run-input-snapshot.js';

/**
 * ⭐ §9 HOOK FOR LANE B (BLOCKED-LEASE, outbox/LANE-B.md:19; Lane A pass-through, 15 Oct). What the SELECTED successful Run
 * itself recorded, for the Run facts the AI reads (`runFactsOf`'s `state.runEvidence`): its `run_id`, its stored
 * `input_snapshot` (the transport `analysis_result` block omits it) and its stored row occurrence (`fact_row_id`,
 * `evaluated_scenario_revision`). Read-only, from the fact the graph read already selected, under the SAME gate as the
 * `analysis_result` it describes. Missing evidence stays absent: never today's graph, never a guess. No persisted field.
 */
export interface RunEvidence {
  readonly runId?: string;
  readonly inputSnapshot?: unknown;
  readonly evaluatedQuestion?: unknown;
  readonly occurrence?: { readonly fact_row_id?: string; readonly evaluated_scenario_revision?: number };
}

/** The same evidence on the graph read's wire (`analysis_run_evidence`). */
export interface RunEvidenceWire {
  readonly run_id?: string;
  readonly input_snapshot?: unknown;
  readonly evaluated_question?: unknown;
  readonly occurrence?: { readonly fact_row_id?: string; readonly evaluated_scenario_revision?: number };
}

const revisionOf = (v: unknown): number | undefined => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const idOf = (v: unknown): string | undefined => typeof v === 'string' && v !== '' ? v : undefined;
const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

function occurrenceOf(o: Record<string, unknown> | undefined): RunEvidenceWire['occurrence'] {
  const factRowId = idOf(o?.fact_row_id);
  const revision = revisionOf(o?.evaluated_scenario_revision);
  return factRowId === undefined && revision === undefined ? undefined
    : { ...(factRowId === undefined ? {} : { fact_row_id: factRowId }), ...(revision === undefined ? {} : { evaluated_scenario_revision: revision }) };
}

/** The selected fact's own evidence; `undefined` when it records none of it. */
export function runEvidenceWireOf(fact: RunAnalysisHandlerFact): RunEvidenceWire | undefined {
  const runId = idOf(fact.result.run_id);
  const snapshot = (fact.result as { input_snapshot?: unknown }).input_snapshot;
  const question = recordOf(fact.result.enrichment)?.[RUN_QUESTION_EVIDENCE_KEY];
  const occurrence = occurrenceOf(readRunAnalysisOccurrence(fact) as Record<string, unknown> | undefined);
  const wire: RunEvidenceWire = {
    ...(runId === undefined ? {} : { run_id: runId }),
    ...(snapshot === undefined || snapshot === null ? {} : { input_snapshot: snapshot }),
    ...(question === undefined || question === null ? {} : { evaluated_question: question }),
    ...(occurrence === undefined ? {} : { occurrence }),
  };
  return Object.keys(wire).length === 0 ? undefined : wire;
}

/** The Agent's reader of that wire: only well-formed fields survive; anything else is absent. */
export function readRunEvidence(value: unknown): RunEvidence | undefined {
  const w = recordOf(value);
  if (w === undefined) return undefined;
  const runId = idOf(w.run_id);
  const occurrence = occurrenceOf(recordOf(w.occurrence));
  const evidence: RunEvidence = {
    ...(runId === undefined ? {} : { runId }),
    ...(w.input_snapshot === undefined || w.input_snapshot === null ? {} : { inputSnapshot: w.input_snapshot }),
    ...(w.evaluated_question === undefined || w.evaluated_question === null ? {} : { evaluatedQuestion: w.evaluated_question }),
    ...(occurrence === undefined ? {} : { occurrence }),
  };
  return Object.keys(evidence).length === 0 ? undefined : evidence;
}
