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
/** V2's stated residual: the binder cannot bind the 80 where the rival label repeats its verb. */
const RIVAL_VERB_LABEL = new Set(['c2a3f477-f3cf-4092-a286-388794963c57', '14b66c8e-5016-4414-807e-27412c92107a']);
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

describe('the goal\'s stated level goes through V2\'s verification (the served capacity drafts)', () => {
  it('IDENTITY: the brief writes both sentences; eight drafts tag the goal level explicit, one inferred', () => {
    expect(cap.brief).toContain(OWN);
    expect(cap.brief).toContain(DEFINED);
    expect(cap.drafts.map(d => d.candidate.goal.baseline_value)).toEqual(Array(9).fill(80));
    expect(cap.drafts.filter(d => d.candidate.goal.baseline_provenance === 'explicit')).toHaveLength(8);
  });
  for (const d of cap.drafts) {
    const explicit = d.candidate.goal.baseline_provenance === 'explicit';
    const binds = !RIVAL_VERB_LABEL.has(d.scenario_id);
    const expected = !explicit ? 'VERIFIED although the drafter tagged it inferred (DL GO (2): the tag never withholds a level Paul wrote)'
      : binds ? 'VERIFIED: extractionType explicit, the user\'s current level' : 'as before (V2\'s binder residual): no extractionType';
    it(`${d.scenario_id.slice(0, 8)}: Paul's goal level 80 is ${expected}`, () => {
      const os = goal(d.candidate, cap.brief);
      expect([os?.raw_value, os?.source]).toEqual([80, 'brief_extraction']);
      expect(os?.extractionType).toBe(binds ? 'explicit' : undefined);
      if (binds) expect(provenanceOf(os)).toEqual({ origin: 'human', role: 'verified' });
    });
  }
});

describe('controls: a goal level nothing verifies is written exactly as before', () => {
  const served = cap.drafts.find(d => d.scenario_id.startsWith('b33bf531'))!.candidate;
  it('POSITIVE CONTROL: the same draft, Paul\'s brief: verified', () => {
    expect(goal(served, cap.brief)?.extractionType).toBe('explicit');
  });
  // The unit check in `verifiedGoalLevel` is defence in depth: V2's neighbour rule already withholds a factor whose figure
  // the goal's sentence writes as another quantity (measured here), so its mutant survives. Kept for C's rebase.
  it('stays as before: the only 80 the user owns is another quantity (80 people), which V2 itself withholds', () => {
    const own = 'Our existing team currently has 80 people.';
    const c = structuredClone(served) as Rec;
    const f = (c.factors as Rec[]).find(x => x.baseline_value === 80)!;
    Object.assign(f, { label: 'Existing team headcount', unit: 'people', baseline_evidence: { quote: own } });
    const brief = cap.brief.replace(OWN, own);
    const nodes = admitCandidateModel(structuredClone(c) as unknown as CandidateModel, {}, brief).nodes as unknown as Rec[];
    expect(provenanceOf(nodes.find(n => n.label === 'Existing team headcount')?.observed_state), 'V2 withholds it: the goal sentence writes 80 tickets')
      .toEqual({ origin: 'human', role: 'unverified' });
    const os = goal(c, brief);
    expect(os?.source).toBe('brief_extraction');
    expect(os?.extractionType).toBeUndefined();
  });
  it('stays as before: the goal\'s 80 is in another period from the verified factor\'s (per day vs per week)', () => {
    const c = structuredClone(served) as Rec; c.goal.unit = 'tickets per day';
    const brief = cap.brief.replace(DEFINED, DEFINED.replace('80 tickets per week', '80 tickets per day'));
    const os = goal(c, brief);
    expect(os?.source).toBe('brief_extraction');
    expect(os?.extractionType).toBeUndefined();
  });
  for (const [name, brief] of [
    ['a drafted-only level: the brief never writes the 80', cap.brief.replace(OWN, '').replace(DEFINED, 'Total weekly support capacity is the existing capacity plus the additional specialist capacity.')],
    ['a third party owns the 80 ("Their existing team …")', cap.brief.replace(OWN, 'Their existing team resolves 80 tickets per week.')],
    ['the 80 is past ("Last year our existing team resolved …")', cap.brief.replace(OWN, 'Last year our existing team resolved 80 tickets per week.')],
    ['the goal sentence writes no 80, only the factor sentence does', cap.brief.replace(DEFINED, 'Total weekly support capacity is defined as the existing capacity plus the additional specialist capacity.')],
  ] as const) {
    it(`stays as before (brief_extraction, no extractionType): ${name}`, () => {
      expect(brief).not.toBe(cap.brief);
      const os = goal(served, brief);
      expect(os?.source).toBe('brief_extraction');
      expect(os?.extractionType).toBeUndefined();
    });
  }
});

describe('DL GO (2): a drafter\'s estimate tag never withholds a goal level the brief writes; a drafted-only level keeps its treatment', () => {
  const inferred = cap.drafts.find(d => d.scenario_id.startsWith('cd3d9c25'))!;
  const lossOf = (candidate: Rec, brief: string) => admitted(candidate, brief).loss.filter(l => /observed_state\.baseline$/.test(String(l.field_path)));
  it('IDENTITY: cd3d9c25 drafted Paul\'s written goal level as inferred; production\'s strict goal-level reader misses it', () => {
    expect([inferred.candidate.goal.baseline_value, inferred.candidate.goal.baseline_provenance]).toEqual([80, 'inferred']);
    const c = inferred.candidate as unknown as CandidateModel;
    expect(goalLevelTheUserWrote(c, cap.brief)(80, c.goal.unit), 'the strict reader alone would keep withholding it').toBe(false);
    expect(briefWritesGoalLevel(c, cap.brief), 'the origin rule\'s reader: the brief writes it in the goal\'s frame').toBe(true);
  });
  it('cd3d9c25: admitted as Paul\'s, role by V2 (verified), with no "Olumi\'s own estimate" withheld line', () => {
    expect(provenanceOf(goal(inferred.candidate, cap.brief))).toEqual({ origin: 'human', role: 'verified' });
    expect(lossOf(inferred.candidate, cap.brief)).toEqual([]);
  });
  it('CONTRAST: the same inferred tag on a level the brief never writes is still withheld, with its line (current treatment)', () => {
    const brief = cap.brief.replace(OWN, '').replace(DEFINED, 'Total weekly support capacity is the existing capacity plus the additional specialist capacity.');
    expect(briefWritesGoalLevel(inferred.candidate as unknown as CandidateModel, brief), 'its reason: the brief writes no 80').toBe(false);
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
