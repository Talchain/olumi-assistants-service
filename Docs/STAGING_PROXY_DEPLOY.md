# Staging deployment checklist — V5 browser proxy

This document covers the one-time environment variable changes required to
route V5 long-running draft graph calls through the browser-safe CEE proxy
instead of the Netlify Edge Function that times out at ~40 s.

Do **not** change production (`BROWSER_PROXY_ENABLED` remains `false` there).

---

## Why this is needed

Netlify Edge has a ~40 s response-header timeout. V5 draft graph generation
takes 40-60 s, causing `500 text/plain — the edge function timed out`.
The CEE service on Render runs on a plan with a request timeout of ≥150 s,
safely above the observed p95.

---

## Verified timeout chain (defaults)

| Layer | Value | Env var / note |
|---|---|---|
| UI extended timeout | **130 s** | `EXTENDED_TIMEOUT_MS` in `src/v5/getTimeoutMs.ts` |
| Browser proxy | **125 s** | `BROWSER_PROXY_TIMEOUT_MS` |
| Render/gateway | configured to ≥150 s | Render dashboard → service → Settings → Request Timeout |
| CEE route (Fastify) | 135 s | `ROUTE_TIMEOUT_MS` |
| CEE draft budget | 120 s | `DRAFT_REQUEST_BUDGET_MS` |
| CEE LLM timeout | 105 s | `DRAFT_LLM_TIMEOUT_MS` (derived) |

**Required invariants (CEE validates at startup):**
1. `BROWSER_PROXY_TIMEOUT_MS` (125 s) < `ROUTE_TIMEOUT_MS` (135 s) — proxy returns structured
   JSON before Fastify kills the request.
2. `BROWSER_PROXY_TIMEOUT_MS` (125 s) ≥ `DRAFT_REQUEST_BUDGET_MS` (120 s) — proxy waits long
   enough for a draft to complete normally.
3. UI extended timeout (130 s) > proxy timeout (125 s) — the browser stays alive long enough
   to receive the structured proxy error if the proxy itself times out.

> **Render timeout:** The default request timeout for Render Starter plan web services has
> been assumed at ≥150 s based on the CEE timeout-chain comment in `config/timeouts.ts`.
> Verify the actual value in the Render dashboard (service → Settings → Timeout) before
> enabling the proxy on a new service or plan, and set `ROUTE_TIMEOUT_MS` accordingly.

---

## Changes required for staging

### 1. Render — CEE staging service env vars

Set via the Render dashboard (not committed — contains a secret pattern):

```
BROWSER_PROXY_ENABLED=true
BROWSER_PROXY_ALLOWED_ORIGINS=https://staging--olumi.netlify.app,http://localhost:5173,http://localhost:4173
BROWSER_PROXY_TIMEOUT_MS=125000
```

> `BROWSER_PROXY_ALLOWED_ORIGINS` must be an exact-match list. Netlify preview
> deploy URLs (e.g. `deploy-preview-42--olumi.netlify.app`) must be listed
> explicitly — the proxy no longer accepts them via regex (to avoid a CORS
> preflight mismatch with `@fastify/cors`).
>
> If preview origins are added here, also add them to `ALLOWED_ORIGINS` so
> that OPTIONS preflight (handled by the global CORS plugin) passes too.

`ASSIST_API_KEY` (already set) is used as the internal service key — no
additional auth configuration needed.

### 2. Netlify — staging site env vars

Set via the Netlify dashboard under **Site configuration → Environment
variables** for the staging site:

```
VITE_V5_ENDPOINT=https://cee-staging.onrender.com/proxy/v5/turn
```

This overrides the default fallback (`/bff/orchestrate/v2/turn` via Netlify
Edge). The existing Netlify Edge proxy remains registered and unchanged as a
rollback fallback.

> **Security:** `VITE_V5_ENDPOINT` is a public URL — no secrets. The service
> key is never stored in any `VITE_*` variable.

### 3. Smoke test after enabling

Run the hiring-prompt smoke test to confirm end-to-end success.

> **Payload notes:**
> - `turn_id` and `scenario_id` are plain strings (not UUID-constrained by the schema).
>   Use realistic values so accidental duplicate IDs across smoke runs are avoided.
> - `conversation_history` is **not** part of the V5 `OrchestratorTurnPayload` schema
>   (which is `.strict()`). Sending it causes a 422 — do not include it.
> - `graph_state: null` is a recognised extension field (stripped before B1 validation)
>   and signals "no existing graph" → CEE dispatches `draft_graph`.

```bash
TURN_ID="smoke-$(date +%s)"
SCENARIO_ID="smoke-scen-$(date +%s)"
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
  -X POST https://cee-staging.onrender.com/proxy/v5/turn \
  -H "Content-Type: application/json" \
  -H "Origin: https://staging--olumi.netlify.app" \
  -d "{
    \"kind\": \"message\",
    \"turn_id\": \"${TURN_ID}\",
    \"scenario_id\": \"${SCENARIO_ID}\",
    \"message\": \"Should I hire a Tech lead or two developers to increase productivity?\",
    \"stage\": \"frame\",
    \"turn_class\": \"frame\",
    \"source\": \"composer\",
    \"graph_state\": null
  }"
```

Expected: `200` and response time > 10 s (confirming the proxy doesn't short-circuit).

Full response check:

```bash
TURN_ID="smoke-$(date +%s)"
SCENARIO_ID="smoke-scen-$(date +%s)"
curl -s \
  -X POST https://cee-staging.onrender.com/proxy/v5/turn \
  -H "Content-Type: application/json" \
  -H "Origin: https://staging--olumi.netlify.app" \
  -d "{\"kind\":\"message\",\"turn_id\":\"${TURN_ID}\",\"scenario_id\":\"${SCENARIO_ID}\",\"message\":\"Should I hire a Tech lead or two developers to increase productivity?\",\"stage\":\"frame\",\"turn_class\":\"frame\",\"source\":\"composer\",\"graph_state\":null}" \
  | jq '{has_draft_graph: (.draft_graph != null), analysis_status: .analysis_ready.status}'
```

Expected output:
```json
{
  "has_draft_graph": true,
  "analysis_status": "ready"
}
```

---

## Rollback

To revert to Netlify Edge routing:

1. **Netlify dashboard:** unset `VITE_V5_ENDPOINT` (or set it to empty string)
2. **Render dashboard:** set `BROWSER_PROXY_ENABLED=false`

The Netlify Edge proxy at `/bff/orchestrate/v2/turn` remains registered and
will immediately take over. No code changes required.

---

## Security notes

- `ASSIST_API_KEY` is injected server-side inside the CEE process. It is
  never present in any `VITE_*` variable, request header sent to browsers, or
  proxy response.
- Origin validation is enforced by the proxy route before any internal call.
  Non-browser callers can forge `Origin` — this is a browser defence only.
  The proxy does not expose a general LLM API; it only forwards to
  `/orchestrate/v2/turn` on the same Fastify instance.
- `x-user-id` is forwarded through the proxy for per-user diagnostics. It is
  not treated as an auth credential by CEE.
