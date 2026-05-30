# V5 Current State — operating truth

**Status:** live operating truth · **Date:** 2026-05-30 · **Baseline:** `origin/staging` @ `638ecbe9` (PR #220 merged)

**Purpose:** the single, current operating-truth tracker for V5 implementation. It records what has landed, the reframed next step, the Phase 3 reconciliation against the merged handler-coverage map, and the holds and gates that bound the next workstream.

**Authoritative audit:** [`v5-handler-coverage-map.md`](./v5-handler-coverage-map.md) — read-only static audit, PR #220. This file summarises and points to that map; it does not restate it.

---

## 1. Canonical operating-truth rule

This file is the canonical current-state tracker for V5. After it lands:

- **Update this file** (`Docs/v5/V5_CURRENT_STATE.md`) for V5 state changes rather than spinning up new trackers.
- **Create a new tracker only** for a distinct audit or evidence artefact (e.g. the handler-coverage map). When you do, **link it from here** and capture its operative conclusion in a line or two.
- **Implementation briefs should reference this file** as the current operating truth.

Rationale: the programme has been treating `V5_CURRENT_STATE.md` as canonical before it existed — it is already referenced by [`v5-analysis-tab-data-contract-v1_3.md`](./v5-analysis-tab-data-contract-v1_3.md) (header and §8). This file closes that gap.

---

## 2. What just landed

- **Handler-coverage map merged and accepted** — PR #220, squash `638ecbe9` (2026-05-29). Now the authoritative static audit for V5 handler coverage and coaching-field delivery.
- **Diagnostics trace merged** — #213 (`72bf16f0`): `_diagnostic_trace` on `draft_graph` plus a minimal trace on the other V5 paths.

---

## 3. Operating truth — key findings

From the handler map (source-verified unless noted):

- **ContextPack has exactly one direct consumer:** the fall-through routing prompt (`Prompts/v40.txt`, read at `route-with-tool-use.ts:742-768`). It does double duty — it **picks the tool** and **writes the explanation `answer_text`** for `explain_results` / `what_would_flip` / `explain_from_structure`.
- **The routing prompt stays structurally relevant** precisely because it owns that explanation `answer_text` on free-text turns that escape every deterministic gate.
- **`decision_review` is a separate Sonnet call** (`invokeDecisionReview`) that assembles its **own** context from **raw PLoT enrichment plus the scenario brief — not the ContextPack** (`decision-review-enricher.ts`, `cee/decision-review/invoke.ts`).
- **Leverage today sits at the deterministic copy-owning surfaces** and the enricher's input adapter — not generic ContextPack enrichment.

---

## 4. Reframe — supersedes "improve ContextPack"

**Superseded:** "improve / enrich the ContextPack" as the headline next step. On current static evidence it is **low-leverage** — it reaches only the fall-through routing prompt.

**Current framing:** **deliver structured coaching fields to the copy-owning surfaces.** Those surfaces, all under `src/orchestrator-v5/`:

| Surface | Owns | Today |
|---|---|---|
| `coaching/post-draft-narrative.ts` | post-draft `assistant_text` | handler-owned, gating; CEE coaching summary used verbatim only if `gateFullResponse` accepts |
| `compose/phase3-blocks.ts` | review / coaching / evidence blocks | composer-owned over LLM-fallback content |
| `routing/post-analysis-advice-gate.ts` | post-analysis advice prose | composer-owned, deterministic |
| selected handler-specific context paths | per-handler assembly | 14 surfaces catalogued in map §7b |

**v41.8 / generic ContextPack enrichment is held — not dismissed.** The routing prompt is a real consumer (it writes the explanation `answer_text`), so v41.8 is **held pending the runtime bypass-rate / copy-source proof**, not ruled out as structurally irrelevant.

---

## 5. Next likely path — Tranche A (coaching delivery, V5-owned, surgical)

The handler map ranks these first: V5-owned, surgical, and already across the V4→V5 boundary on `DraftGraphResult`.

| # | Change | Static status | Safety |
|---|---|---|---|
| **A1** | Wire `widening_log` into post-draft copy | crosses boundary; **not consumed** in `post-draft-narrative.ts` today | SAFE, V5-only — ~1 line at `dispatch.ts:162-168` plus interface/logic in `post-draft-narrative.ts` |
| **A2** | Consume `strengthen_items[1..n]` (not just `[0]`) | full array crosses; only `[0]` consumed via `pickStrengthenAssumption` | SAFE, V5-only — `post-draft-narrative.ts` only |
| **A3** | Use `bias_signals` more fully | full array already iterated by the post-draft picker, but a **single** signal is surfaced | SAFE, V5-only — lift is surfacing / extending beyond the one picked signal |
| **A4** | `decision_review` / deferred draft-sourced block surfacing | block path already emits; free-text residual | **later, after runtime proof** |

> **Re-confirm on HEAD before implementing.** The map found A1–A3 V5-owned and safe pre-V4-lift, but all cited line numbers are as of baseline `d59be1a8`. Reconcile against current `origin/staging` HEAD when implementation starts.

> **Update (2026-05-30, branch `feat/v5-coaching-surface-delivery`, base `27bb71a8`; [PR #222](https://github.com/Talchain/olumi-assistants-service/pull/222) open against `staging`, awaiting review — not merged).** A1–A3 implemented deterministically: revived the `widening_log` liveness path (the canonical object shape was dead on V5) and surface its `brief_completeness` as a calm advisory; the post-draft narrative now surfaces a second `strengthen_items` / `bias_signals` "check" point; the post-analysis advice gate names the two highest-leverage drivers in its evidence-gap fallback. Plus additive, flag-gated copy-source diagnostics. No prompt/PMS/schema/env/DGAI/PLoT/ISL changes; deterministic, no new LLM calls.
>
> **A4 / `decision_review` auto-fire remains an OPEN product decision — not resolved here.** `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` defaults **off**, so the persisted `run_analysis` fact carries raw PLoT enrichment only and `phase3_block_context_available` is false on follow-up turns **by design** (not a propagation bug). This branch builds the deterministic enrichment-backed bridge — the right immediate path — and the advice gate already draws from the projected-analysis fallback, so it does not degrade. Whether to enable the flag despite its added latency is a pending **product / latency** decision to revisit separately.

---

## 6. Phase 3 reconciliation (13 May Completion Plan → handler map)

The 13 May "V5 Completion Plan" is an **external** companion doc — it is not in the repo, and no in-repo file carries literal `3a`–`3g` labels. The items below are reconciled from this workstream's brief against the merged map. **3c–3e are not enumerated in any available in-repo source** and require reconciliation against the external 13 May Completion Plan when implementation resumes; they are not invented here.

| Item | Was | Now | Note |
|---|---|---|---|
| **3a** `decision_review` auto-invoke / reach | broad Medium task | **fixed for blocks / residual for free-text** | Block path emits review/coaching/evidence (PR #178 emission, #180 input adapter, #181 lifecycle). Residual: does a fall-through free-text post-analysis turn get Sonnet to use `coaching.decision_review` in `answer_text`? `unknown-needs-runtime-proof`. **Not a fresh broad Medium task.** |
| **3b** draft_graph structured outputs | one broad task | **split into sub-findings** | see the four rows below |
| 3b · `strengthen_items[]` | — | **partial** | full array crosses; only `[0]` consumed → A2 |
| 3b · `widening_log` | — | **partial** | crosses; not in same-turn post-draft copy → A1 |
| 3b · `bias_signals` | — | **partial** | full array iterated, single signal surfaced → A3 |
| 3b · provenance | — | **partial (graph) / still true (analysis)** | compact graph passes node/edge provenance opaque; the ContextPack analysis projection flattens `top_drivers` / `fragile_edges` to label pairs and drops confidence / attribution_stability / EVPI / switch_probability |
| **3c–3e** | — | **not enumerated** | reconcile against the external 13 May Completion Plan when implementation resumes |
| **3f** structured blocks | — | **partly fixed; deferred kinds remain separate** | `phase3-blocks.ts` already emits review/coaching/evidence (composer-owned over LLM-fallback). Deferred: the four draft_graph-sourced coaching kinds (`orientation` / `widening` / `bias_signal` / `strengthen`) — separate sidecar workstream |
| **3g** prompt quality | — | **held** | depends on the v41.8 decision / routing-prompt runtime proof |

---

## 7. Runtime-proof gates

**Before A1–A3 — small post-draft copy-source trace:**

- `gateFullResponse` pass / discard rate;
- post-draft copy-source rates;
- whether post-draft coaching reaches the visible surface.

**Later — full trace:**

- prompt bypass rate (fraction of real turns hitting a deterministic gate vs. falling through to the router) — bounds how much ContextPack enrichment can ever matter;
- `decision_review` free-text use;
- fall-through vs. advice-gate split;
- DGAI production route parity (which `/assist/v1/*` and `/orchestrate/v2/turn` the deployed UI actually hits);
- copy-source rates for routing-prompt explanation turns.

All of the above are `unknown-needs-runtime-proof` until measured.

---

## 8. Current holds

- **No v41.8 upload.**
- **No generic ContextPack enrichment.**
- **No V4 decommission implementation.**
- **No broad coaching state / cache / anchor work.**
- **No link-safe corpus gate / full Golden Journey validation** until product-impacting fixes land.

Cheap manual sanity and **staging smoke checks remain allowed.**

---

## 9. Safety / process gates

- **`staging` branch protection still needs to be applied** before the next merge. This file is committed locally only; it is not to be merged until protection is in place, unless explicitly overridden.
- **Staging Supabase isolation must be confirmed** before meaningful staging traces or replay.
- **Full Typecheck red is pre-existing test-file drift** — tracked separately, not fixed inside product workstreams.

---

## 10. V4 decommission — held future workstream

Held. When it resumes, use a **delta-refresh** of the handler map's constituent maps (§3 coverage matrix · §4 turn-type · §5 prompt-usage · §6 copy-owner · §7 context-consumption · §8 V4/V5 ownership), **not a fresh audit**.

**Blocked by:** `draft_graph`, `edit_graph`, `repair_graph`, the PLoT client, shared utility / type imports, the mounted `assist/v1/*` routes, DGAI route parity, and canonical journey proof.

---

## References

- [`v5-handler-coverage-map.md`](./v5-handler-coverage-map.md) — authoritative static audit (PR #220).
- [`v5-phase3-input-contract.md`](./v5-phase3-input-contract.md) — Phase 3 block input contract and `decision_review` density telemetry.
- [`v5-analysis-tab-data-contract-v1_3.md`](./v5-analysis-tab-data-contract-v1_3.md) — V5 / Analysis-tab data contract (references this file).
