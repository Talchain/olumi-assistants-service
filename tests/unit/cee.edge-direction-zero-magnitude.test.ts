/**
 * ZERO MAGNITUDE IS THE HOLE IN EVERY DIRECTION AUTHORITY — AND THE ONE
 * DERIVATION THAT DOES NOT ABSTAIN THERE ASSERTS "positive".
 *
 * Causal direction is carried TWICE: `effect_direction` (an enum) and the SIGN
 * of the magnitude (`strength_mean` / `strength.mean`, documented at
 * `schemas/graph.ts:488` as "sign indicates direction"). Which one wins when
 * they disagree was adjudicated in `cee.edge-polarity-direction-authority.test.ts`
 * (Q_B: an UNSIGNED magnitude carries no polarity, so the label wins) and
 * `cee.edge-direction-derives-from-mean-sign.test.ts` (Q_A: a SIGNED magnitude
 * is self-describing, so the mean wins). Neither question is reopened here.
 *
 * ⚠ THIS FILE IS ABOUT THE THIRD SIGN CLASS, WHICH BOTH RULINGS SKIP.
 *
 * Measured at staging `42394c9d`, by executing the production functions:
 *
 *   - STRP Rule 4 (`validators/structural-reconciliation.ts:896`) guards
 *     `edge.strength_mean !== 0` — it ABSTAINS at zero.
 *   - `fixSignMismatch` (`unified-pipeline/stages/repair/deterministic-sweep.ts:147`)
 *     is gated on a `SIGN_MISMATCH` violation, and `validators/graph-validator.ts:1405`
 *     raises that only when `strength_mean !== 0` — it ABSTAINS at zero.
 *   - `transformEdgeToV3`'s sign application (`cee/transforms/schema-v3.ts:964`)
 *     is guarded `rawStrength > 0` — it ABSTAINS at zero.
 *   - `deriveEffectDirection` (`schemas/cee-v3.ts:919`) is `mean >= 0 ? "positive"
 *     : "negative"`. It does NOT abstain. It returns "positive".
 *
 * So every authority that could reconcile the two carriers declines to rule on
 * zero, and the single derivation that runs unconditionally fills the silence
 * with a POSITIVE CAUSAL CLAIM. Measured consequence, executed end to end: an
 * edge stating `effect_direction: "negative"` with `strength_mean: 0` leaves
 * `transformEdgeToV3` as `effect_direction: "positive"`. An authored negative
 * becomes a positive on the wire, with no warning anywhere.
 *
 * ⚠ ZERO IS NOT A DIRECTION, AND THE ESTATE ALREADY SAID SO — IN ONE PLACE,
 * EXPLICITLY. `edgeSign()`
 * (`orchestrator-v5/coaching/post-draft-narrative.ts:1340-1352`) returns `null`
 * at a zero mean, and its own comment gives the reason: "at zero the sign
 * cannot recover direction, and `-0 >= 0` is `true`, so an unguarded test calls
 * every zero positive." That is the evidence — from outside this lane's head —
 * that `>= 0` is the wrong DEFINITION and not merely an inconsistency between
 * copies: the enum's own documentation (`schemas/graph.ts:459-462`) defines
 * "positive" as "increasing source INCREASES target", which is false of a zero
 * coefficient.
 *
 * ⚠ AND THE LIMIT OF THAT EVIDENCE, STATED SO IT CANNOT BE INHERITED WRONG:
 * this lane first wrote "TWO places", citing
 * `orchestrator/context/graph-compact.ts:529-532` as the second. WITHDRAWN.
 * That file never names a direction at zero either, but only because an earlier
 * `absMean < 0.1` sub-threshold skip makes its `mean > 0 ? 'positive' :
 * 'negative'` ternary unreachable there — incidental, not a second independent
 * judgement. One witness is enough; two would have been better, and saying two
 * when there is one is how a premise becomes load-bearing without being true.
 *
 * WHAT THIS FILE PINS — written against the SPEC ("a magnitude with no sign
 * states no direction"), never against the failure mode in hand, and every case
 * carries its opposite-direction twin (CLAUDE.md trap 22b):
 *
 *   1. the magnitude sign classification is TOTAL and three-valued, including -0;
 *   2. at zero, a STATED direction is preserved rather than overwritten;
 *   3. at zero with NOTHING stated, the invented direction is DISCLOSED in
 *      `transform_defaults` — the same channel every other invented edge value
 *      already uses — so it cannot become positive *silently*;
 *   4. the signed classes are untouched — Q_A and Q_B behaviour is byte-identical;
 *   5. `v3-validator`'s `EFFECT_DIRECTION_MISMATCH` consumes the SAME definition
 *      rather than re-deriving `>= 0`, so the repair cannot trade a silent flip
 *      for a spurious warning (CLAUDE.md trap 21 — adding a conjunct creates a
 *      new concept; every other reader of the old one must move with it);
 *   6. a CORPUS drawn from the estate's own committed captures, not from this
 *      lane, with a non-empty assertion and a contrast control.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  classifyMagnitudeSign,
  resolveEffectDirection,
  deriveEffectDirection,
} from "../../src/schemas/cee-v3.js";
import { transformEdgeToV3 } from "../../src/cee/transforms/schema-v3.js";
import { validateV3Response } from "../../src/cee/validation/v3-validator.js";

/**
 * Two nodes bound by an identity no other edge in these fixtures can satisfy
 * (`fac_driver → out_result`). Every assertion below finds its edge by that
 * pair, never by a value predicate another edge could also match
 * (CLAUDE.md trap 19).
 */
