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
import { composeBriefAuditAnswer } from "../brief-audit-answer.js";

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
type Item = { literal: string; char_offset: number; verdict: string; matched_node_id: string | null };
const manifestOf = (brief: string, graph: Graph) => {
  const m = deriveNotModelledManifest(brief, graph);
  expect(m.status).toBe("derived");
  return m;
};
const rows = (brief: string, graph: Graph) => {
  const items = (manifestOf(brief, graph).quantities?.items ?? []) as Item[];
  // Addressed by WHERE the user wrote it (Codex r1 on #2601): one literal can occur twice and mean two things.
  return {
    at: (literal: string, offset: number): Item => {
      const item = items.find((i) => i.char_offset === offset);
      expect(item?.literal, `no ${literal} at ${offset}`).toBe(literal);
      return item!;
    },
    find: (literal: string) => items.find((i) => i.literal === literal),
  };
};
// The served brief's own figures, by offset (asserted in PRECONDITION).
const AT = { "£60,000": 121, "£420,000": 240, "96%": 280, "£75,000": 445, "£12,000": 470 } as const;

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
    const { brief } = fresh();
    for (const [literal, offset] of Object.entries(AT)) expect(brief.slice(offset, offset + literal.length)).toBe(literal);
  });

  it("(a) £75,000 and £12,000 are in_model, each matched to the node its edge sizes", () => {
    const { brief, graph } = fresh();
    const r = rows(brief, graph);
    expect(r.at("£75,000", AT["£75,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
    expect(r.at("£12,000", AT["£12,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SCHEDULING });
  });

  it("(b) CONTROL: the served verdicts the fix must not touch are unchanged", () => {
    const { brief, graph } = fresh();
    const r = rows(brief, graph);
    expect(r.at("£420,000", AT["£420,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
    expect(r.at("96%", AT["96%"])).toMatchObject({ verdict: "in_model", matched_node_id: "on_time_arrivals" });
    expect(r.at("£60,000", AT["£60,000"]).verdict).toBe("prose_only");
  });

  it("(c) CONTRAST: a stated figure that NOTHING holds is still `absent` (the scheduling edge's size removed)", () => {
    const { brief, graph } = fresh();
    delete edgeTo(graph, SCHEDULING).provenance.natural_effect;
    expect(rows(brief, graph).at("£12,000", AT["£12,000"]).verdict).toBe("absent");
  });

  it("(d) CONTRAST: only the USER's size counts — the same amount as Olumi's estimate is not the user's figure", () => {
    const { brief, graph } = fresh();
    edgeTo(graph, SPENDING).provenance.magnitude = "olumi_estimate";
    expect(rows(brief, graph).at("£75,000", AT["£75,000"]).verdict).toBe("absent");
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
    expect(r.at("7%", brief.length + 7).verdict).not.toBe("in_model");
    expect(r.at("£75,000", AT["£75,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
  });

  it("(f) CONTRAST: a quote that IS present must still be the user's words verbatim (unchanged path)", () => {
    const { brief, graph } = fresh();
    edgeTo(graph, SCHEDULING).provenance.quote = "a sentence the user never wrote";
    expect(rows(brief, graph).at("£12,000", AT["£12,000"]).verdict).toBe("absent");
  });

  // ── Codex r1 on #2601: without a quote, the edge must bind to ONE written figure, by currency AND period ──

  it("(g) PERIOD PAIR: a monthly figure is not a GBP/year edge's figure; the same edge declared GBP/month is", () => {
    const { brief, graph } = fresh();
    const monthly = brief.replace("£75,000 a year", "£75,000 a month");
    expect(rows(monthly, graph).at("£75,000", AT["£75,000"]).verdict).toBe("absent");
    (edgeTo(graph, SPENDING).provenance.natural_effect as Record<string, unknown>).amount_unit = "GBP/month";
    expect(rows(monthly, graph).at("£75,000", AT["£75,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
  });

  it("(h) OCCURRENCE: an unrelated £75,000 elsewhere is never credited to the edge; two equal candidates credit neither", () => {
    const { brief, graph } = fresh();
    const pension = " Pension contributions are £75,000 a month.";
    const r = rows(brief + pension, graph);
    expect(r.at("£75,000", AT["£75,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
    expect(r.at("£75,000", brief.length + pension.indexOf("£")).verdict).toBe("absent");
    // Same currency AND period twice: nothing says which one the edge holds, so neither is claimed.
    const yearly = " Pension contributions are £75,000 a year.";
    const twice = rows(brief + yearly, graph);
    expect(twice.at("£75,000", AT["£75,000"]).verdict).toBe("absent");
    expect(twice.at("£75,000", brief.length + yearly.indexOf("£")).verdict).toBe("absent");
  });

  it("(i) IDENTITY PAIR: the served upfront £12,000 is credited; an appended annual £12,000 is not", () => {
    const { brief, graph } = fresh();
    const insurance = " Annual insurance is £12,000 a year.";
    const r = rows(brief + insurance, graph);
    expect(r.at("£12,000", AT["£12,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SCHEDULING });
    expect(r.at("£12,000", brief.length + insurance.indexOf("£")).verdict).toBe("absent");
  });

  it("(j) SIGN: a verified quote that writes the sign (−£75,000) still matches the signed edge", () => {
    const { brief, graph } = fresh();
    const sentence = "Each 1% of rounds merged changes delivery spending by -£75,000 a year.";
    const p = edgeTo(graph, SPENDING).provenance;
    p.quote = sentence;
    Object.assign(p.natural_effect as Record<string, unknown>, { per_source_change: 1, per_source_change_unit: "%" });
    const r = rows(`${brief} ${sentence}`, graph);
    const at = brief.length + 1 + sentence.indexOf("-£");
    expect(r.at("-£75,000", at)).toMatchObject({ verdict: "in_model", matched_node_id: SPENDING });
    expect(r.at("1%", brief.length + 1 + sentence.indexOf("1%"))).toMatchObject({ verdict: "in_model", matched_node_id: "route_consolidation" });
  });

  it("(k) DISCLOSURE: crediting an edge's figure never hides Olumi's own estimate on the node it sizes", () => {
    const { brief, graph } = fresh();
    const node = graph.nodes.find((n) => n.id === SCHEDULING) as { observed_state: Record<string, unknown> };
    Object.assign(node.observed_state, { raw_value: 22222, value: 0.22222 });
    const withEffect = manifestOf(brief, graph);
    expect(rows(brief, graph).at("£12,000", AT["£12,000"])).toMatchObject({ verdict: "in_model", matched_node_id: SCHEDULING });
    expect(withEffect.inferred_factors.items.map((i) => i.node_id)).toContain(SCHEDULING);
    delete edgeTo(graph, SCHEDULING).provenance.natural_effect;
    expect(manifestOf(brief, graph).inferred_factors.items).toEqual(withEffect.inferred_factors.items);
  });

  it("(l) THE AUDIT: a figure an edge holds is not listed as one I could not find; the removed one is", () => {
    const heading = "Figures I could not find in the model:";
    const lost = (brief: string, graph: Graph) =>
      (composeBriefAuditAnswer(manifestOf(brief, graph)) ?? "").split("\n\n").find((p) => p.startsWith(heading)) ?? "";
    const { brief, graph } = fresh();
    expect(lost(brief, graph)).not.toContain("£75,000");
    expect(lost(brief, graph)).not.toContain("£12,000");
    delete edgeTo(graph, SCHEDULING).provenance.natural_effect;
    expect(lost(brief, graph)).toContain("£12,000");
  });
});
