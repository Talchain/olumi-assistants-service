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
 * status-quo wiring. There is no representation to choose for a lever nobody
 * stated, so an option in that position must NOT be asked for a value. A fix
 * that counted every edge would flip it and this suite would RED.
 *
 * ⚠⚠ AMENDED 18 Sep 2026 (the held-baseline lane) — THE RULING ABOVE IS INTACT,
 * ITS EXEMPLARS MOVED. Three of this file's captured options carry
 * `is_baseline: true` ON THE CAPTURE — draw-4 `e5dc21d6`, draw-5 `e405d56a`,
 * draw-9 `cbf30a46` — and a declared status quo is now `ready`: `interventions:
 * {}` on a baseline is a COMPLETE statement ("hold every factor at its observed
 * value"), which is the specification `analysable-option-gate.ts` already HELD
 * and SUBMITTED it on. Asking such an option for a mapping, or for an effect-
 * scale representation, is the same unanswerable question in two spellings.
 * So each arm below that used a baseline as its exemplar has been RE-POINTED at
 * a NON-baseline option from the same captures, and the repair-edge ruling is
 * re-proved on a derived non-baseline control. Nothing in
 * `observed_analysis_ready` is edited — it is the historic record (trap 14b).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { assessCanonicalAnalysisReadiness } from "../../../orchestrator/tools/analysis-ready-helper.js";
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

/**
 * Whether the CAPTURE declares this option the status quo. Read from the graph
 * itself, never asserted from memory, so every baseline premise below is pinned
 * to the record.
 */
function isDeclaredBaseline(draw: Draw, optionId: string): boolean {
  const node = (draw.draft_graph.nodes as NodeV3T[]).find(
    (n) => (n as unknown as { id: string }).id === optionId,
  ) as unknown as { is_baseline?: boolean } | undefined;
  return node?.is_baseline === true;
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
    ["draw-9", "e755ec33"],
    ["draw-5", "4abad64d"],
    ["draw-5", "e755ec33"],
  ])("%s option %s is needs_encoding", (drawKey, optionId) => {
    // PRECONDITION, PINNED IN-TEST: none of these is the declared baseline, or
    // this block would be measuring the baseline rule instead of the
    // connected-but-numberless one.
    expect(isDeclaredBaseline(DRAWS[drawKey], optionId)).toBe(false);
    expect(draftPathStatusById(DRAWS[drawKey]).get(optionId)).toBe("needs_encoding");
  });

  // ⭐ RE-POINTED ARMS. `draw-9 cbf30a46` and `draw-4 e5dc21d6` used to sit in
  // the list above. Both carry `is_baseline: true` on the capture, and a
  // declared status quo needs no effect value at all — not a mapping, and not a
  // representation. Bound by identity, and the baseline premise is asserted from
  // the capture so it cannot rot silently.
  it.each([
    ["draw-9", "cbf30a46"],
    ["draw-4", "e5dc21d6"],
    ["draw-5", "e405d56a"],
  ])("%s option %s is a DECLARED BASELINE and is ready", (drawKey, optionId) => {
    expect(isDeclaredBaseline(DRAWS[drawKey], optionId)).toBe(true);
    expect(draftPathStatusById(DRAWS[drawKey]).get(optionId)).toBe("ready");
  });

  it("the reason names the connection rather than claiming nothing was extracted", () => {
    // Re-pointed from `cbf30a46` (the declared baseline) to `c94b4086`, which is
    // connected-but-numberless and is NOT a baseline — the class this assertion
    // is about.
    const graph = DRAW_9.draft_graph;
    expect(isDeclaredBaseline(DRAW_9, "c94b4086")).toBe(false);
    const payload = buildAnalysisReadyPayload(optionsFromGraph(graph), goalNodeId(graph), graph);
    const option = payload.options.find((o) => o.id === "c94b4086");
    expect(option?.status).toBe("needs_encoding");
    expect(option?.status_reason).toMatch(/awaiting effect value/i);
  });
});

