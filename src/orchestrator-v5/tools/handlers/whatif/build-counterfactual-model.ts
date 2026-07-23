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
 * only via `intervention`, at a graph-provided model-unit target
 * (`observed_state.cap`, else a distinct `baseline`); when neither exists the
 * builder returns `null` rather than invent a target.
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
  readonly factorCurrentValue: number;
  readonly interventionValue: number;
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

  // --- intervention target (model-unit, graph-provided, no conversion) ------
  const interventionValue = pickInterventionTarget(probeNode);
  if (interventionValue === null) return null;

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
    factorCurrentValue: probeNode.observed_state!.value,
    interventionValue,
  };

  return { request, meta };
}

/** The model-unit intervention target from the factor's own graph fields.
 *  `cap` (a declared ceiling) first, then a `baseline` that differs from the
 *  current value; both are model-unit values already in the graph. */
function pickInterventionTarget(node: NodeV3T): number | null {
  const os = node.observed_state;
  if (!os) return null;
  if (isFiniteValue(os.cap) && os.cap !== os.value) return os.cap!;
  if (isFiniteValue(os.baseline) && os.baseline !== os.value) return os.baseline!;
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
