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
    | "issue_path_not_an_array"
    | "issue_outside_observed_state"
    | "issue_code_not_invalid_union"
    | "issue_node_index_unusable"
    | "no_observed_state_issues"
    | "graph_has_no_node_array"
    | "no_node_carried_the_field"
    | "would_strip_constraint"
    | "would_strip_user_authority"
    | "reparse_still_failed";
}

/**
 * Zod reports a failing optional union member at `graph.nodes.<i>.observed_state`.
 * Returns the node indices named by the issues, or null if ANY issue sits
 * elsewhere — that node index set is the only thing we are permitted to touch.
 */
type IndicesOutcome =
  | { readonly ok: true; readonly indices: number[] }
  | { readonly ok: false; readonly reason: ObservedStateSalvageResult["declined_reason"] };

function observedStateNodeIndices(issues: ReadonlyArray<ZodIssue>): IndicesOutcome {
  const indices = new Set<number>();
  for (const issue of issues) {
    const path = Array.isArray(issue?.path) ? issue.path : null;
    if (path === null) return { ok: false, reason: "issue_path_not_an_array" };
    // Expected exactly: ["graph", "nodes", <number>, "observed_state", ...]
    if (path[0] !== "graph" || path[1] !== "nodes" || path[3] !== "observed_state") {
      return { ok: false, reason: "issue_outside_observed_state" };
    }
    // ONLY `invalid_union`. A MALFORMED CONSTRAINT observed_state (metadata
    // present, operator missing or invalid) trips FactorObservedState's
    // refinement and is reported as `custom`, NOT `invalid_union` — measured,
    // not supposed. That refusal is deliberate: schemas/graph.ts:255-259 exists
    // so "you cannot slip a broken operator through by shedding the constraint
    // shape", and shedding it is exactly what this module does. Salvaging a
    // `custom` issue would therefore OVERRIDE that ruling. It declines instead.
    // The 2026-09-21 census recorded 20 of 20 issues as `invalid_union`, so
    // this narrowing costs nothing against the measured population.
    //
    // ⚠ THIS NARROWING RESTS ON A ZOD INTERNAL, AND IS NOT THE ONLY GUARD. A
    // malformed constraint reports `custom` rather than `invalid_union` only
    // because `ZodUnion._parse` returns dirty-first. If that behaviour ever
    // changes, that case arrives here AS `invalid_union` and this check stops
    // refusing it — at which point the CONSTRAINT DECLINE below is what still
    // catches it. The two guards overlap by design; do not remove one on the
    // grounds that the other covers the case.
    if (issue?.code !== "invalid_union") {
      return { ok: false, reason: "issue_code_not_invalid_union" };
    }
    const idx = path[2];
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
      return { ok: false, reason: "issue_node_index_unusable" };
    }
    indices.add(idx);
  }
  return indices.size > 0
    ? { ok: true, indices: [...indices] }
    : { ok: false, reason: "no_observed_state_issues" };
}

/**
 * Attempt the salvage. `input` is the same object handed to
 * `DraftGraphOutput.parse`; `issues` are that parse's issues.
 *
 * On success the caller's `graph.nodes[i].observed_state` have been DELETED
 * in place, so downstream stages and the response see the salvaged model.
 */
/**
 * Node ids named as `goal_constraints[].node_id`. These carry a user-stated
 * threshold on whatever kind of node the drafter put it on.
 *
 * ⚠ TOTAL AND FAIL-SAFE: anything it cannot read yields an EMPTY set, which
 * makes hazard test 1 decline nothing. That is deliberate — tests 2 and 3 still
 * run, and a guard that threw here would turn an unreadable input into a lost
 * model, which is the harm this whole module exists to prevent.
 */
function goalConstraintNodeIds(goalConstraints: unknown): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(goalConstraints)) return ids;
  for (const entry of goalConstraints) {
    if (entry === null || typeof entry !== "object") continue;
    const id = (entry as Record<string, unknown>).node_id;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  return ids;
}

/**
 * `observed_state.source` literals that mean A HUMAN PUT THIS HERE.
 *
 * ⚠ NOT DERIVED FROM THE CONTRACT, DELIBERATELY — and taken verbatim from the
 * estate's own enumeration in `schemas/__tests__/observed-state-source-derivation.test.ts`,
 * which lists each literal beside the writer that emits it. The CEE/system
 * literals are excluded on purpose: `brief_extraction` is the SYSTEM's reading
 * of prose, and #853 is the record of exactly that being attributed to the user
 * with values 10^6x wrong (`stages/boundary.ts:82-87`). A guard that treated
 * the system's own reading as user authority would re-import that mistake.
 */
const USER_AUTHORED_SOURCES: ReadonlySet<string> = new Set([
  "user_override",     // CEE set_factor_value / chat edits
  "user_confirmed",    // UI "confirm as is"
  "user",              // UI Model-tab factor-value edit
  "user_edited",       // UI OutputsDock transition bridge
  "user_assumption",   // UI "mark as assumption"
  "user_calibration",  // UI inspector calibration
  "panel_elicited",    // CEE verified panel apply
]);

/**
 * Does this `observed_state` carry USER AUTHORITY that shedding would destroy?
 *
 * Two independent markers, either sufficient:
 *   · `source` names a user-authored writer (above); or
 *   · `stated_role` is present at all — it records WHAT THE USER STATED THE
 *     MAGNITUDE AS (`schemas/cee-v3.ts:137`), i.e. the reading itself is the
 *     user's, and `value-warrant-guard.ts:227` treats `stated_role: 'constraint'`
 *     as a REFUSAL to assert the value, which is meaning no other field carries.
 */
