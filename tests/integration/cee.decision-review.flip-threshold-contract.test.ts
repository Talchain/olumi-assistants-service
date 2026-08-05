/**
 * ROADMAP 2.505 — `/assist/v1/decision-review` flip-threshold rows must be
 * validated against the SHARED CONTRACT, not a hand-rolled copy of it.
 *
 * ── WHAT THIS PINS, AND WHY IT EXISTS ───────────────────────────────────────
 * PLoT (ROADMAP 2.258, `factor-flip-values.ts`) deliberately OMITS
 * `flip_threshold_data[].direction` on an attested-no-flip row: a direction for
 * a flip that does not exist is a fabricated claim. `@talchain/schemas` 0.31.0
 * relaxed `EnrichmentFlipThresholdSchema.direction` to optional to permit that.
 *
 * This route validated against a HAND-ROLLED LOCAL COPY of that row shape which
 * still declared `direction: z.string()` (required) — untouched since the
 * endpoint's first commit, 2026-02-02. Result: HTTP 400 `CEE_VALIDATION_FAILED`
 * in ~2 ms, `fieldErrors: {flip_threshold_data: ["Required"]}`, before any LLM
 * call. Measured on live staging 2026-08-05 (probe-2505).
 *
 * That is trap 12 at a service boundary: a hand-maintained duplicate of a
 * contract that drifted from the contract it duplicates.
 *
 * ── THE TWO HALVES (trap 12d), NEITHER OF WHICH SUPERSEDES THE OTHER ────────
 * (a) DERIVATION guards + the union assertion prove the route AGREES with
 *     `EnrichmentFlipThresholdSchema` — they catch a consumer drifting from the
 *     contract. They are structurally BLIND to the contract itself being wrong
 *     or short: deriving from a list cannot notice a missing entry.
 * (b) The HAND-WRITTEN PLoT EGRESS CORPUS is what notices that. Every row in it
 *     is transcribed from the PRODUCER's declared semantics at PLoT's deployed
 *     tip `e18e17c2` (`src/integrations/isl/adapters/factor-flip-values.ts`,
 *     `src/cee/validation/m1-review-types.ts`), NOT from this route's reading of
 *     what a field ought to mean (trap 13c). If the contract ever starts
 *     requiring something PLoT does not emit, (a) stays green and (b) goes red.
 *
 * Ship both. Deleting either leaves a whole defect class unobserved.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { EnrichmentFlipThresholdSchema } from "@talchain/schemas/boundary";
import { SCHEMA_PACKAGE_VERSION } from "@talchain/schemas";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("CEE_DECISION_REVIEW_ENABLED", "true");

import { build } from "../../src/server.js";
import {
  DecisionReviewInputSchema,
  FlipThresholdRowSchema,
} from "../../src/routes/assist.v1.decision-review.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

/**
 * PLoT's REAL decision-review egress body, recovered byte-for-byte from the
 * diagnostic capture `PHASE0-EVIDENCE-2026-07-28/witness-plot-2480a-raw/
 * POSTFIX_e18e17c2__S1_healthy_precontrol__cee-egress.json` (entry `1`,
 * `POST /assist/v1/decision-review`), built by PLoT commit `e18e17c2`.
 * 3,862 bytes compact. Its own `flip_threshold_data` is `[]` — it passes
 * VACUOUSLY, which is exactly why the discriminating rows below are injected
 * into it rather than composed from scratch.
 */
import plotEgressBodyRaw from "../fixtures/plot/decision-review-egress-e18e17c2.json";

const plotEgressBody: Record<string, unknown> = plotEgressBodyRaw;

// ---------------------------------------------------------------------------
// (b) THE HAND-WRITTEN CORPUS — PLoT egress row shapes, transcribed from the
//     producer's declared semantics at deployed tip e18e17c2.
//
//     `factor-flip-values.ts` builds EVERY row with: factor_id, factor_label,
//     current_value, flip_value, flip_reason, alternative_winner_id,
//     iterations_used, probes_used — and CONDITIONALLY spreads `direction`
//     (only beside a real flip), `no_flip_in_range` (literal `true` only), and
//     `unit` (only when the node carries one).
// ---------------------------------------------------------------------------

