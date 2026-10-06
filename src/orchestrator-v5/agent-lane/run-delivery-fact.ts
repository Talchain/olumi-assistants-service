/**
 * 0.79 SD-1 Slice R — the WRITER (DL ruling #87, option A; label `writer-after-prod-0.79`).
 *
 * The served Run is the agent lane. It commits the Run's `run_analysis` fact inside its internal chip dispatch, then
 * composes the blocks the user sees from the post-commit readback. So what the Run's turn DELIVERED exists only at the
 * agent's ANSWER row, and is recorded there as an append-only `run_delivery` fact. The scenario read serves the newest one
 * for the selected Run (CEE #2654, `current_read.delivered_record`) under its own gates.
 *
 * WHAT IS RECORDED: the answer row's body at its write (`agent-v1-turn.ts`), which IS the body sent. Every reassignment of
 * `wireBody` (final egress, proposal preview, scope question) precedes that write, and the 200 is `{...wireBody, sidecars}`.
 * Its Phase 3 blocks, verbatim, and the `analysis_ready` options it carried.
 *
 * BOUND TO THIS TURN'S RUN, never to whichever Run is current: the readback's `current_read` names its Run (`run_id`), and
 * that Run is this turn's only when the graph it ran against AND its `computed_at` equal this turn's run tool result's
 * `run_identity` (a refused Run leaves an earlier Run current, and this turn's cards are not that Run's delivery).
 *
 * Never throws and never blocks the answer: any doubt omits the fact (`handler_facts: []`, as before).
 */
import { RunDeliveredRecordSchema, type RunDeliveredRecord } from '@talchain/schemas/boundary';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import type { LeaderLicence } from '../compose/leader-licence.js';
import { deliveredRecordWithinLicence } from '../../routes/delivered-record-licence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The Phase 3 block types a Run's turn delivers (`DeliveredPhase3BlockSchema`). */
const DELIVERED_PHASE3_TYPES: ReadonlySet<string> = new Set(['review_card', 'coaching', 'evidence', 'exercise']);

export type RunDeliveryOmitReason =
  | 'guidance_row' | 'no_run_this_turn' | 'run_not_current' | 'not_this_turns_run' | 'record_refused' | 'outside_licence' | 'fact_refused' | 'threw';

export type RunDeliveryOutcome =
  | { readonly kind: 'recorded'; readonly fact: HandlerFact; readonly record: RunDeliveredRecord }
  | { readonly kind: 'omitted'; readonly reason: RunDeliveryOmitReason };

export interface RunDeliveryInput {
  /** The answer row's body at its write: the body sent. */
  readonly sentBody: Rec;
  /** This turn's run tool results; the Run this turn made carries `run_identity` {graph_hash_at_run, computed_at}. */
  readonly toolResults: readonly unknown[];
  /** The readback's selected Run (`readbackCurrentRun`), when current and identified. */
  readonly currentRun: { readonly runId: string; readonly graphHashAtRun: string; readonly computedAt: string } | undefined;
  /** The readback's leader licence, and the rosters the reader checks against — a record the reader would refuse is not written. */
  readonly licence: LeaderLicence;
  readonly graph: unknown;
  readonly analysisReady: unknown;
}

const omitted = (reason: RunDeliveryOmitReason): RunDeliveryOutcome => ({ kind: 'omitted', reason });

/**
 * The automatic first analysis (construction → Run) reports no tool result of its own; its identity is its OWN run turn's
 * analysis_result block (`computed_against_hash`) and `run_state.computed_at` (Codex r1 P2 on #2657). Shaped as a run tool
 * result so the writer reads every Run of the turn one way.
 */
export function firstAnalysisRunReceipt(outcome: unknown): Rec | undefined {
  if (!isRec(outcome) || outcome.ran !== true || !Array.isArray(outcome.blocks)) return undefined;
  const block = outcome.blocks.find((b) => isRec(b) && b.type === 'analysis_result');
  const graphHashAtRun = isRec(block) ? block.computed_against_hash : undefined;
  const state = isRec(outcome.analysisState) ? outcome.analysisState : undefined;
  const computedAt = isRec(state?.run_state) ? state.run_state.computed_at : undefined;
  if (typeof graphHashAtRun !== 'string' || graphHashAtRun === '' || typeof computedAt !== 'string' || computedAt === '') return undefined;
  return { ok: true, mutated: false, ran: true, run_identity: { graph_hash_at_run: graphHashAtRun, computed_at: computedAt } };
}

/** Every Run receipt of the turn, in order: the automatic first analysis (it runs before any Agent tool call), then the tools'. */
export function turnRunReceipts(firstAnalysisOutcome: unknown, toolResults: readonly unknown[]): readonly unknown[] {
  const first = firstAnalysisRunReceipt(firstAnalysisOutcome);
  return [...(first !== undefined ? [first] : []), ...toolResults];
}

/** The identity of the Run THIS turn made: the last run tool result that produced one. */
function thisTurnsRun(toolResults: readonly unknown[]): { graphHashAtRun: string; computedAt: string } | undefined {
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const r = toolResults[i];
    if (!isRec(r) || r.ran !== true || !isRec(r.run_identity)) continue;
    const { graph_hash_at_run: graphHashAtRun, computed_at: computedAt } = r.run_identity;
    if (typeof graphHashAtRun === 'string' && graphHashAtRun !== '' && typeof computedAt === 'string' && computedAt !== '') {
      return { graphHashAtRun, computedAt };
    }
  }
  return undefined;
}

export function runDeliveryFactFor(input: RunDeliveryInput): RunDeliveryOutcome {
  try {
    const run = thisTurnsRun(input.toolResults);
    if (run === undefined) return omitted('no_run_this_turn');
    const current = input.currentRun;
    if (current === undefined) return omitted('run_not_current');
    if (current.graphHashAtRun !== run.graphHashAtRun || current.computedAt !== run.computedAt) return omitted('not_this_turns_run');

    const blocks = Array.isArray(input.sentBody.blocks) ? input.sentBody.blocks : [];
    const phase3 = blocks.filter((b) => isRec(b) && DELIVERED_PHASE3_TYPES.has(String(b.type)));
    const ready = input.sentBody.analysis_ready;
    const options = isRec(ready) && Array.isArray(ready.options)
      ? ready.options.map((o) => (isRec(o) ? { option_id: o.option_id, label: o.label, status: o.status, interventions: o.interventions } : o))
      : undefined;
    const parsed = RunDeliveredRecordSchema.safeParse({
      record_version: 1,
      run_id: current.runId,
      graph_hash: current.graphHashAtRun,
      phase3_blocks: phase3,
      ...(options !== undefined ? { analysis_ready_options: options } : {}),
    });
    if (!parsed.success) return omitted('record_refused');
    const record = parsed.data;
    // The reader serves a record only within ITS licence; one it would refuse is not stored.
    if (!deliveredRecordWithinLicence(record, { licence: input.licence, graph: input.graph, analysisReady: input.analysisReady })) {
      return omitted('outside_licence');
    }
    const fact = HandlerFactSchema.safeParse({ fact_type: 'run_delivery', fact_version: 1, noop: false, result: { run_id: current.runId, record } });
    if (!fact.success || fact.data.fact_type !== 'run_delivery') return omitted('fact_refused');
    return { kind: 'recorded', fact: fact.data, record };
  } catch {
    return omitted('threw');
  }
}
