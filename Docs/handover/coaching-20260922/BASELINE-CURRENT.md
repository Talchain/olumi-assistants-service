# The current baseline — 25 assertions, one build, 0 SKIP

**`a459d23` · signed-in · 22 Sep 2026 · `witness/spine-a459d23-full.log`**

```
### 19 PASS · 6 FAIL · 0 SKIP   on build a459d23
criterion roll-up: 1=PASS · 2a=PASS · 2b=FAIL · 3=FAIL · 4=PASS · 5=FAIL · 6=PASS
```

Every failure maps to an open PR. **No residue** — there is no failing row that
nobody owns.

| rows | criterion | owner | state |
|---|---|---|---|
| 3 | **2b** replay narrates an edit it did not make (`status=applied`, *"Updated … 17 → 14"*) | **#1685** | green at `4cd3ee29…`, awaiting exact-head verdict |
| 2 | **3** a reused turn_id claims the new value was applied (`after.raw_value: 25` while the model holds 14) | **#1688** | stacked on #1685, CI queued |
| 1 | **5** two reads of one analysis turn genuinely disagree | **#1679** | green at `41915bf3…`, awaiting exact-head verdict |

## How this number moved, and why each move was a correction downward

| | assertions | result | what changed |
|---|---|---|---|
| first run (`c12a54d`) | 20 | 15 / 5 | — |
| audit | 22 | **16 / 6** | criterion 5 passed whenever the probe found **no data**; criterion 4 never read the **persisted** value and had no capped-scale control; negatives passed on a 500 |
| #1686 deployed (`a459d23`) | 22 | **18 / 4** | criterion 4 flipped, with a discriminating pair — nothing regressed |
| criterion 3's other half | 25 | **19 / 6** | the durable key was only tested as a **concurrent race**, never as a reused id carrying a different instruction |

⭐ **Every revision made the number worse, and every revision was right.** A
witness that only ever improves is measuring the author's confidence, not the
product.

## What must happen for the goal to be met

The 6 flip to PASS **and the 19 hold** — in particular:

- **`a CAPPED scale factor does NOT swallow a bare 0.8`**, the row a careless
  change to the unit boundary turns red (the rejected first version of #1686
  would have, ~100× on real factors);
- **`a reused turn_id writes nothing`**, which passes today because the durable
  key genuinely works — #1688 must fix the *narration* without weakening the
  *key*.

Run: `WITNESS_OWNER=… WITNESS_JWT=… node witness/spine.mjs` — exit 0 only if
every row passes. Receipt rows report **SKIP, never PASS**, without a signed-in
owner; the build is printed and written into the JSON, so a green run against
the wrong build proves nothing.
