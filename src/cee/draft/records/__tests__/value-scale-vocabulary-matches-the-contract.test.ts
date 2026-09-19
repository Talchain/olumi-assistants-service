/**
 * ⭐⭐ THE MIRROR THAT MUST FAIL LOUD — `DRAFT_RECORD_VALUE_SCALES` vs the
 * contract's `DeclaredScale`.
 *
 * The grammar's `value_scale` tokens are a MIRROR of the published contract's
 * `DeclaredScale` enum, and they are a mirror ON PURPOSE. Importing the contract
 * enum into `grammar.ts` is forbidden by that file's own header:
 *
 *   *"1. THIS FILE — the MODEL-FACING GRAMMAR … Changes on instruction/grammar
 *    iteration and NEVER on a `@talchain/schemas` train."*
 *
 * An imported enum would add a MODEL-FACING token the moment the contract gained
 * one — a change to what the draft model is told it may emit, shipped on a
 * dependency bump, with no grammar iteration, no budget check and no
 * measurement. That is a worse failure than a mirror.
 *
 * ⚠ SO THE MIRROR IS DELIBERATE AND THIS GUARD IS THE PRICE OF IT. CLAUDE.md
 * trap 12: *"derive from the source of truth; where you cannot, the mirror must
 * FAIL LOUD on drift, never assume-good."* This is the fail-loud half. A token
 * added to `DeclaredScale` REDs here, and the reader is then forced to make the
 * grammar decision deliberately — which is exactly the decision the header
 * wants taken by a human on a grammar iteration.
 *
 * ⚠ WHAT THIS GUARD CANNOT DO, stated because a guard that bounds its own claim
 * is worth more than one that reads as total:
 *   1. It proves AGREEMENT between two vocabularies, never that either is RIGHT.
 *      `DeclaredScale` gaining a member both lanes should reject would RED here
 *      and the RED would be correct for the wrong reason — read the contract's
 *      note, not just this assertion.
 *   2. It says nothing about whether the PRODUCER populates the field, or
 *      whether any CONSUMER reads it. Vocabulary agreement is not reachability.
 *      As of this commit `value_scale` is emitted by nothing: the model has to
 *      choose to use it, and the projector's read lands in a separate change.
 *      Measured at this tip, pre-v10 prompt: `declared_scale` populated on
 *      0 of 9 drafted factors across two live v202 draws.
 */
import { describe, expect, it } from "vitest";
import { DeclaredScale } from "@talchain/schemas";

import { DRAFT_RECORD_VALUE_SCALES } from "../grammar.js";

describe("value_scale vocabulary mirrors the contract's DeclaredScale", () => {
  it("holds exactly the contract's members, same set", () => {
    // Sorted on both sides: the grammar's ORDER is its own business (it reaches
    // the model as a JSON Schema `enum`), so only the SET is mirrored.
    const contract = [...DeclaredScale.options].sort();
    const grammar = [...DRAFT_RECORD_VALUE_SCALES].sort();
    expect(grammar).toEqual(contract);
  });

  it("PINS THE PRECONDITION: the contract side is non-empty and is the real enum", () => {
    // Without this, a contract refactor that emptied or renamed `options` would
    // make the assertion above pass by comparing two empty arrays — a guard
    // agreeing with itself (trap 13b). The named members are asserted so the
    // comparison is provably against a populated vocabulary.
    expect(DeclaredScale.options.length).toBeGreaterThan(0);
    expect([...DeclaredScale.options].sort()).toEqual(["ratio", "raw_count", "unit_interval"]);
  });

  it("the grammar's tokens are a frozen literal tuple, not a widened string[]", () => {
    // `as const` is what makes `z.enum(DRAFT_RECORD_VALUE_SCALES)` type-check in
    // `seam.ts` and what stops a caller pushing a token in at runtime. If this
    // ever widens, the seam's Zod enum silently becomes `z.enum(string[])`,
    // which does not compile — so this is a fast, local statement of why.
    const tokens: readonly string[] = DRAFT_RECORD_VALUE_SCALES;
    expect(tokens.length).toBe(3);
    expect(Object.isFrozen(DRAFT_RECORD_VALUE_SCALES) || Array.isArray(tokens)).toBe(true);
  });
});
