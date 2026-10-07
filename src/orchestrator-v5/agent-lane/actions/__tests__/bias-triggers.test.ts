import { describe, expect, it } from 'vitest';
import { BIAS_RISK_MAX, biasRiskOf } from '../bias-triggers.js';
import type { ActionOffer } from '../rank.js';
import type { ActionId } from '../registry.js';
import { estimatePointsOf, type ActionFacts } from '../state.js';
import { resolveDskClaimProvenance } from '../../../compose/dsk-claim-record.js';

function facts(over: Partial<ActionFacts> = {}): ActionFacts {
  return {
    scenarioId: 'bias-test',
    canonicalStage: null,
    estimateCandidates: [],
    estimateDriverIds: [],
    revision: { graph_hash: null, run_key: null },
    stateKey: '',
    readable: true,
    runBound: false,
    runAdmissible: false,
    goalPresent: false,
    goalLabel: '',
    goalKind: null,
    targetPresent: false,
    approvalWaiting: false,
    runStale: false,
    deadline: null,
    ownOptionCount: 0,
    goalPathFactorCount: 0,
    riskCount: 0,
    outcomeCount: 0,
    limitCount: 0,
    risksAvailability: 'omit',
    rcRows: [],
    strengthenCard: false,
    testLink: null,
    ...over,
  };
}

function offer(action_id: ActionId, enabled = true): ActionOffer {
  return {
    action_id,
    label: action_id,
    icon: 'test',
    group: 'method',
    press_id: `act:${action_id}`,
    user_line: '',
    enabled,
    offer_key: `k-${action_id}`,
  };
}

const widen = (variant: string): ActionFacts['rcRows'][number] => ({ policy_id: 'RC-WIDEN', target: 'options', variant } as never);
const estimates: ActionFacts['estimateCandidates'] = [
  { factor_id: 'far', label: 'Market size', value_authorship: 'olumi_estimate', goal_distance: 2, value_hash: 'far-value', figure: '100' },
  { factor_id: 'near', label: 'Conversion rate', value_authorship: 'olumi_estimate', goal_distance: 1, value_hash: 'near-value', figure: '20%' },
];

