/**
 * A FIGURE THE USER STATED AS THEIR GOAL, WHICH THE MODEL HOLDS AS ITS GOAL,
 * MUST NOT BE REPORTED AS NEVER MODELLED.
 *
 * ── THE DEFECT, WIRE-WITNESSED ─────────────────────────────────────────────
 * Served CEE `d2afc2c`, scenario 8a317cdc-bf30-4899-8614-fd24d98dfc37, brief
 * "Budget is £900k either way and we want to add £3m of new ARR within eighteen
 * months". The manifest returned:
 *
 *   £900k -> in_model (matched: gtm_budget)
 *   £3m   -> absent  (matched: none)
 *
 * £900k anchors through `gtm_budget`'s node carrier. £3m does not — although the
 * model holds it, as `new_arr.goal_threshold_raw: 3000000` with
 * `goal_threshold_unit: "GBP"` on the same node.
 *
 * ── WHY IT CANNOT ANCHOR ───────────────────────────────────────────────────
 * `valueCarriers()` builds carriers `[node, node.observed_state, node.data]` and
 * reads `VALUE_FIELDS = ["value","raw","raw_value","cap"]` paired with
 * `carrier.unit`. The goal's figure is `goal_threshold_raw` (not in that list)
 * and its unit is `goal_threshold_unit` (not `unit`), so BOTH halves of the pair
 * are invisible and the figure is never a candidate.
 *
 * ── THIS MODULE HAS BEEN BITTEN BY THIS CLASS TWICE ALREADY ────────────────
 * `VALUE_FIELDS`' own doc-comment: "A field MISSING here means a figure the user
 * really stated goes unseen, and we then tell them we invented their own number.
 * (Measured: `observed_state.cap` and `raw_value` were absent from the first
 * version, and B2's offshore-scale factor — carrying the brief's £2.9m cap — was
 * wrongly claimed as ours.)" The goal threshold is the remaining instance, so
 * the fix is a further carrier rather than anything new in kind.
 *
 * ── WHY IT IS USER-VISIBLE ─────────────────────────────────────────────────
 * `not_modelled` is rendered: DGAI `adapters/cee/notModelled.ts` ->
 * `canvas/hydrate/serverGraphHydration.ts` -> `canvas/stores/contextIntegrityStore.ts`
 * -> `components/results/contextIntegrity/notModelledNotices.ts` ->
 * `WhatIWasGivenSection.tsx`, mounted by `AnalysisNewTabBody.tsx`; and
 * `notModelledNotices.ts:151` filters rows SPECIFICALLY for the `absent`
 * outcome. Established with `rg -a` over a fresh clone — GitHub code search
 * returned 0 for `not_modelled` there even with controls firing at 46, so the
 * search was wrong and the clone settled it.
 *
 * This module's own header calls wrongly claiming a user's value as our
 * invention "the named harm", and telling the user their stated goal was never
 * modelled is that harm on the surface built to prevent it.
 *
 * ── THE ORACLE IS A REAL CAPTURE, NOT A FIXTURE I WROTE ────────────────────
 * `live-gtm-goal-threshold.cold-read.json` is unedited wire bytes from the graph
 * read above, as the sibling specs require (trap 16-inverse). The predicate
 * below is restated from the spec — "the model holds this figure as its goal" —
 * rather than borrowed from the producer, so it can disagree with it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ColdRead {
  readonly brief_text: string;
  readonly graph: Record<string, unknown>;
}

const capture = JSON.parse(
  readFileSync(join(HERE, "fixtures", "live-gtm-goal-threshold.cold-read.json"), "utf8"),
) as ColdRead;

const manifest = () => deriveNotModelledManifest(capture.brief_text, capture.graph);

/** The goal's own figure, read from the graph rather than from the module under test. */
function goalThreshold(): { raw: number; unit: string } {
  const nodes = (capture.graph as { nodes?: Record<string, unknown>[] }).nodes ?? [];
  const goal = nodes.find((n) => n.kind === "goal");
  return { raw: goal?.goal_threshold_raw as number, unit: goal?.goal_threshold_unit as string };
}

describe("the capture is real and the assertion cannot pass vacuously", () => {
  it("carries a brief, a goal threshold and an untruncated manifest", () => {
    const q = manifest().quantities;
    expect(q, "the capture must derive").not.toBeNull();
    expect(q!.truncated, "a truncated capture would let the assertion below pass by omission").toBe(false);
    expect(q!.total, "the brief states £900k and £3m, so the scan must find figures").toBeGreaterThan(0);
    const g = goalThreshold();
    expect(g.raw, "the model must actually hold the goal figure, or there is nothing to anchor").toBe(3_000_000);
    expect(g.unit).toBe("GBP");
  });

  it("still anchors the figure that already worked — the contrast control", () => {
    // £900k anchors through a node carrier. If a change broke THAT, the headline
    // assertion could pass while the module got worse.
    const items = manifest().quantities!.items;
    const budget = items.find((i) => i.literal.includes("900"));
    expect(budget, "the brief's £900k must be scanned").toBeDefined();
    expect(budget!.verdict, "£900k anchors through gtm_budget and must keep doing so").toBe("in_model");
    expect(budget!.matched_node_id).not.toBeNull();
  });
});

describe("a figure the model holds as its goal is not reported absent", () => {
  it("£3m is in_model, and anchored to the goal node", () => {
    const items = manifest().quantities!.items;
    const arr = items.find((i) => i.literal.includes("3m") || i.literal.includes("£3"));
    expect(arr, "the brief's £3m must be scanned").toBeDefined();
    expect(
      arr!.verdict,
      `the model holds ${goalThreshold().raw} ${goalThreshold().unit} as its goal threshold, so "absent" is a false claim about the user's own input`,
    ).toBe("in_model");
    expect(arr!.matched_node_id, "and it must name the goal node, not merely match characters").toBe("new_arr");
  });

  it("no stated figure in this capture is absent", () => {
    const q = manifest().quantities!;
    const absent = q.items.filter((i) => i.verdict === "absent").map((i) => i.literal);
    expect(absent, "both of this brief's figures survive into the model").toEqual([]);
  });
});
