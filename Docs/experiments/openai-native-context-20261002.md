# OpenAI native conversation continuity: isolated manual trial

Date: 2 October 2026
Status: PREPARED ONLY. No runtime implementation, tests or deployment claimed.
Branch: `experiment/openai-native-context-20261002`
Frozen CEE baseline: `9a9bf022373495b37878a87e033057c6cf0ec47c`.
Coordination: Talchain/olumi-programme-docs#85. Existing AI HARNESS/context owner owns the change; DL owns assignment, exact-head review and test deployment. Do not interrupt Compare or create a new programme lane.

## Objective and evidence boundary

Paul requests the quickest practical isolated PoC he can test manually, not a production migration. Replace only the model-facing conversation-history transport with Responses `previous_response_id`. Keep canonical graph, analysis, proposals, approvals, writes and visible-result permissions unchanged.

Correction to the earlier ChatGPT recommendation: the completed API screen was a synthetic recall test, with simplified history policies, ACK assistant replies and no real canonical-state projection or tool execution. It was not an end-to-end comparison with current Olumi. The full-transcript control also recalled every scored fact. Those results justify this trial, not a proven superiority or migration claim. Automatic compaction also produced a subsequent response containing only a compaction item and no answer; post-compaction continuity is not established. Keep compaction OFF in this first trial.

## Six bounded tasks

### 1. Freeze the experiment and prepare the test surface in parallel

One code owner and one deployment helper, using existing sessions. Keep the existing model, reasoning effort, prompt content and tool catalogue fixed. Introduce one default-OFF experiment configuration switch, enabled only on the isolated backend. Do not merge into staging or change its environment.

Use the existing frontend against the isolated CEE instance. Reuse approved non-production infrastructure and separate disposable test scenarios; no new database is required. Prefer an isolated local worktree and local frontend/backend if hosted preview setup is slower. For a hosted test, use a dedicated frontend preview plus a separate backend, not just a frontend branch pointing at shared staging. Inspect every browser API/proxy destination, including direct edits and readbacks. Preserve authentication and scenario ownership. Do not repoint the existing locked `manual-test` deployment. Publish only a URL that has actually been opened and verified.

### 2. Add native continuation at the existing call boundary

Read and minimally extend:
- `src/routes/agent-v1-turn.ts`: Responses HTTP request/response mapping, authenticated scenario binding, history selection and final turn settlement.
- `src/orchestrator-v5/agent-lane/runtime/agent-loop.ts`: `ModelCallRequest`, `ModelCallResponse`, `runAgentTurn`, host-first calls and composed replies.
- One small experiment-local continuation helper if needed; do not refactor the route or create a memory framework.

Expose the provider's actual response ID through the internal adapter result. In native mode, use stored Responses and send `previous_response_id` plus only items the provider has not yet seen. Never send the replayed transcript alongside its own previous-response chain. Repeat the required current instructions and tool declarations on every provider request. Prewarm, construction, research and independent interpretation calls must not accidentally advance the conversational chain.

Use a bounded server-side map keyed by authenticated subject, scenario and experiment session. Never trust a browser-supplied provider response ID. Single backend process, one tester and one tab are accepted PoC restrictions. Serialise or reject overlapping turns for the same binding. No database migration or historical-session import in this first cut. Browser refresh should retain the same chain while that backend process remains alive. After a server restart, expiry or eviction, visibly require a new test conversation rather than silently pretending continuity survived.

### 3. Preserve the real tool and visible-answer lifecycle

The loop already has host-synthesised function calls, a prewarm call, and `composeReply` paths that can end a turn without another model call. Handle these explicitly: retain unsent tool results and authoritative visible replies and forward them once at the next continuation. Every provider-issued function call receives exactly one corresponding result before continuing. Preserve complete reasoning/phase protocol items where manually forwarding items is required.

Do not use a prewarm/auxiliary response as the chain head. Do not advance the committed head on a failed turn or replay a completed write to recover a missing response. Reuse existing replay and idempotency authorities. When Olumi replaces or withholds model prose, subsequent context must reflect the final user-visible outcome, not treat discarded provider prose as an authoritative result. This is a focused lifecycle change, not merely adding one JSON parameter.

### 4. Retain fresh canonical state and all existing safety boundaries

Each turn still reads the actual current graph, Run/result identity, freshness, participation, provenance and proposal status through existing authorities. Historical conversation and old tool results do not override current permissions or turn a proposal into an applied change. User corrections that conflict with saved facts trigger the existing clarification/proposal flow, never an unapproved rewrite.

Keep `HistoryStore` and durable transcript writes for existing logging, replay and non-native mode. Bypass history trimming only as the source of model-facing history in native mode. Do not delete old code during this experiment. Do not change shared schemas, science, model construction, approval semantics or PMS prompt content.

### 5. Use a small preview gate, not the whole programme as a prerequisite

Run the build, targeted type/lint checks and focused deterministic tests for:
1. Later requests carry a valid prior response ID and only new items; auxiliary calls never change it.
2. Host-first and model-chosen tool paths, composed replies, and exact-retry produce no orphaned outputs, lost results or duplicate writes.
3. Subject/scenario separation and a missing/expired/restarted chain fail safely and visibly.
4. Fresh state after an edit overrides stale historical results; denied/withheld claims remain denied.
5. Default-OFF mode preserves existing request behaviour.

Obtain one focused independent review of the actual diff. Then one real browser smoke: create disposable scenario, converse, approve one change, analyse, refresh and continue. Record the exact served code/configuration. Existing wider merge/release gates still apply before integration; unrelated feature completion and a broad benchmarking campaign are not prerequisites for this private preview.

### 6. Give Paul the working URL and a short test card

Use separate fresh but equivalent scenarios for native and baseline, the same model/prompt/backend code apart from the switch, and the same scripted user turns. Test:
- State an early correction and reject a suggestion, then continue for more than eight turns and ask about both.
- Ask a follow-up referring to a prior explanation, not just a stored number.
- Propose a change, decline it, later approve a different change; inspect what actually changed.
- Run analysis, change an input, ask about the old result, rerun and ask what changed.
- Refresh the browser and continue the same conversation.

Record complete user-visible correctness, repetitions, failures, total provider calls, latency and usage for the whole journey. Keep transcript recall separate from canonical-state/write defects. Native continuation does not by itself remove input-token billing or context-window limits. A modest test/session cap and existing call deadlines are sufficient here; no elaborate cost dashboard.

Deliver a verified URL, exact UI/CEE build identifiers, how to reset, and known limitations. Any new superiority claim must be grounded in this integrated trial, not the synthetic 1/11 versus 11/11 result.

## Explicitly deferred

Automatic compaction, historical conversation migration, durable cross-device/native-session recovery, multi-instance scaling, a Conversations API rewrite, cache optimisation, memory dashboards, full-history archival redesign and a broad model/prompt sweep. None is needed to learn whether native continuation improves Paul's actual experience.

## Sources verified for this brief

- Current CEE staging branch and the route/loop files at the frozen SHA above.
- Programme context ownership: #85 comments 5958253834 and 5958337891.
- Official OpenAI conversation-state documentation: https://developers.openai.com/api/docs/guides/conversation-state
- Official OpenAI compaction documentation: https://developers.openai.com/api/docs/guides/compaction

No provider calls, product writes, runtime configuration changes or deployment were performed in preparing this brief.
