# draft-quality-eval — the non-serving evaluation path for `DRAFT_RECORDS_INSTRUCTION`

`DRAFT_RECORDS_INSTRUCTION` (`src/cee/draft/records/instruction.ts`) owns the draft output
contract. It ships as a **code constant**, so it has no prompt-store row, no candidate version,
and no `POST /admin/prompts/:id/test` bench — the four non-serving paths the prompt register
enumerates all belong to store-backed prompts and none of them reaches this one. Changing it has
therefore meant editing the constant, branching and deploying, which is why its own pin file
records **v3 and v6 as UNMEASURED**.

This tool closes that. Nothing here touches serving code, moves a prompt pointer, or deploys.

## Run it

```bash
# OFFLINE. Scores 14 banked live draws against the rubric. No credential.
pnpm eval:draft-quality

# Same, but after the deterministic repair substeps — closer to what the user gets.
pnpm eval:draft-quality -- --post-repair

# The controls + the baseline pin (this is what CI runs).
pnpm eval:draft-quality:test

# LIVE. Real, paid model calls. Needs ANTHROPIC_API_KEY.
ANTHROPIC_API_KEY=… pnpm eval:draft-quality -- --live \
  --candidate tools/draft-quality-eval/candidates/<name>.txt --n 3
```

`--live` composes the request from the **same two system blocks the adapter composes** — the
pinned served prompt first, the output-shape instruction second, exactly where `anthropic.ts:506`
appends it — swapping only the second block for the candidate file. The `control` arm always uses
the tree's own constant, so a candidate is always measured against the artefact it would replace.
A candidate byte-identical to the control aborts with `VACUOUS ARM` rather than reporting a null
result that reads as "no difference".

## The rubric

Eighteen boolean **checks** across eight dimensions, plus **measures** (counts and lists) a human
reads directly. **There is no composite score** — weights would be invented. The headline is
`checksPassed / checksApplicable`, and `UNEVALUABLE` is a first-class answer that is excluded from
the denominator rather than silently scored as a pass.

Every bar is derived from a producer, named in the check's `authority` field: the served prompt's
own text for the risk floor and the Status Quo label mandate, `MAX_OPTIONS` from the validator's
types, `validateGraph`'s own codes for connectivity and repair burden, `DEFAULT_GOAL_LABEL` from
`src/cee/structure/goal-inference.ts`, the graph schema's doc comments for what `value` /
`raw_value` / `unit` mean, and `MODEL-QUALITY-BAR.md` §1 for the label rules. None of the
thresholds was chosen here.

## The two stages, and why both are reported

`PROJECTED` is the projector's output — the purest signal about the instruction, because nothing
downstream has had a chance to cover for it. `POST-REPAIR` runs normalisation and the two
deterministic repair substeps the pipeline runs next.

They disagree in a way that matters. On a brief that never states an objective in words, the
projected graph has **no goal node at all**; the sweep then mints one labelled *"Achieve the best
outcome for this decision"*. Reporting either stage alone is true and misleading — only the pair
shows that the gap is **covered**, not closed.

## What it CANNOT measure

- Whether the causal claims are **true**, or the options **wise**. It scores structure and honesty.
- Anything about the **prose** the user reads — coaching, summaries, confirmations.
- Anything **downstream** of the draft: analysis, EVPI, or how the panel renders any of this.
- Goal-label quality beyond "verbatim fragment / compound join / over-long / machine placeholder".
  *Is this a good objective?* is judgement; the labels are emitted as evidence for a human sheet.
- Brief conservation in general (`MODEL-QUALITY-BAR` Q9). Extraction over prose cannot be a gate,
  so only the narrow **honesty** half is checked: a numeral the draft has already badged as the
  user's own must appear in the brief.
- **Run-to-run variance.** The banked corpus is one draw per brief. A one-check difference between
  two arms at `n=1` is noise.
- Anything the live adapter's field projection drops after the projector runs (record disclosures,
  the object-shaped node provenance).
- Nothing here is a journey witness. A green run is evidence about a draft, not about a user.

## Corpus provenance, and what it excludes

Briefs: `tools/graph-evaluator/briefs/*.md`, 16 files, with front-matter oracles
(`expect_status_quo`, `has_numeric_target`, `complexity`) written with the briefs. Captured draws:
the governed baseline's 14 live draws, stamped with the instruction hash that produced them.

**Excluded**, stated rather than implied: no non-English brief; no attached document; no
adversarial or prompt-injection brief; no multi-turn or seeded state (every case is a first draft
from a cold brief); no repeat draws; and the two staging briefs have no captured draw, so they are
available to the live arm only.

## Why it can fail

Three layers, each catching something the others cannot:

1. **Two controls, opposite directions.** A hand-built terrible draft must score badly; a *real*
   captured draft (`live-4day-week.cold-read.json`, the positive control the estate already holds)
   must score well. The positive control is **not** pinned as perfect — it genuinely fails the
   repair-burden check, and that failure is asserted by identity.
2. **Per-check discrimination.** Every check must be observed both passing and failing across the
   control set. A check stuck on one answer is decoration, and it looks exactly like a working
   check until you ask.
3. **Discriminating repair pairs.** For each defect the terrible draft carries, a repair that fixes
   exactly that defect must flip exactly that check — and the couplings it unavoidably drags with
   it are declared, so a change to them goes red rather than passing under a looser assertion.
