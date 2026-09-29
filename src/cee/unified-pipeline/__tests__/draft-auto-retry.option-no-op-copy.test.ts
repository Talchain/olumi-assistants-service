/**
 * OPTION_NO_OP HONEST COPY — the connectivity sentence is not true of this code.
 *
 * ## The defect this pins
 *
 * Paul, 2026-09-11, on staging. A draft blocked by `OPTION_NO_OP` told him:
 *
 *   "Part of the drafted decision model was left unconnected to your goal …
 *    State the outcome you are optimising for explicitly / Naming how each
 *    consideration affects that outcome helps the model connect them"
 *
 * `OPTION_NO_OP` has nothing to do with connectivity. His brief stated its
 * outcome explicitly ("£20k MRR within 12 months while keeping monthly churn
 * under 4%") and named how each consideration bears on it, so the copy
 * prescribed, twice, the two things the brief already did — for a failure we
 * caused. The cause is structural, not a wording slip: `OPTION_NO_OP` was
 * folded into the one `post_enforcement` retry class, so it inherited that
 * class's copy. `draft-auto-retry.ts`'s own comment on
 * `OPTIONS_IDENTICAL_RETRY_EXHAUSTED_SUGGESTION` already forbids exactly this
 * reuse, in terms.
 *
 * ## Why the assertions look the way they do
 *
 * **Bound by IDENTITY, never by a substring another message could satisfy**
 * (trap 19). Every case names the CODE that blocked and asserts on the copy
 * that code selects; the negative assertions name the CONNECTIVITY sentence's
 * own distinguishing clauses, which no other copy in the estate carries.
 *
 * **Both directions, every time** (trap 22b). One predicate stands between two
 * harms here: a no-op sentence shown for a real connectivity failure DENIES a
 * failure that happened; a connectivity sentence shown for a no-op is the lie
 * we are closing. So every no-op case has a connectivity twin asserting the
 * connectivity copy is UNCHANGED — a fix that quietly widened the predicate
 * would turn those red.
 *
 * **The copy's own truth conditions are asserted, not just its selection.** No
 * frequency claim on an arm with no measured rate; no blame line; no em dash
 * (Paul, 2026-09-10); the observational phrasing the pending current-level data
 * defect requires.
 *
 * RED at pristine 77d11382: `isOptionNoOpOnlyBlock`,
 * `readEnforcementBlockCodes`, `selectEnforcementBlockRecovery`,
 * `resolveDraftFailureCopyKey` and the three `OPTION_NO_OP_*` copy constants do
 * not exist, and all three sites emit the connectivity sentence.
 */

import { describe, it, expect } from "vitest";

import {
  applyRetryExhaustedCopy,
  applyRetryUnaffordableCopy,
  resolveDraftFailureCopyKey,
  OPTION_NO_OP_RETRY_EXHAUSTED_SUGGESTION,
  OPTION_NO_OP_RETRY_EXHAUSTED_HINTS,
  OPTION_NO_OP_UNAFFORDABLE_SUGGESTION,
  OPTION_NO_OP_UNAFFORDABLE_HINTS,
  ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
  RETRY_UNAFFORDABLE_SUGGESTION,
} from "../draft-auto-retry.js";
import {
  isOptionNoOpOnlyBlock,
  readEnforcementBlockCodes,
  selectEnforcementBlockRecovery,
  OPTION_NO_OP_VALIDATION_CODE,
  ENFORCEMENT_BLOCK_STATUS_CODE,
  ENFORCEMENT_BLOCK_ERROR_CODE,
  ENFORCEMENT_BLOCK_LAST_PHASE,
} from "../stages/repair/graph-enforcement.js";
import { buildCeeErrorResponse } from "../../validation/pipeline.js";

/**
 * The producer's real body, built by the REAL envelope builder with the REAL
 * shared constants — the same device the sibling decision spec uses, so this
 * fixture cannot drift from the emitter's signature without the constants
 * moving with it. `codes` is the only variable: it IS the discriminator under
 * test.
 */
