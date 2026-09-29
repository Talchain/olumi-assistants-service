# V5 Journey Replay

Harness for the six-step V5 golden-path regression against `/orchestrate/v2/turn`. Produces [Docs/v5/v5-golden-path-evidence-cee.md](../../Docs/v5/v5-golden-path-evidence-cee.md) with per-step rows, outcome class, and an executive summary.

## Usage

### Local

```bash
# terminal 1
pnpm start

# terminal 2
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url http://localhost:3000 \
  --out Docs/v5/v5-golden-path-evidence-cee.md
```

No API key required for localhost.

### Staging

```bash
export OLUMI_REPLAY_API_KEY='[your-staging-key]'

pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging
```

#### Strict-mode SHA check

For "I just pushed X, confirm staging is on X" workflows, opt into strict mode by passing the expected short SHA:

```bash
DEPLOYED_SHA=$(git rev-parse --short HEAD)

pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --expected-build "$DEPLOYED_SHA" \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging
```

The CLI flag takes precedence over the `OLUMI_REPLAY_EXPECTED_BUILD` env var. When neither is set the gate runs in default mode: it confirms `/healthz` returned a well-formed `build` field but does not compare against any reference SHA.

#### Journey selector

The harness runs one journey per invocation. The default is the original six-step canonical journey, so existing CLI invocations stay unchanged. DL-7 journeys are opt-in via the `--journey` flag:

| `--journey` | Steps | Notes |
|---|---|---|
| `canonical` *(default)* | the original 6 steps | Backwards-compatible. No new behaviour. |
| `dl7-set-factor` | `draft → set_factor_value → what_changed → run_analysis → explain_leader → what_would_flip` | Drives the V5 `set_factor_value` mutation handler so `recent_changes` populates today, before edit_graph DL-7 PR B exists. |
| `dl7-staleness` | `draft → run_analysis → edit_graph_generic → explain_leader_stale` | Reorders the mutation AFTER analysis to exercise the freshness=stale signal. Step 3 was switched from `set_factor_value` to the generic `edit_graph` dispatcher in Phase 2.6.4 because the set_factor_value path was label-fragile — see `STALENESS_STEPS` in [steps.ts](./steps.ts) for the rationale comment. |
| `dl7-edit-graph` | same shape as `dl7-set-factor` but Step 2 is a generic edit_graph mutation | **Core V5 path** — edit_graph DL-7 PR B is live on CEE staging. Runs by default. Emergency rollback: `DL7_PR_B_DISABLE=true` re-gates the journey if PR B regresses. Step 2 verifies the user-visible response is product-shaped and free of internal terms. The Step 3 (`what_changed`) assertion checks that the response references the captured factor label and reports `safe_summary=ok`. **Replay does not assert `turn_class` / `handler_id` / fact emission** — those fields are not on the wire response envelope and must be covered by edit_graph dispatch unit tests. |

#### Universal leak guards (apply to every step)

Every step's `assistant_text` and chip labels/messages are scanned by `findForbiddenMatches` ([forbidden-terms.ts](forbidden-terms.ts)) for:

- Internal/code identifiers (`HandlerFact`, `recent_changes`, `prior_facts`, `accepted_edit`, `fact_type`, `noop`, `buildTurnContext`, `orchestrator-v5` — case-insensitive for snake_case/PascalCase) and product-internal terms.
- Raw entity ID prefixes (`opt_*`, `fac_*`, `goal_*`, `risk_*`, `out_*`).
- **Graph-hash leaks** (any 12+ char hex string) — per the edit_graph DL-7 contract that graph hashes remain diagnostic-only. Reported as `graph_hash:<match>` in the row's `failing_contract` so reviewers can distinguish hash leaks from identifier leaks at a glance.

```bash
# DL-7 set-factor journey, runs against staging today
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey dl7-set-factor \
  --out Docs/v5/v5-dl7-set-factor.md

# DL-7 staleness journey
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey dl7-staleness \
  --out Docs/v5/v5-dl7-staleness.md

# DL-7 generic edit_graph journey (PR B live on staging — runs by default)
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey dl7-edit-graph \
  --out Docs/v5/v5-dl7-edit-graph.md

# Emergency rollback: re-gate dl7-edit-graph if PR B regresses on staging
DL7_PR_B_DISABLE=true pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey dl7-edit-graph \
  --out Docs/v5/v5-dl7-edit-graph.md
```

DL-7 journeys parse Step 1's drafted-graph response for option labels **and** factor labels. Step 2 picks a factor by deterministic fallback: any label containing the case-insensitive substring `"budget"` wins, otherwise the first label in the array, otherwise the step fails cleanly with `failing_contract: 'no_factor_label_available'` and downstream steps cascade-skip.

The key is sent as `X-Olumi-Assist-Key` (the existing service contract — see [src/plugins/auth.ts](../../src/plugins/auth.ts)). The service-side env var is `ASSIST_API_KEY` (or `ASSIST_API_KEYS` for a comma-separated list). The harness-side env var is deliberately named differently (`OLUMI_REPLAY_API_KEY`) so rotating one does not silently affect the other.

