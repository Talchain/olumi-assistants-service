/**
 * THE node-scoped violation/repair path builders.
 *
 * ## Why this module exists
 *
 * A validation issue that concerns a single node carries a `path` string, and
 * the estate mints that string in TWO different shapes depending on which pass
 * produced it:
 *
 *   - the authoritative validator (`graph-validator.ts`) → `nodesById.<id>`
 *     (documented at `graph-validator.types.ts:133`)
 *   - the deterministic repair sweep                     → `nodes[<id>]`
 *
 * Both literals used to be hand-written at every site, and they drifted apart in
 * the one place that COMPARED them. The repair sweep's Step 8 built its
 * duplicate-suppression set from validator-produced paths and then probed it
 * with a sweep-format string:
 *
 *   const existingPaths = new Set(validatorErrors.map((v) => v.path)); // nodesById.opt_a
 *   if (!existingPaths.has(`nodes[${optId}]`)) { push(...) }           // nodes[opt_a]
 *
 * `"nodes[opt_a]"` never equals `"nodesById.opt_a"`, so the guard was
 * STRUCTURALLY INCAPABLE of suppressing anything: every option the validator had
 * already flagged `NO_PATH_TO_GOAL` was reported a second time, inflating
 * `ctx.remainingViolations` — whose length is serialized to clients as
 * `trace.repair_summary.remaining_violations_count`.
 *
 * ## The rule this module enforces
 *
 * Platform CLAUDE.md trap 12: *derive, don't mirror*. A path format that two
 * sites must agree on is exactly the hand-maintained mirror that drifts
 * silently, so neither site writes the literal any more — both call the builder
 * here.
 *
 * ## Why `nodePathAliases` and not an inverse parser
 *
 * The obvious alternative — parse the node id back out of the path and compare
 * ids — cannot be made exact. Node ids are `z.string().min(1)` with no character
 * class (`src/schemas/graph.ts:270`), so an id may legally contain `.` or `]`
 * and `nodesById.a.b` is genuinely ambiguous between id `a` and id `a.b`.
 * Building every alias for a KNOWN id and testing set membership is exact for
 * any id string, and it keeps the comparison derived from the same two builders
 * that do the emitting: a change to either builder moves the comparison with it,
 * and adding a third format is a one-line change in one file.
 *
 * ## Scope
 *
 * These are the BARE node paths only. Field-scoped paths (`nodesById.<id>.data.value`,
 * `nodes[<id>].category`) are built by suffixing a bare path and are not
 * enumerated here — nothing compares those across families.
 */

/**
 * Validator-family bare node path: `nodesById.<id>`.
 *
 * Minted by `graph-validator.ts` for every node-scoped `ValidationIssue`.
 */
export function validatorNodePath(nodeId: string): string {
  return `nodesById.${nodeId}`;
}

/**
 * Repair-sweep-family bare node path: `nodes[<id>]`.
 *
 * Minted by the deterministic sweep and its sibling repair passes. Parsed back
 * into a node id by `stages/boundary.ts` (`/^nodes\[([^\]]+)\]/`) when turning a
 * repair into a user-visible `model_adjustments` entry, so the shape is
 * effectively wire-facing and must not change casually.
 */
export function sweepNodePath(nodeId: string): string {
  return `nodes[${nodeId}]`;
}

/**
 * Every bare-node-path spelling of `nodeId` across both families.
 *
 * Derived by calling the builders above, so it cannot drift from them.
 */
export function nodePathAliases(nodeId: string): readonly string[] {
  return [validatorNodePath(nodeId), sweepNodePath(nodeId)];
}

/**
 * Is `nodeId` already named by one of `paths`, in EITHER path family?
 *
 * The format-agnostic membership test that the duplicate-suppression guards use
 * in place of comparing one hand-written literal against another.
 */
export function pathsNameNode(paths: ReadonlySet<string>, nodeId: string): boolean {
  return nodePathAliases(nodeId).some((p) => paths.has(p));
}