/** The 2.258 shape: an attested no-flip. `direction` is ABSENT — the defect. */
const ROW_ATTESTED_NO_FLIP = {
  factor_id: "factor_price",
  factor_label: "Seat Price Level",
  current_value: 49,
  flip_value: null,
  flip_reason: "no_effect_within_bounds",
  alternative_winner_id: null,
  iterations_used: 0,
  probes_used: 0,
  no_flip_in_range: true,
} as const;

/** A real flip: `direction` present beside a real `flip_value`. */
const ROW_REAL_FLIP = {
  factor_id: "factor_price",
  factor_label: "Seat Price Level",
  current_value: 49,
  flip_value: 55,
  direction: "increase",
  flip_reason: "found",
  alternative_winner_id: "option_raise",
  iterations_used: 0,
  probes_used: 0,
} as const;

/** Node carried a unit — `unit` spread in. */
const ROW_WITH_UNIT = { ...ROW_REAL_FLIP, unit: "GBP" } as const;

/**
 * An UNRESOLVED row: null flip value, NO `no_flip_in_range` flag (absence is
 * not the negation of `flip_value === null`), open `flip_reason` vocabulary.
 */
const ROW_UNRESOLVED = {
  factor_id: "factor_churn",
  factor_label: "Churn Rate",
  current_value: 0.08,
  flip_value: null,
  flip_reason: "candidate_cap_exceeded",
  alternative_winner_id: null,
  iterations_used: 0,
  probes_used: 0,
} as const;

/**
 * The RETIRED `'none'` placeholder (PLoT #300, pre-2.258). The contract's own
 * docstring is explicit that it still parses and that the placeholder retires
 * at the CONSUMERS' pace — so this route must keep accepting it.
 */
const ROW_LEGACY_NONE_PLACEHOLDER = {
  factor_id: "factor_price",
  factor_label: "Seat Price Level",
  current_value: 49,
  flip_value: null,
  direction: "none",
  flip_reason: "no_effect_within_bounds",
  alternative_winner_id: null,
  iterations_used: 0,
  probes_used: 0,
} as const;

/** A future producer key this build has never seen — must ride passthrough. */
const ROW_FORWARD_COMPATIBLE = {
  ...ROW_ATTESTED_NO_FLIP,
  some_field_added_after_this_test_was_written: 42,
} as const;

const PLOT_EGRESS_CORPUS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["attested no-flip (2.258: direction ABSENT)", ROW_ATTESTED_NO_FLIP],
  ["real flip (direction present)", ROW_REAL_FLIP],
  ["real flip carrying a unit", ROW_WITH_UNIT],
  ["unresolved row (null flip, no attestation flag)", ROW_UNRESOLVED],
  ["legacy 'none' placeholder (PLoT #300)", ROW_LEGACY_NONE_PLACEHOLDER],
  ["row carrying an unknown future key", ROW_FORWARD_COMPATIBLE],
];

function bodyWithRows(rows: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  return { ...plotEgressBody, flip_threshold_data: rows };
}

