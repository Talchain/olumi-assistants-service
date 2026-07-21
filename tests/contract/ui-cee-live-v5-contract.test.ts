/**
 * LOAD-BEARING cross-boundary contract test: the LIVE V5 wire (UI → CEE).
 *
 * This is the gate that `ui-cee-contract.test.ts` was NOT: the sibling file
 * pins the V1-route-derived `TurnRequestSchema` (client_turn_id, flat
 * conversation_history) whose only runtime importers are the 410'd V1 routes.
 * That schema REJECTS a real `/orchestrate/v2/turn` payload — so the exported
 * `contracts/turn-request.schema.json` and the "Contract schemas" CI job were
 * self-blind: green while guarding the dead path.
 *
 * TWO fixtures, TWO contracts:
 *
 *   1. `ui-v5-turn-message.live.json` — the TRUE live wire shape, byte-derived
 *      from the UI's live V5 outbound builder (`DecisionGuideAI/src/v5/
 *      buildPayload.ts` @ DGAI 6bc31128d): `buildV5Payload` posts its core keys
 *      ONLY — `{kind:'message', turn_id, scenario_id, stage, turn_class,
 *      message, source, chip?, retry_of?}` — with turn_class hardcoded 'frame'
 *      at the sole live call site. It carries NO extension fields: caller
 *      identity travels via HTTP headers, and the graph_state-attaching request
 *      builder targets the 410'd V1 route. So on the live wire TODAY
 *      `graph_state / analysis_state / user_id / selected_elements` are ABSENT.
 *      The live contract this test pins is therefore: B1 ACCEPTS the core
 *      shape, and all four extensions parse to NULL (trap-16: the V5 wire sends
 *      no graph). Populate any extension in the live fixture and the null
 *      assertions below go red — the pin is mutation-proven.
 *
 *   2. `ui-v5-turn-message.cee-capability.json` — a CEE-CAPABILITY fixture with
 *      NO live producer today (trap-16). It exercises `parseRequestExtensions`'
 *      handling of the four extension fields so that IF a producer ever starts
 *      sending them on this wire they are validated at the boundary rather than
 *      silently dropped. This is CEE's parsing capability, NOT the UI's current
 *      behaviour — see tests/fixtures/golden/PROVENANCE.md.
 *
 * Both are driven through the REAL pre-flight primitives — the exact ones
 * `runPreFlight` composes, in its REAL order (route-v2-preflight.ts):
 * `parseRequestExtensions` FIRST on the raw body → `stripExtensionFields` →
 * `validateIngress` (B1) on the stripped body. Mutate a wire key and this test
 * goes red: it executes and discriminates.
 *
 * UUID / vocabulary traps (the ones the audit hit): B1's `turn_id` /
 * `scenario_id` are UUIDv4-pattern; `stage` ∈ {frame,analyse,decide,review};
 * `turn_class` ∈ {frame,clarify,propose,decide,review}; `source` ∈
 * {composer,chip,chip_click,retry}.
 */
import { describe, it, expect } from "vitest";

import { stripExtensionFields } from "../../src/orchestrator/route-v2-preflight.js";
import { validateIngress } from "../../src/validators/b1.js";
import { parseRequestExtensions } from "../../src/orchestrator-v5/boundary/request-extensions.js";
import { TurnRequestSchema } from "../../src/orchestrator/route-schemas.js";

import liveFixture from "../fixtures/golden/ui-v5-turn-message.live.json";
import ceeCapabilityFixture from "../fixtures/golden/ui-v5-turn-message.cee-capability.json";

