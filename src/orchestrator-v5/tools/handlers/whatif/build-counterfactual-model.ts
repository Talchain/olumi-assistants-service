/**
 * FAITHFUL-OR-NULL graph → counterfactual structural-model builder.
 *
 * The ISL counterfactual endpoint requires a structural causal model
 * (`variables`, algebraic `equations`, exogenous `distributions`) plus an
 * `intervention`, an `outcome`, and optional observed `context`. This module
 * builds that request from a GraphV3 the CEE side already holds — using ONLY
 * numeric fields the graph actually carries, and returning `null` the instant
 * it would have to INVENT one. Nothing here defaults, rounds, widens, or
 * synthesises a value: a graph that cannot be represented faithfully yields no
 * request, and the lens then emits nothing.
 *
 * ## The faithful reading (documented so review can weigh each choice)
 *
 * GraphV3 declares the exact parametric fields a linear structural model needs:
 *   - `edge.strength.mean` — "Signed linear coefficient [-1, +1]" (schema doc).
 *   - `node.intercept`     — "Prior mean / base rate for root nodes in ISL
 *                             inference" — used as the additive constant.
 *   - `node.observed_state.value` — the node's current value.
 * So each endogenous (has-incoming-edge) node V becomes
 *   `V = intercept_V + Σ strength.mean · parent`  (intercept defaults to the
 * neutral 0 — the standard no-offset linear form, not an invented value).
 *
 * Every EXOGENOUS root is PINNED at its observed value via `context`, with a
 * matching degenerate `uniform{min:v,max:v}` distribution. This is deliberate:
 * pinning the exogenous noise is full-context abduction, whose confidence
 * interval is CORRECTLY degenerate (lower == upper) — the ISL honesty caveat
 * says do NOT widen it. Pinning at observed values also means the ONLY
 * distribution shape emitted is the degenerate uniform, so we never depend on
 * ISL's sampled-distribution parameter conventions.
 *
 * The intervention variable (the selected factor) is NEVER placed in `context`
 * — that overlap is exactly the do∩observe case ISL rejects with 422. It is set
 * only via `intervention`, at a graph-provided target put onto the MODEL scale
 * (`observed_state.cap` ÷ the factor's frame, else the `value` a distinct
 * `baseline` reveals to be the PROPOSED level); when neither exists, or when
 * the frame needed to reconcile a from-to pair cannot be resolved, the builder
 * returns `null` rather than invent a target. See {@link pickInterventionTarget}
 * — its previous reading was inverted AND ~100x out of scale, and the wire
 * carried the error silently because ISL computes on whatever it is given.
 *
 * ## Fidelity boundary (reported to A1)
 *
 * Whether ISL's evaluator agrees with this linear reading end-to-end is NOT
 * verifiable from CEE (the direct-ISL transport is dark on staging). This
 * builder is faithful to the GRAPH's declared semantics; a live ISL probe must
 * confirm the READING before the lens is enabled. Variable/equation safety is
 * matched to the ISL producer's validators
 * (`IDENTIFIER_PATTERN`, `SAFE_EQUATION_PATTERN`).
 */

import { GraphV3, type NodeV3T } from '../../../../schemas/cee-v3.js';
// The estate's ONE owner of "what frame is this factor on?" (a leaf module),
// and the reader that already answers "where is this factor today" for the
// no-op validator. Consulted, never re-derived — two consumers holding private
// opinions about one shared field is the defect this module was fixed for.
import { resolveScaleFrame } from '../d1-shared/scale-frame.js';
import { levelsAreIdentical, readFactorBaselineLevel } from '../../../../validators/option-no-op.js';
import type { CounterfactualProbe } from './select-counterfactual-probe.js';
import type { CounterfactualRequestBody, CounterfactualStructuralModel } from '../../../../adapters/isl/counterfactual-client.js';

/** Node kinds that participate in the causal factor → goal structural model.
 *  Option / decision nodes are connectivity scaffolding, not causal variables. */
const SCM_NODE_KINDS = new Set(['goal', 'factor', 'outcome', 'risk', 'action']);

/**
 * Display metadata the card composer needs, resolved here (where the graph is
 * already parsed) so the lens never re-parses. All fields are graph-verbatim.
 */
export interface CounterfactualModelMeta {
  readonly goalLabel: string;
  readonly factorLabel: string;
  readonly factorUnit: string | null;
  /** MODEL units — the scale `interventionValue` is compared against. */
  readonly factorCurrentValue: number;
  /** MODEL units — what ISL was asked to set, and the raise/lower comparand. */
  readonly interventionValue: number;
  /**
   * USER-SCALE magnitude — what the card displays. Separate from
   * `interventionValue` because `formatFactorValue` formats raw values and
   * returns `null` for a bare sub-1 decimal; see {@link InterventionTarget}.
   */
  readonly interventionDisplayValue: number;
}

