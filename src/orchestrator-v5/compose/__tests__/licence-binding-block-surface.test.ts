/**
 * THE LICENCE MUST BIND ON THE BLOCK SURFACE, NOT ONLY ON `assistant_text`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT THIS FILE IS WRITTEN AGAINST — real wire bytes, not a fixture
 * anyone here composed (CLAUDE.md trap 16: *a fixture you wrote yourself is not
 * evidence about the wire*).
 *
 * `fixtures/founder-turn2-wire-body-20260907T200724Z.json` is the VERBATIM
 * response body CEE returned on turn 2 of the founder journey driven against
 * deployed staging `9de184f` on 2026-09-07T20:07:24Z — the user's very first
 * "Run analysis." click. Its `analysis_admission` reads:
 *
 *     permitted_analysis_mode: "quantified_provisional"
 *     reasons[].message: "… no option can be called the leader and no result
 *                         can be called stable or robust until you have set at
 *                         least one of them."
 *
 * The SAME payload then says, in `blocks[0].summary`:
 *
 *     "ICP Validation Sprint Before Hiring came out ahead in 73% of runs of
 *      this model …"
 *
 * The run both withholds a leader and asserts one. That is the defect.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE EXISTING GATE DOES NOT CATCH IT — derived at the bytes, not inferred.
 *
 * `enforceLeadingOptionClaimsAtWire` DOES conjoin the admission
 * (`analysisReadyPermitsLeaderNaming`) with the turn's entitlement. It is not
 * observe-only and it is not misconfigured. Its SCOPE is the whole story:
 * {@link WIRE_ENFORCED_PROSE_FIELDS} is `['assistant_text','framing_question']`,
 * and `route-v2.ts` records the delegation in terms — *"block prose, enrichment
 * blobs and structured key designations are producer-owned
 * (`compose/withheld-claim-projection.ts`) and are NOT edited here"*.
 *
 * The producer projection is real and complete. Its GATE is
 * `mayPresentLeaderClaimForFact` — the constraint verdict composed with "did
 * anybody ask for this run". It never reads `permitted_analysis_mode`. On this
 * journey the fact PERMITTED (the arms separated, 73% vs 24%) and the user DID
 * click, so the projection was skipped wholesale — while the admission withheld.
 *
 * So: the chokepoint that owns the CONJUNCTION edits two top-level fields; the
 * projection that owns the SURGERY is gated on a different question. One name,
 * two questions (CLAUDE.md trap 21) — and the licence falls through the gap.
 *
 * ⚠ THIS FILE DOES NOT ASK THE PRODUCER TO CONJOIN THE ADMISSION. That is the
 * #709/#737 defect the wire-enforcement module explicitly forbids: *"making one
 * authority call another"*. `mayPresentLeaderClaimForFact` keeps answering its
 * own question. What changes is the CHOKEPOINT'S REACH.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY ABSENCE ARM HAS A PRESENCE ARM (CLAUDE.md trap 13), AND EVERY CASE ITS
 * OPPOSITE-DIRECTION TWIN (CEE #888 paid four oscillating rounds for the
 * asymmetry). Suppressing everything is not a fix — it trades a lie for a gap.
 * The licensed arm below drives the SAME bytes with the admission moved to
 * `comparative_leader` and asserts the payload comes back BY REFERENCE.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { findLeaderClaims } from '../leading-option-egress-guard.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/founder-turn2-wire-body-20260907T200724Z.json', import.meta.url),
);

/** The captured body, re-read per test so no arm can mutate another's input. */
function capturedTurn2(): OlumiResponse {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as OlumiResponse;
}

/**
 * Move ONLY `permitted_analysis_mode`, leaving every other byte alone. The
 * licensed twin must differ from the withheld arm in exactly the licence and
 * nothing else, or it is not a twin — it is a different payload.
 */
function withLicence(body: OlumiResponse, mode: string): OlumiResponse {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const ready = clone.analysis_ready as Record<string, unknown>;
  const admission = ready.analysis_admission as Record<string, unknown>;
  admission.permitted_analysis_mode = mode;
  return clone as OlumiResponse;
}

function opts(body: OlumiResponse, mayName: boolean) {
  return {
    requestId: 'licence-binding-test',
    exitPath: 'run_analysis' as const,
    // TRUE on this journey: the constraint verdict permitted and the user
    // clicked. The defect is NOT that this operand was false and ignored — it
    // is that the ADMISSION was withholding and never reached the block surface.
    mayNameLeadingOption: mayName,
    analysisReady: (body as unknown as Record<string, unknown>).analysis_ready,
    graph: undefined,
  };
}

/** Paths, by identity, that the captured turn 2 carried. */
const SUMMARY_PATH = 'blocks[0].summary';
const LEADING_ID_PATH = 'blocks[0].leading_option_id';

