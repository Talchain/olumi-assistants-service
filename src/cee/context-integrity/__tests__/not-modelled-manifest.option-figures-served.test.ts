/**
 * RT-4 class A: the user's option figures are credited as in the model.
 *
 * The corpus is seven SERVED draft turns captured by the red team (#87 5998705341):
 * four staging builds and prod fdbef0ad, from three different briefs. Each one is
 * replayed here at 0 LLM through the real `deriveNotModelledManifest`.
 *
 * The defect: the served agent-lane producer (`admit-model` `ConstructedLevel`)
 * writes `{ value, source, target_match, raw_value, unit }`, with no
 * `value_confidence` field at all. The manifest required `value_confidence ===
 * "high"`, so every stated option figure read "absent". Examples: the bakery's
 * £250k fit-out, the 8% price rise and the 6% waste rate, and the support team's
 * £120k tool and 15% deflection.
 *
 * Rows bind by IDENTITY (literal @ char_offset → the exact factor id) and pair each
 * credit with a contrast: a level the producer marked `cee_hypothesis` stays
 * absent even where the brief states the same number (£300, £8k, and the b2r2 15%).
 * Every other item must keep the verdict the served build gave it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

interface ServedDraft {
  readonly capture: string;
  readonly served_cee_build: string | null;
  readonly brief: string;
  readonly served: {
    readonly absent: number;
    readonly in_model: number;
    readonly verdicts: Readonly<Record<string, string>>;
    /** literal@offset → the node the served build anchored it to (in_model items only). */
    readonly anchors: Readonly<Record<string, string>>;
    /** The factors the served build listed as figures Olumi supplied (`inferred_factors`), in order. */
    readonly inferred_factors: readonly string[];
  };
  readonly draft_graph: Record<string, unknown>;
}

const FIXTURE = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rt4-served-option-figures.json"), "utf8"),
) as { briefs: Record<string, string>; drafts: ServedDraft[] };

const draft = (capture: string): ServedDraft => {
  const found = FIXTURE.drafts.find((d) => d.capture === capture);
  if (found === undefined) throw new Error(`fixture has no capture ${capture}`);
  return found;
};

const manifestFor = (capture: string) => {
  const d = draft(capture);
  const quantities = deriveNotModelledManifest(FIXTURE.briefs[d.brief]!, structuredClone(d.draft_graph)).quantities;
  if (quantities === undefined || quantities === null) throw new Error(`no quantities for ${capture}`);
  return quantities;
};

const itemAt = (capture: string, literal: string, offset: number) => {
  const item = manifestFor(capture).items.find((i) => i.literal === literal && i.char_offset === offset);
  expect(item, `${capture} must report ${literal}@${offset}`).toBeDefined();
  return item!;
};

/** The figures the user stated that the served model carries as a `brief_extraction` option level. */
const CREDITED: readonly (readonly [string, string, number, string])[] = [
  ["b1r3", "£250k", 352, "central_kitchen_fit_out_cost"],
  ["b1r3", "6%", 673, "production_waste_rate"],
  ["r2", "£250k", 352, "central_kitchen_fit_out_cost"],
  ["b2", "15%", 475, "ai_ticket_deflection"],
  ["b2r2", "£120k", 285, "annual_incremental_support_investment"],
  ["prod-b2", "£120k", 285, "annual_intervention_cost"],
  ["prod-b2", "15%", 475, "ai_ticket_deflection"],
];

/**
 * OWN SPAN (DL ruling on #2603): the bakery writes its 8% price rise TWICE. Value and unit cannot say which written
 * figure the level holds, so neither is credited by the option route. A known, deliberate cost in the safe direction.
 */
const STATED_TWICE: readonly (readonly [string, string, number])[] = [
  ["r2", "8%", 206],
  ["r2", "8%", 567],
];

/** Stated in the brief, but the producer marked the level as Olumi's own (`cee_hypothesis`): never credited. */
const HYPOTHESIS_ONLY: readonly (readonly [string, string, number, string])[] = [
  ["b1r3", "£300", 448, "subscription_price"],
  ["r2", "£300", 448, "monthly_fee_per_caf"],
  ["b2r2", "15%", 475, "ai_ticket_deflection"],
  ["j1", "£8k", 201, "security_audit_price"],
];

/**
 * RT-4 CLASS B, NOT THIS CLAIM: figures whose unit is composite ("% of output", "% increase from prior
 * year", "£/billable day") do not read as % or £ (`stated-amounts.ts` allows a one-word denominator).
 * Their verdicts belong to class B's fix, so these rows neither credit them nor pin today's false absence.
 */
const KNOWN_CLASS_B: Readonly<Record<string, readonly string[]>> = {
  r2: ["18%@92", "12%@656", "6%@673"],
  j1: ["£900@271", "£1,000@279"],
};
const isClassB = (capture: string, key: string): boolean => (KNOWN_CLASS_B[capture] ?? []).includes(key);

