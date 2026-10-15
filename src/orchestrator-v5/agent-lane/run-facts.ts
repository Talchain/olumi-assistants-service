/**
 * ⭐ S7 STEP 1 — ONE RUN-FACTS PACKET (arch12/7-ai-scientific-coaching.md §3; DL 15 Oct 00:35Z, proof route approved 01:1xZ).
 * Every AI call after a Run (the interpreter, the Agent narrating, the method and widen turns) reads canonical state; this is
 * the ONE typed account of the selected CURRENT Run it reads there, built once by this builder from the owners' own readers
 * (never re-derived): the licence's chance facts (`goalChanceFactsForAgent`), each option's typed withheld reason (the Run's
 * `GOAL_FIGURES_*` records), whether sensitivity was measured (`decisionSensitivityOf`), how many of the Run's inputs are
 * Olumi's (the licence's census), the user's recorded statements (`userStatementsOn`) and the disclosures the AIE wrote that
 * apply (`must_say`: said exactly where they apply, checked present at egress). Typed facts and the AIE's exact phrases only:
 * no host coaching prose. Today's date and the brief travel in `turnContextItems` (#3175). Pure.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import { decisionSensitivityOf } from './decision-sensitivity.js';
import { userStatementsOn } from '../statement-door/statements.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { readRawRobustnessSignals } from '../coaching/pick-raw-robustness.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** One reason a figure is not shown, as the Run recorded it: its code, the options it covers, and its typed reason. */
export interface RunWithheld {
  readonly code: string;
  readonly option_ids: readonly string[];
  readonly reason?: string;
  /** The claims it holds back (`goal_probability`, `downside` …), as recorded. */
  readonly withheld_claims?: readonly string[];
}

/**
 * WHO LEADS, from the ONE source the AI and the UI both read (UI Q3, DL 01:07Z): no second leader computation anywhere. The
 * comparative leader is named only where its licence permits; the goal-chance leader only where the goal-chance licence's form
 * names one; near-ties and similar shares are said as recorded.
 */
export interface RunLeader {
  /** The Run's leader licence (`leaderLicenceFromState`): permitted, permitted with a caveat, or withheld. */
  readonly licence: ReturnType<typeof leaderLicenceFromState>;
  /** The comparative leader, only where the licence permits naming one; else null. */
  readonly option_id: string | null;
  /** The option with the highest licensed goal chance, only where the goal-chance licence names one. */
  readonly goal_chance_leader: string | null;
  /** Options whose licensed goal chances are similar (the licence's `similar` form). */
  readonly similar_option_ids: readonly string[];
  /** The engine's near-tie flag and robustness level, as recorded. */
  readonly near_tie: boolean;
  readonly robustness: string | null;
}

/** The Run's leader facts (see {@link RunLeader}); a Run that is not current names no leader. */
export function runLeaderOf(analysisResult: unknown, analysisState: unknown, analysisReady: unknown, current: boolean): RunLeader {
  const licence = leaderLicenceFromState(analysisState, analysisReady);
  const goal = current ? goalChanceLicenceForAgent(analysisResult) : undefined;
  const r = isRec(analysisResult) ? analysisResult : undefined;
  const robust = current && isRec(r?.enrichment) ? readRawRobustnessSignals(r!.enrichment.robustness) : null;
  const leading = current && licence !== 'withheld' && typeof r?.leading_option_id === 'string' ? r!.leading_option_id as string : null;
  const named = goal !== undefined && (goal.form === 'highest' || goal.form === 'highest_all_likely_to_miss') ? goal.leader_option_id ?? null : null;
  return { licence, option_id: leading, goal_chance_leader: named, similar_option_ids: goal?.similar_option_ids ?? [],
    near_tie: robust?.near_tie_is_tie ?? false, robustness: robust?.level ?? null };
}

/**
 * THE COMPARISON WITH THE PRECEDING RUN (AIE 6181933060 via DL 01:18Z: both arms of the AIE's comparison omitted it), as the
 * state already gates it: the prior Run's id, the licensed model-facing delta (`analysis.run_delta`) and Olumi's leader-free
 * record of what changed (`rerun_record`). Carried, never recomputed; none for a first Run or a Run that is not current.
 */
