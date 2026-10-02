/**
 * ANALYSABLE-OPTION GATE — decides which options are submitted to PLoT for
 * comparative analysis, and reports the ones that were not.
 *
 * Ruling (Paul, 2026-08-14): **an unanalysable/placeholder option must NOT be
 * included in comparative ranking or probabilities. It stays visible as a
 * proposed/unanalysed alternative with a clear reason and an action to resolve
 * it.** This SUPERSEDES the scaffold-and-rank consequence of D-ask-1 (ROADMAP
 * 2.11 P0-1). The scaffold's original *job* — stop one unconfigured option
 * 422-blocking the WHOLE analysis at the PLoT preflight — survives, and is now
 * discharged by EXCLUSION rather than by minting values.
 *
 * Measured at the banked capture that forced the ruling
 * (`first-use-acceptance-2026-08-14/run-2/draws/A_hiring-2`): option
 * `31997614` "Hire Two Developers Only" arrived with `interventions: {}` and
 * `status_reason: "No interventions extracted"`, and came back ranked 3 with
 * `win_probability` 0.0355. That rank is an artefact of a SUBSTITUTION, not a
 * measurement of the option.
 *
 * ## The asymmetry that is the whole fix
 *
 * The old neutral rule was "hold each factor at its own `observed_state`
 * numbers". For an arbitrary option that means **"this option changes
 * nothing"** — which is the definition of the status quo, not an
 * approximation of the option. It does not model the option; it REPLACES it
 * with "do nothing" and then ranks that as if it were the option. (This is
 * also why the 2026-07-25 staging capture recorded PLoT removing a scaffolded
 * arm as `IDENTICAL_OPTIONS_DEDUPED` *against the status-quo option*, and why
 * `A_hiring-2` deduped one scaffolded twin onto the other.)
 *
 * Applied to an option that IS the status quo, the same rule is not a
 * placeholder at all: holding every factor at its own observed value *is* the
 * complete and correct specification of "no change". So:
 *
 *   - `is_baseline === true` + no interventions → **HELD** and submitted. The
 *     status quo does not vanish from a comparison for want of values it does
 *     not need. ISL's status-quo draw is a LEVEL ANCHOR, not a comparator.
 *   - every other option with no interventions → **EXCLUDED** from the
 *     submission entirely. Nothing is minted for it, so it cannot reach
 *     `option_comparison[]` or `decision_brief.options[]`: no rank, no win
 *     probability, by construction rather than by suppression downstream.
 *
 * ## The consumer predicate this gate mirrors (13d — derive, don't infer)
 *
 * PLoT `src/validation/preflight-v2.ts::validateInterventions` raises blocker
 * `EMPTY_INTERVENTIONS` for an option with
 * `Object.keys(option.interventions ?? {}).length === 0`, and a blocker fails
 * the whole preflight. That exact predicate — emptiness, nothing else — is
 * what {@link hasEmptyInterventions} tests. The gate is written against the
 * consumer's real rule, not against the symptom that led us here.
 *
 * ## Disclosure
 *
 * Excluded options are disclosed BY NAME with a reason and a repair, through
 * the existing omitted-suffix machinery (`coaching/scaffold-disclosure.ts`),
 * which already carries exactly the copy the ruling asks for. Held baselines
 * get their own new sentence — reusing the placeholder copy would be false
 * twice over (nothing was defaulted from a guess, and the comparison is NOT
 * "illustrative until you configure it").
 *
 * ## Invariants
 *
 * TOTALITY: never throws. Any internal failure returns the input unchanged —
 * i.e. today's blocking behaviour, never a half-gated payload.
 *
 * Pure: never mutates the snapshot options, the graph, or persisted state.
 * The gate exists ONLY on the outbound PLoT projection; the persisted graph
 * (and therefore `graph_hash_at_run` / freshness) is untouched.
 *
 * Byte-stable no-op: when every option is analysable the submitted set is the
 * INPUT ARRAY BY REFERENCE, so a fully-configured scenario is unchanged to the
 * byte. Pinned by identity (`toBe`), not by deep equality.
 */

import type { ScaffoldedOptionRecord } from '../../coaching/scaffold-disclosure.js';
import {
  buildFactorScaleMap,
  extractNumericInterventionValue,
  resolveRawInterventionValue,
  type FactorScaleInfo,
} from '../plot-intervention-scale.js';
import { recoverScaleFrame } from './d1-shared/scale-frame.js';

