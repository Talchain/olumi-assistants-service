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

/**
 * HISTORIC — v2. The bytes served on every run measured up to and including
 * 2026-08-11 (the 0/27-accepted enumeration and the two arm-R1 measured blocks).
 * This literal is a RECORD and is never re-pointed: it is what makes those runs
 * attributable. The current instruction is v3 and deliberately does NOT hash to
 * it; the assertion below is that the two are DISTINCT, which is the honest
 * statement and the one that stays true forever.
 */
const HISTORIC_V2_INSTRUCTION_SHA256 =
  "e630587523d29ace5739d5c26754d787fb00479d542a3cb1fc7ca13ceb1eca26";
const HISTORIC_V2_INSTRUCTION_BYTES = 2351;

/**
 * ⭐ PRE-REGISTERED — v3, frozen 2026-08-12 BEFORE any run was spent on it.
 *
 * Pre-registration is the point: these bytes were hashed and written to the
 * evidence dir (`v3/PRE-REGISTRATION-V3.md`) before measurement, so the result of
 * the five-gate block cannot be attributed to an instruction that was quietly
 * tuned after seeing it.
 *
 * ⚠ STATUS AT THE TIME OF PINNING: UNMEASURED. v3 was written against the gate's
 * grammar derived at the validator's bytes and against the emission anatomy of the
 * banked corpus — NOT against a live result. A reader must not infer from the
 * existence of this pin that a measurement stands behind it; the evidence file
 * says so in terms, and this comment says so here because the pin is what a future
 * session will find first.
 *
 * These bytes SUPERSEDE the spike's pinned instruction BY DESIGN: the spike's
 * §1.4 pin governed the falsification experiment, and this is productionisation
 * under R1's own acceptance design, which is a different question.
 */
const HISTORIC_V3_INSTRUCTION_SHA256 =
  "494e52b9fca948660927849c870ca8a689cac7399ac100b185243f99a54f416b";
const HISTORIC_V3_INSTRUCTION_BYTES = 3673;

/**
 * ⭐ PRE-REGISTERED — v4, frozen 2026-08-12 BEFORE any acceptance run was spent
 * on it (`round7/PRE-REGISTRATION-V4.md`).
 *
 * v4 changes the REFERENCE SYNTAX and the option-chaining rule:
 *   · references are typed by FIELD (`from_stated`/`from_claim`/`to_stated`/
 *     `to_claim`, integers) instead of by a prefix character inside a string.
 *     A grammar cannot constrain a string's shape here — `pattern` is a
 *     forbidden structured-outputs keyword — so a TYPE on a FIELD is the only
 *     enforcement available.
 *   · the model is told to chain the option THE USER NAMED rather than its own
 *     refinement, which is the instruction-side half of a fix whose load-bearing
 *     half is deterministic (the projector merges a single refinement onto its
 *     stated parent).
 *
 * ⚠ v3 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED. Both long-brief
 * measured blocks were taken against exactly those bytes; re-pointing the
 * literal would detach that evidence from the artefact that produced it.
 */
const HISTORIC_V4_INSTRUCTION_SHA256 =
  "edc329f9d2496be3c1fbfba4f5f5968439d4178913f0b5b1967773ee6430e9f3";
const HISTORIC_V4_INSTRUCTION_BYTES = 4426;

/**
 * ⭐ PRE-REGISTERED — v5, frozen 2026-08-12 BEFORE any acceptance run was spent
 * on it (`round9/PRE-REGISTRATION-V5.md`).
 *
 * v5 changes ONE thing in the connect half, and the shape half does not move at
 * all (`175af059…` / 1,771 bytes, unchanged from v4 — asserted below):
 *
 *   **the goal is a `stated_item`, so a link that reaches it sets `to_stated`.**
 *
 * DERIVED, not guessed: `projector.ts` `CLAIM_KIND_TO_NODE_KIND` maps the four
 * claim kinds to `factor | option | null` and NEVER to `goal`, so no claims index
 * IS the goal. MEASURED cause: on round 7's run 8 the single link intended for
 * the goal was written with a claim reference. It resolved SUCCESSFULLY — to a
 * factor — so nothing terminated at the goal, every derived factor was withheld
 * as unconnected, and a completion pass that emitted TEN well-formed causal links
 * contributed ZERO nodes and ZERO edges.
 *
 * ⚠ THE GRAMMAR CANNOT ENFORCE THIS AND NO SCHEMA CAN. `{"to_claim": 0}` is
 * well-formed, in range, and denotes a real node of a legal kind; its wrongness
 * is a fact about what the model MEANT. A schema constrains documents, not
 * intentions. The instruction and the completion ask are the only places this can
 * be said, which is why it is said in both.
 *
 * ⚠ v4 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED — round 7's five-gate
 * block was measured against exactly those bytes.
 */
const HISTORIC_V5_INSTRUCTION_SHA256 =
  "2e5bc9695f1907a802ab9f2dfa7f697bf36692f10c3675e9227c06994de98182";
const HISTORIC_V5_INSTRUCTION_BYTES = 4688;

