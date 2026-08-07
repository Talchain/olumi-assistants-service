/**
 * CEE → UI wire-shape contract (analysis_result block enrichment).
 *
 * Installed from the olumi-schemas contract-test pack (contract-tests/
 * cee-to-ui.contract.test.ts @ main 5612e266, enrichment v1 rollout
 * step 2 — see that repo's docs/enrichment-v1/ROLLOUT.md and
 * contract-tests/README.md §CEE lane). Requires @talchain/schemas ≥ 0.14.0.
 *
 * CEE reduces the persisted 40-key PLoT envelope to the P0-B safe-transport
 * keep-list before it ships on `analysis_result` blocks
 * (src/orchestrator-v5/compose.ts: toSafeTransportEnrichment +
 * stripInternalKeysDeep). This contract pins:
 *
 *   1. THE DRIFT BOLT: compose.ts `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP`
 *      equals `CEE_UI_ENRICHMENT_KEEP_LIST` from @talchain/schemas
 *      element-for-element — the schemas package is the cross-repo source
 *      of truth (the UI's contract test reads the same constant), so the
 *      two lists must never drift,
 *   2. the REAL projection (imported from compose.ts, not a mirror) parses
 *      against AnalysisEnrichmentSchema,
 *   3. internal carriers never ship at any depth (the leak class the
 *      keep-list exists to stop), and
 *   4. keep-list membership pins for the UI's no-fallback reads.
 *
 * UI read-path evidence (DecisionGuideAI @ staging eeea43d2):
 *   - option_comparison_status — OutcomePanel.tsx (read, no fallback)
 *   - conditional_probabilities — read with no fallback (CEE keep-list
 *     closure review)
 *   - factor_sensitivity[].influence_score / sensitivity_score —
 *     debug exportBundle field resolvers
 *   - block enrichment container — src/v5/extractPhase3FromV5Response.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalysisEnrichmentSchema,
  CEE_UI_ENRICHMENT_KEEP_LIST,
} from "@talchain/schemas/boundary";
import {
  P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP,
  toSafeTransportEnrichment,
} from "../../src/orchestrator-v5/compose.js";
import {
  WITHHELD_DROPPED_ENRICHMENT_BLOBS,
  projectTransportEnrichmentForWithheldClaim,
} from "../../src/orchestrator-v5/compose/withheld-claim-projection.js";
import { ENRICHMENT_PRODUCER_MANIFEST } from "../../src/orchestrator-v5/context/enrichment-manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const crossServiceFixtures = join(here, "..", "fixtures", "cross-service");

/**
 * Keys CEE strips at ANY depth — assertion mirror of compose.ts
 * INTERNAL_ENRICHMENT_KEYS. This set is used to inspect the projection
 * OUTPUT (the projection itself is the real compose.ts function); keep it
 * in sync with compose.ts if the denylist grows.
 */
const INTERNAL_KEYS = new Set([
  "_meta", "meta", "_diagnostics", "ceeTrace", "cee_trace", "debug",
  "payloads", "downstream_calls", "graph", "graph_hash", "graph_hash_at_run",
  "feature_flags", "feature_flags_snapshot", "lineage", "seed",
  "isl_response", "isl_engine",
]);

const turnFixture = JSON.parse(
  readFileSync(
    join(crossServiceFixtures, "v5-turn.run-analysis.staging.json"),
    "utf-8",
  ),
) as { blocks: Array<Record<string, unknown>> };
const analysisBlock = turnFixture.blocks.find(
  (b) => b.type === "analysis_result",
);
if (!analysisBlock) {
  throw new Error(
    "v5-turn.run-analysis.staging.json no longer carries an analysis_result block — re-capture the fixture",
  );
}
const persisted = analysisBlock.enrichment as Record<string, unknown>;
const projected = toSafeTransportEnrichment(persisted);
if (!projected) {
  throw new Error(
    "toSafeTransportEnrichment returned undefined for the staging capture — the capture should carry kept fields",
  );
}

