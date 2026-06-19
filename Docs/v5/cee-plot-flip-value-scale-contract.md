# CEE ↔ PLoT contract: `flip_thresholds[].value_scale`

**Status:** active · **Scope:** CEE Branch A flip-threshold → `set_factor_value` proposal · **Owner:** CEE
**Related code:** [`src/orchestrator-v5/compose/flip-proposal.ts`](../../src/orchestrator-v5/compose/flip-proposal.ts), [`src/orchestrator-v5/compose/format-factor-value.ts`](../../src/orchestrator-v5/compose/format-factor-value.ts)

## Summary

`value_scale` is the **authoritative boundary signal** that tells CEE the scale of the numeric
values inside a PLoT `enrichment.flip_thresholds[]` entry (`flip_value`, `current_value`, and the
`margin_sensitivity` probe values). CEE consumers **must not** assume `flip_value` is on the
normalised `[0, 1]` model scale without checking it.

| `value_scale` | Meaning | CEE handling |
|---|---|---|
| `"display"` | `flip_value` is already a **user-unit** value (e.g. `6.055 story_points`). | Use it directly as the user-scale value — **do not** multiply by `cap`. Store the **exact** value in the action payload; round the chip copy to one decimal for readability and prefix **"around"** when rounding changed it. |
| `"model"` | `flip_value` is **normalised** `[0, 1]`. | Invert to user scale: `rawInput = flip_value × cap` (capped) or `flip_value` (uncapped). Display **exactly** (whole numbers only; never round). **Legacy / backward-compatible only.** |
| absent | Pre-contract data. | Treated as model-scale **only when unambiguous**: an uncapped factor (model === user), or a capped value already in `[0, 1]`. A capped value **outside** `[0, 1]` with no signal **fails closed** (`ambiguous_scale`) — it could be an unsignalled display value and CEE will not guess. |
| any other string | Unrecognised. | **Fails closed** (`ambiguous_scale`). |

### Field location

The current PLoT build (`964fa37`, PR #184 — "flip probe mutates `observed_state.value`") emits
`value_scale` **nested under `margin_sensitivity.value_scale`**. CEE reads the row top level first,
then falls back to `margin_sensitivity.value_scale` (see `readValueScale` in `flip-proposal.ts`).
Either location is contract-valid; top level wins.

## Why this exists

PLoT changed flip-threshold values from model-scale to **display/user-scale** (carrying
`value_scale: "display"`). CEE's flip-proposal producer originally assumed model-scale `[0, 1]` and
inverted via `× cap`, so a real display-scale flip such as `delivery_gap = 6.055 story_points`
(cap 10) was rejected as `model_value_out_of_range` (`6.055 > 1`) — **no proposal chip emitted**.
The reproducible PLoT artefact:

| field | value |
|---|---|
| factor | `delivery_gap` |
| `flip_value` | `6.055` |
| `current_value` / `raw_value` | `5` |
| `unit` / `cap` | `story_points` / `10` |
| `movement` | `flipped` (alt winner `opt_hire_ftes`) |
| `value_scale` | `display` |
| build | `964fa37` |

## Display / executed invariant (display-scale)

The chip copy may **round for readability** (`6.055 → "around 6.1 story points"`), but the
`set_factor_value` action payload stores the **exact** value (`6.055`). The user is told the shown
figure is approximate ("around …"), while the system applies the precise scientific threshold —
so *meaning* is preserved even though the displayed and executed numbers differ. The producer
never applies a rounded value as if exact, and never displays a rounded value without the "around"
hedge.

## Producer hard rules (unchanged)

- Copy is a threshold **test**, never a guarantee: `Test X at N` / `Check whether X at N changes
  the result.` — never "this will flip the result".
- No raw normalised decimals, no `%` for non-percent units, no values that cannot round-trip
  through the handler's cap-range guard (a display value above `cap` fails closed).
- **Emit ⟺ egress safety parity (complete).** The egress chip-finaliser drops a chip for three
  reasons — leak-token, raw-decimal, and blank copy — and never drops a *protected* proposal for
  dedupe/budget (proposal chips win dedupe and claim budget first, with a unique `prop_<sha>` id).
  `emitProposedChange` mirrors all three at the materialisation site: forbidden-token
  (a superset of the egress leak-token list), `findChipRawDecimalLeak` (validated-proposal
  treatment, on label and message), and blank/whitespace label or message. Any of these returns
  `unsafe_copy` — **no chip and no pending** — so an egress-only chip drop can never orphan an
  `apply_proposed_change` pending (persisted pending ⟹ rendered chip), for *any* proposal emitter.
  Low-precision embedded copy (`around 6.1 story points`) and formatted currency/percent are
  unaffected.

## Out of scope

This contract governs the flip-threshold **proposal chip** (`flip-proposal.ts`, chip-click
`what_would_flip` EXECUTE path) only. It does **not** cover the deterministic what-would-flip
narrative copy (`composeWhatWouldFlip*`) or its fragile-edge label parity (tracked separately).

---

# CEE → PLoT contract: `run_analysis` intervention input scale (egress net, #284)

**Status:** active · flag-gated, default OFF; enabled on `cee-staging` for a monitored soak (2026-06-19) · **Scope:** outbound option interventions at the `run_analysis` projection boundary · **Owner:** CEE
**Related code:** [`src/orchestrator-v5/tools/plot-intervention-scale.ts`](../../src/orchestrator-v5/tools/plot-intervention-scale.ts), [`src/orchestrator-v5/build-turn-context.ts`](../../src/orchestrator-v5/build-turn-context.ts) (`loadScenarioSnapshotForRunAnalysis`) · **Flag:** `cee.plotEgressScaleNetEnabled` / env `CEE_PLOT_EGRESS_SCALE_NET_ENABLED`

This section covers the **opposite direction** to the flip-threshold contract above: how CEE sends
option intervention values **into** PLoT's `run_analysis` (the flat `{ factor_id: finite number }`
intervention map).

