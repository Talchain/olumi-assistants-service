# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.25.0.tgz`

> **✔ PUBLISHED TARBALL — the released `@talchain/schemas@0.25.0`, pulled from
> GitHub Packages via `npm pack @talchain/schemas@0.25.0`.** 0.23.0 → 0.25.0 is
> **ADDITIVE-ONLY**: 201 → 205 exported symbols, **zero removed**, measured by
> diffing every `export (const|type|interface|enum|function)` across both
> packages' `dist/**/*.d.ts`. A fact or turn WITHOUT the new field still parses.

The 0.25.0 surface over 0.23.0 — two independent waves, only one of which CEE
adopts here:

- **`constraint_verdict?: ConstraintVerdict` on `RunAnalysisResultSchema`
  (0.25.0)** — the reason for this re-vendor. `{ may_name_leading_option:
  boolean, constraint_verdict_state: ConstraintVerdictState }`, `.strict()`,
  **optional and staying optional** (every fact persisted before this release is
  unstamped, and "unknown" is a different claim from "verified feasible"). It
  mirrors CEE's `PersistedClaimSafety` interface verbatim — member names, types
  and order — and the package's own docstring says so. CEE holds that mirror
  to account with a bidirectional `extends` assertion in
  `orchestrator/context/constraint-feasibility.ts`, so a future divergence fails
  `pnpm typecheck` rather than silently skewing a wire field (parent CLAUDE.md
  hazard 1).
  Also exported: `ConstraintVerdictSchema`, `ConstraintVerdictStateSchema`, and
  the `ConstraintVerdict` / `ConstraintVerdictState` types.
- **`HealthManifestSchema` + `contracts/` (0.24.0, arch step 2 / S0)** — the four
  fields every Olumi service must expose on its health endpoint, plus
  `SCHEMA_SHA` / `CONTRACT_MANIFEST_SHA` / `SCHEMA_PACKAGE_VERSION` generated
  constants, and the shipped `contracts/adoption-manifest.json`. **CEE consumes
  NONE of it in this PR** — nothing imports `HealthManifestSchema`, and
  `/healthz` is unchanged. Recorded here so the next reader knows the delta was
  read, not skipped: adopting the health manifest is its own decision with its
  own producer/consumer obligations.

**Purpose — the 0.25 re-vendor RETIRES an interim shape, and that is the whole
point.** From CEE #710 until now the T1 constraint verdict rode a CEE-owned key
INSIDE the PLoT enrichment pass-through (`enrichment.__cee_claim_safety`),
because `RunAnalysisResultSchema` is `.strict()` and there was nowhere else to
put it — a documented, deliberate breach of the handler-ownership invariant
("enrichment is byte-for-byte PLoT", `scripts/validate-handler-ownership.sh`
§6), tolerated only while a schemas release was blocked behind V5-CI-01. CEE's
own source named this field as the target: *"Delete this key and its two helpers
when V5-CI-01 unblocks the release."* This release is that unblock, so:

- **Write:** the single stamp site in `run_analysis` now writes
  `result.constraint_verdict` inside the validated fact. The second
  `safeParse` the bolt-on needed is deleted with it, and `enrichment` becomes a
  TOTAL pass-through (`run-analysis.test.ts` tightened from "verbatim PLUS
  exactly one CEE key" to "verbatim, zero added keys").
- **Read:** `readMayNameLeadingOptionFromResult` reads the typed field FIRST and
  falls back to the interim stamp for rows already persisted on staging. **No
  data migration** (A1 ruling); fail-closed still applies to a fact carrying
  neither. Exactly one of the two keys is ever present on a given fact, so this
  is a migration ramp, not a mirror.
- **Drift:** `__tests__/constraint-verdict-typed-field.test.ts` asserts a
  newly-produced fact carries the typed field on BOTH verdict answers and that
  the interim key is gone — so the interim cannot become permanent by neglect.

⚠ **DEPLOYMENT NOTE — a brief rollover window, verified at the bytes.**
`session/supabase-store.ts:612` (`readFactsWithTurnFor`) **THROWS
`SessionReadError`** when a persisted payload fails `HandlerFactSchema`. During a
rolling deploy of this change, an instance still pinned to 0.23.0 that reads a
fact written by a 0.25.0 instance sees an undeclared `constraint_verdict` key on
a `.strict()` schema and throws. The window is the deploy rollover only, it is
self-healing (it ends when the last old instance drains), and it affects only a
scenario whose next turn lands on an old instance. There is no shape that avoids
it — writing BOTH keys does not help, because the failure is the EXTRA key, not
a missing one. Flagged for the deploy, not worked around.

> **Registry note.** CEE consumes the vendored tarball via
> `file:./vendor/...`, never a registry version. Registry/publish state is
> orthogonal to this pin — but the CONTENT here must match the
> merged+published `0.25.0`.

**Checksum verification:** `vendor/talchain-schemas-0.25.0.tgz.sha256`
holds the canonical sha256 hash
(`5d7f567947aac1bcc6c7afe39f02ee401b9f7bbf20c423061c6bd27519708c4a`).
The pre-push hook (`scripts/validate-tarball-sha.sh`) verifies the
tarball bytes against this manifest on every push. ✔ This hash is for the
PUBLISHED `@talchain/schemas@0.25.0` tarball (`npm pack` from GitHub Packages),
replacing the prior `0.23.0` hash `be49feb8…4eca26`.

**Rollback path:** revert the vendor-refresh commit. Git history
restores the prior `vendor/talchain-schemas-0.23.0.tgz`, its
`.sha256` manifest, the prior `package.json` `file:` reference, and
this README's prior state — the entire pin returns to v0.23.0 in one
commit. Re-run `pnpm install` after the revert. **NOTE:** a revert must also
revert the CEE write path, or the handler emits a `constraint_verdict` key that
0.23.0's `.strict()` result schema rejects on write AND on every later read.
Revert the whole PR, never the vendor commit alone.

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
the `graph_state` ingress / wave-2 graph write-identity boundary) are
removed on each bump — only the currently-pinned version lives in
`vendor/`.

**⚠ OWED, CROSS-REPO, NOT DONE HERE:** the adoption-manifest row for
`constraint_verdict` ships INSIDE this tarball
(`contracts/adoption-manifest.json`) and its source of truth is
`Talchain/olumi-schemas`, a different repo from this lane. It currently reads
`"state": "declared"` with `producer_test: null` / `consumer_test: null`, and
its own notes name this adoption as "ADOPTION STEP (owned by the CEE lane)".
With this PR both halves are verified by named tests, so the truthful state per
the manifest's own definitions is **`enforced`** ("both sides verified by named
tests"). It is NOT edited here: rewriting a file inside a published, sha256-
pinned vendor tarball would forge the published bytes and break the checksum
discipline the pre-push hook enforces. Raise it as a schemas-repo PR with:
`state: "enforced"`,
`producer_test: "cee:src/orchestrator-v5/__tests__/constraint-verdict-typed-field.test.ts::§1 PRODUCER + DRIFT"`,
`consumer_test: "cee:src/orchestrator-v5/__tests__/constraint-disclosure-route-level.test.ts::withhold paths: the STRUCTURED leader residue must not reach the wire"`.

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