describe("BOUNDARIES", () => {
  it("REPAIR-AUTHORED EDGES ARE NOT A MAPPING — the ruling, re-proved on a NON-baseline", () => {
    // Both of this option's edges carry `origin: "repair"`. Asserted here from
    // the capture itself so the premise of the case cannot rot silently.
    const graph = DRAW_5.draft_graph;
    const kind = new Map((graph.nodes as NodeV3T[]).map((n) => [n.id, n.kind]));
    const edges = (graph.edges as Array<{ from: string; to: string; origin?: string }>).filter(
      (e) => e.from === "e405d56a" && kind.get(e.to) === "factor",
    );
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.origin === "repair")).toBe(true);

    // ⚠ ON THE CAPTURE this option is the DECLARED baseline, so its verdict is
    // `ready` and it says nothing either way about repair edges — which is why
    // the ruling is re-proved below on the same option with the baseline
    // declaration and idiom removed. Pinned in BOTH directions so neither rule
    // can quietly absorb the other.
    expect(isDeclaredBaseline(DRAW_5, "e405d56a")).toBe(true);
    expect(draftPathStatusById(DRAW_5).get("e405d56a")).toBe("ready");

    const nonBaseline = JSON.parse(JSON.stringify(graph)) as GraphV3T;
    const node = (nonBaseline.nodes as NodeV3T[]).find(
      (n) => (n as unknown as { id: string }).id === "e405d56a",
    ) as unknown as { is_baseline?: boolean; label: string };
    delete node.is_baseline;
    node.label = "Plan Alpha"; // carries no baseline idiom
    const payload = buildAnalysisReadyPayload(
      optionsFromGraph(nonBaseline),
      goalNodeId(nonBaseline),
      nonBaseline,
    );
    const rebuilt = new Map(payload.options.map((o) => [o.id, o.status]));
    expect(payload.options.find((o) => o.id === "e405d56a")?.is_baseline).not.toBe(true);
    expect(rebuilt.get("e405d56a")).toBe("needs_user_mapping");
    // The OTHER options are untouched — this is a per-option rule, not a switch.
    expect(rebuilt.get("4abad64d")).toBe("needs_encoding");
  });

  it("NO CONNECTED FACTOR AT ALL is genuinely needs_user_mapping", () => {
    // Derived from the real draw-9 graph by removing one option's edges — a
    // control, and labelled as one. Every OTHER option is untouched and must
    // keep its corrected verdict, so this also proves the rule is per-option
    // and not a whole-payload switch.
    // Re-pointed from `cbf30a46` (the declared baseline) to `c94b4086`, which is
    // not one — a baseline with no connections is `ready`, and would therefore
    // have made this control vacuous.
    const graph = DRAW_9.draft_graph;
    expect(isDeclaredBaseline(DRAW_9, "c94b4086")).toBe(false);
    const stripped = {
      ...graph,
      edges: (graph.edges as Array<{ from: string }>).filter((e) => e.from !== "c94b4086"),
    } as unknown as GraphV3T;
    const payload = buildAnalysisReadyPayload(
      optionsFromGraph(graph),
      goalNodeId(graph),
      stripped,
    );
    const byId = new Map(payload.options.map((o) => [o.id, o.status]));
    expect(byId.get("c94b4086")).toBe("needs_user_mapping");
    expect(byId.get("4abad64d")).toBe("needs_encoding");
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

describe("THE USER-FACING COPY — the semantic-issue branch, reached uncovered", () => {
  // ⭐ WHY THIS BLOCK EXISTS. `appendSemanticIssues`
  // (`orchestrator/tools/analysis-ready-helper.ts`) is where the status becomes
  // a SENTENCE — `OPTION_NEEDS_ENCODING` / "Choose how X should be represented
  // on the effect scale" vs `OPTION_NEEDS_MAPPING` / "Choose which factor X
  // changes and by how much". It is also SUPPRESSED for any option a blocker
  // has already named (`coveredOptionIds`).
  //
  // Measured on the captures above: EVERY affected option carries a
  // `MISSING_OPTION_VALUE` blocker, so all seven instances are suppressed and
  // the copy branch is never reached by that corpus. A corpus that cannot reach
  // a branch cannot certify it — so this block reaches it deliberately.
  //
  // HOW, without leaving real data: an option→factor edge to an EXTERNAL factor
  // still counts as a mapping (the edge is the product's established link), but
  // the blocker loop skips non-controllable factors — so the option is
  // `needs_encoding` with no covering blocker. Derived from the real draw-9
  // graph by re-categorising exactly the factors `c94b4086` targets.
  // ⚠ RE-POINTED from `cbf30a46` to `c94b4086` (18 Sep 2026): `cbf30a46` is the
  // capture's DECLARED baseline and is now `ready`, so it can no longer reach
  // the semantic copy branch at all. `c94b4086` is connected-but-numberless and
  // is not a baseline — the class this block exists to cover.
  function draw9WithCbfTargetsExternal(): GraphV3T {
    const graph = JSON.parse(JSON.stringify(DRAW_9.draft_graph)) as GraphV3T;
    const kind = new Map((graph.nodes as NodeV3T[]).map((n) => [n.id, n.kind]));
    const targets = new Set(
      (graph.edges as Array<{ from: string; to: string }>)
        .filter((e) => e.from === "c94b4086" && kind.get(e.to) === "factor")
        .map((e) => e.to),
    );
    expect(targets.size).toBeGreaterThan(0);
    for (const node of graph.nodes as Array<NodeV3T & { category?: string }>) {
      if (targets.has(node.id)) node.category = "external";
    }
    return graph;
  }

  it("an uncovered connected-but-numberless option is asked for the VALUE", () => {
    const assessment = assessCanonicalAnalysisReadiness(draw9WithCbfTargetsExternal());
    const issues = assessment.blockingIssues;

    // PRECONDITION, PINNED IN-TEST (trap 13b): this option must genuinely reach
    // the semantic branch UNCOVERED. If a blocker ever starts naming it, the
    // assertions below would be testing the suppression path instead and would
    // still pass for the wrong reason.
    expect(
      issues.some((i) => i.code === "MISSING_OPTION_VALUE" && i.option_id === "c94b4086"),
    ).toBe(false);
    expect(assessment.analysisReady?.options.find((o) => o.option_id === "c94b4086")?.status)
      .toBe("needs_encoding");

    const issue = issues.find((i) => i.option_id === "c94b4086" && i.code === "OPTION_NEEDS_ENCODING");
    expect(issue).toBeDefined();
    expect(issue!.category).toBe("option_values");
    expect(issue!.message).toMatch(/should be represented on the effect scale/i);

    // And NOT the question this PR exists to stop asking.
    expect(issues.some((i) => i.option_id === "c94b4086" && i.code === "OPTION_NEEDS_MAPPING"))
      .toBe(false);
    expect(issues.every((i) => !(i.option_id === "c94b4086" && /which factor/i.test(i.message ?? ""))))
      .toBe(true);
  });

  it("SUPPRESSION STILL WORKS — an option a blocker already named gets no semantic duplicate", () => {
    // The GREEN half of the pair. `e755ec33` keeps a controllable target, so it
    // keeps its `MISSING_OPTION_VALUE` blocker and must NOT also receive a
    // semantic option issue — otherwise the fix would have doubled the asks.
    const issues = assessCanonicalAnalysisReadiness(draw9WithCbfTargetsExternal()).blockingIssues;
    expect(
      issues.some((i) => i.code === "MISSING_OPTION_VALUE" && i.option_id === "e755ec33"),
    ).toBe(true);
    expect(
      issues.some(
        (i) =>
          i.option_id === "e755ec33"
          && (i.code === "OPTION_NEEDS_ENCODING" || i.code === "OPTION_NEEDS_MAPPING"),
      ),
    ).toBe(false);
  });
});
