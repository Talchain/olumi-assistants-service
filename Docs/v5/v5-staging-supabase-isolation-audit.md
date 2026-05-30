# V5 Staging — Supabase Isolation Audit (read-only)

**Date:** 2026-05-30
**Author:** Paul (Claude Code, read-only audit)
**Branch:** `audit/v5-staging-supabase-isolation` (off `origin/staging` @ `638ecbe9`)
**Goal:** Before running V5 runtime traces, replay, or manual test data, determine whether
CEE / V5 **staging** traffic writes to the **production** Supabase project.
**Method:** Read-only only. The Supabase connector was used **solely** for project/org listing
(`list_organizations`, `list_projects`). No application data, table rows, schema, migrations, or
timestamps were queried. No product journeys were run. No writes, no env/code changes. Secrets
are masked (project refs — which are identifiers, not secrets — are shown; keys, JWTs, passwords
and connection-string credentials are shown as `<present, masked>`).

---

## 1. Verdict

### `unknown-needs-admin-verification`

Not `safe`. Not `unsafe`. The evidence is insufficient to prove either, and we do not overclaim.

---

## 2. Core finding (what this audit *does* prove)

This audit **does not prove "staging writes to production".** It proves something more precise —
and more important:

1. **Supabase project selection depends entirely on the live environment binding** — chiefly
   `SUPABASE_URL`, together with `SUPABASE_SERVICE_ROLE_KEY` (and `DATABASE_URL`/`DB_PASSWORD`
   where used). There is no other input.
2. **The repo cannot prove which project Render staging is actually bound to.** Neither
   `render.yaml` nor `render-staging.yaml` declares any Supabase variable; the live value is set
   by hand in the Render dashboard and is invisible to the repository.
3. **`NODE_ENV=production` cannot distinguish staging from production**, because both Render
   services set `NODE_ENV=production`. Any in-process `isProduction()` check therefore behaves
   identically on both.
4. **No isolation guard exists.** No schema prefix, no namespace/environment column on writes,
   no environment guard, no project-ref assertion, and no service-level fail-fast check was found
   that would prevent staging from writing to the wrong Supabase project.
5. **Therefore, whichever Supabase project Render injects via `SUPABASE_URL` is where persistent
   turn data lands** — `v5_conversation_turns` and `v5_handler_facts`, written through the
   `append_turn_atomic` RPC.

**That structural absence of a guard is the risk.** Isolation today rests on a dashboard
convention, not an enforced contract.

---

## 3. The project-ref contradiction (recorded cleanly, not resolved)

- Supabase project ref **`etmmuzwxtcjipwphdola`** is the ref referenced by repo, config, and
  local staging evidence (docs, migration/verify scripts, and the local gitignored
  `.env.staging.local`). Every in-repo signal **labels it "staging" ("Olumi", us-east-1).**
- A **prior tracker** called **`etmmuzwxtcjipwphdola`** the **production** project that staging
  "may be writing to".
- The "Olumi" organisation **also contains another active project,
  `ewyskeampbmbagyclvfn` / "Olumi-EarlyAccess" (eu-west-2)**, which is **not referenced anywhere
  in the repo evidence** found by this audit.
- The existence of that second active project makes a **separate-project interpretation
  plausible** (staging on one project, real/pilot users on another) — **but it is not proven.**
  The unqualified name "Olumi" on `etmmuzwxtcjipwphdola` is equally consistent with it being
  production.

**Verdict therefore remains `unknown-needs-admin-verification`.** It is resolvable only by reading
the live Render (and DGAI) bindings — see §9.

> *Non-binding timeline note (inference only):* `etmmuzwxtcjipwphdola` was created 2025-02-02
> (potentially the original/only project at the time — a tracker from that era could correctly
> have called it production); `ewyskeampbmbagyclvfn` was created 2025-09-28 (potentially stood up
> as the early-access/production user project, demoting "Olumi" to staging). Consistent with the
> repo evidence, but unconfirmed; the prior tracker may instead still be accurate.