function blockedResultWithCodes(codes: readonly string[]) {
  const body = buildCeeErrorResponse(
    ENFORCEMENT_BLOCK_ERROR_CODE,
    `Graph failed post-enforcement validation (${codes.length} topology error(s))`,
    {
      requestId: "req-option-no-op-copy-spec",
      retryable: true,
      recovery: {
        suggestion:
          "Part of the drafted decision model was left unconnected to your goal, so it was rejected instead of being shown to you — this is usually transient. Try again.",
        hints: ["Retrying the same brief usually succeeds"],
      },
      details: {
        validation_error_codes: [...codes],
        enforcement_repairs: 1,
        last_phase: ENFORCEMENT_BLOCK_LAST_PHASE,
      },
    },
  );
  return { statusCode: ENFORCEMENT_BLOCK_STATUS_CODE, body: body as unknown };
}

/** The connectivity sentence's own distinguishing clause. Nothing else in the
 *  estate's recovery copy says this, so asserting on it binds by identity
 *  rather than by a generic word any refusal could carry. */
const CONNECTIVITY_CLAIM = "left unconnected to your goal";
/** The connectivity hints' two prescriptions — the exact pair Paul's brief had
 *  already satisfied when it was told to do them. */
const CONNECTIVITY_PRESCRIPTIONS = [
  "outcome you are optimising for",
  "helps the model connect them",
];

function recoveryTextOf(result: { body: unknown }): string {
  const body = result.body as Record<string, unknown>;
  return JSON.stringify(body.recovery);
}

// ---------------------------------------------------------------------------
// 1. The discriminator itself
// ---------------------------------------------------------------------------

describe("isOptionNoOpOnlyBlock — the whole finding, not any of it", () => {
  it("is true when every blocking code is OPTION_NO_OP", () => {
    expect(isOptionNoOpOnlyBlock([OPTION_NO_OP_VALIDATION_CODE])).toBe(true);
    expect(
      isOptionNoOpOnlyBlock([OPTION_NO_OP_VALIDATION_CODE, OPTION_NO_OP_VALIDATION_CODE]),
    ).toBe(true);
  });

  it("is FALSE when a topology code rode along — that block really did have one", () => {
    expect(
      isOptionNoOpOnlyBlock([OPTION_NO_OP_VALIDATION_CODE, "NO_PATH_TO_GOAL"]),
    ).toBe(false);
    expect(
      isOptionNoOpOnlyBlock(["NO_PATH_TO_GOAL", OPTION_NO_OP_VALIDATION_CODE]),
    ).toBe(false);
  });

  it("is false for an empty set — no codes is not evidence of a no-op", () => {
    expect(isOptionNoOpOnlyBlock([])).toBe(false);
  });

  it("is false for every other blocking code", () => {
    for (const code of ["NO_PATH_TO_GOAL", "MISSING_BRIDGE", "NO_EFFECT_PATH", "OPTIONS_IDENTICAL"]) {
      expect(isOptionNoOpOnlyBlock([code])).toBe(false);
    }
  });
});

