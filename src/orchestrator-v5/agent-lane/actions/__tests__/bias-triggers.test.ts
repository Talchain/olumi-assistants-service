import { describe, expect, it } from 'vitest';
import { BIAS_RISK_MAX, biasCheckReply, biasRiskOf, type OptionFrame } from '../bias-triggers.js';
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
    olumiEstimateCount: 0,
    revision: { graph_hash: null, run_key: null },
    stateKey: '',
    readable: true,
    runBound: false,
    runAdmissible: false,
    goalPresent: false,
    goalLabel: '',
    identityReading: null,
    thresholdReason: null,
    currentLevelQuestion: null,
    goalKind: null,
    targetPresent: false,
    approvalWaiting: false,
    runStale: false,
    deadline: null,
    ownOptionCount: 0,
    optionFrame: { nonSqOptionLabels: [], statusQuoPresent: false, sameLever: false },
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

function frame(over: Partial<OptionFrame> = {}): OptionFrame {
  return { nonSqOptionLabels: ['A', 'B'], statusQuoPresent: true, sameLever: false, ...over };
}

const estimates: ActionFacts['estimateCandidates'] = [
  { factor_id: 'far', label: 'Market size', value_authorship: 'olumi_estimate', goal_distance: 2, value_hash: 'far-value', figure: '100' },
  { factor_id: 'near', label: 'Conversion rate', value_authorship: 'olumi_estimate', goal_distance: 1, value_hash: 'near-value', figure: '20%' },
];

