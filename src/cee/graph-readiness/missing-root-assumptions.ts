/**
 * ⭐ THE QUESTION THIS MODULE ANSWERS — one question, stated before anything
 * else, because this estate's signature defect is two questions under one name:
 *
 *   **"Which ROOT assumption's missing value would most change what this model
 *   can say — and how many others are standing in the same place?"**
 *
 * It is NOT "which factors are empty?" (that question has a wrong answer — see
 * THE DENOMINATOR below), NOT "may analysis run?" (`assessCanonicalAnalysisReadiness`
 * owns that, and this module never blocks it), and NOT "is this model credible
 * enough to quantify?" (a claim-permission question this module deliberately
 * does not answer — it supplies one input to it).
 *
 * ── THE DENOMINATOR, AND WHY IT IS THE WHOLE POINT ─────────────────────────
 * `DIAGNOSIS-LOCKED-2026-09-03.md` withdraws the headline "11 of 13 nodes are
 * empty" in its own words: *literally true and semantically wrong*. Of the
 * founder's 13, eight are outcomes, risks, the goal and the decision —
 * quantities COMPUTED THROUGH the model, which are not supposed to carry an
 * observed baseline. Requiring a user to fill them "would turn strategic
 * reasoning into data entry, which is the opposite of what this product is
 * for."
 *
 * Exactly THREE root factors were unset. So the population here is derived
 * structurally — `kind === 'factor'` AND **no incoming directed edge** — and
 * that predicate reproduces the locked count exactly on the captured model
 * (`__tests__/fixtures/founder-2026-09-03.graph.json`, projected from the
 * founder's own debug bundle). Nothing about outcomes, risks, the goal or the
 * decision reaches this module's output, by construction rather than by a rule
 * someone must remember.
 *
 * ⭐ AND ROOT-NESS ALSO SOLVES A DEFECT NOBODY ASKED IT TO. In the same
 * capture, the user corrected a factor from £80 to £100,000 and the engine
 * reported `sensitivity_score: 0`, `zero_reason: "intervention_override"` —
 * every option overrides that factor, so its baseline cannot move the result.
 * Asking a user for a number that is structurally inert is the futility this
 * lane exists to avoid. Option interventions are carried as `option → factor`
 * EDGES, so such a factor has an incoming edge and is not a root: it is
 * excluded here for free, and for a reason that is derived rather than tuned.
 * (Measured on the capture: both controllable factors carry an incoming edge
 * from all three options; the three unset roots carry none.)
 *
 * ── UNQUANTIFIED, USING THE PREDICATES THAT ALREADY EXIST ──────────────────
 * No new value predicate is minted here (CLAUDE.md trap 12 — derive, never
 * mirror). Both imports below are the estate's existing authorities:
 *
 *   `factorHasExtractedValue`   — "does this factor carry a numeric value at
 *                                  all?", `cee/provenance/factor-value-provenance.ts`
 *   `shouldPreserveModelPrior`  — "is this factor's prior an ESTIMATE rather
 *                                  than an admission of ignorance?",
 *                                  `cee/provenance/unquantified-factor.ts`
 *
 * A factor is UNQUANTIFIED here exactly when it has no value AND no informative
 * prior. The second conjunct is load-bearing and is not decoration: the served
 * prompt teaches the drafting model to encode ignorance as `uniform(0,1)` and
 * a real belief as a narrowed range, so `U(0.45, 1)` is information the user
 * gave us and `U(0, 1)` is not. Both shapes occur in the committed captures —
 * B2 carries one of each — so a version of this module that asked only "has a
 * value?" would demand a number for a factor the model already has a belief
 * about. `shouldPreserveModelPrior` is the estate's existing discriminator for
 * exactly that, and it is imported rather than restated.
 *
 * ⚠ SCOPE OF THE PRIOR READ, stated because it is a real limit: both imported
 * predicates read `node.prior`, `node.observed_state` and `node.data` and
 * nothing else. A prior carried anywhere else is invisible to this module, and
 * that blindness is inherited deliberately — a second reading path here would
 * be the mirror the imports exist to avoid.
 *
 * ── MATERIALITY: EXPECTED ABSOLUTE INFLUENCE ON THE GOAL ───────────────────
 * The sum, over every directed path from the factor to any goal node, of the
 * product of the |edge strengths| along it. Computed exactly and in one pass by
 * backward propagation in reverse topological order:
 *
 *     w(goal) = 1
 *     w(u)    = Σ over out-edges (u → v) of |strength(u → v)| · w(v)
 *
 * WHY ABSOLUTE. A risk edge is negative by construction, and a signed sum
 * would let a negative branch CANCEL a positive one — so a factor with two
 * strong opposing routes to the goal would score near zero and never be asked
 * about, precisely because it matters a lot. The same signed/absolute confusion
 * is the measured cause of `detectStrengthClustering` never firing
 * (`DIAGNOSIS-LOCKED` finding E: true CV 0.000 read as 1.549), so it is a
 * defect this estate has already paid for once.
 *
 * WHY NOT `exists_probability`. It is uniform (0.8) across every causal edge in
 * both captured models, so this corpus cannot tell a version that reads it from
 * one that does not — and a factor that no evidence can discriminate is a
 * factor this module has no business asserting. Left out, and named here so the
 * omission is a recorded decision rather than an oversight.
 *
 * ⚠ THE NUMBER IS ORDINAL, AND ONLY WITHIN ONE MODEL. It is a ranking key. It
 * is NOT a percentage, NOT comparable between graphs, and must never be shown
 * to a user or quoted as a quantity. The consumer uses the ORDER.
 *
 * ── FAIL-CLOSED, EVERYWHERE ────────────────────────────────────────────────
 * No goal node, a cycle, a malformed input, or an unreadable strength all
 * produce an EMPTY result — never a guess. An empty result means "say nothing",
 * which is exactly the pre-existing behaviour, so every failure direction costs
 * coverage and never truth.
 */

