/**
 * ⭐⭐ THE OPTION→FACTOR MAGNITUDE CENSUS — A MEASUREMENT, AND NOTHING ELSE.
 *
 * WHY IT EXISTS. Deployed drafts persist options with `interventions: {}`.
 * Measured on real traffic: 28 of 32 options empty across 8 drafts, 0 of 8
 * fully valued, and one case correlated end to end had six surviving
 * option→factor edges carrying zero magnitudes. Three causes are suspected —
 * an optional `sets_to` in the live grammar (`grammar.ts:434`), a completion
 * pass with no category for a missing magnitude, and two prompt instructions
 * that disagree about whether the model may estimate. NOBODY CAN CURRENTLY SAY
 * WHICH, because no artefact between the model's bytes and the persisted graph
 * is counted. This module is the counter; it is the precondition for choosing
 * between those three, not a fix for any of them.
 *
 * ⚠ IT CHANGES NOTHING. No value is written, no shape is repaired, no branch is
 * taken on its output. If deleting every call site changed a single persisted
 * byte, this module would be misbuilt.
 *
 * ── WHAT IS COUNTED ────────────────────────────────────────────────────────
 *
 * DENOMINATOR (`option_factor_edges`): edges on the graph whose `from` node is
 * kind `option` and whose `to` node is kind `factor`. Every such edge is the
 * survival of exactly one `causal_link` claim (`projector.ts:2881` mints one
 * edge per claim and keys `setsToByEdgeId` by that edge id), so "surviving
 * option→factor edges" and "option→factor claims with a surviving edge" are the
 * same number, which is why the count is taken over edges — a claim that was
 * dropped has no edge, and a claim that survived has exactly one.
 *
 * ⚠ THE DENOMINATOR IS NOT DECORATION. A bare miss count cannot tell "the model
 * stated no magnitudes" from "there were no option→factor claims at all", and
 * those two demand opposite fixes. It is also the only thing that makes THIS
 * MODULE'S OWN BLINDNESS visible: a graph shape it cannot read (no `kind`, no
 * `nodes`/`edges` arrays) reports `option_factor_edges: 0`, which reads as
 * "nothing to measure" rather than as a confident zero-misses.
 *
 * NUMERATOR (`missing_magnitude`): of those edges, the ones whose OPTION node
 * carries no finite numeric magnitude for that EDGE'S TARGET FACTOR, in any of
 * the three carriers the read path consults.
 *
 * PARALLEL EDGES ARE COUNTED ONCE EACH, deliberately. Two option→factor edges
 * for the same pair are two surviving claims and contribute 2 to the
 * denominator; both then agree on presence, because presence is a property of
 * the (option, factor) pair. Counting pairs instead would silently under-report
 * the claim population the brief asks about.
 *
 * ── WHAT "HAS A MAGNITUDE" MEANS, AND WHY IT IS NOT `sets_to` ──────────────
 *
 * `sets_to` is the WIRE field; `interventions` is where it lands and where the
 * analysis reads it (`OptionData.interventions`, `schemas/graph.ts:200`). Only
 * the landed form exists at all four census points — the record set is gone by
 * commit — so the census asks the landed question at every point, which is what
 * makes the four numbers comparable at all. Asking a record-level question at
 * the first two points and a graph-level one at the last two would produce
 * deltas that are artefacts of the question changing, not of a magnitude going
 * missing (trap 21).
 *
 * THE THREE CARRIERS, and why all three: `node.data.interventions` is what the
 * projector writes (`projector.ts:3213`) and what the edit prompt teaches;
 * `node["data/interventions/<fac>"]` is the slash-keyed flat form; top-level
 * `node.interventions` is the canonical persisted OptionV3 location. A census
 * reading only one of them would report a magnitude "lost" at exactly the
 * boundary where `normaliseOptionInterventionContract` moves it between
 * carriers — i.e. it would manufacture the finding it exists to test.
 *
 * PRESENCE IS PRECEDENCE-INVARIANT, which is why this module does not restate
 * the precedence order. `mergeInterventionSources` picks WHICH value wins per
 * factor; the census asks only WHETHER any carrier holds a finite one, and that
 * is the union — equal to the merged key set for every input.
 */

