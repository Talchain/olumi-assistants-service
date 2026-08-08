/**
 * 2.909 N-suite — ERASURE R-1/R-2 (N-12 SHAPE) — RED pre-DDL by construction.
 *
 * The ruled design (unified plan §5.3, Paul's 8 Aug ruling; TA 03 §3, N-12):
 * R-1 option (ii) pseudonymise-on-erasure — name-detach, content retained —
 * plus R-2, the NARROW, service-role-only, AUDIT-LOGGED, IDEMPOTENT redaction
 * exception to append-only, extended to elicitation tables + display_name.
 * Pseudonyms must not be reversible from any packet/reveal payload.
 *
 * RED signature today (every test): "RED (pre-DDL): seam not implemented:
 * src/collab/redaction.ts".
 */
import { describe, it, expect } from "vitest";
import {
  importSeam,
  type RedactionSeam,
  type PacketReadModelSeam,
  seededOpenRoundStore,
  fixtureRound,
  SENTINELS,
  FIXTURE_ROUND_ID,
  jsonContains,
} from "./contracts.js";

describe("N-E erasure (R-1 pseudonymise + R-2 narrow audited redaction — the N-12 executable shape)", () => {
  it("N-E1: redaction DETACHES the name and RETAINS the content — belief values and expression_raw survive byte-for-byte; the display_name is gone from the reveal (with pre-redaction presence as the positive control)", async () => {
    const redaction = await importSeam<RedactionSeam>("src/collab/redaction.ts");
    const packetSeam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: "closed" }));

    // POSITIVE CONTROL (trap 13): pre-redaction, the reveal names B.
    const before = await packetSeam.assembleRevealView(store, {
      round_id: FIXTURE_ROUND_ID,
      requested_by: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
    });
    expect(jsonContains(before, SENTINELS.B_DISPLAY_NAME)).toBe(true);
    expect(jsonContains(before, SENTINELS.B_VALUE_STR)).toBe(true);

    await redaction.redactParticipantIdentity(store, {
      participant_id: SENTINELS.B_PARTICIPANT_ID,
      requested_by: { kind: "service" },
    });

    const after = await packetSeam.assembleRevealView(store, {
      round_id: FIXTURE_ROUND_ID,
      requested_by: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
    });
    // Name detached…
    expect(jsonContains(after, SENTINELS.B_DISPLAY_NAME)).toBe(false);
    expect(jsonContains(after, SENTINELS.B_SUPABASE_USER_ID)).toBe(false);
    // …content retained (R-1 option ii): the belief record is intact.
    expect(jsonContains(after, SENTINELS.B_VALUE_STR)).toBe(true);
    expect(jsonContains(after, SENTINELS.B_EXPRESSION)).toBe(true);
    // Narrowness: sibling A's identity is untouched by B's redaction.
    expect(store.state.participants.get(SENTINELS.A_PARTICIPANT_ID)?.display_name).toBe(
      SENTINELS.A_DISPLAY_NAME
    );
  });

  it("N-E2: the pseudonym is not reversible from the payload — non-empty, distinct, and carries no fragment of the redacted identity", async () => {
    const redaction = await importSeam<RedactionSeam>("src/collab/redaction.ts");
    const store = seededOpenRoundStore();
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: "closed" }));

    const { pseudonym } = await redaction.redactParticipantIdentity(store, {
      participant_id: SENTINELS.B_PARTICIPANT_ID,
      requested_by: { kind: "service" },
    });

    expect(pseudonym).toBeTruthy();
    expect(pseudonym).not.toBe(SENTINELS.B_DISPLAY_NAME);
    // No identity fragment survives into the pseudonym (name parts, supabase id).
    for (const fragment of ["Beatrix", "Zenobia", SENTINELS.B_SUPABASE_USER_ID]) {
      expect(pseudonym.includes(fragment)).toBe(false);
    }
    // The persisted row now carries the pseudonym as its display label.
    const row = store.state.participants.get(SENTINELS.B_PARTICIPANT_ID);
    expect(row?.pseudonym).toBe(pseudonym);
    expect(row?.display_name).toBe(pseudonym);
  });

  it("N-E3: redaction is AUDIT-LOGGED — exactly one audit row, naming the actor, NOT carrying the redacted name (the audit log must not re-leak the PII)", async () => {
    const redaction = await importSeam<RedactionSeam>("src/collab/redaction.ts");
    const store = seededOpenRoundStore();

    await redaction.redactParticipantIdentity(store, {
      participant_id: SENTINELS.B_PARTICIPANT_ID,
      requested_by: { kind: "service" },
    });

    const audit = await store.listRedactionAuditRows(SENTINELS.B_PARTICIPANT_ID);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.participant_id).toBe(SENTINELS.B_PARTICIPANT_ID);
    expect(audit[0]?.requested_by).toBeTruthy();
    expect(audit[0]?.created_at).toBeTruthy();
    expect(jsonContains(audit, SENTINELS.B_DISPLAY_NAME)).toBe(false);
    expect(jsonContains(audit, "Beatrix")).toBe(false);
  });

  it("N-E4: redaction is IDEMPOTENT — a second invocation is non-destructive: same pseudonym, no second audit row, events untouched (N-12: cannot be invoked twice destructively)", async () => {
    const redaction = await importSeam<RedactionSeam>("src/collab/redaction.ts");
    const store = seededOpenRoundStore();

    const first = await redaction.redactParticipantIdentity(store, {
      participant_id: SENTINELS.B_PARTICIPANT_ID,
      requested_by: { kind: "service" },
    });
    const eventsSnapshot = JSON.stringify(store.state.events);

    const second = await redaction.redactParticipantIdentity(store, {
      participant_id: SENTINELS.B_PARTICIPANT_ID,
      requested_by: { kind: "service" },
    });

    expect(first.already_redacted).toBe(false);
    expect(second.already_redacted).toBe(true);
    expect(second.pseudonym).toBe(first.pseudonym);
    expect(await store.listRedactionAuditRows(SENTINELS.B_PARTICIPANT_ID)).toHaveLength(1);
    expect(JSON.stringify(store.state.events)).toBe(eventsSnapshot);
  });
});
