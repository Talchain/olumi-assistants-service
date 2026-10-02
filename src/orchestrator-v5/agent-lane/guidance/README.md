# Guidance selector leaf — INERT

Policy source: Talchain/olumi-programme-docs, rc/reasoning-coach-20261001 @
`734de2c98790dd010873448e855bd11ab219b836` (board #85; T1 re-pin, REASONING COACH lease 5937451355).

The adjacent policy JSON and the acceptance fixture are byte-identical to that commit (35 cases, 29 checker
fixtures). `policy.ts` contains its typed selection, row, copy and method-turn constants; tests assert their
equality. The contract's reference implementations are `tools/select_ref.py` and `tools/check_method_turn.py` in the
same commit: every case agrees with them, and each of their 16 mutants turns at least one case red.

- `selectGuidance(signals, guidance)` returns at most two rows with copy, content-free state-key hashes,
  suppression reasons, and an optional method dispatch description. It never runs a method. On a `method` turn it
  returns `runs_method` plus, when the contract says so, `mode`:
  - `honest_limit` (an asked What-changes with no measured factor) with the `item` to firm up;
  - `choose_plan` (an asked pre-mortem with no licensed leader and no `user.selected_option_id`) with `choices`.
    The plan is never chosen for the user.
- `planOf` (the row's subject: licensed leader, else the user's pick, else the single option) and `methodPlanOf`
  (the plan a pre-mortem method stresses: licensed leader, else the user's pick) live in `plan.ts`.
- `renderCopy(row, signals)` uses typed labels. An unavailable field is null, never an invented label,
  internal id, or unresolved template.
- `stateKeyHash(fields)` hashes canonical JSON (object keys sorted, array order kept) to 12 hex characters, the same
  bytes as `computeResponseHash`. Key builders omit null and absent members (`selection.state_key_rule`).
- `entryKey(policy_id, item?)` is the `coaching_state` entry key: the policy id, or for a Strengthen item the policy id
  + `:` + `stateKeyHash({item_id})`. Never the raw id (it carries the user's words, and `->` fails the envelope key
  pattern). A Strengthen item's key includes its `value_hash`, so a changed estimate brings a dismissed item back.
- `checkMethodTurn(id, reply, inputs)` checks every deterministic text rule and returns `{pass, failed, targets}`.
  `targets` (pre-mortem only) names, per story, the first `supplied_items` entry it rests on. It also covers
  `RERUN-EXPLANATION` (`RX-*`). Widen's structured `WD-S-*` mechanism checks are **not implemented** here; AI HARNESS
  owns them.

`GuidanceState` entries are the on-disk form `{status, state_key_hash, turn_id}`; `state_key_fields` is still read
when present. Only hashes leave the selector; this module neither stores nor reads conversation state.

There is no production caller. AI HARNESS owns signal construction (`turn-context/guidance-signals.ts`),
`coaching_state` persistence, method dispatch, and replacing the static chips.
