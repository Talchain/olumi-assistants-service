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

**Trigger to close:** worktree `pnpm install` produces a working
`node_modules/.bin/vitest`, OR a documented procedure exists for running
tests from a worktree.

**Notes:** the worktree was created with the standard tooling; broken
pnpm resolution there is plausibly a project-wide issue affecting any
worktree-based workflow. Worth checking before more agents run in
worktrees.

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

**Earliest review date:** `<Phase-2A-staging-deploy-date> + 14 days`.

**Anchor (explicit):** the 14-day clock starts from the **Phase 2A
staging deploy date** — i.e. the date the change in
[src/orchestrator/tools/edit-graph.ts](../src/orchestrator/tools/edit-graph.ts)
that adds the dual emission (`legacy_array_response` +
`legacy_array_wrapped`) reaches the staging environment. **NOT** from:

- the implementation date (when the parser change was authored locally),
- the merge date (when the PR landed on `main` or another branch),
- the Phase 2A acceptance date in this workstream record.

Rationale: dashboards and saved log queries only start receiving the new
event when staging is serving the dual emission. Before that, ops
operators have no opportunity to migrate their queries even if they
wanted to. The 14-day window is a migration-and-verification budget for
the people downstream, not a code-freeze countdown.

Stored as a formula, not a fixed date, until the actual Phase 2A staging
deploy exists. When Phase 2A reaches staging, replace the formula with
the resolved date here so the sunset window doesn't drift silently.

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

- [ ] **1. Documented source of truth for `edit_graph` recent-change /
      receipt behaviour.** Where the user-facing "what changed?" string
      comes from, where the structured fact is written, where it is
      consumed by `recent_changes`, and which fields are display-safe.
- [ ] **2. Successful `edit_graph` mutation creates or is associated
      with a V5 turn-linked mutation fact / receipt.** Per
      Decision 1 above; implemented in the V5 integration tranche, not
      in the current branch.
- [ ] **3. `recent_changes` can surface the accepted edit in a safe
      user-facing form.** No raw entity IDs, no internal vocabulary
      ("repair", "wrapped", "envelope", model-routing details), no
      jargon from the A6 list in
      [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts).
- [ ] **4. Graph hash / graph diff is used only as supporting
      evidence, not the sole user-facing source.** Per Decision 1.
      Hash drives staleness verification; meaning + rationale + safe
      summary come from the structured receipt.
- [ ] **5. `prior_facts` / `HandlerFactWithTurn` stability is covered
      by a targeted contract test.** Per Decision 2 above. Test lives
      with the V5 integration tranche.
- [ ] **6. No `ContextPack` assembler/schema files are touched in the
      `edit_graph` branch unless the War Room explicitly authorises a
      cross-workstream integration tranche.** The "must NOT edit" list
      in the Workstream-status declarations section above is the
      enforcement surface; reviewers should bounce any `edit_graph` PR
      whose diff includes those paths without a recorded War Room
      authorisation.

**Owner (acceptance):** the War Room (Paul + V5 Context Management
workstream owner).

**Trigger to close:** all six closure criteria above are signed off.

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

**Status:** open — environmental, not workstream-introduced.

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

## How to add a new DL entry

1. Number sequentially (DL-N).
2. State the symptom or decision in one or two lines.
3. Name an owner (or `_unassigned_` and chase later).
4. Define the trigger to close — the concrete observable that retires
   the entry.
5. Cross-reference back here from any external decision log so the
   entries don't drift.
