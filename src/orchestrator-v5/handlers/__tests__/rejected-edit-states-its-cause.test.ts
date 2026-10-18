/**
 * ⭐⭐⭐ A REJECTED EDIT NOW SAYS WHY, AND LEAVES A ROUTE.
 *
 * Witnessed on staging, 16 Sep 2026. After three turns in which Olumi agreed
 * twice that a morale risk belonged in the model:
 *
 *   USER:  "Update the model to reflect all of this, then."
 *   OLUMI: "I couldn't take that change forward, so the model is unchanged..."
 *   USER:  "What's one update based on this discussion that you recommend we
 *           make now?"
 *   OLUMI: (BYTE-IDENTICAL SAME SENTENCE)
 *
 * One sentence answered an EDIT request and an ADVICE request identically,
 * with no cause and no onward action. The user's conversation was lost.
 *
 * ⛔ THE CAUSE WAS NEVER MISSING. `publicReason.blocker_code` is computed on the
 * same object, one line from the sentence, and was emitted to the wire's
 * machine block, to telemetry and to the log — everywhere except to the person.
 *
 * ⚠ INSTRUMENT NOTE: `edit-graph-referee-gate.ts` carries a deliberate NUL
 * sentinel, so `file(1)` calls it `data` and PLAIN GREP IS BLIND TO IT
 * (CLAUDE.md trap 17). Verified while writing this: `grep -c` failed on a
 * string `rg -a -c` found twice. Any sweep of that file must use `rg -a`, and
 * a reviewer must fetch it rather than read `gh pr diff`, which renders it
 * binary.
 */
import { describe, expect, it } from 'vitest';

import {
  GM_REJECTED_ASSISTANT_TEXT,
  GM_REJECTED_COPY_BY_BLOCKER_CODE,
  selectRejectedAssistantText,
} from '../edit-graph-referee-gate.js';

const ALL_COPY = [
  GM_REJECTED_ASSISTANT_TEXT,
  ...Object.values(GM_REJECTED_COPY_BY_BLOCKER_CODE),
];

// ── R1/R2 — the cause reaches the person, and absence is not invented ───────

describe('R1 — a known cause is stated, an unknown one falls back truthfully', () => {
  it('R1a a mapped blocker code gets its OWN sentence, not the generic one', () => {
    for (const code of Object.keys(GM_REJECTED_COPY_BY_BLOCKER_CODE)) {
      const text = selectRejectedAssistantText(code);
      expect(text, `${code} must be distinguishable`).not.toBe(GM_REJECTED_ASSISTANT_TEXT);
      expect(text).toBe(GM_REJECTED_COPY_BY_BLOCKER_CODE[code]);
    }
  });

  it('R1b PRECONDITION: the mapped codes are real codes the referee emits', () => {
    // A map keyed on invented codes would pass R1a while never firing in
    // production — a guard agreeing with itself.
    for (const code of ['ENTITY_NOT_FOUND', 'ENTITY_ID_COLLISION', 'READINESS_DOWNGRADE']) {
      expect(Object.keys(GM_REJECTED_COPY_BY_BLOCKER_CODE)).toContain(code);
    }
  });

  it('R1c an UNMAPPED code falls back to the generic sentence, which is still true', () => {
    for (const unknown of ['SOME_FUTURE_CODE', '', null, undefined, 42, {}]) {
      expect(selectRejectedAssistantText(unknown)).toBe(GM_REJECTED_ASSISTANT_TEXT);
    }
  });

  it('R1d every sentence still states that nothing changed', () => {
    // The one thing the old copy got right, and the thing a user most needs.
    for (const text of ALL_COPY) {
      expect(text.toLowerCase(), text.slice(0, 40)).toContain('unchanged');
    }
  });
});

/**
 * ⛔ R3 (the onward chip) IS DELIBERATELY ABSENT FROM THIS SPEC.
 *
 * The chip shipped here first and turned `structural-edit-batch-atomicity
 * .test.ts:182` red — an assertion that a rejected batch carries no chips,
 * written under the name "no chip to confirm". I established that the harm
 * that guard prevents is a confirmable PENDING (resumption is gated on
 * `pendingActions`, not chips) and that this arm leaves pendings null, so the
 * assertion is a proxy rather than the invariant.
 *
 * That is an argument for narrowing another lane's safety assertion, and it is
 * not one to act on unreviewed as the author of the change it blocks. The
 * cause ships; the route is a separate reviewed change. Tests for the chip
 * belong with it, not here asserting behaviour that no longer exists.
 */

// ── R5 — authorship: true on an advice turn as well as an edit turn ────────

describe('R5 — no sentence blames the user for a request they may not have made', () => {
  it('R5a ⭐ nothing attributes the attempted change to the user', () => {
    // This arm CANNOT tell an edit turn from an advice turn: the evaluation
    // input carries no intent field. So every sentence must be true when the
    // user asked for nothing at all. "The node YOU asked to rename does not
    // exist" is a false statement about a request that was never made.
    const FORBIDDEN = [
      /\byou asked\b/i,
      /\byour request\b/i,
      /\byou requested\b/i,
      /\byou wanted\b/i,
      /\bthe change you\b/i,
      /\byou tried\b/i,
    ];
    for (const text of ALL_COPY) {
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(text), `"${text.slice(0, 50)}" attributes to the user`).toBe(false);
      }
    }
  });

  it('R5b every sentence offers to talk it through, so an advice turn is answered', () => {
    for (const text of ALL_COPY) {
      expect(text.toLowerCase(), text.slice(0, 40)).toMatch(/suggest|talk through|tell me/);
    }
  });
});

// ── R6 — the lane's inherited copy constraints ─────────────────────────────

describe('R6 — copy obeys the constraints this lane already carries', () => {
  it('R6a no em dashes', () => {
    for (const text of ALL_COPY) expect(text).not.toContain('—');
  });

  it('R6b no backticks, ids, or internal vocabulary leaking from diagnostics', () => {
    // `blocker_readable` carries exactly this ("top-level `options`", "failed
    // schema validation"), which is why it is NOT passed through verbatim.
    for (const text of ALL_COPY) {
      expect(text).not.toContain('`');
      expect(text).not.toMatch(/\b(schema|validation|node id|edge id|candidate|hash)\b/i);
    }
  });

  it('R6c no success claim — nothing here may read as though a change landed', () => {
    for (const text of ALL_COPY) {
      expect(text).not.toMatch(/\b(applied|updated|saved|added it|has been)\b/i);
    }
  });
});
