# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.16.0.tgz`

**Purpose:** consumption of `@talchain/schemas` v0.16.0 (the 0.16.0
decision-record additive wave, olumi-schemas PR #8 — Paul-approved and
merged; CEE-first pin bump per the established rollout mechanics: CEE
adopts before any consumer starts emitting/depending on the new shapes).
0.16.0 is a superset of 0.15.0; the whole delta is strictly additive and
confined to the standalone `DecisionRecordSchema` family
(`src/boundary/decision-record.ts`) — zero fields removed, renamed, or
tightened; every object schema stays `.strict()`:

- `prediction.probability_of_goal?` + `prediction.probability_of_joint_goal?`
  (`z.number().min(0).max(1).optional()`, both) — D-N Option-B scoring
  derisk: both candidate goal-attainment probabilities captured from day
  one so a Neil overrule is a recompute, never lost data.
- `prediction.confidence_source?` — new closed enum
  `DecisionRecordConfidenceSource` (`'model_derived' | 'user_stated'`),
  the calibration pack's binding honesty constraint (the two populations
  are never blended); absent ⇒ `model_derived` (disclosed inference).
- `decision.committed_by_user?` (boolean) — explicit "log this decision"
  commits vs ambient auto-capture (calibration pack lane 3a).

No CEE import breaks: 0.16.0 only adds new optional fields plus one new
exported enum. `DecisionRecordSchema` is standalone (not wired into
`OlumiResponseSchema` or any other producer schema), so no wire-surface
pin, block allowlist, or sanitiser bolt is affected by this bump. Compat
was proven both directions in the schemas PR against built dists: base
0.15.0 hard-rejects the new fields ("Unrecognized key(s)"); a maximal
0.15.0-shaped payload round-trips byte-identically under 0.16.0
(761/761 package tests green).

Source: `olumi-schemas` `main` @ `45b8bcae3f66a43c849eab16c157323092f43cee`
(v0.16.0; the publish workflow's "Publish to GitHub Packages" step
succeeded — only its post-publish "Trigger propagation" step failed on a
missing token); built via `npm ci && npm run prepublishOnly && npm pack`
from a fresh clone at that commit (761/761 package tests passed at build
time).

**Checksum verification:** `vendor/talchain-schemas-0.16.0.tgz.sha256`
holds the canonical sha256 hash
(`65adade472d57f94e86c5f5199a1aa37b133dcbab9519e68d4a1106b206219d6`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.15.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — i.e. the entire pin returns to v0.15.0 in
one commit. Re-run `pnpm install` after the revert to repopulate
`node_modules` from the restored tarball.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave) are
removed on each bump — only the currently-pinned version lives in
`vendor/`.

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
`package.json` to a registry version (`"@talchain/schemas": "^0.16.0"`,
or whatever version is current at the time of the switch). 0.16.0 IS
published to GitHub Packages, but per ROLLOUT.md the staging consumers
stay on the vendored-tarball mechanism until all three services' prod
branches are migrated. Until then, every consuming repo is expected to
carry its own `vendor/` copy.
