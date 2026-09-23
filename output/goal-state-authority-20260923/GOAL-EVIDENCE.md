# GOAL EVIDENCE — state authority on the OpenAI (Agent) path

**Goal.** *Every OpenAI interaction, analysis and UI surface reads one authoritative current model with consistent values, provenance, freshness, versions and receipts; edits and reloads cannot contradict or overwrite committed state.*

**Measured on the SERVED build, deterministically. No model calls were made** (the Anthropic-spend instruction is in force, and an Agent turn would also spend OpenAI tokens).

## Provenance of this measurement

| item | value | how |
|---|---|---|
| served CEE build | `e4cd297a906b49bd5faf8ab3af0fdc55045d8952` | `/healthz` → `build: e4cd297`, resolved to 40 chars locally, `HEAD` asserted equal before any read |
| relation to tip | ancestor of `origin/staging`, **1 commit behind** | `git merge-base --is-ancestor` |
| deployed CAS posture | `app_mode: observe` · `rpc_mode: enforce` · `enforcing: true` · `requires_expected_hash: true` | `curl /healthz \| jq .graph_cas` — the repo's own instruction, because `config/index.ts:366` forbids stating the posture in prose |

## ⛔ 1. "Edits cannot overwrite committed state" — VIOLATED on the served build

Four Agent-lane `graph/register` write sites. **Only one carries the caller's base.**

| site | writes | `expected_graph_hash` |
|---|---|---|
| `agent-capabilities.ts:366` | the approved value batch | ✅ `carried` |
| `agent-capabilities.ts:1072` | scale_frame — attaches a range | ⛔ **absent** |
| `agent-capabilities.ts:1270` | scale_frame — attaches a range | ⛔ **absent** |
| `build-model.ts:250` | initial construction | absent, but guarded by `operation_id` idempotency — a *different* protection, not CAS |

Site `:366` is the **contrast control**: the probe does see the field when it is present, so the two absences are real and not a blind grep.

**What the route does when it is absent — its own words:**

> *"A caller that sends nothing is **unaffected, byte for byte**."* — `assist.v1.scenario-graph-register.ts:459-460`

The comparison is inside `if (callerExpectedGraphHash !== undefined)` (`:465`). No hash → no staleness check → **no 409, no refusal, the write lands**.

**Why `rpc_mode: enforce` does not save it.** The route passes its **own** freshly-read base to the RPC (`:645`), not the caller's. So the RPC's identity CAS closes the *route's* read→write window. It cannot close the **caller's** read→think→write window, which is the one an Agent turn spans. A user edit landing in that window is silently clobbered.

**And `requires_expected_hash: true` has exactly two enforcing consumers, both Conventional:**
`edit-graph-dispatch.ts:3191` and `turn-executor.ts:1721`. **The Agent lane never consults it.** The boot guard rejects the invalid *config* combination; nothing makes an individual caller participate.

→ **Fixed by #1743** (both scale-frame sites, counting guard bounded at 3, mutants RED per site). **NOT MERGED.**

## ⛔ 2. "Analysis freshness" — ABSENT on the served Agent route

| probe | served `agent-v1-turn.ts` | contrast control |
|---|---|---|
| `current_graph_hash` / `graph_hash_at_run` | **0** | Conventional `orchestrator/route-v2.ts`: **6** |

The contrast proves the fields exist and are used in this codebase, so the zero is an absence rather than a missing vocabulary. A UI holding one side of a two-sided freshness comparison cannot tell a stale readiness from a current one.

→ **Fixed by #1746** (stamps both `analysis_ready` branches; 16-hex projection verified to match `graph_hash_at_run`). **NOT MERGED.**

## ⚠ 3. "Versions and receipts" — REAL, but PROSE-ONLY and unverifiable

**I corrected my own first reading here.** The served instruction at `agent-v1-turn.ts:137` tells the Agent to *"tell the user the change is saved and which version it became"*, and `agent-v1-turn.ts` carries **0** occurrences of `version_id`/`mutation_id` — which looked like instructing the model to report something it never receives.

It is not. `agent-capabilities.ts:381-384` reads `reg.json.model_version` and pushes a real `{version, version_id, mutation_id, source_turn_id}` into `receipts`, returned to the model at `:452`. **The instruction is truthful.**

The actual gap: **those receipts never reach the wire.** The user gets a version number in prose that **no surface can verify** and the UI cannot read.

→ **#1747** puts them on the wire. ⚠ But I measured that the UI does not read `_agent` either (only `navigator.userAgent` matches; contrast: it *does* read `_diagnostic_trace`). So #1747 makes the receipt **auditable**, not yet **rendered**. Stating that rather than implying a user-visible fix.

## Not measured this pass — said rather than implied

- **Reload agreement** (does a reload reproduce the same authoritative model?). Not probed here; it needs a driven journey, which is Paul's manual test.
- **Units / provenance consistency.** Partially addressed by #1663 (another lane, approved by me today — the 100-fold goal-threshold understatement) and the `value-warrant-guard` ledger, where 26 of 34 value sites remain `OPEN`.

## Bottom line

**The goal is NOT met on the deployed build, and the gap is not theoretical.** Two of the four Agent write paths can overwrite a user's committed model with no staleness check, the Agent route emits no freshness comparison at all, and its version receipts exist but never reach a surface.

**All three fixes are built, RED-first tested and mutant-proved. None is deployed.** #1743 and #1746 are NOT LOW RISK and are waiting on an independent exact-head verdict; #1747 is LOW RISK with a published head-bound verdict and was blocked by a starved non-required aggregator, then invalidated when #1733 moved `staging` under it.