import { isDirectedEdge } from "../../schemas/graph.js";
import { buildDirectedForwardAdjacency, type ReachabilityEdge } from "../../graph/reachability.js";
import { factorHasExtractedValue } from "../provenance/factor-value-provenance.js";
import { shouldPreserveModelPrior } from "../provenance/unquantified-factor.js";

/** One unquantified root factor, with its ranking key. */
export interface MissingRootAssumption {
  readonly factor_id: string;
  readonly factor_label: string;
  /**
   * Expected absolute influence on the goal layer. ORDINAL, within this model
   * only. Always `> 0` — a root that cannot reach a goal is not ranked.
   */
  readonly materiality: number;
}

/**
 * ⚠ TWO COUNTS, NAMED APART ON PURPOSE (CLAUDE.md trap 21). `ranked` is what
 * may be ASKED about; `unreachable_count` is what exists but cannot move the
 * answer. A single "how many gaps?" number would have to pick one meaning and
 * would be wrong for the other reader.
 */
export interface MissingRootAssumptions {
  /**
   * Unquantified root factors that can reach a goal, most material first.
   * Ties break by `factor_id` ascending, so the ORDER IS TOTAL AND STABLE.
   *
   * ⚠⚠ AND THAT IS THE ONLY THING THE TIE-BREAK GUARANTEES. An earlier version
   * of this comment said it was "DELIBERATELY not by label", which reads as a
   * label-independence guarantee and is FALSE on the population that actually
   * ties. Production factor ids are LABEL SLUGS —
   * `factor-extraction/index.ts`'s `generateFactorId` builds
   * `factor_${label.toLowerCase().replace(/[^a-z0-9]+/g,'_').substring(0,20)}_${index}`
   * — so on enrichment-added factors `factor_id` order IS label order in the
   * ordinary case. (It diverges only where the slug truncates at 20 characters
   * or the numeric suffix sorts lexically, e.g. `_10` before `_2`.)
   *
   * The true and narrow statement: this module reads the `id` FIELD and never
   * the `label` FIELD, which is what keeps it out of the contradiction
   * `DIAGNOSIS-LOCKED` addendum B records — a live pair of tests in this estate
   * that require and forbid alphabetical tie-ranking. It is NOT a claim that
   * the resulting order is uncorrelated with the label.
   *
   * ⭐ WHY THAT NOW COSTS NOTHING. A tie-break is only dangerous while a
   * consumer reads it as a materiality VERDICT. It is not one, and since
   * `orchestrator-v5/handlers/draft-calibration-blocks.ts` stopped asserting
   * "matters most" on an exact tie, no consumer treats it as one: `ranked[0]`
   * on a tie means "the one we ask about first", nothing more.
   */
  readonly ranked: readonly MissingRootAssumption[];
  /**
   * Unquantified root factors that were NOT ranked because their materiality
   * came out at zero.
   *
   * ⚠ TWO CAUSES, AND THE NAME NAMES ONLY ONE. An earlier version of this
   * comment said "NO directed path to any goal". The classifier is
   * `materiality > 0`, which also catches a factor that HAS a path but whose
   * edges state no strength — an unstated strength contributes nothing, by
   * `readAbsoluteStrength` above. Measured: delete every `strength_mean` from
   * `__tests__/fixtures/founder-2026-09-03.graph.json` and this reads 3, for
   * three roots that all have paths. The suite's `an edge with NO stated
   * strength contributes nothing rather than a default` pins the same thing.
   *
   * Carried, never spoken, and it has NO reader today. A future one must not
   * render it as "N assumptions cannot affect the outcome" — that sentence is
   * false for the second cause. If a consumer needs the two apart they are two
   * questions and must be named apart (CLAUDE.md trap 21), never split out of
   * this one field.
   */
  readonly unreachable_count: number;
}

