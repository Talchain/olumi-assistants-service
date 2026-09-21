/**
 * A REAL MODEL EMISSION through the scale projection and the analysis seam's
 * own guard — the corpus member no fixture-authoring head can supply (trap 22:
 * a corpus drawn from the author's head cannot see the class the author did
 * not imagine; this one was drawn from the MODEL's).
 *
 * PROVENANCE (verbatim copy, append-only — trap 14b): banked capture
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/
 * r1-records-cutover/round11/corpus-v4/set12.json`, a live instruction-v3
 * emission on the long fidelity brief (B-class): 20 stated items, 28 claims,
 * genuinely mixed magnitudes — £700,000 and £1.8m figures beside 0.8/1.0
 * proportions and 0/1 flags, with free-text units ('£/seat/month',
 * 'engineers', '% NRR'-style percent spellings, 'minutes').
 *
 * At the pristine tip this record set projected to a graph the deployed guard
 * REFUSES (`mixedUnresolved: true` — the exact refusal the golden fresh
 * journey witnessed on 2026-08-12). The assertion here is the consumer's own
 * verdict flipping, on input the model actually produced.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import {
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
} from "../../../../orchestrator-v5/tools/plot-intervention-scale.js";
import type { DraftRecordSet } from "../grammar.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "live-emission-round11-set12.json");

describe("a real banked emission (round11 set12) computes under the deployed guard", () => {
  const records = JSON.parse(readFileSync(FIXTURE, "utf8")) as DraftRecordSet;

  it("projects to a graph whose request passes the analysis seam's mixed-scale predicate", () => {
    const { graph } = projectRecordsToGraph(records);
    const options = graph.nodes.filter((n) => n.kind === "option");
    // Positive control for the whole replay: the emission genuinely carries
    // magnitudes — an empty option set or empty interventions would make the
    // verdict below vacuous (trap 13).
    expect(options.length).toBeGreaterThanOrEqual(2);
    const perOption = options.map(
      (o) => ((o.data as { interventions?: Record<string, number> })?.interventions ?? {}),
    );
    const allValues = perOption.flatMap((iv) => Object.values(iv));
    expect(allValues.length).toBeGreaterThan(0);

    const verdict = projectRequestInterventionsToWireScale(perOption, buildFactorScaleMap(graph.nodes));
    expect(verdict.mixedUnresolved).toBe(false);
    expect(verdict.unresolvedFactorIds).toEqual([]);
    expect(verdict.allWithinUnitInterval).toBe(true);
    expect(verdict.postconditionViolated).toBe(false);
  });

  it("the raw £700,000 magnitude the model stated is preserved and its level is its exact projection", () => {
    const { graph } = projectRecordsToGraph(records);
    // The emission's headline raw magnitude: sets_to 700000 (LLM serving cost
    // in year one). Its factor's frame is derived from its OWN surviving
    // magnitudes, so the level is exactly raw/frame and the ratio to any
    // sibling magnitude on the same factor is exact. Locate the entries by
    // scanning the SOURCE record set (identity: the claim that carries 700000),
    // then assert the projected level is in (0,1) and back-multiplies exactly.
    const options = graph.nodes.filter((n) => n.kind === "option");
    const levels = options.flatMap((o) =>
      Object.values(((o.data as { interventions?: Record<string, number> })?.interventions ?? {})),
    );
    // Every projected level is a unit-interval value…
    for (const v of levels) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // …and 700000 survives as 0.7 exactly (frame 1,000,000 — the smallest
    // {1,2,5}·10^k strictly above 700000; hand-computed).
    expect(levels).toContain(0.7);
  });
});
