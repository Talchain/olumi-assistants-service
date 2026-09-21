/**
 * Salvage an otherwise-valid draft graph whose ONLY schema violation is a
 * malformed OPTIONAL `observed_state`.
 *
 * WHY THIS EXISTS — measured, not supposed. On 2026-09-21 the deployed
 * `Staging Journey Smoke` gate recorded draft failure rates of 40/60/20/40/40%
 * across five consecutive staging heads: two in five first turns returned a 500
 * with an empty `assistant_text`, and 0 of 5 journeys produced an analysable
 * model. A complete census of that window's `cee.structural_parse.failed`
 * events (17 events, 20 issues, no truncation) found EVERY issue at
 * `graph.nodes.N.observed_state` with code `invalid_union`.
 *
 * THE DEFECT IS THE BLAST RADIUS, NOT THE FIELD. `Node.observed_state` is
 * declared `NodeObservedState.optional()` (schemas/graph.ts:336). A node that
 * omits it parses cleanly. A node that carries a MALFORMED one fails the whole
 * `DraftGraphOutput.parse`, so one unparseable optional provenance field on one
 * node destroys the user's entire model. That asymmetry — absent is fine,
 * malformed is fatal — is the bug this closes.
 *
 * STRICTLY DOMINANT BY CONSTRUCTION. This runs ONLY after the full parse has
 * already failed, i.e. only on a path whose current outcome is a guaranteed
 * 500. It acts only when EVERY issue is an `observed_state` issue; a single
 * issue anywhere else and it declines, leaving the existing 500 byte-identical.
 * It cannot make any outcome worse, because the alternative it replaces is
 * total loss of the model.
 *
 * IT SHEDS A CLAIM, IT NEVER INVENTS ONE. The union deliberately refuses a
 * malformed constraint `observed_state` so that "you cannot slip a broken
 * operator through by shedding the constraint shape" (schemas/graph.ts:255-259).
 * Dropping the field entirely is the opposite of slipping one through: the node
 * keeps every other field and simply stops asserting a stored position it could
 * not express. No magnitude is written, moved or attributed — cf. the #853
 * prohibition recorded in stages/boundary.ts.
 *
 * WHAT IS NOT SETTLED, AND IS DISCLOSED RATHER THAN DECIDED: a CONSTRAINT node
 * that loses its threshold still renders, so a user could be shown a model whose
 * limit is no longer expressed. Whether a quietly weaker model beats a blank
 * screen is a product ruling, not a build decision. `salvageObservedState`
 * therefore reports every stripped node id and kind so the caller can disclose
 * them; it does not choose for the product.
 */

import type { ZodIssue } from "zod";

import { DraftGraphOutput } from "../../../../schemas/assist.js";

/** A node whose optional `observed_state` was shed to save the model. */
export interface StrippedObservedState {
  node_id: string;
  /** `kind` as the drafter emitted it — "constraint" carries the disclosure risk. */
  node_kind: string;
}

export interface ObservedStateSalvageResult {
  /** True only when re-parse succeeded after stripping. */
  salvaged: boolean;
  /** Populated only when `salvaged` is true. */
  stripped: StrippedObservedState[];
  /** Why salvage declined, for telemetry. Absent when it succeeded. */
  declined_reason?:
    | "issue_outside_observed_state"
    | "no_observed_state_issues"
    | "would_strip_constraint"
    | "reparse_still_failed";
}

/**
 * Zod reports a failing optional union member at `graph.nodes.<i>.observed_state`.
 * Returns the node indices named by the issues, or null if ANY issue sits
 * elsewhere — that node index set is the only thing we are permitted to touch.
 */
function observedStateNodeIndices(issues: ReadonlyArray<ZodIssue>): number[] | null {
  const indices = new Set<number>();
  for (const issue of issues) {
    const path = Array.isArray(issue?.path) ? issue.path : null;
    if (path === null) return null;
    // Expected exactly: ["graph", "nodes", <number>, "observed_state", ...]
    if (path[0] !== "graph" || path[1] !== "nodes" || path[3] !== "observed_state") return null;
    // ONLY `invalid_union`. A MALFORMED CONSTRAINT observed_state (metadata
    // present, operator missing or invalid) trips FactorObservedState's
    // refinement and is reported as `custom`, NOT `invalid_union` — measured,
    // not supposed. That refusal is deliberate: schemas/graph.ts:255-259 exists
    // so "you cannot slip a broken operator through by shedding the constraint
    // shape", and shedding it is exactly what this module does. Salvaging a
    // `custom` issue would therefore OVERRIDE that ruling. It declines instead.
    // The 2026-09-21 census recorded 20 of 20 issues as `invalid_union`, so
    // this narrowing costs nothing against the measured population.
    if (issue?.code !== "invalid_union") return null;
    const idx = path[2];
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) return null;
    indices.add(idx);
  }
  return indices.size > 0 ? [...indices] : null;
}