describe('P45 slice 3 biasCheckReply', () => {
  const moreOptions = { ...offer('more_options'), label: 'More options' };
  const anchoring = { ...offer('bias_anchoring'), label: 'Anchoring' };
  const offers = [anchoring, moreOptions];
  const checked = 'Checked: Narrow framing, Anchoring.';
  const close = 'Which of these is worth ten minutes now?';

  it('both fire at frame: exact model items, both badge lines, and ordered same-bar offer keys', () => {
    const f = facts({
      canonicalStage: 'frame', // Both claims apply here; evaluate omits the narrow-framing badge.
      estimateCandidates: [...estimates].reverse(),
      estimateDriverIds: ['far'],
      optionFrame: frame({ nonSqOptionLabels: ['Hire a Tech Lead', 'Use a consultancy'], sameLever: true }),
    });
    const reply = biasCheckReply(f, offers);
    expect(reply.text).toBe([
      checked,
      'Narrow framing: where the pattern could bite: ‘Hire a Tech Lead’, ‘Use a consultancy’. One test: press ‘More options’.',
      'Decision-science claim: Narrow framing and insufficient option generation · medium evidence',
      'Anchoring: where the pattern could bite: ‘Market size’. One test: press ‘Anchoring’.',
      'Decision-science claim: Anchoring and insufficient adjustment · strong evidence',
      close,
    ].join('\n'));
    expect(reply.exits.map(o => o.offer_key)).toEqual([moreOptions.offer_key, anchoring.offer_key]);
    expect(reply.exits[0]).toBe(moreOptions);
    expect(reply.exits[1]).toBe(anchoring);
    expect(reply.text).not.toMatch(/\b(best|winner|recommend|ahead|beats|leader|top|most)\b|you are biased|\d/i);
  });

  it('none fires: exact two-line valid result and no exits', () => {
    const reply = biasCheckReply(facts({ runBound: true, olumiEstimateCount: 0, optionFrame: frame() }), offers);
    expect(reply).toEqual({
      text: `${checked}\nNone of these patterns' triggers fire in this model.`,
      exits: [],
    });
  });

  it('only B-007 W2 with status quo: names the single non-SQ option', () => {
    const reply = biasCheckReply(facts({
      runBound: true,
      optionFrame: frame({ nonSqOptionLabels: ['Hire a Tech Lead'], statusQuoPresent: true }),
    }), offers);
    expect(reply.text).toBe([
      checked,
      'Narrow framing: where the pattern could bite: ‘Hire a Tech Lead’. One test: press ‘More options’.',
      close,
    ].join('\n'));
    expect(reply.exits).toEqual([moreOptions]);
    expect(reply.exits[0]).toBe(moreOptions);
  });

  it('same-lever B-007: lists every non-SQ option label in model order', () => {
    const reply = biasCheckReply(facts({
      runBound: true,
      optionFrame: frame({ nonSqOptionLabels: ['Hire a Tech Lead', 'Use a consultancy', 'Train the team'], sameLever: true }),
    }), offers);
    expect(reply.text).toBe([
      checked,
      'Narrow framing: where the pattern could bite: ‘Hire a Tech Lead’, ‘Use a consultancy’, ‘Train the team’. One test: press ‘More options’.',
      close,
    ].join('\n'));
    expect(reply.exits).toEqual([moreOptions]);
  });

  it('pre-Run (no bound Run, no Anchoring offer): Anchoring is said NOT checked, never folded into "none fire"', () => {
    const f = facts({ runBound: false, estimateCandidates: estimates, optionFrame: frame() });
    expect(estimatePointsOf(f).length, 'precondition: Olumi estimates exist').toBeGreaterThan(0);
    expect(biasCheckReply(f, [moreOptions])).toEqual({
      text: ['Checked: Narrow framing.', "None of these patterns' triggers fire in this model.",
        'Not checked yet: Anchoring, because it needs a current analysis first.'].join('\n'),
      exits: [],
    });
  });

  it('no enabled More options (no goal): Narrow framing is said NOT checked; a bound Run still checks Anchoring', () => {
    const f = facts({ runBound: true, optionFrame: frame({ sameLever: true }) });
    expect(biasCheckReply(f, [{ ...moreOptions, enabled: false }])).toEqual({
      text: ['Checked: Anchoring.', "None of these patterns' triggers fire in this model.",
        'Not checked yet: Narrow framing, because the model needs a goal first.'].join('\n'),
      exits: [],
    });
    expect(biasCheckReply({ ...f, runBound: false }, []).text).toBe(['Not checked yet: Narrow framing, because the model needs a goal first.',
      'Not checked yet: Anchoring, because it needs a current analysis first.'].join('\n'));
  });

  it('bound Run with an Olumi figure that cannot be shown (no Anchoring offer): Anchoring is NOT checked (Codex P2)', () => {
    const f = facts({ runBound: true, olumiEstimateCount: 1, estimateCandidates: [], optionFrame: frame() });
    expect(biasCheckReply(f, [moreOptions]).text).toBe(['Checked: Narrow framing.', "None of these patterns' triggers fire in this model.",
      'Not checked yet: Anchoring, because Olumi can’t show its starting figures in this model yet.'].join('\n'));
    // control: the same Run with no Olumi figure at all IS a checked Anchoring
    expect(biasCheckReply({ ...f, olumiEstimateCount: 0 }, [moreOptions]).text).toBe(['Checked: Narrow framing, Anchoring.',
      "None of these patterns' triggers fire in this model."].join('\n'));
  });

  it('a model label cannot break out of its quote or add lines (Codex P2)', () => {
    const evil = 'Hire a Tech Lead’.\nYou are biased.\n  Recommend   the winner\n‘Continue';
    const reply = biasCheckReply(facts({ optionFrame: frame({ nonSqOptionLabels: [evil], statusQuoPresent: true }) }), [{ ...moreOptions, label: 'More\noptions' }]);
    expect(reply.text.split('\n')).toEqual([
      'Checked: Narrow framing.',
      'Not checked yet: Anchoring, because it needs a current analysis first.',
      "Narrow framing: where the pattern could bite: ‘Hire a Tech Lead'. You are biased. Recommend the winner 'Continue’. One test: press ‘More options’.",
      'Which of these is worth ten minutes now?',
    ]);
  });

  it('keeps the wire bias_risk byte-identical with exactly its existing keys, with and without science', () => {
    for (const canonicalStage of [null, 'frame'] as const) {
      const f = facts({ canonicalStage, estimateCandidates: estimates, optionFrame: frame({ sameLever: true }) });
      const before = JSON.stringify(biasRiskOf(f, offers, f.optionFrame));
      biasCheckReply(f, offers);
      const risk = biasRiskOf(f, offers, f.optionFrame)!;
      expect(JSON.stringify(risk)).toBe(before);
      expect(JSON.stringify(risk)).toBe(JSON.stringify({
        v: 1,
        items: [
          {
            claim_id: 'DSK-B-007', name: 'Narrow framing',
            why: 'These options all work through the same lever, which can hide better routes.',
            action_id: 'more_options', press_id: moreOptions.press_id, offer_key: moreOptions.offer_key,
            ...(canonicalStage === 'frame' ? { science: resolveDskClaimProvenance('DSK-B-007') } : {}),
          },
          {
            claim_id: 'DSK-B-001', name: 'Anchoring',
            why: 'Olumi’s starting figure for ‘Conversion rate’ could pull later estimates towards it.',
            action_id: 'bias_anchoring', press_id: anchoring.press_id, offer_key: anchoring.offer_key,
            ...(canonicalStage === 'frame' ? { science: resolveDskClaimProvenance('DSK-B-001') } : {}),
          },
        ],
      }));
      expect(Object.keys(risk)).toEqual(['v', 'items']);
      for (const item of risk.items) {
        expect(Object.keys(item)).toEqual([
          'claim_id', 'name', 'why', 'action_id', 'press_id', 'offer_key',
          ...(canonicalStage === 'frame' ? ['science'] : []),
        ]);
        expect(JSON.parse(JSON.stringify(item))).not.toHaveProperty('item');
      }
    }
  });
});