describe("CEE→UI: keep-list drift bolt (schemas package is the source of truth)", () => {
  it("compose.ts P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP === @talchain/schemas CEE_UI_ENRICHMENT_KEEP_LIST, element-for-element", () => {
    expect([...P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP]).toEqual([
      ...CEE_UI_ENRICHMENT_KEEP_LIST,
    ]);
  });
});

describe("CEE→UI: keep-list is anchored to the PLoT PRODUCER manifest (context-audit #1 row #1)", () => {
  // The original drift bolt compares CEE-copy == schemas-copy ONLY — it stays
  // green while BOTH mirror copies omit a real new PLoT field (it never looks
  // at the producer). Anchor the keep-list to ENRICHMENT_PRODUCER_MANIFEST
  // (the PLoT /v2/run RunResponseV3 top-level field set) so a kept key that is
  // NOT a real producer field — a drifted/renamed/removed-upstream key — goes
  // RED here instead of silently shipping an always-absent key to the UI.
  it("every kept key is a real PLoT producer field", () => {
    const notEmitted = P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP.filter(
      (key) => !ENRICHMENT_PRODUCER_MANIFEST.has(key),
    );
    expect(notEmitted).toEqual([]);
  });

  it("POSITIVE CONTROL — the producer check SEES a keep-list key absent from the manifest", () => {
    // Prove the subset check can detect a violation (doctrine trap #13):
    // a hypothetical kept key PLoT never emits must be flagged.
    const withPhantom = [...P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP, "ghost_field_plot_never_emits"];
    const notEmitted = withPhantom.filter((key) => !ENRICHMENT_PRODUCER_MANIFEST.has(key));
    expect(notEmitted).toContain("ghost_field_plot_never_emits");
  });
});

describe("CEE→UI: keep-list projection (real compose.ts toSafeTransportEnrichment)", () => {
  it("parses against AnalysisEnrichmentSchema", () => {
    const result = AnalysisEnrichmentSchema.safeParse(projected);
    if (!result.success) throw new Error(result.error.message);
    expect(result.success).toBe(true);
  });

  it("carries every UI no-fallback read present on the source envelope", () => {
    // option_comparison_status: OutcomePanel read.
    expect(projected.option_comparison_status).toBe(
      persisted.option_comparison_status,
    );
    // factor_sensitivity influence/sensitivity scores: exportBundle resolvers.
    const fs = projected.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs.length).toBeGreaterThan(0);
    expect(typeof fs[0].influence_score).toBe("number");
    expect(typeof fs[0].sensitivity_score).toBe("number");
  });

  it("ships NO internal carrier at any depth (leak pin)", () => {
    const violations: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (INTERNAL_KEYS.has(k)) violations.push(`${path}.${k}`);
          walk(v, `${path}.${k}`);
        }
      } else if (typeof value === "string" && value.includes("[REDACTED]")) {
        violations.push(`${path} carries [REDACTED]`);
      }
    };
    walk(projected, "$");
    expect(violations).toEqual([]);
  });

  it("drops the non-keep-listed keys (they exist on the persisted fact, not the wire)", () => {
    for (const droppedKey of [
      "m1_coaching",
      "_meta",
      "meta",
      "downstream_calls",
      "fact_objects",
      "critiques",
    ]) {
      expect(projected, `${droppedKey} must not ship`).not.toHaveProperty(
        droppedKey,
      );
    }
  });

  // Wave-2 ask 3 (0.19.0): decision_brief joined the keep-list — the UI's
  // leader-band consumer (DGAI #291/#292) shipped contract-pinned and never
  // fired because this key was stripped. The lineage-leak reason for the
  // original omission is the mutation-check built into this test: the
  // PERSISTED staging capture really carries `seed` and `graph_hash` inside
  // the brief (asserted below as positive controls), so if
  // stripInternalKeysDeep ever stops discriminating, the not-shipped
  // assertions go red.
  it("ships decision_brief WITH its internal lineage stripped (0.19.0, through the REAL projection)", () => {
    const persistedBrief = persisted.decision_brief as Record<string, unknown>;
    // Positive controls — the source really carries the internal keys.
    expect(persistedBrief).toHaveProperty("seed");
    expect(persistedBrief).toHaveProperty("graph_hash");
    // The real projection ships the brief…
    const shipped = projected.decision_brief as Record<string, unknown>;
    expect(shipped).toBeDefined();
    expect(shipped.headline).toBe(persistedBrief.headline);
    expect(shipped.options).toEqual(persistedBrief.options);
    // …minus the internal carriers, at any depth.
    expect(shipped).not.toHaveProperty("seed");
    expect(shipped).not.toHaveProperty("graph_hash");
  });
});

