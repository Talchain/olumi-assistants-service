# Contract drift & re-vendor plan — v0 (DOC-ONLY)

**Date:** 2026-07-05 · **Scope:** `@talchain/schemas` version skew across CEE / PLoT / UI / ISL, CEE-local contract-shaped primitives, and the re-vendor + promotion sequencing question ("Decision 2: re-vendor timing").
**Status:** analysis only. Nothing in this document has been executed. No packages promoted, no schemas altered, nothing re-vendored. All file references verified against working trees on 2026-07-05 (CEE read via worktree `.claude/worktrees/cranky-maxwell-7e1780`; Group A files read via `git show origin/claude/group-a-canonical-state-foundation` — branch not checked out).

---

## 1. Measured version drift map

### 1.1 The pins (all verified in-tree today)

| Repo | Pin (verified location) | Consumption method | Effective version |
|---|---|---|---|
| **CEE** (`olumi-assistants-service`) | `"@talchain/schemas": "file:./vendor/talchain-schemas-0.13.0.tgz"` — `package.json:75` | Vendored tarball + `vendor/talchain-schemas-0.13.0.tgz.sha256` (sha pinned at vendor time per 0.11.0 changelog note on tarball non-reproducibility). 175 source files import the package. | **0.13.0** |
| **PLoT** (`plot-lite-service`) | `"@talchain/schemas": "0.2.1"` — `package.json:84` | Exact pin resolved from **GitHub Packages registry** (`package-lock.json`: `resolved: https://npm.pkg.github.com/download/@talchain/schemas/0.2.1/…`); installed `node_modules/@talchain/schemas/package.json` = 0.2.1. Only ~6 files import it. | **0.2.1** |
| **UI** (`DecisionGuideAI`) | `"@talchain/schemas": "file:./vendor/talchain-schemas-0.8.1.tgz"` — `package.json:95` | Vendored tarball + `vendor/talchain-schemas-0.8.1.tgz.sha256`. ~20 source files import, including the boundary subpath for `OlumiResponse` parsing. | **0.8.1** |
| **ISL** (`Inference-Service-Layer`) | none (Python/Pydantic) | Shapes mirrored by hand in Pydantic; skew is invisible to any package manager. Out of scope for re-vendor; in scope for the fixture plan (§5). | n/a |
| **Source** (`olumi-schemas`) | `package.json` version **0.13.1**; latest git tag **v0.13.0** | Tags present: v0.1.0, v0.2.0, v0.2.1, v0.5.1, v0.10.0, v0.11.0, v0.12.0, v0.13.0. **No `v0.8.1` tag** (0.8.1 = commit `394de18`), **no `v0.13.1` tag** (0.13.1 = commit `3d31281`). A `talchain-schemas-0.13.1.tgz` sits untagged in the repo root. | 0.13.1 (untagged) |

Release-hygiene gap to fix before any re-vendor: **tag `v0.13.1`** and record the sha256 of the exact tarball each consumer vendors.

### 1.2 What each consumer silently drops or mistypes today

The platform hazard (per the system map) is that a consumer on an older schema version **silently drops** fields it doesn't know. Concretely, per consumer:

**UI at 0.8.1** — the heaviest active drift, and it's *documented in the UI's own source*:

- `src/v5/responseParser.ts` (header comment, verified): the vendored 0.8.1 `BlockSchema` union does **not** include the 0.13.0 Phase 3 block types. The parser hand-tolerates exactly `review_card | coaching | evidence | exercise` by splitting them out of `blocks[]` *before* strict validation into a sidecar slot (`phase3_blocks_from_blocks_array`). **Truly-unknown block types are DROPPED** (defensive hardening 2026-06) with only a privacy-safe `unknown_blocks` diagnostic — "Dropped != rendered." Any future 0.14.x block type CEE emits will be silently discarded by the UI until re-vendor.
- Coaching first-class contract (0.11.0: `CoachingSchema`, `BiasType`, `StrengthenItemSchema`, `WideningLogSchema`, `CausalClaimSchema`, `StrengthBand`) — not importable at 0.8.1; the UI survives on `.passthrough()` survivors and local forks. This is the "coaching lost via skew" history the system map warns about. 0.11.0's `StrengthBand` (4-band) explicitly *replaced a consumer-side 3-band* (`strong|moderate|weak`) — any UI local 3-band fork is now off-contract.
- `session.user_id` is `z.string().uuid()` at 0.8.1 but `nullable()` from 0.10.0 — a runtime-shape difference **invisible to tsc** (Zod refinement class of bug; see §5).
- `src/v5/buildPayload.ts` header pins "CEE contract: @talchain/schemas@0.7.0" — the payload-builder's own doc-contract is even staler than the vendored 0.8.1. The 0.13.1 `generate_model` / `explicit_generate` flags on `MessageTurnPayload` cannot be sent typed (0.8.1's schema is `.strict()`, so a 0.8.1-validated outbound payload would *reject* them).

