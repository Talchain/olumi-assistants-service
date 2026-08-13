/**
 * D-ask-1 (ROADMAP 2.11 P0-1) — scaffold neutral placeholder interventions
 * for options added WITHOUT configuration, so `run_analysis` completes
 * (with the defaults DISCLOSED) instead of one unconfigured option
 * 422-blocking the WHOLE analysis at the PLoT preflight.
 *
 * Scope — deliberately narrow (the ratified decision covers exactly this):
 *   - Fires ONLY when at least one option IS configured AND at least one is
 *     not. All-unconfigured scenarios keep the pre-PLoT
 *     `options_not_configured` guard + #487's honest configure path — an
 *     analysis that was never runnable is not "kept running" by inventing
 *     every option.
 *   - NEVER touches a configured option (no scaffold overwrite — the
 *     projected interventions of configured options pass through by
 *     reference, byte-identical).
 *   - NEVER scaffolds over user intent: an option whose PERSISTED node
 *     carries any intervention entry (data.interventions / slash-keyed /
 *     top-level) that merely failed numeric projection was CONFIGURED by
 *     the user — defaulting placeholders over their values would
 *     misrepresent. Those stay on the recoverable configure path.
 *
 * Neutral-value rule (per target factor — the factor's OWN stored numbers,
 * never an invented magnitude; same class as the engine-side
 * CONSTRAINT_NODE_DEFAULT_BASE defaulting convention: default + coded
 * disclosure). Candidate provenance, in order:
 *   1. the factor's own `observed_state` numbers — `{value, raw_value}` on a
 *      CAPPED factor, `{value}` alone on a CAPLESS one. A capless factor's
 *      `raw_value` is the DISPLAY magnitude stored beside the framed level
 *      (`{value: 0.6, raw_value: 600000}` for "£600,000"), and with no cap it
 *      is undemotable, so synthesising it onto a placeholder shipped a raw
 *      magnitude beside unit-scale siblings and blocked the whole analysis —
 *      see the inline note in `buildNeutralFactorValues` for the measurement;
 *   2. `prior.range_min`/`range_max` midpoint — centre-of-range;
 *   3. no projectable provenance → the factor is SKIPPED (never fabricated).
 *
 * ONE scale convention, not two (P1-1): the candidate is an intervention
 * OBJECT, and the final WIRE number is derived by routing it through the
 * EXACT projection the configured siblings' interventions went through in
 * `loadScenarioSnapshotForRunAnalysis` (both functions live in
 * `../plot-intervention-scale.ts` — no local mirror):
 *   - scale net OFF (legacy wire): `extractNumericInterventionValue` — the
 *     stored `.value` field verbatim, the sibling convention. `raw_value`
 *     is deliberately NEVER sent on this wire (mixing raw user-scale into
 *     a normalised wire distorts the whole option ranking, undisclosed);
 *   - scale net ON (raw wire): `resolveRawInterventionValue` with the SAME
 *     `buildFactorScaleMap` evidence the sibling projection uses —
 *     `raw_value` wins, a PROVEN-normalised value is denormalised, a
 *     capless/raw-looking value passes through. An AMBIGUOUS `[0,1]` value
 *     on a cap-bearing factor is REJECTED as scaffold provenance: PLoT
 *     divides intervention values by `observed_state.cap`, so an unproven
 *     0.4 on a cap-5000 factor would slam the option's position to ~0 — a
 *     large intervention masquerading as neutral. Skipping is the honest
 *     neutral (PLoT holds un-intervened factors at baseline); the sibling
 *     projection SURFACES the same ambiguity instead, because there it is
 *     interpreting a user-authored value, not fabricating one.
 *
 * Target-factor selection per unconfigured option: the option's own
 * option→factor edges first; when it has none, the union of the CONFIGURED
 * siblings' intervention factor ids (the comparison basis — a neutral
 * position on exactly the levers the analysis compares). An option with no
 * scaffoldable target at all is left untouched (honest degradation: the
 * existing preflight-422 → `options_not_configured` recovery still fires).
 *
 * TOTALITY: never throws. Any internal failure returns the input unchanged
 * — today's blocking behaviour, never a half-scaffolded payload.
 *
 * Pure: never mutates the snapshot options, the graph, or persisted state.
 * The scaffold exists ONLY on the outbound PLoT projection; the persisted
 * graph (and therefore `graph_hash_at_run` / freshness) is untouched.
 */

