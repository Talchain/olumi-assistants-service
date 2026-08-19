/**
 * ⭐⭐ CONNECTED BUT NUMBERLESS — THE STATUS DECIDES WHICH QUESTION THE PRODUCT
 * PUTS TO THE USER, AND IT WAS PUTTING THE WRONG ONE ON EVERY CAPTURED DRAW.
 *
 * THE DEFECT. `analysis_ready.options[].status` chooses between two asks that
 * are NOT interchangeable (both spellings live in
 * `orchestrator/tools/analysis-ready-helper.ts`):
 *   · `needs_user_mapping` → "Choose which factor X changes and by how much."
 *   · `needs_encoding`     → "Choose how X should be represented on the effect
 *                             scale."
 * An option that already carries an option→factor edge HAS its mapping. Only
 * the magnitude is outstanding. Labelling it `needs_user_mapping` sends the
 * user to redo work the product had already done.
 *
 * WHY THIS SUITE USES REAL CAPTURES AND NOT A HAND-WRITTEN FIXTURE (trap
 * 16-inverse: *a fixture you wrote yourself is not evidence about the wire*).
 * The graphs below are the verbatim `draft_graph` blocks from three of the nine
 * draws captured against deployed staging on 19 Aug 2026
 * (`POST /proxy/v5/turn`, fresh anonymous guest, pinned 538-byte brief), stored
 * beside their OBSERVED `analysis_ready` statuses. `observed_analysis_ready` is
 * an APPEND-ONLY HISTORIC RECORD of what the product actually emitted on that
 * build — never edit it to match new behaviour (trap 14b).
 *
 * THE ROOT CAUSE WAS ORDERING, NOT ARITHMETIC. `buildAnalysisReadyPayload`
 * decided every status ~70 lines BEFORE it built the option→factor adjacency it
 * already had the graph for. The persisted-graph readiness path compensated
 * with its own duplicate rule in `projectOptionForCanonicalBuilder`; the draft
 * path — a fresh user's first turn — had no compensation. Two producers, one
 * field, disagreeing on IDENTICAL graph shapes. `HARNESS FIDELITY` below proves
 * the reconstruction reproduces the wire, so the disagreement is the product's
 * and not this suite's.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE `option_id` and
 * THE status literal. Counts are never the subject of an assertion.
 *
 * THE DISCRIMINATOR IS REAL DATA, NOT A CONSTRUCTION. Draw 5's `e405d56a` is
 * connected by TWO edges that both carry `origin: "repair"` — the product's own
 * status-quo wiring. It must STAY `needs_user_mapping`, because there is no
 * representation to choose for a lever nobody stated. A fix that counted every
 * edge would flip it and this suite would RED.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import type { GraphV3T, NodeV3T, OptionV3T, InterventionV3T } from "../../../schemas/cee-v3.js";
import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { computeOptionStatus } from "../option-status.js";

// ---------------------------------------------------------------------------
// Real captures
// ---------------------------------------------------------------------------

interface ObservedOption {
  readonly option_id: string;
  readonly status: string;
  readonly status_reason?: string;
  readonly intervention_count: number;
}
interface Draw {
  readonly captured_at: string;
  readonly endpoint: string;
  readonly draft_graph: GraphV3T;
  readonly observed_analysis_ready: {
    readonly status: string;
    readonly options: readonly ObservedOption[];
  };
}

const DRAWS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/sendable-variance-draws-2026-08-19.json", import.meta.url)),
    "utf-8",
  ),
) as Record<string, Draw>;

const DRAW_4 = DRAWS["draw-4"];
const DRAW_5 = DRAWS["draw-5"];
const DRAW_9 = DRAWS["draw-9"];

// ---------------------------------------------------------------------------
// Reconstruction of the draft path from a captured graph
// ---------------------------------------------------------------------------

/**
 * Rebuild the V3 options the draft path hands to `buildAnalysisReadyPayload`.
 *
 * The option's `status` is NOT typed in here — it is computed by the
 * extractor's own producer, `computeOptionStatus`, from the option's own
 * interventions. Typing a literal would encode this suite's model of the
 * extractor instead of the extractor (trap 13c).
 */
function optionsFromGraph(graph: GraphV3T): OptionV3T[] {
  return (graph.nodes as NodeV3T[])
    .filter((node) => node.kind === "option")
    .map((node) => {
      const raw = node as unknown as {
        id: string;
        label: string;
        interventions?: Record<string, InterventionV3T>;
        is_baseline?: boolean;
      };
      const interventions = raw.interventions ?? {};
      return {
        id: raw.id,
        label: raw.label,
        status: computeOptionStatus({ interventions }).status,
        interventions,
        ...(raw.is_baseline === true || raw.is_baseline === false
          ? { is_baseline: raw.is_baseline }
          : {}),
      } as unknown as OptionV3T;
    });
}

function goalNodeId(graph: GraphV3T): string {
  const goal = (graph.nodes as NodeV3T[]).find((node) => node.kind === "goal");
  if (!goal) throw new Error("captured graph carries no goal node");
  return goal.id;
}

/** `option_id` → status, from the draft path, for a captured graph. */
function draftPathStatusById(draw: Draw): Map<string, string> {
  const graph = draw.draft_graph;
  const payload = buildAnalysisReadyPayload(optionsFromGraph(graph), goalNodeId(graph), graph);
  return new Map(payload.options.map((option) => [option.id, option.status]));
}

function observedStatusById(draw: Draw): Map<string, string> {
  return new Map(draw.observed_analysis_ready.options.map((o) => [o.option_id, o.status]));
}

