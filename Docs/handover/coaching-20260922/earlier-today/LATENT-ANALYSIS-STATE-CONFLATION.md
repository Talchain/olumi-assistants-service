# Latent: `compactAnalysis` conflates "could not look" with "nothing there"

**Recorded, deliberately NOT fixed.** Measured 22 Sep 2026 at deployed CEE `e717e19d`/`bd35cc9e`.

## The defect

`src/orchestrator/context/analysis-compact.ts` returns `null` for **four semantically
different** situations:

| line | situation | meaning |
|---|---|---|
| 719 | `!response` | no envelope at all |
| 726 | `analysis_status === 'blocked'` | the engine **blocked** the analysis |
| 726 | `analysis_status === 'failed'` | the analysis **failed** |
| 899 | `catch (err)` | an internal error (logged, then flattened) |

The comment at :722 states the collapse outright — *"treat errors as null"* — and the
consumer documents the value as the opposite: `turn-executor.ts:955`, *"Absent / null on
**pre-analysis** decisions."*

So a blocked or failed analysis is projected to the model and the user as **never analysed**.
That is the same class `#1659`/`#1660` exist to close (a failed read arriving as an absent
fact), one layer over, and it is architecture-independent: any controller reading this
projection inherits it. `read_results` would say the analysis was never run, and
`run_analysis` would offer to spend compute rather than surfacing the failure.

## Why it is NOT being fixed now

Measured over 7 days on the PLoT envelope, with a positive control:

| filter | hits |
|---|---|
| `"analysis_status":"blocked"` | **0** |
| `"analysis_status":"failed"` | **0** |
| `"analysis_status":"computed"` (positive control) | 50+, `hasMore: true` |

The control proves the probe sees the field. Neither reachable arm fires in the sampled
window, and there is no evidence the `catch` fires either. **This is latent, not live.**

Blast radius if it is fixed: three real call sites (`analysis-fallback.ts:564`,
`compare-runs.ts:302`, and the `AnalysisStateIngress` type threaded through
`turn-executor.ts`). Small, but a discriminated return ripples through the projection's type.

## The shape a fix should take, when it is worth taking

Return a discriminated result rather than a bare `null`, so callers can tell
`not_analysed` from `blocked` / `failed` / `could_not_compute`. The precedent is already in
this estate and should be matched rather than reinvented:
`reconcile-scenario-analysis-facts.ts` returns `degraded('durable_unavailable')` and
`degraded('durable_contract_invalid')` for exactly this reason, and `currentModelRevision`
documents it in terms — *"`null` means 'no analysis-affecting model'; a transport failure
means 'we could not look'"*.

## Note on how this was found

Three of my own measurement instruments failed this way today — the Render log API returning
`{"message": ...}` parsed as n=0, an `env-vars?limit=200` error ("invalid limit: too large")
read as "1 variable, no flags set", and a stale local clone read as current source. Each
produced a confident wrong claim until a control or an implausible number caught it. The
product has the same class of hazard on its analysis path; it is simply not firing yet.
