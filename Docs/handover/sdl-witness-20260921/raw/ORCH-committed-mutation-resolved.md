# The `committed_mutation` scarcity is resolved: zero suppression, zero second mutations

Measured read-only against the live Supabase project (one project serves staging + production),
**2026-09-21T22:48:16Z**. Session-pooler, `set transaction read only`.

## The discriminating result

| probe | result |
|---|---|
| OWNED scenarios created since 11 Sep, by count of turns carrying `model_version_mutation_id` | **625 scenarios with exactly 1. ZERO with 2 or more.** |
| OWNED turns since 1 Sep with a mutation id but `model_version_created = FALSE` (silent suppression) | **empty set — zero rows** |
| CONTRAST CONTROL: `initial` versions created per day, last 5 days | 5, 68, 73, 26, 9, **16 today** — the instrument works and versioning is live right now |

## What this settles

**Versioning is NOT regressed and nothing is being silently suppressed.** Every owned turn that
carries a mutation id created a version: the suppressed-turn query returns an empty set across the
whole of September, while the positive control shows `initial` versions being written today.

The reason `model_versions.creation_kind = 'committed_mutation'` stops on 10 Sep 08:57 is simply
that **no signed-in scenario has had a second graph-changing turn since 11 Sep**. `creation_kind` is
decided in SQL — `'initial'` when the scenario has no versions yet, `'committed_mutation'` otherwise
(`20260824200000_c8_atomic_model_version_restore.sql` ~:818-828) — so a population where every owned
scenario receives exactly one version-creating turn produces exactly the observed distribution.
The second-mutation cohort is dated: 217 scenarios reached a 2nd version-creating turn between
26–31 Aug, 14 more between 7–10 Sep, **none since**.

This closes the handover's open question 5 ("why only 296 committed mutations in all history") with
a usage answer, not a defect: signed-in users draft a model and do not go on to confirm a second
change. It also supersedes the earlier hypothesis that writes were bypassing Model Management.

## ⚠ The consequence that matters for the witness

The `committed_mutation` path has **not been exercised on the deployed build for 11 days**, and the
build has moved many times in that window. So step 2 of the state-spine witness — a second confirmed
mutation producing a `committed_mutation` version whose `parent_version_id` is the initial version —
is genuinely UNPROVEN on the current build, not merely unobserved. The witness will be the first
exercise of that path since 10 Sep. That raises its value and is a real risk to plan for.

## Scope and limits

- OWNED scenarios only. Guest scenarios never version, by deliberate design
  (`v_should_create := v_user_id IS NOT NULL AND ...`), and guests dominate volume.
- "Turn carrying a mutation id" is the proxy for "version-eligible graph-changing turn". It is the
  marker the RPC itself claims (`v5_conversation_turns.model_version_mutation_id`), so it cannot be
  set by a turn that never reached v5 — but a graph write that never reached v5 at all (for example
  `/assist/v1/scenarios/:id/graph/register`, which passes no version carrier) would not appear here.
  That path is measured separately by lane C.
