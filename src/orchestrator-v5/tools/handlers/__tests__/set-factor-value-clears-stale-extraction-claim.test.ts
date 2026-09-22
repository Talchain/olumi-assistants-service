/**
 * ⛔⛔ A USER'S OWN EDIT MUST NOT KEEP THE PRODUCER'S EXTRACTION CLAIM ABOUT THE
 * VALUE IT REPLACED.
 *
 * ── THE RULE IS ALREADY WRITTEN IN THIS HANDLER, ONE FIELD OVER ─────────────
 * `set-factor-value.ts:652-671` states it in full, for `elicited_from`:
 *
 *   *"AND THE ABSENT BRANCH MUST CLEAR IT, NOT MERELY DECLINE TO SET IT.
 *    `merged` SPREADS the prior `observed_state`, so a node that already
 *    carries `elicited_from` keeps it unless this deletes it."*
 *
 * `merged` (`:620`) spreads `...(node.observed_state ?? {})` and the handler
 * never touches `extractionType`, so a stale `'inferred'` rides straight through
 * into `node.observed_state = merged` (`:678`) beside the new
 * `source: 'user_override'`. The rule was applied to one field and not to its
 * neighbour.
 *
 * ── WHY IT IS NOT COSMETIC, AND WIDER THAN THE CARD ─────────────────────────
 * The handler's OWN comment at `:627-628` records that *"the provenance stamp
 * below is CLOBBERED by the V3 response transform (schema-v3.ts recomputes
 * node.provenance from extractionType)"*. So the stale claim does not merely
 * linger — it is the input from which `node.provenance` is recomputed. A number
 * the user typed is persisted, and then re-served, as the model's inference.
 *
 * Measured consequence on the UI side (22 Sep 2026, verified at
 * `DecisionGuideAI@0879918`, reviewing #1857 from this end):
 *   · `cee-v3.ts:135` — the V3 wire's `observed_state` carries
 *     `extractionType: z.enum(["explicit","inferred","range","observed"])`.
 *   · `canvas/utils/applyDraftResult.ts:39,55` — hydrate re-keys the wire's
 *     `observed_state` into `observedState` VERBATIM, with no clearing.
 *   · `canvas/domain/valueProvenance.ts:401-405` — the reader then returns true
 *     and the card renders *"Estimate not yet confirmed — this value was filled
 *     in for you"*, about a number the user typed.
 * The canvas can withdraw the claim in-session (#1857 does, correctly) but a
 * reload re-serves it from here. THIS is the boundary that closes it.
 *
 * This is Gate-0 contract item 2 — *"a confirmed change produces exactly the
 * intended canonical semantic change AND RELOAD AGREES"*.
 *
 * ⚠ ABSENT, NOT PRESENT-BUT-UNDEFINED, for the reason `:673-677` already gives
 * about `elicited_from`: a present-but-undefined key survives `structuredClone`
 * and object spreads while reading as present to `in` and `Object.keys`.
 */
import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '@talchain/schemas';
import type { ProposalAction } from '../../../proposals/types.js';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

const TARGET = 'f-churn';
/** A second factor carrying the same stale claim, so a blanket wipe is visible. */
const DECOY = 'f-support-load';

function buildGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-arr', kind: 'goal', label: 'ARR' },
      {
        id: TARGET,
        kind: 'factor',
        label: 'Monthly Churn Rate',
        // The producer's claim about the OLD value.
        observed_state: { value: 10, raw_value: 10, extractionType: 'inferred' },
      },
      {
        id: DECOY,
        kind: 'factor',
        label: 'Support Load',
        observed_state: { value: 4_000, raw_value: 4_000, extractionType: 'inferred' },
      },
    ],
    edges: [
      {
        from: TARGET,
        to: 'g-arr',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
  } as unknown as GraphV3T;
}

function proposalFor(value: unknown, targetId = TARGET): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: targetId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

async function invoke(proposal: ProposalAction, graph: GraphV3T) {
  return createSetFactorValueHandler()(buildHandlerInvocation({ proposal, graph }));
}

function observedAfter(outcome: { mutated_graph?: unknown }, id: string) {
  const nodes = (outcome.mutated_graph as { nodes: Array<Record<string, unknown>> }).nodes;
  return nodes.find((n) => n.id === id)?.observed_state as Record<string, unknown>;
}

describe("a user's edit withdraws the producer's claim about the value it replaced", () => {
  it('⛔ the stale extractionType is ABSENT after the write, not merely undefined', async () => {
    const outcome = await invoke(proposalFor({ value: 0.2 }), buildGraph());
    const after = observedAfter(outcome, TARGET);

    // PRECONDITION, pinned in-test: the write really happened and is the user's.
    // Without this the assertion below would pass on a handler that did nothing.
    expect(after.value, 'the user’s number was written').toBe(0.2);
    expect(after.source, 'and it is stamped as the user’s own edit').toBe('user_override');

    // `in`, not `=== undefined`: a present-but-undefined key survives spreads
    // and structuredClone, and reads as present to every key-based consumer.
    expect(
      'extractionType' in after,
      'the producer’s claim about the REPLACED value must be gone, not undefined',
    ).toBe(false);
  });

  it('CONTRAST — one stale sentence is withdrawn, the rest of observed_state survives', async () => {
    const outcome = await invoke(proposalFor({ value: 0.2 }), buildGraph());
    const after = observedAfter(outcome, TARGET);
    // Without this, the assertion above would pass on a fix that deleted the
    // whole observed_state, or replaced it wholesale.
    expect(after.raw_value, 'the raw magnitude is still carried').toBe(0.2);
    expect(Object.keys(after).length, 'observed_state was not emptied').toBeGreaterThan(1);
  });

  it('CONTRAST — an untouched factor keeps its claim, so this is not a blanket wipe', async () => {
    const outcome = await invoke(proposalFor({ value: 0.2 }), buildGraph());
    const decoy = observedAfter(outcome, DECOY);
    // The producer's claim about a value NOBODY edited is still true and must
    // stand. A fix that walked every node would break this.
    expect(decoy.extractionType, 'only the edited factor is withdrawn').toBe('inferred');
    expect(decoy.value).toBe(4_000);
  });
});
