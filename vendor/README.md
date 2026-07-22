# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.22.0.tgz`

> **✔ PUBLISHED TARBALL — the released `@talchain/schemas@0.22.0`, pulled from
> GitHub Packages via `npm pack` (tag `v0.22.0` at `e04b900c`).** This is the
> named CEE 0.22 absorption row (ROADMAP 1.181). 0.22.0 carries the full 0.22
> batch PLUS the FIRST-SHIP of the two changes 0.21.0 deliberately held back
> (schemas PR #13 and #14 — see the 0.21.0 README note in git history).

The 0.22.0 surface over 0.21.0:

- **0.22 batch.** `Intent` enum + `chip.id` / `chip.intent` on the message-turn
  chip; batched `direct_graph_edit` fields (`changed_node_ids`,
  `changed_edge_ids`, `operations`, `fields_changed`, `summary`); the S1
  `graph_hash` / `computed_against_hash` / `GRAPH_DIVERGED` set; the typed
  `feedback` system event; the Group-A surfaces; and the #16 enrichment
  additions.
- **#13 (first ship).** Compute-seam JSON-Schema types. Additive new exports;
  CEE constructs no objects against them here.
- **#14 (first ship).** `GoalConstraintSchema` → `LegacyGoalConstraintStubSchema`
  rename **in the vendored package**. This has ZERO effect on CEE: every
  `GoalConstraintSchema` reference in CEE resolves to CEE's OWN local
  `src/schemas/assist.ts`, and no CEE file imports that name from
  `@talchain/schemas` (verified by `git grep` at re-vendor time — the F2-B
  re-pack finding still holds). No import changes were required.

> **Registry note.** CEE consumes the vendored tarball via
> `file:./vendor/...`, never a registry version. Registry/publish state is
> orthogonal to this pin — but the CONTENT here must match the
> merged+published `0.22.0`.

**Purpose — INGRESS ACCEPTANCE ONLY. This re-vendor adds NO new EMISSIONS
and NO routing/handlers.** CEE's B1 validator (`src/validators/b1.ts`, derived
from the vendored `OrchestratorTurnPayloadSchema`) is `.strict()` and
fail-closed: an unknown key or an out-of-vocabulary literal 422s the WHOLE turn.
So each new INGRESS field — `chip.id`, `chip.intent`, the `feedback` system
event, and the batched `direct_graph_edit` fields — must be ACCEPTED here FIRST,
before any producer (the S2+S3 CEE lanes / the UI) sends it. That accept-half is
pinned executably in `tests/contract/schemas-0.22-ingress-surface.test.ts`
(one acceptance per new field + a discrimination control each, plus a
fall-through proof that an intent-carrying turn still completes ingress
normally). Routing off `intent`, the feedback handler, and the batched-edit
handler land LATER with S2+S3 — un-routed accepted fields fall through benignly.

The prior EGRESS obligations (`signal_code` / `signal` on the guidance blocks,
`framing_quality`, the `what_changed` / `analysis_readiness` action-type
literals) are carried forward unchanged; their landing notes live in the 0.20.0
and 0.21.0 README revisions in git history. 0.21.0 → 0.22.0 is additive on the
ingress surface: new optional fields and one new system-event member; every
pre-0.22.0 payload still parses.

**Checksum verification:** `vendor/talchain-schemas-0.22.0.tgz.sha256`
holds the canonical sha256 hash
(`adf17921456eb024fde429a79e7375d7af27aa14db76b4d720498dc99e5f622d`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. ✔ This hash is for the
PUBLISHED `@talchain/schemas@0.22.0` tarball (`npm pack` from GitHub Packages,
tag `v0.22.0` at `e04b900c`), replacing the prior `0.21.0` hash
`73621323…52da5663`.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.21.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — the entire pin returns to v0.21.0 in one
commit. Re-run `pnpm install` after the revert.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave, 0.18.0 at the
draft-goal-constraints wave, 0.19.0 at the wave-2 producer fields,
0.20.0 at the readiness/signal/framing_quality wave, 0.21.0 at the
`what_changed` action-type wave) are
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