/**
 * PLoT's `/v2/run` Ajv request schema declares `options` with `minItems: 2`,
 * and `decision-brief.ts::buildBandedHeadline` returns null below two options
 * ("no comparative claim without a comparison"). Exclusion can therefore leave
 * a submission PLoT will refuse — so the run refuses FIRST, honestly, naming
 * what to fix. See `run-analysis.ts` §2.56.
 */
export const PLOT_MIN_COMPARISON_OPTIONS = 2;

export interface AnalysableOptionGateInput {
  /** PLoT-projection options from the scenario snapshot. */
  readonly options: ReadonlyArray<Record<string, unknown>>;
  /** The snapshot graph (GraphV3-parsed) — factor values + option edges. */
  readonly graph: unknown;
  /**
   * The RAW persisted graph — the AUTHORITY for user intervention intent
   * (the GraphV3 projection can drop `node.data`, so intent detection on
   * the parsed graph alone would hold values over autosave-written ones).
   */
  readonly rawPersistedGraph?: unknown;
  /**
   * P1-1 (one scale convention): MUST match the projection the snapshot
   * loader applied to the configured siblings' interventions. The egress
   * scale net is UNCONDITIONAL since 2026-07-20 (O-7 wave 2:
   * CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted), so the production caller
   * (run_analysis, which owns the outbound PLoT payload) pins this true;
   * the parameter survives as a pure-function input so the OFF-convention
   * maths stays unit-testable. The hold routes its candidates through the
   * SAME projection functions the loader used, so its wire numbers land in
   * the sibling convention.
   */
  readonly scaleNetEnabled: boolean;
}

/**
 * One option EXCLUDED from the PLoT submission — no values minted for it, so
 * it cannot be ranked or scored.
 *
 * `reason` is an ENUM, not a boolean: today exclusion has exactly one cause,
 * and a boolean would have to be renamed the day it gains a second. It is also
 * what lets a consumer say WHY without re-deriving the verdict.
 *
 * Deliberately NOT a {@link ScaffoldedOptionRecord}: that type carries
 * `value_defaulted: true`, which is FALSE for an excluded option — nothing was
 * defaulted for it. A lie minted to satisfy a type is still a lie.
 */
export interface ExcludedOptionRecord {
  readonly option_id: string;
  /** Raw option label (unsanitised); null when the node carried none. */
  readonly label: string | null;
  /**
   * ⭐ B3 (model fidelity + admission) gave the enum its second and third causes — the reason it was an enum:
   *   · `no_interventions` — nothing says what the option does (unchanged);
   *   · `incomplete`       — the option says SOME of what it does and declares what it does not carry yet
   *                          (`needs_user_mapping` with `unresolved_targets`; `missing` names them);
   *   · `duplicate`        — its submitted intervention vector equals another option's (`duplicate_of` names it).
   */
  readonly reason: 'no_interventions' | 'incomplete' | 'duplicate';
  /** `incomplete` only: what the option does that the model does not carry yet, as declared. */
  readonly missing?: readonly string[];
  /** `duplicate` only: the option it cannot be told apart from, which stays in the comparison. */
  readonly duplicate_of?: string;
  readonly duplicate_of_label?: string | null;
}

export interface AnalysableOptionGateOutcome {
  /** The set actually SUBMITTED to PLoT. */
  readonly options: ReadonlyArray<Record<string, unknown>>;
  /** Status-quo options held at their own observed position, and submitted. */
  readonly held: readonly ScaffoldedOptionRecord[];
  /** Options left out of the submission entirely. */
  readonly excluded: readonly ExcludedOptionRecord[];
}

/**
 * F4 (readiness↔run gate) — the pre-run PROJECTION of the run-path submission
 * decision. The `/graph-readiness` pre-run panel advertises this so it can say
 * "will run even though not every option is configured" instead of "blocked"
 * for exactly the mixed state `run_analysis` proceeds on.
 *
 * ⚠ THE WIRE NAMES ARE DELIBERATELY UNCHANGED AND NO LONGER DESCRIBE THE
 * MECHANISM. `will_scaffold_options` is a PUBLISHED response field
 * (`schemas/ceeResponses.ts`, `contracts/openapi.yaml`) with live UI readers
 * (`canvas/utils/composeBlockedReason.ts`, the `canRunAnalysis` gate), so
 * renaming it is a cross-service contract change that needs the UI half in the
 * same wave. The QUESTION the field answers is unchanged — *"will the run
 * proceed even though not every option is configured?"* — so the answer stays
 * correct under the new mechanism. Rename to
 * `submission_plan.will_proceed_with_unconfigured_options` is a follow-up row.
 */
