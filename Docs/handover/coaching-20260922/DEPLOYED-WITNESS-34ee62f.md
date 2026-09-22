# #1685 deployed — the lie is gone, but its headline capability was dead

**22 Sep 2026 · served `34ee62f` · signed-in · 0 SKIP**

```
### 24 PASS · 3 FAIL · 0 SKIP   on build 34ee62f
criterion roll-up: 1=PASS · 2a=PASS · 2b=FAIL · 3=FAIL · 4=PASS · 5=PASS · 6=PASS
```

| build | assertions | result |
|---|---|---|
| `c12a54d` | 22 | 16 / 6 |
| `a459d23` (#1686) | 25 | 19 / 6 |
| `c6f6dec` (#1679) | 25 | 20 / 5 |
| **`34ee62f` (#1685)** | 27 | **24 / 3** |

## What #1685 fixed — real

```
PASS [2b] retry does NOT claim an edit — "That change had already been recorded…"
PASS [2b] graph_patch does NOT say applied — status=noop
```

The false success narration is **gone on deployed staging**. That was the core
defect.

## What it did not fix, and why

```
FAIL [2b] reply RECONCILES current state — current=17 names=false claims_edit=false
```

> *"That change had already been recorded, so nothing new was written just now.
> **I couldn't read the current value just now — open the model to check it.**"*
> `graph_patch: status=noop target_id=bc936d4c after=null`

Measured on the same scenario immediately before the retry:
`label="Sales Cycle Length"  display_value="17 months"  raw_value=17`, and the
block carried `target_id`. **Nothing was unreadable.**

### Cause — one variable

```ts
1121:  const store = sessionStore ?? getSessionStore();        // resolved — always defined
1653:  if (patchTargetId !== null && sessionStore !== undefined) {   // ← the OPTIONAL PARAM
1655:      const currentGraph = await sessionStore.loadGraph(metadata.scenario_id);
```

The real route relies on the default, so `sessionStore` is `undefined` and the
branch short-circuits. Line 1909 already used the resolved `store`.

⭐ **Every existing test passed a store explicitly, so the acceptance seam could
not fail.** Identical shape to the mutant that survived the first #1688 suite:
*testing the object you edited, not the chain that reaches it.* The new test
calls `commitDirectAnswer` with **two** arguments — the deployed route's shape —
and mocks `getSessionStore`. Mutant restoring the old guard: **3 of 3 fail.**

**#1688 inherited the same defect** (its conflict branch shares the
reconciliation), so the fix is folded there rather than into a third PR.

## Nothing regressed

All 20 from `c6f6dec` still pass, including both criterion-5 controls
(`an UNDISTURBED analysis still completes`, `reports itself FRESH`) and the
capped-scale corruption control (`persisted value=0.2`).

**All 3 remaining rows are now owned by #1688** — 1 × reread, 2 × reused id.
