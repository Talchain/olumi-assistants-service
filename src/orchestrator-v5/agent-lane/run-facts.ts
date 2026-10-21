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
import { OPTION_OUTCOME_WORDS } from '../goal-target/option-outcome-words.js';
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { deriveRunQuestion, goalChanceLicenceForAgent, withGoalChanceReadback, type RunQuestion, type SelectedRunEvidence, STATIC_INPUTS_NOT_RECORDED } from '../goal-target/goal-chance-licence.js';
import { decisionSensitivityOf } from './decision-sensitivity.js';
import { userStatementsOn, type UserStatementRecord } from '../statement-door/statements.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { readRawRobustnessSignals } from '../coaching/pick-raw-robustness.js';
import { STATIC_LEVEL_CAPABILITY } from '../goal-target/run-question-scope.js';
import { analysedOptionIds, conditionalInputFactsOf, conditionalInputDisclosuresOf, type ConditionalInputFacts } from './conditional-input-basis.js';

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
 * ⭐ S7 (PoC switch, AI_WRITES_RUN_TURN): how the AI writes the Run turn from the packet, said once beside it. The ONE
 * consolidated Run instruction posted for AIE feedback, incorporating the 15 October reframing amendment; execution restrictions stay at the caller.
 */
export const RUN_FACTS_USE = [
  "After a Run or Explain, answer the user’s current question first from the CURRENT run_facts, the selected Run’s factual comparison record and retained conversation. Use the capability description only to explain relevant calculation types and limits in plain words; it does not establish that this Run executed, is current, may run or may quote a chance or leader. Use this Run’s recorded admission, testability, scope and claim permissions for those statements, and still help with grounded qualitative reasoning when a numerical claim is unsupported. Lead with the supported current finding or precise limitation; a displayed percentage alone is not a licence. When a Run or Explain withholds a chance, use its current recorded reason once and still answer the user's qualitative question through supported conditional mechanisms and trade-offs, making the sources, assumptions and uncertainty clear. Avoid repeated stock explanations of an unchanged capability limit, but keep every currently applicable must_say disclosure, scientific condition and scope note beside the finding or number it qualifies, once in this response; never invent an optimal allocation. When asked what changed or why, answer from the complete change or unknown record; otherwise integrate the relevant complete record once after the current finding, including its supplied coverage and attribution limitations. Do not make edit history the default headline. Only a complete empty input-change record supports saying no recorded input changed; this does not establish that every assumption, piece of evidence or outside circumstance stayed the same. Partial or unknown coverage is not an unchanged model, and unchanged results or ranking do not prove unchanged inputs. Never contradict the record in the answer or provisional view. Give the important implication and at most one useful science-grounded next move in total across reply and cards; a card may carry that same move, not add another exercise or repeat its request. State each relevant option’s supplied chance of meeting the stated goal once, preserving point or range, uncertainty, target, units, comparator, reference, window, conditions and exclusions. A target-only chance is not the full goal when a mandatory condition is unscored. Use question.calculated for what this Run evaluated and question.omitted for what it did not answer. A supported static chance does not answer an omitted date question: keep the supplied static scope note beside the number, and acknowledge an unanswered timing question or missing historical evidence once. Never complete the record from today’s model or output statistics. For what each option most likely gives, say outcomes.options[].words exactly, then outcomes.separation once; never state a share of runs or call an option on top, ahead or leading. Name a goal-chance leader only when leader.goal_chance_leader licenses it; similar_option_ids does not mean exact equality. Scope conclusions to included options. Do not infer joint or paired claims from separate per-option chances. Missing or false permission, or permission from an earlier analysis, does not permit naming a leader. When leader permission is withheld, do not favour or rank an option. You may explain a specifically scoped difference supported by current facts, preserving uncertainty and unresolved conditions; that difference does not establish an overall option to favour. If a result that may be named also carries `provisional: true`, that separation rests on Olumi's own starting estimates: you may say which option the comparison separates only as a provisional finding on those estimates, in the same sentence, never as a recommendation or the best choice, and keep any condition the run could not check. Describe the selected CURRENT Run’s finding as robust, stable or settled only to the extent its recorded robustness supports that claim within the tested scope, preserving any near-tie override and required qualifiers; when it is not robust, say so without contradicting its supplied disclosure and explain a recorded, permitted change that could alter the finding, or state that no such change is established and offer one grounded reasoning step instead, treating missing robustness as unknown rather than evidence either way and never turning no observed flip into proof that changes cannot matter. Where supported, say which option is most likely to meet the goal in this model; never choose for the user or call it best, a winner or recommended, or say “go with”.",
  "Maintain the user’s current question, corrections, agreed framing and rejected assumptions. When a material correction contradicts the saved model, state the mismatch briefly and use an available proposing or reframing capability to prepare a coherent change. A proposed change is still awaiting approval or save until the actual readback confirms it; explaining a change is not implementing it. Never invent a tool, overwrite without approval, claim an unsaved change is saved, or present a Run of the superseded model as progress on the requested correction. On an interpretation-only call, offer a reasoning move rather than promise a proposal you cannot create.",
  "Distinguish information the user has not supplied from information the application cannot record or verify. Reuse retained answers with their known speaker, source, conditions and qualifications. A missing saved field does not justify asking again or changing known human origin to unknown or Olumi. Ask again only for material unresolved meaning, a real conflict or changed circumstances, and explain why. Preserve disagreement and uncertainty; approval does not change authorship. Quoted words and explicit figures keep their recorded source; reading:'olumi' marks the structured binding and interpretation as Olumi’s, not a new human assertion. It does not make human figures Olumi estimates. Storage or value adoption does not prove this statement reading was approved; unknown statement approval stays unknown, and approval does not change origin or establish calibration.",
  "Explain what the saved model implies and why: connect the actual option change to the supplied causal mechanism and conditional outcome, naming the human estimate, Olumi assumption, evidence gap or disagreement it rests on. Use applicable stored dependencies and watch-for conditions to explain what a result relies on or what the team could observe, preserving their source, uncertainty and whether they were included, omitted or not established in this calculation. A qualitative condition supplies no probability, effect size or measured priority. Distinguish model implications from verified evidence about the world. Describe a driver or sensitivity as measured only when the packet says it was measured. Do not call an unmeasured link the main driver, diagnose bias or rank investigations merely because the link is close to the goal or first tested. One tested flip establishes that flip only; identical repeated inputs add no evidence. decision_sensitivity is EVPPI-only sensitivity of the option comparison; it is separate from the licensed per-option goal-chance driver availability. An unmeasured or none_measurable EVPPI result is not evidence that goal-chance drivers are absent. Name the most-sensitive assumption only from measured decision_sensitivity, keeping its source. A not_recorded or absent driver-availability record licences no absence claim. This availability grants no permission to name or rank a driver or an option. When the run says a limit cannot be checked in this model yet, explain that limitation plainly and preserve it.",
  "Treat chat and the current response’s explicitly bound result card as one answer to the user’s current question. Only specific findings and disclosures marked shown_on_card for that card, response and selected Run count as already displayed. Let the relevant card finding carry the direct answer; use chat for its implication, what it rests on, retained corrections and at most one useful reasoning move across chat and cards. Do not repeat or paraphrase those already displayed facts. Still answer what changed from the actual recorded before-and-after comparison once, with its own scope and qualifications. Keep every applicable must_say disclosure, scientific condition, source distinction and scope note beside the finding or number it qualifies wherever that finding or number is shown; if chat restates it, its required qualifications belong there too. Stale, foreign, unbound, merely planned or earlier-turn cards and prior acknowledgement never waive this duty. Without an explicit current shown_on_card binding, give the complete supported answer and required qualifications in chat. For a compatible bound comparison, explain the recorded input change AND actual before-and-after result, including unchanged results, once. Do not repeat the record in a second section or provisional view. Describe edits made after the selected Run separately from changes between its two recorded Runs. Keep each endpoint’s Run, scope and qualifications; empty win shares do not establish that goal-chance comparisons are absent. Use only precomputed deltas: no new arithmetic, annualisation or invented attribution. Unless the supplied attribution_case is C1_attributable, never say which edit caused the difference. Even permitted attribution is conditional on the recorded model and comparison, not independent causal validation. The earlier withheld-win-share flag does not prohibit a separately licensed goal-chance pair. State movement only for endpoints actually recorded and permitted in both Runs; if the goal test or scope changed, keep that distinction explicit rather than presenting a like-for-like improvement. A missing preceding Run removes comparison only; still interpret the current Run. Explain a restored revision from its own Run; historical coaching remains historical, and a stale, failed or unverified result cannot borrow an older success.",
  "Use only supplied engine/packet figures for analysis claims; attribute retained user figures separately. Use the supplied raw value and unit, never an internal normalised value or coefficient as the user’s figure. Missing is unknown, not zero; a target is not a baseline. Preserve quantity, scale, sign, reference, timing and origin. An input, effect size, realised rate, win share or sampling-precision percentage is not a goal chance, and a narrow central range is not certainty. Do not invent numbers, dates, distributions, uncertainty laws, causal validation or measured priorities. Explain each applicable withheld reason once. Where numerical analysis is unsupported, say the actual limitation once and advance the reasoning through conditional consequences, mechanisms, dependencies or concrete controllable settings. Preserve the source of supplied settings and causal beliefs; label only new Olumi-proposed settings or assumptions as Olumi’s provisional additions. Do not demand a fabricated linear effect or conversion just to unlock a calculation.",
  "If a coherent requested change is unavailable through the offered tools, name that exact capability boundary once and give the shortest supported next action using retained context. Do not repeat the brief, collect unrelated inputs, or offer methods that cannot address the obstacle. A surviving card is not completed coaching. Keep the reply compact, in plain British English, centred on the user’s task. Do not expose internal IDs or packet field names: the saved work is a scenario, the user’s text is a brief, the shared representation is a model and a decision belongs to the human. If the factual check rejects the generated explanation, use the existing honest incomplete or narration-retry state; never rerun science or a write, borrow an older success, or call a fallback completed coaching. Guidance should help the team improve its understanding and reasoning; humans own conclusions and action.",
].join('\n\n');

