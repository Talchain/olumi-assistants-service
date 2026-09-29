/**
 * V5 product-state continuity (foamy-bee tranche) — DEFERRAL contract.
 *
 * The Phase 0 finding called out raw structural identifiers
 * (`constraint_id`, `node_id`, `operator` characters, `provenance`,
 * edge IDs) leaking into the default UI through the wire `graph_patch`
 * block's `before` and `after` records.
 *
 * The fix in this tranche stops short of a CEE-side schema change:
 * `@talchain/schemas/boundary/blocks.js → GraphPatchBlockSchema` is
 * `.strict()` and only permits
 * `{ type, status, operation, target_id, before, after }`. Adding a
 * `display` / `summary` / `applied_summary` field requires a
 * coordinated schemas package change, which is out of scope here.
 *
 * The deferral is documented in the [UI handoff brief]
 * (../../../../Docs/v5/foamy-bee-ui-handoff.md). This file pins the
 * contract that's still pending enforcement: every assertion below is
 * `it.todo` so it shows up in CI test reports as known-deferred. When
 * the schemas-package change lands, flip these to `it()` with bodies
 * and they'll fail until `compose.ts:buildBlocksFromFacts()` populates
 * the new field.
 */

import { describe, it } from 'vitest';

// Unblock condition (single source of truth):
//
//   When the vendored `@talchain/schemas` package widens
//   `GraphPatchBlockSchema` to permit a clean display field
//   (e.g. `display`, `summary`, `applied_summary`), populate it
//   in `compose.ts:buildBlocksFromFacts()` for the three V5
//   mutation fact types and flip every `it.todo` below to a
//   real `it()` body using the assertions implied by the title.
//   See `Docs/v5/foamy-bee-ui-handoff.md` for the renderer-side
//   contract this test pins.
const UNBLOCK_HINT = '[BLOCKED: schemas package coordination — see Docs/v5/foamy-bee-ui-handoff.md]';

describe(`graph_patch block — clean payload contract (DEFERRED) ${UNBLOCK_HINT}`, () => {
  describe('add_constraint mutation block', () => {
    it.todo(`emits a clean human-readable summary field alongside before/after ${UNBLOCK_HINT}`);
    it.todo(`omits constraint_id from any display-bearing field ${UNBLOCK_HINT}`);
    it.todo(`omits node_id from any display-bearing field ${UNBLOCK_HINT}`);
    it.todo(`omits provenance from any display-bearing field ${UNBLOCK_HINT}`);
    it.todo(`omits operator characters (<= / >=) in favour of decision-language phrases ${UNBLOCK_HINT}`);
  });

  describe('set_factor_value mutation block', () => {
    it.todo(`emits a clean human-readable summary field alongside before/after ${UNBLOCK_HINT}`);
    it.todo(`omits factor_id / target_id from any display-bearing field ${UNBLOCK_HINT}`);
    it.todo(`omits raw_value / cap from any display-bearing field ${UNBLOCK_HINT}`);
  });

  describe('adjust_edge_strength mutation block', () => {
    it.todo(`emits a clean human-readable summary field alongside before/after ${UNBLOCK_HINT}`);
    it.todo(`omits edge endpoint ids from any display-bearing field ${UNBLOCK_HINT}`);
    it.todo(`omits raw mean / std numbers in favour of influence-band words ${UNBLOCK_HINT}`);
  });
});
