/**
 * Batch F (DL 12 Oct; T5 meaning loss, `recovery/t5-meaning/DIAGNOSIS.md` §7): a goal with NO target dropped the current
 * level the user stated, silently (no node held it, no line said so). D6 A r2 drafted "features completed per week" with
 * `baseline_value: 80`, explicit, `target_stated: false`, from "Our team currently completes about 80 features per week."
 * The level is kept, attributed as the user's; no target means no threshold, so none is written.
 *
 * The corpus is the AIE's T5 raw draft (`fixtures/row5-range-drafts-t5.json`, sha-checked), through admission as
 * production wires it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import t5 from './fixtures/row5-range-drafts-t5.json';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { goalLevelTheUserWrote } from '../stated-by-user.js';
import { provenanceOf } from './fixtures/provenance-of-standin.js';

type Rec = Record<string, any>;
const D6 = t5.drafts.find((d) => d.case.startsWith('D6') && d.arm === 'A' && d.sample.includes('-r2-'))!;
const BRIEF = (t5.briefs as Record<string, string>)[D6.case]!;
function goalOf(candidate: Rec, brief = BRIEF): Rec {
  const c = structuredClone(candidate) as unknown as CandidateModel;
  const nodes = admitCandidateModel(c, {}, brief, goalLevelTheUserWrote(c, brief)).nodes as unknown as Rec[];
  return nodes.find((n) => n.kind === 'goal')!;
}

describe('T5 D6 A r2: a goal with no target keeps the level the user stated', () => {
  it('IDENTITY: the draft byte for byte; no target; the user\'s 80 per week, explicit', () => {
    expect(createHash('sha256').update(D6.raw_text).digest('hex')).toBe(D6.raw_sha256);
    const goal = JSON.parse(D6.raw_text).goal as Rec;
    expect([goal.target_stated, goal.value, goal.baseline_value, goal.baseline_provenance]).toEqual([false, null, 80, 'explicit']);
    expect(BRIEF).toContain('Our team currently completes about 80 features per week.');
  });
  it('the goal holds the user\'s 80 per week, as theirs, and no threshold (no target was stated)', () => {
    const goal = goalOf(JSON.parse(D6.raw_text));
    expect([goal.observed_state?.raw_value, goal.observed_state?.unit, goal.observed_state?.source]).toEqual([80, 'features per week', 'brief_extraction']);
    expect(provenanceOf(goal.observed_state).origin).toBe('human');
    expect('goal_threshold_raw' in goal, 'no target, so no threshold').toBe(false);
    expect('goal_threshold' in goal).toBe(false);
  });
  it('CONTRAST: a level the brief never states (Olumi\'s estimate) stays out, as before', () => {
    const c = JSON.parse(D6.raw_text) as Rec;
    c.goal.baseline_provenance = 'inferred';
    const brief = BRIEF.replace('Our team currently completes about 80 features per week. ', '');
    expect(goalOf(c, brief).observed_state).toBeUndefined();
  });
});
