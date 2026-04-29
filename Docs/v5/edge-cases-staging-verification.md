# Explain edge-case fixes — staging verification (build 71f9efbc)

**Branch:** `staging` at `71f9efbc` (merge of `claude/v5-explain-edge-cases`)
**Date:** 2026-04-29
**Author:** Claude (Opus 4.7)
**Status:** **B FIXED**, **A NOT IMPROVED**, **H ordering FAILS** on Sonnet text path. **No regression on D/E/F.** **No duplicate Run-analysis chips.**

---

## Build confirmation

| Probe | Value |
|---|---|
| `git rev-parse --short=7 origin/staging` | `71f9efb` |
| `GET /healthz` | `{"ok":true,"build":"71f9efb",...}` |
| `pnpm exec tsc -p tsconfig.build.json --noEmit` | exit 0 |

---

## Per-test results (A–H)

Two scenarios:
- **Scenario 1** (`ccc99896-709d-4700-9fb6-f161a7a8cd4e`) — Tests A, B, E (pre-analysis)
- **Scenario 2** (`6a971842-589e-4c18-b19e-7384169b6196`) — Tests C, D, F, G, H (post-analysis)

### Test A — pre-analysis structural — **NOT IMPROVED**
- Message: *"What factor most influences my decision?"*
- handler=`explain_from_structure`, noop=true, 400 chars, source=deterministic_fallback
- chips: 1 (`Run analysis`)

### Test B — pre-analysis result question — **PASS**
- Message: *"Why is the leading option winning?"*
- handler=`explain_results`, precondition_unmet=true, 142 chars, source=precondition_template
- chips: **1** (was 0 in prior verification — fixed)

### Test C — typed run request — **PASS**
- Message: *"Run the analysis"*
- handler=`run_analysis`, noop=false, 482 chars, source=sonnet_text
- chips: 2 post-analysis prompts (no Run-analysis chip — correct)

### Test D — post-analysis explanation — **PASS**
- Message: *"Why does the leading option win?"*
- handler=`explain_results`, 691 chars, source=deterministic_fallback
- staleness ordering: **first** (lead sentence) — fix in place at composer layer

### Test E — factor-named structural — **PASS**
- Message: *"How does Engineering Capacity affect this decision?"*
- handler=`explain_from_structure`, 1424 chars, source=sonnet_text

### Test F — what-would-flip — **PASS**
- Message: *"What would need to change for the runner-up to win?"*
- handler=`what_would_flip`, 703 chars, source=deterministic_fallback
- staleness ordering: first

### Test G — value update routing — **FAIL** (out of scope, unchanged)
- Message: *"Increase the budget to £300k"*
- routed to `direct_answer` clarification, not `edit_graph`

### Test H — stale analysis — **FAIL on ordering**
- Message: *"Why does the leading option still win?"*
- handler=`explain_results`, 1424 chars, source=sonnet_text
- First number at offset 77, staleness phrase at offset 190 — **fails** brief's ordering requirement on the Sonnet text path. Deterministic-fallback path (Test D) satisfies the ordering; Sonnet's freeform text does not.

---

## Summary

**5 PASS / 1 NOT-IMPROVED / 2 FAIL.** KEY edge-case targets: B fixed, A unchanged, H ordering still wrong on the sonnet_text path. No D/E/F regressions (all >> 30-char SAFE_FALLBACK threshold). No duplicate Run-analysis chips.

---

## Operational note

Test D returned `LLM_UNAVAILABLE` 500 on first attempt before succeeding on retry — same flake pattern observed across two consecutive verification runs. Worth separate investigation; does not block this verification.

---

Tests I–O added in [recovery-coaching-verification.md](recovery-coaching-verification.md).
