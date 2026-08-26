# C4 canonical-state fixtures — local database recipe

`c4-canonical-state-restore.contract.test.ts` runs against a **real Postgres**.
It has to: no plpgsql executes in `test:required`, SQL is otherwise asserted
only by regex-over-file static guards, and **a regex cannot observe a
transaction boundary**. A TypeScript-only version would prove things about
TypeScript and nothing about atomicity.

**Carriers under test:** `restore_model_version_atomic_v1` and
`append_turn_atomic_v5`, from
`supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql`.

> ⚠ **CORRECTED 2026-08-26.** This said the migration was *"not on this branch —
> this branch carries fixtures only. Fetch it to run them."* **It is on this
> branch**, and has been since the C8-A integration; there is nothing to fetch,
> and §3's `git show origin/codex/c8-a-integration:…` step below is redundant —
> apply the file from your own checkout. Stale on the one point a reader opens
> this file to settle, which is how someone ends up running the suite against a
> database missing the very functions it asserts.
>
> The migration is **founder-gated and NOT applied to staging**. Applying it to
> a throwaway local container, which is all this recipe does, is unrelated to
> that gate.

> ⚠ **Local container only. Never staging.** The suite installs and drops
> failure-injection triggers and a control table, which is a schema mutation.
> Everything it creates is prefixed `c4acc_` and every scenario carries its
> `RUN_ID` in `brief_text`, but the correct answer is a throwaway container.

## 1. Start Postgres

```bash
docker run -d --name c4pg \
  -e POSTGRES_PASSWORD=c4test -e POSTGRES_DB=cee \
  -p 55432:5432 postgres:15
```

`supabase start` would also work but needs a `supabase/config.toml` this repo
does not have, and `supabase init` would add files to the tree.

## 2. Apply the prerequisites

⚠ **`scenarios` is NOT created by any migration in `supabase/migrations/`** —
the earliest file there (`20260226010000`) *hardens* a table it assumes exists.
These are the columns the tracked migrations reference but never `ADD`, derived
by sweeping the migration corpus:

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

**This baseline is a RECONSTRUCTION, not a repo artefact.** The migrations on
top of it are the repo's real files; the table underneath is inferred. If the
fixtures ever disagree with staging, suspect this first.

## 3. Apply the migrations

`20260824200000` is IN this loop — it is an ordinary tracked migration on this
branch. The separate `git show origin/codex/c8-a-integration:…` fetch this
section used to carry has been removed; it fetched a copy of a file already in
your checkout, and following it against a moved branch would apply a DIFFERENT
version of the migration than the one the suite asserts.

```bash
docker cp supabase/migrations c4pg:/tmp/migrations
for f in $(ls supabase/migrations/*.sql | sort); do
  docker exec c4pg psql -U postgres -d cee -v ON_ERROR_STOP=1 -q \
    -f "/tmp/migrations/$(basename "$f")" || echo "FAILED $(basename "$f")"
done
```

**26 of the 28 tracked migrations apply** (measured on Postgres 15.18). Two fail
on tables that, like `scenarios`, predate this directory — `shared_briefs`
(`20260226010000`) and `turn_observations` (`20260610120000`). Neither is on the
canonical-state path, and both failures are expected here.

The suite's first test asserts `restore_model_version_atomic_v1` is PRESENT and
**fails loud rather than skipping** — so if the loop above silently missed the
migration you get a named failure, not a vacuous pass.

### ⚠ Migration collision hazard — verify the column type, do not assume it

Codex's migration uses `ADD COLUMN IF NOT EXISTS mutation_id UUID`. **If any
other migration has already added a `mutation_id` column of a different type,
`IF NOT EXISTS` silently no-ops and the column keeps the earlier type** — after
which `restore_model_version_atomic_v1` fails on *every* call with
`operator does not exist: text = uuid`, from
`WHERE ... mutation_id = p_mutation_id`.

This is not hypothetical: it is exactly what happened when a superseded C4
migration adding `mutation_id TEXT` was present in the tree. Always check:

```bash
docker exec c4pg psql -U postgres -d cee -tAc \
  "select column_name, data_type from information_schema.columns
    where table_name='model_versions' and column_name='mutation_id';"
# must read: mutation_id|uuid
```

Then confirm the carrier compiled:

```bash
docker exec c4pg psql -U postgres -d cee -tAc \
  "select proname from pg_proc where proname='restore_model_version_atomic_v1';"
```

## 4. Run

```bash
RUN_C4_CANONICAL_STATE=1 \
DATABASE_URL='postgres://postgres:c4test@localhost:55432/cee' \
  pnpm vitest run tests/integration/c4-canonical-state-restore.contract.test.ts
```

Without those two variables the suite **skips** (28 skipped) and never touches
a database.

## 5. Reproduce the discriminating mutant pair

The pins are only worth what their discrimination is worth. Extract the
function from Codex's migration, mutate, re-apply, re-run:

- **M1 — break atomicity.** Wrap the single `UPDATE public.scenarios` in
  `BEGIN … EXCEPTION WHEN OTHERS THEN NULL; END;`. The version rows commit
  while the graph write rolls back. Expected: **P2 and D2 RED**, S2b green.
- **M2 — break the re-projection property.** In the restore-row `INSERT`, swap
  `p_graph, p_graph_identity_hash` for `v_target.graph,
  v_target.graph_identity_hash`. Expected: **S2b RED**, P2 and D2 green.

Each pin must bite **its own** property. Verify the mutant actually landed —
an unapplied mutation is indistinguishable from an equivalent one:

```bash
docker exec c4pg psql -U postgres -d cee -tAc \
  "select md5(prosrc) from pg_proc where proname='restore_model_version_atomic_v1';"
```

Measured against Codex's carrier, 2026-08-24: original `699ababd…` 28/28 green ·
M1 `76d80913…` P2+D2 red · M2 `e5fb1140…` S2b red · original restored, green.

## 6. Tear down

```bash
docker rm -f c4pg
```
