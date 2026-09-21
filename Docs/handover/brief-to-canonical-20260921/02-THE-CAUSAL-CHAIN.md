# The causal chain — brief to corrupted canonical model

All file:line refs at `Talchain/olumi-assistants-service` @ `ce28ab22aa05959ac7b0eaf9e13a055b52772c4a`.

---

## The one-paragraph answer

The draft grammar makes a stated item's **`value` optional**
(`grammar.ts:686`, `required: ["kind","source_quote"]`). Measured on the
deployed wire, the model supplies it on **15 of 22,488 stated items (0.067%)**.
So the user's figures arrive as **prose in `source_quote`**, not as quantities.
The number is then re-derived downstream and attached to whichever option the
**model** proposed — stamped `source: "brief_extraction"`, which
`obligation-provenance.ts:OBSERVED_STATE_SOURCE` classifies as **`user_stated`**.
**Result: the invented option carries the user's authority; the user's own
option carries nothing.**

## The chain, each step evidenced

| # | Step | Evidence |
|---|---|---|
| 1 | Grammar exposes `value` but does not require it | `grammar.ts:647` declares it; `grammar.ts:686` `required: ["kind","source_quote"]` |
| 2 | Model omits it on ~all stated items | Render `cee.draft.records.wire_histogram`, 30d: **15 / 22,488 = 0.067%**; 3,996/4,000 events empty. Positive control: counters register non-zero (15 and 598) |
| 3 | The seam faithfully carries the absence | `seam.ts:305-313` carries `value` when present; `seam.ts:526-543` derived completeness guard REDs if the rebuild lags the grammar. **The seam is NOT the defect** |
| 4 | The user's option node is minted from the stated item, valueless | `projector.ts:2484` + `:2740` (`provenance_class: "stated"`) |
| 5 | The prompt unconditionally asks for extra options | `instruction.ts:332-334`, `:336-341`, `:317-322` (baseline demanded even when the brief names alternatives) |
| 6 | Those mint their own option nodes, **with** values, via claims | `projector.ts:3223` + `:3321`, `provenance_class: "ai_inferred"` at `:3312` |
| 7 | The user's figure attaches to the AI's paraphrase, stamped as the user's | `stated-option-figure-adoption.ts:20-23` — *"The sibling's price intervention is stamped `source: "brief_extraction"`, `reasoning: "the amount is stated in the brief"`, raw_value 59. The figure the user typed reached the model's paraphrase and not the user's own option."* |
| 8 | `brief_extraction` is classified as **authorship** | `obligation-provenance.ts` `OBSERVED_STATE_SOURCE`: `brief_extraction: 'user_stated'` |
| 9 | No dedupe can match the two | signature dedupe keys on interventions (`graph-validator.ts:251-256`) and the user's option carries `{}`; label dedupe needs token containment (`option-rephrase-merge.ts:277-280`) and "increase…from £49 to £59" vs "Raise Price to £59" contains neither way |
| 10 | Only governor left is a numeric budget of 6 | `projector.ts:3866-3874` |

**In-repo production witness of exactly this brief** — `stated-option-figure-adoption.ts:5-18`,
9 live staging drafts, `8e4efce0`, 2026-09-14:

```
brief : "…increase the Pro plan price from £49 to £59 per month…"
⇒ options[]:
    "increase the Pro plan price from £49 to £59 …"  from_brief   {}      ← 0
    "Raise Price to £59 Immediately (No Feature Tie)" ai_inferred  2 values
    "Raise Price to £59 with Feature Release"         ai_inferred  2 values
    "Hold Price at £49"                               ai_inferred  2 values
```

> *"the product ranks the user's proposal against a better-configured
> restatement of itself"* — and **5 of 12 stated-option instances are wired to a
> factor they carry no value for.**

---

## ⛔⛔ THE CONTRADICTION THE SUCCESSOR MUST RESOLVE FIRST

Two live, written, reasoned rulings give **opposite** answers to the single
most Gate-0-relevant question: *is a number extracted from the brief the
user's statement?*

**Ruling A — `src/cee/graph-readiness/obligation-provenance.ts`**
```ts
// The user speaking — directly, or through their own brief. A brief is the
// user's own words, so a value extracted from it is user-stated, not inferred.
brief_extraction: 'user_stated',
explicit: 'user_stated',
```

**Ruling B — `src/cee/transforms/__tests__/no-brief-derived-user-override.writers.test.ts`**
> *"A value READ OUT OF THE BRIEF is the system's reading of prose, not the
> user's statement — that is the ROADMAP 2.714 defect this guard exists to stop
> coming back."*
>
> `stated-value-honour.ts` **was deleted** for doing this, "having been measured
> writing values that were 10^6x wrong, explicitly negated, retracted, or never
> stated — each one attributed back to the user with an empty skip list."

**Consequence of Ruling A being live:** `earnsAuthorshipCredit('user_stated')`
is true, and `analysis-admission.ts:851` counts it toward `material_user_stated`
— the threshold is **one** parameter — so a value the system parsed out of prose
**licenses `comparative_leader`**, i.e. the product names a winner on the
strength of a number the user never set.

### The distinction that reconciles them (neither states it)

- The brief's **words** are the user's. "£59" is genuinely in their prose.
- The system's **reading of which field that number sets** is not.

`brief_extraction` conflates *the digits* with *the binding*. The 2.714 defect
was always about the **binding**.

**⭐ Recommended shape for the user-authority layer:** authority attaches to a
**(source_quote, value, unit, role) tuple the user can see and correct**, never
to a `source` string on a field the system chose. That is the "simple explicit
user-authority layer" in the release brief, and it dissolves the contradiction
rather than picking a side.

---

## Three predicates, two questions (trap 21)

| predicate | file | question | `user_confirmed` |
|---|---|---|---|
| `earnsAuthorshipCredit` | `obligation-provenance.ts:133` | may we name a winner? | **no** |
| `reflectsAHumanAct` | `obligation-provenance.ts` | did a person touch this? | **yes** |
| `USER_AUTHORED_SOURCES` | `observed-state-salvage.ts` (PR #1674) | may we destroy this? | yes — **hand-rolled 4th copy** |

"May we destroy this?" is the *second* question. #1674 currently answers it with
a local set rather than delegating. **Deliberately not resolved tonight** — see
`03-CURRENT-WORK.md`.
