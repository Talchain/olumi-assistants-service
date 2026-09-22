# Model Generation & Quality — bake-off result and architecture recommendation

**21 Sep 2026.** Every number below was measured this session: 121 scored runs across 7 arms,
6 briefs, 3 runs each, plus 4 fresh traced draws of the live product. Raw evidence in
`SCORES.txt` · `SCORES.json` · `PROJECTION.txt` · `PROJECTION-CONTROL.txt` · `JUDGE.json` ·
`arms/**` · `armA/**`. Code: `runner/{run_arms,score_arms,project,judge}.py`. Contract v0 is
committed at `9f6697ad` on `feat/model-gen-rich-builder` (contract files identical to `a00f824a`).

---

## ⚠ The finding that reframes the workstream

**Today's analysis runs entirely on invented causal magnitudes, and an honest model cannot be
analysed at all.** Measured 22 Sep against live PLoT `/v2/run`:

- The live product's graph is **accepted** (HTTP 200, `analysis_status: computed`). All **17** of
  the edges it computed on carry `source: cee_hypothesis`, reasoning *"Model-inferred causal
  link (records projector)"*, with strengths like `-0.8`, `0.402`, `0.548`. **0 of 17 appear
  anywhere in the brief.**
- Every projected rich model is **refused**: first `NO_PATH_TO_GOAL` (fixed, see below), then
  `NO_EFFECTIVE_PATH_TO_GOAL` — *"Option … has no interventions that can effectively affect the
  goal"* — because the rich model records causal magnitude as `unknown` instead of inventing one.

So the engine's precondition is exactly the thing Paul's brief forbids: *never invent a point
estimate just to make analysis run*. A model that obeys that rule is currently unanalysable; the
model that is analysable today is analysable **because** it invented 17 numbers.

**The contrast, counted over everything measured this session:**

| | invented causal magnitudes |
|---|---|
| Live product, the graph PLoT accepted | **17 of 17 edges** |
| Rich contract, every arm, 137 runs | **0 of 1,763 causal links** |
| Rich contract, AI-authored factor values | **0 of 1,352 factors** |

Not one model under the rich contract invented a magnitude or a baseline, across six arms and two
model families. The refusal to invent is not a fragile prompt behaviour — it held on every run.
That is the finding stated as precisely as this session can state it: **the contract reliably
produces honest models, and the engine reliably refuses them.**

### ⚠ A fourth route already exists and is live — my framing above was incomplete

I wrote that today's analysis runs on invented causal magnitudes. That is true, and it is **less
naked than I portrayed.** `src/cee/validation-pipeline/` runs a **second independent model** over the
draft and cross-checks every magnitude:

1. extract the graph structure **with no parameter values** (the same principle as the dual-draft
   serialiser — what the reviewer never sees, it cannot echo back);
2. call **o4-mini** to estimate the parameters independently;
3. enforcement lints;
4. compute per-parameter bias offsets (pass 1 − pass 2 median) and bias-correct;
5. compare each pair and attach `ValidationMetadata` to the edge:
   `status: 'agreed' | 'contested'`, both passes' values, and pass 2's reasoning.

**Measured on the accepted control draw:** 11 of 17 edges carry this metadata — **6 agreed,
5 contested**. Example, verbatim from the wire: pass 1 says strength −0.3, pass 2 says −0.4 with
reasoning *"Higher feature release quality typically reduces the magnitude of churn spikes triggered
by a price increase."* ⚠ The graph-level `validation_summary` is **null** on that draw even though
the per-edge metadata is populated, so the summary is not reaching the wire.

**What this changes.** The decision is not three-way, it is four-way, and the fourth option is built:

4. **Cross-check.** Keep model-authored magnitudes, have a second independent model estimate them,
   bias-correct, and tell the user *which ones the two models disagree about*. On this draw that
   would have surfaced 5 contested edges out of 11 checked.

That is a materially better version of "disclose" than the one I offered, because it is a *per-number*
signal rather than a blanket caveat, and it already runs on every draft. **It does not make the
numbers the user's** — which is still what route 1 achieves and what the trust gates measure — but it
is a real epistemic control and my memo should not have omitted it.

**Overlap with my widener: partial, and worth resolving before either lands.** The validation pass
estimates *parameters* on an existing structure; my widener proposes *structure* (options, factors,
mediators, risks) and deliberately declines to estimate magnitudes. They are complementary rather
than duplicative — widen first, then cross-check what the widening asserts. But both are a
second-model pass over a draft, both cost a call, and nobody has run them together.

⚠ UNVERIFIED and NOT re-derived: a reported claim that an adjacent two-pass design cut disagreement
from ~81% to ~43% against a 15–40% target, and rejected an LLM referee. I found the mechanism and the
`agreed`/`contested` classification but **no disagreement-rate constants or target in
`constants.ts`/`comparison.ts`**. Do not cite those figures until someone finds their source.

This is not an argument against the rich model. It is the clearest possible statement of what the
PoC must decide, and there are only three honest routes:
1. **Elicit.** The widened models already produce **12–17 explicit unknowns each**. Ask the user
   for the handful of magnitudes that actually move the answer, then analyse on their numbers.
   **Tested end to end this session: it lifts PLoT's refusal (422 → 200 computed). See the section
   below for what it did and did not close.**
2. **Propagate.** Run analysis in a mode that carries uncertainty instead of demanding point
   estimates, and report ranges rather than a leader.
3. **Disclose.** Keep model-supplied priors, but label every result as resting on Olumi's estimates
   — which the product already half-does, and which the handover records as *"every estimate this
   comparison rests on is Olumi's, not yours."*

Route 1 is the one the architecture is already built for — **and more literally than I realised
when I wrote that. The server already elicits edge weights from the user. Nothing ever asks it to.**

`POST /assist/v1/elicit-belief` (route `assist.v1.elicit-belief.ts:78`, registered
`server.ts:32`) takes `target_type: "prior" | "edge_weight"` and returns
`{suggested_value, confidence, reasoning, needs_clarification, clarifying_question?, options[]}` —
a deterministic natural-language → [0,1] converter with the ambiguity path already designed
("pretty likely" → 0.70 high; an ambiguous term returns options to choose from). The UI mounts it:
`CalibrateDrillIn` renders at `YourDecisionSection.tsx:449`, with `BeliefInput`,
`BeliefElicitationField` and `useBeliefElicitation`.

**The gap is one call site.** In the UI, non-test occurrences of `edge_weight` number exactly
**one** — the type declaration at `adapters/cee/client.ts:1016`. It is never a call. The sole
producer, `useBeliefElicitation.ts:138`, hardcodes `target_type: 'prior'`. Contrast control in the
same probe: `'prior'` has a real producer and tests, so the probe sees the family and the zero is
real. `edge_weight` is a declared-but-unproduced enum member.

⚠ **Three things must be fixed on that path or elicitation launders authorship the moment it
works** (found by the prior-work research lane; each verified here):
1. `belief-elicitation/index.ts` declares `provenance: "cee"` as a **type-level literal** on its
   result interface (10 occurrences, no conditional). A magnitude the user just stated in their own
   words returns stamped as Olumi's. Elicit through this seam unchanged and every elicited value
   arrives `cee_hypothesis` — the exact defect this workstream exists to remove.
2. CEE writes `user_override` server-side for **both** "confirm as is" and "type a new value",
   collapsing confirmed-vs-edited. A third laundering path, distinct from the node allow-list-of-one
   and the edge substring match. The best provenance map in the estate is
   `DecisionGuideAI/src/canvas/domain/valueProvenance.ts:125-145` — a byte-read ledger of every
   `observed_state.source` literal any producer writes. Read it before touching this.