describe("RT-4 class A — a stated option figure the model carries is credited", () => {
  it("the corpus is the served shape: no option level carries value_confidence", () => {
    let levels = 0;
    for (const d of FIXTURE.drafts) {
      for (const node of (d.draft_graph.nodes as Record<string, unknown>[]) ?? []) {
        for (const iv of Object.values((node.interventions as Record<string, Record<string, unknown>>) ?? {})) {
          levels += 1;
          expect(iv).not.toHaveProperty("value_confidence");
        }
      }
    }
    expect(levels).toBeGreaterThan(0);
  });

  it.each(CREDITED)("%s: %s@%i is in_model on %s", (capture, literal, offset, nodeId) => {
    const item = itemAt(capture, literal, offset);
    expect(item.verdict).toBe("in_model");
    expect(item.matched_node_id).toBe(nodeId);
  });

  it.each(STATED_TWICE)("OWN SPAN %s: %s@%i, written twice, is not credited by the option route", (capture, literal, offset) => {
    const item = itemAt(capture, literal, offset);
    expect(item.verdict).toBe("absent");
    expect(item.matched_node_id).toBeNull();
  });

  it.each(HYPOTHESIS_ONLY)(
    "CONTRAST %s: %s@%i stays absent — the level on %s is cee_hypothesis",
    (capture, literal, offset, nodeId) => {
      const d = draft(capture);
      const carriers = ((d.draft_graph.nodes as Record<string, unknown>[]) ?? []).flatMap((node) =>
        Object.entries((node.interventions as Record<string, Record<string, unknown>>) ?? {})
          .filter(([factorId]) => factorId === nodeId)
          .map(([, iv]) => iv.source),
      );
      // The precondition: the level exists and is Olumi's, so only the source gate keeps it out.
      expect(carriers).toContain("cee_hypothesis");
      expect(carriers).not.toContain("brief_extraction");
      const item = itemAt(capture, literal, offset);
      expect(item.verdict).toBe("absent");
      expect(item.matched_node_id).toBeNull();
    },
  );

  it.each(FIXTURE.drafts.map((d) => [d.capture] as const))(
    "%s: every item outside the credited set keeps its served verdict",
    (capture) => {
      const d = draft(capture);
      const credited = new Set(CREDITED.filter(([c]) => c === capture).map(([, l, o]) => `${l}@${o}`));
      const items = manifestFor(capture).items;
      expect(items.length).toBe(Object.keys(d.served.verdicts).length);
      for (const item of items) {
        const key = `${item.literal}@${item.char_offset}`;
        expect(d.served.verdicts[key], `${capture} ${key} was served`).toBeDefined();
        if (isClassB(capture, key)) continue;
        if (credited.has(key)) {
          expect(d.served.verdicts[key], `${capture} ${key} was a false absent`).toBe("absent");
        } else {
          expect(item.verdict, `${capture} ${key}`).toBe(d.served.verdicts[key]);
        }
      }
    },
  );

  it.each(FIXTURE.drafts.map((d) => [d.capture] as const))(
    "%s: no previously anchored match moves (Science W2)",
    (capture) => {
      const d = draft(capture);
      const items = manifestFor(capture).items;
      let anchored = 0;
      for (const [key, nodeId] of Object.entries(d.served.anchors)) {
        const item = items.find((i) => `${i.literal}@${i.char_offset}` === key);
        expect(item?.matched_node_id, `${capture} ${key}`).toBe(nodeId);
        anchored += 1;
      }
      expect(anchored).toBe(Object.keys(d.served.anchors).length);
    },
  );

  it.each(FIXTURE.drafts.map((d) => [d.capture] as const))(
    "%s: every item the served build had in the model keeps exactly its served anchor (or none)",
    (capture) => {
      const d = draft(capture);
      const items = manifestFor(capture).items;
      let checked = 0;
      for (const [key, verdict] of Object.entries(d.served.verdicts)) {
        if (verdict !== "in_model") continue;
        const item = items.find((i) => `${i.literal}@${i.char_offset}` === key);
        expect(item?.verdict, `${capture} ${key}`).toBe("in_model");
        expect(item?.matched_node_id ?? null, `${capture} ${key}`).toBe(d.served.anchors[key] ?? null);
        checked += 1;
      }
      expect(checked).toBe(Object.values(d.served.verdicts).filter((v) => v === "in_model").length);
    },
  );

  it.each(FIXTURE.drafts.map((d) => [d.capture] as const))(
    "%s: crediting an option's level never removes its factor from the figures Olumi supplied",
    (capture) => {
      // The level is a figure ON the factor; the factor's own baseline and cap (e.g. £0 today, a £500k cap) stay Olumi's.
      const d = draft(capture);
      const fresh = deriveNotModelledManifest(FIXTURE.briefs[d.brief]!, structuredClone(d.draft_graph));
      expect((fresh.inferred_factors?.items ?? []).map((i) => i.node_id)).toEqual(d.served.inferred_factors);
    },
  );

  it("the inferred-factor rows see something: credited factors are on the served list", () => {
    expect(draft("b1r3").served.inferred_factors).toContain("central_kitchen_fit_out_cost");
    expect(draft("prod-b2").served.inferred_factors).toContain("annual_intervention_cost");
  });

  it("the anchored-match rows see something: the corpus has served anchors", () => {
    expect(FIXTURE.drafts.reduce((n, d) => n + Object.keys(d.served.anchors).length, 0)).toBeGreaterThan(0);
  });

  it("the class B list names items the corpus really reports", () => {
    for (const [capture, keys] of Object.entries(KNOWN_CLASS_B)) {
      for (const key of keys) expect(draft(capture).served.verdicts[key], `${capture} ${key}`).toBe("absent");
    }
  });

  // Counted over every item outside class B, so a later class B fix does not move these rows.
  it.each([
    ["b1r3", 6, 7],
    ["r2", 7, 3],
    ["b2", 8, 2],
    ["b2r2", 8, 2],
    ["prod-b2", 7, 3],
    ["j1", 7, 2],
    ["b3", 1, 0],
  ] as const)("%s: outside class B, absent %i and in_model %i", (capture, absent, inModel) => {
    const items = manifestFor(capture).items.filter((i) => !isClassB(capture, `${i.literal}@${i.char_offset}`));
    expect(items.filter((i) => i.verdict === "absent").length).toBe(absent);
    expect(items.filter((i) => i.verdict === "in_model").length).toBe(inModel);
  });
});
