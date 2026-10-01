/**
 * 0.71.0 — THE RESIDUAL: every analysis input a Run's input snapshot does NOT record, digested
 * (`RunInputSnapshot.residual_digest`; DL ruling on CEE #2482 5939864517: `complete` means VERIFIED).
 *
 * WHY. A diff of the recorded fields says nothing about the fields it does not record. CODEX overflow on #2482 changed
 * a factor's σ and an encoded goal threshold — neither recorded — and the pair read `input_coverage: 'complete'` with
 * no row. Listing more fields one by one would leave the next one open; this closes the class: two Runs whose residuals
 * are equal were sent the same value for every analysis input outside the snapshot.
 *
 * WHAT IS DIGESTED. The analysis-affecting projection (`analysisAffectingProjection`, the published
 * `CANONICAL_GRAPH_HASH_NESTED_PROJECTION` vocabulary — labels, descriptions and display fields are already out) of the
 * request PLoT received (the wire graph, the wire options, the goal and the limits), plus every other request member
 * except the request id and the seed. Then each field the snapshot RECORDS is removed.
 *
 * ⭐ THE ONE STRIP RULE: a field is removed only when the snapshot recorded EXACTLY its value (same field, same value),
 * so any change to a removed field necessarily changes the snapshot, and the diff either states it as a row or marks
 * the pair partial. A field the snapshot records in another form (a band for a mean, a normalised unit) is NOT
 * removed on that basis alone. Two named exceptions, each argued where it is applied:
 *   - a link's `provenance.source` / `provenance.magnitude` are removed when the snapshot recorded that link's
 *     `sizing`: the class every analysis reader derives from them (`cee/magnitude/link-sizing.ts`, the one module);
 *   - a SENT option's intervention objects on its graph node are removed: PLoT computes on the request's options,
 *     whose numbers the snapshot records per factor (`run-analysis.ts` 3.3 — nothing transforms them before PLoT).
 *
 * Pure.
 */
import { createHash } from 'node:crypto';
import { analysisAffectingProjection } from '../../context/graph-hash.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deterministic JSON: object keys sorted (the same rule `sentDigest` uses). */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isRec(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const sizingIgnoringReview = (s: string): string => (s === 'olumi_accepted' ? 'olumi_estimate' : s);

/** Remove `key` from `obj` only when it holds exactly `recorded` (the one strip rule). */
function stripIfRecorded(obj: Rec, key: string, recorded: unknown): void {
  if (recorded !== undefined && obj[key] === recorded) delete obj[key];
}

/** What the snapshot recorded — only the members the strip rule reads (the builder's own values, before the parse). */
interface Recorded {
  readonly goal: { readonly node_id: string; readonly target_raw?: number; readonly unit?: string; readonly operator?: string; readonly frame?: string; readonly direction?: string } | null;
  readonly options: ReadonlyArray<{
    readonly option_id: string;
    readonly settings: ReadonlyArray<{ readonly factor_id: string; readonly encoded: number; readonly range?: { readonly low?: unknown; readonly high?: unknown; readonly meaning?: unknown } }>;
  }>;
  readonly factors: ReadonlyArray<{ readonly factor_id: string; readonly raw?: number | string; readonly unit?: string; readonly encoded?: number; readonly source?: string }>;
  readonly constraints: ReadonlyArray<{ readonly constraint_id: string; readonly node_id: string; readonly operator: string; readonly raw: number; readonly unit?: string; readonly frame?: string }>;
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string; readonly mean: number; readonly std?: number; readonly exists_probability?: number; readonly sizing?: string }>;
}

/**
 * The residual digest of `plotPayload` given what the snapshot `recorded` from it. `null` when the request carries no
 * graph to project (the snapshot then records no residual, and its pairs are never `complete`).
 */
