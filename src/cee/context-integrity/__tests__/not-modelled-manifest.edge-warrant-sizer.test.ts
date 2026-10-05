/**
 * ⭐ PR-U2a (MC P0 F5): the manifest credits an edge's figure by WHO SIZED IT — `magnitude: 'user_stated'` — never by the
 * link's structural `source`. After MC P0 an inferred link (`cee_hypothesis`) the user's own "£1,200 a month" sizes must
 * read `in_model`, or "What I was given" contradicts the turn that tells the user the figure is theirs.
 *
 * Fixture: MC's served T1b probe, draw 2 (CEE 147c663; provenance inside). Every row edits ONE field of the served
 * £1,200 edge and reads the item at its own `char_offset`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/served-t1b-draw2.json", import.meta.url)), "utf8"),
) as { brief_text: string; graph: Graph };
const MRR = "monthly_recurring_revenue";
const AT_1200 = 309;
const fresh = (): Graph => JSON.parse(JSON.stringify(FIXTURE.graph)) as Graph;
const priceEdge = (g: Graph) => {
  const e = g.edges.find((x) => x.from === "price_increase" && x.to === MRR);
  if (!e) throw new Error("served fixture lost the price → MRR edge");
  return e as { provenance: Record<string, unknown> };
};
const at = (brief: string, g: Graph, offset: number, literal: string) => {
  const item = (deriveNotModelledManifest(brief, g).quantities?.items ?? []).find((i) => i.char_offset === offset);
  expect(item?.literal, `no ${literal} at ${offset}`).toBe(literal);
  return { verdict: item!.verdict, matched: item!.matched_node_id };
};

describe("PR-U2a: an edge figure is the user's when the USER sized it, whatever the link's source", () => {
  it("PRECONDITION: served draw 2 — the £1,200 edge is brief_extraction + olumi_estimate, quote-less; £1,200 is written once", () => {
    const p = priceEdge(fresh()).provenance;
    expect(p).toMatchObject({ source: "brief_extraction", magnitude: "olumi_estimate" });
    expect(p.natural_effect).toMatchObject({ amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" });
    expect(Object.hasOwn(p, "quote")).toBe(false);
    expect(FIXTURE.brief_text.slice(AT_1200, AT_1200 + 6)).toBe("£1,200");
    expect(FIXTURE.brief_text.indexOf("£1,200", AT_1200 + 1)).toBe(-1);
  });

  it("served as-is: Olumi's own estimate of the size is never the user's figure (absent, as served)", () => {
    expect(at(FIXTURE.brief_text, fresh(), AT_1200, "£1,200").verdict).toBe("absent");
  });

  it("F5, the post-P0 shape: an INFERRED link the user's figure sizes reads in_model", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "user_stated" });
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200")).toEqual({ verdict: "in_model", matched: MRR });
  });

  it("CONTRAST: the same inferred link sized by Olumi is not credited", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "olumi_estimate" });
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200").verdict).toBe("absent");
  });

  // Review Desk class check: the chat-edit writer (`link-effect-edit.ts`, source `user_specified`) is a NEW candidate if
  // the warrant were magnitude alone. A chat size can only COINCIDE with a brief figure, so it never credits one.
  it("a size the user said in CHAT (`user_specified` + `user_stated`) never credits a coinciding brief figure", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "user_specified", magnitude: "user_stated" });
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200").verdict).toBe("absent");
  });

  // Two places, the same unit: nothing says which one the edge holds, so neither is credited (#2601 ruling; a
  // sentence-evidence disambiguator is a Science question for U2 proper). Pinned so a change here is deliberate.
  it("RULED: a figure the brief writes twice in the same unit stays absent (£300 @96/@455, £49 @166/@601)", () => {
    const g = fresh();
    for (const [offset, literal] of [[96, "£300"], [455, "£300"], [166, "£49"], [601, "£49"]] as const) {
      expect(at(FIXTURE.brief_text, g, offset, literal).verdict, `${literal}@${offset}`).toBe("absent");
    }
  });
});
