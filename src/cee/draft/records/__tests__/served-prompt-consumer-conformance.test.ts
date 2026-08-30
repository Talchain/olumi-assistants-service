/**
 * SERVED PROMPT ↔ CONSUMER CONFORMANCE — the draft_graph seam.
 *
 * ── WHAT THIS GUARDS ───────────────────────────────────────────────────────
 * The model receives TWO system blocks on every draft (`anthropic.ts:517`):
 *   block 1 — the served PMS `draft_graph` prompt (canonical export in
 *             `Prompts/canonical/draft_graph.txt`, matched to the served bytes
 *             by sha256 in `Prompts/canonical/manifest.json`);
 *   block 2 — `DRAFT_RECORDS_INSTRUCTION`, a code constant.
 * The consumer is `projectDraftRecords` (`seam.ts`), whose FIRST and
 * UNCONDITIONAL check rejects a graph-shaped response.
 *
 * Nothing anywhere compared block 1 against that consumer. Served prompt v195
 * declared `Required keys: "nodes", "edges", "causal_claims", "coaching"` — the
 * exact shape the seam refuses — so ~half the served prompt instructed an
 * output that could only ever be a typed failure, and its own worked example
 * was rejected by the seam it feeds.
 *
 * ⚠ This is env-independent. `DRAFT_RECORDS_INSTRUCTION` is appended with NO
 * structured-outputs gate, so the contradiction is present whether or not
 * `CEE_ANTHROPIC_STRUCTURED_OUTPUTS` is true in the deployed environment. The
 * grammar only decides WHICH failure follows, never whether the prompt agrees
 * with its consumer.
 *
 * ── WHY IT IS DERIVED, NOT MIRRORED ────────────────────────────────────────
 * The forbidden/required key sets are read from `buildDraftRecordsSchema()`
 * ITSELF, never from a copy. A grammar edit moves this test's expectations with
 * it. The prompt bytes are read from the canonical export, so a PMS re-upload
 * that regenerates that file moves the other side.
 *
 * The historical-bytes control is pinned BY HASH, permanently (trap 12b: a
 * control pinned to "whatever is served now" decays into a tautology the first
 * time "now" changes). It must keep producing violations forever; if it ever
 * goes green, the detector has stopped detecting and THIS suite reds on the
 * control rather than silently blessing the product.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { buildDraftRecordsSchema, buildDraftClaimItemSchema } from "../grammar.js";
import { DRAFT_RECORDS_INSTRUCTION } from "../instruction.js";
import { projectDraftRecords, isGraphShapedResponse } from "../seam.js";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const CANONICAL = resolve(REPO_ROOT, "Prompts/canonical/draft_graph.txt");

/**
 * The v195 bytes, pinned by hash. THIS IS A HISTORIC RECORD, not a fixture that
 * tracks live (trap 14b: a corpus pinning what the product once served is
 * evidence, and evidence is append-only). It is the positive control: these
 * bytes MUST produce violations.
 */
const V195_SHA256_16 = "152998b447819c2e";