export interface RunComparison {
  readonly prior_run_id: string;
  readonly run_delta?: unknown;
  /** Olumi's record's facts (`code_line`, `prior_withheld`, `attribution_case`); its `use` instruction stays in `rerun_record`. */
  readonly rerun_record?: unknown;
}

/**
 * ⭐ S7 (PoC switch, AI_WRITES_RUN_TURN): how the AI writes the Run turn from the packet, said once beside it. The AIE's ONE
 * consolidated Run instruction, byte-exact (#94 6188855695; replaces 6183364243 and T1H's proposed paragraph): five paragraphs.
 */
export const RUN_FACTS_USE = [
  "After a Run, write contextual coaching from the CURRENT run_facts and the retained turnContext. Lead with each option’s chance of meeting the stated goal as the packet displays it, preserving its point or range, uncertainty, target, unit, reference, window and conditions. Where a chance is unavailable, explain the actual supplied reason once; do not invent a reason or promise that one input will unlock every result.",
  "Explain what the current model implies and why, using its actual causal reasoning and evidence. Distinguish verified human statements, derived readings and Olumi’s provisional estimates; identify which findings depend on those estimates. Approval does not change authorship. Preserve material qualifications, disagreement, exclusions and unresolved assumptions. Describe a driver or sensitivity as measured only when the packet says it was measured.",
  "Include each applicable must_say disclosure once, using its supplied words, without repeating the same explanation elsewhere. When comparison is present, explain the recorded input change AND the actual before-and-after result from that bound pair, including unchanged results. Keep each endpoint’s Run, scope and qualifications; empty win shares do not establish that goal-chance comparisons are absent. A first Run need not have a comparison.",
  "Use only supplied engine/packet figures for analysis claims. Attribute retained user figures separately; an input, effect, win share or sampling-precision percentage is not a goal chance. Do not invent numbers, dates, distributions, certainty or causal validation. If current facts are missing or conflict, state the precise limitation and retain the useful reasoning.",
  "Where the packet supports it, say which option is most likely to meet the goal in this model, with its basis and uncertainty. Never call an option best, a winner or recommended, or choose for the user. Finish with at most one justified next reasoning step; reuse retained answers rather than asking for them again.",
].join('\n\n');

export interface RunFacts {
  /** How the AI uses these facts (`RUN_FACTS_USE`), present only with a current Run's facts. */
  readonly use?: string;
  /** Whether these facts are the selected CURRENT Run's (a stale Run's facts are never read as current). */
  readonly current: boolean;
  /** Who leads, as the UI shows it too (`runLeaderOf`). */
  readonly leader: RunLeader;
  /** The licence's chance facts, exactly as both Agent doors read them. */
  readonly chances: ReturnType<typeof goalChanceFactsForAgent>;
  readonly withheld: readonly RunWithheld[];
  /**
   * ⭐ S7 B2 (capacity e2e c1e944a4 judge item 3): each option whose chance is not shown because its result has no spread, typed:
   * `fixed_baseline` where it is the status quo holding every factor at today's value (nothing in it varies), else
   * `measured_spread` (only the recorded spread is known). The licence's own line says it; the AI never words it as a
   * measurement problem on a fixed option. Absent when no option is withheld for zero spread.
   */
  readonly zero_spread?: readonly { readonly option_id: string; readonly basis: 'fixed_baseline' | 'measured_spread' }[];
  readonly sensitivity: { readonly measured: boolean; readonly most_sensitive?: string };
  /** How many of THIS Run's inputs on the goal's paths are Olumi's estimates. */
  readonly olumi_inputs?: { readonly links: number; readonly values: number; readonly settings_by_option: Readonly<Record<string, number>> };
  /** The user's own recorded statements, verbatim, per node. */
  readonly user_statements: readonly { readonly node_id: string; readonly field: string; readonly said: readonly string[] }[];
  /** This Run against the preceding one (see {@link RunComparison}); absent for a first Run. */
  readonly comparison?: RunComparison;
  /** The AIE's exact disclosures that apply to THIS Run: each said once, word for word, where it applies. */
  readonly must_say: readonly string[];
}

