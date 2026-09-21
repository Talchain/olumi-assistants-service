/**
 * ⭐⭐⭐ MORNING ACCEPTANCE, ITEM 1 — FAITHFUL INITIAL GRAPH, OFFLINE, ZERO API COST.
 *
 * The acceptance is not "tests are green" and not "PRs merged". It is that the
 * initial model keeps the person's whole proposal and offers a useful alternative
 * they did not name. This file asserts the part that CAN be established without
 * spending a provider call, against every capture we hold:
 *
 *   · five banked live pass-1 record sets (15 Sep)
 *   · the 16 Sep witness (served prompt v201, instruction sha 52c1c94a = v17,
 *     model claude-sonnet-4-6)
 *
 * ⚠ WHAT THIS CANNOT SHOW, said plainly so nobody reads more into a green run:
 * replay proves PRESERVATION and PROJECTION. It cannot prove improved
 * GENERATION, because the records are fixed. A generation claim needs a live
 * draw, and one draw is not a rate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANKED = resolve(HERE, "fixtures/2026-09-15-option-effect-references");

function findList(o: unknown, key: string): unknown[] | undefined {
  if (Array.isArray(o)) {
    for (const v of o) { const r = findList(v, key); if (r) return r; }
    return undefined;
  }
  if (o !== null && typeof o === "object") {
    const rec = o as Record<string, unknown>;
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
    for (const v of Object.values(rec)) { const r = findList(v, key); if (r) return r; }
  }
  return undefined;
}

function load(path: string): DraftRecordSet | undefined {
  if (!existsSync(path)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const stated_items = findList(raw, "stated_items");
  const claims = findList(raw, "claims");
  if (!stated_items || !claims) return undefined;
  return { stated_items, claims } as unknown as DraftRecordSet;
}

/** Every capture this repo carries, by name, so a shrunk corpus is visible. */
const CAPTURES: ReadonlyArray<{ name: string; records: DraftRecordSet }> = readdirSync(BANKED)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f, records: load(resolve(BANKED, f)) }))
  .filter((x): x is { name: string; records: DraftRecordSet } => x.records !== undefined);

type Node = Record<string, any>;
const project = (r: DraftRecordSet, boundary?: number) =>
  projectRecordsToGraph(r, undefined, boundary) as unknown as {
    graph: { nodes: ReadonlyArray<Node> };
    dropped: ReadonlyArray<{ reason: string }>;
  };

describe("A0 — the corpus is non-empty and named, so a shrunk one cannot pass silently", () => {
  it("A0a every banked capture loads", () => {
    expect(CAPTURES.length, `captures found: ${CAPTURES.map((c) => c.name).join(", ")}`).toBeGreaterThanOrEqual(6);
  });
});

/**
 * ⛔⛔ A1 PREVIOUSLY ASSERTED `ratio < 1000` AND THAT WAS WRONG — struck on
 * independent review, in its own words: "the new morning-acceptance ratio<1000
 * assertion likewise encodes a rule contradicted by legitimate native
 * quantities; it is not a general acceptance criterion."
 *
 * The reviewer is right and the counterexample is already in this repo:
 * `projector-scale-projection` asserts, deliberately, that £0.50 penny pricing
 * beside £50,000 enterprise pricing shares one frame — a legitimate 100,000x
 * span. An acceptance criterion that fails that is asserting my detector's
 * heuristic as a property of good models. It is not one.
 *
 * ⭐ WHAT IS ACTUALLY TRUE AND WORTH ASSERTING: nothing is deleted, and a
 * cross-pass divergence is reported. A detector may flag suspicion; it may not
 * prove a value invalid, and acceptance may not encode the detector's guess as
 * a fact about the world.
 */
describe("A1 — no magnitude is deleted, whatever its scale", () => {
  it.each(CAPTURES.map((c) => [c.name, c] as const))(
    "%s: supplying the pass boundary removes no option magnitude",
    (_name, capture) => {
      const boundary = capture.records.claims.length;
      const count = (p: ReturnType<typeof project>) =>
        p.graph.nodes
          .filter((n) => n.kind === "option")
          .reduce((acc, o) => acc + Object.keys((o.data?.interventions ?? {}) as object).length, 0);
      expect(
        count(project(capture.records, boundary)),
        "a detector may flag suspicion; it may not delete a value",
      ).toBe(count(project(capture.records)));
    },
  );
});

describe("A2 — the change preserves every alternative it found before", () => {
  it.each(CAPTURES.map((c) => [c.name, c] as const))(
    "%s: option set is identical with and without the pass boundary",
    (_name, capture) => {
      const before = project(capture.records).graph.nodes
        .filter((n) => n.kind === "option").map((n) => String(n.label)).sort();
      const after = project(capture.records, capture.records.claims.length).graph.nodes
        .filter((n) => n.kind === "option").map((n) => String(n.label)).sort();
      expect(after, "a number may be refused; an alternative may not").toEqual(before);
    },
  );
});

describe("A3 — the person's stated figures still reach the graph as evidence", () => {
  it.each(CAPTURES.map((c) => [c.name, c] as const))(
    "%s: every stated figure the model cited survives in basis_figures",
    (_name, capture) => {
      const stated = capture.records.stated_items as unknown as ReadonlyArray<Record<string, unknown>>;
      const cited = new Set<number>();
      for (const c of capture.records.claims as unknown as ReadonlyArray<Record<string, unknown>>) {
        for (const b of (Array.isArray(c.basis) ? c.basis : []) as number[]) {
          const item = stated[b];
          if (item?.kind === "figure" && typeof item.value === "number") cited.add(item.value as number);
        }
      }
      if (cited.size === 0) return; // this capture stated no cited figures
      const carried = new Set<number>();
      for (const n of project(capture.records, capture.records.claims.length).graph.nodes) {
        for (const f of (n.provenance?.basis_figures ?? []) as Array<{ value?: number }>) {
          if (typeof f.value === "number") carried.add(f.value);
        }
      }
      for (const v of cited) {
        expect(carried.has(v), `the model cited ${v} and it must remain visible as evidence`).toBe(true);
      }
    },
  );
});
