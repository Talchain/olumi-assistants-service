/**
 * Derive-or-fail-loud tripwire for the V5 extension-field set.
 *
 * The historical footgun (trap-12, "the dominant defect is the hand-maintained
 * mirror"): a field could be added to `V5_EXTENSION_FIELDS` (so B1's .strict()
 * accepts the body) but NOT wired into `parseRequestExtensions` — the field is
 * then stripped before B1 and never re-parsed: a SILENT DROP.
 *
 * Three lists must agree:
 *   (a) V5RequestExtensionsSchema.shape  — the declarative extension contract
 *   (b) V5_EXTENSION_FIELDS              — the pre-flight strip-list
 *   (c) the keys parseRequestExtensions actually consumes
 *
 * (b) is now DERIVED from (a) in route-v2-preflight.ts, so that mirror cannot
 * drift. This file pins (a)↔(c): add a field to the schema and forget to read
 * it (or map it) and a test here goes red, forcing the wiring.
 */
import { describe, it, expect } from "vitest";

import {
  V5RequestExtensionsSchema,
  parseRequestExtensions,
  type ParsedRequestExtensions,
} from "../../src/orchestrator-v5/boundary/request-extensions.js";
import {
  V5_EXTENSION_FIELDS,
  stripExtensionFields,
} from "../../src/orchestrator/route-v2-preflight.js";

// Wire-key → the ParsedRequestExtensions slot the parser must populate for it.
// This map is itself checked for completeness against the schema below, so it
// cannot silently fall behind a newly-added field.
const KEY_TO_RESULT: Record<string, keyof ParsedRequestExtensions> = {
  graph_state: "graphState",
  analysis_state: "analysisState",
  user_id: "userId",
  selected_elements: "selectedElements",
};

// A structurally-valid value for each wire key, so a "present ⇒ non-null"
// probe exercises the real parse rather than the absent-field short-circuit.
const VALID_VALUE: Record<string, unknown> = {
  graph_state: { nodes: [{ id: "n1", kind: "goal", label: "G" }], edges: [] },
  analysis_state: { analysis_status: "complete" },
  user_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  selected_elements: { node_ids: ["n1"], edge_ids: [] },
};

describe("V5 extension-field set is derived, not mirrored", () => {
  const schemaKeys = Object.keys(V5RequestExtensionsSchema.shape).sort();

  it("(a)↔(b): the pre-flight strip-list equals the extension contract's keys", () => {
    expect([...V5_EXTENSION_FIELDS].sort()).toEqual(schemaKeys);
  });

  it("(a)↔(c): every declared extension field maps to a parser output slot (add a field → wire it here or fail)", () => {
    expect(Object.keys(KEY_TO_RESULT).sort()).toEqual(schemaKeys);
    expect(Object.keys(VALID_VALUE).sort()).toEqual(schemaKeys);
  });

  it("stripExtensionFields removes EXACTLY the contract's extension keys and nothing else", () => {
    const body: Record<string, unknown> = { kind: "message", keep_me: 1 };
    for (const k of schemaKeys) body[k] = VALID_VALUE[k];
    const stripped = stripExtensionFields(body) as Record<string, unknown>;
    for (const k of schemaKeys) expect(k in stripped).toBe(false);
    expect(stripped.kind).toBe("message");
    expect(stripped.keep_me).toBe(1);
  });

  it("parseRequestExtensions consumes every declared field (present ⇒ non-null — no unread key, no silent drop)", () => {
    const body: Record<string, unknown> = {};
    for (const k of schemaKeys) body[k] = VALID_VALUE[k];
    const ext = parseRequestExtensions(body, "req-derive-all");
    expect(ext.ok).toBe(true);
    if (ext.ok) {
      for (const k of schemaKeys) {
        const slot = KEY_TO_RESULT[k];
        expect(ext.value[slot], `extension "${k}" was present but parser left ${slot} null`).not.toBeNull();
      }
    }
  });
});
