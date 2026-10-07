/**
 * THE BUNDLE IS THE AUTHORITY — so prove this module actually READS it rather
 * than trusting three transcribed ids.
 *
 * The sibling spec exercises behaviour against the real `data/dsk/v1.json`. It
 * cannot kill a mutant that deletes a bundle-integrity check, because the real
 * bundle satisfies every check. These specs inject bundles that do not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadVerifiedDskBundle = vi.hoisted(() => vi.fn());
vi.mock('../../compose/dsk-bundle-record.js', () => ({
  loadVerifiedDskBundle,
  _resetDskBundleCache: () => {},
}));

const { assessOutsideViewEligibility, OUTSIDE_VIEW_PROTOCOL_ID, OUTSIDE_VIEW_TRIGGER_ID } =
  await import('../outside-view-eligibility.js');

const REAL = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/dsk/v1.json'), 'utf8'),
) as { objects: Array<Record<string, unknown>> };

function bundleWith(mutate: (objects: Array<Record<string, unknown>>) => void) {
  const objects = JSON.parse(JSON.stringify(REAL.objects)) as Array<Record<string, unknown>>;
  mutate(objects);
  return { ...REAL, objects };
}
const find = (objs: Array<Record<string, unknown>>, id: string) =>
  objs.find((o) => o['id'] === id) as Record<string, unknown>;

function inputs() {
  return {
    signals: {
      signalVersion: 1 as const,
      windowComplete: true,
      scannedTurnCount: 2,
      referenceClassVocabularyPresent: false,
      tradeOffVocabularyPresent: false,
      numericEstimatePresent: true,
    },
    userMessage: "we'll land 40 new customers",
    stage: 'frame',
    hasDecisionDescription: true,
    confirmedReferenceClassPresent: false,
    declineObservedInWindow: false,
    userStatesNoComparableCases: false,
  };
}

beforeEach(() => {
  loadVerifiedDskBundle.mockReset();
});

describe('the trigger must itself name the protocol', () => {
  it('offers when DSK-TR-002 links to DSK-P-002 (the real bundle shape)', () => {
    loadVerifiedDskBundle.mockReturnValue(bundleWith(() => {}));
    expect(assessOutsideViewEligibility(inputs()).eligibility).toBe('eligible');
  });

  it('REFUSES when the trigger no longer links to the protocol', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        find(objs, OUTSIDE_VIEW_TRIGGER_ID)['linked_protocol_ids'] = ['DSK-P-001'];
      }),
    );
    const v = assessOutsideViewEligibility(inputs());
    expect(v.eligibility).toBe('not_applicable');
    if (v.eligibility !== 'not_applicable') return;
    expect(v.reason).toBe('protocol_unavailable');
  });

  it('REFUSES when the link is removed entirely', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        delete find(objs, OUTSIDE_VIEW_TRIGGER_ID)['linked_protocol_ids'];
      }),
    );
    expect(assessOutsideViewEligibility(inputs()).eligibility).toBe('not_applicable');
  });
});

describe('other bundle-integrity refusals', () => {
  it('refuses when the bundle cannot be verified at all', () => {
    loadVerifiedDskBundle.mockReturnValue(null);
    const v = assessOutsideViewEligibility(inputs());
    expect(v.eligibility).toBe('not_applicable');
    if (v.eligibility !== 'not_applicable') return;
    expect(v.reason).toBe('protocol_unavailable');
  });

  it('refuses a DEPRECATED protocol rather than citing it', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        find(objs, OUTSIDE_VIEW_PROTOCOL_ID)['deprecated'] = true;
      }),
    );
    expect(assessOutsideViewEligibility(inputs()).eligibility).toBe('not_applicable');
  });

  it('refuses a DEPRECATED trigger', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        find(objs, OUTSIDE_VIEW_TRIGGER_ID)['deprecated'] = true;
      }),
    );
    expect(assessOutsideViewEligibility(inputs()).eligibility).toBe('not_applicable');
  });

  it('follows the bundle when stage_applicability changes — no hard-coded stages', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        find(objs, OUTSIDE_VIEW_PROTOCOL_ID)['stage_applicability'] = ['decide'];
      }),
    );
    expect(assessOutsideViewEligibility({ ...inputs(), stage: 'frame' }).eligibility).toBe(
      'not_applicable',
    );
    expect(assessOutsideViewEligibility({ ...inputs(), stage: 'decide' }).eligibility).toBe(
      'eligible',
    );
  });

  it('asks the bundle question, so re-authoring steps[0] changes the invitation', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        const p = find(objs, OUTSIDE_VIEW_PROTOCOL_ID);
        p['steps'] = ['What family of decisions is this?', 'unused second step'];
      }),
    );
    const v = assessOutsideViewEligibility(inputs());
    if (v.eligibility !== 'eligible') throw new Error('expected eligible');
    expect(v.invitation).toBe('What family of decisions is this?');
  });

  it('skips a placeholder-bearing first step rather than leaking authoring syntax', () => {
    loadVerifiedDskBundle.mockReturnValue(
      bundleWith((objs) => {
        const p = find(objs, OUTSIDE_VIEW_PROTOCOL_ID);
        p['steps'] = ['Compare [winning option] to the base rate', 'What category is this?'];
      }),
    );
    const v = assessOutsideViewEligibility(inputs());
    if (v.eligibility !== 'eligible') throw new Error('expected eligible');
    expect(v.invitation).toBe('What category is this?');
    expect(v.invitation).not.toMatch(/\[[^\]]*\]/);
  });
});