export function residualDigest(plotPayload: Rec, recorded: Recorded): string | null {
  const graph = isRec(plotPayload.graph) ? plotPayload.graph : null;
  if (graph === null) return null;
  const wireOptions = Array.isArray(plotPayload.options) ? plotPayload.options : [];
  const projection = analysisAffectingProjection({
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
    options: wireOptions,
    goal_node_id: plotPayload.goal_node_id,
    goal_constraints: plotPayload.goal_constraints,
  } as never);
  if (projection === null) return null;

  const goal = recorded.goal;
  const factorById = new Map(recorded.factors.map((f) => [f.factor_id, f]));
  const optionById = new Map(recorded.options.map((o) => [o.option_id, o]));

  // ── nodes: recorded factor fields, the recorded goal fields, and a sent option's graph-side interventions ───────
  const nodes = projection.nodes.map((n) => {
    const out: Rec = { ...n };
    const f = factorById.get(n.id);
    if (f !== undefined && isRec(out.observed_state)) {
      const os: Rec = { ...out.observed_state };
      stripIfRecorded(os, 'value', f.encoded);
      stripIfRecorded(os, 'raw_value', typeof f.raw === 'number' ? f.raw : undefined);
      stripIfRecorded(os, 'unit', f.unit);
      stripIfRecorded(os, 'source', f.source);
      out.observed_state = os;
    }
    if (goal !== null && n.id === goal.node_id) {
      stripIfRecorded(out, 'goal_threshold_raw', goal.target_raw);
      stripIfRecorded(out, 'goal_threshold_unit', goal.unit);
      stripIfRecorded(out, 'goal_direction', goal.operator);
      stripIfRecorded(out, 'goal_threshold_frame', goal.frame);
    }
    // A SENT option's own interventions reach PLoT through the request's options (recorded per factor below); the
    // graph copy is their source object. An option NOT sent keeps them: nothing records its settings.
    if (optionById.has(n.id)) delete out.interventions;
    return out;
  });

  // ── links: the recorded engine numbers, and who sized it when the sizing class was recorded ─────────────────
  const linkByKey = new Map(recorded.links.map((l) => [`${l.from}\u0000${l.to}`, l]));
  const edges = projection.edges.map((e) => {
    const out: Rec = { ...e };
    const l = linkByKey.get(`${e.from}\u0000${e.to}`);
    if (l === undefined) return out;
    if (isRec(out.strength)) {
      const s: Rec = { ...out.strength };
      stripIfRecorded(s, 'mean', l.mean);
      stripIfRecorded(s, 'std', l.std);
      out.strength = s;
    }
    stripIfRecorded(out, 'exists_probability', l.exists_probability);
    // Exception 1 (header): `source`/`magnitude` matter to the analysis only through the sizing CLASS, and the snapshot
    // recorded that class for this link — but only when the wire edge reads as the class recorded (else kept). The
    // review (`reviewed_by_user`) is not an analysis input and not in the projection, so an accepted estimate is
    // compared as an estimate on both sides.
    if (l.sizing !== undefined && isRec(out.provenance) && sizingIgnoringReview(linkSizing({ provenance: out.provenance })) === sizingIgnoringReview(l.sizing)) {
      const p: Rec = { ...out.provenance };
      delete p.source;
      delete p.magnitude;
      out.provenance = p;
    }
    return out;
  });

  // ── the request's options: identity, baseline flag and every recorded setting number ───────────────────────
  const options = wireOptions.filter(isRec).map((opt) => {
    const id = typeof opt.option_id === 'string' && opt.option_id.length > 0 ? opt.option_id : typeof opt.id === 'string' ? opt.id : '';
    const o = optionById.get(id);
    if (o === undefined) return { id, kept: opt };
    const settings = new Map(o.settings.map((s) => [s.factor_id, s]));
    const interventions = isRec(opt.interventions) ? { ...opt.interventions } : {};
    for (const [factorId, v] of Object.entries(interventions)) {
      if (settings.get(factorId)?.encoded === v) delete interventions[factorId];
    }
    const ranges = isRec(opt.intervention_ranges) ? { ...opt.intervention_ranges } : {};
    for (const [factorId, r] of Object.entries(ranges)) {
      const rec = settings.get(factorId)?.range;
      if (rec === undefined || !isRec(r)) continue;
      const rest: Rec = { ...r };
      stripIfRecorded(rest, 'low', rec.low);
      stripIfRecorded(rest, 'high', rec.high);
      stripIfRecorded(rest, 'meaning', rec.meaning);
      ranges[factorId] = rest;
    }
    // The vocabulary's option fields (`id`, `status`, `is_baseline`, conditional `raw_interventions`) minus the
    // recorded identity and baseline flag; label and the rest are not analysis inputs (projection header).
    const projected = projection.options.find((p) => p.id === (typeof opt.id === 'string' ? opt.id : '')) ?? {};
    const { id: _id, is_baseline: _baseline, interventions: _projected, ...vocab } = projected as Rec;
    return { id, vocab, interventions, intervention_ranges: ranges };
  }).sort((a, b) => a.id.localeCompare(b.id));

  // ── limits: each recorded limit's recorded members ──────────────────────────────────────────────────────────
  const recordedLimit = new Map(recorded.constraints.map((c) => [c.constraint_id, c]));
  const goal_constraints = projection.goal_constraints.map((c) => {
    if (!isRec(c)) return c;
    const rc = typeof c.constraint_id === 'string' ? recordedLimit.get(c.constraint_id) : undefined;
    if (rc === undefined) return c;
    const out: Rec = { ...c };
    delete out.constraint_id;
    stripIfRecorded(out, 'node_id', rc.node_id);
    stripIfRecorded(out, 'operator', rc.operator);
    stripIfRecorded(out, 'value', rc.raw);
    stripIfRecorded(out, 'unit', rc.unit);
    stripIfRecorded(out, 'value_frame', rc.frame);
    delete out.label; // a label is never an analysis input (projection header)
    return out;
  });

  // ── every other request member, except the request id and the seed (a pairing matter, C1) ──────────────────
  const { request_id: _r, seed: _s, graph: _g, options: _o, goal_node_id: goalNodeId, goal_constraints: _c, ...extras } = plotPayload;
  const rest: Rec = { ...extras };
  if (goal !== null) stripIfRecorded(rest, 'goal_direction', goal.direction);

  const residual = {
    nodes,
    edges,
    options,
    goal_node_id: goal !== null && goalNodeId === goal.node_id ? null : goalNodeId ?? null,
    goal_constraints,
    run_semantics: projection.run_semantics,
    request: rest,
  };
  return createHash('sha256').update(stableStringify(residual)).digest('hex');
}
