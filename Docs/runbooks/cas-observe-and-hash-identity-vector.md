# Runbook — CAS observe-mode check + cross-service hash-identity vector

**Salvaged 2026-07-19** from PR #353 (`docs(v5): staging confidence pack v0`),
closed unmerged. The rest of that pack was a point-in-time staging verification
checklist tied to a specific merge wave; these two procedures are durable and
are the reason the PR was worth salvaging at all.

**This is a read/observe runbook.** Nothing here authorises SQL, migration
execution, CAS *enforcement*, prompt upload, a production flag flip, or runtime
feature enablement. Every step is observation only.

**Prerequisites carried over from #353:** §1 assumes #346 (CAS observe-mode) is
merged to staging AND `CEE_V5_GRAPH_CAS_MODE=observe` is set on the
`cee-staging` environment. Those are two separate, separately-approved events —
if either has not happened, §1 does not apply and §2 stands alone.

**Freshness warning.** The golden vector in §2 was empirically confirmed
**2026-07-06**, pre-merge, against CEE #348 / DGAI #229 / PLoT #194. It has not
been re-confirmed at salvage time. Treat a mismatch as "re-derive the vector",
not automatically as "a service regressed".

---

## 1. CAS observe-mode check

CAS observe-mode is **app-side stale-write observation, not atomic DB CAS**; enforcement is
OFF (prod auto-downgrades `enforce`→`observe`). This step confirms observe telemetry flows
and nothing blocks.

- **Clean write:** normal edit commit. **Pass:** one `v5.graph_cas.evaluated` telemetry
  event with `category=match` (or `first_write`/`no_expected` on a fresh/draft path); the
  commit proceeds; no `v5.graph_cas.write_blocked`.
- **Concurrent/stale write (if reproducible on staging):** a second writer between turn-start
  and commit. **Pass:** event `category=analysis_affecting_conflict` **or**
  `cosmetic_concurrent_edit` is emitted, and **the commit still proceeds** (observe never
  blocks); `write_blocked` count stays 0.
- **Flag-off parity (sanity):** with `CEE_V5_GRAPH_CAS_MODE` unset/`off`, confirm zero
  `scenarios` SELECT overhead and byte-identical commit behaviour (unit-proven in #346;
  re-confirm no telemetry emitted).
- **What observe gives us:** real conflict-frequency data at the single writer chokepoint —
  the input to decide whether the RPC v3 atomic CAS is worth building (it is markdown-only
  today, `Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md`, Paul-gated).
- **Known limitation:** SELECT-then-write TOCTOU window; observe does not prove system-wide
  absence of stale writes, only measures them on the instrumented app path.

---

## 2. Hash-identity check (cross-service, post-hardening)

The `__proto__` hardening (CEE #348 / DGAI #229 / PLoT #194) must preserve cross-service
hash alignment AND fix the collision. Verified this session; re-confirm on merged staging:

- **Cross-service golden vector:** for the benign payload `{z:1,a:2,m:3}`, all three services
  canonicalise to `{"a":2,"m":3,"z":1}` and hash (sha256, 12-hex) to **`ebba85cfdc0a`**.
  **Pass:** CEE `computeResponseHash`, PLoT `computeOlumiHash`, and DGAI `computePayloadHash`
  all return `ebba85cfdc0a` (empirically confirmed 2026-07-06 pre-merge). *(DGAI's separate
  FNV `computePayloadHashSync` is a UI-local sync fallback, never cross-service-aligned by
  design — do not treat its different value as a regression.)*
- **Collision fixed:** a body differing only by an own `__proto__` key now hashes
  **differently** from the same body without it, in all three services (the
  idempotency-cache-replay hazard PLoT #194 closed).
- **graphIdentityHash (Group A):** a cosmetic-only edit changes the full identity hash while
  the analysis-affecting hash is unchanged (the two-hash contract, pinned by #345). **Pass:**
  identity hash moves on a label edit; analysis hash does not.