3. `CalibrateDrillIn` **unmounts on "Analyse"** (`FactorControllablePanel.tsx:169`), so elicitation
   is pre-analysis only today. "Ask for the magnitudes that matter" currently has to happen before
   the run, not in response to a refusal.

**Also counts toward the invented-magnitude total:**
`src/cee/verification/generators/weight-suggestion-generator.ts` generates a `suggested_belief` for
edges with problematic belief patterns and sets `auto_applied: true` at a grounding score ≥0.5,
populating the value at confidence ≥0.7. That is a second automatic producer of invented causal
magnitudes, separate from the projector's.

**Recommend deciding this before any further generation work**, because it determines whether the
widener's unknowns are the product's best feature or a blocker — and because route 1 now looks like
days of work, not weeks.

### Two contract defects this probe exposed (neither was visible from generation alone)
- **The rich model never said which outcome measures the goal**, so nothing connected an option to
  the goal. Fixed in contract **v0.1**: `decision.goal_measured_by`, now required, with both
  prompts updated. The projection uses it when present and, when absent, links the outcomes and
  records `goal_link_inferred` in the loss report rather than passing the inference off as the
  model's own structure.
- **PLoT's contract is `{factor_id: <number>}`** — a flat map of bare numbers. Provenance, unit and
  confidence **cannot travel with the value**. That is the precise boundary at which authorship
  stops travelling, and no amount of upstream rigour survives it. 20 interventions crossed it in
  this probe.

Evidence: `PLOT-PROBE.json`, `armA/pricing-staging/plot-control.json`, `runner/plot_probe.py`.

---

## The headline, re-measured on the shipped contract

Everything in the arm table further down was measured on the **earlier** contract. Re-run on the
contract that is actually on the branch (v0.2), 6 briefs × 3 runs each:

| | gate-clean | factors | links | mediators | temporal | qualitative | unknowns asked |
|---|---|---|---|---|---|---|---|
| GPT-4.1 builder alone | 15 / 18 | 3.8 | 2.8 | 0.0 | 0.0 | 1.2 | 2.9 |
| **builder → Terra widener** | **17 / 17** | **13.5** | **21.6** | **4.0** | **17.3** | **6.2** | **11.9** |
| current CEE (unchanged) | **0 / 4** | 4.2 | 19.8 | 0.0 | 0.0 | 0.0 | 0 |

**The recommended architecture passed every hard trust gate on every run that produced a model, while
carrying roughly five times the modelling content of the builder alone.** 17 of 18 runs produced a
model; the 18th failed on a provider timeout, not a gate, and is counted as a production failure in
the reliability figures rather than quietly dropped.

That is the cleanest statement the evidence supports: **the widener is not a richness-versus-fidelity
trade. On this corpus it bought both.**

## Route 1 tested end to end — the refusal lifts, the analysis does not complete

Measured 22 Sep against live PLoT, with the same model as its own control:

| | PLoT `/v2/run` | |
|---|---|---|
| model with unknown magnitudes (control) | **422 blocked** | `NO_EFFECTIVE_PATH_TO_GOAL` |
| same model, magnitudes **elicited** | **200 computed** | `analysis_status: computed` |

**20 of 20 unknown edge magnitudes were elicited successfully** through
`POST /assist/v1/elicit-belief` with `target_type: "edge_weight"` — the path nothing in the product
calls. Ordinary phrasings converted cleanly: *"moderately likely"* → 0.70, *"pretty likely"* → 0.70
(high confidence), *"about 50-50"* → 0.50. Confidence split: 9 high, 7 medium, 4 low. Nothing was
invented; every filled magnitude carries the phrase it came from.

### The full route, generalised: 4 of 5 briefs reach a scored comparison

Two things were needed, and the second was not obvious until the first was done.

| brief | magnitudes elicited | non-numeric options withheld | PLoT | scored options |
|---|---|---|---|---|
| `pricing-staging` | 20 / 20 | 0 | **200** | 2 — £59 **0.761** vs hold **0.239** |
| `pricing-staging-b` | 15 / 15 | 0 | **200** | 2 — **0.559** vs **0.441** |
| `hiring-staging` | 27 / 27 | 1 | **200** | 2 — tech lead **0.567** vs two developers **0.433** |
| `12-similar-options` | 28 / 28 | 1 | **200** | 4, win probabilities 0.442 / 0.279 / 0.145 / … |
| `02-multi-option-constrained` | 28 / 28 | **6 of 6** | 400 | **none — and correctly so** |

**Step 1 — elicit the unknown magnitudes.** Necessary but not sufficient: three briefs stayed refused
at 100% elicitation, with PLoT's own critique naming the reason —
`EMPTY_INTERVENTIONS: Option '…' does not specify what it changes`.

**Step 2 — withhold the options that change nothing numeric, and say so.** An option defined by a
qualitative action (run a prototype, hire locally, enter a market) has no numeric lever; the rich
model declines to invent one, and sending it forfeits the analysis of *every other option*. Withheld
and recorded rather than dropped, three of those briefs go straight to a scored comparison.

**The fifth is the honest boundary, not a failure.** Every one of
`02-multi-option-constrained`'s six options — enter Germany, enter Brazil, enter Japan, hire locally,
relocate staff, run a partner-led pilot — is a qualitative action. Nothing numeric remains to
compare, so the payload is empty and the engine refuses it. **That is the correct answer.** The
product should say "these options cannot be compared numerically, here is what each one rests on"
rather than manufacture six lever values to produce a ranking. Today's pipeline would invent them.

⚠ **Three wrong readings on the way here, all mine, all recorded:** the `0/28` and `0/27` elicitation
failures were **429 rate limiting from my own burst**; my all-or-nothing hypothesis was refuted by
100% elicitation still blocking; and a `400` I briefly took for a product limit was **my own
bookkeeping key in the wire payload**, which PLoT was right to reject.

**AND IT REACHES A SCORED ANSWER — the loop closes.** The elicited model returns
`option_comparison` with **2 options scored**, each carrying `win_probability`, `outcome` and
`downside`, plus a full `decision_brief` with a graph hash. The control, with magnitudes left
unknown, returns `analysis_status: blocked` and nothing.

| | PLoT | analysis | options scored |
|---|---|---|---|
| unknown magnitudes (control) | 422 | blocked | — |
| **elicited magnitudes** | **200** | **computed** | **2, with win probabilities** |

⚠ **I reported "0 options scored" twice before getting this right, and both errors were mine.**
First I blamed my projection; a contrast control showed the live product's graph returned the same
empty field, so it could not be my projection. Then I called it a gap in my probe's request shape.
It was neither: **the scored options live under `option_comparison`, and I was reading `results`.**
A wrong field name, reported as a product limitation, twice. The probe now reads the right key and
prints the win probabilities so the mistake cannot recur silently.

**What is genuinely still different from the live product:** my projection draws
`GRAPH_DISCONNECTED: 2 components` where the product's draws none. Adding the option→lever
structural edges the target itself uses took that from 7 components to 2; the residual pair is a
separate experiment sub-branch the widener proposed. Real, and unrelated to scoring.

⚠ The user answers are stand-ins I wrote. This proves the **mechanism** converts ordinary language
into usable magnitudes; it does not prove real users answer well or that the numbers are right.
Evidence: `ELICIT-PROBE.json`, `runner/elicit_probe.py`.

## DECISIVE COMPARISON — single strong model vs builder → widener, on finished models