describe("CEE→UI: keep-list membership pins", () => {
  it("conditional_probabilities and results stay keep-listed (UI reads with no fallback)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toContain("conditional_probabilities");
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toContain("results");
  });

  it("m1_coaching stays DEFERRED (carries internal isl_engine provenance token)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).not.toContain("m1_coaching");
  });

  it("decision_brief is keep-listed (0.19.0, wave-2 ask 3)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toContain("decision_brief");
  });

  it("keep-list is exactly the CEE compose.ts P0B list (17 keys)", () => {
    expect(CEE_UI_ENRICHMENT_KEEP_LIST).toHaveLength(17);
  });
});

// ============================================================================
// V7-C slice 1b — the VOI family transports (@talchain/schemas 0.30.0).
//
// THE DEFECT. ISL emits `factor_evppi`, `decision_evpi`, `p_win_sensitivity`
// and `correlation_model` at the top level of ISLResponseV2; PLoT forwards all
// four VERBATIM (ISL_TOPLEVEL_ENRICHMENT_KEYS, run-contract-keys.ts:34-38,
// spread at run.ts:3533 @ PLoT staging 3d13e0ac); the run-analysis handler
// persists the PLoT body byte-for-byte. And `toSafeTransportEnrichment` then
// stripped all four — ONE HOP before the browser. The chain was whole
// everywhere except its last link, which is exactly why a producer-side probe
// at any earlier hop reported success.
//
// RED-FIRST ENTRY POINT: the drift bolt above is DERIVED from the vendored
// `CEE_UI_ENRICHMENT_KEEP_LIST`, so re-vendoring 0.30.0 turns it RED before a
// line of compose.ts changes. That is the intended order and it is why the
// bolt compares against the schemas constant rather than a local literal.
//
// SCOPE, STATED HONESTLY: the checked-in staging capture predates the VOI
// family and carries none of these keys (asserted below as this block's own
// negative control). The overlay is SYNTHESISED from ISL's typed row shape.
// These are PROJECTION pins over the real compose.ts functions — they prove
// what CEE does to bytes it is handed, NOT that ISL put those bytes on the
// wire. The live-wire claim needs a staging probe and is not made here.
// ============================================================================

/** Synthesised from ISL `FactorEvppiEntryV2` @ staging 1716f9bb — NOT a capture. */
const VOI_ENRICHMENT = {
  factor_evppi: [
    {
      factor_id: "fac_market_receptivity",
      evppi: 0.34,
      evppi_raw: 0.341982,
      units: "outcome",
      method: "regression_evppi_v1",
      noise_floor: 0.02,
      status: "resolved",
      correlation_active: false,
    },
    {
      // clamped_high: the per-factor <= total-EVPI cap fired. Audit only —
      // order is unaffected and no magnitude is displayed, so this row must
      // transport exactly like any other.
      factor_id: "fac_competitor_response",
      evppi: 0.91,
      evppi_raw: 1.4,
      units: "outcome",
      method: "regression_evppi_v1",
      clamped_high: true,
      noise_floor: 0.02,
      status: "resolved",
    },
    {
      factor_id: "fac_hiring_pace",
      evppi: 0,
      evppi_raw: -0.0004,
      units: "outcome",
      method: "regression_evppi_v1",
      clamped_low: true,
      noise_floor: 0.02,
      status: "below_resolution",
    },
  ],
  decision_evpi: 0.91,
  p_win_sensitivity: [{ factor_id: "fac_market_receptivity", delta_pp: 4.2 }],
  correlation_model: { suppressed_attributions: ["p_win_sensitivity"] },
} as const;

