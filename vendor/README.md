# vendor/

Checkout-stable local tarball references for pre-publish consumption of
private packages. Each tarball is checked in and pinned via
`file:./vendor/<name>.tgz` in `package.json`, so the path resolves
identically from a normal clone, a CI checkout, and any worktree.

## Current contents

### `talchain-schemas-0.46.0.tgz`

> **✔ SOURCE-PACKED FROM THE MERGED, TAGGED RELEASE, AND VERIFIED AGAINST THE
> PUBLISHED BYTES BY CONTENT DIFF.**
>
> Packed from a fresh blobless clone of `olumi-schemas` with `HEAD` asserted
> equal to `git rev-list -n1 v0.46.0` =
> **`637ae4f8e3e33136c728a3aa3d1363e6019bf40b`** *before any read* — fetching a
> ref is not checking it out — and `package.json.version == 0.46.0` asserted,
> then `npm ci && npm run build && npm pack`
> (node 20.19.5 / npm 10.8.2, the toolchain every entry above records).
>
> sha256 `99ce0c620b9788785276705c0e476009f0058288dff4962ac53790432279e8d9`
> — 443,422 bytes. A second independent `npm pack` produced **byte-identical**
> output.
>
> **✔ PUBLISHED-CONTENT IDENTITY, PROVEN BY CONTENT AND NOT BY A COMPRESSED
> HASH.** npm REPACKS on publish, so the registry and source-packed *envelopes*
> differ by construction and comparing their sha256 would be a check that can
> only ever fail. The registry artifact was downloaded from GitHub Packages
> (`dist.tarball` for 0.46.0, sha1 `9dea6332…`, integrity
> `sha512-OZg64Tp+S+6np…atjL2NSWoh2Vw==` — both matching the publish run's own
> `npm notice` lines), both tarballs were unpacked, and **`diff -r` over all
> 226 files reported ZERO content differences**. The comparator carries a
> positive control: injecting eight bytes into one file of the registry copy
> made it fail, so the clean result is not a comparator that cannot see.
>
> **✔ THE PUBLISH ITSELF IS WITNESSED, NOT ASSUMED.** Merging PR #45 to
> `olumi-schemas` `main` IS the release switch. Run `31956789130` on
> `637ae4f8` completed with every step `success`, including
> `Publish to GitHub Packages` (`skipped` is what a no-op version check
> produces, and it did not skip) and the log line
> `npm notice Publishing to https://npm.pkg.github.com …`. Tag `v0.46.0`
> resolves to the same sha, and the registry packument reports
> `dist-tags.latest = 0.46.0`. ⚠ NOTE FOR THE NEXT LANE: `Trigger propagation`
> **succeeded** on this run. `olumi-schemas/CLAUDE.md` records it as a
> never-once-successful standing red; that sentence is now stale at this tip.
> Nothing propagated into CEE (no propagation PR exists on this repo), but do
> not inherit either the old claim or this one — read the run.

**What CEE adopts here: one additive-optional wire field, and CEE is its
PRODUCER.** Unlike a reader-only bump, this one ships the emitter in the same
change.

`0.46.0` adds `AnalysisStateV1Schema` (`src/boundary/analysis-state.ts`) and an
optional top-level `OlumiResponse.analysis_state`: ONE composed verdict per
turn for "what is the state of the analysis, and what may a surface claim about
it" — a seven-branch `run_state` discriminated union (including the new
`refused`), `readiness`, `leader_claim`, `robustness`, five usability booleans
and a producer self-report of `contradictions`. The paired CEE change composes
it at the single V5 finaliser seam from values the turn has already computed.

