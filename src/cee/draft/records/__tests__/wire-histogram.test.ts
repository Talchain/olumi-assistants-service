/**
 * ⭐ THE WIRE HISTOGRAM FIRES — and it is asserted by FIRING, not by RED-first.
 *
 * RED-first is not meaningful for a telemetry line: deleting it does not change
 * a value any other assertion reads, so a suite could stay green while the
 * instrument silently stopped. The only honest guard is to drive the real seam
 * and assert the event was EMITTED with the shape a reader depends on — which
 * is what these do. Delete the `log.info` and every case here REDs.
 *
 * ⛔ The third case is the one that matters most and it is a LEAK guard: this
 * seam holds `source_quote` and `label`, which are the user's own words. The
 * event must carry kinds and counts and nothing else, so the test asserts the
 * user's text is ABSENT from the emitted payload rather than merely that the
 * counts are right.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '../../../../utils/telemetry.js';
import { projectDraftRecords } from '../seam.js';

const EVENT = 'cee.draft.records.wire_histogram';

/** A record set whose kinds are deliberately UNEVEN, so a miscount cannot pass. */
const WIRE = {
  stated_items: [
    { kind: 'goal', source_quote: 'lift enterprise renewal rate' },
    { kind: 'option', source_quote: 'commission a churn review' },
    { kind: 'option', source_quote: 'instrument product analytics' },
    { kind: 'figure', source_quote: 'renewal rate is 78%', value: 78, unit: '%' },
  ],
  claims: [
    { claim_kind: 'risk', label: 'the review may take a quarter' },
    { claim_kind: 'risk', label: 'analytics work could slip' },
    { claim_kind: 'risk', label: 'budget may not clear' },
    { claim_kind: 'outcome', label: 'renewals recover' },
  ],
};

let infoSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { infoSpy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never); });
afterEach(() => { infoSpy.mockRestore(); vi.restoreAllMocks(); });

function emitted(): Record<string, unknown> | undefined {
  for (const call of infoSpy.mock.calls) {
    const payload = call[0] as Record<string, unknown> | undefined;
    if (payload && payload.event === EVENT) return payload;
  }
  return undefined;
}

describe('draft-records seam — the wire histogram', () => {
  it('⭐ FIRES on an accepted record set, with the model\'s RAW claim-kind mix', () => {
    const result = projectDraftRecords(WIRE);
    expect(result.ok).toBe(true);

    const payload = emitted();
    expect(payload, `no ${EVENT} event was emitted`).toBeDefined();
    // The uneven counts are the point: 3 risks and 1 outcome cannot be produced
    // by a probe that merely echoes the array length.
    expect(payload!.claim_kinds).toEqual({ risk: 3, outcome: 1 });
    expect(payload!.stated_kinds).toEqual({ goal: 1, option: 2, figure: 1 });
    expect(payload!.claim_count).toBe(4);
    expect(payload!.stated_count).toBe(4);
  });

  it('⭐ does NOT fire when the wire is rejected — a refusal is not a histogram', () => {
    const result = projectDraftRecords({ nodes: [], edges: [] });
    expect(result.ok).toBe(false);
    expect(emitted(), 'a rejected response must not emit a wire histogram').toBeUndefined();
  });

  it('⛔⛔ CARRIES NO USER TEXT — kinds and counts only', () => {
    projectDraftRecords(WIRE);
    const payload = emitted();
    expect(payload).toBeDefined();

    // Every quote and label from the fixture must be absent from the payload,
    // at any depth. Serialising is the check a reader actually cares about,
    // because that is what reaches the log sink.
    const serialised = JSON.stringify(payload);
    for (const item of WIRE.stated_items) {
      expect(serialised, `source_quote leaked: ${item.source_quote}`).not.toContain(item.source_quote);
    }
    for (const claim of WIRE.claims) {
      expect(serialised, `claim label leaked: ${claim.label}`).not.toContain(claim.label);
    }
    // Positive control: the probe CAN see text when text is present, so the
    // absences above are real rather than a serialisation that dropped everything.
    expect(serialised).toContain('risk');
    expect(serialised).toContain(EVENT);
  });
});