describe("readEnforcementBlockCodes — the producer's own codes-only mirror", () => {
  it("reads the codes the gate emitted", () => {
    expect(readEnforcementBlockCodes(blockedResultWithCodes(["OPTION_NO_OP"]).body)).toEqual([
      "OPTION_NO_OP",
    ]);
  });

  it("is empty, never a throw, for a malformed or absent field", () => {
    expect(readEnforcementBlockCodes(undefined)).toEqual([]);
    expect(readEnforcementBlockCodes({})).toEqual([]);
    expect(readEnforcementBlockCodes({ details: null })).toEqual([]);
    expect(readEnforcementBlockCodes({ details: { validation_error_codes: "nope" } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. SITE 1 — the single-attempt emission (graph-enforcement.ts)
// ---------------------------------------------------------------------------

describe("SITE 1 — single-attempt block copy", () => {
  it("an OPTION_NO_OP-only block does NOT claim anything was left unconnected", () => {
    const recovery = selectEnforcementBlockRecovery([OPTION_NO_OP_VALIDATION_CODE]);
    const text = JSON.stringify(recovery);

    expect(text).not.toContain(CONNECTIVITY_CLAIM);
    for (const p of CONNECTIVITY_PRESCRIPTIONS) expect(text).not.toContain(p);

    // It says what was actually observed, and names the option as the subject.
    expect(recovery.suggestion).toContain("match the ones already recorded");
    expect(recovery.suggestion).toContain("nothing to compare it against");
  });

  it("TWIN: a connectivity block still gets the connectivity copy, byte-identical", () => {
    const recovery = selectEnforcementBlockRecovery(["NO_PATH_TO_GOAL"]);
    expect(recovery.suggestion).toContain(CONNECTIVITY_CLAIM);
    expect(recovery.suggestion).toContain("usually transient");
    expect([...recovery.hints]).toEqual([
      "Retrying the same brief usually succeeds",
      "If it keeps happening, state the outcome you are optimising for explicitly",
      "Naming how each consideration affects that outcome helps the model connect them",
    ]);
  });

  it("TWIN: a MIXED block keeps the connectivity copy — it really did have one", () => {
    const recovery = selectEnforcementBlockRecovery([OPTION_NO_OP_VALIDATION_CODE, "MISSING_BRIDGE"]);
    expect(recovery.suggestion).toContain(CONNECTIVITY_CLAIM);
  });

  it("TWIN: an unreadable code set falls back to today's copy, unchanged", () => {
    expect(selectEnforcementBlockRecovery([]).suggestion).toContain(CONNECTIVITY_CLAIM);
  });

  it("makes NO frequency claim — there is no measured recovery rate for this code", () => {
    const text = JSON.stringify(selectEnforcementBlockRecovery([OPTION_NO_OP_VALIDATION_CODE]));
    expect(text).not.toContain("usually");
    expect(text).not.toContain("often");
  });
});

// ---------------------------------------------------------------------------
// 3. SITE 2 — retry exhausted (draft-auto-retry.ts)
// ---------------------------------------------------------------------------

describe("SITE 2 — retry-exhausted copy", () => {
  it("routes an OPTION_NO_OP-only block to the no-op copy key", () => {
    expect(
      resolveDraftFailureCopyKey(blockedResultWithCodes(["OPTION_NO_OP"]) as never, "post_enforcement"),
    ).toBe("option_no_op");
  });

  it("emits the no-op sentence, and never the connectivity claim", () => {
    const adjusted = applyRetryExhaustedCopy(
      blockedResultWithCodes(["OPTION_NO_OP"]) as never,
      "post_enforcement",
    );
    const body = adjusted.body as Record<string, any>;

    // ⭐ THE DEFECT ASSERTION FIRST, deliberately: this is the sentence Paul was
    // shown, and putting it ahead of the new-constant equality makes the
    // RED-first signature the DEFECT rather than a missing symbol.
    const text = recoveryTextOf(adjusted);
    expect(text).not.toContain(CONNECTIVITY_CLAIM);
    for (const p of CONNECTIVITY_PRESCRIPTIONS) expect(text).not.toContain(p);

    expect(body.recovery.suggestion).toBe(OPTION_NO_OP_RETRY_EXHAUSTED_SUGGESTION);
    expect(body.recovery.hints).toEqual([...OPTION_NO_OP_RETRY_EXHAUSTED_HINTS]);
    // The pinned flat mirror must not be left carrying a DIFFERENT sentence.
    expect(body.recovery_suggestion).toBe(OPTION_NO_OP_RETRY_EXHAUSTED_SUGGESTION);

    // Still discloses the spent retry, and still the same typed failure.
    expect(body.details.auto_retry).toEqual({ attempted: true, attempts: 2 });
    expect(body.retryable).toBe(true);
    expect(body.details.validation_error_codes).toEqual(["OPTION_NO_OP"]);
  });

  it("TWIN: a connectivity block's exhausted copy is UNCHANGED", () => {
    const adjusted = applyRetryExhaustedCopy(
      blockedResultWithCodes(["NO_PATH_TO_GOAL"]) as never,
      "post_enforcement",
    );
    const body = adjusted.body as Record<string, any>;
    expect(body.recovery.suggestion).toBe(ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION);
    expect(body.recovery.suggestion).toContain(CONNECTIVITY_CLAIM);
  });

  it("TWIN: the OPTIONS_IDENTICAL class is untouched by the post_enforcement split", () => {
    expect(
      resolveDraftFailureCopyKey(
        blockedResultWithCodes(["OPTION_NO_OP"]) as never,
        "options_identical",
      ),
    ).toBe("options_identical");
  });
});

// ---------------------------------------------------------------------------
// 4. SITE 3 — retry unaffordable (draft-auto-retry.ts)
// ---------------------------------------------------------------------------

describe("SITE 3 — unfunded-retry copy", () => {
  it("emits the no-op sentence, and never the connectivity claim", () => {
    const adjusted = applyRetryUnaffordableCopy(
      blockedResultWithCodes(["OPTION_NO_OP"]) as never,
      "post_enforcement",
    );
    const body = adjusted.body as Record<string, any>;

    // The defect assertion first, for the same reason as SITE 2.
    const text = recoveryTextOf(adjusted);
    expect(text).not.toContain(CONNECTIVITY_CLAIM);
    for (const p of CONNECTIVITY_PRESCRIPTIONS) expect(text).not.toContain(p);

    expect(body.recovery.suggestion).toBe(OPTION_NO_OP_UNAFFORDABLE_SUGGESTION);
    expect(body.recovery.hints).toEqual([...OPTION_NO_OP_UNAFFORDABLE_HINTS]);
    expect(body.recovery_suggestion).toBe(OPTION_NO_OP_UNAFFORDABLE_SUGGESTION);

    // Still discloses that nothing was retried — the distinction this arm exists for.
    expect(body.details.auto_retry).toEqual({
      attempted: false,
      attempts: 1,
      skipped_reason: "budget_unaffordable",
    });
  });

  it("does NOT say the server tried twice — nothing was retried on this arm", () => {
    const text = recoveryTextOf(
      applyRetryUnaffordableCopy(blockedResultWithCodes(["OPTION_NO_OP"]) as never, "post_enforcement"),
    );
    expect(text).not.toContain("twice");
    expect(text).not.toContain("second draft");
  });

  it("TWIN: a connectivity block's unfunded copy is UNCHANGED", () => {
    const adjusted = applyRetryUnaffordableCopy(
      blockedResultWithCodes(["NO_PATH_TO_GOAL"]) as never,
      "post_enforcement",
    );
    const body = adjusted.body as Record<string, any>;
    expect(body.recovery.suggestion).toBe(RETRY_UNAFFORDABLE_SUGGESTION);
    expect(body.recovery.suggestion).toContain(CONNECTIVITY_CLAIM);
  });
});

// ---------------------------------------------------------------------------
// 5. The copy's own truth conditions — asserted across ALL THREE sites at once
// ---------------------------------------------------------------------------

describe("the OPTION_NO_OP copy is honest at every site", () => {
  /** ⚠ LAZY ON PURPOSE. Built inside each test, not at module scope, so the
   *  file still COLLECTS when the exports do not yet exist — which is what
   *  makes the RED-first signatures per-assertion rather than one collection
   *  error standing in for the lot. */
  const siteNames = ["single-attempt", "exhausted", "unaffordable"] as const;
  /** ⚠ PIN THE PRECONDITION (trap 13b). Without this, every "the copy does not
   *  say X" assertion below passes VACUOUSLY whenever the constant is missing
   *  or empty — a guard that agrees with itself. Measured at pristine: four of
   *  these passed for exactly that reason before this assert was added. */
  function site(name: (typeof siteNames)[number]): { suggestion: string; hints: readonly string[] } {
    const copy = siteCopy(name);
    expect(typeof copy.suggestion, `${name}: suggestion must be a real string`).toBe("string");
    expect(copy.suggestion.length, `${name}: suggestion must be non-empty`).toBeGreaterThan(40);
    expect(Array.isArray(copy.hints), `${name}: hints must be a real array`).toBe(true);
    expect(copy.hints.length, `${name}: hints must be non-empty`).toBeGreaterThan(0);
    return copy;
  }

  function siteCopy(name: (typeof siteNames)[number]): { suggestion: string; hints: readonly string[] } {
    if (name === "single-attempt") return selectEnforcementBlockRecovery([OPTION_NO_OP_VALIDATION_CODE]);
    if (name === "exhausted") {
      return {
        suggestion: OPTION_NO_OP_RETRY_EXHAUSTED_SUGGESTION,
        hints: OPTION_NO_OP_RETRY_EXHAUSTED_HINTS ?? [],
      };
    }
    return {
      suggestion: OPTION_NO_OP_UNAFFORDABLE_SUGGESTION,
      hints: OPTION_NO_OP_UNAFFORDABLE_HINTS ?? [],
    };
  }

  it.each(siteNames)("%s: no em dash in product content (Paul, 2026-09-10)", (name) => {
    const copy = site(name);
    expect(copy.suggestion).not.toContain("—");
    for (const hint of copy.hints) expect(hint).not.toContain("—");
  });

  it.each(siteNames)("%s: does not blame the brief", (name) => {
    const copy = site(name);
    const text = `${copy.suggestion} ${copy.hints.join(" ")}`.toLowerCase();
    // Brief-CONDITIONAL, not brief-CAUSED. The connectivity copy's own comment
    // refuses a "be more specific" / "simplify" blame line for the same reason.
    expect(text).not.toContain("your brief");
    expect(text).not.toContain("a small change to the brief");
    expect(text).not.toContain("be more specific");
    expect(text).not.toContain("simplify");
  });

  it.each(siteNames)("%s: reports what was OBSERVED, not a verdict on the user", (name) => {
    const copy = site(name);
    // ⚠ A separate lane is repairing a data defect that binds a factor's
    // recorded current level from the wrong slot, which can make a genuine
    // option LOOK like a no-op. "values that match the ones already recorded"
    // stays true in both worlds; "your option changes nothing" would not.
    expect(copy.suggestion).toContain("match the ones already recorded");
    expect(copy.suggestion.toLowerCase()).not.toContain("you did not");
    expect(copy.suggestion.toLowerCase()).not.toContain("you have not");
  });

  it.each(siteNames)("%s: names BOTH ways out, so no do-nothing arm is forced", (name) => {
    const copy = site(name);
    // retry-directive.ts:109-113 — only the model can tell a mis-drafted
    // alternative from a deliberate do-nothing arm; naming one route pushes
    // every genuine do-nothing option into being restated as a change it is
    // not, which is the fabrication direction.
    const text = `${copy.suggestion} ${copy.hints.join(" ")}`;
    expect(text).toMatch(/what that option changes/);
    expect(text).toMatch(/current arrangement/);
  });

  it.each(siteNames)("%s: domain-neutral — names the KIND of differentiator", (name) => {
    const copy = site(name);
    // Ruling 2026-07-24 (draft-honesty lane): the copy used to script a PRICING
    // remedy and served it on a build-vs-buy brief.
    const text = `${copy.suggestion} ${copy.hints.join(" ")}`.toLowerCase();
    for (const domain of ["price", "pricing", "£", "$", "/month", "plan"]) {
      expect(text).not.toContain(domain);
    }
    expect(text).toMatch(/cost, time, scope, capacity or risk/);
  });

  it.each(siteNames)("%s: British English, no race framing (Paul's standing ruling)", (name) => {
    const copy = site(name);
    const text = `${copy.suggestion} ${copy.hints.join(" ")}`.toLowerCase();
    for (const banned of ["winner", "wins", "beat", "loser", "race", "optimizing", "modeled"]) {
      expect(text).not.toContain(banned);
    }
  });
});