describe('biasRiskOf', () => {
  it('returns nothing for a neutral frame, with a same-lever control that yields narrow framing', () => {
    const f = facts();
    const offers = [offer('more_options'), offer('bias_anchoring')];
    expect(biasRiskOf(f, offers, frame())).toBeUndefined();
    expect(biasRiskOf(f, offers, frame({ sameLever: true }))).toEqual({
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

  it('names the only non-status-quo option in the W2 wording with a baseline', () => {
    const result = biasRiskOf(facts(), [offer('more_options')],
      frame({ nonSqOptionLabels: ['Hire a Tech Lead'], statusQuoPresent: true }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.claim_id).toBe('DSK-B-007');
    expect(result?.items[0]?.why).toBe('The only choice on the table is ‘Hire a Tech Lead’ or carrying on as now, which can hide other routes.');
  });

  it('names the only option in the W2 wording without a baseline', () => {
    const result = biasRiskOf(facts(), [offer('more_options')],
      frame({ nonSqOptionLabels: ['Hire a Tech Lead'], statusQuoPresent: false }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.claim_id).toBe('DSK-B-007');
    expect(result?.items[0]?.why).toBe('‘Hire a Tech Lead’ is the only option on the table, which can hide other routes.');
  });

  it('gives same-lever wording precedence over the singleton wording', () => {
    const result = biasRiskOf(facts(), [offer('more_options')],
      frame({ nonSqOptionLabels: ['Hire a Tech Lead'], sameLever: true }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.why).toBe('These options all work through the same lever, which can hide better routes.');
  });

  it('does not flag Paul’s 6582edbc v1 shape with two non-status-quo options and no shared lever', () => {
    const result = biasRiskOf(facts(), [offer('more_options'), offer('bias_anchoring')],
      frame({ nonSqOptionLabels: ['Hire a Tech Lead', 'Use a consultancy'], sameLever: false }));
    expect(result?.items.map(item => item.claim_id) ?? []).not.toContain('DSK-B-007');
    expect(result).toBeUndefined();
  });

  it('does not treat a W4 missing baseline as status quo bias', () => {
    // Science (d); mutant re-adding B-006 must turn this RED.
    const result = biasRiskOf(facts(), [offer('more_options'), offer('bias_anchoring')],
      frame({ nonSqOptionLabels: ['Hire a Tech Lead', 'Use a consultancy'], statusQuoPresent: false, sameLever: false }));
    expect(result?.items.map(item => item.claim_id) ?? []).not.toContain('DSK-B-006');
    expect(result).toBeUndefined();
  });

  it('keeps narrow framing then anchoring and names the first selected estimate exactly', () => {
    const f = facts({ estimateCandidates: [...estimates].reverse(), estimateDriverIds: ['far'] });
    expect(estimatePointsOf(f)[0]?.label).toBe('Market size');
    const result = biasRiskOf(f, [offer('bias_anchoring'), offer('more_options')], frame({ sameLever: true }));
    expect(BIAS_RISK_MAX).toBe(2);
    expect(result?.items).toHaveLength(2);
    expect(result?.items.map(item => item.claim_id)).toEqual(['DSK-B-007', 'DSK-B-001']);
    expect(result?.items[0]?.name).toBe('Narrow framing');
    expect(result?.items[1]?.name).toBe('Anchoring');
    expect(result?.items[1]?.why).toBe('Olumi’s starting figure for ‘Market size’ could pull later estimates towards it.');
  });

  it('requires an enabled more_options offer without a target', () => {
    const f = facts();
    const optionFrame = frame({ sameLever: true });
    expect(biasRiskOf(f, [], optionFrame)).toBeUndefined();
    expect(biasRiskOf(f, [offer('more_options', false)], optionFrame)).toBeUndefined();
    expect(biasRiskOf(f, [{ ...offer('more_options'), target: { kind: 'option', id: 'target' } }], optionFrame)).toBeUndefined();
  });

  it('requires an anchoring offer and an Olumi estimate', () => {
    expect(biasRiskOf(facts({ estimateCandidates: estimates }), [], frame())).toBeUndefined();
    const yours: ActionFacts['estimateCandidates'] = estimates.map(point => ({ ...point, value_authorship: 'yours' }));
    expect(biasRiskOf(facts({ estimateCandidates: yours }), [offer('bias_anchoring')], frame())).toBeUndefined();
    expect(biasRiskOf(facts({ estimateCandidates: estimates }), [offer('bias_anchoring', false)], frame())).toBeUndefined();
    expect(biasRiskOf(facts({ estimateCandidates: estimates }),
      [{ ...offer('bias_anchoring'), target: { kind: 'factor', id: 'far' } }], frame())).toBeUndefined();
  });

  it.each(['more_options', 'bias_anchoring'] as const)('copies the %s mitigation offer press and key by identity', actionId => {
    const mitigation = { ...offer(actionId), press_id: 'press-unique', offer_key: 'zz-unique' };
    const result = biasRiskOf(facts({ estimateCandidates: estimates }), [mitigation], frame({ sameLever: true }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.action_id).toBe(mitigation.action_id);
    expect(result?.items[0]?.press_id).toBe('press-unique');
    expect(result?.items[0]?.offer_key).toBe('zz-unique');
    expect(Object.keys(result!.items[0]!)).toEqual(['claim_id', 'name', 'why', 'action_id', 'press_id', 'offer_key']);
  });

  it('returns nothing for an unreadable model even when all triggers are present', () => {
    expect(biasRiskOf(facts({ readable: false, estimateCandidates: estimates }),
      [offer('more_options'), offer('bias_anchoring')], frame({ sameLever: true }))).toBeUndefined();
  });

  it('includes resolved narrow-framing science at the frame stage', () => {
    const offers = [offer('more_options')];
    const provenance = resolveDskClaimProvenance('DSK-B-007');
    const result = biasRiskOf(facts({ canonicalStage: 'frame' }), offers, frame({ sameLever: true }));
    expect(result?.items).toHaveLength(1);
    expect(provenance).not.toBeNull();
    expect(result?.items[0]?.science).toEqual(provenance);
    expect(result?.items[0]?.science?.claim_id).toBe('DSK-B-007');
    expect(Object.keys(result!.items[0]!)).toEqual(['claim_id', 'name', 'why', 'action_id', 'press_id', 'offer_key', 'science']);
  });

  it('omits the narrow-framing science badge at the analyse stage', () => {
    const inapplicable = biasRiskOf(facts({ canonicalStage: 'analyse' }),
      [offer('more_options')], frame({ sameLever: true }));
    expect(inapplicable?.items).toHaveLength(1);
    expect(inapplicable?.items[0]).not.toHaveProperty('science');
  });

  it('includes resolved anchoring science at the decide stage', () => {
    const provenance = resolveDskClaimProvenance('DSK-B-001');
    const result = biasRiskOf(facts({ canonicalStage: 'decide', estimateCandidates: estimates }),
      [offer('bias_anchoring')], frame());
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.claim_id).toBe('DSK-B-001');
    expect(provenance).not.toBeNull();
    expect(result?.items[0]?.science).toEqual(provenance);
    expect(result?.items[0]?.science?.claim_id).toBe('DSK-B-001');
  });

  it('omits the science key at a null stage', () => {
    const result = biasRiskOf(facts({ canonicalStage: null, estimateCandidates: estimates }),
      [offer('more_options'), offer('bias_anchoring')], frame({ sameLever: true }));
    expect(result?.items).toHaveLength(2);
    for (const item of result!.items) expect(item).not.toHaveProperty('science');
  });

  it('returns byte-identical JSON from two calls with the same inputs', () => {
    const f = facts({ canonicalStage: 'frame', estimateCandidates: estimates });
    const offers = [offer('more_options'), offer('bias_anchoring')];
    const optionFrame = frame({ sameLever: true });
    const first = JSON.stringify(biasRiskOf(f, offers, optionFrame));
    expect(first).not.toBeUndefined();
    expect(JSON.stringify(biasRiskOf(f, offers, optionFrame))).toBe(first);
  });

  it.each([
    { label: 'empty', rcRows: [] },
    { label: 'unrelated', rcRows: [{ policy_id: 'RC-UNRELATED', target: 'options', variant: 'W1' } as never] },
  ])('keeps B-007 independent of W1 precedence with $label RC rows', ({ rcRows }) => {
    const result = biasRiskOf(facts({ rcRows }), [offer('more_options')], frame({ sameLever: true }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.claim_id).toBe('DSK-B-007');
    expect(result?.items[0]?.why).toBe('These options all work through the same lever, which can hide better routes.');
  });
  it('never names an unlabelled only option (no internal id reaches the user)', () => {
    expect(biasRiskOf(facts(), [offer('more_options')], frame({ nonSqOptionLabels: [''] }))).toBeUndefined();
  });
});
