/**
 * ⭐ THE EVIDENCE ASSESSMENT REACHES THE WIRE, WITHOUT THE TIER-3 SUBTREE.
 *
 * ── WHAT THIS EXISTS TO FIX ───────────────────────────────────────────────
 * PLoT computes `m1_coaching.evidence_gaps` on every run (`safeCompute(..., [])`,
 * so the key is always an array). CEE consumes it internally. The UI's check
 * asks `Array.isArray(m1Coaching?.evidence_gaps)` and, finding nothing, renders
 * "Evidence not assessed" — correctly refusing to read silence as an all-clear.
 *
 * Journey-witnessed on deployed staging (10 Sep 2026, fresh guest, two briefs):
 * "Evidence not assessed" on every run, while PLoT's own telemetry showed the
 * analysis completing.
 *
 * ⛔⛔ THE ACCEPTANCE CONDITION, AND IT IS THE FIRST CASE BELOW.
 * COUNT AND LABELS TRAVEL WITH THE BOOLEAN, OR NEITHER TRAVELS.
 * The consumer's predicate is:
 *   gaps.length > 0 ? (addressed ? all_addressed : gaps)
 *                   : (assessed === true ? none_flagged : not_assessed)
 * so `assessed: true` beside an empty list renders "No evidence gaps flagged" —
 * a LICENSED ALL-CLEAR. Emitting the boolean without the gaps that produced it
 * would tell a user their evidence was clear on a run that found gaps. Today's
 * "Evidence not assessed" is an honest refusal; that would be a lie, and a lie
 * is strictly worse than the gap. Hence: fail CLOSED everywhere the projection
 * cannot carry the whole answer.
 *
 * ⛔ AND IT IS NOT GATED ON DEBUG, DELIBERATELY. The finaliser's Tier-3 deletion
 * runs only when `turnDebugEnabled` is false, and staging currently has it TRUE
 * — so the deletion is NOT what was producing "Evidence not assessed" there.
 * That was a separate, UI-side gap: the live turn path never wrote the field the
 * check reads. Both are real; only one was biting on staging, and this file
 * previously implied the ban was the cause. The ban is still worth crossing
 * because the debug flag is expected to be turned off (it puts brief text into
 * logs), and a projection that inherited its gating would go dark exactly then.
 * Both debug arms are pinned below.
 *
 * ⚠ CLAIM TYPE. These are assertions about the RESPONSE OBJECT the finaliser
 * returns. They say nothing about what any surface renders.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
type OlimiResponseAlias = OlumiResponse;

import { finaliseV5Response } from '../response-finaliser.js';
import { config } from '../../config/index.js';

/** A gap exactly as PLoT's `EvidenceGap` ships it — label PLUS Tier-3 numerics. */
function gap(id: string, label: string, voi: number) {
  return { factor_id: id, factor_label: label, voi_score: voi, evpi_percentage_points: voi * 10, influence: voi };
}

function responseWith(m1Coaching: unknown): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'ok',
    blocks: [
      {
        type: 'analysis_result',
        enrichment: (m1Coaching === undefined ? {} : { m1_coaching: m1Coaching }) as Record<string, unknown>,
      } as never,
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  } as OlumiResponse;
}

function enrichmentOf(out: OlumiResponse): Record<string, unknown> {
  return (out.blocks as Array<Record<string, unknown>>)[0]!.enrichment as Record<string, unknown>;
}

function assessment(out: OlumiResponse): Record<string, unknown> | undefined {
  return enrichmentOf(out).evidence_assessment as Record<string, unknown> | undefined;
}

const TWO_GAPS = { evidence_gaps: [gap('f1', 'Repeat question volume', 0.7), gap('f2', 'Agent capacity', 0.4)] };