const EMPTY: MissingRootAssumptions = Object.freeze({
  ranked: Object.freeze([]) as readonly MissingRootAssumption[],
  unreachable_count: 0,
});

interface GraphLike {
  readonly nodes?: unknown;
  readonly edges?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Both edge vocabularies, one reader.
 *
 * `schemas/graph.ts` `EdgeT` carries `strength_mean` (with a deprecated
 * `weight` twin); `schemas/cee-v3.ts` `EdgeV3T` carries `strength: {mean, std}`.
 * `graph/reachability.ts` documents this split as the reason its own parameter
 * names only the three structural fields. Reading all three spellings in ONE
 * place is the alternative to a caller-side cast, and the precedence is the
 * canonical-first order the V4 field comment declares (`strength_mean` is
 * preferred, `weight` is `@deprecated`).
 *
 * Returns `null` — never a default — when no finite strength is stated. A
 * defaulted magnitude here would invent the very information the module is
 * reporting as absent.
 */
function readAbsoluteStrength(edge: Record<string, unknown>): number | null {
  const nested = isRecord(edge.strength) ? edge.strength.mean : undefined;
  for (const candidate of [nested, edge.strength_mean, edge.weight]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Math.abs(candidate);
  }
  return null;
}

interface NormalisedEdge extends ReachabilityEdge {
  readonly absoluteStrength: number | null;
}

function readEdges(raw: unknown): NormalisedEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalisedEdge[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    // `from`/`to` is the internal normal form; `source`/`target` is the API
    // boundary spelling `EdgeInput` also accepts. Both are read so a caller
    // never has to normalise before asking this question.
    const from = readTrimmedString(entry.from) || readTrimmedString(entry.source);
    const to = readTrimmedString(entry.to) || readTrimmedString(entry.target);
    if (from.length === 0 || to.length === 0) continue;
    const edgeType = entry.edge_type;
    out.push({
      from,
      to,
      ...(edgeType === "directed" || edgeType === "bidirected" ? { edge_type: edgeType } : {}),
      absoluteStrength: readAbsoluteStrength(entry),
    });
  }
  return out;
}

