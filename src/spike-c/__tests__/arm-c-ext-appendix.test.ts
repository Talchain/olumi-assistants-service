/**
 * SPIKE ARM C-EXTENDED — the appendix extension and its arm gate.
 *
 * ⚠ THROWAWAY. Spike branch only. Never merged, never pushed to `staging`.
 *
 * ── WHAT THIS FILE HAS TO PREVENT ──────────────────────────────────────────
 * C-ext exists because `C-BUILD-2` traced arm C's structural rejection to the
 * appendix. Two failures would make the re-measure worthless and BOTH are
 * silent:
 *
 *  1. THE FROZEN ARM-C BYTES DRIFT. Every P4C arm-C run is pinned to
 *     `a6de4225…`. If extending the instruction edited that string instead of
 *     appending to a new one, the pre-registration hash stops verifying, the
 *     P4C runs stop being reproducible, and the comparison becomes A-vs-C-ext
 *     with C's own numbers no longer attributable to anything. The hash literal
 *     below is the guard, and it is a HISTORIC RECORD: it may never be updated
 *     to match a new value (trap 14b — a dated pin is evidence, not a fixture).
 *
 *  2. THE ARMS BECOME INDISTINGUISHABLE. C and C-ext share the grammar, the
 *     projector and all three call sites by design, so the ONLY things that can
 *     tell a C-ext run from a C run in the record are the arm label and the
 *     appendix hash. If either were hardcoded, six C-ext runs would be filed as
 *     arm C and no reader could ever separate them.
 *
 * Both are asserted by IDENTITY (the exact hash, the exact label), never by a
 * predicate another value could satisfy (trap 19).
 */

import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  isSpikeArmC,
  isSpikeArmCExt,
  isSpikeArmCFamily,
  activeSpikeCAppendix,
  spikeCPreRegistration,
  SPIKE_C_SYSTEM_APPENDIX,
  SPIKE_C_EXT_SYSTEM_APPENDIX,
  SPIKE_C_EXT_APPENDIX_SECTION,
} from "../arm.js";

const ORIGINAL = process.env.SPIKE_ARM;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * The arm-C appendix hash as recorded in the P4C evidence and in
 * `SHA256-MANIFEST-SPIKE.txt`. HISTORIC — never update this literal.
 */
const FROZEN_ARM_C_APPENDIX_SHA256 =
  "a6de4225a94bf321185775a7b34d01b1eb4f7f9def5c0c6ee7b2f1fc95692a80";
/** The records grammar hash, likewise recorded at P3/P4C. C-ext does NOT touch the grammar. */
const FROZEN_RECORDS_SCHEMA_SHA256 =
  "4780361d4724bd663d3c404374c917d438f45006b098a67dd5d2c93ddb16c77a";

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SPIKE_ARM;
  else process.env.SPIKE_ARM = ORIGINAL;
});

describe("the frozen arm-C bytes survive the extension untouched", () => {
  it("hashes to the value pinned by the P4C pre-registration, exactly", () => {
    expect(sha256(SPIKE_C_SYSTEM_APPENDIX)).toBe(FROZEN_ARM_C_APPENDIX_SHA256);
  });

  it("C-ext is a PURE APPEND — the frozen bytes are its prefix, byte for byte", () => {
    expect(SPIKE_C_EXT_SYSTEM_APPENDIX.startsWith(SPIKE_C_SYSTEM_APPENDIX)).toBe(true);
    // and the remainder is exactly the declared section (no third, unnamed edit)
    expect(SPIKE_C_EXT_SYSTEM_APPENDIX.slice(SPIKE_C_SYSTEM_APPENDIX.length).trim())
      .toBe(SPIKE_C_EXT_APPENDIX_SECTION.trim());
  });

  it("the records grammar is NOT part of the intervention delta", () => {
    process.env.SPIKE_ARM = "C";
    const c = spikeCPreRegistration();
    process.env.SPIKE_ARM = "C_EXT";
    const ext = spikeCPreRegistration();
    expect(c.schema_sha256).toBe(FROZEN_RECORDS_SCHEMA_SHA256);
    expect(ext.schema_sha256).toBe(FROZEN_RECORDS_SCHEMA_SHA256);
  });
});

