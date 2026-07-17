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
 *   1. the factor's own `observed_state` numbers (`{value, raw_value}` as
 *      stored — the factor's current position);
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
   * P1-1 (one scale convention): MUST be the same
   * `config.cee.plotEgressScaleNetEnabled` value the snapshot loader
   * branched on when it projected the configured siblings' interventions —
   * the caller (run_analysis, which owns the outbound PLoT payload) passes
   * the live config read. The scaffold routes its neutral candidates
   * through the SAME projection functions the loader used, so its wire
   * numbers land in the sibling convention in both flag states.
   */
  readonly scaleNetEnabled: boolean;
}

export interface ScaffoldUnconfiguredOutcome {
  readonly options: ReadonlyArray<Record<string, unknown>>;
  readonly scaffolded: readonly ScaffoldedOptionRecord[];
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
): Map<string, number> {
  const neutral = new Map<string, number>();
  const nodes = nodesOf(graph);
  // The SAME evidence map the loader's net-ON sibling projection builds
  // (buildFactorScaleMap over the graph nodes) — only needed when the net
  // is on.
  const scaleById = scaleNetEnabled ? buildFactorScaleMap(nodes) : undefined;
  for (const node of nodes) {
    if (node.kind !== 'factor' || typeof node.id !== 'string') continue;
    const candidates: Dict[] = [];
    const obs = isPlainObject(node.observed_state) ? node.observed_state : undefined;
    if (obs !== undefined) {
      const observedCandidate: Dict = {};
      const value = finiteNum(obs.value);
      const rawValue = finiteNum(obs.raw_value);
      if (value !== undefined) observedCandidate.value = value;
      if (rawValue !== undefined) observedCandidate.raw_value = rawValue;
      if (Object.keys(observedCandidate).length > 0) candidates.push(observedCandidate);
    }
    const prior = isPlainObject(node.prior) ? node.prior : undefined;
    const rangeMin = prior ? finiteNum(prior.range_min) : undefined;
    const rangeMax = prior ? finiteNum(prior.range_max) : undefined;
    if (rangeMin !== undefined && rangeMax !== undefined) {
      candidates.push({ value: (rangeMin + rangeMax) / 2 });
    }
    for (const candidate of candidates) {
      const wire = projectNeutralCandidate(candidate, scaleById?.get(node.id), scaleNetEnabled);
      if (wire !== undefined) {
        neutral.set(node.id, wire);
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
      const connected = (edgeTargets.get(optionId) ?? []).filter((f) => neutral.has(f));
      const targets = connected.length > 0 ? connected : comparisonBasis;
      if (targets.length === 0) return opt; // nothing safe → honest 422 recovery
      const interventions: Record<string, number> = {};
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
  } catch {
    // TOTAL: fail-safe is today's behaviour (the run blocks; nothing is
    // half-scaffolded, nothing undisclosed reaches PLoT).
    return untouched;
  }
}
