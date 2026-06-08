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
- **Emit ⟺ egress safety parity.** `emitProposedChange` runs the same raw-decimal predicate the
  egress chip-finaliser uses (`findChipRawDecimalLeak`, validated-proposal treatment) on the
  chip label and message. A proposal whose copy carries a non-exempt raw decimal — e.g. a
  high-precision value interpolated from a `factor_label` like `Confidence 0.4732` — is refused
  at emit (`unsafe_copy`: no chip **and** no pending), so an egress-only chip drop can never
  orphan an `apply_proposed_change` pending (persisted pending ⟹ rendered chip).

## Out of scope

This contract governs the flip-threshold **proposal chip** (`flip-proposal.ts`, chip-click
`what_would_flip` EXECUTE path) only. It does **not** cover the deterministic what-would-flip
narrative copy (`composeWhatWouldFlip*`) or its fragile-edge label parity (tracked separately).