> **⚠ THIS IS A TWO-LINE JUMP: 0.44.0 → 0.46.0, SO IT ALSO ADOPTS 0.45.0.**
> `@talchain/schemas` is 0.x, where **MINOR is the breaking axis**, so this
> crosses two compatibility lines. CEE never vendored 0.45.0, which adds the
> optional top-level `OlumiResponse.model_building_notices` and its
> `ModelBuildingNoticeKind` / `ModelBuildingNotices` reader types. That is
> additive-optional and CEE adopts it as **types only** — this PR emits no
> notice carrier and reads none. Neither 0.45.0 nor 0.46.0 makes any existing
> field required or narrows any vocabulary; `response_version` stays `2`.

> **⚠ READER-FIRST ORDER, AND WHY IT IS SATISFIED HERE.** `OlumiResponseSchema`
> is strict, so a service pinned below 0.46.0 that received `analysis_state`
> would refuse the whole payload — not drop the field. CEE is the only producer
> and it validates egress against the SAME 0.46.0 vendored here, so producer and
> validator move as one commit. **The UI is NOT a reader yet (pinned 0.43.0 at
> the time of writing) and does not need to be**: it ignores unknown top-level
> keys on ingest. The UI pin bump is its own PR and is the prerequisite for the
> UI CONSUMING the field (migration step 5), not for CEE emitting it.

> **✔ AND IT CLOSES 0.44.0's OPEN ITEM IN PASSING, MEASURED HERE RATHER THAN
> EDITED INTO THAT ENTRY.** The 0.44.0 block below still carries its
> pre-merge caveat — that the bytes were packed from an unmerged branch head and
> that "these are the published bytes" was asserted, not proven. **It is proven
> now.** 0.44.0's registry artifact (sha1
> `f47469ea5e7da2b0f28472788308f653e758c71d`) was downloaded and unpacked
> alongside the tarball this repo carried at `bacf35d5`, whose sha256 is
> `2177849b178aaf5a4fbdf273377582ac03dfb18d891cf3d8443c62c81315ea72` —
> identical to the value recorded in that block — and `diff -r` over every path
> reported **zero content differences**. The estate rule "no two repos may hold
> DIFFERENT bytes under one version string" held for 0.44.0.
>
> ⚠ THE 0.44.0 BLOCK IS DELIBERATELY LEFT UNEDITED. Open PR **#987** rewrites
> that exact paragraph. Recording the settlement here instead of there keeps
> these two PRs free of a textual conflict, and keeps both statements: #987's
> account of the tagged-tree identity, and this measurement of the published
> bytes. Whichever merges second should fold them together rather than take one
> side wholesale.

**Rollback path:** revert this whole PR and run `pnpm install`. Git restores the
exact 0.44.0 tarball, checksum, pin and lockfile, and the wire returns to the
shape it had before — no consumer reads `analysis_state`, so nothing downstream
regresses. Reverting never unpublishes 0.46.0.

### `talchain-schemas-0.44.0.tgz` (historical — no longer vendored as of 0.46.0)

