# Brief 4 — Claim-safety & Provenance Contract for Coaching / Data Consumption

**Type:** Data Architecture contract (definition only — no implementation).
**Status:** Draft for approval.
**Baseline:** `origin/staging@c8c64a24` (PR #297 enrichment keep-list, live on cee-staging).
**Seam arbiter:** `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json` — **n = 1**; every
field-presence statement here is true of that single captured payload only and must be re-confirmed
as the seam evolves.
**Owner:** Data Architecture. **Science doctrine owner:** Neil / Jinghui / S1 (via the escalation
register, §9).

> **Scope boundary (binding).** This document defines policy and names the enforcement that *should
> follow after approval*. It makes **no** source, schema, config, flag, generated-file or deploy
> change, and it does **not** implement any gate. The implementation gates in §10 are a forward
> list, not work performed here.

---

## Why this exists

V5 has confirmed the **Coaching Context Pack is Tier 1 only** for current activation. Widening
coaching, UI and analysis copy to richer fields — confidence, evidence quality, provenance, bias,
scientific warnings — is **locked until Data Architecture defines a claim-safety / provenance
contract**. This document is that gating artefact. Without it, coaching cannot safely consume any
field beyond the small Tier 1 set.

The contract answers, for a field of **known source, status and provenance**: *what may Olumi say,
what must it caveat, what must it not say, and how is that enforced?* It deliberately does **not**
re-litigate whether the underlying science is valid; unsettled science is routed to the escalation
register (§9), never decided inline.

---

## §0 — Concise contract (the binding invariants)

**The two axes (read this first).** Every field carries two *independent* statuses:

1. **Transport-cleanliness** — is the field carried to the client free of internal carriers
   (`_meta`, `downstream_calls`, `isl_response`, `isl_engine`), free of `[REDACTED]` leakage, and
   present in the transport keep-list? This is a *plumbing* property, settled at the CEE compose
   seam.
2. **Claim-permission** — what, if anything, may Olumi *say* on the basis of the field? This is a
   *doctrine* property, settled by this contract (and, for science, by escalation).

These axes are **orthogonal**. A field can be fully transport-clean yet claim-deferred. The
canonical example is `flip_thresholds`: it is in the keep-list and populated in the fixture
(transport-clean), but its causal/counterfactual claim is **Tier 3 deferred** (claim-locked).
Transport readiness is **never** evidence of claim permission, and a field being claim-approved
**never** relaxes the transport rules.

**Seven invariants:**

- **C1 — Two axes, kept separate.** Transport-cleanliness and claim-permission are evaluated and
  enforced independently (per above).
- **C2 — Tiering governs claim-permission.** Tier 1 = safe now; Tier 2 = *candidate*, usable only
  after approval + allow-listing + default-off flag + tests + Tier-3 leak guard; Tier 3 = deferred,
  default-off, until contract-approved (and, for science, ratified by Neil/Jinghui).
- **C3 — Fail-closed everywhere.** Absent / empty / `unknown` / `stale` / `none` / a non-success
  companion status ⇒ the field is **not** claim-usable. Such states are never inferred as `0`, low
  confidence, low robustness, or negative evidence.
- **C4 — No rehydration.** Empty top-level fields must never be repopulated from internal carriers.
  Empty on the wire stays empty.
- **C5 — Provenance is a precondition for any approved claim.** Source owner, producer path,
  companion status, stable IDs (where the claim binds to graph entities), and `freshness = fresh`
  must all hold before a field may be used.
- **C6 — Enforcement is binding, not advisory.** Each tier is made binding by **flag/default
  posture + allow-list / deny-list + test + required CI gate** (the Brief 3 model). The doctrine is
  vehicle-agnostic; the S1 spine classifier is a **preferred reference implementation once reviewed
  and merged**, not ratified baseline code.
- **C7 — Unsettled science escalates; it is not guessed.** Vocabulary, scoring and claim-strength
  questions go to the escalation register (§9). Conservative interim defaults hold until ruled.

**Non-circularity (C6 corollary, binding).** This contract and PR #293 / the S1 spine classifier
**must not ratify each other’s provisional scientific defaults.** The spine’s registry is marked
*“DRAFT pending Neil/Jinghui ratification”*; this contract likewise leaves every scientific
claim-strength **provisional/deferred**. Ratification of a scientific default comes **only** from
the science owners via §9 — never from the mere existence of the spine, and never from this
document citing the spine. The spine is cited as an enforcement *vehicle*, not as a doctrinal
*source of truth*.

### Shared absence / degradation semantics

Referenced by every field’s claim permissions in §5. (Distinguishing **absent**, **empty**,
**unavailable/degraded**, and **missing numeric** is the operational core of C3.)

| State | Meaning | Olumi behaviour |
|---|---|---|
| **Absent** (key missing) | Not emitted at this seam | Never a claim; never inferred as zero / negative |
| **Empty** (`[]` / `null` present) | No items emitted *at top level* (a populated copy may exist only inside a stripped internal carrier) | Not “none exist”; **no rehydration** (C4); never a clean bill of health |
| **Unavailable / degraded / error** (companion status non-success, or freshness `stale` / `unknown` / `none`) | Field not confirmed computed | Omit, or caveat (“I can’t confirm…”); never assert |
| **Missing numeric** | No value present | Must **not** become `0`, low confidence, low robustness, or inferred negative evidence |

---

## §1 — Tier definitions (Deliverable 1)

- **Tier 1 — safe now.** Stable, deterministic, source-clean fields safe for immediate Coaching
  Context Pack use. Freshness/staleness and the redacted coaching-state counts/statuses.
- **Tier 2 — candidate, conditionally usable.** Deterministic, source-clean, **prompt-safe**,
  **structured (non-prose)** fields, usable **only after** explicit approval **and** all activation
  conditions in §3 are met. Until then they are **not active**.
- **Tier 3 — deferred by default.** Evidence quality, report-level confidence, provenance-as-claim,
  bias, scientific warnings, and causal claims. **Default-off**; tests must assert they cannot
  surface; activation requires contract approval and (for science) Neil/Jinghui ratification.

---

## §2 — Approved Tier 1 list (Output 2)

| Field | Claim-class | Why Tier 1 |
|---|---|---|
| **Freshness / staleness** | computed (deterministic) | `deriveAnalysisFreshness` verdict + reason (`fresh\|stale\|unknown\|none`; plus the Tier-0 handler verdict `unconfirmed`). Derived from graph-hash comparison; fail-closed; invariant `none ⟺ no successful fact`. |
| **Redacted coaching-state pack** | computed | Counts / statuses / predicates / hashes only (no prose, no labels, no graph content). Currently diagnostic-only behind a double flag; Tier-1 ratification keeps the **redaction discipline** as the contract floor. |

These two are the **only** fields approved for immediate use. Everything else is Tier 2 candidate
(§3) or Tier 3 deferred (§4).

---

## §3 — Candidate Tier 2 list, with conditions (Output 3)

> **NOT ACTIVE.** The three fields below are **candidates only**. They confer **no** claim
> permission until *every* activation condition holds. Until then they are treated exactly as Tier 3
> for surfacing purposes (default-off, may not surface).

**Candidate fields:** `factor_sensitivity`, `confidence_tier`, `robustness`.

**Activation conditions — all required (the Brief 3 pattern):**

1. **Allow-list.** An explicit `TIER2_COACHING_ALLOWLIST` entry exists for the field.
2. **Source-clean / prompt-safe.** Structured projection only (no prose), carrier-stripped, no
   `[REDACTED]` leakage.
3. **Companion-status fail-closed.** `drivers_status` (for `factor_sensitivity`); `robustness_status`
   + `near_tie` + `stability_thresholds.provisional` (for `robustness`); for `confidence_tier`,
   which has no companion, **absence ⇒ unavailable**.
4. **Freshness gate.** `freshness = fresh` (never surface from a `stale` / `unknown` / `none`
   analysis).
5. **Stable IDs.** Present where the claim binds to graph entities (`factor_id`, `edge_id`).
6. **Flag + tests + gate.** Default-off flag (proposed `CEE_COACHING_TIER2_ENABLED`) + activation
   tests + a **green Tier-3 leak guard** + the required CI gate.
7. **Caveated wording.** Model-derived, not empirical — e.g. “based on the current model…”.

If any condition fails, the field is **omitted** (fail-closed) — never surfaced with a weaker
caveat.

---

## §4 — Deferred Tier 3 list (Output 4)

**Default-off. Tests must assert these cannot surface (§7, §10-G3).**

`flip_thresholds` (causal counterfactual) · `edge_e_values` (causal; empty in fixture) ·
`inference_warnings` (scientific warnings; empty in fixture) · **report-level confidence** ·
**evidence quality** · **provenance (as a user-facing claim)** · **bias** · **scientific-warning
vocabulary** · `m1_coaching` (model prose; carries `isl_engine`; **not** in the keep-list — pending
`isl_engine` redaction/redelivery policy).

---

## §5 — Claim permissions, per field / category (Deliverable 2)

Each row gives all six dimensions: **may say · may say only with caveat · must not say · absence ·
unavailable/degraded/error · claim-class** (observed | computed | heuristic | inferred |
model-generated | unavailable). `provenance` is authored as its own row (provenance-*as-claim*),
kept distinct from provenance-*as-precondition* (§6); `scientific warnings` is a row distinct from
`inference_warnings`.

### Tier 1

**Freshness / staleness** — *claim-class: computed.*
- **May:** state whether the last analysis matches the current model (`fresh`), or that it may be
  out of date (`stale`).
- **Caveat:** on `unknown` / `unconfirmed`, “I can’t confirm the last analysis still matches the
  current model.”
- **Must not:** claim the analysis is *wrong*; assert freshness when `unknown`; treat `stale` as a
  result value.
- **Absence (`none`):** “No analysis has been run yet” — never “the analysis is empty/zero.”
- **Unavailable/degraded:** surface the degraded status; do not claim success.

**Redacted coaching-state pack** — *claim-class: computed.*
- **May:** drive internal coaching logic from counts/statuses/predicates/hashes.
- **Caveat:** n/a (no user-facing assertion of the raw values).
- **Must not:** surface raw counts as claims; surface any prose/label/graph content (there is none
  in the pack by construction).
- **Absence:** treat as “not observed at this surface,” `null`, never `0`/`false`.
- **Unavailable/degraded:** omit.

### Tier 2 candidates (permissions apply **only after** §3 activation)

**`factor_sensitivity`** — *claim-class: computed.*
- **May (post-approval):** present the structured driver ranking / relative sensitivity as
  model-derived.
- **Caveat:** “in the current model, X looks most sensitive.”
- **Must not:** assert causal magnitude or real-world certainty; collapse to a single “the dominant
  factor is X” claim (`dominant_factor` is deliberately absent — use the structured ranking, never a
  bare dominance assertion).
- **Absence / `drivers_status` not computed:** unavailable, fail-closed.
- **Unavailable/degraded:** omit.

**`confidence_tier`** — *claim-class: computed (discrete enum).* **(Special-attention field.)**
- **May (post-approval):** surface the **discrete tier label** as a model self-assessment — e.g.
  “the model rates this analysis’s confidence as *needs work*.”
- **Caveat:** model self-assessment of the current analysis, not a guarantee.
- **Must not:** convert to a number/percentage; assert a **calibrated probability**; treat it as
  **evidence quality**; treat it as **report-level confidence**. It is a coarse discrete label and
  nothing more.
- **Absence:** unavailable — **not** “low confidence.”
- **Unavailable/degraded:** omit.

**`robustness`** — *claim-class: computed.*
- **May (post-approval):** present the structured stability level and fragile edges.
- **Caveat:** “robust / not robust *under the model’s perturbations*.”
- **Must not:** assert real-world or empirical robustness.
- **Disputes (`near_tie` / `robustness_status` not computed / `stability_thresholds.provisional`):**
  fail-closed downgrade.
- **Absence:** unavailable — not “robust.”

### Tier 3 (deferred — must not surface)

**`flip_thresholds`** — *claim-class: heuristic / inferred counterfactual.*
- **May:** nothing as a causal claim, by default.
- **Caveat (only if ever approved, structured-only):** a tipping-point value as “the model’s
  estimate.”
- **Must not:** “change X to Y and the decision flips,” as real-world causation.
- **Absence:** not “no tipping point.” → §9 (heuristic-vs-true EVPI).

**`edge_e_values`** — *claim-class: unavailable (causal if populated).* Empty in fixture.
- **Must not:** surface anything; **no rehydration** from carriers.
- **Empty:** “not emitted at top level” — **not** “no causal effects,” not zero. Producer = upstream
  PLoT / Track-S.

**`inference_warnings`** — *claim-class: model / heuristic warnings.* Empty in fixture.
- **Must not:** present absence as a clean bill of health. When populated, a warning naming a field
  **disputes** that field (fail-closed downgrade).
- **Empty:** warnings not emitted — not “all clear.” → §9 (warning vocabulary). *(Spine note: the
  S1 registry classifies this as category `calibration`, default `conservative` — not the strictest
  tier; its Tier-3 **product** deferral here is independent of that.)*

**report-level confidence** — *claim-class: unavailable (no ratified field).*
- **Must not:** assert an overall numeric/percentage confidence. **Absence:** never inferred as
  low/high. → §9. (Distinct from `confidence_tier`’s discrete label.)

**evidence quality** — *claim-class: unavailable (no field exists).*
- **Must not:** score or assert evidence quality. **Absence:** never inferred. → §9
  (evidence-quality scoring).

**provenance (as a user-facing claim)** — *claim-class: inferred / metadata.*
- **May:** only the approved structured marker (“model-derived”) for an *activated* field.
- **Must not:** assert source authority or empirical lineage to the user beyond that marker.
- **Absence:** never inferred. **Unavailable:** omit. Distinct from provenance-as-precondition
  (§6). → §9 (confidence/provenance language).

**bias** — *claim-class: model-generated.*
- **Must not:** assert bias presence or absence (`bias_signals` exist in `draft_coaching`, but bias
  *claims* are deferred). **Absence:** not “unbiased.” → §9 (bias claims).

**scientific warnings (vocabulary)** — *claim-class: model / heuristic.*
- **Must not:** surface any sample-depth / heuristic-vs-true-EVPI / below-resolution / false-precision
  warning wording until the vocabulary is ratified. **Absence:** not a clean bill of health. → §9.

**`m1_coaching`** — *claim-class: model-generated prose.*
- **Must not:** surface directly (carries `isl_engine`; stripped; **not** in the keep-list). Cleaned
  coaching ships via `decision_review`. Pending `isl_engine` redaction/redelivery policy.

---

## §6 — Provenance requirements, per approved field (Deliverable 3)

All eight columns are populated for every Tier-1 and candidate-Tier-2 row (none dropped). Tier-3
rows note owner/producer; the rest is “to be defined on approval.” **Provenance here is the
*precondition* metadata of C5 — distinct from the provenance-as-claim row in §5.**

| Field | Source owner | Producer path | CEE transport path | Consumer | Required provenance metadata | Freshness req. | Stable IDs? | Warnings/statuses mandatory? |
|---|---|---|---|---|---|---|---|---|
| **freshness/staleness** | CEE | `deriveAnalysisFreshness` over handler facts + graph hash | canonical-analysis-state → Tier-0 precondition (product) / `_context_summary` (diagnostic) | coaching precondition + chips | `graph_hash_at_run`, `current_graph_hash`, `computed_at`, `reason` | derived per-turn (live) | graph hash | **Yes** (verdict + reason) |
| **factor_sensitivity** | ISL / Track-S | ISL → `enrichment.factor_sensitivity` | keep-list pass-through (carrier-stripped) | coaching pack + Analysis tab | `provenance='isl'`, `drivers_status` | **fresh-only** | `factor_id` **required** | **Yes** (`drivers_status`, fail-closed) |
| **confidence_tier** | ISL / Track-S | ISL → `enrichment.confidence_tier` | keep-list pass-through | coaching pack | enum domain (e.g. `needs_work`) | **fresh-only** | n/a | absence ⇒ unavailable (no companion) |
| **robustness** | ISL / Track-S | ISL → `enrichment.robustness` (+ `fragile_edges`) | keep-list pass-through | coaching pack + Analysis tab | `robustness_status`, `near_tie`, `stability_thresholds.provisional` | **fresh-only** | `edge_id` **required** | **Yes** (status + near_tie + provisional) |
| **Tier-3 fields** | Track-S / PLoT / Science (emission); CEE transport-only | upstream emission | keep-list where present; **no rehydration** | — (deferred) | to be defined on approval | to be defined | to be defined | to be defined |

---

## §7 — Enforcement mechanism per tier (Deliverable 4)

Stated as **binding requirements** (vehicle-agnostic), each citing the live reference an
implementation should reuse, and naming the S1 spine as the **preferred** Tier-2/3 registry **once
merged** (never as ratified baseline). Each tier carries a concrete mechanism — not policy language.

| | **Tier 1** | **Tier 2 (candidate)** | **Tier 3 (deferred)** |
|---|---|---|---|
| **Allow/deny-list location** | Transport keep-list `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` + `stripInternalKeysDeep` / `INTERNAL_ENRICHMENT_KEYS` deny-set (`src/orchestrator-v5/compose.ts`); redaction discipline of `build-context-summary.ts` | New `TIER2_COACHING_ALLOWLIST` (the three candidate fields) | Deny by default — no allow-list entry |
| **Flag / default posture** | None for freshness (deterministic); coaching-state pack stays behind `contextSummaryEnabled` + `coachingStatePackEnabled` (both default-off) until separate Tier-1 product activation | New `CEE_COACHING_TIER2_ENABLED`, **default-off** | **Default-off**; no flag flips it on without the leak guard green |
| **Test that proves unsafe fields cannot surface** | `tests/contract/context-summary-diagnostic-only.guard.test.ts` (static `src/`-tree leak guard) + freshness fail-closed unit tests | Activation tests + a **Tier-3 leak guard** modelled on the diagnostic-only guard | **Tier-3 leak guard** (no Tier-3 field/category on any prose/chip/coaching path) + empty-not-populated (`edge_e_values === []`, no-rehydration — already proven in PR #297 compose tests) + missing-not-zero |
| **CI / required gate** | `test:required` (“Lint, TypeCheck, Unit Tests”) | `test:required` | `test:required` |
| **Failure mode if unapproved field present** | Guard test red → blocks merge | Unapproved/disputed field ⇒ **omit** (fail-closed), never caveat-through | Unapproved Tier-3 field on a product path = **contract violation → hard-block** |
| **UI/coaching posture** | Redact / omit (never raw content) | Degrade / caveat, or omit | **Hard-block / omit** |

*Source-clean / prompt-safe pre-checks for Tier 2* should reuse the spine’s read-side reference —
`narrowScientificEnrichment` (structured-only projection) and `classifyEnrichment` (fail-closed
dispute signals) — **once that code is reviewed and merged**.

---

## §8 — Approval table (Deliverable 5)

> **Tier-2 “Allowed claim” entries are conditional on §3 activation** (allow-list + default-off flag
> + tests + Tier-3 leak guard). Until then they confer no permission.

| Field / category | Tier | Source owner | Current status | Allowed consumers | Allowed claim | Required caveat | Blocked usage | Enforcement mechanism | Open dependency |
|---|---|---|---|---|---|---|---|---|---|
| **freshness / staleness** | 1 | CEE | Live | coaching precondition, chips | Whether last analysis matches current model | “can’t confirm” on `unknown` | Claiming analysis is wrong; asserting on `unknown` | Freshness derivation + fail-closed; `test:required` | — |
| **`factor_sensitivity`** | 2 (candidate) | ISL / Track-S | Transport-clean (keep-list); populated (n=1) | coaching, Analysis tab (post-approval) | Structured driver ranking, model-derived | “in the current model…” | Causal magnitude; single “dominant factor” claim | `TIER2_COACHING_ALLOWLIST` + `drivers_status` fail-closed + flag + tests + gate | §3 activation |
| **`confidence_tier`** | 2 (candidate) | ISL / Track-S | Transport-clean; populated `needs_work` (n=1) | coaching (post-approval) | Discrete tier label as model self-assessment | model self-assessment, current analysis | Numeric/probability; evidence quality; report-level confidence | allow-list + absence⇒unavailable + flag + tests + gate | §3 activation |
| **`flip_thresholds`** | 3 | ISL / Science | Transport-clean; populated (n=1) | none | none (causal) by default | (heavy caveat only if ever approved) | Real-world causal “flip” claims | Deny-by-default + Tier-3 leak guard | §9 (heuristic-vs-true EVPI) |
| **`edge_e_values`** | 3 | PLoT / Track-S | Transport-clean; **empty** top-level (n=1) | none | none | — | Surfacing; **rehydration**; “no effects”/zero | Deny + empty-not-populated + no-rehydration tests | upstream emission; §9 |
| **`inference_warnings`** | 3 | ISL / Science | Transport-clean; **empty** top-level (n=1) | none | none | — | “all clear” from absence | Deny + Tier-3 leak guard; warning disputes field when populated | §9 (warning vocabulary) |
| **`robustness`** | 2 (candidate) | ISL / Track-S | Transport-clean; populated (`fragile_edges`×9, n=1) | coaching, Analysis tab (post-approval) | Structured stability + fragile edges | “under the model’s perturbations” | Real-world/empirical robustness | allow-list + status/near_tie/provisional fail-closed + flag + tests + gate | §3 activation |
| **report-level confidence** | 3 | — | No ratified field | none | none | — | Overall numeric confidence | Deny-by-default | §9 (confidence language) |
| **evidence quality** | 3 | — | No field | none | none | — | Scoring/asserting evidence quality | Deny-by-default | §9 (evidence-quality scoring) |
| **provenance** (as claim) | 3 | CEE / Science | Metadata only | none | only “model-derived” marker for an activated field | — | Source-authority / lineage claims | Deny-by-default; distinct from §6 precondition | §9 (provenance language) |
| **bias** | 3 | Coaching (M1) | `bias_signals` exist in `draft_coaching`; claims deferred | none | none | — | Asserting bias present/absent | Deny-by-default | §9 (bias claims) |
| **scientific warnings** (vocab) | 3 | Science / S1 | Vocabulary provisional | none | none | — | Sample-depth / false-precision / below-resolution wording | Deny-by-default | §9 (warning vocabulary) |
| **`m1_coaching`** | 3 | Coaching (M1) | Carries `isl_engine`; **not** in keep-list | none (cleaned coaching via `decision_review`) | none directly | — | Direct surfacing | Deny + carrier strip | `isl_engine` redaction/redelivery policy |

---

## §9 — Escalation register (Deliverable 6)

Routed to the science owners. **Every entry has a conservative interim default that holds until
ruled.** No entry is decided inline by this contract.

| # | Question | Why unsettled | Owner | What it blocks | Conservative interim default |
|---|---|---|---|---|---|
| E1 | **Scientific-warning vocabulary** — agreed terms for sample-depth, heuristic-vs-true EVPI, below-resolution, false precision | Terms not ratified; risk of false precision in copy | Neil / Jinghui / S1 | Surfacing `inference_warnings` / scientific warnings | **Surface no warning wording**; absence ≠ all-clear |
| E2 | **Heuristic-vs-true EVPI** — may we claim EVPI/flip values as decision-relevant? | Heuristic vs true EVPI distinction unresolved | Neil / Jinghui | `flip_thresholds`, EVPI in `factor_sensitivity` | **No causal/EVPI claim**; values are model estimates only |
| E3 | **Sample-depth claims** — when is sample depth sufficient to assert a result? | No agreed threshold | Neil / Jinghui | Strengthening any sensitivity/robustness claim | **No sample-depth assertion**; fail-closed |
| E4 | **Below-resolution display** — how to present values below model resolution? | Display policy unset; risk of false precision | Neil / Jinghui / Design | Numeric display of small magnitudes | **Do not display below-resolution values as precise** |
| E5 | **False precision** — rounding/precision policy for surfaced numbers | Unset | Neil / Jinghui / Design | Any numeric surfacing | **Prefer discrete labels over raw numbers** |
| E6 | **Evidence-quality scoring** — is there a defensible evidence-quality score? | No ratified field or method | Neil / Jinghui | Any evidence-quality claim | **No evidence-quality claim** (Tier 3 deny) |
| E7 | **Bias claims** — may `bias_signals` become user-facing bias statements? | Bias claim doctrine unset | Neil / Jinghui / Coaching | Surfacing bias | **No bias claim** (signals stay internal) |
| E8 | **Confidence / provenance language** — wording for confidence and provenance to users | Calibration + provenance-claim doctrine unset | Neil / Jinghui | `confidence_tier` wording beyond the discrete label; provenance-as-claim; report-level confidence | **Discrete label only; no numeric confidence; “model-derived” provenance marker at most** |

---

## §10 — Implementation gates to follow *after* approval (Output 7 — NOT built here)

1. **G1 — Tier-1 ratification.** Adopt the live redaction + diagnostic-only guard + freshness as the
   Tier-1 floor (no code change; documentation anchor).
2. **G2 — Tier-2 activation.** `TIER2_COACHING_ALLOWLIST` + source-clean/prompt-safe pre-checks +
   `CEE_COACHING_TIER2_ENABLED` (default-off) + activation tests + required gate; review & merge the
   S1 spine classifier, then cite it as the reference registry.
3. **G3 — Tier-3 deny.** Default-off + Tier-3 leak guard + empty-not-populated + missing-not-zero
   tests.
4. **G4 — Provenance-metadata.** Require companion statuses + stable IDs + `freshness = fresh` for
   any Tier-2 activation; fail-closed.
5. **G5 — Escalation closure.** Feed Neil/Jinghui rulings back into the spine registry defaults and
   this contract’s tables (§8, §9).

---

## Provenance of this contract

- **Field reality** is taken from the seam arbiter fixture `v5-turn.run-analysis.staging.json`
  (**n = 1**) and the live CEE compose seam on `c8c64a24`.
- **Live enforcement references** (`compose.ts` keep-list/strip, `build-context-summary.ts`
  redaction, `context-summary-diagnostic-only.guard.test.ts`, `freshness.ts`, the
  `contextSummaryEnabled` / `coachingStatePackEnabled` flags, `test:required`) exist on baseline
  `c8c64a24`.
- The **S1 spine classifier** (`src/orchestrator-v5/spine/claim-safety.ts`,
  `enrichment-scientific-view.ts`) lives on branch `claude/tier0-s1-decision-data-spine` /
  PR #293 — **unmerged**, absent from baseline — and is cited only as a preferred reference
  implementation, with its scientific defaults treated as provisional (C7 / non-circularity).