const NODES = [
  { id: "fac_driver", kind: "factor", label: "Driver" },
  { id: "out_result", kind: "outcome", label: "Result" },
] as const;

function v3Edge(edge: Record<string, unknown>) {
  return transformEdgeToV3(
    { from: "fac_driver", to: "out_result", ...edge } as never,
    0,
    NODES as never,
  );
}

describe("magnitude sign classification — the ONE definition", () => {
  it("is total over the three sign classes, and zero is its own class", () => {
    expect(classifyMagnitudeSign(0.5)).toBe("positive");
    expect(classifyMagnitudeSign(-0.5)).toBe("negative");
    expect(classifyMagnitudeSign(0)).toBe("no_sign_information");
  });

  it("treats NEGATIVE ZERO as carrying no sign information, not as positive", () => {
    // `-0 >= 0` is true in JS, which is precisely how the old definition called
    // every zero positive. `post-draft-narrative.ts:1344` flags this by name.
    const negativeZero = -0;
    expect(Object.is(negativeZero, 0)).toBe(false);
    // The hazard, stated as an executable fact rather than a comment: the old
    // `mean >= 0` definition answered TRUE here, which is how every zero — and
    // every negated zero produced by `-Math.abs(0)` — was called positive.
    expect(negativeZero >= 0).toBe(true);
    expect(classifyMagnitudeSign(negativeZero)).toBe("no_sign_information");
  });
});

describe("resolveEffectDirection — a magnitude with no sign states no direction", () => {
  it("preserves a STATED negative when the magnitude carries no sign", () => {
    const r = resolveEffectDirection(0, "negative");
    expect(r.direction).toBe("negative");
    expect(r.invented).toBe(false);
  });

  // Opposite-direction twin (trap 22b): the fix must not pass by making
  // everything negative.
  it("preserves a STATED positive when the magnitude carries no sign", () => {
    const r = resolveEffectDirection(0, "positive");
    expect(r.direction).toBe("positive");
    expect(r.invented).toBe(false);
  });

  it("MARKS the direction as invented when nothing stated one at zero", () => {
    // This is the epistemic assertion, and it is the one that catches the
    // DEFINITION being wrong rather than merely inconsistent (trap 12d): the
    // returned VALUE is unchanged from the old behaviour, so a test that only
    // checked the value would pass against the defect.
    const r = resolveEffectDirection(0, undefined);
    expect(r.invented).toBe(true);
  });

  it("never reports `invented` for a magnitude that carries its own sign", () => {
    expect(resolveEffectDirection(0.5, undefined).invented).toBe(false);
    expect(resolveEffectDirection(-0.5, undefined).invented).toBe(false);
  });

  it("leaves the signed classes exactly as the two prior rulings settled them", () => {
    // Q_A — a signed magnitude is self-describing and beats a stale label.
    expect(resolveEffectDirection(-0.53, "positive").direction).toBe("negative");
    // Q_B is applied upstream by moving the SIGN onto the magnitude, so by the
    // time the derivation runs the mean is already signed. Both signed classes
    // resolve from the magnitude alone.
    expect(resolveEffectDirection(0.53, "positive").direction).toBe("positive");
    expect(resolveEffectDirection(-0.53, "negative").direction).toBe("negative");
  });

  it("keeps the single-argument `deriveEffectDirection` byte-identical for signed input", () => {
    expect(deriveEffectDirection(0.5)).toBe("positive");
    expect(deriveEffectDirection(-0.5)).toBe("negative");
  });
});

