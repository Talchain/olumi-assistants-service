/**
 * Recovery Batch B (DL 12 Oct 13:3xZ, a B value item): the GOAL's stated current level was written at admission as
 * `brief_extraction` with no extractionType and no user-text check (`briefGoalObservedState`), which C's positive
 * attestation reads as stamp-only: Paul's chances would say "This result uses inputs whose sources have not been verified."
 * even where he typed the figure. Now the write goes through V2's existing verification:
 *   - ORIGIN: the brief writes the figure in the goal's frame, in a sentence naming the goal (the origin rule's reader);
 *   - ROLE: the same figure, in the goal's typed unit, is V2's VERIFIED current level of a factor of this model
 *     (`verifiedFactorLevel`: first-person owner, present-state marker, positive attestation only).
 * Verified → extractionType 'explicit'. Otherwise the level stays exactly as written before (no new refusal, no new ask).
 *
 * The wire: the nine served drafts of Paul's capacity level brief (`fixtures/capacity-served-drafts-20261011.json`).
 * Paul's brief: "Our existing team resolves 80 tickets per week. … Total weekly support capacity is defined as the existing
 * 80 tickets per week plus the additional specialist capacity." The hiring brief's goal is a CHANGE (+10% productivity)
 * with no level on any of its 12 served drafts (SELECT-only, `cee_drafter_raw_responses`), so this site writes nothing there.
 *
 * DL GO (after 501759f0): (1) the two sibling writers (a change goal's base, `admitStatedGoalChange`; a held ceiling's
 * level, `admitGoalLevelBesideHeldCeiling`) go through the same attestation; (2) a drafter's `inferred` tag never withholds
 * a goal level the brief writes in the goal's frame (`briefWritesGoalLevel`, the origin rule's reader): cd3d9c25. A level
 * the brief never writes keeps its treatment, with its line. Label, never withhold.
 *
 * ⛔ B2 (DL 12 Oct: 635f590d left B; C's independent check r2, BLOCKING 1): a figure that is a TERM of a sum the user builds
 * is a part, never the goal's level. Paul's capacity brief writes the goal only as "the existing 80 … plus the additional
 * specialist capacity", so its 80 is the existing team's capacity: never credited (cd3d9c25 stays withheld, as C pins) and
 * never verified (the eight drafter-explicit drafts are admitted as before 501759f0, a label). Where a brief writes the goal
 * quantity's OWN level, the drafter's tag still never withholds it, and V2 still verifies it; a total stated with its
 * breakdown is still the total.
 */
import { describe, expect, it } from 'vitest';
import cap from './fixtures/capacity-served-drafts-20261011.json';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { provenanceOf } from './fixtures/provenance-of-standin.js';
import { goalLevelTheUserWrote } from '../stated-by-user.js';
import { briefWritesGoalLevel, verifiedGoalLevel } from '../verified-option-setting.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const OWN = 'Our existing team resolves 80 tickets per week.';
const DEFINED = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';

/** Admission as production wires it (`build-model.ts` admitForBuild): the brief's own goal-level check is injected. */
function admitted(candidate: Rec, brief: string): { nodes: Rec[]; loss: Rec[] } {
  const c = structuredClone(candidate) as unknown as CandidateModel;
  return admitCandidateModel(c, {}, brief, goalLevelTheUserWrote(c, brief)) as unknown as { nodes: Rec[]; loss: Rec[] };
}
function goal(candidate: Rec, brief: string): Rec | undefined {
  return admitted(candidate, brief).nodes.find(n => n.kind === 'goal')?.observed_state;
}

const lossOf = (candidate: Rec, brief: string) => admitted(candidate, brief).loss.filter(l => /observed_state\.baseline$/.test(String(l.field_path)));