/** Olumi's record of what changed, as facts only: its instruction (`use`) already rides beside it in the state, said once. */
const recordFacts = (record: unknown): Rec | undefined => {
  if (!isRec(record)) return undefined;
  const { use: _use, ...facts } = record;
  return facts;
};

const warningsOf = (result: unknown): Rec[] => {
  const r = isRec(result) ? result : undefined;
  return [isRec(r?.enrichment) ? r!.enrichment.inference_warnings : undefined, r?.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).filter(isRec);
};

/** The packet for the selected Run (`analysisResult`, the graph it reads, and whether it is current). */
export function runFactsOf(analysisResult: unknown, graph: unknown, current: boolean,
  state: { readonly analysisState?: unknown; readonly analysisReady?: unknown;
    readonly comparison?: { readonly prior_run_id?: string; readonly run_delta?: unknown; readonly rerun_record?: unknown } } = {}): RunFacts {
  const chances = goalChanceFactsForAgent(analysisResult, graph, current);
  const licence = current ? goalChanceLicenceForAgent(analysisResult) : undefined;
  const withheld: RunWithheld[] = current ? warningsOf(analysisResult).filter((w) => typeof w.code === 'string' && w.code.startsWith('GOAL_FIGURES_'))
    .map((w) => {
      const detail = isRec(w.detail) ? w.detail : undefined;
      const claims = strs(w.withheld_claims);
      // Typed facts only, never the record's message: its words reach the AI through `goal_chance.say`, already scoped and
      // asked once (never-reask-closed; target-not-testable-beside-ranges). A copy here would bypass both.
      return { code: String(w.code), option_ids: strs(w.option_ids),
        ...(typeof detail?.reason === 'string' ? { reason: detail.reason } : {}), ...(claims.length > 0 ? { withheld_claims: claims } : {}) };
    }) : [];
  const zeroSpread = Object.entries(licence?.withheld_reason_by_option ?? {}).flatMap(([option_id, r]) => r.reason !== 'zero_spread' ? []
    : [{ option_id, basis: r.basis === 'fixed_baseline' ? 'fixed_baseline' as const : 'measured_spread' as const }]);
  const enrichment = isRec(analysisResult) ? analysisResult.enrichment : undefined;
  const s = current ? decisionSensitivityOf(enrichment) : { status: 'not_measured' as const };
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const said = nodes.flatMap((n) => (typeof n.id !== 'string' ? [] : userStatementsOn(n).map((r) => ({ node_id: n.id as string, field: r.field,
    said: r.statements.map((x) => x.quote) }))));
  const census = licence?.olumi_estimate_link_count !== undefined || licence?.olumi_estimate_value_count !== undefined
    ? { links: licence.olumi_estimate_link_count ?? 0, values: licence.olumi_estimate_value_count ?? 0,
      settings_by_option: licence.olumi_estimate_settings_by_option ?? {} } : undefined;
  return {
    ...(current ? { use: RUN_FACTS_USE } : {}),
    current,
    leader: runLeaderOf(analysisResult, state.analysisState, state.analysisReady, current),
    chances,
    withheld,
    ...(zeroSpread.length > 0 ? { zero_spread: zeroSpread } : {}),
    sensitivity: s.status === 'measured' ? { measured: true, most_sensitive: s.most_sensitive.label } : { measured: false },
    ...(census !== undefined ? { olumi_inputs: census } : {}),
    user_statements: said,
    ...(current && typeof state.comparison?.prior_run_id === 'string' && state.comparison.prior_run_id !== ''
      && (state.comparison.run_delta !== undefined || state.comparison.rerun_record !== undefined)
      ? { comparison: { prior_run_id: state.comparison.prior_run_id,
        ...(state.comparison.run_delta !== undefined ? { run_delta: state.comparison.run_delta } : {}),
        ...(recordFacts(state.comparison.rerun_record) !== undefined ? { rerun_record: recordFacts(state.comparison.rerun_record) } : {}) } } : {}),
    must_say: [...(chances.goal_chance_notes ?? [])],
  };
}

