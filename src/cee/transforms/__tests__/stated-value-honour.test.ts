/**
 * INV-HONOUR (ROADMAP 2.714) — a value the user states in a turn is never
 * overridden in that turn.
 *
 * NO LLM IN THE LOOP. `runGraphDataIntegrityChecks` is a pure function of
 * `(v3Body, requestId, brief)`, so every case below constructs the pair
 * directly. That is deliberate and load-bearing: fixing 2.716 removes the
 * clarify redraft that produced most WITNESSED instances of this defect and
 * will make it LOOK fixed, while the fabrication still occurs on any FIRST
 * draft whose brief states a number (derivation §4.3/§7.5).
 *
 * FIXTURE HONESTY (§5.0): every `v3Body` is a deep clone of a CAPTURED staging
 * response — `tests/fixtures/cross-service/draft-graph.success.no-coaching.json`,
 * recorded verbatim from cee-staging on build a555cf7 and typed
 * `CEEGraphResponseV3` (see `fixture-metadata.json`). Nothing here hand-writes
 * `{ nodes: [{ observed_state: { value: 20000 } }] }`: that shape is exactly
 * how a fixture comes to disagree with the wire.
 *
 * ⚠ PREMISE CORRECTIONS, both measured at this tip:
 *  1. §4.4 says to stamp `observed_state.source = 'user_specified'`. That
 *     literal is NOT a member of `ObservedStateV3.source` (`cee-v3.ts`) — the
 *     three lines the derivation cites are the EDGE, INTERVENTION and OPTION
 *     provenance enums. Stamping it would fail `CEEGraphResponseV3` validation
 *     two statements later in the same stage. The user-owned literal this enum
 *     does carry, and the one the schema's own comment names as pill-earning,
 *     is `user_override`.
 *  2. The captured body proves `observed_state.value` is the CAP-NORMALISED
 *     ratio and `raw_value` carries the human-scale magnitude. Writing the
 *     stated value into `value` would contradict the scale-consistency repair
 *     running beside it in the same function.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runGraphDataIntegrityChecks } from "../graph-data-integrity.js";
import { MAGNITUDE_MULTIPLIERS } from "../../../utils/magnitude-alphabet.js";

const CAPTURED_V3_PATH = resolve(
  process.cwd(),
  "tests/fixtures/cross-service/draft-graph.success.no-coaching.json",
);

/** A fresh deep clone of the captured staging body for every case. */
function capturedBody(): any {
  return JSON.parse(readFileSync(CAPTURED_V3_PATH, "utf8"));
}

function nodeById(body: any, id: string): any {
  const found = body.nodes.find((n: any) => n.id === id);
  if (!found) throw new Error(`fixture precondition failed: node ${id} absent from the capture`);
  return found;
}