describe("ROADMAP 2.505 — decision-review flip rows derive from @talchain/schemas", () => {
  let app: FastifyInstance;
  const headers = { "X-Olumi-Assist-Key": "flip-contract-key" } as const;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "flip-contract-key");
    // One bucket, one test file: keep the limit clear of the request count so a
    // 429 can never masquerade as a shape verdict.
    vi.stubEnv("CEE_DECISION_REVIEW_RATE_LIMIT_RPM", "200");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  async function post(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/assist/v1/decision-review", headers, payload: body });
  }

  // -------------------------------------------------------------------------
  // NON-VACUITY CONTROL (trap 13). Every "accepted" assertion below is worth
  // nothing unless this instrument can produce a REJECTION through the very
  // same path. It must keep rejecting after the fix too — proof we relaxed
  // `direction` and nothing else.
  // -------------------------------------------------------------------------
  describe("positive control — the instrument can still reject", () => {
    it("REJECTS a row with `flip_value` omitted, naming flip_threshold_data", async () => {
      const { flip_value: _dropped, ...noFlipValue } = ROW_REAL_FLIP;
      const res = await post(bodyWithRows([noFlipValue]));

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
      expect(body.details.field_errors.fieldErrors.flip_threshold_data).toEqual(["Required"]);
    });

    it("REJECTS a body with `winner` omitted (control on a different field)", async () => {
      const { winner: _dropped, ...noWinner } = plotEgressBody;
      const res = await post({ ...noWinner, flip_threshold_data: [ROW_REAL_FLIP] });

      expect(res.statusCode).toBe(400);
      expect(res.json().details.field_errors.fieldErrors.winner).toEqual(["Required"]);
    });
  });

  // -------------------------------------------------------------------------
  // THE DISCRIMINATING PAIR, reproduced from the live measurement of 2026-08-05
  // (probe-2505 §4d, M2 vs M3): one row, one key varied, nothing else.
  // -------------------------------------------------------------------------
  describe("discriminating pair — `direction` is the only varied key", () => {
    it("M2: accepts a row WITH `direction`", async () => {
      const res = await post(bodyWithRows([ROW_REAL_FLIP]));
      expect(res.statusCode).toBe(200);
    });

    it("M3: accepts the SAME row with `direction` OMITTED (the 2.258 shape)", async () => {
      const { direction: _omitted, ...withoutDirection } = ROW_REAL_FLIP;
      const res = await post(bodyWithRows([withoutDirection]));

      expect(res.statusCode).toBe(200);
    });

    it("accepts `flip_value: null` — pinned so a future change that starts rejecting it is caught", async () => {
      const res = await post(bodyWithRows([ROW_ATTESTED_NO_FLIP]));
      expect(res.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // (b) THE CORPUS AT THE ROUTE. This is the half that can notice the CONTRACT
  //     being short: it asks only "does the real producer's row get through?",
  //     with no reference to what the contract says.
  // -------------------------------------------------------------------------
  describe("PLoT egress corpus — every shape the deployed producer can emit", () => {
    it.each(PLOT_EGRESS_CORPUS)("accepts: %s", async (_name, row) => {
      const res = await post(bodyWithRows([row]));

      expect(res.statusCode).toBe(200);
    });

    it("accepts the full corpus in one body (PLoT sends up to 2 rows)", async () => {
      const res = await post(bodyWithRows([ROW_ATTESTED_NO_FLIP, ROW_REAL_FLIP]));
      expect(res.statusCode).toBe(200);
    });

    it("accepts PLoT's captured egress body unmodified", async () => {
      const res = await post(plotEgressBody);
      expect(res.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // (a) DERIVATION GUARDS. These prove AGREEMENT with the contract and can
  //     never prove the contract is complete — see the header note.
  // -------------------------------------------------------------------------
  describe("derivation — the row schema is the contract's, not a copy of it", () => {
    it("carries EXACTLY the contract's key set (a copy would drift; a derivation cannot)", () => {
      expect(Object.keys(FlipThresholdRowSchema.shape).sort()).toEqual(
        Object.keys(EnrichmentFlipThresholdSchema.shape).sort()
      );
    });

    it("keeps the contract's passthrough posture", () => {
      expect(FlipThresholdRowSchema._def.unknownKeys).toBe("passthrough");
      expect(FlipThresholdRowSchema._def.unknownKeys).toBe(
        EnrichmentFlipThresholdSchema._def.unknownKeys
      );
    });

    it("requires a SUBSET of what the contract requires — so it can never be stricter", () => {
      const requiredOf = (shape: Record<string, { isOptional(): boolean }>) =>
        Object.entries(shape)
          .filter(([, v]) => !v.isOptional())
          .map(([k]) => k);

      const routeRequired = requiredOf(
        FlipThresholdRowSchema.shape as unknown as Record<string, { isOptional(): boolean }>
      );
      const contractRequired = new Set(
        requiredOf(
          EnrichmentFlipThresholdSchema.shape as unknown as Record<string, { isOptional(): boolean }>
        )
      );

      expect(routeRequired.length).toBeGreaterThan(0); // never vacuously true
      for (const key of routeRequired) {
        expect(contractRequired.has(key)).toBe(true);
      }
    });

    it("does NOT require `direction` — the field 0.31.0 relaxed", () => {
      expect(FlipThresholdRowSchema.shape.direction.isOptional()).toBe(true);
    });

    // THE UNION ASSERTION: contract-valid ⟹ route-valid, over the corpus.
    // Derivable, importable, and the property that actually matters at the
    // seam — a consumer must never reject what the producer's contract permits.
    it.each(PLOT_EGRESS_CORPUS)(
      "union assertion — contract-accepted implies route-accepted: %s",
      (_name, row) => {
        const contractOk = EnrichmentFlipThresholdSchema.safeParse(row).success;
        expect(contractOk).toBe(true); // the corpus must exercise the implication
        expect(FlipThresholdRowSchema.safeParse(row).success).toBe(true);
      }
    );

    // ── The route's DECLARED posture, pinned separately from the corpus ──────
    // The file header states this endpoint performs "NO strict validation
    // (PLoT handles that) — Lightweight shape check only". The contract
    // REQUIRES `flip_reason`; this route never reads it. Adopting the contract
    // verbatim would hand a new 400 to any producer path that omits it, which
    // is the same failure mode 2.505 exists to remove — one layer over.
    //
    // ⚠ HONEST SCOPE: these are NOT claims about a shape PLoT emits today.
    // All three of PLoT's flip-row producers set `flip_reason` at their
    // deployed tips (`factor-flip-values.ts`, and `coaching/flip-thresholds.ts`
    // at `:159` / `:194`). They are kept OUT of PLOT_EGRESS_CORPUS for exactly
    // that reason: the corpus is a producer transcription and stays one.
    it("does NOT require `flip_reason` — a contract-required field this route never reads", () => {
      expect(FlipThresholdRowSchema.shape.flip_reason.isOptional()).toBe(true);
      expect(EnrichmentFlipThresholdSchema.shape.flip_reason.isOptional()).toBe(false);
    });

    it("accepts a row with `flip_reason` omitted (lightweight-shape-check posture)", async () => {
      const { flip_reason: _omitted, ...withoutReason } = ROW_REAL_FLIP;
      const res = await post(bodyWithRows([withoutReason]));

      expect(res.statusCode).toBe(200);
    });

    it("rejects an empty `factor_id`, matching the contract's `.min(1)`", () => {
      // Derived from the PRODUCER's declared semantics, not from taste:
      // `factor-flip-values.ts` refuses any row whose factor_id is not a
      // non-empty string (`rejected_malformed++; continue;`), so this
      // tightening is UNREACHABLE for a row PLoT can emit.
      expect(
        FlipThresholdRowSchema.safeParse({ ...ROW_REAL_FLIP, factor_id: "" }).success
      ).toBe(false);
      expect(
        EnrichmentFlipThresholdSchema.safeParse({ ...ROW_REAL_FLIP, factor_id: "" }).success
      ).toBe(false);
    });

    it("the route's own input schema routes flip rows through the derived schema", () => {
      const { direction: _omitted, ...withoutDirection } = ROW_REAL_FLIP;
      expect(
        DecisionReviewInputSchema.safeParse(bodyWithRows([withoutDirection])).success
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // PIN-SKEW GUARD. A consumer on an older pin silently drops fields it does
  // not know — this estate's dominant hazard, and the whole subject of 2.505.
  // Assert WHICH package the derivation actually resolved against.
  // -------------------------------------------------------------------------
  describe("pin-skew guard — which @talchain/schemas did this derivation resolve against?", () => {
    it("the RESOLVED runtime version equals the version this repo pins", () => {
      const pkg: { dependencies: Record<string, string> } = JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8")
      );
      const pin = pkg.dependencies["@talchain/schemas"];
      const pinned = /talchain-schemas-(\d+\.\d+\.\d+)\.tgz/.exec(pin)?.[1];

      expect(pinned).toBeDefined();
      expect(SCHEMA_PACKAGE_VERSION).toBe(pinned);
    });

    it("resolved a version at or after 0.31.0, which relaxed `direction`", () => {
      const [major, minor] = SCHEMA_PACKAGE_VERSION.split(".").map(Number);
      // 0.31.0 is the release that made `direction` optional. Below it, this
      // route's derivation would re-acquire the exact defect 2.505 fixed.
      expect(major > 0 || minor >= 31).toBe(true);
    });

    it("the resolved contract genuinely declares `direction` optional", () => {
      // Not a restatement of the version number: the PROPERTY the version is a
      // proxy for. A repackaged 0.34.0 that re-required the field fails here.
      expect(EnrichmentFlipThresholdSchema.shape.direction.isOptional()).toBe(true);
    });
  });
});
