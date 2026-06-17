# V5 Golden Journey Benchmark — Runbook

Build-pinned, two-mode benchmark over `/orchestrate/v2/turn`, built on
[tools/v5-journey-replay](../../tools/v5-journey-replay/). This runbook is the
operator guide for the gate probes and the two baseline modes.

> **Live-run boundary.** This lane PREPARED the harness only. Do **not** run a
> live staging benchmark until the gates below pass, and only in the documented
> order. Each live run is a separate, explicitly-approved execution.

## Modes & journeys

| `--journey` | Purpose | Flip legs |
|---|---|---|
| `gate-278` | #278 acceptance probe — Gate 1 (cappable add → rerun 200) + Gate 3 (unencodable add → safe defer) | — |
| `gate-277` | #277 live acceptance probe — fresh + stale `what_would_flip` | included |
| `p0-partial-spine` | **Partial spine baseline** — draft → run → explain → add → rerun → edit-option → what-changed → reload-rerun | **EXCLUDED** |
| `p0-full-golden` | **Full P0 Golden Journey baseline** — partial spine + `what_would_flip` fresh + stale | included |

The evidence pack prints an explicit banner: `p0-partial-spine` shows
**“⚠️ EXCLUDED — #277 not deployed on this build”** so it can never be misread
as covering flip.

## Gate → run dependency chart (run order)

```
#278 MERGED + LIVE (staging 9ac9ea6)  ──▶  [approve] run gate-278
                                              │  Gate 1 PASS + Gate 3 PASS
                                              ▼
                                          run p0-partial-spine   (Mode A baseline)

#277 review → merge → deploy  ──▶  [approve] run gate-277
                                              │  fresh + stale flip acceptance PASS
                                              ▼
                                          run p0-full-golden     (Mode B baseline)
```

1. `gate-278` — only after explicit approval to run #278 acceptance.
2. `p0-partial-spine` — only after `gate-278` Gate 1–6 pass.
3. `gate-277` — only after #277 is merged **and** deployed.
4. `p0-full-golden` — only after both #278 and #277 are live-accepted.

