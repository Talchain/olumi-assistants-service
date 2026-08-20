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
 * THE FOUR WITNESSED STRINGS (COMPOSED-JOURNEY-WITNESS-2026-08-18-B links
 * 2(c) and 4; each reproduced byte-for-byte by executing the pristine bodies
 * at `877affe2` before this spec was written):
 *   1. `double down on enterprise sales (higher`                       @40
 *   2. `Several of our largest enterprise customers are asking for a self-hosted` @80
 *   3. `hold the line on cloud-only for another`                       @40
 *   4. `Configure double down on enterprise sales (higher…`            chip
 * String 4 is the one PR #1038's corpus omits entirely, and it is the
 * counter-example to that PR's doc claim that every ellipsis-appending helper
 * is therefore innocent. An ellipsis does not close a bracket.
 */
import { describe, it, expect } from 'vitest';
import { buildPostDraftNarrative } from '../post-draft-narrative.js';
import {
  buildReadinessRecoveryChip,
  projectReadinessRecovery,
} from '../readiness-recovery.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

// ---------------------------------------------------------------------------
// The user's own words, verbatim from the 18 Aug composed-journey witness.
// These are RECORDS of what a real brief produced. Append to them; never edit
// them to keep a suite green.
// ---------------------------------------------------------------------------

/** 85 characters. `label === source_quote` on the wire. */
const USER_OPTION_85 =
  'double down on enterprise sales (higher margins but longer cycles and more headcount)';

/** 101 characters. The second user-stated option; absent from #1038's corpus. */
const USER_OPTION_101 =
  'invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)';

/** 44 characters — just over the 40-char label cap. */
const USER_OPTION_44 = 'hold the line on cloud-only for another year';

/** 90 characters — exercises the 80-char GOAL cap, not the label cap. */
const USER_GOAL_90 =
  'Several of our largest enterprise customers are asking for a self-hosted deployment option';

/**
 * The "too aggressive" inverse. A delimiter-aware back-off that ignores the
 * retention floor collapses this to `Migrate…` — every word the user wrote
 * except one, discarded to close a bracket.
 */
const NESTED_PARENTHETICAL =
  'Migrate (everything except the payments platform … which is a lot)';

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
const UNBREAKABLE_GOAL_94 =
  'A comprehensive-restructuring-of-the-entire-commercial-organisation-across-every-single-region';

/** What each one must render as, once cut to its cap and marked. */
const UNBREAKABLE_LABEL_76_ELIDED = 'Self-hosted/on-premise-deployment-for-r…';
const UNBREAKABLE_GOAL_94_ELIDED =
  'A comprehensive-restructuring-of-the-entire-commercial-organisation-across-ever…';

// --- the exact strings a user was shown, which must never reappear ---------
const WITNESSED_1 = 'double down on enterprise sales (higher';
const WITNESSED_2 =
  'Several of our largest enterprise customers are asking for a self-hosted';
const WITNESSED_3 = 'hold the line on cloud-only for another';
const WITNESSED_4 = 'Configure double down on enterprise sales (higher…';

const MAX_LABEL_CHARS = 40;
const MAX_GOAL_CHARS = 80;