Identical corpus (6 briefs × 3 runs), identical frozen gates, both arms scored on the finished
validated model rather than on components.

| | gate-clean | factors | links | mediators | temporal | qualitative | unknowns | enrichment | s | $ |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** single strong model (Terra, **1 call**) | **15/18** | 8.2 | 9.5 | 1.4 | **1.0** | 4.6 | 7.4 | 15.3 | **97** | **0.091** |
| **B** builder → Terra widener (**2 calls**) | **15/18** | **12.8** | **18.9** | **2.7** | **9.8** | **6.3** | **11.9** | **33.4** | 143 | 0.135 |

**The gate score is a tie. The representation is not.** B carries ~2× the causal structure, ~2.2× the
enrichment, and **~10× the temporal semantics** for 1.47× the latency and 1.49× the cost. On the
criteria that the rich model exists to serve — temporal and qualitative preservation, mediating
mechanisms, unknowns surfaced for elicitation — B wins on every one. On cost and latency A wins.

### The failure modes differ in kind, and reading them found a defect in my own gate

⚠ **I first read arm A's two G5 failures as the single model recreating the duplicate-option defect.
That was wrong.** Inspecting them instead of counting them:

```
[user] Enter Germany      lever f_target_market = None
[user] Enter Brazil       lever f_target_market = None
[user] Enter Japan        lever f_target_market = None
```

Three genuinely distinct choices that set the same categorical lever with no numeric value. My G5
signature groups on `(factor_id, value)`, so they collide and are flagged as duplicates. **That is a
false positive in my gate, not a defect in the model** — and it is the same underlying gap as the
`EMPTY_INTERVENTIONS` finding: the contract cannot say "this option selects branch X of a categorical
lever". G5 needs a categorical exemption before it is used on market-entry or forced-choice briefs.

Corrected reading of the six failures:

| arm | failures | genuine? |
|---|---|---|
| A | G5 ×2 | **no** — categorical false positive in my gate |
| A | G4 ×1 | **no** — the contested brief-12 oracle (model was stricter than my oracle) |
| B | G2 ×2 | **yes, minor** — implied singular `1` with no transformation declared |
| B | G6 ×1 | **yes** — options treating the constrained budget as a lever |

So on genuine failures A is **0 of 18** and B is **3 of 18**. ⚠ But that cuts against B less than it
appears: A achieves it partly by leaving levers null, and **a null lever means the option is withheld
from analysis entirely** (the `EMPTY_INTERVENTIONS` boundary). A is cleaner on the gates and less
analysable; B is slightly dirtier and produces more that an engine can actually score. **Neither
number should be quoted without that sentence.**

### Verdict

**Builder → widener, for the representation, not the gate score.** The two-call architecture buys
temporal semantics (9.8 vs 1.0 per model), mediating mechanisms and roughly twice the causal
structure — which is precisely the material the Rich Decision Model exists to carry and the analysis
projection is measured on losing. A single strong model is a legitimate cheaper fallback at 67% of
the cost and 68% of the latency, and it is **not** a worse model on fidelity; it is a thinner one.

### Arm C — RUN, and the answer changes why it belongs

The decisive test I set for the second pass was: does it contest magnitudes **the user supplied**, or
only ones a model invented? Run with o4-mini over a value-stripped structure, mirroring the real
pipeline's method (`runner/armC_validation.py`; contested at |Δmean| > 0.25):

| pass-1 magnitudes | contested by an independent second pass |
|---|---|
| **elicited from the user** | **4 of 20 = 20%** |
| model-authored | **0 of 0 — none exist to test** |

Examples of the disagreements: the user's *"fairly strong"* became −0.70, pass 2 said −0.40; a −0.50
became −0.85. Those are exactly the kind of challenge a science layer should raise.

⚠ **The comparison arm came back empty, and that is itself a confirmation.** Every widener arm
produces `magnitude.kind: "unknown"` with `value: null`, so there are **no model-authored numbers to
contest** — consistent with the 0-of-1,763 count elsewhere in this memo, and now demonstrated a second
way: a test designed to catch invented magnitudes found nothing to catch.

**So it earns its place, but for a different reason than I hypothesised.** It is not a check on our own
inventions, because under this contract there are none. It is a **challenge to the user's estimates** —
it materially disagrees with roughly one in five of them. That is a legitimate and useful role, and it
is the first thing in the estate that would tell a user "a second model reads this relationship
differently from you."

**Recommendation on arm C: include it, gated and after elicitation, not in the default first pass.**
It costs ~46 s and one call; run it once a model has elicited magnitudes worth challenging, and
surface `contested` per edge. Do not run it over a model whose magnitudes are all `unknown` — there is
nothing for it to do.

⚠ Method caveat: this reproduces the pipeline's *mechanism*, not its code, and omits bias correction
(which needs a population), so 20% is an **upper bound** on the real pipeline's contested rate.

## A serious challenge to the builder choice, tested rather than deferred to

The banked prior-work report surfaces a same-prompt head-to-head (`o4-mini-vs-gpt41-head-to-head-v185`,
March 2026, **5 runs × 22 fixtures = 110 evaluations per model**) in which **o4-mini beat gpt-4.1 by
23.6 points on structural validity** for graph generation — 98.2% against 74.5%, with gpt-4.1 failing
all 5 runs on one fixture. That is far better powered than the 4-brief round usually cited, and it
directly challenges using gpt-4.1 as the builder.

**Re-run under the rich contract, same corpus, same frozen gates, 6 briefs × 3:**

| builder | gate-clean | source-binding ok | factors | links | s | $ |
|---|---|---|---|---|---|---|
| **gpt-4.1** | **15 / 18** | **18 / 18** | 3.8 | **2.8** | **12.8** | **0.022** |
| o4-mini | 12 / 18 | 17 / 18 | 4.2 | 1.2 | 37.0 | n/a |

**The March result does not transfer, and the reason is that it measured a different task.** It
scored a model emitting a GraphV3 **directly** under a 40k-char prompt, where structural validity is
the model's own responsibility. The builder here emits a **record set under a strict JSON schema**
with a ~2k prompt, so the schema guarantees the structure and what remains is fidelity — which is
where gpt-4.1 wins, at **one third the latency**.

**Builder choice stands: gpt-4.1.** ⚠ And the generalisable point is the one worth keeping: a model
ranking is a ranking *for a task*, and changing the output contract can invert it. Historical model
selections in this estate were made against the graph-emitting task and **should not be carried over
to the record-emitting one without re-measurement** — in either direction.

## Adopted from prior art and measured: the widener no longer sees the values

The v6 dual-draft branch's best idea is one line in its graph serialiser — the reviewer is shown
structure only, *"because what M2 never sees, it cannot echo back as an invented value."* My widener
saw the whole builder output including every number and was asked in prose not to touch them, with
immutability **checked afterwards**. I implemented the blind version: the widener receives structure
and quotes with every value nulled, and the user-authored parts are then restored deterministically
from the builder's own output. **Immutability is now a property of the pipeline rather than a test.**

Measured, identical builder / corpus / gates, 6 briefs × 3:

| widener input | gate-clean | immutable | factors | links | mediators | temporal | qualitative | unknowns | s |
|---|---|---|---|---|---|---|---|---|---|
| sighted (sees values) | 15/18 | 18/18 | 12.8 | 18.9 | 2.7 | **9.8** | 6.3 | 11.9 | 143 |
| **blind (structure only)** | **15/18** | **18/18** | **12.9** | **19.1** | 2.7 | 7.2 | **6.4** | **12.6** | **117** |