/** Slash-keyed flat intervention entry, e.g. `data/interventions/fac_annual_cost`. */
const SLASH_KEY_RE = /^data\/interventions\/(.+)$/;

/**
 * `v` is object-like in the sense `mergeInterventionSources` uses when it
 * decides whether to walk a carrier: `v && typeof v === 'object'`.
 *
 * ⚠ ARRAYS PASS, DELIBERATELY, and this is not sloppiness — it is agreement.
 * The read path walks `Object.entries` of whatever object it finds, so an
 * `interventions: [5]` yields the factor id `"0"` there. Excluding arrays here
 * would make the census disagree with the read path on a shape the persisted
 * graph can actually hold, and the census's whole value is that it answers the
 * same presence question the consumer does.
 */
function isObjectLike(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Finite-numeric acceptance for ONE intervention entry: a bare finite number,
 * or an `InterventionV3`-shaped object with a finite numeric `.value`.
 *
 * ⚠ A DELIBERATE COPY of `extractNumericIntervention`
 * (`src/orchestrator/tools/analysis-ready-helper.ts:199`), NOT an import. That
 * module's package already imports THIS one
 * (`orchestrator-v5/handlers/draft-graph-dispatch.ts` → `cee/draft/records`),
 * so importing it back would close a package-level cycle on the draft adapter's
 * boot path — a real runtime hazard bought for a four-line predicate, in a
 * change whose entire promise is that it alters no behaviour.
 *
 * ⚠ THE COPY IS NOT UNGUARDED, because a copy nobody checks is exactly the
 * hand-maintained mirror this estate keeps paying for (trap 12). Deriving a
 * guard from the copy would only prove the copy agrees with itself, so the
 * guard is sourced from the OTHER side: `__tests__/option-magnitude-census
 * .test.ts` builds the cross-product of every carrier × every value shape and
 * asserts this module's factor-id set equals `Object.keys(
 * mergeInterventionSources(node) ?? {})` on each. A drift in EITHER acceptance
 * rule REDs there.
 */
function hasFiniteMagnitude(v: unknown): boolean {
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as Record<string, unknown>).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return true;
  }
  return false;
}

/**
 * Every factor id for which THIS option node carries a finite numeric
 * magnitude, across all three carriers. Union, not precedence — see the header.
 */
export function interventionFactorIdsWithFiniteMagnitude(node: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  if (!isPlainRecord(node)) return out;

  // Carrier 1 — `node.data.interventions` (what the projector writes).
  const data = node.data;
  if (isObjectLike(data) && isObjectLike(data.interventions)) {
    for (const [factorId, v] of Object.entries(data.interventions)) {
      if (hasFiniteMagnitude(v)) out.add(factorId);
    }
  }

  // Carrier 2 — slash-keyed flat entries `data/interventions/<fac>`.
  for (const [key, v] of Object.entries(node)) {
    const match = SLASH_KEY_RE.exec(key);
    if (match === null) continue;
    if (hasFiniteMagnitude(v)) out.add(match[1]!);
  }

  // Carrier 3 — top-level `node.interventions` (canonical persisted OptionV3).
  if (isObjectLike(node.interventions)) {
    for (const [factorId, v] of Object.entries(node.interventions)) {
      if (hasFiniteMagnitude(v)) out.add(factorId);
    }
  }

  return out;
}

/**
 * The four points the census is taken at, and the ONE place they are named.
 * The emission sites read these constants rather than spelling the strings, so
 * a rename moves every site at once and no site can invent a fifth.
 *
 * ⚠ THE NAMES DESCRIBE THE CHAIN AS IT IS, NOT AS THE STAGE ORDER READS.
 * Projection happens BEFORE the completion pass, not after it: the seam
 * projects pass 1, the completion adds claims, and the merged set is
 * RE-projected. So:
 *   · `before_completion` — the pass-1 projection, the earliest graph-shaped
 *     artefact that exists at all.
 *   · `after_completion`  — the projection the pipeline carries forward once
 *     the completion has been merged, or discarded, or never attempted.
 *   · `after_projection`  — the final projection handed to the rest of the
 *     draft path, after option-framing reconciliation.
 *   · `at_commit`         — the exact bytes written to `scenarios.graph`.
 */
export const OPTION_MAGNITUDE_CENSUS_POINTS = [
  "before_completion",
  "after_completion",
  "after_projection",
  "at_commit",
] as const;

export type OptionMagnitudeCensusPoint = (typeof OPTION_MAGNITUDE_CENSUS_POINTS)[number];

export interface OptionFactorMagnitudeCensus {
  /** DENOMINATOR — surviving option→factor edges on this graph. */
  readonly option_factor_edges: number;
  /** NUMERATOR — of those, the ones with no finite magnitude at the option node. */
  readonly missing_magnitude: number;
}

/**
 * Count the option→factor edges on `graph` and how many lack a magnitude.
 *
 * Total function: any shape it cannot read yields `{0, 0}` rather than a throw.
 * That is required, not lenient — this runs inside a draft that must not be
 * failed by its own instrumentation, and the zero denominator is the honest
 * report of "this instrument saw nothing here" (see the header on blindness).
 *
 * ⚠ `from`/`to` AND `source`/`target` are both read, because `EdgeInput`
 * (`schemas/graph.ts:485`) accepts either and only normalises on parse. At
 * commit the graph is `unknown` and may not have been through that parse, so
 * reading only `from`/`to` would report a confident zero on a `source`/`target`
 * graph — an absence claim produced by not looking.
 */
export function censusOptionFactorMagnitudes(graph: unknown): OptionFactorMagnitudeCensus {
  if (!isPlainRecord(graph)) return { option_factor_edges: 0, missing_magnitude: 0 };
  const rawNodes = graph.nodes;
  const rawEdges = graph.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    return { option_factor_edges: 0, missing_magnitude: 0 };
  }

  const kindById = new Map<string, string>();
  const nodeById = new Map<string, Record<string, unknown>>();
  for (const node of rawNodes as unknown[]) {
    if (!isPlainRecord(node)) continue;
    const id = node.id;
    if (typeof id !== "string" || id.length === 0) continue;
    nodeById.set(id, node);
    if (typeof node.kind === "string") kindById.set(id, node.kind);
  }

  // Per OPTION NODE, not per edge: an option wired to eight factors would
  // otherwise re-walk its carriers eight times.
  const magnitudesByOption = new Map<string, ReadonlySet<string>>();

  let optionFactorEdges = 0;
  let missingMagnitude = 0;
  for (const edge of rawEdges as unknown[]) {
    if (!isPlainRecord(edge)) continue;
    const from =
      typeof edge.from === "string" ? edge.from : typeof edge.source === "string" ? edge.source : undefined;
    const to =
      typeof edge.to === "string" ? edge.to : typeof edge.target === "string" ? edge.target : undefined;
    if (from === undefined || to === undefined) continue;
    if (kindById.get(from) !== "option") continue;
    if (kindById.get(to) !== "factor") continue;

    optionFactorEdges += 1;
    let carried = magnitudesByOption.get(from);
    if (carried === undefined) {
      carried = interventionFactorIdsWithFiniteMagnitude(nodeById.get(from));
      magnitudesByOption.set(from, carried);
    }
    if (!carried.has(to)) missingMagnitude += 1;
  }

  return { option_factor_edges: optionFactorEdges, missing_magnitude: missingMagnitude };
}
