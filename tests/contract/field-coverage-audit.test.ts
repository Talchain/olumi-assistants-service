/**
 * Field-coverage audit (v1).
 *
 * Audits the 10 critical cross-boundary fields shipped in V5 waves 1-3.
 * For each, asserts:
 *   - **P1 (test FAILS):** UI_CONSUMED_FIELDS references an audited field
 *     that no fixture in tests/fixtures/cross-service/ contains. This is the
 *     `coaching` / `draft_coaching` class of bug — UI expects, CEE doesn't
 *     produce.
 *   - **P2 (test PASSES, observation logged):** an audited field is produced
 *     by at least one fixture but no UI consumer reads it. P2 observations
 *     are listed in Docs/v5/cross-boundary-contract-test-report.md but do
 *     NOT fail the test — they are signals for future UI work, not
 *     contract violations.
 *
 * `UI_CONSUMED_FIELDS` is curated from inspecting:
 *   - DecisionGuideAI/src/adapters/cee/client.ts (adaptDraftResponse,
 *     mapDraftCoachingFromResponse)
 *   - DecisionGuideAI/src/canvas/utils/draftIngestion.ts
 *     (edgeProvenanceDisplayPatch)
 *   - DecisionGuideAI/src/v5/responseRouter.ts
 *     (assistant_text, blocks routing)
 *   - DecisionGuideAI/src/canvas/conversation/useConversation.ts
 *     (handleEnvelope reads suggested_actions, blocks, assistant_text)
 *
 * Any new audited field added to the allowlist requires a corresponding
 * UI_CONSUMED_FIELDS entry — that is the contract this test enforces.
 */
import { describe, it, expect } from "vitest";

import draftWithCoaching from "../fixtures/cross-service/draft-graph.success.with-coaching-and-provenance.json";
import draftNoCoaching from "../fixtures/cross-service/draft-graph.success.no-coaching.json";
import draftPartialCoaching from "../fixtures/cross-service/draft-graph.success.partial-coaching.json";
import v5Stale from "../fixtures/cross-service/v5-turn.explain-stale.json";
import v5Failure from "../fixtures/cross-service/v5-turn.failure-with-recovery-chip.json";
import v5Fresh from "../fixtures/cross-service/v5-turn.explain-fresh.json";
import allowlist from "./field-coverage.allowlist.json" with { type: "json" };

interface FixtureEntry {
  readonly name: string;
  readonly fixture: unknown;
}

const FIXTURES: ReadonlyArray<FixtureEntry> = [
  { name: "draft-graph.success.with-coaching-and-provenance", fixture: draftWithCoaching },
  { name: "draft-graph.success.no-coaching", fixture: draftNoCoaching },
  { name: "draft-graph.success.partial-coaching", fixture: draftPartialCoaching },
  { name: "v5-turn.explain-stale", fixture: v5Stale },
  { name: "v5-turn.failure-with-recovery-chip", fixture: v5Failure },
  { name: "v5-turn.explain-fresh", fixture: v5Fresh },
];

/**
 * Curated list of the audited fields each UI consumer reads. Values are
 * a list of fixture-name patterns where the field is expected to appear
 * (i.e. CEE must produce it for that endpoint).
 *
 * Source: DecisionGuideAI source paths cited in the file header.
 */
const UI_CONSUMED_FIELDS: Record<string, ReadonlyArray<string>> = {
  // Draft-graph response (consumed by adaptDraftResponse +
  // mapDraftCoachingFromResponse + draftIngestion.edgeProvenanceDisplayPatch)
  "coaching": ["draft-graph.success.with-coaching-and-provenance"],
  "strengthen_items": ["draft-graph.success.with-coaching-and-provenance"],
  "widening_log": ["draft-graph.success.with-coaching-and-provenance"],
  "bias_signals": ["draft-graph.success.with-coaching-and-provenance"],
  "provenance": ["draft-graph.success.with-coaching-and-provenance"],
  "provenance_display": ["draft-graph.success.with-coaching-and-provenance"],
  "analysis_ready": ["draft-graph.success.with-coaching-and-provenance"],
  // V5 turn envelope (consumed by responseRouter + useConversation handleEnvelope)
  "assistant_text": ["v5-turn.explain-stale", "v5-turn.failure-with-recovery-chip", "v5-turn.explain-fresh"],
  "blocks": ["v5-turn.explain-stale", "v5-turn.failure-with-recovery-chip", "v5-turn.explain-fresh"],
  "suggested_actions": ["v5-turn.explain-stale", "v5-turn.failure-with-recovery-chip", "v5-turn.explain-fresh"],
};

