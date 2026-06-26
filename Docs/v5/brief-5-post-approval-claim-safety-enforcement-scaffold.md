# Brief 5 — Post-Approval Claim-Safety Enforcement Scaffold

> **Status:** DOC-ONLY design brief. No implementation, no flags flipped, no deploy, no push/merge. This brief *proposes* files-likely-to-change; it does not change them.
> **Authoring home:** `origin/staging` tip `c35c0fa3` ("docs(v5): Brief 4 — claim-safety & provenance contract (#301)"). Brief 4 (`Docs/v5/brief-4-claim-safety-provenance-contract.md`), the PR #297 keep-list seam (`src/orchestrator-v5/compose.ts`), and the diagnostic-only static guard (`tests/contract/context-summary-diagnostic-only.guard.test.ts`) all live on staging and are the live primitives this scaffold extends. The current `main`-based worktree is **behind** staging and lacks all three (its `compose.ts` still spreads enrichment raw, no keep-list, no `stripInternalKeysDeep`); therefore Brief 5 must be authored on a fresh worktree off `origin/staging` (`c35c0fa3`), as a single new file `Docs/v5/brief-5-post-approval-claim-safety-enforcement-scaffold.md`, mirroring Brief 4's docs-only, single-file, no-runtime-change PR pattern.
> **Core principle:** Brief 5 is **THE CAGE, NOT THE ACTIVATION.** Its successful end-state is: scaffold designed, tests specified, defaults closed, and **ZERO newly claim-permitted or newly surfaced Tier-2 fields**. Activating any individual Tier-2 field is a separate later decision (Brief 4 gate **G2**), explicitly out of scope here.
> **Dovetails with:** Brief 4 §0 invariants C1–C7, §1 tiers, §9 science-escalation register (incl. **E8** provenance-as-claim / calibration).

---

## 1. Executive Summary

Brief 4 ratified the *contract*: two axes (transport-cleanliness vs claim-permission), three tiers, fail-closed everywhere, no rehydration, provenance-as-precondition, and — in **C6** — the binding requirement that each tier be made enforceable by **FLAG + ALLOW-LIST + TEST + REQUIRED CI GATE** (the "Brief 3 model"). Brief 4 stopped at the contract and deliberately added no gates.

**Brief 5 is the implementation-ready translation of C6 for Tier 2, plus the Tier-3 leak cage.** It specifies the scaffold that makes claim-permission *binding rather than advisory*, while activating nothing:

- **Tier-2 candidates** — `factor_sensitivity`, `confidence_tier`, `robustness` — get their **gate built but left OFF**, behind **two independent locks**: a default-off master flag (`CEE_COACHING_TIER2_ENABLED`) **and** an initially-empty allow-list (`TIER2_COACHING_ALLOWLIST`). Either lock alone yields zero surfaced fields; both together are defence-in-depth. Turning on a single field is Brief 4 gate G2, not this brief.
- **Tier-3 deferred fields** — `flip_thresholds`, `edge_e_values`, `inference_warnings`, `m1_coaching`, scientific-warning vocabulary, report-level confidence, evidence quality, bias, **and provenance-as-a-user-facing-claim** — get a **two-part leak guard** that blocks them outright from any user-facing string: (a) a **static source-tree scan** modelled on the live `context-summary-diagnostic-only.guard.test.ts`, re-scoped to the user-facing **string-producer** files (because, unlike the diagnostic tokens, several Tier-3 wire keys legitimately appear in transport/routing code — see §5a/§6), and (b) a **runtime output assertion** that feeds populated Tier-3 values through the real compose / coaching / prose / chip path — **including the independent enrichment-prose path** (decision-review enricher + finaliser backstop) — and proves none reach `assistant_text`, `blocks[].*`, `suggested_actions[].*`, or `insights[]`.

