# RESUME HERE — OpenAI Technical Architecture lane, 23 Sep 2026 ~21:30

> ⛔ **THIS FILE WAS REWRITTEN AT 21:30 AND ITS EARLIER VERSION WAS WRONG ABOUT THE
> CENTRAL FACT.** The 18:00 version said provider isolation was unachieved and the PoC
> needed its own deployment. **Both were false.** Isolation is request-scoped and
> already works. Nothing in this file is safe to quote without re-deriving — including
> this sentence.

## The goal (unchanged)

> Make the OpenAI PoC fast, simple and differentiated by using the optimal mix of OpenAI
> models, focused prompts, deterministic tools, context delivery, caching and optional
> challenger reasoning, while preserving Olumi's scientific and human-in-control principles.

---

## 1. ⭐ READ THIS BEFORE ANY CLAIM — the lane's dominant failure mode

**I published seven claims today that needed correcting. Four were the same mistake: I
measured one code path and attributed the result to another.** The correction is mechanical,
and it is the single most valuable thing in this file:

- **The OpenAI PoC is `POST /agent/v1/turn`** — `exit_path: agent_lane_v1`, one model
  `gpt-5.6-terra`, wrapped in `runWithProviderPolicy(OPENAI_ONLY(...))` at
  `src/routes/agent-v1-turn.ts:1080-1081`.
- **It does NOT use the router.** Not `TASK_MODEL_DEFAULTS`, not `CEE_MODEL_*`, not
  `LLM_PROVIDER`. Its model and reasoning effort live in
  `src/orchestrator-v5/agent-lane/model-budgets.ts` (`BANKED_BUDGETS`, keyed by
  `(model, role)`, each entry carrying the measurement that justifies it).
- **It does NOT run Pass-2 validation.** 0 of 13 calls in a full journey. So every
  `validate_graph` / 75.7%-reasoning-token / 28s figure is **v5/Conventional**, never the PoC.

⛔ **Before publishing any latency, purity or reachability number: read
`_diagnostic_trace.exit_path` and the ledger's `purpose` column, and write the path name
INTO the claim.** "28s Pass-2 on the v5 pipeline", never "28s".

⛔ **For a reachability claim, ask "reachable by whom"** — a user, a route, or an internal
dispatch — **and say which.** `provider-policy.ts:13-15` is explicit that `AsyncLocalStorage`
survives `app.inject()`, so "no user-facing caller" does NOT mean unreachable. I got this
wrong twice, in both directions.

⛔ **Before proposing where a config value should live, read the consuming call site and
name the rank it resolves at.** I recommended an env var twice; both times the call site
read something else first.

---

## 2. WHAT IS TRUE, MEASURED TODAY (re-derive before quoting, but these were done properly)

### Provider isolation — MET, and proven under contrary load

- `POST /agent/v1/turn` with `X-Olumi-Assist-Key`. Mounting proven with controls:
  fabricated path + key → Fastify **404**; real route + key → its own **422**
  (`scenario_id and message are required`); no key → **401**. A 401 alone proves nothing.
- **53 guarded generative calls across 12 turns: 53 OpenAI, 0 Anthropic** — counting both
  `allowed` and `refused_before_network`, so zero means never attempted.
- ⭐ **Render logs for the same window show 16 Anthropic lines on the same process**
  (`claude-sonnet-4-6`, `claude-sonnet-5`, `claude-haiku-4-5`). So this is isolation
  demonstrated **under concurrent contrary load**, not an empty window. It also confirms
  `provider-policy.ts`'s promise that Conventional is untouched.
- `_provider_calls` is a **TOP-LEVEL** response key, not under `_agent`.

### Latency — NOT met, and the variance matters more than the mean

- **n=6 identical-brief construction turns: mean 54.1s, sd 10.4s, CV 19%** (range 39.0–69.2s).
- Sample size to detect an effect: **n≥5 per arm for 35%, n≥7 for 30%, n≥15 for 20%.**
  ⛔ **A single before/after turn cannot distinguish a 30% win from noise.**
- Shape: ~5 calls / 3 hops per construction turn, ~10.9s mean per call. Per-call cost rises
  to ~23.6s on a ~700-char brief (a 66-char brief still took 49.9s — within the noise band,
  so **do not claim brief length is irrelevant**, only that any effect is smaller than the spread).
- A **duplicated `propose_starting_point` hop** was observed **1 in 7** turns — intermittent,
  not systematic. Still worth an idempotence guard (~10s on a 54s turn).

