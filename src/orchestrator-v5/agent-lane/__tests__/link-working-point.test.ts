/**
 * ⭐ G3 WORKING POINT (BUDDY-A 00:12Z / 02:58Z; DL-3 04:15Z): Olumi's working point from a link's brief range, on the link's own
 * frames, only where the convention holds (a yes/no source, the target's own unit, one un-negated construction range, a
 * placeholder). SYNTHETIC graph: a 0/1 switch onto a % level goal (the stated-range spec's shape).
 */
import { describe, expect, it } from 'vitest';
import { linkWorkingPointOf, linkWorkingPointWords, QUARTILES_APART_IN_SD } from '../link-working-point.js';
import { CONSTRUCTION_ATTEST, userStatementRecord, withUserStatement } from '../../statement-door/statements.js';

type Json = Record<string, any>;
const FROM = 'collection', TO = 'recycling';
const QUOTE = 'Our waste officer thinks weekly food collection could lift the rate by somewhere between 4 and 7 percentage points.';
const graph = (patch: { from?: Json; edge?: Json } = {}): Json => ({
  nodes: [
    { id: 'weekly', kind: 'option', label: 'Weekly food collection', interventions: { [FROM]: 1 } },
    { id: 'keep', kind: 'option', label: 'Keep fortnightly', interventions: { [FROM]: 0 } },
    { id: FROM, kind: 'factor', label: 'Weekly food collection running', observed_state: { value: 0, baseline: 0, raw_value: 0, unit: '0/1', cap: 1 }, ...patch.from },
    { id: TO, kind: 'goal', label: 'Household recycling rate', goal_direction: '>=', goal_threshold: 0.5, goal_threshold_raw: 50,
      goal_threshold_unit: '%', goal_threshold_frame: 'level', observed_state: { value: 0.42, baseline: 0.42, raw_value: 42, unit: '%', cap: 100 } },
  ],
  edges: [{ from: 'weekly', to: FROM, strength: { mean: 1, std: 0.01 } }, { from: 'keep', to: FROM, strength: { mean: 1, std: 0.01 } },
    { from: FROM, to: TO, strength: { mean: 0.1, std: 0.05 }, effect_direction: 'positive',
      provenance: { source: 'brief_extraction', magnitude: 'olumi_placeholder' }, defaulted: true, ...patch.edge }],
});
const subject = { kind: 'link' as const, id: FROM, to_id: TO, field: 'effect' as const };
const statement = (patch: Json = {}): Json => ({ speaker: 'user', reading: 'olumi', quote: QUOTE, source: QUOTE,
  subject: { quantity: `link|${FROM}|${TO}||effect` }, unit: 'percentage points', form: 'range', low: 4, high: 7, ...patch });
/** The range as construction records it (its attest), or without it (a chat press's own record). */
const withRange = (g: Json, statements: Json[] = [statement()], attest: typeof CONSTRUCTION_ATTEST | null = CONSTRUCTION_ATTEST): Json =>
  withUserStatement(g as never, userStatementRecord(subject, statements as never, '2026-10-17T00:00:00.000Z', attest ?? undefined), subject) as Json;

describe('Olumi\'s working point from a link\'s brief range', () => {
  it('⭐ a switch onto a % level, 4 to 7 points: mean the middle on the link\'s frame, the ends as inner quartiles', () => {
    const wp = linkWorkingPointOf(withRange(graph()), FROM, TO)!;
    expect(wp).toMatchObject({ from: FROM, to: TO, quote: QUOTE, low: 4, high: 7, unit: 'percentage points', band: 'weak' });
    expect(wp.mean).toBeCloseTo(0.055, 12);
    expect(wp.std).toBeCloseTo(0.03 / QUARTILES_APART_IN_SD, 12);
    expect(QUARTILES_APART_IN_SD).toBeCloseTo(1.349, 3);
  });

  it('⭐ a negative link keeps its direction: the working point is signed by it', () => {
    expect(linkWorkingPointOf(withRange(graph({ edge: { effect_direction: 'negative', strength: { mean: -0.1, std: 0.05 } } })), FROM, TO)?.mean).toBeCloseTo(-0.055, 12);
  });

  it('⭐ the words: the user\'s sentence whole, the reading as Olumi\'s, the convention as Olumi\'s, its limitation, what stays', () => {
    const g = withRange(graph());
    const words = linkWorkingPointWords(g, linkWorkingPointOf(g, FROM, TO)!);
    expect(words).toBe(`Your brief says: “${QUOTE}” Olumi reads it as a range of 4 percentage points to 7 percentage points for how much `
      + 'switching on ‘Weekly food collection running’ changes ‘Household recycling rate’, in the unit ‘Household recycling rate’ is measured '
      + 'in; any other qualifications or conditions in those words were not read. Olumi proposes a working point for this link, for this '
      + 'analysis: 5.5 percentage points, the middle of that range, with a spread that reads your two ends as the middle half of likely '
      + 'effects (about one chance in four below 4 percentage points and one in four above 7 percentage points). That reading is Olumi’s '
      + 'modelling convention, not something your words say, and not a measured calibration. Its limitation: the spread is symmetric '
      + 'around 5.5 percentage points with no outer limit, so effects beyond either end, and occasionally in the opposite direction, stay '
      + 'possible in the analysis. Your range stays recorded as you stated it, and a chance shown with this working point rests on it and '
      + 'stays provisional. Record this link to use Olumi’s working point, or change or reject it instead.');
  });

  it.each([
    ['a chat press\'s own record (no construction attest: Olumi\'s reading only, #3329)', () => withRange(graph(), [statement()], null)],
    ['a negated reading', () => withRange(graph(), [statement({ negated: true })])],
    ['two statements in the record', () => withRange(graph(), [statement(), statement({ low: 2, high: 3 })])],
    ['a unit that is not the target\'s own (months)', () => withRange(graph(), [statement({ unit: 'months' })])],
    ['a single figure (no range)', () => withRange(graph(), [statement({ form: 'point', low: 5, high: 5 })])],
    ['ends not ascending', () => withRange(graph(), [statement({ low: 7, high: 4 })])],
    ['a spread over the link writer\'s bound (0 to 90 points)', () => withRange(graph(), [statement({ low: 0, high: 90 })])],
    ['a link already sized by the user', () => withRange(graph({ edge: { provenance: { source: 'user_specified' }, defaulted: undefined } }))],
    ['no range at all', () => graph()],
  ])('⛔ no working point: %s', (_why, g) => {
    expect(linkWorkingPointOf(g(), FROM, TO)).toBeUndefined();
  });

  // The graded source is framed so that, read as if it were a switch, its working point WOULD be valid (0.11 on its frame of 2):
  // only the switch rule refuses it, never a size or spread bound.
  it('⛔ CONTRAST: the same range on a GRADED source (staff, frame 2) gives no "per what", so no working point; the switch does', () => {
    const graded = withRange(graph({ from: { label: 'Collection staff', observed_state: { value: 0.5, baseline: 0.5, raw_value: 1, unit: 'staff', cap: 2 } } }));
    expect(linkWorkingPointOf(graded, FROM, TO)).toBeUndefined();
    expect(linkWorkingPointOf(withRange(graph()), FROM, TO)).toBeDefined();
  });
});