/**
 * Reverse topological order over directed edges, or `null` on a cycle.
 *
 * Kahn's algorithm. A cycle is a hard stop rather than a bounded relaxation:
 * on a cyclic model the path sum does not converge to a finite answer, and a
 * truncated one would be a made-up ranking key wearing a computation's clothes.
 */
function reverseTopologicalOrder(
  nodeIds: readonly string[],
  edges: readonly NormalisedEdge[],
): string[] | null {
  const forward = buildDirectedForwardAdjacency(edges);
  const known = new Set(nodeIds);
  const outstandingIncoming = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    outstandingIncoming.set(edge.to, (outstandingIncoming.get(edge.to) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (outstandingIncoming.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of forward.get(current) ?? []) {
      if (!known.has(next)) continue;
      const remaining = (outstandingIncoming.get(next) ?? 0) - 1;
      outstandingIncoming.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (order.length !== nodeIds.length) return null; // cycle
  return order.reverse();
}

/**
 * Derive the ranked unquantified root assumptions for one model.
 *
 * Pure. Never throws. Returns an empty result on every doubt.
 */
export function deriveMissingRootAssumptions(graph: unknown): MissingRootAssumptions {
  if (!isRecord(graph)) return EMPTY;
  const rawNodes = (graph as GraphLike).nodes;
  if (!Array.isArray(rawNodes)) return EMPTY;

  const nodes: Record<string, unknown>[] = [];
  const nodeIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of rawNodes) {
    if (!isRecord(entry)) continue;
    const id = readTrimmedString(entry.id);
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    nodes.push(entry);
    nodeIds.push(id);
  }
  if (nodes.length === 0) return EMPTY;

  const goalIds = new Set(
    nodes.filter((n) => n.kind === "goal").map((n) => readTrimmedString(n.id)),
  );
  // No goal means no "influence on the goal" to rank by. Silence, not a guess.
  if (goalIds.size === 0) return EMPTY;

  const edges = readEdges((graph as GraphLike).edges);

  const order = reverseTopologicalOrder(nodeIds, edges);
  if (order === null) return EMPTY;

  // Out-adjacency carrying the strength, built once. Directed-only, via the
  // estate's single edge-policy predicate.
  const outgoing = new Map<string, { to: string; absoluteStrength: number | null }[]>();
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue;
    if (!seen.has(edge.from) || !seen.has(edge.to)) continue;
    hasIncoming.add(edge.to);
    const list = outgoing.get(edge.from);
    const row = { to: edge.to, absoluteStrength: edge.absoluteStrength };
    if (list) list.push(row);
    else outgoing.set(edge.from, [row]);
  }

  // Backward propagation: w(goal) = 1, w(u) = Σ |s(u→v)| · w(v).
  const influence = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const id of order) {
    if (goalIds.has(id)) {
      influence.set(id, 1);
      continue;
    }
    let total = 0;
    for (const { to, absoluteStrength } of outgoing.get(id) ?? []) {
      // An unstated strength contributes nothing. It is the honest reading:
      // we do not know how much this link carries, so we do not claim it does.
      if (absoluteStrength === null) continue;
      total += absoluteStrength * (influence.get(to) ?? 0);
    }
    influence.set(id, total);
  }

  const ranked: MissingRootAssumption[] = [];
  let unreachable = 0;
  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    const id = readTrimmedString(node.id);
    if (hasIncoming.has(id)) continue; // not a root
    if (factorHasExtractedValue(node)) continue; // already quantified
    if (shouldPreserveModelPrior(node)) continue; // an estimate, not ignorance

    const materiality = influence.get(id) ?? 0;
    if (!(materiality > 0)) {
      unreachable += 1;
      continue;
    }
    ranked.push({
      factor_id: id,
      factor_label: readTrimmedString(node.label),
      materiality,
    });
  }

  ranked.sort((a, b) =>
    b.materiality !== a.materiality
      ? b.materiality - a.materiality
      : a.factor_id.localeCompare(b.factor_id),
  );

  return { ranked, unreachable_count: unreachable };
}