describe('the evidence assessment travels whole, or not at all', () => {
  let originalDebug: boolean | undefined;
  beforeEach(() => { originalDebug = config.cee?.turnDebugEnabled; });
  afterEach(() => {
    if (config.cee && originalDebug !== undefined) {
      (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = originalDebug;
    }
  });

  const setDebug = (v: boolean) => {
    if (config.cee) (config.cee as { turnDebugEnabled: boolean }).turnDebugEnabled = v;
  };

  /**
   * ⛔⛔ THE ACCEPTANCE CONDITION. A happy path structurally cannot observe this
   * failure, which is why it is written first and against a GAP-BEARING payload.
   */
  it('ACCEPTANCE — what ships carries EVERY gap the producer found, or nothing at all', () => {
    /**
     * ⚠ COUNT EQUALITY, NOT NON-EMPTINESS. The first version asserted only that
     * the list was not empty, which passes on a SHORT list — and a short list is
     * the same defect one step earlier, because it becomes the false all-clear
     * the moment it drops the last gap. It also passed while the feature emitted
     * nothing at all, so it could not tell a working projection from a dead one.
     */
    for (const debug of [false, true]) {
      setDebug(debug);
      for (const source of [TWO_GAPS, { evidence_gaps: [gap('f1', 'Only one', 0.5)] }]) {
        const a = assessment(finaliseV5Response(responseWith(source), {}));
        expect(a, `debug=${debug}: emitted nothing for a run that found gaps`).toBeDefined();
        expect(
          (a!.gaps as unknown[]).length,
          `debug=${debug}: shipped a SHORT list — ${(a!.gaps as unknown[]).length} of ${source.evidence_gaps.length}`,
        ).toBe(source.evidence_gaps.length);
      }
    }
  });

  it('carries every gap the producer found, by label', () => {
    setDebug(false);
    const a = assessment(finaliseV5Response(responseWith(TWO_GAPS), {}));
    expect(a?.assessed).toBe(true);
    expect(a?.gaps).toEqual([
      { factor_id: 'f1', factor_label: 'Repeat question volume' },
      { factor_id: 'f2', factor_label: 'Agent capacity' },
    ]);
  });

  /**
   * ⚠ THE ID TRAVELS AND THE NUMERICS DO NOT, AND THAT IS THE BOUNDARY BEING
   * PINNED. An earlier version of this case also banned `factor_id`, which was
   * the wrong line to draw: an id licenses no claim, it lets the consumer bind
   * a gap by IDENTITY instead of keying on a label that can collide. What must
   * never travel is a quantity a surface could author a claim from.
   */
  it('carries NO Tier-3 NUMERIC, while the binding id does travel', () => {
    setDebug(false);
    const a = assessment(finaliseV5Response(responseWith(TWO_GAPS), {}));
    const serialised = JSON.stringify(a ?? {});
    for (const banned of ['voi_score', 'evpi_percentage_points', 'influence']) {
      expect(serialised, `Tier-3 numeric leaked: ${banned}`).not.toContain(banned);
    }
    expect(serialised).not.toMatch(/0\.7|0\.4/);
    expect(serialised).toContain('f1');
  });

  it('fails closed on a gap with a label but NO id — it could not be bound', () => {
    setDebug(false);
    const noId = { evidence_gaps: [{ factor_label: 'Repeat question volume', voi_score: 0.7 }] };
    expect(assessment(finaliseV5Response(responseWith(noId), {}))).toBeUndefined();
  });

  /**
   * ⛔⛔ AN EMPTY ARRAY EMITS NOTHING — this case was INVERTED in the first
   * version and the inversion was the false all-clear itself.
   *
   * It asserted that `[]` is "a real all-clear and is carried as one". Refuted
   * at PLoT's bytes: `safeCompute(..., [], ...)` yields `[]` on ANY exception,
   * and `computeEvidenceGaps` yields `[]` when there is nothing assessable. An
   * empty list therefore cannot distinguish "looked and found none" from
   * "crashed", and the consumer renders assessed-with-empty as the licensed
   * all-clear "No evidence gaps flagged".
   *
   * Emitting nothing keeps the honest refusal. Losing the genuine all-clear is
   * the correct price: we cannot tell it from a crash on this wire.
   */
  it('an EMPTY producer array emits NOTHING — it cannot be told from a crash', () => {
    setDebug(false);
    for (const debug of [false, true]) {
      setDebug(debug);
      expect(
        assessment(finaliseV5Response(responseWith({ evidence_gaps: [] }), {})),
        `debug=${debug}: emitted a licensed all-clear from an empty list`,
      ).toBeUndefined();
    }
  });

  /**
   * ⚠ BLOCK BINDING IS POSITIONAL, AND NOTHING EXERCISED IT. Every other case
   * uses a single-block response, so an implementation that read block 0's
   * enrichment for every block would pass the whole file. This pins that each
   * block is projected from ITS OWN source enrichment.
   */
  it('binds each block to its OWN source enrichment, not to the first', () => {
    setDebug(false);
    const out = finaliseV5Response(
      {
        response_version: 2,
        assistant_text: 'ok',
        blocks: [
          { type: 'analysis_result', enrichment: {} },
          { type: 'analysis_result', enrichment: { m1_coaching: TWO_GAPS } },
        ],
      } as never as OlimiResponseAlias,
      {},
    );
    const blocks = out.blocks as Array<Record<string, unknown>>;
    const first = (blocks[0]!.enrichment as Record<string, unknown>).evidence_assessment;
    const second = (blocks[1]!.enrichment as Record<string, unknown>).evidence_assessment;
    expect(first, 'a block with no coaching must not inherit its sibling’s assessment').toBeUndefined();
    expect((second as { gaps: unknown[] })?.gaps).toHaveLength(2);
  });

  it('emits NOTHING when the producer sent no coaching subtree — the honest refusal survives', () => {
    setDebug(false);
    expect(assessment(finaliseV5Response(responseWith(undefined), {}))).toBeUndefined();
  });

  /**
   * ⛔ THE ARRAY CHECK IS LOAD-BEARING ON ITS OWN, AND THE FIRST VERSION OF THIS
   * CASE DID NOT PROVE IT. It passed `'soon'`, and a mutant that replaced
   * `!Array.isArray(raw)` with `raw === undefined` STAYED GREEN: iterating a
   * string yields characters, every one fails the label check, and the function
   * returned null for a reason that had nothing to do with the guard under test.
   * A guard agreeing with itself (CLAUDE.md trap 13b).
   *
   * These two fixtures discriminate. A KEYED OBJECT is the realistic producer
   * drift — `evidence_gaps` becoming a map — and it is not iterable, so a
   * predicate that admits it THROWS rather than declining. A SET is iterable and
   * carries a perfectly good gap, so a predicate that admits it emits an
   * assessment from a shape the contract does not describe. One proves the guard
   * prevents a crash, the other that it prevents a fabrication.
   */
  it('emits NOTHING for a non-array evidence_gaps, and does not throw on a keyed object', () => {
    setDebug(false);
    for (const notAnArray of [
      'soon',
      { f1: { factor_id: 'f1', factor_label: 'Repeat question volume' } },
      new Set([{ factor_id: 'f1', factor_label: 'Repeat question volume' }]),
    ]) {
      let out: OlumiResponse | undefined;
      expect(
        () => { out = finaliseV5Response(responseWith({ evidence_gaps: notAnArray }), {}); },
        `threw on a non-array evidence_gaps: ${String(notAnArray)}`,
      ).not.toThrow();
      expect(assessment(out as OlumiResponse)).toBeUndefined();
    }
  });

  /**
   * ⛔ FAIL CLOSED ON AN UNLABELLABLE GAP. Dropping it would shrink the list
   * below what the producer found — the understatement that becomes a false
   * all-clear when it drops the last one.
   */
  it('emits NOTHING when any gap has no usable label, rather than understating the count', () => {
    setDebug(false);
    const mixed = { evidence_gaps: [gap('f1', 'Repeat question volume', 0.7), { factor_id: 'f2', voi_score: 0.4 }] };
    expect(assessment(finaliseV5Response(responseWith(mixed), {}))).toBeUndefined();
  });

  /**
   * ⭐ THE INVARIANT, STATED NARROWLY AND PINNED: THIS MODULE NEVER TRUNCATES.
   *
   * The header once claimed a partial list was an outcome this module could never
   * produce. False — PLoT caps `evidence_gaps` and leaves no residue, so a partial
   * list ARRIVES here and ships. What this module must never do is SHORTEN one
   * further, because its own truncation is invisible to everyone downstream.
   *
   * The size is deliberately well above any plausible producer cap, so a silently
   * introduced slice — the natural way this would regress — reds here rather than
   * hiding inside a set small enough to survive it.
   */
  it('NEVER TRUNCATES — a large gap set ships whole, however far above any cap', () => {
    setDebug(false);
    const many = { evidence_gaps: Array.from({ length: 17 }, (_, i) => gap(`f${i}`, `Factor ${i}`, 0.5)) };
    const a = assessment(finaliseV5Response(responseWith(many), {}));
    expect(a?.gaps).toHaveLength(17);
    // Order is the producer's and is not re-ranked here either: a reorder would
    // be a silent editorial claim about which gap matters most.
    expect((a!.gaps as Array<{ factor_label: string }>).map((g) => g.factor_label)).toEqual(
      Array.from({ length: 17 }, (_, i) => `Factor ${i}`),
    );
  });

  /** ⭐ The projection is NOT gated on debug — the pair is the point. */
  it('is emitted with debug OFF, and the Tier-3 subtree is still deleted', () => {
    setDebug(false);
    const out = finaliseV5Response(responseWith(TWO_GAPS), {});
    expect(assessment(out)?.assessed).toBe(true);
    expect(enrichmentOf(out).m1_coaching, 'the transport ban must still hold').toBeUndefined();
  });

  it('is emitted with debug ON too, so turning debug off cannot make it dark', () => {
    setDebug(true);
    expect(assessment(finaliseV5Response(responseWith(TWO_GAPS), {}))?.assessed).toBe(true);
  });
});