export interface ScaffoldPlan {
  readonly will_scaffold_options: boolean;
  readonly option_count: number;
  readonly scaffolded_option_ids: readonly string[];
  /**
   * The options the run will LEAVE OUT — the gate's `excluded`, and only those. `scaffolded_option_ids` also
   * lists the options the run HOLDS (a status quo held at the factors' current values), and a held option is
   * SUBMITTED and compared. Every "leave out" claim reads this list, never the touched one: on the served
   * `bf-20260926T054503Z` graph the Agent said it would leave out "Status Quo" while the same run computed it.
   * The run's own record makes the same split (`run-analysis.ts`).
   */
  readonly excluded_option_ids: readonly string[];
}

/**
 * The ONE shared predicate the readiness endpoint and the run path both read.
 *
 * Anti-drift by CONSTRUCTION: this does NOT re-derive the decision — it
 * DELEGATES to {@link gateAnalysableOptions} (the exact function `run_analysis`
 * invokes) and projects that outcome to the advertised plan. A COPIED predicate
 * here would re-create the precise readiness↔run drift F4 exists to close;
 * there is deliberately no second predicate to keep in sync.
 *
 * The `>= PLOT_MIN_COMPARISON_OPTIONS` conjunct is LOAD-BEARING: when exclusion
 * leaves fewer than two options the run REFUSES (§2.56), so advertising "will
 * proceed" would be the same readiness↔run drift in the other direction.
 *
 * `option_count` counts HELD + EXCLUDED because it means *"options the run will
 * not send exactly as the user left them"*. Counting only the excluded ones
 * would say "nothing special will happen" about a run holding the status quo.
 *
 * Pure / total: inherits the gate's fail-safe (any internal failure ⇒ the
 * ungated outcome ⇒ `will_scaffold_options: false`).
 */
export function computeScaffoldPlan(input: AnalysableOptionGateInput): ScaffoldPlan {
  const outcome = gateAnalysableOptions(input);
  const touchedIds = [
    ...outcome.held.map((s) => s.option_id),
    ...outcome.excluded.map((s) => s.option_id),
  ];
  return {
    will_scaffold_options:
      touchedIds.length > 0 && outcome.options.length >= PLOT_MIN_COMPARISON_OPTIONS,
    option_count: touchedIds.length,
    scaffolded_option_ids: touchedIds,
    excluded_option_ids: outcome.excluded.map((s) => s.option_id),
  };
}

type Dict = Record<string, unknown>;

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function interventionsOf(option: Dict): Dict {
  return isPlainObject(option.interventions) ? option.interventions : {};
}

/**
 * PLoT's own `EMPTY_INTERVENTIONS` predicate, mirrored exactly: emptiness,
 * nothing else. An option that satisfies this is UNANALYSABLE — the preflight
 * blocker it raises fails the whole run.
 */
function hasEmptyInterventions(option: Dict): boolean {
  return Object.keys(interventionsOf(option)).length === 0;
}

/**
 * ⭐ B3 MODEL FIDELITY — "≥1 numeric intervention ⇒ complete" WAS THE PREDICATE, AND IT RANKED HALF-MODELLED OPTIONS.
 *
 * MEASURED (Paul's 2 Oct pricing test): "Raise Pro to £59 with introductory offer of 1 month free" carried only the
 * ongoing price and "per-seat pricing" carried a per-seat price with no seats; both had a value, so both were submitted
 * and RANKED, while the Agent itself said each was incomplete. Emptiness is PLoT's refusal predicate, not the
 * product's admission predicate.
 *
 * An option is INCOMPLETE when the one readiness authority (`assessCanonicalAnalysisReadiness` →
 * `computeAnalysisReadyStatusWithReason`) says `needs_user_mapping` AND it names what is missing in
 * `unresolved_targets` — the existing carrier, read here, never re-derived. Such an option is excluded exactly as an
 * empty one is: nothing is minted for it, it is named, and the reason travels.
 *
 * ⚠ BOTH CONJUNCTS. `needs_user_mapping` with NO targets is the empty-option limb (`interventions: {}`), which the
 * emptiness rule above already owns; a target list on a `ready` option does not occur (the status owner returns
 * `needs_user_mapping` first) and is not read as a verdict here.
 */