**Blinding costs nothing on gates and nothing on structural richness — and it is 18% faster**, because
the input is smaller. Factors, links, mediators, qualitative factors and unknowns are all equal or
slightly better.

⚠ **One real cost: temporal richness falls 27%** (9.8 → 7.2 per model). The widener evidently uses
magnitudes to reason about timing — a price change persisting versus a promotion decaying is easier to
assert when you can see the numbers. That is a genuine trade against a genuine safety gain, and the
memo records it rather than choosing silently.

⚠ Not attributable to blinding: the blind arm's single G1 failure. Each arm runs its own builder call,
so that is builder variance, not an effect of withholding values from the widener. Do not read it as
a cost of blinding.

### The middle ground, tested: show timing, withhold magnitudes

| widener sees | gate-clean | immutable | factors | links | mediators | temporal | enrichment | s |
|---|---|---|---|---|---|---|---|---|
| everything (values included) | 15/18 | 18/18 | 12.8 | 18.9 | 2.7 | **9.8** | 33.4 | 143 |
| structure only, no temporal | 15/18 | 18/18 | 12.9 | 19.1 | 2.7 | 7.2 | 33.8 | **117** |
| **structure + temporal, no values** | 14/18 | 18/18 | 12.9 | **19.9** | **3.1** | 8.9 | **35.3** | 118 |

**Showing timing recovers most of the temporal loss (7.2 → 8.9 against 9.8) and produces the best
structural enrichment of all three arms** — most links, most mediators, highest enrichment — at the
fast latency. Delay, duration and persistence are not magnitudes; they are structure, and withholding
them bought no safety while losing exactly the material the rich model exists to carry.

⚠ **The one extra gate failure (14/18 vs 15/18) is a single run and should not be read as a cost.**
At n=18 a one-run difference is within the variance already visible across these arms; the failing
gates (G2 ×3, G7 ×1) are the implied-singular and weak-keyword classes documented above, not
something blinding or unblinding plausibly causes. Confirming or dismissing it needs more runs, and
it is not worth them before the architecture is settled.

**Recommendation: the widener sees structure and timing, never magnitudes.** Equal fidelity, the best
structural enrichment measured, 17% faster than showing everything, and immutability holds by
construction rather than by test.

## Evidence grounding: adopted, measured, and the cost turned out to be padding

The one criterion where v6 dual-draft beat this contract was evidence grounding. Its M2 requires a
non-empty `evidence_pointer`; the **live** M1 reviewer in plot-lite goes further and requires the id
to resolve to a real fragile edge or evidence-gap factor, flagging the item when it does not. That is
the stronger rule, and it is now the contract's: `grounded_in` is required on options, factors,
outcomes, causal links and notes, and an id must resolve to something in this model.

**Measured, identical builder / corpus / gates, 6 briefs × 3:**

| | gate-clean | factors | links | mediators | temporal | enrichment | grounded items | **dangling refs** |
|---|---|---|---|---|---|---|---|---|
| before | 14/18 | 12.9 | 19.9 | 3.1 | 8.9 | 35.3 | — | — |
| **after** | 13/18 | 11.4 | 17.2 | **3.3** | **9.4** | 30.9 | **745** | **0** |

**Zero dangling references across 745 grounded items.** The model never invented an id. It also
added ~12% fewer items, which looked like a real cost until the blind dual-judge was pointed at the
two arms:

| | recognisable | causal validity | useful enrichment | honesty | legibility |
|---|---|---|---|---|---|
| **grounded** | 4.7 / 4.7 | **3.3 / 4.3** | **4.0 / 3.7** | 4.3 / 5.0 | 3.3 / 3.7 |
| ungrounded | 4.3 / 5.0 | 3.0 / 4.0 | 3.7 / 3.7 | 4.7 / 4.7 | **3.7 / 4.0** |

**Neither judge missed the 12%.** Grounded scores equal or better on causal validity and useful
enrichment *with fewer items*; ungrounded wins only on legibility, which is what having less content
buys. Judge wins split 2–1 and 1–2. **The enrichment the rule removed was padding**, and requiring a
resolving pointer is a free improvement in quality on top of perfect referential integrity.

⚠ Caveat: the gate difference (13/18 vs 14/18) is one run, and the judge comparison is 3 briefs at
n=1 per arm. Directionally clear, not precise.

⚠ Method note: my first judge run compared the wrong directory — `judge.py` globbed the old `arms/`
path rather than the staged pair. Caught by reading the arm names in the output. It now takes an
explicit `--root`.

## FINAL MATCHED COMPARISON — contract v0.5, finished admitted models, hard gates first

Identical corpus (6 briefs × 3 runs), identical contract, identical frozen gates. Gates are applied
**before** any quality or latency scoring, so an arm that fails a trust gate cannot buy its way back
with richness.

| | **hard gates** | factors | links | mediators | temporal | qualitative | unknowns | enrichment | s | $ |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** single strong model, 1 call | **17/18** | 7.5 | 8.9 | 1.4 | 0.2 | 4.0 | 7.1 | 15.2 | **105** | **0.100** |
| **B** builder → widener, 2 calls | **17/18** | **11.7** | **18.3** | **3.8** | **2.9** | **5.6** | **10.7** | **32.1** | 138 | 0.149 |

**The hard gates tie — both 17/18, each failing G1 once.** Neither arm is more trustworthy than the
other, so the selection is made on representation, which is what the rich model exists for:
**B carries 2.1× the links, 2.7× the mediating mechanisms and 2.1× the enrichment** for 1.31× the
latency and 1.49× the cost.

⚠ Both arms improved from 15/18 to 17/18 once `selects` landed, which is the categorical fix doing
its work on the two briefs that previously failed every run.

⚠ Link-level `temporal` fell sharply (9.8 → 2.9) and that is **expected, not a regression**: timing
moved to `options[].timing` in v0.4, where it belongs. The canonical acceptance check accepts either
and passes 10/10 on 3/3.

**SELECTED: builder → widener.** Simplest path that satisfies the gates *and* carries the
representation; the single-model route is a legitimate cheaper fallback at 70% of the latency and 67%
of the cost, thinner rather than less trustworthy.

## Recommendation

**Adopt `faithful builder → widener/critic`.** Builder: `gpt-4.1`, temperature 0, strict JSON
schema, ~2k-char prompt. Widener: a GPT-5.6 reasoning model at high effort on initial generation
and major structural revision only — never per conversational turn.

**Default to Terra; use Sol where quality matters most.** Terra is half the cost for most of the
benefit. Sol is the strongest arm on gates and richness and costs 2× Terra, 12× the builder alone.

---

## The result

| arm | what it is | gate-clean | factors | links | mediators | temporal | qualitative | s | $ |
|---|---|---|---|---|---|---|---|---|---|
| **A** current CEE | v202 + records path, `claude-sonnet-4-6` | **0 / 4** | 4.2 | 19.8 | 0 | 0 | 0 | 62.6 | n/a |
| **A′** Claude + rich contract (prose) | `claude-sonnet-4-6` | 6 / 18 | 7.4 | 6.9 | 1.4 | 5.1 | 3.1 | 62.8 | 0.089 |
| **B** GPT-4.1 + rich contract (enforced) | builder only | **27 / 32** | 4.3 | 2.7 | 0 | 0 | 1.9 | **18.9** | **0.022** |
| Luna builder | `gpt-5.6-luna` | 11 / 18 | 4.9 | 1.9 | 0.1 | 0.5 | 2.7 | 13.9 | 0.003 |
| **C** GPT-4.1 → Terra widener | `gpt-5.6-terra` high | **27 / 31** | 13.7 | 20.4 | 3.5 | 15.3 | 7.0 | 152.7 | 0.138 |
| C-dsk | as C + DSK allowlist | 6 / 7 | 12.6 | 20.1 | 3.9 | 17.4 | 5.4 | 138.7 | 0.151 |
| **D** GPT-4.1 → **Sol** widener | `gpt-5.6-sol` high | **26 / 31** | **16.6** | **25.2** | **5.2** | **19.2** | **8.8** | 153.0 | 0.274 |

