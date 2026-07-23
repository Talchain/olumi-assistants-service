# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.23.0.tgz`

> **✔ PUBLISHED TARBALL — the released `@talchain/schemas@0.23.0`, pulled from
> GitHub Packages via `npm pack @talchain/schemas@0.23.0`.** This is the named
> CEE 0.23 absorption row (ROADMAP 1.188, wave-2 graph write/identity boundary
> 1.192). 0.23.0 is ADDITIVE-ONLY over 0.22.0 (D-34: 538→538 symbols, zero
> removed; a turn WITHOUT the new field still parses).

The 0.23.0 surface over 0.22.0:

- **`graph_state?: GraphV3` on `MessageTurnPayloadSchema`** — the inbound
  first-touch canvas graph (full GraphV3, not a hash ref — no server model to
  fetch on first touch). Additive + `.strict()`-safe: CEE's B1 pre-flight
  strips `graph_state` (with `analysis_state` / `user_id` / `selected_elements`)
  from the body BEFORE `validateIngress` via
  `V5_EXTENSION_FIELDS = Object.keys(V5RequestExtensionsSchema.shape)`
  (`route-v2-preflight.ts`), then re-parses it CEE-side
  (`request-extensions.ts` `GraphStateIngressSchema`) — the exact
  strip-then-reparse pattern already proven for `selected_elements` since 0.22.
  So the re-vendor cannot 422 a `graph_state`-bearing turn on a strict-schema
  mismatch. The wave-2 adopt leg (turn-executor `graphForCommit`) then persists
  it at first commit when there is no server model.
- **F6 accommodation comment** on the turn payload (representative-singular wire
  convention). Documentation only.
- The 0.22 handshake set — `OlumiResponseSchema.graph_hash`,
  `AnalysisResultBlockSchema.computed_against_hash`, the `GRAPH_DIVERGED` error
  code — is carried forward unchanged; **wave-2 (leg κ) lights it CEE-side**
  (map `freshness.current_graph_hash` → `graph_hash`; map the fact's
  `graph_hash_at_run` → `computed_against_hash`). ⚠ `model_graph_hash` NEVER
  existed (D-34) — it is referenced nowhere.

The `GoalConstraintSchema` → `LegacyGoalConstraintStubSchema` rename (0.22 #14)
still has ZERO effect on CEE: every `GoalConstraintSchema` reference in CEE
resolves to CEE's OWN local `src/schemas/assist.ts`, and no CEE file imports
that name from `@talchain/schemas` (unchanged by 0.23).

> **Registry note.** CEE consumes the vendored tarball via
> `file:./vendor/...`, never a registry version. Registry/publish state is
> orthogonal to this pin — but the CONTENT here must match the
> merged+published `0.23.0`.

**Purpose — the 0.23 re-vendor ENABLES the wave-2 (1.192) graph write/identity
boundary.** Unlike the pure ingress-acceptance re-vendors before it, the 0.23
re-vendor lands in one PR with the CEE code that consumes the new surface:

- **Ingress:** `graph_state?: GraphV3` on `MessageTurnPayloadSchema`. CEE's B1
  pre-flight STRIPS it (with `analysis_state`/`user_id`/`selected_elements`)
  before `validateIngress` and re-parses it CEE-side via
  `GraphStateIngressSchema` — so B1 `.strict()` cannot 422 a `graph_state`
  turn on the schema bump (proven strip-then-reparse pattern, unchanged since
  `selected_elements`). A turn WITHOUT `graph_state` still parses (fail-safe).
- **Emission (wave-2 leg κ, in `compose/output-safety.ts` + `compose.ts` — NOT
  the vendor swap):** the 0.22-shipped handshake fields
  `OlumiResponseSchema.graph_hash` and `AnalysisResultBlockSchema.computed_against_hash`
  are now MAPPED onto the wire from values CEE already computes
  (`freshness.current_graph_hash` / the run-analysis fact's `graph_hash_at_run`).
- **Adopt (wave-2 leg S2, in `turn-executor.ts` `graphForCommit`):** a
  first-touch `graph_state` with no server model is PERSISTED at commit,
  routing through the W2 chokepoint (repair + options[]-reconcile + CAS-stamp).

0.22.0 → 0.23.0 is additive on the ingress surface: one new optional field on
the turn payload; every pre-0.23.0 payload still parses. The prior EGRESS/ingress
obligations (`signal_code`/`signal`, `framing_quality`, the Intent/`chip.id`/
batched-`direct_graph_edit` accept-half in
`tests/contract/schemas-0.22-ingress-surface.test.ts`) are carried forward
unchanged.

**Checksum verification:** `vendor/talchain-schemas-0.23.0.tgz.sha256`
holds the canonical sha256 hash
(`be49feb8037a963c9a3dcd2ec206b29672ae91e07d055f6aa2bdd99c034eca26`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. ✔ This hash is for the
PUBLISHED `@talchain/schemas@0.23.0` tarball (`npm pack` from GitHub Packages,
tag `v0.23.0`), replacing the prior `0.22.0` hash
`adf17921…9e5f622d`.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.22.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — the entire pin returns to v0.22.0 in one
commit. Re-run `pnpm install` after the revert.

Earlier vendored versions (0.3.0 at A0, 0.4.0 at A1, 0.5.0/0.5.1 at
B+C, 0.6.0 at D, 0.7.0 at E, 0.8.1 at F, 0.9.1 at G, 0.10.0 at H,
0.11.0 at coaching-amendment, 0.12.0 at DL-7 edit-graph fact,
0.13.0 at V5 Phase 3A block types, 0.14.0 at enrichment-v1 CEE-first
adoption, 0.15.0 at the reasoning/held_proposal/ui_directive wave,
0.16.0 at the decision-record additive wave, 0.18.0 at the
draft-goal-constraints wave, 0.19.0 at the wave-2 producer fields,
0.20.0 at the readiness/signal/framing_quality wave, 0.21.0 at the
`what_changed` action-type wave, 0.22.0 at the Intent/chip.id +
graph-identity-handshake + batched direct_graph_edit wave) are
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
