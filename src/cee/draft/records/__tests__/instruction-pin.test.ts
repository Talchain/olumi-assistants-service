/**
 * THE INSTRUCTION IS PINNED BY A HISTORIC HASH, AND THE LITERAL MAY NOT BE
 * "UPDATED" TO MATCH A CHANGE.
 *
 * Every measurement that justified drafting by records was taken against exactly
 * these bytes. `e630587523d29ace…` / 2,351 bytes is a RECORD of what was served,
 * not a convenience constant: if the instruction changes and someone edits the
 * literal below to match, the whole evidence base silently detaches from the
 * product and nothing anywhere goes red.
 *
 * Changing the instruction is legitimate. Changing it while re-pointing the pin
 * in the same motion is not — move the pin deliberately, in a commit that also
 * carries the new measurement.
 *
 * The pin is derived by HASHING THE SERVED CONSTANT, so it also fails if the
 * concatenation, the trimming or either section moves — not just if someone
 * edits the prose.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DRAFT_RECORDS_INSTRUCTION,
  DRAFT_RECORDS_SHAPE_INSTRUCTION,
  DRAFT_RECORDS_CONNECT_INSTRUCTION,
  draftRecordsInstructionHash,
} from "../instruction.js";

/** HISTORIC. The bytes served on every measured run. Never update to match a change. */
const PINNED_INSTRUCTION_SHA256 =
  "e630587523d29ace5739d5c26754d787fb00479d542a3cb1fc7ca13ceb1eca26";
const PINNED_INSTRUCTION_BYTES = 2351;

describe("the draft records instruction is the measured artefact", () => {
  it("hashes to the pinned historic value at the pinned byte length", () => {
    expect(draftRecordsInstructionHash()).toBe(PINNED_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).toBe(PINNED_INSTRUCTION_BYTES);
  });

  it("is exactly the two declared sections, in order, and nothing else", () => {
    // Derived rather than restated: if a third section is ever appended without
    // being exported, this fails even though the hash test might have been
    // "fixed" by someone re-pinning it.
    expect(DRAFT_RECORDS_INSTRUCTION).toBe(
      `${DRAFT_RECORDS_SHAPE_INSTRUCTION}\n${DRAFT_RECORDS_CONNECT_INSTRUCTION}`.trimEnd(),
    );
    expect(DRAFT_RECORDS_INSTRUCTION.startsWith(DRAFT_RECORDS_SHAPE_INSTRUCTION)).toBe(true);
  });

  it("keeps the shape half independently pinned, so a connect-half edit is legible as one", () => {
    // The two halves were measured separately: the shape half alone produced
    // ZERO option-origin causal links over 44 links / 9 runs; adding the connect
    // half moved that to 28 of 75 on the first attempt. Pinning them apart is
    // what makes a future edit attributable to one half or the other.
    //
    // ⚠ The evidence record carries this hash to EIGHT hex characters
    // (`a6de4225…`) and a byte count (1,443). Both are asserted; the remaining
    // digits are this file's own, computed here, and are pinned so a future edit
    // is caught at full precision rather than at the precision the record
    // happened to print. Saying which part is inherited and which part is local
    // is the difference between a pin and a claim.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).toBe(
      "a6de4225a94bf321185775a7b34d01b1eb4f7f9def5c0c6ee7b2f1fc95692a80",
    );
    expect(Buffer.byteLength(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8")).toBe(1443);
  });
});

describe("the instruction says nothing it must not say", () => {
  /**
   * The model has NO provenance channel — `grammar.ts` carries no provenance
   * property, and that absence is the mechanism that makes false authorship
   * structurally impossible rather than merely discouraged. An instruction that
   * discussed provenance would invite the model to try to express one, and the
   * first thing a model does when it cannot express something is approximate it.
   *
   * Bound to the CONCEPT's vocabulary, not to one phrasing.
   */
  it("never mentions provenance, attribution or authorship", () => {
    const lowered = DRAFT_RECORDS_INSTRUCTION.toLowerCase();
    for (const forbidden of ["provenance", "attribut", "authorship", "badge", "from_brief", "ai_inferred"]) {
      expect(lowered).not.toContain(forbidden);
    }
  });

  /**
   * `category` is INFERRED FROM STRUCTURE by the validator
   * (`graph-validator.ts:83-134`): a factor is `controllable` because an option
   * edge points at it. Asking the model to DECLARE it invites `CATEGORY_MISMATCH`
   * — the instruction would be manufacturing the very rejection it exists to
   * avoid.
   */
  it("never asks the model to declare a category", () => {
    expect(DRAFT_RECORDS_INSTRUCTION.toLowerCase()).not.toContain("category");
    expect(DRAFT_RECORDS_INSTRUCTION).not.toContain("controllable");
  });

  /**
   * A number the model was not asked for is invented precision, and the repair
   * machinery defaults edge strength anyway — so asking for it buys nothing and
   * costs honesty.
   */
  it("never asks the model for an edge strength", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).not.toContain("strength");
  });

  /**
   * The one prohibition that must survive every future edit: the model must not
   * invent a number the user did not state. This is the sentence the fabrication
   * gate rests on, so it is pinned by content rather than left to a hash that a
   * legitimate edit elsewhere would move.
   */
  it("keeps the do-not-invent-a-number prohibition", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).toContain(
      "Do not invent a number the\nuser did not state, and do not round or rescale one they did.",
    );
  });

  /**
   * ⭐ AND THE ANTI-PRESSURE CLAUSE, which is the reason zero claims is a
   * legitimate answer. Without it, "emit claims" reads as "emit claims", and a
   * model that cannot find a basis will manufacture one.
   */
  it("keeps empty basis as an explicitly legitimate answer", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).toContain("leave `basis` empty — that\nis a legitimate and expected answer");
    expect(DRAFT_RECORDS_INSTRUCTION).toContain("An empty `claims` list is a valid response.");
  });

  /**
   * The connect half is the half that could most easily be turned into pressure
   * to invent. It must keep BOTH of its balancing sentences: the one that removes
   * a claim, and the one that forbids dropping anything the user stated.
   */
  it("keeps both balancing sentences in the connect half", () => {
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("Do not emit a factor you cannot connect.");
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("But never drop something the user\nstated");
  });
});