export function incompleteMissingOf(option: Dict): readonly string[] | null {
  if (option.status !== 'needs_user_mapping') return null;
  const targets = Array.isArray(option.unresolved_targets)
    ? option.unresolved_targets.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    : [];
  return targets.length > 0 ? targets : null;
}

/**
 * The option's SUBMITTED intervention vector, as an identity: each factor's numeric `value` and, when present, its
 * `raw_value` (the user's own figure), sorted by factor. `null` when any cell is not a plain number pair — such an
 * option is never called a duplicate (fail toward comparing, never toward hiding an option on a guess).
 *
 * Deliberately STRICTER than PLoT's own `IDENTICAL_OPTIONS` fingerprint (`analysis-ready-core.ts::
 * interventionFingerprint`, value only): two options are duplicates here only when both numbers agree, so this rule can
 * only ever remove an arm PLoT would also have collapsed.
 */
function submittedVectorIdentity(option: Dict): string | null {
  const cells = Object.entries(interventionsOf(option));
  if (cells.length === 0) return null;
  const parts: string[] = [];
  for (const [factorId, raw] of cells) {
    const cell = isPlainObject(raw) ? raw : { value: raw };
    const value = finiteNum(cell.value);
    if (value === undefined) return null;
    const rawValue = cell.raw_value === undefined ? undefined : finiteNum(cell.raw_value);
    if (cell.raw_value !== undefined && rawValue === undefined) return null;
    const snap = (n: number): number => Math.round(n / 1e-9) * 1e-9;
    parts.push(`${factorId}:${snap(value)}${rawValue !== undefined ? `|${snap(rawValue)}` : ''}`);
  }
  return parts.sort().join(';');
}

/** An unadopted Olumi suggestion, which the Run's own filter keeps out of an ordinary comparison after this gate. */
function unadoptedOlumiIds(graph: unknown): Set<string> {
  const ids = new Set<string>();
  for (const node of nodesOf(graph)) {
    if (node.kind === 'option' && typeof node.id === 'string' && node.proposed_by === 'olumi'
      && node.analysis_participation !== 'included') ids.add(node.id);
  }
  return ids;
}

/**
 * ⭐ B3-2 — TWO OPTIONS WITH THE SAME SUBMITTED VECTOR ARE ONE ARM, NOT TWO. For each group of complete options sharing
 * a vector, ONE stays: the status quo first, then a user option over an unadopted Olumi suggestion (which the Run drops
 * after this gate — keeping it would lose the user's own option), then the earlier one. Every other member is excluded
 * naming the one that stays.
 */
function duplicateExclusions(options: readonly Dict[], graph: unknown): Map<Dict, Dict> {
  const olumi = unadoptedOlumiIds(graph);
  const rank = (o: Dict): number => {
    if (isBaselineOption(o)) return 0;
    const id = optionIdOf(o);
    return id !== null && olumi.has(id) ? 2 : 1;
  };
  const groups = new Map<string, Dict[]>();
  for (const opt of options) {
    if (optionIdOf(opt) === null) continue;
    const identity = submittedVectorIdentity(opt);
    if (identity === null) continue;
    const group = groups.get(identity);
    if (group === undefined) groups.set(identity, [opt]);
    else group.push(opt);
  }
  const dropped = new Map<Dict, Dict>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = group.reduce((best, o) => (rank(o) < rank(best) ? o : best), group[0]!);
    for (const o of group) if (o !== keeper) dropped.set(o, keeper);
  }
  return dropped;
}

/**
 * The refusal sentence when B3's exclusions leave fewer than two options to compare — or `null` when every excluded
 * option is an empty one, so the existing copy ships byte for byte. Names the first incomplete option and what it does
 * not model, or the duplicate and its twin; never a count alone.
 */