// The JSON import is a shared module singleton — deep-clone per case so a
// mutation in one test cannot leak into another.
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe("UI → CEE LIVE V5 contract (the real /orchestrate/v2/turn wire)", () => {
  it("positive control: the exported V1 contract (TurnRequestSchema) REJECTS the live V5 shape — this is the self-blind defect", () => {
    // Documents WHY ui-cee-contract.test.ts's green was theatre: the live wire
    // carries `turn_id` (not the required `client_turn_id`) and V5 vocabulary.
    const result = TurnRequestSchema.safeParse(clone(liveFixture));
    expect(result.success).toBe(false);
  });

  it("the LIVE pre-flight chain (parseExtensions → strip → B1) ACCEPTS the real V5 wire and finds NO extensions", () => {
    const body = clone(liveFixture);

    // Real order: extensions parse off the RAW body first.
    const ext = parseRequestExtensions(body, "req-live");
    expect(ext.ok).toBe(true);
    if (ext.ok) {
      // THE LIVE CONTRACT TODAY: the wire carries no graph / analysis /
      // identity / selection, so every extension parses to null. Populate any
      // of them in `ui-v5-turn-message.live.json` and one of these assertions
      // goes red (mutation-proven — this is not a vacuous absence check).
      expect(ext.value.graphState).toBeNull();
      expect(ext.value.analysisState).toBeNull();
      expect(ext.value.userId).toBeNull();
      expect(ext.value.selectedElements).toBeNull();
    }

    // ...then the extension keys are stripped (a no-op here — none present) and
    // B1 validates the core turn.
    const stripped = stripExtensionFields(body);
    const ingress = validateIngress(stripped, "req-live");
    expect(ingress.ok).toBe(true);
  });

  it("B1 rejects a non-UUID turn_id (discriminator — mutate the wire and it goes red)", () => {
    const body = clone(liveFixture) as Record<string, unknown>;
    body.turn_id = "not-a-uuid";
    const ingress = validateIngress(stripExtensionFields(body), "req-bad-uuid");
    expect(ingress.ok).toBe(false);
  });

  it("B1 rejects a message turn missing turn_class (discriminator)", () => {
    const body = clone(liveFixture) as Record<string, unknown>;
    delete body.turn_class;
    const ingress = validateIngress(stripExtensionFields(body), "req-no-turn-class");
    expect(ingress.ok).toBe(false);
  });

  it("B1 fail-closes on an unknown non-extension top-level key — it is NOT silently stripped", () => {
    // The fail-closed doctrine in action: a field the UI newly starts sending
    // that is neither a B1 core field nor a declared extension survives the
    // strip and B1's .strict() rejects it with a 422 — loud, not dropped.
    const body = clone(liveFixture) as Record<string, unknown>;
    body.brand_new_wire_field = { anything: true };
    const stripped = stripExtensionFields(body) as Record<string, unknown>;
    expect("brand_new_wire_field" in stripped).toBe(true);
    const ingress = validateIngress(stripped, "req-unknown-key");
    expect(ingress.ok).toBe(false);
  });
});

describe("CEE-CAPABILITY extension parsing (no live producer today — trap-16: the V5 wire sends no graph)", () => {
  it("the pre-flight core still ACCEPTS the enriched body once extensions are stripped", () => {
    const body = clone(ceeCapabilityFixture);
    const ingress = validateIngress(stripExtensionFields(body), "req-cap");
    expect(ingress.ok).toBe(true);
  });

  it("parseRequestExtensions parses all four extension fields to non-null values", () => {
    const body = clone(ceeCapabilityFixture);
    const ext = parseRequestExtensions(body, "req-cap");
    expect(ext.ok).toBe(true);
    if (ext.ok) {
      // Presence proves the parser reads each field — not a vacuous absence.
      expect(ext.value.graphState).not.toBeNull();
      expect(ext.value.analysisState).not.toBeNull();
      expect(ext.value.userId).not.toBeNull();
      expect(ext.value.selectedElements).not.toBeNull();
    }
  });

  it("parseRequestExtensions rejects a structurally invalid graph_state node (discriminator)", () => {
    const body = clone(ceeCapabilityFixture) as {
      graph_state: { nodes: Array<Record<string, unknown>> };
    };
    delete body.graph_state.nodes[0].label; // node.label is required by the ingress schema
    const ext = parseRequestExtensions(body, "req-bad-graph");
    expect(ext.ok).toBe(false);
  });
});