function carriesUserAuthority(obs: unknown): boolean {
  if (obs === null || typeof obs !== "object") return false;
  const o = obs as Record<string, unknown>;
  if (typeof o.source === "string" && USER_AUTHORED_SOURCES.has(o.source)) return true;
  if (o.stated_role !== undefined && o.stated_role !== null) return true;
  return false;
}

export function salvageObservedState(
  input: { graph?: unknown; goal_constraints?: unknown },
  issues: ReadonlyArray<ZodIssue>,
): ObservedStateSalvageResult {
  const outcome = observedStateNodeIndices(issues);
  if (!outcome.ok) {
    return { salvaged: false, stripped: [], declined_reason: outcome.reason };
  }
  const indices = outcome.indices;

  const graph = input?.graph as { nodes?: unknown } | undefined;
  const nodes = Array.isArray(graph?.nodes) ? (graph!.nodes as Array<Record<string, unknown>>) : null;
  if (nodes === null) {
    return { salvaged: false, stripped: [], declined_reason: "graph_has_no_node_array" };
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
  // ⛔ KEYED ON THE HAZARD, NOT ON `node.kind`. An earlier version declined only
  // when `kind === "constraint"` and was WRONG: the hazard lives in the
  // `observed_state` SHAPE and in the node's ROLE, neither of which `kind`
  // decides. Reproduced at review: an `observed_state` of
  // `{metadata:{operator:">"}}` was still SHED on factor, risk, outcome, goal,
  // option, decision and action — all seven of the other kinds.
  //
  // ⚠ WHY A NON-CONSTRAINT NODE CAN HOLD A THRESHOLD. `translator-v3.ts`'s
  // `buildParameterUncertaintiesV3` passes are BOTH factor-only, "which is why
  // an `outcome` or `risk` target has to carry its own `observed_state.value`"
  // (`d1-shared/constraint-write-admissibility.ts:47-52`). And losing that value
  // is not a missing check — `:41-44` records that PLoT then logs
  // `plot.constraint_no_observed_value` and "ISL may use base=0.0", i.e. the
  // user's threshold is compared against a FABRICATED ZERO, which that file
  // itself calls "worse than not checked".
  //
  // Three independent hazard tests, any one of which declines:
  const constraintTargetIds = goalConstraintNodeIds(input.goal_constraints);
  for (const i of indices) {
    const node = nodes[i];
    if (node === undefined || node === null || typeof node !== "object") continue;

    // 1. ROLE — the node is a `goal_constraints[]` target, so it carries a
    //    threshold regardless of its kind. This is the case `kind` missed.
    const nodeId = typeof node.id === "string" ? node.id : null;
    if (nodeId !== null && constraintTargetIds.has(nodeId)) {
      return { salvaged: false, stripped: [], declined_reason: "would_strip_constraint" };
    }

    // 2. SHAPE — the `observed_state` carries a `metadata` key, i.e. it is
    //    constraint-shaped whatever the node calls itself. This is the
    //    broken-operator hazard `schemas/graph.ts:255-259` exists to refuse.
    const obs = node.observed_state;
    if (obs !== null && typeof obs === "object" && "metadata" in (obs as Record<string, unknown>)) {
      return { salvaged: false, stripped: [], declined_reason: "would_strip_constraint" };
    }

    // 3. USER AUTHORITY — the observed_state records that a HUMAN put this
    //    here, via a user-authored `source` or any `stated_role`. Shedding it
    //    would delete user meaning with nothing shown to the user, which is
    //    what "explicit user meaning survives brief -> canonical model" and
    //    "unsupported semantics are exposed as unsupported, never silently
    //    approximated" forbid. FOUND BY EXECUTION, not by reading: a witness
    //    run at this head showed `{unit, stated_role, source:'user_override'}`
    //    being shed silently while the salvage reported success.
    if (carriesUserAuthority(obs)) {
      return { salvaged: false, stripped: [], declined_reason: "would_strip_user_authority" };
    }

    // 4. KIND — kept as well, not instead. It is the weakest of the three and
    //    the only one that was here before; removing it would narrow the guard
    //    on the strength of the other two being complete, which is not proven.
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
    return { salvaged: false, stripped: [], declined_reason: "no_node_carried_the_field" };
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
  // `observed_state` being PRESENT. Complete manifest of `src/schemas/*.ts` —
  // NINE refinements across FOUR files, not the three an earlier version of
  // this comment claimed: working-set.ts 3 (node-count cap, edge-count cap,
  // "at least one actionable element"), cee.ts 2 (request-mode rules),
  // cee-v3.ts 1 (`uncertainty_drivers` duplicates), graph.ts 3 (:189
  // duplicates, :267 FactorObservedState's own metadata rule, :577 edge
  // from/to). Only :267 touches `observed_state`, and it fires only when the
  // field is PRESENT and malformed. So stripping cannot leave a different rule
  // failing, and this branch is unreachable.
  //
  // It is KEPT rather than deleted purely as insurance against a FUTURE
  // refinement that reads `observed_state` — "unreachable under today's schema"
  // is not "unreachable".
  //
  // ⛔ DO NOT restate this as "the restore is what stops a half-stripped graph
  // reaching the 500 path". That claim was made here and MEASURED FALSE:
  // deleting the path guard AND this restore leaves the suite 10/10 green, and
  // the half-strip only becomes observable when the `invalid_union` CODE guard
  // is ALSO removed (then T2 and T4 RED). What actually stands between today's
  // code and a half-stripped graph is the CODE guard, not this restore.
  for (const [i, value] of originals) {
    (nodes[i] as Record<string, unknown>).observed_state = value;
  }
  return { salvaged: false, stripped: [], declined_reason: "reparse_still_failed" };
}
