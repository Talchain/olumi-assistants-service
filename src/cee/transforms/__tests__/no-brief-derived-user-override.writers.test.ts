/**
 * ROADMAP 2.714 REVERTED — the DERIVED half of the guard.
 *
 * `no-brief-derived-user-override.test.ts` is a CORPUS: it proves the ten
 * measured briefs no longer fabricate. A corpus can only ever notice the cases
 * someone thought to write down — which is exactly how #853 shipped a 25/25
 * mutant kit blind to all six of its own defects (CLAUDE.md trap 12d: deriving
 * a guard from a list MOVES the risk, it does not remove it; ship BOTH the
 * derivation and the corpus, because neither supersedes the other).
 *
 * This file is the other half. It DERIVES, from the source tree at your tip,
 * the complete set of files that can stamp `observed_state.source =
 * "user_override"` — the marking that tells a user "this number is yours" and
 * earns the "From brief"/"Edited" provenance pill — and pins it to a reviewed
 * manifest. It answers the question the corpus cannot: *is the list right?*
 *
 * WHY THIS EXACT PREDICATE. The review's core finding was not a coding error;
 * it was that every invariant in #853 was true AS STATED while the PREDICATE
 * IMPLEMENTING IT had the wrong domain. The user-facing claim here —
 * "you told us this number" — has exactly one honest truth condition: the value
 * arrived through an operation the user consented to. So the manifest below
 * records, per file, HOW the value reaches the stamp. A new entry is not
 * automatically wrong; it is unreviewed, and it must justify itself against
 * that truth condition before it is added.
 *
 * NUL-SAFETY: `readFileSync(..., "utf8")` reads NUL-bearing sources fine, which
 * plain `grep` does not (CLAUDE.md trap 17) — this repo has at least one such
 * file, so the scan must not shell out to grep.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";

const SRC_ROOT = resolve(process.cwd(), "src");

/** The wire literal that marks a value as the user's own. */
const USER_OVERRIDE_LITERAL = "user_override";

/**
 * Every `src/` file permitted to carry the `user_override` literal, with the
 * path by which a value reaches the stamp. Reviewed 8 Aug 2026 alongside the
 * 2.714 revert.
 */
const REVIEWED: Readonly<Record<string, string>> = {
  // Declares USER_EDIT_SOURCE and stamps it onto `update_node` ops that carry
  // an `observed_state.value` — i.e. a value the user wrote through a
  // structured patch operation they consented to. The stamp is TRUE here.
  "orchestrator/canonicalise-value-ops.ts":
    "declares USER_EDIT_SOURCE; stamps only structured update_node value ops (user-consented edit)",
  // The enum member itself plus the schema comments describing which writers
  // may emit it. Declaration site, not a writer.
  "schemas/cee-v3.ts":
    "ObservedStateV3.source enum member + the comments naming its legitimate writers — declaration, not a write",
  // ── Comment-only mentions. Both are the 2.714 revert's own prose, on the
  // ── seam the removed rule sat on, warning the next author off it. Neither
  // ── file contains a write. This guard cannot tell a mention from a write —
  // ── that is deliberate: an unreviewed appearance of the literal is exactly
  // ── the signal worth stopping on, and the cost is one manifest line.
  "cee/transforms/graph-data-integrity.ts":
    "comment only — the `_brief` parameter doc recording why no integrity check may read the brief",
  "cee/unified-pipeline/stages/boundary.ts":
    "comment only — the stage comment recording that the removed 2.714 check stamped brief text this way",
  // ── 0.40.0, the panel-apply slice. Reviewed 14 Aug 2026 against this guard's
  // ── one truth condition: "did the value arrive through an operation the user
  // ── consented to?"
  //
  // THE STAMP SITE. It writes USER_EDIT_SOURCE for an inspector/chat value edit
  // — a structured operation the user performed, so the stamp is TRUE — and now
  // carries the literal in prose as well. The 0.40.0 change makes it stamp LESS
  // often, not more: when the server has verified that the number is a named
  // colleague's panel answer, it stamps `panel_elicited` + `elicited_from`
  // instead. That is this guard's own principle applied one case further out —
  // the old behaviour claimed "you told us this number" about a value the owner
  // had merely retyped from someone else's answer, which is the same class of
  // untruth 2.714 was reverted for, one seam downstream.
  "orchestrator-v5/tools/handlers/set-factor-value.ts":
    "the stamp site — user_override for a user-consented structured edit; stamps panel_elicited instead when CEE has VERIFIED the value is a named participant's panel answer",
  // Comment only. Contains no write of any kind: it is a pure verifier that
  // reads the collab store and either returns a server-owned value or refuses.
  // The literal appears in its header, explaining the attribution untruth the
  // module exists to close.
  "collab/apply-verification.ts":
    "comment only — the module header naming the user_override untruth it closes; the module performs no write",
};

/**
 * ⚠ NOT IN THE MANIFEST, DELIBERATELY: any rule that reads a number out of
 * FREE-BRIEF TEXT and stamps it `user_override`. That is the 2.714 defect
 * class. The brief is prose the user wrote about their decision; it is not an
 * instruction to set a field, and a value inferred from it is the SYSTEM'S
 * READING, never the user's statement. `stated-value-honour.ts` was removed
 * for exactly this reason, having been measured writing values that were
 * 10^6x wrong, explicitly negated, retracted, or never stated — each one
 * attributed back to the user with an empty skip list.
 */

function walkTypeScript(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      walkTypeScript(full, out);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    // Tests assert ABOUT the stamp; they never emit one onto the wire.
    if (full.includes("__tests__")) continue;
    out.push(full);
  }
  return out;
}

describe("2.714 revert — the user_override writer set is DERIVED and pinned", () => {
  const files = walkTypeScript(SRC_ROOT);
  const carriers = files
    .filter((f) => readFileSync(f, "utf8").includes(USER_OVERRIDE_LITERAL))
    .map((f) => relative(SRC_ROOT, f))
    .sort();

  it("the scan is actually running (it would pass vacuously on an empty walk)", () => {
    expect(files.length, "the src/ walk found no TypeScript files").toBeGreaterThan(100);
    // The literal must exist SOMEWHERE, or the scan is matching nothing and
    // every assertion below is vacuous.
    expect(carriers.length).toBeGreaterThan(0);
  });

  it("no UNREVIEWED file can stamp a value as the user's own", () => {
    const unreviewed = carriers.filter((rel) => !(rel in REVIEWED));
    expect(
      unreviewed,
      `These src/ files carry the \`${USER_OVERRIDE_LITERAL}\` literal but are not in this ` +
        `guard's REVIEWED manifest:\n` +
        unreviewed.map((f) => `  - ${f}`).join("\n") +
        `\n\nBefore adding one, answer the only question that matters: by what path does the ` +
        `value reach the stamp? "The user told us this number" is true ONLY when the value ` +
        `arrived through an operation the user consented to. A value READ OUT OF THE BRIEF ` +
        `is the system's reading of prose, not the user's statement — that is the ROADMAP ` +
        `2.714 defect this guard exists to stop coming back.`,
    ).toEqual([]);
  });

  it("the REVIEWED manifest has no stale entries", () => {
    const present = new Set(carriers);
    for (const rel of Object.keys(REVIEWED)) {
      expect(
        present.has(rel),
        `REVIEWED lists ${rel}, which no longer carries the literal in src/`,
      ).toBe(true);
    }
  });

  it("the removed 2.714 module is gone from src/ entirely", () => {
    const revertedModule = files.map((f) => relative(SRC_ROOT, f));
    expect(revertedModule).not.toContain("cee/transforms/stated-value-honour.ts");
  });
});
