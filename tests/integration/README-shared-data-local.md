# Shared-data local experiment

This runs the production session store, SQL RPCs, Run handler, canonical edit door,
AI readers and cold read against disposable local PostgreSQL/PostgREST. It never
loads shared Supabase configuration. The UI bridge consumes the resulting read
bytes through the real turn/read applicators and goal chooser.

Start from the `exp/shared-data-spine-20260929` candidate with its pinned schema
installed. One heavy job at a time; use focused specs under the repository load guard.

```sh
node scripts/dev/shared-data-db.mjs
```

The runner uses the installed Docker daemon, `postgres:17` and
`postgrest/postgrest:v12.2.3`. Only experiment-labelled containers are created:
PostgreSQL on 127.0.0.1:55432, PostgREST on 55433 and the `/rest/v1` transport on
55431. Credentials are generated locally and stored with mode 0600 under
`~/.codex/workspaces/shared-data-spine-local/connection.json`; do not publish it.

In another terminal:

```sh
RUN_SHARED_DATA_LOCAL=1 SHARED_DATA_RECEIPT_PATH=/private/tmp/shared-data-run-receipt.json \
  pnpm vitest run tests/integration/shared-data-run-lifecycle.local.test.ts --maxWorkers=1
```

This defaults to a captured PLoT reply to isolate persistence. For real computation,
also set `SHARED_DATA_LIVE_PLOT=1` and `SHARED_DATA_PLOT_ENV` to an existing local
environment file. Only `PLOT_BASE_URL` and `PLOT_AUTH_TOKEN` are read from that file.
The data target remains the local database. Use a separate receipt filename to keep
captured and live evidence distinct.

In the corresponding UI experimental checkout:

```sh
SHARED_DATA_RECEIPT_PATH=/private/tmp/shared-data-run-receipt.json \
  pnpm vitest run src/canvas/state/__tests__/sharedDataDatabaseReceipt.spec.ts --maxWorkers=1
```

Observed on 29 September: the live lifecycle passed with PLoT staging build
`ea593a2`, including a value edit, one version/fact, replay refusal, stale concurrent
write refusal and cold rerun retention. The adoption row passed against the real
database with captured computation: valid card removes only the proposal marker,
one version/fact, old Run stale, replay refused, rerun current. Tests delete only
their generated scenario and cascading fixture rows.

Limits: the baseline scenario table predates this repo's migrations and follows
`README-c4-local-db.md`. The runner applies 31 repository migrations and skips the
two legacy sharing/observation migrations named in its migration record. It supplies
the local Supabase service-role grants and an `auth.uid()` JWT-claims reader. This
is not a full GoTrue/storage stack or proof of browser authentication. A direct
in-process writer test starts after route authorization. AI summary narration has
no provider credentials here and uses its existing fallback. Browser, authorization
and narration quality require their own real entry paths.

## Local HTTP and browser path

```sh
env -u ANTHROPIC_API_KEY pnpm exec tsx scripts/dev/shared-data-api.mjs --port 8791
# In the corresponding UI checkout:
node scripts/shared-data-ui.mjs
# Back in CEE, register an owned model for the browser:
node scripts/dev/shared-data-seed.mjs
```

The API boots the real server, Agent route, ownership checks and graph CAS, with
both CORS and the proxy limited to `http://127.0.0.1:5178`. Existing OpenAI and PLoT
credentials are allowlisted from local files; shared Supabase values are discarded.
The API and PostgREST verify the same local ES256 test-user token. Service access
retains its separate HMAC token. No anonymous grants or ownership bypass are added.
This verifies the token/ownership path, not an email or OAuth sign-in flow.

Load the private `browser-auth.json` in a fresh Playwright browser, then open the
seed script's `/#/scenario/...` URL. That file contains only the local SDK session:
no model, report or conversation is preloaded. The UI wrapper enables the existing
manual-edit dispatcher and V5 analysis path; the legacy direct-run path is off.
Vite uses a private cache even when the checkout shares installed dependencies.

`shared-data-turn.mjs` sends one real Agent turn and captures a subsequent cold
read. `--read-only --label <name>` captures a read without an Agent call. Evidence
is written to the private experiment directory without request credentials.
The live API uses code-default prompts because the local prompt store is absent;
its narration must not be described as staging-identical or an AI quality pass.

Stop the transport with Ctrl-C, then `node scripts/dev/shared-data-db.mjs stop`.
Only the two experiment containers stop; their local data is retained for reuse.
Rollback code by returning to DL base `0f9db88d`; shared deployments are unchanged.
