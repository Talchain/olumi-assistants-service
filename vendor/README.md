# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.5.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.5.0 for
V5 slices B + C + D1 + D2 (session + handler-fact + per-handler arg/result
+ handler-result block schemas, on top of the A1 `/boundary` +
`/orchestrator` surface). Authored at `~/Documents/GitHub/olumi-schemas/`;
not yet published to a private registry.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1) are removed on each
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
# 4. Replace the vendored copy here
cp talchain-schemas-<version>.tgz \
   /path/to/olumi-assistants-service/vendor/
# 5. Update package.json `file:` reference if the filename changed
# 6. pnpm install (reinstalls from the new tarball)
```

**Removal criterion:** delete this tarball + the vendor entry and switch
`package.json` to a registry version (`"@talchain/schemas": "^0.3.0"`)
once `olumi-schemas` publishes to the private npm registry. Until then,
every consuming repo is expected to carry its own `vendor/` copy.