const VOI_KEYS = [
  "factor_evppi",
  "decision_evpi",
  "p_win_sensitivity",
  "correlation_model",
] as const;

/**
 * The persisted fact shape: the real capture PLUS the VOI family, an internal
 * intruder, and a `decision_review`.
 *
 * `decision_review` is added deliberately: it is CEE-INJECTED after PLoT
 * returns (turn-executor / decision-review-enricher), so the PLoT-side staging
 * capture does not carry it — and without it the withheld block's positive
 * control asserts nothing, because the key it watches being dropped was never
 * there. That is not hypothetical; it is how this fixture was first written,
 * and the control caught itself.
 */
const persistedWithVoi = {
  ...persisted,
  ...VOI_ENRICHMENT,
  decision_review: {
    // `produced_at` is REQUIRED by EnrichmentDecisionReviewSchema — a bare
    // `{summary}` fails the parse pin two tests down, which is the envelope
    // catching a malformed KNOWN key exactly as designed.
    produced_at: "2026-07-29T00:00:00.000Z",
    summary: "FIXTURE synthetic decision review.",
  },
  _meta: { seed: 42, graph_hash: "deadbeef" },
} as Record<string, unknown>;
const transportedWithVoi = toSafeTransportEnrichment(persistedWithVoi);
if (!transportedWithVoi) {
  throw new Error("toSafeTransportEnrichment returned undefined for the VOI fixture");
}

describe("CEE→UI: the VOI family transports (V7-C slice 1b)", () => {
  it("NEGATIVE CONTROL — the staging capture itself carries none of the four", () => {
    // Provenance, asserted rather than claimed in a comment: if a future
    // re-capture DOES carry them, this goes red and the synthesised overlay
    // above should be replaced by the real bytes.
    for (const key of VOI_KEYS) {
      expect(persisted, `${key} unexpectedly present on the capture`).not.toHaveProperty(key);
    }
  });

  it("the real projection ships all four VERBATIM", () => {
    for (const key of VOI_KEYS) {
      expect(transportedWithVoi, `${key} must transport`).toHaveProperty(key);
    }
    expect(transportedWithVoi.factor_evppi).toEqual(VOI_ENRICHMENT.factor_evppi);
    expect(transportedWithVoi.decision_evpi).toBe(0.91);
    expect(transportedWithVoi.p_win_sensitivity).toEqual(VOI_ENRICHMENT.p_win_sensitivity);
    expect(transportedWithVoi.correlation_model).toEqual(VOI_ENRICHMENT.correlation_model);
  });

  it("preserves PRODUCER RANK ORDER — the ordering is the contract", () => {
    // ISL sorts by `evppi` DESCENDING and the surface renders in wire order.
    // Transport must not reorder, and a consumer must not re-sort: a layer
    // that "fixes" the order is a layer that can invert it.
    const rows = transportedWithVoi.factor_evppi as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.factor_id)).toEqual([
      "fac_market_receptivity",
      "fac_competitor_response",
      "fac_hiring_pace",
    ]);
  });

  it("preserves the below-resolution row's clamped 0 AND its status (absent != zero)", () => {
    // The pair is what stops a consumer reading 0 as "measured worthless".
    // A transport that dropped `status` would leave a bare 0 that ranks.
    const rows = transportedWithVoi.factor_evppi as Array<Record<string, unknown>>;
    const below = rows[2];
    expect(below.evppi).toBe(0);
    expect(below.status).toBe("below_resolution");
    expect(below.clamped_low).toBe(true);
    // …and the clamped_high row is untouched: audit flag, not a display gate.
    expect(rows[1].clamped_high).toBe(true);
    expect(rows[1].evppi).toBe(0.91);
  });

  it("still strips the internal intruder (the strip did not stop discriminating)", () => {
    // Positive control for the leak pin on THIS fixture: the source really
    // carries `_meta`, so the not-shipped assertion is not vacuous.
    expect(persistedWithVoi).toHaveProperty("_meta");
    expect(transportedWithVoi).not.toHaveProperty("_meta");
    expect(transportedWithVoi).not.toHaveProperty("m1_coaching");
  });

  it("the transported VOI family parses against AnalysisEnrichmentSchema", () => {
    const result = AnalysisEnrichmentSchema.safeParse(transportedWithVoi);
    if (!result.success) throw new Error(result.error.message);
    expect(result.success).toBe(true);
  });
});

