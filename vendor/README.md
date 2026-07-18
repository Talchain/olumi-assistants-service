# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.18.0.tgz`

**⚠ PRE-RELEASE — NOT A PUBLISHED ARTEFACT.** This tarball was built from
the head of olumi-schemas **PR #10** (`claude-schemas/draft-goal-constraints`
@ `8291ca03d2702a80b0cbd6629857ed92c34a6b26`), which is **open, unmerged and
Paul-gated**. There is no `v0.18.0` tag and no published 0.18.0 package.
**This vendored tarball MUST be replaced with the published artefact before
this branch merges.** Merging olumi-schemas PR #10 to `main` auto-publishes,
so the publish is Paul's to sequence.

**Purpose:** consumption of `@talchain/schemas` v0.18.0, which declares an
optional `goal_constraints` array on `DraftGraphBlockSchema` plus a new
`DraftGoalConstraintSchema` element type. This is the contract change that
unblocks CEE emitting the user's extracted hard constraints on the
`/orchestrate/v2/turn` draft wire: the block is `.strict()`, so before 0.18.0
an undeclared `goal_constraints` key produced `unrecognized_keys` →
`validateEgress` failure → an `EGRESS_CONTRACT_VIOLATION` envelope replacing
every draft response.

0.16.0 → 0.18.0 is strictly additive (verified against built dists at both
refs, 24/24 differential checks incl. positive controls):

- **0.17.0** — new `./fixtures` subpath export only (100 new exports, all
  behind that subpath; no existing entry point rewired).
- **0.18.0** — `DraftGraphBlockSchema.goal_constraints?` +
  `DraftGoalConstraintSchema` / `DraftGoalConstraint` exported from
  `/boundary`. `.strict()` is RETAINED on the block — the fix for a dropped
  field at this seam is to DECLARE it, never to loosen the block.

Zero exports removed or renamed across the whole 0.16.0 → 0.18.0 range; no
pre-existing validator tightened; no schema gained or lost strictness. The
`OlumiResponseSchema.draft_graph` projection is
`DraftGraphBlockSchema.omit({ type: true })`, so it inherits the new field
automatically — that projection is the wire location the UI reads.

Note the new element schema is deliberately NOT the existing
`boundary/run.ts` `GoalConstraintSchema`: that is a different payload at a
different seam (V2 run-request; `id` + `bound`, no `node_id`). They are kept
distinct and differently named on purpose — a same-named twin is a defect
class this programme has already paid for.

Source: olumi-schemas PR #10 head `8291ca03d2702a80b0cbd6629857ed92c34a6b26`;
built via `npm ci && npm run build && npm pack` from a fresh blobless clone at
that commit (918/918 package tests green at that head).

**Checksum verification:** `vendor/talchain-schemas-0.18.0.tgz.sha256`
holds the canonical sha256 hash
(`86c44b042d5423fcc87041941925beec53a726a439915562195c040f8c97ce7d`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. The byte-identical
tarball is vendored into DecisionGuideAI on branch
`fix/goal-constraints-ui-surface` — same hash, so the two consumers are
provably on the same contract.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.16.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — i.e. the entire pin returns to v0.16.0 in
one commit. Re-run `pnpm install` after the revert to repopulate
`node_modules` from the restored tarball.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave) are
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
