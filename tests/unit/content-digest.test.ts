import { describe, it, expect } from "vitest";
import { contentDigest } from "../../src/utils/redaction.js";
import { createHash } from "node:crypto";

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

describe("contentDigest", () => {
  it("emits only a hash and length — never the raw content — by default", () => {
    const secret = "The launch codes are 8675309 and my email is alice@example.com";
    const d = contentDigest(secret);

    // No raw content on the wire.
    expect(JSON.stringify(d)).not.toContain("launch codes");
    expect(JSON.stringify(d)).not.toContain("alice@example.com");
    expect(JSON.stringify(d)).not.toContain("8675309");

    // Only the safe derivatives are present.
    expect(d).toEqual({ sha256_16: sha16(secret), length: secret.length });
    expect(d.head).toBeUndefined();
  });

  it("is stable and collision-correlating for identical content", () => {
    const a = contentDigest("same output");
    const b = contentDigest("same output");
    const c = contentDigest("different output");
    expect(a.sha256_16).toBe(b.sha256_16);
    expect(a.sha256_16).not.toBe(c.sha256_16);
  });

  it("serializes non-string values (objects) before digesting", () => {
    const obj = { nodes: [{ id: "n1", label: "secret label" }] };
    const d = contentDigest(obj);
    const serialized = JSON.stringify(obj);
    expect(d).toEqual({ sha256_16: sha16(serialized), length: serialized.length });
    expect(JSON.stringify(d)).not.toContain("secret label");
  });

  it("handles null and undefined as empty content", () => {
    expect(contentDigest(null)).toEqual({ sha256_16: sha16(""), length: 0 });
    expect(contentDigest(undefined)).toEqual({ sha256_16: sha16(""), length: 0 });
  });

  it("opt-in head is capped and passed through the PII guard (no raw PII prefix)", () => {
    const value = "alice@example.com started the analysis with a very long preamble that continues";
    const d = contentDigest(value, { headChars: 40 });
    expect(d.head).toBeDefined();
    // The head is scrubbed: the email inside the prefix must not survive verbatim.
    expect(d.head).not.toContain("alice@example.com");
    // And it is bounded by the requested prefix window (post-scrub length may differ, but
    // it must never exceed a scrub of the first headChars characters).
    expect(d.head!.length).toBeLessThanOrEqual(value.slice(0, 40).length + 32);
  });

  it("omits head when headChars is 0 or content is empty", () => {
    expect(contentDigest("some text", { headChars: 0 }).head).toBeUndefined();
    expect(contentDigest("", { headChars: 50 }).head).toBeUndefined();
  });
});