function makeGraph(nodes: unknown[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

/**
 * Bind by IDENTITY. Every fixture node carries a unique id, and each
 * assertion below names the id whose label it is checking, so a different
 * node satisfying the same value predicate cannot pass the test for it.
 */
const GOAL_ID = 'goal_n26';
const OPT_85_ID = 'opt_n26_85';
const OPT_101_ID = 'opt_n26_101';
const OPT_44_ID = 'opt_n26_44';
const OPT_NESTED_ID = 'opt_n26_nested';
const OPT_UNBREAKABLE_ID = 'opt_n26_unbreakable';

function narrativeLines(nodes: unknown[]): string[] {
  const result = buildPostDraftNarrative({
    graph: makeGraph(nodes),
    analysisReady: { status: 'ready' },
  });
  expect(result.text.length, 'narrative must be non-empty').toBeGreaterThan(0);
  return result.text.split('\n');
}

/** The bullet line the options block renders for one option label. */
function bulletFor(lines: readonly string[], label: string): string | undefined {
  return lines.find((line) => line === `• ${label}`);
}

describe('N26 — post-draft narrative elides user labels honestly', () => {
  it('renders the 85-char user option as a closed phrase with an ellipsis, not the witnessed unclosed bracket', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: 'Choose a growth strategy' },
      { id: OPT_85_ID, kind: 'option', label: USER_OPTION_85 },
      { id: OPT_44_ID, kind: 'option', label: USER_OPTION_44 },
    ]);

    // Identity: the bullet for THIS option, matched as a whole line.
    expect(bulletFor(lines, 'double down on enterprise sales…')).toBe(
      '• double down on enterprise sales…',
    );
    // The witnessed byte string must be absent as a whole bullet line.
    expect(bulletFor(lines, WITNESSED_1)).toBeUndefined();
    expect(lines.join('\n')).not.toContain(WITNESSED_1);
  });

  it('renders the 101-char user option with an ellipsis (the label #1038 never tested)', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: 'Choose a growth strategy' },
      { id: OPT_101_ID, kind: 'option', label: USER_OPTION_101 },
      { id: OPT_44_ID, kind: 'option', label: USER_OPTION_44 },
    ]);

    expect(bulletFor(lines, 'invest heavily in a self-serve product…')).toBe(
      '• invest heavily in a self-serve product…',
    );
    // Pristine emitted the same prefix with NO marker at all.
    expect(bulletFor(lines, 'invest heavily in a self-serve product')).toBeUndefined();
  });

  it('renders the 44-char user option with an ellipsis and inside the 40-char cap', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: 'Choose a growth strategy' },
      { id: OPT_44_ID, kind: 'option', label: USER_OPTION_44 },
      { id: OPT_85_ID, kind: 'option', label: USER_OPTION_85 },
    ]);

    /**
     * ⚠ EXPECTATION UPDATED BY UX-GATE-4 (20 Aug 2026), not weakened.
     *
     * N26 pinned `"hold the line on cloud-only for another…"` — a cut that is
     * honest about eliding and lands on a word boundary, which is all N26
     * claimed. The UX gate then re-witnessed this exact string on 19 AND 20
     * August and ruled it still defective: `another` is a determiner with no
     * noun, so the cut is mid-PHRASE and the marker reads as a broken
     * sentence. `utils/label-elision.ts` now rejects a head ending on a
     * closed-class function word.
     *
     * The superseded expectation is kept below as a NEGATIVE pin rather than
     * deleted, so this test REDs if the old cut ever comes back.
     */
    const bullet = bulletFor(lines, 'hold the line on cloud-only…');
    expect(bullet).toBe('• hold the line on cloud-only…');
    // Whole output, marker included, fits the cap.
    expect((bullet as string).slice('• '.length).length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(bulletFor(lines, WITNESSED_3)).toBeUndefined();
    // The N26-era cut is now itself a defect: pin it as unreachable.
    expect(lines.join('\n')).not.toContain('hold the line on cloud-only for another…');
  });

  it('does NOT quote the 90-char goal at all — a fragment cannot keep the quotation mark\'s promise', () => {
    /**
     * ⚠ EXPECTATION SUPERSEDED BY UX-GATE-4 (20 Aug 2026), not weakened.
     *
     * N26 pinned the elided quotation
     * `"…are asking for a self-hosted…"`, which is an HONEST elision and all
     * N26 claimed. The UX gate then ruled the SENTENCE defective rather than
     * the cut: quotation marks promise "these are your words", and a fragment
     * cannot keep that promise.
     *
     * ⛔ The elider is NOT changed — extending it was run and refused
     * (`label-elision.ts:215-232`). The suppression happens at THIS seam.
     * Derived: every over-budget goal label in the frozen governed corpus is
     * one `deriveGoalObjectiveLabel` REFUSED to author, so there is no
     * objective to announce. See `goal-quotation-whole-or-none.test.ts`.
     *
     * Both superseded strings are kept below as NEGATIVE pins rather than
     * deleted, so this test REDs if either cut ever comes back.
     */
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: USER_GOAL_90 },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);

    expect(lines[0]).toBe("I've built a first decision model from your brief.");

    // The N26-era elided quotation is now itself a defect: pin it unreachable.
    const n26ElidedGoal =
      'Several of our largest enterprise customers are asking for a self-hosted…';
    expect(lines[0]).not.toContain(n26ElidedGoal);
    // And the pristine, unmarked cut stays unreachable too.
    expect(lines[0]).not.toContain(`"${WITNESSED_2}"`);
    expect(lines[0]).not.toContain(WITNESSED_2);
    // No quotation mark at all on this opener — there is nothing to quote.
    expect(lines[0]).not.toContain('"');
  });

  it('OPPOSITE DIRECTION — a goal INSIDE the cap is still quoted verbatim, with no marker', () => {
    // The rule must not creep inward: suppression fires only where a whole
    // quotation is impossible.
    const fittingGoal = 'Several of our largest enterprise customers want self-hosting';
    expect(fittingGoal.length).toBeLessThanOrEqual(MAX_GOAL_CHARS);
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: fittingGoal },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);
    expect(lines[0]).toBe(`I've built a first decision model for "${fittingGoal}".`);
    expect(lines[0]).not.toContain('…');
  });

  it('leaves a label that already fits completely untouched — no marker when nothing was cut', () => {
    const shortLabel = 'Status Quo: Hold current strategy';
    expect(shortLabel.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: 'Choose a growth strategy' },
      { id: 'opt_short', kind: 'option', label: shortLabel },
      { id: OPT_44_ID, kind: 'option', label: USER_OPTION_44 },
    ]);
    expect(bulletFor(lines, shortLabel)).toBe(`• ${shortLabel}`);
    expect(bulletFor(lines, `${shortLabel}…`)).toBeUndefined();
  });

  it('INVERSE (a) — too aggressive: honours the retention floor rather than collapsing to a stub', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: 'Choose a migration path' },
      { id: OPT_NESTED_ID, kind: 'option', label: NESTED_PARENTHETICAL },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);

    const bullet = lines.find((line) => line.startsWith('• Migrate'));
    expect(bullet, 'the Migrate option must still render a bullet').toBeTypeOf('string');
    const rendered = (bullet as string).slice('• '.length);

    // The stub the delimiter rule alone would produce.
    expect(rendered).not.toBe('Migrate…');
    // Retention floor: at least half the 40-char budget survives.
    expect(rendered.length).toBeGreaterThanOrEqual(Math.ceil((MAX_LABEL_CHARS - 1) * 0.5));
    expect(rendered.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(rendered.endsWith('…')).toBe(true);
    // Still a genuine prefix of what the user wrote.
    expect(NESTED_PARENTHETICAL.startsWith(rendered.slice(0, -1))).toBe(true);
  });

  it('INVERSE (b) — too permissive: a label whose only boundaries sit below the floor is still cut to the cap and marked, at BOTH caps', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: UNBREAKABLE_GOAL_94 },
      { id: OPT_UNBREAKABLE_ID, kind: 'option', label: UNBREAKABLE_LABEL_76 },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);

    // Identity: the bullet for THIS option, matched as a whole line, by exact
    // string — not a length predicate another bullet could satisfy.
    expect(bulletFor(lines, UNBREAKABLE_LABEL_76_ELIDED)).toBe(
      `• ${UNBREAKABLE_LABEL_76_ELIDED}`,
    );
    // The un-clipped overrun this branch used to hand the caller is absent.
    expect(bulletFor(lines, UNBREAKABLE_LABEL_76)).toBeUndefined();
    expect(lines.join('\n')).not.toContain(UNBREAKABLE_LABEL_76);
    expect(UNBREAKABLE_LABEL_76_ELIDED.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(UNBREAKABLE_LABEL_76_ELIDED.endsWith('…')).toBe(true);

    // Goal-cap twin, same class — UX-GATE-4: the OPENER suppresses rather than
    // quoting a fragment, so the goal half of this case moves to the fallback.
    // The elider's own last-resort branch is unchanged and still pinned, at
    // `label-elision.test.ts` and by the elision assertion below.
    expect(lines[0]).toBe("I've built a first decision model from your brief.");
    expect(lines[0]).not.toContain(UNBREAKABLE_GOAL_94);
    expect(lines[0]).not.toContain(UNBREAKABLE_GOAL_94_ELIDED);

    // ⚠ The matching POSITIVE pin — that the elider still produces
    // `UNBREAKABLE_GOAL_94_ELIDED` for this input, so the suppression is a
    // SEAM change and not a silent edit to the module — deliberately lives in
    // `goal-quotation-whole-or-none.test.ts`, which may import the elider.
    // This file must not (see the header): importing it would make the file
    // fail to COLLECT at a pristine tip, which is not a behavioural red.
    expect(UNBREAKABLE_GOAL_94_ELIDED.length).toBeLessThanOrEqual(MAX_GOAL_CHARS);

    // Both are still honest prefixes of what the user wrote.
    expect(UNBREAKABLE_LABEL_76.startsWith(UNBREAKABLE_LABEL_76_ELIDED.slice(0, -1))).toBe(true);
    expect(UNBREAKABLE_GOAL_94.startsWith(UNBREAKABLE_GOAL_94_ELIDED.slice(0, -1))).toBe(true);
  });
});

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

  it('the PRODUCT output passes the oracle for all three witnessed option labels', () => {
    const optionCases: ReadonlyArray<readonly [string, string]> = [
      [USER_OPTION_85, 'double down on enterprise sales…'],
      [USER_OPTION_101, 'invest heavily in a self-serve product…'],
      // UX-GATE-4: was `…for another…`; the trailing determiner is now backed
      // off. The oracle below is unchanged and still passes, which is the
      // point — the new cut is a prefix of the same source, only an honest one.
      [USER_OPTION_44, 'hold the line on cloud-only…'],
    ];
    expect(optionCases.length, 'option corpus must be non-empty').toBe(3);

    for (const [source, expected] of optionCases) {
      const lines = narrativeLines([
        { id: GOAL_ID, kind: 'goal', label: 'Choose a growth strategy' },
        { id: 'opt_under_test', kind: 'option', label: source },
        { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
      ]);
      const bullet = bulletFor(lines, expected);
      expect(bullet, `product must render ${JSON.stringify(expected)}`).toBe(`• ${expected}`);
      expect(
        isHonestElision(source, expected),
        `oracle on ${JSON.stringify(expected)}`,
      ).toBe(true);
    }
  });

  it('the PRODUCT confirm sentence quotes a WHOLE goal, and the oracle is not consulted because nothing was elided', () => {
    /**
     * ⚠ RE-AIMED BY UX-GATE-4 (20 Aug 2026). This case used to assert that the
     * 90-char goal's quotation was an HONEST elision. It was — and the gate
     * ruled the sentence defective anyway, because quotation marks promise
     * "these are your words" and no fragment can keep that promise. The opener
     * now quotes whole or not at all, so the oracle's job here changes from
     * "was the elision honest?" to "is the quoted span the goal, entire?".
     *
     * The oracle itself is UNCHANGED and still load-bearing for the OPTION
     * bullets in the case above, which do still elide at 40.
     */
    const fittingGoal = 'Several of our largest enterprise customers want self-hosting';
    expect(fittingGoal.length).toBeLessThanOrEqual(MAX_GOAL_CHARS);
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: fittingGoal },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);
    const match = /^I've built a first decision model for "(.+)"\.$/.exec(lines[0] ?? '');
    expect(match, `confirm sentence not matched: ${JSON.stringify(lines[0])}`).not.toBeNull();
    const rendered = (match as RegExpExecArray)[1];
    // Whole, not elided: identical to the label, and the oracle CONVICTS it as
    // an elision precisely because there is no marker — the discrimination.
    expect(rendered).toBe(fittingGoal);
    expect(isHonestElision(fittingGoal, rendered)).toBe(false);
  });

  it('and the over-budget goal produces NO quotation for the oracle to judge', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: USER_GOAL_90 },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);
    expect(/^I've built a first decision model for "(.+)"\.$/.exec(lines[0] ?? '')).toBeNull();
    expect(lines[0]).toBe("I've built a first decision model from your brief.");
  });
});
