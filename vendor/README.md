# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.37.0.tgz`

> **✔ SOURCE-PACKED FROM `main` AT THE MERGE SHA, AND RE-DERIVED HERE RATHER
> THAN INHERITED — NOT COMPARED AGAINST THE REGISTRY BYTES.** The tarball was
> vendored onto this branch at 18:13Z on 5 Aug, which is **~6 hours BEFORE**
> olumi-schemas #36 merged (`685d92ec`, 23:55:54Z). That timing makes
> "merged-main pack" a claim the vendoring commit could not have measured, so
> this lane measured it: a fresh blobless clone of olumi-schemas checked out at
> **`685d92ec49b3caf14e1086a2a0c94a5cc50f95ea`** (HEAD asserted equal to the SHA
> before any read — fetching a ref is not checking it out), `npm ci && npm run
> build && npm pack` (node 20.19.5 / npm 10.8.2), produced a tarball
> **byte-identical** to the vendored one.
>
> sha256 `835ab4b8381e1280f239de0d408c2da6790ab9f93a0a14ce6e5a389acd4dd369`
> — 347,174 bytes. So the entry states three separate, separately-measured
> facts: the bytes are the MERGED-MAIN bytes (not a pre-publish branch pack),
> the pack is REPRODUCIBLE, and the version identity is confirmed
> (`package/package.json` reads `@talchain/schemas 0.37.0`; tag `v0.37.0` and
> `main` tip both resolve to `685d92ec`).
>
> **✔ BYTE-IDENTITY WITH DGAI IS PROVEN, NOT ASSERTED.** The estate rule is that
> DGAI and CEE must never hold DIFFERENT bytes under one version string. Both
> repos' vendored tarballs are the **same git blob**,
> `51ad170451a51e5edbdf89b34738fcdf2d65ddbf` (CEE at this commit; DGAI at
> `04d9bece`, the reader car's head) — blob identity is byte identity, which is
> a stronger check than comparing two recorded sha256 strings, since a manifest
> can be copied without the bytes being.
>
> The registry-bytes comparison (ROADMAP 2.464) remains open and was NOT
> performed here — this lane's token has no GitHub Packages read scope
> (`gh api /orgs/Talchain/packages?package_type=npm` → 404), so the honest
> statement is "merged-main source pack, reproducible, byte-identical across
> both consumers, unverified against the registry".

**What CEE adopts here (ROADMAP 2.490 slice 2):** the atomic DSK protocol
provenance triple — `DskProtocolProvenanceSchema` (`protocol_id` constrained to
`/^DSK-P-\d{3}$/`, `protocol_title` `min(1)`, `evidence_strength` ∈
`strong|medium|weak|mixed`, `.strict()`) and its optional carrier
`ExerciseBlock.dsk_provenance`.

Slice 1 (#820) shipped two protocol exercises whose DSK attribution reached
TELEMETRY ONLY, because `ExerciseBlockSchema` was `.strict()` with no dsk field
— the user saw a bare instruction paragraph with nothing marking it as
published decision science. This bump is what lets that attribution reach the
user. `src/orchestrator-v5/compose/dsk-protocol-record.ts` fills it by reading
`data/dsk/v1.json` and returning the triple **only** when the id resolves to a
live protocol record in a bundle that passes its own `verifyDSKHash`; the key is
OMITTED otherwise (never `null`, never partial — the schema field is
`.optional()`, so absence is the only representable non-emission).

⚠ **THE TITLE AND STRENGTH ARE READ FROM THE BUNDLE, NEVER TYPED IN THIS REPO,
AND THAT ASYMMETRY IS THE WHOLE POINT.** Only the protocol *id* comes from
CEE's hand-written `LENS_DSK_PROVENANCE` map (a lens id is not derivable from
the bundle; `dsk-provenance-attestation.test.ts` attests every id in it against
the bundle bytes per trap 12). Everything DISPLAYED is the record's own. This is
CEE #830's defect refused at a new site: there, an attestation checked that a
DSK claim id EXISTED but never that the prose shown under it resolved to that
id, so a badge printed the model's own words under the bundle's authority.

⚠ **THIS BUMP UNAVOIDABLY INHERITS 0.36.0's EDITABLE-FIELD-TABLE REVISION 2** —
no consumer had pinned 0.36.0, so CEE is the first to take it, and the
inheritance was MEASURED rather than waved through (see
`src/orchestrator-v5/graph-management/__tests__/field-parity-derivation.test.ts`,
which moves 42→43 rows, `provenance_owned` 7→8, digest
`f6354a44-ea998eaa` → `67cea469-77605f3b`). The semantic delta is EXACTLY ONE
added row — `edge|validation|validation|provenance_owned` — with zero removals;
every other changed row differs only in `reason` / `ui_write_sites` prose. That
row is behaviourally INERT at this consumer: `validation` is already in
`CEE_ANALYSIS_OWNED_ROOTS` (`field-safety.ts:173`), unioned into
`PIPELINE_OWNED_ROOTS`, so the deny set is unchanged. Verified at the bytes, not
taken from the row's own prose claiming it.

**The closing bolt ships in the same PR:**
`src/orchestrator-v5/compose/__tests__/dsk-protocol-provenance-wire.test.ts`
derives every expectation from `data/dsk/v1.json` AT TEST TIME (a literal would
only prove CEE agrees with the test author — trap 13c), binds each assertion to
its protocol by explicit id rather than by a value predicate (trap 19), and
covers the fail-closed arms: bundle hash mismatch and missing bundle both yield
NO provenance rather than a partial or fabricated triple.

**Rollback path:** revert the whole PR. Git history restores
`vendor/talchain-schemas-0.35.0.tgz`, its `.sha256`, the `package.json` `file:`
reference and this README. Re-run `pnpm install` after the revert. This one
cannot be reverted alone — `dsk-protocol-record.ts` and `phase3-blocks.ts`
depend on the 0.37.0 field, and `field-parity-derivation.test.ts` pins the
0.36.0 table revision, so the source changes must revert with it. Reverting does
NOT unpublish 0.37.0. **Merge order is schemas → UI → CEE** (reader before
producer): the field is additive and optional, so an older-pinned consumer
simply does not see it, but the badge must be readable before it is emitted.

### `talchain-schemas-0.35.0.tgz` (historical — no longer vendored)

> **✔ SOURCE-PACKED FROM `main` AT THE MERGE SHA — NOT COMPARED AGAINST THE
> REGISTRY BYTES** (same provenance class as the 0.33.0 entry below, and better
> than the 0.34.0 entry it replaces, which was a PRE-PUBLISH BRANCH pack).
> Packed with `npm pack` from a fresh blobless clone of olumi-schemas at **main
> tip `6c88076ba1fcdc155af23c953a1ae57ebd699fec`** — the merge commit of PR #34,
> "Option A schemas leg: 0.35.0 — classed field-parity table + tool op-batch
> (2.474)" — after `npm ci && npm run build` (node 20.19.5 / npm 10.8.2).
>
> sha256 `bbca89c0fe4b33b10822cfbac826a224424343c86729016df2882f16b9f464b7`
> — 337,967 bytes. **Proven byte-reproducible**: a second independent `npm pack`
> of the same build produced the identical sha256.
>
> The registry-bytes comparison (ROADMAP 2.464) remains open and was NOT
> performed here — this lane's token has no GitHub Packages read scope
> (`gh api /orgs/Talchain/packages` → 404), so the honest statement is
> "merged-main source pack, reproducible, unverified against the registry".
>
> ⚠ **DGAI IS STILL ON AN OLDER PIN.** The estate rule is that DGAI and CEE must
> never hold DIFFERENT bytes under one version string — that rule is not
> violated here (they hold different VERSIONS, which is the normal train state),
> but when the UI leg adopts 0.35.0 it must vendor **these exact bytes**, not a
> fresh pack of its own.

**What CEE adopts here (ROADMAP 2.474, design-review amendment A6):** the
**classed field-parity table** — `EDITABLE_FIELD_TABLE` (42 rows: 22 `grant` ·
7 `invariant_coupled` · 7 `provenance_owned` · 5 `ai_only` · 1
`deferred_derivation`) and its derivation accessors `aiEditableFieldRoots`,
`aiEditableObservedSubkeys`, `provenanceOwnedSegments`,
`requireEditableFieldTableRevision`.

`src/orchestrator-v5/graph-management/field-safety.ts` now DERIVES
`ALLOWED_NODE_FIELD_ROOTS`, `ALLOWED_EDGE_FIELD_ROOTS` and
`ALLOWED_OBSERVED_SUBKEYS` from those accessors instead of carrying its own
hand-reconciled lists (trap 12 — the lists had drifted from the inspector's
setters), and takes the UNION of its own analysis-owned stamps with
`provenanceOwnedSegments()` (ruling J2). It calls
`requireEditableFieldTableRevision(1)` at module load, so a repo re-vendored
BACKWARDS to a shorter table throws at import instead of silently enforcing a
narrower allowlist.

**The closing bolt ships in the same PR:**
`src/orchestrator-v5/graph-management/__tests__/field-parity-derivation.test.ts`
asserts the derived sets are set-equal to the accessors AND that the referee's
actual screen honours the table row by row; the hand-written corpus in
`field-safety-corpus.test.ts` is the half derivation cannot provide (12d).

**Also in this commit, and NOT caused by it — ⚠ `staging` COULD NOT PASS ITS OWN
PRE-PUSH GATE.** `talchain-schemas-0.33.0.tgz` was still present alongside
0.34.0, so `scripts/validate-docs-consistency.sh` failed its pin/vendor
tripwire. That script is **not** caller-less: `scripts/validate-prepush.sh:385`
(`check_docs_consistency`) runs it and increments `FAILURES` on a non-zero exit.
Measured with a control — pristine `staging` via `git archive`: check 11 FAIL,
`FAILURES=1`; this head: check 11 OK, `FAILURES=0`. So every push from a clean
`staging` had been reporting a failing pre-push check that nobody acted on —
trap 7, a broken alarm, which is a worse finding than an unrun script. The stale
tarball is removed here and the check is green again.

### `talchain-schemas-0.34.0.tgz` (historical — no longer vendored)

> **⚠ BRANCH-PACKED, PRE-PUBLISH — NOT (YET) THE REGISTRY ARTIFACT** (same
> trade as the 0.32.0 section below, same three-repo-train reason: no registry
> 0.34.0 exists until olumi-schemas PR #33 merges, and merge order is
> schemas → CEE → UI). Packed with `npm pack` from olumi-schemas branch
> `p4/transport-events-0.34` at `b883869` (the 0.34.0 version-bump PR; full
> gate green, 43 files / 1446 tests).
>
> sha256 `c3db4b4e5e4458cbd11c9b924c7e529ccd0f405b2967844e30550aecf9acc559`
> — must be BYTE-IDENTICAL to DGAI's vendored copy when the UI leg lands
> (both legs copy the same pack output).
>
> **FOR THE MERGING ORCHESTRATOR:** the schemas PR auto-publishes 0.34.0 on
> merge; optionally re-vendor from the registry afterwards and update BOTH
> consumers' tarballs + sidecars together. What must never happen is DGAI and
> CEE holding DIFFERENT bytes under one version string.

**What CEE adopts here (P4 transport):** SystemEventSchema members
`edge_adjudication` + `prior_range_edit`; HandlerFactSchema members
`feedback` / `edge_adjudication` / `prior_range_edit` (the receipts this
repo's system-event dispatch now persists instead of committing empty acks).
Additive; every pre-0.34.0 payload parses byte-identically.


### `talchain-schemas-0.33.0.tgz` (historical — no longer vendored)

> **⚠ SOURCE-PACKED FROM MAIN AT THE MERGE SHA — NOT (YET) COMPARED AGAINST
> THE REGISTRY BYTES.** Packed with `npm pack` from a fresh blobless clone of
> olumi-schemas at **main tip `4526cf58`** (the 0.33.0 merge commit, "Lane 3
> Car 2: transported-critique seam typing (2.293)"; full repo gate green there,
> 41 files / 1410 tests), after `npm ci && npm run build` (node 20.19.5 /
> npm 10.8.2). The registry-bytes comparison (ROADMAP 2.464) remains open —
> source-pack provenance is documented here instead: unlike the 0.32.0 entry
> above this is not a pre-publish branch pack, it is the exact merged main
> bytes, and the pack was proven byte-reproducible by packing twice and
> comparing hashes.
>
> sha256 `d36f75aad9197a3d8721688891ad05da51ff270645d617e741922603867f9cb6`
> — 296,658 bytes. A second independent `npm pack` of the same build produced
> the identical sha256.

**What CEE adopts here (2.473):** `TransportedCritiqueSchema` /
`TransportedCritique` — the CEE→UI transported-critique row, whose field set
mirrors THIS repo's projection allow-list (`projectCritiquesForTransport`,
`src/orchestrator-v5/compose/sanitise-enrichment.ts`): `user_message`
REQUIRED, `message` deliberately NOT declared, severity optional, object
passthrough. `AnalysisEnrichmentSchema.critiques` becomes a union (inbound
`EnrichmentCritiqueSchema` first, then transported); the inbound schema is
byte-for-byte unchanged. **Recorded design cost (Car 2 review): inbound
validators now accept transported-shape rows — an accepted
telemetry-discrimination loss.**

**The closing bolt ships in the same PR:**
`src/orchestrator-v5/compose/__tests__/critiques-transport-schema-bolt.test.ts`
asserts `projectCritiquesForTransport`'s ACTUAL output parses under the
vendored `TransportedCritiqueSchema` AND that every emitted key is declared in
the schema's shape (the schema is passthrough, so parse alone cannot see an
allow-list field the schema never heard of). This is the cross-repo assertion
schemas-CI cannot make — its own `PROJECTED_ROW` fixture is a hand-mirror of
this repo's projection and would drift silently without it.

### `talchain-schemas-0.32.0.tgz` (historical — no longer vendored)

> Branch-packed pre-publish from `lane2/ui-directive-panel-section-0.32.0` at
> `23f8e01b` (no registry 0.32.0 existed when that leg was built; three-repo
> train schemas → DGAI → CEE). sha256
> `472cd35d355c2292589a98f609e6ad478c9576dab179ea1ce27b06c87a5dd93a`,
> byte-identical to DGAI's vendored copy by construction. Adopted the
> `ui_directive` verbs `open_panel` / `open_section` + strict `ui_target`
> (emit ladder: `src/orchestrator-v5/compose/ui-directive.ts`). The
> registry-bytes comparison flagged in that entry was never performed —
> carried forward as ROADMAP 2.464.

### `talchain-schemas-0.31.0.tgz` (historical — no longer vendored)

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
