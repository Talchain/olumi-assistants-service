# Supabase security model

**Last updated:** 26 February 2026

## Access control approach

This project uses **RLS-first security** — the standard Supabase model:

- **Table grants are broad** (Supabase defaults). Both `anon` and `authenticated` roles have DML privileges on public-schema tables. This is required for PostgREST to function.
- **Row Level Security (RLS) is the actual access control layer.** Every table with user data has RLS enabled and restrictive policies that filter on `auth.uid()`.
- **RPCs use SECURITY DEFINER** with pinned `search_path = pg_catalog, public` for operations that require cross-row logic, atomic state+event writes, or public access patterns that bypass RLS.

This is consistent across all tables in the project. No tables use an "RPC-only" model (where table-level grants are revoked).

## Function execution grants

All PostgreSQL functions default to `EXECUTE` granted to `PUBLIC`. This project explicitly manages function grants:

- **Mutating RPCs:** `EXECUTE` granted to `authenticated` only. Revoked from both `PUBLIC` and `anon`.
- **Read-only public RPCs** (e.g., `get_shared_brief_by_slug`): `EXECUTE` granted to `anon` and `authenticated`. Revoked from `PUBLIC` (then explicitly re-granted to the two named roles for clarity).

This prevents unintended access via the `PUBLIC` pseudo-role inheritance chain.

## Scenario persistence tables

### `scenarios`

| Policy | Operation | Rule |
|---|---|---|
| Users can read own scenarios | SELECT | `auth.uid() = user_id` |
| Users can insert own scenarios | INSERT | `auth.uid() = user_id` |
| Users can update own scenarios | UPDATE | `auth.uid() = user_id` (USING + WITH CHECK) |
| Users can delete own scenarios | DELETE | `auth.uid() = user_id` |

Anonymous access: `auth.uid()` returns NULL for unauthenticated requests, so zero rows match any policy. No anonymous reads or writes are possible.

### `shared_briefs`

| Policy | Operation | Rule |
|---|---|---|
| Users can read own shared briefs | SELECT | `auth.uid() = user_id` |

No INSERT, UPDATE, or DELETE policies exist. Direct writes are impossible even for authenticated users — brief creation goes through the `create_shared_brief` RPC (SECURITY DEFINER), which performs ownership verification and generates the slug server-side.

Public read access to shared briefs is via `get_shared_brief_by_slug` RPC only (SECURITY DEFINER, bypasses RLS, returns safe fields only — no `user_id` or `scenario_id`).

## RPCs

| Function | Auth | Purpose |
|---|---|---|
| `append_scenario_event` | authenticated | Core event append with idempotency |
| `apply_patch_and_log` | authenticated | Atomic graph update + event |
| `store_analysis_and_log` | authenticated | Atomic analysis + provenance + event |
| `store_analysis_failure` | authenticated | Atomic analysis failure + event |
| `store_brief_and_log` | authenticated | Atomic brief storage + event |
| `set_stage_and_log` | authenticated | Atomic stage transition + event |
| `create_shared_brief` | authenticated | Ownership-verified brief sharing (slug server-generated) |
| `get_shared_brief_by_slug` | anon + authenticated | Public read-only brief access by unguessable slug |

All RPCs: `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, explicit `auth.uid()` ownership checks in function body.

## Why not revoke table-level grants?

Revoking DML from `anon`/`authenticated` at the table level would create an "RPC-only" model. We deliberately chose not to do this because:

1. **Consistency:** Every other table in this Supabase project uses the default broad-grant + RLS model. Making two tables an exception creates confusion.
2. **PostgREST compatibility:** The UI service layer uses direct `UPDATE` for high-frequency fields (graph, framing, title) via PostgREST. Revoking table grants would break these paths.
3. **Defence in depth:** RLS policies are the correct and sufficient access control layer. Table grants without matching RLS policies grant no actual access.

If the project moves to a stricter security posture post-pilot (e.g., for enterprise requirements), table-level grant revocation can be added per-table with a follow-up migration.