/**
 * ⭐ v6 — 2026-08-14, the instruction half of the risk/outcome grammar widening.
 *
 * ⚠ STATUS: UNMEASURED AGAINST A LIVE DRAW at the time of pinning, and this
 * comment is what a future session will find first, so it says so plainly. The
 * bytes were written against `grammar.ts`'s widened `DRAFT_RECORD_CLAIM_KINDS`,
 * against `ALLOWED_EDGES`, and against the SERVED graph prompt's own BRIDGE
 * TERMINALITY / NODE ORIENTATION sections — i.e. against three authorities at
 * their bytes, and against ZERO live results. What the model actually emits
 * under the widened schema is the post-merge deploy witness's job
 * (`scripts/records-pinned-brief-acceptance.ts`), and no claim about it is made
 * here.
 *
 * ⚠ v5 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED. The round-11 block and
 * every measurement taken through 2026-08-13 were served exactly those bytes;
 * re-pointing the literal would detach that evidence from the artefact that
 * produced it. Both halves moved in v6, which has not happened before — the
 * shape half changed in v4 only, and the connect half in v3/v4/v5 — because a
 * new claim KIND has to be both declared (shape) and connected (connect).
 */
const PREREGISTERED_V6_INSTRUCTION_SHA256 =
  "b4916b58954b30838a5ca37a770fd796371b17400a1002131defba6bd7a69162";
const PREREGISTERED_V6_INSTRUCTION_BYTES = 6021;

describe("the draft records instruction is the measured artefact", () => {
  it("hashes to the PRE-REGISTERED v6 value at the pinned byte length", () => {
    expect(draftRecordsInstructionHash()).toBe(PREREGISTERED_V6_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).toBe(
      PREREGISTERED_V6_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v5 bytes, so round 11's block stays attributable", () => {
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V5_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V5_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v4 bytes, so round 7's block stays attributable", () => {
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V4_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V4_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v3 bytes, so v3's measured blocks stay attributable", () => {
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V3_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V3_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v2 bytes, so v2's measurements stay attributable", () => {
    // The failure this guards is not a typo — it is someone "restoring" the old
    // pin, or hand-editing v3 back toward v2, and thereby making two different
    // instructions share one evidence base.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V2_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V2_INSTRUCTION_BYTES,
    );
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

  it("keeps the shape half independently pinned, so a reference-syntax edit is legible as one", () => {
    // The two halves were measured separately: the shape half alone produced
    // ZERO option-origin causal links over 44 links / 9 runs; adding the connect
    // half moved that to 28 of 75 on the first attempt. Pinning them apart is
    // what makes a future edit attributable to one half or the other.
    //
    // ⚠⚠ THE SHAPE HALF MOVED IN v4, AND IT HAD NEVER MOVED BEFORE. v2 and v3
    // shared it byte-for-byte (`a6de4225…`, 1,443 bytes) because both described
    // the same reference syntax. v4 changes that syntax — the namespace is now
    // the FIELD, not a prefix character inside a string — and the sentence that
    // teaches it lives in the shape half. Recorded explicitly because "the shape
    // half is unchanged" was true for two versions running and is exactly the
    // kind of inherited sentence that survives past the change that falsified it.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).toBe(
      "575509cbc8570c1bd4fb8d31f9ce8b83f3d5508f28f37a5f11417a1f6dd30a3e",
    );
    expect(Buffer.byteLength(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8")).toBe(2373);
    // HISTORIC — v4/v5's shared shape half. Asserted DISTINCT: it stood
    // unchanged for two versions, which is exactly the kind of "unchanged" a
    // reader inherits past the change that ended it.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "175af059317040381c4529c0e9ec0342070b7d14425b62fd6c5b374df48a99d6",
    );
    // HISTORIC — v2/v3's shared shape half. Asserted DISTINCT so the two cannot
    // be conflated in the record.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "a6de4225a94bf321185775a7b34d01b1eb4f7f9def5c0c6ee7b2f1fc95692a80",
    );
  });

  it("pins the v5 CONNECT half independently, so the half that changed is legible", () => {
    // v4 changes the connect half too: "chain the option the USER named" replaces
    // v3's "an option_refinement IS an option needing its own chain". That v3
    // sentence closed one direction of a defect and opened its mirror — the model
    // complied and left the user's own options bare — so the load-bearing half of
    // the v4 fix is DETERMINISTIC (the projector merges a lone refinement onto its
    // stated parent) and this sentence is only its instruction-side complement.
    //
    // ⭐ v5 adds ONE bullet to this half and changes nothing else: the goal is a
    // `stated_item`, so `to_stated` is how a link reaches it. That sentence is
    // the instruction-side half of round 9's goal-targeting fix; its
    // completion-side half names the goal's exact index in the ask.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).toBe("44c966336427c2672c2a0ee96bb6a507877ee7819660d77d496d9f982d1b879f");
    expect(Buffer.byteLength(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8")).toBe(3648);
    // HISTORIC — v5's connect half, asserted DISTINCT.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("6f395141d575f2b1b6e04454da84dc0b755cadfc60bd77fde7894207913a5b87");
    // HISTORIC — v4's connect half, asserted DISTINCT.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("cb7fa43faf8237c974f044c098a6c97d8d9003733705f58ff2df3cf41786af74");
    // HISTORIC — v3's connect half, asserted DISTINCT.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("53a6955a40d9a8c877d8f1dc09f24343b3cfac540d74dfcc82aa507ea131d856");
  });

  /**
   * ⭐ THE v5 SENTENCE, PINNED BY CONTENT rather than only by a hash.
   *
   * A hash pin fails on ANY edit, which means it cannot tell "someone removed
   * the goal-targeting rule" from "someone fixed a typo two bullets away". This
   * is the one sentence round 9's whole goal-link fix rests on, so it is bound to
   * its own content — and bound to BOTH halves of the claim, because the negative
   * half ("`to_claim` cannot reach it") is the one that names the actual defect.
   */
  it("keeps the goal-is-a-stated-item rule that round 9 added", () => {
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "The goal is a `stated_item`, so a link that reaches it sets `to_stated`.",
    );
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "goal is never one of your `claims`, so `to_claim` cannot reach it",
    );
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
