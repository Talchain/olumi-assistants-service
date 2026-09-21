# The first wrong boundary — measured, not reasoned

**Date:** 21 Sep 2026 · **Status:** MEASURED on deployed staging
**Clone:** `Talchain/olumi-assistants-service` @ `ce28ab22aa05959ac7b0eaf9e13a055b52772c4a`

---

## Verdict

**The user's figures never arrive as numbers.** The boundary is the
**brief → draft-records producer**, one hop earlier than every downstream
symptom that has been investigated so far.

## The measurement

Render logs, `cee-staging`, event `cee.draft.records.wire_histogram`,
30-day window ending 2026-09-21T19:23Z, fully paginated, de-duplicated by
`(timestamp, message)`.

| metric | value |
|---|---|
| unique draft events | 4,000 |
| `stated_items` total | 22,488 |
| ...of kind `figure` | **8,273** |
| ...carrying a numeric `value` | **15 (0.067%)** |
| events with EMPTY `stated_value_scale_by_kind` | **3,996 / 4,000** |
| `claims` total | 117,419 |
| ...declaring `value_scale` | 598 (0.509%) |

**Positive control:** both counters register non-zero (15 and 598), so the
near-zero is a real producer rate, not a blind probe.

## Why "empty `stated_value_scale_by_kind`" does NOT mean what it looks like

`src/cee/draft/records/seam.ts:441-448`:

```ts
for (const item of records.stated_items) {
  if (typeof item.value !== "number") continue;   // ← VALUED items only
  const bucket = (statedValueScaleByKind[item.kind] ??= { declared: 0, absent: 0 });
  if (item.value_scale === undefined) bucket.absent += 1;
  else bucket.declared += 1;
}
```

An empty map is **not** "figures exist but declare no scale". It is
**"no stated item carried a number at all"**. The scale is missing because the
*value* is missing.

## Ruled OUT — do not re-investigate

| Hypothesis | Verdict | Evidence |
|---|---|---|
| The seam drops `value` | **REFUTED** | `seam.ts:305-313` explicitly carries `value`, `unit`, `role`, `value_scale`; and `seam.ts:526-543` is a derived completeness guard that REDs if the rebuild falls behind the grammar |
| The grammar cannot express a number | **REFUTED** | `grammar.ts:647` declares `value: { type: "number" }` on stated_items |
| `figure` is not a stated kind | **REFUTED** | `grammar.ts:194` — `["goal","option","constraint","figure","cause"]` |
| `stated_value_scale_by_kind` is a binding path | **REFUTED** | ONE occurrence repo-wide (`seam.ts:456`), consumed by nothing. It is telemetry. Contrast control: `stated_items` appears in 153 files |

## The actual cause

`src/cee/draft/records/grammar.ts:686`

```ts
required: ["kind", "source_quote"],
```

`value` and `unit` are **optional** on every stated item. A model that emits
`{kind:"figure", source_quote:"raise the price from £49 to £59"}` is fully
conformant — and that is what it emits 99.93% of the time.

The number therefore survives only as **prose inside `source_quote`**, and
every downstream consumer that needs the quantity must re-derive it by parsing
that prose. That re-derivation is where authority is invented.

## Why this is UPSTREAM of the other failures

Each downstream symptom requires a quantity that does not exist at this seam:

- **£49/£59 provenance** — there is no number to attach provenance to.
- **duplicate options** — two options cannot be compared for equality on a
  value neither carries.
- **invented churn interventions** — an intervention magnitude has to come
  from somewhere; it is not coming from the user's stated figure.
- **`<4%` handling** — the threshold is prose, not a bounded quantity.

⚠ **UNVERIFIED at time of writing:** whether each downstream mechanism is
*wholly* explained by this. Three parallel evidence sweeps were running.
See `02-DOWNSTREAM-WITNESSES.md`.