⚠ **Those gate columns moved after a second scorer correction, disclosed in full below.** Before it,
B was 13/18, Terra 11/17 and Sol 13/18. Read the correction before quoting any of these numbers.

**The headline: the widener adds roughly six times the modelling content at the same gate-pass rate
as the builder alone, and every rich-contract arm beats the live product decisively.** Current CEE
passed 0 of 4 fresh draws.

⚠ **I have already had to correct my own headline once, and it is worth saying so.** An earlier
draft reported Sol at **9/9** — that was 9 runs on 3 briefs. On the full six-brief corpus Sol is
**13/18**, tied with the builder. The 9/9 was a small-sample artefact of exactly the kind Paul's
amendment 4 exists to catch. Treat every figure here as "best measured so far", not settled.

---

## Reliability at n=10 on the two briefs that matter (amendment 4)

Ten runs each on `pricing-staging` (Paul's real brief) and `12-similar-options` (the
near-duplicate-option trap), scored on the same gates:

| arm | pricing ×10 | similar-options ×10 | combined |
|---|---|---|---|
| **A** current CEE | **0/3** | — | **0/3** |
| A′ Claude + contract (prose) | 3/3 | 0/3 | 3/6 |
| Luna builder | 3/3 | 2/3 | 5/6 |
| **B** GPT-4.1 builder | **10/10** | **10/10** | **20/20** |
| **C** Terra widener | **10/10** | 9/10 | **19/20** |
| **D** Sol widener | **10/10** | **9/9** | **19/19** |

**This resolves the earlier ambiguity.** The 13/18 and 11/17 figures were dragged down by the other
four briefs — chiefly `03-vague-underspecified` (which contains no numbers, where G2 fires on an
implied singular and the weak G7 keyword check fires on "not sure") and `02-multi-option-constrained`
(where options act on factors the model classified `external`). **On the two briefs that carry the
actual product risk, the builder and both wideners are effectively clean at n=10 and the live
product is 0/3.**

It does not mean "deterministic". 20/20 and 19/20 are failure rates of ≤5% at n≈10 on two briefs,
not a guarantee; the four-brief weakness above is real and is where the next work should go.

---

## What the comparison proves about model vs contract (amendment 1)

- **A′ ≫ A (6/18 vs 0/4): the contract does substantial work.** The same model family that produces
  0 clean runs through today's pipeline produces 6 when asked for the rich contract instead. CEE's
  four known failures are contract and pipeline failures, not model-capability failures.
- **B > A′ (13/18 vs 6/18), but the comparison is confounded — and the confound is the finding.**
  A′ could not run with its schema enforced, because **Anthropic's structured-output validator caps
  a schema at 16 union-typed parameters and the rich contract needs 27**, verbatim: *"Schemas
  contains too many parameters with union types (27 parameters with type arrays or anyOf) …
  limit: 16"*. It also rejects a nullable enum that OpenAI accepts (*"Enum value 'days' does not
  match declared type"*). So A′ ran prompt-only, and B vs A′ is "enforced schema + GPT-4.1" versus
  "prose schema + Claude". **Do not read it as "GPT-4.1 is the better modeller."**
  Corroboration, not proof: CEE budgets against the same limit itself —
  `anthropic-graph-schema.ts` computes a union-param count and logs `UNION BUDGET EXCEEDED` above
  16, currently sitting at 10/16. ⚠ It **logs**, it does not throw; an earlier peer report said
  "throws" and we both re-derived it. The load-bearing fact is the API limit, not a CEE boot guard.
- **D ≥ B on gates with ~6× the content: widening supplies the intelligence without costing
  fidelity.** The builder alone is faithful but thin — 2.7 causal links, no mediators, no temporal
  structure. The widener reaches 25 links, 5 mediators and 19 temporally-qualified links while
  leaving every user fact byte-identical (immutability checked on every widener run, not trusted).

---

## Current CEE's failures, on fresh traced draws

Four draws, trace confirming `claude-sonnet-4-6` on `draft_graph_default@v202`,
`model_override_active: false`.

- **G1 user provenance — 4/4 FAIL.** The user's £49, £59, £20k and 12 months never arrive
  user-attributed. The user's own option carries `source: cee_hypothesis`, `value_confidence: low`,
  reason *"no stated figure is cited for this option→factor effect"*.
- **G4 strict constraint — 4/4 FAIL, and read it as a contract absence, not a drafting failure.**
  *"monthly churn under 4%"* becomes `operator: "<="`, relabelled *"at or below 4%"*, with no
  disclosure; on one draw of the perturbed wording the constraint is **absent altogether**.
  ⚠ **G4 is structurally unsatisfiable for today's CEE.** The operator enum at `assist.ts:407` is
  `[">=", "<="]` and **no `src/` producer emits `strictness` or `relaxed_to` at all** (contrast
  control in the same sweep: `provenance` as a field, 3,019 hits — so the probe sees the family and
  the zero is real). No CEE code path could pass this gate. It measures a missing representation in
  the wire contract, and **no arm comparison should read Arm A's G4 failure as model quality.**
  *Found independently by the evaluation-contract agent, which is why it is stated here rather than
  left implicit in a table.*
- **G6 lever discipline — 2/4 FAIL.** Options intervene on the churn node, which is the constrained
  outcome, not a lever.
- **G3 invented baseline — 0/4 FAIL** *(corrected, see below)*.
- The duplicate-£59 option did **not** reproduce; it was demoted as `endpoint_demoted_duplicate`.
  It is run-to-run variable, so that failure is "sometimes", not "always".

---

## Where CEE launders AI content into user truth (corrected, with a peer's finding)

My first draft said "CEE defaults AI values to user truth". That is refutable as written. The
accurate statement, verified in code:

- **Nodes — an allow-list of one.** `schema-v3.ts` decides
  `node.data.extractionType === "inferred" ? "cee_inference" : "brief_extraction"`. Only the exact
  string `"inferred"` escapes; every other non-empty value — `assumed`, `estimated`,
  `ai_proposed`, `hypothesis` — lands on `brief_extraction`, i.e. presented as taken from the
  user's brief. Mitigation worth recording: a deterministic sweep defaults a *missing*
  `extractionType` to `"inferred"`, so the absent case lands safely. **The laundering window is a
  present-but-unrecognised value, not an absent one.**
- **Edges — a substring decides authorship.** `mapToV3ProvenanceSource` lowercases the provenance
  string and tests `includes("user")` **first**, before `"specified"` and `"manual"`. Any
  provenance string containing the word "user" anywhere — including free-text reasoning routed
  through `extractProvenanceForV3` — is promoted to `user_specified`. This path is reachable from
  model-authored prose. *Found by the prior-work research lane, verified here.*

The contract closes both shapes the same way: an explicit map with **no default branch**, which
raises on an unknown value, plus the post-projection gate below.

---

## Trust gates before scores

Nine deterministic gates, no model involved. G1 user values survive · G2 no user-attributed number
absent from the brief · G3 no invented baseline · G4 strict limits never silently relaxed · G5 no
semantic duplicate of a user option · G6 options act only on levers · G7 declared temporal and
qualitative material survives · G8 no unknown promoted to a point estimate · **G9 post-projection
provenance** (amendment 2).

