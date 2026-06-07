# V5 Lane 2 — deterministic chip curation (egress finaliser)

**Status:** implemented on `feat/v5-cee-chip-grounding` · **Date:** 2026-06-07 ·
**Baseline:** `origin/staging` @ `b8d5bcce`

Findings + contract for the deterministic chip-quality pass. Companion to
[`V5_CURRENT_STATE.md`](./V5_CURRENT_STATE.md).

## Why

Chips reaching the wire were not uniformly curated. Copy-safety was enforced only
on proposal chips (at emit); rule-engine / recovery / state-query / draft /
chip-click / edit chips bypassed it. Dedupe was exact-`id`-only and inline in a
single turn-executor branch; there was no near-duplicate detection, no universal
budget, and proposal protection was positional in one branch.

## Confirmed live chip path

`POST /orchestrate/v2/turn` ([route-v2.ts](../../src/orchestrator/route-v2.ts),
gated on `ENABLE_V5_ORCHESTRATOR`) → every 200-OK dispatch path (`turn_executor`,
`chip_click`, `draft_graph`, `edit_graph`, `system_event`,
`frame_no_brief_guard`) exits through `sendFinalised200` →
`finaliseV5Response()` ([response-finaliser.ts](../../src/orchestrator-v5/response-finaliser.ts)).
That finaliser is the universal egress chokepoint (brand + WeakSet +
`preSerialization` contract), so a single curation pass there covers **all** live
V5 chips. `chip-generator.ts`'s `generateChips()` is confirmed live (called on
every TurnExecutor compose branch; not on any V4 path). `/orchestrate/v1/turn`
returns **410** under V5; `/assist/v1/*` are CEE task routes, not the turn path,
and do not use the chip generator.

## Chip quality rules (`compose/chip-curation.ts` → `curateChips`)

Pure, idempotent, subtractive pass — runs in the finaliser, returns strict
`{id,label,message,action_type?}` chips:

1. **Malformed drop** — blank id / label / message.
2. **Copy-unsafe drop** (all chips, incl. proposals): internal leak tokens
   (handler ids, `prop_`/`chip_`, `graph_hash`, JSON fragments, `zod`, …, reusing
   `SAFETY_FORBIDDEN_TOKENS` minus the em dash), prose jargon
   (`findForbiddenPhraseHit`: `_meta`, `orchestrator`, prescriptive language),
   and a **narrow bare-decimal guard** — drops model-scale leaks like `0.4732`
   but keeps display values (`£1.50`, `$2.00`, `12.5%`) and exempts
   user-authored labels (`chip_entity_*`, `edit_clarify_*`, e.g. "Plan 2.5").
3. **Dedupe** — exact `id`, then near-duplicate on normalised
   `label+message+action_type` (so an executable chip is never merged with a
   same-copy prompt chip), proposal-preferring on collision.
4. **Budget** — at most 3, **never** dropping a protected chip.

Conservative: never invents a chip, never reorders survivors, preserves the rule
engine's deliberate grounded fallback prompts. Empty in → empty out (no filler).

## Protection & divergence-safety

Pending actions are persisted at COMMIT (`commit.ts` →
`derivePendingActionsFromChips`), **before** the finaliser. They are seeded only
for chips with `action_type ∈ {run_analysis, what_would_flip}` plus proposals
(`prop_` ids, via explicit emit). So curation **never dedupe-loses or
budget-trims** a proposal or a chip-derivable action chip — otherwise displayed
chips could diverge from persisted resume state (the Branch A hazard). The only
removals that can touch them are the copy-safety / decimal egress checks, which
never fire in practice (proposal copy is whole-number + emit-filtered; derivable
action chips carry hardcoded-safe copy) — asserted by tests. Disambiguation
choice-sets (`chip_entity_*`) are budget-protected so "which one did you mean?"
is never truncated. The inline turn-executor proposal-dedupe loop is **kept** as
belt-and-braces.

## Telemetry

Content-free `v5.chip.suppressed` `log.warn` (reason, category, closed-enum
`action_type`, optional `scenario_id`) — **no chip label / message / user / graph
text**. No new `TelemetryEvents` enum entry → freeze gate untouched. The existing
chip-generator suppression logs were also tightened to drop `chip_label`.

## Liveness evidence — canonical replay vs live `/orchestrate/v2/turn`

Local server (build `b8d5bcc`, running this branch's working tree via `tsx`),
staging PLoT + Supabase. `tools/v5-journey-replay --journey canonical`:

| Step | Status | Chips | Note |
|---|---|---|---|
| 1 draft_graph | PASS | **3** | "Run analysis", "Review model", "What assumptions matter most?" — budget=3 |
| 2 weakest_option | PASS | 1 | |
| 3 add_option | PASS | **0** | no filler |
| 4 run_analysis | PASS | 2 | "Explain the result", "What could change the outcome?" · `analysis_ready=ready, options=4` (real PLoT — not dormant/V4) |
| 5 explain_leader | PASS | 1 | "Explore what would change this" |
| 6 edit_budget | PASS | **0** | no filler |

All steps pass the harness forbidden-term scan over chip labels/messages (no
internal-term/ID/hash leaks). Pending-bearing action chips (`run_analysis`,
`what_would_flip`) survived curation intact. The `dl7-set-factor` /
`dl7-staleness` mutation steps fail locally on an inherited `assistant_text`
mutation-ack assertion (documented "label-fragile" path) — unrelated to chips;
the `what_would_flip` flip-proposal chip is therefore covered by route-v2 + unit
tests rather than the local replay.

## Route / latency findings

- **Route parity:** no public routing change. Curation covers every live V5 chip
  path because all 200-OK exits converge on `finaliseV5Response`. DGAI production
  route parity remains `unknown-needs-runtime-proof` (see `V5_CURRENT_STATE.md`).
- **Latency (evidence only, no code in this PR):** per-step wall-clock —
  `draft_graph` ≈ 54s (LLM-dominated; the hotspot), `run_analysis` ≈ 3.7s (incl.
  PLoT), `explain` ≈ 4.1s, converse turns ≈ 2.3–2.7s. Curation is pure array work
  over ≤5 chips — negligible. Quick win noted for a separate PR: the duplicated
  `buildTurnOutcome()` call at `turn-executor.ts:4568`.

## Remaining follow-ups

- Optional registered `V5ChipsCurated` summary event (with full freeze
  registration) if dashboards need aggregate curation counts.
- Latency micro-optimisations (`buildTurnOutcome` hoist) — separate PR.
- Re-run `dl7-set-factor` / `what_would_flip` flip-proposal replay post-merge on
  staging (where the mutation-ack path is not label-fragile) for end-to-end
  proposal-chip liveness.
