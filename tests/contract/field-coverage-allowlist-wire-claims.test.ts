/**
 * Field-coverage allowlist — WIRE-CLAIM enforcement.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `field-coverage.allowlist.json` v1 stored its classifications as free prose,
 * and one of them was false: `trace.repair_summary` was described as
 * "Consumed by debug bundles; never user-facing" while
 * `src/cee/transforms/schema-v3.ts` emits it UNCONDITIONALLY ("Always emitted
 * so the UI can depend on the key existing"), un-gated by `includeDebug`, on
 * both the draft-graph HTTP body and the SSE COMPLETE payload.
 *
 * It could not have been caught. `field-coverage-audit.test.ts` only inspects
 * paths whose HEAD segment is one of the 10 `audited_fields`; `trace`, `_meta`,
 * `answer_source` and `fallback_reason` are not audited heads, and the
 * remaining entries were keyed by bare leaf name while the audit matches
 * fully-qualified paths. Measured at staging tip 55c64ed5: of 4,786 paths
 * walked across the six audit fixtures, ZERO of the 27 classification entries
 * was ever consulted, and deleting all 27 left the suite at 14/14 green.
 * The file read as a contract and was enforced by nothing.
 *
 * WHAT THIS FILE ENFORCES
 * -----------------------
 * The serialisation claim now lives in exactly one machine-checked place —
 * each entry's `wire` field — and is checked BOTH WAYS against a client
 * surface derived from real code, not mirrored by hand:
 *
 *   wire: "serialized"  =>  the exact path MUST be present in the surface
 *   wire: "internal"    =>  the exact path MUST be absent, and any same-named
 *                           leaf that IS serialized elsewhere must be declared
 *                           in `wire_homonyms`
 *
 * Prose may no longer restate a wire claim, and the word "user-facing" is
 * banned outright: conflating "not on the wire" with "not rendered by the UI"
 * is precisely what let the false claim read as true. Whether a field is
 * RENDERED is a separate claim owned by DecisionGuideAI and is what `why`
 * describes.
 *
 * SURFACE PROVENANCE (stated per source so completeness can be judged)
 *   A. REAL CODE     — `transformResponseToV3` output. Authoritative for the
 *                      V3 draft-graph body, which is what both the HTTP route
 *                      (`reply.send(result.body)`) and the SSE route
 *                      (`writeStage(..., { stage: "COMPLETE", payload })`,
 *                      `includeDebug: false`) put on the wire. This is the
 *                      source that makes the trace.* claims self-checking: gate
 *                      `repair_summary` on includeDebug and this surface
 *                      changes, flipping the assertion.
 *   B. REAL CODE     — `toSafeTransportEnrichment` (exported by compose.ts for
 *                      contract tests precisely so they exercise the REAL
 *                      projection). Applied to the staging capture's raw
 *                      enrichment. The raw capture is deliberately NOT used
 *                      directly: it still carries the `_meta` / `downstream_calls`
 *                      carriers the keep-list strips, so trusting it raw would
 *                      let a fixture pin the very leak the code fixes.
 *   C. CAPTURES      — the draft-graph and v5-turn cross-service fixtures, for
 *                      envelope paths (blocks, suggested_actions, coaching)
 *                      that the V3 transform alone does not produce.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";
import { toSafeTransportEnrichment } from "../../src/orchestrator-v5/compose.js";
import allowlist from "./field-coverage.allowlist.json" with { type: "json" };

const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE_DIR = path.join(REPO_ROOT, "tests/fixtures/cross-service");

const CLASSIFIED_CATEGORIES = [
  "diagnostic_allowed",
  "machine_routing_allowed",
  "structured_pointer_allowed",
  "currently_unrendered_but_intentional",
] as const;

interface Entry {
  readonly wire?: unknown;
  readonly why?: unknown;
  readonly emitted_by?: unknown;
  readonly wire_homonyms?: unknown;
}

const typed = allowlist as unknown as Record<string, Record<string, Entry>>;

function entries(): Array<{ category: string; key: string; entry: Entry }> {
  const out: Array<{ category: string; key: string; entry: Entry }> = [];
  for (const category of CLASSIFIED_CATEGORIES) {
    for (const [key, entry] of Object.entries(typed[category] ?? {})) {
      out.push({ category, key, entry });
    }
  }
  return out;
}

function* walk(value: unknown, prefix: string): Generator<string> {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) yield* walk(child, `${prefix}[]`);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      yield childPath;
      yield* walk(v, childPath);
    }
  }
}

/** Minimal V1 draft-graph response, carrying coaching so the real transform
 *  produces the coaching subtree the envelope classifications point at. */
function minimalV1(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "dec_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "fac_1", kind: "factor", label: "F" },
        { id: "out_1", kind: "outcome", label: "O" },
      ],
      edges: [{ from: "fac_1", to: "out_1", weight: 0.5 }],
    },
  } as unknown as V1DraftGraphResponse;
}

