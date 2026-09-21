# Measured failures → first wrong boundary

Every row cites code at `ce28ab22`/`3b9a0b9f` or a measurement made 21 Sep 2026.
**Ruled-out hypotheses are listed so the successor does not re-derive them.**

---

## F1 — User figures lose their quantity (THE UPSTREAM ONE)

**First wrong boundary:** `src/cee/draft/records/grammar.ts:686`
`required: ["kind", "source_quote"]` — `value`/`unit` optional on stated items.

**Evidence:** Render `cee.draft.records.wire_histogram`, 30d, fully paginated:
4,000 events · 22,488 stated_items · 8,273 of kind `figure` ·
**15 carrying a numeric value (0.067%)** · 3,996/4,000 events with an empty
`stated_value_scale_by_kind`. Positive control: both counters register non-zero.

**Ruled out:** the seam dropping `value` (`seam.ts:305-313` carries it;
`seam.ts:526-543` is a derived completeness guard); the grammar being unable to
express it (`grammar.ts:647`); `stated_value_scale_by_kind` being a binding path
(one occurrence repo-wide, telemetry only).

**Silent-loss amplifier:** `projector.ts` — every value branch gates on
`typeof item.value === "number"` (`:2764,:2778,:2794,:2827,:2850,:2921`). A
valueless `figure` gets no `data`, no `observed_state`, **and no `dropped`
disclosure**. The prose-rescue `soleStatedQuantityInSpan` exists but is scoped
to `goal` + `role:"target"` only (`projector.ts:3007-3014`).

---

## F2 — Duplicate options; the user's own option is the empty one

**First wrong boundary:** F1, plus `instruction.ts:332-341` + `:317-322`, which
**unconditionally** ask the model for extra options and a flagged baseline.

**In-repo production witness** (`stated-option-figure-adoption.ts:5-18`, 9 live
staging drafts, `8e4efce0`, 2026-09-14) on exactly this brief:

```
"increase the Pro plan price from £49 to £59 …"  from_brief   {}      ← 0
"Raise Price to £59 Immediately (No Feature Tie)" ai_inferred  2 values
"Raise Price to £59 with Feature Release"         ai_inferred  2 values
"Hold Price at £49"                               ai_inferred  2 values
```

**5 of 12 stated-option instances are wired to a factor they carry no value for.**

**Why no dedupe catches it — three exist and all three correctly decline:**
- signature dedupe keys on interventions (`graph-validator.ts:251-256`); the
  user's option carries `{}` and the twins carry different levels;
- label dedupe needs token containment (`option-rephrase-merge.ts:277-280`);
  "increase…from £49 to £59" vs "Raise Price to £59" contains neither way;
- `options-identical-graceful-dedup.ts:189-198` has a label-distinctness floor.

**Ruled out:** absence of dedupe machinery. It exists and is keyed on the wrong
thing. **No semantic comparison exists** — `detectOptionSimilarity`
(`structure/index.ts:1697`, Jaccard over shared factor targets) only *reports*.

---

## F3 — £49/£59 lose user authority; invented options gain it

**First wrong boundary:** `src/cee/transforms/schema-v3.ts:457-459`

```ts
const source: "brief_extraction" | "cee_inference" =
  node.data.extractionType === "inferred" ? "cee_inference" : "brief_extraction";
```

A 12-member `observed_state.source` enum collapses to **two**, by a ternary on
`"inferred"` alone — so **absent `extractionType` defaults to `brief_extraction`**.
Combined with `obligation-provenance.ts` classing `brief_extraction` as
`user_stated`, **the default authorship of a machine-authored value is "the user
said it."** `analysis-admission.ts:851` counts that toward
`material_user_stated`, and the threshold is **one** parameter — so it licenses
`comparative_leader`.

**The decisive quote** (`stated-option-figure-adoption.ts:20-23`):
> *"the sibling's price intervention is stamped `source: "brief_extraction"`,
> `reasoning: "the amount is stated in the brief"`, raw_value 59. The figure the
> user typed reached the model's paraphrase and not the user's own option."*

