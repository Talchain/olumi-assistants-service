/**
 * ⭐⭐ THE HELD BASELINE — TWO AUTHORITIES READ THE SAME FLAG AND ONLY ONE OF
 * THEM ACTS ON IT, SO THE PRODUCT DEMANDS A MAPPING THAT CANNOT EXIST.
 *
 * THE DEFECT, MEASURED ON A LIVE JOURNEY (deployed staging build `0168483`,
 * 18 Sep 2026, scenario `d1795668-4a7d-4ef0-a77c-04ab206d6fce`). Option
 * `bad0f75e` "Status Quo (Hold Current Plan)" arrived on the wire with
 * `is_baseline: true` and `interventions: {}`.
 *
 *   · RUN ADMISSION reads the flag. `analysable-option-gate.ts` HOLDS a
 *     `is_baseline === true` option with no interventions and submits it,
 *     because "holding every factor at its own observed value *is* the
 *     complete and correct specification of 'no change'" (its own docblock).
 *     That is why the analysis completed and the status quo scored.
 *   · READINESS does not. `option-status.ts` saw `interventionCount === 0`
 *     and `connectedFactorCount === 0` and returned `needs_user_mapping`.
 *
 * Same object, same turn, opposite answers. The flag was three lines away:
 * `analysis-ready.ts` computed every option's status and THEN stamped
 * `is_baseline`.
 *
 * WHY THE USER CANNOT ESCAPE IT. The readiness ask — "choose which factor
 * this option changes and by how much" — HAS NO ANSWERABLE FORM for a
 * baseline: supplying the mapping would stop it being the status quo. The one
 * affordance the product offered led straight into that: the user sent the
 * product's own chip message and was told, correctly, that there is nothing to
 * configure — while the same response still carried the blocker. Both halves
 * of that circle are recorded verbatim in the fixture beside this file.
 *
 * WHAT THIS SUITE PINS. The RENDERED SENTENCE, not a field: the blocker copy
 * asserted here is read from the capture's own `observed_readiness_blockers`,
 * so the pin cannot drift from what the product actually said.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE `option_id`.
 * Counts are never the subject of an assertion.
 *
 * THE DISCRIMINATOR IS THE FLAG, NOT THE EMPTINESS. `is_baseline` is flipped
 * to `false` on the SAME captured option in `BOUNDARIES` below; it must return
 * to `needs_user_mapping`. Without that pair, a fix that simply stopped asking
 * about empty options would pass.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { assessCanonicalAnalysisReadiness } from "../../../orchestrator/tools/analysis-ready-helper.js";
import type { GraphV3T, NodeV3T, OptionV3T, InterventionV3T } from "../../../schemas/cee-v3.js";
import { buildAnalysisReadyPayload, labelMatchesBaseline } from "../analysis-ready.js";
import { computeOptionStatus } from "../option-status.js";

// ---------------------------------------------------------------------------
// The capture. APPEND-ONLY HISTORIC RECORD (trap 14b) — never edited to match
// new behaviour.
// ---------------------------------------------------------------------------

interface ObservedOption {
  readonly option_id: string;
  readonly label: string;
  readonly status: string;
  readonly status_reason?: string;
  readonly is_baseline?: boolean | null;
  readonly intervention_count: number;
}
interface ObservedBlocker {
  readonly code: string;
  readonly message: string;
  readonly option_id?: string;
  readonly option_label?: string;
}
interface Capture {
  readonly captured_at: string;
  readonly scenario_id: string;
  readonly draft_graph: GraphV3T;
  readonly observed_analysis_ready: {
    readonly status: string;
    readonly options: readonly ObservedOption[];
  };
  readonly observed_readiness_blockers_t1: readonly ObservedBlocker[];
  readonly observed_readiness_blockers_t4: readonly ObservedBlocker[];
  readonly observed_suggested_actions_t1: readonly { id: string; label: string; message: string }[];
  readonly observed_suggested_actions_t4: readonly unknown[];
  readonly observed_assistant_text_t4: string;
  readonly t4_request_message: string;
  readonly observed_analysis_ready_status_t4: string;
}

const CAPTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/held-baseline-journey-2026-09-18.json", import.meta.url)),
    "utf-8",
  ),
) as Capture;

/** THE option this suite is about, named once, by id. */
const BASELINE_ID = "bad0f75e";
/** A configured sibling — the positive control for every harness claim. */
const CONFIGURED_ID = "57b38228";
/** A second configured sibling, connected by TWO non-repair edges. */
const TWO_EDGE_ID = "3fb49c45";

