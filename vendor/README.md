# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.13.0.tgz`

**Purpose:** pre-publish consumption of `@talchain/schemas` v0.13.0.
v0.13.0 adds the four V5 Phase 3 block types per Analysis tab data
contract v1.3 (`Docs/v5/v5-analysis-tab-data-contract-v1_3.md`),
plus the shared schemas they depend on. Additions:

- `ReviewCardBlockSchema` (emitted by the `decision_review` enricher
  after `run_analysis`; hero-eligible; eight `card_kind` values).
- `CoachingBlockSchema` (coaching pass + draft_graph threading;
  hero-eligible; six `coaching_kind` values).
- `EvidenceBlockSchema` (evidence-ranking module; hero-eligible;
  includes the v1.3 §1.3 `factor_ref` ↔ `target_refs` consistency
  rule enforced via `superRefine`).
- `ExerciseBlockSchema` (on-demand handler invocation; NOT
  hero-eligible).
- Shared: `ActionIntent` (15-value strict union), `TargetRefKind`
  (7-value, adds `outcome`), `TargetRefSchema`,
  `Phase3BlockFreshness` (`fresh | stale | pending | failed`),
  `Phase3BlockSeverity` (`info | warning | critical`).
- Common metadata block (§0) enforced on all four new block types:
  `block_id` (UUID), `signal_id`, `created_at` (ISO 8601 with
  offset), `source_handler`, `graph_hash_at_generation` (required
  for analysis-derived blocks, optional otherwise), `freshness`.
- Copy-length caps (§0.2): `title` ≤ 80, `body` ≤ 300,
  `action_label` ≤ 40 — enforced at the schema boundary as
  defence-in-depth.

Purely additive on the discriminated `BlockSchema` union — existing
block types (`text`, `error`, `analysis_result`, `graph_patch`,
`explanation`, `comparison`, `flip_analysis`, `draft_graph`) and
the existing `HandlerFact` discriminated union are unchanged. CEE
must add four new cases to the exhaustive switch in
`src/orchestrator-v5/compose/output-safety.ts` for the build to
compile after this bump — that is the deliberate boundary signal.

Note: `BlockSchema` is now a `ZodEffects<ZodDiscriminatedUnion>`
(the §1.3 consistency rule is applied at the union level via
`.superRefine`). Consumers calling `.parse()` / `.safeParse()` are
unaffected. Consumers introspecting `.options` / `.discriminator`
on the discriminated union (none in tree today) would be reading
through a `ZodEffects` wrapper.

Source lives at `~/Documents/GitHub/olumi-schemas/` on `main`
(HEAD `b239d4b6` — Merge pull request #3 from
`feat/phase-3a-block-types`); built via `npm run build && npm pack`
from source. Not yet published to a private registry.

**Checksum verification:** `vendor/talchain-schemas-0.13.0.tgz.sha256`
holds the canonical sha256 hash. The pre-push hook
(`scripts/validate-tarball-sha.sh`) verifies the tarball bytes against
this manifest on every push.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.12.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — i.e. the entire pin returns to v0.12.0 in
one commit. Re-run `pnpm install` after the revert to repopulate
`node_modules` from the restored tarball.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact) are
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
`package.json` to a registry version (`"@talchain/schemas": "^0.12.0"`,
or whatever version is current at the time of registry publication)
once `olumi-schemas` publishes to the private npm registry. Until then,
every consuming repo is expected to carry its own `vendor/` copy.