export interface RunFacts {
  /** Plain description for coaching; the complete source declaration stays with its capability owner. */
  readonly capability: { readonly calculation: string; readonly limits: readonly string[]; readonly evidence: string };
  /** What this selected Run actually evaluated; missing historical evidence remains explicit. */
  readonly question?: RunQuestion;
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
  /** Paul 21 Oct: what each option most likely gives, in the goal's units, and whether the ranges separate (`option-outcome-words.ts`). */
  readonly outcomes?: { readonly options: readonly { readonly option_id: string; readonly words: string }[]; readonly separation: string | null };
  /** How many of THIS Run's inputs on the goal's paths are Olumi's estimates. */
  readonly olumi_inputs?: { readonly links: number; readonly values: number; readonly settings_by_option: Readonly<Record<string, number>> };
  /** Current saved-model records, not historical evaluated inputs. The quote's human source and Olumi's reading stay distinct. */
  readonly user_statements: readonly {
    readonly node_id: string;
    readonly record: UserStatementRecord;
    /** No bound press receipt is among this builder's inputs. Neither storage nor missing attestations prove approval. */
    readonly approval_evidence: { readonly status: 'unknown'; readonly missing: 'bound_statement_approval_receipt' };
  }[];
  /** Current comparison's bounded source facts. Qualifications belong beside a finding that uses these inputs. */
  readonly input_basis?: ConditionalInputFacts & { readonly required_disclosures: readonly string[] };
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
    readonly runEvidence?: SelectedRunEvidence;
    readonly comparison?: { readonly prior_run_id?: string; readonly run_delta?: unknown; readonly rerun_record?: unknown } } = {}): RunFacts {
  const question = analysisResult == null && state.runEvidence === undefined ? undefined
    : deriveRunQuestion({ runEvidence: state.runEvidence, storedResult: analysisResult });
  analysisResult = withGoalChanceReadback(analysisResult, analysisResult, state.runEvidence);
  const licence = current ? goalChanceLicenceForAgent(analysisResult) : undefined;
  const chances = goalChanceFactsForAgent(analysisResult, graph, current);
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
  const words = current ? warningsOf(analysisResult).find((w) => w.code === OPTION_OUTCOME_WORDS) : undefined;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const said: RunFacts['user_statements'] = nodes.flatMap((n) => (typeof n.id !== 'string' ? [] : userStatementsOn(n).map((r) => ({
    node_id: n.id as string, record: structuredClone(r),
    approval_evidence: { status: 'unknown' as const, missing: 'bound_statement_approval_receipt' as const },
  }))));
  const inputBasis = current && analysisResult != null ? conditionalInputFactsOf({ graph,
    admission: isRec(state.analysisReady) ? state.analysisReady.analysis_admission : undefined,
    analysedOptionIds: analysedOptionIds(analysisResult) }) : undefined;
  const census = licence?.olumi_estimate_link_count !== undefined || licence?.olumi_estimate_value_count !== undefined
    ? { links: licence.olumi_estimate_link_count ?? 0, values: licence.olumi_estimate_value_count ?? 0,
      settings_by_option: licence.olumi_estimate_settings_by_option ?? {} } : undefined;
  return {
    capability: {
      calculation: 'Static goal levels from a baseline plus each option’s paired change.',
      limits: [
        `This analysis route requires at least ${STATIC_LEVEL_CAPABILITY.transport_admission.minimum_option_count} options.`,
        'A static level calculation is not a forecast to a date; other calculation types require their own checks.',
        'This description grants no permission to run, quote a chance, rank options or name a leader; use the selected Run’s recorded checks and permissions.',
      ],
      evidence: 'Source contracts only; engine execution has not been independently verified.',
    },
    ...(question === undefined ? {} : { question }),
    ...(current ? { use: RUN_FACTS_USE } : {}),
    current,
    leader: runLeaderOf(analysisResult, state.analysisState, state.analysisReady, current),
    chances,
    withheld,
    ...(zeroSpread.length > 0 ? { zero_spread: zeroSpread } : {}),
    sensitivity: s.status === 'measured' ? { measured: true, most_sensitive: s.most_sensitive.label } : { measured: false },
    ...(words === undefined ? {} : { outcomes: { options: (Array.isArray(words.options) ? words.options : [])
      .filter((o): o is { option_id: string; words: string } => isRec(o) && typeof o.option_id === 'string' && typeof o.words === 'string'),
      separation: typeof words.message === 'string' && words.message !== '' ? words.message : null } }),
    ...(census !== undefined ? { olumi_inputs: census } : {}),
    user_statements: said,
    ...(inputBasis === undefined ? {} : { input_basis: { ...inputBasis, required_disclosures: conditionalInputDisclosuresOf(inputBasis) } }),
    ...(current && typeof state.comparison?.prior_run_id === 'string' && state.comparison.prior_run_id !== ''
      && (state.comparison.run_delta !== undefined || state.comparison.rerun_record !== undefined)
      ? { comparison: { prior_run_id: state.comparison.prior_run_id,
        ...(state.comparison.run_delta !== undefined ? { run_delta: state.comparison.run_delta } : {}),
        ...(recordFacts(state.comparison.rerun_record) !== undefined ? { rerun_record: recordFacts(state.comparison.rerun_record) } : {}) } } : {}),
    must_say: [...(chances.goal_chance_notes ?? []), ...(current && withheld.some(w => w.reason === 'EVALUATED_STATIC_INPUTS_NOT_RECORDED') ? [STATIC_INPUTS_NOT_RECORDED] : [])],
  };
}

