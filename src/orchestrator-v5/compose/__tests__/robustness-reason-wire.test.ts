import assert from 'node:assert/strict';
import { test } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { readMayNameLeadingOptionFromResult } from '../../../orchestrator/context/constraint-feasibility.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { findLeaderClaims } from '../leading-option-egress-guard.js';

const LEADER = 'Hire Marketing Manager';
const SCIENCE = 'but this run scored low on our other robustness checks. Tipping point: Demand must rise by 12%.';
const REASONS = [
  `${LEADER} is the most-supported option, ${SCIENCE}`,
  `varying any one of the factors we could test did not change the most-supported option, ${SCIENCE}`,
];

function witness(reason: string, copied = false): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'The robustness checks are ready.',
    blocks: [
      { type: 'analysis_result', summary: 'The checks are ready.', leading_option_id: null,
        win_probabilities: {}, enrichment: { robustness: {
          level: 'fragile', display_verdict: 'fragile', display_verdict_reason: reason,
          fragile_edges: [{ edge_id: 'demand->revenue', switch_probability: 0.23 }],
          tipping_point: 'Demand must rise by 12%.',
        } } },
      { type: 'review_card', card_kind: copied ? 'insight' : 'robustness', body: reason },
    ],
  } as unknown as OlumiResponse;
}

function enforce(body: OlumiResponse, permitted: boolean, graph: unknown = {
  nodes: [{ kind: 'option', label: LEADER }],
}) {
  // Opposing legacy stamp proves that CURRENT typed Run permission owns this gate.
  const result = { constraint_verdict: { may_name_leading_option: permitted },
    enrichment: { __cee_claim_safety: { may_name_leading_option: !permitted } } };
  return enforceLeadingOptionClaimsAtWire(body, {
    requestId: 'robleak-chip-click', exitPath: 'chip_click', graph,
    mayNameLeadingOption: readMayNameLeadingOptionFromResult(result),
    analysisReady: { analysis_admission: { permitted_analysis_mode: 'comparative_leader' } },
  });
}

function robustness(body: OlumiResponse): Record<string, unknown> {
  const block = body.blocks[0];
  assert.equal(block.type, 'analysis_result');
  assert.ok('enrichment' in block);
  return (block.enrichment as Record<string, unknown>).robustness as Record<string, unknown>;
}

for (const reason of REASONS) {
  test(`withheld chip_click removes reason and body claims: ${reason.slice(0, 40)}`, () => {
    const input = witness(reason);
    assert.ok(findLeaderClaims(input).length > 0, 'positive alarm control');
    const { response } = enforce(input, false);
    const wire = JSON.stringify(response);
    assert.ok(!wire.includes(LEADER), 'no leader identity anywhere on the response wire');
    assert.ok(!wire.includes('most-supported option'), 'no implicit leader referent either');
    assert.equal(findLeaderClaims(response).length, 0, 'unchanged egress scanner sees no hits');
    assert.ok(String(robustness(response).display_verdict_reason).endsWith(SCIENCE));
    assert.ok(String((response.blocks[1] as unknown as Record<string, unknown>).body).endsWith(SCIENCE));
    const { display_verdict_reason: _before, ...beforeScience } = robustness(input);
    const { display_verdict_reason: _after, ...afterScience } = robustness(response);
    assert.deepEqual(afterScience, beforeScience, 'level, fragile edges and tipping text unchanged');
    assert.equal(robustness(input).display_verdict_reason, reason, 'input is not mutated');
  });

  test(`permitted twin preserves every byte: ${reason.slice(0, 40)}`, () => {
    const input = witness(reason);
    const bytes = JSON.stringify(input);
    const { response, changed } = enforce(input, true);
    assert.equal(changed, false);
    assert.equal(response, input);
    assert.equal(JSON.stringify(response), bytes);
    assert.equal(robustness(response).display_verdict_reason, reason);
  });
}

test('generic reason and exact non-robustness body copy are covered without a roster', () => {
  const { response } = enforce(witness(REASONS[1], true), false, null);
  assert.equal(findLeaderClaims(response).length, 0);
  assert.ok(String(robustness(response).display_verdict_reason).endsWith(SCIENCE));
  assert.ok(String((response.blocks[1] as unknown as Record<string, unknown>).body).endsWith(SCIENCE));
});

test('non-asserting robustness reason and body remain byte-identical when withheld', () => {
  const reason = `We tested Demand, ${SCIENCE}`;
  const input = witness(reason);
  const { response } = enforce(input, false);
  assert.equal(robustness(response).display_verdict_reason, reason);
  assert.equal((response.blocks[1] as unknown as Record<string, unknown>).body, reason);
});

test('robustness card body is covered independently of an enrichment reason', () => {
  const input = witness('This run scored low on our other robustness checks.');
  (input.blocks[1] as unknown as Record<string, unknown>).body = REASONS[1];
  const { response } = enforce(input, false);
  assert.equal(findLeaderClaims(response).length, 0);
  assert.ok(String((response.blocks[1] as unknown as Record<string, unknown>).body).endsWith(SCIENCE));
});

for (const prefix of ['most-supported option', 'We tested Demand']) {
  test(`20k whitespace clause timing <50 ms: ${prefix}`, () => {
    const input = witness(`${prefix},${' '.repeat(20_000)}${SCIENCE}`);
    enforce(witness(REASONS[1]), false); // warm module/classifier work outside measurement
    const start = performance.now();
    const { response } = enforce(input, false);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `elapsed ${elapsed.toFixed(2)} ms`);
    assert.ok(String(robustness(response).display_verdict_reason).endsWith(SCIENCE));
    assert.equal(findLeaderClaims(response).length, 0);
  });
}

test('semicolon clauses retain science and remove a distributed leader claim', () => {
  const reason = `${LEADER} is strong. It is the most-supported option; ${SCIENCE}`;
  const { response } = enforce(witness(reason), false);
  assert.ok(!JSON.stringify(response).includes(LEADER));
  assert.equal(findLeaderClaims(response).length, 0);
  assert.ok(String(robustness(response).display_verdict_reason).endsWith(SCIENCE));
});

test('a clean clause ending in the shared withheld sentence keeps its original full stop', () => {
  const reason = `${REASONS[0]}; No single option can be put forward yet., and Demand was tested.`;
  const { response } = enforce(witness(reason), false);
  assert.ok(String(robustness(response).display_verdict_reason).endsWith(
    'No single option can be put forward yet., and Demand was tested.',
  ));
});
