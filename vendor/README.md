# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.20.0.tgz`

Built from the **MERGED** olumi-schemas main
(`1b936ecaf9ddde0ee09566d13d686e07b8877751`, the squash of PR #12; tag
`v0.20.0` resolves to the same commit — verified with
`git rev-list -n1 v0.20.0`). Built via `npm ci && npm test && npm pack`
from a fresh blobless clone at that commit — **996/996 package tests
green**, including the dedicated
`tests/boundary/v020-readiness-and-signal-fields.test.ts` (30 tests).
`npm test` runs the tsc build first, so the packed dist is the tested
dist.

> **Registry note.** The package CHANGELOG's 0.20.0 heading still reads
> `(UNPUBLISHED — merge + publish are Paul-gated contract class)`; that
> line was written pre-merge and was not refreshed when the merge landed.
> It does not gate this re-vendor either way: CEE consumes the vendored
> tarball via `file:./vendor/...`, never a registry version (0.19.0 was
> itself vendored from a pre-release PR head). Registry state is
> orthogonal to this pin.

**Purpose — contract acceptance only. This PR adds NO emissions.**
0.20.0 carries two classes of change and CEE's obligation differs for
each:

1. **`analysis_readiness` joins `ActionType`** (the 10th value). This is
   an INGRESS obligation with a MIRROR hazard: CEE's B1 validator
   (`src/validators/b1.ts`) validates `chip.action_type` fail-closed, so
   an older CEE returns a 422 for the WHOLE turn — not just the chip —
   when the UI sends the new literal. **CEE must therefore re-vendor
   FIRST, before the UI's readiness sparks send it.** That handshake is
   pinned executably in
   `tests/contract/action-type-vocabulary-pin.test.ts`.
2. **`signal_code` / `signal` (four guidance blocks) and
   `framing_quality` (top-level)** are EGRESS additions. The block
   schemas and the envelope are `.strict()`, so a consumer on an older
   pin strict-fails a payload carrying them. **CEE must not emit them
   until DGAI has re-vendored ≥ 0.20.0** — emission is a SEPARATE,
   LATER PR. This one only widens what CEE will accept and what its
   schema surface declares.

0.19.0 → 0.20.0 is strictly additive: one new enum value, five new
optional fields, no existing field changed, removed, or re-typed; every
pre-0.20.0 payload still parses. The one new export, `FramingQuality`,
is a scalar vocabulary (`ready | thin | conflict`). The `signal` 140
cap is a WIRE bound, not a layout contract — consumers clamp visually.

**Checksum verification:** `vendor/talchain-schemas-0.20.0.tgz.sha256`
holds the canonical sha256 hash
(`854d2f1432f9204f778b11bb0ab1c97f3f30bc3bbedd65f6a0615b4b4d2771d0`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. DGAI's 0.20.0
re-vendor should vendor the byte-identical tarball — same hash, so the
two consumers are provably on the same contract.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.19.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — the entire pin returns to v0.19.0 in one
commit. Re-run `pnpm install` after the revert.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave, 0.18.0 at the
draft-goal-constraints wave, 0.19.0 at the wave-2 producer fields) are
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
