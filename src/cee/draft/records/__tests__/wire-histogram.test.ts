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

  /**
   * ⭐⭐ THE `value_scale` ADOPTION COUNTER — the number nothing could produce.
   *
   * Grammar v10 + instruction v19 (#1562) ask the model to declare what its
   * number MEANS. Whether it ANSWERS has been unmeasured AND unmeasurable:
   * `value_scale` appears in zero telemetry payloads repo-wide, and the banked
   * v202 witnesses are post-projection payloads that never carry `claims`. Two
   * queued deletions — the repair stage's competing inference and
   * `display-value.ts:507`'s own dated deletion condition — are both waiting on
   * this rate.
   *
   * The fixture is deliberately MIXED WITHIN ONE KIND and split ACROSS kinds, so
   * neither a per-kind bug nor a pooled total could produce this shape:
   * `factor` 2 declared / 1 absent, `risk` 0 declared / 1 absent.
   */
  it('⭐ counts value_scale presence PER CLAIM KIND, declared and absent apart', () => {
    const result = projectDraftRecords({
      stated_items: [{ kind: 'goal', source_quote: 'cut monthly churn' }],
      claims: [
        { claim_kind: 'factor', label: 'Monthly Churn Rate', value: 0.04, unit: '%', value_scale: 'unit_interval' },
        { claim_kind: 'factor', label: 'Net Revenue Retention', value: 1.1, unit: '%', value_scale: 'ratio' },
        { claim_kind: 'factor', label: 'Support Headcount' },
        { claim_kind: 'risk', label: 'the review may slip' },
      ],
    });
    expect(result.ok).toBe(true);

    const payload = emitted();
    expect(payload, `no ${EVENT} event was emitted`).toBeDefined();
    expect(payload!.value_scale_by_kind).toEqual({
      factor: { declared: 2, absent: 1 },
      risk: { declared: 0, absent: 1 },
    });
    // THE PRECONDITION, pinned in-test: the kinds really do differ on this
    // payload, so the split above is the counter's doing and not a fixture in
    // which every kind happens to agree.
    expect((payload!.value_scale_by_kind as Record<string, { declared: number }>).factor.declared)
      .not.toBe((payload!.value_scale_by_kind as Record<string, { declared: number }>).risk.declared);
  });

  /**
   * THE LEAK GUARD, EXTENDED TO THE NEW FIELD. The block's own invariant is that
   * a histogram cannot leak a brief. A new field is a new chance to break it, so
   * it is asserted rather than assumed: the counter must carry grammar enums and
   * integers only — no value, no unit, no label, no source_quote.
   */
  it('⭐ the new counter carries enums and integers only — no value, unit or label', () => {
    projectDraftRecords({
      stated_items: [{ kind: 'goal', source_quote: 'cut monthly churn to 3%' }],
      claims: [
        { claim_kind: 'factor', label: 'Monthly Churn Rate', value: 0.04, unit: '%', value_scale: 'unit_interval' },
      ],
    });
    const serialised = JSON.stringify(emitted()!.value_scale_by_kind);
    expect(serialised).not.toContain('Monthly Churn Rate');
    expect(serialised).not.toContain('cut monthly churn');
    expect(serialised).not.toContain('0.04');
    expect(serialised).not.toContain('%');
    expect(serialised).not.toContain('unit_interval');
    // ...and the contrast: the counter is not empty, so the absences above are
    // about its CONTENT and not about a field that failed to populate.
    expect(serialised).toContain('declared');
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