import type { ScaffoldedOptionRecord } from '../../coaching/scaffold-disclosure.js';
import {
  buildFactorScaleMap,
  extractNumericInterventionValue,
  resolveRawInterventionValue,
  type FactorScaleInfo,
} from '../plot-intervention-scale.js';

export interface ScaffoldUnconfiguredInput {
  /** PLoT-projection options from the scenario snapshot. */
  readonly options: ReadonlyArray<Record<string, unknown>>;
  /** The snapshot graph (GraphV3-parsed) — factor values + option edges. */
  readonly graph: unknown;
  /**
   * The RAW persisted graph — the AUTHORITY for user intervention intent
   * (the GraphV3 projection can drop `node.data`, so intent detection on
   * the parsed graph alone would scaffold over autosave-written values).
   */
  readonly rawPersistedGraph?: unknown;
  /**
   * P1-1 (one scale convention): MUST match the projection the snapshot
   * loader applied to the configured siblings' interventions. The egress
   * scale net is UNCONDITIONAL since 2026-07-20 (O-7 wave 2:
   * CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted), so the production caller
   * (run_analysis, which owns the outbound PLoT payload) pins this true;
   * the parameter survives as a pure-function input so the OFF-convention
   * maths stays unit-testable. The scaffold routes its neutral candidates
   * through the SAME projection functions the loader used, so its wire
   * numbers land in the sibling convention.
   */
  readonly scaleNetEnabled: boolean;
}

export interface ScaffoldUnconfiguredOutcome {
  readonly options: ReadonlyArray<Record<string, unknown>>;
  readonly scaffolded: readonly ScaffoldedOptionRecord[];
}

/**
 * F4 (readiness↔run gate) — the pre-run PROJECTION of the run-path scaffold
 * decision. The `/graph-readiness` pre-run panel advertises this so it can say
 * "will run with disclosed placeholders" instead of "blocked" for exactly the
 * mixed-configured state `run_analysis` scaffolds and succeeds on.
 *
 * `will_scaffold_options` is TRUE iff `run_analysis` would scaffold ≥1
 * unconfigured option for this input; `option_count` is how many.
 */
export interface ScaffoldPlan {
  readonly will_scaffold_options: boolean;
  readonly option_count: number;
  readonly scaffolded_option_ids: readonly string[];
}

/**
 * The ONE shared predicate the readiness endpoint and the run path both read.
 *
 * Anti-drift by CONSTRUCTION: this does NOT re-derive the scaffold decision —
 * it DELEGATES to `scaffoldUnconfiguredOptions` (the exact function
 * `run_analysis` invokes to decide what it will scaffold) and projects that
 * outcome to the advertised plan. A COPIED predicate here would re-create the
 * precise readiness↔run drift F4 exists to close (the April-2026 gate drift, in
 * reverse); there is deliberately no second predicate to keep in sync. For any
 * given input, `computeScaffoldPlan(input).will_scaffold_options` and
 * `scaffoldUnconfiguredOptions(input).scaffolded.length > 0` are the same value
 * because they are the same computation.
 *
 * Pure / total: inherits `scaffoldUnconfiguredOptions`' fail-safe (any internal
 * failure ⇒ the unscaffolded outcome ⇒ `will_scaffold_options: false`).
 */
