# Security / data-floor status register

**Date:** 2026-07-02 · **Verified against:** `origin/staging` @ `475922b300`, live GitHub PR
state re-checked today. Read-only consolidation — no probing beyond repo + PR metadata.

| Item | Status | Owner / decision gap |
|---|---|---|
| S1 Credentials | ✅ LOW risk — no action | none |
| S2 RLS-disabled table | ⏸ PR #253 open, required checks green, 22 days stale | **Paul: review + merge (likely refresh first)** |
| S3 Second Supabase project / staging-prod isolation | ⏸ blocked on admin verification | **Paul + admin dashboard: REQUIRED decision** |
| S4 Dependency vulnerability backlog | ⏸ 20 dependabot PRs open | **Paul: merge order below** |

## S1 — Credentials (verdict: LOW, evidence)

- `.env` / `.env.local` / `.env.*.local` gitignored (`.gitignore`); `.env.example` contains
  placeholder structure only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ASSIST_API_KEYS`,
  `HMAC_SECRET`, `SHARE_SECRET`, `ADMIN_API_KEY`, `BRAINTRUST_API_KEY` — all empty).
- Docs reference Supabase **project refs** (identifiers, not secrets); no real-looking keys,
  service-role tokens or passwords found in committed code or `Docs/` during this sweep.
- No action needed; keep `.env.staging.local` machine-local as today.

## S2 — RLS hardening (PR #253)

- [PR #253](https://github.com/Talchain/olumi-assistants-service/pull/253)
  `fix/v5-db-security-tier1`: revoke anon `TRUNCATE` + legacy RPC `EXECUTE`, **enable RLS on
  `cee_prompt_observations`** (the actual RLS-disabled table).
- Clarification vs earlier framing: the V5 tables (`v5_conversation_turns`, `v5_handler_facts`)
  already have RLS ENABLED (SELECT-only policies; writes only via the SECURITY DEFINER
  `append_turn_atomic` RPC) — audit `Docs/v5/v5-staging-supabase-isolation-audit.md` §4 (on
  branch `audit/v5-staging-supabase-isolation`).
- Live status (re-checked 2026-07-02): required checks SUCCESS; the three reds are the known
  inherited advisory baseline (Full Test Suite advisory / Integration Tests advisory / Security
  Audit — see `reference_ci_rehab` inventory). Last updated 2026-06-10 → **22 days stale against
  a fast-moving staging; recommend re-baselining the branch (or at least confirming clean merge)
  before landing.**
- **Decision gap:** Paul to review + merge. Migration content should be re-checked against any
  migrations landed since 2026-06-10.

## S3 — Second Supabase project / staging-prod isolation (decision REQUIRED)

- Verdict standing since 2026-05-30: `unknown-needs-admin-verification`
  (`Docs/v5/v5-staging-supabase-isolation-audit.md`). The audit proves **structural absence of
  isolation guards** (no schema prefix, no environment column, no fail-fast project-ref
  assertion, both Render services run `NODE_ENV=production`) — isolation rests on dashboard
  convention only.
- Contradiction unresolved: `etmmuzwxtcjipwphdola` is called "staging" in docs/scripts but was
  previously tracked as "production". A second active project
  `ewyskeampbmbagyclvfn` ("Olumi-EarlyAccess", eu-west-2, created 2025-09-28) has **zero repo
  references** — plausibly the real production/user project, undocumented.
- **Admin checklist (audit §9) — must be answered from the Render + Supabase dashboards:**
  1. Render CEE staging `SUPABASE_URL` → which project ref?
  2. Render CEE production `SUPABASE_URL` → which project ref?
  3. DGAI staging backend/Supabase target?
  4. DGAI production backend/Supabase target?
  5. Which project holds real/pilot user data?
  6. Any service-role/database-URL vars pointing at a *different* ref than `SUPABASE_URL`?
- Standing runtime gate: turn-persisting traces remain blocked until (1) and (2) are verified
  distinct. **No code work is possible on this item — it is purely an admin verification + a
  Paul decision (adopt/document the second project, or consolidate).**

## S4 — Dependency vulnerability backlog (20 open dependabot PRs)

CI posture: Snyk fails at **high+**; GitHub Dependency Review fails at **moderate** on PRs;
`pnpm audit` (Security Audit job) is an **inherited advisory red** on staging. `pnpm.overrides`
already pin the known advisory families (fast-uri, undici, lodash, ajv, minimatch,
brace-expansion, protobufjs, vite).

Recommended merge order (safe → decision-needed):

1. **CI-only, low risk (merge first):** #56 setup-node 3→6, #57 codecov 3→5, #58
   upload-artifact 4→5, #59 comment-pr action 2→3, #60 pnpm/action-setup 2→4. Note: workflows
   currently use `pnpm/action-setup@v4` + `actions/upload-artifact@v4` — #58/#60 should be
   checked against every workflow file (including the new golden-journey-replay.yml) for
   version consistency.
2. **Patch/minor prod deps (low risk):** #118 undici 6.22→6.23, #122 lodash 4.17.21→4.17.23,
   #125 fastify 5.6.2→5.7.3, #131 minimatch 3.1.2→3.1.5, #132 rollup 4.53→4.59 (dev/build),
   #128 ajv 6.12.6→6.14.0 (transitive-facing).
3. **Grouped updates (review the manifest):** #126 production-dependencies group (8 updates),
   #127 development-dependencies group (11 updates) — groups can hide a risky member; read the
   diff list before merging.
4. **Major bumps — each needs its own assessment, do NOT batch:**
   - **#64 zod 3.25.76 → 4.1.13 — HIGHEST RISK.** Zod is the contract layer; the vendored
     `@talchain/schemas` 0.13.0 is built against zod v3 introspection APIs (`.shape`, `_def`,
     `innerType()` — also used by the new egress pin test). A zod v4 bump is a
     cross-repo/schemas-package project, not a dependabot merge. Recommend: close/snooze until
     the schemas package migrates.
   - #68 undici 6→7 (supersedes #118 if taken; check fetch/dispatcher API changes).
   - #65 pino 9→10, #63 @fastify/cors 10→11, #67 pdf-parse 1.1.4→2.4.5, #66 @types/node 20→24
     (dev; may surface new type errors — run full typecheck).
- **Decision gap:** Paul to confirm the order and whether tier-1/2 merges can proceed as a batch;
  tier-4 items each need a dedicated check.

## Standing advisory-red context

`Full Test Suite (advisory)`, `Integration Tests (advisory)` and `Security Audit` are inherited
baseline reds on staging (predate current PRs). For any PR, prove identical-to-base rather than
treating them as PR-caused. Getting these lanes green is a separate CI-rehab workstream, not part
of this register.
