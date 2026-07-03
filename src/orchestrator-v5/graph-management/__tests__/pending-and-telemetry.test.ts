/**
 * Track 3 — Slice 4: pending-action projection, idempotency, no-silent-outcome telemetry.
 *
 * The projection's structural compatibility with the REAL Track 2 union is proven
 * at TYPECHECK by the `PendingActionAction` assignment below (esbuild strips types
 * at test runtime, so `pnpm typecheck` is the enforcing gate — a compile error if
 * Track 2's shape drifts). Importing the TYPE in a test does not edit the T2 file.
 */
import { describe, it, expect } from 'vitest';
import type { PendingActionAction } from '../../session/pending-action.js';
import {
  projectHeldToPendingAction,
  appliedLedgerOf,
  idempotencyBlocker,
  type HeldMutationPendingAction,
} from '../pending-projection.js';
import { mutationTelemetryEvent } from '../telemetry.js';
import { STRUCTURAL_APPLY_HELD, PROPOSAL_ALREADY_APPLIED } from '../reason-codes.js';
import type { RefereeVerdict, MutationVerdict } from '../types.js';

const heldVerdict: RefereeVerdict = {
  verdict: 'held',
  kind: 'add_node',
  candidate_id: '11111111-1111-4111-8111-111111111111',
  mutation_class: 'structural',
  base_hash_match: true,
  blocker: { code: STRUCTURAL_APPLY_HELD, readable: 'held' },
};

describe('held → PendingAction projection', () => {
  it('projects a held verdict onto the apply_proposed_change shape (assignable to the REAL union)', () => {
    const projected = projectHeldToPendingAction(heldVerdict);
    expect(projected).not.toBeNull();
    // TYPE-LEVEL compat with Track 2's real union — enforced by `pnpm typecheck`.
    const asPending: PendingActionAction = projected as HeldMutationPendingAction;
    expect(asPending.kind).toBe('apply_proposed_change');
    expect((asPending as { proposal_ref: string }).proposal_ref).toBe(heldVerdict.candidate_id);
  });

  it('returns null for every non-held verdict', () => {
    for (const verdict of ['would_apply', 'stale', 'rejected', 'clarify_required'] as MutationVerdict[]) {
      expect(projectHeldToPendingAction({ ...heldVerdict, verdict })).toBeNull();
    }
  });

  it('redaction: public copy makes no applied/updated/safe claim; inline_patch carries only redacted metadata', () => {
    const p = projectHeldToPendingAction(heldVerdict)!;
    expect(p.public_message.toLowerCase()).not.toMatch(/applied|updated|safe to apply|done/);
    expect(Object.keys(p.inline_patch).sort()).toEqual(
      ['apply_wiring', 'blocker_code', 'candidate_kind', 'handler_id', 'mutation_class'].sort(),
    );
    // No raw graph/payload values leak into the patch.
    expect(JSON.stringify(p.inline_patch)).not.toMatch(/label|observed_state|edges/);
  });
});

describe('idempotency (PROPOSAL_ALREADY_APPLIED)', () => {
  it('a re-presented already-applied candidate_id resolves to PROPOSAL_ALREADY_APPLIED', () => {
    const ledger = appliedLedgerOf(['11111111-1111-4111-8111-111111111111']);
    expect(idempotencyBlocker('11111111-1111-4111-8111-111111111111', ledger)?.code).toBe(PROPOSAL_ALREADY_APPLIED);
    expect(idempotencyBlocker('unseen-id', ledger)).toBeNull();
  });
});

describe('no-silent-outcome telemetry', () => {
  it('every verdict maps to exactly one redacted event with the right name', () => {
    for (const verdict of ['would_apply', 'held', 'stale', 'rejected', 'clarify_required'] as MutationVerdict[]) {
      const ev = mutationTelemetryEvent({ ...heldVerdict, verdict }, 'dual_model_m2');
      expect(ev.event).toBe(`v5.candidate_mutation.${verdict}`);
      expect(ev.verdict).toBe(verdict);
      expect(ev.source).toBe('dual_model_m2');
      expect(ev.base_hash_match).toBe(true);
    }
  });

  it('event carries codes/enums/booleans only — never a raw payload value', () => {
    const ev = mutationTelemetryEvent(heldVerdict);
    expect(JSON.stringify(ev)).not.toMatch(/observed_state|"label"|Marketing/);
    expect(ev.blocker_code).toBe(STRUCTURAL_APPLY_HELD);
    expect(ev.source).toBeNull();
  });
});
