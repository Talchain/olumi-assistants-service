# Native context trial: implementation notes

Date: 2 October 2026
Branch: `experiment/openai-native-context-20261002`
Base: `9a9bf022373495b37878a87e033057c6cf0ec47c`

The runtime implementation now exists on this branch. The PREPARED status in `openai-native-context-20261002.md` records the original brief, not the current implementation state. This document does not claim deployment, independent review or a live browser acceptance.

## What changed

Four runtime files only:

- `src/config/native-context-trial.ts`: experiment switches read at route registration.
- `src/orchestrator-v5/agent-lane/runtime/native-context-trial.ts`: bounded native response-chain transaction and subject/scenario/session binding.
- `src/orchestrator-v5/agent-lane/runtime/agent-loop.ts`: native transport hook, provider response ID, verified current-state requirement and unsent-item capture.
- `src/routes/agent-v1-turn.ts`: request/response mapping, session opening, final durable settlement and diagnostics.

Native conversation calls use `store: true` and the server's own `previous_response_id`, with only new items. A browser-supplied response ID is never used. Each new turn supplies fresh canonical state; old conversation cannot authorise writes. All existing tool eligibility, proposal, approval, ownership, replay, write and final-output gates remain in place.

A model-issued function call receives its corresponding output exactly once. A reply composed by Olumi without another model call, and zero-call approval/Run turns, are retained for the next continuation. Independent construction, research, brief-reading and interpretation calls never become the conversational response-chain head.

The helper commits a new chain position only after the final user-visible reply is durably recorded. An ambiguous/failed turn invalidates the trial chain rather than repeating a write or silently starting a new conversation. Corrected final replies are carried as assistant text after a fixed host display receipt, not promoted into developer instructions. Historical upstream drafts remain part of the provider's stored conversation; the current-state and final-egress gates are not removed.

## Deliberate PoC limits

- One backend process and one test user; overlapping requests for the same subject/scenario are refused.
- Fresh disposable scenarios only. Existing conversations are not imported.
- Same-session browser refresh is supported while the backend process lives. Backend restart, expiry, lost chain or session mismatch requires a new disposable scenario.
- At most 25 process-local sessions, 60 completed turns per session, one-hour idle lifetime, and a one-million-character ceiling for pending unsent items. Limits refuse explicitly, never trim silently.
- Automatic compaction is OFF. Context-window and token costs still apply.
- Detached cache prewarming is OFF in native mode. Native instructions use the top-level `instructions` field rather than the existing developer cache-breakpoint carrier; the instruction text itself is unchanged. This avoids accumulating repeated static instructions in provider history.
- `HistoryStore` and durable transcripts still serve existing provenance, logging, replay and non-native behaviour. This is not a new authority for graph, analysis or approval state, and does not repair unrelated canonical scope defects.

## Activation and isolation

Default is OFF. On a separate test backend only:

```text
OPENAI_NATIVE_CONTEXT_TRIAL=isolated
AGENT_LANE_ENABLED=true
OLUMI_ENV=staging
PROMPTS_ENVIRONMENT=staging
```

Do not set the trial flag on the shared staging backend. Production `OLUMI_ENV=prod` or `production` is explicitly refused. Use the existing authenticated test infrastructure and a distinct port/service; no database migration or schema release is required.

Build with the existing locked dependency set:

```sh
pnpm install --frozen-lockfile
pnpm build
# With approved test credentials already supplied securely to this separate process:
OPENAI_NATIVE_CONTEXT_TRIAL=isolated AGENT_LANE_ENABLED=true OLUMI_ENV=staging \
PROMPTS_ENVIRONMENT=staging PORT=3102 node dist/src/server.js
```

The existing frontend must point all relevant API/proxy destinations at this backend, including edits and readbacks. A frontend preview pointing at shared staging is not isolated. Do not repoint the locked `manual-test` slot.

Successful native responses expose `_agent.native_context.mode = openai_native_trial`, `continuity`, `compaction: false`, `recovery: single_process_only` and a turn count. Provider response IDs are not exposed. Normal UI-generated turn IDs are required. A reset error leaves the saved model intact.

## Verification

The branch workflow `Isolated native context trial` checks the exact triggering commit with failure-propagating shell pipelines. It does not deploy, mutate branches or make paid provider calls. Logs and verdict are stored in its `native-context-evidence` artifact.

Coverage includes helper lifecycle tests, the real Fastify route and Agent loop, proposal/approval/retry integration, 22 sequential route turns, scenario isolation, restart refusal, incomplete upstream responses, current-state presence and default-OFF compatibility. Provider HTTP, identity and persistence are test doubles, so these tests are not a live model benchmark or browser acceptance.

Before manual preview acceptance: one independent diff review and one authenticated browser journey against the actual isolated deployment. Check early corrections and rejected suggestions after more than eight turns, propose/approve one change, Run, edit, rerun, then refresh and continue. Capture the served frontend/backend identifiers and the native diagnostic marker. Do not claim superiority from the earlier synthetic recall scores.

## Rollback

Disable the flag on the separate backend or stop that process. Shared staging and production have not been changed by this implementation. Native test conversations cannot be resumed through a different process; retain their normal saved model/transcript records for inspection.
