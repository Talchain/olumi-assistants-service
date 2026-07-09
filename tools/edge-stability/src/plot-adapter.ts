/**
 * Edge-Stability phase 2 — CEE draft graph -> PLoT /v2/run request adapter.
 *
 * The draft (CEE M1 output) does NOT carry explicit per-option interventions —
 * in the product those come from user/scenario state, and PLoT will not
 * synthesize them ("require explicit interventions", src/routes/v2/run.ts). So
 * this adapter synthesizes them from the draft with an explicit, deterministic,
 * DOCUMENTED rule (a Neil-review modelling item), held constant across all draws
 * so any recommended-option flip is attributable to draft variance, not the
 * synthesis.
 *
 * V2 request shape (from src/routes/v2/run.ts:934 + tests/fixtures/c1-categorical-direct.json):
 *   { graph:{nodes:[{id,kind,label,observed_state:{value,std,cap?}}], edges:[{from,to,exists_probability,strength:{mean,std}}]},
 *     options:[{id,label,interventions:{factorId:{value,source}}}], goal_node_id, seed }
 * Options/decision nodes are FILTERED OUT of the graph (they are intervention bundles, not nodes).
 * PLoT expects RAW user-scale intervention values (categorical/encoded verbatim); it normalises
 * internally via observed_state.cap (per src/orchestrator-v5/tools/plot-intervention-scale.ts).
 */

export type SynthesisRule = "categorical-only" | "categorical-and-magnitude-cap";

interface DraftNode { id: string; kind: string; label: string; category?: string; data?: Record<string, unknown>; observed_state?: { value?: number; std?: number }; }
interface DraftEdge { from: string; to: string; exists_probability?: number; strength?: { mean?: number; std?: number }; }
interface DraftGraph { nodes: DraftNode[]; edges: DraftEdge[]; }

export interface V2Intervention { value: number; source: "cee_hypothesis"; }
export interface V2Option { id: string; label: string; interventions: Record<string, V2Intervention>; }
export interface V2RunRequest {
  graph: { nodes: Array<{ id: string; kind: string; label: string; observed_state: { value: number; std: number; cap?: number } }>; edges: Array<{ from: string; to: string; exists_probability: number; strength: { mean: number; std: number } }>; };
  options: V2Option[];
  goal_node_id: string;
  seed: string;
}

const cat = (n: DraftNode): string | undefined => n.category ?? (n.data as { category?: string })?.category;
const fdata = (n: DraftNode): Record<string, unknown> => ((n.data as { data?: Record<string, unknown> })?.data) ?? (n.data as Record<string, unknown>) ?? {};
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Normalise a raw factor value to [0,1] for the factor's own scale.
 *
 * METRIC-VALIDITY MITIGATION: PLoT /v2/run normalisation is REQUEST-LEVEL bimodal —
 * if ALL intervention values are in [0,1] the request is treated as already-normalised
 * (skip); if ANY value > 1 the WHOLE request is normalised via per-factor derived ranges.
 * Across 5 draws of one brief, synthesized values could land on different sides of that
 * gate (one draw has a 150000 budget, another a [0,1] factor) => different regimes =>
 * flip-rate contamination from the GATE, not the graph. So we emit EVERY value in [0,1]
 * (and omit cap), forcing the skip regime uniformly across all draws.
 */
function to01(raw: number, n: DraftNode): number {
  const d = fdata(n);
  const enc = d.encoding_map as Record<string, string> | undefined;
  if (enc && Object.keys(enc).length) {
    const maxk = Math.max(...Object.keys(enc).map(Number).filter(Number.isFinite));
    return maxk > 0 ? clamp01(raw / maxk) : clamp01(raw);
  }
  const cap = d.cap as number | undefined;
  if (typeof cap === "number" && cap > 0) return clamp01(raw / cap);
  return clamp01(raw); // no scale evidence: already-small values pass; anything >1 clamps to 1
}

