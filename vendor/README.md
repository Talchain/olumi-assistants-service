# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.31.0.tgz`

> **✔ PUBLISHED REGISTRY ARTIFACT — the released `@talchain/schemas@0.31.0`
> from GitHub Packages (`npm.pkg.github.com`), tag `v0.31.0` = commit
> `1454f6324f0f2d5c031b198e37d961ca807ab3d5`.** Vendored from the registry,
> never from a local `npm pack` of the branch — npm repacks on publish, so a
> branch pack has different bytes and a different hash; the 0.29.0 vendor commit
> learned that the hard way.

**Registry identity — DERIVED here, not inherited.** PLoT vendored 0.31.0 first
(#301) and its README asks the next consumer to confirm the same bytes. Rather
than take that on trust, all three agreements were re-measured against the
registry's own metadata during this re-vendor:

| # | check | result |
|---|-------|--------|
| 1 | registry `dist.shasum` vs `shasum -a 1` of these bytes | `bfd68db40b2e38af22e91a4b151b094ac8b31449` — **identical** |
| 2 | registry `dist.integrity` vs `openssl dgst -sha512 -binary … \| base64` | `sha512-hdsteWcP15vi…` — **identical** |
| 3 | that same string vs this repo's `pnpm-lock.yaml` `integrity` | **identical** (so every install re-verifies the registry bytes) |

Registry `dist-tags.latest` was `0.31.0` at vendor time, and the tarball's own
`package/package.json` reads `@talchain/schemas 0.31.0`. **Byte-identity with
PLoT is now established:** sha256 `a9efa0fd…`, 290,759 bytes — the same git blob
PLoT carries at `staging`. CEE is the SECOND consumer on 0.31.0; DGAI is still
on 0.30.0.

**What CEE adopts here:**

- **`goal_threshold_frame` (ROADMAP 2.258) — the reason for this bump.** CEE
  stamps `'level'` as a CODE CONSTANT (`CEE_GOAL_THRESHOLD_FRAME`,
  `src/utils/goal-threshold-cap.ts`) at both registration paths. ⚠ Adopting it
  required declaring the field in **`src/schemas/cee-v3.ts`** and carrying it in
  **`transformNodeToV3`**: `NodeV3` is a plain `z.object` ("declared fields only
  — unknown fields stripped") and the transform rebuilds nodes field-by-field,
  so an undeclared frame is deleted SILENTLY one hop before the PLoT payload.
  Pinned end-to-end with positive controls in
  `src/schemas/__tests__/goal-threshold-frame-wire-survival.test.ts`.
- **`critiques` on `CEE_UI_ENRICHMENT_KEEP_LIST`** — mirrored onto
  `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` (`src/orchestrator-v5/compose.ts`); the
  cross-repo drift bolt is DERIVED from the vendored constant, so it REDs on the
  re-vendor alone and goes green only once compose.ts matches — that is the
  RED-first entry point. Transport is licensed, sanitisation is not waived: the
  row is PROJECTED per-critique, never forwarded verbatim.
- **`EnrichmentCritiqueSchema`** — typed; CEE transports the rows, and now
  projects them.

**UNADOPTED in this bump** (typed and accepted, nothing emits one):
`action_prompt` on `CoachingBlockSchema` (2.225 — pinned in the egress
wire-surface test as contract-acceptance only), `declared_scale` /
`DECLARED_SCALE_BOUNDS` (2.193), `no_flip_in_range` (2.228).

⚠ **`direction` WENT REQUIRED → OPTIONAL ON FLIP ROWS, AND THAT ARMS A LATENT
FIXTURE TRAP.** Nothing in this bump breaks today, and no fixture was recaptured
here. But a FUTURE recapture of a PLoT envelope containing an attested no-flip
row (one that OMITS `direction` rather than sending the `'none'` placeholder)
would have failed against 0.30.0's required `z.string()`. The failure is
schema-mediated via `AnalysisEnrichmentSchema.safeParse`, not a literal
assertion, so it surfaces as an opaque parse error rather than a readable diff.
Re-vendoring BEFORE any recapture — as this PR does — is what defuses it.

⚠ **SEQUENCING — the goal-probability train has a HARD deploy order, and the
earlier cars are already landed.** schemas 0.31.0 → ISL converter deploy-verified
on staging (`29cb4e27`) → PLoT re-lands forwarding (#301, `7133bba1`) → **CEE's
stamp, this PR, is the last car.** CEE's stamp may land at any time: an
older-pinned PLoT strips the unknown key, which degrades to dark-but-honest (no
frame → no probability), never to a wrong number. The enrichment half is
additive-only (`enrichment` is `z.record(z.string(), z.unknown())` and the typed
envelope is `.passthrough()`), so there is no outage window and no forced landing
order against the UI.

**Checksum verification:** `vendor/talchain-schemas-0.31.0.tgz.sha256` holds the
canonical sha256 (`a9efa0fdb390faed86e53867024141cd86813b5d33379c2d21cb213b612de1ad`,
290,759 bytes). The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies
the tarball bytes against this manifest on every push.

**Rollback path:** revert the whole PR. Git history restores
`vendor/talchain-schemas-0.30.0.tgz`, its `.sha256`, the `package.json` `file:`
reference and this README. Re-run `pnpm install` after the revert. Unlike the
0.29.0 vendor commit this one could NOT be reverted alone — `src/schemas/cee-v3.ts`
and `src/schemas/graph.ts` now import `GoalThresholdFrame` from the package, so
the source changes must revert with it. Reverting does NOT unpublish 0.31.0.

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
value-carrying `factor_value_edit` inspector event, 0.30.0 at the VOI
keep-list family) are removed on each
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
