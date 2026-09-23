# RESUME HERE — OpenAI Technical Architecture lane, 23 Sep 2026 ~18:00

Written immediately before a machine restart. Everything below was verified at the
time of writing; **re-derive every SHA before acting on it** — a restart is exactly
the boundary at which pins go stale.

## The goal (unchanged)

> Make the OpenAI PoC fast, simple and differentiated by using the optimal mix of
> OpenAI models, focused prompts, deterministic tools, context delivery, caching
> and optional challenger reasoning, while preserving Olumi's scientific and
> human-in-control principles.

Hard constraints: **OpenAI means OpenAI** (zero Anthropic generative calls, no
hidden fallback) · **Conventional stays untouched** (no provider config change, no
prompt migration) · post material findings to `Talchain/olumi-programme-docs#63`
as "OpenAI Technical Architecture".

---

## 1. FIRST ACTIONS ON RESTART, in order

```bash
# 1. Re-derive every head — do not trust the SHAs in this file
gh api repos/Talchain/olumi-assistants-service/pulls/1755 --jq '.head.sha'
gh api repos/Talchain/olumi-assistants-service/pulls/1764 --jq '.head.sha'
gh api repos/Talchain/DecisionGuideAI/pulls/1907          --jq '.head.sha'

# 2. Required check + verdicts on each (the ONLY required context on CEE is
#    "Lint, TypeCheck, Unit Tests"; on the UI it is "Full Test Suite" x4 + "TypeScript + Lint")
gh api "repos/Talchain/olumi-assistants-service/commits/<head>/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.status=="completed") | "\(.conclusion) \(.name)"'
gh api repos/Talchain/olumi-assistants-service/pulls/1755/reviews --jq '.[] | "\(.state) \(.commit_id)"'

# 3. What CEE is actually serving (there is NO /version.json on CEE — see §5)
#    Take the deploy whose status == "live", NOT the newest.
```

**Then act:** if a required check is RED, fix it — that is the top priority.
If required is GREEN **and** an exact-head independent verdict exists, run
`bash scripts/premerge-check.sh Talchain/olumi-assistants-service <n>` and merge.
**Merging to `staging` IS the deploy** (`cee-staging` `autoDeploy=yes`).

---

## 2. STATE OF THE THREE OPEN PRs

| PR | head at write time | what it is | gate |
|---|---|---|---|
| CEE **#1755** | `ccc5f94293d034d9e17fcd5753e99b7eab58330c` | 9 commits: `reasoning_effort` reachable + Pass 2 `'low'`; `OpenAIAdapter.critiqueGraph`; `critique_graph` capability; admin bake-off live-resolver fallback; OpenAI cache-read mapping; + typecheck fix + route test | required check was **queued**; **0 reviews** |
| CEE **#1764** | `497d74715bc6304c3419356a2b330681806ea0c0` | 1 commit, 5 files: `OpenAIAdapter.explainDiff` + `explain_diff` capability + 2 test files | 22 checks **queued**; **0 reviews** |
| UI **#1907** | `10136c997527c608224331b1c60c06e4bb883695` | inspector no longer claims "Estimated by Olumi" over no evidence | required **queued**; **0 reviews** |

**All three are NOT LOW RISK → each needs an independent exact-head verdict. Do
not self-merge any of them.** Exact-head REVIEW_REQUESTs are posted on all three.

⚠ **#1755 and #1764 both touch `src/adapters/llm/openai.ts` and adjacent lines of
the capability map** (#1755 opens `critique_graph` at `:851`, #1764 opens
`explain_diff` at `:852`). **Whichever merges second needs a mechanical rebase —
that is mine to do, not the reviewer's.**