// ---------------------------------------------------------------------------
// Reconstruction of the draft path from the captured graph
// ---------------------------------------------------------------------------

type RawOptionNode = {
  id: string;
  label: string;
  interventions?: Record<string, InterventionV3T>;
  is_baseline?: boolean | null;
};

/**
 * Rebuild the V3 options the draft path hands to `buildAnalysisReadyPayload`.
 * The option's `status` is NOT typed in — it is computed by the extractor's own
 * producer, so this suite cannot encode its own model of the extractor
 * (trap 13c).
 */
function optionsFromGraph(graph: GraphV3T): OptionV3T[] {
  return (graph.nodes as NodeV3T[])
    .filter((node) => node.kind === "option")
    .map((node) => {
      const raw = node as unknown as RawOptionNode;
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

function payloadFor(graph: GraphV3T) {
  return buildAnalysisReadyPayload(optionsFromGraph(graph), goalNodeId(graph), graph);
}

function statusById(graph: GraphV3T): Map<string, string> {
  return new Map(payloadFor(graph).options.map((o) => [o.id, o.status]));
}

function clone(): GraphV3T {
  return JSON.parse(JSON.stringify(CAPTURE.draft_graph)) as GraphV3T;
}

function optionNode(graph: GraphV3T, id: string): RawOptionNode {
  const node = (graph.nodes as NodeV3T[]).find((n) => n.id === id) as unknown as RawOptionNode | undefined;
  if (!node) throw new Error(`captured graph carries no node ${id}`);
  return node;
}

function dropOptionFactorEdges(graph: GraphV3T, optionId: string): void {
  const kind = new Map((graph.nodes as NodeV3T[]).map((n) => [n.id, n.kind]));
  (graph as unknown as { edges: Array<{ from: string; to: string }> }).edges = (
    graph as unknown as { edges: Array<{ from: string; to: string }> }
  ).edges.filter((e) => !(e.from === optionId && kind.get(e.to) === "factor"));
}

/** The captured blocker sentence for the baseline, read from the record itself. */
const CAPTURED_BASELINE_BLOCKER = CAPTURE.observed_readiness_blockers_t1.find(
  (b) => b.option_id === BASELINE_ID,
);

// ---------------------------------------------------------------------------

describe("THE JOURNEY AS CAPTURED — historic record, append-only", () => {
  it("the wire carried `is_baseline: true` AND `needs_user_mapping` on the same option", () => {
    const observed = CAPTURE.observed_analysis_ready.options.find(
      (o) => o.option_id === BASELINE_ID,
    );
    expect(observed?.label).toBe("Status Quo (Hold Current Plan)");
    expect(observed?.is_baseline).toBe(true);
    expect(observed?.intervention_count).toBe(0);
    expect(observed?.status).toBe("needs_user_mapping");
    expect(observed?.status_reason).toBe("No interventions extracted");
    expect(CAPTURE.observed_analysis_ready.status).toBe("needs_user_mapping");
  });

  it("the only affordance offered led to the option the product then said was unconfigurable", () => {
    expect(CAPTURE.observed_suggested_actions_t1).toHaveLength(1);
    expect(CAPTURE.observed_suggested_actions_t1[0]!.id).toBe("chip_prompt_configure_option");
    expect(CAPTURE.observed_suggested_actions_t1[0]!.message).toBe(
      "Help me configure Status Quo (Hold Current Plan).",
    );
    // The user sent exactly that message.
    expect(CAPTURE.t4_request_message).toBe("Help me configure Status Quo (Hold Current Plan).");
    expect(CAPTURE.observed_assistant_text_t4).toContain(
      "There is nothing to configure for this option",
    );
    // …and the blocker was still on screen in that same response, with no
    // affordance left to act on.
    expect(CAPTURE.observed_suggested_actions_t4).toHaveLength(0);
    expect(
      CAPTURE.observed_readiness_blockers_t4.some(
        (b) => b.option_id === BASELINE_ID && b.code === "OPTION_NEEDS_MAPPING",
      ),
    ).toBe(true);
    expect(CAPTURE.observed_analysis_ready_status_t4).toBe("needs_user_mapping");
  });

  it("the blocker sentence this suite pins is the one the product actually rendered", () => {
    expect(CAPTURED_BASELINE_BLOCKER).toBeDefined();
    expect(CAPTURED_BASELINE_BLOCKER!.code).toBe("OPTION_NEEDS_MAPPING");
    expect(CAPTURED_BASELINE_BLOCKER!.message).toBe(
      'Choose which factor "Status Quo (Hold Current Plan)" changes and by how much.'
        + " Olumi has already linked it to 5 factors to keep the model connected,"
        + " but that link is Olumi's own inference rather than a mapping you stated,"
        + " and it carries no effect value.",
    );
  });
});

describe("HARNESS FIDELITY — the reconstruction reproduces the captured wire", () => {
  // A positive control (trap 13): if this suite could not reproduce the
  // capture's `ready` verdicts, nothing it says about the OTHER verdict would
  // be evidence about the product.
  it.each([[CONFIGURED_ID], [TWO_EDGE_ID], ["68c0488d"], ["edbad1ba"]])(
    "option %s reproduces the captured `ready`",
    (optionId) => {
      const observed = CAPTURE.observed_analysis_ready.options.find(
        (o) => o.option_id === optionId,
      );
      expect(observed?.status).toBe("ready");
      expect(statusById(CAPTURE.draft_graph).get(optionId)).toBe("ready");
    },
  );

  it("every captured option id is reconstructed — no arm is silently dropped", () => {
    const rebuilt = statusById(CAPTURE.draft_graph);
    for (const observed of CAPTURE.observed_analysis_ready.options) {
      expect(rebuilt.has(observed.option_id)).toBe(true);
    }
    expect(rebuilt.size).toBe(CAPTURE.observed_analysis_ready.options.length);
  });

  it("the baseline's five edges are ALL repair-authored — the premise of the defect", () => {
    const graph = CAPTURE.draft_graph;
    const kind = new Map((graph.nodes as NodeV3T[]).map((n) => [n.id, n.kind]));
    const edges = (graph.edges as Array<{ from: string; to: string; origin?: string }>).filter(
      (e) => e.from === BASELINE_ID && kind.get(e.to) === "factor",
    );
    expect(edges).toHaveLength(5);
    expect(edges.every((e) => e.origin === "repair")).toBe(true);
    expect(optionNode(graph, BASELINE_ID).is_baseline).toBe(true);
    expect(Object.keys(optionNode(graph, BASELINE_ID).interventions ?? {})).toHaveLength(0);
  });
});

describe("A HELD BASELINE IS READY — the question readiness was asking has no answerable form", () => {
  it("the captured baseline is `ready`, not `needs_user_mapping`", () => {
    expect(statusById(CAPTURE.draft_graph).get(BASELINE_ID)).toBe("ready");
  });

  it("its reason says why, rather than claiming nothing was extracted", () => {
    const option = payloadFor(CAPTURE.draft_graph).options.find((o) => o.id === BASELINE_ID);
    expect(option?.status).toBe("ready");
    expect(option?.is_baseline).toBe(true);
    expect(option?.status_reason).toMatch(/baseline|observed value/i);
    expect(option?.status_reason).not.toBe("No interventions extracted");
  });

  it("the WHOLE-MODEL status clears too — no `blocked` with zero blockers", () => {
    // Without the rollup limb this payload stays `needs_user_mapping` while
    // every option is ready and no blocker names one — the shape already
    // recorded at `compose/analysis-state-v1.ts`.
    expect(payloadFor(CAPTURE.draft_graph).status).toBe("ready");
  });
});

describe("THE RENDERED SENTENCE — the copy the user actually read", () => {
  it("the captured blocker sentence is no longer emitted for the baseline", () => {
    const assessment = assessCanonicalAnalysisReadiness(CAPTURE.draft_graph);

    // PRECONDITION, PINNED IN-TEST (trap 13b): the captured graph must reach
    // the semantic branch at all. A `SCHEMA_INVALID`/`NO_GRAPH` short-circuit
    // would satisfy every absence assertion below for the wrong reason.
    expect(assessment.analysisReady).toBeDefined();
    expect(
      assessment.analysisReady!.options.some((o) => o.option_id === BASELINE_ID),
    ).toBe(true);

    const messages = assessment.blockingIssues.map((i) => i.message ?? "");
    expect(messages).not.toContain(CAPTURED_BASELINE_BLOCKER!.message);
    expect(
      assessment.blockingIssues.some(
        (i) => i.option_id === BASELINE_ID && i.code === "OPTION_NEEDS_MAPPING",
      ),
    ).toBe(false);
    expect(
      assessment.blockingIssues.every(
        (i) => !/which factor "Status Quo \(Hold Current Plan\)"/.test(i.message ?? ""),
      ),
    ).toBe(true);
  });

  it("the wire option reports `ready` through the canonical projection too", () => {
    const assessment = assessCanonicalAnalysisReadiness(CAPTURE.draft_graph);
    const wire = assessment.analysisReady!.options.find((o) => o.option_id === BASELINE_ID);
    expect(wire?.is_baseline).toBe(true);
    expect(wire?.status).toBe("ready");
  });
});

describe("BOUNDARIES — the discriminator is the FLAG, not the emptiness", () => {
  // ⭐ THE DISCRIMINATING PAIR (trap 19). Both halves run on THE SAME captured
  // option with THE SAME non-idiomatic label, so the only thing that moves
  // between them is the flag. A fix that merely stopped asking about empty
  // options would pass the GREEN half and fail the RED one.
  //
  // The label is changed in BOTH halves on purpose: "Status Quo (Hold Current
  // Plan)" carries a baseline IDIOM, which is the product's own second-priority
  // detector (`detectBaselineOptionIndex`), so leaving it in place would let the
  // label decide the verdict and the pair would discriminate nothing — it would
  // be a guard agreeing with itself (trap 13b).
  function relabelledBaseline(flag: boolean | undefined): GraphV3T {
    const graph = clone();
    const node = optionNode(graph, BASELINE_ID);
    node.label = "Plan Alpha";
    if (flag === undefined) delete node.is_baseline;
    else node.is_baseline = flag;
    // PRECONDITION, PINNED IN-TEST: the label must genuinely NOT be idiomatic,
    // or this pair is measuring the idiom rather than the flag.
    expect(labelMatchesBaseline("Plan Alpha")).toBe(false);
    expect(labelMatchesBaseline("Status Quo (Hold Current Plan)")).toBe(true);
    return graph;
  }

  it("THE PAIR'S GREEN HALF: flag `true`, non-idiomatic label → ready", () => {
    expect(statusById(relabelledBaseline(true)).get(BASELINE_ID)).toBe("ready");
  });

  it("THE PAIR'S RED HALF: flag `false`, same option, same label → needs_user_mapping", () => {
    const graph = relabelledBaseline(false);
    expect(statusById(graph).get(BASELINE_ID)).toBe("needs_user_mapping");
    // …and the mapping ask comes back for that exact option.
    const assessment = assessCanonicalAnalysisReadiness(graph);
    expect(
      assessment.blockingIssues.some(
        (i) => i.option_id === BASELINE_ID && i.code === "OPTION_NEEDS_MAPPING",
      ),
    ).toBe(true);
  });

  it("STRICTLY `=== true`: an ABSENT flag does not hold, it excludes", () => {
    // Mirrors `analysable-option-gate.ts::isBaselineOption`, which fails toward
    // saying less. A missing verdict must not silently ready an option.
    expect(statusById(relabelledBaseline(undefined)).get(BASELINE_ID)).toBe(
      "needs_user_mapping",
    );
  });

  it("THE LABEL IDIOM IS A SECOND RUNG, AND READINESS NOW SHARES IT WITH RUN ADMISSION", () => {
    // ⚠ DISCLOSED, NOT INHERITED. `detectBaselineOptionIndex` priority 2 reads
    // the LABEL when no option carries an explicit `true`, and it does so even
    // where a label-bearing option carries an explicit `false`. That predicate
    // is UNCHANGED by this PR — what changes is that its result now also
    // decides readiness.
    //
    // That is the point rather than a side effect: the very same stamped flag
    // is what `analysis-ready-core.ts` hands to
    // `analysable-option-gate.ts::isBaselineOption`, so the two authorities
    // cannot diverge on this population. Pinned here at BOTH ends — the stamped
    // wire flag AND the status — so a future change to either rung fails loud.
    const graph = clone();
    optionNode(graph, BASELINE_ID).is_baseline = false; // idiomatic label kept
    const option = payloadFor(graph).options.find((o) => o.id === BASELINE_ID);
    expect(option?.is_baseline).toBe(true);
    expect(option?.status).toBe("ready");

    const wire = assessCanonicalAnalysisReadiness(graph).analysisReady!.options.find(
      (o) => o.option_id === BASELINE_ID,
    );
    // The flag the run gate reads and the status readiness reports agree.
    expect(wire?.is_baseline).toBe(true);
    expect(wire?.status).toBe("ready");
  });

  it("A NON-BASELINE OPTION WITH NOTHING STATED is still needs_user_mapping", () => {
    const graph = clone();
    optionNode(graph, TWO_EDGE_ID).interventions = {};
    dropOptionFactorEdges(graph, TWO_EDGE_ID);
    expect(optionNode(graph, TWO_EDGE_ID).is_baseline).not.toBe(true);
    expect(statusById(graph).get(TWO_EDGE_ID)).toBe("needs_user_mapping");
  });

  it("CONNECTED BUT NUMBERLESS is untouched — it still asks for the VALUE", () => {
    // Protects the ROADMAP 2.1266 ruling: a non-baseline option with a genuine
    // (non-repair) option→factor edge and no value is `needs_encoding`.
    const graph = clone();
    optionNode(graph, CONFIGURED_ID).interventions = {};
    expect(statusById(graph).get(CONFIGURED_ID)).toBe("needs_encoding");
  });

  it("REPAIR EDGES STILL COUNT FOR NOTHING — a NON-baseline option wired only by repair asks for the mapping", () => {
    const graph = clone();
    // Re-point the baseline's five repair edges at a configured option, and
    // empty that option. Real repair-authored edges, a non-baseline owner.
    optionNode(graph, TWO_EDGE_ID).interventions = {};
    dropOptionFactorEdges(graph, TWO_EDGE_ID);
    for (const edge of (graph as unknown as { edges: Array<{ from: string; origin?: string }> }).edges) {
      if (edge.from === BASELINE_ID && edge.origin === "repair") edge.from = TWO_EDGE_ID;
    }
    expect(statusById(graph).get(TWO_EDGE_ID)).toBe("needs_user_mapping");
  });

  it("A BASELINE THAT DID STATE INTERVENTIONS IS UNAFFECTED — the fix reaches only the empty case", () => {
    const graph = clone();
    const configured = optionNode(graph, CONFIGURED_ID);
    configured.is_baseline = true;
    optionNode(graph, BASELINE_ID).is_baseline = false;
    expect(Object.keys(configured.interventions ?? {}).length).toBeGreaterThan(0);
    expect(statusById(graph).get(CONFIGURED_ID)).toBe("ready");
  });

  it("THE FALLBACK QUESTION DOES NOT NAME THE BASELINE — the other user-visible sentence", () => {
    // ⭐ A SECOND RENDERED STRING, ON A BRANCH THE HAPPY PATH CANNOT REACH.
    // When some OTHER option is genuinely unmapped, `buildAnalysisReadyPayload`
    // mints "Which factors and values should be specified for: <labels>". The
    // held baseline must not appear in that list — it would put the same
    // unanswerable ask back in front of the user by a different route.
    const graph = clone();
    optionNode(graph, TWO_EDGE_ID).interventions = {};
    dropOptionFactorEdges(graph, TWO_EDGE_ID);
    const payload = payloadFor(graph);

    // PRECONDITION, PINNED IN-TEST: the branch must actually be reached.
    expect(payload.status).toBe("needs_user_mapping");
    const questions = payload.user_questions ?? [];
    expect(questions.some((q) => q.startsWith("Which factors and values should be specified for:"))).toBe(true);

    const joined = questions.join(" | ");
    expect(joined).toContain("invest two engineers for a quarter in the onboarding flow");
    expect(joined).not.toContain("Status Quo (Hold Current Plan)");
  });

  it("AN UPSTREAM `needs_encoding` IS PRESERVED — a stated effect that could not be represented is a different fact", () => {
    const graph = CAPTURE.draft_graph;
    const options = optionsFromGraph(graph).map((o) =>
      o.id === BASELINE_ID ? ({ ...o, status: "needs_encoding" } as OptionV3T) : o,
    );
    const payload = buildAnalysisReadyPayload(options, goalNodeId(graph), graph);
    expect(payload.options.find((o) => o.id === BASELINE_ID)?.status).toBe("needs_encoding");
  });
});
