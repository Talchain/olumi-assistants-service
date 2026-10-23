/**
 * ⭐ PATH-B: THE RUN ADAPTER (C5, 19 Oct 2026; gap 4, PATH-B). The Run is the product's EXISTING pipeline, the route's
 * `capabilities.runAnalysis` (`deps.runAnalysis`): the engine turn, its admission and licence, a Run press's ONE Run (its
 * operation id makes a resend recover that Run, never run another) and the facts the AI coaches from (`result`,
 * `run_comparison` against the preceding Run). The adapter only types what is on record afterwards, read by the ONE
 * context reader:
 *  · `ok` with `ran: true` ONLY when a fresh read selects THIS Run (its own id and identity) on the model as it now stands. Its
 *    data is the pipeline's own facts, never a figure composed here;
 *  · `refused` with the pipeline's own code when it declined (`run_blocked`: the engine gave an outcome and no result);
 *  · `refused('run_not_requested')` when this turn already applied an approved change: the automatic Run after that
 *    commit rode `apply_change`'s own outcome;
 *  · `unavailable` when the Run failed or is not on record: nothing is claimed.
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { readCanonicalContext } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';

export const RUN_ANALYSIS = 'run_analysis';
export const RunAnalysisParams = z.object({
  /** Why the user asked for this Run, in a few words: the Run turn's message. */
  reason: z.string(),
  /** The user's stated timing of the options' effects within the goal's period; `not_stated` when they gave none. */
  effects_timing: z.enum(['in_place_by_period', 'later_or_partial', 'not_stated']).nullable(),
}).strict();
export type RunAnalysisArgs = z.infer<typeof RunAnalysisParams>;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const CODE = /^[a-z][a-z0-9_]*$/;

export interface RunDeps {
  readonly dispatch: InternalDispatch;
  /** The route's existing Run pipeline (`capabilities.runAnalysis`, a Run press's guard included). */
  readonly runAnalysis: (args: RunAnalysisArgs) => Promise<Rec>;
}

export async function runAnalysis(deps: RunDeps, ctx: Pick<AgentToolContext, 'scenario_id'>, args: RunAnalysisArgs,
  turn: { readonly approvalApplied: boolean }): Promise<ToolOutcome> {
  if (turn.approvalApplied) return refused('run_not_requested');
  let r: Rec;
  try {
    r = await deps.runAnalysis(args);
  } catch {
    return unavailable('run_failed');
  }
  return recordedRun(deps, ctx, r);
}

/**
 * ⭐ THE AI SAYS A RUN'S WARNINGS IN ITS OWN WORDS (DL 22 Oct, marketing on 15c72e9d: its Run reply carried a warning's display
 * sentence verbatim under its own heading). Its copy keeps every warning's code, ids, links and licence fields, so each withheld
 * or provisional reason still reaches it typed; only the UI's `message` prose is left out. A copy: the stored result and the
 * UI's analysis_result are unchanged.
 */
const proseless = (ws: unknown): unknown => (Array.isArray(ws)
  ? ws.map((w) => { if (!isRec(w)) return w; const { message: _message, ...typed } = w; return typed; }) : ws);
function withoutWarningProse(result: Rec): Rec {
  return { ...result,
    ...(Array.isArray(result.inference_warnings) ? { inference_warnings: proseless(result.inference_warnings) } : {}),
    ...(isRec(result.enrichment) && Array.isArray(result.enrichment.inference_warnings)
      ? { enrichment: { ...result.enrichment, inference_warnings: proseless(result.enrichment.inference_warnings) } } : {}) };
}

/** The pipeline's own outcome, typed: `ran` only when a fresh read selects this Run, by its identity, on the current model. */
export async function recordedRun(deps: { readonly dispatch: InternalDispatch }, ctx: Pick<AgentToolContext, 'scenario_id'>,
  r: Rec): Promise<ToolOutcome> {
  const { ok: _ok, mutated: _mutated, ...facts } = r;
  // B's SDK continuation reads Run data; the AI authors the narration. Never rewrite the stored result.
  if (isRec(facts.result)) facts.result = withoutWarningProse({ ...facts.result, summary: '' });
  const code = typeof r.refusal === 'string' && CODE.test(r.refusal) ? r.refusal : undefined;
  if (r.ran !== true) {
    if (code === 'run_failed' || (code === undefined && r.ok !== true)) return unavailable('run_failed', 'none', undefined, facts);
    // Every refusal names its own reason (DL 93d79c3e: marketing r3 came back a bare run_blocked): the engine's or the moved
    // Run's typed reason, or the outcome's kind, before the generic code.
    const outcome = isRec(r.run_outcome) ? r.run_outcome : undefined;
    const typed = [outcome?.reason, outcome?.kind].find((c): c is string => typeof c === 'string' && CODE.test(c));
    return refused(code ?? typed ?? 'run_blocked', undefined, facts);
  }
  const id = isRec(r.run_identity) ? r.run_identity : undefined;
  const after = await readCanonicalContext(deps, ctx);
  if (after.status !== 'ok') return unavailable('run_not_confirmed');
  const run = isRec(after.data.selected_run) ? after.data.selected_run : null;
  const revision = isRec(after.data.revision) ? after.data.revision.graph_hash : null;
  const at = isRec(run?.run_state) ? run.run_state.computed_at : undefined;
  // A Run with no id is no receipt, whatever its revision and time (the canonical view allows `run_id: null`).
  if (run !== null && typeof run.run_id === 'string' && run.run_id !== '' && id !== undefined
    && run.graph_hash_at_run === id.graph_hash_at_run && id.graph_hash_at_run === revision && at === id.computed_at) {
    // Exact results: the margins and the input each rests on, from the ONE run-facts packet of this same Run (`goalMarginsOf`).
    const margins = isRec(run.facts) ? run.facts.margins : undefined;
    // Item 2: with no target figure, what this same Run implies for the quantity nearest the aim (`implied_by_deadline`).
    const implied = isRec(run.facts) ? run.facts.implied_by_deadline : undefined;
    return ok({ run_id: run.run_id, ...facts, inputs_used: run.inputs_used, ...(margins === undefined ? {} : { goal_margins: margins }),
      ...(implied === undefined ? {} : { implied_by_deadline: implied }) }, { ran: true });
  }
  return unavailable('run_not_recorded');
}
