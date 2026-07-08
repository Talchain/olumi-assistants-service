# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.14.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.14.0
(rollout step 2 of `olumi-schemas` `docs/enrichment-v1/ROLLOUT.md` —
CEE is the FIRST consumer to adopt). v0.14.0 is a superset of 0.13.1;
both deltas over the previously-pinned 0.13.0 are additive:

- **0.13.1 delta (the ingress-skew defusal):** two OPTIONAL keys on
  `MessageTurnPayloadSchema` — `generate_model` / `explicit_generate`.
  The schema is `.strict()`, so on 0.13.0 CEE's B1 `validateIngress`
  REJECTED (422 `INGRESS_CONTRACT_VIOLATION`, fail-closed) any
  `kind:'message'` turn carrying either key. With this pin CEE now
  ACCEPTS them — a UI on 0.13.1+ may start emitting the flags on
  `/orchestrate/v2/turn` without detonating the validator.
- **0.14.0 delta (opt-in enrichment envelope):** typed
  `AnalysisEnrichmentSchema` (passthrough + all-optional) for the
  PLoT→CEE analysis-enrichment payload, `parseAnalysisEnrichment`,
  and `CEE_UI_ENRICHMENT_KEEP_LIST` — the single source of truth for
  the 11-key CEE→UI safe-transport keep-list, mirrored against
  `src/orchestrator-v5/compose.ts` `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP`
  by the drift bolt in `tests/contract/cee-to-ui.contract.test.ts`.
  No transport field changes, no strictness changes.

No CEE import breaks: CEE code imports only names that exist in
0.13.0; 0.14.0 adds names. No behavioural change until code opts in
to the new envelope types.

Source: `olumi-schemas` `main` @ `5612e266632bd759d4b5457923e58517b3a0f531`
(tag `v0.14.0`; published to GitHub Packages); built via
`npm ci && npm run prepublishOnly && npm pack` from that commit.

**Checksum verification:** `vendor/talchain-schemas-0.14.0.tgz.sha256`
holds the canonical sha256 hash
(`4e4915552a36654b7736eb56d42740e44b5c655209b606882782c55aff749767`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.13.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — i.e. the entire pin returns to v0.13.0 in
one commit. Re-run `pnpm install` after the revert to repopulate
`node_modules` from the restored tarball. NOTE: rolling back re-arms
the 0.13.0 strict-ingress landmine — the UI must not be emitting
`generate_model`/`explicit_generate` while CEE sits on ≤0.13.0.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types) are removed on each bump — only
the currently-pinned version lives in `vendor/`.

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
`package.json` to a registry version (`"@talchain/schemas": "^0.14.0"`,
or whatever version is current at the time of the switch). 0.14.0 IS
published to GitHub Packages, but per ROLLOUT.md the staging consumers
stay on the vendored-tarball mechanism until all three services' prod
branches are migrated. Until then, every consuming repo is expected to
carry its own `vendor/` copy.
