# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.30.0.tgz`

> **✔ PUBLISHED TARBALL — the released `@talchain/schemas@0.30.0`, pulled from
> GitHub Packages via `npm pack @talchain/schemas@0.30.0`.** olumi-schemas PR #29
> merged as `f5815a34`, tagged `v0.30.0`, and the Publish Package run
> (`30445606038`) completed `success` with `Publish to GitHub Packages` green.
> **Vendored from the registry, never from a local `npm pack` of the branch** —
> npm repacks on publish, so a branch pack has different bytes and a different
> hash — the 0.29.0 vendor commit learned that the hard way (it first shipped a
> 254,301-byte branch pack, sha `2e866b89…`, against a 254,609-byte release, and
> had to re-vendor; see this file at the previous commit).
> Content verified at the bytes rather than assumed: the published
> `dist/boundary/enrichment.js` carries all four VOI keys on
> `CEE_UI_ENRICHMENT_KEEP_LIST`.

0.29.0 → 0.30.0 is a single-release step (no skew inherited: CEE was current).

**What CEE adopts here — exactly one thing:**

- **The VOI family on `CEE_UI_ENRICHMENT_KEEP_LIST` (0.30.0)** — `factor_evppi`,
  `decision_evpi`, `p_win_sensitivity`, `correlation_model`. CEE mirrors the same
  four onto `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` (`src/orchestrator-v5/compose.ts`)
  in this PR; the cross-repo drift bolt (`tests/contract/cee-to-ui.contract.test.ts`)
  is DERIVED from the vendored constant, so it REDs on the re-vendor alone and
  goes green only once compose.ts matches — that is the RED-first entry point.
- The new exported `EnrichmentFactorEvppiEntrySchema` is typed but **not read by
  CEE**: this repo transports the rows, it does not interpret them. The reader is
  the UI (V7-C slice 1c), and the claim cage lives there.

**Everything else in 0.30.0 is UNADOPTED**, which is the whole release — 0.30.0
is a keep-list + one entry schema, nothing more.

⚠ **SEQUENCING — THERE ISN'T ANY, AND THAT IS DERIVED, NOT ASSUMED.** Unlike the
0.29.0 `factor_value_edit` train (a `.strict()` union member, where a
below-pin consumer rejects the WHOLE turn), this change adds only ENRICHMENT
keys. `AnalysisResultBlockSchema.enrichment` is `z.record(z.string(),
z.unknown())` and the typed envelope is `.passthrough()` throughout, so an
additive enrichment key parses at every pinned validator including the UI's
current one. There is no outage window, no forced landing order, and no flag:
CEE and the UI can land in either order, and rollback is a revert.

**Checksum verification:** `vendor/talchain-schemas-0.30.0.tgz.sha256` holds the
canonical sha256 hash
(`cd3746369b26da20e079c8d8ec323294edcc46a32df6830b657aed2cd465a0cc`, 265,222
bytes). The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push.

**Rollback path:** revert the whole PR. Git history restores
`vendor/talchain-schemas-0.29.0.tgz`, its `.sha256`, the `package.json` `file:`
reference and this README. Re-run `pnpm install` after the revert. Unlike the
0.29.0 vendor commit, this one **could** be reverted alone — no CEE source
imports anything new from 0.30.0; the compose.ts keep-list entries are plain
string literals. Reverting here does NOT unpublish 0.30.0; the release stands.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave, 0.18.0 at the
draft-goal-constraints wave, 0.19.0 at the wave-2 producer fields,
0.20.0 at the readiness/signal/framing_quality wave, 0.21.0 at the
`what_changed` action-type wave, 0.22.0 at the Intent/chip.id +
graph-identity-handshake + batched direct_graph_edit wave, 0.23.0 at
the `graph_state` ingress / wave-2 graph write-identity boundary,
0.25.0 at the typed `constraint_verdict` wave, 0.29.0 at the
value-carrying `factor_value_edit` inspector event) are removed on each
bump — only the currently-pinned version lives in `vendor/`.

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