describe('the licence binds on the block surface (founder turn 2, deployed 9de184f)', () => {
  /**
   * PRECONDITION, PINNED IN-TEST (CLAUDE.md trap 13b). A guard whose
   * discriminating power depends on a fixture nothing pins is decorative: if
   * this fixture were ever replaced by a licensed capture, every assertion
   * below would pass while testing nothing.
   */
  it('the captured payload is genuinely UNLICENSED and genuinely makes the claim', () => {
    const body = capturedTurn2();
    const admission = (
      (body as unknown as Record<string, unknown>).analysis_ready as Record<string, unknown>
    ).analysis_admission as Record<string, unknown>;

    expect(admission.permitted_analysis_mode).toBe('quantified_provisional');
    expect(String(admission.permitted_analysis_mode)).not.toBe('comparative_leader');

    // The admission states the rule the same payload breaks. Bound by identity
    // to the message, not to a substring another reason could satisfy.
    const messages = (admission.reasons as ReadonlyArray<Record<string, unknown>>).map((r) =>
      String(r.message),
    );
    expect(messages.some((m) => m.includes('no option can be called the leader'))).toBe(true);

    // And the claim is present, by identity: exact path, exact roster label,
    // exact vocabulary — never a value predicate another object could satisfy.
    const blocks = (body as unknown as Record<string, unknown>).blocks as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(blocks[0].type).toBe('analysis_result');
    expect(String(blocks[0].summary)).toContain(
      'ICP Validation Sprint Before Hiring came out ahead',
    );
    expect(blocks[0].leading_option_id).toBe('501e2731');
  });

  /**
   * ⭐ THE RED. At pristine this FAILS, and it names the surfaces by path.
   */
  it('WITHHELD: no leader claim survives on any block surface', () => {
    const body = capturedTurn2();
    const { response } = enforceLeadingOptionClaimsAtWire(body, opts(body, true));

    const residue = findLeaderClaims(response);
    const blockResidue = residue.filter((h) => h.path.startsWith('blocks['));

    // Named, not counted: a bare count would pass if the set changed identity.
    const paths = blockResidue.map((h) => h.path);
    expect(paths).not.toContain(SUMMARY_PATH);
    expect(paths).not.toContain(LEADING_ID_PATH);

    const blocks = (response as unknown as Record<string, unknown>).blocks as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(String(blocks[0].summary)).not.toContain('came out ahead');
    // `leading_option_id` is REQUIRED by the boundary schema and NULLABLE — so
    // the honest withheld value is `null`, never a deleted key (which would
    // fail egress validation) and never a substituted id (which would be
    // invention, not suppression).
    expect(blocks[0].leading_option_id).toBeNull();

    // The enrichment blobs that carried 16 of the 28 designations on this turn.
    const enrichment = blocks[0].enrichment as Record<string, unknown> | undefined;
    if (enrichment !== undefined) {
      const robustness = enrichment.robustness as Record<string, unknown> | undefined;
      if (robustness !== undefined) {
        expect(robustness).not.toHaveProperty('recommended_option_id');
        expect(robustness).not.toHaveProperty('recommended_option_label');
      }
    }

    // The whole block surface, stated as the invariant rather than as the
    // instances found: write the invariant against the SPEC (CLAUDE.md 13d).
    expect(blockResidue).toEqual([]);
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN. Same bytes, licence moved. A genuine leader
   * claim MUST still ship — suppressing everything is a gap, not a fix.
   */
  it('LICENSED (comparative_leader): the same payload is returned BY REFERENCE, untouched', () => {
    const licensed = withLicence(capturedTurn2(), 'comparative_leader');
    const result = enforceLeadingOptionClaimsAtWire(licensed, opts(licensed, true));

    // Byte identity by REFERENCE is the strongest available statement that the
    // licensed path is untouched — a deep-equal would pass on a rebuilt clone.
    expect(result.response).toBe(licensed);
    expect(result.changed).toBe(false);
    expect(result.editedFields).toEqual([]);

    const blocks = (result.response as unknown as Record<string, unknown>).blocks as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(String(blocks[0].summary)).toContain(
      'ICP Validation Sprint Before Hiring came out ahead',
    );
    expect(blocks[0].leading_option_id).toBe('501e2731');
  });

  /**
   * The turn's ENTITLEMENT half, on its own, must still withhold — the two
   * operands answer different questions and either one withholding is
   * sufficient. This is the arm that proves the conjunction did not collapse
   * into a single operand while the scope was being widened.
   */
  it('LICENSED MODE but UNENTITLED TURN: the block surface is still suppressed', () => {
    const licensed = withLicence(capturedTurn2(), 'comparative_leader');
    const { response } = enforceLeadingOptionClaimsAtWire(licensed, opts(licensed, false));

    const blocks = (response as unknown as Record<string, unknown>).blocks as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(String(blocks[0].summary)).not.toContain('came out ahead');
    expect(blocks[0].leading_option_id).toBeNull();
  });

  /**
   * SCOPE, STATED NOT IMPLIED. `priority_rank` is CARD DISPLAY ORDERING
   * (`phase3-blocks.ts` emits 1, 10, 15, 20, 30+idx, 100+idx, 200+idx — values
   * far outside any 4-option ordinal), NOT an option designation. The witness
   * harness counted it among the claims; that was an over-read, and suppressing
   * it would destroy the ordering of every review card on every withheld turn.
   *
   * This arm exists so the over-suppression is caught if anyone "fixes" the
   * scope by widening the key vocabulary.
   */
  it('does NOT suppress `priority_rank` — it is card ordering, not a designation', () => {
    const body = capturedTurn2();
    const before = (
      (body as unknown as Record<string, unknown>).blocks as ReadonlyArray<Record<string, unknown>>
    ).map((b) => b.priority_rank);
    const { response } = enforceLeadingOptionClaimsAtWire(body, opts(body, true));
    const after = (
      (response as unknown as Record<string, unknown>).blocks as ReadonlyArray<
        Record<string, unknown>
      >
    ).map((b) => b.priority_rank);

    expect(after).toEqual(before);
    // Positive control: the fixture really does carry ranks, so this arm cannot
    // pass vacuously on a payload that had none.
    expect(before.filter((r) => typeof r === 'number').length).toBeGreaterThan(0);
  });
});
