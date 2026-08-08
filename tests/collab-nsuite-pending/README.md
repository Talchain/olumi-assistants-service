# 2.909 — Collab U-S0 adversarial N-suite (PRE-DDL, AUTHORED RED-FIRST)

**Status: RED by construction, deliberately.** Nothing under `src/collab/` or
`src/routes/collab.v1.*` exists at the authoring tip (CEE staging `4b57b8ff`,
2026-08-08). Every spec here is executable and fails with the uniform signature

    RED (pre-DDL): seam not implemented: <seam path>

That failure IS the deliverable (tenancy-audit DDL condition 4: the N-suite is
authored RED **before** the DDL merges). The suite goes GREEN only when the
U-S0 migration set + routes land **with the safety properties intact**.

Authorities: ROADMAP 2.909/2.910/2.686 · `parallel-briefs/COLLAB-UNIFIED-BUILD-PLAN-2026-08-07.md`
(§2 asset 6, §3 U-S0, §4 C4) · `parallel-briefs/COLLAB-ELICITATION-DESIGN-2026-08-07.md`
(G2 §§2-4, §10 INV-A..I) · `docs-designs/COLLAB-TENANCY-AUDIT-2026-07-11/05-adversarial-rls-test-plan.md`
(N-1..N-12) · `PHASE0-EVIDENCE-2026-07-28/collab-readiness-2026-08-08.md` (build-list items 2/3/6;
the dim-1 owner-attribution finding).

## Why this directory is not collected by the required gate

These specs MUST fail today, and the required gate (`pnpm test:required`) must
stay green. So: files here use the `.ntest.ts` suffix (no vitest config
collects `*.ntest.ts`), and the gate SEES the suite through ONE collected
meta-test — `tests/meta/collab-n-suite-pending.test.ts` — which asserts, in the
required gate, that:

1. this directory's file manifest is exactly as declared;
2. every contract seam is still absent (with a positive control proving the
   absence check can see a presence — trap 13);
3. every spec here actually invokes the seam guard (so a tidy-up cannot
   silently defuse the RED);
4. **the moment any seam lands, the meta-test goes RED with promotion
   instructions** — fail-loud, never assume-good (trap 12/12f).

Run the pending suite itself with:

    pnpm test:collab-nsuite        # all specs fail with the RED signature today

DB grain: `n-suite-rls.collab.sql` runs under
`psql -v ON_ERROR_STOP=1 -f tests/collab-nsuite-pending/n-suite-rls.collab.sql`
against the staging clone. RED today at block N-SQL-0
(`missing elicitation relations: elicitation_rounds round_events elicitation_participants elicitation_events`).

## The seam-name contract (chosen by this lane — the build lane implements it)

The banked designs fix the tables, invariants, and route ROLES but not module
paths / function names / refusal codes / dependency shape. Those are chosen in
`contracts.ts` (single source; the specs import it). Renaming any seam is
allowed ONLY by editing this suite in the same PR — consciously, in the diff.

| Seam | Contract type (contracts.ts) |
|---|---|
| `src/collab/participant-tokens.ts` | `ParticipantTokensSeam` — mint/verify/revoke; tokens ≥128-bit, stored hashed |
| `src/collab/rounds-service.ts` | `RoundsServiceSeam` — mintRound / closeRound / ownerPreview |
| `src/collab/packet-read-model.ts` | `PacketReadModelSeam` — assembleOpenPacket / assembleRevealView |
| `src/collab/elicitation-append.ts` | `ElicitationAppendSeam` — appendParticipantEvent (server-stamped provenance) |
| `src/collab/redaction.ts` | `RedactionSeam` — redactParticipantIdentity (R-1/R-2, N-12 shape) |
| `src/routes/collab.v1.rounds.ts` | owner routes: `POST /collab/v1/rounds`, `POST /collab/v1/rounds/:round_id/close`, `GET /collab/v1/rounds/:round_id/preview` |
| `src/routes/collab.v1.packet.ts` | participant routes: `GET /collab/v1/packet/:round_id`, `POST /collab/v1/packet/:round_id/events`, `GET /collab/v1/packet/:round_id/reveal` |
| DB routine (SQL suite) | `collab_redact_participant` SECURITY DEFINER + `collab_redaction_audit` table |

Cross-cutting choices: **F-1** deps-first services over a `CollabStore`
interface; routes read `app.collabStore` decoration when present (test
injection), bare-Fastify registrable, fail closed without auth context ·
**F-2** typed `CollabRefusal` errors with stable `.code` (vocabulary in
`contracts.ts`) · **F-3** token header `x-collab-participant-token` ·
**F-4** route-grain refusal indistinguishability (401 `collab_token_invalid`
for missing/forged/revoked/unknown-round/not-a-participant alike) ·
**F-5** round mint calls `createModelVersion({provenance:"elicitation_round_mint"})`
and pins its returned id (2.910) · **F-6** owner-panellist ordering enforced at
close.

## Coverage map (spec → property → design authority)