**The key is env-var only — no CLI flag.** This keeps the secret out of shell history, `ps auxww`, and process-tree telemetry.

## Auth contract

| Surface | Detail |
|---|---|
| Harness env var | `OLUMI_REPLAY_API_KEY` |
| Service env var | `ASSIST_API_KEY` (single) / `ASSIST_API_KEYS` (comma list) |
| HTTP header | `X-Olumi-Assist-Key: <key>` |
| 401 body | `{ schema: "error.v1", code: "UNAUTHENTICATED", message: "Missing API key. Provide X-Olumi-Assist-Key header." }` |
| 403 body | `{ schema: "error.v1", code: "FORBIDDEN", message: "Invalid API key." }` |

## Behaviour

The harness runs two preflight probes before burning the six-step replay:

1. `GET /healthz` (public, no auth) — confirms the service is reachable and records `build`, `version`, `degraded`, and `degraded_reasons` in the evidence pack. Used for Phase 2 deploy confirmation.
2. `POST /orchestrate/v2/turn` with a minimal body `{}` (authenticated) — confirms the auth header is accepted. The expected outcome is 400 or 422 (auth OK, body rejected). A 401 or 403 halts the run with exit code 3 before any canonical step is attempted.

### Deploy gate

Between healthz and preflight, the harness halts with exit code 3 if any of the following hold (and the URL is not localhost):

- `/healthz` is unreachable or returns no body
- `build` is missing or not a well-formed short SHA (7+ hex chars)
- `--expected-build` (or `OLUMI_REPLAY_EXPECTED_BUILD`) is set and `build` does not match
- `degraded === true`

The gate has two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| Default | neither `--expected-build` nor `OLUMI_REPLAY_EXPECTED_BUILD` set | Confirms `/healthz` returned a well-formed `build` field. No SHA comparison. |
| Strict | `--expected-build SHA` (CLI; preferred) or `OLUMI_REPLAY_EXPECTED_BUILD=SHA` (env) | Additionally halts when `build !== SHA`. Use for post-deploy verification and formal evidence packs. |

To bypass any halt (well-formed failure, strict mismatch, degraded, unreachable):

```bash
export OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true   # also accepts "1" or "yes"
```

Localhost runs always skip this gate (local builds use arbitrary SHAs).

### Outcome classes (per row)

- `v5-runtime` — the orchestrator actually ran. Includes success (200), genuine 500, and 200 with an error envelope (`schema: "error.v1"` or BoundaryError shape — both are runtime failures, not successes).
- `harness-auth-blocker` — pre-orchestrator: 401, 403, network errors, aborts, harness exceptions.
- `skipped` — a prerequisite step failed; this step was not attempted.

### Localhost detection

Only the following hostnames are treated as local:

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `::1`

Not local (key required):

- `host.docker.internal` — container ergonomics; letting it pass means a misconfigured Docker environment could silently hit remote staging.
- `*.nip.io`, `*.localtest.me`, `*.xip.io` — wildcard DNS; can resolve to any public IP.
- `/etc/hosts` entries — not reproducible in CI.

If you find yourself wanting to widen this set, halt and ask.

### Secret redaction

A three-layer redactor (see [redact.ts](redact.ts)) ensures the API key never appears in:

- Console output (`console.log`, `console.error`)
- The evidence pack markdown (`row.evidence`, `failing_contract`, header fields)
- `Error.message` / `Error.stack` (via `sanitiseError` in `postTurn`)
- Diagnostic serialisations of request/response objects

Regression coverage: see [tests/unit/v5-journey-replay/redact.test.ts](../../tests/unit/v5-journey-replay/redact.test.ts) and [tests/unit/v5-journey-replay/auth-redaction.test.ts](../../tests/unit/v5-journey-replay/auth-redaction.test.ts) — the sentinel `SENTINEL-LEAK-CANARY-DO-NOT-MATCH-PROD-xyz123` must not appear in any observable surface.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All six canonical steps passed |
| 1 | One or more steps failed (replay ran; some rows failed). **Mid-replay transport errors classify as `failed`, not `skipped`** — exit 1 fires if a network blip prevents any step from completing. |
| 2 | Fatal harness error (uncaught exception outside the step loop) |
| 3 | Auth / preflight blocker, or deploy gate halted (build mismatch / degraded / healthz unreachable). Halts before any canonical step is attempted. |

## Files

