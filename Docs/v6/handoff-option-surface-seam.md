# Handoff — executable option enrichment requires a seam change (decision for Paul)

**Status: DECISION REQUIRED. Nothing on the quarantined branch changes the seam.**
This is gate-7 territory: sequenced AFTER the MVP's 6 ordered activation gates.

## Current contract (file anchors, at branch base)

- **D1** — `src/cee/dual-draft/merge.ts` (`added_option` branch): every
  `added_option` proposal becomes a defer artifact; the merge never creates an
  option node. Core rationale: **inventing intervention values is prohibited**, and
  a value-less option flips a ready draft to `needs_user_mapping`.
- **G12(i)** — `src/cee/dual-draft/guards.ts` `optionSurfaceUnchanged`: option
  nodes + option-adjacent edges must be **byte-identical** pre/post merge; any trip
  discards ALL merges (`option_surface_changed`).
- **Endpoint restriction** — `merge.ts` `RESTRICTED_ENDPOINT_KINDS`: proposed edges
  may not touch option/decision nodes (`edge_endpoint_restricted`).
- **Unsynchronised surface** — `GraphV3` has **no top-level `options[]`**; that
  array lives on `CEEGraphResponseV3` only. The merge operates on the persisted
  GraphV3 seam, so an executable option would exist as a graph node without any
  response-level `OptionV3` entry unless a new writer owns that surface.

## What the proofs established (`src/cee/dual-model/__tests__/frozen-seam-readiness-proof.test.ts`)

1. **G12(i) is the binding constraint, not readiness.** A fully-executable
   synthetic option (values supplied, `NodeV3`/`OptionV3`-valid) keeps
   `checkReadinessNoDowngrade` GREEN — and is still discarded by the byte-freeze.
2. The freeze discards even **strict readiness improvements** (1-option graph:
   `needs_user_input → ready`, still blocked).
3. Value-less options DO downgrade readiness — D1's defer is correct as long as
   values cannot be sourced.
4. Edges to an injected option trip `edge_endpoint_restricted` independently.

So: relaxing readiness is NOT needed; the decision is about G12(i), D1's defer,
the edge restriction, and who writes `options[]`.

## What a seam change would require (proposed shape, not built)

1. **New proposal/merge input kind** (e.g. `added_option_executable`) carrying a
   **value-provenance bundle**: every intervention value traceable to
   user/operator input (`source: 'user_specified'`), never M2 invention — D1's
   core survives; M2 still cannot supply values. The deterministic synthesis half
   already exists and is tested:
   `src/cee/dual-model/option-enrichment/synthesise-option-candidate.ts`
   (refuses empty mappings: `no_intervention_values_supplied`).
2. **G12(i) relaxed from "byte-identical" to "additive-only"**: pre-existing
   option surface byte-identical; appended options must pass an
   executable-candidate validator (values present + finite, targets exist and are
   factors, `NodeV3`/`OptionV3` valid, readiness non-downgrade re-checked).
3. **Edge permission** scoped to the appended option's own intervention edges (if
   the option→factor connectivity convention is wanted in the graph, mirroring
   `computeStructuralReadiness`'s edge-based fallback).
4. **`options[]` synchronization — the largest untouched surface.** Someone must
   write the `OptionV3` entry (status `ready`, `InterventionV3` records with
   `target_match`) at the layer that owns `CEEGraphResponseV3`. Candidates:
   dispatch-layer composer at commit time, or a response-assembly step. Freshness
   hashing note: `computeAnalysisAffectingGraphHash` already covers node-level
   `interventions`, so an appended executable option correctly invalidates staleness.

## Blast radius to enumerate before approving (not solved here)

- **PLoT**: receives options via the response contract; an option present in the
  graph but absent from `options[]` (or vice versa) is exactly the class of skew
  the platform CLAUDE.md warns about — trace producer → validator → consumer
  across the schema pins before building.
- **UI canvas**: renders option nodes with node-level `interventions`
  (`NodeV3.interventions` is display-copy; `options[]` is canonical for analysis).
- **Baseline detection**: `computeStructuralReadiness` + `buildAnalysisReadyPayload`
  baseline ordering — an appended option changes `is_baseline` assignment inputs.
- **Run-comparison / persisted-first controlled-factor authority** (PR #316): new
  options appearing mid-session interact with persisted-graph authority.

## Decision asks

1. Approve/reject the **additive-only G12(i)** shape (2 above)?
2. Approve the **value-provenance rule** (values only from user/operator mapping)?
3. Who owns **`options[]` writing** — dispatch composer or response assembly?
4. Sequencing: confirm this waits for all 6 MVP activation gates + a proven
   merged-graph `run_analysis` SUCCESS baseline first.
