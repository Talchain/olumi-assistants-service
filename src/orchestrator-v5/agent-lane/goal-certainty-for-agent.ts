/**
 * ⛔ THE AGENT NEVER SAYS AN UNEARNED GOAL CERTAINTY AS 100% OR 0% (DL 5887061638, route A; MG's producer #2270;
 * AIQ 5882366427).
 *
 * SERVED (R3's strict journey on CEE 5411da8; Paul's "£85k not met under any option"): an option can read P(goal) = 1 or
 * 0 while the only path that could reverse it runs through links nobody sized. MG's producer decides, per option at
 * exactly 0 or 1, whether that certainty is earned, and for an unearned one gives the sentence to say.
 *
 * Which decision the Agent follows:
 *   1. RECORDED — the read carries the Run's own `analysis_goal_certainty` (Canonical #2280, once it serves): followed
 *      verbatim, never recomputed. A recorded `[]` is a record, not an absence: it does not cover a certainty, so unchecked.
 *   2. NOT RECORDED — the SAME producer on the SAME Run, bound exactly: the read's own result block must be this Run
 *      (`computed_against_hash` equal, every certain option at the same P) and the read must call it current, so the
 *      read's graph is the graph the Run was computed on. The read attests which identities the Run evaluated but not
 *      their `level_source`, so the producer's stated-level break-even is withheld (fail closed); `earned` is unchanged.
 *      DL 5887061638: a temporary fallback, removed once #2280's stored writer serves and is witnessed.
 *   3. Anything else — no read, a Run that cannot be bound, a decision that does not cover every certainty — is
 *      `unchecked`: never said as 100% or 0%.
 */
import { goalCertaintyDecisions } from './goal-certainty.js';

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
  /** The read's `analysis_identity_evaluated_node_ids` (same fact and gates as its result); absent = not attested. */
  readonly identity_evaluated?: ReadonlySet<string>;
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

/**
 * The read's graph is the graph THIS Run was computed on: the read calls its Run current, that Run is this one (the same
 * `computed_against_hash`), and it reports every certain option at the same P. Anything unproven is unbound.
 */
function boundToThisRun(runResult: unknown, certain: readonly Rec[], read: GoalCertaintyRead): boolean {
  const runState = isRec(read.analysis_state) && isRec(read.analysis_state.run_state) ? read.analysis_state.run_state : undefined;
  if (runState?.kind !== 'complete_current') return false;
  const hashOf = (b: unknown): string | undefined =>
    (isRec(b) && typeof b.computed_against_hash === 'string' && b.computed_against_hash !== '' ? b.computed_against_hash : undefined);
  const runHash = hashOf(runResult);
  if (runHash === undefined || hashOf(read.analysis_result) !== runHash) return false;
  const readP = new Map(optionRows(read.analysis_result).map((r) => [r.option_id, r.probability_of_goal] as const));
  return certain.every((o) => readP.get(o.option_id) === o.probability_of_goal);
}

/**
 * `goal_certainty` for the Agent, for one Run's result. `undefined` when no option claims a certainty; otherwise either
 * the decision per certain option with the rule, or `unchecked` (never said as certain).
 */
export function goalCertaintyForAgent(runResult: unknown, read: GoalCertaintyRead | null | undefined): Rec | undefined {
  const certain = certainOptionRows(runResult);
  if (certain.length === 0) return undefined;
  if (read === null || read === undefined) return { ...UNCHECKED };
  let decisions: readonly unknown[];
  if (read.goal_certainty !== undefined) {
    decisions = read.goal_certainty;
  } else if (boundToThisRun(runResult, certain, read)) {
    const evaluations = read.identity_evaluated === undefined ? undefined
      : [...read.identity_evaluated].map((node_id) => ({ node_id, evaluated: true }));
    decisions = goalCertaintyDecisions(read.raw, certain, evaluations);
  } else {
    return { ...UNCHECKED };
  }
  const byId = new Map(decisions.filter(isRec).map((d) => [String(d.option_id), d] as const));
  const options: Rec[] = [];
  for (const o of certain) {
    const d = byId.get(String(o.option_id));
    if (d === undefined || d.probability_of_goal !== o.probability_of_goal || typeof d.earned !== 'boolean') return { ...UNCHECKED };
    if (d.earned === false && (typeof d.say !== 'string' || d.say.trim() === '')) return { ...UNCHECKED };
    const label = o.option_label ?? o.label;
    options.push({
      option: typeof label === 'string' ? label : String(o.option_id), option_id: String(o.option_id),
      probability_of_goal: o.probability_of_goal, earned: d.earned, ...(d.earned === false ? { say: d.say } : {}),
    });
  }
  return { options, note: GOAL_CERTAINTY_NOTE };
}