| File | Purpose |
|---|---|
| [index.ts](index.ts) | CLI entry + six-step orchestration + preflight + fail-fast gate |
| [client.ts](client.ts) | `postTurn`, `getHealthz`, `preflightAuth` — all HTTP |
| [redact.ts](redact.ts) | `createRedactor`, `redactString`, `sanitiseError` |
| [localhost.ts](localhost.ts) | `isLocalHost` — exact-match hostname detection |
| [classify-outcome.ts](classify-outcome.ts) | `classifyResponse`, `hasErrorEnvelope`, `isTransportError` |
| [steps.ts](steps.ts) | Canonical + DL-7 journey definitions, factor-label resolver, journey registry |
| [assertions.ts](assertions.ts) | Per-step product-shape assertions |
| [forbidden-terms.ts](forbidden-terms.ts) | Internal-term leak patterns |
| [evidence-writer.ts](evidence-writer.ts) | Markdown output + executive summary |
| [types.ts](types.ts) | Shared types |

---

## V5 staging assurance (`pnpm assurance:v5:staging`)

A separate, **manual** confidence command that extends this spine (it reuses
`client`, `redact`, `forbidden-terms`, `classify-outcome`, and the
`evaluateDeployGate`/healthz/preflight gates) and adds what the HTTP-only
replay cannot do: **Supabase fact/hash reads + exact-ID cleanup + a
red/amber/green report**. It replaces the repeated hand-run live checks for the
current CEE/coaching spine. Code lives under [`assurance/`](assurance/).

```bash
# uses .env.staging.local for the Supabase service-role key (cleanup) + assist key (auth)
pnpm assurance:v5:staging
# options:
pnpm assurance:v5:staging -- --base-url https://cee-staging.onrender.com \
  --expected-build "$(git rev-parse --short HEAD)" \
  --scenario-prefix demo --out test-diagnostics/v5-assurance/report.md
```

**What it does** (two disposable scenarios, cleaned up in a `finally`):
1. graphless forced `run_analysis` → typed `analysis_not_ready` 200 + chip
   `chip_prompt_fix_before_analysis` + **zero** handler facts;
2. draft-first → persisted graph;
3. forced `run_analysis` → real PLoT result + `run_analysis` fact +
   `graph_hash_at_run`;
4. deterministic `set_factor_value` via `selected_elements.node_ids` + edit verb
   + quantity → the persisted factor value changes (no LLM routing);
5. stale coaching question → **safe degrade** (post-check / caveat / rerun
   offer), never confident current-result advice (the hardest case is
   `confident_advice_under_unsafe_state`);
6. forced rerun → `analysis_ready.freshness: 'fresh'`.

Every turn is scanned for internal-term leaks **and** Tier-2/Tier-3 claim
vocabulary ([`assurance/blocked-claim-fields.ts`](assurance/blocked-claim-fields.ts)).
Serving SHA + flag state are captured (never set). The run exits non-zero on any
🔴. The report defaults to a gitignored `test-diagnostics/` path.

### Credentials (names only — values never printed)

Read from `.env.staging.local`:

| Name | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | exact-ID cleanup + fact/hash reads. Service-role bypasses RLS (assurance scenarios are guest rows, `user_id IS NULL`). |
| `OLUMI_REPLAY_API_KEY` (or `ASSIST_API_KEY`) | assist auth (`X-Olumi-Assist-Key`). |

> **Security (locked decision):** the Supabase service-role key is for this
> LOCAL/MANUAL command **only**. It MUST NOT be put into CI. When a gated
> CI workflow is added later, cleanup transport is a **separate** approved
> decision (authenticated admin endpoint / scoped cleanup credential /
> CI-only controlled path) — never the service-role key by default.

### Field-safety boundary (non-negotiable)

PR #301 (Brief 4 claim-safety contract) is **doctrine, not enforcement**. The
suite asserts Tier-2/Tier-3 fields (`factor_sensitivity`, `confidence_tier`,
`robustness`, `edge_e_values`, `inference_warnings`, evidence quality,
report-level confidence, bias / scientific-warning vocabulary) are **absent**
from user-facing text — it must never assert them as present, displayed, or
safe.

### Files (`assurance/`)

| File | Purpose |
|---|---|
| [assurance/index.ts](assurance/index.ts) | CLI entry (arg parse, report write, exit code) |
| [assurance/run.ts](assurance/run.ts) | Orchestrator — two-scenario journey + cleanup in `finally` |
| [assurance/journey.ts](assurance/journey.ts) | Pure extraction + R/A/G classifiers |
| [assurance/facts.ts](assurance/facts.ts) | Supabase fact/hash/graph reads + factor resolution |
| [assurance/cleanup.ts](assurance/cleanup.ts) | Exact-ID child-first cleanup + zero-residual verify |
| [assurance/supabase.ts](assurance/supabase.ts) | Env load + service-role client + `TableAccess` |
| [assurance/blocked-claim-fields.ts](assurance/blocked-claim-fields.ts) | Tier-2/3 negative guard |
| [assurance/report.ts](assurance/report.ts) | Red/amber/green report renderer |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | all checks green/amber (no red) |
| 1 | at least one 🔴 (hard contract failure / unsafe state / residual left) |
| 2 | fatal harness error |
| 3 | blocked before running (missing creds / deploy halt / auth) — no scenarios created |