describe("the C-ext gate, in both directions", () => {
  it("is OFF when SPIKE_ARM is absent — the control must stay inert", () => {
    delete process.env.SPIKE_ARM;
    expect(isSpikeArmCExt()).toBe(false);
    expect(isSpikeArmCFamily()).toBe(false);
  });

  it("is ON only for exactly `C_EXT`, and never for `C`", () => {
    process.env.SPIKE_ARM = "C_EXT";
    expect(isSpikeArmCExt()).toBe(true);
    expect(isSpikeArmC()).toBe(false);
    process.env.SPIKE_ARM = "C";
    expect(isSpikeArmCExt()).toBe(false);
    expect(isSpikeArmC()).toBe(true);
  });

  it("is OFF for near-misses that a sloppy gate would accept", () => {
    for (const v of ["", "C_", "CEXT", "C-EXT", "c_ext", "C_EXT ", " C_EXT", "EXT", "A", "B"]) {
      process.env.SPIKE_ARM = v;
      expect(isSpikeArmCExt(), `SPIKE_ARM=${JSON.stringify(v)} must not arm C-ext`).toBe(false);
    }
  });

  it("the FAMILY gate arms the shared sites for both arms and for nothing else", () => {
    for (const [v, want] of [["C", true], ["C_EXT", true], ["A", false], ["B", false], ["", false]] as const) {
      process.env.SPIKE_ARM = v;
      expect(isSpikeArmCFamily(), `SPIKE_ARM=${JSON.stringify(v)}`).toBe(want);
    }
  });
});

describe("the served appendix is the DISCRIMINATING artefact between the two arms", () => {
  it("serves the frozen bytes under C and the extended bytes under C_EXT", () => {
    process.env.SPIKE_ARM = "C";
    expect(activeSpikeCAppendix()).toBe(SPIKE_C_SYSTEM_APPENDIX);
    process.env.SPIKE_ARM = "C_EXT";
    expect(activeSpikeCAppendix()).toBe(SPIKE_C_EXT_SYSTEM_APPENDIX);
  });

  it("stamps a DIFFERENT arm label and a DIFFERENT appendix hash per arm", () => {
    process.env.SPIKE_ARM = "C";
    const c = spikeCPreRegistration();
    process.env.SPIKE_ARM = "C_EXT";
    const ext = spikeCPreRegistration();
    expect(c.arm).toBe("C");
    expect(ext.arm).toBe("C_EXT");
    expect(c.appendix_sha256).toBe(FROZEN_ARM_C_APPENDIX_SHA256);
    expect(ext.appendix_sha256).not.toBe(c.appendix_sha256);
    expect(ext.appendix_bytes).toBeGreaterThan(c.appendix_bytes);
  });
});

describe("the extension says what the CONSUMER's predicate requires, and no more", () => {
  /**
   * These bind to the instruction's SUBSTANCE. Derived at
   * `graph-validator.ts` — `NO_EFFECT_PATH` (:822) needs option → controllable
   * factor → … → goal; `NO_PATH_TO_GOAL` (:620) needs every node to reach the
   * goal. An instruction that asked only for option-origin links would have been
   * written against the SYMPTOM `C-BUILD-2` named, not against the gate.
   */
  it("asks for the option-origin link (the C-BUILD-2 finding)", () => {
    expect(SPIKE_C_EXT_APPENDIX_SECTION).toContain("Every `option` needs at least one `causal_link` FROM it TO a factor");
  });

  it("asks for the chain to TERMINATE AT THE GOAL — not merely to exist", () => {
    expect(SPIKE_C_EXT_APPENDIX_SECTION).toContain("the chain must end");
    expect(SPIKE_C_EXT_APPENDIX_SECTION).toContain("`goal`");
  });

  it("keeps the user's stated items protected — connectivity may not become suppression", () => {
    // The one way this extension could BUY structural validity with fidelity is
    // by teaching the model to drop what it cannot connect. F1 is the floor that
    // forbids it, so the instruction says so explicitly.
    expect(SPIKE_C_EXT_APPENDIX_SECTION).toContain("never drop something the user");
    expect(SPIKE_C_EXT_APPENDIX_SECTION).toContain("keep it in `stated_items`");
  });

  it("says NOTHING about provenance, badges or authorship — the projector owns those", () => {
    // C-K4's premise is that the model has no field through which to express a
    // provenance claim. An instruction that discussed provenance would invite the
    // model to argue about it, and the grammar has nowhere to put the answer.
    for (const forbidden of ["provenance", "badge", "ai_inferred", "from_brief", "authorship", "stated provenance"]) {
      expect(SPIKE_C_EXT_APPENDIX_SECTION.toLowerCase(), `the extension must not mention ${forbidden}`)
        .not.toContain(forbidden.toLowerCase());
    }
  });

  it("CONTRAST CONTROL — none of the connectivity language is in the frozen arm-C bytes", () => {
    // Without this the four assertions above would pass on the base appendix too,
    // and would prove nothing about the delta (trap 13e: an absence claim needs a
    // contrast that reads the other way in the same run).
    for (const phrase of ["CONNECT WHAT YOU EMIT", "needs at least one `causal_link` FROM it", "the chain must end", "never drop something the user"]) {
      expect(SPIKE_C_SYSTEM_APPENDIX, `the frozen bytes must NOT already contain: ${phrase}`)
        .not.toContain(phrase);
      expect(SPIKE_C_EXT_SYSTEM_APPENDIX, `the extended bytes MUST contain: ${phrase}`)
        .toContain(phrase);
    }
  });
});
