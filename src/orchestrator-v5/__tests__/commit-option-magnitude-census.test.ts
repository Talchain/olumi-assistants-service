/**
 * ⭐⭐ THE FOUR-POINT OPTION→FACTOR MAGNITUDE CENSUS — point 4, `at_commit`.
 * Points 1-3 (the draft adapter) are pinned in
 * `src/cee/draft/records/__tests__/option-magnitude-four-point-census.test.ts`.
 *
 * WHAT THIS PINS. That the census is CALLED at the commit chokepoint, on a
 * graph-writing commit and only on one, and that it counts the population the
 * `at_commit` point names. A unit test of the census function cannot see any of
 * that — an instrument never called reports nothing and reds nothing.
 *
 * ⭐ THE SECOND CASE IS THE ONE THAT DISCRIMINATES. Its interventions live at
 * TOP-LEVEL `node.interventions` as `{ value }` objects — the canonical
 * persisted OptionV3 carrier — while the draft projector writes bare numbers to
 * `node.data.interventions`. A census that read only the projector's carrier
 * would report those options as unvalued at commit and manufacture a cliff
 * between `after_projection` and `at_commit` that is pure shape, not loss.
 *
 * ⚠ WHAT IS *NOT* PINNED HERE, stated rather than left to be assumed from the
 * call site's comment: that the census reads `graphForStore` rather than
 * `metadata.graph`. That mutant SURVIVES, and it survives for a good reason —
 * the persist passes between those two objects move interventions between
 * carriers, and the census reads every carrier, so the two agree on this
 * measure for every input. The choice of `graphForStore` is about which
 * artefact the point's NAME promises, not about a difference any assertion
 * here can currently see. Demonstrated in the PR body, not asserted.
 *
 * MUTATION-CHECK (recorded in the PR body; run in a throwaway worktree
 * OUTSIDE the repo root): deleting this emit, and deleting its `writesGraph`
 * gate, were each mutated separately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { TelemetryEvents, setTestSink } from '../../utils/telemetry.js';

const META = {
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_class: 'handler' as const,
  handler_id: null,
  request_hash: 'sha256:test-magnitude-census',
  llm_calls_used: 1,
  duration_ms: 42,
  handler_facts: [],
};

function makeSpyStore(): { readonly store: SessionStore; readonly appendCalls: SessionTurnWrite[] } {
  const appendCalls: SessionTurnWrite[] = [];
  const noop = createNoopSessionStore({ appendId: 'row-census' });
  vi.spyOn(noop, 'append').mockImplementation(async (write) => {
    appendCalls.push(write);
    return { id: 'row-census' };
  });
  return { store: noop, appendCalls };
}

const composed = () =>
  composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'ok', stage: 'analyse' });

interface CapturedEvent {
  readonly name: string;
  readonly data: Record<string, unknown>;
}
let captured: CapturedEvent[] = [];

beforeEach(() => {
  captured = [];
  setTestSink((name, data) => {
    captured.push({ name, data: data as Record<string, unknown> });
  });
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

/** Bound by the frozen EVENT NAME — commit emits several other events. */
function censusEvents(): CapturedEvent[] {
  return captured.filter((e) => e.name === TelemetryEvents.CeeDraftOptionMagnitudeCensus);
}

function theOne(): Record<string, unknown> {
  const events = censusEvents();
  expect(events, 'exactly one census event per graph-writing commit').toHaveLength(1);
  return events[0]!.data;
}

describe('option→factor magnitude census — the commit point', () => {
  it('counts every surviving option→factor edge and the ones with no magnitude', async () => {
    // Three option→factor edges. `opt_partner` carries a magnitude for the
    // factor it points at; the other two carry none. The factor→goal edge and
    // the decision→option edges must NOT enter either number.
    const graph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Reliability' },
        { id: 'dec', kind: 'decision', label: 'Decision' },
        { id: 'opt_hold', kind: 'option', label: 'Hold', is_baseline: true },
        { id: 'opt_warehouse', kind: 'option', label: 'Warehouse' },
        {
          id: 'opt_partner',
          kind: 'option',
          label: 'Partner',
          data: { interventions: { fac_capacity: 0.6 } },
        },
        { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
      ],
      edges: [
        { from: 'dec', to: 'opt_hold' },
        { from: 'dec', to: 'opt_warehouse' },
        { from: 'dec', to: 'opt_partner' },
        { from: 'opt_hold', to: 'fac_capacity' },
        { from: 'opt_warehouse', to: 'fac_capacity' },
        { from: 'opt_partner', to: 'fac_capacity' },
        { from: 'fac_capacity', to: 'goal_1' },
      ],
    };

    const { store } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    expect(theOne()).toMatchObject({
      point: 'at_commit',
      option_factor_edges: 3,
      missing_magnitude: 2,
      scenario_id: META.scenario_id,
      turn_id: META.turn_id,
    });
  });

  it('reads the PERSISTED bytes: a magnitude on the canonical top-level carrier counts as present', async () => {
    // The canonical persisted OptionV3 shape — top-level `interventions` with
    // `{ value }` objects, NOT the projector's `data.interventions` numbers.
    // Both options are fully valued, so a census blind to this carrier would
    // report 2 missing instead of 0.
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'Decision' },
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: { fac_cost: { value: 0.3, source: 'user_specified' } },
        },
        {
          id: 'opt_b',
          kind: 'option',
          label: 'B',
          interventions: { fac_cost: { value: 0.7, source: 'user_specified' } },
        },
        { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      ],
      edges: [
        { from: 'opt_a', to: 'fac_cost' },
        { from: 'opt_b', to: 'fac_cost' },
      ],
    };

    const { store } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    expect(theOne()).toMatchObject({ point: 'at_commit', option_factor_edges: 2, missing_magnitude: 0 });
  });

  it('reads source/target edges too — the alias EdgeInput accepts and only normalises on parse', async () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      ],
      edges: [{ source: 'opt_a', target: 'fac_cost' }],
    };

    const { store } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    expect(theOne()).toMatchObject({ option_factor_edges: 1, missing_magnitude: 1 });
  });

  it('emits NOTHING on a commit that writes no graph — a census with no artefact would be a fabricated zero', async () => {
    const { store } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph: undefined }, store);
    expect(censusEvents()).toHaveLength(0);
  });
});