export function computeScaffoldPlan(input: ScaffoldUnconfiguredInput): ScaffoldPlan {
  const outcome = scaffoldUnconfiguredOptions(input);
  return {
    will_scaffold_options: outcome.scaffolded.length > 0,
    option_count: outcome.scaffolded.length,
    scaffolded_option_ids: outcome.scaffolded.map((s) => s.option_id),
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

function hasEmptyInterventions(option: Dict): boolean {
  return Object.keys(interventionsOf(option)).length === 0;
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
 * Neutral placeholder WIRE value per factor id. Candidates (the factor's
 * own `observed_state` object, then the prior-range midpoint) are built as
 * intervention OBJECTS and routed through the EXACT projection the
 * configured siblings' interventions went through (see the module header:
 * one scale convention, not two). A factor none of whose candidates
 * projects to a safe wire number is absent from the map — skipped, never
 * fabricated.
 */
function buildNeutralFactorValues(
  graph: unknown,
  scaleNetEnabled: boolean,
): Map<string, unknown> {
  // ROUND 4 (final-payload enforcement): the map now carries the CANDIDATE
  // OBJECT, not a projected wire number. Projection to the wire happens
  // exactly once, downstream, over the WHOLE request (configured siblings +
  // scaffolded neutrals together) — the per-value projection here is used for
  // SELECTION only (reject unprojectable / ambiguous candidates), preserving
  // the original selection semantics byte-for-byte. Emitting a projected
  // number from here was the TOCTOU: it re-mixed the request AFTER the
  // request-level guard had attested coherence.
  const neutral = new Map<string, unknown>();
  const nodes = nodesOf(graph);
  // The SAME evidence map the loader's net-ON sibling projection builds
  // (buildFactorScaleMap over the graph nodes). Built UNCONDITIONALLY since
  // 2026-08-13: the factor's cap now also decides the `raw_value` provenance
  // question below, which is a property of the candidate OBJECT and therefore
  // of both wire conventions. The net-OFF projection is still handed
  // `undefined`, so OFF selection semantics are byte-identical.
  const scaleById = buildFactorScaleMap(nodes);
  for (const node of nodes) {
    if (node.kind !== 'factor' || typeof node.id !== 'string') continue;
    const factorScale = scaleById.get(node.id);
    // Derived from the SAME FactorScaleInfo the projection reads — never a
    // local re-implementation of the cap fallback chain (CLAUDE.md trap 12:
    // a hand-maintained mirror drifts silently and the drift reads as green).
    // `> 0` mirrors `scaleNumeric`'s own `capUsable`, which is the predicate
    // that actually decides whether `raw_value` can be demoted.
    const capUsable = factorScale?.cap !== undefined && factorScale.cap > 0;
    const candidates: Dict[] = [];
    const obs = isPlainObject(node.observed_state) ? node.observed_state : undefined;
    if (obs !== undefined) {
      const observedCandidate: Dict = {};
      const value = finiteNum(obs.value);
      const rawValue = finiteNum(obs.raw_value);
      if (value !== undefined) observedCandidate.value = value;
      // ⭐ A `raw_value` is only a LEVEL on a factor that declares the frame
      // making it one. On a CAPPED factor it is exactly that (PLoT divides by
      // the cap) and a consistent pair carries a `unitIntervalEquivalent`, so
      // it is demotable — keep it, unchanged.
      //
      // On a CAPLESS factor it is a DISPLAY magnitude that the drafter stored
      // beside the framed level it also wrote (`{value: 0.6, raw_value:
      // 600000}` for "£600,000"), and `projector.ts` deliberately stores no
      // cap. Copying it into a SYNTHESISED placeholder made
      // `resolveRawInterventionValue` rule 1 — where `raw_value` WINS — emit
      // 600000 onto the wire beside its siblings' 0.6 and 0; with no cap that
      // emission can carry no `unitIntervalEquivalent`, so it was UNDEMOTABLE
      // and the request became unresolvably mixed. `run_analysis` then refused,
      // naming a factor whose incoherent value CEE had just manufactured.
      //
      // Measured at the wire on deployed staging CEE 6079f2d, 2026-08-13
      // (DIAGNOSIS-MIXED-SCALE.md §3.3, arms M2 and N; banked in
      // `__tests__/fixtures/staging-mixed-scale-captures-2026-08-13.json`):
      // 3 of 3 big-money briefs blocked, and the one that computed did so only
      // because both its options happened to be configured.
      //
      // Omitting it lets the candidate fall to rule `no_cap`, which emits the
      // factor's own `value` — the sibling convention this module's header
      // (P1-1) already commits to, and on a capless factor the level itself.
      // An honest absence beats a fabricated magnitude: the scaffold may
      // default, never invent.
      if (capUsable && rawValue !== undefined) observedCandidate.raw_value = rawValue;
      if (Object.keys(observedCandidate).length > 0) candidates.push(observedCandidate);
    }
    const prior = isPlainObject(node.prior) ? node.prior : undefined;
    const rangeMin = prior ? finiteNum(prior.range_min) : undefined;
    const rangeMax = prior ? finiteNum(prior.range_max) : undefined;
    if (rangeMin !== undefined && rangeMax !== undefined) {
      // Review fix B3 (fail-closed): on the scale-net-OFF wire the midpoint is
      // forwarded VERBATIM with no scale/ambiguity check downstream, so a
      // raw-magnitude prior (e.g. range 100000..500000 on a money factor)
      // would inject a wrong-scale "neutral" beside [0,1]-convention siblings.
      // Only trust the midpoint on net-OFF when the prior itself sits inside
      // the sibling convention; otherwise skip the candidate — the option
      // stays unconfigured and takes the existing honest configure path.
      // Net-ON keeps its own resolveRawInterventionValue ambiguity rejection.
      if (scaleNetEnabled || (rangeMin >= 0 && rangeMax <= 1)) {
        candidates.push({ value: (rangeMin + rangeMax) / 2 });
      }
    }
    for (const candidate of candidates) {
      const wire = projectNeutralCandidate(
        candidate,
        scaleNetEnabled ? factorScale : undefined,
        scaleNetEnabled,
      );
      if (wire !== undefined) {
        // Selection passed — keep the OBJECT; the single request-level
        // projection downstream derives the wire value in request context.
        neutral.set(node.id, candidate);
        break;
      }
    }
    // No projectable provenance → skipped: a placeholder is a default,
    // never an invention.
  }
  return neutral;
}

/**
 * Route ONE neutral candidate object through the sibling projection for the
 * active flag state, returning the wire number or `undefined` when the
 * candidate is not safe scaffold provenance. Net ON additionally rejects
 * `ambiguous_no_evidence` — see the module header for why an unproven
 * `[0,1]` value on a cap-bearing factor must be skipped, not sent.
 */
function projectNeutralCandidate(
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
 * value. Presence of an entry is user intent; intent is never scaffolded
 * over.
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

export function scaffoldUnconfiguredOptions(
  input: ScaffoldUnconfiguredInput,
): ScaffoldUnconfiguredOutcome {
  const untouched: ScaffoldUnconfiguredOutcome = { options: input.options, scaffolded: [] };
  try {
    const options = input.options.filter(isPlainObject);
    if (options.length !== input.options.length) return untouched;

    const unconfigured = options.filter(hasEmptyInterventions);
    if (unconfigured.length === 0) return untouched;
    const configured = options.filter((o) => !hasEmptyInterventions(o));
    // All-unconfigured stays with the pre-PLoT guard + honest configure path.
    if (configured.length === 0) return untouched;

    const neutral = buildNeutralFactorValues(input.graph, input.scaleNetEnabled);
    const edgeTargets = buildOptionFactorEdgeMap(input.graph);
    const intentIds = collectInterventionIntentOptionIds(
      input.rawPersistedGraph ?? input.graph,
    );

    // Comparison basis: factor ids the configured siblings intervene on
    // (insertion order), restricted to factors with a neutral value.
    const comparisonBasis: string[] = [];
    for (const opt of configured) {
      for (const factorId of Object.keys(interventionsOf(opt))) {
        if (!comparisonBasis.includes(factorId) && neutral.has(factorId)) {
          comparisonBasis.push(factorId);
        }
      }
    }

    const scaffolded: ScaffoldedOptionRecord[] = [];
    const outOptions = options.map((opt) => {
      if (!hasEmptyInterventions(opt)) return opt;
      const optionId = optionIdOf(opt);
      if (optionId === null || intentIds.has(optionId)) return opt;
      const ownEdges = edgeTargets.get(optionId) ?? [];
      const connected = ownEdges.filter((f) => neutral.has(f));
      // Review fix B4 (doctrine scope): the ratified D-ask-1 comparison-basis
      // fallback covers ONLY options with NO edges at all. An option WITH
      // edges whose targets lack projectable neutrals is not silently
      // switched to the sibling basis (that would misdescribe what ran) —
      // it stays on the honest configure path.
      const targets = connected.length > 0 ? connected : ownEdges.length === 0 ? comparisonBasis : [];
      if (targets.length === 0) return opt; // nothing safe → honest 422 recovery
      const interventions: Record<string, unknown> = {};
      for (const factorId of targets) {
        interventions[factorId] = neutral.get(factorId)!;
      }
      scaffolded.push({
        option_id: optionId,
        label: typeof opt.label === 'string' ? opt.label : null,
        factor_ids: targets,
        value_defaulted: true,
      });
      return { ...opt, interventions };
    });

    if (scaffolded.length === 0) return untouched;
    return { options: outOptions, scaffolded };
  } catch (err) {
    // TOTAL: fail-safe is today's behaviour (the run blocks; nothing is
    // half-scaffolded, nothing undisclosed reaches PLoT). Review fix B5:
    // the fallback is right, the SILENCE was the bug — a future regression
    // in here would revert every mixed-configured run to 422-blocking with
    // zero signal. Log loudly (error class only, no graph content — PII rule).
    // eslint-disable-next-line no-console -- deliberate stderr signal: this
    // module has no logger dependency and must never throw from its catch.
    console.error(
      `[scaffold-unconfigured-options] scaffold crashed; falling back to unscaffolded input: ${err instanceof Error ? err.name + ': ' + err.message : 'non-Error throw'}`,
    );
    return untouched;
  }
}
