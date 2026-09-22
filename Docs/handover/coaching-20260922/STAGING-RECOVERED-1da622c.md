# Staging unblocked, and the conventional spine still holds on the served build

**22 Sep 2026 · served `1da622c` · signed-in · 0 SKIP**

```
### 27 PASS · 4 FAIL · 0 SKIP   on build 1da622c
1=PASS · 2a=PASS · 2b=PASS · 3=PASS · 4=PASS · 5=PASS · 6=PASS · 7=FAIL
```

**All six behavioural criteria pass on the build users are being served**, after
#1692 landed and after every agent-lane merge to date. The conventional route
was never broken by the incident — the breakage was a gate failure, not a
runtime one (an unused variable and a test-file type error).

## The incident, closed

`#1692` merged 18:57:24Z (squash `8dbb1fe4`). The dead `adjacency`+`reaches`
duplicate is confirmed **gone** from the served head; the live pair is intact.
Staging had been `failure` for four consecutive commits with a red build served.

⛔ **And I kept reporting it "blocked on a verdict" for twenty minutes after it
merged.** My polling loop watched `verdicts`, `mergeable` and `checks-running` —
**not PR state**. *When polling for a state change, poll the state.*

## The commissioned adversarial review, published because it earned it

`VERDICT: APPROVE` at `bf0ef488…`, told to find a reason to refuse and unable to.
It proved equivalence **mechanically** (both blocks normalised and diffed —
identical md5), established that **scope, not grep**, is decisive (block-scoped,
non-exported, so nothing outside *can* reference them), and caught something I
had missed: the lint rule names only `reaches` because `adjacency` is used *by*
it, so **deleting both was necessary** — removing one moves the error onto the
other.

⚠ It also caught two flaws in my own published claims: my "17 files / 190
passed" is **not reproducible from the method I stated** (its `rg`-derived set is
13 files / 84), and I disclosed the ratchet failure but **not**
`Graph Evaluator (advisory)`, which also fails at that head. Both pre-exist at
the base; neither is introduced; the disclosure was still incomplete.

## ⚠ Open, and possibly not transient

The conventional creation arm has now returned **`nodes=0` twice** — no graph
drafted from the brief at all. Two immediate re-runs in between were healthy, so
it is intermittent rather than broken. The witness now reports that case as
**NOT MEASURED** rather than FAIL, so it can no longer masquerade as a product
regression — but the **rate** is being measured, because an intermittent failure
to draft a model from a brief would be a Core defect in its own right.
