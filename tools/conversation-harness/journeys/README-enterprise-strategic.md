# Enterprise strategic golden journeys (brief §5)

Five representative strategic-initiative scenarios added to the conversation-harness
evaluation set. **Authoring only** — no new enterprise functionality, no served-state
change, no harness-code change. They are ordinary `journeys/*.json` fixtures that the
existing `runner.mjs` can drive against any CEE base (hermetic arm or staging), exactly
like `journey-v2.json` and the `s1`–`s5` journeys beside them.

## Why these exist

The prior harness journeys are product-shaped (hiring, feature launch, edit loops). The
buyer-facing evaluation needs **enterprise strategic** decisions with real tension —
the situations a leadership team actually brings to a decision tool — so the coach's
strategic judgement can be scored, not just its mechanics.

## The five scenarios

| File | Decision type | Core tension (one line) |
|---|---|---|
| `enterprise-transformation-programme.json` **(PRIMARY)** | Transformation-programme direction | A new CTO inherits a £40m programme from a departed COO and must decide continue / re-scope / pause with the original rationale lost, dissent buried, and the incentive behind the case unknown. |
| `enterprise-ai-operating-model.json` | AI investment / operating-model choice | Buy vs build vs partner for underwriting AI, plus central-CoE vs embedded pods, with no in-house model-risk governance and a regulator demanding explainability. |
| `enterprise-portfolio-prioritisation.json` | Product / portfolio prioritisation | Allocate a flat R&D budget across four product lines when the growth bet's revenue is a guess dressed as a forecast and per-line unit economics are disputed. |
| `enterprise-cross-functional-initiative.json` | Cross-functional strategic initiative | Scope a customer-data-platform initiative across Marketing / IT / Legal / Sales when each function frames it differently, the DPO's GDPR concern was softened, and customer-service isn't in the room. |
| `enterprise-market-entry.json` | Market-entry / major investment | Whether and how to enter a new market with up to £120m at stake, when the whole case rests on one optimistic market-size estimate and there's no in-house regulatory expertise. |

## §5 criteria — what each scenario makes testable

| Criterion | |
|---|---|
| **C1** | expose assumptions that materially drive the conclusion |
| **C2** | distinguish evidence from interpretation |
| **C3** | surface genuine disagreement without manufacturing it |
| **C4** | identify missing evidence / stakeholders / expertise |
| **C5** | preserve minority concerns |
| **C6** | help the team toward a defensible commitment |
| **C7** | retain enough rationale for another leader to understand later |

Every scenario exercises **all seven** criteria. Each turn carries an `expect` block with
the criteria it targets and an explicit PASS / FAIL definition, e.g. a turn that says
*"surface the buried dissent — PASS = names it unprompted; FAIL = affirms consensus"*.

Coverage map (turn ids that are the primary probe for each criterion):

| | C1 | C2 | C3 | C4 | C5 | C6 | C7 |
|---|---|---|---|---|---|---|---|
| transformation (PRIMARY) | TP02, TP05 | TP03, TP08 | TP03, TP06 | TP09 | TP06, TP07 | TP05, TP09 | **TP10** |
| ai-operating-model | AI02, AI05 | AI03 | AI03 | AI06, AI07 | AI07 | AI05, AI08 | AI08 |
| portfolio-prioritisation | PF06, PF08 | PF03, PF06 | PF07 | PF02 | PF07 | PF05, PF09 | PF09 |
| cross-functional-initiative | XF05 | XF03 | XF03, XF07 | XF02 | XF06, XF07 | XF05, XF08 | XF08 |
| market-entry | ME02, ME06 | ME03 | ME03 | ME06, ME08 | ME07 | ME05, ME09 | ME09 |

## The PRIMARY journey — six required narrative elements

`enterprise-transformation-programme.json` weaves all six brief-§5 elements into one
continuous conversation. A new Chief Transformation Officer has inherited a programme and
is trying to reconstruct and re-decide it:

