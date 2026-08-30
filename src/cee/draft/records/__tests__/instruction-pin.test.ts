/**
 * Instruction identity, not semantic or live-promotion evidence.
 *
 * Historical pins are immutable attribution records. v11 is the unpromoted
 * PR #1228 instruction candidate; its hash must not be described as served
 * until deployment is independently witnessed. A hash deliberately changes on
 * an unrelated spelling edit, so these tests do not claim semantic compatibility.
 * The assembled-adapter and behavioural suites provide those different proofs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDraftRecordsSchema } from "../grammar.js";
import {
  DRAFT_RECORDS_INSTRUCTION,
  DRAFT_RECORDS_SHAPE_INSTRUCTION,
  DRAFT_RECORDS_CONNECT_INSTRUCTION,
  DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION,
  draftRecordsInstructionHash,
} from "../instruction.js";

const HISTORIC_INSTRUCTIONS = [
  // v2: measured enumeration / R1 blocks through 2026-08-11.
  { version: 2, sha256: "e630587523d29ace5739d5c26754d787fb00479d542a3cb1fc7ca13ceb1eca26", bytes: 2351 },
  // v3-v7: pre-registered artefacts, unmeasured at original pinning.
  { version: 3, sha256: "494e52b9fca948660927849c870ca8a689cac7399ac100b185243f99a54f416b", bytes: 3673 },
  { version: 4, sha256: "edc329f9d2496be3c1fbfba4f5f5968439d4178913f0b5b1967773ee6430e9f3", bytes: 4426 },
  { version: 5, sha256: "2e5bc9695f1907a802ab9f2dfa7f697bf36692f10c3675e9227c06994de98182", bytes: 4688 },
  { version: 6, sha256: "b4916b58954b30838a5ca37a770fd796371b17400a1002131defba6bd7a69162", bytes: 6021 },
  { version: 7, sha256: "37f271b2377bc1f8a84c8b822af1a626aea22832ca767cfa8f897076f8c69af8", bytes: 6748 },
  // v8: unmeasured; the independent-model proxy failed its deployed control.
  { version: 8, sha256: "acd9148eb107ea85d839fd1198a4eff9659b3ab81b36ef2255d5c029837a0b4d", bytes: 8265 },
  // v9-v10: unmeasured at original pinning. The hashes are not success claims.
  { version: 9, sha256: "7629e9ec738786eb4624b078a62c81a5f4e5c90adc2bb4e1b5edbd820f97def8", bytes: 9183 },
  { version: 10, sha256: "3a1226696828692f6538a2de8bc8e156c5a9ce69575748c23094444642e81ce1", bytes: 10079 },
] as const;

// v11 changes semantic guidance and embeds the actual machine schema. It is
// separately identified instead of rewriting any historical evidence pin.
const CANDIDATE_V11 = {
  instruction: { sha256: "51d260e6bc07b8d80ea170533e2ec2f565ed8ee83fbe63be1aed351ac35770fa", bytes: 12554 },
  shape: { sha256: "c5741d81cb6fa76a0c6d995a7054a89c8cfd910dc7e8a2241119af80677c6103", bytes: 7890 },
  connect: { sha256: "9ec1533ffe0859418fbdfb1a6a678ddac8fcbd2d35ef4aaedd37b09c645d2903", bytes: 4664 },
} as const;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("draft records instruction artefact identity", () => {
  it("pins the unpromoted v11 candidate without repointing served v10 evidence", () => {
    expect(draftRecordsInstructionHash()).toBe(CANDIDATE_V11.instruction.sha256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).toBe(CANDIDATE_V11.instruction.bytes);
  });

  it("preserves the full v10 instruction fixture at the historic hash and byte length", () => {
    // Text fixtures end with LF; the exported constant historically used
    // trimEnd(). No other whitespace or content is normalised here.
    const historic = readFileSync(
      new URL("./fixtures/records-instruction-v10.txt", import.meta.url),
      "utf8",
    ).trimEnd();
    const pin = HISTORIC_INSTRUCTIONS.find((entry) => entry.version === 10)!;
    expect(sha256(historic)).toBe(pin.sha256);
    expect(Buffer.byteLength(historic, "utf8")).toBe(pin.bytes);
  });

  it.each(HISTORIC_INSTRUCTIONS)("keeps v$version measurements attributable to distinct bytes", (pin) => {
    expect(draftRecordsInstructionHash()).not.toBe(pin.sha256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(pin.bytes);
  });

  it("keeps every historical version once, so table-driven pins cannot silently disappear", () => {
    expect(HISTORIC_INSTRUCTIONS.map((entry) => entry.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(HISTORIC_INSTRUCTIONS.map((entry) => entry.sha256)).size).toBe(9);
  });

  it("is exactly the two independently pinned sections, in production order", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).toBe(
      `${DRAFT_RECORDS_SHAPE_INSTRUCTION}\n${DRAFT_RECORDS_CONNECT_INSTRUCTION}`.trimEnd(),
    );
    expect(sha256(DRAFT_RECORDS_SHAPE_INSTRUCTION)).toBe(CANDIDATE_V11.shape.sha256);
    expect(Buffer.byteLength(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8")).toBe(CANDIDATE_V11.shape.bytes);
    expect(sha256(DRAFT_RECORDS_CONNECT_INSTRUCTION)).toBe(CANDIDATE_V11.connect.sha256);
    expect(Buffer.byteLength(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8")).toBe(CANDIDATE_V11.connect.bytes);
  });

  it("the prompt-only machine shape is the actual attached grammar, not a prose mirror", () => {
    const match = /^<DRAFT_RECORDS_MACHINE_SCHEMA>\n([\s\S]+)\n<\/DRAFT_RECORDS_MACHINE_SCHEMA>$/.exec(
      DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION,
    );
    expect(match, "the complete machine-schema block must be readable").not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual(buildDraftRecordsSchema());
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION.split(DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION)).toHaveLength(2);
  });
});