**G9 is load-bearing, and the proof is a fabricated control — not the real data.** The real mapping
passes on all 121 projected models. The fail-open mutant (the CEE shape above) *also* passes on real
models, because no arm produced an unanchored user-claimed lever. A control that passes at base is
no control, so discrimination is demonstrated on a purpose-built fixture, where the mutant is
caught: `G9_laundered … non-user lever projected as brief_extraction`. Reproduce with
`python3 runner/project.py --control` (exit 0 = discriminates).

### One scoring correction, disclosed
G3 was inconsistent between arms: the CEE branch scored "value not in the brief" regardless of
label, while the rich branch scored provenance. A parallel agent's **pre-registered** predictions
caught it. Both branches now use one rule — an invented *baseline* is a current-state value asserted
with no anchor and no AI label; a labelled `cee_hypothesis` alternative price is a legitimate AI
proposal. **The fix removed 4 failures from current CEE and changed no other arm**, i.e. it moved
against my own recommendation, which is the safest direction for a correction. Pre-fix scorer kept
at `runner/score_arms.pre-g3-fix.py`.

### A second scoring correction, disclosed
**G2 was stricter than the contract it scores.** Its first version compared a user-attributed number
against the brief's literal digits only, so it failed a model for recording "next quarter" as
`value: 1, unit: quarters` **with `transformation: "next quarter → 1, unit quarters"` declared** —
a derivation the contract explicitly requires the model to declare, and which the source-binding
validator in `run_arms.py` already accepts. Two of my own checks disagreed, and G2 was the wrong one.

G2 now honours a declared transformation and still fails an undeclared one. **Control, run before
re-scoring:** the same fact with a declared transformation PASSES; an undeclared `7` for "a tech
lead" FAILS with `NO declared transformation`. So the exemption is not a blanket.

⚠ **This correction moved numbers in my recommendation's favour**, unlike the G3 one, so it deserves
the harder look: the pre-fix scorer is kept at `runner/score_arms.pre-g2-fix.py` and re-running it
reproduces the old table exactly. The judgement is that a gate cannot be correct while contradicting
the contract's own `transformation` field — but a reviewer should check that reasoning, not the
outcome.

**What survived the fix was a real defect — and it is now fixed and measured.** The remaining G2
failures were models recording an implied singular with **no** transformation declared: "a tech
lead" → `1`, "next quarter" → `1`. Contract rule 2a now requires a transformation whenever the
digits of `value` do not appear in `source_quote`, including an implied count or period, and the
schema description says so.

Re-ran the gpt-4.1 builder ×3 on the two briefs where **every** previous run failed G2:

| | G2 pass | fully gate-clean |
|---|---|---|
| before rule 2a | **0 / 6** | 0 / 6 |
| after rule 2a | **6 / 6** | 5 / 6 (one unrelated G6) |

The models now declare exactly what was missing: `a tech lead → 1`, `next quarter → 1 quarter`,
`two developers → 2`, `£200k → 200000`. Committed `2a0fa744`; evidence in `arms-v02/`.

**And it generalises — re-measured on the whole corpus, not just the two briefs it was aimed at.**
gpt-4.1 builder, 6 briefs × 3 runs under v0.2:

| | gate-clean | G2 failures |
|---|---|---|
| contract v0.1 | 13 / 18 | 3 |
| **contract v0.2** | **15 / 18** | **0 of 18** |

Per brief: pricing 3/3 · pricing-b 2/3 · similar-options 2/3 · multi-option 3/3 · vague 3/3 ·
hiring 2/3. **G2 is eliminated entirely**, and the three remaining failures are one each of G4, G6
and G7 — of which two fall on checks this memo already flags as weak: the G4 one is the contested
brief-12 oracle (the model recorded `<` where I oracled `<=`, i.e. over-strictness), and the G7 one
is the keyword check losing "next Pro feature release". **Only the G6 failure is unambiguously the
model's fault** (an option treating the budget as a lever).

**This is the only change tonight where a contract edit was followed by a measurement rather than an
assertion**, and it is the cheapest fidelity improvement found all session: one prompt rule, ~$0.45
of re-runs, +2 gate-clean runs and one whole gate closed.

### Two contract changes tried, measured, and BOTH REVERTED — and a finding I withdrew

The one residual failure genuinely attributable to the model is G6: on one hiring run, options set
the **budget**, a quantity the same model recorded as a constraint, which makes that constraint
unfalsifiable. I tried two fixes. Both made the frozen gates worse, both are reverted, and the
second attempt refuted a finding I had already written down.

Measured on the two affected briefs, gpt-4.1 builder ×3 each:

| contract | clean | G6 | G2 | one-hot indicators claimed as user-known |
|---|---|---|---|---|
| **v0.2 (shipped)** | **5 / 6** | 1 | 0 | **0** |
| v0.3 — "a constrained quantity is never a lever" | 4 / 6 | **0** | 2 | 10 |
| v0.4 — "never write 1/0 as an on/off flag" | 4 / 6 | 1 | 2 | 2 |

⛔ **I withdraw the claim that the contract cannot express a categorical choice.** I wrote that after
seeing v0.3 produce `value: 1` one-hot indicators on "enter Germany" and "hire locally", and called
it a real design gap that v0.3 had merely surfaced. It is not: **v0.2 produces zero of them.** The
one-hot behaviour was *caused* by my own constrained-lever rule pushing the model toward more lever
settings, and the rule I then wrote to fix it only reduced the symptom my previous rule had created,
while still scoring worse than shipping neither. The gap was an artefact of my experiment, and the
earlier paragraph claiming otherwise was wrong.

**v0.2 is the best contract measured, and both later rules are reverted.** G6 stays open at one
failure in eighteen runs, because every attempt to close it has cost more than it saved. Whoever
takes it next should note that the obvious fix and the obvious fix-for-the-fix have both been tried
and measured.

⚠ **One genuinely new open item, from an untested brief.** `13-forced-binary` (no oracle, so absent
from every gate count) fails source-binding 4–6 times per run with `provenance user with no
source_fact_id` on factors — the model marks factors as the user's without anchoring them. That is a
real defect on a brief shape the corpus never scored. Add an oracle for it before trusting any
forced-choice brief.

### Other honest limitations
- The gates were written from the approved spec, but two arms had already run. No scoring change has
  been made since the first full scoring run other than the G3 correction above. The formal
  freeze-with-independent-review is landing separately in TypeScript; treat this Python layer as the
  fast path, not the frozen authority.
- **G7 is a keyword check and is weak** — it scores "not sure" as lost qualitative material. Discount
  G7-only failures.
- **One oracle is contested.** For brief 12, *"without pushing churn above 5%"* is oracled `<= 5`;
  several arms recorded `< 5`. That is over-strictness, the opposite of the failure we care about.
- G2's recurring failures are models recording an implied singular ("a tech lead", "next quarter")
  as a user-stated `1`. Real over-attribution, minor; the contract should force an explicit
  `transformation` for implied counts.
- Cost for Terra and Sol is `n/a` in earlier artefacts and filled here from verified list prices
  (below); latency was measured, cost is computed from measured tokens.

---

## The gates were checked for vacuity, independently, over 126 real models

A gate that never fires is indistinguishable from a gate that cannot fire. An independent sweep
(`scripts/wp1-gate-sweep.ts`, 126 rich models across 7 arms, recorded in `wp1/GATE-SWEEP.md`) gives
pass/fail/NA per gate: G1 88/23/15 · G2 109/14/3 · G3 110/**0**/16 · G4 85/26/15 · G5 114/12/0 ·
G6 122/1/3 · G7 69/14/43 · G8 126/**0**/0.

