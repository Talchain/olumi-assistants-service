/**
 * ⭐ THE TELEMETRY COUNTERS MUST PARTITION THE OPTIONS, NOT DOUBLE-COUNT THEM.
 *
 * THE DEFECT THIS PINS. `optionsNeedingEncoding` is strict
 * (`status === "needs_encoding"`) while `optionsNeedingMapping` was LOOSE
 * (`status === "needs_user_mapping" || interventions empty`). Once a
 * connected-but-numberless option started reporting `needs_encoding` honestly,
 * the SAME option was counted by BOTH — measured four counted on two options.
 *
 * AND THE CONSEQUENCE IS OBSERVABILITY, WHICH IS WHY IT IS WORTH A TEST. The
 * loose limb pins `optionsNeedingMapping` regardless of the status, so an
 * operator watching that counter to confirm the change landed would have seen
 * NO MOVEMENT AT ALL. A change justified by a 9/9 measurement would have
 * shipped un-observable.
 *
 * ⛔ THE BOUND THAT MUST NOT BE "TIDIED" INTO THIS ONE. `hasIncompleteOptions`
 * in the same function keeps its loose limb deliberately: it is what holds
 * `analysis_ready.status` still for this class, and the payload status is a
 * user-visible gate input. The two predicates LOOK identical and answer
 * different questions — telemetry counts a STATUS, admission counts an
 * EMPTINESS. The last assertion here pins that separation, so a future edit
 * that "makes them consistent" REDs instead of moving a gate.
 *
 * This file mocks telemetry because the counters exist only on the emitted
 * event; it is kept separate from the behaviour suite so that mock cannot
 * perturb it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach } from "vitest";

const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];

vi.mock("../../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: (event: string, payload: Record<string, unknown>) => {
    emitted.push({ event, payload });
  },
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

const { buildAnalysisReadyPayload } = await import("../analysis-ready.js");
const { computeOptionStatus } = await import("../option-status.js");
type GraphV3T = import("../../../schemas/cee-v3.js").GraphV3T;
type NodeV3T = import("../../../schemas/cee-v3.js").NodeV3T;
type OptionV3T = import("../../../schemas/cee-v3.js").OptionV3T;
type InterventionV3T = import("../../../schemas/cee-v3.js").InterventionV3T;

const DRAWS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/sendable-variance-draws-2026-08-19.json", import.meta.url)),
    "utf-8",
  ),
) as Record<string, { draft_graph: GraphV3T }>;

function optionsFromGraph(graph: GraphV3T): OptionV3T[] {
  return (graph.nodes as NodeV3T[])
    .filter((node) => node.kind === "option")
    .map((node) => {
      const raw = node as unknown as {
        id: string; label: string; interventions?: Record<string, InterventionV3T>;
      };
      const interventions = raw.interventions ?? {};
      return {
        id: raw.id,
        label: raw.label,
        status: computeOptionStatus({ interventions }).status,
        interventions,
      } as unknown as OptionV3T;
    });
}

function buildAndCapture(drawKey: string) {
  emitted.length = 0;
  const graph = DRAWS[drawKey].draft_graph;
  const goal = (graph.nodes as NodeV3T[]).find((n) => n.kind === "goal")!;
  const payload = buildAnalysisReadyPayload(optionsFromGraph(graph), goal.id, graph);
  const built = emitted.find((e) => e.event === "cee.analysis_ready.built");
  expect(built, "the built event must have been emitted").toBeDefined();
  return { payload, counters: built!.payload as Record<string, number> };
}

beforeEach(() => { emitted.length = 0; });

describe("analysis_ready built-event counters partition the option set", () => {
  it.each(["draw-4", "draw-5", "draw-9"])(
    "%s — ready + needingEncoding + needingMapping never exceeds optionCount",
    (drawKey) => {
      const { counters } = buildAndCapture(drawKey);
      const sum =
        counters.readyOptionsCount
        + counters.optionsNeedingEncoding
        + counters.optionsNeedingMapping;
      expect(sum).toBeLessThanOrEqual(counters.optionCount);
    },
  );

  it("draw-9 — every option is needs_encoding, so the mapping counter reads zero", () => {
    // The measured double-count: this read 4 on 4 options that were ALSO all
    // counted as needing encoding. Bound by identity to the statuses, not to a
    // bare number, so it cannot pass on a coincidence.
    const { payload, counters } = buildAndCapture("draw-9");
    expect(payload.options.every((o) => o.status === "needs_encoding")).toBe(true);
    expect(counters.optionsNeedingEncoding).toBe(payload.options.length);
    expect(counters.optionsNeedingMapping).toBe(0);
  });

  it("the ADMISSION predicate keeps its loose limb — status stays put", () => {
    // `hasIncompleteOptions` must still fire on empty interventions even though
    // every option now reports `needs_encoding`, which is what keeps the
    // payload status off `needs_encoding`/`ready`. If someone "tidies" that
    // predicate to match the counter, this REDs.
    const { payload } = buildAndCapture("draw-9");
    expect(payload.options.every((o) => Object.keys(o.interventions).length === 0)).toBe(true);
    expect(payload.status).not.toBe("ready");
    expect(payload.status).not.toBe("needs_encoding");
  });
});