**PLoT at 0.2.1** — nominally the largest drift (11 minor versions), but the *measured* consumed-surface drift is **zero**:

- PLoT imports only: `SeedSourceType`, `PlotCeeUpstreamEnvelope`, `PlotProxyTimeoutError`, `DetailLevel`, `LIMITS`, `DEFAULT_EXISTS_PROBABILITY` (files: `src/types/engine-v3.ts`, `src/constants/limits.ts`, `src/trust/types.ts`, `src/routes/v1/cee-draft-graph.ts`, `src/routes/v2/run.ts`).
- **Verified:** `git diff v0.2.1 v0.13.0 -- src/analysis.ts src/limits.ts src/enums.ts src/plot-errors.ts src/request-chain.ts src/responses.ts src/validation.ts src/warnings.ts src/repairs.ts src/cee-errors.ts` in `olumi-schemas` is **empty** — every file PLoT imports from is byte-identical across the entire 0.2.1→0.13.0 range. The whole delta (2,156 insertions, 0 deletions on `src/`) lives in the `/boundary` and `/orchestrator` subpaths PLoT never imports.
- So PLoT doesn't *drop* fields via schema skew today — it is simply **blind** to the whole V5 contract surface. Its payload toward CEE remains the untyped `z.record` enrichment passthrough (known-open seam); skew there is unguarded by design, not by version.
- Loss history at this seam is real but CEE-side: PR #297's analysis-enrichment keep-list recovered `edge_e_values` / `inference_warnings` / `confidence_tier` / `flip_thresholds` that had been dropped in CEE's projection (defensive extraction now at `src/orchestrator/pipeline/phase1-enrichment/index.ts:233–278`); PR #244 noted raw `fragile_edges` dropped by gate projection. These were *projection* drops, but they are exactly the failure mode a typed enrichment contract (future) would catch.

**CEE at 0.13.0** — one minor behind source:

- Missing only 0.13.1's `generate_model` / `explicit_generate` on `MessageTurnPayloadSchema` (+14 lines, `src/boundary/turn-payload.ts`). Because 0.13.1's schemas remain `.strict()`, a 0.13.0-validating CEE would **reject** (not drop) a turn payload carrying those keys — a hard 4xx rather than silent loss, but still a skew failure if the UI starts sending them.

**ISL** — no pin; Pydantic mirrors drift silently by construction. Any wire-shape claim involving ISL needs fixture proof, not package-version reasoning.

---

## 2. Stay-local vs promote — per primitive