**The two gates that never failed were shown to be true-and-non-binding rather than blind.** For G8,
778 numeric values were inspected across all three of its limbs, 633 items genuinely carry
`epistemic_state: unknown` and every one of them is null-valued, and a purpose-built mutant REDs the
gate. For G3, a positive control in the same test (delete one `source` field) REDs it.

That sweep **independently corroborates this memo's central count by a different method**: it found
that no widener in any arm ever emitted a magnitude of kind `ai_estimate` carrying a value. Two
measurements, two authors, one answer.

⚠ It also contradicted the plan I wrote: the banked failing capture **passes** G3, because
`cee_hypothesis` is a label and G3 is about the absence of one. The gate was kept as specified and
the plan's expectation was recorded as wrong, rather than widening G3 to swallow "labelled but
invented" — which is G2's and G8's job.

## Two of the evaluator's seven dimensions never measured anything

Independently verified by the prior-work research lane and consistent with what I found:
`scoreConstraintRetention` (weight **15%**) reads `brief.meta.expected_constraints` and
`scoreRatioEncoding` (weight **5%**) reads `brief.meta.ratio_metrics`. Both return **1.0 =
not-applicable when the field is absent**, and **zero of the 16 tracked briefs declare either** —
including `pricing-staging.md`, which is Paul's own pricing test. So every historical evaluator
score carries an unearned 20%, and the "churn under 4%" constraint has never once been scored by the
tool built to score it. The contrast control that makes this a finding rather than a guess: the
scorer genuinely reads those fields, and so does the `bakeoff-v6-dry-pass` branch — the capability
has existed alongside the corpus the whole time and has never fired.

Combined with the parameter-quality dimension rewarding *varied* invention (it penalises edges at
exactly `|mean|=0.5, std=0.125`), **two of the seven dimensions were not measuring what their names
say.** Six months of model selection ran on that rubric. What remains sound for reuse: structural
validity, option differentiation, completeness and label specificity. A grounding scorer does not
exist yet — none of the seven dimensions asks whether a number is traceable to the brief. That is
the gap the trust gates in this session were built to fill.

## Blind dual-judge (amendment 3 — supporting evidence only)

An OpenAI judge (`gpt-5.6-terra`) and a Claude judge (`claude-sonnet-4-6`) saw the same anonymised
models, labelled by content hash, arm names stripped. Means 1–5, OpenAI / Claude:

| arm | recognisable | causal validity | useful enrichment | honesty | legibility |
|---|---|---|---|---|---|
| builder gpt-4.1 | 3.7 / 3.7 | 1.7 / 2.0 | 1.3 / 1.0 | 4.3 / 3.0 | **5.0 / 4.7** |
| Luna builder | 3.3 / 3.7 | 1.7 / 1.7 | 1.3 / 1.0 | 3.3 / 3.0 | 4.7 / 4.7 |
| A′ Claude + contract | 4.0 / 4.7 | 3.0 / 3.3 | 3.0 / 3.0 | 3.3 / 3.7 | 4.0 / 4.0 |
| C Terra widener | 4.7 / 5.0 | 3.7 / 4.3 | 4.3 / 4.7 | 4.7 / 4.7 | 3.3 / 3.7 |
| C-dsk | 5.0 / 5.0 | 4.5 / 4.5 | 5.0 / 4.5 | 5.0 / 5.0 | 3.5 / 3.5 |
| **D Sol widener** | **5.0 / 5.0** | **4.3 / 4.7** | **5.0 / 5.0** | **5.0 / 5.0** | 3.7 / 3.7 |

**Both judges agree on the ordering across families** — the part worth trusting. Sol was named best
by both on 2 of 3 briefs. One consistent trade-off: **builder-only models win on legibility because
they are thin.** Enrichment costs legibility, so the widened model needs presentation work in the
UI; that is not a reason to prefer the thin model. Blinding hides the arm name; it does not remove
stylistic-family bias, and the judges are two of the families under test.

The judges also caught semantic errors the deterministic gates do not, which is why they are worth
keeping: *"labels 'Monthly churn' and 'MRR' as [known] when neither value is provided in the
brief"*, and *"multiple causal links are attributed to 'user', falsely implying the brief asserted
these causal relationships"*.

---

## What the analysis projection loses (amendment 6)

Rich model → GraphV3-shaped projection over 121 models. **Nothing is invented to make analysis run.**

| lost at projection | count |
|---|---|
| unknown magnitude (no placeholder written) | 938+ |
| no value (none invented) | 762+ |
| temporal semantics (delay / duration / persistence) | 659+ |
| qualitative factors | 494+ |
| mediating mechanisms | 169+ |
| horizon (no such field exists in the target) | 84+ |
| strict operator (projected **with disclosure**) | 65+ |

The strict constraint is preserved exactly in the rich model (`operator: "<"`) and projected as
`<=` **only with `strictness: "strict"` and `relaxed_to: "<="` recorded** — disclosed, never silent.
No cross-repo schema change is proposed, per amendment 6.

**This table is the case for the rich model existing at all.** The widener arms generate the most of
what today's numerical contract cannot carry — temporal decay, mediators, qualitative factors —
which is exactly the material needed to represent a real decision.

---

## Economics (prices verified 21 Sep from OpenAI's published pricing)

`gpt-4.1` $2/$8 · `gpt-5.6-terra` $2/$12 · `gpt-5.6-sol` $4/$20 · `gpt-5.6-luna` $0.20/$1.20 ·
`claude-sonnet-4-6` $3/$15 per 1M input/output.

| arm | $/model | s/model | model calls |
|---|---|---|---|
| Luna builder | 0.003 | 13.9 | 1 |
| **B gpt-4.1 builder** | **0.022** | **18.9** | 1 |
| A′ Claude + contract | 0.089 | 62.8 | 1 |
| **C Terra widener** | **0.138** | 152.7 | 2 |
| D Sol widener | 0.274 | 153.0 | 2 |
| A current CEE | not comparable | 62.6 | **3** |

`trace.pipeline.llm_call_count: 1` on the CEE path is **false as a model-call count** — Render logs
show three calls per draft: draft parse, coaching pass, and an OpenAI `o4-mini` validation pass at
~46 s. The builder alone is 3× faster than the incumbent for the faithful skeleton; builder +
widener roughly doubles the incumbent's latency, which is acceptable for initial generation and
clearly not acceptable per turn.

---

## Recommended architecture

```
brief
 ├─ BUILDER          gpt-4.1, temp 0, strict json_schema, ~2k prompt      ~19 s   $0.022
 │                   emits ONLY what the user said, every fact anchored to a verbatim quote
 ├─ DETERMINISTIC SOURCE-BINDING VALIDATION                                free
 │                   quote ⊂ brief · value derivable from quote or transformation declared ·
 │                   no user provenance without an anchor
 ├─ WIDENER/CRITIC   gpt-5.6-terra (Sol for hard cases), high effort      ~135 s  $0.138
 │                   adds options, factors, mediators, risks, temporal structure, challenges —
 │                   all ai_proposed; user facts byte-identical (checked, not trusted)
 ├─ DETERMINISTIC ADMISSIBILITY — 9 trust gates incl. G9 post-projection   free
 └─ ANALYSIS PROJECTION → GraphV3 + explicit loss report and disclosures
```

## What this lets us bypass — and what must be proven first

