# Warranted reference sets (R) — HARD benchmark input, not built yet

R is the blind warranted reference set for FGQ recall — the third
human-judgement input, alongside Paul's labels and judge clearance (see
`R_PLAN.md` in the judge scaffold for construction design and cost).

Until one file per brief exists here, every report shows FGQ **precision +
safety only**, recall is `pending R`, and no claim about which arm found more
warranted content can be made.

Format — `{brief_id}.json` (e.g. `buy-vs-build.json`):

```json
{
  "items": [
    { "id": "r1", "kind": "positive", "description": "vendor lock-in risk" },
    { "id": "r2", "kind": "affirmative_defer", "description": "payback horizon unstated" }
  ]
}
```

- `kind: "positive"` — a warranted element; satisfied only by a grounded+useful
  matching element.
- `kind: "affirmative_defer"` — a warranted defer locus; satisfied ONLY by a
  grounded defer/uncertainty/clarification artifact, never by mere absence.
- `description` — used for element matching (exact-normalized in the smoke
  stub; the cleared judge owns real matching).