### Caching / context delivery / focused prompts — ALL gated on ONE discarded field

- `AGENT_INSTRUCTIONS` is **5,750 chars ≈ 1,437 tokens**, assembled at exactly one place
  (`agent-v1-turn.ts:886`), a module constant, passed through unmodified. **Byte-identical on
  every call, for every user** — a textbook prompt-cache prefix, above OpenAI's ~1,024-token
  automatic-caching floor (that floor is model knowledge, **not measured here**).
- ⭐ **So there is no cache system to build.** The brief's "do not build another cache system"
  is already satisfied by construction. **Only the verification is missing.**
- ⛔ `agent-v1-turn.ts:533-542` fetches `usage` from the Responses API and **returns it into a
  void** — `usage` appears exactly twice in the file, the type and the return. Nothing consumes it.
  Absence confirmed with controls: `cached_tokens` 0 and `prompt_tokens_details` 0 in the logs,
  against `msg` 100, `input_tokens` 15 and `cache_read` 4 in the same window.
- ⚠ **"Focused prompts" is a TRAP, not a task.** If caching works, ~90% of that prefix is a
  cache read and trimming saves almost nothing — and every line in those instructions is a
  measured behavioural fix (the `raw_value`-vs-normalised-`value` rule, "never print a
  proposal_id", "say what the change became"). **Do not trim before measuring.**

### The challenger — NOT wired, and the path is now known

- **0 `decision_review` attempts and 0 `critique_graph` attempts in 53 calls.** Not a refusal
  either — a refused Anthropic call would be *recorded*. It is never invoked.
  Consistent with `run-analysis.ts:965` deliberately withholding the brief from PLoT under any
  policy so PLoT cannot call back into CEE's review legs.
- The agent substitutes prose hedging ("no robust leader", "a fragile near tie"). Honest, and
  preserves the scientific principle, **but it is the model's own narration, not an
  independent challenger.**

---

## 3. THE CHALLENGER PATH — step 1 is DONE and DEPLOYED

| # | what | state |
|---|---|---|
| 1 | `critique_graph` capability-open + `OpenAIAdapter.critiqueGraph` + the effort knob | ✅ **#1771 MERGED `467b5912cb75`, LIVE on cee-staging 20:58:38Z** |
| 2 | a **request-scoped** OpenAI model for `critique_graph` | ⛔ open — see the RC ruling below |
| 3 | one `critique_model` tool registration (`agent-tools.ts`) | ⛔ agent lane's; file contended |

**Verified on the deployed build by identity, not inference:**
`critique_graph = ['anthropic','openai','fixtures']`, `explain_diff = ['anthropic','fixtures']`,
`async critiqueGraph(` present, `reasoningEffort: 'high'` at the critique site,
`args.reasoningEffort` threaded at the chat site, and **0** occurrences of the executable
`throw new Error("openai_critique_not_supported` (the string survives only in a docblock —
check position, not count).

### ⛔ RC RULING ON STEP 2 — do not repeat my mistake

RC on #1771: *"The proposed `CEE_MODEL_CRITIQUE=gpt-4.1-2025-04-14` on the shared
PoC/Conventional service changes its process-wide task default; this is not request-scoped
isolation, and historical model-routing intent is not current authorisation to repoint
Conventional config."*

**I proposed an env var, withdrew it, proposed PMS `modelConfig`, and withdrew that too** —
per-environment is still not per-request. **The correct boundary is a request-scoped model
choice: rank 1, an explicit `modelOverride` at the call site**, which belongs to the tool
registration in step 3. RC also notes their comment is *"not a duplicate source-review gate"*
on #1771.

⚠ **Model choice, if and when it is scoped correctly:** `gpt-4.1-2025-04-14`, on the estate's
own recorded reasoning — `draft_quality_review`'s docblock picks the fast non-reasoning model
because *"this call cannot be hidden — the redraw decision waits on it"*, and a critique
dispatched as an agent tool is likewise on the user's critical path. `gpt-5.2` (the estate's
original choice for critique) belongs there only if the challenger moves OFF the path.
⚠ A challenger adds a call to a turn already costing 10–24s per call on a ~54s floor —
**make it the model's choice, not an auto-fire, and measure before and after.**

---

## 4. OPEN PRs — mine, with their risk class