// ── The withheld-turn ruling, pinned ────────────────────────────────────────
//
// THE RULING, DERIVED AT THE BYTES RATHER THAN ASSUMED: the VOI family SURVIVES
// a withheld-claim turn, unchanged, and that is correct — not an oversight to
// be closed.
//
// `projectTransportEnrichmentForWithheldClaim` drops
// WITHHELD_DROPPED_ENRICHMENT_BLOBS (= ['decision_review']) whole, projects
// `decision_brief` and `robustness` member-wise, and passes every other key
// through verbatim. The question is therefore whether these four keys are
// claim-adjacent, and they are not: NO FIELD OF ANY VOI SHAPE NAMES AN OPTION.
// A `factor_evppi` row carries a factor id and numbers; `correlation_model`
// carries field names; `p_win_sensitivity` carries factor-keyed deltas. The
// leading-option egress guard has nothing to catch, so the right move is to PIN
// the pass-through, not to add a suppression path — a second owner of the
// withholding rule is how this estate ends up with two `generateGraphHash`
// twins (compose/withheld-claim-projection.ts says so in its own comments).
//
// The claim being withheld is "which option leads". "Which uncertainty is worth
// resolving next" is a different claim, and withholding it would be its own
// dishonesty: on a turn where we cannot name a leader, what to go and learn is
// the most useful thing we can still say.
describe("CEE→UI: the VOI family on a WITHHELD-claim turn (V7-C slice 1b)", () => {
  const withheld = projectTransportEnrichmentForWithheldClaim(transportedWithVoi);
  if (!withheld) {
    throw new Error("withheld projection returned undefined for the VOI fixture");
  }

  it("POSITIVE CONTROL — the withheld projection actually ran", () => {
    // Without this, every assertion below passes just as happily against a
    // projection that no-opped (trap 13). `decision_review` is on the capture
    // and on the transport keep-list, and the withheld projection drops it
    // whole — so its absence is proof the funnel executed.
    expect(transportedWithVoi).toHaveProperty("decision_review");
    expect(withheld).not.toHaveProperty("decision_review");
  });

  it("passes all four VOI keys through UNCHANGED", () => {
    for (const key of VOI_KEYS) {
      expect(withheld, `${key} must survive a withheld turn`).toHaveProperty(key);
      expect(withheld[key]).toEqual(transportedWithVoi[key]);
    }
  });

  it("no VOI shape names an OPTION — the licence for passing them through", () => {
    // Walked over the real values, not read off the types. This is the
    // derivation the ruling rests on, so it is executed, not asserted in prose.
    const OPTION_KEY = /(^|_)option(_|$)|option_id|leading_option/i;
    const violations: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (OPTION_KEY.test(k)) violations.push(`${path}.${k}`);
          walk(v, `${path}.${k}`);
        }
      }
    };
    for (const key of VOI_KEYS) walk(withheld[key], `$.${key}`);
    expect(violations).toEqual([]);

    // POSITIVE CONTROL — the walker can see an option key when one exists.
    const control: string[] = [];
    const walkControl = (value: unknown, path: string): void => {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (OPTION_KEY.test(k)) control.push(`${path}.${k}`);
          walkControl(v, `${path}.${k}`);
        }
      }
    };
    walkControl({ leading_option_id: "opt_a" }, "$");
    expect(control).toEqual(["$.leading_option_id"]);
  });

  it("the VOI keys are NOT on the withheld drop list, and decision_review still is", () => {
    // Pins the ruling against the constant itself, so a future lane that adds
    // a VOI key to the drop list has to change this test and read the reason.
    for (const key of VOI_KEYS) {
      expect(WITHHELD_DROPPED_ENRICHMENT_BLOBS).not.toContain(key);
    }
    expect(WITHHELD_DROPPED_ENRICHMENT_BLOBS).toContain("decision_review");
  });
});

