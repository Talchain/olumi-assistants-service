> ⚠⚠ **SUPERSEDED AS A DESCRIPTION OF WHAT SHIPS — v11 IS WITHDRAWN.** Its rule was right and its
> DESTINATION did not exist: 6 of its 9 clean draws were clean only via
> `stated_items[].kind = "claim"`, a value the structured-outputs enum forbids. See
> **`V12-WITHDRAWAL-AND-ROUTE.md`**. Everything below is the v11 record and is left UNEDITED —
> it is evidence of what was measured on dated bytes, not a fixture to keep current.

# records instruction v11 — a proposed CAUSE is not an option (2026-08-30)

## The defect, at the rung it was witnessed

**WIRE-WITNESSED**, deployed CEE build `a18e194`, served `draft_graph` PMS v195
(`152998b447819c2e`, sampled 8× over 7 minutes past the ~5-min loader TTL — no instance split),
records instruction v10 (`3a122669…` / 10,079).

`POST /assist/v1/draft-graph` with a diagnostic brief (leadership disagrees about why growth
stalled) returned OPTION nodes:

| id | label | provenance | source_quote |
|---|---|---|---|
| `0811361d` | The Product Has Fallen Behind Competitors | `from_brief` | "the product has fallen behind competitors" |
| `b8e1cbe6` | Onboarding Is the Problem | `from_brief` | "onboarding is the problem" |
| `5f615ae5` | We're Selling to the Wrong Customers | `from_brief` | "we're selling to the wrong customers" |

Three competing EXPLANATIONS, scored and ranked as though they were alternatives the user
picks between. The same draw ALSO emitted the genuine actions ("Commission structured
win/loss review", "Run rapid customer interviews and churn analysis") — the model was never
short of the right answer; the instruction let the causes stand as their siblings.

Raw capture: `DEPLOYED-BEFORE-witness-A1-assist-v1-draft-graph.json`.

## Where the fix belongs — a CORRECTED PREMISE

The lane was briefed that the served prompt is PMS `draft_graph_default@v195` and that a
repo-only edit ships nothing. **That is true of the graph prompt and false of this defect.**
`anthropic.ts:516-517` pushes `DRAFT_RECORDS_INSTRUCTION` as a SECOND system block beside the
PMS prompt. Derived by control:

* PMS v195 ALONE (admin `test-prompt-llm`, 6 briefs) emitted **no records at all** and never
  reproduced the defect — the option nodes carry `provenance`/`source_quote`, which only the
  records path mints, and the reported determinism (identical node ids across independent
  draws) is content-derived hashing, not LLM behaviour.
* v195 **+ the records instruction** reproduced it on the first draw.

The filing decision is made in the repo. **This change ships by merge and deploy; no PMS
promotion is required or requested.**

## The rule

Reclassification only — it tells the model where to put something it was already going to
say, applying no pressure to invent. Two directions, deliberately:

1. an option is something you can CARRY OUT; a span that can be TRUE or FALSE is not one;
2. a proposed CAUSE routes to a `factor` (what varies) or a `risk` (what threatens the goal);
3. **who said it makes no difference** — "sales says cut the price, product says hold and ship
   the integrations" names two real acts, and both stay options.

(3) is the half that stops the fix being worse than the defect: a rule keyed on ATTRIBUTION
rather than on ACTION would delete the user's real alternatives from their own decision, and
that failure could not show up in a corpus of diagnostic briefs (CLAUDE.md trap 22b).

## Behavioural evidence — and the limits of the instrument

⚠ **MEASURED ON A PROXY, NOT ON THE DEPLOYED PATH.** Both arms were composed from the same two
system blocks and drawn through admin `test-prompt-llm`, which carries **no structured-outputs
grammar**. It measures the FILING decision this change governs and nothing downstream. The
deployed witness above was DETERMINISTIC; this instrument is not, so **no absolute AFTER rate
is a deployed rate and none is claimed.** What it supports, both arms carrying the same bias,
is the within-instrument delta. Per-draw data: `paired-draws.json`.

| arm | diagnostic briefs (A1, A2) | genuine-choice briefs (A3, B1, B2, B3) |
|---|---|---|
| BEFORE (records v10) | **5 of 5 draws** filed causes as options | 0 genuine options lost (5 draws) |
| AFTER (records v11) | **3 of 9 draws** filed causes as options | **0 genuine options lost (7 draws)** |

* Acceptance (a) — attributed explanations do not become options: **improved, not solved.**
  100% → 33% of draws. The residual is stochastic and concentrated on A2.
* Acceptance (b) — genuine named alternatives still become options: **met, 7/7 draws, zero
  losses**, including B3, where three real actions are each attributed to a named person.

Two rounds were spent. Round 1 (`62171b0e`-lineage first attempt) changed nothing at all;
round 2 is what is proposed. A third round was **not** attempted: the corpus was written by
this lane, so further tuning against it would be overfitting to the author's own head
(trap 22), and the honest next instrument is a deployed witness, not a better proxy.

## Residual, NOT introduced by this change

Some AFTER draws file the decision-framing sentence as an option ("We need to understand this
before we commit budget"). **Pre-existing**: BEFORE draws on the same brief do it too. The
instruction already carries a rule against it ("The question the user is deciding is not an
option"). Out of scope here; recorded so it is not read as a regression.

## What is owed after deploy

A fresh `/assist/v1/draft-graph` witness on brief A1 at the deployed build, asserting no
option node's `source_quote` is one of the three attributed explanations, and that B1/B3
options are unchanged. Until then this change sits at **TESTED**, not witnessed.