describe("V3 EGRESS — an authored direction survives a zero magnitude", () => {
  it("does NOT turn a stated negative into a positive", () => {
    const r = v3Edge({ effect_direction: "negative", strength_mean: 0, belief_exists: 0.8 });
    expect(r.edge.from).toBe("fac_driver");
    expect(r.edge.to).toBe("out_result");
    expect(r.edge.strength.mean).toBe(0);
    expect(r.edge.effect_direction).toBe("negative");
  });

  it("does NOT turn a stated positive into a negative (twin)", () => {
    const r = v3Edge({ effect_direction: "positive", strength_mean: 0, belief_exists: 0.8 });
    expect(r.edge.effect_direction).toBe("positive");
  });

  it("DISCLOSES an invented direction when a zero magnitude states nothing", () => {
    const r = v3Edge({ strength_mean: 0, belief_exists: 0.8 });
    const record = r.defaults.find((d) => d.field === "effect_direction");
    expect(record, "an invented direction must be recorded in transform_defaults").toBeDefined();
    expect(record?.edge_id).toBe("fac_driver->out_result");
    expect(record?.default_value).toBe(r.edge.effect_direction);
  });

  it("records NO direction default when the magnitude carries its own sign", () => {
    for (const strength_mean of [0.5, -0.5]) {
      const r = v3Edge({ strength_mean, belief_exists: 0.8 });
      expect(
        r.defaults.find((d) => d.field === "effect_direction"),
        `mean=${strength_mean} states its own direction and must not be recorded as defaulted`,
      ).toBeUndefined();
    }
  });

  it("leaves the Q_B sign transfer intact — stated negative + unsigned magnitude", () => {
    const r = v3Edge({ effect_direction: "negative", strength_mean: 0.6, belief_exists: 0.8 });
    expect(r.edge.strength.mean).toBe(-0.6);
    expect(r.edge.effect_direction).toBe("negative");
  });

  it("leaves the Q_A label correction intact — stale positive + signed magnitude", () => {
    const r = v3Edge({ effect_direction: "positive", strength_mean: -0.53, belief_exists: 0.8 });
    expect(r.edge.strength.mean).toBe(-0.53);
    expect(r.edge.effect_direction).toBe("negative");
  });
});

