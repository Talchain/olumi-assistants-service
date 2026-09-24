# Route-captured OpenAI Agent-lane turns, served CEE `57f903c` (24 Sep 2026, ~19:20Z)

These were captured from the **served** staging CEE through the browser's own transport:
`POST https://cee-staging.onrender.com/proxy/v5/turn` with `x-olumi-ai-mode: openai` and the UI Origin. The proxy forwards that to `/agent/v1/turn`.

- Every turn was a **guest** turn: no user JWT, so receipts and versions are not minted.
- Payload shapes mirror DecisionGuideAI `buildV5Payload` (the message turn, the approve chip, and the explicit Run button: `chip.action_type: run_analysis`).
- Captured by `capture-served.sh` (AI Quality & Architecture, session `d5d1e225`).

## Scenarios

| Folder | Brief | Construction | Approve (typed chip, FP2) | Explicit Run (FP3) |
|---|---|---|---|---|
| `hiring-run-blocked/` | hiring: tech lead vs two developers | 5 call(s): openai, 310 words | 0 call(s):  | **blocked**: `blocked`; the status-quo option acts on no factor. 1 call(s): openai, 96 words |
| `pricing-run-complete/` | pricing: £49 → £59 Pro, £20k MRR, churn < 4% | 6 call(s): openai, 284 words | 0 call(s):  | **complete**: `complete_current`, leader withheld (`constraint_verdict_withheld`). 1 call(s): openai, 191 words |

Each turn has four files:
- `*.request.json`: the exact body sent;
- `*.response.json`: the full body returned;
- `*.response.headers.txt`: an allow-list of headers only;
- `*.meta.json`: HTTP status, served build before and after (the same, `57f903c`, for every turn), and wall time.

## OpenAI-only evidence (asserted per turn before the next was sent)

- HTTP 200, and the response header `x-olumi-ai-mode: openai`.
- `_diagnostic_trace.exit_path == "agent_lane_v1"`.
- Every `_provider_calls[].provider == "openai"` with no `refused` outcome; `_provider_calls_truncated` is absent.
- The route runs under `runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'))` (served `src/routes/agent-v1-turn.ts:1619`).
- **Zero Anthropic calls.**

## Redaction

- Every UUID (scenario, turn, request and trace ids) is replaced by a stable placeholder `00000000-0000-4000-8000-0000000000NN`. A guest scenario has no owner, so anyone holding its id could open it.
- Response headers are allow-listed.
- No credentials were sent: the proxy is public and injects its own key server-side.

## What these files are, and are not

- They ARE the route-level request and response contract that the UI actually receives, for AI Conversation's rendering fixture and for this lane's reply scoring.
- They are NOT the OpenAI Responses-API request bodies the route sends. Those (instructions + input + tools) are reconstructed separately for the paired prompt comparison.
- `_provider_calls` carries model, purpose, `duration_ms` and token usage for each call.