export function tooFewAfterExclusionNextStep(excluded: readonly ExcludedOptionRecord[]): string | null {
  const incomplete = excluded.find((e) => e.reason === 'incomplete' && e.label !== null && (e.missing?.length ?? 0) > 0);
  if (incomplete !== undefined) {
    const missing = (incomplete.missing ?? []).join(' or the ');
    return `I've left out the options that aren't fully modelled yet, and that leaves fewer than two options, so `
      + `there's nothing to compare. '${incomplete.label}' does not model the ${missing} yet. Tell me what the `
      + `${missing} changes and by how much, and I'll write it into the model, then ask me to run the analysis again.`;
  }
  const duplicate = excluded.find((e) => e.reason === 'duplicate' && e.label !== null && typeof e.duplicate_of_label === 'string');
  if (duplicate !== undefined) {
    return `'${duplicate.label}' sets exactly the same values as '${duplicate.duplicate_of_label}', so they are one `
      + `option to the analysis, and that leaves fewer than two options to compare. Tell me what makes them different, `
      + `or add another option, then ask me to run the analysis again.`;
  }
  if (excluded.some((e) => e.reason !== 'no_interventions')) {
    return `I've left out the options that aren't fully modelled yet or repeat another option, and that leaves fewer `
      + `than two options, so there's nothing to compare. Tell me what your other options change and I'll write them `
      + `into the model, then ask me to run the analysis again.`;
  }
  return null;
}

/**
 * Strictly `=== true`, so a MISSING verdict excludes rather than holds.
 *
 * Both directions are wrong in some world. Excluding a real-but-undetected
 * status quo leaves it visible, named, disclosed and one configure step away.
 * Holding a non-baseline would put a CEE-authored position inside a ranked
 * comparison with nothing marking it as ours. This one fails toward saying
 * less.
 */
function isBaselineOption(option: Dict): boolean {
  return option.is_baseline === true;
}

function optionIdOf(option: Dict): string | null {
  if (typeof option.option_id === 'string' && option.option_id.length > 0) return option.option_id;
  if (typeof option.id === 'string' && option.id.length > 0) return option.id;
  return null;
}

function nodesOf(graph: unknown): Dict[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  return graph.nodes.filter(isPlainObject);
}

/**
 * Per-factor HOLD value: the factor's own `observed_state` object, routed
 * through the EXACT projection the configured siblings' interventions went
 * through (one scale convention, not two). A factor whose observed state does
 * not project to a safe wire number is absent from the map — skipped, never
 * fabricated.
 *
 * ⚠ THE PRIOR-RANGE MIDPOINT RUNG WAS DELETED WITH THE RULING. A
 * centre-of-range guess answers *"where might this factor sit?"*; the status
 * quo is a claim about *where it does sit*. The hold is now this function's
 * only caller, so a rung that cannot support the hold's claim has no honest
 * caller left. Deleted outright rather than left behind a pinned-true flag: a
 * branch no production path can reach, kept alive by its own tests, is how a
 * rule quietly stops being enforced.
 */