/** Active (intervention) value for a controllable factor: encoded max for categorical, cap for magnitude. */
function activeValue(n: DraftNode, rule: SynthesisRule): number | null {
  const d = fdata(n);
  const enc = d.encoding_map as Record<string, string> | undefined;
  if (enc && Object.keys(enc).length) {
    // categorical/encoded: the highest encoded key is the "activated" state (baseline is the low key)
    const keys = Object.keys(enc).map(Number).filter((k) => Number.isFinite(k));
    return keys.length ? Math.max(...keys) : null;
  }
  if (rule === "categorical-and-magnitude-cap") {
    const cap = d.cap as number | undefined;
    if (typeof cap === "number" && cap > 0) return cap; // magnitude: cap is the maximal intervention (documented, Neil-review)
  }
  return null; // magnitude under categorical-only rule -> left at baseline (no intervention)
}

/**
 * Read an option's OWN per-option interventions via the live 3-source precedence merge
 * (analysis-ready-helper.ts:76-129): data.interventions FIRST, then slash-keyed, then
 * top-level node.interventions. Handles both array-form [{factor_id, value}] and object-form
 * {factor_id: value} (the model emits object-form; CEE normalisation converts array->object).
 * Returns {} when the draft carries none (→ caller falls back to synthesis).
 */
function readOptionInterventions(opt: DraftNode): Record<string, number> {
  const out: Record<string, number> = {};
  const sources = [
    (opt.data as { interventions?: unknown } | null)?.interventions, // data.interventions (canonical, first)
    (opt as { interventions?: unknown }).interventions,              // top-level node.interventions (last)
  ];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const it of src) {
        const fid = (it as { factor_id?: string }).factor_id; const v = (it as { value?: number }).value;
        if (typeof fid === "string" && typeof v === "number") out[fid] = v;
      }
    } else if (src && typeof src === "object") {
      for (const [fid, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v === "number") out[fid] = v;
        else if (v && typeof v === "object" && typeof (v as { value?: number }).value === "number") out[fid] = (v as { value: number }).value;
      }
    }
    if (Object.keys(out).length) return out; // precedence: first non-empty source wins
  }
  return out;
}

/** The factor's normalised [0,1] value (data.value), for observed_state — consistent with the
 *  draft's own [0,1] intervention convention so every request lands in PLoT's skip regime. */
function normFactorValue(n: DraftNode): number {
  const d = fdata(n);
  if (typeof d.value === "number" && Number.isFinite(d.value)) return clamp01(d.value);
  return to01(baselineValue(n), n);
}

function baselineValue(n: DraftNode): number {
  const d = fdata(n);
  const rv = d.raw_value;
  if (typeof rv === "number") return rv;
  if (typeof rv === "string" && rv.trim() !== "" && Number.isFinite(Number(rv))) return Number(rv);
  return typeof n.observed_state?.value === "number" ? n.observed_state.value : 0;
}

export interface AdaptResult {
  request: V2RunRequest | null; skipReason?: string; synthNotes: string[];
  interventionSource: "draft" | "synthesized" | "none"; // where the option interventions came from
  optionsDifferentiated: boolean; // >=2 distinct intervention bundles (else CEE would IDENTICAL_OPTION_INTERVENTIONS)
  allValuesIn01: boolean; // regime assertion: every intervention + observed_state value is in [0,1]
}

/**
 * Build a V2RunRequest from a CEE draft graph. Returns skipReason when the draft
 * can't form a valid comparison (e.g. <2 options, no goal) — a skip is itself an
 * outcome-instability signal (recorded, not silently dropped).
 */