---

## 4. Supabase projects in the "Olumi" organisation (`sspfayxnifgdykzjxrkg`)

| Ref | Name | Region | Status | PG | Created | Referenced in repo? |
|---|---|---|---|---|---|---|
| `etmmuzwxtcjipwphdola` | Olumi | us-east-1 | ACTIVE_HEALTHY | 15 | 2025-02-02 | yes (docs + scripts + local env) |
| `ewyskeampbmbagyclvfn` | Olumi-EarlyAccess | eu-west-2 | ACTIVE_HEALTHY | 17 | 2025-09-28 | **no — never referenced** |
| `vaslbdceyqwcgzjlftgi` | sb1-8t1bpc | us-east-1 | INACTIVE | 15 | 2025-01-25 | no (dormant/scaffold) |

---

## 5. Evidence table

| Source | Location / command | Variable | Observed (masked) | == `etmmuzwxtcjipwphdola`? | Interpretation |
|---|---|---|---|---|---|
| Supabase connector | `list_organizations` | — | org "Olumi" (`sspfayxnifgdykzjxrkg`) | n/a | Single org owns all projects |
| Supabase connector | `list_projects` | — | `etmmuzwxtcjipwphdola` "Olumi" us-east-1 ACTIVE | **YES** | Ref the repo points staging at |
| Supabase connector | `list_projects` | — | `ewyskeampbmbagyclvfn` "Olumi-EarlyAccess" eu-west-2 ACTIVE | no | Separate active project; prod-shaped; unreferenced in repo |
| Supabase connector | `list_projects` | — | `vaslbdceyqwcgzjlftgi` "sb1-8t1bpc" INACTIVE | no | Dormant/scaffold |
| Runtime config | `src/config/index.ts:1003-1004` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | read from env; no baked default | n/a | Target chosen purely by env at runtime |
| Config helper | `src/config/index.ts:1190-1192` | `isProduction()` | `nodeEnv === "production"` | n/a | Only env signal is NODE_ENV |
| V5 session store | `src/orchestrator-v5/session/index.ts:48,69-79` | `process.env.SUPABASE_URL` / `…SERVICE_ROLE_KEY` | call-time read; throws if unset; **no env branch** | n/a | No NODE_ENV/APP_ENV guard around the client |
| Prompt store | `src/prompts/stores/supabase.ts:156` | `config.url` / `config.serviceRoleKey` | env-fed `createClient` | n/a | Same env-derived target |
| Draft-failures store | `src/cee/draft-failures/store.ts:38-49` | `config.prompts.supabaseUrl` / `…ServiceRoleKey` | env-fed `createClient` | n/a | Same env-derived target |
| Draft-failures store | `src/cee/draft-failures/store.ts:207-217` | `isProduction()` | gates 7-day retention cleanup only | n/a | **Not** a project-selection guard |
| Staging deploy manifest | `render-staging.yaml` (whole file) | — | `NODE_ENV=production`; **no** SUPABASE_*/DATABASE_URL | n/a | Live staging binding NOT in repo — dashboard-managed |
| Prod deploy manifest | `render.yaml` (whole file) | — | `NODE_ENV=production`; **no** SUPABASE_*/DATABASE_URL | n/a | Live prod binding NOT in repo — dashboard-managed |
| Ops docs | `Docs/operations/render-{deploy,setup}.md` | — | list OPENAI/ANTHROPIC/ENGINE_BASE_URL only; no Supabase | n/a | Docs predate V5 persistence; no Supabase guidance |
| Local env (gitignored) | `.env.staging.local:1` (Paul's machine) | `SUPABASE_URL` | `https://etmmuzwxtcjipwphdola.supabase.co` | **YES** | Local "staging" creds resolve to the suspect ref |
| Local env (gitignored) | `.env.staging.local` | `SUPABASE_SERVICE_ROLE_KEY`, `DB_PASSWORD` | `<present, masked>` | — | Service-role key + DB password present (not shown) |
| Script fallback | `scripts/run-sql-migration.ts:10` | conn string | `postgres.etmmuzwxtcjipwphdola@…pooler…:6543` (pwd `<masked>`) | **YES** | Migration script defaults to suspect ref |
| Script fallback | `scripts/test-supabase-migration.ts:8` | `SUPABASE_URL` default | `https://etmmuzwxtcjipwphdola.supabase.co` | **YES** | Default when env unset |
| Script fallback | `scripts/verify-schema.ts:4` | `SUPABASE_URL` default | `https://etmmuzwxtcjipwphdola.supabase.co` | **YES** | Default when env unset |
| Doc | `Docs/cee-comprehensive-audit-2026-04-11.md:19,663` | `SUPABASE_URL` | `https://etmmuzwxtcjipwphdola.supabase.co` "Database endpoint" | **YES** | Labels it the staging DB endpoint |
| Doc | `Docs/v5/v5-baseline-evidence.md:429` | — | "staging project `etmmuzwxtcjipwphdola` (Olumi, us-east-1)" | **YES** | V5 baseline evidence read from it as "staging" |
| Doc | `Docs/v5/v5-explain-handler-diagnosis.md:44` | — | "Project Olumi (`etmmuzwxtcjipwphdola`, schema public)" | **YES** | Same |
| Doc | `Docs/v5/overnight-chat-2-summary.md:66` | — | RPC latency "against `etmmuzwxtcjipwphdola.supabase.co`" | **YES** | Integration tests ran against it |
| Health endpoint | `/healthz` (`src/server.ts`) | — | returns `build` SHA, `version`, `provider`, `prompts_ready`; **no** Supabase ref | n/a | No safe live-ref readout via health |
| Startup logging | server boot summary | — | logs service/version/provider/engine_url/timeouts; **no** Supabase URL | n/a | Render logs won't reveal the live ref at boot |
| Replay harness | `tools/v5-journey-replay/` | `--base-url`, `OLUMI_REPLAY_API_KEY` | targets `https://cee-staging.onrender.com`; POSTs `/orchestrate/v2/turn` | n/a | Persists turns to whatever the staging `SUPABASE_URL` is |
| Prior tracker | (referenced in workstream brief; not in repo) | — | `etmmuzwxtcjipwphdola` flagged **PRODUCTION** | **YES** | Direct contradiction with repo's "staging" labelling |

### Structural notes
- **One env, one target.** All three Supabase clients
  (`prompts/stores/supabase.ts:156`, `orchestrator-v5/session/index.ts:48`,
  `cee/draft-failures/store.ts:49`) write to whatever `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  resolve to at runtime.
- **No discriminator.** `isProduction()` is `nodeEnv === "production"` and `render-staging.yaml`
  sets `NODE_ENV=production`, so it returns `true` on staging too. The only thing distinguishing
  the two services' data destination is the injected `SUPABASE_URL`/key.

---

## 6. Affected services

| Service | Supabase binding source | Verifiable from repo? | Note |
|---|---|---|---|
| **CEE staging** (`olumi-assistants-staging`, branch `staging`, `cee-staging.onrender.com`) | Render dashboard env | **No** | Repo/local evidence → *likely* `etmmuzwxtcjipwphdola`, **unconfirmed** |
| **CEE production** (`olumi-assistants-service`) | Render dashboard env | **No** | Unknown from repo; needed to compare against staging |
| **DGAI staging** (separate frontend/backend; `staging--olumi.netlify.app` in CORS allow-lists) | DGAI's own hosting/config | **No** | Not present in this repo; must be checked in DGAI's env |
| **DGAI production** | DGAI's own hosting/config | **No** | Not present in this repo; must be checked in DGAI's env |

---

## 7. Risk assessment

| Activity | Persists to Supabase? | Risk until binding confirmed |
|---|---|---|
| Cheap manual smoke — stateless endpoints (`/healthz`, `/assist/clarify-brief`, `/assist/critique-graph`) | No | **Low** — no scenario/turn persistence |
| Runtime trace — V5 turns via `/orchestrate/v2/turn` | **Yes** (`v5_conversation_turns`, `v5_handler_facts`) | **Moderate–High** — could land in a production project |
| Replay harness (`tools/v5-journey-replay/` → `cee-staging.onrender.com`) | **Yes** (same path) | **Moderate–High** — same as above |
| Production data safety | — | **Cannot be guaranteed** until the live staging `SUPABASE_URL` and DGAI's binding are confirmed distinct from the real/pilot-user project |

---

## 8. Runtime gate (practical consequence)

**Until Paul verifies the live Render/DGAI bindings (§9), do not run turn-persisting staging
traces or replay.** Any path that creates or mutates scenarios/turns/facts could write into the
wrong Supabase project.

**Blocked until admin verification:**
- `/orchestrate/v2/turn` traces;
- the bundled staging trace;
- the small post-draft copy-source trace **if it creates turns**;
- the direction-honesty runtime proof **if it creates turns**;
- the replay harness;
- any manual test that creates or mutates scenarios / turns / handler facts.

**Still allowed:**
- stateless `/healthz`;
- non-persisting config checks;
- repo / static audits;
- dashboard / admin verification;
- cheap browser smoke **only if** it does not create or persist test data.

---

## 9. Exact admin verification questions

Paul must answer these before any turn-persisting runtime trace:

1. **In Render CEE staging** (`olumi-assistants-staging`), what project ref is present in
   `SUPABASE_URL`?
2. **In Render CEE production** (`olumi-assistants-service`), what project ref is present in
   `SUPABASE_URL`?
3. **In DGAI staging**, what backend / Supabase / CEE target is configured for V5 traffic?
4. **In DGAI production**, what backend / Supabase / CEE target is configured for V5 traffic?
5. **Which Supabase project is intended to hold real / pilot user data** —
   `etmmuzwxtcjipwphdola`, `ewyskeampbmbagyclvfn`, or another project?

**Also confirm:** do any **service-role** or **database-URL** variables
(`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) point to a **different project ref** from
`SUPABASE_URL` on the same service? (A mismatch would itself be a hazard.)