/**
 * Explicit JSON paths the UI adapter reads under each audited field. Used
 * by the path-level audit so that brand-new subfields (e.g. an LLM-emitted
 * `coaching.unused_new_field`) FAIL the audit unless explicitly added here
 * or classified in the allowlist.
 *
 * Sources (UI repo):
 *   - mapDraftCoachingFromResponse (src/adapters/cee/client.ts:99-163)
 *     reads: coaching.summary, coaching.strengthen_items[].{id,label,detail,action_type,bias_category},
 *            coaching.widening_log[].{node_id,label,reason},
 *            coaching.bias_signals[].{type,detail,target}
 *   - adaptDraftResponse v3-fast-path (client.ts:185-240) reads:
 *            nodes[*].{id,kind/type,label,observed_state,*spread*}, edges[*].{from,to,*spread*},
 *            analysis_ready (passthrough), schema_version (passthrough),
 *            trace.pipeline (passthrough), rationales (passthrough)
 *   - edgeProvenanceDisplayPatch (canvas/utils/draftIngestion.ts) reads: provenance_display
 *   - For NodeV3.provenance: nodes[*].provenance read directly in adapter spread
 *   - V5 envelope (responseRouter.ts + useConversation.handleEnvelope) reads:
 *            assistant_text, blocks (full discriminated union), suggested_actions
 *
 * Path syntax mirrors the allowlist: `[]` for arrays, dotted segments,
 * leaf-level granularity for known consumption.
 */
const UI_CONSUMED_PATHS: ReadonlySet<string> = new Set([
  // Top-level audited fields themselves (presence is consumed)
  "coaching",
  "analysis_ready",
  "assistant_text",
  "blocks",
  "suggested_actions",
  // coaching subtree
  "coaching.summary",
  "coaching.strengthen_items",
  "coaching.strengthen_items[].id",
  "coaching.strengthen_items[].label",
  "coaching.strengthen_items[].detail",
  "coaching.strengthen_items[].action_type",
  "coaching.strengthen_items[].bias_category",
  // v0.11.0 schema amendment: widening_log is the canonical OBJECT
  // shape. Per-entry array shape (`{node_id,label,reason}[]`) is gone.
  "coaching.widening_log",
  "coaching.widening_log.elements_added",
  "coaching.widening_log.elements_added[]",
  "coaching.widening_log.elements_considered_but_excluded",
  "coaching.widening_log.elements_considered_but_excluded[]",
  "coaching.widening_log.brief_completeness",
  "coaching.bias_signals",
  "coaching.bias_signals[].type",
  "coaching.bias_signals[].detail",
  "coaching.bias_signals[].target",
  // V5 envelope blocks (each variant's user-consumed fields)
  "blocks[].type",
  "blocks[].content",
  "blocks[].error_code",
  "blocks[].severity",
  "blocks[].details",
  "blocks[].summary",
  "blocks[].leading_option_id",
  "blocks[].win_probabilities",
  "blocks[].enrichment",
  "blocks[].status",
  "blocks[].operation",
  "blocks[].target_id",
  "blocks[].before",
  "blocks[].after",
  "blocks[].narrative",
  "blocks[].referenced_option_ids",
  "blocks[].options",
  "blocks[].options[].option_id",
  "blocks[].options[].label",
  "blocks[].options[].win_probability",
  "blocks[].options[].attributes",
  "blocks[].flip_scenarios",
  "blocks[].flip_scenarios[].factor_id",
  "blocks[].flip_scenarios[].current_value",
  "blocks[].flip_scenarios[].flip_threshold",
  "blocks[].flip_scenarios[].from_option_id",
  "blocks[].flip_scenarios[].to_option_id",
  "blocks[].flip_scenarios[].fragile",
  "blocks[].nodes",
  "blocks[].edges",
  "blocks[].node_count",
  "blocks[].edge_count",
  // suggested_actions subtree
  "suggested_actions[].id",
  "suggested_actions[].label",
  "suggested_actions[].message",
  "suggested_actions[].action_type",
  // provenance/provenance_display: read directly off node/edge spreads
  // (these path heads collide with audited heads provenance/provenance_display
  // but at the actual fixture path live under nodes[]/edges[])
  "nodes[].provenance",
  "edges[].provenance_display",
]);