const CAPTURE_FIXTURES = [
  "draft-graph.success.with-coaching-and-provenance.json",
  "v5-turn.explain-stale.json",
  "v5-turn.failure-with-recovery-chip.json",
  "v5-turn.explain-fresh.json",
];

/** Build the client-serialized path surface. See SURFACE PROVENANCE above. */
function buildClientSurface(): ReadonlySet<string> {
  const surface = new Set<string>();

  // A. real code — the V3 draft-graph body (HTTP + SSE COMPLETE)
  for (const p of walk(transformResponseToV3(minimalV1(), { requestId: "wire-claims" }), "")) {
    surface.add(p);
  }

  // C. captures — envelope shapes the V3 transform alone does not produce.
  //
  // The V3 transform is AUTHORITATIVE for the `trace` subtree, so no capture may
  // contribute a `trace.*` path. Without this rule the union masks the very
  // change the test exists to detect: gating `repair_summary` on `includeDebug`
  // removes it from source A, but a capture recorded before the gate keeps it in
  // the surface, and the claim stays "serialized" forever. That is a fixture
  // pinning the old wire shape — the failure mode this whole file is about.
  // Verified by mutation: with this rule, gating the real emission flips the
  // assertion; without it, the suite stayed red no matter what the code did.
  for (const file of CAPTURE_FIXTURES) {
    const json = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
    for (const p of walk(json, "")) {
      if (p === "trace" || p.startsWith("trace.")) continue;
      surface.add(p);
    }
  }

  // B. real code — the enrichment keep-list projection over the staging capture
  const staging = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, "v5-turn.run-analysis.staging.json"), "utf8"),
  ) as { blocks?: Array<{ enrichment?: unknown }> };
  for (const block of staging.blocks ?? []) {
    if (!block.enrichment) continue;
    for (const p of walk(toSafeTransportEnrichment(block.enrichment), "blocks[].enrichment")) {
      surface.add(p);
    }
  }

  return surface;
}

const CLIENT_SURFACE = buildClientSurface();

const leafOf = (key: string): string => {
  const segments = key.split(".");
  return segments[segments.length - 1].replace(/\[\]/g, "");
};

/** Every surface path whose final segment equals `leaf`. */
function homonymsOf(leaf: string, surface: ReadonlySet<string>): string[] {
  return [...surface].filter((p) => leafOf(p) === leaf).sort();
}

/**
 * The checker under test. Returns a violation string per entry whose declared
 * `wire` disagrees with `surface`. Pure so the positive control can run it
 * against a deliberately-poisoned surface.
 */
function wireViolations(surface: ReadonlySet<string>): string[] {
  const violations: string[] = [];
  for (const { category, key, entry } of entries()) {
    const present = surface.has(key);
    if (entry.wire === "serialized" && !present) {
      violations.push(
        `${category}.${key}: declared wire="serialized" but the path is ABSENT from the client surface`,
      );
    }
    if (entry.wire === "internal" && present) {
      violations.push(
        `${category}.${key}: declared wire="internal" but the path IS serialized to clients`,
      );
    }
  }
  return violations;
}