function buildHoldFactorValues(
  graph: unknown,
  scaleNetEnabled: boolean,
): Map<string, unknown> {
  // The map carries the CANDIDATE OBJECT, not a projected wire number.
  // Projection to the wire happens exactly once, downstream, over the WHOLE
  // request (configured siblings + held baseline together) — the per-value
  // projection here is used for SELECTION only (reject unprojectable /
  // ambiguous candidates). Emitting a projected number from here was the
  // round-4 TOCTOU: it re-mixed the request AFTER the request-level guard had
  // attested coherence.
  const hold = new Map<string, unknown>();
  const nodes = nodesOf(graph);
  // The SAME evidence map the loader's net-ON sibling projection builds. Built
  // UNCONDITIONALLY: the factor's cap also decides the `raw_value` provenance
  // question below, which is a property of the candidate OBJECT and therefore
  // of both wire conventions. The net-OFF projection is still handed
  // `undefined`, so OFF selection semantics are byte-identical.
  const scaleById = buildFactorScaleMap(nodes);
  for (const node of nodes) {
    if (node.kind !== 'factor' || typeof node.id !== 'string') continue;
    const factorScale = scaleById.get(node.id);
    // Derived from the SAME FactorScaleInfo the projection reads — never a
    // local re-implementation of the cap fallback chain (trap 12: a
    // hand-maintained mirror drifts silently and the drift reads as green).
    // `> 0` mirrors `scaleNumeric`'s own `capUsable`, the predicate that
    // actually decides whether `raw_value` can be demoted.
    const capUsable = factorScale?.cap !== undefined && factorScale.cap > 0;
    const obs = isPlainObject(node.observed_state) ? node.observed_state : undefined;
    if (obs === undefined) continue;
    const candidate: Dict = {};
    const value = finiteNum(obs.value);
    const rawValue = finiteNum(obs.raw_value);
    if (value !== undefined) candidate.value = value;
    // ⭐ A `raw_value` is only a LEVEL on a factor that declares the frame
    // making it one. On a CAPPED factor it is exactly that (PLoT divides by
    // the cap) and a consistent pair carries a `unitIntervalEquivalent`, so it
    // is demotable — keep it, unchanged.
    //
    // On a CAPLESS factor it is a DISPLAY magnitude the drafter stored beside
    // the framed level it also wrote (`{value: 0.6, raw_value: 600000}` for
    // "£600,000"), and `projector.ts` deliberately stores no cap. Copying it
    // into a synthesised object made `resolveRawInterventionValue` rule 1 —
    // where `raw_value` WINS — emit 600000 onto the wire beside its siblings'
    // 0.6 and 0; with no cap that emission can carry no
    // `unitIntervalEquivalent`, so it was UNDEMOTABLE and the request became
    // unresolvably mixed. `run_analysis` then refused, naming a factor whose
    // incoherent value CEE had just manufactured.
    //
    // Measured at the wire on deployed staging CEE 6079f2d, 2026-08-13
    // (DIAGNOSIS-MIXED-SCALE.md §3.3, arms M2 and N; banked in
    // `__tests__/fixtures/staging-mixed-scale-captures-2026-08-13.json`):
    // 3 of 3 big-money briefs blocked.
    //
    // Omitting it lets the candidate fall to rule `no_cap`, which emits the
    // factor's own `value` — the sibling convention, and on a capless factor
    // the level itself. An honest absence beats a fabricated magnitude.
    //
    // ⛔ EXCEPT A CAPLESS FRAMED PAIR (DL #72 5865140074; MG 5865254606). Olumi's
    // estimated factors carry their frame as the pair itself (`{value: 0.6,
    // raw_value: 60}`, `scale_frame` 100, no cap), and their siblings' build-time
    // levels go out RAW (75). Dropping the 60 sent the status quo at 0.6 beside
    // 75: one factor in two conventions, so PLoT normalised the whole request and
    // held the status quo at 0.006 of its frame (served journey A: status quo
    // p50 0, mean −£41,379 against today's £75,000). The projection already owns
    // this shape (`scaleNumeric`'s `caplessPairProvesUnitForm`, through
    // `recoverScaleFrame`): it emits the raw level DEMOTABLY, so a request whose
    // siblings are unit-interval still demotes it. The hold asks the same owner;
    // a pair it refuses (unframed, zero, negative, level above 1) is still held
    // at its value, as before.
    const framedPair =
      value !== undefined && value <= 1 && recoverScaleFrame({ value, raw_value: rawValue }) !== undefined;
    if ((capUsable || framedPair) && rawValue !== undefined) candidate.raw_value = rawValue;
    if (Object.keys(candidate).length === 0) continue;
    const wire = projectHoldCandidate(
      candidate,
      scaleNetEnabled ? factorScale : undefined,
      scaleNetEnabled,
    );
    if (wire !== undefined) {
      // Selection passed — keep the OBJECT; the single request-level
      // projection downstream derives the wire value in request context.
      hold.set(node.id, candidate);
    }
    // No projectable observed provenance → skipped: the hold may report a
    // position, never invent one.
  }
  return hold;
}

/**
 * Route ONE hold candidate object through the sibling projection for the
 * active flag state, returning the wire number or `undefined` when the
 * candidate is not safe provenance.
 *
 * Net ON additionally rejects `ambiguous_no_evidence`: PLoT divides
 * intervention values by `observed_state.cap`, so an unproven `[0,1]` value on
 * a cap-bearing factor would slam the option's position to ~0 — a large
 * intervention masquerading as "no change". Skipping is the honest hold (PLoT
 * holds un-intervened factors at baseline anyway).
 *
 * ⚠ REAL PRODUCT CONSEQUENCE, STATED RATHER THAN BURIED: a status-quo option
 * ALL of whose factors carry unprovable `[0,1]` observed values ends up with
 * no holdable target, and is therefore EXCLUDED, not held. That is a genuine,
 * disclosed limitation of the status-quo arm, and it is the correct direction:
 * excluding beats submitting a position at a scale we cannot prove.
 */