function sha16(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/** Every property key the attached grammar can emit, derived from the schema. */
function emittableKeys(): Set<string> {
  const root = buildDraftRecordsSchema() as {
    properties: {
      stated_items: { items: { properties: Record<string, unknown> } };
      claims: unknown;
    };
    required: string[];
  };
  const keys = new Set<string>(Object.keys(root.properties));
  for (const k of Object.keys(root.properties.stated_items.items.properties)) keys.add(k);
  const claimItem = buildDraftClaimItemSchema() as { properties: Record<string, unknown> };
  for (const k of Object.keys(claimItem.properties)) keys.add(k);
  return keys;
}

/**
 * The JSON keys a prompt DECLARES REQUIRED, parsed from its own
 * `Required keys:` / `Optional keys:` declarations. Derived from the prompt
 * text, so a prompt that stops declaring them stops asserting them.
 */
function declaredOutputKeys(prompt: string): string[] {
  const out: string[] = [];
  const re = /(?:Required|Optional) keys:\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    for (const q of m[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) out.push(q[1]);
  }
  return out;
}

/** Keys the prompt declares that the attached grammar cannot emit. */
function unemittableDeclaredKeys(prompt: string): string[] {
  const emittable = emittableKeys();
  return declaredOutputKeys(prompt).filter((k) => !emittable.has(k));
}

describe("served draft_graph prompt ↔ records consumer", () => {
  const served = readFileSync(CANONICAL, "utf8");

  it("instrument: the probe can see a presence and discriminates (positive + fabricated control)", () => {
    // Trap 13: an absence assertion is vacuous until the probe proves it can
    // see a presence. Trap 20: a probe returning the same answer for every
    // input is reporting on itself.
    expect(served.length).toBeGreaterThan(1000);
    const emittable = emittableKeys();
    expect(emittable.size).toBeGreaterThan(5);
    // Contrast control: real grammar keys ARE emittable, a fabricated one is not.
    expect(emittable.has("stated_items")).toBe(true);
    expect(emittable.has("claims")).toBe(true);
    expect(emittable.has("ZZQQ_FABRICATED_CONTROL")).toBe(false);
    // The declared-key parser must be able to find keys in SOME prompt.
    expect(declaredOutputKeys('Required keys: "a", "b".').sort()).toEqual(["a", "b"]);
    expect(declaredOutputKeys("no declarations here")).toEqual([]);
  });

  it("POSITIVE CONTROL (v195, pinned by hash): the historic bytes DO violate the grammar", () => {
    // If this ever goes green the detector has stopped detecting. It reds here,
    // on the control, instead of silently passing the product.
    const v195 = readFileSync(
      resolve(__dirname, "fixtures/served-draft-graph-v195.txt"),
      "utf8",
    );
    expect(sha16(v195)).toBe(V195_SHA256_16);
    const violations = unemittableDeclaredKeys(v195);
    expect(violations).toEqual(
      expect.arrayContaining(["nodes", "edges", "causal_claims", "coaching"]),
    );
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it("the served prompt declares no output key the attached grammar cannot emit", () => {
    const violations = unemittableDeclaredKeys(served);
    expect(violations).toEqual([]);
  });

  it("the ASSEMBLED system prompt teaches every key the grammar REQUIRES", () => {
    // ⚠ ASSERTED ON BOTH BLOCKS, because both are what the model receives
    // (`anthropic.ts:517` appends block 2 with no gate). Shape is deliberately
    // owned by block 2 alone — one contract, one owner (instruction.ts) — so
    // asserting block 1 in isolation would demand a SECOND copy of the shape
    // contract in the store and re-create the drift this seam exists to remove.
    // A required key absent from BOTH blocks is a key nothing teaches.
    const root = buildDraftRecordsSchema() as { required: string[] };
    const claimItem = buildDraftClaimItemSchema() as { required: string[] };
    const statedItem = (
      buildDraftRecordsSchema() as {
        properties: { stated_items: { items: { required: string[] } } };
      }
    ).properties.stated_items.items.required;

    const required = [...root.required, ...claimItem.required, ...statedItem];
    expect(required.length).toBeGreaterThan(0);

    const assembled = `${served}\n${DRAFT_RECORDS_INSTRUCTION}`;
    const missing = required.filter((k) => !assembled.includes(k));
    expect(missing).toEqual([]);
  });

  it("POSITIVE CONTROL (v195): the historic worked example IS rejected by the consumer", () => {
    // Proves the worked-example detector below can actually fail. Without this,
    // a prompt that simply ships no example would pass that guard vacuously.
    const v195 = readFileSync(
      resolve(__dirname, "fixtures/served-draft-graph-v195.txt"),
      "utf8",
    );
    const example = extractWorkedExample(v195);
    expect(example).not.toBeNull();
    expect(isGraphShapedResponse(example)).toBe(true);
    const result = projectDraftRecords(example);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("graph_shaped_response");
  });

  it("any worked example the served prompt ships is ACCEPTED by the consumer", () => {
    // A prompt need not ship an example — but one that does is telling the model
    // what to imitate, so the seam must accept it. If the seam rejects it, the
    // prompt's canonical demonstration is a typed failure.
    const example = extractWorkedExample(served);
    if (example === null) return; // no example shipped; nothing to contradict
    expect(isGraphShapedResponse(example)).toBe(false);
    const result = projectDraftRecords(example);
    expect(result.ok).toBe(true);
  });
});

/**
 * Pull the first complete JSON object out of the prompt's worked-example
 * section. Brace-balanced with string/escape awareness so a brace inside a
 * quoted label cannot truncate it.
 */
function extractWorkedExample(prompt: string): unknown {
  const section = prompt.indexOf("<ANNOTATED_EXAMPLE>");
  if (section < 0) return null;
  const start = prompt.indexOf("{", section);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < prompt.length; i++) {
    const c = prompt[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(prompt.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
