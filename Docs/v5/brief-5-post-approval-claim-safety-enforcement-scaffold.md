# Brief 5 — Post-Approval Claim-Safety Enforcement Scaffold

> **Status:** DOC-ONLY design brief. No implementation, no flags flipped, no deploy, no push/merge. This brief *proposes* files-likely-to-change; it does not change them.
> **Revision:** **R2 (2026-06-27) — evidence-driven rewrite.** R1 (PR #304, `6b4f02b5`) framed Tier-2/Tier-3 leakage as a *hypothetical future* risk to be caged before activation. **The 2026-06-26 manual-test capture proves the leak is already LIVE** — Olumi is *today* emitting user-facing reasoning claims (driver-strength and tipping-point) derived from gated/deferred concepts, through a code path the R1 cage does **not** cover. R2 reframes the brief around that evidence, adds **Gate Zero** (coaching-seam fail-closed preconditions) ahead of the leak guard, re-scopes the guard from *token-presence* to *reasoning-claim* coverage, completes the producer manifest, and re-sequences the work. R2 still activates nothing.
> **Authoring home:** current `origin/staging` tip `6b4f02b5` ("docs(v5): Brief 5 — post-approval claim-safety enforcement scaffold (#304)"). Brief 4 (`Docs/v5/brief-4-claim-safety-provenance-contract.md`), the PR #297 keep-list seam (`src/orchestrator-v5/compose.ts`), the diagnostic-only static guard (`tests/contract/context-summary-diagnostic-only.guard.test.ts`), and the PR #297 phase-3 block-lifecycle (`buildLifecycleBlocksFromPrior` in `compose.ts`) all live on staging today and are the live primitives this scaffold extends. **All implementation work this brief specifies must be authored on a fresh worktree off current `origin/staging`** (see §19 Process Requirements).
> **Core principle (unchanged):** Brief 5 is **THE CAGE, NOT THE ACTIVATION.** Its successful end-state is: the live leak closed, the scaffold built, tests specified, defaults closed, and **ZERO newly claim-permitted or newly surfaced Tier-2 fields**. Activating any individual Tier-2 field is a separate later decision (Brief 4 gate **G2**), explicitly out of scope here.
> **Dovetails with:** Brief 4 §0 invariants C1–C7, §1 tiers, §9 science-escalation register (incl. **E8** provenance-as-claim / calibration).

---

## 0. Live Evidence — the leak is not hypothetical (2026-06-26 manual test)

R1 was written before a live capture existed. A manual staging walkthrough on **2026-06-26** produced three corroborating artefacts:

1. **UI debug bundle** `olumi-debug-147eff40-20260626.json` — the CEE→UI response for a `what_would_flip` chip-click turn.
2. **CEE follow-up log** — the explanation-handler turn, recording `phase3.block_lifecycle` = `rebuild_failed`, reason `selected_fact_unavailable`, a freshly-selected fact, `block_count: 0`.
3. **PLoT `/v2/run` log** — showing `edge_e_values` **populated upstream** (ISL → PLoT).

**What the bundle shows the user actually saw.** The user-facing strings made reasoning claims from gated/deferred concepts:

| Surface | Verbatim user-facing string | Claim type | Brief-4 status of the underlying concept |
|---------|-----------------------------|------------|------------------------------------------|
| `assistant_text` | *"Technical Leadership Capacity very strongly strengthens the lead; Annual Hiring Cost moderately weakens the lead."* | **Driver-strength** claim | `top_drivers` / `factor_sensitivity` — **Tier 2 candidate (gate must be OFF)** |
| `assistant_text` | *"Movement on … would shift this result the most."* | **Driver-ranking** claim | `top_drivers` — Tier 2 candidate |
| `assistant_text` | *"Within the tested range, no single factor on its own reached a tipping point that would change which option leads."* | **Tipping-point** claim | `flip_thresholds` — **Tier 3 deferred** |
| `blocks[0].summary` | *"Hire One Tech Lead currently leads by 83 percentage points because Technical Leadership Capacity is the strongest driver."* | **Driver-strength** claim | `top_drivers` — Tier 2 candidate |
| `blocks[0].enrichment` | `confidence_tier: "strong"`, `flip_thresholds:[{flip_value:null,…}]`, `robustness.fragile_edges:[populated]`, `edge_e_values:[]` | raw gated/deferred fields surfaced on the block | Tier 2 / Tier 3 |

The CEE follow-up log additionally confirms the **explanation handler cited `top_drivers`, `robustness_band`, and `fragile_edges`** in building that prose.

**The single most important finding — the R1 cage would NOT have caught this leak.** R1's leak guard checks that no **literal wire-key token** (`flip_thresholds`, `edge_id`, `isl_engine`, …) reaches a user string, and scopes its file walk to enrichment/compose/coaching producers. But the live leak is **semantic, not syntactic** — *"no single factor reached a tipping point"* contains **no literal token** — and it travels a **third data path** (`ContextPackAnalysis → AnalysisProjectionSummary → explanation/what_would_flip handlers → assistant_text`) that R1's manifest omits entirely. R2 closes both gaps: the guard must assert no gated/deferred **reasoning claim** (not merely no token), and the manifest must include the projection/explanation producers (§5b).

Verbatim grounding for every claim in this section is in §0a, §2a, and §12a; all citations were verified against `origin/staging` `6b4f02b5`.

### 0a. The three corroborating facts, grounded

- **Driver-strength prose is deterministic, from `top_drivers`.** `formatSensitivityDirection` (`src/orchestrator-v5/format/sensitivity-phrases.ts:40-55`) maps a numeric sensitivity into exactly the observed phrases (`|v|≥0.95 → "very strongly …"`, `[0.3,0.7) → "moderately …"`); it is invoked by the deterministic explain/what-would-flip composers (`src/orchestrator-v5/tools/handlers/explanation-fallback.ts:140-154,291-305`) and the post-analysis advice gate. The sensitivity values originate from `AnalysisProjectionSummary.top_drivers` (§2a).
- **Tipping-point prose is deterministic, from `flip_thresholds`.** `composeWhatWouldFlipFallback` (`explanation-fallback.ts:330-335`) emits the "no single factor … reached a tipping point" sentence when the flip verdict is `no_practical_flip`, derived from `flip_thresholds[].flip_reason === 'no_effect_within_bounds'` (`compose/flip-proposal.ts:363-368`; flip summary threaded at `turn-executor.ts:4437-4439`). The bundle's `flip_thresholds[0].flip_reason` is exactly `"no_effect_within_bounds"` with `flip_value: null`.
- **Robustness-band prose is deterministic, from `robustness_band`.** `describeRobustnessBand` (`src/orchestrator-v5/format/robustness-honesty.ts:115-130`) maps the band to `"fragile"`/`"stable"`/`"fairly stable"`, used at `explanation-fallback.ts:163-177,374-387`. `fragile_edges` separately reaches prose via the validation-beat path (`tools/handlers/explain-results.ts:85-102,162-186`).
- **No literal token leaks.** The leaked prose contains none of `flip_thresholds`/`isl_engine`/`top_drivers`/`robustness_band`/`fragile_edges` as substrings — confirming a token-presence assertion alone is blind to it.

---

## 1. Executive Summary

Brief 4 ratified the *contract*: two axes (transport-cleanliness vs claim-permission), three tiers, fail-closed everywhere, no rehydration, provenance-as-precondition, and — in **C6** — the binding requirement that each tier be made enforceable by **FLAG + ALLOW-LIST + TEST + REQUIRED CI GATE** (the "Brief 3 model"). Brief 4 stopped at the contract and deliberately added no gates.

**Brief 5 is the implementation-ready translation of C6 for Tier 2, plus the Tier-3 leak cage — now grounded in a demonstrated live leak.** It specifies the scaffold that makes claim-permission *binding rather than advisory*, while activating nothing:

- **Gate Zero (NEW in R2, lands first) — coaching-seam fail-closed preconditions.** Close, narrow, or prove-unreachable `m1_coaching[*].text` through the enrichment-prose path; preserve legitimate cleaned `decision_review` coaching; verify the `stale_coaching_emitted` safety boolean emits an actual value *and* extend equivalent observability to the prose path; reproduce and resolve the live `phase3.block_lifecycle: rebuild_failed` / `selected_fact_unavailable` / `block_count: 0` case so that **a failed coaching rebuild fails closed** (no coaching, or coaching marked unavailable — never stale coaching under a fresh analysis context). **Coaching freshness is kept separate from global analysis freshness.**
- **Part B runtime leak guard — re-scoped from *token* to *claim*.** Feed the manual-test response shape through compose / coaching / **prose / chip / finaliser** paths *including the projection→explanation path that produced the live leak* and the selected-fact-unavailable rebuild-failure path, and assert: (a) no Tier-3 token reaches user strings, **and (b) no gated Tier-2/Tier-3 reasoning claim (driver-strength, tipping-point, robustness-band) is emitted while the cage is closed**, and (c) no stale coaching is emitted under a fresh analysis context when rebuild fails.
- **Part A producer-scoped static guard.** A source-tree scan modelled on the live `context-summary-diagnostic-only.guard.test.ts`, re-scoped to a **completed** `STRING_PRODUCER_FILES` manifest (R1's manifest omitted the explanation/projection producers — §5b). Producer-scoped, never whole-tree, never red-excluded.
- **No-rehydration & missing-not-zero tests.** Empty stays empty, null stays null, absent stays absent, internal carriers never rehydrate top-level fields, missing never becomes zero.
- **Tier-2 candidates** — `factor_sensitivity`, `confidence_tier`, `robustness` / `top_drivers` / `robustness_band` — get their **gate built but left OFF**, behind **two independent locks**: a default-off master flag (`CEE_COACHING_TIER2_ENABLED`) **and** an initially-empty allow-list (`TIER2_COACHING_ALLOWLIST`). Either lock alone yields zero surfaced fields. Turning on a single field is Brief 4 gate G2, not this brief.

**Coverage honesty (read before trusting the cage's breadth).** The *executable* leak guard covers two leak classes: (1) the **four literal-bearing keys** — `flip_thresholds`, `edge_e_values`, `inference_warnings`, `m1_coaching` — via static + runtime token assertions; and (2) the **semantic reasoning claims** — driver-strength, tipping-point, robustness-band — via Part B's claim-level assertions over the projection→explanation prose path. The remaining Tier-3 categories (scientific-warning vocabulary, report-level confidence, evidence quality, bias, provenance-as-claim) have **no ratified field/string token** and remain covered only by absence-of-field + a deferred vocabulary block (§9). This is foregrounded in §4 and §5 so the cage's breadth is not over-trusted.

The scaffold reuses live primitives (the PR #297 `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` keep-list, `INTERNAL_ENRICHMENT_KEYS` deny-list, `stripInternalKeysDeep`, the diagnostic static-guard mechanic, and the `buildLifecycleBlocksFromPrior` lifecycle). New `tests/contract/*.guard.test.ts` files **auto-enrol** in the one required CI status check, "Lint, TypeCheck, Unit Tests".

Brief 5 **decides no science**. Every unsettled scientific question — what `confidence_tier`'s labels (`needs_work`, `strong`, …) permit a claim, whether `robustness`/`near_tie` warrant a hedged claim, the vocabulary of scientific warnings, causal permissions, what a provenance/lineage statement may claim (E8), and whether two live captures suffice to characterise a label vocabulary — is routed to **Brief 4 §9** with a conservative interim default of *not claim-usable*. Fail-closed is the default everywhere: **absent / empty / stale / unknown / degraded / disputed / unapproved / rebuild-failed ⇒ not claim-usable.**

---

## 2. Enforcement Architecture

The scaffold composes live and proposed primitives. The first four exist on staging today; the last three are this brief's net-new proposals.

| # | Primitive | Status | Role in the cage |
|---|-----------|--------|------------------|
| P1 | `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` keep-list + `toSafeTransportEnrichment()` (`compose.ts:295-434`) | **Live** (PR #297) | Transport-cleanliness axis for the **enrichment** flow. Transport-clean ≠ claim-permitted. |
| P2 | `INTERNAL_ENRICHMENT_KEYS` deny-list + `stripInternalKeysDeep()` (`compose.ts:368-400`) | **Live** (PR #297) | Strips carriers (`_meta`, `downstream_calls`, `isl_response`, `isl_engine`, …) at any depth. Foundation of no-rehydration. |
| P3 | Diagnostic-only static guard mechanic (`context-summary-diagnostic-only.guard.test.ts`) | **Live** | The source-tree-scan *mechanic* Part-A re-uses (walker, allow-list, stale-allow-list `it` block). |
| P6 | Phase-3 block lifecycle (`buildLifecycleBlocksFromPrior`, `compose.ts:504-609`) + `V5Phase3BlockLifecycle` telemetry (`telemetry.ts:914`) | **Live** (PR #297) | The coaching-emission state machine Gate Zero hardens (rebuild-failed fail-closed, freshness separation). |
| P4 | `TIER2_COACHING_ALLOWLIST` + `CEE_COACHING_TIER2_ENABLED` | **Proposed** | Claim-permission axis for Tier-2 candidates. Two independent locks, both closed at ship. |
| P5 | Tier-3/Tier-2 leak guard (producer-scoped static scan + runtime token **and reasoning-claim** assertion) | **Proposed** | Claim-permission cage. Blocks tokens **and** semantic claims. |
| **GZ** | **Gate Zero — coaching-seam fail-closed preconditions** | **Proposed (lands first)** | Closes the live prose-path leak: m1_coaching reconciliation, rebuild-failure fail-closed, coaching-vs-analysis freshness separation, safety-boolean observability. |

**Layering (claim-permission decision order, fail-closed at every fork):**

```
GATE ZERO (coaching seam): if coaching rebuild failed / selected-fact unavailable
        → emit NO coaching and assert NO driver/tipping claim in prose. Fail closed.
        │  (coaching freshness is derived/asserted SEPARATELY from analysis freshness)
        ▼
analysis data, by data-flow:
   (1) enrichment  → toSafeTransportEnrichment (P1+P2) → block enrichment/summary
   (2) enrichment-prose → sanitiseEnrichment (ALLOWLISTED_LEAF_PATHS) → decision-review-enricher + finaliser
   (3) ContextPackAnalysis → AnalysisProjectionSummary → explanation/what_would_flip prose   ← LIVE LEAK PATH
        │
        ▼
[Tier-3 deny check]  is key in the Tier-3 leak-block set, OR is the prose a Tier-3 reasoning claim?
        │ yes → BLOCK from every user-facing string (P5 proves it — token AND claim)
        ▼ no
[Tier-2 gate]  CEE_COACHING_TIER2_ENABLED === true ?              ── lock 1 (OFF at ship)
        ▼ yes
        is field ∈ TIER2_COACHING_ALLOWLIST ?                      ── lock 2 (EMPTY at ship)
        ▼ yes
[Companion-status gate] (§10) → [Freshness gate] deriveAnalysisFreshness()==='fresh' (§9)
        ▼ yes
[Structured-only projection]  emit STRUCTURED, prompt-safe, non-prose only (§11)
```

At ship, **Gate Zero fails closed**, **lock 1 is OFF and lock 2 is EMPTY**, and the Tier-3 deny check (now covering semantic claims) sits above the Tier-2 gate and is unconditional.

**Non-circularity clause (S1 spine).** Unchanged from R1: the scaffold's guards depend **only** on the live primitives P1–P3/P6, all merged on staging. They do **not** depend on PR #293's `spine/claim-safety.ts`. Brief 5 cites that spine as the preferred future reference implementation; the cage stands alone without it.

### 2a. The three user-facing data flows (load-bearing — R1 modelled only flows 1 and 2)

The manual-test root-cause analysis establishes that analysis information reaches the user by **three independent flows**, and the live leak travelled the one R1 did not model:

| Flow | Source → producer → user surface | What it carries | Gated today? |
|------|----------------------------------|-----------------|--------------|
| **(1) Enrichment → block** | `fact.result.enrichment` → `toSafeTransportEnrichment` (keep-list, P1/P2) → `buildAnalysisResultBlock` (`compose.ts:449-463`) → `blocks[].enrichment` + `blocks[].summary` | `confidence_tier`, `flip_thresholds`, `edge_e_values`, `inference_warnings`, `robustness`(`fragile_edges`); `m1_coaching` **dropped** from keep-list. `summary` is passed through **raw**. | **Transport-gated only.** No claim-permission gate; `summary` is *not* sanitised. |
| **(2) Enrichment-prose → finaliser** | `enrichment` prose → `sanitiseEnrichment` (`ALLOWLISTED_LEAF_PATHS`, `sanitise-enrichment.ts:158-174`) → decision-review-enricher → response-finaliser backstop (`response-finaliser.ts:201-262`) | `m1_coaching[*].text` (carries `isl_engine`), `factor_sensitivity[*].interpretation`, `robustness[*].caveat`, `robustness_synthesis`; vs. the **cleaned, fresh** `decision_review` artefact (not allow-listed → preserved). | Prose-cleanliness allow-list; `m1_coaching` dropped from transport but path is independent (§5b precondition). |
| **(3) ContextPack → projection → explanation prose** | `prior_facts.run_analysis` → `ContextPackAnalysis` (`context-pack-assembler.ts`) → `AnalysisProjectionSummary` (`projection-summaries.ts:47-99`) → explanation/what_would_flip handlers + chip-generator → `assistant_text` | `top_drivers`, `robustness_band`, `fragile_edges`, sensitivity magnitudes → **deterministic driver/tipping/robustness prose** | **NOT gated.** Bypasses both the enrichment keep-list and the enrichment-prose sanitiser. **This is the live leak conduit.** |

Root cause (verified): `turn-executor.ts:4389-4391` builds `analysisProjection` from the prior-fact context pack; the **SAME-SOURCE GUARANTEE** (`turn-executor.ts:4426-4433`) pairs the projection with its evidence **but applies no tier gating**. The explanation handlers then translate the projection's structured fields into prose via deterministic composers — correct *engineering*, but emitting *claims* from concepts that are Tier-2-gated (gate OFF) or Tier-3-deferred. **Part B and the §5b manifest must cover flow (3); R1 covered only (1) and (2).**

---

## 3. Two-Axis Table (transport-cleanliness × claim-permission)

Using Brief 4 §0 C1 terms. **Transport-cleanliness** = is the field carrier-free, no `[REDACTED]` leak, surviving the keep-list onto the wire? **Claim-permission** = what may Olumi *say* about it, by Tier? The defining subtlety, now demonstrated live: a field (or a concept derived from it) can be **transport-clean / projection-carried yet claim-deferred**, and still surface as a *claim* if no claim-gate exists on its producer.

| Field / concept | Flow | Transport-cleanliness | Claim-permission (Tier) | What Brief 5 builds |
|-----------------|------|------------------------|-------------------------|---------------------|
| `factor_sensitivity` | 1, 2 | Clean — kept | **Tier 2 candidate** | Gate (OFF). Allow-list entry absent at ship. |
| `top_drivers` (driver-strength/-ranking prose) | **3** | n/a — projection field, not enrichment | **Tier 2 candidate** | **Part B claim assertion** (no driver-strength claim while caged). **NEW in R2.** |
| `robustness_band` (robustness prose) | **3** | n/a — projection field | **Tier 2 candidate** | **Part B claim assertion** (no robustness-band claim while caged). **NEW in R2.** |
| `confidence_tier` | 1 | Clean — kept (top-level scalar; observed `"needs_work"` and `"strong"`) | **Tier 2 candidate (special, §7)** | Gate (OFF) + second-capture precondition (now n=2; still not claim-usable). |
| `robustness` / `fragile_edges` | 1, 3 | Clean — kept (`fragile_edges`; `near_tie` nested) | **Tier 2 candidate** | Gate (OFF) + companion-status; **+ Part B claim assertion** for the fragile-edge validation-beat prose (flow 3). |
| `flip_thresholds` | 1, 3 | Clean — kept (`flip_value:null` preserved) | **Tier 3 deferred** (causal counterfactual / heuristic EVPI) | Deny / leak guard (token) **+ Part B tipping-point claim assertion** (flow 3). Literal-bearing → statically scanned. |
| `edge_e_values` | 1 | Clean — kept (empty `[]` at CEE/UI boundary; populated upstream in PLoT — §12a) | **Tier 3 deferred** | Deny / leak guard + **no-rehydration test**. Literal-bearing → statically scanned. |
| `inference_warnings` | 1 | Clean — kept (`[]` in capture) | **Tier 3 deferred** | Deny / leak guard + no-rehydration test. Literal-bearing → statically scanned. |
| `m1_coaching` | 2 | **NOT clean via keep-list** (dropped) **but** reachable via the enrichment-prose path | **Tier 3 deferred** (prose) | Gate Zero blocking precondition (§6a). Literal-bearing → statically scanned. |
| `decision_review` (cleaned coaching) | 2 | Fresh LLM artefact, not allow-listed | **legitimate** | **Preserve** — Gate Zero must not break it. |
| scientific-warning vocabulary | — | distinct from `inference_warnings` | **Tier 3 deferred** | Vocabulary block (deferred); escalate to §9. **Not yet statically scanned.** |
| report-level confidence | — | **No ratified field** (distinct from `confidence_tier`) | **Tier 3 deferred** | Vocabulary block (deferred); escalate to §9. **Not yet statically scanned.** |
| evidence quality | — | **No field exists** | **Tier 3 deferred** | Vocabulary block (deferred); escalate to §9. **Not yet statically scanned.** |
| bias (`bias_signals` exist) | — | partial / unverified | **Tier 3 deferred** | Claims deferred; escalate to §9. **Not yet statically scanned.** |
| **provenance (as a user-facing claim)** | — | source / lineage / "this came from ISL science" | **Tier 3 deferred** (E8) | Deny / leak guard; vocabulary block deferred. **Not yet statically scanned.** |

The keep-list governs the *transport* axis for flow (1); the **projection** (flow 3) has no transport gate at all. Brief 5's gate, deny set, and **Part B claim assertions** govern the *claim-permission* axis across all three flows.

---

## 4. Field-by-Field Gate Table

`drivers_status`, `robustness_status`, `near_tie`, and `stability_thresholds.provisional` are **companions** required for a candidate field to become claim-eligible (§10). Stable ids are used for grounding identity (no positional/index references).

**Coverage column** records how the row is enforced **today**: `static` (executable Part-A token scan), `claim` (Part-B reasoning-claim assertion — NEW in R2), or `deferred-vocab` (no literal/field yet).

| Field / concept | Tier | Companion(s) | Stable id | Claim-permitted at ship? | Gate built | Enforced by | Default posture |
|-----------------|------|--------------|-----------|--------------------------|------------|-------------|-----------------|
| `factor_sensitivity` | 2 | `drivers_status` | `factor_id` | **NO** | YES | gate + claim | Flag OFF **and** not in allow-list |
| `top_drivers` (prose) | 2 | `drivers_status` | `factor_id` | **NO** | YES | **claim (Part B)** | Caged; no driver-strength claim emitted |
| `robustness_band` (prose) | 2 | `robustness_status` | `edge_id` | **NO** | YES | **claim (Part B)** | Caged; no robustness-band claim emitted |
| `confidence_tier` | 2 (special) | none (absence ⇒ unavailable) | discrete label | **NO** | YES | gate | Flag OFF + not in allow-list + **second capture** (now n=2; science unsettled) |
| `robustness` / `fragile_edges` | 2 | `robustness_status` + `near_tie` + `stability_thresholds.provisional` | `edge_id` | **NO** | YES | gate + claim | Flag OFF **and** not in allow-list |
| `flip_thresholds` | 3 | — | — | **NO** (hard-blocked) | DENY | **static + claim** | Leak guard (token) + tipping-point claim assertion |
| `edge_e_values` | 3 | — | — | **NO** (hard-blocked) | DENY | static | Leak guard + no-rehydration (empty at CEE/UI; populated upstream — §12a) |
| `inference_warnings` | 3 | — | — | **NO** (hard-blocked) | DENY | static | Leak guard + no-rehydration |
| `m1_coaching` | 3 | — | — | **NO** (hard-blocked) | DENY | static + **Gate Zero** | Enrichment-prose path; §6a blocking precondition |
| scientific-warning vocabulary | 3 | — | — | **NO** | DENY | deferred-vocab | Vocabulary block deferred; §9 |
| report-level confidence | 3 | — | — | **NO** | DENY | deferred-vocab | §9 |
| evidence quality | 3 | — | — | **NO** | DENY | deferred-vocab | §9 |
| bias (`bias_signals`) | 3 | — | — | **NO** | DENY | deferred-vocab | §9 |
| **provenance (as claim)** | 3 | — | — | **NO** | DENY | deferred-vocab | §9 (E8) |

**Binding statement.** At ship, **every** row's "claim-permitted" column is **NO** — and, unlike R1, this is now an *enforced* NO for the driver-strength, tipping-point, and robustness-band claims that were leaking live, via Part B's claim assertions. **Caveat on breadth:** the five `deferred-vocab` rows rest on *no-ratified-field + deferred vocabulary block*, not on the executable guard.

---

## 5. Two-Part Leak-Guard Design

Part A is **structural** (no *string-producer* file even *names* a Tier-3 key without justification); Part B is **behavioural** (even if a producer touched one, or *derives a claim from one*, it cannot reach a user). Both are required.

**Executable coverage (R2).** Static Part A targets the **four literal-bearing keys** (`flip_thresholds`, `edge_e_values`, `inference_warnings`, `m1_coaching`). Part B targets **both** those tokens **and** the **semantic reasoning claims** (driver-strength, tipping-point, robustness-band) that the live leak proved travel flow (3) token-free. Scientific-warning vocabulary, report-level confidence, evidence quality, bias, and provenance-as-claim remain `deferred-vocab` (no literal). Do not over-trust Part A's breadth on those five.

### 5a. Part A — Static source-tree scan (re-using the `context-summary-diagnostic-only.guard.test.ts` mechanic, re-scoped)

**Why the live mechanic cannot be copied verbatim with a whole-tree key-substring scan.** Unchanged from R1: the Tier-3 wire keys appear as legitimate identifiers in ~26 product `src/` files (e.g. `compose/flip-proposal.ts`, `coaching/decision-review-enricher.ts`, `compose/phase3-blocks.ts`, `deterministic/prompt-builder-v2.ts`, `prompts/defaults.ts`, `tools/registry.ts`, …). A bare whole-tree `text.includes(WIRE_KEY)` would be permanently red or vacuous.

**Part A is therefore re-scoped to the user-facing string-producer files enumerated in §5b** (a manifest R2 *completes*). A new `tests/contract/tier3-leak-guard.static.guard.test.ts`:

- `SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))`; reads files **from disk** (`readdirSync`/`readFileSync`/`statSync`) — does **not** import modules (so it cannot be defeated by runtime gating).
- **Scoped walk** over the explicit **`STRING_PRODUCER_FILES` manifest** (§5b). Excludes `*.d.ts`, `*.test.ts`, editor-sync dupes via `/ \d+\.[cm]?tsx?$/` (exactly the live walker).
- For each Tier-3 literal `WIRE_KEY`: if `text.includes(WIRE_KEY)` and the repo-relative path is **not** in a reviewed `ALLOWLIST: Set<string>`, push to `offenders`.
- **Value is REGRESSION-detection:** no *new* string-producer file may name a Tier-3 key without reviewed allow-listing. Allow-list seeded from a **verified manifest** of current legitimate uses among the producer files (each entry classified producer-vs-transport per the `~/.claude/CLAUDE.md` evidence-for-absence rule).
- Assertion `expect(offenders).toEqual([])`; parallel guards, one per literal key.
- **Manifest-completeness requirement (NEW):** Part A must include a guard asserting `STRING_PRODUCER_FILES` itself is complete — every file under `src/orchestrator-v5` that writes `assistant_text`, `blocks[].{title,body,summary}`, `suggested_actions[].{label,message}`, or `insights[]` is either in the manifest or in an explicit, reviewed `NOT_A_PRODUCER` exclusion set with a reason. This prevents a future prose producer (like the omitted explanation handlers) silently escaping the scan.

### 5b. Part B — Runtime output assertion (token **and** reasoning-claim), across all three flows

A new `src/orchestrator-v5/__tests__/tier3-leak-guard.runtime.test.ts` (or a `tests/contract/` peer; §6/§14) that:

1. Builds the fixture from the **2026-06-26 manual-test response shape** (`olumi-debug-147eff40-20260626.json` → `payloads.cee_response`), with **populated** Tier-3 fields (`flip_thresholds` with real values incl. `flip_value:null`; `edge_e_values`/`inference_warnings`; an `m1_coaching` block carrying an `isl_engine` token) **and** populated copies buried in carriers (`_meta.payloads.isl_response.*`, `downstream_calls.isl[*].response_payload.*`), **plus a populated `AnalysisProjectionSummary`** (`top_drivers`, `robustness_band`, `fragile_edges`, sensitivity magnitudes) to drive flow (3).
2. Feeds it through the **real** producers of all three flows (§2a / the §5b manifest): compose keep-list + `buildAnalysisResultBlock`; the enrichment-prose path (`sanitiseEnrichment` → decision-review-enricher → response-finaliser); **and the projection→explanation path** (`explain-results.ts` / `what-would-flip.ts` / `explanation-fallback.ts` deterministic composers + `chip-generator.ts`), then the egress chokepoint `sanitiseOlumiResponseForEgress`.
3. **Asserts (token):** `JSON.stringify(userFacingProjection)` contains none of the populated `flip_value`, `edge_id`, warning text, or `isl_engine` token.
4. **Asserts (reasoning-claim — NEW in R2):** while the cage is closed (Gate Zero closed, Tier-2 locks OFF/EMPTY), the user-facing strings contain **no driver-strength claim** (the `formatSensitivityDirection` band phrases "slightly/moderately/strongly/very strongly {strengthens|weakens} the lead"), **no tipping-point claim** (the `composeWhatWouldFlipFallback` "reached a tipping point" / "no single factor" family), and **no robustness-band claim** (the `describeRobustnessBand` "fragile"/"stable"/"fairly stable" family). The assertion keys on the **deterministic phrase vocabularies** (single source of truth: `format/influence-bands.ts`, `format/sensitivity-phrases.ts`, `format/robustness-honesty.ts`, the flip-summary verdict strings) so it is precise and maintainable.
5. **Asserts (Gate Zero):** with the lifecycle in `rebuild_failed` / `selected_fact_unavailable` (`block_count:0`), no stale coaching and **no driver/tipping claim** is emitted under a fresh analysis context (§6a).

> **The reasoning-claim assertion (4) must be mechanically testable, not a vague "no claim-bearing sentence" check — derive the forbidden-claim set from the producer functions and prove the captured bundle prose fails the test. See §16a (binding review risk).**

**Blocking precondition — `m1_coaching[*].text` is reachable independent of the transport keep-list (unchanged, still live on staging).** `sanitise-enrichment.ts:158-174` still allow-lists `/^\$\.m1_coaching\[\d+\]\.text$/` (line 168). It operates on the enrichment-prose path consumed by the decision-review enricher + response-finaliser backstop — **not** the `compose.ts` transport keep-list. So `m1_coaching` prose (and its `isl_engine` token) can reach a user-facing string **regardless** of transport-stripping. Therefore **Gate Zero (S-GZ) must resolve this before S1/S2 land green** (§6a), and Part B must exercise that path.

**User-facing string producers the runtime test must exercise (the COMPLETED manifest; R1 omitted the flow-3 producers).** This is also Part A's scoped walk set.

| Path | File(s) | New in R2? |
|------|---------|-----------|
| transport keep-list + analysis_result block (`summary` raw) | `src/orchestrator-v5/compose.ts` (`toSafeTransportEnrichment`, `buildAnalysisResultBlock`) | |
| review / coaching / evidence card text | `src/orchestrator-v5/compose/phase3-blocks.ts` (`buildReviewCardBlocks`, `buildCoachingBlocks`, `buildEvidenceBlocks`, `buildStaleRerunCoachingBlock`) | |
| enrichment-prose path (independent of keep-list) | `src/orchestrator-v5/compose/sanitise-enrichment.ts`; `src/orchestrator-v5/coaching/decision-review-enricher.ts`; `src/orchestrator-v5/response-finaliser.ts` | |
| **projection → explanation prose (LIVE LEAK PATH)** | `src/orchestrator-v5/tools/handlers/explain-results.ts`, `tools/handlers/what-would-flip.ts`, `tools/handlers/explanation-fallback.ts` | **YES** |
| **projection construction** | `src/orchestrator-v5/context/projection-summaries.ts`, `context/context-pack-assembler.ts` | **YES** |
| **deterministic claim-phrase translators** | `src/orchestrator-v5/format/sensitivity-phrases.ts`, `format/robustness-honesty.ts`, `format/influence-bands.ts` | **YES** |
| **enriched advice composer (reclassified from "transport" to producer)** | `src/orchestrator-v5/routing/post-analysis-advice-gate.ts` | **YES** |
| coaching degrade / narrative prose | `src/orchestrator-v5/coaching/coaching-output-postcheck.ts`, `post-draft-narrative.ts` | **YES** |
| egress envelope walk (main chokepoint) | `src/orchestrator-v5/compose/output-safety.ts`; companion `src/orchestrator/shared/output-safety.ts` | |
| chips | `src/orchestrator-v5/compose/chip-finalizer.ts`, `chip-generator.ts`, `chip-safety.ts` | |
| handler-failure responses | `src/orchestrator-v5/compose/handler-failure-responses.ts` | |
| precondition / freshness templates | `src/orchestrator-v5/tools/handlers/no-op-helpers.ts` | |

**Note on `ALLOWLISTED_LEAF_PATHS`.** The enrichment-prose allow-list (`sanitise-enrichment.ts:158-174`) permits `$.factor_sensitivity[*].interpretation`, `$.m1_coaching[*].text`, `$.m1_review[*].text`, `$.robustness[*].caveat`, `$.robustness_synthesis`. These are *prose-cleanliness* allowances on the transport axis — they do **not** grant claim-permission. Part B must assert that an allow-listed leaf path does not result in a claim-bearing user string while the cage is closed. The `m1_coaching[*].text` reconciliation is a **Gate Zero blocking precondition** (§6a), not a deferred question.

---

## 6. Scan Scope, Allow-list Exceptions, and Failure Condition

| Aspect | Specification |
|--------|---------------|
| **Files scanned (Part A)** | The **completed `STRING_PRODUCER_FILES` manifest** (§5b) — compose/coaching/**projection/explanation**/prose/chip/handler-failure/precondition producers — **not** the whole `src/` tree. (Whole-tree scanning is rejected: the literal keys already appear in ~26 legitimate transport/routing files; a whole-tree scan would be permanently red or vacuous.) |
| **Manifest completeness** | A guard asserts every `src/orchestrator-v5` file that writes a user-facing string is in the manifest or an explicit reviewed `NOT_A_PRODUCER` set (closes the R1 gap that let the explanation handlers escape). |
| **Excluded files** | `*.d.ts`, `*.test.ts`, editor-sync dupes (`/ \d+\.[cm]?tsx?$/`). |
| **Keys scanned (static)** | The **four literal-bearing** Tier-3 keys. Vocabulary / report-confidence / evidence-quality / bias / provenance-as-claim are **NOT** scanned yet → escalate to §9. |
| **Claims asserted (runtime)** | Driver-strength, tipping-point, robustness-band phrase families (single source of truth: `format/*`), while the cage is closed. |
| **Permitted allow-list exceptions** | Only **transport/routing** uses (a producer that *names* a key to transport/route it, never to emit a user string), each seeded from the reviewed manifest and classified producer-vs-transport. |
| **What makes CI fail (Part A)** | A new/un-allow-listed Tier-3 literal in a string-producer file → `offenders` non-empty → required check red. **OR** a producer missing from the manifest. |
| **What makes CI fail (Part B)** | Any Tier-3 token **or** any caged Tier-2/Tier-3 reasoning claim surfacing in `assistant_text`/`blocks[].*`/`suggested_actions[].*`/`insights[]` → required check red. |
| **Stale-allowlist guard** | Mirror the live guard's second `it` block: assert every allow-list entry still references the key in its file (no dead allow-listing). |

**Never silently disable the cage.** If a leak guard becomes flaky, **harden it, never red-exclude it**. A red-excluded leak guard is a **silently-disabled cage** — CI stays green while leaks freely. The new guards must **not** be added to the `vitest.required.config.ts` red-exclusion list under any circumstance, flakiness included.

### 6a. Gate Zero — coaching-seam fail-closed preconditions (lands FIRST)

Gate Zero is the R2-net-new step that closes the **live** prose-path leak before any of the R1 cage lands. It has five parts, each grounded in the manual-test trace and the staging code.

**GZ-1 — `m1_coaching[*].text` fail-closed (blocking precondition for S1/S2).** `$.m1_coaching[\d+].text` is still in `ALLOWLISTED_LEAF_PATHS` (`sanitise-enrichment.ts:168`). Remove/narrow it, **or** prove it unreachable to any user-facing string while the Tier-3 deny set is active. **Preserve the legitimate cleaned `decision_review` coaching** — it is a *separate, fresh LLM artefact* attached as a top-level key by the decision-review enricher (`decision-review-enricher.ts:225-243`) and is **not** in `ALLOWLISTED_LEAF_PATHS`, so narrowing the m1_coaching leaf must not touch it. The distinction in code: `decision_review` = fresh, cleaned; `m1_coaching` = raw ISL prose carrying `isl_engine` (asserted absent in transported enrichment at `phase3-lifecycle.test.ts:294,517`).

**GZ-2 — safety-boolean observability.** `stale_coaching_emitted` **does** emit an actual value in the block-lifecycle path: it is computed (`compose.ts:579` `staleBlock !== null`; explicit `false` at the other six emit sites: lines 219, 518, 530, 544, 561, 606) and survives telemetry serialisation (`sanitizeTelemetryValue` keeps booleans incl. `false`, `telemetry.ts:1496`; `sanitizeTelemetryData` keeps non-`undefined`, `telemetry.ts:1558`). **So the verify-outcome for the block path is: logging is sound — do not "fix" it blindly.** The real gap is that **the prose/explanation path (`assistant_text`) has no equivalent lifecycle telemetry** — the driver/tipping claim is emitted unobserved. GZ-2 deliverable: (a) confirm the block-path boolean with a unit assertion; (b) **add an equivalent safety signal on the prose path** — a telemetry boolean recording whether an explanation/what_would_flip turn emitted a driver/tipping/robustness claim under a non-fresh or rebuild-failed coaching context. (A flat `false` is also indistinguishable from "absent" in a flat log; prefer an always-present field over relying on truthiness.)

**GZ-3 — reproduce and resolve the live `rebuild_failed` case.** The captured CEE follow-up log = `phase3.block_lifecycle: rebuild_failed`, `reason: selected_fact_unavailable`, `block_count: 0`. This maps exactly to `buildLifecycleBlocksFromPrior` → `selectPriorRunAnalysisFact` returning `null` (`compose.ts:535-546`), which emits `rebuild_failed`/`selected_fact_unavailable`/`block_count:0`/`stale_coaching_emitted:false` and **returns `[]`**. **Finding: the phase-3 *coaching block* path already fails closed** (no block served). **But the prose path is decoupled** — the explanation/what_would_flip handler still produced `assistant_text` driver/tipping claims on that same turn. So GZ-3's answer to "did that path serve stale coaching or no coaching?" is: **it served no coaching *block*, but it served claim-bearing prose anyway.** GZ-3 deliverable: make the explanation/what_would_flip prose path **honour the same rebuild-failed verdict** — when the selected-fact rebuild fails, the prose must not assert driver/tipping/robustness claims (fail closed), independent of whether the coaching *block* was suppressed.

**GZ-4 — required behaviour: coaching fails closed on rebuild failure.** If selected-fact rebuild fails, coaching (block *and* prose) must **emit nothing claim-bearing, or mark coaching unavailable**. Do **not** serve stale coaching — nor a fresh-context driver/tipping claim — under a failed rebuild.

**GZ-5 — coaching freshness ≠ analysis freshness.** Today `buildLifecycleBlocksFromPrior` takes a single `FreshnessDerivation` and uses `freshness.freshness` to decide both *whether* and *what kind* of coaching (`compose.ts:504-609`); there is **no secondary coaching-content freshness check**, and `deriveAnalysisFreshness` (`context/freshness.ts:380-438`) is hash-based. A fresh *analysis* may legitimately stay fresh, but a coaching artefact that **failed to rebuild** must not inherit that freshness. GZ-5 deliverable: keep the global analysis-freshness verdict separate from a coaching-availability/coaching-freshness verdict, so "analysis fresh" can never launder a failed-rebuild coaching artefact into "coaching fresh."

---

## 7. confidence_tier Special Case

`confidence_tier` is a Tier-2 candidate most likely to be mistaken for a Tier-3 claim, so it carries extra binding constraints. In the captured fixtures it is a **populated top-level scalar**: the first staging fixture showed `"needs_work"`; the **2026-06-26 capture showed `"strong"`**.

| Constraint | Rule |
|------------|------|
| **No companion status** | No companion field exists. **Absence ⇒ unavailable ⇒ not claim-usable** (fail-closed). The gate treats missing/empty as a hard stop. |
| **Discrete label only** | Surface (later, post-G2) only as the discrete label (e.g. `needs_work`, `strong`). |
| **Never numeric / probabilistic** | Never a number, percentage, probability, "evidence-quality" measure, or **report-level confidence** statement. Conflating it with report-level confidence (Tier-3, no ratified field) is a contract violation Part B must guard. |
| **Must not ride the Tier-1 redacted pack** | The discrete label must NOT be carried inside the Tier-1 redacted coaching pack (counts/statuses/predicates/hashes only — no prose/labels/graph content). §11 "Prompt-safe" makes this explicit. |
| **Second live capture — now satisfied in COUNT, not in science** | R1 required a second independent live capture before any G2 activation. **That count condition is now met: n=2 observed labels (`needs_work`, `strong`).** **This is evidence of the label vocabulary, NOT permission to activate.** What each label *permits Olumi to claim* remains an unsettled science/calibration question (§9, E8). Until §9 rules, even with flag-on + allow-list-listed, `confidence_tier` stays **not claim-usable**. (Whether n=2 suffices to characterise the vocabulary is itself part of the §9 question; R2 does not settle it.) |
| **Science routed** | What a given label permits → Brief 4 §9 (E8) (owner Neil / Jinghui / S1). Brief 5 decides none; conservative interim default = not claim-usable. |

---

## 8. No-Rehydration & Missing-Not-Zero Test Plan

Extends the four live PR #297 cases in `src/orchestrator-v5/__tests__/phase3-lifecycle.test.ts`, hardened for the cage and the live evidence. C4 (no rehydration) and the missing-not-zero discipline are the load-bearing invariants.

| Test | Setup | Assertion |
|------|-------|-----------|
| **T1 — Absence preserved** | Tier-3 fields absent from the source enrichment. | `('edge_e_values' in enr) === false`, same for `inference_warnings`/`confidence_tier`/`flip_thresholds`. Never fabricated. |
| **T2 — Empty-as-empty** | Top-level `edge_e_values: []`, `inference_warnings: []` (honest empty; **matches the live capture**). | Preserved **as `[]`** — not dropped to absent, not fabricated to populated. Honest empty survives. |
| **T3 — No rehydration (carrier populated)** | Top-level `edge_e_values: []`, populated copy only inside `_meta.payloads.isl_response.*` **and** `downstream_calls.isl[*].response_payload.*` (and `isl_engine` carrier for `m1_coaching`). **This is the verified live PLoT-populated / CEE-empty shape (§12a).** | After `stripInternalKeysDeep`, top-level stays `[]`; `JSON.stringify(enr)` contains no populated `edge_id`/`value`; the `isl_engine` token does not survive. Carriers are **never** the source of a top-level repopulation (C4). |
| **T4 — Null preserved (missing-not-zero)** | `flip_thresholds` with `flip_value: null` (**matches the live `flip_reason: "no_effect_within_bounds"` capture**). | Survives as honest `null`, **never coerced to 0**. |
| **T5 — Missing-not-zero, claim layer** | A Tier-2 candidate (`factor_sensitivity` / `robustness`) with a missing magnitude or absent companion status. | The claim layer treats it as *unavailable* (fail-closed), not a zero-magnitude / "no effect" claim. No invented `0` in a user string. |
| **T6 — Runtime no-leak, all three flows (Part B)** | Populated Tier-3 + projection fields fed through compose / coaching / enrichment-prose **and the projection→explanation prose path** (§5b). | No Tier-3 token in any user-facing string; **no driver-strength / tipping-point / robustness-band claim** while caged; the `m1_coaching` `isl_engine` token does not surface. |
| **T7 — Coaching fail-closed on rebuild failure (Gate Zero)** | Lifecycle forced to `rebuild_failed` / `selected_fact_unavailable` (`block_count:0`) **under a fresh analysis context**. | No stale coaching; **no driver/tipping/robustness claim** emitted via the prose path; coaching marked unavailable, not fresh. |

**Missing-not-zero binding statement.** Empty stays empty; null stays null; absent stays absent. The system **never** substitutes `0` (or any fabricated magnitude) for a missing/empty/null/unconfirmed value — neither on the wire (`stripInternalKeysDeep` / keep-list) nor in any claim projection. `null ≠ 0`; `[] ≠ populated`; absent ≠ "no effect".

---

## 9. Fail-Closed State Semantics

Fail-closed is the default at **every** decision fork (Brief 4 C3). A field/concept is claim-usable **only** when *all* of the following hold; if **any** is true, it is **not claim-usable** and degrades to a conservative, honest, non-claiming projection.

| State | Source | Verdict |
|-------|--------|---------|
| **absent** | field omitted from enrichment/projection | not claim-usable |
| **empty** | `[]` / `{}` / empty scalar | not claim-usable |
| **stale** | `deriveAnalysisFreshness() === 'stale'` | not claim-usable (rerun-guidance only) |
| **unknown** | freshness `unknown` / `unconfirmed` | not claim-usable (treat conservatively) |
| **degraded** | analysis degraded; precondition verdict `degraded` | not claim-usable |
| **rebuild-failed (NEW)** | coaching `block_lifecycle` = `rebuild_failed` (`selected_fact_unavailable` / `source_graph_hash_missing`) | **not claim-usable — coaching fails closed (Gate Zero, §6a); the prose path must honour this too** |
| **disputed** | spine `DisputeSignal` (`SAFETY_ORDER` moves toward *less* safe) | not claim-usable — **forward-declared, not active at baseline** |
| **unapproved** | flag OFF **or** field not in allow-list **or** Tier-3 | not claim-usable |

**Coaching-freshness-separation (binding, NEW).** A *fresh* global analysis verdict does **not** make a coaching artefact fresh. Coaching availability is its own verdict: a `rebuild_failed` coaching artefact is **not** claim-usable even under `deriveAnalysisFreshness() === 'fresh'` (§6a GZ-5).

**Freshness requirement (binding).** A Tier-2 claim may be made **only** when `deriveAnalysisFreshness()` returns `'fresh'` **and** coaching availability is not rebuild-failed/stale. Prose, chips, and context all derive from the single canonical `deriveAnalysisFreshness`; the precondition verdicts `missing | degraded | stale | unconfirmed | execute` in `no-op-helpers.ts` are the conservative templates a closed gate falls through to. The rerun **chip** fires only on *definite* stale.

**Note on `disputed` (forward-declaration, not an enforced gate at baseline).** Unchanged from R1: the only source is the unmerged S1 spine `DisputeSignal` (PR #293); at ship no mechanism sets `disputed`, so this arm is a forward-declaration caught transitively today by `unapproved`/`absent`.

**Telemetry.** Degrade events emit `v5.coaching.output_postcheck` (`stale_presented_as_fresh`, `invented_mutation_success`, `confident_advice_under_unsafe_state`); the block lifecycle emits `v5.phase3.block_lifecycle`. GZ-2 adds an equivalent observable on the prose path.

---

## 10. Companion-Status Requirements

A candidate Tier-2 field is **claim-eligible only when its companion status confirms it is safe**; absent / unsafe / unknown companion ⇒ fail-closed.

| Candidate | Companion(s) | Rule |
|-----------|--------------|------|
| `factor_sensitivity` / `top_drivers` | `drivers_status` | Claim only if `drivers_status` present and claim-safe; identity grounded on **`factor_id`** (stable id), never position/index. Absent companion ⇒ not claim-usable. |
| `robustness` / `robustness_band` / `fragile_edges` | `robustness_status` **+** `robustness.near_tie` (nested) **+** `stability_thresholds.provisional` | Claim only if `robustness_status` is claim-safe **and** the provisional/near-tie companions are consistent with a non-provisional, non-near-tie reading; identity grounded on **`edge_id`** on `fragile_edges`. **Read note:** `robustness_status` and `stability_thresholds.provisional` are top-level enrichment siblings, but `near_tie` is **nested inside the `robustness` object** (`enrichment.robustness.near_tie`) — the companion gate must dereference `robustness` to read it. A `provisional` threshold or a `near_tie` ⇒ hedged/fail-closed, not a confident claim. |
| `confidence_tier` | **none** | Special case (§7): no companion exists; absence ⇒ unavailable. The gate degenerates to "present-and-fresh-and-second-captured", all else fail-closed. |

These companion rules are the **fail-closed grounding rules** that any later coaching-card / run-delta grounding design **must consume** — Brief 5 defines them here rather than spawning a separate grounding policy (§17 Non-Goals). **(Single, authoritative statement of companion-status requirements; there is no separate companion section.)**

---

## 11. Structured-Only / Prompt-Safe Projection Rules

When (later, post-G2) a Tier-2 field is activated, its projection is constrained as follows. Brief 5 defines the rules; it does not emit any projection now (gate closed). **The live leak is the direct illustration of why these rules matter: the deterministic explanation composers turned a structured projection into a prose *claim* with no claim-gate in between.**

| Rule | Specification |
|------|---------------|
| **Structured, non-prose** | Tier-2 projection is **STRUCTURED only** — discrete fields (id + status + discrete magnitude/label), never free or templated prose that *is* the claim. The `formatSensitivityDirection` / `describeRobustnessBand` prose composers are exactly what this rule forbids while the gate is closed. |
| **Deterministic** | Deterministic from the structured payload (no model rephrasing of the value); reproducible from `factor_id` / `edge_id` / discrete label. |
| **Source-clean** | Derived only from the **kept, stripped** enrichment (or a gated projection), never from a carrier (`_meta` / `downstream_calls` / `isl_response` / `isl_engine`). |
| **Prompt-safe** | The structured projection must not be injectable into a routing/coaching prompt as a claim the model can launder into prose. The `confidence_tier` discrete label must NOT ride inside the Tier-1 redacted pack (§7). |
| **Grounded** | Every projected element carries its stable id (`factor_id` / `edge_id`) and its companion status; the freshness verdict (`fresh`) is a precondition (§9). |
| **No Tier-3 admixture** | A Tier-2 projection must never co-emit a Tier-3 quantity (no `flip_value`, no `edge_e_value`, no warning text, no report-level confidence, no provenance/lineage claim). Part B asserts this. |

These rules are the **contract that future coaching-card and run-delta grounding designs must consume**. Brief 5 does not author those designs (§17).

---

## 12. Implementation Sequencing

A strict ordering so the **cage lands before the key is ever cut** — and, in R2, so the **live leak is closed before anything else**. Each step is independently shippable and leaves defaults closed. **R2 re-sequences R1: Gate Zero first, then Part B (runtime), then Part A (static), then no-rehydration tests, then the Tier-2 locks.** (Runtime before static because the live leak is behavioural and travels a token-free path; proving it closed at runtime is the priority.)

| Step | Work | Lands |
|------|------|-------|
| **S0** | This brief (R2) on a fresh worktree off current `origin/staging`; single file `Docs/v5/brief-5-...md`; docs-only PR (mirror Brief 4 / PR #301). | Doc only |
| **S-GZ — Gate Zero** | Coaching-seam fail-closed preconditions (§6a): GZ-1 m1_coaching reconciliation (preserve `decision_review`); GZ-2 safety-boolean observability (verify block path + add prose-path signal); GZ-3 reproduce `rebuild_failed`/`selected_fact_unavailable` and make the prose path honour it; GZ-4 coaching fails closed on rebuild failure; GZ-5 separate coaching freshness from analysis freshness. **Blocking precondition for S1/S2.** | Live leak closed |
| **S1 — Part B (runtime)** | `tier3-leak-guard.runtime.test.ts`: manual-test fixture; exercise compose / coaching / enrichment-prose / **projection→explanation** / chip / finaliser; assert no Tier-3 token **and** no caged driver/tipping/robustness claim **and** no stale coaching under fresh-context rebuild failure (T6, T7). | Cage (test) |
| **S2 — Part A (static)** | `tier3-leak-guard.static.guard.test.ts`: producer-scoped scan over the **completed** `STRING_PRODUCER_FILES` manifest (four literal keys; allow-list seeded from the reviewed manifest) + a manifest-completeness guard. Auto-enrols in required gate. | Cage (test) |
| **S3 — No-rehydration & missing-not-zero** | Extend `phase3-lifecycle.test.ts` with T1–T5/T7: empty stays empty, null stays null, absent stays absent, carriers never rehydrate, missing never becomes zero. | Cage (test) |
| **S4 — Default-off Tier-2 locks** | Add `cee.coachingTier2Enabled = booleanString.default(false)` (env `CEE_COACHING_TIER2_ENABLED`, mapped in `parseConfig()`) — the `booleanString.default(false)` pattern is already used at `config/index.ts:271`; add **empty** `TIER2_COACHING_ALLOWLIST`; add a **unit test asserting the parsed default is `false`**. | Two locks (closed) |
| **S5 — Inert Tier-2 gate seam** | Wire the gate (lock 1 ∧ lock 2 ∧ companion ∧ freshness ∧ coaching-availability) into the claim-projection seam — **read-only / no-op at ship** (both locks closed). Add a flag-off byte-identical proof (output unchanged with gate present). | Gate (inert) |
| **G2** | **(Separate later decision, NOT this brief.)** Activate one Tier-2 field: flip flag on **and** add exactly one field to the allow-list, gated on companion-status + freshness + (for `confidence_tier`) the science-clearance of its label vocabulary, with its own tests + independent review + science-clearance from §9. | Activation |

Steps S-GZ–S5 are the cage. **G2 is out of scope.** Brief 5's success criterion: the live leak closed and **zero newly claim-permitted or newly surfaced Tier-2 fields** at end of S5.

### 12a. Corrections forced by the 2026-06-26 manual-test analysis

Three claims an over-eager reading of the capture could make are **wrong**; the brief adopts the corrected positions.

- **Do NOT claim `edge_e_values` is populated end-to-end.** The PLoT `/v2/run` log shows it **populated upstream** (`plot-lite-service/src/routes/v2/run.ts:1985` always emits `edge_e_values: edgeEValues ?? []`, enriched by `transformEdgeEValues`; `isl-to-ui.contract.ts:94`). But the CEE/UI **top-level enrichment is empty** (`blocks[0].enrichment.edge_e_values: []` in the bundle; `isl_diagnostic.isl_raw_fields.edge_e_values: null`). CEE keeps it in the transport keep-list (`compose.ts:328`) yet it arrives empty, and `stripInternalKeysDeep` (`compose.ts:368-400`) prevents any carrier from rehydrating it. **Conclusion: keep `edge_e_values` Tier-3 and caged; the right test is no-rehydration (T3), not an end-to-end-population claim.**
- **Do NOT attribute the ~13s follow-up latency solely to a missing `action_type`.** Deterministic chip dispatch fires only when `ingress.source === 'chip_click'` **and** the action_type is in `DETERMINISTIC_CHIP_ACTION_TYPES` = {`run_analysis`, `explain_results`, `what_would_flip`} (`route-v2.ts:1185-1190`; `chip-click-dispatch.ts:151-155`). The captured `what_would_flip` click **had** a whitelisted `action_type` yet carried `source: "chip"` (UI telemetry) and still fell through to `TurnExecutor → routeWithToolUse`, paying routing-LLM cost. **So `action_type` presence alone is insufficient — deterministic chip dispatch is gated on `source` (and the narrow whitelist) too; treat it as a broader deterministic-dispatch gap.** *(Performance, not a claim-safety deliverable — noted because it intersects: when the explanation turn routes through the LLM, the driver/tipping prose can also be LLM-generated, widening the leak surface Part B must cover.)*
- **`confidence_tier: "strong"` is evidence of label vocabulary, not permission to activate it.** It is the second observed label (with `"needs_work"`), satisfying §7's *count* condition but not licensing activation. The claim semantics of each label remain unsettled science (§9, E8); `confidence_tier` stays not-claim-usable.

---

## 13. Files Likely To Change (in a later implementation — proposed, not changed here)

| File | Change | Step |
|------|--------|------|
| `Docs/v5/brief-5-post-approval-claim-safety-enforcement-scaffold.md` | This brief (R2). | S0 |
| `src/orchestrator-v5/compose/sanitise-enrichment.ts` | **GZ-1:** remove/narrow `$.m1_coaching[*].text` from `ALLOWLISTED_LEAF_PATHS` (or prove unreachable); must not affect `decision_review`. | S-GZ |
| `src/orchestrator-v5/compose.ts` / `tools/handlers/explain-results.ts` / `what-would-flip.ts` / `explanation-fallback.ts` | **GZ-3/GZ-4:** make the projection→explanation prose path honour the `rebuild_failed`/`selected_fact_unavailable` verdict and fail closed (no driver/tipping/robustness claim). | S-GZ |
| `src/orchestrator-v5/compose.ts` (lifecycle) / `context/freshness.ts` | **GZ-5:** separate coaching-availability/coaching-freshness from `deriveAnalysisFreshness`. | S-GZ |
| `src/utils/telemetry.ts` + emit sites | **GZ-2:** confirm block-path boolean; add a prose-path safety signal (driver/tipping claim under non-fresh/rebuild-failed context). | S-GZ |
| `src/orchestrator-v5/__tests__/tier3-leak-guard.runtime.test.ts` *(or `tests/contract/` peer)* | **New** — Part B runtime token **and** reasoning-claim assertion across all three flows + Gate-Zero fail-closed (T6/T7). | S1 |
| `tests/contract/tier3-leak-guard.static.guard.test.ts` | **New** — Part A producer-scoped scan over the completed manifest + manifest-completeness guard (auto-enrols in required gate). | S2 |
| `src/orchestrator-v5/__tests__/phase3-lifecycle.test.ts` | Extend — no-rehydration (T3) + missing-not-zero (T4/T5) + null-preserved + T7. | S3 |
| `src/config/index.ts` | Add `cee.coachingTier2Enabled: booleanString.default(false)`; env mapping `CEE_COACHING_TIER2_ENABLED` in `parseConfig()`; empty `TIER2_COACHING_ALLOWLIST` constant; **unit test** asserting parsed default is `false`. | S4 |
| `src/orchestrator-v5/compose.ts` (or a new claim-projection module) | Tier-2 claim-projection gate seam (inert at ship; keep-list/deny-list untouched). | S5 |
| `eslint.config.js` | *Optional, not required* — a `no-restricted-syntax` AST rule forbidding importing Tier-3 keys into producer files. Noted as option, not a gate. | — |
| `src/orchestrator-v5/spine/claim-safety.ts` (PR #293) | *Future* — once merged, become the claim-safety classification source the gate/deny set consume (non-circularity: not a dependency now). | — |

Existing allow/deny constants to **model on (reuse, don't reinvent):** `REPAIR_VOCABULARY_DENYLIST` (`src/orchestrator/shared/repair-vocabulary-denylist.ts`, `Object.freeze`, append-only); `HARD_BAN_PATTERNS` / `WARNING_PATTERNS` / `INTERNAL_TEMPLATE_TOKENS` (`src/orchestrator/shared/forbidden-tokens.ts`, with the coverage test that every token is reachable); `ALLOWLISTED_LEAF_PATHS` (`sanitise-enrichment.ts`); `INTERNAL_ENRICHMENT_KEYS` (`compose.ts`, `ReadonlySet<string>`); and the deterministic phrase vocabularies (`format/influence-bands.ts`, `format/sensitivity-phrases.ts`, `format/robustness-honesty.ts`) as the single source of truth for the claim-phrase assertions.

---

## 14. CI Gate Integration

Enforcement enters the **one required status check** without workflow surgery.

- The required job is **"Lint, TypeCheck, Unit Tests"** in `.github/workflows/ci.yml`. Its steps, in order: `pnpm openapi:generate` → `pnpm lint` (`eslint .`) → `pnpm typecheck:src` (`tsc -p tsconfig.build.json --noEmit`, source-only) → `pnpm config:validate` (`tsx scripts/validate-config.ts`) → `pnpm test:required` (`vitest run --config vitest.required.config.ts`) → **Check for quarantined tests**. The other three jobs — **Full Test Suite**, **Integration Tests**, **Security Audit** — are advisory (plus advisory Typecheck-Drift).
- **Auto-enrolment (by absence-of-exclusion).** `vitest.required.config.ts` has **no `include` array**; it relies on Vitest's default include and sets only an `exclude` (BASE_EXCLUDE + `REQUIRED_GATE_CATEGORY_EXCLUSIONS=['tests/integration/**']` + named red-exclusion paths). A new `tests/contract/tier3-leak-guard.static.guard.test.ts` matches the default include and is on **no** exclusion list, so it **auto-enrols** in `pnpm test:required`. **Brief 5's guards must NOT be added to the red-exclusion list** (§6).
- **Part B placement.** If under `src/orchestrator-v5/__tests__/` it runs in the unit set; if under `tests/contract/` it runs via the default include. Either way it lands in `pnpm test:required` (the required check). Pick for locality with `phase3-lifecycle`.
- **Config default guard.** The default-OFF posture is enforced by the Zod `booleanString.default(false)` in `ConfigSchema` (`config/index.ts`) **plus a unit test asserting the parsed default is `false`** — **not** by `scripts/validate-config.ts` (ISL-config-only: `ISL_BASE_URL`, `ISL_TIMEOUT_MS`, max-retries; never inspects a feature-flag default).
- **Optional lint reinforcement.** The eslint boundary-gate (`eslint.config.js`, `no-restricted-syntax` AST selectors) could structurally forbid importing Tier-3 keys into producer files. **Noted as an option, not a requirement.**

Net effect: a Tier-3 token leak, a **caged reasoning-claim leak**, a manifest gap, a Gate-Zero regression, or a default-on regression turns the **required** merge gate red — exactly the C6 "FLAG + ALLOW-LIST + TEST + REQUIRED CI GATE" model.

---

## 15. Companion-status cross-reference

Companion-status rules are specified in full in **§10** (and are a hard precondition in the §2 decision flow). There is no separate companion requirement beyond §10 — this pointer keeps the artifact-to-section mapping explicit. In brief: `factor_sensitivity`/`top_drivers` require claim-safe `drivers_status` (grounded on `factor_id`); `robustness`/`robustness_band`/`fragile_edges` require claim-safe `robustness_status` consistent with non-provisional `stability_thresholds` and non-`near_tie` state, reading `near_tie` from nested `robustness.near_tie` (grounded on `edge_id`); `confidence_tier` has **no companion** and fails closed on absence (§7).

---

## 16. Risks, Review, Rollback

| Risk | Mitigation |
|------|------------|
| **Live leak persists (driver/tipping/robustness claims)** | **Realized, not hypothetical.** Gate Zero (§6a) closes the prose path; Part B asserts no caged reasoning claim across all three flows (T6); manifest completed (§5b). |
| **Cage misses the projection→explanation path** | The R1 gap. Closed by the completed `STRING_PRODUCER_FILES` manifest + a manifest-completeness guard + Part B's claim-level assertions over flow (3). |
| **Token-only guard blind to semantic claims** | Part B now asserts on the deterministic claim-phrase vocabularies (`format/*`), not just literal tokens. |
| **Stale coaching / claim under failed rebuild** | Gate Zero GZ-3/GZ-4 + T7: rebuild-failed fails closed for block **and** prose; coaching freshness separated from analysis freshness (GZ-5). |
| **`m1_coaching` prose leak via the independent path** | Blocking precondition GZ-1: `$.m1_coaching[*].text` removed/narrowed/proven-unreachable; `decision_review` preserved; Part B exercises the enricher + finaliser path and asserts `isl_engine` absent. |
| **Accidental Tier-2 activation** | Two independent locks (flag OFF **and** allow-list EMPTY); flag-off byte-identical proof (S5); `booleanString.default(false)` + unit test. G2 is a separate deliberate decision with its own review + science clearance. |
| **Rehydration from carriers** | `stripInternalKeysDeep` + T1–T3 (`JSON.stringify` must not contain populated `edge_id`/`value`/`isl_engine`). |
| **Missing rendered as zero** | T4/T5 (missing-not-zero); `null`/absent never coerced to `0`. |
| **`edge_e_values` over-claimed end-to-end** | §12a: empty at CEE/UI despite upstream population; Tier-3 caged; no-rehydration test. |
| **Latency mis-diagnosed as action_type-only** | §12a: deterministic dispatch gated on `source==='chip_click'` + whitelist; broader gap (not a Brief-5 deliverable). |
| **Stale allow-listing / silently-disabled cage** | Second `it` block asserts every allow-list entry still references its key; **never red-exclude a flaky leak guard — harden it** (§6). |
| **Disputed state not enforced** | Forward-declaration (spine PR #293 unmerged); caught transitively by `unapproved`/`absent` (§9). |
| **Spine coupling** | Non-circularity clause: guards depend only on live primitives, never on unmerged PR #293. |

**Review requirements.** **Independent non-author review is a required gate before merge** (§19). Review against Brief 4's C1–C7 checklist; explicit scope-guard that **zero newly claim-permitted or newly surfaced Tier-2 fields** result and **no science doctrine is decided** (all unsettled questions — including provenance-as-claim E8 and the `confidence_tier` label-vocabulary/calibration question — routed to §9); confirmation that the live leak is closed (Gate Zero) and that Part B fails on a reintroduced driver/tipping claim; confirmation the new guards auto-enrol in the required gate and are absent from the red-exclusion list; confirmation the `m1_coaching[*].text` precondition is resolved and `decision_review` preserved. Match Brief 4's review posture (PR #301: APPROVE on a 10/10 checklist + scope-guard pass).

**Rollback / default-off posture.** Defaults are closed at ship (flag OFF, allow-list empty ⇒ byte-identical Tier-2 output). Gate Zero changes are *behavioural* (they suppress an existing leak) and are validated by T6/T7 rather than rolled back. Should the gate seam itself need backing out, removal of the (inert) gate + flag + allow-list restores the pre-S5 state with no user-visible change. Rollback of an *activation* (post-G2) is `DELETE` the env flag (or empty the allow-list) + redeploy — a single-field revert.

### 16a. Review Risk — Semantic Part B Must Be Mechanically Testable

**The risk.** R2's most important addition — asserting that no gated/deferred *reasoning claim* (driver-strength, tipping-point, robustness-band) reaches a user string — is also its most fragile. A naive implementation that asserts something like *"no claim-bearing sentence appears in `assistant_text`"* is **not a test**: there is no mechanical oracle for "claim-bearing", it cannot be evaluated deterministically, it will silently pass on a reworded leak, and it will rot the moment the prose changes. **A reviewer must reject any Part B whose semantic assertions are not mechanically derivable, deterministic, and anchored to the producing code.** The cage's credibility rests entirely on this being a real, failing-then-passing test, not a vibe.

**Required mechanism — gate/enumerate the producers, do not pattern-match free prose.** The claim vocabulary is **deterministic and finite** because every leaking claim is emitted by an enumerable set of pure producer functions over their own single-source-of-truth vocabularies. Part B must derive its forbidden-claim matcher **from those producers**, so the matcher cannot drift from what actually leaks. The producers to enumerate (each verified as a live claim source for the 2026-06-26 capture):

| Claim family | Producer function / path | Single-source-of-truth vocabulary |
|--------------|--------------------------|-----------------------------------|
| driver-strength ("very strongly strengthens the lead") | `formatSensitivityDirection` (`format/sensitivity-phrases.ts:40-55`) | the 4 band adverbs (`slightly/moderately/strongly/very strongly`) × 2 directions (`strengthens/weakens the lead`) + the `NEAR_ZERO` phrase, bands from `format/influence-bands.ts` |
| robustness-band ("fragile" / "stable") | `describeRobustnessBand` (`format/robustness-honesty.ts:115-130`) | the finite band-word set |
| tipping-point ("no single factor … reached a tipping point") | `composeWhatWouldFlipFallback` / flip verdict (`tools/handlers/explanation-fallback.ts:330-335`, `compose/flip-proposal.ts:363-368`) | the flip-summary verdict strings (`no_practical_flip` → its sentence template) |
| explanation prose assembly | `composeExplainResultsFallback` / `composeWhatWouldFlipFallback` (`explanation-fallback.ts`), and the enriched composer in `routing/post-analysis-advice-gate.ts` | composed from the above |
| projection source (the ungated inputs) | `AnalysisProjectionSummary` (`context/projection-summaries.ts:47-99`) ← `ContextPackAnalysis` (`context/context-pack-assembler.ts`) | `top_drivers`, `robustness_band`, `fragile_edges`, sensitivity magnitudes |
| chip / finaliser surfaces | `compose/chip-generator.ts`, `chip-finalizer.ts`; egress `compose/output-safety.ts` | chip `label`/`message`; final `assistant_text`/`blocks[]` |

The forbidden-claim set should be **generated programmatically** from these functions (e.g. iterate `formatSensitivityDirection` over its band/direction domain; enumerate `describeRobustnessBand`'s outputs; read the flip-verdict templates) rather than hand-copied as string literals — so adding a band word or rewording a template updates the matcher automatically and a producer change that escapes the matcher is itself a test failure.

**Required demonstration — the captured leak must fail the test.** R2 binds Part B to a concrete falsifiable obligation, in two complementary forms:

1. **Golden-prose regression (proves the matcher recognises the real leak).** Feed the **verbatim captured strings** — `assistant_text` *"Technical Leadership Capacity very strongly strengthens the lead; Annual Hiring Cost moderately weakens the lead."* and *"Within the tested range, no single factor on its own reached a tipping point …"*, and `blocks[0].summary` *"… because Technical Leadership Capacity is the strongest driver."* (`olumi-debug-147eff40-20260626.json` → `payloads.cee_response`) — into the forbidden-claim matcher. The matcher **must flag all three** (red). A matcher that passes the captured prose is, by construction, broken.
2. **Producer-driven end-to-end (proves the guard tracks the producers, not a frozen snapshot).** Feed the **captured `AnalysisProjectionSummary` + enrichment** through the *real* producers of flow (3) (`explain-results.ts` / `what-would-flip.ts` / `explanation-fallback.ts`, plus chip/finaliser/egress) with the cage configured as it was at capture time. The assertion **must be RED today** (the producers re-emit the leak) and must turn **GREEN only once Gate Zero (§6a) closes the path** (rebuild-failed / caged ⇒ no driver/tipping/robustness claim). This makes Gate Zero's success the literal pass condition, and any regression that re-opens flow (3) an automatic required-gate failure.

**Reviewer checklist for Part B.** (a) The forbidden-claim set is derived from the producer functions, not hand-written sentences. (b) The captured bundle prose is checked in as a fixture and the matcher flags it. (c) The producer-driven test is RED before Gate Zero and GREEN after. (d) The assertion is deterministic (no model call, no fuzzy match that can silently pass). (e) The guard is not red-excluded (§6).

---

## 17. Non-Goals (explicit)

- **NO Tier-2 activation.** No user-visible field surfacing. The cage ships with zero newly claim-permitted or newly surfaced Tier-2 fields; G2 is a separate later decision.
- **NO science doctrine decisions.** Every unsettled scientific question is routed to **Brief 4 §9** with a conservative interim default of *not claim-usable* — including the `confidence_tier` label-vocabulary/calibration question (E8). Brief 5 decides none.
- **NO claim about provenance / source-authority / lineage.** Provenance-as-a-user-facing-claim is Tier-3 deny-by-default (Brief 4 §4/§8, E8); Brief 5 caches it in the deny set and adds a vocabulary block once its string form settles.
- **NO separate coaching-card / run-delta grounding policy.** Brief 5 defines the fail-closed grounding rules (§9, §10, §11) those later designs must consume.
- **NO chip-dispatch performance refactor.** The §12a latency observation is *noted*, not fixed here (it informs Part B's coverage of LLM-routed explanation prose).
- **NO implementation in this task.** This brief proposes files-likely-to-change; it changes none. No code, no flags flipped, no deploy, no push/merge.
- **NO new wire fields, no OpenAPI/Zod/schema change, no UI change, no PLoT/ISL change** beyond the CEE-internal Gate-Zero/cage work. Docs-only PR for this brief.
- **NO dependency on unmerged PR #293.** The spine is cited as preferred future reference only (non-circularity clause, §2).

---

## 18. Open Questions

Routed by owner. **All unsettled science → Brief 4 §9** (columns: question · why unsettled · owner · what's blocked · conservative interim default). Brief 5 decides none of the science.

### Data Architecture
- **OQ-DA1.** Should `TIER2_COACHING_ALLOWLIST` ship as a literally empty `Set`/array, or all-three-listed-but-each-individually-flagged? Both yield zero surfaced fields at ship (the master flag is OFF). *(Design choice; not science.)*
- **OQ-DA2.** Co-locate the Tier-2 allow-list + tiering registry inside `config/index.ts` (Zod `ConfigSchema`), or a dedicated `claim-safety` module anticipating the PR #293 spine `ENRICHMENT_REGISTRY`? Prefer the spine once merged.
- **OQ-DA3.** Single source of truth for "Tier-2 vs Tier-3" — hard-coded key sets now, migrating to the spine's `ClaimSafetyStatus` later? Define the migration path.
- **OQ-DA4 (NEW).** Where should the claim-permission gate sit for **flow (3)** — at `AnalysisProjectionSummary` construction (`projection-summaries.ts`), at the explanation composers, or both? The projection currently carries `top_drivers`/`robustness_band` ungated; a single chokepoint is preferable to per-composer guards. *(Design; the gate seam, not science.)*

### CEE
- **OQ-CEE1.** *(Resolved into Gate Zero S-GZ.)* `ALLOWLISTED_LEAF_PATHS` `$.m1_coaching[*].text` is reachable via the independent enrichment-prose path; removed/narrowed or proven unreachable before S1/S2 land green, and Part B must exercise that path (§6a GZ-1).
- **OQ-CEE2.** Should the prose-path safety signal (GZ-2) be a new `v5.phase3.*` event or an extension of `v5.coaching.output_postcheck`?
- **OQ-CEE3.** Deterministic chip dispatch keys on `source === 'chip_click'`; the UI sent `source: "chip"`. Is this a UI/CEE contract mismatch to fix separately, and does fixing it change the explanation-prose code path Part B must cover? *(Performance + coverage; not science.)*
- **OQ-CEE4.** Part B placement — `__tests__/` (unit set) vs `tests/contract/` — both land in `pnpm test:required`; pick for locality with `phase3-lifecycle`.

### Science (→ Brief 4 §9; owner Neil / Jinghui / S1 — conservative interim default = not claim-usable)
- **OQ-SCI1.** What claim (if any) does a given `confidence_tier` label (`needs_work`, `strong`, …) permit Olumi to make — **and do two captures (n=2) suffice to characterise the label vocabulary, or is more required (E8 calibration)?** *(Blocks `confidence_tier` G2; the second-capture count in §7 is now met, but the science is not.)*
- **OQ-SCI2.** Does `robustness` / `robustness_band` / `fragile_edges` with a `near_tie` or `provisional` threshold warrant any hedged claim, or strictly none? *(Blocks `robustness` G2 — the live leak emitted "fragile"/driver claims with no such clearance.)*
- **OQ-SCI3.** Ratified vocabulary (if any) for scientific warnings, and is it distinct from the `inference_warnings` array for deny-surface purposes? *(Tier-3 deny + vocabulary block once string forms exist.)*
- **OQ-SCI4.** Is there ever a ratified report-level confidence field, distinct from `confidence_tier`? *(None today; Tier-3 deny.)*
- **OQ-SCI5.** Evidence-quality and bias (`bias_signals`): is any user claim ever permitted? *(Claims deferred; Tier-3.)*
- **OQ-SCI6.** Causal claims (`flip_thresholds` counterfactual / `edge_e_values` effects): permission boundary — and specifically, what (if anything) may a **tipping-point** statement assert, given the live "no single factor reached a tipping point" leak? *(Tier-3 deferred.)*
- **OQ-SCI7.** Provenance-as-claim (source / lineage / "this came from ISL science"): what may Olumi assert, and what ratified string form joins the vocabulary block? *(Brief 4 E8; Tier-3 deny until ratified.)*

### UI
- **OQ-UI1.** When a Tier-2 field is (later) activated, what structured (non-prose) surface does the canvas render — consuming the stable id (`factor_id` / `edge_id`) + companion status as specified in §10/§11? *(Consumer contract for a future G2.)*
- **OQ-UI2.** How should the UI present a *fail-closed* / coaching-unavailable state (gate closed / stale / rebuild-failed) without implying a claim was wrongly withheld?

---

## 19. Process Requirements for the Implementer (hard requirements)

These are binding on the engineer who implements S-GZ–S5. They are **not** executed by this docs-only brief; they constrain the implementation work.

1. **Fresh worktree from current `origin/staging`.** Author all code on a clean worktree off the current `origin/staging` tip (not a stale `main`-based tree, not a diverged feature worktree). Verify readiness in that fresh worktree.
2. **Proper local tooling installed before code work.** Run `bash scripts/install-hooks.sh` and `pnpm install` (per `Docs/CLAUDE.md`) before touching code, so the pre-push hook and the required gate run locally.
3. **No `--no-verify` for code changes.** The pre-push hook (branch guard, `tsc -p tsconfig.build.json --noEmit`, lint, smoke tests, stale-`.js`, dep-audit) must run. Do not bypass it for any code change.
4. **Stop and report on any hook failure.** If a pre-commit/pre-push hook fails, stop and report the failure with output — do not work around it.
5. **Independent non-author review gate before merge.** A reviewer who is not the author must approve against the §16 review checklist before the change merges to `staging`. (Match Brief 4's PR #301 posture: APPROVE on a 10/10 checklist + scope-guard pass.)
6. **Tier-2 activation is out of scope.** No flag flipped, no allow-list populated, no field surfaced. Success = the live leak closed and zero newly claim-permitted/surfaced Tier-2 fields.
7. **Push to `staging` only, never `main`** without explicit confirmation; the push is the integration gate (staging branch protection is currently absent across the repos).