// ============================================================================
// EXHAUSTIVENESS: every transport key has an EXPLICIT withheld ruling.
//
// THE GAP THIS CLOSES (adversarial review of #754, non-blocking recommendation).
// `projectTransportEnrichmentForWithheldClaim` is default pass-through: it names
// what it drops and what it projects, and everything else falls through. So a
// key added to `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` in a future train starts
// crossing the withheld-claim boundary the moment it is keep-listed, with
// nothing forcing anyone to decide whether it should — it inherits pass-through
// silently, from a different file, in a different PR.
//
// That is the same defect class this very PR was written to fix, pointed the
// other way. A key silently DROPPED at a boundary cost the estate four releases
// of a dark UI surface. A key silently KEPT at a CLAIM boundary is the same
// failure with worse consequences, because the thing that leaks is a claim we
// decided not to make.
//
// WHY THIS IS NOT JUST A SECOND MIRROR: the rulings are not compared against
// the projection's source. They are compared against its OBSERVED BEHAVIOUR —
// the real function is run over a probe and each key's fate is derived from the
// output. A ruling that stops matching what the code does goes red.
// ============================================================================
/**
 * The declared withheld ruling for every transport keep-list key.
 *
 * ⚠ WHY THIS LIVES IN THE TEST AND NOT BESIDE THE PROJECTION. It was written
 * first in `compose/withheld-claim-projection.ts`, and
 * `tests/contract/tier3-leak-guard.static.guard.test.ts` immediately went RED:
 * the registry names `flip_thresholds`, `edge_e_values` and `inference_warnings`
 * as literals, and that guard's static scan cannot tell a REGISTRY of key names
 * from a CONSUMPTION of the fields — by design, because a producer file that
 * mentions a Tier-3 key is exactly what it exists to catch.
 *
 * The available fixes were: allow-list the projection file, or move the table.
 * Allow-listing was the wrong one. The guard's own message routes a new entry
 * through Brief 4 §9 claim-safety review, and buying a cosmetic table an
 * exemption from a claim-safety control — self-granted, for a file that does no
 * Tier-3 consumption at all — weakens the control for everyone who reads the
 * allow-list afterwards as "these files were reviewed".
 *
 * Nothing is lost by moving it. This table is ENFORCEMENT, not behaviour: no
 * production code imports it, the projection's semantics are unchanged, and the
 * gate is identical — a key added to the keep-list without a ruling REDs here.
 */
type WithheldRuling = "pass_through" | "projected" | "dropped";
const WITHHELD_RULING_BY_TRANSPORT_KEY: ReadonlyMap<string, WithheldRuling> =
  new Map<string, WithheldRuling>([
    // Science that measures options WITHOUT ranking them. The 2026-07-27
    // anti-over-suppression ruling deliberately KEEPS per-option
    // win_probability on a withheld turn; these ride that ruling.
    ["option_comparison", "pass_through"],
    ["option_comparison_status", "pass_through"],
    ["conditional_probabilities", "pass_through"],
    ["factor_sensitivity", "pass_through"],
    ["edge_e_values", "pass_through"],
    ["inference_warnings", "pass_through"],
    ["confidence_tier", "pass_through"],
    ["flip_thresholds", "pass_through"],
    ["results", "pass_through"],
    // Leader-designating members removed, the rest kept.
    ["decision_brief", "projected"],
    ["robustness", "projected"],
    // Withheld whole.
    ["decision_review", "dropped"],
    // V7-C slice 1b — the VOI family. `pass_through` is a RULING, derived: no
    // field of any of these shapes names an option (factor ids and numbers
    // only), so the leading-option egress guard has nothing to catch. And the
    // claim being withheld is "which option leads"; "which uncertainty is worth
    // resolving next" is a different claim, and withholding it on a turn where
    // we cannot name a leader would suppress the most useful thing still true.
    ["factor_evppi", "pass_through"],
    ["decision_evpi", "pass_through"],
    ["p_win_sensitivity", "pass_through"],
    ["correlation_model", "pass_through"],
    // schemas 0.31.0 — `critiques`. `projected`, and this ruling had to be
    // DERIVED rather than inherited from the VOI family beside it: the 0.30.0
    // entries are `pass_through` precisely BECAUSE no field of those shapes
    // names an option. A critique does — `affected_option_ids` is raw option
    // identity, and S-bucket copy resolves an option LABEL into its prose. So
    // the withheld turn must change the row, not forward it.
    //
    // Projected rather than DROPPED, deliberately: the claim being withheld is
    // "which option leads". "This option changes nothing yet" is a different
    // claim and is the most useful thing still true on such a turn — the same
    // anti-over-suppression ruling that keeps per-option win_probability.
    ["critiques", "projected"],
  ]);

