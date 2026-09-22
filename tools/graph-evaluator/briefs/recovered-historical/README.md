# 14 briefs rescued from the damaged clone — read this before landing any of them

**22 Sep 2026.** These were **never committed anywhere** in 3,056 commits of CEE history (verified by
a peer lane with `git log --all --diff-filter=A` over `tools/graph-evaluator/briefs/*`). They existed
only as iCloud sync-conflict copies in `~/Documents/GitHub/olumi-assistants-service`, whose git pack
now **times out on read** and whose commit graph references an object absent from the object database.
Copied here verbatim, de-duplicated (the `" 2"/" 3"/" 4"` variants are byte-identical), read-only from
the source.

**Why they matter:** two of the evaluator's seven scoring dimensions — `constraint_retention` (15%)
and `ratio_encoding` (5%) — return not-applicable 1.0 for every one of the 16 tracked briefs, because
none declares `expected_constraints` or `ratio_metrics`. **These 14 are the missing half**, and
`21-multi-constraint-nrr.md` is the first brief in the estate that would actually score a churn
constraint.

---

## ⛔ Do not land `21-multi-constraint-nrr.md` as written — its oracle encodes the bug

Brief text: *"keeping monthly churn **under** 4% and maintaining NRR **above** 110%"*.
Its own front matter:

```yaml
expected_constraints:
  - keyword: churn
    operator: "<="      # ⛔ the brief says "under" — that is strict "<"
    value: 0.04
  - keyword: NRR
    operator: ">="      # ⛔ the brief says "above" — that is strict ">"
    value: 1.10
```

**The fixture that would finally test strict-constraint handling asserts the relaxation as correct.**
"Under 4%" is `< 0.04`; "above 110%" is `> 1.10`. Landing this unchanged would make the evaluator
certify the exact silent-widening defect this workstream exists to remove, on the one brief built to
catch it. Whoever lands it must set `operator: "<"` / `">"` and `strict: true`, and then the gate will
correctly fail today's CEE — which is the point.

## ⛔⛔ It is not one brief. EVERY recovered oracle that declares a constraint encodes the relaxation

I first wrote that I had only checked the headline brief. I then checked all fourteen, and the result
is systematic — **4 of 4 briefs that declare a numeric limit state it strictly in the prose and
non-strictly in the oracle:**

| brief | oracle operators | the brief's own words |
|---|---|---|
| `21-multi-constraint-nrr` | `<=` , `>=` | "churn **under** 4%", "NRR **above** 110%" |
| `23-external-factor-heavy` | `>=` | "**above**" |
| `24-bundled-goal-decomposition` | `<=` , `<=` | "**under**", "**below**" |
| `26-inbound-sum-multi-driver` | `<=` | "**below**" |

Not one author's slip — a consistent convention that treats `<=` as the representation of "under".
Which is precisely how the defect survives in the product: the wire contract has no strict operator,
so everyone who writes a fixture reaches for `<=`, and the fixture then certifies the widening.
**Every one of these must be corrected to `<` / `>` with `strict: true` before it is landed**, and
when they are, they will correctly fail today's CEE. That failure is the deliverable.

⭐ Lesson worth keeping: a sample is not a manifest. Checking one brief gave "an authoring slip";
checking fourteen gave "a convention". The second is actionable and the first is not.

## Three further cautions

1. **Unreviewed and never CI'd.** No oracle here has been validated against real model output.
2. **Landing them changes what the legacy composite score means.** Turning 20% of `overall_score`
   from a constant 1.0 into a real signal makes new scores non-comparable with every historical
   result — the same trap the rubric-1 → rubric-2 changelog documents.
3. **They do not enter the governed pack automatically.** `governed/draft-graph-v5/manifest.json`
   pins an ordered 14-brief corpus with per-brief SHAs and `governed-draft-graph.ts` raises
   `CORPUS_DRIFT` on any change. A governed arm needs a new authorised freeze.

## What is here

`15-thin-hiring` · `16-rich-saas-pricing` · `17-personal-relocation` · `18-multi-option-crm` ·
`19-ambiguous-retention` · `20-currency-euro` (the only € brief) · **`21-multi-constraint-nrr`** ·
`22-forced-choice-no-sq` · `23-external-factor-heavy` · `24-bundled-goal-decomposition` ·
`25-minimal-binary` · `26-inbound-sum-multi-driver` · `27-one-hot-market-entry` ·
`28-edge-type-compliance`

⭐ `27-one-hot-market-entry` is worth attention for a different reason: this session measured that an
all-qualitative-option decision cannot be compared numerically at all (PLoT returns an empty-options
400, correctly). A one-hot market-entry brief is that shape, so it is the right fixture for pinning
"this decision has no numerically comparable options" as an expected outcome rather than a failure.