**Interpretation of answers**
- **Safe** = CEE staging's `SUPABASE_URL` ref is **distinct** from the project holding real/pilot
  user data (i.e. staging on a dedicated project), and DGAI staging agrees.
- **Unsafe** = CEE staging's (or DGAI staging's) `SUPABASE_URL` ref **equals** the real/pilot-user
  project — whichever ref that turns out to be.

---

## 10. Defence-in-depth follow-up (future implementation item — **not implemented here**)

This is a small, future implementation item to record now. **Do not implement it in this audit
branch.** Its purpose is to turn "staging does not write to production" from a dashboard
convention into an **enforced contract**:

- Introduce an explicit, **non-secret** env such as `SUPABASE_PROJECT_REF` (or equivalent) naming
  the expected project ref per service/environment.
- At Supabase/session-store initialisation, **fail-fast** if the project ref resolved from
  `SUPABASE_URL` does not match the expected ref for that environment.
- Emit telemetry/logging with the **masked** project ref on startup, so the binding is observable.
- **Do not rely on `NODE_ENV` alone** (it is `production` on both services and cannot discriminate).

---

## 11. Does `etmmuzwxtcjipwphdola` appear in staging config?

**Yes.** In `origin/staging` it appears in four docs and three migration/verify script fallbacks,
and in Paul's local gitignored `.env.staging.local`. It does **not** appear in runtime `src/`
code or in either Render manifest. The **live deployed binding is dashboard-only and therefore
unverified by this read-only audit.**

---

## 12. Scope & safety (this audit)

- Read-only; **one** report file created; no Supabase data queried; no table/schema/migration
  probes; no product journeys; no data mutation; no env changes; no code changes; no tests run;
  no prompts/PMS changes; no deploy; no push; no PR; no merge.
- Secrets masked throughout; only project/org identifiers and variable **names** are shown.