| Spec file | Tests | Property pinned |
|---|---|---|
| `blindness.inv-a.ntest.ts` | N-A1..N-A4 | INV-A: open packet withholds sibling contributions/model value/aggregates/counts **by query shape** (scoped `listOwnEvents` only — a fetch-all-and-filter implementation fails N-A2) + closed key-set allowlist + owner-not-exempt pre-close (G2 §2.3); every absence has a reveal-shape presence control (trap 13) |
| `token-scope.ntest.ts` | N-T1..N-T6 | forged/revoked/cross-round token refusals; participant cannot mint/close; revocation = appended status event, rows never deleted; raw token appears in NO persisted row |
| `round-lifecycle.ntest.ts` | N-L1..N-L6 | INV-G: no event lands on a closed round (submit AND revise); revoked-participant append refused; reveal impossible while open (owner included); guest mint refused (G1); **2.910 version-anchor pin with a poisoned everyday-path pointer**; F-6 close-ordering |
| `attribution.inv-f.ntest.ts` | N-P1..N-P4 | INV-F: `authored_by` = the token-resolved participant, never the scenario owner (the `append_turn_atomic_v4` dim-1 defect class); wire-supplied provenance refused (INV-D fail-loud); revision appends, reveal folds latest-per-participant (INV-C) |
| `routes.token-boundary.ntest.ts` | N-R1..N-R3 | F-3/F-4 HTTP boundary; no existence oracle; participant token worthless on owner routes; graph-mutation-shaped payloads refused (INV-B) |
| `redaction.r1-r2.ntest.ts` | N-E1..N-E4 | R-1 name-detach content-retained; pseudonym irreversibility from payloads; audit row that does not re-leak the name; idempotency (N-12) |
| `n-suite-rls.collab.sql` | N-SQL-0..7 | FORCE RLS; anon-nothing/authenticated-SELECT-only; append-only grants (INV-C at DB grain); RPC EXECUTE revocation; N-7 legacy isolation; N-9 share-link isolation; N-12 routine posture |

Not covered here, and why: realtime (N-8) — U-S0 subscribes to nothing
(unified plan §4 C2, obligation dormant until a realtime slice) · JWT hygiene
(N-10) — owner routes ride the existing key-auth/ownership-preflight posture;
its hardening rides the dormant `CEE_REQUIRE_USER_JWT` seam, tested where that
seam's tests live · N-11 forbidden-pattern grep — adopt
`docs-designs/COLLAB-TENANCY-AUDIT-2026-07-11/tests/forbidden-patterns.sh`
verbatim when the routes land (it greps route modules that must exist first) ·
aggregation absence (INV-E) — the seam ships EMPTY in U-S0; the INV-E mutant
kit is a build-lane deliverable against the aggregation seam when it exists.

## Flagged forks (contract decisions the design left open — build lane may re-rule, but must edit this suite in the same PR)

1. **Store-injection grain (F-1).** The specs test services over an injected
   `CollabStore` rather than vi-mocking module internals. The fixture store is
   the suite's INPUT DOMAIN, not evidence about the wire (trap 16): the specs
   prove the read model withholds **even when the store hands it everything**,
   the SQL file pins the DB layer, the route file pins the HTTP boundary — and
   a live staging witness after deploy is the BUILD lane's deliverable.
2. **Refusal vocabulary (F-2/F-4).** Codes are this lane's minimal invention;
   the service-grain revoked/invalid distinction collapses to one code at the
   route (no oracle). If CEE's BoundaryError machinery is preferred, keep the
   `.code` values and edit `isCollabRefusal` accordingly.
3. **Owner-panellist ordering at CLOSE, not reveal-only (F-6).** G2 §2.3¹ words
   the rule as a reveal-endpoint refusal "in an open round" — but reveal is
   already impossible while open (INV-G), and once closed the owner can never
   submit (closed rounds refuse writes), so a reveal-time-only gate would
   deadlock a closed round with an unsubmitted owner-panellist forever. The
   property that must survive any re-ruling: **the owner cannot reach the
   reveal without having submitted or declined first.**
4. **The redaction audit row does NOT carry the redacted display_name** (N-E3).
   "Audit-logged" (R-2) is read as logging THAT/WHO/WHEN, not preserving the
   PII the routine exists to detach. If the ruling is later read otherwise, the
   audit table needs its own access posture first.
5. **Strict open-packet key allowlist (N-A3).** `OPEN_PACKET_ALLOWED_KEYS` is
   asserted with strict equality, so ANY new packet field — however innocent —
   goes RED here until it is added to the allowlist consciously. That is the
   point: the packet is the blindness boundary; it never grows silently.

## Promotion protocol (when the U-S0 build lands)

1. Implement the seams (or rename them here, in the same PR).
2. Rename `*.ntest.ts` → `*.test.ts` and move under `tests/collab/` (collected
   by the required gate); delete `vitest.collab-nsuite.config.ts` + the
   `test:collab-nsuite` script.
3. Delete `tests/meta/collab-n-suite-pending.test.ts` (its job — remembering
   this suite exists — is done) and this README's pre-DDL framing.
4. Run the SQL suite against the migrated staging clone; record command+output.
5. Mutation-check the pins per the standing brief (throwaway worktree OUTSIDE
   the repo, sentinel write-test for isolation, applied-check scoped to src/):
   at minimum — unscope the packet query (N-A2 must RED), stamp the owner id in
   provenance (N-P1 must RED), accept a late event on a closed round (N-L1 must
   RED), read the everyday-path pointer at mint (N-L5 must RED), skip the audit
   row (N-E3 must RED). A pin whose revert stays green is theatre (trap 11).
