# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.29.0.tgz`

> **⚠ PRE-PUBLISH TARBALL — built from `Talchain/olumi-schemas` branch
> `lane/factor-value-edit-event` at `ef58d93a`, NOT from GitHub Packages.** That
> branch is PR #28, which is HELD for orchestrator review. `npm run build && npm
> pack` on that tip produced these bytes. **The orchestrator must RE-VENDOR
> against the published `0.29.0` at merge time** — this pin is a build artefact of
> an unmerged branch and its bytes are not the released ones until it is.

0.25.0 → 0.29.0 is a FOUR-RELEASE jump (0.26.0, 0.27.0, 0.28.0 landed 26–27 Jul
while CEE stayed on 0.25.0 — parent CLAUDE.md hazard 1, measured not assumed).
**The jump was isolated with a control before any code was written:** vendoring
UNMODIFIED `0.28.0` into this repo and running `pnpm typecheck` gave 0 errors,
identical to the 0.25.0 baseline. So the inherited skew is typecheck-clean on its
own, and any error after the 0.29.0 bump is attributable to the new member rather
than to three releases of drift. (Measured again at 0.29.0: still 0 errors.)

**What CEE adopts here — exactly one thing:**

- **`factor_value_edit` on `SystemEventSchema` (0.29.0)** — the VALUE-CARRYING
  inspector edit. `{ target_id, value, raw_value?, unit?, field? }`, `.strict()`
  like every sibling of that union. `target_id` is ID-ADDRESSED; `value` is the
  MODEL scale and `raw_value` the USER-UNIT magnitude, borrowing the vocabulary of
  this repo's own `d1-shared/normalise-factor-value.ts` rather than inventing
  parallel names. CEE consumes it in
  `src/orchestrator-v5/system-events/factor-value-edit.ts`.
- The union widening also widens `SystemEventKindLiteral`. **Nothing broke:**
  `pnpm typecheck` is 0 errors with no code change, which establishes that no
  exhaustive `switch` over `event.kind` exists in the build scope — so a new kind
  would have fallen silently through to the generic acknowledgement path rather
  than failing loudly. That is why the dispatch branch is explicit.

**Everything else in 0.26.0–0.28.0 is UNADOPTED, and that is deliberate**, not
skipped: nothing in this PR imports it, and each of those surfaces carries its own
producer/consumer obligations. Recorded here so the next reader knows the delta was
read rather than ignored.

⚠ **SEQUENCING — THIS IS THE READER, AND IT MUST DEPLOY BEFORE THE WRITER.**
Every member of `SystemEventSchema` is `.strict()` and the union discriminates on
`kind`, so a consumer below 0.29.0 that receives `factor_value_edit` fails the
discriminator and rejects THE WHOLE TURN. Pins measured 2026-07-28 at each repo's
`staging` tip: UI **0.22.0**, CEE **0.25.0** (this PR), PLoT 0.22.0 (never sees
turns). Order: publish 0.29.0 → this PR merges and DEPLOYS → only then the UI
emitter ships. Shipping the writer first 400s every inspector edit.

**Checksum verification:** `vendor/talchain-schemas-0.29.0.tgz.sha256` holds the
canonical sha256 hash
(`08d3a6dcec7b74ba6160451f17f782e68889dea5822e169e788988381d41ce33`). The pre-push
hook (`scripts/validate-tarball-sha.sh`) verifies the tarball bytes against this
manifest on every push. ⚠ This hash is for the PRE-PUBLISH build described above,
replacing the prior published `0.25.0` hash `5d7f5679…708c4a`. **It will change
when the orchestrator re-vendors from the registry** — the published tarball is
repacked by npm and is not guaranteed byte-identical to a local `npm pack`.

**Rollback path:** revert the whole PR. Git history restores
`vendor/talchain-schemas-0.25.0.tgz`, its `.sha256`, the `package.json` `file:`
reference and this README. Re-run `pnpm install` after the revert. **NOTE:** the
vendor commit cannot be reverted alone — `src/orchestrator-v5/system-events/`
references the new event type and would not typecheck against 0.25.0.

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
0.25.0 at the typed `constraint_verdict` wave) are removed on each
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