export function adaptDraftToV2(graph: DraftGraph, seed: string, rule: SynthesisRule = "categorical-and-magnitude-cap", normalise = true): AdaptResult {
  const notes: string[] = [];
  const nodes = graph?.nodes ?? [];
  const decisionIds = new Set(nodes.filter((n) => n.kind === "decision").map((n) => n.id));
  const optionNodes = nodes.filter((n) => n.kind === "option");
  const optionIds = new Set(optionNodes.map((n) => n.id));
  const goal = nodes.find((n) => n.kind === "goal");
  const fail = (skipReason: string): AdaptResult => ({ request: null, skipReason, synthNotes: notes, interventionSource: "none", optionsDifferentiated: false, allValuesIn01: true });
  if (!goal) return fail("no goal node");
  if (optionNodes.length < 2) return fail(`<2 options (${optionNodes.length})`);

  const excluded = new Set<string>([...decisionIds, ...optionIds]);
  // graph nodes = everything except decision/option
  const graphNodes = nodes.filter((n) => !excluded.has(n.id)).map((n) => {
    const d = fdata(n);
    const cap = typeof d.cap === "number" && d.cap > 0 ? (d.cap as number) : undefined;
    const value = normalise ? normFactorValue(n) : baselineValue(n);
    const std = typeof n.observed_state?.std === "number" ? n.observed_state.std : 1.0;
    // In normalise mode omit cap (values are already [0,1]; a cap would re-normalise).
    return {
      id: n.id, kind: n.kind, label: n.label,
      observed_state: { value, std, ...(!normalise && cap !== undefined && { cap }) },
    };
  });
  // graph edges = both endpoints retained (drop any touching a decision/option node)
  const graphEdges = (graph.edges ?? []).filter((e) => !excluded.has(e.from) && !excluded.has(e.to)).map((e) => ({
    from: e.from, to: e.to,
    exists_probability: typeof e.exists_probability === "number" ? e.exists_probability : 1,
    strength: { mean: e.strength?.mean ?? 0, std: e.strength?.std ?? 0.1 },
  }));

  // Prefer the DRAFT's OWN per-option interventions (live grammar). Synthesis is a fallback only
  // for pathological/older draws that carry none. graph-node ids restrict interventions to real factors.
  const graphNodeIds = new Set(graphNodes.map((n) => n.id));
  const ctrl = new Map(nodes.filter((n) => n.kind === "factor" && cat(n) === "controllable").map((n) => [n.id, n]));
  const optionEdges = (graph.edges ?? []).filter((e) => optionIds.has(e.from) && ctrl.has(e.to));
  let drafted = 0, synthesized = 0;
  const options: V2Option[] = optionNodes.map((opt) => {
    const interventions: Record<string, V2Intervention> = {};
    const own = readOptionInterventions(opt);
    const ownFactors = Object.keys(own).filter((fid) => graphNodeIds.has(fid));
    if (ownFactors.length > 0) {
      drafted++;
      for (const fid of ownFactors) interventions[fid] = { value: normalise ? clamp01(own[fid]) : own[fid], source: "cee_hypothesis" };
    } else {
      // fallback: synthesize from option->factor wiring
      synthesized++;
      const isBaseline = (opt as { is_baseline?: boolean }).is_baseline === true || (opt.data as { is_baseline?: boolean } | null)?.is_baseline === true;
      for (const fid of optionEdges.filter((e) => e.from === opt.id).map((e) => e.to)) {
        const f = ctrl.get(fid)!;
        const rawV = isBaseline ? baselineValue(f) : activeValue(f, rule);
        if (rawV !== null) interventions[fid] = { value: normalise ? to01(rawV, f) : rawV, source: "cee_hypothesis" };
      }
    }
    return { id: opt.id, label: opt.label, interventions };
  });

  const interventionSource: AdaptResult["interventionSource"] = drafted > 0 && synthesized === 0 ? "draft" : synthesized > 0 && drafted === 0 ? "synthesized" : drafted > 0 ? "draft" : "synthesized";
  const optionsDifferentiated = new Set(options.map((o) => JSON.stringify(o.interventions))).size >= 2;
  if (!optionsDifferentiated) notes.push(`options NOT differentiated: <2 distinct intervention bundles across ${options.length} options (CEE would fail IDENTICAL_OPTION_INTERVENTIONS)`);
  if (synthesized > 0 && drafted > 0) notes.push(`mixed intervention source: ${drafted} draft, ${synthesized} synthesized`);
  const allValuesIn01 = [...options.flatMap((o) => Object.values(o.interventions).map((i) => i.value)), ...graphNodes.map((n) => n.observed_state.value)].every((v) => v >= 0 && v <= 1);
  if (!allValuesIn01) notes.push("regime WARNING: some value outside [0,1] — request may hit PLoT's normalise-whole-request regime");

  return { request: { graph: { nodes: graphNodes, edges: graphEdges }, options, goal_node_id: goal.id, seed }, synthNotes: notes, interventionSource, optionsDifferentiated, allValuesIn01 };
}
