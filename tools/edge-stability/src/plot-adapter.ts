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

function baselineValue(n: DraftNode): number {
  const d = fdata(n);
  const rv = d.raw_value;
  if (typeof rv === "number") return rv;
  if (typeof rv === "string" && rv.trim() !== "" && Number.isFinite(Number(rv))) return Number(rv);
  return typeof n.observed_state?.value === "number" ? n.observed_state.value : 0;
}

export interface AdaptResult { request: V2RunRequest | null; skipReason?: string; synthNotes: string[]; }

/**
 * Build a V2RunRequest from a CEE draft graph. Returns skipReason when the draft
 * can't form a valid comparison (e.g. <2 options, no goal) — a skip is itself an
 * outcome-instability signal (recorded, not silently dropped).
 */
export function adaptDraftToV2(graph: DraftGraph, seed: string, rule: SynthesisRule = "categorical-and-magnitude-cap"): AdaptResult {
  const notes: string[] = [];
  const nodes = graph.nodes ?? [];
  const decisionIds = new Set(nodes.filter((n) => n.kind === "decision").map((n) => n.id));
  const optionNodes = nodes.filter((n) => n.kind === "option");
  const optionIds = new Set(optionNodes.map((n) => n.id));
  const goal = nodes.find((n) => n.kind === "goal");
  if (!goal) return { request: null, skipReason: "no goal node", synthNotes: notes };
  if (optionNodes.length < 2) return { request: null, skipReason: `<2 options (${optionNodes.length})`, synthNotes: notes };

  const excluded = new Set<string>([...decisionIds, ...optionIds]);
  // graph nodes = everything except decision/option
  const graphNodes = nodes.filter((n) => !excluded.has(n.id)).map((n) => {
    const d = fdata(n);
    const cap = typeof d.cap === "number" && d.cap > 0 ? (d.cap as number) : undefined;
    return {
      id: n.id, kind: n.kind, label: n.label,
      observed_state: { value: baselineValue(n), std: typeof n.observed_state?.std === "number" ? n.observed_state.std : 1.0, ...(cap !== undefined && { cap }) },
    };
  });
  // graph edges = both endpoints retained (drop any touching a decision/option node)
  const graphEdges = (graph.edges ?? []).filter((e) => !excluded.has(e.from) && !excluded.has(e.to)).map((e) => ({
    from: e.from, to: e.to,
    exists_probability: typeof e.exists_probability === "number" ? e.exists_probability : 1,
    strength: { mean: e.strength?.mean ?? 0, std: e.strength?.std ?? 0.1 },
  }));

  // interventions: each option activates the controllable factors it is wired to (option->factor edge)
  const ctrl = new Map(nodes.filter((n) => n.kind === "factor" && cat(n) === "controllable").map((n) => [n.id, n]));
  const optionEdges = (graph.edges ?? []).filter((e) => optionIds.has(e.from) && ctrl.has(e.to));
  const options: V2Option[] = optionNodes.map((opt) => {
    // is_baseline is a top-level option field (data may be null); fall back to nested for older drafts
    const isBaseline = (opt as { is_baseline?: boolean }).is_baseline === true
      || (opt.data as { is_baseline?: boolean } | null)?.is_baseline === true;
    const wired = optionEdges.filter((e) => e.from === opt.id).map((e) => e.to);
    const interventions: Record<string, V2Intervention> = {};
    for (const fid of wired) {
      const f = ctrl.get(fid)!;
      const v = isBaseline ? baselineValue(f) : activeValue(f, rule);
      if (v !== null) interventions[fid] = { value: v, source: "cee_hypothesis" };
    }
    return { id: opt.id, label: opt.label, interventions };
  });

  // A comparison needs >=2 options that differ in their interventions.
  const distinct = new Set(options.map((o) => JSON.stringify(o.interventions)));
  if (distinct.size < 2) {
    notes.push(`only ${distinct.size} distinct intervention bundle(s) across ${options.length} options — options do not differ under the synthesis rule`);
  }

  return { request: { graph: { nodes: graphNodes, edges: graphEdges }, options, goal_node_id: goal.id, seed }, synthNotes: notes };
}