Context: five CEE-local, contract-shaped primitives were audited. **Verified across PLoT and UI source: zero references to `graphIdentityHash`, `computeAnalysisAffectingGraphHash`, or `pending_confirmation`** (grep over both repos' `src/`, empty result). Verdict for this layer: **all five stay CEE-local now.**

| Primitive | Where it lives (verified) | Who else needs it — evidence | Verdict NOW | What would justify promotion later |
|---|---|---|---|---|
| **Graph-hash pair** (`computeDeterministicGraphHash`, `computeAnalysisAffectingGraphHash`) | CEE `src/orchestrator-v5/context/graph-hash.ts` (topology-identity hash + whitelist analysis-affecting projection, SHA-256/16-hex) | Nobody consumes CEE's hash. But the **UI has a PARALLEL, semantically different freshness implementation**: `src/canvas/utils/graphHash.ts` `generateGraphHash` — not a cryptographic hash at all (string concat of `id:type:label:probability:confidence` per node + `confidence:weight:belief` per edge), compared in `src/canvas/ui/inspector-v2/useStaleGuard.ts` against the hash stored at last run. **Semantic drift is live today**: UI includes `label` (label edit ⇒ UI says *stale*); CEE's analysis-affecting projection deliberately excludes labels (label edit ⇒ CEE says *fresh*). Field vocabularies also differ (React-Flow `node.data` vs wire GraphState `observed_state.value` / `strength.mean/std` / `exists_probability`). The two verdicts can disagree on the same edit; the hashes are not comparable across the wire. | **Stay CEE-local** | UI adopting server-authoritative freshness (retiring `useStaleGuard`'s local hash), or any feature that compares hashes cross-service (compare-baseline identity). Precondition: UI on ≥0.13.x so the promoted type isn't dropped. |
| **canonicalizeJson / computeResponseHash** | CEE `src/utils/response-hash.ts` (12-char SHA-256; comment: "matches UI implementation") | **UI twin exists**: `src/lib/canonical-hash.ts` (`canonicalise` / `canonicalJson` / `computePayloadHash`, 12-char SHA-256, drives `x-olumi-payload-hash` cross-service tracing). Compared semantics: **agree on pure wire JSON** (sorted keys at every level, `undefined` omitted, arrays ordered, `null` preserved, same 12-char truncation). **Diverge off wire-JSON**: UI special-cases `Date`→ISO, `Map`/`Set`/`RegExp`/`Error`; CEE does not (a `Date` through CEE's `canonicalizeJson` becomes `{}` — no own enumerable keys). Shared latent flaw: both use plain `{}` accumulators, so a parsed-JSON own `__proto__` key vanishes → false hash equality. The Group A branch hardens CEE's `stableStringify` (null-prototype accumulator) **but not `response-hash.ts`** and not the UI twin — a three-way divergence risk once Group A merges. | **Stay CEE-local**, but this is the strongest *eventual* promotion candidate — hash equality across services is its entire purpose | Promote when cross-service hash equality is asserted anywhere (tracing joins, replay verification). Must ship with a shared golden hash-parity test (§5.3) and a single `__proto__`/special-types policy, or promotion just standardises the divergence. |
| **Routing enums / proposal schemas** | CEE `src/orchestrator-v5/routing/types.ts` — file header (lines 1–6): "Must migrate to @talchain/schemas in next bump. QUARANTINE: … No other file in src/orchestrator-v5/ may define these types," enforced by `scripts/validate-handler-ownership.sh` (D11; `CANONICAL_FILE='src/orchestrator-v5/routing/types.ts'` at line 302) | No PLoT/UI consumer today (Sonnet-router internal). The quarantine is a *pre-declared promotion obligation*, unique among the five. | **Stay CEE-local this layer** | The **next `@talchain/schemas` bump** (0.14.x), per the file's own contract. This is the first primitive to promote when the promotion window opens. |
| **Pending-confirmation carriage** | CEE `src/orchestrator-v5/context/context-pack-schema.ts:130` — `conversation.pending_confirmation: z.boolean()` inside a `.strict()` pack; schema comment (lines 39–41): structured carriage lives **off-pack** on the wire (`pending_actions[]`, `proposed_actions[]`). Truth semantics = Track 2 (#340, merged), CEE-internal (`CONFIRMATION_EXPECTING_ACTION_TYPES`), plus `src/orchestrator/deterministic/confirmation-flow.ts` et al. | Zero PLoT/UI references (verified grep). UI currently experiences confirmations only through composed prose/chips, not a typed field. | **Stay CEE-local** | UI rendering or acknowledging pending confirmations first-class (typed confirm/decline round-trip), or write-time CAS surfacing confirmation state to clients. Also gated on Track 3 apply-wiring maturing. |
| **Group A graph-identity primitives** (`GraphIdentityHash` / `AnalysisAffectingHash` envelopes, `computeGraphIdentityHash`, `evaluateGraphIdentityCas`, transient-UI strip list, projection/normaliser version constants) | `src/orchestrator-v5/context/graph-identity.ts` on branch `origin/claude/group-a-canonical-state-foundation` (PR #343, draft, review-only; read via `git show`). File header states its own doctrine: "Designed for later promotion to `@talchain/schemas` once package skew is resolved (contract §6.4/§6.5) — **NOT promoted this slice**." CAS evaluator is pure, never throws/writes, **zero production call sites**. | **Explicit note: graph-identity primitives can remain CEE-local for now because no consumer references them** — verified zero hits in PLoT and UI source. The envelopes are deliberately contract-*shaped* (kind/algorithm/projection_version/graph_schema_version/normaliser_version) so promotion later is a lift, not a redesign. | **Stay CEE-local** (matches the branch's own stated plan) | A3 write-time CAS enforcement requiring clients to echo an expected `graphIdentityHash` on writes (UI must then carry the type), or compare-baseline identity crossing the wire. Hard gate: **Group A merged + A3 CAS interface frozen** — promoting a hash envelope whose projection/normaliser versions are still moving would burn a schemas version on churn. |

---

## 3. Blast-radius assessment per consumer

### 3.1 PLoT: 0.2.1 → 0.13.x

Nominal distance: 11 minor versions (0.x semver — minors can break). Enumerated from `olumi-schemas` CHANGELOG.md + `git log v0.2.1..v0.13.0` (16 commits):

| Version | Change category | Touches PLoT's consumed surface? |
|---|---|---|
| 0.3.0 | New `/boundary` subpath + orchestrator stub | No |
| 0.4.0 | New `/orchestrator` subpath | No |
| 0.5.0 | `HandlerFact` discriminated union, per-handler args/results, session types | No |
| 0.5.1 | Defensive schema tightening (P1-1..P1-3) | No — lands in post-0.2.1 files |
| 0.6.0 | CQE quantity-extraction schema | No |
| 0.7.0 | `OrchestratorTurnPayload` discriminated union | No |
| 0.8.1 | `draft_graph` block + `analysis_ready` on OlumiResponse | No |
| 0.10.0 | Explain handlers; freshness fields; **`session.user_id` widened to nullable**; **`WhatWouldFlipResultSchema` shape change**; `explain_result` deprecated | No |
| 0.11.0 | First-class coaching / causal-claims / `StrengthBand` (replaces consumer-side 3-band) | No |
| 0.12.0 | `EditGraphHandlerFact` union member | No |
| 0.13.0 | Phase 3 block types + **union-level `.superRefine`** on `BlockSchema` (evidence §1.3) | No |
| 0.13.1 | `generate_model`/`explicit_generate` on `MessageTurnPayload` | No |

**Measured conclusion:** every file PLoT imports from (`analysis`, `limits`, `enums`, `plot-errors`, `request-chain`, `responses`, `validation`, `warnings`, `repairs`, `cee-errors`, `graph` — graph's only delta is an added `TopologyPlanSchema` export) is **byte-identical or purely additive** between v0.2.1 and v0.13.0. The re-vendor risk for PLoT is not schema semantics at all; it is **mechanics**:

1. **Consumption method**: PLoT resolves from GitHub Packages; 0.13.x may not be published there (CEE/UI consume tarballs — publication status must be verified, cannot be confirmed from local trees). Either publish 0.13.1 to the registry or (recommended) switch PLoT to the vendored-tgz + sha256 pattern for parity with CEE/UI.
2. Lockfile churn + transitive `zod` version alignment.
3. `package.json` `exports` map changes (new subpaths added since 0.2.1) — PLoT imports only the root entry, so this should be inert, but typecheck proves it.
4. PLoT is npm (not pnpm) — run PLoT's own gate, not CEE's.

### 3.2 UI: 0.8.1 → 0.13.x

Measured delta (`git diff 394de18 v0.13.0 -- src`): **842 insertions, 13 deletions across 12 files.** The deletions — the only candidates for breakage — are fully enumerable:

1. **`BlockSchema` union redefinition** (`src/boundary/blocks.ts`): 8 members → 12 (adds `ReviewCardBlock`, `CoachingBlock`, `EvidenceBlock`, `ExerciseBlock`) plus a **union-level `.superRefine`** enforcing evidence §1.3 (`factor_ref` must match first factor `target_refs` entry). Runtime-only rule — invisible to tsc.
2. **`session.user_id`**: `z.string().uuid()` → nullable (0.10.0).
3. **`WhatWouldFlipResultSchema`**: `narrative` required → optional; `precondition_unmet` + `option_count` now required (0.10.0).

UI-side touch points, verified in source:

- **`src/v5/responseParser.ts` — the good news**: the Phase 3 tolerance splits `blocks[]` by **hardcoded type-string sets** (`PHASE3_TOLERATED_BLOCK_TYPES`, `LEGACY_SCHEMA_KNOWN_BLOCK_TYPES`) *before* validation, not by schema membership. After re-vendor, Phase 3 blocks are still diverted to the sidecar and `src/v5/extractPhase3FromV5Response.ts` still finds them at `phase3_blocks_from_blocks_array` — **the re-vendor is behavior-preserving on this path with zero UI code change**. The tolerance layer becomes redundant, not broken. Retiring it (letting the 0.13 union validate Phase 3 blocks in place) is a *separate follow-up* with its own hazard: once evidence blocks go through the strict union, a §1.3 violation becomes a fatal `schema_mismatch` instead of a tolerated sidecar entry. Do not bundle the retirement into the re-vendor PR.
- **`src/v5/buildPayload.ts`**: stale "contract: 0.7.0" header; post-re-vendor the UI can type `generate_model`/`explicit_generate` (0.13.1). Additive.
- **`src/test/__tests__/schema-adoption-contract.test.ts`**: fixtures against `NodeV3Schema`/`EdgeV3Schema`/`AnalysisReadyV3Schema` + `LIMITS`/CIL constants — all byte-identical since 0.2.1, so expected green; run it as the acceptance gate.
- **Local forks to audit at re-vendor time**: any 3-band strength enum (0.11.0 replaced it), any `session.user_id: string` assumption (now nullable), any local `WhatWouldFlipResult` fixture (shape changed).

### 3.3 CEE: 0.13.0 → 0.13.1

+14 lines in one file (`src/boundary/turn-payload.ts`), purely additive optional booleans. Smallest possible bump; the only reason to do it is to *read* the generate flags typed instead of via passthrough. Requires tagging v0.13.1 first.

---

## 4. Re-vendor sequencing recommendation

**Key structural insight (drives everything):** the consumer re-vendor to 0.13.1 and the *promotion* of CEE-local primitives into `@talchain/schemas` are **independent workstreams with different gates**. Nothing in 0.13.1 contains Group A material — re-vendoring consumers does not need Group A. Promotion (routing enums, graph-identity envelopes) *does* need Group A merged + the A3 CAS interface frozen, because promoting an envelope whose `projection_version`/`normaliser_version` semantics are still moving burns a schemas version on churn.

Ordered steps:

- **Step 0 — release hygiene (olumi-schemas, blocking, trivial).** Tag `v0.13.1` on `3d31281`; record the sha256 of the canonical 0.13.1 tarball at each vendor site (per the 0.11.0 changelog's non-reproducibility note). Decide PLoT's consumption method (recommend: vendored tgz, parity with CEE/UI).
- **Step 1 — UI re-vendors 0.8.1 → 0.13.1 first.** Why first: it carries the only *active* drift debt (hand-rolled Phase 3 tolerance, silent unknown-block drops, untypeable generate flags); the change is verified behavior-preserving (§3.2 — pre-validation split by type string); and it is the consumer most likely to need the *next* promotion wave (graph-identity, pending-confirmation), so shrinking its skew now shortens every future promotion. Scope discipline: pin bump + lockfile + adoption-contract test + §5 fixtures only. Do **not** retire the tolerance layer in the same PR.
- **Step 2 — PLoT re-vendors 0.2.1 → 0.13.1 (can run in parallel with Step 1; the two share no state).** Near-zero semantic risk (byte-identical consumed surface, §3.1); the work is consumption-method mechanics + typecheck + PLoT's own gate. Doing it now removes the platform's largest *nominal* skew and makes any future typed enrichment contract (the known-open `z.record` seam) actually adoptable.
- **Step 3 — CEE bumps 0.13.0 → 0.13.1** when it wants typed generate flags. Optional and low urgency; CEE already treats the flags as advisory.
- **Step 4 — promotion wave (0.14.x), gated on Group A merge + A3 CAS interface freeze.** First promotion per the pre-declared quarantine contract: routing enums out of `src/orchestrator-v5/routing/types.ts` (update `validate-handler-ownership.sh` D11 in the same change). Second, if and only if A3 requires clients to echo identity hashes: the `GraphIdentityHash`/`AnalysisAffectingHash` envelopes per contract §6.4/§6.5. Consumers are then one *minor* away instead of five-to-eleven.

**Rollback story (per repo, and why re-vendor-first is safe):** every consumer keeps its previous vendored tarball in git history; rollback is a one-line `package.json` pin revert + lockfile regeneration + that repo's own gate — no cross-repo coordination, because 0.13.1 is additive on every consumed surface and each repo deploys from its own staging branch. The UI's parser tolerance layer staying in place during Step 1 is the belt-and-braces: even if a 0.13.1 union behaved unexpectedly, Phase 3 blocks never reach it. Promotion (Step 4) is the only step with a coordination cost, which is exactly why it waits for the freeze.

---

## 5. Compatibility test plan

Doctrine: **Zod runtime refinements are invisible to tsc** (`.uuid()`, `.datetime()`, `.superRefine`, `.strict()` — e.g. 0.13.0's evidence §1.3 union-level superRefine and `block_id` uuid enforcement). A boundary fixture that only typechecks proves nothing; every fixture below MUST `safeParse` at runtime against the *consumer's installed* schema version.

### 5.1 Fixture safeParse at every producer→consumer hop

| Hop | Fixture set | Validates against |
|---|---|---|
| UI → CEE (`/orchestrate/v2/turn`) | Golden `MessageTurnPayload` (with and without 0.13.1 generate flags) + one per `OrchestratorTurnPayload` system-event variant | CEE's vendored boundary schemas (strict — flags fixture *proves* the 0.13.0→0.13.1 rejection boundary before and acceptance after CEE's bump) |
| CEE → UI (`OlumiResponse`) | One golden response per block type incl. all four Phase 3 blocks; evidence block in both §1.3-conforming and §1.3-violating forms | UI's vendored schema + parser: assert conforming blocks land where the extractor reads them (sidecar pre-re-vendor; still sidecar post-re-vendor while tolerance stands) and violating evidence stays non-fatal until the tolerance is retired |
| UI → PLoT (run request) | Golden GraphV3 with post-0.2.1 optional fields present | PLoT's installed schemas — `GraphV3Schema` is `.passthrough()`, so assert unknown fields *survive*, not merely parse |
| PLoT → UI (V2/V3 adapters) | Golden analysis result incl. enrichment-adjacent fields | UI adapter schemas |
| PLoT → CEE (enrichment) | **Cannot be schema-tested** (untyped `z.record` passthrough). Golden-payload snapshot + keep-list presence assertions instead: `edge_e_values`, `inference_warnings`, `confidence_tier`, `flip_thresholds` must survive CEE's projection (`src/orchestrator/pipeline/phase1-enrichment/index.ts:233–278`) — regression net for the #297 class of drop | CEE projection output |
| CEE/PLoT ↔ ISL | Pydantic-side fixture parity (ISL has no npm pin; shape claims need fixtures, not version reasoning) | ISL Pydantic models |

### 5.2 Golden payload round-trips

Full journey fixtures (draft → analyse → explain) serialized at the producer, parsed at each consumer's installed version, re-serialized, and byte/hash-compared — catches drops that per-hop fixtures miss when a middle hop re-emits.

### 5.3 Version-skew canary tests

1. **Dual-version survival diff**: a small harness loads the consumer's *vendored* schema and the *current source* schema side by side, safeParses the same golden payloads through both, and diffs surviving field sets. Any field that survives source but not vendored = a named, reviewed skew (allowlist), never a silent one. This mechanises the platform's "consumers silently drop unknown fields" hazard.
2. **Hash-parity canary**: the same golden payload through UI `computePayloadHash` (`src/lib/canonical-hash.ts`) and CEE `computeResponseHash` (`src/utils/response-hash.ts`) must yield the identical 12-char hash. Include a wire-JSON-only corpus (where they agree today) and a deliberately non-wire corpus (Date/Map/Set) as *documented-divergence* pins, plus an own-`__proto__`-key case — this fails loudly the day Group A's `stableStringify` hardening (null-prototype accumulator, branch-only today; worktree `stable-stringify.ts:23` still uses `{}`) makes CEE's three canonicalizers disagree with each other or with the UI.
3. **Freshness-verdict divergence pin**: one fixture where a label-only edit is applied — assert UI `generateGraphHash` changes (stale) while CEE `computeAnalysisAffectingGraphHash` doesn't (fresh). This pins the *known* divergence so any unintentional widening of it fails a test, and becomes the deletion target when server-authoritative freshness lands.

---

## 6. Decision input — "Decision 2: re-vendor timing" (one page)

**Recommendation (decisive): keep all five CEE-local primitives CEE-local until Group A merges and the A3 CAS interface freezes — and DECOUPLE the consumer re-vendor from that gate: re-vendor UI and PLoT to 0.13.1 now (UI first, PLoT in parallel), promote nothing in this layer.**

**Rationale.**
1. Promotion now would burn a schemas version on unfrozen semantics: the graph-identity envelopes carry `projection_version`/`normaliser_version` fields that A3 review can still move; the branch's own header says "NOT promoted this slice"; and **no consumer references any of the five primitives today** (verified, §2) — a promoted type nobody imports is pure coordination cost.
2. Re-vendor, by contrast, is measured-cheap and additive: PLoT's consumed surface is byte-identical 0.2.1→0.13.0 (§3.1); the UI's only behavioral seam (Phase 3 block tolerance) splits by type-string before validation, so the bump is behavior-preserving without touching parser logic (§3.2).
3. Sequencing re-vendor *before* promotion is what makes the eventual promotion cheap: after Steps 1–2, every consumer is ≤1 minor from head, so the 0.14.x promotion wave (routing enums per the quarantine contract, then identity envelopes per contract §6.4/§6.5) lands without the silent-drop hazard that today's 5–11-version skews guarantee.

**Implementation consequence.** olumi-schemas tags v0.13.1 (Step 0); UI and PLoT re-vendor with §5 fixtures as the acceptance gate; CEE optionally bumps to 0.13.1; the quarantine in `routing/types.ts` and the promotion note in `graph-identity.ts` remain the authoritative promotion backlog, executed only at 0.14.x after the freeze. No CEE code changes in this layer.

**Risk if wrong — both directions.** If we promote now and A3 review moves the CAS interface: a published-contract revision, three consumers to coordinate, and version churn in the single source of truth — the expensive failure. If we keep local too long: worst case is the UI later needing `graphIdentityHash` before a promotion window — mitigated because the envelopes are already contract-shaped (lift, not redesign) and post-re-vendor consumers are one minor away. The asymmetry strongly favours keep-local. Residual re-vendor risk: runtime-refinement surprises invisible to tsc — exactly what §5's mandatory safeParse fixtures exist to catch; rollback is a one-line vendored-pin revert per repo (§4).

**What it unblocks.** UI: first-class Phase 3 block types (retiring the hand-rolled tolerance on its own schedule), typed generate flags, coaching/StrengthBand contract adoption, and readiness to receive promoted identity/freshness types. PLoT: eligibility for a typed enrichment contract closing the `z.record` seam. Platform: the 0.14.x promotion wave (routing enums first, identity envelopes second) with every consumer ≤1 minor from head; A3/A4 can freeze the CAS interface against a CEE-local implementation without a published-contract deadline hanging over the review.

---

*Verification provenance: package pins read from each repo's `package.json`; olumi-schemas history via `git tag`/`git log`/`git diff` between cited tags/commits; Group A files via `git show origin/claude/group-a-canonical-state-foundation` (no checkout); UI/PLoT absence claims are full-`src` greps for the three primitive names (zero hits) — scope is those repos' `src/` trees only. No repo files were modified.*
