/**
 * ⛔ THE AGENT NEVER SAYS AN UNEARNED GOAL CERTAINTY AS 100% OR 0% (DL 5887061638 / 5887593253; AIQ 5882366427; MG's
 * producer #2270; Canonical's stored writer #2280).
 *
 * SERVED (R3's strict journey on CEE 5411da8; Paul's "£85k not met under any option"): an option can read P(goal) = 1 or
 * 0 while the only path that could reverse it runs through links nobody sized. MG's producer decides, per option at
 * exactly 0 or 1, whether that certainty is earned; #2280 STORES that decision on each Run, and the cold read carries it
 * (`analysis_goal_certainty`, validated by the writer's own schema).
 *
 * ONE RULE, ONE WRITER (DL 5887593253): the Agent follows ONLY the executed Run's own stored decision — never a
 * recomputation. The read selects a Run of its own, and a second Run on the same graph can finish in between, so the
 * read's Run must be THIS Run by the estate's run-fact identity (`compareAnalysisRunFactIdentity`: scenario,
 * `graph_hash_at_run` = the block's `computed_against_hash`, and the Run's own `computed_at` — served 0497e52: three Runs
 * of one graph share the hash and differ only here), and the read must call it current. Then:
 *   - RECORDED: followed verbatim. A recorded `[]` is a record, not an absence: it covers no certainty, so unchecked.
 *   - Anything else — no read, another or unstamped Run, nothing recorded, a record that does not cover every certainty —
 *     is `unchecked`: never said as 100% or 0%.
 */
import { compareAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import { readStoredGoalCertainty } from '../tools/handlers/run-goal-certainty.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What one graph read says about the Run it selected, under the read route's own gates. */
export interface GoalCertaintyRead {
  /** The read's graph. */
  readonly raw: unknown;
  /** The read's `analysis_state` (its `run_state` is the currency verdict). */
  readonly analysis_state?: unknown;
  /** The read's `analysis_result` block: the selected Run, present only when the route delivers it. */
  readonly analysis_result?: unknown;
  /** The read's `analysis_goal_certainty`: the Run's own recorded array; absent = not recorded. */
  readonly goal_certainty?: readonly unknown[];
}

/** The rule the Agent follows for `goal_certainty` (AIQ 5882366427: an unearned certainty is never 100% or certain). */
export const GOAL_CERTAINTY_NOTE =
  'For each option here whose `earned` is false, never call its chance 100% or 0%, certain, guaranteed or impossible, and never say it ' +
  'will or will not reach the goal: say its `say` sentence instead, as written. An option whose `earned` is true may be said as the run reports it.';
export const GOAL_CERTAINTY_UNCHECKED_NOTE =
  'Some options came out at a chance of exactly 0 or 1, and whether that certainty is earned could not be checked. Never call any of them ' +
  '100% or 0%, certain, guaranteed or impossible: say it is what this model gives, not a certainty.';

const UNCHECKED = { unchecked: true, note: GOAL_CERTAINTY_UNCHECKED_NOTE } as const;

const optionRows = (result: unknown): Rec[] => {
  const enrichment = isRec(result) && isRec(result.enrichment) ? result.enrichment : undefined;
  return Array.isArray(enrichment?.option_comparison) ? enrichment!.option_comparison.filter(isRec) : [];
};

/** The run's per-option rows whose P(goal) is exactly 0 or 1: the only ones that claim a certainty. */
export function certainOptionRows(result: unknown): Rec[] {
  return optionRows(result).filter((r) => typeof r.option_id === 'string' && (r.probability_of_goal === 0 || r.probability_of_goal === 1));
}

const probabilityAbsent = (row: Rec): boolean =>
  row.probability_of_goal === undefined && row.goal_probability === undefined && row.goalProbability === undefined;

/** A Run may need its stored certainty decision for an exact chance or the sentence beside a transported absence. */
export function hasGoalCertaintyCandidates(result: unknown): boolean {
  return optionRows(result).some((r) => typeof r.option_id === 'string'
    && (r.probability_of_goal === 0 || r.probability_of_goal === 1 || probabilityAbsent(r)));
}

/** The Run that produced this result, as the Agent received it: its scenario, its result block and its analysis state. */
export interface RunOfResult {
  readonly scenario_id: string;
  readonly analysis_state: unknown;
}

const runStateOf = (state: unknown): Rec | undefined =>
  (isRec(state) && isRec(state.run_state) ? state.run_state : undefined);

/**
 * The read selected THIS Run: the estate's run-fact identity matches (scenario, `graph_hash_at_run`, `computed_at`) and
 * the read calls it current. Anything unproven is unbound.
 */
function boundToThisRun(runResult: unknown, run: RunOfResult, read: GoalCertaintyRead): boolean {
  if (runStateOf(read.analysis_state)?.kind !== 'complete_current') return false;
  const identity = (block: unknown, state: unknown) => ({
    scenario_id: run.scenario_id,
    graph_hash_at_run: isRec(block) ? block.computed_against_hash : undefined,
    computed_at: runStateOf(state)?.computed_at,
  });
  return compareAnalysisRunFactIdentity(identity(runResult, run.analysis_state), identity(read.analysis_result, read.analysis_state)).status === 'match';
}

/**
 * `goal_certainty` for the Agent, for one Run's result. A transported unearned probability is absent, so its SAME-Run
 * stored decision still supplies its sentence without restoring the number. Earned numbers must remain in the result.
 * Otherwise `undefined` when no option claims a certainty, or `unchecked` when an exact value cannot be checked.
 */
export function goalCertaintyForAgent(runResult: unknown, run: RunOfResult, read: GoalCertaintyRead | null | undefined): Rec | undefined {
  const certain = certainOptionRows(runResult);
  const rows = optionRows(runResult);
  if (!hasGoalCertaintyCandidates(runResult)) return undefined;
  const unchecked = certain.length > 0 ? { ...UNCHECKED } : undefined;
  if (read === null || read === undefined || !boundToThisRun(runResult, run, read)) return unchecked;
  // Only the executed Run's own record; nothing recorded → unchecked (never recomputed here).
  const decisions = readStoredGoalCertainty(read.goal_certainty);
  if (decisions === undefined) return unchecked;
  const byId = new Map(decisions.map((d) => [d.option_id, d] as const));
  if (byId.size !== decisions.length) return { ...UNCHECKED };
  const options: Rec[] = [];
  for (const o of rows) {
    if (typeof o.option_id !== 'string') continue;
    const d = byId.get(String(o.option_id));
    const exact = o.probability_of_goal === 0 || o.probability_of_goal === 1;
    const withheld = probabilityAbsent(o);
    if (exact && (d === undefined || d.probability_of_goal !== o.probability_of_goal)) return { ...UNCHECKED };
    if (!exact && !(withheld && d?.earned === false)) continue;
    if (d === undefined) continue;
    const label = o.option_label ?? o.label;
    options.push({
      option: typeof label === 'string' ? label : String(o.option_id), option_id: String(o.option_id),
      // An unearned extreme is a producer diagnostic, not a chance the Agent may repeat. Its stored sentence
      // carries the honest meaning, even when this option also has a separately recorded outcome range.
      ...(d.earned === true ? { probability_of_goal: o.probability_of_goal } : {}),
      earned: d.earned, ...(d.earned === false ? { say: d.say } : {}),
    });
  }
  return options.length > 0 ? { options, note: GOAL_CERTAINTY_NOTE } : undefined;
}