describe("the two carriers cannot disagree — one definition, every reader", () => {
  /** A minimal but schema-valid V3 response carrying exactly the edge under test. */
  function v3Response(edges: unknown[]) {
    return {
      schema_version: "3.0",
      nodes: [
        { id: "fac_driver", kind: "factor", label: "Driver" },
        { id: "out_result", kind: "outcome", label: "Result" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges,
      options: [],
      goal_node_id: "goal_1",
    };
  }

  function directionMismatches(response: unknown): unknown[] {
    const result = validateV3Response(response) as {
      warnings?: Array<{ code: string; affected_edge_id?: string }>;
    };
    const all = result.warnings ?? [];
    // The fixture must actually have REACHED the semantic checks. A schema
    // failure returns early, and an empty mismatch list would then read as
    // "no disagreement" when in truth nothing was ever examined (trap 13).
    expect(
      all.filter((w) => w.code === "SCHEMA_VALIDATION_ERROR"),
      "fixture must parse, or the absence below is vacuous",
    ).toHaveLength(0);
    return all.filter(
      (w) =>
        w.code === "EFFECT_DIRECTION_MISMATCH" &&
        w.affected_edge_id === "fac_driver\u2192out_result",
    );
  }

  it("does not flag a zero-magnitude edge whose direction was stated", () => {
    // Trap 21: the repair must not trade a silent flip for a spurious warning.
    // `v3-validator.ts:424` re-derived `mean >= 0 ? positive : negative` — the
    // same wrong definition in a second place — so a preserved "negative" at
    // zero would have raised EFFECT_DIRECTION_MISMATCH against itself.
    const built = v3Edge({ effect_direction: "negative", strength_mean: 0, belief_exists: 0.8 });
    expect(built.edge.effect_direction).toBe("negative");
    expect(directionMismatches(v3Response([built.edge]))).toHaveLength(0);
  });

  it("does not flag a zero-magnitude edge stating positive either (twin)", () => {
    const built = v3Edge({ effect_direction: "positive", strength_mean: 0, belief_exists: 0.8 });
    expect(directionMismatches(v3Response([built.edge]))).toHaveLength(0);
  });

  it("STILL flags a genuine disagreement on a signed magnitude (contrast)", () => {
    // The pair proves the guard above closed the hole without swallowing the
    // discrimination (trap 13b): this case must remain RED. It fails on a
    // DIFFERENT assertion than the pair above, so one cannot mask the other.
    const mismatches = directionMismatches(
      v3Response([
        {
          from: "fac_driver",
          to: "out_result",
          strength: { mean: -0.53, std: 0.1 },
          exists_probability: 0.8,
          effect_direction: "positive",
        },
      ]),
    );
    expect(mismatches).toHaveLength(1);
  });
});

/**
 * CORPUS — from the estate's own committed captures, not from this lane.
 *
 * Trap 12d: a derived guard proves the readers AGREE with the definition and can
 * never prove the definition is RIGHT. The completeness check has to come from
 * outside the derivation. These are real draft-graph outputs and staging
 * captures already in the tree; the lane did not author a single value in them.
 */
describe("committed capture corpus", () => {
  const files = execSync(
    "git grep -a -l -E 'effect_direction' -- '*.json' '*.jsonl'",
    { cwd: process.cwd(), maxBuffer: 1 << 28 },
  )
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  type Observed = { file: string; dir: string; mean: number };
  const observed: Observed[] = [];
  let directionsSeen = 0;

  function walk(o: unknown, file: string): void {
    if (o === null || typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, file);
      return;
    }
    const rec = o as Record<string, unknown>;
    const dir = rec.effect_direction;
    if (typeof dir === "string") directionsSeen++;
    const nested = rec.strength as Record<string, unknown> | undefined;
    const mean =
      typeof rec.strength_mean === "number"
        ? rec.strength_mean
        : nested && typeof nested.mean === "number"
          ? nested.mean
          : undefined;
    if (typeof dir === "string" && typeof mean === "number") {
      observed.push({ file, dir, mean });
    }
    for (const k of Object.keys(rec)) walk(rec[k], file);
  }

  for (const f of files) {
    let txt: string;
    try {
      txt = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of f.endsWith(".jsonl") ? txt.split("\n") : [txt]) {
      if (!line.trim()) continue;
      try {
        walk(JSON.parse(line), f);
      } catch {
        /* not JSON — a capture corpus holds prose too */
      }
    }
  }

  it("collected a non-empty corpus (the probe can SEE)", () => {
    // Trap 13 / 13e: an absence assertion over a corpus that silently collected
    // nothing passes by testing nothing, and a positive control must be
    // plausible in MAGNITUDE, not merely non-zero.
    expect(files.length).toBeGreaterThan(50);
    expect(directionsSeen).toBeGreaterThan(2000);
    expect(observed.length).toBeGreaterThan(2000);
  });

  it("carries BOTH direction words (contrast control — the corpus discriminates)", () => {
    expect(observed.some((o) => o.dir === "positive")).toBe(true);
    expect(observed.some((o) => o.dir === "negative")).toBe(true);
  });

  it("classifies every observed magnitude without exception", () => {
    for (const o of observed) {
      expect(["positive", "negative", "no_sign_information"]).toContain(
        classifyMagnitudeSign(o.mean),
      );
    }
  });

  it("resolves every observed edge to the direction the carriers jointly support", () => {
    for (const o of observed) {
      const r = resolveEffectDirection(o.mean, o.dir);
      const cls = classifyMagnitudeSign(o.mean);
      if (cls === "no_sign_information") {
        // Nothing may be invented where a direction was stated.
        expect(r.invented, `${o.file}: ${o.dir} @ ${o.mean}`).toBe(false);
        expect(r.direction).toBe(o.dir);
      } else {
        // A signed magnitude is self-describing and is never invented.
        expect(r.invented, `${o.file}: ${o.dir} @ ${o.mean}`).toBe(false);
        expect(r.direction).toBe(cls);
      }
    }
  });
});
