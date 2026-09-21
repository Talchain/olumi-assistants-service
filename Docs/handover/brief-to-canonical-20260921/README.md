# ⚠ THIS IS AN ADDENDUM — NOT AN ENTRY POINT

**The entry point for Brief → Trusted Canonical Model is the Producer lane's
handover:** `output/producer-handover-20260921/HANDOVER.md`.

Read that first. It owns the core finding and states it more precisely than
this folder did: lost provenance has **two boundaries in series** (B1
`projector.ts:2006` `if (citedFigures.length === 0)` → stamps `cee_hypothesis`;
B2 `stated-amounts.ts` broken two ways), and it **proves the duplicate option is
not the cause**. This folder's first draft implied the chain ran through the
duplicate option. **Theirs is right; prefer it.**

Two lanes measured the same defect independently and agreed:
- Producer: **1,433 of 1,442** `figure` records carry no `value`
- this lane: **15 of 22,488** stated items carry a numeric value (**0.067%**),
  across 4,000 draft events, 30-day Render census

Both also independently re-derived that `stated_value_scale_by_kind: {}` means
**no number**, not "no scale declared" (`seam.ts:441-448` counts valued items
only).

---

## What this folder adds that the Producer handover does NOT contain

Verified by search against their document — each of these returns **zero hits**
there:

| file | unique contribution |
|---|---|
| `02-THE-CAUSAL-CHAIN.md` | ⛔ **Two live rulings contradict** on whether a brief-derived number is the user's statement — `obligation-provenance.ts` (`brief_extraction: 'user_stated'`) vs the 2.714 guard. **Rule this before designing the user-authority layer.** |
| `04-…ROOT-CAUSES.md` §F3 | `schema-v3.ts:457-459` collapses a 12-member authorship enum to **two** by a ternary on `"inferred"` alone, so everything non-inferred **defaults to `brief_extraction`** |
| `04-…ROOT-CAUSES.md` §F5 | `intervention-extractor.ts:1243` early-return makes **every warrant check beneath it dead**; `factor-matcher.ts:31` lists `rate` as a synonym of `price`, which is how "Cut price by 15%" wrote `churn := 0.102` |
| `03-CURRENT-WORK.md` | #1674 exact state, CI, and the three banked branches |

Everything else here **duplicates** the Producer handover. Where the two differ
on the causal chain, **theirs is correct.**

---

## Other files

| file | note |
|---|---|
| `00-CURRENT-PIPELINE.md` | derived stage order + the 10 deterministic stages that can change semantics. Overlaps their §1 |
| `01-FIRST-WRONG-BOUNDARY.md` | the 30-day wire census + ruled-out list. Corroborates their B1 |
| `05-ARCHITECTURAL-JUDGEMENT.md` | overlaps their §5; the prompt-size measurements are additional |
| `06-SUCCESS-CONTRACT.md` | overlaps their §6 |

## Lane status

#1674 is at `3b9a0b9f` (required check's two real failures fixed, controls RED
on revert). **Approval is stale** — it was issued against `ce28ab22`.
This lane stops after #1674 pending release control.