## Observed PLoT normalisation heuristic (build `78aea76`, empirically verified)

PLoT normalises a factor's intervention values **per-factor, by whether they look raw**:

- If **any** of a factor's intervention values across the compared options is `> 1` → PLoT treats
  them **all as raw** and divides by the factor's `observed_state.cap`.
- If **all** are `≤ 1` → PLoT uses them **directly** as already-normalised.

Evidence (direct, non-persisting `/v2/run` probes; `cap = 150000`, edge strength `0.9`):

| Inputs for one factor (two options) | PLoT outcome | Interpretation |
|---|---|---|
| uniform **normalised** `{0.8, 0.2}` | `0.706 / 0.176` | used **directly** |
| uniform **raw** `{120000, 30000}` | `0.706 / 0.176` | **÷cap** → same internal values |
| **mixed** `{0.8, 30000}` | **`0.000 / 0.176`** | the `0.8` is **÷cap'd to ~0** because the sibling is raw |

**Corrected mental model.** The earlier "PLoT always expects raw / always ÷cap" assumption was
wrong. PLoT handles **uniform normalised** and **uniform raw** option values **equivalently**. The
corruption case is **mixed-scale** factors: a normalised value is silently divided by cap (→ ~0)
when any sibling option's value for the **same factor** is raw (`> 1`).

**How the model was refined.** The original Step 0 verification confirmed the raw + `observed_state.cap`
behaviour for values `≥ 1` but did not exercise the mixed-scale interaction. The flag-ON staging soak
refined the model by showing that **mixed-scale factors are the actual corruption case** — uniform-scale
inputs (all-normalised or all-raw) are handled equivalently by PLoT and were never the failure mode.

## What #284 does (egress canonicalisation net)

At `loadScenarioSnapshotForRunAnalysis`, when `cee.plotEgressScaleNetEnabled` is ON, CEE
canonicalises every outbound option intervention to **raw user-scale** before PLoT, via the
evidence-gated rule in `plot-intervention-scale.ts`. Given the heuristic above:

- For **uniform-scale** scenarios it is behaviourally **equivalent** to OFF (PLoT already handles
  them) → low risk.
- Its corrective value is **eliminating mixed-scale corruption**: making all of a factor's outbound
  values raw means PLoT consistently ÷cap's them, so a normalised sibling can no longer drag one
  option to ~0.
- Flag **default OFF**; byte-identical no-op when OFF. **Read-only**: never mutates the persisted
  graph; the PLoT request stays the flat `{ factor_id: finite number }` map; intervention-level
  `raw_value` / `cap` / `unit` are **never** sent.

## Evidence-gated rules + diagnostic categories

Per numeric intervention (no silent corruption; double-conversion-safe):

| Category | Behaviour |
|---|---|
| `raw_value_used` | Explicit finite `raw_value` wins. If it disagrees with `value × cap` (normalised input) or `value` (raw-looking input) beyond 0.5% tol → also flagged `inconsistent_scale` (surfaced, never repaired). |
| `inconsistent_scale` | Diagnostic-only flag when explicit `raw_value` disagrees with the normalised or raw-looking `value` beyond tolerance. The egress net does **not** repair by inference; `raw_value` remains authoritative and the inconsistency is surfaced for audit and soak monitoring. (Orthogonal to the rule — co-occurs with `raw_value_used`.) |
| `cap_denormalised` | `value × cap`, **only** when the target factor's own `observed_state` proves `value ≈ raw_value / cap` (baseline `∈ (0, 1]`, `raw_value > value` — forces `cap > 1`). |
| `ambiguous_no_evidence` | `[0, 1]` on a capped factor **without** proving evidence → passed through unchanged (never blindly scaled). |
| `no_cap` | No usable cap → passthrough. |
| `encoded_verbatim` | Categorical/boolean (`value_type`, `encoding_map`, or boolean `raw_value`) → passed through verbatim, never scaled. |
| `passthrough` | Already-raw (`< 0` or `> 1`) on a capped factor → sent as-is. |

A **single redacted** diagnostic `run_analysis.intervention_scale_egress` is emitted per snapshot
load when noteworthy — **factor ids + rule counts only**, never magnitudes, caps, units, or user
text.

## Read-shape invariant (Track S relationship; PR B prerequisite)

`loadScenarioSnapshotForRunAnalysis` runs the persisted graph through `GraphV3.safeParse`, which
**strips undeclared `node.data`** and keeps the **declared top-level `node.interventions`**. The
egress net therefore reads option interventions from **top-level `node.interventions` post-parse**
(via `mergeInterventionSourceObjects`, which holds key/precedence parity with the numeric
`mergeInterventionSources`). Track S's persist-time `normaliseOptionInterventionContract` already
promotes `data.interventions` / slash-keyed entries to this canonical top-level location at the
write chokepoint, preserving `raw_value` / `value_type`.

> **Invariant for the future add-option encode path (PR B).** Any add-option encode/promote must
> **land interventions at top-level `node.interventions`** (so they survive `GraphV3.safeParse` and
> are visible to the egress net) and must **compose with #281's fail-closed value/unit guard** —
> do not duplicate or fight it.

## Acceptance + rollout status

Flag-ON staging acceptance passed and rollback proven (2026-06-19). The net is currently enabled on
`cee-staging` for a monitored soak (build `dbe8d22`), watching `run_analysis.intervention_scale_egress`
(`cap_denormalised` / `ambiguous_no_evidence` / `inconsistent_scale`). Rollback = set the flag OFF
and redeploy (config is read once per process, so a restart is required for the change to take effect).
