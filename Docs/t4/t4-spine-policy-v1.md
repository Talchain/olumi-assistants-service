# T4 Spine Policy v1 — SHELL (structure only; doctrine PENDING)

**Status:** scaffold. This file is the agreed home for the T4 spine's
implementation-facing policy. The substantive freshness/claim doctrine is
**deliberately absent**: it is a held science/product decision pending
Paul/Neil. Slice 3 runtime implementation does not start until the pending
sections below are filled by that decision (or explicitly approved defaults).

## The one rule in force now

> **When freshness or authority is unknown, hold/refuse rather than apply or
> claim.**

That is the entirety of the policy content encoded before doctrine clears.
Everything is held until this file says otherwise: no mutation application,
no analysis-grounded confident claim, and no relaxation of any
claim-permission class may cite this shell as authority.

## Fail-closed posture until policy clears

- The executable expression of "hold everything" already exists and is
  guarded in CI today: `DEFAULT_CLAIM_PERMISSIONS` is all-`held`
  (`src/orchestrator-v5/context/frame/claim-permissions.ts`), pinned by the
  build-frame guard test (held-science stem scan + default-held assertion in
  `src/orchestrator-v5/context/frame/__tests__/build-frame.test.ts`) and by
  the zero-consumer contract (no production reader of `claimPermissions`
  exists). Moving any class from `held` requires the certification pathway
  (#305 R2 + Neil/Jinghui sign-off), not an edit to this file alone.
- No loader/parser is built for this shell: nothing at runtime consumes
  policy yet, and building consumption before the doctrine exists would
  invite placeholder rules. The loader (if one is needed at all — a typed
  module may serve better than file parsing) is a slice-3-open decision,
  designed against the filled-in policy, with tests proving that an unknown
  or missing policy resolves to held/refused.

## PENDING — decisions this shell does NOT make (Paul/Neil)

Each item below is intentionally empty. Filling any of them is a doctrine
decision; an implementation that needs one of these answers must stop and
ask, not improvise a placeholder.

1. **Stale taxonomy** — what counts as stale; whether/when age thresholds
   apply; how `unknown` relates to `stale` for gating purposes.
2. **Trust boundary for stale state** — when (if ever) a stale analysis may
   still ground a claim or a mutation decision.
3. **Apply semantics** — when Olumi may say a change is safe to apply;
   confirmation requirements; any auto-apply posture.
4. **Confidence language** — permitted wording for certainty/uncertainty on
   analysis-grounded statements.
5. **Stale-state user-facing wording** — the copy shown when something is
   held for freshness reasons.
6. **Structural-versus-tunable doctrine** — the classification and its
   worked examples.
7. **EVPI/VOI naming** — whether and how value-of-information concepts are
   surfaced or named.
8. **Gate Zero relaxations** — any move of a held-science claim class to
   `allowed`.

## Consumption contract (structural sketch only)

When doctrine lands, slice 3 will consume this policy at the mutation
referee's verdict seam (per the landed T4.0 contract,
`Docs/t4/dual-model-typed-mutation-handoff-contract.md`) and at no other
point; prose surfaces continue to be governed by the existing egress gates.
The referee's default verdict remains **held** regardless of policy-file
presence — absence of policy is treated as "unknown authority" under the one
rule above.
