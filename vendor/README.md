# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.10.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.10.0.
Adds optional `graph_hash_at_run` and `computed_at` fields to
`RunAnalysisResultSchema` (v0.10.0) for V5 state-trust freshness
derivation, and bundles the in-flight v0.9.0 work
(`ExplainResultsResultSchema`, `ExplainFromStructureResultSchema`,
`WhatWouldFlipResultSchema` reshape, plus the matching handler-fact
schemas). Source lives at `~/Documents/GitHub/olumi-schemas/`; built
via `npm pack` from source. Not yet published to a private registry.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at B+C,
0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G) are removed on each
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
`package.json` to a registry version (`"@talchain/schemas": "^0.8.1"`)
once `olumi-schemas` publishes to the private npm registry. Until then,
every consuming repo is expected to carry its own `vendor/` copy.