| PR | head | risk | what it needs |
|---|---|---|---|
| **#1764** explainDiff | `ccdbc4bba2b6` | **LOW** (same clauses as #1771) | CI green, then a self-verdict + `premerge-check.sh` |
| **#1774** bake-off harness | `4b41107f6598` | **NOT LOW** — admin route + response shape | an independent exact-head verdict |
| **UI #1907** inspector label | `848104fde313` | **NOT LOW** — view change | an independent exact-head verdict |
| ~~#1755~~ | — | — | **CLOSED**, split into #1771 + #1774; Pass-2 `'low'` dropped |

⛔ **#1774 and #1907 are NOT self-mergeable and I must not re-classify them to unblock myself.**
The rubric is explicit that the judgement is written down **before** the merge; flipping it
afterwards is the thing it guards against.

### The premerge gate — four refusals, all correct. Read this before merging anything.

1. **One merge per command.** The hook refuses two.
2. **`never a verdict while running>0`** — ALL checks, advisory included.
3. **The required context must be green in EVERY instance.** Duplicate workflow runs produce
   two; my monitor's glob matched `in_progress,completed/success` as green. **Evaluate CI
   predicates with `jq all(...)`, never a substring match.**
4. ⭐ **A verdict must be `VERDICT: APPROVE`** — `_DECL` in `scripts/verdict_lib.py` requires
   the literal `VERDICT` label. A bare `APPROVE` is refused deliberately, because it once
   cleared CEE #1314 on an author's own comment. It must also sit in the **opening protocol
   region** and carry substance (`approve-substance.py`).

**The working sequence:** all checks terminal → publish `VERDICT: APPROVE` + `REVIEWED_HEAD:`
(substitute the SHA from a variable, never transcribe) → `bash scripts/premerge-check.sh <repo>
<pr>` → `gh pr merge <n> --repo <repo> --squash`. **The gate lives at the estate root:
`/Users/paulslee/Documents/GitHub/scripts/premerge-check.sh`**, not in the CEE repo.

⚠ `gh pr comment` from the estate root **silently posts nothing** — it is not a git repo.
Always pass `--repo`.

---

## 5. THE BLOCKER, and the handoff that is already posted

**3 of the 4 remaining goal elements reduce to one line** — logging `usage` at
`agent-v1-turn.ts:542`. That file had **7 open PRs** against it at 21:30 (two updated within
three minutes), so it is genuinely leased to the `openai-experiment-poc-integration` lane.
Declared in `output/panel-lane/BLOCKED-NOW.md`.

**Four ready-to-apply diffs are posted on `Talchain/olumi-programme-docs#63`**, each with the
measurement that justifies it:
1. **log `usage`** — converts caching, context delivery and focused prompts from unmeasurable
   to measured. 1 line.
2. **thread `budget.reasoning_effort` into `callModel`** — `reasoning` appears nowhere in that
   file except `callStructured:516-517`, so **92% of the PoC's calls have no effort control**.
   ⚠ Put the value in `BANKED_BUDGETS` with its measurement, **not an env var** — and the
   conversation entry says *"reasoning effort omitted (model default)"*, never measured.
   Precedent: the `whole` role's high→medium ruling bought **20–26s** (#63 5798194848).
3. **make the conversation model selectable** — it is a literal at `:475` and `:877`.
4. **idempotence guard on `propose_starting_point`** — reproduction: the identical 203-char
   brief gave 3 hops once and 4 the next time.

---

## 6. GOAL SCORECARD — 7 of 11, stated honestly

| element | verdict |
|---|---|
| OpenAI means OpenAI | ✅ **MET (strong)** — 53/53 under concurrent Anthropic load |
| Conventional untouched | ✅ **MET** — request-scoped policy, proven by the same logs |
| deterministic tools | ✅ **MET** — 5 tools, all `ok`, `authorise_change` gates the write |
| human-in-control | ✅ **MET** — leader refused until explicit approval; assumptions disclosed as pending |
| scientific | ✅ **MET** — 41.1/32.8/26.1 delivered with "fragile near tie", no over-claim |
| simple | ✅ **MET** — one model, one transport, one loop |
| challenger step 1 | ✅ **MERGED + DEPLOYED** |
| **fast** | ❌ 54.1s mean, and the lever is absent on 92% of calls |
| **optimal mix** | ❌ conversation model is a literal (a measured mix DOES exist per role) |
| **challenger (end to end)** | ❌ 0 attempts in 53 calls; needs steps 2–3 |
| **caching / context / focused prompts** | ⛔ unmeasurable until the `usage` line lands |
