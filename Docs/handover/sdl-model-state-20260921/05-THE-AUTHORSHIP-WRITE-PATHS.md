# Who may stamp a value as the user's — the three writers, and the gap

Measured 22 Sep 2026 at staging tip. Prompted by a **live witness from the
Canvas lane**, which is the part that makes this urgent rather than academic.

---

## The live symptom (Canvas lane, deployed build `5775e94e`)

Their seven-leg journey witness, leg 4, run against the **deployed** build:

> editing a factor value wrote `value 0 → 7` and fired the wire POST, but
> canonical state still read `source: "cee_inference"` with `extractionType`
> merely deleted.

**The product recorded Olumi as the author of a number the user had just
typed.** DecisionGuideAI #1846 (merged, staging `19a7bb99`) closes the UI half.

⚠ **Not independently reproduced by this lane** — I did not run their harness.
Recorded as their measurement, attributed. What follows is the CEE-side
analysis of how that symptom is *possible*, which I did measure.

---

## There are exactly THREE production writers of `user_override`

| # | site | how |
|---|---|---|
| 1 | `orchestrator/tools/edit-graph.ts:3194` | via `stampUserEditProvenance` |
| 2 | `orchestrator-v5/handlers/gm-held-execute.ts:495` | via `stampUserEditProvenance` |
| 3 | `orchestrator-v5/tools/handlers/set-factor-value.ts:642` | direct — `source: appliedProvenance?.source ?? USER_EDIT_SOURCE` |

### The stamper's gate is narrow, and every conjunct can silently decline

`canonicalise-value-ops.ts:531` `stampUserEditProvenance` returns the op
**unchanged** unless *all* of:

```ts
op.op === 'update_node'                                   // update_node ONLY
asRecord(op.value) !== null
asRecord(value[OBSERVED_ROOT]) !== null                   // an observed_state object
operationWritesObservedValue(...) || userValueTargets.has(op.path)
Object.prototype.hasOwnProperty.call(observed, 'value')   // own property `value`
```

Corroborated in-repo: `graph-management/field-safety.ts:483` —
*"`stampUserEditProvenance` is `update_node`-ONLY"*.

**A value write that is not an `update_node` patch op carrying `observed.value`
gets no stamp — and a pre-existing `source: "cee_inference"` then survives the
user's edit untouched.** That is exactly the shape of the live symptom.

---

## ⛔ THE GAP

The Canvas symptom means the write reached canonical state **without passing any
of the three writers above.** Value updated, authorship not.

⚠ **UNVERIFIED: which path it took.** I have not traced their specific wire
event to a CEE handler. That is the next measurement and it is small: capture
the event their leg 4 fires and find which handler consumes it.

**Why this belongs to SDL, not Canvas:** #1846 fixes the *client's* local stamp.
If a server path can still write a value while leaving `cee_inference` in place,
the canonical record remains wrong no matter what the client does — and
canonical authorship is this lane's.

---

## ⚠ A stale claim in the source, load-bearing where it sits

`orchestrator-v5/routing/route-with-tool-use.ts:1855` declines a repair partly on
this ground:

> *"It is also a change to the highest-traffic write path in the estate
> (`stampUserEditProvenance`, **six call sites**)"*

**Measured, call expressions only (name + `(`), definition excluded:**

| scope | count |
|---|---|
| production (`src/`, non-test) | **2** |
| including tests | **14** |

Contrast control, identical query shape on a helper in the same file:
`asRecord(` → **21**, so the query finds call expressions correctly.

**Neither count is six.** I am not claiming which number the comment intended —
only that it matches neither, and that it is used as a reason not to make the
stamp discriminate. An argument resting on "highest-traffic … six call sites"
is weaker against **two** production callers. Worth re-deciding on the real
number rather than inheriting the sentence.

---

## Relation to the contradiction already banked

`02-THE-CAUSAL-CHAIN.md` records the CEE-side inversion: `brief_extraction`
classifies as `user_stated`, so **the system's reading of prose is recorded as
the user's statement.**

The Canvas witness is the **mirror image**: a number the user genuinely typed is
recorded as **the system's**.

⭐ Both are the same defect class — *the provenance stamp does not describe what
happened* — and they fail in **opposite directions**. A fix scoped to one
direction will leave the other live. Any general authorship work should be
specified against both, or it will look complete and not be.