// ---------------------------------------------------------------------------

describe("HARNESS FIDELITY — the reconstruction reproduces the captured wire", () => {
  // A positive control (trap 13): if this suite could not reproduce the
  // capture's `ready` verdicts, nothing it says about the OTHER verdicts would
  // be evidence about the product. These three are `ready` on the wire because
  // they carry interventions, and they must stay `ready` through the fix — the
  // change touches only the zero-intervention branch.
  it.each([
    ["draw-4", "4abad64d"],
    ["draw-4", "939d4630"],
    ["draw-4", "e755ec33"],
  ])("%s option %s reproduces the captured `ready`", (_draw, optionId) => {
    expect(observedStatusById(DRAW_4).get(optionId)).toBe("ready");
    expect(draftPathStatusById(DRAW_4).get(optionId)).toBe("ready");
  });

  it("every captured option id is reconstructed — no arm is silently dropped", () => {
    for (const draw of [DRAW_4, DRAW_5, DRAW_9]) {
      const rebuilt = draftPathStatusById(draw);
      for (const observed of draw.observed_analysis_ready.options) {
        expect(rebuilt.has(observed.option_id)).toBe(true);
      }
      expect(rebuilt.size).toBe(draw.observed_analysis_ready.options.length);
    }
  });
});

describe("THE DEFECT AS CAPTURED — historic record, append-only", () => {
  // This is what the deployed build emitted on 19 Aug 2026. It is a record,
  // not an expectation about current behaviour: it must NOT be updated when
  // the product is fixed.
  it.each([
    ["draw-9", "4abad64d"],
    ["draw-9", "c94b4086"],
    ["draw-9", "cbf30a46"],
    ["draw-9", "e755ec33"],
    ["draw-5", "4abad64d"],
    ["draw-5", "e755ec33"],
  ])("%s option %s WAS emitted as needs_user_mapping", (drawKey, optionId) => {
    expect(observedStatusById(DRAWS[drawKey]).get(optionId)).toBe("needs_user_mapping");
  });
});

describe("connected-but-numberless options ask for the VALUE, not the mapping", () => {
  // ⭐ THE RED-FIRST ASSERTION. Each of these option ids carries at least one
  // NON-repair-authored option→factor edge and zero interventions. Before the
  // fix every one of them came back `needs_user_mapping`.
  it.each([
    ["draw-9", "4abad64d"],
    ["draw-9", "c94b4086"],
    ["draw-9", "cbf30a46"],
    ["draw-9", "e755ec33"],
    ["draw-5", "4abad64d"],
    ["draw-5", "e755ec33"],
    ["draw-4", "e5dc21d6"],
  ])("%s option %s is needs_encoding", (drawKey, optionId) => {
    expect(draftPathStatusById(DRAWS[drawKey]).get(optionId)).toBe("needs_encoding");
  });

  it("the reason names the connection rather than claiming nothing was extracted", () => {
    const graph = DRAW_9.draft_graph;
    const payload = buildAnalysisReadyPayload(optionsFromGraph(graph), goalNodeId(graph), graph);
    const option = payload.options.find((o) => o.id === "cbf30a46");
    expect(option?.status).toBe("needs_encoding");
    expect(option?.status_reason).toMatch(/awaiting effect value/i);
  });
});

describe("BOUNDARIES", () => {
  it("REPAIR-AUTHORED EDGES ARE NOT A MAPPING — draw-5 e405d56a stays needs_user_mapping", () => {
    // Both of this option's edges carry `origin: "repair"`. Asserted here from
    // the capture itself so the premise of the case cannot rot silently.
    const graph = DRAW_5.draft_graph;
    const kind = new Map((graph.nodes as NodeV3T[]).map((n) => [n.id, n.kind]));
    const edges = (graph.edges as Array<{ from: string; to: string; origin?: string }>).filter(
      (e) => e.from === "e405d56a" && kind.get(e.to) === "factor",
    );
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.origin === "repair")).toBe(true);

    expect(draftPathStatusById(DRAW_5).get("e405d56a")).toBe("needs_user_mapping");
  });

  it("NO CONNECTED FACTOR AT ALL is genuinely needs_user_mapping", () => {
    // Derived from the real draw-9 graph by removing one option's edges — a
    // control, and labelled as one. Every OTHER option is untouched and must
    // keep its corrected verdict, so this also proves the rule is per-option
    // and not a whole-payload switch.
    const graph = DRAW_9.draft_graph;
    const stripped = {
      ...graph,
      edges: (graph.edges as Array<{ from: string }>).filter((e) => e.from !== "cbf30a46"),
    } as unknown as GraphV3T;
    const payload = buildAnalysisReadyPayload(
      optionsFromGraph(graph),
      goalNodeId(graph),
      stripped,
    );
    const byId = new Map(payload.options.map((o) => [o.id, o.status]));
    expect(byId.get("cbf30a46")).toBe("needs_user_mapping");
    expect(byId.get("c94b4086")).toBe("needs_encoding");
  });

  it("PARTIALLY CONFIGURED — one value set of two connected factors stays ready", () => {
    // draw-4 e755ec33 has an intervention AND connected factors. The fix must
    // not reach any option whose intervention count is non-zero.
    const graph = DRAW_4.draft_graph;
    const options = optionsFromGraph(graph);
    const target = options.find((o) => o.id === "e755ec33");
    expect(Object.keys(target?.interventions ?? {}).length).toBeGreaterThan(0);
    expect(draftPathStatusById(DRAW_4).get("e755ec33")).toBe("ready");
  });
});
