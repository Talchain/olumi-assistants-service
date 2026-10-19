/**
 * ⭐ PATH-B: THE RUN ADAPTER (C5, 19 Oct 2026). Wraps the product's own Run turn (`/orchestrate/v2/turn`, stage `analyse`,
 * the agent Run chip): the engine, its admission and its licence stay the product's. The adapter only reports what is on
 * record afterwards, read by the ONE context reader:
 *  · `ok` with `ran: true` ONLY when a fresh read shows a Run id this call did not see before, computed on the model as it
 *    now stands. Its data is that Run's licensed facts, never a figure composed here;
 *  · `refused('run_blocked')` when the product declined to run, with the typed readiness it declined on;
 *  · `refused('run_not_requested')` when this turn already applied an approved change: an approval never runs an analysis
 *    (Paul, #63 5812069638); the route's automatic Run after a committed change does;
 *  · `unavailable` when the Run turn failed or nothing new is on record: nothing is claimed.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';
import { readCanonicalContext } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';

export const RUN_ANALYSIS = 'run_analysis';
export const RunAnalysisParams = z.object({
  /** Why the user asked for this Run, in a few words: the Run turn's message. */
  reason: z.string().min(1).max(400),
  /** The user's stated timing of the options' effects within the goal's period; `not_stated` when they gave none. */
  effects_timing: z.enum(['in_place_by_period', 'later_or_partial', 'not_stated']).nullable(),
}).strict();
export type RunAnalysisArgs = z.infer<typeof RunAnalysisParams>;

/** The observer the route already gives the capabilities: the Run turn's payload, for the UI's result blocks. */
export type RunObserver = (payload: { scenario_id: string; status: number; analysis_state?: unknown; analysis_ready?: unknown;
  blocks?: unknown[]; run_delta?: unknown }) => void;

export interface RunDeps {
  readonly dispatch: InternalDispatch;
  readonly onAnalysis?: RunObserver;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const runIdOf = (o: ToolOutcome): string | null =>
  (o.status === 'ok' && isRec(o.data.selected_run) && typeof o.data.selected_run.run_id === 'string' ? o.data.selected_run.run_id : null);

export async function runAnalysis(deps: RunDeps, ctx: Pick<AgentToolContext, 'scenario_id'>, args: RunAnalysisArgs,
  turn: { readonly approvalApplied: boolean }): Promise<ToolOutcome> {
  if (turn.approvalApplied) return refused('run_not_requested');
  const before = await readCanonicalContext(deps, ctx);
  if (before.status !== 'ok') return before;
  let r: Awaited<ReturnType<InternalDispatch>>;
  try {
    r = await deps.dispatch('/orchestrate/v2/turn', {
      kind: 'message', turn_id: randomUUID(), scenario_id: ctx.scenario_id, stage: 'analyse', turn_class: 'decide',
      source: 'chip_click', message: args.reason,
      chip: { id: AGENT_RUN_ANALYSIS_CHIP_ID, action_type: 'run_analysis', parameters: { effects_timing: args.effects_timing } },
    });
  } catch {
    return unavailable('run_failed');
  }
  try {
    deps.onAnalysis?.({ scenario_id: ctx.scenario_id, status: r.status, analysis_state: r.json.analysis_state,
      analysis_ready: r.json.analysis_ready, blocks: Array.isArray(r.json.blocks) ? r.json.blocks : [],
      ...(r.json.run_delta === undefined ? {} : { run_delta: r.json.run_delta }) });
  } catch { /* an observer never decides the outcome */ }
  if (r.status !== 200) return unavailable('run_failed', 'none', `HTTP ${r.status}`);
  const after = await readCanonicalContext(deps, ctx);
  if (after.status !== 'ok') return unavailable('run_not_confirmed');
  const run = isRec(after.data.selected_run) ? after.data.selected_run : null;
  const revision = isRec(after.data.revision) ? after.data.revision.graph_hash : null;
  const runId = runIdOf(after);
  if (run !== null && runId !== null && runId !== runIdOf(before) && run.graph_hash_at_run === revision) {
    return ok({ run_id: runId, selected_run: run }, { ran: true });
  }
  const kind = isRec(r.json.analysis_state) && isRec(r.json.analysis_state.run_state) ? r.json.analysis_state.run_state.kind : undefined;
  if (kind === 'blocked' || kind === 'refused') return refused('run_blocked', undefined, { readiness: after.data.readiness });
  return unavailable('run_not_recorded');
}