function projectHoldCandidate(
  candidate: Dict,
  factor: FactorScaleInfo | undefined,
  scaleNetEnabled: boolean,
): number | undefined {
  if (!scaleNetEnabled) {
    const value = extractNumericInterventionValue(candidate);
    return value === null ? undefined : value;
  }
  const result = resolveRawInterventionValue(candidate, factor);
  if (result.value === null) return undefined;
  if (result.rule === 'ambiguous_no_evidence') return undefined;
  return result.value;
}

/** option id → factor ids the option has outgoing edges to (edge order). */
function buildOptionFactorEdgeMap(graph: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!isPlainObject(graph) || !Array.isArray(graph.edges)) return map;
  const factorIds = new Set<string>();
  const optionIds = new Set<string>();
  for (const node of nodesOf(graph)) {
    if (typeof node.id !== 'string') continue;
    if (node.kind === 'factor') factorIds.add(node.id);
    if (node.kind === 'option') optionIds.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!isPlainObject(edge)) continue;
    const from = typeof edge.from === 'string' ? edge.from : null;
    const to = typeof edge.to === 'string' ? edge.to : null;
    if (from === null || to === null) continue;
    if (!optionIds.has(from) || !factorIds.has(to)) continue;
    const existing = map.get(from);
    if (existing === undefined) map.set(from, [to]);
    else if (!existing.includes(to)) existing.push(to);
  }
  return map;
}

/**
 * Option ids whose PERSISTED node carries ANY intervention entry in any of
 * the three source locations `mergeInterventionSourceObjects` reads
 * (data.interventions / `data/interventions/<fac>` slash keys / top-level
 * interventions) — regardless of whether the entry projected to a numeric
 * value. Presence of an entry is user intent, and user intent is never
 * overwritten: such an option is EXCLUDED and disclosed, not held at values
 * CEE chose in place of the ones the user wrote.
 */
function collectInterventionIntentOptionIds(graph: unknown): Set<string> {
  const intent = new Set<string>();
  for (const node of nodesOf(graph)) {
    if (node.kind !== 'option' || typeof node.id !== 'string') continue;
    const data = isPlainObject(node.data) ? node.data : undefined;
    if (data && isPlainObject(data.interventions) && Object.keys(data.interventions).length > 0) {
      intent.add(node.id);
      continue;
    }
    if (Object.keys(node).some((k) => k.startsWith('data/interventions/'))) {
      intent.add(node.id);
      continue;
    }
    if (isPlainObject(node.interventions) && Object.keys(node.interventions).length > 0) {
      intent.add(node.id);
    }
  }
  return intent;
}

