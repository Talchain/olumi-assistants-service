/**
 * N26 ACCEPTANCE — the two user-reachable label truncators tell the truth.
 *
 * ⭐ THIS FILE DELIBERATELY DOES NOT IMPORT `utils/label-elision.js`.
 * A spec that imports the new symbol REDs at pristine with a MODULE-RESOLUTION
 * error, and a file that fails to COLLECT is not a behavioural red — it proves
 * only that a file is absent. Every assertion here runs through a PRODUCT
 * ENTRY POINT that shipped at staging `877affe2`:
 *   `buildPostDraftNarrative`  (post-draft assistant_text)
 *   `projectReadinessRecovery` / `buildReadinessRecoveryChip`  (the chip)
 * so at pristine this file collects, runs, and fails on the exact bytes a
 * user was shown.
 *
 * THE FOUR WITNESSED STRINGS — each reproduced byte-for-byte by executing the
 * pristine bodies at `877affe2` before this spec was written.
 *
 * ⚠ CITATION CORRECTED 20 Aug 2026 — TWO DOCUMENTS, NOT ONE. This header
 * attributed all four to `COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`. Strings 2
 * and 3 are not in that document: it has ZERO hits for `self-hosted`, `hold
 * the line` and `cloud-only` (contrast control `double down` fires 7 times, so
 * the sweep could see). They come from `UX-GATE-2026-08-18.md` — a different
 * document, a different brief, a different journey.
 *
 * ⭐ WHY THIS MATTERED ENOUGH TO FIX: a citation to the WRONG document is
 * worse than no citation. The next reader opens the named file, cannot find
 * the claim, and concludes the claim was FABRICATED rather than mis-cited —
 * so a correct finding gets discarded. Neither document is touched; only the
 * pointer is.
 *
 *   1. `double down on enterprise sales (higher`                       @40
 *      → COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md, links 2(c) and 4
 *   2. `Several of our largest enterprise customers are asking for a self-hosted` @80
 *      → UX-GATE-2026-08-18.md
 *   3. `hold the line on cloud-only for another`                       @40
 *      → UX-GATE-2026-08-18.md
 *   4. `Configure double down on enterprise sales (higher…`            chip
 *      → COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md, links 2(c) and 4
 *
 * ⚠ String 2 is ALSO the point at which this seam stopped being an elision
 * problem. `UX-GATE-2026-08-18.md` diagnoses it in its own words — "a raw
 * sentence lifted from the brief … a stated fact, not a goal" — and
 * `deriveGoalObjectiveLabel` REFUSES to author an objective from it. The
 * opener therefore quotes nothing at all now; see
 * `goal-quotation-whole-or-none.test.ts`.
 * String 4 is the one PR #1038's corpus omits entirely, and it is the
 * counter-example to that PR's doc claim that every ellipsis-appending helper
 * is therefore innocent. An ellipsis does not close a bracket.
 */
import { describe,expect,it } from 'vitest';

import {
buildReadinessRecoveryChip,
projectReadinessRecovery,
} from '../readiness-recovery.js';

// ---------------------------------------------------------------------------
// The user's own words, verbatim from the TWO 18 Aug witnesses named in the
// header — the option labels and the chip from COMPOSED-JOURNEY-WITNESS-
// 2026-08-18-B.md, the goal from UX-GATE-2026-08-18.md. (This line used to say
// "the 18 Aug composed-journey witness", singular, which is the same
// mis-attribution the header corrects.)
// These are RECORDS of what a real brief produced. Append to them; never edit
// them to keep a suite green.
// ---------------------------------------------------------------------------

/** 85 characters. `label === source_quote` on the wire. */
const USER_OPTION_85 =
  'double down on enterprise sales (higher margins but longer cycles and more headcount)';

/** 101 characters. The second user-stated option; absent from #1038's corpus. */


/** 44 characters — just over the 40-char label cap. */


/** 90 characters — exercises the 80-char GOAL cap, not the label cap. */


/**
 * The "too aggressive" inverse. A delimiter-aware back-off that ignores the
 * retention floor collapses this to `Migrate…` — every word the user wrote
 * except one, discarded to close a bracket.
 */


/**
 * The "too permissive" inverse, AT THE CALLERS — the branch every existing
 * cap assertion in this file is structurally blind to.
 *
 * Both of these are labels whose only word boundaries sit BELOW the retention
 * floor (the first has none at all; the second has one, at index 1). They
 * therefore reach the elider's last-resort branch, which is the one branch no
 * other case here exercises: the caps asserted at the tests above only ever
 * run on labels that elide normally, so a last-resort overrun stays invisible
 * to all of them. Recorded here as CALLER-level cases, by exact string, so the
 * budget the user's screen actually has is pinned at the seam that renders it.
 */
const UNBREAKABLE_LABEL_76 =
  'Self-hosted/on-premise-deployment-for-regulated-financial-services-customers';

/** The goal-cap twin of the same class, exercised at `MAX_GOAL_CHARS`. */


/** What each one must render as, once cut to its cap and marked. */
const UNBREAKABLE_LABEL_76_ELIDED = 'Self-hosted/on-premise-deployment-for-r…';


// --- the exact strings a user was shown, which must never reappear ---------
const WITNESSED_1 = 'double down on enterprise sales (higher';