describe("CEE→UI: every transport key has an explicit withheld ruling", () => {
  /**
   * A probe carrying every keep-list key with a value that can distinguish all
   * three fates. `decision_brief` and `robustness` deliberately carry BOTH a
   * leader-designating member (removed) and an innocent one (kept), so they
   * come back changed-but-present rather than dropped.
   */
  const probe: Record<string, unknown> = {};
  for (const key of P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP) {
    probe[key] = { probe_marker: key };
  }
  probe.decision_brief = { headline: "X currently leads", brief_id: "keep-me" };
  probe.robustness = { leading_option_id: "opt_a", fragile_edges: [] };
  // `critiques` is an ARRAY of rows, not a blob — the generic `{ probe_marker }`
  // above cannot exercise it. Carries BOTH an option-identity member (removed)
  // and an innocent one (kept), so it comes back changed-but-present.
  probe.critiques = [
    {
      code: "EMPTY_INTERVENTIONS",
      severity: "warning",
      user_message: "Option 'Bravo' does not change anything yet.",
      affected_option_ids: ["opt_b"],
      affected_node_ids: ["n1"],
    },
  ];

  const projectedProbe = projectTransportEnrichmentForWithheldClaim(probe) ?? {};

  /** Derive each key's fate from what the REAL projection did to it. */
  const observed = new Map<string, WithheldRuling>();
  for (const key of P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP) {
    if (!(key in projectedProbe)) observed.set(key, "dropped");
    else if (JSON.stringify(projectedProbe[key]) === JSON.stringify(probe[key])) {
      observed.set(key, "pass_through");
    } else observed.set(key, "projected");
  }

  it("the ruling registry covers the keep-list EXACTLY (a new key must be ruled on)", () => {
    expect([...WITHHELD_RULING_BY_TRANSPORT_KEY.keys()].sort()).toEqual(
      [...P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP].sort(),
    );
  });

  it("every declared ruling matches OBSERVED behaviour of the real projection", () => {
    const mismatches: string[] = [];
    for (const [key, declared] of WITHHELD_RULING_BY_TRANSPORT_KEY) {
      const actual = observed.get(key);
      if (actual !== declared) mismatches.push(`${key}: declared ${declared}, observed ${actual}`);
    }
    expect(
      mismatches,
      "A withheld ruling no longer describes what the projection does. Fix the " +
        "CODE if the behaviour is wrong, or the RULING if the behaviour is right " +
        "— but never by copying one into the other without deciding which is.",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL — the probe exercises all three verdicts", () => {
    // Without this, the check above passes just as happily in a world where the
    // projection became a no-op and every key read `pass_through` (trap 13).
    expect(new Set(observed.values())).toEqual(
      new Set(["pass_through", "projected", "dropped"]),
    );
    expect(observed.get("decision_review")).toBe("dropped");
    expect(observed.get("decision_brief")).toBe("projected");
    expect(observed.get("factor_evppi")).toBe("pass_through");
  });
});
