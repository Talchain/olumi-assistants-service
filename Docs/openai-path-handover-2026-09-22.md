# OpenAI product path — session handover, 22 Sep 2026

Written so a fresh session can resume without re-deriving anything. Every SHA
here is 40 characters and was verified with `git ls-remote` **and** `gh api`
where a PR exists.

> **Scope note.** This session worked the priority brief: (1) canonical creation
> authority, (2) the Agent semantic-context projection, (3) deterministic human
> consent, (4) deterministic causal repairs. **1 and 2 have work landed on
> branches. 3 and 4 are UNTOUCHED.**

---

## 1. Branches — what exists, what it needs

| branch | head (40-char) | state | needs |
|---|---|---|---|
| `fix/registration-leaves-a-version` (**PR #1691**) | `b3643ccb028c8522661102b88d4bc36cd1f8ce9a` | MERGEABLE, **0 reviews**, required check **SUCCESS** | independent review |
| `fix/agent-canonical-state-carries-magnitude` (**PR #1698**) | `ee6027718f82df4c512513adaf55f29c07dd836a` | open, CI running | independent review |
| `fix/agent-lane-dead-reachability-duplicate` (**PR #1699**) | `42e16ad8c93b89557a3cb9bcbd718baf082ff8ef` | open, CI running | **land first** — unblocks the only required check |
| `backup/claude-session-20260922-build-on-1691` | `9834e3bf655b3aa157a57c08dd7c0941fcda8e3c` | backup only | nothing; delete once #1691 and the projection branch land |
| `feat/registration-writes-canonical-model-version` | `2a7b513ed8afbc7d2828424c573aeaeb8bc47701` | **SUPERSEDED — do not review** | delete on Paul's word |

### CI state at handover, read from the remote

**#1691 @ `b3643ccb` — required check `Lint, TypeCheck, Unit Tests` is SUCCESS**, and
so is `Typecheck Drift (ratchet)`. GitHub reports the PR as `UNSTABLE`, but the
**only** failure is `Graph Evaluator (advisory)`, which is **not required**. Do not
read `UNSTABLE` as "the gate is red".

⚠ **A bare branch push gets almost no CI.** Before PR #1698 was opened, the
projection branch had exactly one check-run (`check-schemas`) and no required check
at all. **A branch without a PR has no required-check signal** — silence is not
green. PRs #1698 and #1699 were opened so both branches get a real verdict.

**Risk classification, decided before any merge:** #1691 and the projection
branch are **NOT low risk** — one writes durable version rows, the other changes
what the Agent believes canonical state contains. Neither was self-merged. The
lint branch is low risk (dead-code deletion, clean revert).

### Why `feat/registration-writes-canonical-model-version` is superseded
It was an independent rebuild of #1691 — same three files, same
`export function buildAtomicCommittedModelVersion`, same call site. It was built
before #1691 was discovered. Its only unique value (three extra mutant-killing
tests) was contributed onto #1691 instead.

---

## 2. What each branch actually does

### #1691 — registration writes, and returns, the canonical version receipt
`POST /assist/v1/scenarios/:id/graph/register` is the **other** `scenarios.graph`
writer (the C3 shared-persistence-floor header names both it and
`commitDirectAnswer`). It wrote no model-version receipt at all.

**Measured on staging:** all **725** turns whose `turn_id` matches
`graph_registration:%` carry `model_version_created` **NULL** and
`model_version_mutation_id` **NULL** — never `false`. Contrast from the same
query: the **38,208** other turns carry 3,491 `true` / 8,518 `false` and 12,009
mutation ids.

> ⭐ **The distinction that mattered:** `false` = the carrier ran and its policy
> declined. **NULL = the carrier was never reached.** Merging those two buckets
> is how the first version of this finding named the wrong mechanism.

`build_model_from_brief` persists through that route, so an agent-constructed
model had no canonical history.

Two commits of mine on this branch:
- tests killing two mutants the original suite left alive (submitted-vs-projected
  bytes; dropping the server-read CAS base);
- **`feat(register)`: return the receipt.** The RPC builds
  `model_version_receipt`, `SupabaseSessionStore` parses it onto
  `SessionAppendOutcome.modelVersionReceipt` (`session/store.ts:96`), and
  `appendCheckedGraphWrite` returns it verbatim — but the route **never captured
  the return value**. Now surfaced as an additive optional `model_version` and
  carried into the agent tool result.

### `fix/agent-canonical-state-carries-magnitude` — priority 2
`get_canonical_state` returned only `label`, `full_label`, `kind` and a bare
`value`. Now also carries `id`, `raw_value`, `display_value`, `unit`, `cap`,
`declared_scale`, `scale_frame`, `value_provenance`, entity `provenance`.

**None of it is enrichment.** Key counts across every stored graph, 22 Sep 2026:

```
id 211,211 · provenance 209,115 · display_value 34,107 · observed_state 27,728
observed_state.value 27,728 · .source 27,654 · .extractionType 26,894
.unit 9,490 · .raw_value 8,080 · .cap 4,345 · .declared_scale 736
scale_frame 5,803
```

Three judgement calls a reviewer should check rather than assume:
1. `value_provenance` is kept **distinct** from entity `provenance` — collapsing
   them lets a system-read figure inherit a user's authority.
2. Every added field is **omitted when absent, never nulled** — a null reads to a
   model as a stated fact rather than as silence.
3. `GraphRead`'s node type now **declares** these carriers instead of the
   projection casting to them, so a rename fails typecheck.

⚠ `dispatchTool` routes `get_canonical_state` to the projection in
**`agent-capabilities.ts`**. There is a sibling `tools/get-canonical-state.ts`
with its own test file that the dispatcher does **not** call — fixing that one
would have changed nothing.

---

## 3. Settled findings — do NOT re-derive

**Deployed `append_turn_atomic_v5`** (read with `pg_get_functiondef`, verified on
statements with comments stripped):

```
v_turn_preexisting := FOUND;
IF NOT v_turn_preexisting THEN
  IF p_cas_enforce AND p_expected_base_known AND ... THEN RAISE 'OLGC1'
END IF;
```

- **Replay is decided BEFORE CAS**; CAS is nested inside the not-replay branch,
  so a replay skips it entirely and returns the stored receipt. Reusing a turn_id
  with a different mutation id raises `MV422`.
  ⛔ **Estate doctrine saying "deployed v5 puts CAS before the replay check" is
  STALE — that fix is deployed.** Re-derive anything built on it.
- **`p_expected_base_known boolean DEFAULT false`** is the fence for competing
  initial builds. `supabase-store.ts:1398` derives it as
  `write.expectedGraphIdentityHash !== undefined`, so a **null** base (read
  happened, empty) counts as KNOWN; only `undefined` disables it.
- **Retry cannot double-version**: `registrationTurnId()` mints a fresh uuid so a
  retry is not a replay, but `v_should_create := v_user_id IS NOT NULL AND
  v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash` is false once
  the graph matches. It does leave a duplicate turn row.

**The agent route IS mounted** — but only provable with the key:

| authenticated probe | result |
|---|---|
| `POST /agent/v1/turn` | **422** `BAD_INPUT: scenario_id and message are required` |
| fabricated sibling / top-level path | **404** `Route ... not found` |

⛔ An **unauthenticated 401 proves nothing** — a fabricated path 401s identically,
because auth precedes routing. `AGENT_LANE_ENABLED=true`, `AGENT_LANE_PREVIEW=false`.

**Registered graphs ARE versionable in practice.** A 5 Aug capture fixture
(`walk-import-modified.wire.json`) carries `strength.std` on 0 of 32 edges, which
suggests the opposite. Live: **16,000 of 16,092 edges**, 517 of 535 graphs fully
populated. The skip arm is an **18-graph minority**. A real capture can still be
weeks behind the producer.

---

## 4. Still UNPROVEN (state it, don't assume it)

- **Exactly one canonical head** — not demonstrated.
- **Authoritative graph reread agrees** — not demonstrated.
- **No browser witness of anything here.** Note that a key-authed harness
  *cannot* witness a receipt: guests mint no `model_versions`, and a shared key
  on an owned scenario 422s `scenario_requires_authenticated_owner`. A receipt
  witness needs a signed-in browser.
- Priorities **3 (deterministic consent)** and **4 (causal repairs)** — untouched.

### Pointers for priority 3, gathered but not acted on
`MUTATION_TOOLS = ['propose_model_change', 'authorise_change']`;
`toolsFor('preview')` filters them. ⚠ **`build_model_from_brief` mutates
(`mutated=true`) but is NOT in `MUTATION_TOOLS`**, so preview does not filter it.
`authoriseChange` checks proposal integrity, ownership and
`current_graph_identity_hash` — it does **not** independently prove the human
accepted that exact proposal. The durable machinery to reuse is
`apply_proposed_change` / PendingAction (`session/pending-action.ts`), whose
`preconditions.graph_hash` binds state. Do **not** build a second consent system.

---

## 5. Environment facts that cost time to find

- Assist key header is **`X-Olumi-Assist-Key`**, not `x-api-key`. The 401 body
  names it. `ASSIST_API_KEY` lives in `olumi-assistants-service/.env.staging.local`;
  **`set -a; . .env.staging.local` does NOT export it** — read it with `grep`/`cut`.
- Supabase pooler: only **`aws-0-us-east-1`** resolves. Tables are
  `public.v5_conversation_turns` and `public.model_versions` (not a `v5` schema).
  `pg` is not installed; the `postgres` (porsager) package is, and
  `scripts/wave0-apply-migration.mjs` has the connection pattern.
- Render env-vars endpoint paginates; cee-staging has ~125 vars.
- **The sole required check is `Lint, TypeCheck, Unit Tests`** and it is RED on
  staging's own head until `fix/agent-lane-dead-reachability-duplicate` lands.
  `Typecheck Drift (ratchet)` is also red on base: *"current: 101 files / 291
  errors vs baseline 103 files / 291 errors"* — fewer files, equal errors, red
  because the path SET changed. Needs a baseline update with sign-off.

---

## 6. Traps hit this session (all cost real time)

1. **`cmd | tail` then `$?` returns tail's exit.** Twice. Once a background gate
   reported "exit code 0" while `REQUIRED_EXIT=1`; once a `git cherry-pick` that
   **conflicted** reported 0, and a branch containing none of the work was pushed
   and announced as verified. Use `cmd > log 2>&1; RC=$?` on its own line, and for
   git state-machine commands confirm the RESULT (`git diff --name-only <base> HEAD`,
   absence of `.git/CHERRY_PICK_HEAD`), never the exit.
2. **`git checkout HEAD -- <file>` wipes uncommitted work.** Commit before mutating.
3. **A contrast control must be able to fail.** A `server.ts` probe returned 0 for
   both target and control, which is what revealed the probe was mis-aimed.
4. **zsh expands `--include=*.ts`** — quote it.

---

## 7. Estate state at handover (NOT mine, NOT touched)

- `olumi-assistants-service` main clone is on `docs/claude-md-restructure` with
  **117 unpushed commits and no remote branch**, and 25 dirty paths dating from
  June/20 Sep. **Not this session's work.**
- That clone hosts **10 other lanes' worktrees** under `.worktrees/` — deleting
  the host clone destroys them.
- `plot-lite-service` shows 75 deletions under `.tooling/node20/…`;
  `DecisionGuideAI` and `Inference-Service-Layer` also dirty. All pre-existing.

My own trees are clean: the build clone has no uncommitted changes and no
in-progress git operation, and all eight pinned read-only clones are clean.
