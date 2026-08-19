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

    const bullet = bulletFor(lines, 'hold the line on cloud-only for another…');
    expect(bullet).toBe('• hold the line on cloud-only for another…');
    // Whole output, marker included, fits the cap.
    expect((bullet as string).slice('• '.length).length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(bulletFor(lines, WITNESSED_3)).toBeUndefined();
  });

  it('elides the 90-char goal in the confirm sentence with an ellipsis, inside the 80-char goal cap', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: USER_GOAL_90 },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);

    const elidedGoal =
      'Several of our largest enterprise customers are asking for a self-hosted…';
    expect(lines[0]).toBe(`I've built a first decision model for "${elidedGoal}".`);
    expect(elidedGoal.length).toBeLessThanOrEqual(MAX_GOAL_CHARS);
    expect(lines[0]).not.toContain(`"${WITNESSED_2}"`);
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
      [USER_OPTION_44, 'hold the line on cloud-only for another…'],
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

  it('the PRODUCT confirm sentence passes the oracle for the 90-char goal', () => {
    const lines = narrativeLines([
      { id: GOAL_ID, kind: 'goal', label: USER_GOAL_90 },
      { id: OPT_44_ID, kind: 'option', label: 'Ship it' },
    ]);
    const match = /^I've built a first decision model for "(.+)"\.$/.exec(lines[0] ?? '');
    expect(match, `confirm sentence not matched: ${JSON.stringify(lines[0])}`).not.toBeNull();
    const rendered = (match as RegExpExecArray)[1];
    expect(rendered.length, 'rendered goal must be non-empty').toBeGreaterThan(0);
    expect(isHonestElision(USER_GOAL_90, rendered)).toBe(true);
  });
});
