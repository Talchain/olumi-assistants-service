/**
 * ROUND 2 — N1: THE SECOND DISCLOSURE THIS WARNING TOUCHES, MADE VISIBLE.
 *
 * The adversarial review raised this as a row rather than a blocker, and it is
 * pinned here rather than rowed because it is a BEHAVIOUR CHANGE IN A SURFACE
 * THIS PR DOES NOT OTHERWISE MENTION, and an unpinned behaviour change is one
 * nobody will notice moving.
 *
 * THE MECHANISM, derived at the bytes. `not-modelled-manifest.ts` classifies
 * top-level `validation_warnings` as **`prose`** (`TOP_KEY_CLASS`, :441), and
 * `splitSurfaces` walks every string beneath a prose key into `proseStrings`.
 * The WS-A 1(b) message quotes the brief's stated magnitudes back to the user
 * verbatim (*"could not be matched to an amount in your brief (£18,000,
 * £6,000)"*). So a magnitude the graph carries nowhere — previously reported as
 * `absent` — now appears in a prose surface and is reported as `prose_only`.
 *
 * ⚠ WHICH VERDICT IS *RIGHT* IS NOT WHAT THIS FILE DECIDES, and pretending
 * otherwise would be the overclaim (CLAUDE.md trap 20). `prose_only` is
 * arguably the honest reading — the manifest's own `prose_surface` vocabulary
 * already names "validation warnings", and the amount genuinely IS mentioned in
 * prose and genuinely IS NOT in the model. The point of this file is narrower
 * and more durable: THE INTERACTION IS REAL, IT IS OBSERVABLE, AND IT IS
 * PINNED — so if a later change flips it, something REDs and someone decides on
 * purpose.
 *
 * Both halves are asserted (trap 22b): the flip itself, AND the fact that the
 * warning does not touch the `in_model` verdict of a magnitude the graph really
 * does carry. A disclosure that quietly reclassified a modelled amount would be
 * a far worse defect than the one being pinned.
 */

import { describe, it, expect } from "vitest";

import { transformResponseToV3 } from "../../transforms/schema-v3.js";
import { deriveNotModelledManifest } from "../../context-integrity/not-modelled-manifest.js";

/**
 * THE ASYMMETRY IS THE INSTRUMENT. £25,000 is on the model literally (it IS the
 * factor's cap), so it reads `in_model`. £6,000 is stated and carried nowhere,
 * so it reads `absent` — until the money warning quotes it back in prose. The
 * two together let this file assert a flip AND a non-flip in the same graph.
 */
const BRIEF =
  "Switching would cost roughly £18,000 one-off, plus around £6,000 of training. " +
  "Our switching budget is capped at £25,000.";

const V1_GRAPH = {
  graph: {
    nodes: [
      { id: "goal", kind: "goal", label: "Lower total cost of ownership" },
      {
        id: "fac_switch_cost",
        kind: "factor",
        label: "Switching Cost",
        category: "controllable",
        data: { value: 0, unit: "£", cap: 25000, source: "brief_extraction" },
      },
      {
        id: "opt_switch",
        kind: "option",
        label: "Switch supplier",
        // The V4 prompt shape the extractor reads: a bare level per factor id.
        data: { interventions: { fac_switch_cost: 0.5 } },
      },
    ],
    edges: [{ from: "fac_switch_cost", to: "goal", edge_type: "causal" }],
  },
} as unknown as Parameters<typeof transformResponseToV3>[0];

function verdictFor(manifest: ReturnType<typeof deriveNotModelledManifest>, literal: string) {
  return manifest.quantities?.items.find((i) => i.literal === literal)?.verdict ?? null;
}

describe("WS-A 1(b) round 2 — how the money disclosure interacts with the not-modelled manifest", () => {
  const body = transformResponseToV3(V1_GRAPH, { brief: BRIEF }) as unknown as Record<
    string,
    unknown
  >;

  it("PRECONDITION — the transform really did emit the money warning on this graph", () => {
    // Trap 13b: without this, both assertions below would pass on a graph that
    // never carried a warning at all, and the file would prove nothing.
    const option = (body.options as Array<Record<string, any>>).find((o) => o.id === "opt_switch");
    expect(option?.interventions?.fac_switch_cost?.value).toBe(0.5);
    const warnings = (body.validation_warnings ?? []) as Array<Record<string, unknown>>;
    const money = warnings.filter((w) => w.code === "STATED_MAGNITUDE_UNRECONCILED");
    expect(money.map((w) => w.affected_node_id)).toEqual(["fac_switch_cost"]);
    expect(String(money[0]?.message)).toContain("£6,000");
  });

  it("PINNED: the warning's quoted magnitudes move a stated-but-unmodelled amount absent → prose_only", () => {
    const withoutWarnings = { ...body };
    delete withoutWarnings.validation_warnings;

    expect(verdictFor(deriveNotModelledManifest(BRIEF, withoutWarnings), "£6,000")).toBe("absent");
    expect(verdictFor(deriveNotModelledManifest(BRIEF, body), "£6,000")).toBe("prose_only");
  });

  it("and does NOT disturb the verdict of a magnitude the model genuinely carries", () => {
    // The opposite-direction twin. £25,000 IS the factor's cap, i.e. it is on
    // the model literally, so it must read `in_model` with the warning present
    // exactly as it does without it — a prose mention may never demote a
    // modelled quantity.
    const withoutWarnings = { ...body };
    delete withoutWarnings.validation_warnings;

    const before = verdictFor(deriveNotModelledManifest(BRIEF, withoutWarnings), "£25,000");
    const after = verdictFor(deriveNotModelledManifest(BRIEF, body), "£25,000");
    expect(before).toBe("in_model");
    expect(after).toBe("in_model");
  });
});
