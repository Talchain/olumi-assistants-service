/**
 * ⭐ RULE (e) (Science GO, 5 Oct; Lead brief, verbatim conditions): OLUMI SETS ITS OWN UNSUPPORTED STRUCTURE ASIDE.
 *
 * Runs in the records compile chain on the NORMALISED projection, BEFORE the shared deterministic sweep (`replay.ts`),
 * so the sweep never builds scaffolding (factor→goal splits, status-quo wiring) around a node the compile withdraws.
 * Identity is the node's own typed origin (`provenance.provenance_class === "ai_inferred"`), never a label.
 *   (e1) An UNQUANTIFIED invented node (no level of its own, no incident edge carrying a sized natural effect, no option
 *        setting bound to the brief) on a path from an option to the goal, where that SAME option already reaches the
 *        SAME goal through edges each carrying a sized natural effect (the user's stated causes, and the definitional
 *        identity onto the goal's quantity), leaves the graph: `superseded_by_stated_path`. An unsized stated path
 *        anywhere sets nothing aside.
 *   (e2) An invented root factor with no level that reaches the goal — exactly the readiness authority's own
 *        MISSING_FACTOR_LEVEL (`assessCanonicalAnalysisReadiness`, read on this graph's V3 projection; no second rule) — is
 *        removed with no Olumi level, disclosed (`invented_root_level_unknown`) and asked about ("What is <label>
 *        today?"), at most INVENTED_ROOT_ASK_CAP asks, ordered by how many option→goal paths it carried; repeated until
 *        no invented root lacks a level. A USER-stated root keeps the gate-2 rule untouched. An option left with no path
 *        is NOT patched here: gate 1 v2 says so.
 * CR-E1: a node carrying ANY stated receipt (`statedCarrierIds`) is user evidence and is never removed by either pass.
 * Every removal carries `restore` (the node, its edges, the option settings on it): adding it back is one step.
 */
import { assessCanonicalAnalysisReadiness } from "../../../orchestrator/tools/analysis-ready-helper.js";
import { projectGraphAndOptionsToV3, transformGraphToV3 } from "../../transforms/schema-v3.js";
import type { V1Graph } from "../../transforms/schema-v2.js";
import type { DroppedRecordRef } from "./projector.js";
import type { StatedDisposition } from "./stated-dispositions.js";

type Rec = Record<string, unknown>;
type Node = { readonly id: string; readonly kind?: unknown; readonly label?: unknown; readonly observed_state?: unknown; readonly data?: unknown; readonly provenance?: unknown };
type Edge = { readonly from: string; readonly to: string; readonly provenance?: unknown };

/** Rule (e2)'s ask, exactly as Science worded it. */
export const inventedRootLevelAsk = (label: string): string => `What is ${label} today?`;
/** Rule (e2): at most this many level asks per turn; the rest are in the disclosure only. */
export const INVENTED_ROOT_ASK_CAP = 3;

const quoted = (labels: readonly string[]): string => {
  const q = labels.map((label) => `"${label}"`);
  return q.length <= 1 ? q.join("") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
};
/**
 * ⭐ ITEM 4 (Science, 5 Oct): THE DISCLOSURE NAMES EVERY SET-ASIDE ITEM, where the user sees it. `not_represented` reaches
 * only the Agent's model; `open_questions` is appended to every reply and listed whole in the UI's disclosure. So each
 * reason's set-aside labels are said in ONE line there, by name, so the user can restate any of them in chat. (The
 * one-step add-back from `restore` is a follow-up; nothing here claims it exists.)
 */
export function setAsideDisclosureLines(disclosures: readonly DroppedRecordRef[]): string[] {
  const named = (reason: DroppedRecordRef["reason"]): string[] => [...new Set(disclosures.filter((d) => d.reason === reason).map((d) => d.label))];
  const superseded = named("superseded_by_stated_path");
  const unlevelled = named("invented_root_level_unknown");
  return [
    ...(superseded.length > 0 ? [`Olumi left out its own ${quoted(superseded)}: your stated figures already link those options to the goal. Name any of them to add it back.`] : []),
    ...(unlevelled.length > 0 ? [`Olumi left out its own ${quoted(unlevelled)}: no current level was given. Name any of them, with its level today, to add it back.`] : []),
  ];
}
const INTERVENTION_FIELDS = ["interventions", "intervention_details", "raw_interventions"] as const;