export interface BuiltCounterfactualModel {
  readonly request: CounterfactualRequestBody;
  readonly meta: CounterfactualModelMeta;
}

/**
 * Build a faithful counterfactual request from the per-turn graph + the
 * selected probe, or `null` when the graph cannot be represented without
 * inventing a value.
 */
export function buildCounterfactualModel(
  graphForTurn: unknown,
  probe: CounterfactualProbe,
): BuiltCounterfactualModel | null {
  const parsed = GraphV3.safeParse(graphForTurn);
  if (!parsed.success) return null;
  const graph = parsed.data;

  // --- candidate nodes: the causal factor→goal subgraph ---------------------
  const candidateNodes = graph.nodes.filter((n) => SCM_NODE_KINDS.has(n.kind));
  if (candidateNodes.length === 0) return null;

  // Exactly one goal node — the outcome variable must be unambiguous.
  const goals = candidateNodes.filter((n) => n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goalNode = goals[0]!;

  const nodeById = new Map<string, NodeV3T>();
  for (const n of candidateNodes) nodeById.set(n.id, n);

  // Probe factor must be a candidate node with a finite current value.
  const probeNode = nodeById.get(probe.factor_id);
  if (!probeNode || !isFiniteValue(probeNode.observed_state?.value)) return null;

  // --- safe-name bijection (ISL IDENTIFIER_PATTERN) -------------------------
  const idToVar = buildSafeNameMap(candidateNodes);
  if (idToVar === null) return null; // collision — never conflate two variables

  // --- candidate directed edges (exclude bidirected trust annotations) ------
  const incoming = new Map<string, Array<{ from: string; coeff: number }>>();
  let edgeCount = 0;
  for (const e of graph.edges) {
    if (e.edge_type === 'bidirected') continue;
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    if (e.from === e.to) continue;
    const coeff = e.strength?.mean;
    if (typeof coeff !== 'number' || !Number.isFinite(coeff)) return null;
    const list = incoming.get(e.to) ?? [];
    list.push({ from: e.from, coeff });
    incoming.set(e.to, list);
    edgeCount += 1;
  }
  if (edgeCount === 0) return null; // no causal structure to reason over

  // --- roots (exogenous) vs endogenous --------------------------------------
  const roots = candidateNodes.filter((n) => !incoming.has(n.id));
  // The goal must be endogenous — a graph whose goal has no drivers has no
  // counterfactual to compute.
  if (!incoming.has(goalNode.id)) return null;

  // --- intervention target (graph-provided, put onto the MODEL scale) -------
  const target = pickInterventionTarget(probeNode);
  if (target === null) return null;
  const interventionValue = target.model;

  // --- equations for endogenous nodes ---------------------------------------
  const equations: Record<string, string> = {};
  for (const node of candidateNodes) {
    const parents = incoming.get(node.id);
    if (!parents || parents.length === 0) continue; // root — no equation
    const intercept = isFiniteValue(node.intercept) ? node.intercept! : 0;
    const interceptStr = formatNumber(intercept);
    if (interceptStr === null) return null;
    const terms: string[] = [interceptStr];
    for (const p of parents) {
      const coeffStr = formatNumber(p.coeff);
      if (coeffStr === null) return null;
      const parentVar = idToVar.get(p.from);
      if (!parentVar) return null;
      terms.push(`${coeffStr} * ${parentVar}`);
    }
    const selfVar = idToVar.get(node.id);
    if (!selfVar) return null;
    equations[selfVar] = terms.join(' + ');
  }
  if (Object.keys(equations).length === 0) return null;

  // --- distributions + context (pin exogenous roots at observed values) -----
  const distributions: Record<
    string,
    { type: 'uniform'; parameters: { min: number; max: number } }
  > = {};
  const context: Record<string, number> = {};
  for (const root of roots) {
    const rootVar = idToVar.get(root.id);
    if (!rootVar) return null;
    const isInterventionVar = root.id === probe.factor_id;
    const rootValue = isInterventionVar ? interventionValue : root.observed_state?.value;
    if (!isFiniteValue(rootValue)) return null; // cannot pin faithfully
    // Degenerate distribution: the exogenous variable sits at exactly `value`.
    distributions[rootVar] = { type: 'uniform', parameters: { min: rootValue!, max: rootValue! } };
    // Pin every root EXCEPT the intervention variable (do∩observe → 422).
    if (!isInterventionVar) {
      context[rootVar] = rootValue!;
    }
  }
  // ISL requires a distribution for every exogenous variable it must resolve.
  // If the probe factor is endogenous (not a root) it has an equation the
  // intervention overrides; if it is a root it was handled in the loop above.
  if (Object.keys(distributions).length === 0) return null;

  const probeVar = idToVar.get(probe.factor_id)!;
  const outcomeVar = idToVar.get(goalNode.id)!;

  const model: CounterfactualStructuralModel = {
    variables: candidateNodes.map((n) => idToVar.get(n.id)!),
    equations,
    distributions,
  };

  const request: CounterfactualRequestBody = {
    model,
    intervention: { [probeVar]: interventionValue },
    outcome: outcomeVar,
    context: Object.keys(context).length > 0 ? context : undefined,
  };

  const meta: CounterfactualModelMeta = {
    goalLabel: goalNode.label,
    factorLabel: probeNode.label,
    factorUnit: probeNode.observed_state?.unit ?? null,
    // NOT `observed_state.value`: in a from-to graph that field holds the
    // PROPOSED level, so reading it as "current" made the card's raise/lower
    // word compare the target against itself.
    factorCurrentValue: target.current,
    interventionValue,
    interventionDisplayValue: target.raw,
  };

  return { request, meta };
}

/**
 * The intervention target, in BOTH of the scales its two consumers need.
 *
 * ⚠ TWO QUESTIONS WERE LIVING UNDER ONE NAME (trap 21), AND THAT IS WHY THE
 * DEFECT LOOKED CORRECT ON SCREEN. A single `interventionValue` was serving:
 *   · the ISL `intervention` and the raise/lower comparison — MODEL units, the
 *     scale every other variable in the request is pinned in; and
 *   · `formatFactorValue`, which formats the USER-SCALE magnitude and returns
 *     `null` for a bare sub-1 decimal (`compose/format-factor-value.ts`).
 * A raw target satisfied the display question and violated the model one, so
 * the card read "£49" while the wire carried a variable ~100x off its own
 * equations. They are named apart here rather than reconciled.
 */
interface InterventionTarget {
  /** On `observed_state.value`'s scale — what ISL is asked to set. */
  readonly model: number;
  /** The user-scale magnitude — what the card displays. */
  readonly raw: number;
  /** The level the factor is at TODAY, on the same scale as `model`. */
  readonly current: number;
}

/**
 * The intervention target from the factor's own graph fields.
 *
 * ⚠⚠ THIS FUNCTION'S HEADER PREVIOUSLY READ: *"the model-unit intervention
 * target … `cap` first, then a `baseline` that differs from the current value;
 * both are model-unit values already in the graph."* IT WAS WRONG TWICE, and
 * the correction is recorded in place rather than tidied away (trap 14).
 *
 *  1. SEMANTICS. `baseline` is *"Baseline/original value (e.g., \"from X to
 *     Y\" → baseline is X)"* (`schemas/graph.ts:158`) — the level the factor is
 *     at TODAY, i.e. the FROM. Returning it as the intervention asked ISL what
 *     would happen if the factor were where it already is. `value` is the field
 *     that holds the proposed level in a from-to graph — its own contract calls
 *     it *"Current or proposed value"* (`schemas/cee-v3.ts:53`), which is the
 *     same two-questions-under-one-name defect one level down.
 *
 *  2. SCALE. `baseline` and `cap` are RAW. The contract's own examples are the
 *     from-to `X` (49, for "from £49 to £59") and *"\"up to £500k\" → cap is
 *     500000"* (`schemas/graph.ts:162`), while `value` is *"The factor's
 *     current position on the model 0-1 scale"* (`schemas/graph.ts:263`).
 *     "Both are model-unit values already in the graph" was false of both.
 *
 * ── NO FOURTH OPINION ABOUT EITHER QUESTION ───────────────────────────────
 * The divisor comes from `resolveScaleFrame`, the estate's ONE owner of "what
 * frame is this factor on?", and the current level from
 * `readFactorBaselineLevel`, the estate's reader for "where is this factor
 * today" — the sibling that already reads this same field correctly. Neither is
 * re-derived here; a private copy of either is the hand-maintained mirror of
 * trap 12, and a second reader disagreeing with the first is how this defect
 * existed at all.
 *
 * ── WHY THE BASELINE BRANCH NEEDS A FRAME AND THE CAP BRANCH DOES NOT ──────
 * `cap` is ONE number on one scale: the scale-frame doctrine gives an exact
 * rule for putting it on `value`'s scale — divide by the frame, or take it
 * verbatim when the factor is unframed, where raw IS the model scale (counts,
 * ratios, unbounded scales — "today's behaviour … which is CORRECT and is
 * pinned", `d1-shared/scale-frame.ts`).
 *
 * A from-to is TWO numbers written by DIFFERENT passes — the extractor writes
 * the pair raw, and the records projector reframes `value` ALONE — so only the
 * divisor can say whether `{value: 0.59, baseline: 49}` is a framed pair
 * (current 0.49) or an unframed one (current 49). Those two are
 * indistinguishable on the evidence, and guessing is exactly the invention this
 * module refuses. Without a frame it returns `null`: the lens emits nothing and
 * the base flip answer is byte-preserved.
 */
function pickInterventionTarget(node: NodeV3T): InterventionTarget | null {
  const os = node.observed_state;
  if (!os || !isFiniteValue(os.value)) return null;

  const frame = resolveScaleFrame({
    storedFrame: node.scale_frame,
    value: os.value,
    raw_value: os.raw_value,
  });

  // Whether `baseline` states something `value` does not. Spelled with the
  // sibling reader's OWN predicate (`baseline === value` on the raw pair,
  // `option-no-op.ts`) so the two cannot disagree about when a baseline speaks.
  const statesDistinctBaseline = isFiniteValue(os.baseline) && os.baseline !== os.value;
  if (statesDistinctBaseline && frame === undefined) return null;

  // The level the factor is at today, already put on `value`'s frame by the
  // shared reader. Guarded above so this is only consulted where it can answer
  // on the model scale.
  //
  // NO CAST: `NodeV3T` (cee-v3) is structurally assignable to the reader's
  // `NodeT` (graph). Measured, not assumed — an earlier version of this line
  // carried an `as unknown as NodeT` double cast that was never needed, and the
  // forbidden-boundary ratchet was right to reject it.
  //
  // Note which limb of the reader is live here: it consults `observed_state`
  // {value, raw_value, baseline} and `scale_frame`, both declared on `NodeV3`.
  // Its `node.data` fallback is INERT on this path — `NodeV3` declares no
  // `data` and is a plain `z.object`, so `GraphV3.safeParse` has already
  // stripped that key by the time we hold the node (proven by execution with a
  // contrast control: the declared `observed_state` survives, `data` does not).
  const current = readFactorBaselineLevel(node);
  if (current === undefined || !Number.isFinite(current)) return null;

  // 1. A declared ceiling, put on the model scale.
  if (isFiniteValue(os.cap)) {
    const capModel = frame === undefined ? os.cap! : os.cap! / frame;
    if (Number.isFinite(capModel) && !levelsAreIdentical(capModel, current)) {
      return { model: capModel, raw: os.cap!, current };
    }
  }

  // 2. A distinct `baseline` means `value` holds the PROPOSED level, so `value`
  //    IS the target — and it is already model-unit, needing no conversion.
  if (statesDistinctBaseline && !levelsAreIdentical(os.value, current)) {
    // `raw_value` verbatim where the graph carries it. It is absent only when
    // the frame came from a stored `scale_frame` (a recovered frame IS
    // raw_value/value, so it cannot be missing there), and `value * frame` is
    // then the user magnitude by the definition of the frame — arithmetic over
    // two graph fields, not an invented number.
    const raw = isFiniteValue(os.raw_value) ? os.raw_value! : os.value * frame!;
    if (!Number.isFinite(raw)) return null;
    return { model: os.value, raw, current };
  }

  return null;
}

/** Sanitise every candidate node id to an ISL-valid identifier, preserving a
 *  bijection. Returns `null` on any collision so two distinct nodes can never
 *  be conflated into one variable. */
function buildSafeNameMap(nodes: readonly NodeV3T[]): Map<string, string> | null {
  const idToVar = new Map<string, string>();
  const used = new Set<string>();
  for (const n of nodes) {
    let safe = n.id.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!/^[a-zA-Z_]/.test(safe)) safe = `v_${safe}`;
    if (used.has(safe)) return null;
    used.add(safe);
    idToVar.set(n.id, safe);
  }
  return idToVar;
}

function isFiniteValue(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Format a finite number as a plain decimal string safe for ISL's
 *  `SAFE_EQUATION_PATTERN` AST evaluator. Returns `null` for non-finite values
 *  or any exponent form (`1e-7`) whose `e` the evaluator could misread. */
function formatNumber(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  if (/[eE]/.test(s)) return null;
  return s;
}