describe('B2 (C BLOCKING 1): the served capacity brief writes the goal only as a sum of parts, so its 80 is never the user\'s goal level', () => {
  it('IDENTITY: the brief writes both sentences; eight drafts tag the goal level explicit, one inferred; the 80 is a term of the sum', () => {
    expect(cap.brief).toContain(OWN);
    expect(cap.brief).toContain(DEFINED);
    expect(DEFINED).toContain('defined as the existing 80 tickets per week plus the additional specialist capacity');
    expect(cap.drafts.map(d => d.candidate.goal.baseline_value)).toEqual(Array(9).fill(80));
    expect(cap.drafts.filter(d => d.candidate.goal.baseline_provenance === 'explicit')).toHaveLength(8);
  });
  for (const d of cap.drafts) {
    const explicit = d.candidate.goal.baseline_provenance === 'explicit';
    it(`${d.scenario_id.slice(0, 8)}: ${explicit ? 'admitted as before 501759f0: no extractionType (a part is never verified as the level)'
      : 'withheld as Olumi\'s estimate, with its line (C\'s WITHHOLD baseline: a part is never credited)'}`, () => {
      const c = d.candidate as unknown as CandidateModel;
      expect([briefWritesGoalLevel(c, cap.brief), verifiedGoalLevel(c, cap.brief)], 'its reason: the 80 is a term of the user\'s sum').toEqual([false, false]);
      const os = goal(d.candidate, cap.brief);
      if (explicit) {
        expect([os?.raw_value, os?.source, os?.extractionType]).toEqual([80, 'brief_extraction', undefined]);
      } else {
        expect(os).toBeUndefined();
        expect(lossOf(d.candidate, cap.brief).map(l => String(l.reason))).toEqual([expect.stringContaining('Olumi\'s own estimate')]);
      }
    });
  }
});

/** Design (a level brief; the served capacity brief has no sentence writing its goal's own level). */
const CLINIC_HEAD = 'We are choosing between two options, "Keep the current rota" and "Add an evening clinic". We want completed appointments of at least 1,000 each month. ';
const CLINIC_OWN = 'Our clinic completes 920 appointments each month.';
function clinic(tag: string): Rec {
  return {
    goal: { metric: 'Completed appointments', operator: '>=', target_stated: true, frame: 'level', value: 1000, unit: 'appointments/month', horizon_months: null,
      provenance: 'explicit', baseline_known: true, baseline_value: 920, baseline_provenance: tag, scope: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], links: [], factors: [],
    options: [{ label: 'Keep the current rota', interventions: [] }, { label: 'Add an evening clinic', interventions: [] }],
  };
}
describe('controls: the goal\'s own level is verified by V2; a part, and anything V2 does not attest, is written exactly as before', () => {
  it('POSITIVE CONTROL: "Our clinic completes 920 appointments each month." → verified (extractionType explicit)', () => {
    expect(goal(clinic('explicit'), CLINIC_HEAD + CLINIC_OWN)?.extractionType).toBe('explicit');
  });
  it('a total stated with its breakdown is still the total → verified', () => {
    expect(goal(clinic('explicit'), `${CLINIC_HEAD}Our clinic completes 920 appointments each month: 800 booked plus 120 walk-ins.`)?.extractionType).toBe('explicit');
  });
  for (const [name, sentence, writes] of [
    ['the figure is a term of the user\'s definition ("defined as our 920 … plus walk-ins")', 'Completed appointments are defined as our 920 booked appointments each month plus walk-ins.', false],
    ['the figure is a term of a sum ("920 … plus whatever the evening clinic adds")', 'Our clinic completes 920 appointments each month plus whatever the evening clinic adds.', false],
    ['a third party owns it (V2)', 'Our competitor completes 920 appointments each month.', true],
    ['it is past (V2)', 'Last year our clinic completed 920 appointments each month.', true],
    ['another period (each week)', 'Our clinic completes 920 appointments each week.', false],
    ['the brief never writes it', '', false],
  ] as const) {
    it(`stays as before (brief_extraction, no extractionType): ${name}`, () => {
      const m = clinic('explicit');
      expect(briefWritesGoalLevel(m as unknown as CandidateModel, CLINIC_HEAD + sentence), 'the origin reader').toBe(writes);
      const os = goal(m, CLINIC_HEAD + sentence);
      expect([os?.source, os?.extractionType]).toEqual(['brief_extraction', undefined]);
    });
  }
});