describe("field-coverage allowlist — wire claims are machine-checked", () => {
  it("the derived client surface is non-empty and contains its provenance anchors", () => {
    // Guards against a silently-empty surface making every absence assertion
    // vacuous (the pino/sonic-boom "captured 0 bytes" failure mode).
    expect(CLIENT_SURFACE.size).toBeGreaterThan(200);
    // one anchor per surface source, so a source dropping out fails loudly
    expect(CLIENT_SURFACE.has("trace.pipeline")).toBe(true); // A: real V3 transform
    expect(CLIENT_SURFACE.has("blocks[].enrichment.robustness.fragile_edges[].edge_id")).toBe(true); // B: real projection
    expect(CLIENT_SURFACE.has("blocks[].error_code")).toBe(true); // C: captures
  });

  it("the real enrichment projection strips the internal carriers (source B is not a raw capture)", () => {
    const projected = [...CLIENT_SURFACE].filter((p) => p.startsWith("blocks[].enrichment"));
    expect(projected.length).toBeGreaterThan(0);
    expect(projected.filter((p) => p.includes("._meta"))).toEqual([]);
    expect(projected.filter((p) => p.includes("downstream_calls"))).toEqual([]);
  });

  it("every classification entry has a machine-checkable shape", () => {
    for (const { category, key, entry } of entries()) {
      expect(key.includes("*"), `wildcard path '${key}' in ${category}`).toBe(false);
      expect(
        entry.wire === "serialized" || entry.wire === "internal",
        `${category}.${key} must declare wire: "serialized" | "internal" (got ${JSON.stringify(entry.wire)}). ` +
          "This is the only place a serialisation claim may live, and it is checked against the real wire.",
      ).toBe(true);
      expect(
        typeof entry.why === "string" && entry.why.trim().length > 0,
        `${category}.${key} has no 'why' — every entry must explain why the field is intentionally not rendered`,
      ).toBe(true);
      if (entry.wire === "serialized") {
        expect(
          key.includes(".") || key.includes("[]"),
          `${category}.${key} is a bare leaf name. Serialized entries must be FULLY ANCHORED paths — ` +
            "bare names matched nothing in v1 and silently classified unrelated homonyms.",
        ).toBe(true);
      }
    }
  });

  it("prose may not restate a wire claim, and 'user-facing' is banned as ambiguous", () => {
    // The v1 phrase "never user-facing" conflated "not on the wire" with "not
    // rendered by the UI". trace.repair_summary was the second but not the
    // first, and the ambiguity is what let the falsehood read as true.
    const BANNED = [/user-facing/i, /never serialised|never serialized/i, /debug[- ]only/i];
    for (const { category, key, entry } of entries()) {
      const why = String(entry.why ?? "");
      for (const pattern of BANNED) {
        // `_corrections_*` quotes the old prose verbatim; entries may not.
        expect(
          pattern.test(why),
          `${category}.${key} 'why' matches banned ${pattern} — state the wire fact in the 'wire' field ` +
            "(where it is checked) and keep 'why' to the rendering/consumer rationale.",
        ).toBe(false);
      }
    }
  });

  it("every wire:internal entry names a producing source file that really emits it", () => {
    // Kills dead entries: an `internal` claim can never be proven by the client
    // surface (absence is its expectation), so it must instead point at real code.
    for (const { category, key, entry } of entries()) {
      if (entry.wire !== "internal") continue;
      const emittedBy = entry.emitted_by;
      expect(
        typeof emittedBy === "string" && emittedBy.length > 0,
        `${category}.${key} is wire:"internal" and must declare 'emitted_by' (a src/ path that produces it)`,
      ).toBe(true);
      const abs = path.join(REPO_ROOT, String(emittedBy));
      expect(fs.existsSync(abs), `${category}.${key} emitted_by '${String(emittedBy)}' does not exist`).toBe(true);
      const source = fs.readFileSync(abs, "utf8");
      expect(
        source.includes(leafOf(key)),
        `${category}.${key} emitted_by '${String(emittedBy)}' does not mention '${leafOf(key)}' — stale entry`,
      ).toBe(true);
    }
  });

  it("wire:internal entries declare every serialized homonym of their leaf name", () => {
    // Two different fields shared the leaf `fallback_reason` — one internal,
    // one serialized under _pipeline_outcome. An undeclared homonym means the
    // absence claim is quietly narrower than it reads.
    for (const { category, key, entry } of entries()) {
      if (entry.wire !== "internal") continue;
      const declared = new Set((entry.wire_homonyms as string[] | undefined) ?? []);
      const found = homonymsOf(leafOf(key), CLIENT_SURFACE).filter((p) => p !== key);
      const undeclared = found.filter((p) => !declared.has(p));
      expect(
        undeclared,
        `${category}.${key} is wire:"internal" but the leaf '${leafOf(key)}' IS serialized at these ` +
          "undeclared paths. Either they are the same field (the internal claim is false) or they are " +
          "different fields (declare them in 'wire_homonyms').",
      ).toEqual([]);
      for (const d of declared) {
        expect(
          CLIENT_SURFACE.has(d),
          `${category}.${key} declares homonym '${d}' which is not on the wire — stale declaration`,
        ).toBe(true);
      }
    }
  });

  it("POSITIVE CONTROL — the checker SEES a wire:internal field that reaches the wire", () => {
    // Trap 13: an absence assertion is worthless until it has been shown to
    // detect a presence. Poison the surface with each internal entry's own path
    // and require the checker to flag it. If this ever passes vacuously, the
    // real assertion below is proving nothing.
    const internalKeys = entries()
      .filter((e) => e.entry.wire === "internal")
      .map((e) => e.key);
    expect(internalKeys.length).toBeGreaterThan(0);
    for (const key of internalKeys) {
      const poisoned = new Set(CLIENT_SURFACE);
      poisoned.add(key);
      const found = wireViolations(poisoned);
      expect(
        found.some((v) => v.includes(key) && v.includes("IS serialized to clients")),
        `checker did not flag '${key}' after it was injected into the client surface — the absence assertion is blind`,
      ).toBe(true);
    }
  });

  it("POSITIVE CONTROL — the checker SEES a wire:serialized field that leaves the wire", () => {
    const serializedKeys = entries()
      .filter((e) => e.entry.wire === "serialized")
      .map((e) => e.key);
    expect(serializedKeys.length).toBeGreaterThan(0);
    for (const key of serializedKeys) {
      const starved = new Set(CLIENT_SURFACE);
      starved.delete(key);
      const found = wireViolations(starved);
      expect(
        found.some((v) => v.includes(key) && v.includes("ABSENT from the client surface")),
        `checker did not flag '${key}' after it was removed from the client surface`,
      ).toBe(true);
    }
  });

  it("every declared wire disposition matches the real client surface", () => {
    expect(
      wireViolations(CLIENT_SURFACE),
      "A classification entry's `wire` field disagrees with what CEE actually serializes. " +
        "Fix the CODE or fix the CLAIM — do not delete the entry.",
    ).toEqual([]);
  });
});