export function gateAnalysableOptions(
  input: AnalysableOptionGateInput,
): AnalysableOptionGateOutcome {
  const ungated: AnalysableOptionGateOutcome = {
    options: input.options,
    held: [],
    excluded: [],
  };
  try {
    const options = input.options.filter(isPlainObject);
    if (options.length !== input.options.length) return ungated;

    // ⭐ B3: an option that declares what it does not model is INCOMPLETE and leaves first (with an identity — an
    // option that cannot be named cannot be disclosed, so it stays to PLoT exactly as before); then, among the complete
    // valued options, a second option with the same submitted vector is the SAME arm and leaves naming its twin.
    const incomplete = new Map<Dict, readonly string[]>();
    for (const opt of options) {
      const missing = incompleteMissingOf(opt);
      if (missing !== null && optionIdOf(opt) !== null) incomplete.set(opt, missing);
    }
    const valuedComplete = options.filter((o) => !incomplete.has(o) && !hasEmptyInterventions(o));
    const duplicates = duplicateExclusions(valuedComplete, input.rawPersistedGraph ?? input.graph);

    const unanalysable = options.filter((o) => !incomplete.has(o) && hasEmptyInterventions(o));
    // BYTE-STABLE NO-OP: every option is analysable, so there is nothing to
    // decide. The submitted set is the INPUT ARRAY BY REFERENCE.
    if (unanalysable.length === 0 && incomplete.size === 0 && duplicates.size === 0) return ungated;
    const analysable = valuedComplete.filter((o) => !duplicates.has(o));
    // All-unanalysable is owned by the pre-PLoT `options_not_configured` guard
    // (`run-analysis.ts` §2.5), which tests the same emptiness predicate over
    // the same options and runs BEFORE this gate. The gate must never turn
    // "nothing was runnable" into an EMPTY submission.
    // ⚠ B3: that guard cannot see an INCOMPLETE option (it has a value), so this early return is kept ONLY for the
    // pre-B3 shape. With an incomplete option present the exclusions below still run, and too few survivors is the
    // run's own `insufficient_analysable_options` refusal — never a submission that ranks the incomplete option.
    if (analysable.length === 0 && incomplete.size === 0 && duplicates.size === 0) return ungated;

    const holdValues = buildHoldFactorValues(input.graph, input.scaleNetEnabled);
    const edgeTargets = buildOptionFactorEdgeMap(input.graph);
    const intentIds = collectInterventionIntentOptionIds(
      input.rawPersistedGraph ?? input.graph,
    );

    // Comparison basis: factor ids the analysable siblings intervene on
    // (insertion order), restricted to factors with a holdable value.
    const comparisonBasis: string[] = [];
    for (const opt of analysable) {
      for (const factorId of Object.keys(interventionsOf(opt))) {
        if (!comparisonBasis.includes(factorId) && holdValues.has(factorId)) {
          comparisonBasis.push(factorId);
        }
      }
    }

    const held: ScaffoldedOptionRecord[] = [];
    const excluded: ExcludedOptionRecord[] = [];
    const submitted: Dict[] = [];

    for (const opt of options) {
      const missing = incomplete.get(opt);
      if (missing !== undefined) {
        excluded.push({
          option_id: optionIdOf(opt)!,
          label: typeof opt.label === 'string' ? opt.label : null,
          reason: 'incomplete',
          missing: [...missing],
        });
        continue;
      }
      const twin = duplicates.get(opt);
      if (twin !== undefined) {
        excluded.push({
          option_id: optionIdOf(opt)!,
          label: typeof opt.label === 'string' ? opt.label : null,
          reason: 'duplicate',
          duplicate_of: optionIdOf(twin)!,
          duplicate_of_label: typeof twin.label === 'string' ? twin.label : null,
        });
        continue;
      }
      if (!hasEmptyInterventions(opt)) {
        submitted.push(opt);
        continue;
      }
      const optionId = optionIdOf(opt);
      if (optionId === null) {
        // No readable identity: it cannot be disclosed by name, and it cannot
        // be matched to a returned comparison entry. Excluding it would
        // silently drop an option the user can see on their canvas — the one
        // outcome worse than the pre-ruling behaviour. PLoT's
        // EMPTY_INTERVENTIONS blocker owns it, loudly. (Unchanged.)
        submitted.push(opt);
        continue;
      }
      const label = typeof opt.label === 'string' ? opt.label : null;
      if (isBaselineOption(opt) && !intentIds.has(optionId)) {
        const ownEdges = edgeTargets.get(optionId) ?? [];
        const connected = ownEdges.filter((f) => holdValues.has(f));
        // Review fix B4 (doctrine scope) RETAINED: the comparison-basis
        // fallback covers ONLY options with NO edges at all. An option WITH
        // edges whose targets lack holdable values is not silently switched to
        // the sibling basis — that would misdescribe what ran.
        const targets =
          connected.length > 0 ? connected : ownEdges.length === 0 ? comparisonBasis : [];
        if (targets.length > 0) {
          const interventions: Record<string, unknown> = {};
          for (const factorId of targets) {
            interventions[factorId] = holdValues.get(factorId)!;
          }
          held.push({
            option_id: optionId,
            label,
            factor_ids: targets,
            value_defaulted: true,
          });
          submitted.push({ ...opt, interventions });
          continue;
        }
        // Nothing holdable → fall through to exclusion. We never invent the
        // status quo either: an unprovable "no change" is still an invention.
      }
      excluded.push({ option_id: optionId, label, reason: 'no_interventions' });
    }

    if (held.length === 0 && excluded.length === 0) return ungated;
    return { options: submitted, held, excluded };
  } catch (err) {
    // TOTAL: fail-safe is today's behaviour (the run blocks; nothing is
    // half-gated, nothing undisclosed reaches PLoT). Review fix B5: the
    // fallback is right, the SILENCE was the bug — a future regression in here
    // would revert every mixed-configured run to 422-blocking with zero
    // signal. Log loudly (error class only, no graph content — PII rule).
    // eslint-disable-next-line no-console -- deliberate stderr signal: this
    // module has no logger dependency and must never throw from its catch.
    console.error(
      `[analysable-option-gate] gate crashed; falling back to the ungated input: ${err instanceof Error ? err.name + ': ' + err.message : 'non-Error throw'}`,
    );
    return ungated;
  }
}
