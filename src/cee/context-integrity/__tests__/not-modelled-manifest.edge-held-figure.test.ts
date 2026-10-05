/**
 * ⭐⭐ A FIGURE HELD IN AN EDGE'S `natural_effect` IS NEVER `absent` — on SERVED bytes (#87 5996437122).
 *
 * The fixture is the AIE coaching lab's served capture (CEE staging b43bb79e, case c1, `graph-read.json`; provenance and
 * sha256 inside it). Served, the manifest called "£75,000 a year" and "£12,000 upfront" `absent`, and the coach told the
 * user those figures "aren't represented" — while two `brief_extraction` / `user_stated` edges held them in
 * `natural_effect`. The cause, proven by replay: the edges carry NO `provenance.quote` (the agent route's admission has
 * no such field), and the edge route required one before matching anything; and the match compared the SIGNED amount
 * (−75000) with the written figure (75000).
 *
 * Every contrast below edits the SAME served bytes in exactly one field, so each row is bound to one identity.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/served-aie-c1-merge-routes.json", import.meta.url)), "utf8"),
) as { brief_text: string; graph: Graph };

const SPENDING = "annual_operating_delivery_spending";
const SCHEDULING = "scheduling_and_training_cost";
const fresh = (): { brief: string; graph: Graph } => ({
  brief: FIXTURE.brief_text,
  graph: JSON.parse(JSON.stringify(FIXTURE.graph)) as Graph,
});
const edgeTo = (g: Graph, to: string) => {
  const e = g.edges.find((x) => x.from === "route_consolidation" && x.to === to);
  if (!e) throw new Error(`served fixture lost its edge → ${to}`);
  return e as { provenance: Record<string, unknown> };
};
const rows = (brief: string, graph: Graph) => {
  const m = deriveNotModelledManifest(brief, graph) as unknown as {
    status: string;
    quantities: { items: { literal: string; verdict: string; matched_node_id: string | null }[] };
  };
  expect(m.status).toBe("derived");
  return new Map(m.quantities.items.map((i) => [i.literal, i]));
};

describe("served c1: a figure held in an edge's natural_effect is in the model", () => {
  it("PRECONDITION: the served edges hold the figures, user_stated, and carry NO quote", () => {
    const { graph } = fresh();
    for (const [to, amount] of [[SPENDING, -75000], [SCHEDULING, 12000]] as const) {
      const p = edgeTo(graph, to).provenance;
      expect(p.magnitude).toBe("user_stated");
      expect(p.source).toBe("brief_extraction");
      expect((p.natural_effect as { amount: number }).amount).toBe(amount);
      expect(Object.hasOwn(p, "quote")).toBe(false);
    }
  });

  it("(a) £75,000 and £12,000 are in_model, each matched to the node its edge sizes", () => {
    const { brief, graph } = fresh();
    const r = rows(brief, graph);
    expect(r.get("£75,000")).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
    expect(r.get("£12,000")).toMatchObject({ verdict: "in_model", matched_node_id: SCHEDULING });
  });

  it("(b) CONTROL: the served verdicts the fix must not touch are unchanged", () => {
    const { brief, graph } = fresh();
    const r = rows(brief, graph);
    expect(r.get("£420,000")).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
    expect(r.get("96%")).toMatchObject({ verdict: "in_model", matched_node_id: "on_time_arrivals" });
    expect(r.get("£60,000")?.verdict).toBe("prose_only");
  });

  it("(c) CONTRAST: a stated figure that NOTHING holds is still `absent` (the scheduling edge's size removed)", () => {
    const { brief, graph } = fresh();
    delete edgeTo(graph, SCHEDULING).provenance.natural_effect;
    expect(rows(brief, graph).get("£12,000")?.verdict).toBe("absent");
  });

  it("(d) CONTRAST: only the USER's size counts — the same amount as Olumi's estimate is not the user's figure", () => {
    const { brief, graph } = fresh();
    edgeTo(graph, SPENDING).provenance.magnitude = "olumi_estimate";
    expect(rows(brief, graph).get("£75,000")?.verdict).toBe("absent");
  });

  // (e) was first written against "100%", and CI at 189a6326 showed that row RED on the BASE code: the served option
  // `merge_routes` really does set `route_consolidation` to 100 % (its intervention, and the factor's own cap), so a
  // stated "100%" legitimately matches it. The guard this row exists for is narrower — a QUOTE-LESS edge's
  // `per_source_change` is the producer's encoding, never a figure the user wrote — so it is pinned on a value no
  // other carrier in the served graph holds (7 %), with that one edge field edited.
  it("(e) CONTRAST: a quote-less edge's per_source_change is never offered as a figure the user stated", () => {
    const { brief, graph } = fresh();
    const effect = edgeTo(graph, SPENDING).provenance.natural_effect as Record<string, unknown>;
    effect.per_source_change = 7;
    effect.per_source_change_unit = "%";
    const r = rows(`${brief} About 7% of rounds overlap today.`, graph);
    expect(r.get("7%"), "the brief's 7% is extracted").toBeDefined();
    expect(r.get("7%")?.verdict).not.toBe("in_model");
    expect(r.get("£75,000")).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
  });

  it("(f) CONTRAST: a quote that IS present must still be the user's words verbatim (unchanged path)", () => {
    const { brief, graph } = fresh();
    edgeTo(graph, SCHEDULING).provenance.quote = "a sentence the user never wrote";
    expect(rows(brief, graph).get("£12,000")?.verdict).toBe("absent");
  });
});
