# The spine witness was passing for the wrong reasons. Three defects, found by auditing it against the build it is supposed to FAIL.

**22 Sep 2026 · audited and re-baselined on deployed `c12a54d` · signed-in owner, 0 SKIP**

The consolidated harness (`witness/spine.mjs`, banked at `28a7488c`) reported
**15 PASS · 5 FAIL** and I was one merge away from treating that as the reference
the post-deploy run would be compared against. Auditing it line by line — not
re-reading it, *classifying every assertion by what else could satisfy it* —
found three ways it could go green on a broken build.

Honest re-baseline after the fixes: **16 PASS · 6 FAIL · 0 SKIP**.
The old number was wrong in the flattering direction.

---

## Defect 1 — criterion 5 passed whenever the probe found no data ⛔ SEVERE

```js
const diverged = f?.har && res.j?.graph_hash && res.j.graph_hash !== f.har;
rec('5', 'the two reads never silently disagree', diverged ? 'FAIL' : 'PASS', …)
```

`f` is the `run_analysis` handler-fact row. If it is missing, `diverged` is
falsy and the row reads **PASS**.

**Why that is exactly wrong here:** #1679's whole purpose is to make a divergent
analysis *refuse*. A refusal plausibly writes **no handler fact row at all** —
so the fix's success state and the probe's blind spot are the same observation.
The row would have flipped to green after deploy **without proving anything**,
and I would have reported the criterion met.

Now classified explicitly, with indeterminate treated as a failure to measure:

```js
const refusedCleanly = res.status === 200 && /stopped rather than mix|changed while this analysis/i.test(txt(res));
const both = Boolean(f?.har) && Boolean(res.j?.graph_hash);
const verdict = refusedCleanly ? 'PASS' : both ? (res.j.graph_hash === f.har ? 'PASS' : 'FAIL') : 'FAIL';
```

On `c12a54d` it now fails **for the right reason** — both hashes present and
genuinely different: `resp=56eacec6adfe` vs `fact=96cae050527f`.

## Defect 2 — criterion 4 only ever tested the ACCEPT direction ⛔ DANGEROUS

The proportion row asserted the reply says `Updated`. It never read the
persisted value, and there was **no case at all** for the shape that the
rejected first version of #1686 corrupted.

Two rows added:

- **`the accepted proportion actually PERSISTS as 0.8`** — saying "Updated" is
  not the claim; the claim is that `0.8` reached the model. (`f9223d57`,
  `unit:'scale'`, no cap, no raw_value — the legitimate accept case.)
- **`a CAPPED scale factor does NOT swallow a bare 0.8`** — the regression guard.

The control fixture is **copied verbatim from live staging**, not invented:
`fac_internal_pipeline` `{cap:100, unit:'scale', value:0.2, raw_value:20}`, one
of **128 real `cap=100` proportion-unit factors** (contrast control in the same
query: 2,611 proportion-unit factors overall, 663 of them capped). Here
`value = raw_value/cap`, so a bare `0.8` means **80, not 4/5**.

This gives a genuine **discriminating pair**, because today the product refuses
`0.8` on *both* factors with the same sentence. After #1686 the two rows must
part company: uncapped → accept **and persist 0.8**; capped → **still refuse**.
A build that accepts both is corrupting models and now goes red.

Measured on `c12a54d`: capped control **PASS** (persisted `0.2`, untouched) —
this row must *stay* PASS through #1686.

## Defect 3 — negative assertions passed on errors

`!/Updated/i` is satisfied by an HTTP 500, a 409, or an empty body. Two rows
("retry does NOT claim an edit", "a REAL rescale is still refused") were
conjoined with `answered(r) = r.status === 200 && assistant_text non-empty`, so
a transport failure can no longer read as correct product behaviour.

## Also fixed — the harness could lose the run

A transient `ECONNRESET` to staging aborted the first hardened run at criterion
3 and destroyed every result after it. Post-deploy that would have cost the
completion evidence. Now: connection-level failures retry twice **under the same
`turn_id`** (so the retry rides the service's own idempotent-replay path and
cannot double-write), and each criterion runs inside `step()` — a crashing block
records `BLOCK CRASHED — criterion NOT measured` as a **FAIL** rather than
vanishing from the roll-up.

---

## Baseline to compare the post-deploy run against

```
### 16 PASS · 6 FAIL · 0 SKIP   on build c12a54d
criterion roll-up: 1=PASS · 2a=PASS · 2b=FAIL · 3=PASS · 4=FAIL · 5=FAIL · 6=PASS
```

The 6 failures map exactly onto the three open PRs, with no residue:

| rows | criterion | PR |
|---|---|---|
| 3 | 2b — replay narrates an edit it did not make (`status=applied`, "Updated … 17 → 14") | **#1685** |
| 2 | 4 — proportion refused, and not persisted | **#1686** |
| 1 | 5 — two reads of one analysis turn genuinely disagree | **#1679** |

**What must happen after deploy:** those 6 flip to PASS **and the other 16 stay
PASS** — in particular the capped-scale control, which is the one row that a
careless #1686 turns red.

⚠ Two anti-false-green properties retained: receipt rows report **SKIP, never
PASS**, without a signed-in owner (a guest mints no `model_version`, so "no new
version" is vacuous there); and the deployed build is printed and written into
the JSON, so a green run against the wrong build proves nothing.

Run: `WITNESS_OWNER=… WITNESS_JWT=… node witness/spine.mjs` (exit 0 only if every row passes).
