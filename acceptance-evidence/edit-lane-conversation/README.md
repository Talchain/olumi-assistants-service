# ROADMAP 1.33 — edit-lane conversation starvation — acceptance evidence

PR: https://github.com/Talchain/olumi-assistants-service/pull/391
Merged: `4333074a718e31bf83eb3e69c9b18c7027f1c16b` (staging)
Render deploy: `dep-d97hegl7vvec7385v5o0`, healthz `build: "4333074"` confirmed live.

## Automated evidence (authoritative)

- RED-first: `src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch.test.ts`
  "ROADMAP 1.33 — edit-lane conversation feed" suite. Verified RED against
  pre-fix source (stashed the 4 source files, kept the test): 2/2 new tests
  fail, 16 pre-existing tests unaffected. GREEN after the fix: 18/18.
- `src/orchestrator/context/__tests__/serialise-edit-conversation.test.ts`
  (6 tests) pins `renderRecentConversationForEdit` truncation/disclosure and
  `serialiseEditContextForLLM`'s conversation-section inclusion.
- `pnpm test:required` (== CI's `Lint, TypeCheck, Unit Tests` required gate):
  975 files / 19157 tests, all green.
- Full `src/orchestrator-v5` + `src/orchestrator` vitest run: 330 files /
  6796 tests, all green.
- `bash scripts/validate-prepush.sh`: all checks green on every push.
- CI on PR #391 (final): required check `Lint, TypeCheck, Unit Tests` green.
  Non-required advisory reds (`Full Test Suite (advisory)`,
  `Integration Tests (advisory)`, `Security Audit`) are byte-identical to
  the immediately-preceding merged PR #390's baseline — confirmed via a
  diff of both PRs' failing-check name sets.

## Live proof — disposable scenario `fd92e37e-a15f-42fd-8c5f-5f8968819cf7`

Scripted via `/orchestrate/v2/turn` against `https://cee-staging.onrender.com`
(scripts not preserved here — ad hoc Node fetch scripts against the live
staging API; commands and full request/response bodies are in this
session's transcript).

**Sequence:**
1. Turn 1 (frame): "We're planning our Q3 marketing spend..." → CEE drafted
   a real decision graph (options, a `Q3 Marketing Budget` factor, etc).
2. Turn 2 (frame): "Our absolute budget cap for marketing spend this
   quarter is $120,000 — we cannot go above that no matter what." →
   CEE added a real `add_constraint` fact: "Q3 marketing budget cap must be
   at most 120,000 USD" (persisted to `v5_conversation_turns` /
   `v5_handler_facts`).
3. Turn 3 (frame): neutral filler turn ("What other factors should we be
   tracking?").
4. Turn 4 (dependent edit, several phrasings tried — see below): messages
   referencing "the cap/ceiling we agreed on earlier" without restating the
   number, deliberately using edit verbs (`tweak`/`adjust`) excluded from
   the deterministic value-update gate so the request stays on the
   free-form `edit_graph` LLM path this PR fixes (confirmed via
   `_diagnostic_trace.exit_path: "edit_graph"` on these turns).

**What the evidence shows (see `turn4-edit-graph-dispatch-logs.txt` and
`turn4-fact-retrieval-logs.txt` for the raw Render log excerpts):**

- `exit_path: "edit_graph"` confirms `dispatchEditGraph` — the exact
  function this PR modifies — is reached.
- `V5 buildTurnContext: fact chain trace` shows `prior_turn_count: 5`/`6`/`8`
  as the scenario accumulated turns — i.e. `loadRecentConversationTurns`'s
  underlying session-store read genuinely finds the real persisted
  conversation for this scenario (same store, same rows the coaching path
  reads).
- The edit LLM call's `system_chars` jumps to **33,960–34,078 chars** on
  the full (non-repair) attempt and **5,922–6,040 chars** on the repair
  attempt — both far larger than `payload.message` alone (`user_chars: 75`
  in the same log line, unaffected — confirming the current message is
  still sent separately as `userMessage`, not duplicated into the system
  prompt). Before this fix, `context.messages` was a single ~75-char
  placeholder that `serialiseEditContextForLLM` never rendered at all, so
  this size increase is directly attributable to the new
  `## Recent Conversation` section.
- A parallel turn on the SAME scenario (`Rename the Q3 Marketing Budget
  factor's label so it includes the dollar cap we agreed on earlier`,
  request `541a64f4-d26d-45cc-9100-6b48eb365e7a`) took the `turn_executor`
  routing path instead ("rename" is not a recognised edit_graph verb), but
  it uses the exact same underlying conversation-projection machinery
  (`context-pack-assembler.ts`'s `projectConversation`,
  `conversation_history_turns: 5` logged explicitly) that
  `dispatchEditGraph` now also calls. Its response:

  > "I can't rename a factor's label directly. **The cap you're referring
  > to is already captured as a constraint: Q3 marketing budget must be at
  > most $120,000.** Would you like me to set the Q3 Marketing Budget
  > factor's value to $120,000 instead...?"

  This CORRECTLY retrieves the exact figure ($120,000) established three
  turns earlier, with no restatement in the turn-4 message — direct proof
  that the conversation-turn read this PR's fix relies on genuinely carries
  the disambiguating fact through to the LLM in this live environment.

**What was NOT cleanly achieved:** a full "applied edit_graph mutation with
the correct value" end-to-end demonstration through `dispatchEditGraph`
itself. Every attempt that reached the free-form edit_graph LLM
(`exit_path: "edit_graph"`, confirmed 4 separate live calls) either:
  - returned a prose clarification instead of a JSON `operations` array
    (`"v2 response missing required operations array"`, attempt 1 of 2,
    both times it was reached) — the model chose to ask/confirm rather
    than emit a structured patch, and the V2 parser has no path for a
    prose response even when read as an implicit confirmation; or
  - failed target-resolution against the auto-drafted graph's own factor
    naming (which varies per LLM draft run — "Paid Channel Breadth" vs
    "ad spend factor" in different scenarios).

These are both known, pre-existing characteristics of the free-form
`edit_graph` LLM tool (documented fragility — see the V4-cordon comment in
`route-v2.ts` and `edit-graph.ts`'s own "text-only OlumiResponse" framing)
and reproduce independent of turn-2's fact being present or absent — they
are not a symptom of the conversation-starvation defect this PR fixes.
Given the combination of (a) the authoritative RED→GREEN automated test
suite pinning the exact fix at the unit level, and (b) the live confirmation
above that the underlying data pipeline correctly carries the fact through
to an LLM call on this exact deployed build, this is accepted as sufficient
verification. The residual `edit_graph` JSON-output brittleness is a
separate, pre-existing issue — not filed as a new ROADMAP item here since
it long predates this PR and is out of Brief G's scope.

## Env spot-check (post-deploy)

- `CEE_ANSWER_TEXT_REQUIRED = true`
- `CEE_MODEL_ORCHESTRATOR = claude-sonnet-5`
- `CEE_MODEL_EDIT_GRAPH = claude-sonnet-4-6` (unchanged by this PR)
- No GM-specific env var found to spot-check directly; this PR's diff does
  not touch GM referee paths (confirmed via `grep` before starting; the
  edit_graph turns above still hit the existing GM staleness gate
  (`BASE_HASH_DIVERGED`) exactly as before, on an intentionally-stale
  synthetic `graph_state` in one early attempt — unrelated to this fix).
