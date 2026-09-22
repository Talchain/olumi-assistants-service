# Which deterministic safeguards survive an architecture change?

**Measured 22 Sep 2026 at deployed staging `bd35cc9e`.** Written because the CEE route is now
the hedge: the question is not whether it is good, but which of its guarantees would have to
be **rebuilt** if the OpenAI-connected path wins — and which come along for free.

## Portable: the judgement lives in reusable modules

| safeguard | module |
|---|---|
| write truth | `orchestrator-v5/replacement/write-truthfulness.ts` |
| constraint verdict | `orchestrator/context/constraint-feasibility.ts` |
| leader-claim egress | `orchestrator-v5/compose/leading-option-egress-guard.ts` |
| leader-claim wire enforcement | `orchestrator-v5/compose/leading-option-wire-enforcement.ts` |
| canonical model revision | `orchestrator-v5/apply-operations.ts` |
| decision-review shape contract | `cee/decision-review/contract-gate.ts` |
| unbacked-receipt **decision** | `orchestrator-v5/compose/goal-target-receipt-guard.ts` |

Six of seven are pure functions over data. `enforceLeadingOptionClaimsAtWire` is the best
shape of all — it both decides *and* edits the text inside the module, so it transfers end
to end.

## ⛔ NOT portable: one enforcement action is inline in the controller

`decideGoalTargetReceipt` returns the verdict from a module, but the **action** on a `swap`
verdict is written directly into the controller at `turn-executor.ts:14381` and `:14393`:

```
graphForCommit = undefined;        // withhold the graph write
handlerFactsForCommit = [];        // withhold the "applied" receipt fact
```

Assignments to those two variables occur at **10 sites**, all inside
`turn-executor.ts` (8) and `handlers/edit-graph-dispatch.ts` (2). There is no module that
performs the withholding.

**Why this specific one matters.** The subtle half is the receipt, not the write. Committing
an `applied / noop:false` fact while the graph write is withheld grounds the *next* turn's
model on a phantom edit — `recent_changes` / `prior_facts` readers have no persisted graph to
cross-check against and take it at face value (recorded in-code as a DL-7 violation). A new
architecture inheriting `decideGoalTargetReceipt` would get the verdict and **silently lose
the withholding**, reproducing exactly the defect the guard exists to prevent — and it would
look correct, because the honest text would still be swapped in.

## Scale context

`turn-executor.ts` is **17,361 lines**; `route-v2.ts` is **8,391**. The safeguards are mostly
well-factored out of them, which is better than those numbers would suggest. The risk is
concentrated in the few places where a module decides and the controller acts.

## Recommendation

If the OpenAI path proceeds, the smallest thing that preserves this guarantee is to move the
withholding beside its decision — have `goal-target-receipt-guard.ts` return the
*consequences* (`{ withholdGraphWrite: true, withholdFacts: true }`) rather than a verdict the
caller must know how to honour. That is a contained change, it is testable without a
controller, and it converts a convention into a contract.

**Not proposed as work now** — it is an architecture-migration precondition, not a live
defect. The guard is unconditional and correct today.