/**
 * Subtree prefixes the adapter reads as opaque passthrough — every leaf
 * under these prefixes is forwarded to a downstream consumer (PLoT, an
 * inline-block renderer, etc.) without leaf-level inspection. New leaves
 * added under these prefixes ride along automatically and do not require
 * audit classification.
 *
 * Sources:
 *   - `analysis_ready` — adapt-fast-path forwards the whole object to the
 *     PLoT call (src/adapters/cee/client.ts:215-216). UI never reads
 *     individual sub-fields.
 *   - `blocks[].details` — V5 error block `details` is a `z.passthrough`
 *     diagnostic bag (boundary/olumi-response.d.ts:46). UI surfaces the
 *     `details` object as-is to telemetry / dev tooling but does not
 *     render individual fields. New diagnostic keys ride along.
 *   - `blocks[].enrichment` — explanation/analysis_result/flip_analysis
 *     blocks carry an opaque `enrichment` record forwarded to ResultsPanel
 *     plumbing (z.passthrough in the boundary schema).
 *   - `blocks[].attributes` — comparison-block per-option attributes,
 *     opaque passthrough to the comparison renderer.
 *
 * Adding a new prefix here requires the same justification rigour as the
 * allowlist — the entry below must reference the production source path
 * that proves the subtree is consumed wholesale.
 */
const UI_CONSUMED_PASSTHROUGH_PREFIXES: ReadonlyArray<string> = [
  "analysis_ready",
  "blocks[].details",
  "blocks[].enrichment",
  "blocks[].options[].attributes",
];

/**
 * Recursively check whether a field name appears anywhere in the JSON tree
 * (as an object key or, for array containers, as a sub-field of an array
 * element).
 */
function fixtureContainsField(fixture: unknown, fieldName: string): boolean {
  if (fixture === null || fixture === undefined) return false;
  if (Array.isArray(fixture)) {
    return fixture.some((item) => fixtureContainsField(item, fieldName));
  }
  if (typeof fixture === "object") {
    const obj = fixture as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, fieldName)) return true;
    return Object.values(obj).some((v) => fixtureContainsField(v, fieldName));
  }
  return false;
}

/**
 * Walk every leaf and intermediate object key in a JSON value, yielding
 * dotted JSON paths with `[]` for arrays. Used by the path-level audit to
 * compare exact produced paths against the allowlist + UI consumption.
 */
function* walkPaths(value: unknown, path: string): Generator<string> {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) {
      yield* walkPaths(child, `${path}[]`);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      yield childPath;
      yield* walkPaths(v, childPath);
    }
  }
}

/**
 * Normalise an array-aware path so leaf-level lookups against the allowlist
 * match either of the two conventions used in the JSON file:
 *   - `bias_signals[].target` (array container marker)
 *   - `coaching.bias_signals.target` (no marker)
 * The audit accepts both.
 */
function pathVariants(path: string): string[] {
  return [path, path.replace(/\[\]/g, "")];
}

interface Allowlist {
  audited_fields: ReadonlyArray<string>;
  diagnostic_allowed: Readonly<Record<string, string>>;
  machine_routing_allowed: Readonly<Record<string, string>>;
  structured_pointer_allowed: Readonly<Record<string, string>>;
  currently_unrendered_but_intentional: Readonly<Record<string, string>>;
}

const typedAllowlist = allowlist as unknown as Allowlist;
const audited: ReadonlyArray<string> = typedAllowlist.audited_fields;

const CLASSIFIED_CATEGORIES = [
  "diagnostic_allowed",
  "machine_routing_allowed",
  "structured_pointer_allowed",
  "currently_unrendered_but_intentional",
] as const satisfies ReadonlyArray<keyof Allowlist>;

