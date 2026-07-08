# R-set seeds — PROVISIONAL, NOT RATIFIED, NOT loaded as R

These `{brief_id}.seed.json` files are **memory-aid scaffolding only**. They live
in this `seeds/` subdirectory ON PURPOSE: the fixture loader reads R only from
`fixtures/r-sets/{brief_id}.json` (the parent dir), so nothing here is picked up
as a warranted reference set. FGQ recall stays `pending R` and the report stays
watermarked until real R exists — exactly as intended.

## Why a seed is not R (R_PLAN discipline)

R must be **brief-first, human-anchored, and arm-blind**: every warranted item
cites a span of the brief, and it MUST include brief-implied items that no arm
produced. A pool of observed M2 proposal loci is the opposite construction — it
is anchored to model output, not the brief, and it is **circular** (using arm
output to score arm output). So a seed is a starting checklist a human can react
to, never the reference set itself.

## Ratifying a seed into real R (human step — Paul or a delegated labeller)

1. Open the brief and the seed side by side. Ignore the seed's suggested items
   at first; read the brief and write down, from the brief alone, the warranted
   loci a good review SHOULD surface (positives) and the warranted defer/clarify
   loci (affirmative_defer). Cite a brief span for each.
2. Only then consult the seed to catch anything you missed — but add brief-implied
   items the seed lacks, and delete seed items not grounded in the brief.
3. Set each item's `kind` (`positive` | `affirmative_defer`) and a `description`
   the judge can match on.
4. Write the ratified items to `fixtures/r-sets/{brief_id}.json` (parent dir),
   shape `{ "items": [ { "id", "kind", "description" } ] }`. THAT file is the one
   the loader reads. Once every fixture has one, `anyRPending` clears.

Estimated effort (R_PLAN): ~6–10 items/brief, ~5–10 min/brief.

## Seed file shape (this dir)

```json
{
  "ratified": false,
  "brief_id": "buy-vs-build",
  "note": "memory aid only — pooled, de-authored M2 proposal loci; NOT R",
  "candidate_items": [
    { "suggested_kind": "positive", "description": "...", "seen_count": 3 }
  ]
}
```
`seen_count` = how many M2 runs surfaced a near-duplicate locus (a weak salience
hint, not evidence). `suggested_kind` is a guess from proposal type, to be
overridden by the human.