const WITNESSED_4 = 'Configure double down on enterprise sales (higher…';

const MAX_LABEL_CHARS = 40;




/**
 * Bind by IDENTITY. Every fixture node carries a unique id, and each
 * assertion below names the id whose label it is checking, so a different
 * node satisfying the same value predicate cannot pass the test for it.
 */

const OPT_85_ID = 'opt_n26_85';



const OPT_UNBREAKABLE_ID = 'opt_n26_unbreakable';



/** The bullet line the options block renders for one option label. */




describe('N26 — the readiness-recovery chip elides the same label the same way', () => {
  const analysisReady = {
    status: 'needs_encoding' as const,
    options: [{ id: OPT_85_ID, status: 'needs_encoding' as const }],
  };
  const nodes = [{ id: OPT_85_ID, kind: 'option', label: USER_OPTION_85 }];

  it('projects the option label with a closed phrase and an ellipsis', () => {
    const projection = projectReadinessRecovery(analysisReady, nodes);
    expect(projection.kind).toBe('encode_option');
    // Identity: this projection resolved the label of node OPT_85_ID.
    expect(projection.optionLabel).toBe('double down on enterprise sales…');
    expect(projection.optionLabel).not.toBe('double down on enterprise sales (higher…');
  });

  it('WITNESSED STRING 4 — the chip label no longer ships an unclosed bracket', () => {
    const chip = buildReadinessRecoveryChip(analysisReady, nodes);
    expect(chip, 'a non-ready status must produce a chip').not.toBeNull();
    expect((chip as { id: string }).id).toBe('chip_prompt_configure_option');
    expect((chip as { label: string }).label).toBe(
      'Configure double down on enterprise sales…',
    );
    expect((chip as { label: string }).label).not.toBe(WITNESSED_4);
  });

  it('carries the elision into the recovery next-step sentence too', () => {
    const projection = projectReadinessRecovery(analysisReady, nodes);
    expect(projection.nextStep).toContain('"double down on enterprise sales…"');
    expect(projection.nextStep).not.toContain('(higher…');
  });

  it('leaves a label inside the cap untouched, so the chip carries no marker', () => {
    const shortId = 'opt_short_chip';
    const chip = buildReadinessRecoveryChip(
      { status: 'needs_encoding', options: [{ id: shortId, status: 'needs_encoding' }] },
      [{ id: shortId, kind: 'option', label: 'Status Quo: Hold current strategy' }],
    );
    expect((chip as { label: string }).label).toBe(
      'Configure Status Quo: Hold current strategy',
    );
  });

  it('INVERSE (b) — too permissive: the chip cuts a below-floor-boundary label to the cap and marks it', () => {
    const chip = buildReadinessRecoveryChip(
      { status: 'needs_encoding', options: [{ id: OPT_UNBREAKABLE_ID, status: 'needs_encoding' }] },
      [{ id: OPT_UNBREAKABLE_ID, kind: 'option', label: UNBREAKABLE_LABEL_76 }],
    );
    expect(chip, 'a non-ready status must produce a chip').not.toBeNull();
    // Identity: the configure chip for THIS option id.
    expect((chip as { id: string }).id).toBe('chip_prompt_configure_option');
    expect((chip as { label: string }).label).toBe(
      `Configure ${UNBREAKABLE_LABEL_76_ELIDED}`,
    );
    // The un-clipped overrun the chip used to ship is absent.
    expect((chip as { label: string }).label).not.toBe(`Configure ${UNBREAKABLE_LABEL_76}`);
    expect((chip as { label: string }).label).not.toContain(UNBREAKABLE_LABEL_76);

    const rendered = (chip as { label: string }).label.slice('Configure '.length);
    expect(rendered.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(rendered.endsWith('…')).toBe(true);
    expect(UNBREAKABLE_LABEL_76.startsWith(rendered.slice(0, -1))).toBe(true);
  });
});

describe('N26 — prefix relation controls (both directions)', () => {
  /**
   * An honest elision is a PREFIX of the source plus exactly one marker. This
   * predicate is written here, in the spec, on purpose: it is the ORACLE, and
   * it must not be borrowed from the implementation it judges.
   */
  function isHonestElision(source: string, rendered: string): boolean {
    if (!rendered.endsWith('…')) return false;
    const body = rendered.slice(0, -1);
    if (body.length === 0) return false;
    if (!source.startsWith(body)) return false;
    // A word boundary, not a mid-token cut: the next source character must be
    // whitespace (or the body must end exactly at the source's end).
    const next = source.charAt(body.length);
    return next === '' || /\s/.test(next);
  }

  it('acquits an honest elision', () => {
    expect(isHonestElision(USER_OPTION_85, 'double down on enterprise sales…')).toBe(true);
  });

  it('convicts a tidier substitution (words the user did not write)', () => {
    expect(isHonestElision(USER_OPTION_85, 'double down on enterprise selling…')).toBe(false);
  });

  it('convicts a mid-token cut', () => {
    expect(isHonestElision(USER_OPTION_85, 'double down on enterprise sal…')).toBe(false);
  });

  it('convicts an elision with no marker — the pristine seam-1 defect', () => {
    expect(isHonestElision(USER_OPTION_85, WITNESSED_1)).toBe(false);
  });






});
