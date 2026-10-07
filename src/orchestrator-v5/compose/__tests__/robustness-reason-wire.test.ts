import assert from 'node:assert/strict';
import { test, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { readMayNameLeadingOptionFromResult } from '../../../orchestrator/context/constraint-feasibility.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { replaceAssertingUnits } from '../redactable-units.js';
import { findLeaderClaims } from '../leading-option-egress-guard.js';

const LEADER = 'Hire Marketing Manager';
const NEUTRAL = 'No single option can be put forward yet.';
// Verbatim resolved PLoT wire fixtures: cddc7560f3350238685b6561fb0f83295f1fe8cb,
// src/routes/v2/robustness-display-verdict.ts:96-99,168-171;
// RESULT_CHANGE_PHRASE in src/constants/result-voice.ts:53.
const PLOT_REASONS: ReadonlyArray<readonly [string, string]> = [
  ['this run held up under the changes we tested', 'this run held up under the changes we tested'],
  ['this run was only moderately stable under the changes we tested', 'this run was only moderately stable under the changes we tested'],
  ['small changes to your assumptions could change the most-supported option', 'small changes to your assumptions could change the result'],
  ['robustness was not assessed for this run', 'robustness was not assessed for this run'],
  ['varying any one of the factors we could test did not change the most-supported option, but this run scored low on our other robustness checks',
    'varying any one of the factors we could test did not change the result, but this run scored low on our other robustness checks'],
  ['varying any one of the factors we could test did not change the most-supported option, and this run mostly held up under the other changes we tested',
    'varying any one of the factors we could test did not change the result, and this run mostly held up under the other changes we tested'],
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

function bodyText(body: OlumiResponse): unknown {
  return (body.blocks[1] as unknown as Record<string, unknown>).body;
}

function checkWithheld(input: OlumiResponse, expectedReason: string, expectedBody: string, graph?: unknown) {
  const before = JSON.stringify(input);
  const { response } = enforce(input, false, graph);
  expect(robustness(response).display_verdict_reason).toBe(expectedReason);
  expect(bodyText(response)).toBe(expectedBody);
  expect(findLeaderClaims(response).length).toBe(0);
  const { display_verdict_reason: _before, ...beforeScience } = robustness(input);
  const { display_verdict_reason: _after, ...afterScience } = robustness(response);
  assert.deepEqual(afterScience, beforeScience, 'level, fragile edges and tipping text unchanged');
  expect(JSON.stringify(input)).toBe(before);
  return response;
}

for (const [reason, after] of PLOT_REASONS) {
  test(`PLoT withheld exact: ${reason}`, () => {
    checkWithheld(witness(reason), after, after);
  });
  test(`PLoT permitted byte/reference twin: ${reason}`, () => {
    const input = witness(reason);
    const bytes = JSON.stringify(input);
    const { response, changed } = enforce(input, true);
    expect(changed).toBe(false);
    expect(response).toBe(input);
    expect(JSON.stringify(response)).toBe(bytes);
    expect(robustness(response).display_verdict_reason).toBe(reason);
    expect(bodyText(response)).toBe(reason);
    // Permitted twins intentionally retain the licensed claims: oracle parity,
    // not zero hits, is the invariant on this arm.
    assert.deepEqual(findLeaderClaims(response), findLeaderClaims(input));
  });
}

const PROSE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Robust: the most-supported option held when each factor varied.', 'Robust: the result held when each factor varied.'],
  ['Tipping point: if Demand falls by 12%, the most-supported option would change',
    'Tipping point: if Demand falls by 12%, the result would change'],
  [`${LEADER} is the most-supported option, but this run scored low on our other robustness checks.`,
    'No single option can be put forward yet, but this run scored low on our other robustness checks.'],
  [`Demand is volatile, ${LEADER} is the most-supported option.`,
    'Demand is volatile, no single option can be put forward yet.'],
  [`Demand is volatile, ${LEADER} leads in 54% of runs.`,
    'Demand is volatile, no single option can be put forward yet.'],
  [`Demand matters most; ${LEADER} is most supported.`,
    'Demand matters most; no single option can be put forward yet.'],
  [`${LEADER} is the most-supported option, ${LEADER} leads.`, NEUTRAL],
  [`${LEADER} is the most-supported option, ${LEADER} leads, but Demand matters.`,
    'No single option can be put forward yet, but Demand matters.'],
  [`${LEADER} is fragile, and it is the most-supported option.`, NEUTRAL],
  [`${LEADER}, the most-supported option, is fragile.`, NEUTRAL],
  [`The most-supported option, ${LEADER}, is fragile.`, NEUTRAL],
  [`${LEADER} is the most-supported option,`, NEUTRAL],
  [`${LEADER} is strong. It is the most-supported option; but Demand matters.`,
    'No single option can be put forward yet; but Demand matters.'],
  [`${LEADER} is the most-supported option. Demand is the most sensitive input.`,
    'No single option can be put forward yet. Demand is the most sensitive input.'],
];

for (const [before, after] of PROSE_ROWS) {
  test(`grammar/science exact: ${before}`, () => {
    const response = checkWithheld(witness(before), after, after);
    for (const output of [robustness(response).display_verdict_reason, bodyText(response)]) {
      const text = String(output);
      assert.ok(text.length > 0);
      assert.ok(!/\. [a-z]|,\.|\. ,| {2}/.test(text), `grammar: ${text}`);
      assert.ok((text.match(/no single option can be put forward yet/gi)?.length ?? 0) <= 1);
    }
  });
}

for (const clean of [
  'Demand is the most sensitive input; the result held when each factor varied.',
  'the most fragile link is Demand → Revenue',
  'Robust: the result held when each factor varied.',
  'no single option is the most supported, but Demand matters',
  'We tested Demand, but this run scored low on our other robustness checks.',
]) {
  test(`kept science byte control: ${clean}`, () => {
    const input = witness(clean);
    checkWithheld(input, clean, clean);
  });
}

for (const copied of [false, true]) {
  for (const graph of [null, { nodes: [{ kind: 'option', label: LEADER }] }]) {
    test(`no-roster/card-kind exact-copy: copied=${copied}, roster=${graph !== null}`, () => {
      const [before, after] = PLOT_REASONS[4];
      checkWithheld(witness(before, copied), after, after, graph);
    });
  }
}

test('named no-roster robustness and exact-copy are still neutralised', () => {
  const reason = `${LEADER} is the most-supported option, but Demand matters.`;
  const after = 'No single option can be put forward yet, but Demand matters.';
  checkWithheld(witness(reason, true), after, after, null);
});

test('robustness card body projects independently of enrichment reason', () => {
  const input = witness('This run scored low on our other robustness checks.');
  (input.blocks[1] as unknown as Record<string, unknown>).body = PROSE_ROWS[1][0];
  checkWithheld(input, 'This run scored low on our other robustness checks.', PROSE_ROWS[1][1]);
});

test('exact-copy coverage is independent of block order', () => {
  const [before, after] = PLOT_REASONS[2];
  const input = witness(before, true);
  input.blocks.reverse();
  const { response } = enforce(input, false, null);
  expect((response.blocks[0] as unknown as Record<string, unknown>).body).toBe(after);
  expect(((response.blocks[1] as unknown as Record<string, unknown>).enrichment as {
    robustness: { display_verdict_reason: string };
  }).robustness.display_verdict_reason).toBe(after);
  expect(findLeaderClaims(response).length).toBe(0);
});

test('summary preserves the original science sentence through base surgery', () => {
  const input = witness('Robust: the result held when each factor varied.');
  (input.blocks[0] as unknown as Record<string, unknown>).summary =
    'Demand is the most sensitive factor. Hire Marketing Manager leads at 72%.';
  const { response } = enforce(input, false);
  expect((response.blocks[0] as unknown as Record<string, unknown>).summary).toBe(
    'Demand is the most sensitive factor. No single option can be put forward yet.',
  );
  expect(findLeaderClaims(response).length).toBe(0);
});

// Ordinary whitespace parity covers BOTH first and collapsed replacement arms.
for (const trailing of ['', ' ', '  ', '\t', '\r', '\u00a0', '\u2028', '\ufeff']) {
  test(`linear trailing whitespace preserves ordinary surgery: ${JSON.stringify(trailing)}`, () => {
    expect(replaceAssertingUnits(`Claim${trailing}`, unit => unit.startsWith('Claim'), NEUTRAL)).toBe(NEUTRAL + trailing);
    expect(replaceAssertingUnits(`Claim. Claim${trailing}`, unit => unit.startsWith('Claim'), NEUTRAL)).toBe(NEUTRAL + trailing);
    expect(findLeaderClaims(witness(NEUTRAL)).length).toBe(0);
  });
}

const SPACES = ' '.repeat(20_000);
for (const tail of ['x', ':)']) {
  for (const surface of ['reason', 'robustness-card', 'exact-copy'] as const) {
    test(`timing no-separator ${surface} 20k spaces tail=${tail}`, () => {
      const reason = `most-supported option${SPACES}${tail}`;
      const after = `the result${SPACES}${tail}`;
      const input = witness(surface === 'robustness-card' ? 'The checks are ready.' : reason, surface === 'exact-copy');
      if (surface === 'reason') input.blocks.pop();
      if (surface === 'robustness-card') (input.blocks[1] as unknown as Record<string, unknown>).body = reason;
      enforce(witness(PLOT_REASONS[2][0]), false);
      const start = performance.now();
      const { response } = enforce(input, false, null);
      const elapsed = performance.now() - start;
      console.info(`R2_TIMING ${surface} spaces tail=${tail}: ${elapsed.toFixed(2)} ms`);
      assert.ok(elapsed < 50, `elapsed ${elapsed.toFixed(2)} ms`);
      expect(robustness(response).display_verdict_reason).toBe(surface === 'robustness-card' ? 'The checks are ready.' : after);
      if (surface !== 'reason') expect(bodyText(response)).toBe(after);
      expect(findLeaderClaims(response).length).toBe(0);
    });
  }
}

for (const tail of ['x', ':)']) {
  test(`timing 10k comma-space clauses tail=${tail}`, () => {
    const input = witness(`most-supported option${', '.repeat(10_000)}${tail}`, true);
    const start = performance.now();
    const { response } = enforce(input, false, null);
    const elapsed = performance.now() - start;
    console.info(`R2_TIMING comma-space tail=${tail}: ${elapsed.toFixed(2)} ms`);
    assert.ok(elapsed < 50, `elapsed ${elapsed.toFixed(2)} ms`);
    expect(robustness(response).display_verdict_reason).toBe(NEUTRAL);
    expect(bodyText(response)).toBe(NEUTRAL);
    expect(findLeaderClaims(response).length).toBe(0);
  });
}

for (const collapsed of [false, true]) {
  test(`timing assistant_text linear whitespace collapsed=${collapsed}`, () => {
    const input = witness('The checks are ready.');
    input.assistant_text = `${collapsed ? 'Hire Marketing Manager leads. ' : ''}Hire Marketing Manager leads${SPACES}x`;
    const start = performance.now();
    const { response } = enforce(input, false);
    const elapsed = performance.now() - start;
    console.info(`R2_TIMING assistant collapsed=${collapsed}: ${elapsed.toFixed(2)} ms`);
    assert.ok(elapsed < 50, `elapsed ${elapsed.toFixed(2)} ms`);
    expect(response.assistant_text).toBe(NEUTRAL);
    expect(findLeaderClaims(response).length).toBe(0);
  });
}

for (const separators of [127, 128]) {
  test(`clause cap boundary: ${separators + 1} clauses`, () => {
    const before = `most-supported option${', x'.repeat(separators)}`;
    const after = separators === 127 ? `the result${', x'.repeat(separators)}` : NEUTRAL;
    checkWithheld(witness(before, true), after, after, null);
  });
}

test('permitted no-roster exact-copy preserves every byte and original reference', () => {
  const input = witness(PLOT_REASONS[4][0], true);
  const bytes = JSON.stringify(input);
  const { response, changed } = enforce(input, true, null);
  expect(response).toBe(input);
  expect(changed).toBe(false);
  expect(JSON.stringify(response)).toBe(bytes);
  expect(robustness(response).display_verdict_reason).toBe(PLOT_REASONS[4][0]);
  expect(bodyText(response)).toBe(PLOT_REASONS[4][0]);
  assert.deepEqual(findLeaderClaims(response), findLeaderClaims(input));
});

test('ordinary collapsed units preserve the separator before surviving science', () => {
  expect(replaceAssertingUnits('Claim. Claim. Demand matters.', unit => unit.startsWith('Claim'), NEUTRAL)).toBe(
    'No single option can be put forward yet. Demand matters.',
  );
  expect(replaceAssertingUnits('Claim.\nClaim.\nDemand matters.', unit => unit.startsWith('Claim'), NEUTRAL)).toBe(
    'No single option can be put forward yet.\nDemand matters.',
  );
});