“Gate 1–6” = #278’s four post-deploy gates (Gate 4 has three negative
sub-checks): Gate 1 add→rerun 200 · Gate 2 edit-existing-option (containment,
see scoring) · Gate 3 unencodable→defer · Gate 4a top-level-raw-uncapped→defer ·
Gate 4b missing-factor→defer · Gate 4c unit-mismatch→defer. **4a/b/c are not
reachable via NL over HTTP — they are unit-test proven** in
`src/orchestrator/tools/__tests__/encode-option-interventions.test.ts` (or the
PR #278 test files) and are cited here rather than probed live.

## Environment

```bash
# Auth (harness env var → sent as X-Olumi-Assist-Key). Fetch from Render
# cee-staging env (srv-d4slpaili9vc73eiq4og) ASSIST_API_KEY.
export OLUMI_REPLAY_API_KEY='<staging ASSIST_API_KEY>'

# Optional: prove deterministic flip dispatch (handler_id + llm_calls=0) and
# capture per-stage server timings. Without it, latency falls back to per-step
# wall-clock and flip dispatch is recorded as "not_capturable".
#   set V5_TIMING_DEBUG=true on cee-staging (Render env)  ← read-only check first
```

The harness always sends `X-Olumi-Debug: timings`; the server only emits the
`_timings` block when `V5_TIMING_DEBUG=true`.

## Build pinning

Every run records the staging `/healthz` build and **halts** (exit 3) on build
drift, degraded, or unreachable health (override:
`OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true`). Pin the expected SHA with
`--expected-build`.

PR provenance is recorded verbatim from `--included-prs` / `--excluded-prs`
(comma-separated `<num>[:<sha>]`). These are **optional** and the harness runs
without `gh`. Generate them with `gh` when available:

```bash
# included merge SHAs (example: #276 + #278 on the partial-spine build)
INCLUDED="276:$(gh pr view 276 --json mergeCommit -q .mergeCommit.oid | cut -c1-7),278:$(gh pr view 278 --json mergeCommit -q .mergeCommit.oid | cut -c1-7)"
# excluded open PRs
EXCLUDED="277,270,271,272,273,275,259,264"
```

If `gh` is unavailable, pass the values by hand (or omit them — provenance lines
are simply elided).

## Commands

### Phase 1a — `gate-278` (after approval; #278 already live on 9ac9ea6)

```bash
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey gate-278 \
  --expected-build 9ac9ea6 \
  --scenario-prefix gate278 \
  --included-prs "$INCLUDED" --excluded-prs "$EXCLUDED" \
  --out Docs/v5/v5-gate-278-evidence.md
```

### Phase 2 — `p0-partial-spine` (after gate-278 passes)

```bash
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey p0-partial-spine \
  --expected-build 9ac9ea6 \
  --scenario-prefix p0-spine \
  --included-prs "$INCLUDED" --excluded-prs "$EXCLUDED" \
  --out Docs/v5/v5-golden-journey-partial-spine.md
```

### Phase 1b — `gate-277` (only after #277 merged + deployed)

```bash
DEPLOYED=$(curl -s https://cee-staging.onrender.com/healthz | python3 -c 'import sys,json;print(json.load(sys.stdin)["build"])')
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey gate-277 \
  --expected-build "$DEPLOYED" \
  --scenario-prefix gate277 \
  --out Docs/v5/v5-gate-277-evidence.md
```

### Phase 3 — `p0-full-golden` (after both #278 and #277 live-accepted)

```bash
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --journey p0-full-golden \
  --expected-build "$DEPLOYED" \
  --scenario-prefix p0-full \
  --included-prs "276:...,278:...,277:..." --excluded-prs "270,271,272,273,275,259,264" \
  --out Docs/v5/v5-golden-journey-full.md
```

## Pass / fail criteria (summary)

- **Draft / run_analysis / explain / rerun / reload-rerun:** 200, no error
  envelope, no forbidden prose; run/rerun/reload steps additionally assert the
  **DGAI** `analysis_result` block (`leading_option_id` + ≥2 win-probabilities).
- **Add option (#278 Gate 1):** cappable add is acknowledged (no defer); the
  following `run_analysis` returns 200 (a failed encode would surface as a
  `options_not_configured` 500 caught by the rerun step).
- **Edit existing option intervention (#278 Gate 2 — CONTAINMENT-PASS):**
  PASS iff safely contained (defer/clarify with graph unchanged, **or** a clean
  apply that references the option) and **no leak**. FAIL iff misapplied as a
  factor-value update, an unverifiable apply claim, or a value-parse leak
  (“You gave unknown”). The strict apply→rerun→200 path is **recorded
  separately as “not exercised / known routing limitation”** and does **not**
  colour the verdict.
- **what_would_flip fresh (#277):** deterministic dispatch (when `_timings`
  present: `handler_id=what_would_flip`, `llm_calls=0`), non-empty
  blocks-or-actions, no “no-tipping-point ↔ could-flip” contradiction.
- **what_would_flip stale (#277):** steers to RERUN, no executable stale flip chip.
- **Leak-safety (public surfaces only):** assistant_text + chips + DGAI summary
  in every mode; **public `analysis_result.enrichment` carriers**
  (`[REDACTED]`, `isl_engine`, `seed`, `_meta`/`meta`, `m1_coaching`, …) only in
  the flip modes (`gate-277` / `p0-full-golden`) — #277 is what cleans them, so
  the partial spine does NOT gate on enrichment carriers.
- **Latency:** capture-and-report baseline (per-step wall-clock + server
  `_timings` when enabled). Not a hard gate.

## Data captured per run

Build SHA (`/healthz`) + `--expected-build`; included/excluded PR metadata;
scenario id; per-step request id (`X-Request-Id`), wall-clock latency + server
`_timings`; response snippets (`assistant_text`); DGAI result-state summary;
leak findings. See the evidence pack’s **Run metadata** and **Per-step capture**
sections.

## Optional Supabase corroboration (persist/reload + Gate 3 graph-unchanged)

For hard proof that the persisted graph carries the canonical top-level
intervention (or is unchanged on defer), read via Supabase MCP (project
`etmmuzwxtcjipwphdola`): `scenarios`, `v5_handler_facts`, `v5_conversation_turns`.
**Clean up test rows afterwards** (delete by `scenario_id`) so the store is
restored exactly — baseline ≈ 285 intercept nodes / 686 facts.

## Exit codes

`0` all passed · `1` some steps failed · `2` fatal harness error · `3`
auth/preflight blocker or deploy-gate halt (build mismatch / degraded /
unreachable).