describe("field-coverage audit (v1)", () => {
  it("allowlist contains every UI-consumed field", () => {
    for (const field of Object.keys(UI_CONSUMED_FIELDS)) {
      expect(
        audited.includes(field),
        `UI consumes '${field}' but it is not in audited_fields. Add it to field-coverage.allowlist.json or remove the UI_CONSUMED_FIELDS entry.`,
      ).toBe(true);
    }
  });

  it("allowlist classification categories are object maps with non-empty justifications and no wildcard paths", () => {
    for (const category of CLASSIFIED_CATEGORIES) {
      const entries = typedAllowlist[category] as Readonly<Record<string, string>>;
      expect(
        entries !== null && typeof entries === "object" && !Array.isArray(entries),
        `category ${category} must be an object map (path → justification), not an array`,
      ).toBe(true);
      for (const [path, justification] of Object.entries(entries)) {
        expect(
          path.includes("*"),
          `wildcard path '${path}' in ${category} — entries must be specific paths, not wildcards`,
        ).toBe(false);
        expect(
          typeof justification === "string" && justification.trim().length > 0,
          `path '${path}' in ${category} has no justification — every entry must explain why the field is intentionally not consumed by UI`,
        ).toBe(true);
      }
    }
  });

  it("audit detects synthetic drift: a new unclassified subfield under an audited field would fail", () => {
    // Negative test: prove the audit has teeth. Build a synthetic fixture
    // with `coaching.unused_new_field`, run the same audit logic, expect
    // the violation to surface. Without this, a passing audit could mean
    // the rule is too permissive — this asserts the rule rejects the
    // class of drift the brief is designed to catch.
    const driftFixture = {
      coaching: {
        summary: "ok",
        strengthen_items: [],
        unused_new_field: "this should be flagged",
      },
    };
    const allowedPaths = new Set<string>();
    for (const cat of CLASSIFIED_CATEGORIES) {
      const map = typedAllowlist[cat] as Readonly<Record<string, string>>;
      for (const k of Object.keys(map)) allowedPaths.add(k);
    }

    const violations: string[] = [];
    for (const path of walkPaths(driftFixture, "")) {
      const head = path.split(/[.[]/)[0];
      if (!audited.includes(head)) continue;
      const variants = pathVariants(path);
      if (variants.some((v) => UI_CONSUMED_PATHS.has(v))) continue;
      if (
        UI_CONSUMED_PASSTHROUGH_PREFIXES.some((prefix) =>
          variants.some(
            (v) => v === prefix || v.startsWith(`${prefix}.`) || v.startsWith(`${prefix}[`),
          ),
        )
      ) {
        continue;
      }
      if (variants.some((v) => allowedPaths.has(v))) continue;
      violations.push(path);
    }
    expect(
      violations.includes("coaching.unused_new_field"),
      `audit failed to flag synthetic drift 'coaching.unused_new_field'. Violations: ${violations.join(", ")}`,
    ).toBe(true);
  });

  it("path-level audit: every produced path under an audited field is consumed at the exact path or classified in the allowlist", () => {
    // v1 scope (per brief): walk all paths but only fail on paths whose
    // leading segment is one of the 10 audited fields. Anything else is
    // out of v1 audit scope.
    //
    // No top-level shortcut: a brand-new subfield like
    // `coaching.unused_new_field` MUST appear in either UI_CONSUMED_PATHS
    // (with a real adapter consumer) or in the allowlist (with a
    // justification) — otherwise it fails the audit. This is the
    // schema-drift detector the brief asks for.
    const allowedPaths = new Set<string>();
    for (const cat of CLASSIFIED_CATEGORIES) {
      const map = typedAllowlist[cat] as Readonly<Record<string, string>>;
      for (const k of Object.keys(map)) allowedPaths.add(k);
    }

    const violations: string[] = [];
    for (const { name, fixture } of FIXTURES) {
      for (const path of walkPaths(fixture, "")) {
        const head = path.split(/[.[]/)[0];
        if (!audited.includes(head)) continue;
        // Path falls under an audited field. Pass if ANY:
        //   (a) the EXACT path (or its no-bracket variant) is in
        //       UI_CONSUMED_PATHS — adapter reads this leaf directly
        //   (b) the path falls under a passthrough prefix — adapter
        //       forwards the whole subtree opaquely
        //   (c) any path-variant is explicitly classified in the allowlist
        const variants = pathVariants(path);
        const consumed = variants.some((v) => UI_CONSUMED_PATHS.has(v));
        if (consumed) continue;
        const passthrough = UI_CONSUMED_PASSTHROUGH_PREFIXES.some((prefix) =>
          variants.some(
            (v) => v === prefix || v.startsWith(`${prefix}.`) || v.startsWith(`${prefix}[`),
          ),
        );
        if (passthrough) continue;
        const allowed = variants.some((v) => allowedPaths.has(v));
        if (allowed) continue;
        violations.push(`${name}: ${path}`);
      }
    }
    expect(
      violations.length,
      "Produced paths under audited fields must be either explicitly UI-consumed " +
        "(in UI_CONSUMED_PATHS — added by the engineer who wires the adapter) " +
        "or explicitly classified in field-coverage.allowlist.json with a justification. " +
        "Unclassified paths:\n  " +
        violations.join("\n  "),
    ).toBe(0);
  });

  for (const field of audited) {
    it(`P1 — every UI-expected fixture for '${field}' produces it`, () => {
      const expectedFixtures = UI_CONSUMED_FIELDS[field] ?? [];
      // P2 case: audited but UI doesn't consume — pass silently. The report
      // documents these as "produced but not consumed" observations.
      if (expectedFixtures.length === 0) return;

      const missingFromFixtures: string[] = [];
      for (const fixtureName of expectedFixtures) {
        const entry = FIXTURES.find((f) => f.name === fixtureName);
        expect(entry, `missing fixture '${fixtureName}' referenced by UI_CONSUMED_FIELDS['${field}']`).toBeDefined();
        if (!entry) continue;
        if (!fixtureContainsField(entry.fixture, field)) {
          missingFromFixtures.push(fixtureName);
        }
      }
      expect(
        missingFromFixtures.length,
        `P1 — UI expects '${field}' but the following CEE fixtures don't produce it: ${missingFromFixtures.join(", ")}. ` +
          "This is a cross-boundary contract violation — the UI is consuming a field CEE never sends.",
      ).toBe(0);
    });
  }
});
