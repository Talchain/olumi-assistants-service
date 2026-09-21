# Architectural judgement

Opinion, clearly labelled — but every number below is measured.

## The shape of the problem

The draft path asks **one LLM call** to do all of this at once:

- extract what the user said (`stated_items`)
- decide what each statement *means* (`kind`, `role`, `direction`)
- transcribe the numbers (`value`, `unit`, `value_scale`) — **measured 0.067%**
- invent additional options (`instruction.ts:332-341`)
- assert causal structure (`claims[]` with `from_*`/`to_*`)
- assign intervention magnitudes (`sets_to`) — **measured 47/47 model-chosen**
- flag a baseline (`instruction.ts:317-322`)

**Measured prompt surface:** `defaults-v187.ts` **43,694 bytes**;
records path `instruction.ts` **34,824** + `grammar.ts` **47,459** = **82,283**.

⭐ **The verdict: yes, it is doing too much — and the specific harm is
identifiable, not general.** The one job the model does *worst* is the only one
that is purely mechanical: **transcribing a number that is already literally in
the brief**, at 0.067%. Meanwhile the jobs it does eagerly — inventing options
and choosing lever magnitudes — are the ones that need the most restraint.

**The task mix is inverted.** Deterministic work (find "£59" in the prose) is
delegated to the model; judgement-laden work (what level should this lever be
set to?) is unconstrained.

## Where deterministic repair helps, and where it damages

**Helping** — these refuse rather than guess, which is the right shape:
- `projector.ts:3904-3908` — *"An entry exists if and only if the model stated a
  number for that exact option→factor pair; no default, no neutral fill."*
- `analysable-option-gate.ts:494-502` — discloses held values
  (`value_defaulted: true`); *"an unprovable 'no change' is still an invention."*
- `stated-option-figure-adoption.ts:100-128` — on the 9 witnessed drafts it
  **adopts nothing and records the gap**.
- #1674's salvage — fail-closed when it cannot prove the shed is safe.

**Damaging** — repair that makes a corrupted graph *look* correct:
- The whole-brief magnitude scan (`intervention-extractor.ts:1022-1032`) —
  restores a `brief_extraction`/high label to an invented level whenever the
  number appears *anywhere* in the brief. **This is a provenance launderer.**
- `schema-v3.ts:457-459` — defaulting to `brief_extraction` is repair-by-
  assumption at the exact point authorship should be admitted as unknown.
- `factor-matcher.ts` semantic matching — `rate ≈ price` produced
  `churn := 0.102`. Semantic matching that *writes a value* is not repair.

**The rule I would apply:** deterministic repair may **withhold, disclose or
refuse**. It may never **supply a value or an authorship claim**. Three of the
damaging sites above break exactly that rule.

## Redundant / mis-placed AI calls

- Several draft-path modules carry their own model touchpoints
  (`option-factor-mapper.ts`, `objective-label.ts`, `records/completion.ts`,
  `records/lineage.ts`). **UNVERIFIED** how many fire per draft — worth counting
  before optimising.
- Four prompt generations coexist (`defaults.ts` 130KB, `defaults-v187.ts`,
  `defaults-v19.ts`, `defaults-v15.ts`) with **different constraint-mapping
  text**. Which is served was **not resolved this session** — all three agents
  independently flagged this as unverified. **Settle it first**; several findings
  are attributed to v187/v201 on comment evidence only.

## What I would redesign for a low-cost, reliable PoC

1. **Split extraction from modelling.** Call 1: *"quote every figure, goal,
   option, limit and horizon the user stated, with its literal span."* No graph,
   no invention. This is cheap, checkable against the brief bytes, and is the
   one thing that must never be wrong.
2. **Make `value` required when `kind: "figure"`.** The grammar already has the
   field; a conditional `required` costs nothing and closes F1 at source.
   ⚠ Verify the provider honours conditional required in structured output.
3. **Authority attaches to a tuple, not a string.** `(source_quote, value, unit,
   role)` that the user can see and correct — never a `source` enum on a field
   the system chose. This dissolves the `brief_extraction` contradiction instead
   of picking a side.
4. **Delete `brief_extraction` as an authorship class.** Replace with
   `brief_quoted` (the digits are the user's) + an explicit `binding` verdict
   (whether *this field* is what they meant). Those are different questions and
   one enum member cannot answer both.
5. **Interventions require a warrant bound to the target factor**, or they are
   emitted as `proposed` and excluded from any leader claim.
6. **Add a strict operator** (`<`/`>`) or **refuse the constraint and say so.**
   Silently widening a limit is the single clearest breach of the release
   contract, and it is four lines of enum.
