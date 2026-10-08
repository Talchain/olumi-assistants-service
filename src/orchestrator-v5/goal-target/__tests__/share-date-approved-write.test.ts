import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { assertShareByDatePreserved, ShareByDateOwnershipError, withApprovedShareByDateWrite } from '../share-by-date-carrier.js';

const graph = () => ({
  nodes: [{ id: 'team', kind: 'factor', label: "Today's team" }, { id: 'goal', kind: 'goal', label: 'Launch' }],
  edges: [{ from: 'team', to: 'goal', strength: { mean: 1, std: 0.01 }, exists_probability: 1,
    effect_direction: 'positive', provenance: { source: 'cee_hypothesis', share_by_date: {
      role: 'team', team_id: 'team', goal_id: 'goal', deliverable: 'the launch', unresolved_option_ids: [] as string[],
      stated_time: undefined as undefined | { quantity: string; most_likely: number; unit: string; deadline: string; reference_date: string },
    } } }],
});
const approvedGraph = () => {
  const after = graph();
  after.edges[0]!.provenance.share_by_date.stated_time = {
    quantity: 'months_to_finish', most_likely: 6, unit: 'months', deadline: '2027-04-07', reference_date: '2026-10-07',
  };
  return after;
};

describe('sanctioned atomic deadline forecast writes', () => {
  it('S1-SINGLE-CARRIER-PARSE: the most likely record survives the canonical node parser', () => {
    const after = approvedGraph();
    expect(GraphV3.parse(after).edges[0]!.provenance?.share_by_date).toEqual(after.edges[0]!.provenance.share_by_date);
  });
  it('S1-SINGLE-APPROVED-COMMIT: only the exact approved before/after passes both guard copies', async () => {
    const before = graph(), after = approvedGraph();
    await withApprovedShareByDateWrite(before, after, async () => {
      expect(() => assertShareByDatePreserved(before, after)).not.toThrow();
      await Promise.resolve();
      expect(() => assertShareByDatePreserved(structuredClone(before), structuredClone(after))).not.toThrow();
    });
    expect(() => assertShareByDatePreserved(before, after)).toThrow(ShareByDateOwnershipError);
  });
  it('S1-SINGLE-APPROVED-COMMIT control: another postimage inside the approved operation is refused', () => {
    const before = graph(), after = approvedGraph(), forged = structuredClone(after);
    forged.edges[0]!.provenance.share_by_date.unresolved_option_ids.push('forged');
    withApprovedShareByDateWrite(before, after, () => {
      expect(() => assertShareByDatePreserved(before, forged)).toThrow(ShareByDateOwnershipError);
      const otherBase = graph(); otherBase.nodes[0]!.label = 'Different base';
      expect(() => assertShareByDatePreserved(otherBase, after)).toThrow(ShareByDateOwnershipError);
      const extraCarrier = structuredClone(after);
      extraCarrier.edges.push({ ...structuredClone(extraCarrier.edges[0]!), to: 'other_goal' });
      expect(() => assertShareByDatePreserved(before, extraCarrier)).toThrow(ShareByDateOwnershipError);
    });
  });
  it('S1-SINGLE-APPROVED-COMMIT control: input mutation cannot broaden its frozen permission', () => {
    const before = graph(), after = approvedGraph();
    withApprovedShareByDateWrite(before, after, () => {
      after.edges[0]!.provenance.share_by_date.stated_time!.most_likely = 99;
      expect(() => assertShareByDatePreserved(before, after)).toThrow(ShareByDateOwnershipError);
    });
  });
  it('S1-SINGLE-APPROVED-COMMIT control: a detached async child loses permission when its operation ends', async () => {
    const before = graph(), after = approvedGraph();
    let resume!: () => void;
    const wait = new Promise<void>(resolve => { resume = resolve; });
    let detached!: Promise<void>;
    await withApprovedShareByDateWrite(before, after, async () => {
      detached = wait.then(() => {
        expect(() => assertShareByDatePreserved(before, after)).toThrow(ShareByDateOwnershipError);
      });
    });
    resume();
    await detached;
  });
  it('S1-SINGLE-APPROVED-COMMIT control: ordinary writes preserve carriers without permission', () => {
    const before = approvedGraph(), after = structuredClone(before);
    after.nodes[0]!.label = 'Our renamed team';
    expect(() => assertShareByDatePreserved(before, after)).not.toThrow();
    delete after.edges[0]!.provenance.share_by_date.stated_time;
    expect(() => assertShareByDatePreserved(before, after)).toThrow(ShareByDateOwnershipError);
  });
});
