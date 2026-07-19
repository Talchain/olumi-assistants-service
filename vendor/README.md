# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.19.0.tgz`

**RELEASED.** Built from the **MERGED** olumi-schemas main
(`8088d4e96bdd606a9d86b15ad32f3a18ead08fab`, the squash of PR #11; tag
`v0.19.0`; published to GitHub Packages by run 29707387512 —
`Publish to GitHub Packages` step SUCCESS; the run-level red is the
known `Trigger propagation` missing-PAT failure that occurs on every
publish). Provenance chain, verified at the bytes: the PR-#11 head
(`2243599d`) and merged main share git tree
`7eff3a76838533574e6beee0b4124bdf8b3e573e`, a fresh
`npm ci && npm test && npm pack` at merged main (966/966 green)
reproduces this tarball sha256-identically, and the registry artefact's
raw tar stream is byte-identical to this tarball's
(`gzcat | shasum -a 256` = `7329ebd43625fe7b01f1ec25e7fcbbd0636b6251cde01d311db058c2aed26185`
for both; only the gzip wrapper differs, so the registry sha512 differs
while the content is provably the same).

**Purpose:** the wave-2 producer fields (task #13). This re-vendor is what
lets CEE (a) add `decision_brief` to `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP`
without breaking the contract test that binds the CEE list
element-for-element to the package's `CEE_UI_ENRICHMENT_KEEP_LIST`
(11 → 12 keys), and (b) later emit the strict-schema additions (guidance
`category`/`priority`, `Action.detail`, `framing_question`,
`decision_classification`) once DGAI has re-vendored — those emissions are
a SEPARATE PR gated on the DGAI re-vendor merging, because a 0.18.0
consumer strict-fails a block carrying the new keys.

0.18.0 → 0.19.0 is strictly additive (966/966 package tests green at the
built head, including the maximality ratchet over every new optional
field; per-change rationale in the package CHANGELOG): optional
`category`/`priority` on the four Phase-3 block schemas, optional
`framing_question`/`decision_classification` on `OlumiResponseSchema`,
optional `detail` on `ActionSchema`, typed `recovery`/`recovery_suggestion`
on `CeeTypedErrorSchema` (passthrough), typed `edge_e_values[].stability`
band, `decision_brief` keep-list key + typed-open enrichment field, and
the `priority_rank`/`Stage` contract statements. Zero exports removed or
renamed; no schema gained or lost strictness.

Source: olumi-schemas main `8088d4e96bdd606a9d86b15ad32f3a18ead08fab`
(tag `v0.19.0`); built via `npm ci && npm test && npm pack` from a fresh
clone at that commit (`npm test` runs the tsc build first, so the packed
dist is the tested dist).

**Checksum verification:** `vendor/talchain-schemas-0.19.0.tgz.sha256`
holds the canonical sha256 hash
(`2ba3ebe99b407372b21ad925872846cb8fd8dbfcb4a00ca26c9398d229d8fc04`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. DGAI's 0.19.0
re-vendor should vendor the byte-identical tarball — same hash, so the
two consumers are provably on the same contract.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.18.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — the entire pin returns to v0.18.0 in one
commit. Re-run `pnpm install` after the revert.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave, 0.18.0 at the
draft-goal-constraints wave) are removed on each bump — only the
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
`package.json` to a registry version (`"@talchain/schemas": "^0.16.0"`,
or whatever version is current at the time of the switch). 0.16.0 IS
published to GitHub Packages, but per ROLLOUT.md the staging consumers
stay on the vendored-tarball mechanism until all three services' prod
branches are migrated. Until then, every consuming repo is expected to
carry its own `vendor/` copy.
