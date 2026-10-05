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
import { buildModelFromBrief, type CallStructuredModel } from "../../../orchestrator-v5/agent-lane/runtime/build-model.js";
import type { InternalDispatch } from "../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js";
import { computeAnalysisAffectingGraphHash } from "../../../orchestrator-v5/context/graph-hash.js";
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from "../../../orchestrator-v5/system-events/link-effect-edit.js";
import { GraphV3 } from "../../../schemas/cee-v3.js";

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

  // ⛔ Codex r1 on #2610, P1: construction's label door stamps `user_stated` when the amount is written about EITHER end,
  // so on an INFERRED link the stamp alone is not the user's size. Without the brief sentence that verifies the whole
  // effect (the Fi receipt below), it is not credited — exactly as on staging before this PR.
  it("P1: a QUOTE-LESS inferred link stamped user_stated is not credited (the stamp alone is not the user's size)", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "user_stated" });
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200").verdict).toBe("absent");
  });

  // MC 5 Oct: the post-P0 Fi-promoted link carries `source_quote` — the exact brief sentence its C2 binding validated.
  const FACTS = "Facts: each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.";
  const AT_1PCT = 290;
  it("F5, the EXACT post-P0 shape (source_quote): the figure binds inside that sentence, and its 1% source is credited too", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "user_stated", source_quote: FACTS });
    expect(FIXTURE.brief_text.indexOf(FACTS)).toBeGreaterThan(0);
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200")).toEqual({ verdict: "in_model", matched: MRR });
    expect(at(FIXTURE.brief_text, g, AT_1PCT, "1%")).toEqual({ verdict: "in_model", matched: "price_increase" });
  });

  it("CONTRAST: a source_quote NOT in the brief (a chat sentence) binds as quote-less: the target by one span, never its source", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "user_specified", magnitude: "user_stated", source_quote: "Each 1% rise adds £1,200 a month." });
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200")).toEqual({ verdict: "in_model", matched: MRR });
    // Not credited as modelled (the chat sentence stored on the edge is commentary text, so the text route may say
    // prose_only — never in_model, and never anchored to the source node).
    expect(at(FIXTURE.brief_text, g, AT_1PCT, "1%")).toMatchObject({ matched: null });
    expect(at(FIXTURE.brief_text, g, AT_1PCT, "1%").verdict).not.toBe("in_model");
  });
  it("CONTRAST (Desk twin): the same chat source_quote with TWO coincident brief spans → neither is credited", () => {
    const g = fresh();
    const e = g.edges.find((x) => x.from === "customer_losses_from_price_rise" && x.to === MRR) as { provenance: Record<string, unknown> };
    Object.assign(e.provenance, { source: "user_specified", magnitude: "user_stated", source_quote: "Each lost customer costs £300 a month." });
    expect(FIXTURE.brief_text.includes(e.provenance.source_quote as string)).toBe(false);
    // The chat sentence stored on the edge is commentary text (prose_only at most): never in_model, never anchored.
    for (const offset of [96, 455]) {
      const item = at(FIXTURE.brief_text, g, offset, "£300");
      expect(item.matched, `£300@${offset}`).toBeNull();
      expect(item.verdict, `£300@${offset}`).not.toBe("in_model");
    }
  });

  it("CONTRAST: the same inferred link sized by Olumi is not credited", () => {
    const g = fresh();
    Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "olumi_estimate" });
    expect(at(FIXTURE.brief_text, g, AT_1200, "£1,200").verdict).toBe("absent");
  });

  // Review Desk class check + Science ruling #87 6003878735 (chat-sized edge CREDITED by the same one-span C3 rule): the chat-edit writer
  // (`link-effect-edit.ts`, source `user_specified`) sizes a link with the figure the user repeats from their brief.
  describe("a size the user said in CHAT (`user_specified` + `user_stated`)", () => {
    const chatSized = (g: Graph) => {
      const e = g.edges.find((x) => x.from === "customer_losses_from_price_rise" && x.to === MRR) as { provenance: Record<string, unknown> };
      Object.assign(e.provenance, { source: "user_specified", magnitude: "user_stated" });
      return g;
    };
    // The brief with ONE "£300 a month" (the price-per-customer clause dropped), so the effect's figure has one place.
    const oneSpan = FIXTURE.brief_text.replace(" from 400 customers paying £300 a month", "");
    const at300 = (brief: string) => brief.indexOf("£300");
    it("credits the ONE brief span stating its amount in its currency and period", () => {
      expect(oneSpan.indexOf("£300", at300(oneSpan) + 1)).toBe(-1);
      expect(at(oneSpan, chatSized(fresh()), at300(oneSpan), "£300")).toEqual({ verdict: "in_model", matched: MRR });
    });
    it("CONTRAST: two brief £300 spans → neither", () => {
      expect(at(FIXTURE.brief_text, chatSized(fresh()), 455, "£300").verdict).toBe("absent");
    });
    it("CONTRAST: a brief \"£300 a year\" conflicts with the chat size's £/month → not credited", () => {
      const yearly = oneSpan.replace("removes £300 a month", "removes £300 a year");
      expect(at(yearly, chatSized(fresh()), at300(yearly), "£300").verdict).toBe("absent");
    });
  });

  // ⛔ Codex r1 on #2610, P2: the chat-edit writer replaces `natural_effect` and KEEPS the rest of the provenance, so a Fi
  // link resized in chat still carries the old sentence. Chained through the REAL writer (`applyLinkEffectEdit`).
  describe("a Fi link the user then RESIZES in chat (Fi → chat edit, the real writer)", () => {
    const FACTS_1500 = " Finance now puts the rise at £1,500 a month.";
    const brief = FIXTURE.brief_text + FACTS_1500;
    const at1500 = brief.indexOf("£1,500");
    const RESIZE = { amount: 1500, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" };
    const resized = () => {
      const g = fresh();
      Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "user_stated", source_quote: FACTS });
      const quote = "Make it £1,500 a month for each 1%.";
      const r = applyLinkEffectEdit({
        persistedGraph: g, from: "price_increase", to: MRR, effect: RESIZE as never, quote,
        expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, "price_increase", MRR)! },
        reading_token: linkEffectReadingToken({ from: "price_increase", to: MRR, effect: RESIZE as never, quote }),
      });
      expect(r.kind, JSON.stringify(r)).toBe("mutated");
      return (r as { mutatedGraph: Graph }).mutatedGraph;
    };
    it("PRECONDITION: the writer resized the link to £1,500 and kept the £1,200 Fi sentence; £1,500 is written once", () => {
      const p = priceEdge(resized()).provenance;
      expect(p).toMatchObject({ source: "user_specified", magnitude: "user_stated", source_quote: FACTS });
      expect(p.natural_effect).toMatchObject({ amount: 1500, per_source_change: 1 });
      expect(brief.indexOf("£1,500", at1500 + 1)).toBe(-1);
    });
    it("the stale sentence is not a veto: the chat size binds to the ONE place the brief writes £1,500 a month", () => {
      expect(at(brief, resized(), at1500, "£1,500")).toEqual({ verdict: "in_model", matched: MRR });
    });
    it("and the old sentence credits nothing: £1,200 and its 1% are no longer this link's figures", () => {
      const g = resized();
      // The kept sentence is commentary text on the edge, so the text route may say prose_only — never in_model.
      expect(at(brief, g, AT_1200, "£1,200")).toMatchObject({ matched: null });
      expect(at(brief, g, AT_1200, "£1,200").verdict).not.toBe("in_model");
      expect(at(brief, g, AT_1PCT, "1%").matched).not.toBe("price_increase");
    });
    it("CONTRAST: a NON-chat link whose sentence does not verify its size is not credited", () => {
      const g = fresh();
      Object.assign(priceEdge(g).provenance, { source: "cee_hypothesis", magnitude: "user_stated", source_quote: FACTS });
      Object.assign(priceEdge(g).provenance.natural_effect as Record<string, unknown>, { amount: 1500 });
      expect(at(brief, g, at1500, "£1,500").verdict).toBe("absent");
    });
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

