# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.12.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.12.0.
v0.12.0 adds the canonical `EditGraphHandlerFact` member to the
`HandlerFact` discriminated union (DL-7 V5-integration contract).
Companion to the deterministic D1 mutation facts (`set_factor_value`,
`add_constraint`, `adjust_edge_strength`); covers the LLM-driven
`edit_graph` dispatcher path. Additions:

- `EditGraphResultSchema` (`{ edit_kind, status, operations_count,
  affected_entities[<=8], graph_hash_before/after, safe_summary
  [1..80], impact, rerun_recommended }`).
- `EditGraphHandlerFactSchema` (the new union member).
- Sub-enums `EditGraphEditKindSchema`
  (`'parameter_update' | 'option_configuration' | 'structural'`),
  `EditGraphImpactSchema` (`'low' | 'moderate' | 'high'`),
  `EditGraphAffectedEntitySchema` (`{ kind, label }`).
- A new canonical regression-fixture file at
  `tests/orchestrator/__fixtures__/handler-fact-fixtures.ts` with one
  valid sample per HandlerFact variant.

Purely additive: existing variants unchanged; existing consumers that
don't reference `'edit_graph'` continue to parse and operate
identically. CEE typecheck and tests pass cleanly after this vendor
bump even before the corresponding CEE wiring (DL-7 PR B) lands.

Source lives at `~/Documents/GitHub/olumi-schemas/` on
`claude/edit-graph-handler-fact` (HEAD `50c192cb`); built via
`npm run build && npm pack` from source. Not yet published to a
private registry.

`affected_entities[].kind` reuses the canonical `NodeKind` enum
from the schemas package (`src/graph.ts`: `'goal' | 'factor' |
'outcome' | 'risk' | 'action' | 'decision' | 'option' |
'constraint'`) PLUS the literal `'edge'` for edge-mutation
receipts. Pinned by tests at
`tests/orchestrator/handler-fact-edit-graph.test.ts` so any
future NodeKind extension flows through and any drift is caught.

**Checksum verification:** `vendor/talchain-schemas-0.12.0.tgz.sha256`
holds the canonical sha256 hash. The pre-push hook
(`scripts/validate-tarball-sha.sh`) verifies the tarball bytes against
this manifest on every push.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.11.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — i.e. the entire pin returns to v0.11.0 in
one commit. Re-run `pnpm install` after the revert to repopulate
`node_modules` from the restored tarball.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment) are removed on each bump — only the
currently-pinned version lives in `vendor/`.

**How to update:**

```bash
# 1. Rebuild the schemas package
cd ~/Documents/GitHub/olumi-schemas
npm run build
# 2. Bump the version in olumi-schemas/package.json if contents changed
#    (additive → patch/minor; breaking → major)
# 3. Pack
npm pack  # produces talchain-schemas-<version>.tgz
# 4. Replace the vendored copy here and update the sha256 manifest
cp talchain-schemas-<version>.tgz \
   /path/to/olumi-assistants-service/vendor/
shasum -a 256 /path/to/olumi-assistants-service/vendor/talchain-schemas-<version>.tgz \
  | awk '{print $1}' \
  > /path/to/olumi-assistants-service/vendor/talchain-schemas-<version>.tgz.sha256
# On Linux: use `sha256sum` in place of `shasum -a 256` (same output format)
# 5. Update package.json `file:` reference if the filename changed
# 6. pnpm install (reinstalls from the new tarball)
# 7. Delete the old tarball and its .sha256 from vendor/
# 8. Update the "Current contents" section of this README
```

**Removal criterion:** delete this tarball + the vendor entry and switch
`package.json` to a registry version (`"@talchain/schemas": "^0.12.0"`,
or whatever version is current at the time of registry publication)
once `olumi-schemas` publishes to the private npm registry. Until then,
every consuming repo is expected to carry its own `vendor/` copy.