**Coverage honesty (read before trusting the cage's breadth).** The *executable* leak guard (static + runtime) covers exactly the **four literal-bearing Tier-3 keys** — `flip_thresholds`, `edge_e_values`, `inference_warnings`, `m1_coaching`. The remaining Tier-3 categories — scientific-warning vocabulary, report-level confidence, evidence quality, bias, provenance-as-claim — have **no ratified field and therefore no literal string token to scan or assert against yet**; they are covered *today* only by (a) the absence of any ratified field and (b) a **vocabulary block to be added once their string forms are settled** (escalated to §9). They are **not yet enforced by the static scan**. This limitation is foregrounded in §4 and §5 so the cage's Tier-3 breadth is not over-trusted.

The scaffold reuses live primitives (the PR #297 `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` keep-list, `INTERNAL_ENRICHMENT_KEYS` deny-list, `stripInternalKeysDeep`, and the diagnostic static-guard mechanic). New `tests/contract/*.guard.test.ts` files **auto-enrol** in the one required CI status check, "Lint, TypeCheck, Unit Tests", so enforcement lands in the merge gate without workflow surgery.

Brief 5 **decides no science**. Every unsettled scientific question — what `confidence_tier`'s label semantics mean for a claim, whether `robustness`/`near_tie` warrant a hedged claim, the vocabulary of scientific warnings, causal permissions, **what a provenance/lineage statement may claim (E8)**, and **whether a single live capture suffices to characterise a label vocabulary** — is routed to **Brief 4 §9** (Neil / Jinghui / S1) with a conservative interim default of *not claim-usable*. Fail-closed is the default everywhere: **absent / empty / stale / unknown / degraded / disputed / unapproved ⇒ not claim-usable.**

---

## 2. Enforcement Architecture

The scaffold composes five live or proposed primitives. The first three exist on staging today; the last two are this brief's net-new proposals.

| # | Primitive | Status | Role in the cage |
|---|-----------|--------|------------------|
| P1 | `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` keep-list + `toSafeTransportEnrichment()` (`compose.ts`) | **Live** (PR #297) | Transport-cleanliness axis. Decides which enrichment keys may *transport*. Transport-clean ≠ claim-permitted. |
| P2 | `INTERNAL_ENRICHMENT_KEYS` deny-list + `stripInternalKeysDeep()` (`compose.ts`) | **Live** (PR #297) | Strips carriers (`_meta`, `downstream_calls`, `isl_response`, `isl_engine`, …) and any `[REDACTED]` leaf at any depth. Foundation of no-rehydration. |
| P3 | Diagnostic-only static guard mechanic (`context-summary-diagnostic-only.guard.test.ts`) | **Live** | The source-tree-scan *mechanic* Part-A re-uses (walker, allow-list, stale-allow-list `it` block). **Note:** the diagnostic tokens it scans appear in **zero** product files; the Tier-3 keys do not (see §5a) — so Part A re-uses the mechanic, not the bare whole-tree key-substring premise. |
| P4 | `TIER2_COACHING_ALLOWLIST` + `CEE_COACHING_TIER2_ENABLED` | **Proposed** | Claim-permission axis for Tier-2 candidates. Two independent locks, both closed at ship. |
| P5 | Tier-3 two-part leak guard (producer-scoped static scan + runtime output assertion) | **Proposed** | Claim-permission cage for Tier-3. Blocks outright. |

**Layering (claim-permission decision order, fail-closed at every fork):**

```
enrichment (post-keep-list, post-strip)            ← P1 + P2: transport-clean payload
        │
        ▼
[Tier-3 deny check]  is key in the Tier-3 leak-block set?
        │             (incl. provenance-as-claim; vocabulary-block once string forms settle)
        │ yes → BLOCK from every user-facing string (P5 proves it)
        ▼ no
[Tier-2 gate]  is CEE_COACHING_TIER2_ENABLED === true ?     ── lock 1
        │ no  → not claim-usable
        ▼ yes
        is field ∈ TIER2_COACHING_ALLOWLIST ?               ── lock 2
        │ no  → not claim-usable        (empty allow-list ⇒ all no)
        ▼ yes
[Companion-status gate]  is the field's companion status claim-safe?  (§10)
        │ no  → not claim-usable
        ▼ yes
[Freshness gate]  is deriveAnalysisFreshness() === 'fresh' ?  (§9)
        │ no  → not claim-usable
        ▼ yes
[Structured-only projection]  emit STRUCTURED, prompt-safe, non-prose only (§13)
```

At ship, **lock 1 is OFF and lock 2 is EMPTY**, so the flow short-circuits before any Tier-2 field is claim-usable. The Tier-3 deny check sits *above* the Tier-2 gate and is unconditional.

**Non-circularity clause (S1 spine).** The scaffold's guards depend **only** on the live primitives P1–P3 (keep-list, deny-list, static-guard mechanic), all merged on staging. They do **not** depend on PR #293's `spine/claim-safety.ts` `ENRICHMENT_REGISTRY` / `ClaimSafetyStatus`, which is unmerged at baseline. Brief 5 **cites that spine as the preferred future reference implementation** for claim-safety classification (its `SAFETY_ORDER` — disputes only move a field toward *less* safe — is the doctrine this brief's fail-closed rules anticipate), but the cage stands alone without it. Should the spine merge, the Tier-2 gate and Tier-3 deny set become consumers of `narrowScientificEnrichment` / `ClaimSafetyStatus` rather than of hard-coded key sets — a later refactor, not a precondition.

---

## 3. Two-Axis Table (transport-cleanliness × claim-permission)

Using Brief 4 §0 C1 terms. **Transport-cleanliness** = is the field carrier-free, no `[REDACTED]` leak, surviving the keep-list onto the wire? **Claim-permission** = what may Olumi *say* about it, by Tier? The defining subtlety: a field can be **transport-clean yet claim-deferred**.

| Field | Transport-cleanliness (on the wire?) | Claim-permission (Tier) | What Brief 5 builds |
|-------|--------------------------------------|-------------------------|---------------------|
| `factor_sensitivity` | **Clean — kept** (in keep-list, stripped) | **Tier 2 candidate** | Gate (OFF). Allow-list entry absent at ship. |
| `confidence_tier` | **Clean — kept** (top-level scalar, e.g. `"needs_work"`) | **Tier 2 candidate** (special case §7) | Gate (OFF) + second-capture precondition. |
| `robustness` | **Clean — kept** (incl. `fragile_edges`; `near_tie` nested inside) | **Tier 2 candidate** | Gate (OFF) + companion-status requirement. |
| `flip_thresholds` | **Clean — kept** (top-level array; `flip_value:null` preserved) | **Tier 3 deferred** (causal counterfactual / heuristic EVPI) | Deny / leak guard (block outright). Literal-bearing → statically scanned. |
| `edge_e_values` | **Clean — kept** (empty `[]` in fixture; no rehydration) | **Tier 3 deferred** (causal effects) | Deny / leak guard + no-rehydration test. Literal-bearing → statically scanned. |
| `inference_warnings` | **Clean — kept** (empty `[]` in fixture; no rehydration) | **Tier 3 deferred** (scientific warnings) | Deny / leak guard + no-rehydration test. Literal-bearing → statically scanned. |
| `m1_coaching` | **NOT clean via keep-list** (prose; carries `isl_engine`) **but** reachable via a **separate enrichment-prose path** (`ALLOWLISTED_LEAF_PATHS`) | **Tier 3 deferred** (prose) | Deny / leak guard. **Transport-stripping alone is NOT sufficient** — the prose path is independent (§5b, blocking precondition). Literal-bearing → statically scanned. |
| scientific-warning vocabulary | distinct from `inference_warnings` (vocabulary, not the array) | **Tier 3 deferred** | Vocabulary block (deferred until string forms settle); escalate to §9. **Not yet statically scanned.** |
| report-level confidence | **No ratified field** (distinct from `confidence_tier`) | **Tier 3 deferred** | Vocabulary block (deferred); escalate to §9. **Not yet statically scanned.** |
| evidence quality | **No field exists** | **Tier 3 deferred** | Vocabulary block (deferred); escalate to §9. **Not yet statically scanned.** |
| bias (`bias_signals` exist) | partial / unverified | **Tier 3 deferred** | Claims deferred; escalate to §9. **Not yet statically scanned.** |
| **provenance (as a user-facing claim)** | source / lineage / "this came from ISL science" | **Tier 3 deferred** (Brief 4 §4/§8 deny-by-default, E8) | Deny / leak guard (block outright). **Vocabulary block deferred** (string form unsettled → escalate to §9, don't guess a literal). **Not yet statically scanned.** |

`edge_e_values`, `inference_warnings`, `flip_thresholds`, and `confidence_tier` are the canonical illustrations of C1: **transport-clean keys that remain claim-deferred or claim-gated.** The keep-list governs the *transport* axis; Brief 5's gate and deny set govern the *claim-permission* axis. They are deliberately decoupled.

---

## 4. Field-by-Field Gate Table

`drivers_status`, `robustness_status`, `near_tie`, and `stability_thresholds.provisional` are **companions** required for a candidate field to even become claim-eligible (see §10). Stable ids are used for grounding identity (no positional / index references).

**Static-scan coverage column** records whether the row is enforced by the executable Part-A scan **today** (only literal-bearing keys are) or is a **deferred vocabulary block** awaiting a settled string form.

| Field | Tier | Companion status field(s) | Stable id | Claim-permitted at ship? | Gate built | Static scan today? | Default posture |
|-------|------|---------------------------|-----------|--------------------------|------------|--------------------|-----------------|
| `factor_sensitivity` | 2 (candidate) | `drivers_status` | `factor_id` | **NO** | YES | n/a (Tier-2) | Flag OFF **and** not in allow-list → not claim-usable |
| `confidence_tier` | 2 (candidate, special) | **none** (absence ⇒ unavailable) | discrete label | **NO** | YES | n/a (Tier-2) | Flag OFF + not in allow-list + **second live capture required** before any G2 |
| `robustness` | 2 (candidate) | `robustness_status` + `robustness.near_tie` (nested) + `stability_thresholds.provisional` | `edge_id` (on `fragile_edges`) | **NO** | YES | n/a (Tier-2) | Flag OFF **and** not in allow-list → not claim-usable |
| `flip_thresholds` | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **YES** (literal-bearing) | Leak guard blocks; escalate causal claim to §9 |
| `edge_e_values` | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **YES** (literal-bearing) | Leak guard + no-rehydration |
| `inference_warnings` | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **YES** (literal-bearing) | Leak guard + no-rehydration (spine interim: `conservative`) |
| `m1_coaching` | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **YES** (literal-bearing) | Reachable via independent prose path; leak guard MUST exercise it (blocking precondition, §5b) |
| scientific-warning vocabulary | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **No** (string form unsettled) | Vocabulary block deferred; escalate to §9 |
| report-level confidence | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **No** (no field) | Vocabulary block deferred; escalate to §9 |
| evidence quality | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **No** (no field) | Vocabulary block deferred; escalate to §9 |
| bias (`bias_signals`) | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **No** (form unverified) | Claims deferred; escalate to §9 |
| **provenance (as claim)** | 3 (deferred) | — | — | **NO** (hard-blocked) | DENY | **No** (string form unsettled) | Vocabulary block deferred; escalate to §9 (E8) |

**Binding statement.** At ship, **every** row's "claim-permitted" column is **NO**. Tier-2 rows are NO because two locks are closed; Tier-3 rows are NO because the deny set blocks them. There is no field for which this brief permits a claim. **Caveat on breadth:** for the five Tier-3 rows marked "Static scan today? No", enforcement currently rests on *no-ratified-field + deferred vocabulary block*, not on the executable scan — they become statically enforced only when their string forms are settled (§9).

---

## 5. Two-Part Leak-Guard Design

The leak guard enforces the Tier-3 claim-permission cage with two complementary tests. Part A is **structural** (proves no *string-producer* file even *names* a Tier-3 key without justification); Part B is **behavioural** (proves that even if a producer *did* touch one, it cannot reach a user). Both are required; neither alone is sufficient.

**Executable coverage.** Both parts target the **four literal-bearing keys** (`flip_thresholds`, `edge_e_values`, `inference_warnings`, `m1_coaching`). Scientific-warning vocabulary, report-level confidence, evidence quality, bias, and provenance-as-claim are **not yet** statically scanned (no literal); they are guarded by no-ratified-field + a deferred vocabulary block (§6) added once their string forms are settled. Do not over-trust Part A's Tier-3 breadth on those five.

### 5a. Part A — Static source-tree scan (re-using the `context-summary-diagnostic-only.guard.test.ts` mechanic, re-scoped)

**Why the live mechanic cannot be copied verbatim with a whole-tree key-substring scan.** The live diagnostic guard scans for internal-only tokens (`_context_summary`, `coaching_state_pack`, `canonical_state_source`) that appear in **zero** product files. The Tier-3 wire keys are categorically different: on `origin/staging`, `flip_thresholds` / `edge_e_values` / `inference_warnings` / `m1_coaching` already appear as **legitimate identifiers in ~26 product `src/` files outside tests** (e.g. `compose/flip-proposal.ts`, `coaching/pick-flip-summary.ts`, `coaching/decision-review-enricher.ts`, `compose/phase3-blocks.ts`, `routing/post-analysis-advice-gate.ts`, `deterministic/prompt-builder-v2.ts`, `deterministic/response-normaliser.ts`, `pipeline/phase3-llm/prompt-assembler.ts`, `prompts/defaults.ts`, `tools/registry.ts`, …). A bare `text.includes(WIRE_KEY)` over the **entire** `src/` tree with a tiny allow-list would emit a huge day-one offenders list — permanently red — or force allow-listing a large fraction of the codebase, defeating the guard.

**Part A is therefore re-scoped to the user-facing string-producer files** enumerated in §5b (the only files that can emit a user string), not all of `src/`. A new `tests/contract/tier3-leak-guard.static.guard.test.ts`:

- `SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))`; reads files **from disk** (`readdirSync` + `readFileSync` + `statSync`) — does **not** import modules (so it cannot be defeated by runtime gating).
- **Scoped walk:** instead of the whole tree, it iterates the explicit **`STRING_PRODUCER_FILES` manifest** (§5b table) — the compose/coaching/prose/chip/handler-failure/precondition producers. Excludes `*.d.ts`, `*.test.ts`, and editor-sync duplicates via the `/ \d+\.[cm]?tsx?$/` regex, exactly the live walker.
- For each Tier-3 literal `WIRE_KEY`: if `text.includes(WIRE_KEY)` **and** the repo-relative path (`'\' → '/'` normalised) is **not** in a hardcoded `ALLOWLIST: Set<string>` of reviewed legitimate transport/routing namers, push to `offenders`.
- **Part A's value is REGRESSION-detection:** no *new* string-producer file may name a Tier-3 key without explicit, reviewed allow-listing. The allow-list is **seeded from a verified manifest** of the current legitimate uses among the producer files (each entry classified producer-vs-transport per the `~/.claude/CLAUDE.md` evidence-for-absence rule), so the guard ships green and any future addition trips red.
- Assertion: `expect(offenders).toEqual([])`, with a message instructing the dev to either justify-and-allow-list a *transport/routing-only* use or treat a claim-emitting hit as a contract violation.
- **Parallel guards in one file**, one per literal-bearing Tier-3 key, mirroring the live file's three parallel guards.

**Scan scope, allow-list exceptions, and failure condition** are specified in §6.

### 5b. Part B — Runtime output assertion (extends the PR #297 phase3-lifecycle pattern)

A new `src/orchestrator-v5/__tests__/tier3-leak-guard.runtime.test.ts` (or a `tests/contract/` peer; see §6) that:

1. Builds an enrichment object with **populated** Tier-3 fields (e.g. `flip_thresholds` with real `flip_value`s, `edge_e_values` with real `edge_id`/`value`, `inference_warnings` with real warning strings, an `m1_coaching` prose block carrying an `isl_engine` token) — plus populated copies buried inside carriers (`_meta.payloads.isl_response.*`, `downstream_calls.isl[*].response_payload.*`).
2. Feeds it through the **real** compose / coaching / prose / chip path (the producers below) **and** — critically — through the **independent enrichment-prose path** (`sanitise-enrichment.ts` `ALLOWLISTED_LEAF_PATHS` → decision-review enricher → response-finaliser backstop), then through the egress chokepoint `sanitiseOlumiResponseForEgress`.
3. Asserts that **no** Tier-3 token reaches any user-visible string field: `assistant_text`, `blocks[].*.title/body`, `suggested_actions[].label/message`, `insights[]`. Concretely: `JSON.stringify(userFacingProjection)` does **not** contain the populated `flip_value`, `edge_id`, warning text, or `isl_engine` token.

**Blocking precondition — `m1_coaching[*].text` is reachable independent of the transport keep-list.** On `origin/staging`, `sanitise-enrichment.ts` (`ALLOWLISTED_LEAF_PATHS`, e.g. `/^\$\.m1_coaching\[\d+\]\.text$/`) operates on a **separate enrichment-prose path** consumed by the **decision-review enricher** and the **response-finaliser backstop** — **not** the `compose.ts` transport keep-list. So `m1_coaching` prose (and its `isl_engine` token) can reach a user-facing string **regardless** of transport-stripping. This is a **live potential fail-OPEN seam**, not a deferred question. Therefore:

- **S1/S2 cannot land green** until `$.m1_coaching[*].text` is **removed from `ALLOWLISTED_LEAF_PATHS` or proven unreachable** to any user-facing string while the Tier-3 deny set is active.
- Part B **must** feed a populated `m1_coaching` block through the **decision-review-enricher + finaliser-backstop** path (not only `compose.ts`) and assert the `isl_engine` token and prose do **not** reach `assistant_text` / `blocks[].*`.
- The §3/§4 wording deliberately does **not** call `m1_coaching` "stripped at transport, therefore safe" — transport-stripping is necessary but not sufficient.

**User-facing string producers the runtime test must exercise** (every path that can emit a user string; the test proves none leaks; this manifest is also Part A's scoped walk set):

| Path | File |
|------|------|
| transport keep-list + block enrichment | `src/orchestrator-v5/compose.ts` (`toSafeTransportEnrichment`, `buildBlocksFromFacts` / `block.enrichment`) |
| review / coaching / evidence card text | `src/orchestrator-v5/compose/phase3-blocks.ts` (`buildReviewCardBlocks`, `buildCoachingBlocks`, `buildEvidenceBlocks` — `title`/`body`/`action_label`) |
| **enrichment-prose path (independent of keep-list)** | `src/orchestrator-v5/compose/sanitise-enrichment.ts` (`sanitiseEnrichment` + `ALLOWLISTED_LEAF_PATHS`), **decision-review enricher** (`src/orchestrator-v5/coaching/decision-review-enricher.ts`), **response-finaliser backstop** |
| egress envelope walk (main chokepoint) | `src/orchestrator-v5/compose/output-safety.ts` (`sanitiseOlumiResponseForEgress`, `sanitiseUserFacingText`, `sanitiseCoachingProse`); companion `src/orchestrator/shared/output-safety.ts` |
| chips | `src/orchestrator-v5/compose/chip-finalizer.ts` (`finalizeChips`), `chip-generator.ts` (`label`/`message`), `chip-safety.ts` (`findChipLeakToken`, `findChipRawDecimalLeak`) |
| handler-failure responses | `src/orchestrator-v5/compose/handler-failure-responses.ts` (`composeHandlerFailure`) |
| precondition / freshness templates | `src/orchestrator-v5/tools/handlers/no-op-helpers.ts` (`decideExplanationPrecondition`, `buildPreconditionAssistantText`; verdicts `missing` / `degraded` / `stale` / `unconfirmed` / `execute`) |

**Note on `ALLOWLISTED_LEAF_PATHS`.** The enrichment prose allow-list in `sanitise-enrichment.ts` permits (among others) `$.factor_sensitivity[*].interpretation`, `$.m1_coaching[*].text`, `$.robustness[*].caveat` (the file also lists further entries such as `$.m1_review[*].text` and `$.robustness_synthesis`; the three cited here are the claim-relevant subset, not an exhaustive list). These are *prose-cleanliness* allowances on the transport axis — they do **not** grant claim-permission. Part B must assert that even an allow-listed leaf path does not result in a claim-bearing user string while the Tier-2 gate is closed and the Tier-3 deny set is active. The `m1_coaching[*].text` reconciliation is **not** a deferred question — it is a blocking precondition above.

---

## 6. Scan Scope, Allow-list Exceptions, and Failure Condition

| Aspect | Specification |
|--------|---------------|
| **Files scanned (Part A)** | The explicit **`STRING_PRODUCER_FILES` manifest** (§5b table) — the compose/coaching/prose/chip/handler-failure/precondition producers — **not** the whole `src/` tree. (Whole-tree scanning is rejected: the literal keys already appear in ~26 legitimate transport/routing files; a whole-tree scan would be permanently red or vacuous.) |
| **Excluded files** | `*.d.ts`, `*.test.ts`, editor-sync dupes (`/ \d+\.[cm]?tsx?$/`). |
| **Keys scanned** | The **four literal-bearing** Tier-3 keys: `flip_thresholds`, `edge_e_values`, `inference_warnings`, `m1_coaching`. Scientific-warning vocabulary, report-level-confidence, evidence-quality, bias, and **provenance-as-claim** are **NOT** scanned yet (no settled literal) → escalate to §9 rather than guess a literal; add a vocabulary block once string forms are ratified. |
| **Permitted allow-list exceptions (within the producer manifest)** | Only **transport/routing** uses — a producer file that legitimately *names* a key to transport or route it (never to emit a user string) — may be allow-listed, each entry seeded from the **reviewed manifest** of current legitimate uses and classified producer-vs-transport. Outside the producer manifest, the ~26 existing legitimate namers (flip-proposal/coaching/prompt-builder/routing transport code) are **out of Part A's scope by design** — Part A guards *regression in string-producers*, not their existence elsewhere. |
| **What makes CI fail (Part A)** | A **new or un-allow-listed** Tier-3 literal appearing in a **string-producer** file → `offenders` non-empty → `expect(offenders).toEqual([])` fails → required "Lint, TypeCheck, Unit Tests" check red. |
| **What makes CI fail (Part B)** | Any Tier-3 token surfacing in `assistant_text` / `blocks[].*` / `suggested_actions[].*` / `insights[]` after the real compose **or enrichment-prose** path → assertion fails → required check red. |
| **Stale-allowlist guard** | Mirror the live guard's second `it` block: assert every allow-list entry still references the key in its file (no dead allow-listing). |

**Never silently disable the cage.** If a leak guard becomes flaky, the fix is to **harden the guard, never to red-exclude it**. A red-excluded leak guard is a **silently-disabled cage** — CI stays green while Tier-3 leaks freely. The new guards must **not** be added to the `vitest.required.config.ts` red-exclusion list under any circumstance, flakiness included. (How a new `tests/contract/*.guard.test.ts` auto-enrols in the required gate is specified in §14.)

---

## 7. confidence_tier Special Case

`confidence_tier` is a Tier-2 candidate but is the **most likely to be mistaken for a Tier-3 claim**, so it carries extra binding constraints. In the captured fixture it is a **populated top-level scalar** (`"needs_work"`).

| Constraint | Rule |
|------------|------|
| **No companion status** | Unlike `factor_sensitivity` (`drivers_status`) or `robustness` (`robustness_status` + `near_tie` + `stability_thresholds.provisional`), `confidence_tier` has **no companion status field**. Its **absence ⇒ unavailable ⇒ not claim-usable** (fail-closed). There is no companion to consult, so the gate treats missing/empty as a hard stop. |
| **Discrete label only** | It is a discrete label (e.g. `needs_work`). Any projection (later, post-G2) must surface it **only** as the discrete label. |
| **Never numeric / probabilistic** | It must **never** be rendered as a number, a percentage, a probability, an "evidence-quality" measure, or a **report-level confidence** statement. `confidence_tier` (Tier-2 discrete label) is categorically distinct from *report-level confidence* (Tier-3, **no ratified field**); conflating them is a contract violation Part B must guard against. |
| **Must not ride the Tier-1 redacted pack** | The discrete `confidence_tier` label must **NOT** be carried inside the Tier-1 redacted coaching pack (counts / statuses / predicates / hashes only — no prose / labels / graph content). The label is the most likely Tier-2 value to be laundered into prompt-derived prose; §13 "Prompt-safe" makes this explicit. |
| **Second live capture required (Brief-5 conservative interim default, not a Brief 4 inheritance)** | Before any G2 activation of `confidence_tier`, a **second independent live capture** is required. **This is a Brief-5-originated tightening**, not stated by Brief 4 (Brief 4 gates `confidence_tier` on allow-list + absence-unavailable + flag + tests + freshness and notes n=1 but does not require a second capture). The single staging fixture `v5-turn.run-analysis.staging.json` shows exactly one populated value `"needs_work"`; whether n=1 suffices to characterise the label vocabulary and its claim semantics is a **calibration/science question routed to §9 (E8)** — Brief 5 does not settle it inline, it adopts "need a second capture" as the conservative default until §9 rules. Until then, even with flag-on + allow-list-listed, `confidence_tier` stays not-claim-usable. |
| **Science routed** | What a given `confidence_tier` label *permits Olumi to claim* is an **unsettled science question → Brief 4 §9 (E8)** (owner: Neil / Jinghui / S1). Brief 5 decides none of it; conservative interim default = not claim-usable. |

---

## 8. No-Rehydration & Missing-Not-Zero Test Plan

Extends the four live PR #297 cases in `src/orchestrator-v5/__tests__/phase3-lifecycle.test.ts`, hardened for the Tier-3 cage. C4 (no rehydration) and the missing-not-zero discipline are the load-bearing invariants.

| Test | Setup | Assertion |
|------|-------|-----------|
| **T1 — Absence preserved** | Tier-3 fields absent from the source enrichment. | `('edge_e_values' in enr) === false`, same for `inference_warnings`, `confidence_tier`, `flip_thresholds`. Never fabricated. |
| **T2 — Empty-as-empty** | Top-level `edge_e_values: []` and `inference_warnings: []` (honest empty source state). | Preserved **as `[]`** — not dropped to absent, not fabricated to populated. Honest empty survives. |
| **T3 — No rehydration (carrier populated)** | Top-level `edge_e_values: []` / `inference_warnings: []`, but a **populated** copy lives only inside `_meta.payloads.isl_response.*` **and** `downstream_calls.isl[*].response_payload.*` (and, for `m1_coaching`, inside an `isl_engine` carrier). | After `stripInternalKeysDeep`, top-level stays `[]`; `JSON.stringify(enr)` does **not** contain the populated `edge_id` or `value`; the `isl_engine` token does not survive. Internal carriers are **never** the source of a top-level repopulation (C4). |
| **T4 — Null preserved (missing-not-zero)** | `flip_thresholds` with `flip_value: null`. | Survives as honest `null`, **never coerced to 0**. Missing/unknown is `null`/absent, never a fabricated numeric zero. |
| **T5 — Missing-not-zero, claim layer** | A Tier-2 candidate (`factor_sensitivity` / `robustness`) with a missing magnitude or absent companion status. | The claim layer treats it as *unavailable* (fail-closed), not as a zero-magnitude / "no effect" claim. No `0` is ever invented to fill an absence in a user string. |
| **T6 — Runtime no-leak (Part B integration, incl. prose path)** | Populated Tier-3 fields fed through the full compose / coaching / prose / chip path **and** the independent enrichment-prose path (decision-review enricher + finaliser backstop) (§5b). | No Tier-3 token in any user-facing string field; the `m1_coaching` `isl_engine` token does not surface via the prose path. |

**Missing-not-zero binding statement.** Empty stays empty; null stays null; absent stays absent. The system **never** substitutes `0` (or any fabricated magnitude) for a missing, empty, null, or unconfirmed value — neither on the wire (`stripInternalKeysDeep` / keep-list) nor in any claim projection. `null ≠ 0`; `[] ≠ populated`; absent ≠ "no effect".

---

## 9. Fail-Closed State Semantics

Fail-closed is the default at **every** decision fork (Brief 4 C3). A field is claim-usable **only** when *all* of the following hold; if **any** is true, the field is **not claim-usable** and degrades to a conservative, honest, non-claiming projection.

| State | Source | Verdict |
|-------|--------|---------|
| **absent** | field omitted from enrichment | not claim-usable |
| **empty** | `[]` / `{}` / empty scalar | not claim-usable |
| **stale** | `deriveAnalysisFreshness() === 'stale'` | not claim-usable (rerun-guidance only) |
| **unknown** | freshness `unknown` / `unconfirmed` | not claim-usable (treat conservatively) |
| **degraded** | analysis degraded; precondition verdict `degraded` | not claim-usable |
| **disputed** | a dispute signal present (spine `DisputeSignal`; `SAFETY_ORDER` moves toward *less* safe) | not claim-usable — **but see note: forward-declared, not active at baseline** |
| **unapproved** | flag OFF **or** field not in allow-list **or** Tier-3 | not claim-usable |

**Note on `disputed` (forward-declaration, not an enforced gate at baseline).** The only defined source of a `disputed` verdict is the S1 spine `DisputeSignal` / `SAFETY_ORDER` (PR #293), which is **unmerged and absent from staging** (consistent with the §2 non-circularity clause). At ship **no mechanism can set `disputed`**, so this arm is a **forward-declaration**, not a live gate. Disputed inputs are nonetheless caught **transitively today** by the `unapproved` / `absent` fail-closed defaults (a Tier-3 or un-allow-listed field is already not claim-usable). The conservative reading is preserved (if ever set → not claim-usable); the row simply does not imply a present, dedicated dispute check.

**Freshness requirement (binding).** A Tier-2 claim may be made **only** when `deriveAnalysisFreshness()` returns `'fresh'`. Any of `stale` / `unknown` / `none` / `unconfirmed` ⇒ not claim-usable. Prose, chips, and context all derive from the single canonical `deriveAnalysisFreshness` (the Tier-0 invariant established by PR #298 / the freshness live-path fix); the precondition verdicts `missing | degraded | stale | unconfirmed | execute` in `no-op-helpers.ts` are the conservative templates a closed gate falls through to. The rerun **chip** fires only on *definite* stale; `unknown`/`unconfirmed` prose stays conservative.

**Telemetry.** Degrade events emit `v5.coaching.output_postcheck` (e.g. `stale_presented_as_fresh`, `invented_mutation_success`, `confident_advice_under_unsafe_state`), giving an observable signal that the fail-closed path fired rather than a claim being made.

---

## 10. Companion-Status Requirements

A candidate Tier-2 field is **claim-eligible only when its companion status confirms it is safe**; absent / unsafe / unknown companion ⇒ fail-closed.

| Candidate | Companion(s) | Rule |
|-----------|--------------|------|
| `factor_sensitivity` | `drivers_status` | Claim only if `drivers_status` present and claim-safe; identity grounded on **`factor_id`** (stable id), never position/index. Absent companion ⇒ not claim-usable. |
| `robustness` | `robustness_status` **+** `robustness.near_tie` (nested) **+** `stability_thresholds.provisional` | Claim only if `robustness_status` is claim-safe **and** the provisional/near-tie companions are consistent with a non-provisional, non-near-tie reading; identity grounded on **`edge_id`** on `fragile_edges`. **Read note:** `robustness_status` and `stability_thresholds.provisional` are **top-level enrichment siblings**, but `near_tie` is **nested inside the `robustness` object** (`enrichment.robustness.near_tie`) — there is no top-level `near_tie`, so the companion gate must dereference the `robustness` object to read it. A `provisional` threshold or a `near_tie` ⇒ hedged/fail-closed, not a confident claim. |
| `confidence_tier` | **none** | Special case (§7): no companion exists; absence ⇒ unavailable. The companion gate degenerates to "present-and-fresh-and-second-captured", all else fail-closed. |

These companion rules are the **fail-closed grounding rules** that any later coaching-card / run-delta grounding design **must consume** — Brief 5 defines them here rather than spawning a separate grounding policy (see §16 Non-Goals). **(This is the single, authoritative statement of companion-status requirements; there is no separate companion section — earlier drafts duplicated it.)**

---

## 11. Structured-Only / Prompt-Safe Projection Rules

When (later, post-G2) a Tier-2 field is activated, its projection is constrained as follows. Brief 5 defines the rules; it does not emit any projection now (gate closed).

| Rule | Specification |
|------|---------------|
| **Structured, non-prose** | Tier-2 projection is **STRUCTURED only** — discrete fields (id + status + discrete magnitude/label), never free LLM prose. No model-generated sentence may *be* the claim. |
| **Deterministic** | The projection is deterministic from the structured payload (no model rephrasing of the value); reproducible from `factor_id` / `edge_id` / discrete label. |
| **Source-clean** | Derived only from the **kept, stripped** enrichment (post `toSafeTransportEnrichment`), never from a carrier (`_meta` / `downstream_calls` / `isl_response` / `isl_engine`). |
| **Prompt-safe** | The structured projection must not be injectable into a routing/coaching prompt as a claim the model can launder into prose. If a Tier-1 redacted pack (counts / statuses / predicates / hashes only — **no prose / labels / graph content**) is the carrier, Tier-2 magnitudes do not ride inside it without the gate — and, explicitly, the **`confidence_tier` discrete label must NOT ride inside the Tier-1 redacted pack** (it is the most likely Tier-2 value to be laundered into a prompt-derived string; §7). |
| **Grounded** | Every projected element carries its stable id (`factor_id` / `edge_id`) and its companion status; the freshness verdict (`fresh`) is a precondition (§9). |
| **No Tier-3 admixture** | A Tier-2 projection must never co-emit a Tier-3 quantity (no `flip_value`, no `edge_e_value`, no warning text, no report-level confidence, no provenance/lineage claim). Part B asserts this. |

These rules are the **contract that future coaching-card and run-delta grounding designs must consume**. Brief 5 does not author those designs (§16).

---

## 12. Implementation Sequencing

A strict ordering so that the **cage lands before the key is ever cut**. Each step is independently shippable and leaves defaults closed.

| Step | Work | Lands |
|------|------|-------|
| **S0** | Author this brief on a fresh worktree off `origin/staging` (`c35c0fa3`); single file `Docs/v5/brief-5-...md`; docs-only PR (mirror Brief 4 / PR #301). | Doc only |
| **S1** | Add **Part A** producer-scoped static leak-guard `tests/contract/tier3-leak-guard.static.guard.test.ts` (four literal-bearing Tier-3 keys; allow-list seeded from the reviewed transport/routing manifest). Auto-enrols in required gate. **Cannot land green until the `m1_coaching[*].text` precondition (§5b) is resolved.** | Cage (test) |
| **S2** | Add **Part B** runtime no-leak assertion (populated Tier-3 → full compose path **and** independent enrichment-prose path → no user string). Extend `phase3-lifecycle` no-rehydration + missing-not-zero cases (T1–T6). **Blocking precondition:** `$.m1_coaching[*].text` removed from `ALLOWLISTED_LEAF_PATHS` or proven unreachable. | Cage (test) |
| **S3** | Add flag `cee.coachingTier2Enabled` = `booleanString.default(false)` in `src/config/index.ts` (env `CEE_COACHING_TIER2_ENABLED`, mapped in `parseConfig()`); add **empty** `TIER2_COACHING_ALLOWLIST` constant; add a **unit test asserting the parsed default is `false`** (the actual default-off guard — `scripts/validate-config.ts` is ISL-config-only and does not inspect feature-flag defaults). | Two locks (closed) |
| **S4** | Wire the Tier-2 gate (lock 1 ∧ lock 2 ∧ companion ∧ freshness) into the claim-projection seam — **read-only / no-op at ship** because both locks are closed. Add a flag-off byte-identical proof (output unchanged with gate present). | Gate (inert) |
| **G2** | **(Separate later decision, NOT this brief.)** Activate one Tier-2 field: flip flag on **and** add exactly one field to the allow-list, gated on companion-status + freshness + (for `confidence_tier`) a second live capture, with its own tests + review + science-clearance from §9. | Activation |

Steps S1–S4 are the cage. **G2 is out of scope.** Brief 5's success criterion is reached at end of S4 with **zero newly claim-permitted or newly surfaced Tier-2 fields**.

---

## 13. Files Likely To Change (in a later implementation — proposed, not changed here)

| File | Change |
|------|--------|
| `Docs/v5/brief-5-post-approval-claim-safety-enforcement-scaffold.md` | **New** — this brief (the only file this task creates). |
| `tests/contract/tier3-leak-guard.static.guard.test.ts` | **New** — Part A producer-scoped static scan (auto-enrols in required gate). |
| `src/orchestrator-v5/__tests__/tier3-leak-guard.runtime.test.ts` *(or a `tests/contract/` peer)* | **New** — Part B runtime no-leak across compose **and** enrichment-prose paths. |
| `src/orchestrator-v5/__tests__/phase3-lifecycle.test.ts` | Extend — no-rehydration (T3) + missing-not-zero (T4/T5) + null-preserved cases. |
| `src/orchestrator-v5/compose/sanitise-enrichment.ts` | **Remove or narrow `$.m1_coaching[*].text` from `ALLOWLISTED_LEAF_PATHS`** (blocking precondition, §5b) — reconcile the prose-clean allowance with `m1_coaching`'s Tier-3 deny status. |
| `src/config/index.ts` | Add `cee.coachingTier2Enabled: booleanString.default(false)`; env mapping `CEE_COACHING_TIER2_ENABLED` in `parseConfig()`; `TIER2_COACHING_ALLOWLIST` (empty) constant or co-located registry; **unit test** asserting the parsed default is `false`. |
| `src/orchestrator-v5/compose.ts` | Tier-2 claim-projection gate seam (inert at ship; keep-list/deny-list untouched). |
| `eslint.config.js` | *Optional, not required* — a `no-restricted-syntax` AST rule structurally forbidding importing Tier-3 keys into producer files (note as option, not a gate). |
| `src/orchestrator-v5/spine/claim-safety.ts` (PR #293) | *Future* — once merged, become the claim-safety classification source the gate/deny set consume (non-circularity: not a dependency now). |

Existing allow/deny constants to **model on (reuse, don't reinvent):** `REPAIR_VOCABULARY_DENYLIST` (`src/orchestrator/shared/repair-vocabulary-denylist.ts`, `Object.freeze`, append-only); `HARD_BAN_PATTERNS` / `WARNING_PATTERNS` / `INTERNAL_TEMPLATE_TOKENS` (`src/orchestrator/shared/forbidden-tokens.ts`, with the coverage test that every token is reachable); `ALLOWLISTED_LEAF_PATHS` (`sanitise-enrichment.ts`); `INTERNAL_ENRICHMENT_KEYS` (`compose.ts`, `ReadonlySet<string>`).

---

## 14. CI Gate Integration

Enforcement enters the **one required status check** without workflow surgery.

- The required job is **"Lint, TypeCheck, Unit Tests"** in `.github/workflows/ci.yml`. Its steps, in order: `pnpm openapi:generate` → `pnpm lint` (`eslint .`) → `pnpm typecheck:src` (`tsc -p tsconfig.build.json --noEmit`, source-only) → `pnpm config:validate` (`tsx scripts/validate-config.ts`) → `pnpm test:required` (`vitest run --config vitest.required.config.ts`) → **Check for quarantined tests**. The other three jobs — **Full Test Suite**, **Integration Tests**, **Security Audit** — are **advisory** (plus advisory Typecheck-Drift). 
- **Auto-enrolment (by absence-of-exclusion, not by an explicit include).** `vitest.required.config.ts` has **no `include` array**; it relies on Vitest's **default include** and sets only an `exclude` (BASE_EXCLUDE + `REQUIRED_GATE_CATEGORY_EXCLUSIONS=['tests/integration/**']` + named red-exclusion paths). A new `tests/contract/tier3-leak-guard.static.guard.test.ts` matches the default include and is on **no** exclusion list, so it **auto-enrols** in `pnpm test:required`. **Brief 5's guards must NOT be added to the red-exclusion list** (never red-exclude a flaky leak guard — §6).
- **Part B placement.** If the runtime no-leak test lives under `src/orchestrator-v5/__tests__/` it runs in the unit set; if under `tests/contract/` it runs via the default include. Either way it lands in `pnpm test:required` (the required check), not in an advisory-only path.
- **Config default guard (correction).** The default-OFF posture is enforced by the Zod `booleanString.default(false)` in the `ConfigSchema` (`src/config/index.ts`) **plus a unit test asserting the parsed default is `false`** — **not** by `scripts/validate-config.ts`, which validates ISL configuration only (`ISL_BASE_URL`, `ISL_TIMEOUT_MS`, max-retries) and never inspects a feature-flag default. (If a `config:validate` assertion on the flag default is later desired, it is a **proposed new check**, not an existing one.)
- **Optional lint reinforcement.** The eslint boundary-gate (`eslint.config.js`, `no-restricted-syntax` AST selectors, currently scoping `route-v2.ts`) could structurally forbid importing Tier-3 keys into producer files. **Noted as an option, not a requirement** — the two-part test guard is the binding mechanism.

Net effect: a Tier-3 leak (static or runtime) or a default-on regression turns the **required** merge gate red. This is exactly the C6 "FLAG + ALLOW-LIST + TEST + REQUIRED CI GATE" model.

---

## 15. Companion-status cross-reference

Companion-status rules are specified in full in **§10** (and are a hard precondition in the §2 decision flow). There is no separate companion requirement beyond §10 — this pointer exists only to keep the artifact-to-section mapping explicit. In brief: `factor_sensitivity` requires claim-safe `drivers_status` (grounded on `factor_id`); `robustness` requires claim-safe `robustness_status` consistent with non-provisional `stability_thresholds` and non-`near_tie` state, reading `near_tie` from the nested `robustness.near_tie` (grounded on `edge_id`); `confidence_tier` has **no companion** and fails closed on absence (§7).

---

## 16. Risks, Review, Rollback

| Risk | Mitigation |
|------|------------|
| **Accidental Tier-2 activation** | Two independent locks (flag OFF **and** allow-list EMPTY); flag-off byte-identical proof (S4); Zod `booleanString.default(false)` + a unit test guard the default. Activation is a deliberate, separate G2 with its own review + science clearance. |
| **Tier-3 leak through a new producer** | Part A producer-scoped static scan catches any new string-producer file that *names* a literal-bearing Tier-3 key; Part B runtime test catches any that *emits* one (across compose **and** the enrichment-prose path). Both required-gate red on failure. |
| **Tier-3 leak with no literal yet (vocab, report-confidence, evidence, bias, provenance-as-claim)** | Covered today only by no-ratified-field + a **deferred vocabulary block**; **not** yet statically enforced. Tracked as a known coverage limit (§5) and an open item (§9 / §18) until string forms settle. |
| **`m1_coaching` prose leak via the independent path** | Treated as a **blocking precondition**, not an open question: `$.m1_coaching[*].text` removed/narrowed from `ALLOWLISTED_LEAF_PATHS` or proven unreachable; Part B exercises the decision-review-enricher + finaliser-backstop path and asserts the `isl_engine` token does not surface (§5b). |
| **Rehydration from carriers** | `stripInternalKeysDeep` + no-rehydration tests T1–T3 (`JSON.stringify` must not contain populated `edge_id`/`value`/`isl_engine`). |
| **Missing rendered as zero** | T4/T5 (missing-not-zero); `null`/absent never coerced to `0`. |
| **Stale allow-listing / silently-disabled cage** | Second `it` block asserts every allow-list entry still references its key; **never red-exclude a flaky leak guard — harden it** (a red-excluded leak guard is a silently-disabled cage, §6). |
| **Disputed state not actually enforced** | `disputed` is a **forward-declaration** (spine PR #293 unmerged); disputed inputs are caught transitively by `unapproved`/`absent` defaults today (§9). |
| **Spine coupling** | Non-circularity clause: guards depend only on live primitives, never on unmerged PR #293. |

**Review requirements.** Independent review against Brief 4's C1–C7 checklist; explicit scope-guard that **zero newly claim-permitted or newly surfaced Tier-2 fields** result and **no science doctrine is decided** (all unsettled questions — including provenance-as-claim E8 and the `confidence_tier` second-capture/calibration question — routed to §9); confirmation that the new guards auto-enrol in the required gate and are absent from the red-exclusion list; confirmation that the `m1_coaching[*].text` precondition is resolved before S1/S2 land. Match Brief 4's review posture (PR #301: APPROVE on a 10/10 checklist + scope-guard pass).

**Rollback / default-off posture.** Defaults are closed at ship; there is nothing to roll back behaviourally (flag OFF, allow-list empty ⇒ byte-identical output). Should the gate seam itself need backing out, removal of the (inert) gate + flag + allow-list restores the pre-S4 state with no user-visible change. Rollback of an *activation* (post-G2) is `DELETE` the env flag (or empty the allow-list) + redeploy — a single-field revert, not a contract change.

---

## 17. Non-Goals (explicit)

- **NO Tier-2 activation.** No user-visible field surfacing. The cage ships with zero newly claim-permitted or newly surfaced Tier-2 fields; G2 is a separate later decision.
- **NO science doctrine decisions.** Every unsettled scientific question is routed to **Brief 4 §9** (Neil / Jinghui / S1) with a conservative interim default of *not claim-usable* — including the `confidence_tier` second-capture/calibration question (E8). Brief 5 decides none.
- **NO claim about provenance / source-authority / lineage.** Provenance-as-a-user-facing-claim is Tier-3 deny-by-default (Brief 4 §4/§8, E8); Brief 5 caches it in the deny set and adds a vocabulary block once its string form settles. No "this came from ISL science" claim surfaces.
- **NO separate coaching-card / run-delta grounding policy.** Brief 5 does **not** author those designs; instead it **defines the fail-closed grounding rules** (§9, §10, §11) those later designs **must consume**.
- **NO implementation in this task.** This brief proposes files-likely-to-change; it changes none. No code, no flags flipped, no deploy, no push/merge.
- **NO new wire fields, no OpenAPI/Zod/schema change, no UI change, no PLoT/ISL change.** Docs-only, single-file, no-runtime-change PR (mirrors Brief 4 / PR #301).
- **NO dependency on unmerged PR #293.** The spine is cited as preferred future reference only (non-circularity clause, §2); the `disputed` state is a forward-declaration until it merges (§9).

---

## 18. Open Questions

Routed by owner. **All unsettled science → Brief 4 §9** (columns: question · why unsettled · owner · what's blocked · conservative interim default). Brief 5 decides none of the science.

### Data Architecture
- **OQ-DA1.** Should `TIER2_COACHING_ALLOWLIST` ship as a literally empty `Set`/array, or as all-three-listed-but-each-individually-flagged? Both yield zero surfaced fields at ship (the master flag is OFF); the choice affects the granularity of a later G2 toggle. *(Design choice; not science.)*
- **OQ-DA2.** Co-locate the Tier-2 allow-list + tiering registry inside `src/config/index.ts` (Zod `ConfigSchema` is the registry today), or in a dedicated `claim-safety` module anticipating the PR #293 spine `ENRICHMENT_REGISTRY`? Prefer the spine once merged (non-circularity preserved).
- **OQ-DA3.** Where is the single source of truth for "which key is Tier-2 vs Tier-3" — hard-coded key sets now, migrating to the spine's `ClaimSafetyStatus` later? Define the migration path.

### Science (→ Brief 4 §9; owner Neil / Jinghui / S1 — conservative interim default = not claim-usable)
- **OQ-SCI1.** What claim (if any) does a given `confidence_tier` label (`needs_work`, …) permit Olumi to make — **and is a single live capture (n=1) sufficient to characterise the label vocabulary, or is a second capture required (E8 calibration)?** *(Blocks `confidence_tier` G2; the second-capture rule in §7 is Brief 5's conservative interim default pending this answer.)*
- **OQ-SCI2.** Does `robustness` / `fragile_edges` with a `near_tie` or `provisional` threshold warrant any hedged claim, or strictly none? *(Blocks `robustness` G2.)*
- **OQ-SCI3.** What is the ratified vocabulary (if any) for scientific warnings, and is "scientific-warning vocabulary" distinct from the `inference_warnings` array for deny-surface purposes? *(Spine interim: `conservative`; until ratified, Tier-3 deny + add a vocabulary block once string forms exist.)*
- **OQ-SCI4.** Is there ever a ratified report-level confidence field, distinct from `confidence_tier`? *(None today; Tier-3 deny.)*
- **OQ-SCI5.** Evidence-quality and bias (`bias_signals`): is any user claim ever permitted? *(Claims deferred; Tier-3.)*
- **OQ-SCI6.** Causal claims (`flip_thresholds` counterfactual / `edge_e_values` effects): permission boundary? *(Tier-3 deferred.)*
- **OQ-SCI7.** Provenance-as-claim (source / lineage / "this came from ISL science"): what, if anything, may Olumi assert, and what is the ratified string form to add to the vocabulary block? *(Brief 4 E8; Tier-3 deny until ratified — currently not statically scanned because no literal exists.)*

### UI
- **OQ-UI1.** When a Tier-2 field is (later) activated, what structured (non-prose) surface does the canvas render — and does it consume the stable id (`factor_id` / `edge_id`) + companion status as specified in §10/§11? *(Consumer contract for a future G2; no UI change now.)*
- **OQ-UI2.** How should the UI present a *fail-closed* Tier-2 state (gate closed / stale / unconfirmed) without implying a claim was withheld for the wrong reason?

### CEE
- **OQ-CEE1.** *(Resolved into a blocking precondition, no longer an open question.)* `ALLOWLISTED_LEAF_PATHS` `$.m1_coaching[*].text` is reachable via the independent enrichment-prose path (decision-review enricher + finaliser backstop) regardless of the transport keep-list; it must be **removed/narrowed or proven unreachable before S1/S2 land green**, and Part B must exercise that path (§5b). Listed here only as a pointer.
- **OQ-CEE2.** Exact placement of Part B: `src/orchestrator-v5/__tests__/` (unit set) vs `tests/contract/` (contract include) — both land in `pnpm test:required`; pick for locality with `phase3-lifecycle`.
- **OQ-CEE3.** Should the optional eslint `no-restricted-syntax` Tier-3-import rule be promoted from option to required, or left as advisory reinforcement of the two-part test guard?
- **OQ-CEE4.** Does the inert Tier-2 gate seam belong in `compose.ts` (alongside the keep-list) or in a new claim-projection module, to keep the transport axis and the claim-permission axis physically separated per C1?