describe('B2: a drafter\'s inferred tag never withholds the goal quantity\'s OWN level the brief writes; a part of the user\'s sum stays withheld', () => {
  const inferred = cap.drafts.find(d => d.scenario_id.startsWith('cd3d9c25'))!;
  const c = inferred.candidate as unknown as CandidateModel;
  // The goal quantity's own level in a form production's strict reader misses (measured: the label-colon form); a plain
  // "Weekly support capacity is 80 tickets per week." is already admitted by the strict reader alone.
  const OWN_LEVEL = 'Weekly support capacity: currently 80 tickets per week.';
  it('IDENTITY: cd3d9c25 drafted the level as inferred; neither the strict reader nor the origin reader reads Paul\'s sum as the level', () => {
    expect([inferred.candidate.goal.baseline_value, inferred.candidate.goal.baseline_provenance]).toEqual([80, 'inferred']);
    expect(goalLevelTheUserWrote(c, cap.brief)(80, c.goal.unit)).toBe(false);
    expect(briefWritesGoalLevel(c, cap.brief), 'the 80 is a term of the user\'s sum').toBe(false);
  });
  it('cd3d9c25 on Paul\'s brief: withheld as Olumi\'s estimate, with its line (C\'s WITHHOLD baseline)', () => {
    expect(goal(inferred.candidate, cap.brief)).toBeUndefined();
    expect(lossOf(inferred.candidate, cap.brief).map(l => String(l.reason))).toEqual([expect.stringContaining('Olumi\'s own estimate')]);
  });
  it('POSITIVE (the pair: one sentence differs): the brief writes the goal quantity\'s own level → the inferred tag does not withhold it', () => {
    const brief = cap.brief.replace(DEFINED, OWN_LEVEL);
    expect(goalLevelTheUserWrote(c, brief)(80, c.goal.unit), 'the strict reader alone would withhold it').toBe(false);
    expect(briefWritesGoalLevel(c, brief)).toBe(true);
    const os = goal(inferred.candidate, brief);
    // Credited as the user's figure, and its role is V2's: "currently" attests it (extractionType explicit).
    expect([os?.raw_value, os?.source, os?.extractionType]).toEqual([80, 'brief_extraction', 'explicit']);
    expect(provenanceOf(os).origin).toBe('human');
    expect(lossOf(inferred.candidate, brief)).toEqual([]);
  });
  it('C\'s BLOCKING 1 wording: "90 … today: the existing 80 … plus 10 … outsourced" never credits the 80', () => {
    const brief = cap.brief.replace(DEFINED, 'Total weekly support capacity is 90 tickets per week today: the existing 80 tickets per week plus 10 tickets per week outsourced, plus the additional specialist capacity.');
    expect(briefWritesGoalLevel(c, brief)).toBe(false);
    expect(goal(inferred.candidate, brief)).toBeUndefined();
  });
  it('a sum named before its terms ("the sum of the existing 80 … and …") never credits the 80 either', () => {
    const brief = cap.brief.replace(DEFINED, 'Weekly support capacity is the sum of the existing 80 tickets per week and the additional specialist capacity.');
    expect(briefWritesGoalLevel(c, brief)).toBe(false);
    expect(goal(inferred.candidate, brief)).toBeUndefined();
  });
  it('CONTRAST: the same inferred tag on a level the brief never writes is still withheld, with its line (current treatment)', () => {
    const brief = cap.brief.replace(OWN, '').replace(DEFINED, 'Total weekly support capacity is the existing capacity plus the additional specialist capacity.');
    expect(briefWritesGoalLevel(c, brief), 'its reason: the brief writes no 80').toBe(false);
    expect(goal(inferred.candidate, brief)).toBeUndefined();
    expect(lossOf(inferred.candidate, brief).map(l => String(l.reason))).toEqual([expect.stringContaining('Olumi\'s own estimate')]);
  });
});

/**
 * Design controls for the two sibling writers (DL GO (1)). The served sibling briefs are not on disk, so these use V2's
 * own control wording (first-person owner, present-state marker). The aim comes first: V2 reads a bound in the sentence
 * right after a level ("at least 25%") as qualifying it, which is V2's rule, not this item's.
 */
const CHANGE_LEVEL = 'Our existing team resolves 80 tickets per week.';
const CHANGE_BRIEF = 'We are choosing between two options, "Keep the current team" and "Add a contractor". We want to increase tickets resolved per week by at least 25% within six months. ' + CHANGE_LEVEL;
function changeModel(tag: string): Rec {
  return {
    goal: { metric: 'Tickets resolved per week', operator: '>=', target_stated: true, frame: 'change_rel', value: 25, unit: 'tickets per week',
      horizon_months: 6, provenance: 'explicit', baseline_known: tag === 'explicit', baseline_value: 80, baseline_provenance: tag, scope: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], links: [], options: [], factors: [],
  };
}
describe('DL GO (1): a change goal\'s base level goes through the same attestation (admitStatedGoalChange)', () => {
  it('POSITIVE: the user\'s own current level, verified by V2 → extractionType explicit', () => {
    expect(provenanceOf(goal(changeModel('explicit'), CHANGE_BRIEF))).toEqual({ origin: 'human', role: 'verified' });
  });
  it('POSITIVE (GO (2) on the change path): tagged inferred, the level the brief writes is still the user\'s, verified', () => {
    expect(provenanceOf(goal(changeModel('inferred'), CHANGE_BRIEF))).toEqual({ origin: 'human', role: 'verified' });
  });
  it('CONTRAST: written but not attested (no present-state marker, V2\'s own control) → admitted as before, no extractionType', () => {
    const brief = CHANGE_BRIEF.replace(CHANGE_LEVEL, 'Our team resolves 80 tickets per week.');
    const m = changeModel('explicit') as unknown as CandidateModel;
    expect([briefWritesGoalLevel(m, brief), verifiedGoalLevel(m, brief)], 'its reason: written, V2 withholds the role').toEqual([true, false]);
    expect([briefWritesGoalLevel(m, CHANGE_BRIEF), verifiedGoalLevel(m, CHANGE_BRIEF)], 'the pair: the marker alone flips it').toEqual([true, true]);
    const os = goal(changeModel('explicit'), brief);
    expect([os?.raw_value, os?.source, os?.extractionType]).toEqual([80, 'brief_extraction', undefined]);
  });
  it('CONTRAST: a drafted-only base (the brief never writes 80) keeps its treatment: withheld, with its line', () => {
    const brief = CHANGE_BRIEF.replace(' ' + CHANGE_LEVEL, '');
    expect(goal(changeModel('inferred'), brief)).toBeUndefined();
    expect(admitted(changeModel('inferred'), brief).loss.map(l => String(l.reason)).filter(r => r.includes('Tickets resolved per week')))
      .toEqual([expect.stringContaining('Olumi\'s own estimate')]);
  });
});