describe("INV-HONOUR — a value stated in the brief wins, deterministically", () => {
  describe("fixture preconditions (pinned, so a capture change fails loud)", () => {
    it("the captured body carries the node, unit and cap this suite binds to", () => {
      const cost = nodeById(capturedBody(), "fac_hiring_cost");
      expect(cost.label).toBe("Hiring and Staffing Cost");
      expect(cost.observed_state.unit).toBe("£");
      expect(cost.observed_state.cap).toBe(400000);
      expect(cost.observed_state.raw_value).toBe(0);
      expect(cost.observed_state.source).toBe("brief_extraction");
    });
  });

  describe("C1 — the witnessed case: a stated value overrides the drafter's", () => {
    const BRIEF =
      "We are hiring for the compliance platform. "
      + "The hiring and staffing cost is £250,000 for the year.";

    it("the bound node carries the stated value", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(body, "req-c1", BRIEF);
      const node = nodeById(body, "fac_hiring_cost");
      expect(node.observed_state.raw_value).toBe(250000);
      expect(node.observed_state.value).toBeCloseTo(250000 / 400000, 6);
      expect(summary.stated_value_honour_repairs).toHaveLength(1);
      expect(summary.stated_value_honour_repairs[0]).toMatchObject({
        node_id: "fac_hiring_cost",
        field: "observed_state.raw_value",
        before: 0,
        after: 250000,
      });
    });

    it("binds by IDENTITY — no other captured node is touched", () => {
      const before = capturedBody();
      const after = capturedBody();
      runGraphDataIntegrityChecks(after, "req-c1b", BRIEF);
      for (const n of after.nodes) {
        if (n.id === "fac_hiring_cost") continue;
        expect(n.observed_state).toEqual(nodeById(before, n.id).observed_state);
      }
    });
  });

  describe("C2 — the LABEL is the trust defect too, and it is asserted separately", () => {
    it("an overridden node is no longer stamped brief_extraction", () => {
      const body = capturedBody();
      runGraphDataIntegrityChecks(
        body,
        "req-c2",
        "The hiring and staffing cost is £250,000 for the year.",
      );
      const node = nodeById(body, "fac_hiring_cost");
      expect(node.observed_state.source).not.toBe("brief_extraction");
      expect(node.observed_state.source).toBe("user_override");
      expect(node.observed_state.extractionType).toBe("explicit");
    });

    it("a node the rule declines to override KEEPS its original stamp", () => {
      const body = capturedBody();
      runGraphDataIntegrityChecks(body, "req-c2b", "Nothing here names any node.");
      expect(nodeById(body, "fac_hiring_cost").observed_state.source).toBe("brief_extraction");
    });
  });

  describe("C3 — unit incompatibility: no override, skip recorded", () => {
    it("a currency stated against a time-unit node is not the same quantity", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c3",
        "The compliance deadline miss is £90,000 in exposure.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(nodeById(body, "risk_deadline_miss").observed_state.raw_value).toBe(4);
      expect(
        summary.stated_value_honour_skips.some(
          (s) => s.node_id === "risk_deadline_miss" && s.reason === "unit_incompatible",
        ),
      ).toBe(true);
    });
  });

  describe("C4 — ambiguity fails CLOSED, and the refusal is recorded", () => {
    it("a label named twice is never guessed at", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c4",
        "The hiring and staffing cost is £250,000 in London. "
          + "In Bangalore the hiring and staffing cost is £90,000.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(nodeById(body, "fac_hiring_cost").observed_state.raw_value).toBe(0);
      // Assert the SKIP, not merely that nothing changed — silence and a
      // decision are indistinguishable otherwise.
      expect(
        summary.stated_value_honour_skips.some(
          (s) => s.node_id === "fac_hiring_cost" && s.reason === "ambiguous_label_binding",
        ),
      ).toBe(true);
    });
  });

  describe("C5 — relative anchors state a delta, not a value", () => {
    it("\"increase by 20%\" never overrides an absolute node value", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c5",
        "The hiring and staffing cost should increase by 20%.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(nodeById(body, "fac_hiring_cost").observed_state.raw_value).toBe(0);
      // Bind to the RELATIVE branch by name. Without this the case passes on
      // the unit-incompatibility branch instead (percent vs £) and proves
      // nothing about relative anchors — measured, and it is why this
      // assertion exists rather than a bare "nothing changed".
      expect(
        summary.stated_value_honour_skips.some(
          (s) => s.node_id === "fac_hiring_cost" && s.reason === "relative_anchor",
        ),
      ).toBe(true);
    });

    it("discriminating case: the units MATCH, so only the relative term can "
      + "be doing the work", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c5b",
        "The hiring and staffing cost should increase by £50,000.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(
        summary.stated_value_honour_skips.some(
          (s) => s.node_id === "fac_hiring_cost" && s.reason === "relative_anchor",
        ),
      ).toBe(true);
      expect(nodeById(body, "fac_hiring_cost").observed_state.raw_value).toBe(0);
    });
  });

  describe("C6 — magnitude words: the canonical alphabet, both halves", () => {
    it("hand corpus — the spellings a user actually types", () => {
      for (const [text, expected] of [
        ["£250,000", 250000],
        ["£250k", 250000],
        ["£250K", 250000],
      ] as ReadonlyArray<readonly [string, number]>) {
        const body = capturedBody();
        runGraphDataIntegrityChecks(
          body,
          "req-c6",
          `The hiring and staffing cost is ${text} for the year.`,
        );
        expect(nodeById(body, "fac_hiring_cost").observed_state.raw_value).toBe(expected);
      }
    });

    it("DERIVED over every canonical magnitude key — a value is either resolved "
      + "EXACTLY or refused, never committed at the bare digits", () => {
      for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
        for (const spelling of [`£2${key}`, `£2 ${key}`]) {
          const body = capturedBody();
          const summary = runGraphDataIntegrityChecks(
            body,
            `req-c6-${key}`,
            `The hiring and staffing cost is ${spelling} for the year.`,
          );
          const raw = nodeById(body, "fac_hiring_cost").observed_state.raw_value;
          const expected = 2 * multiplier;
          if (summary.stated_value_honour_repairs.length === 0) {
            expect(raw).toBe(0); // untouched — the refusal branch
          } else {
            expect(raw).toBe(expected > 400000 ? expected : expected);
          }
          // The failure this guard exists for: NEVER the bare digits.
          expect(raw).not.toBe(2);
        }
      }
    });

    it("the parser's own magnitude list is SHORTER than the canonical alphabet, "
      + "and the gap is refused rather than mis-committed", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c6-grand",
        "The hiring and staffing cost is £2 grand for the year.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(
        summary.stated_value_honour_skips.some(
          (s) => s.node_id === "fac_hiring_cost" && s.reason === "unresolved_magnitude",
        ),
      ).toBe(true);
      expect(nodeById(body, "fac_hiring_cost").observed_state.raw_value).toBe(0);
    });
  });

  describe("C8 — no-op control: the control reads EXACTLY zero", () => {
    it("a brief agreeing with the capture produces no repairs at all", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c8",
        "The effective team capacity is 8 engineers today.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(nodeById(body, "fac_team_size").observed_state.raw_value).toBe(8);
      expect(nodeById(body, "fac_team_size").observed_state.source).toBe("brief_extraction");
    });

    it("no brief at all produces no repairs and no skips", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(body, "req-c8b");
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(summary.stated_value_honour_skips).toHaveLength(0);
    });
  });

  describe("C9 — a stated value beyond the node's cap is refused, not clamped", () => {
    it("re-scaling the model is not this rule's decision", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(
        body,
        "req-c9",
        "The hiring and staffing cost is £900,000 for the year.",
      );
      expect(summary.stated_value_honour_repairs).toHaveLength(0);
      expect(
        summary.stated_value_honour_skips.some((s) => s.reason === "stated_exceeds_cap"),
      ).toBe(true);
      expect(nodeById(body, "fac_hiring_cost").observed_state.value).toBeLessThanOrEqual(1);
    });
  });
});
