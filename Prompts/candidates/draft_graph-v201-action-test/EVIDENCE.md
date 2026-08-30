# draft_graph_default v201 — "ACTION TEST" candidate

**Status: PREPARED AND UNPROMOTED. The candidate arm is UNMEASURED — see §4.**

## 1. The defect, live-witnessed

**Rung: WIRE-WITNESSED, 2026-08-30.** Deployed CEE `a18e194` (`/healthz`),
served prompt `draft_graph_default` **v195**, content_hash `152998b447819c2e`
(`GET /admin/prompts/status`), model `claude-sonnet-5`
(`CEE_MODEL_DRAFT_GRAPH`, read from the deployed Render env — not from YAML).

Brief `B1_diagnostic_nrr` (a diagnostic brief: three attributed explanations,
no named course of action) through the real pipeline,
`POST /assist/v1/draft-graph`:

| kind | id | label | provenance | source_quote |
|---|---|---|---|---|
| goal | `08157a64` | Decide What to Do About It | from_brief | "we need to decide what to do about it" |
| **option** | `657a8f73` | **The Product Has Fallen Behind the Competition** | from_brief | "the product has fallen behind the competition" |
| **option** | `8b08baad` | **We Are Selling to the Wrong Customers** | from_brief | "we are selling to the wrong customers" |
| **option** | `b8e1cbe6` | **Onboarding Is the Problem** | from_brief | "onboarding is the problem" |
| option | `824912e3` | Status Quo — Monitor and Wait | ai_inferred | — |

Three competing *explanations* became three *choices*. Downstream, the analysis
reports a win probability against each, so the product tells the user that "The
Product Has Fallen Behind" scores 0.12 — a number about a hypothesis, presented
as though it were a decision. This damages problem framing, the
hypothesis/option distinction, and scientific credibility at once.

Secondary damage visible in the same draw: the goal degenerates to the
platitude "Decide What to Do About It". **Not addressed here** — it is a
separate defect (an unstated-objective brief), and fixing it inside this change
would be scope expansion.

### It is deterministic, so one draw is a sufficient discriminator

Two independent draws (`live_B1_..._live1.json`, `live_B1_..._live2.json`)
produced **identical labels AND identical node ids** for all three diagnostic
options and the goal. Only the `ai_inferred` Status Quo and decision nodes drew
fresh ids (`824912e3`/`a88a8dea` vs `151538a2`/`3494d72f`) — `from_brief` ids are
content-derived, `ai_inferred` ids are not. **A single fresh B-class draw is
therefore a cheap and reliable post-change discriminator.**

### It is not one brief: `B2_diagnostic_support` is worse

A second, unrelated diagnostic brief (support-ticket volume; three teams
disagreeing on the cause) reproduced the defect more starkly — the option
labels are the **raw attributed sentences, verbatim, attribution included**:

| kind | id | label | provenance |
|---|---|---|---|
| **option** | `1e8ef5b4` | **engineering says it is a quality regression in the 4.2 release** | from_brief |
| **option** | `b6357601` | **support says the help centre content is out of date** | from_brief |
| **option** | `2d3c3923` | **product thinks we onboarded too many very small accounts too quickly** | from_brief |
| option | `c6e1ccaf` | Address all three causes in parallel (combined sprint) | ai_inferred |
| goal | `goal_inferred` | Achieve the best outcome for this decision | ai_inferred |

The product is offering "engineering says it is a quality regression" as a
*choice the team can make*, and scoring it. Note also the fourth option — the
model reaching for a combined-response path — which is the same instinct as the
"Run a structured diagnosis" option seen in the originally reported draws: **the
model already knows these are causes; the prompt simply lets it keep them as
siblings.**

### Why this is a low-risk change: the correct representation is already there

In **both** baseline diagnostic draws the model already emitted the three
explanations as **factors** — `Onboarding Programme Quality`, `Product
Competitiveness Investment`, `Ideal Customer Profile Fit` (live1); `Onboarding
completion rate`, `Product feature gap vs competitors`, `Customer fit quality`
(live2) — **and then also emitted them as options.** The graph already carries
the right structure; v195 merely also licenses the duplicate option nodes. So
the rule removes the wrong half of a duplication the model is already making,
rather than asking it to invent a representation it does not currently produce.

That observation also corrected the rule. An earlier draft of the fourth bullet
prescribed "an observable or external factor whose value is genuinely unknown,
or a risk" — but the model's own (correct) instinct is a **controllable**
factor, because onboarding quality is a lever you can pull. The prescription
would have fought it. The shipped bullet instead defers to the prompt's own
`FACTOR CATEGORIES` rules and puts the *disagreement* where it actually belongs:
uncertainty on the factor's **influence** (wider prior, lower
`exists_probability` on the causal edge), which is the prompt's existing
vocabulary for structural uncertainty.

## 2. The must-not-break arm, also live-witnessed at v195

A rule that fixes diagnostic briefs by breaking briefs whose named alternatives
are genuinely options would be **worse than the defect**, and it would not show
up in any corpus of diagnostic briefs. So the contrast arm was measured first,
at the same commit, prompt and model:

| brief | options emitted | verdict |
|---|---|---|
| `C1_build_vs_buy` | "build it in-house…", "Buy Segment on a 180k GBP Annual Contract", Status Quo | healthy |
| `C2_attributed_options` | "Relocate Five Existing Engineers", "Hire Locally from Scratch", "Contract Through an Agency for the First Year" | healthy |
| `C3_pricing` | "Per-Seat at 40 GBP…", "Introduce a Three-Tier Packaged Plan", hybrid, + | healthy |

