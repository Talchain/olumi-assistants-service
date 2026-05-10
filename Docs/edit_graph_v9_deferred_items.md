# `edit_graph` v9 — Deferred Items (DL)

**Date opened:** 2026-05-09
**Workstream:** `edit_graph` v9 (bare-array safe-envelope + telemetry hardening)
**Status:** open — entries to be triaged into the cross-workstream backlog

> No project-wide war-room or decision-log file was found in `Docs/` or
> `Docs/v5/`. If a cross-workstream source of truth exists outside this
> repo (Notion, Linear, GitHub Project, etc.), copy each entry there and
> link back to this file rather than duplicating content.

---

## DL-1 — Worktree pnpm/vitest resolution broken

**Symptom:** `pnpm exec vitest` from this worktree fails with
`Cannot find module 'vitest/vitest.mjs'` (path resolves to a
worktree-local `node_modules/.pnpm/...` that doesn't exist). Main-repo
`node_modules/.bin/vitest` works fine; using that as a workaround.

**Owner:** _unassigned_ (devex / repo maintainer)

**Trigger to close (sharpened 2026-05-10):** EITHER
(a) `Docs/CLAUDE.md` documents the explicit worktree procedure for
running `vitest` / `tsc` / `pnpm` scripts (e.g. "use the main repo's
`node_modules/.bin/<tool>` on PATH" or "run `pnpm install` in the
worktree first"), AND that procedure is verified to work end-to-end
from a fresh worktree;
OR
(b) a fix lands so that `pnpm install` from a worktree produces a
working `node_modules/.bin/vitest` (and other dev binaries) without
manual PATH adjustments.

The `validate-prepush.sh` PATH adjustment
(`export PATH=...${REPO_ROOT}/node_modules/.bin:$PATH` where
`REPO_ROOT` is the worktree root) does NOT close this — pnpm-managed
scripts still resolve binaries via the project's own
`node_modules/.bin`, which is missing in fresh worktrees.

**Notes:** the worktree was created with the standard tooling; broken
pnpm resolution there is plausibly a project-wide issue affecting any
worktree-based workflow. Worth checking before more agents run in
worktrees. Related: DL-9 (worktree pnpm path-bake), DL-12 / DL-13
(devex friction).

---

## DL-2 — Telemetry event sunset (`edit_graph.legacy_array_response`)

**Decision so far:** Phase 2 will emit BOTH
`edit_graph.legacy_array_response` (existing) and
`edit_graph.legacy_array_wrapped` (new) additively for one transition
window. The old event is preserved so any uninspected cloud-side dashboard,
saved log filter, runbook, or alert query continues to work. Tests A4 and
A4b lock this contract in place.

**Owner:** Paul or the ops owner

**Sunset blocker:** the old event must NOT be removed in this branch and
not for at least **two weeks after the new event ships to staging**, AND
not until the following are explicitly audited and confirmed clean:

- [ ] Datadog dashboards referencing `edit_graph.legacy_array_response`
- [ ] Render saved log filters
- [ ] Operator runbooks (search for the literal event name)
- [ ] Alert / monitor queries

**Trigger to close:** all four checks above are signed off by the ops owner,
AND a follow-up PR removes the old emission and updates A4b accordingly.

**Phase 2A staging deploy date:** **2026-05-09** (visually confirmed
by Paul on the same date; merge commit `13dd9b4d` on `origin/staging`).

**Earliest telemetry sunset review date:** **2026-05-23**
(2026-05-09 + 14 days).

**Anchor (explicit):** the 14-day clock started from the **Phase 2A
staging deploy date** — i.e. when the change in
[src/orchestrator/tools/edit-graph.ts](../src/orchestrator/tools/edit-graph.ts)
that adds the dual emission (`legacy_array_response` +
`legacy_array_wrapped`) reached the staging environment. **NOT** from:

- the implementation date (when the parser change was authored locally),
- the merge date (when the PR landed on `main` or another branch),
- the Phase 2A acceptance date in this workstream record.

Rationale: dashboards and saved log queries only start receiving the new
event when staging is serving the dual emission. Before that, ops
operators have no opportunity to migrate their queries even if they
wanted to. The 14-day window is a migration-and-verification budget for
the people downstream, not a code-freeze countdown.

---

## DL-3 — `extractJson` sharp-edge follow-up

**Symptom:** [`src/orchestrator/tools/edit-graph.ts:2576`](../src/orchestrator/tools/edit-graph.ts:2576)
`extractJson` has known sharp edges that pass through quietly today:

- Greedy `\{[\s\S]*\}` regex can over-capture across multiple JSON blocks
  (matches from first `{` to last `}` in the cleaned text).
- Multi-fence responses use only the first `\`\`\`...\`\`\`` block
  (non-global match).
- Object-extraction is preferred over array-extraction; a payload with
  prose + `{...}` + `[...]` will pick the first object even if the
  intended payload is the array.

**Phase 2 scope decision (gated on captured payload):**

- If the captured production payload exercises any of the above:
  include targeted parser hardening tests + fix in Phase 2.
- If not: file as a separate P1 workstream and DO NOT bundle into Phase 2.

**Owner:** _unassigned_ (CEE)

**Trigger to close:** the captured production payload is examined and a
scope decision is recorded here.

---

## DL-4 — Truth-check doc path convention

**Question:** is `Docs/edit_graph_v9_routing_truth_check.md` the right
home for a workstream-scoped routing truth check, or should it live under
a cross-workstream decision-log path (e.g.
`Docs/v5/decision-log/...` or a project-wide handover doc)?

**Current state:** the doc is at the workstream-scoped path per Paul's
acceptance ("acceptable as a CEE-local implementation artefact"). Paul
will add a short pointer from the V5 cross-workstream source of truth
**if one exists**. None was found in `Docs/v5/` (no `decision-log`,
`war-room`, or `handover` file matched). Treating this DL entry as the
question to resolve.

**Owner:** Paul

**Trigger to close:** a documented convention exists for where
workstream truth-checks live, OR confirmation that the current path is
the convention.

---

## DL-5 — Phase 2 entry gate (BLOCKER)

**Status:** open — Phase 2 implementation is currently blocked.

Phase 2 code changes for `edit_graph` v9 must NOT begin until ALL of the
following are satisfied:

- [ ] **Captured production payload** acquired in one of these forms:
      - failing `edit_graph` `turn_id` from staging or production, OR
      - sanitised Render / Datadog log dump of the failing turn, OR
      - raw LLM output from the failing call with sensitive content
        (customer brief, PII) removed.

- [ ] **A7 converted from `it.todo` to executable test** in
      [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts),
      with the captured payload inlined or loaded from a fixture, and
      the six required assertions in place (safe parse / safe specific
      failure, no unsafe mutation, bounded repair, specific reason if
      malformed, safe assistant text, expected telemetry).

- [ ] **A7 baseline run captured** showing red/green state against the
      captured payload before Phase 2 implementation.

- [ ] **`extractJson` scope decision recorded in DL-3** — does the
      captured payload exercise greedy object over-capture, multi-fence,
      first-fence-only, or prose+JSON? If yes, parser hardening is in
      Phase 2. If no, DL-3 closes with "out of Phase 2 scope".

**Bypass — Phase 2A:** Paul may explicitly authorise a narrower
**Phase 2A** framed ONLY as safe-defaults + telemetry hardening, NOT as
incident closure. Phase 2A landing **does NOT close DL-5** — the
production-incident-closure question stays open until a captured payload
is tested. If Phase 2A is chosen, **DL-5b** must be opened to track
"Phase 2A landed; captured-payload incident closure still pending".

**DL-5b ownership and trigger (pre-recorded so the path is unambiguous):**

- **DL-5b owner:** the Claude Code implementation agent that lands
  Phase 2A. Creating DL-5b is part of the Phase 2A patch, not a follow-up.
- **DL-5b creation trigger:** any Phase 2A PR/patch must create DL-5b in
  the same diff if captured-payload incident closure remains pending.
  Reviewers should bounce a Phase 2A PR that lands without DL-5b.
- **Paul's accountability:** Paul remains accountable for either supplying
  the captured payload (which closes both DL-5 and DL-5b) or explicitly
  closing the incident as unreproducible (which retires DL-5b but should
  itself be recorded as a decision in DL — see "How to add a new DL
  entry" below).

**Why a checklist not a hook:** `it.todo()` for A7 is documentation, not
enforcement. This DL entry is the explicit gate; reviewers / implementers
should bounce any Phase 2 PR that lands without checking off the boxes
above (or without an explicit Phase 2A authorisation note in the PR body
AND a corresponding DL-5b entry created).

**Owner:** Paul (gate-keeper)

**Phase 2 PR / review-gate owner:** **Paul.**

Paul is the named reviewer/gate-keeper for any Phase 2 (or Phase 2A) PR
and is responsible for verifying ALL of the following before approval:

- [ ] **Captured-payload gate satisfied** OR **explicit Phase 2A
      authorisation** is recorded in the PR body (with rationale and a
      pointer to this DL entry).
- [ ] **A7 status:** still `it.todo` only if Phase 2A is authorised;
      otherwise A7 is converted to an executable test with the captured
      payload, has been run, and the run result is recorded in the PR.
- [ ] **`extractJson` scope decision** recorded in [DL-3](#dl-3--extractjson-sharp-edge-follow-up):
      either parser hardening included in this Phase 2 (with tests) or
      DL-3 closed as "out of Phase 2 scope" with rationale.
- [ ] **`.fails` checklist sign-off per test** in the PR description:
      each `.fails` test removed must have an explicit per-test note
      following the five-step checklist below.
- [ ] **Paired `*-green` tests updated in the same diff** where their
      inverted contract has flipped (A4-green, A4b-green, A5-green,
      A6-green, D1-green, D2-green). No paired green-test left
      asserting an obsolete pre-Phase-2 invariant.
- [ ] **DL-5b created in the same diff** if Phase 2A is being landed
      before captured-payload incident closure.

Paul may delegate the technical review of the Phase 2 report to ChatGPT
(or another reviewer) before approval — that is expected and acceptable.
The gate-keeper accountability for the six items above remains with Paul.

**Trigger to close:** **A7 has been converted from `it.todo` to an
executable test, has run against a captured production payload, and has
either passed or failed safely with a specific reason.** This is the
incident-closure event. Phase 2A landing alone is NOT sufficient — the
full Phase 2 path requires A7; Phase 2A explicitly defers it (and creates
DL-5b).

---

### Phase 2 dispatch-brief requirement (paired with DL-5)

When Phase 2 (or Phase 2A) is dispatched to an implementation agent, the
brief MUST include the `it.fails` removal checklist verbatim. This is a
hard requirement to prevent silent regressions sneaking through under the
`.fails` masking mechanism:

> **`it.fails` removal checklist (per test marked `.fails` in
> `tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts`):**
>
> 1. Run the test under `.fails` first; verify it fails for the expected
>    current reason (read the assertion message; confirm it matches the
>    pre-Phase-2 behaviour described in the test's comment block).
> 2. Implement the Phase 2 code change.
> 3. Re-run the test; confirm `.fails` reports an UNEXPECTED PASS.
> 4. Read the assertion and verify the test passes for the **INTENDED
>    reason** — not because of a coincidental side effect, an unrelated
>    throw, a mock interaction, or a weakened assertion.
> 5. Only then remove the `.fails` modifier. If a paired `*-green` test
>    encodes the inverted pre-Phase-2 contract (A4-green, A6-green),
>    update or remove that paired assertion in the SAME diff.

The agent dispatch brief should reproduce this checklist verbatim and
require an explicit per-test sign-off in the Phase 2 PR description.

---

## DL-5b — Phase 2A landed; captured-payload incident closure pending

**Status:** open — created in the same diff as Phase 2A landing, per the
DL-5b creation trigger pre-recorded in DL-5.

**Summary:** Phase 2A (safe coaching defaults + additive telemetry
hardening) has landed on the bare-array path in
[src/orchestrator/tools/edit-graph.ts](../src/orchestrator/tools/edit-graph.ts).
This closes the user-facing-coaching gap surfaced by tests A4, A4b, A5,
A6, D1, D2 — but it does **not** close the captured-payload production
incident, because the synthetic gold case never reproduced the real
parse/structural failure observed in production.

### What Phase 2A landed

- `coaching` populated with `{ summary: "Proposed graph edit.",
  rerun_recommended: false }` on the bare-array branch.
- `removed_edges: []`, `warnings: []` preserved.
- New telemetry event `edit_graph.legacy_array_wrapped` emitted
  additively with `format: 'legacy_array'` and `operations_count: <N>`.
- Existing telemetry event `edit_graph.legacy_array_response`
  preserved unchanged. Sunset blocked behind DL-2.
- Six `.fails` markers removed in
  [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts)
  per the removal checklist (each verified to pass for the intended
  reason).
- Two paired green tests removed (A4-green, A6-green) because their
  pinned pre-Phase-2A invariants were subsumed by the now-passing A4
  and A5/A6 assertions.
- **Two pre-existing tests deliberately updated as part of the Phase 2A
  contract change.** Both root-cause back to the same flip
  (`coaching: null` → safe defaults on the bare-array branch) but
  encoded its consequences at different layers; both are called out
  here so future reviewers can see the full scope of the contract
  change in one place rather than discovering it through a stale-test
  failure later:
  - **[tests/unit/orchestrator/tools/edit-graph-v2.test.ts](../tests/unit/orchestrator/tools/edit-graph-v2.test.ts)**
    ("detects and parses legacy array response"): legacy assertion
    `expect(result.coaching).toBeNull()` updated to assert the new
    safe-defaults shape (`summary: "Proposed graph edit."`,
    `rerun_recommended: false`). This was the test originally named in
    Paul's Phase 2A brief.
  - **[tests/unit/orchestrator/tools/edit-graph.test.ts](../tests/unit/orchestrator/tools/edit-graph.test.ts)**
    ("returns null assistantText on clean success") — a pre-existing
    downstream-consequence pin not named in the original brief but
    necessarily affected by the same flip. The `assistantText: null`
    assertion only held *because* `coaching: null` left the success-
    path text builder
    ([edit-graph.ts:2341](../src/orchestrator/tools/edit-graph.ts:2341))
    with nothing to render. Updated to assert
    `not.toBeNull()` and `toContain("Proposed graph edit.")`. Test
    title also updated from "returns null assistantText" to "returns
    safe-default assistantText" to reflect the new contract.

### Phase 2A polish (post-deploy review fix)

After Phase 2A deployed (commit `13dd9b4d` on 2026-05-09), the
post-deploy review surfaced a P1 semantic issue:

- **Symptom:** the safe coaching default applied to ALL bare-arrays
  including `[]`. The empty-ops branch in `handleEditGraph` then
  rendered `assistantText = "Proposed graph edit."` for empty
  responses, overriding the existing literal fallback "No changes
  were needed for this request." Misleading: the response proposed
  nothing.
- **Fix:** gated the safe coaching default on `parsed.length > 0` in
  `parseEditGraphResponse`. Empty bare-arrays now keep `coaching=null`
  so the existing empty-ops fallback at
  [edit-graph.ts:1637](../src/orchestrator/tools/edit-graph.ts:1637)
  fires. Telemetry still emits both events (`legacy_array_response`
  + `legacy_array_wrapped`) for empty bare-arrays — the array shape
  is the operator-relevant signal regardless of length.
- **Tests added:** A8 (parser-level coaching=null on empty),
  A8b (telemetry still dual-emits with `operations_count: 0`),
  D3-no-op (end-to-end "No changes were needed for this request."
  assertion).
- Same review pass also flagged stale "RED" / "Phase 2 must" comments
  in the test-file header that were authored pre-Phase-2A and not
  refreshed when `.fails` markers were removed. All such wording
  updated to reflect the post-Phase-2A state.

This polish is in-scope for Phase 2A as a small follow-up; it does
NOT broaden the workstream and does NOT touch any DL-7 surface.

### What Phase 2A did NOT land

- **Captured-payload incident closure.** A7 remains `it.todo` until a
  failing `edit_graph` `turn_id`, sanitised Render/Datadog log dump, or
  raw LLM output (sensitive content removed) is provided.
- **V5 integration.** Mutation facts / `recent_changes` / handler-fact
  receipt / `prior_facts` contract test / V5 E2E acceptance are not
  in this branch.
- **Prompt-patch upload.** The proposed v9 prompt diff (held in the
  Phase 1 plan) has not been applied to PMS.
- **`extractJson` sharp-edge hardening.** Out of Phase 2A scope; held
  pending captured-payload review (DL-3).

### Open obligations

- **A7 remains `it.todo`** until a captured payload is provided. This
  is not a Phase 2A regression; it is the entry-gate state pre-recorded
  in DL-5.
- **Full incident closure still requires DL-5.** A7 must be converted
  from `it.todo` to an executable test, run against the captured
  payload, and pass (or fail safely with a specific reason) before the
  incident can be marked closed.
- **Full `edit_graph` v9 completion still requires DL-7.** V5
  integration acceptance — receipt source-of-truth (Decision 1),
  `prior_facts` contract test (Decision 2), and the six-item closure
  checklist — remains the workstream completion gate.

**Owner:** Claude Code implementation agent (this Phase 2A diff) for
the entry; **Paul** for DL-5 closure (captured-payload supply), **War
Room** for DL-7 closure (V5 integration acceptance).

**Trigger to close:** DL-5 closes (captured-payload incident
resolved). At that point DL-5b retires automatically; DL-7 stays open
until the V5 integration tranche lands.

---

## DL-6 — CEE staging env-path convention

**Status:** policy entry — captures the convention used in this
workstream's audit so future agents and operators don't drift.

**Convention:**

- The CEE staging env file is expected at **`<repo-root>/.env.staging.local`**.
- The file is **gitignored**. It must never be committed, echoed, or
  logged. Credentials inside (Supabase service role key, etc.) are
  staging-only but are still secrets.
- The exact path is operator-local. The convention recorded in agent
  memory ("Mirrored at
  `~/Documents/GitHub/olumi-assistants-service/.env.staging.local`") is
  the default; operators may use a different local path.

**Rules of use:**

1. **Verify in-repo, do not assume from memory.** Before relying on the
   path in audit commands, an agent must run a read-only check that the
   file exists at `<repo-root>/.env.staging.local`. The path stored in
   the memory file is a default, not a guarantee — operator setups vary.
2. **Substitute explicitly if your local path differs.** If your CEE
   staging env file lives elsewhere (e.g.
   `~/.config/olumi/staging.env`), substitute that path explicitly in
   audit commands and note the substitution in any audit report
   you produce. Do not edit shared docs to refer to your local path.
3. **Audit reports must reference the path used.** Any audit doc that
   reads from this file should name the path it actually used (cf.
   [Docs/edit_graph_v9_routing_truth_check.md § 1](edit_graph_v9_routing_truth_check.md))
   so a reviewer can verify reproducibility.
4. **Never paste credentials into commits, logs, or report bodies.**
   Use `${SUPABASE_URL}` / `${SUPABASE_SERVICE_ROLE_KEY}` placeholders
   in audit-command examples.

**Owner:** _unassigned_ (CEE / devex)

**Trigger to close:** the convention is documented at a more central
location (e.g. `Docs/CLAUDE.md`, a `Docs/staging-env.md`, or the agent
memory file's canonical entry) AND this DL entry can be retired with a
one-line pointer there. Until then, this DL entry is the
workstream-scoped reference.

**Notes:** during this workstream the truth-check doc initially recorded
the path as `~/.env.staging.local`, which was wrong (the actual file is
at `<repo-root>/.env.staging.local`). The doc was corrected; this DL
entry exists so the same drift doesn't recur in the next workstream.

---

## DL-7 — V5 integration acceptance gate (cross-workstream)

**Status:** open — workstream completion gate. Independent from the
Phase 2 entry gate (DL-5), which controls whether code may start.

### Integration boundary

**Full `edit_graph` v9 completion requires V5 integration acceptance**,
including correct interaction with:

- **ContextPack** (read-side: how V5 assembles boundary state for
  routing and handlers).
- **Recent changes** (`src/orchestrator-v5/context/recent-changes.ts`)
  surfacing successful mutations.
- **Handler facts** (`src/orchestrator-v5/types/handler-fact.ts`,
  `src/orchestrator-v5/session/store.ts`) — what the dispatch writes
  for downstream turns to read.
- **Analysis staleness** (`src/orchestrator-v5/context/freshness.ts`)
  recomputed post-edit.

**ContextPack implementation itself remains owned by the V5 Context
Management Completion workstream.** This branch consumes V5's contract;
it does not own it.

### Workstream-status declarations

- `edit_graph` v9 **remains an independent implementation workstream**,
  but it is **a core V5 component and cannot be considered complete in
  isolation**. Phase 1 close-out, Phase 2 implementation, and incident
  closure are all gated downstream of V5 integration acceptance.
- This branch **must NOT edit** any of the following unless a hard
  dependency surfaces (in which case: pause, do not resolve in-branch,
  and report):
  - `src/orchestrator-v5/context/context-pack-assembler.ts`
  - `src/context/context-pack.ts` (boundary `ContextPack` type) and its
    in-progress companion `ContextPackSchema` (V5-owned, additive)
  - `src/orchestrator-v5/build-turn-context.ts`
  - `src/orchestrator-v5/context/recent-changes.ts`
  - `src/orchestrator-v5/types/handler-fact.ts`
  - `src/orchestrator-v5/session/store.ts` (handler/session fact types)
- If overlap is discovered, **pause and report**. Do not resolve
  cross-workstream contract changes inside this branch.
- **Full Phase 2 completion, incident closure, or v9 prompt upload
  remains gated on V5 integration acceptance** (this DL-7 entry).
- A narrow **Phase 2A** may still be authorised by Paul as
  safe-defaults + telemetry hardening only; it does **not** close
  DL-5, DL-5b, or DL-7.

### Cross-branch merge protocol

The V5 Context Management Completion workstream is proceeding in
parallel and is intentionally narrow / additive only:

- adds `scenario_id` to `ContextPack`
- adds `ContextPackSchema` for tests/harness use only (no runtime gate)
- adds schema/version tests
- documents state-trust / spec divergences
- keeps prompts, PMS, edit_graph, CQE, validator, replay, UI, and
  model-routing OUT of scope

**Whichever branch merges second must:**

1. Merge or rebase against the latest `staging` after the first branch
   lands.
2. Re-run targeted tests for that branch's surface (for `edit_graph`:
   the tests in
   [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts)
   plus any V5 dispatch tests touching edit_graph).
3. Confirm CI green before requesting review.

### War Room decisions

The following decisions were taken by the War Room and pinned into
DL-7's contract. They constrain Phase 2 / 2A scope and DL-7 closure;
they are NOT to be implemented in the current `edit_graph` branch.

#### Decision 1 — `edit_graph` receipt / `recent_changes` source of truth

**Resolution: B.**

> Successful `edit_graph` mutations must produce a V5-owned, turn-linked
> mutation fact or equivalent accepted-edit receipt that can feed
> `recent_changes`, state queries and follow-up turns. Graph hash /
> graph diff may support staleness and verification, but must not be
> the only source of truth for user-facing "what changed?" behaviour.

**Why this matters:** the graph diff alone preserves WHAT changed at the
data level but not the INTENDED edit meaning, the rationale, the impact
classification, or the safe user-facing summary. State-query follow-ups
("what update did you make?", "what changed?") need a structured
receipt, not a structural delta the UI must re-narrate.

**Implementation note (binding):** **do not implement this in the
current `edit_graph` branch.** The receipt-emission contract crosses
into V5 Context Management / `recent_changes` ownership and needs a
small integration tranche **after the current ContextPack work lands**.
This DL entry is the contract record; the integration is a separate
workstream item to be opened by the War Room when the ContextPack
tranche merges.

#### Decision 2 — `prior_facts` shape stability

**Resolution: B with target state.**

> `edit_graph` freshness derivation may depend on `prior_facts`, but
> DL-7 closure requires a targeted contract test proving the
> `prior_facts` / `HandlerFactWithTurn` shape used by `edit_graph`
> freshness derivation remains stable.

The production `prior_facts` / `HandlerFactWithTurn` shape is stable
enough to rely on conceptually today, but DL-7 closure does NOT treat
it as fully locked until a targeted contract test exists.

**Recommended contract-test specification** (to be authored as part of
the V5 integration tranche, not in the current branch):

1. Build a successful graph-edit turn (replay-harness or
   `dispatchEditGraph` with a fixture).
2. Ensure the relevant prior fact / turn fact is available through
   `buildTurnContext`.
3. Run `deriveAnalysisFreshness` using that context.
4. Assert the edit makes prior analysis stale, OR produces the expected
   freshness verdict for the case (e.g. `unknown / no_prior_run` when
   appropriate).
5. Assert NO `ContextPack` or `recent_changes` field-shape drift is
   required to make the assertion pass — i.e. the test exercises only
   the contract surfaces this branch already consumes.

### Closure criteria (all required)

These supersede the previous five-item list. War Room Decisions 1 and
2 above are the canonical wording for criteria 1–5; criteria 6 below
locks the file-overlap rule from DL-7's "Workstream-status
declarations" section.

**Status convention:** `[~]` = covered by PR B implementation (commit
present locally; awaiting push, deploy and War Room acceptance);
`[x]` = finally closed. PR B's branch is built and tested but not yet
merged to staging at the time these checks are ticked. Final closure
flips to `[x]` after deploy + acceptance.

**Loader-fix amendment (DL-7 PR B P0):** an earlier review pass
flagged that criteria 2, 3, and 5 below were not actually covered
by the initial PR B implementation because
`buildTurnContext.fetchPriorFacts` filtered prior turns by
`turn_class === 'handler'`, dropping the `direct_answer` turns on
which PR B emits the `edit_graph` fact. The loader fix at
[src/orchestrator-v5/build-turn-context.ts:362](../src/orchestrator-v5/build-turn-context.ts:362)
widens the filter to all prior turns (the FK in `readFactsFor` is
the actual gate). Criteria 2, 3, 5 are now genuinely covered. The
fix is pinned by:

- `src/orchestrator-v5/__tests__/build-turn-context-direct-answer-facts.test.ts`
  (FL1-FL6, 6 tests) — direct_answer turn → fact in prior_facts.
- `tests/integration/orchestrator/edit-graph-recent-changes-e2e.test.ts`
  (E2E-loader test) — full two-turn flow: dispatch commit on
  direct_answer turn → next-turn buildTurnContext loads it →
  `recent_changes` surfaces it as `graph_edited`.

- [~] **1. Documented source of truth for `edit_graph` recent-change /
      receipt behaviour.** Where the user-facing "what changed?" string
      comes from, where the structured fact is written, where it is
      consumed by `recent_changes`, and which fields are display-safe.
      → `EditGraphHandlerFact.result.safe_summary` is the canonical
      user-facing string; constructed by
      `src/orchestrator-v5/handlers/edit-graph-fact-builder.ts`;
      consumed by
      `src/orchestrator-v5/context/recent-changes.ts:summariseEditGraph`;
      surfaced verbatim by
      `src/orchestrator-v5/routing/state-query-guard.ts`. All display-
      safe-text fields enumerated in DL-7 PR B's `### PR B emitter-side
      safety test contract` subsection.
- [~] **2. Successful `edit_graph` mutation creates or is associated
      with a V5 turn-linked mutation fact / receipt.** Per Decision 1
      above. → Implemented in DL-7 PR B (commit pending push). The
      builder at
      `src/orchestrator-v5/handlers/edit-graph-fact-builder.ts:buildEditGraphHandlerFact`
      produces an `EditGraphHandlerFact` for every successful applied
      mutation; `dispatchEditGraph` passes it as `handler_facts: [<fact>]`
      to `commitDirectAnswer`. Turn linkage flows via the
      `HandlerFactWithTurn` wrapper at session-store read time
      (unchanged from the existing D1 mutation-fact pattern).
- [~] **3. `recent_changes` can surface the accepted edit in a safe
      user-facing form.** No raw entity IDs, no internal vocabulary
      ("repair", "wrapped", "envelope", model-routing details), no
      jargon from the A6 list in
      [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts).
      → `summariseEditGraph` reads `safe_summary` verbatim. Display-
      safety is enforced at the emitter (the builder runs
      `sanitiseUserFacingText` and the Phase 2A jargon-guard before
      construction). Pinned by:
      - `tests/unit/orchestrator-v5/handlers/edit-graph-fact-builder.test.ts`
        (E1-E5 raw-ID + jargon tests)
      - `src/orchestrator-v5/context/__tests__/recent-changes-edit-graph.test.ts`
        (R1-R7)
      - `tests/integration/orchestrator/edit-graph-recent-changes-e2e.test.ts`
        (E2E4 raw-ID scrub end-to-end)
- [~] **4. Graph hash / graph diff is used only as supporting
      evidence, not the sole user-facing source.** Per Decision 1.
      → `graph_hash_before` / `graph_hash_after` on the fact are
      diagnostic-only; `safe_summary` is the user-facing source.
      Documented in
      `src/orchestrator/handler-results.ts` (schema comment line ~273-279)
      and `Docs/edit_graph_v9_dl7_v5_integration_design.md` § 3.2.
      `recent_changes` projector reads `safe_summary`, not the hashes.
- [~] **5. `prior_facts` / `HandlerFactWithTurn` stability is covered
      by a targeted contract test.** Per Decision 2 above. → Test lands
      at
      `tests/unit/orchestrator-v5/handlers/edit-graph-prior-facts-contract.test.ts`
      (PF1-PF6, 6 tests). Asserts `deriveAnalysisFreshness` reads
      `prior_facts: readonly HandlerFact[]` plus a current graph hash
      and produces the correct verdict, with NO `ContextPack` /
      `recent-changes` / `build-turn-context` imports — the
      forbidden-imports list is enforced by the file's import
      statements as the canonical contract surface.
- [~] **6. No `ContextPack` assembler/schema files are touched in the
      `edit_graph` branch unless the War Room explicitly authorises a
      cross-workstream integration tranche.** The "must NOT edit" list
      in the Workstream-status declarations section above is the
      enforcement surface; reviewers should bounce any `edit_graph` PR
      whose diff includes those paths without a recorded War Room
      authorisation. → Verified for PR B at branch
      `claude/xenodochial-goldberg-0f13db` via
      `git diff origin/staging..HEAD --name-only | grep -E
      'context-pack-assembler|context-pack-schema|ContextPack'` →
      empty. PR B touches no `ContextPack` surface. Final `[x]` flips
      after merge / deploy / acceptance.

      **Authorised in-scope exception (build-turn-context):** the
      single edit at
      [src/orchestrator-v5/build-turn-context.ts:362](../src/orchestrator-v5/build-turn-context.ts:362)
      (loader-filter widening from `turn_class === 'handler'` to all
      prior turns) was an authorised hard-dependency fix for DL-7 PR
      B — without it, `direct_answer` turn-linked facts would have
      been silently dropped between commit and downstream load,
      negating PR B's emit-side correctness. This is NOT a general
      ContextPack ownership change: the file lives in
      `src/orchestrator-v5/` (V5-owned), and the change is a one-line
      filter relaxation pinned by FL1–FL6 +
      `edit-graph-recent-changes-e2e.test.ts:E2E-loader`. The
      Workstream-status "must NOT edit" list remains in force for
      all `context-pack-assembler*`, `context-pack-schema*`, and
      `ContextPack`-named files.

**Owner (acceptance):** the War Room (Paul + V5 Context Management
workstream owner).

**Trigger to close:** all six closure criteria above are signed off.

---

### PR B emitter-side safety test contract (paired with DL-7)

PR A (`@talchain/schemas` 0.12.0, vendored at
[vendor/talchain-schemas-0.12.0.tgz](../vendor/talchain-schemas-0.12.0.tgz))
defines `EditGraphHandlerFactSchema` with an intentionally narrow
contract: shape only, no content-form checks, no cross-field
lifecycle invariants. Every test case in the schemas package's
"PERMITS …" boundary tests is a behaviour PR B's emitter MUST guard
against. PR B (CEE wiring) MUST add emitter-side tests asserting:

#### Display-safe text invariants

- [ ] **Long labels capped/truncated before fact emission.** Schema
      permits any non-empty `affected_entities[].label` (no
      `.max()`); emitter must truncate to a sensible cap before
      constructing the fact. Suggested cap mirrors the
      `formatFactorChange` / `formatConstraintAdded` truncation
      patterns in
      [src/orchestrator-v5/tools/handlers/d1-shared/format-confirmation.ts](../src/orchestrator-v5/tools/handlers/d1-shared/format-confirmation.ts).
- [ ] **Raw-ID-looking labels replaced with display-safe labels or
      a generic fallback before fact emission.** Schema permits any
      non-empty string in `label`; emitter must run
      `sanitiseUserFacingText` /
      `resolveLabel`
      ([src/orchestrator/shared/output-safety.ts:214](../src/orchestrator/shared/output-safety.ts:214))
      over each label, replacing entity IDs (e.g. `fac_delivery_cost`)
      with their display label or the prefix-aware generic fallback.
- [ ] **`safe_summary` sanitised before fact emission, including the
      Phase 2A jargon guard.** The 80-char schema bound only
      protects token budget; the emitter must additionally run
      `sanitiseUserFacingText` over `safe_summary` AND the Phase 2A
      jargon list (`legacy`, `repair`, `normalise` / `normalize`,
      `envelope`, `wrapped`, `gpt-`, `claude` — see test A6 in
      [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts))
      before fact construction. Emitter rejects (or down-converts to
      the safe Phase 2A default `"Proposed graph edit."`) any string
      that fails the guard.

#### Cross-field lifecycle invariants

- [ ] **`status='applied'` implies `operations_count >= 1`.** Schema
      explicitly permits `applied + operations_count: 0` (per War
      Room refinement #1 — keep cross-field semantics out of Zod);
      emitter must guard at construction time.
- [ ] **`noop=false` for successful applied mutations.** Schema
      permits `noop=true + status='applied'` (same War Room
      decision); emitter must couple them.
- [ ] **`noop=true` facts, if ever emitted, are not surfaced as
      successful `recent_changes` without explicit handling.** The
      `recent_changes` projector
      ([src/orchestrator-v5/context/recent-changes.ts:131-150](../src/orchestrator-v5/context/recent-changes.ts:131))
      already filters `noop === true` for the existing variants;
      PR B's `summariseEditGraph` branch must do the same. Emitter
      may also choose to never emit `noop=true` facts at all, in
      which case the projector branch is straightforwardly
      `noop=false` only.

These six checks constitute the emitter-side closure of the PR A
schema's deliberate permissive boundaries. PR B is incomplete
without all six tests passing.

---

## Cross-workstream alignment note

- **ContextPack implementation remains owned by the V5 Context
  Management Completion workstream.** Schema, assembler, recent-changes
  projection, handler-fact / session store types, and `buildTurnContext`
  are all V5-owned surfaces.
- **`edit_graph` v9 owns its own parser, repair loop, telemetry,
  prompt-patch proposal, and test baseline.** That includes the
  bare-array safe-envelope wrapper, the `legacy_array_response` →
  `legacy_array_wrapped` additive telemetry, and the
  `serialiseEditContextForLLM` / `editCompactGraph` raw-graph path.
- **V5 integration is a completion / acceptance gate** (DL-7), **not
  permission for `edit_graph` to edit ContextPack internals.** If an
  `edit_graph` change cannot land without modifying a V5-owned file,
  that is a War Room decision — pause and report.
- **Any future overlap must pause and be resolved deliberately by the
  War Room.** Do not silently absorb cross-workstream contract changes
  into either branch.

---

## DL-8 — Inherited OpenAPI generated-types typecheck drift

**Status:** closed by `39a57a8f` (merged to `staging` 2026-05-10 from
branch `claude/stupefied-volhard-15c245`; source commits `911c0296`
chore + `fb8d6a72` docs).

**Resolution implemented:**
- Added `pretypecheck` npm lifecycle hook in `package.json`:
  `"pretypecheck": "pnpm openapi:generate"` — `pnpm typecheck` now
  regenerates `src/generated/openapi.d.ts` before invoking `tsc`, so
  fresh worktrees no longer fail with the wall of TS2307 "Cannot find
  module '../../generated/openapi.d.ts'" errors.
- Updated `scripts/validate-prepush.sh` `check_typecheck()` to run
  `pnpm openapi:generate` before invoking `tsc -p tsconfig.build.json
  --noEmit` directly (the hook calls `tsc` directly rather than via
  `pnpm typecheck`, so the npm lifecycle hook alone is insufficient
  for the pre-push path).

**Scope of the fix:** this closes only the OpenAPI/generated-types
blocker — it does NOT make the broad `pnpm typecheck` command exit
clean on a fresh worktree. `tsc --noEmit` (the full config) still
surfaces documented pre-existing type errors in `tests/**` and
`tools/**` (CLAUDE.md: "Source code (src/) compiles cleanly"). The
pre-push hook uses `tsc -p tsconfig.build.json --noEmit` (source-only)
which DOES exit 0 from a fresh state after this fix.

**Verified:** with `src/generated/openapi.d.ts` deleted (clean
disposable worktree after `pnpm install`):
- `pnpm typecheck` — `pretypecheck` fires, generator regenerates the
  file (~130ms), `tsc` proceeds; exit nonzero, but only on the
  documented pre-existing `tests/` + `tools/` errors.
- `pnpm exec tsc -p tsconfig.build.json --noEmit` (the pre-push
  source-only config) — exit 0.
- Pre-push hook end-to-end on this branch — all 15 checks OK including
  the modified `typecheck` step.

**Initial false alarm (resolved 2026-05-10):** when first verified, the
OpenAPI fix appeared to unmask 4 semantic errors in
`src/orchestrator-v5/context/recent-changes.ts` (TS2367 / TS2339) and
`src/orchestrator-v5/handlers/edit-graph-fact-builder.ts` (TS2305:
"no exported member `EditGraphHandlerFactSchema` /
`EditGraphHandlerFact`"). After running the DL-9 clean-recovery path
(`rm -rf node_modules && pnpm install`) all four errors disappeared.
Confirmed root cause: stale `@talchain/schemas` extraction in main
repo's `node_modules` from a prior install — an older drop missing
the edit_graph fact exports. The vendored
`vendor/talchain-schemas-0.12.0.tgz` (resolved as `@talchain/schemas
0.12.0`) is correct and DOES export both
`EditGraphHandlerFactSchema` and `EditGraphHandlerFact` (verified in
`node_modules/@talchain/schemas/dist/orchestrator/index.d.ts` after
clean install). Classified as **DL-9 / stale node_modules drift**, not
an edit_graph source issue. DL-8 stays focused on OpenAPI/generated-
types self-sufficiency.

---

**Original entry retained below for reference until merge SHA exists.**

**Status (original):** open — environmental, not workstream-introduced.

**Symptom:** `pnpm exec tsc -p tsconfig.build.json --noEmit` reports
**44 errors** in this worktree. The vast majority (≈40+) are TS2307:

```
Cannot find module '../../generated/openapi.d.ts' or its corresponding
type declarations.
```

across `src/cee/validation/*.ts`, `src/contracts/*.ts`,
`src/routes/assist.v1.*.ts`, `src/services/review/*.ts`. Two TS7006
implicit-any errors in `src/routes/assist.v1.graph-readiness.ts` are
also present (line 101, 105 — `Parameter 'n' implicitly has an 'any'
type`).

**Root cause:** `src/generated/openapi.d.ts` is produced by
`pnpm openapi:generate` (which runs `openapi-typescript openapi.yaml -o
src/generated/openapi.d.ts`). The full build script is:

```
"build": "pnpm openapi:generate && rm -rf dist && tsc -p tsconfig.build.json"
```

— so the typecheck step normally runs AFTER OpenAPI generation. In this
worktree the generated file does not exist (`ls src/generated/` returns
"does not exist"). Running `tsc` in isolation without first running
`openapi:generate` produces the 44 errors.

**Confirmed environmental, not Phase 2A regression:** verified by
running `tsc` against the pre-Phase-2A tree (`git stash` → `tsc` → 44
errors → `git stash pop`). Identical count before and after the
Phase 2A change to `edit-graph.ts`.

**Tension with project memory:** the agent's memory entry
("`tsc --noEmit` shows errors only in test files... Source code
(`src/`) compiles cleanly") describes the post-`openapi:generate` state.
The pre-push hook at
[scripts/install-hooks.sh](../scripts/install-hooks.sh) → typecheck
step is run after build, so the staging CI flow is fine. The drift
shows up only when an agent runs `tsc` in isolation in a fresh
worktree.

**Owner:** _unassigned_ (devex / build).

**Suggested fixes (any one closes this entry):**

1. **Document the prerequisite.** Add a one-liner to
   [Docs/CLAUDE.md](CLAUDE.md) under the "Tier 1 Smoke" section
   noting that `pnpm exec tsc -p tsconfig.build.json --noEmit`
   requires `pnpm openapi:generate` first when run from a fresh
   worktree, OR direct contributors to use `pnpm build` for a
   full check.
2. **Make typecheck self-sufficient.** Add an `openapi:generate`
   pre-step to the typecheck npm-script entry, or commit the
   generated file (with a regeneration comment).
3. **CI-check the generated file's freshness** instead of relying
   on local generation.

**Trigger to close:** the typecheck step from a fresh worktree
produces 0 errors without the agent having to know about the OpenAPI
prerequisite.

**Cross-reference:** unrelated test-debt is tracked at
[Docs/TEST-DEBT.md](TEST-DEBT.md) and
[Docs/known-test-failures.md](known-test-failures.md). Neither
mentions this OpenAPI generated-types issue, hence this DL entry.

---

## DL-9 — pnpm install absolute-path diffs across worktrees

**Status:** open — environmental; observed during PR A vendor refresh.

**Symptom:** running `pnpm install` from a git worktree produces
diff noise in tracked `node_modules/` files. The diff content is
absolute paths flipping between the main-repo root and the
worktree root — e.g.:

```
- /Users/paulslee/Documents/GitHub/olumi-assistants-service/node_modules/.pnpm/...
+ /Users/paulslee/Documents/GitHub/olumi-assistants-service/.claude/worktrees/<name>/node_modules/.pnpm/...
```

Concretely observed: PR A's vendor-refresh `pnpm install` produced
**911 unstaged tracked changes** in `node_modules/`, none of which
were real dependency churn. All were path-baked text in pnpm shims
(`node_modules/.bin/<tool>`), pnpm metadata
(`node_modules/.modules.yaml`,
`node_modules/.pnpm-workspace-state-v1.json`), and per-package
metadata under `node_modules/.pnpm/`.

**Root cause:** the repo intentionally tracks ~4,360 files under
`node_modules/` (despite `.gitignore` line 1 saying `node_modules`
— `.gitignore` doesn't apply to already-tracked files). Tracked
files contain absolute paths baked at install time. A `pnpm install`
from a different working directory rewrites those paths.

**Risk:** a broad `git add .` after a worktree install would
silently include hundreds of meaningless path-string changes
alongside the intended commit, polluting history and bloating PR
diffs.

**Mitigation (operational, until fixed at the repo level):**

1. Agents must inspect `git status` and `git diff --stat` before
   any staging that isn't `git add <named-file>` — never use
   `git add .` or `git add -A` after running an install in a
   worktree.
2. Accidental path noise can be cleared before committing via
   `git restore -- node_modules/`. The actual installed package
   contents on disk are not affected (pnpm's content-addressed
   store keeps the real files); only path-baked text reverts to
   match HEAD.
3. Verify zero `node_modules/` entries in
   `git diff --cached --name-only` before committing. PR A's
   final pre-commit state had **0** unstaged tracked changes
   after restore.

**SHARP EDGE — observed during the PR A post-merge assessment
(2026-05-09):** the `git restore -- node_modules/` step in
mitigation #2 reverts the *tracked* `node_modules` files to
HEAD's content. Those tracked files include `.bin/` shims and
`.pnpm/` metadata baked at install time on whichever working tree
last committed them (typically the main repo root). After the
restore, the tracked files mismatch what's actually on disk under
`node_modules/.pnpm/<pkg>/node_modules/<pkg>` (which pnpm
preserved). Subsequent `pnpm install` is a no-op because the
top-level `package.json` and `pnpm-lock.yaml` haven't changed —
so pnpm doesn't fix the inconsistency. The result: TypeScript
typechecks fail with `Module '"undici"' has no exported member …`
errors and several `vitest` runs error out at module-load time,
because the type-stubs pnpm installed don't match the runtime
behaviour the .bin shims point at.

**Recovery procedure when this happens:**

```bash
rm -rf node_modules        # nuke the inconsistent tree
pnpm install               # fresh install reconstructs from
                           # pnpm-lock.yaml + the shared store
```

This is reproducible. Origin/staging is fine — the pre-push hook's
typecheck step ran on a clean install and passed all 15 checks.
The breakage is local-workspace-only.

**Strict-form mitigation (recommended):** if you need a clean
unstaged tree for a commit, prefer the rm+reinstall sequence to
`git restore -- node_modules/`. The restore approach saves time
when the install state is already consistent with HEAD; once it
diverges, restore makes things worse.

**Owner:** _unassigned_ (devex / repo maintainer). Related to
DL-1 (broken worktree pnpm/vitest resolution), but distinct: DL-1
is about install failure; DL-9 is about install-induced diff
noise.

**Suggested fixes (any one closes this entry):**

1. **Stop tracking `node_modules/`.** `git rm -r --cached
   node_modules/` then commit; future installs no longer produce
   tracked diffs (and the original `.gitignore` line takes effect
   for new files). High-impact change; needs review of what (if
   anything) currently relies on the tracked install (CI cache?
   pre-push hook smoke step?).
2. **Make pnpm path-bake relative.** pnpm has had an `embed-path`
   / similar option in some versions; investigating the current
   pnpm 10.18.0 behaviour might offer a config-only fix.
3. **Document a worktree-aware install convention.** Each
   worktree that needs a working `node_modules/` either points
   `PNPM_HOME` at a worktree-specific store, or operators do all
   installs from the main repo and use the worktree only for
   reads/writes that don't trigger pnpm.

**Trigger to close:** running `pnpm install` in a fresh worktree
produces zero unstaged tracked changes by default.

**Cross-reference:** during PR A this manifested as a reviewer
flagging "911 unstaged tracked node_modules changes" — see commit
of vendor refresh (`chore(deps): bump @talchain/schemas to 0.12.0`)
for the reference cleanup pattern.

---

## DL-10 — Loader-side filters can silently negate emit-side correctness (DL-7 PR B retrospective)

**Status:** retrospective — captured 2026-05-10 during DL-7 PR B
review; informs future fact-emission work.

**Symptom.** During DL-7 PR B implementation, the `edit_graph`
dispatcher emitted a valid `EditGraphHandlerFact` and the
`append_turn_atomic` RPC committed it correctly to
`v5_handler_facts`. End-to-end behaviour was nonetheless broken:
nothing surfaced in `recent_changes`, nothing reached the state-
query guard, and the next turn's `prior_facts` array contained no
`edit_graph` entry. The fact was being persisted and then silently
discarded at load time.

**Root cause.** `buildTurnContext.fetchPriorFacts`
([src/orchestrator-v5/build-turn-context.ts:362](../src/orchestrator-v5/build-turn-context.ts:362))
filtered prior turns by `turn_class === 'handler'` before mapping
to row IDs for `readFactsFor` / `readFactsWithTurnFor`. The filter
predated PR B and matched the historical convention that only
`handler`-class turns emit facts. PR B intentionally preserves
`turn_class: 'direct_answer'` for `edit_graph` mutations (per War
Room — `V5ActionType` does not include `edit_graph`, and the
response-finaliser path is unchanged), so the loader filter
silently dropped every PR B fact's parent turn before
`readFactsFor` was even called. Emit-side correctness was real;
load-side correctness negated it.

**Lesson.** *Loader-side filters can silently negate emit-side
correctness.* In PR B, `edit_graph` emitted a valid
`EditGraphHandlerFact`, but `buildTurnContext` originally loaded
facts only from turns where `turn_class === 'handler'`. Since
`edit_graph` intentionally preserves `turn_class: 'direct_answer'`,
emitted facts would have been invisible to `recent_changes` and
state-query flows. **Future fact-emission work must verify
end-to-end visibility through `buildTurnContext` / `prior_facts`,
not just emission.** A unit test that asserts
`commitDirectAnswer` was called with a non-empty `handler_facts`
array is necessary but not sufficient; the same payload must be
shown to round-trip through `buildTurnContext` and reach the
projector.

**Concrete recommendations for the next fact variant.**

1. Pair every emit-side test with a loader-side test that calls
   `buildTurnContext` with a mock store and asserts the new fact
   appears in `prior_facts` and `prior_facts_with_turn`.
2. If the emitting handler does NOT use `turn_class === 'handler'`
   (i.e. preserves `direct_answer`), explicitly enumerate that in
   the design doc so reviewers spot the load-path question.
3. Treat the prior-turn filter in `fetchPriorFacts` as fact-
   emission infrastructure: any narrowing of it must be paired
   with a check that no current emit site relies on the broader
   shape.

**Pinned by.** FL1–FL6 in
[src/orchestrator-v5/__tests__/build-turn-context-direct-answer-facts.test.ts](../src/orchestrator-v5/__tests__/build-turn-context-direct-answer-facts.test.ts)
and the E2E-loader test in
[tests/integration/orchestrator/edit-graph-recent-changes-e2e.test.ts](../tests/integration/orchestrator/edit-graph-recent-changes-e2e.test.ts).

**Trigger to close (retrospective entries).** This DL is reference
material; it does not "close" in the same sense as a defect. It
retires only when the next fact-emission workstream lands and its
review has explicitly cited this entry, or when its lesson is
absorbed into a higher-level checklist (e.g. a "new fact variant"
ADR template).

---

## DL-11 — Inherited `no-op-helpers.test.ts` failures (test baseline)

**Status:** open — pre-existing on staging baseline; unrelated to
DL-7 PR B.

**Symptom.** Two failures persist in
[src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts](../src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts):

- `buildAnalysisAbsentTemplate › uses singular "option" wording when option_count === 1`
- `buildAnalysisAbsentTemplate › uses plural "options" wording when option_count !== 1`

Both fail with the same shape: the test asserts the rendered
template contains the substring `"<N> option(s) configured"`, but
the implementation renders `"<N> option(s) set up"` (different
verb phrase, same semantics). Wording mismatch only.

**Confirmed unrelated to DL-7 PR B.** Reproduction on the
unmodified tree (PR B changes stashed) shows the same two
failures, identical error output. PR B does not modify
`no-op-helpers.ts` or its test file. Not blocking PR B; should be
resolved in baseline cleanup.

**Owner.** _unassigned_ — V5 baseline maintainer.

**Trigger to close.** Either:
- align the assertion strings to `"set up"` (simpler), or
- align the template strings to `"configured"` (matches the
  template's own coaching vocabulary in adjacent helpers).
Then the two failing tests pass and the V5 unit suite is fully
green.

---

## DL-13 — `lint-changed` pre-push hook misses changed source files

**Status:** closed by `736508a5` (merged to `staging` 2026-05-10 from
branch `claude/stupefied-volhard-15c245`; source commit `67fba975`
chore).

**Note on entry origin.** This entry was originally drafted on
`claude/dl7-acceptance-doc` (commit `1a1aac9f`, also adds DL-12 and
DL-14). That branch had not merged when this Step 3 fix landed, so
the entry is reproduced here together with its closure record. When
`dl7-acceptance-doc` merges, the duplicate-add will surface as a
clean conflict on this entry — keep the closure-noted version.

**Symptom.** Across the DL-7 PR B pushes, the pre-push hook's
`lint-changed` stage reported `OK (no changed src files)` despite
the push containing six new files under `src/orchestrator-v5/**`
plus modifications to two existing source files. CI then surfaced
five ESLint errors on those exact files (`'vi' is defined but
never used`, `'AppliedChanges' is defined but never used`,
`Expected a 'const' assertion`, etc.). PR #158 had to clean them
up after the fact.

**Root cause confirmed.** Two compounding bugs in
`scripts/validate-prepush.sh:82` (the original
`check_lint_changed`):
1. **Wrong diff base.** `git diff --name-only HEAD -- ...` compares
   working-tree against last commit, so committed-but-unpushed
   changes were invisible.
2. **Glob pathspec swallowed.** `'src/**/*.ts'` was passed quoted
   to `git diff` as a literal pathspec; git's pathspec engine does
   not expand `**` like a shell glob, so the result was empty even
   when src/ files HAD changed.
Empty result hit `print_check "lint-changed" "OK (no changed src
files)"` (line 84) and returned 0 — silent skip.

**Resolution implemented:**
- Replaced `check_lint_changed()` with a base-vs-HEAD merge-base
  diff (`origin/staging` primary, fallback to `origin/main` and
  local refs), NUL-delimited file collection, ESLint-config-aware
  filtering, deletion-aware file existence check, and visible
  no-op output (prints resolved base + candidate count + selected
  count when no lintable changes are found).
- **Lint scope now matches CI.** CI runs `pnpm lint` = `eslint .`
  over the whole repo, covering `**/*.ts` + `**/*.{js,mjs,cjs}` in
  both `src/` and `tests/`. The hook now selects changed `*.ts`,
  `*.tsx`, `*.js`, `*.mjs`, `*.cjs` files under both, honouring
  `eslint.config.js`'s `ignores` block (`dist/`, `node_modules/`,
  `examples/`, `scripts/`, `perf/`, `tests/types/`,
  `tests/perf/**/*.js`, `sdk/typescript/dist/`,
  `sdk/typescript/vitest.config.ts`, `qa-smoke.mjs`, `* 2.ts` /
  `* 3.ts` stale shadows).
- **Fail-closed base resolution.** If neither `origin/staging`,
  `origin/main`, nor local fallbacks yield a non-empty merge-base,
  the hook returns non-zero with an actionable error message
  (suggests `git fetch origin staging` and notes the bypass env var).
- **Operator escape hatch.** `SKIP_LINT_CHANGED=1 git push` skips
  the check with a loud warning identifying it as an operator
  override. Not a default path; not for CI use.

**Files changed:**
- `scripts/validate-prepush.sh` — `check_lint_changed()` rewritten
  (~100 line diff). No other functions touched, no CI workflow
  changes, no runtime/source code changes.

**Trigger to close (final):** the hook's `lint-changed` stage
reports the same set of files CI's `pnpm lint` would lint, for any
push shape (new branch, amended commit, new files, renames),
AND fails closed when the diff base cannot be resolved. Confirmed
via three local tests on `claude/stupefied-volhard-15c245` and
end-to-end pre-push on push.

---

## How to add a new DL entry

1. Number sequentially (DL-N).
2. State the symptom or decision in one or two lines.
3. Name an owner (or `_unassigned_` and chase later).
4. Define the trigger to close — the concrete observable that retires
   the entry.
5. Cross-reference back here from any external decision log so the
   entries don't drift.
