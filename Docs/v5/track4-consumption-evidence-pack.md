# Track 4 consumption evidence pack — AI-experience state signals

**Status:** produced by the AI Harness Completion Pass (2026-07-06), baseline `origin/staging` @ `93d39f1` (Group A merged).
**Purpose:** unblock Track 4 display work by stating, per UI-facing state: whether it genuinely exists today, where it is observable, how Track 4 should consume it, and what Track 4 must **not** infer locally. Track 4 renders authoritative state; it never derives graph/data truth.

Companion assurance surfaces (this pass): `tools/golden-journey-harness/` (A1–A12 replay classifiers + `replay-manifest.json`), `tests/unit/ai-harness/` (wording honesty, architecture protection, future hooks), `tests/unit/golden-journey-harness/label-only-freshness.test.ts` (freshness known gap).

---

## 1. Signals that exist today

### Analysis freshness
| | |
|---|---|
| Exists today? | **Yes** — authoritative, server-derived. |
| Observable where | Public response: `analysis_ready.freshness` (`fresh` \| `stale` \| `unknown` \| `none`) with `freshness_reason` and `computed_at`. Diagnostic (flag-gated, default off): `_context_summary.analysis_state` carries the composed verdict and usability predicates. |
| How Track 4 consumes | Render the enum verbatim. `stale` ⇒ show stale framing + rerun affordance; `unknown` ⇒ unconfirmed framing (never assert the model changed); `none` ⇒ no analysis exists yet. |
| Must NOT infer locally | **Freshness itself.** Track 4 must not compare hashes, timestamps, or edit history to decide currency — the server verdict is the single source of truth. Known gap: on label-only edits UI and CEE can disagree today (see ISSUE-9021 below); the fix is server-authoritative freshness, not a UI-local heuristic. |

### Rerun state
| | |
|---|---|
| Exists today? | **Yes** — as deterministic chips plus the freshness signal. |
| Observable where | Public response `suggested_actions`: `chip_action_rerun_analysis` ("Re-run analysis" / executable `run_analysis`), `chip_action_rerun_analysis_after_mutation` ("Run analysis again", post-edit), `floor_rerun_analysis` (conversational floor). Diagnostic: `_context_summary.rerun` (prior run count, comparison readiness). |
| How Track 4 consumes | Render the chips as delivered — ids are contract identifiers; labels/messages are copy (pin ids, not prose). A rerun affordance appears exactly when the server decides one is needed. |
| Must NOT infer locally | Whether a rerun is needed. Do not synthesise rerun buttons from local edit tracking — the after-edit rerun chip is already server-emitted on model-relevant edits. |

### Proposal visibility (pending/proposed action state)
| | |
|---|---|
| Exists today? | **Yes** (merged Track 2 pending-confirmation truth). |
| Observable where | Public response: `pending_actions[]` (kinds incl. `apply_proposed_change`, `proposed_concept`; chip id = `proposal_ref` bridge) and the proposal chip itself. Prompt/frame truth: `conversation.pending_confirmation` boolean. Diagnostic (flag-gated): `_context_summary.pending` — redacted counts + kinds only (`live_count`, `expired_count`, `confirmation_expecting_live_count`). |
| How Track 4 consumes | A turn that carries a `proposed_*` pending is a **proposal, not an applied change** — render "proposed, awaiting decision" state from the pending action, never from prose. Expiry is server-owned (turn + wall-clock TTL). |
| Must NOT infer locally | Proposal state from assistant wording; proposal lifetime/expiry; whether a proposal was applied (only a subsequent committed write proves that). |

### Driver explanations
| | |
|---|---|
| Exists today? | **Yes**, bounded. |
| Observable where | Public response: `analysis_ready` enrichment (options with win probabilities; factor sensitivity / option comparison / robustness where present) and deterministic explain prose. What-changed driver deltas: `driver_rank_changes` (labels + integer rank moves) inside comparison prose, fresh-only. |
| How Track 4 consumes | Render delivered labels, probabilities, and rank-change statements. Content is redaction-safe by construction (labels + closed enums + integer points; no raw decimals/IDs). |
| Must NOT infer locally | Driver rankings or sensitivity from raw numbers; anything from Tier-2/3 held-science fields (the harness blocked-claim scanner enforces they never surface). |

### Blocked / recovery states
| | |
|---|---|
| Exists today? | **Yes.** |
| Observable where | Public response: typed error envelope on failure; on degraded-but-200 paths, deterministic recovery copy + recovery chips; `model_adjustments` where repairs occurred. Harness doctrine: every failure path includes a chip (A7 "recovery visible"). |
| How Track 4 consumes | Failure/blocked is a first-class render state: show the recovery copy and its chip. Absence of an error envelope + presence of the expected payload = success; anything else renders as recovery, never as silent success. |
| Must NOT infer locally | Success from a 200 alone; retry semantics; invented failure reasons beyond the delivered copy. |

### Debug visibility (diagnostic traces)
| | |
|---|---|
| Exists today? | **Yes**, flag-gated and default-off. |
| Observable where | `_diagnostic_trace` (`CEE_DIAGNOSTIC_TRACE_ENABLED`, default false): timings, correlation ids, exit path, hash prefixes — no prompt/response text. `_context_summary` v1.1.x (`CEE_CONTEXT_SUMMARY_ENABLED`, default false): analysis state, pending counts, rerun readiness. Both are stripped/re-attached at the route seam and are additive-only. |
| How Track 4 consumes | Debug panels only, behind the same flags; treat both surfaces as optional (absent by default in production). The `graph_hash` fields there are the 16-hex **analysis-affecting** hash. |
| Must NOT infer locally | Product state from diagnostic surfaces (a static guard already forbids product paths reading `_context_summary`); the diagnostic hash is not a graph-identity signal (see future-only below). |

