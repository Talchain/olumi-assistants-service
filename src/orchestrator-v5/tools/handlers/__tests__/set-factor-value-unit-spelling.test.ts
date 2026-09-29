import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../routing/types.js';

/**
 * THE TWO DEFECTS THE COMPARISON-KEY SPLIT MADE REACHABLE, CLOSED HERE.
 *
 * Folding the unit comparison stopped a spelling-only proposal being REFUSED.
 * It therefore let a spelling-only proposal reach the WRITE path for the first
 * time — and two readers downstream were still on the unsplit answer:
 *
 *  1. `noop` was computed with `before.unit === after.unit`, STRICTLY. A
 *     spelling-only proposal was reported as an APPLIED CHANGE: "Updated
 *     Headcount from 12 people to 12 People. This makes the last analysis
 *     stale. Re-run analysis…" — narrating a change that did not happen,
 *     contradicting the freshness authority (the analysis hash is unchanged),
 *     and prompting a paid re-run.
 *
 *  2. `after.unit = parsed.unit ?? before.unit` persisted the PROPOSAL's
 *     spelling. `currencyPrefix` (`cee/factor-extraction/display-value.ts:65`)
 *     is CASE-SENSITIVE — `unit === "GBP"`, not a folded compare — so a factor
 *     stored 'GBP' that received 'gbp' silently LOST ITS CURRENCY SYMBOL on
 *     every subsequent render.
 *
 * ⭐ THE RULE, and it is narrower than "fold everything": on a FOLDED-KEY MATCH
 * the factor's EXISTING spelling wins, because nothing was redeclared. A
 * genuinely NEW unit (no stored unit, or a different comparison key) still
 * persists the user's own case — that is the whole point of keeping the display
 * form. Both directions are asserted below.
 */

function graphWithUnit(factorId: string, unit: string): GraphV3T {
  const graph = buildD1Fixture();
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === factorId
        ? { ...n, observed_state: { ...(n.observed_state ?? {}), unit } }
        : n,
    ),
  } as GraphV3T;
}

function proposal(id: string, value: number, unit: string): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: { id, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'value', value: { value, unit }, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

const handler = createSetFactorValueHandler();

describe('a spelling-only unit proposal', () => {
  it('POSITIVE CONTROL: a genuine value change is still reported as APPLIED', async () => {
    // Without this, "it reports noop" could pass because the handler reports
    // noop for everything.
    const outcome = await handler(
      buildHandlerInvocation({ proposal: proposal('f-uncapped', 20, 'people'), graph: buildD1Fixture() }),
    );
    const fact = (outcome.handler_facts as unknown[])[0] as { noop: boolean; result: { status: string } };
    expect(fact.noop).toBe(false);
    expect(fact.result.status).toBe('applied');
  });

  it('is reported as a NOOP, not as an applied change', async () => {
    // 'people' -> 'People', same number. Nothing changed.
    const outcome = await handler(
      buildHandlerInvocation({ proposal: proposal('f-uncapped', 12, 'People'), graph: buildD1Fixture() }),
    );
    const fact = (outcome.handler_facts as unknown[])[0] as { noop: boolean; result: { status: string } };
    expect(fact.noop).toBe(true);
    expect(fact.result.status).toBe('noop');
  });

  it('KEEPS the factor’s stored spelling — a currency symbol is not lost', async () => {
    // `currencyPrefix` matches 'GBP' exactly. Persisting 'gbp' would strip the £.
    const outcome = await handler(
      buildHandlerInvocation({ proposal: proposal('f-uncapped', 12, 'gbp'), graph: graphWithUnit('f-uncapped', 'GBP') }),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    const factor = mutated.nodes.find((n) => n.id === 'f-uncapped');
    expect(factor?.observed_state?.unit).toBe('GBP');
  });

  it('OPPOSITE-DIRECTION TWIN: introducing a unit on a valued factor is STILL refused', async () => {
    // f-quality carries a recorded value and NO unit. Adding one is a scale
    // REDECLARATION (guard 2c), and folding the comparison must not weaken that:
    // the guard is about whether a unit was DECLARED, not about how it is spelt.
    await expect(
      handler(buildHandlerInvocation({ proposal: proposal('f-quality', 5, 'Widgets'), graph: buildD1Fixture() })),
    ).rejects.toThrow(/without a unit/i);
  });

  it('OPPOSITE-DIRECTION TWIN: a spelling-only proposal with a DIFFERENT value still applies', async () => {
    // Folding must not swallow a real edit that happens to re-spell the unit.
    const outcome = await handler(
      buildHandlerInvocation({ proposal: proposal('f-uncapped', 30, 'People'), graph: buildD1Fixture() }),
    );
    const fact = (outcome.handler_facts as unknown[])[0] as { noop: boolean };
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(fact.noop).toBe(false);
    expect(mutated.nodes.find((n) => n.id === 'f-uncapped')?.observed_state?.raw_value).toBe(30);
    // and the stored spelling is still preserved on the folded match
    expect(mutated.nodes.find((n) => n.id === 'f-uncapped')?.observed_state?.unit).toBe('people');
  });
});