| Element | Where it lives |
|---|---|
| **E1** hidden incentive assumption | opening (COO's bonus tied to headcount reduction) → **TP02** |
| **E2** conflicting interpretations of the strategy | opening (cost vs customer split) → **TP03** |
| **E3** important dissent being buried | opening (SLA concern cut from the board pack) → **TP06**, made a model element in **TP07** |
| **E4** leadership turnover | opening (inherited from the departed COO) → **TP02**, **TP10** (a future successor) |
| **E5** loss of the original rationale | opening (decision memo can't be found) → **TP10** |
| **E6** later questions about why the decision was made | **TP10** ("if the board asks in twelve months why we re-scoped…") |

**TP10 is the rationale-retention test (C7):** it asks whether a leader who replaces the
user could reconstruct the decision without them — directly probing whether the coach
helps preserve enough rationale that the E5 failure (a lost memo) is not repeated.

## Format (matches `runner.mjs`, verified at the bytes)

Same superset the runner documents in its header. Fields the runner reads: top-level
`requires_seeded_scenario`, `placeholders`, `defaults.stage`, `turns`; per-turn `id`,
`stage`, `message`, `turn_class_hint`, `edit_intent`, `only_if`, `concurrent_duplicate`.

These fixtures add extra keys the runner **ignores** and that carry the evaluation spec:

- top-level `decision_type`, `primary`, `honesty`, `criteria_legend`, `element_legend`,
  `expected_model` (the target CEE graph shape — objective / options / factors / risks —
  the coach should draft from the opening turn);
- per-turn `expect { criteria, elements?, challenge_obligation?, pass, fail }`.

Extra keys are inert to the loader (the shipped `journey-v2.json` already carries ignored
`note` / `targets` turn keys), and they never reach the scorer either — `score-run.ts`
scores from the per-turn `meta.json` the runner writes, which only carries the known
fields. So the `expect` / `expected_model` blocks are **provenance + human-review spec**
today. See the FILED note below on auto-grading them.

Each journey opens with a fresh, client-minted disposable scenario (no seed required),
so the opening turn (`stage: frame`, `turn_class_hint: draft`) triggers a draft and the
rest of the turns probe it. Every journey has ≥1 edit turn (`edit_intent: true`), ≥1
challenge-inviting question (a "strongest case against" turn), and ≥1 commit-intent turn.

### Running one

```
export OLUMI_ASSIST_KEY=...        # or ASSIST_API_KEY
node tools/conversation-harness/runner.mjs \
  --journey tools/conversation-harness/journeys/enterprise-transformation-programme.json \
  --arm ent-transformation --base http://localhost:3103
```

No `--scenario` is needed (these are `requires_seeded_scenario: false`).

## Coaching doctrine these scenarios exercise

Drawn from `parallel-briefs/AI-EXPERIENCE-DESIGN-DRAFT-2026-07-14.md` §1: 0–3 woven
questions; chips 0–3 (no decorative floor); the bounded challenge obligations (optional
pre-analysis prediction · **unconditional strongest-case-against on the first fresh-result
reading, form adapting to result status** · one adversarial check before commitment);
anti-sycophancy both ways; calibrated **leading-option** language (never "winner" / "I'd
do it"); provisional→team-owned voice; no dead ends. The "which is leading / strongest
case against" turns and the "tell me I'm right / just confirm it"-adjacent commit turns
are placed to probe exactly these.

## Honesty rule (these get quoted to buyers)

All five scenarios are self-contained and fictional: no real company names, and no
plausible-real financials presented as market fact. Monetary figures (£40m, £120m, £60m
ARR) are illustrative scenario parameters, not claims about any real market or company.

## FILED — not built (net-new harness code, out of this authoring lane's scope)

Auto-grading the §5 criteria requires a scorer extension that does not exist today:

1. A **§5 judge dim** (e.g. `D-S5`) that reads each turn's `expect { criteria, pass,
   fail }` from `journey.json` and runs the existing `scorer/llm-judge.ts` rubric per
   turn to emit a per-criterion pass/fail. Today `score-run.ts` computes D1–D11 from the
   wire and never reads the `expect` blocks.
2. To make the per-turn `meta.json` carry `expect` through to the scorer, `runner.mjs`
   would need to copy the extra turn keys into `turnMeta` (it currently whitelists only
   the known fields at `runner.mjs:219-226`).
3. An `expected_model` graph-shape check (does the draft contain the expected objective /
   option / factor nodes) would reuse the `tools/graph-evaluator` matchers, wired as a
   draft-turn dim.

None of these are built here — this lane is authoring content into the existing
substrate only. The scenarios are gradeable by a human reviewer against the `expect`
blocks in the meantime.
