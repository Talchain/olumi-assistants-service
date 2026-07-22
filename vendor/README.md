# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.21.0.tgz`

> **⚠ PREP TARBALL — NOT built from a merged tip. DO NOT MERGE this PR
> until re-packed + sha-verified against the MERGED schemas tip.**
> This tarball was packed from the **F2 CHANGE B PR head**
> (`olumi-schemas` PR #17, branch `feat/actiontype-what-changed`, commit
> `d27b1bb`), with the package version bumped to `0.21.0` **at pack time
> only** (the schemas repo bumps its version field at release time, so PR
> #17's `package.json` still reads `0.20.0`). The enum change is Paul-gated
> (contract class). Landing order: (1) PR #17 merges + is published as
> `0.21.0` → (2) re-pack the tarball from that MERGED tip, replace this
> file, and re-verify the sha256 below → (3) THIS CEE PR may merge → (4)
> A2's UI send. Never merge this CEE PR against the prep tarball.

Built via `npm run build && npm pack` from a fresh blobless clone at PR #17
head — the packed `dist/boundary/enums.js` carries the new `what_changed`
enum member (verified). The schemas package suite is **1012/1012 green** at
that commit, including the dedicated
`tests/boundary/actiontype-what-changed.test.ts` and the exact-set enum pin
in `tests/boundary/v020-readiness-and-signal-fields.test.ts`.

> **Registry note.** CEE consumes the vendored tarball via
> `file:./vendor/...`, never a registry version. Registry/publish state is
> orthogonal to this pin — but see the PREP caveat above: the CONTENT here
> must match the merged+published `0.21.0` before merge.

**Purpose — contract acceptance only (F2 CHANGE B accept-half). This PR
adds NO new EMISSIONS.** 0.21.0 is `0.20.0` plus ONE additive enum value:

0. **`what_changed` joins `ActionType`** (the 11th value). INGRESS
   obligation, same MIRROR hazard as `analysis_readiness`: CEE's B1
   validator (`src/validators/b1.ts`, derived from the vendored
   `OrchestratorTurnPayloadSchema`) validates `chip.action_type`
   fail-closed, so an older CEE 422s the WHOLE turn when the UI sends the
   new literal. **CEE must re-vendor + accept FIRST, before the UI's
   "What changed?" pill sends it.** Proven executably in
   `tests/contract/action-type-vocabulary-pin.test.ts` (acceptance +
   near-miss discrimination control). The typed pill is then routed to the
   run-comparison mechanism (freshness fail-closed) via the reused F2 CHANGE
   A forced-intent door (`detectChipClickForcedIntent` →
   `chipClickForcedIntent='what_changed'` → the run-comparison gate with
   `forceIntent`).

The 0.20.0 provenance below is retained for the two change classes that
0.20.0 introduced and that this re-vendor carries forward unchanged:

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

**Checksum verification:** `vendor/talchain-schemas-0.21.0.tgz.sha256`
holds the canonical sha256 hash
(`bbc6063bc2cc88b80407b3d488c2189d0b0c2fdb12e1956e4dc58600c2171c24`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. ⚠ This hash is for the
PREP tarball (packed from PR #17 head) — when the tarball is re-packed from
the MERGED+published `0.21.0` before merge, this hash and the sidecar MUST be
regenerated together (the merged-tip pack will differ byte-for-byte).

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.20.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — the entire pin returns to v0.20.0 in one
commit. Re-run `pnpm install` after the revert.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave, 0.18.0 at the
draft-goal-constraints wave, 0.19.0 at the wave-2 producer fields,
0.20.0 at the readiness/signal/framing_quality wave) are
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