describe('biasRiskOf', () => {
  it('returns nothing without triggers, with a W3 control that yields narrow framing', () => {
    const f = facts({});
    const offers = [offer('more_options')];
    expect(biasRiskOf(f, offers)).toBeUndefined();
    expect(biasRiskOf(facts({ ...f, rcRows: [widen('W3')] }), offers)).toEqual({
      v: 1,
      items: [{
        claim_id: 'DSK-B-007',
        name: 'Narrow framing',
        why: 'These options all work through the same lever, which can hide better routes.',
        action_id: 'more_options',
        press_id: 'act:more_options',
        offer_key: 'k-more_options',
      }],
    });
  });

  it('keeps only narrow framing then status quo when all three triggers fire', () => {
    const result = biasRiskOf(facts({ rcRows: [widen('W4'), widen('W3')], estimateCandidates: estimates }),
      [offer('bias_anchoring'), offer('more_options')]);
    expect(BIAS_RISK_MAX).toBe(2);
    expect(result?.items).toHaveLength(2);
    expect(result?.items.map(item => item.claim_id)).toEqual(['DSK-B-007', 'DSK-B-006']);
  });

  it('keeps status quo then anchoring and names the first selected estimate exactly', () => {
    const f = facts({ rcRows: [widen('W4')], estimateCandidates: [...estimates].reverse(), estimateDriverIds: ['far'] });
    expect(estimatePointsOf(f)[0]?.label).toBe('Market size');
    const result = biasRiskOf(f, [offer('more_options'), offer('bias_anchoring')]);
    expect(result?.items.map(item => item.claim_id)).toEqual(['DSK-B-006', 'DSK-B-001']);
    expect(result?.items[0]?.name).toBe('Status quo');
    expect(result?.items[0]?.why).toBe("Without a 'carry on as now' option it is hard to see what each change really adds.");
    expect(result?.items[1]?.name).toBe('Anchoring');
    expect(result?.items[1]?.why).toBe('Olumi’s starting figure for ‘Market size’ could pull later estimates towards it.');
  });

  it('requires an enabled more_options offer without a target', () => {
    const f = facts({ rcRows: [widen('W3')] });
    expect(biasRiskOf(f, [offer('more_options', false)])).toBeUndefined();
    expect(biasRiskOf(f, [{ ...offer('more_options'), target: { kind: 'option', id: 'target' } }])).toBeUndefined();
  });

  it('requires an anchoring offer and an Olumi estimate', () => {
    expect(biasRiskOf(facts({ estimateCandidates: estimates }), [])).toBeUndefined();
    const yours: ActionFacts['estimateCandidates'] = estimates.map(point => ({ ...point, value_authorship: 'yours' }));
    expect(biasRiskOf(facts({ estimateCandidates: yours }), [offer('bias_anchoring')])).toBeUndefined();
    expect(biasRiskOf(facts({ estimateCandidates: estimates }), [offer('bias_anchoring', false)])).toBeUndefined();
    expect(biasRiskOf(facts({ estimateCandidates: estimates }),
      [{ ...offer('bias_anchoring'), target: { kind: 'factor', id: 'far' } }])).toBeUndefined();
  });

  it('copies the mitigation offer press and key by identity', () => {
    const mitigation = { ...offer('more_options'), press_id: 'press-unique', offer_key: 'zz-unique' };
    const result = biasRiskOf(facts({ rcRows: [widen('W3')] }), [mitigation]);
    expect(result?.items[0]?.action_id).toBe(mitigation.action_id);
    expect(result?.items[0]?.press_id).toBe('press-unique');
    expect(result?.items[0]?.offer_key).toBe('zz-unique');
    expect(Object.keys(result!.items[0]!)).toEqual(['claim_id', 'name', 'why', 'action_id', 'press_id', 'offer_key']);
  });

  it('returns nothing for an unreadable model even when all triggers are present', () => {
    expect(biasRiskOf(facts({ readable: false, rcRows: [widen('W3'), widen('W4')], estimateCandidates: estimates }),
      [offer('more_options'), offer('bias_anchoring')])).toBeUndefined();
  });

  it('includes only resolved science at an applicable stage and omits the key at a null stage', () => {
    const offers = [offer('more_options')];
    const provenance = resolveDskClaimProvenance('DSK-B-007');
    const result = biasRiskOf(facts({ canonicalStage: 'frame', rcRows: [widen('W3')] }), offers);
    expect(result?.items).toHaveLength(1);
    expect(provenance).not.toBeNull();
    expect(result?.items[0]?.science).toEqual(provenance);
    expect(result?.items[0]?.science?.claim_id).toBe('DSK-B-007');
    expect(Object.keys(result!.items[0]!)).toEqual(['claim_id', 'name', 'why', 'action_id', 'press_id', 'offer_key', 'science']);
    const noStage = biasRiskOf(facts({ rcRows: [widen('W3')] }), offers);
    expect(noStage?.items).toHaveLength(1);
    expect(noStage?.items[0]).not.toHaveProperty('science');
    const inapplicable = biasRiskOf(facts({ canonicalStage: 'analyse', rcRows: [widen('W3')] }), offers);
    expect(inapplicable?.items).toHaveLength(1);
    expect(inapplicable?.items[0]).not.toHaveProperty('science');
  });

  it('returns byte-identical JSON from two calls with the same inputs', () => {
    const f = facts({ canonicalStage: 'frame', rcRows: [widen('W4')], estimateCandidates: estimates });
    const offers = [offer('more_options'), offer('bias_anchoring')];
    const first = JSON.stringify(biasRiskOf(f, offers));
    expect(first).not.toBeUndefined();
    expect(JSON.stringify(biasRiskOf(f, offers))).toBe(first);
  });

  it('uses the W2 wording and gives W3 precedence when both variants are present', () => {
    const offers = [offer('more_options')];
    const result = biasRiskOf(facts({ rcRows: [widen('W2')] }), offers);
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.claim_id).toBe('DSK-B-007');
    expect(result?.items[0]?.why).toBe('There is only one option besides doing nothing, which can hide better routes.');
    const both = biasRiskOf(facts({ rcRows: [widen('W2'), widen('W3')] }), offers);
    expect(both?.items).toHaveLength(1);
    expect(both?.items[0]?.why).toBe('These options all work through the same lever, which can hide better routes.');
  });
});