/**
 * Attempt the salvage. `input` is the same object handed to
 * `DraftGraphOutput.parse`; `issues` are that parse's issues.
 *
 * On success the caller's `graph.nodes[i].observed_state` have been DELETED
 * in place, so downstream stages and the response see the salvaged model.
 */
export function salvageObservedState(
  input: { graph?: unknown },
  issues: ReadonlyArray<ZodIssue>,
): ObservedStateSalvageResult {
  const indices = observedStateNodeIndices(issues);
  if (indices === null) {
    return { salvaged: false, stripped: [], declined_reason: "issue_outside_observed_state" };
  }

  const graph = input?.graph as { nodes?: unknown } | undefined;
  const nodes = Array.isArray(graph?.nodes) ? (graph!.nodes as Array<Record<string, unknown>>) : null;
  if (nodes === null) {
    return { salvaged: false, stripped: [], declined_reason: "no_observed_state_issues" };
  }

  // ⛔ A CONSTRAINT NODE IS NEVER STRIPPED — the salvage declines wholesale and
  // the 500 stands. A constraint's `observed_state` carries its THRESHOLD: shed
  // it and the node still renders, so the user is shown a model whose own limit
  // has quietly stopped being expressed. For a brief like "£20k MRR within 12
  // months while keeping monthly churn under 4%", that is the user's stated
  // constraint vanishing with no refusal to see.
  //
  // ⚠ THIS IS A BET ON AN UNMEASURED POPULATION, DECLINED. The complete Render
  // census over 30h (hasMore:false) found 18 `structural_parse.failed` events,
  // 22 of 22 issues at `observed_state`/`invalid_union` — and it CANNOT say how
  // many were constraints, because every issue message is the bare string
  // "Invalid input" and `path` carries the node INDEX, not its kind. So nobody
  // can show a constraint has ever been stripped, and nobody can show one has
  // not. Declining costs nothing against the measured population if constraints
  // never appear there, and if they do it surfaces as
  // `stripped_constraint_nodes` without a single user having seen a model
  // missing its own limit. Disclosure can then be built on evidence instead of
  // speculation. (Reviewer's position on #1674; accepted.)
  //
  // Declines WHOLESALE rather than skipping the node: that node's
  // `observed_state` would still be invalid, so a partial strip cannot re-parse
  // anyway, and a half-stripped graph is a state no caller ever produces.
  for (const i of indices) {
    const node = nodes[i];
    if (node === undefined || node === null || typeof node !== "object") continue;
    if (node.kind === "constraint") {
      return { salvaged: false, stripped: [], declined_reason: "would_strip_constraint" };
    }
  }

  // Take a shallow copy of each targeted node so a failed re-parse leaves the
  // caller's graph exactly as it was. Nothing else in the graph is touched.
  const originals = new Map<number, unknown>();
  const stripped: StrippedObservedState[] = [];
  for (const i of indices) {
    const node = nodes[i];
    if (node === undefined || node === null || typeof node !== "object") continue;
    if (!("observed_state" in node)) continue;
    originals.set(i, node.observed_state);
    delete node.observed_state;
    stripped.push({
      node_id: typeof node.id === "string" ? node.id : `#${i}`,
      node_kind: typeof node.kind === "string" ? node.kind : "unknown",
    });
  }

  if (stripped.length === 0) {
    return { salvaged: false, stripped: [], declined_reason: "no_observed_state_issues" };
  }

  // ⚠ `.parse()` in a try/catch for the same reason as the caller: suites that
  // mock `DraftGraphOutput` expose only `.parse`, and `.safeParse` would throw
  // a TypeError rather than report a parse failure.
  let reparseSucceeded = false;
  try {
    DraftGraphOutput.parse(input);
    reparseSucceeded = true;
  } catch {
    reparseSucceeded = false;
  }
  if (reparseSucceeded) {
    return { salvaged: true, stripped };
  }

  // Re-parse still failed: restore byte-for-byte and decline, so the existing
  // 500 path sees precisely the graph it saw before.
  //
  // ⚠ HONEST NOTE ON COVERAGE: the mutant that deletes this restore SURVIVES
  // the suite (M2, 2026-09-21). That is not a gap in the tests but a property
  // of today's schema: no refinement anywhere in the chain depends on
  // `observed_state` being PRESENT — the only three are `uncertainty_drivers`
  // duplicates (graph.ts:189), FactorObservedState's own metadata rule (:267)
  // and the edge from/to rule (:577) — so once every issue is an
  // `invalid_union` at an observed_state path, stripping those paths cannot
  // leave a different rule failing, and this branch is unreachable.
  // It is KEPT rather than deleted because "unreachable under today's schema"
  // is not "unreachable": the day someone adds a cross-field refinement that
  // reads observed_state, this is what stops a half-stripped graph reaching
  // the 500 path in a state its caller never produced.
  for (const [i, value] of originals) {
    (nodes[i] as Record<string, unknown>).observed_state = value;
  }
  return { salvaged: false, stripped: [], declined_reason: "reparse_still_failed" };
}