### What-changed evidence
| | |
|---|---|
| Exists today? | **Yes**, fail-closed on freshness. |
| Observable where | Public response prose from the run-comparison gate: grounded before/after statements (leader change, margin direction, integer percentage-point shifts, driver rank changes) **only when freshness = `fresh`**. On `stale`: honest "model has changed" framing + `chip_action_rerun_analysis`. On `unknown`: unconfirmed framing + the same chip. Identical runs: honest "essentially unchanged" statement. |
| How Track 4 consumes | Render the delivered comparison (or its stale/unconfirmed refusal) as-is. The refusal states are correct product behaviour, not errors. |
| Must NOT infer locally | Before/after deltas from cached previous responses. If the server refused to compare (stale/unknown), the UI must not compare either. |

---

## 2. Future-only signals (do not consume, do not fake)

| Signal | Status today | Keyed hook |
|---|---|---|
| `graphIdentityHash` (64-hex identity) | CEE-local pure function only; zero production call sites; **on no wire or diagnostic surface** | ISSUE-9024 |
| CAS / stale-write observe mode | Absent from branch; PR #346 (draft, do-not-merge) would add `CEE_V5_GRAPH_CAS_MODE` (off\|observe\|enforce, default **off**, prod auto-downgrades enforce). Observe = telemetry-only; **not atomic CAS** | ISSUE-9023 |
| Model versions / restore / compare / timeline | No substrate at all (no table, no pointer, no restore path) | ISSUE-9025 |
| Ratified `CandidateMutationEnvelope` shared export | Doc + isolated spec test only; not in src | ISSUE-9026 |
| Proposal-card surface | Not in src compose/schemas | ISSUE-9027 |

Track 4 must not render, imply, or locally simulate any of these. Wording rule enforced by the harness: Olumi never says "Restored" / "Created a version" / "Committed" / "Applied" unless authoritative state proves a durable committed write — and version/restore vocabulary has **nothing** authoritative to point at until Model Management exists.

---

## 3. Harness known-gap / future-hook register (ISSUE-90XX)

These synthetic markers follow the repo's skip-reference convention (`test-skip-guard` CI). Each lives next to its skipped/blocked case; the tripwires in `tests/unit/ai-harness/future-hooks-registry.test.ts` fail loudly (with conversion instructions) the moment the named substrate lands.

| Marker | What it tracks | Owner | Unblocking substrate signal | Where it lives |
|---|---|---|---|---|
| ISSUE-9021 | Label-only edit freshness: UI and CEE may disagree today; target is server-authoritative freshness as the single source of truth; Track 4 must not compute local freshness as product truth. Converts when an authoritative identity/freshness signal becomes observable | Canonical State / freshness substrate | Identity/freshness substrate wire-observable (see ISSUE-9024) | `tests/unit/golden-journey-harness/label-only-freshness.test.ts` |
| ISSUE-9022 | Restore/revert/rolled-back/version success-claims are NOT runtime-detected by src (deliberate; precision-first). Harness A4/A8 replay classifiers carry the class meanwhile | Model Management | `model_versions` substrate + src detector widening | `tests/unit/ai-harness/wording-honesty-completion.test.ts` |
| ISSUE-9023 | A3 CAS observe-mode assurance: default-off, non-blocking, diagnostic-only; never assert atomic CAS. **The A3/#346 owner should expect the tripwire to fire as part of landing A3** | Canonical State / A3 (PR #346) | `CEE_V5_GRAPH_CAS_MODE` in src/config | `tests/unit/ai-harness/future-hooks-registry.test.ts` |
| ISSUE-9024 | graphIdentityHash wire exposure → identity-hash parity assertions; closes the ISSUE-9021 durability blind spot | Canonical State / contract ratification | `graph_identity_hash`/`graphIdentityHash` on a wire/diagnostic surface | `tests/unit/ai-harness/future-hooks-registry.test.ts` |
| ISSUE-9025 | Version/restore honesty enforcement against real version state | Model Management | `model_versions` table or equivalent | `tests/unit/ai-harness/future-hooks-registry.test.ts` |
| ISSUE-9026 | Repoint the isolated t4-contract envelope spec at the ratified shared export | Track 4 / contract ratification | `CandidateMutationEnvelope` exported from src | `tests/unit/ai-harness/future-hooks-registry.test.ts` |
| ISSUE-9027 | Proposal-card visibility checks (proposed ≠ applied, never inferred from prose) | Track 4 UI | `proposal_card`/`proposalCard` in src compose/schemas | `tests/unit/ai-harness/future-hooks-registry.test.ts` |

---

## 4. What this pass deliberately did NOT do

No graph mutation, CAS, or freshness implementation; no CAS enforcement enabled; no model versions; no local graph truth/hash/normalisation in the harness (mechanically enforced by `tests/unit/ai-harness/architecture-protection.test.ts`); no schema promotion; no UI action wiring; no M2 persistence; no prompt changes. The graph/data contract v0.2 is external and unratified — envelope/identity/writer-path fixtures stay blocked-future, keyed to the signals above.