**Ruled out:** any code path upgrading a brief-derived figure to a `user_*`
stamp. The only genuine writers of `user_override` are
`canonicalise-value-ops.ts:554` and `set-factor-value.ts:642`, both gated on a
**structured patch op**, neither reading the brief. (Contrast control:
`USER_EDIT_SOURCE` finds both writers, proving the search shape works.)

---

## F4 — "monthly churn under 4%" becomes `<= 4%`

**First wrong boundary:** the representation itself.
`src/schemas/assist.ts:401-407` — `operator: z.enum([">=", "<="])`.
Also `graph.ts:204-208`, and `anthropic-graph-schema.ts:395` makes `<`
**ungrammatical for the drafting model**, so the widening happens before any
rejectable value exists.

Every producer is instructed to widen: `defaults-v187.ts:367`
(`"under/below/at most" → <=`), `extractor.ts:304-313`, `instruction.ts:263-269`.
The user is then told `"…must be at most 4%."` (`format-confirmation.ts:131-139`)
**with no flag that the bound changed.**

**Second, compounding widening:** `defaults-v187.ts:358-361` instructs
`"reduce churn below 4%" → goal "Achieve Retention Above 96%", threshold 0.96` —
a strict churn bound becomes a non-strict retention bound.

**Contrast controls:** `rg "['\"](lt|lte|gt|gte)['\"]"` → **0 files**, while
`"operator: z.enum"` → 3 files; `"unsupported operator"` → 0 while `"unsupported"`
→ many. The vocabulary exists; it simply has no strict member.

**This directly violates release-contract item 4** — unsupported semantics are
silently approximated, not exposed.

---

## F5 — Invented churn interventions

**First wrong boundary:** `src/cee/extraction/intervention-extractor.ts:1243`

```ts
if (v4Interventions && Object.keys(v4Interventions).length > 0) { … return buildInterventionsFromV4Data(…) }
```

When the model emits interventions — **which it always does on this path** —
every warrant check beneath is **dead code**. Corroborated independently at
`no-op-target-repair.ts:16-21`.

The only remaining warrant is a **whole-brief magnitude scan not bound to the
target factor**, and its own author disowns it
(`intervention-extractor.ts:1022-1032`):
> *"a model-INVENTED level earns `brief_extraction` / high whenever its
> de-normalised magnitude appears ANYWHERE in the brief … FACTOR-LABEL BINDING
> DOES NOT EXIST."*

And failing it **changes only the label, never the value** (`:993-999`):
> *"47 of 47 interventions carrying model-chosen normalised lever levels
> (0.8, 0.75, 0.45 …) that appear nowhere in the user's words, all stamped
> brief-extracted at high confidence."*

**The pricing→churn mechanism, measured:** `factor-matcher.ts:31` lists
`rate` as a synonym of `price`, so "Cut price by 15%" semantically matches
**"Churn Rate"** → `churn := 0.102` stamped `exact_id` / high /
`brief_extraction` (measured at CEE `51704f12`).

**Ruled out:** "no checks exist". Six real refusals exist
(`intervention-extractor.ts:1357-1383`, `:1461-1467`, `factor-matcher.ts:139-141`,
`projector.ts:3959-3960`, `:3904-3908`, `analysable-option-gate.ts:494-502`) —
**every one of them lives on a path the model's own emission bypasses.**

---

## F6 — The right number on the wrong option

`option-effect-reference-trust.ts:6-19`, served staging prompt v201: all six
`sets_to` option→factor links **off by one**:

```
[20] "Raise to £59 option sets Pro Plan Price"  sets_to 59 → claims[17] "Hold at £49"
```
> *"FOUR LANDED ON `option_refinement` — a LEGAL source kind — so they passed
> every existing check and the product showed the person "hold at £49" priced at £59."*
