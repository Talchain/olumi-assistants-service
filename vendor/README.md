# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.15.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.15.0
(the 0.15.0 contract wave, olumi-schemas PR #7 — CEE-first pin bump per
the established rollout mechanics: CEE adopts before any consumer starts
emitting/depending on the new shapes). 0.15.0 is a superset of 0.14.0;
the whole delta is strictly additive (394 src insertions, 0 deletions —
zero removed, renamed, or tightened fields):

- Optional top-level `reasoning` on `OlumiResponseSchema` (formalises
  the `_reasoning` wire sidecar).
- New `held_proposal` block kind (`HeldProposalBlockSchema`) — durable,
  display-safe shape for held Graph Management mutations.
- New `ui_directive` block kind (`UiDirectiveBlockSchema` +
  `UiDirectiveVerb` enum).
- New `selection_change` inbound system-event (new `SystemEventSchema`
  member) + shared `SelectedElementRefSchema`.
- New optional `selected_elements` on `MessageTurnPayloadSchema`
  (reuses the shared ref schema).
- New standalone `DecisionRecordSchema`
  (`src/boundary/decision-record.ts`) — not wired into
  `OlumiResponseSchema` or any other producer schema yet.

No CEE import breaks: CEE code imports only names that exist in
0.14.0; 0.15.0 only adds new names/enum members plus the new optional
fields above. No behavioural change until code opts in to the new
shapes — this bump is pin-only.

Source: `olumi-schemas` `main` @ `b02ba489c368b8ab32e071a141212a221ed28705`
(v0.15.0; published to GitHub Packages); built via
`npm ci && npm run prepublishOnly && npm pack` from that commit
(745/745 package tests passed at build time).

**Checksum verification:** `vendor/talchain-schemas-0.15.0.tgz.sha256`
holds the canonical sha256 hash
(`50cc1e0c4d5fcab11cd75417c458dad17e7033760c9f4d30d50329a4b946f19f`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.14.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — i.e. the entire pin returns to v0.14.0 in
one commit. Re-run `pnpm install` after the revert to repopulate
`node_modules` from the restored tarball.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption) are removed on each bump — only the currently-pinned version
lives in `vendor/`.

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
`package.json` to a registry version (`"@talchain/schemas": "^0.15.0"`,
or whatever version is current at the time of the switch). 0.15.0 IS
published to GitHub Packages, but per ROLLOUT.md the staging consumers
stay on the vendored-tarball mechanism until all three services' prod
branches are migrated. Until then, every consuming repo is expected to
carry its own `vendor/` copy.
