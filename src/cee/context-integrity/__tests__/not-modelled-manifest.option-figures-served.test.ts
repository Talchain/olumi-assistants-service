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
  ["r2", "8%", 206, "bread_price_change_from_current"],
  ["r2", "£250k", 352, "central_kitchen_fit_out_cost"],
  ["r2", "8%", 567, "bread_price_change_from_current"],
  ["b2", "15%", 475, "ai_ticket_deflection"],
  ["b2r2", "£120k", 285, "annual_incremental_support_investment"],
  ["prod-b2", "£120k", 285, "annual_intervention_cost"],
  ["prod-b2", "15%", 475, "ai_ticket_deflection"],
];

/** Stated in the brief, but the producer marked the level as Olumi's own (`cee_hypothesis`): never credited. */
const HYPOTHESIS_ONLY: readonly (readonly [string, string, number, string])[] = [
  ["b1r3", "£300", 448, "subscription_price"],
  ["r2", "£300", 448, "monthly_fee_per_caf"],
  ["b2r2", "15%", 475, "ai_ticket_deflection"],
  ["j1", "£8k", 201, "security_audit_price"],
];

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
        if (credited.has(key)) {
          expect(d.served.verdicts[key], `${capture} ${key} was a false absent`).toBe("absent");
        } else {
          expect(item.verdict, `${capture} ${key}`).toBe(d.served.verdicts[key]);
        }
      }
    },
  );

  it.each([
    ["b1r3", 6, 7],
    ["r2", 8, 5],
    ["b2", 8, 2],
    ["b2r2", 8, 2],
    ["prod-b2", 7, 3],
    ["j1", 9, 2],
    ["b3", 1, 0],
  ] as const)("%s: absent %i, in_model %i", (capture, absent, inModel) => {
    const q = manifestFor(capture);
    expect(q.absent).toBe(absent);
    expect(q.in_model).toBe(inModel);
  });
});