// ⛔ Codex r1 on #2610, P1, through the ACTUAL construction writer: a scripted drafter call → `buildModelFromBrief` →
// `/graph/register` → GraphV3. "Monthly revenue is £75,000 a month" is a LEVEL; the drafter claims it as an explicit
// £75,000 effect of one campaign on an INFERRED link, and the label door stamps it `user_stated`.
describe("P1 through the construction writer: a level sentence stamped as an inferred link's size is not the user's size", () => {
  const BRIEF = "We are deciding whether to run a spring campaign. Monthly revenue is £75,000 a month.";
  const link = (from: string, to: string, by: "explicit" | "inferred", size?: { amount: number; per: number; by: string }) => ({
    from, to, direction: "positive", provenance: by,
    effect_amount: size?.amount ?? null, effect_per_source_change: size?.per ?? null, effect_provenance: size?.by ?? null, definitional: null,
  });
  const draft = (linkBy: "explicit" | "inferred") => ({
    goal: {
      metric: "Annual profit", operator: ">=", target_stated: false, frame: "level", value: null, unit: "GBP", horizon_months: 12,
      provenance: "inferred", baseline_known: false, baseline_value: null, baseline_provenance: "inferred", scope: null,
    },
    constraints: [],
    options: [
      { label: "Keep current marketing", provenance: "explicit", changes: [], is_status_quo: true, interventions: [] },
      { label: "Run the spring campaign", provenance: "explicit", changes: [], is_status_quo: null, interventions: [
        { factor_label: "Spring campaign", value: 1, value_kind: "absolute", unit: "campaigns", provenance: "explicit" },
      ] },
    ],
    factors: [
      { label: "Spring campaign", role: "controllable", baseline_known: true, baseline_value: 0, unit: "campaigns", provenance: "explicit", plausible_max: 1 },
    ],
    risks: [],
    outcomes: [{ label: "Monthly revenue", provenance: "explicit", unit: "GBP/month", plausible_max: 200000 }],
    links: [
      link("Spring campaign", "Monthly revenue", linkBy, { amount: 75000, per: 1, by: "explicit" }),
      link("Monthly revenue", "Annual profit", "inferred"),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  });
  async function build(d: Record<string, unknown>): Promise<Graph> {
    let body: unknown = null;
    const call = (async () => ({ text: JSON.stringify(d) })) as unknown as CallStructuredModel;
    const dispatch: InternalDispatch = async (path, b) => {
      if (path.endsWith("/graph/register")) {
        body = structuredClone((b as { graph: unknown }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: "h" } };
    };
    const out = (await buildModelFromBrief("f4a3f4a3-0000-4f4a-8f4a-f4a3f4a3f4a3", BRIEF, dispatch, call)) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    return GraphV3.parse(body) as unknown as Graph;
  }
  const AT_75K = BRIEF.indexOf("£75,000");
  const campaignEdge = (g: Graph) => g.edges.find((e) => e.from === "spring_campaign" && e.to === "monthly_revenue") as
    { provenance: Record<string, unknown> } | undefined;

  it("PRECONDITION: the writer stamps the inferred link user_stated with no quote, and no node holds £75,000", async () => {
    const g = await build(draft("inferred"));
    expect(campaignEdge(g)?.provenance).toMatchObject({ source: "cee_hypothesis", magnitude: "user_stated" });
    expect(campaignEdge(g)?.provenance).not.toHaveProperty("quote");
    expect(campaignEdge(g)?.provenance).not.toHaveProperty("source_quote");
    for (const n of g.nodes) expect((n.observed_state as { raw_value?: number } | undefined)?.raw_value, String(n.id)).not.toBe(75000);
  });
  it("the level figure is NOT credited to the fabricated effect", async () => {
    const item = at(BRIEF, await build(draft("inferred")), AT_75K, "£75,000");
    expect(item.matched).toBeNull();
    expect(item.verdict).not.toBe("in_model");
  });
  // Pre-existing on staging (#2601's quote-less rule for a link the brief states), unchanged by this PR and routed to MC
  // as a producer row: the label door should require the C2 sentence (MC P0's Fi binding) before it stamps a size.
  // Pinned so the producer fix flips it deliberately.
  it("KNOWN producer gap (routed to MC): the same stamp on a brief-stated link is credited by #2601's one-span rule", async () => {
    const g = await build(draft("explicit"));
    expect(campaignEdge(g)?.provenance).toMatchObject({ source: "brief_extraction", magnitude: "user_stated" });
    expect(at(BRIEF, g, AT_75K, "£75,000")).toEqual({ verdict: "in_model", matched: "monthly_revenue" });
  });
});