> **⚠⚠ PACKED FROM AN UNMERGED BRANCH — READ THIS BEFORE MERGING THIS PR.**
> Every other entry in this file records a tarball packed from a **merged,
> tagged release**. This one cannot, and saying otherwise would be the false
> label this repo's doctrine exists to prevent.
>
> `@talchain/schemas` **publishes on merge to `main`** — that is its release
> switch — and the schemas half of this train (olumi-schemas **#43**) is
> deliberately still OPEN so both halves can be reviewed as one change. The
> bytes here were therefore packed from that PR's branch head,
> **`bf53ad8fdea3b3c74e94ee7b2b436ba2ecab0b0b`**, with
> `package.json.version == 0.44.0` asserted before packing, via
> `npm ci && npm run build && npm pack` (node 20.19.5 / npm 10.8.2 — the same
> toolchain the 0.40.0 entry records).
>
> sha256 `2177849b178aaf5a4fbdf273377582ac03dfb18d891cf3d8443c62c81315ea72`
> — 419,086 bytes. A second independent `npm pack` produced **byte-identical**
> output.
>
> **REQUIRED BEFORE THIS PR MERGES — do not skip, and do not treat a green CI
> as covering it.** CI validates that these bytes match the adjacent `.sha256`;
> it cannot know whether they match what was PUBLISHED, because nothing was
> published when they were made.
>
> 1. Merge olumi-schemas #43 ⇒ 0.44.0 publishes and is tagged.
> 2. Re-pack from a fresh blobless clone with `HEAD` asserted equal to
>    `git rev-list -n1 v0.44.0` *before any read* — fetching a ref is not
>    checking it out.
> 3. Assert the sha256 is **identical** to the one above. If it differs, the
>    published bytes are not these bytes: replace the tarball and the `.sha256`
>    in this PR rather than reasoning about why the difference is harmless.
> 4. Then replace this whole block with the normal
>    "SOURCE-PACKED FROM THE MERGED, TAGGED RELEASE" wording.
>
> The estate rule this protects is "no two repos may hold DIFFERENT bytes under
> one version string". Until step 3 is done, that rule is *asserted here and not
> yet proven*.

**What CEE adopts here: one transport key, its claim-safety ruling, and a
two-release version jump.**

`0.44.0` adds `conditional_winners` to `CEE_UI_ENRICHMENT_KEEP_LIST`, plus the
typed `EnrichmentConditionalWinnerSchema` / `EnrichmentConditionalBucketSchema`
and an optional `AnalysisEnrichment.conditional_winners`. The paired CEE change
adds the key to `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` and rules it **`projected`**
in the withheld-claim registry: each bucket's `winner_id` / `winner_label` /
`runner_up_id` / `runner_up_label` are stripped on a turn whose verdict withholds
the leading-option claim, and the factor-level science is kept.

> **⚠ THIS IS A TWO-LINE JUMP: 0.42.0 → 0.44.0, SO IT ALSO ADOPTS 0.43.0.**
> CEE never vendored 0.43.0, and `@talchain/schemas` is 0.x, where **MINOR is
> the breaking axis** — so this bump crosses two compatibility lines, not one.
> 0.43.0 is additive for old payloads: legacy-optional
> `DraftGraphBlockSchema.options` / `goal_node_id`, the strict
> `CanonicalCommittedGraphBlockSchema` / `CanonicalCommittedGraphReceiptSchema`
> producer forms, and `CANONICAL_GRAPH_HASH_PROJECTION_VERSION` +
> `CANONICAL_GRAPH_HASH_NESTED_PROJECTION`. It adds names and relaxes two
> previously-absent optional keys; it makes nothing required and narrows no
> vocabulary. CEE adopts it as a **reader only** here — this PR enables no
> canonical receipt emission and adds no digest implementation. 0.43.0's own
> rollout note calls for exactly this order: publish, re-vendor CEE and the UI,
> and only then enable emission.

**Rollback path:** revert this whole PR and run `pnpm install`. Git restores the
exact 0.42.0 tarball, checksum, pin and lockfile. Reverting is independent: no
producer depends on the new key, and dropping `conditional_winners` from the
keep-list returns the wire to the shape it has had for this key's whole life.
Reverting never unpublishes 0.44.0.

### `talchain-schemas-0.42.0.tgz` (historical — no longer vendored)

The exact prior CEE bytes were sha256
`1d5f2c7a7ee71b71d60f80b2e37db3e94f2f379a5741fd84c1099a4e13016ba0`
(403,431 bytes). Tag `v0.42.0` resolves to
`bbfb7eb1e3f450598ff061a8651ce8c7e053468d`. They remain recoverable from the
pre-change CEE commit and are restored by the rollback above.

### `talchain-schemas-0.42.0.tgz` — original adoption note (retained)

> **✔ SOURCE-PACKED FROM THE MERGED, TAGGED RELEASE AND REPRODUCED TWICE.**
> Packed from a fresh blobless clone of `olumi-schemas` after asserting both
> `HEAD` and `git rev-list -n1 v0.42.0` equal
> `bbfb7eb1e3f450598ff061a8651ce8c7e053468d`, and
> `package.json.version == 0.42.0`, then `npm ci && npm run build && npm pack`.
> A second independent `npm pack` produced byte-identical output.
>
> sha256 `1d5f2c7a7ee71b71d60f80b2e37db3e94f2f379a5741fd84c1099a4e13016ba0`
> — 403,431 bytes.
>
> **✔ PUBLISHED-CONTENT IDENTITY ALSO PROVEN.** GitHub Packages reports SHA-1
> `b784ebebe4c1b0a74e6880542018184fa3e3be23` and integrity
> `sha512-ugZGl6CcPyIVPXuyBnwD8xjTp6h0oE+TDknP/jfj/orWDp8O6qfpXPOYkKvOufCGPnUyBh8tFoaaj/T0gODOyg==`.
> Both were reproduced from the downloaded registry artifact. The registry and
> source-packed tar envelopes differ, as npm repacks on publish, but unpacking
> both and comparing every path produced zero content differences.

**What CEE adopts here: one additive compatibility reader, and no writer.**
0.42.0 adds the strict `edge_strength_edit` member to the root
`OrchestratorTurnPayloadSchema`. CEE parses that ROOT schema at B1, including
its cross-field rules, then deterministically returns a typed, non-retryable
`FEATURE_NOT_ENABLED` refusal. The reader writes no graph or handler fact,
derives no new pending action, preserves legitimate prior pendings through the
canonical TTL/expiry/hash carry-forward, and does not call
`adjust_edge_strength`. A degraded pending read fails the transcript commit
closed rather than clearing state. Every pre-0.42 system event retains its
prior handling and wire shape.

> **⚠ READER-FIRST ORDER IS LOAD-BEARING.** A CEE pinned to 0.41 rejects the
> new discriminator before dispatch. Rollout order is: schemas 0.42 publish →
> this CEE reader deploys → the separate CEE writer may deploy → only then may
> a UI emitter ship. This reader is the safe rollback floor for the writer: a
> writer revert retains the 0.42 parse and returns the explicit no-write refusal
> instead of mutating or failing opaquely.

**Rollback path:** revert this whole PR and run `pnpm install`. Git restores
the exact 0.41.0 tarball, checksum, pin, lockfile, generated live schema and
dispatcher. This rollback is independent while no producer emits
`edge_strength_edit`; after an emitter ships, revert the writer to this reader
floor rather than reverting below 0.42. Reverting never unpublishes 0.42.0.

### `talchain-schemas-0.41.0.tgz` (historical — no longer vendored)

The exact prior CEE bytes were sha256
`7054277fbc800c8ec8e63c280803466381d79eb3c570bf0ba6c848a85b979f6a`
(398,468 bytes). Tag `v0.41.0` resolves to
`81692c67a3e0e998c084d14895e494c5ec79b294`. They remain recoverable from the
pre-change CEE commit and are restored by the rollback above.

### `talchain-schemas-0.40.0.tgz` (historical — no longer vendored)

> **✔ BYTE-IDENTITY PROVEN BY INDEPENDENT REPRODUCTION, NOT BY COMPARING RECORDED HASHES.**
> Packed from a fresh blobless clone of `olumi-schemas` with **`HEAD` asserted equal to
> `09c82c9784b2f8220176945ce3ed692352842ae7`** (tag `v0.40.0`; `git rev-list -n1 v0.40.0`
> re-derived, and `package.json.version == 0.40.0`) *before any read* — fetching a ref is
> not checking it out — then `npm ci && npm run build && npm pack`
> (node 20.19.5 / npm 10.8.2, the same toolchain the 0.39.0 entry records).
>
> sha256 `19d7fa78cf830fb0e8865830d5bee63870d69f631e48cc173c03b42b11b3f126` — 395,213 bytes.
>
> **✔ CROSS-REPO BYTE-IDENTITY, ESTABLISHED THE STRONG WAY.** PLoT had already vendored
> 0.40.0 at its staging tip (`d39b4fa1`). Its `vendor/talchain-schemas-0.40.0.tgz` was
> downloaded and hashed: **identical sha256 to the pack produced here from source.** So the
> estate rule ("no two repos may hold DIFFERENT bytes under one version string") is satisfied
> by *reproduction from the tagged source*, which is stronger than agreeing on a recorded
> string — a manifest can be copied without the bytes being. Adding these bytes here yields
> the same git blob PLoT holds.

**What CEE adopts here: THREE things, and this is NOT a parity-only bump.** Unlike the 0.39.0
entry above, this bump is taken *because* CEE consumes the new cars:

| car | CEE consumption in this PR |
|---|---|
| `OBSERVED_STATE_SOURCE_LITERALS` / `KnownObservedStateSource` | **YES** — `src/schemas/cee-v3.ts` now DERIVES `ObservedStateV3.source` from this list instead of hand-mirroring 7 literals. The contract minted the list for exactly this purpose and says so. Widens the accepted set 7 → 12; `observed-state-source-derivation.test.ts` pins SET EQUALITY so drift REDs in both directions. |
| `RoundParticipantRefSchema` | **YES** — the shape of `applied_from` (ingress claim) and `elicited_from` (server stamp). Ids only, `.strict()`; a display name is refused at parse, which is the PII rule made structural. |
| `factor_value_edit.applied_from` | **YES** — CEE is the VERIFIER. `src/collab/apply-verification.ts` checks the claim against CEE's own collab store before any stamp. |
| `observed_state.elicited_from` | **YES** — CEE is the only stamper. |

> ⚠⚠ **READER-FIRST SEQUENCING IS LOAD-BEARING FOR THIS BUMP, AND IT IS THE ONLY WAY TO GET
> IT WRONG.** Every member of the system-event union is `.strict()`. A UI that emits
> `applied_from` against a CEE still pinned ≤0.39.0 does **not** get the field dropped — it gets
> **the whole turn refused** (`unrecognized_keys ['applied_from'] at path ['event']`). So:
> **CEE merges and DEPLOYS first; only then may the UI emitter ship.** The UI PR states the
> same constraint from its side.

### `talchain-schemas-0.39.0.tgz` (historical — no longer vendored)

> **✔ SOURCE-PACKED FROM THE MERGED, TAGGED RELEASE, AND — FOR THE FIRST TIME IN
> THIS FILE'S HISTORY — VERIFIED AGAINST THE REGISTRY BYTES.** Packed from a fresh
> blobless clone of `olumi-schemas` with **`HEAD` asserted equal to
> `76fe0ed9f6a26e884420c2ea5115fa1edb7d2b27`** (tag `v0.39.0`, olumi-schemas #38)
> *before any read* — fetching a ref is not checking it out — then
> `npm ci && npm run build && npm pack` (node 20.19.5 / npm 10.8.2).
>
> sha256 `4c05a7f71efe56c8144b6125f44181b64c56a996c1d38234212bc09e025c92f0`
> — 385,991 bytes. **Proven byte-reproducible:** a second independent `npm pack`
> of the same build produced the identical sha256.
>
> **✔ CROSS-REPO BYTE-IDENTITY IS PROVEN, NOT ASSERTED.** The estate rule is that
> no two repos may hold DIFFERENT bytes under one version string. All three
> consumers' vendored tarballs are the **same git blob
> `844d432b7b339869b02e89ed54854f78a2a354d2`** — blob identity is byte identity,
> a stronger check than comparing three recorded sha256 strings, since a manifest
> can be copied without the bytes being. All three lockfiles independently
> recorded the identical `sha512-O2JqLFE6H9V7…` integrity over those bytes.
>
> **✅ ROADMAP 2.464 IS CLOSED FOR THIS VERSION — and the premise every previous
> entry recorded was FALSE.** Since 0.31.0 this file has said the registry-bytes
> comparison "remains open" because the lane's token had no GitHub Packages read
> scope (`gh api /orgs/Talchain/packages` → 404). **The 404 was about the wrong
> endpoint, not about the token.** `curl -H "Authorization: Bearer $(gh auth
> token)" https://npm.pkg.github.com/@talchain/schemas` succeeds and reports
> `dist-tags.latest = 0.39.0`. The published artifact was downloaded and compared:
>
> | check | result |
> |---|---|
> | registry `dist.shasum` vs `shasum -a 1` of the download | `5435da9b9325a5fd88d997164600612032c943fa` — **identical** |
> | registry `dist.integrity` vs `openssl dgst -sha512 -binary … \| base64` | `sha512-Uk2uRLs94eq7OfJ7TlA2FxccdD0g6k6KOFghJjAPB7+JcBNr4ENaZWODCNVsv61lrQxu4gl3Yoargy6rATy+2w==` — **identical** |
> | registry tarball's own `package/package.json` | `@talchain/schemas 0.39.0` |
> | registry bytes vs the source pack vendored here | **DIFFER** — 385,588 vs 385,991 bytes (npm repacks on publish; the 0.29.0 vendor commit learned this the hard way) |
> | registry CONTENT vs source-pack CONTENT (`diff -r`, both unpacked) | **byte-identical — zero content differences, zero file-list differences** |
>
> **So the two artefacts differ only in their gzip/tar envelope and agree on every
> byte that is ever executed.** The source pack is vendored, because that is the
> recipe PLoT's and the UI's `vendor/` both instruct the next bumper to use; the
> registry hash is recorded so a future session can re-derive either side without
> re-litigating which is canonical. **The honest statement for 0.39.0 is no longer
> "unverified against the registry" — it is "verified against the registry, and
> content-identical to it".**

**What CEE adopts here: NOTHING. This is a PARITY-ONLY bump and it is meant to be
inert.** No field is emitted, no source file is touched beyond the two version
pins named below.

**⚠ WHY AN INERT BUMP IS NEVERTHELESS URGENT — the adoption-order constraint,
measured upstream:** every parent touched by 0.39.0 is `.strict()`. If a producer
emits one of the new fields before its consumer has re-vendored, **the old
consumer does not silently drop it — it HARD-FAILS the entire block/envelope
parse.** Consumers must therefore move FIRST, which is what this PR does across
all three repos. CEE is the eventual PRODUCER for the DSK claim-provenance and
`run_delta` cars; **that producer work is deliberately NOT in this PR.**

Four additive-optional cars arrive; CEE consumes none of them today:

| car | CEE consumption today |
|---|---|
| `DskClaimProvenanceSchema` + the triple on `CoachingBlock` / `ReviewCardBlock` | **not yet** — CEE composes both parents (132 / 211 references) and already carries 192 `dsk_claim_id` references, but has **zero** references to `DskClaimProvenance`. This is CEE's future producer half. |
| `UiDirectiveSource` + optional `source` on `UiDirectiveBlock` | **not yet** — CEE emits `UiDirectiveBlock` (31 references) but has zero references to `UiDirectiveSource` |
| `RunDeltaSchema` + optional `OlumiResponse.run_delta` | **no** — zero references to `run_delta`. ⚠ **See the name-collision warning below before wiring this.** |
| the collab U-S0 family (incl. `AuthoredBySchema`) | **no** — zero references |

> ⚠⚠ **`RunDelta` IS NOW A NAME THAT MEANS TWO DIFFERENT THINGS IN THIS REPO —
> read this before wiring `run_delta`.** CEE already has its **own**
> `export interface RunDelta` at `src/orchestrator-v5/coaching/compare-runs.ts:60`,
> consumed by `signals/coaching-signals.ts` and `routing/run-comparison-gate.ts`
> (13 references). 0.39.0 introduces a **schemas-side `RunDelta`/`RunDeltaSchema`**
> that is a *different type with the same name*. **Nothing breaks today** — every
> current import resolves to the local interface via a relative path, which is why
> this bump typechecks clean — but this is exactly the two-`generateGraphHash`-twins
> trap re-armed at a new site, and it is the trap that costs the most when it
> fires, because there is no compile error to find it by. **Whoever wires
> `run_delta`: alias the import (`import type { RunDelta as WireRunDelta }`) or
> rename the local one, and do NOT assume the two shapes agree — derive the wire
> shape from the schema, not from the local interface.**

**Export verification — checked by IMPORTING, not by grepping the tarball.** A
`grep` over `dist/` proves presence in a file, never that the package entry
EXPORTS the symbol. Installed and imported: all four families resolve from
**`@talchain/schemas/boundary`** (180 exports) and **none from the package ROOT**
(103 exports). A negative control (`FakeSchema_XYZ`) read ABSENT, so the probe was
proven able to report absence before its presence readings were trusted.

**⚠ THE EDITABLE-FIELD TABLE DID NOT MOVE — verified at the bytes, not assumed.**
Unlike the 0.37.0 bump (which silently inherited 0.36.0's table revision 2), the
0.38.0→0.39.0 diff touches no table source. Read off the INSTALLED 0.39.0
package: `EDITABLE_FIELD_TABLE_DIGEST = 67cea469-77605f3b`, `length = 43`,
`REVISION = 2`, and the recomputed digest reproduces the published constant.
All three are byte-identical to 0.38.0, so `field-parity-derivation.test.ts`'s
digest, row-count and revision assertions are untouched by this bump.

**Measured pin-bump delta (re-derived at this tip, not inherited):**

- `pnpm typecheck` (the honest gate — `tsc -p tsconfig.build.json --noEmit`, with
  `pretypecheck` running `openapi:generate` + `check:schemas-resolution`):
  **clean at pristine `9a957207` and clean here**, with the resolution check
  flipping from `✔ @talchain/schemas@0.38.0 bound` to
  `✔ @talchain/schemas@0.39.0 bound`. **0 affected sites.**
- `pnpm test:required` at pristine `9a957207`: **1535 files passed / 19 skipped
  (1554); 26,567 tests passed / 176 skipped / 12 todo (26,755).**
- **Exactly TWO assertions moved, both version pins**, in
  `src/orchestrator-v5/graph-management/__tests__/field-parity-derivation.test.ts`
  (plus that test's own name): the INSTALLED-version pin `0.38.0 → 0.39.0` and the
  DECLARED-pin literal `file:./vendor/talchain-schemas-0.38.0.tgz → …-0.39.0.tgz`.
  Those two are a **deliberate fail-loud tripwire** — they exist so a re-vendor
  cannot land silently — so moving them is the tripwire working, not a test being
  bent around a problem.

> **A THIRD version pin did NOT need touching, and that is worth recording.**
> `tests/integration/cee.decision-review.flip-threshold-contract.test.ts` also
> asserts `SCHEMA_PACKAGE_VERSION`, but it **derives** the expected value by
> regexing the `file:` pin out of `package.json` rather than hardcoding it. It
> therefore self-adjusted and now actively verifies this bump end-to-end (the
> declared pin, the resolved runtime constant, and its `minor >= 31` floor all
> agree at 0.39.0). **That is the pattern the two hand-written pins above should
> eventually adopt** — trap 12: derive, don't mirror.

**Rollback path:** revert the whole PR, then re-run `pnpm install`. Unlike the
0.37.0 and 0.38.0 bumps, this one **CAN be reverted alone** — no source file
imports anything 0.39.0 added, and the only source-tree change is the two version
literals in the pin test, which revert with it. Reverting does NOT unpublish
0.39.0.

### `talchain-schemas-0.38.0.tgz` (historical — no longer vendored)

> **✔ ADOPTED FROM THE BYTES TWO CONSUMERS ALREADY HOLD — NOT RE-PACKED HERE.**
> The estate rule is that no two repos may hold DIFFERENT bytes under one
> version string, so this tarball was taken from the consumers that vendored
> 0.38.0 first rather than packed afresh. DGAI (`staging`) and PLoT (`staging`)
> carry the **same git blob** `4fc13289886dbc1b73a28aa80b9d54518a3dc4dd`
> (353,278 bytes) — blob identity is byte identity, a stronger check than
> comparing two recorded sha256 strings, since a manifest can be copied without
> the bytes being. Those bytes were fetched and re-hashed here:
> sha256 `761c7ec615da3390ec036c8dab4e5a7857501b1d46ff5f3f777353e2d05e55b9`,
> matching BOTH consumers' recorded sidecars. Tag `v0.38.0` = `main` tip
> `371e18c87bcc4e3bbfd074a9178da802244aff5b`.
>
> The registry-bytes comparison (ROADMAP 2.464) remains open and was NOT
> performed here.

**What CEE adopts here (ROADMAP 2.855, the producer half of 2.798):**
`DraftGoalConstraintSchema.value_frame` — the constraint channel's twin of
`goal_threshold_frame`, reusing the same `GoalThresholdFrame` enum. ISL's
reader half (2.796) is merged and deployed and is FAIL-CLOSED: a constraint
without this attestation is refused with `CONSTRAINT_FRAME_UNSPECIFIED` and the
entire `constraint_analysis` block is omitted, so **no goal constraint can
deliver a result until the producers catch up.** This bump is CEE's half.

⚠ **THE CONTRACT'S OWN GUIDANCE IS PARTLY WRONG AND IS NOT FOLLOWED HERE.**
0.38.0's block comment prescribes that "CEE stamps it as a CODE CONSTANT at its
constraint mint sites … the frame is a property of the minting arithmetic". The
second clause is right; the first does not follow. Unlike the goal-threshold
channel — whose single mint branch is `raw / cap`, an absolute level by
construction — this channel's arithmetic is NOT uniform:
`extractReductionConstraints` deliberately mints `{ operator: '<=', value: -N }`
and states its semantics in the SAMPLE frame, which is a DELTA. A blanket
`'level'` constant would attest a change-from-origin number as an absolute
level, ISL would convert it against the target's baseline, and the result would
be a CONFIDENT WRONG probability — strictly worse than today's honest gap. So
the stamp is derived PER BRANCH at the mint site, and producers whose arithmetic
CEE does not own (the `add_constraint` handler, whose number the routing model
computed; the draft LLM's own array; the client ingress array) stamp NOTHING and
ISL keeps failing closed.

**Also inherited, additive and unused here:** `EnrichmentOutcomeStatsSchema`
widens `mean`/`p10`/`p50`/`p90` from REQUIRED to optional and adds
`percentiles_source` (ISL's honest-absence shape for a degenerate run). This is
a widening, so no payload that parsed before stops parsing; measured green
across the full required suite.

**Measured pin-bump delta (re-derived at this tip, not inherited):** `pnpm build`
(the honest typecheck gate) — **0 affected sites**. `EDITABLE_FIELD_TABLE` and
`CEE_UI_ENRICHMENT_KEEP_LIST` are byte-identical across the two tags, so the
table-digest test stays green. Exactly **two** assertions moved, both version
pins in `field-parity-derivation.test.ts` (plus that test's own name). Full
`pnpm test:required` on the pin bump ALONE: 1512 files / 26,119 tests, green.

**Rollback path:** revert the whole PR. This one cannot be reverted alone —
`src/schemas/assist.ts` imports `GoalThresholdFrame` and the extractor imports
`GoalThresholdFrameType` from the package. Re-run `pnpm install` after the
revert. Reverting does NOT unpublish 0.38.0.

### `talchain-schemas-0.37.0.tgz` (historical — no longer vendored)

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