**`C2` is the load-bearing control.** Its brief attributes the alternatives to
people in exactly the shape of the diagnostic brief — *"some of the leadership
team want to relocate five existing engineers, others want to hire locally from
scratch, and a couple think we should contract through an agency"* — and they
are real options. **Any rule keyed on attribution phrasing, on hedging, or on
the presence of disagreement destroys this case.** That is why the rule below is
keyed on the semantic type of the candidate (a move you could make vs a claim
that is true or false), and why the carve-out is pinned by name in
`tests/unit/prompts.draft-graph-v201-delta.test.ts`.

## 3. The change

Three anchored edits to the exact served v195 bytes; nothing else. Built by
`build.py` from `delta.json` (single source of truth, shared with the test).

- base `Prompts/canonical/draft_graph.txt` — sha256 `152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f`
  (agrees with Supabase `cee_prompt_versions.content_hash` and with the live
  `/admin/prompts/status` content_hash — three independent sources)
- candidate `draft_graph_v201.txt` — sha256 `46e5815d6dbbe2d320463059fb15ee33790e7937daeca695d73b29aa876ebb9e`, 61523 chars (+2230)

1. `## 1. EXTRACT` — "the decision and named options," gains "courses of action
   only; apply the OPTION_RULES ACTION TEST before treating any named thing as
   an option".
2. `## 7. OPTIONS` — "List options from the brief" becomes "List the brief's
   named candidates that pass the OPTION_RULES ACTION TEST".
3. `<OPTION_RULES>` — the ACTION TEST rule block itself, gating everything below
   it: options are moves, not diagnoses; the disagreement cue is explicitly *not*
   the test; attributed disagreement about **what to do** still names options; a
   failed candidate becomes the uncertainty it actually is (observable/external
   factor, or risk); the options then become the responses — including the
   diagnose-first path the model already volunteers unprompted.

## 4. ⚠ WHAT IS NOT PROVEN, AND WHY

**No candidate-arm draw exists. The behavioural half of the acceptance pair is
UNMEASURED.** Two routes to real draws were tried and both are closed:

- **`POST /admin/v1/test-prompt-llm`** takes an arbitrary stored version and
  calls the LLM without moving any pointer — the right shape — but it **cannot
  measure `claude-sonnet-5` at all.** With no `budget_tokens` the model runs
  adaptive thinking and consumes the whole 8192-token registry cap, returning
  `Content types: thinking` and no answer; with `budget_tokens` the API returns
  **HTTP 400 — `"thinking.type.enabled" is not supported for this model. Use
  "thinking.type.adaptive" and "output_config.effort"`**. The harness is stale
  against the model the product actually uses. (It also defaults to
  `claude-sonnet-4-6` from the prompt's `modelConfig.staging`, which is stale
  against `CEE_MODEL_DRAFT_GRAPH`; and it sends a single system block, whereas
  the live draft appends a second draft-by-records block — so it was never full
  fidelity either.) **Worth noting: on `claude-sonnet-4-6` the defect did not
  reproduce** — the same brief yielded five genuine action options. The defect
  may be specific to sonnet-5.
- **`POST /assist/v1/draft-graph`** is full fidelity but has **no
  prompt-version selector** — `forceDefault=1` (repo default) and `supa=1`
  (cache refresh) are the only seams, confirmed by a targeted sweep with a
  contrast control (`forceDefault` → 10 hits, any version-override symbol → 0).

The only remaining route is moving `staging_version`, which is a deploy and is
Paul's. **So the candidate arm is deliberately left unmeasured rather than
substituted with a lower-fidelity proxy that measures a different model.**

`Prompts/canonical/draft_graph.txt` is REFERENCE ONLY — `src/cee/draft/records/instruction.ts:90-95`
states this in the tree, and it is why a repo-only edit ships nothing.

## 5. Promotion recommendation (Paul's call)

Key `draft_graph_default` · staging pointer only · `active_version` untouched, so
production is unaffected.

Highest existing version is **200** (196–200 all exist and are unpromoted), so
mint as **201**.

```
# 1. mint the version (does NOT change what is served)
POST /admin/prompts/draft_graph_default/versions
     { content: <draft_graph_v201.txt>, change_note: "v195 + ACTION TEST ..." }
# 2. pin staging (THIS is the deploy)
PATCH /admin/prompts/draft_graph_default  { "stagingVersion": 201 }
# 3. reload — a re-pin without reload silently no-ops
POST  /admin/prompts/reload
# 4. confirm on the wire, sampling past the ~5-min per-instance loader TTL
GET   /admin/prompts/status   -> draft_graph version 201, content_hash 46e5815d6dbbe2d3
```

**Acceptance, immediately after step 4** (~6 minutes, exploits the determinism):

- (a) `B1_diagnostic_nrr` and `B2_diagnostic_support` → **no option node whose
  label is a diagnostic claim**; the three explanations appear as factors/risks;
  options are responses (+ Status Quo).
- (b) `C1_build_vs_buy`, `C2_attributed_options`, `C3_pricing` → **options
  unchanged in kind** from the v195 baselines in §2. **`C2` is the one that
  matters**; if `C2` loses its options, the rule has overfired and must be
  reverted, whatever (a) shows.

**Rollback:** `PATCH { "stagingVersion": 195 }` then `POST /admin/prompts/reload`,
then confirm `content_hash 152998b447819c2e` on the wire. Version 201 may be left
in place — an unpinned version is inert.
