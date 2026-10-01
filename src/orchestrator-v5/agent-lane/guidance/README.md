# Guidance selector leaf — INERT

Policy source: Talchain/olumi-programme-docs, rc/reasoning-coach-20261001 @
`6c4fbffdb4a7f783de9efbfb9eb2f2a25a73079b` (board #85, Ticket 1).

The adjacent policy JSON and the acceptance fixture are byte-identical to that commit. `policy.ts`
contains its typed selection, row, copy and method-turn constants; tests assert their equality.
REASONING COACH's [ruling on #85](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5933526864)
clarifies `A-WIDEN-SAME-KEY-HIDDEN`: when every option fails the limit, there is no plan to stress,
so pre-mortem is silent unless explicitly requested. This guard preserves the pinned behaviour case.

- `selectGuidance(signals, guidance)` returns at most two rows with copy, content-free state-key hashes,
  suppression reasons, and an optional method dispatch description. It never runs a method.
- `renderCopy(row, signals)` uses typed labels. An unavailable field is null, never an invented label,
  internal id, or unresolved template. Coach-edits can carry its fixed title before edit labels arrive.
- `stateKeyHash(fields)` recursively sorts object keys and hashes canonical JSON to 12 hex characters.
  The selector sorts the policy's unordered id/edit sets without modifying inputs.
- `checkMethodTurn(policy_id, reply, inputs)` checks every deterministic text rule and returns failed ids.
  Widen's structured `WD-S-*` mechanism checks are **not implemented** here; AI HARNESS owns them.

`GuidanceState` accepts content-free `state_key_hash` records, or `state_key_fields` for the contract
fixtures. Only hashes leave the selector; this module neither stores nor reads conversation state.
The fixture's additional `run.leader_option_id` is typed copy/key metadata. Optional `value_hash` and
`strength_band_hash` in path descriptors let the caller signal item changes without passing raw values.
Missing run/item key fields are omitted, as in the pinned fixtures; the wiring owner must supply them
to distinguish subsequent runs and item values. A terminal guidance record with no key stays hidden.

There is no production caller. AI HARNESS owns signal construction, `coaching_state` persistence,
method dispatch, and replacing the static chips after its wiring prerequisites land.