Evidence supports bypassing, on the generation path: the 40k-char v202 draft prompt and the ~10.5k
records instruction (replaced by ~5k of builder + widener prompt); the projector's fixed-point
repair loop, `findUndevelopedDuplicates`, and the option-mapping recovery LLM call (the builder does
not emit the duplicate or the unmapped option); the `stated-amounts` rescue path and the whole-brief
magnitude scan (nothing needs rescuing when the number was anchored at emission); the node
allow-list-of-one and the edge substring matcher (replaced by a map that refuses to default).

**Now measured, and it failed:** the projected GraphV3 is **refused by PLoT** while the live
product's graph is accepted — see the finding at the top. Nothing on the bypass list should be
removed until the magnitude question above is decided, because the current machinery's only
advantage is that it manufactures the numbers the engine demands.

## The reviewer that already exists — read before freezing widener v0.1

`claude/v6-dual-draft-mvp` @ `cd4de7ff` (July 2026, Codex-reviewed, **never merged**, absent from
HEAD) contains `src/cee/dual-draft/` — a second-model reviewer with the same shape as the widener.
I read its contract at that tip. It is **better than mine in one respect and shares the defect that
this whole memo is about in another.**

⚠ **And the measurement above settles whether we need their enforcement.** Their node allowlist
physically prevents invention at the API layer; my contract asks for it in a prompt and checks it in
a gate. Measured: **0 of 1,352 factors** and **0 of 1,763 links** carried an invented number under
my contract. So the physical prevention is belt-and-braces here, not a fix for an observed failure —
worth taking because it is free, not because the softer version leaked.

**Adopt from it:**
- **The node allowlist physically prevents invention.** `ALLOWED_NODE_DELTA_FIELDS` is
  `id, kind, label, description, category, uncertainty_drivers` — no thresholds, no priors, no
  interventions — and the structured-output schema is closed (`additionalProperties: false`), so
  *the API layer* stops the reviewer emitting a value-bearing field. That is enforcement at the
  wire; my widener relies on a prompt instruction plus a downstream gate. **Theirs is stronger and
  I would take it.**
- **A vocabulary for "ask, don't fill".** `ARTIFACT_PROPOSAL_TYPES` = `added_evidence_gap`,
  `uncertainty_flag`, `clarification_proposal` — non-mutating proposals, separated from
  `MUTATING_PROPOSAL_TYPES` (`added_option`, `added_risk`, `added_assumption`,
  `added_causal_link`). My `unknowns[]` and `notes[]` are the same idea with less structure.
- Guards worth keeping: a proposal cap, G12 option-surface invariance (the reviewer may not alter
  the option surface), G14 engine-boundary claim scan, and a deterministic merge that re-validates
  against the real schemas rather than trusting the model's output.

**Do NOT adopt unchanged — it mandates the invented magnitudes:**
`ALLOWED_EDGE_DELTA_FIELDS` includes `strength` and `exists_probability`, and the JSON schema marks
them **required** on every proposed edge. The only check on them, G10, is *numeric sanity*:
`|mean| <= 1`, `std >= 1e-6`, `std <= max(0.5, 2|mean|)`. **Nothing checks grounding.** So that
reviewer cannot propose a causal link without inventing its strength, and an invented strength
passes as long as it is in range.

⚠ **And one comparison that cuts against my contract: their schema FITS the provider budget and
mine does not.** `proposal-json-schema.ts` is an Anthropic structured-outputs schema that stays
inside the 16-union-parameter limit; my rich contract needs 28 and is refused outright. That is not
an argument that theirs is better — mine deliberately carries semantics theirs refuses to carry
(qualitative measurability, epistemic state, temporal structure, `magnitude: unknown`) — but it means
**one of the two designs can run on the incumbent provider today and the other cannot.** Whoever
chooses should weigh that explicitly. `PROPOSAL_CAP = 8`, and every proposal requires a non-empty
`evidence_pointer`, which is a discipline my contract lacks and should probably borrow.

That is the same root cause as the PLoT finding, designed in nine months ago. The synthesis for
whoever lands this: **take their node allowlist and proposal vocabulary, keep my
`magnitude: {kind: unknown}`**, and make `strength` optional on a proposed edge so the reviewer can
say "this link exists and I do not know how strong it is" — which is what the honest model needs
and what today's engine refuses. Verified at `cd4de7ff`; line offsets differ between clones, so
re-derive rather than transcribe.

## Risks

1. **Provider lock-in.** The rich contract cannot be enforced by Anthropic (16-union cap vs 27
   needed). Either the builder stays OpenAI, or the contract is split into smaller enforced calls.
2. **The widener is an OpenAI reasoning model, and CEE's OpenAI adapter cannot serve the critic
   seam.** `openai.ts` throws `openai_critique_not_supported`, and `explainDiff` is stubbed the same
   way — so `POST /assist/critique-graph` (Anthropic-only, live on staging and production) is the
   natural landing seam and currently cannot host an OpenAI widener. Integration blocker, not a
   design flaw. *Lead supplied by the prior-work research lane.*
3. **Latency** ~150 s for builder + widener; must be asynchronous.
4. **Sample size.** The ×10 finalist pass covers only two briefs. The four-brief weakness
   (vague/underspecified and multi-option-with-external-factors) is measured but not fixed.
5. Enrichment costs legibility on both judges; the UI must present a widened model well.

## Next steps, in priority order

1. **DONE — see the n=10 table.** Builder 20/20, Sol 19/19, Terra 19/20, current CEE 0/3. Next
   sampling effort should go to `03-vague-underspecified` and `02-multi-option-constrained`, where
   the failures actually concentrate.
2. **DONE, and it failed — decide the magnitude question.** A projected model is refused by PLoT
   (`NO_EFFECTIVE_PATH_TO_GOAL`) precisely because it refuses to invent causal strengths, while the
   live graph is accepted on 17 invented ones. Pick elicit / propagate / disclose before more
   generation work.
3. **Read `claude/v6-dual-draft-mvp` @ `cd4de7ff5` before building any more.** A dual-draft
   generator with a reviewer task `m2_graph_review`, a strict model resolver, proposal size guards
   (`proposal_field_too_large`) and a bake-off harness with `verdicts.ts` exist on the CEE remote,
   Codex-reviewed, July 2026, **never merged** — and are absent from HEAD (0 files for
   `m2_graph_review|dual_draft`; contrast `critique_graph|moe-spike` → 53 files, so the probe sees
   the family). That is this architecture already implemented behind a flag, including a
   "flag-OFF behaviour-preservation proof" that shows how to land it without touching live
   behaviour. Read `m2_graph_review`'s output contract first: widener v0 either matches it or must
   justify diverging. Related: `claude/v6-dual-model-production-system` @ `697d58470`,
   `claude/v6-dual-draft-proposal-size-guards` @ `797e67319`, `claude/bakeoff-v6-dry-pass` @
   `d7c8e3144`. *Found by the prior-work research lane.*
   ⚠ Also unpushed and on one disk only: `claude/v6-structured-outputs-spike` @ `e22760f37`
   (confirmed absent from the remote) — a fail-closed structured-output parse module with 29 tests,
   which is exactly the parse contract a strict-schema builder needs. **Someone should push it.**
4. Land the TypeScript trust gates and scorer in `tools/graph-evaluator`, take the independent
   review, freeze the contract hash.
5. Decide the widener's home: extend `critique-graph` to OpenAI, or run the widener outside CEE.
6. Investigate Sol's and Terra's G2 failures (implied-singular over-attribution) — a one-line
   contract change to require an explicit `transformation` may close most of them.