const CEILING_LEVEL = 'Our clinic currently has 230 patients waiting for a first visit.';
const CEILING_BRIEF = 'We are choosing between two options, "Keep the current rota" and "Add a weekend clinic". We want to keep patients waiting for a first visit at or below 200. ' + CEILING_LEVEL;
async function built(tag: string, brief: string): Promise<{ os: Rec | undefined; said: string[] }> {
  const model = {
    goal: { metric: 'Patients waiting for a first visit', operator: '<=', target_stated: true, frame: 'level', value: 200, unit: 'patients',
      horizon_months: null, provenance: 'explicit', baseline_known: tag === 'explicit', baseline_value: 230, baseline_provenance: tag, scope: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], links: [],
    options: [
      { label: 'Keep the current rota', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Add a weekend clinic', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [] },
    ],
    factors: [],
  };
  let graph: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = (body as { graph: Rec }).graph;
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(model) });
  const result = await buildModelFromBrief('88888888-8888-4888-8888-888888888888', brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
  const node = (graph?.nodes as Rec[] | undefined)?.find(n => n.kind === 'goal');
  expect(node?.goal_direction, 'the held ceiling: this is the sibling writer\'s path').toBe('<=');
  return { os: node?.observed_state, said: (result.not_represented ?? []) as string[] };
}
describe('DL GO (1): a held ceiling\'s level goes through the same attestation (admitGoalLevelBesideHeldCeiling, real build)', () => {
  it('POSITIVE: the user\'s own current level beside a held "at or below" → verified', async () => {
    expect(provenanceOf((await built('explicit', CEILING_BRIEF)).os)).toEqual({ origin: 'human', role: 'verified' });
  });
  it('POSITIVE (GO (2) on the ceiling path): tagged inferred, still the user\'s, verified', async () => {
    expect(provenanceOf((await built('inferred', CEILING_BRIEF)).os)).toEqual({ origin: 'human', role: 'verified' });
  });
  it('CONTRAST: written but not attested (no first-person owner, V2\'s own control) → admitted as before, no extractionType', async () => {
    const brief = CEILING_BRIEF.replace(CEILING_LEVEL, 'The clinic currently has 230 patients waiting for a first visit.');
    const m = { goal: { metric: 'Patients waiting for a first visit', operator: '<=', value: 200, unit: 'patients', baseline_value: 230 },
      constraints: [], risks: [], outcomes: [], links: [], options: [], factors: [] } as unknown as CandidateModel;
    expect([briefWritesGoalLevel(m, brief), verifiedGoalLevel(m, brief)], 'its reason: written, V2 withholds the role').toEqual([true, false]);
    expect([briefWritesGoalLevel(m, CEILING_BRIEF), verifiedGoalLevel(m, CEILING_BRIEF)], 'the pair: the owner alone flips it').toEqual([true, true]);
    const { os } = await built('explicit', brief);
    expect([os?.raw_value, os?.source, os?.extractionType]).toEqual([230, 'brief_extraction', undefined]);
  });
  it('CONTRAST: a drafted-only level (the brief never writes 230) keeps its treatment: withheld, with its line', async () => {
    const { os, said } = await built('inferred', CEILING_BRIEF.replace(' ' + CEILING_LEVEL, ''));
    expect(os).toBeUndefined();
    expect(said.filter(l => l.includes('Patients waiting for a first visit'))).toEqual([expect.stringContaining('Olumi\'s own estimate')]);
  });
});