const rec = (value: unknown): value is Rec => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

/**
 * ⭐ CR-E1 (MC review, 5 Oct; Science (e2) is "ai_inferred roots with NO user evidence"): every node that CARRIES a
 * stated receipt — the node a carried row names, both endpoints of a carried edge (a stated relationship's natural
 * effect), and the factor an option's carried setting is keyed by — is user evidence, so neither (e1) nor (e2) may
 * remove it. Read from the compile's own receipt rows (`deriveStatedDispositions`), by identity, never a label.
 */
export function statedCarrierIds(dispositions: readonly StatedDisposition[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const row of dispositions ?? []) {
    if (row.disposition !== "carried") continue;
    const location = row.location;
    if (location.kind === "edge") { ids.add(location.from); ids.add(location.to); continue; }
    ids.add(location.node_id);
    const [head, field, keyed] = location.path;
    if ((head === "data" && (field === "intervention_details" || field === "interventions" || field === "raw_interventions")) && typeof keyed === "string") ids.add(keyed);
    if (head === "interventions" && typeof field === "string") ids.add(field);
  }
  return ids;
}

export function setAsideInventedStructure<G extends { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] }>(
  graph: G,
  brief?: string,
  /** CR-E1: nodes carrying a stated receipt (`statedCarrierIds`); never removed by either pass. */
  userEvidence: ReadonlySet<string> = new Set(),
): { graph: G; disclosures: DroppedRecordRef[]; asks: string[] } {
  let nodes = [...graph.nodes] as Node[];
  let edges = [...graph.edges] as Edge[];
  const disclosures: DroppedRecordRef[] = [];
  const invented = (node: Node | undefined): boolean => rec(node?.provenance) && node!.provenance.provenance_class === "ai_inferred";
  const sized = (edge: Edge): boolean => rec(edge.provenance) && rec(edge.provenance.natural_effect);
  const settings = (option: Node, field: (typeof INTERVENTION_FIELDS)[number]): Rec | undefined =>
    rec(option.data) && rec(option.data[field]) ? option.data[field] as Rec : undefined;
  const remove = (ids: ReadonlySet<string>, reason: "superseded_by_stated_path" | "invented_root_level_unknown"): void => {
    for (const id of ids) {
      const node = nodes.find((n) => n.id === id)!;
      const interventions = Object.fromEntries(nodes.filter((n) => n.kind === "option").flatMap((n) => {
        const held = Object.fromEntries(INTERVENTION_FIELDS.flatMap((f) => (settings(n, f)?.[id] !== undefined ? [[f, settings(n, f)![id]]] : [])));
        return Object.keys(held).length > 0 ? [[n.id, held]] : [];
      }));
      disclosures.push({ claim_index: -1, claim_kind: String(node.kind), label: String(node.label ?? id), node_id: id, reason,
        restore: { node, edges: edges.filter((e) => e.from === id || e.to === id), interventions } });
    }
    edges = edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
    nodes = nodes.filter((n) => !ids.has(n.id)).map((n) => {
      if (n.kind !== "option" || !rec(n.data) || !INTERVENTION_FIELDS.some((f) => Object.keys(settings(n, f) ?? {}).some((k) => ids.has(k)))) return n;
      const data: Rec = { ...n.data };
      for (const f of INTERVENTION_FIELDS) if (rec(data[f])) data[f] = Object.fromEntries(Object.entries(data[f] as Rec).filter(([k]) => !ids.has(k)));
      return { ...n, data };
    });
  };
  const kindOf = (): Map<string, unknown> => new Map(nodes.map((n) => [n.id, n.kind]));
  const grow = (seed: Iterable<string>, step: (into: Set<string>) => void): Set<string> => {
    const into = new Set(seed);
    for (let size = -1; size !== into.size;) { size = into.size; step(into); }
    return into;
  };
  // ── (e1) ──
  const goals = nodes.filter((n) => n.kind === "goal");
  if (goals.length === 1) {
    const goal = goals[0]!.id;
    const kind = kindOf();
    const causal = edges.filter((e) => kind.get(e.from) !== "decision" && kind.get(e.to) !== "option" && kind.get(e.to) !== "decision");
    const sizedToGoal = grow([goal], (into) => { for (const e of causal) if (sized(e) && into.has(e.to) && kind.get(e.from) !== "option") into.add(e.from); });
    const toGoal = grow([goal], (into) => { for (const e of causal) if (into.has(e.to)) into.add(e.from); });
    const aside = new Set<string>();
    for (const option of nodes.filter((n) => n.kind === "option")) {
      if (!causal.some((e) => e.from === option.id && e.to !== goal && sizedToGoal.has(e.to))) continue;
      const reached = grow([option.id], (into) => { for (const e of causal) if (into.has(e.from) && e.from !== goal) into.add(e.to); });
      for (const node of nodes) {
        if (node.id === goal || !reached.has(node.id) || !toGoal.has(node.id) || !invented(node) || userEvidence.has(node.id)) continue;
        if (["option", "goal", "decision"].includes(String(node.kind))) continue;
        const level = (rec(node.observed_state) && finite(node.observed_state.value)) || (rec(node.data) && finite(node.data.value));
        const evidenced = edges.some((e) => (e.from === node.id || e.to === node.id) && sized(e));
        const statedSetting = nodes.some((n) => n.kind === "option" && rec(settings(n, "intervention_details")?.[node.id])
          && (settings(n, "intervention_details")![node.id] as Rec).source === "brief_extraction");
        if (!level && !evidenced && !statedSetting) aside.add(node.id);
      }
    }
    if (aside.size > 0) remove(aside, "superseded_by_stated_path");
  }
  // ── (e2) ── the readiness authority's MISSING_FACTOR_LEVEL, read on this graph's V3 projection (index-aligned ids).
  const removedRoots: { label: string; paths: number; order: number }[] = [];
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    const v1 = { ...(graph as unknown as V1Graph), nodes, edges } as unknown as V1Graph;
    const v3Ids = (transformGraphToV3(structuredClone(v1)).graph.nodes as Array<{ id: string }>).map((n) => n.id);
    const v1IdOf = new Map(v3Ids.map((id, index) => [id, nodes[index]?.id ?? id]));
    const assessment = assessCanonicalAnalysisReadiness(projectGraphAndOptionsToV3(v1, brief === undefined ? {} : { brief }).graph);
    const ids = new Set(assessment.blockingIssues
      .filter((issue) => issue.code === "MISSING_FACTOR_LEVEL" && issue.option_id === undefined && typeof issue.factor_id === "string")
      .map((issue) => v1IdOf.get(issue.factor_id as string) ?? (issue.factor_id as string))
      .filter((id) => invented(nodes.find((n) => n.id === id)) && !userEvidence.has(id)));
    if (ids.size === 0) break;
    const kind = kindOf();
    const goal = nodes.find((n) => n.kind === "goal")?.id;
    const memo = new Map<string, number>();
    const pathsToGoal = (id: string, seen: ReadonlySet<string>): number => {
      if (id === goal) return 1;
      if (memo.has(id)) return memo.get(id)!;
      if (seen.has(id)) return 0;
      const next = new Set(seen).add(id);
      const count = edges.filter((e) => e.from === id && kind.get(e.to) !== "option" && kind.get(e.to) !== "decision")
        .reduce((sum, e) => sum + pathsToGoal(e.to, next), 0);
      memo.set(id, count);
      return count;
    };
    for (const id of ids) {
      const optionLinks = edges.filter((e) => e.to === id && kind.get(e.from) === "option").length;
      removedRoots.push({ label: String(nodes.find((n) => n.id === id)!.label ?? id), paths: optionLinks * pathsToGoal(id, new Set()), order: removedRoots.length });
    }
    remove(ids, "invented_root_level_unknown");
  }
  const asks = [...removedRoots].sort((a, b) => b.paths - a.paths || a.order - b.order)
    .slice(0, INVENTED_ROOT_ASK_CAP).map((root) => inventedRootLevelAsk(root.label));
  if (disclosures.length === 0) return { graph, disclosures, asks };
  return { graph: { ...graph, nodes, edges }, disclosures, asks };
}
