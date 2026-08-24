# C4 canonical-state fixtures — local database recipe

`c4-canonical-state-restore.contract.test.ts` runs against a **real Postgres**.
It has to: no plpgsql executes in `test:required`, SQL is otherwise asserted
only by regex-over-file static guards, and **a regex cannot observe a
transaction boundary**. A TypeScript-only version would prove things about
TypeScript and nothing about atomicity.

> ⚠ **Local container only. Never staging.** The suite installs and drops
> failure-injection TRIGGERS, which is a schema mutation. Every object it
> creates is prefixed `c4acc_` and every scenario it writes carries its
> `RUN_ID` in `brief_text`, but the correct answer is a throwaway container.

## 1. Start Postgres

```bash
docker run -d --name c4pg \
  -e POSTGRES_PASSWORD=c4test -e POSTGRES_DB=cee \
  -p 55432:5432 postgres:15
```

`supabase start` would also work but needs a `supabase/config.toml` this repo
does not have, and `supabase init` would add files to the tree. Plain Postgres
plus the repo's own migrations is less invasive and equally faithful.

## 2. Apply the prerequisites

⚠ **`scenarios` is NOT created by any migration in `supabase/migrations/`** —
the earliest file there (`20260226010000`) *hardens* a table it assumes exists.
The baseline predates the directory. These are the columns the tracked
migrations reference but never `ADD`, derived by sweeping the migration corpus:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE IF NOT EXISTS public.scenarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NULL,
  workspace_id UUID NULL,
  brief        JSONB NULL,
  graph        JSONB NULL,
  events       JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_seq    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.scenarios TO service_role;
```

**This baseline is a RECONSTRUCTION, not a repo artefact.** The migrations
applied on top of it are the repo's real files; the table underneath them is
inferred. If the fixtures ever disagree with staging, suspect this first.

## 3. Apply the migrations

```bash
docker cp supabase/migrations c4pg:/tmp/migrations
for f in $(ls supabase/migrations/*.sql | sort); do
  docker exec c4pg psql -U postgres -d cee -v ON_ERROR_STOP=1 -q \
    -f "/tmp/migrations/$(basename "$f")" || echo "FAILED $(basename "$f")"
done
```

**26 of 28 apply.** The two that fail depend on other tables that, like
`scenarios`, predate this directory — and neither is on the canonical-state
path:

| migration | missing table | relevant to C4? |
|---|---|---|
| `20260226010000_scenario_schema_v2_0_1_hardening` | `shared_briefs` | no — brief sharing |
| `20260610120000_v5_db_security_tier1_hardening` | `turn_observations` | no — telemetry RLS |

Confirm the carrier compiled:

```bash
docker exec c4pg psql -U postgres -d cee -tAc \
  "select proname from pg_proc where proname='restore_model_version_atomic';"
```

## 4. Run

```bash
RUN_C4_CANONICAL_STATE=1 \
DATABASE_URL='postgres://postgres:c4test@localhost:55432/cee' \
  pnpm vitest run tests/integration/c4-canonical-state-restore.contract.test.ts
```

Without those two variables the suite **skips** (23 skipped) and never touches
a database.

## 5. Reproduce the discriminating mutant pair

The pins are only worth what their discrimination is worth. To re-prove they
bite, replace the function body in the local DB and re-run:

- **M1 — break atomicity.** Wrap the `append_turn_atomic_v4` call and the
  post-write assertion in `BEGIN … EXCEPTION WHEN OTHERS THEN NULL; END;`.
  The version rows commit while the graph write rolls back — `RESTORE_INCOMPLETE`
  reintroduced. Expected: **P2 and D2 RED**, S2b green.
- **M2 — break the re-projection property.** In the restore-row `INSERT`,
  swap `p_graph, p_graph_identity_hash` for `v_target.graph,
  v_target.graph_identity_hash` (the byte-copy the pre-existing
  `restore_model_version` does). Expected: **S2b RED**, P2 and D2 green.

Each pin must bite **its own** property and not the other's. Verify the mutant
actually landed before trusting a result — an unapplied mutation is
indistinguishable from an equivalent one:

```bash
docker exec c4pg psql -U postgres -d cee -tAc \
  "select md5(prosrc) from pg_proc where proname='restore_model_version_atomic';"
```

Measured on 2026-08-24: original `ea051410…` 23/23 green · M1 `e58df930…`
P2+D2 red · M2 `641cca4c…` S2b red · original restored, green again.

## 6. Tear down

```bash
docker rm -f c4pg
```