⚠ **#1764 carries a correction I posted against my own description.** Read
[the correction](https://github.com/Talchain/olumi-assistants-service/pull/1764)
before defending the PR: the stub it removes was **unreachable**, so the PR is a
**precondition, not a fix**. Details in §3.

---

## 3. ⛔ THE HEADLINE FINDING — provider isolation is NOT achieved by `LLM_PROVIDER`

`resolveModelAssignment` returns **`provider: exact.provider`, the resolved
MODEL's registry provider.** The configured provider is consulted **only when no
model was selected** (`resolveCandidate`: `model ?? providerDefaults[provider]`),
and for a valid CEE task `taskDefault` always selects one.
Precedence: `modelOverride > env_var (config.cee.models) > taskDefault`.

**So the model decides the provider and `LLM_PROVIDER=openai` is close to inert
for task-routed calls.** An OpenAI-only deployment is built from the per-task
`CEE_MODEL_*` vars, not from the provider setting.

Derived over all 19 `TASK_MODEL_DEFAULTS` (counts sum to 19):

- **11 already OpenAI by default** — incl. `validate_graph` = `o4-mini`
- **5 Anthropic but overridable** — `draft_graph`, `critique_graph`, `edit_graph`, `orchestrator`, `m2_graph_review`
- ⛔ **3 Anthropic with NO live env override** — `bias_check`, `explain_diff`, `routing`

⚠ Reachability, measured: `routing` and `bias_check` have **zero `getAdapter()`
call sites** in non-test source → **latent**. **`explain_diff` is the only
reachable one** (route + mounted, unflagged `ExplainDiffButton`).

⭐ **So exactly one live path would silently make an Anthropic call on an
"OpenAI-only" CEE.** That is the hard-constraint-#1 violation, and it is one path,
not eleven.

⚠ Also: **`CEE_MODEL_TASK_*` is inert.** `config/index.ts` annotates that whole
inventory "Audited at startup but inert for serving". Anyone grepping for env
names will find them and they do nothing.

---

## 4. NEXT PRIORITIES, in order

1. **Unblock the three PRs** — fix any red required check; merge on a green
   required check **plus** an exact-head verdict. Merging is deploying.
2. **`CEE_MODEL_EXPLAIN_DIFF`** (small, own PR): add to `config.cee.models`,
   `TASK_TO_CONFIG_KEY` and `CONFIG_KEY_TO_MODEL_ENV_KEY`. This is what makes
   #1764 actually do something, and it completes hard constraint #1 for the only
   reachable path.
3. **A provider-isolation test**, now specifiable: for an OpenAI-only config,
   every *reachable* task must resolve to a `provider === 'openai'` assignment.
   Pure resolver test, no network. This is the honest form of "OpenAI means
   OpenAI" — far better than my earlier reliance on the capability map.
4. **Run the bake-off** the moment #1755 deploys — driver is banked at
   `Docs/openai-bakeoff/run-bakeoff.py` on this branch. It exits non-zero and
   writes **no report** if the fix is not live, so it is safe to just run.
   Needs `ADMIN_API_KEY` and `RENDER_API_KEY` in env.
5. **Parse is the remaining latency prize and nothing in flight touches it**
   (23.1 s p50 of a 52.7 s turn). Its only lever is a faster draft model — i.e.
   the bake-off. Do not invent a second lever before measuring.

---

## 5. MEASUREMENTS ESTABLISHED TODAY — do not re-derive these

**Pipeline decomposition** (n=800 `cee.unified_pipeline.stage_timings`, 774 distinct request ids):

| stage | p50 ms | class |
|---|---:|---|
| `parse_ms` | 23,128 | LLM (`parse_llm_ms` 21,495; only 313 ms is non-LLM) |
| `validation_pipeline_ms` | **28,356** | LLM — the binding stage |
| `coaching_pass_ms` | 20,680 | LLM — hidden behind validation, ~7.7 s slack |
| all 6 deterministic stages | **240** | **0.45% of the turn** |
| `total_ms` | 52,741 | |

Per-row model test: `parse → (coaching ∥ validation)` residual **−918 ms**;
fully-serial **+19,052 ms**. ⇒ coaching and validation **already overlap**.
⇒ **"deterministic fast paths" is NOT a speed lever — retired.** Validation
savings cap out at ~7.7 s, after which coaching binds. Say "bounded", not "28 s".

**Harness / prompt facts**
- All 12 probed prompt ids return the **handler's** `404` from
  `POST /admin/v1/test-prompt-llm`. Discriminator: the handler's 404 names the
  prompt; **Fastify's route-level 404 carries `statusCode`**. Different shapes.
- `GET /admin/prompts/status` registers only **9** keys (8 `pms` + 1 `default`).
  `critique_graph`, `suggest_options`, `clarify_brief`, `explain_diff` are **not
  registered**. `draft_graph` is `pms`, **version 202**, live, 40,393 chars.
- The admin harness discloses its own divergence from production in
  `harness_fidelity.divergences`. ⛔ **A bake-off from it licenses a RELATIVE
  ranking between arms only — never an absolute production latency or quality
  figure.**
- ⛔ **CEE has NO version endpoint.** `/version.json` returns 401 without a key
  and a **route-level 404 with a valid `X-Olumi-Assist-Key`**. `/health` and
  `/admin/v1/health` 404; `/api/health` 401s the same misleading way. **The only
  authority is the Render API, taking the deploy with `status == "live"`** — the
  newest was `build_in_progress` while a 14-minute-older commit served traffic.
- Admin header is `x-admin-key` (`ADMIN_API_KEY`). Assist header is
  `X-Olumi-Assist-Key` (`ASSIST_API_KEY`). Never print the values.

**Context/caching** (n=936 `v5.turn_executor.stage_timings`): 173/193 multi-turn
sessions (89.6%) have an unstable context pack, yet `routing_cache` shows
**79.9% hits** — because the only cache breakpoint is the frozen system prefix
and the pack sits entirely after it. **Refuted my own hypothesis; no second
breakpoint proposed** — volume is not position.

**Arm design note:** `gpt-5-mini` is **`reasoning: false`** in `MODEL_REGISTRY`.
Keep it as a fast non-reasoning arm but report it as a **separate class**; never
pool it into a `reasoning_effort` comparison.

---

## 6. BANKED STATE — corrected after a wider re-check

⚠ **My first census was scoped wrong and I am recording that, because the wrong
number is the dangerous one.** I reported "7 git trees in /private/tmp, all
clean". That was only **my own session directory**, searched to `-maxdepth 4`,
checking `refs/heads` containment but **not** the detached `HEAD` itself, **not**
stashes, and **not** worktrees.

**The real figure for `/private/tmp` is 94 git dirs + 34 worktrees.**

### My own 7 trees — verified properly, and genuinely safe

Re-audited with the gaps closed (detached `HEAD` containment, `git stash list`,
worktree pointer files, and tags checked for remote reachability rather than
merely counted):

| tree | HEAD | on a remote ref |
|---|---|---|
| `cee-p0` | `work1701` @ `5421b067f64b` | `origin/feat/deterministic-request-assembly` |
| `cee-effort-…` | detached @ `ccc5f94293d0` | `origin/fix/pass2-reasoning-effort-low` |
| `cee-explaindiff` | `feat/openai-explain-diff` @ `497d74715bc6` | `origin/feat/openai-explain-diff` |
| `cee-plan-…` | detached @ `cc7b26cbe168` | `origin/staging` |
| `ui-1907-…` | detached @ `10136c997527` | `origin/fix/inspector-extraction-label-honesty` |
| `ui-fa84d226…` ×2 | detached @ `fa84d226ee07` | `origin/canvas/applied-receipt-acknowledges` |

**All seven: `dirty=0`, `stashes=0`, zero unpushed branches, zero tags I
created.** Every HEAD — including all four detached ones — is contained in a
remote ref. ⇒ **nothing of mine exists only on this machine.**

### ⛔ 39 OTHER trees DO carry work that exists only in volatile /private/tmp

**Not mine. I did not touch, push or modify any of them** — other sessions may
still be live in them, and publishing another lane's WIP could be destructive.
Full inventory saved at `~/olumi-bank-20260923/OTHER-LANES-AT-RISK.txt`.
Largest: a DGAI clone with **16 stashes and 116 unpushed branches**, visible
three times because two worktrees share it; and a `schemas` clone with **237
uncommitted files**. ⚠ Deleting a parent clone destroys its worktrees.

### Where my work lives

- both code branches → pushed (`fix/pass2-reasoning-effort-low`, `feat/openai-explain-diff`)
- bake-off driver → `Docs/openai-bakeoff/run-bakeoff.py` on this branch
- this file + `Docs/MORNING-BRIEF-2026-09-23.md` §14 → this branch
- every finding → `Talchain/olumi-programme-docs#63` and the three PRs
- raw evidence → `~/olumi-bank-20260923/openai-lane/` (non-volatile):
  `unified_timings.ndjson` (n=800, the pipeline decomposition),
  **`pass2_complete.ndjson` (the n=795 evidence behind #1755 item 1 — nearly
  missed on the first pass)**, `pipe.ndjson`, `verify-p2-stages.ndjson`
- `NOT-BANKED-AND-WHY.txt` records what I dropped **on purpose** (API dumps that
  would go stale, copies of files already in git, drafts already posted) so a
  future pass does not mistake a decision for an oversight.

## 7. MISTAKES TO KEEP CORRECTED

- **A true "blocked on CI" line is not licence to stop.** Before ending a turn,
  name one thing that can run now — and run it.
- **Read the code, never a docblock or spec title.** A stale `FactorNode` docblock
  nearly had me expand #1907 onto a defect that does not exist.
- **Assert the branch name before pushing.** A detached clone made
  `--abbrev-ref HEAD` return the literal `"HEAD"` and I created a remote branch
  called `HEAD`. Use `git symbolic-ref --short HEAD`.
- **A 401 never proves a route exists** — auth precedes routing. Probe with the key.
- **Two local test attempts, then CI is the gate.** This machine hit load 14.7 and
  produced zero collection across eight attempts.
- **Only required checks gate a merge.** `Graph Evaluator` and `Typecheck Drift`
  are advisory here; an advisory red gets one line, not a work lane.
- **Count, don't sample; and check counts sum.** The 19-task table above is only
  trustworthy because the three buckets add to 19.

---

# 8. ✅ RESOLVED BEFORE THE RESTART — the red required check is FIXED and pushed

#1755's `Lint, TypeCheck, Unit Tests` failed at `ccc5f94293d0`. **Diagnosed and
fixed in the same session.** Do not re-diagnose it.

**Cause:** opening `critique_graph` to `'openai'` broke six existing tests that
encoded the old exclusion. I changed a shared constant without sweeping its
readers — none of which live in the directories I touched. My two new files
PASSED (`✓ admin-testing-live-resolver-fallback.test.ts, 7 tests`).

**Fix, pushed:**
- **#1755 → `6f1bd2da72521534e881e1f1f37f01800295ae58`** — six readers repointed.
  ⭐ **Nothing deleted**: every "OpenAI must be rejected" assertion moved to
  `explain_diff`, still closed on that branch. `expect()` counts did not fall
  (111/109, 23/22, 27/27, 63/63, 53/53).
- **#1764 → `ab90edecc489eb4da16c993d986d2b3b3a67c960`** — the map deep-equal
  updated, **plus the discriminator that survives both tasks being open**:
  once both land the map has no closed entry, so the asymmetry tests stop
  discriminating. Replacement asserts `MODEL_DISABLED` still fires for
  `test-disabled-model`, bound by identity, with a positive control.

**Both have fresh exact-head REVIEW_REQUESTs and CI re-queued. Neither is
self-merged. On restart: check those two heads, not the ones in §2.**

⚠ `Integration Tests (advisory)` and `Full Test Suite (advisory)` were also red
at the old head. Check whether they are red on staging's own head before
treating them as mine — several estate advisories are known-red.

