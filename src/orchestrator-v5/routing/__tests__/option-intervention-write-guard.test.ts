/**
 * ⭐⭐ ROADMAP 2.1266 (D1b) — the edit-lane arm of the option-intervention
 * misroute guard, driven by the WIRE BYTES of the defect it exists to kill.
 *
 * ⚠ NOT MY FIXTURES (CLAUDE.md trap 16). The messages and the graph come out of
 * `olumi-docs/witness-acceptance-2026-08-17/captures/`, copied verbatim into
 * `../../__tests__/fixtures/witness-2026-08-17/`:
 *
 *   · `j4_t5_user_message`  — `j4-t5-diag-request.json`, the phrasing that on
 *     `8be62df` applied a FACTOR-BASELINE update instead of the option's effect.
 *   · `j4_t4_chip_message`  — `j4-t4-chip1-request.json`, the product's OWN
 *     repair chip (`chip_prompt_repair_value_bind_1`).
 *   · `j4-draft-graph.json` — the pre-edit graph (`j4-t1-event-final.json`).
 *
 * The witnessed post-edit state is reconstructed from the guest reload
 * (`j6-reload-J4.json`): factor `49a2b80b` `observed_state { value: 0.12,
 * source: "user_override" }` while option `21ea9b80` still carries
 * `interventions: {}`.
 *
 * ⚠ HISTORIC RECORD, NOT COPY TO KEEP CURRENT (trap 14b): append, never edit.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import {
  anyInterventionWriteLanded,
  baselineWritesLanded,
  decideOptionInterventionWrite,
} from '../option-intervention-write-guard.js';
import { evaluateConfigureOptionOutcome } from '../configure-option-outcome.js';

const WIRE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wire-strings.json', import.meta.url),
    'utf8',
  ),
) as { j4_t5_user_message: string; j4_t4_chip_message: string };

const DRAFT_GRAPH = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-draft-graph.json', import.meta.url),
    'utf8',
  ),
) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const OPTION_ID = '21ea9b80';
const OTHER_OPTION_ID = '862169d7';
const FACTOR_ID = '49a2b80b';
const OPTION_LABEL = 'subcontracting inner-city deliveries to a green courier';

function withFactorBaseline(value: number): GraphV3T {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== FACTOR_ID) continue;
    node.observed_state = { value, source: 'user_override' };
    node.display_value = String(value);
  }
  return g as unknown as GraphV3T;
}

function withOptionEffect(optionId: string, value: number): GraphV3T {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== optionId) continue;
    node.interventions = { [FACTOR_ID]: { value, source: 'user_override' } };
  }
  return g as unknown as GraphV3T;
}

function withRenamedFactor(label: string): GraphV3T {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== FACTOR_ID) continue;
    node.label = label;
  }
  return g as unknown as GraphV3T;
}

const BEFORE = DRAFT_GRAPH as unknown as GraphV3T;

describe('the fixture\'s two near-duplicate options — distinguished EXPLICITLY, not positionally', () => {
  // ⚠ REVIEWER FINDING (#1008's reviewer, 17 Aug): the witnessed draft carries two
  // options whose labels differ only cosmetically and whose real distinction is
  // PROVENANCE — `21ea9b80` "subcontracting inner-city deliveries to a green
  // courier" (`from_brief`, i.e. the user's own words) and `862169d7` "Subcontract
  // inner-city runs to green courier" (`ai_inferred`, the drafter's near-duplicate,
  // recorded as N2 in the witness). Leaving that distinction implicit is the same
  // positional fragility as binding a blocker by `[0]`: #1008 changes how
  // system-inferred structure is treated, so which of the two carries a blocker can
  // move. Asserted by IDENTITY here so the fixture's shape is load-bearing and
  // visible rather than incidental.
  it('the two options are distinct ids with distinct provenance', () => {
    const byId = new Map(DRAFT_GRAPH.nodes.map((n) => [n.id as string, n]));
    expect(byId.get(OPTION_ID)?.provenance).toBe('from_brief');
    expect(byId.get(OTHER_OPTION_ID)?.provenance).toBe('ai_inferred');
    expect(byId.get(OPTION_ID)?.label).not.toBe(byId.get(OTHER_OPTION_ID)?.label);
  });

  it('the witnessed message resolves to the FROM_BRIEF option, never its ai_inferred twin', () => {
    const outcome = evaluateConfigureOptionOutcome({
      message: WIRE.j4_t5_user_message,
      before: BEFORE,
      after: withFactorBaseline(0.12),
    });
    expect(outcome.status).toBe('not_honoured');
    if (outcome.status !== 'not_honoured') return;
    expect(outcome.optionId).toBe(OPTION_ID);
    expect(outcome.optionId).not.toBe(OTHER_OPTION_ID);
  });
});

describe('preconditions — the witnessed messages really reach this guard', () => {
  it('the explicit phrasing names the option, so the outcome guard binds by identity', () => {
    const outcome = evaluateConfigureOptionOutcome({
      message: WIRE.j4_t5_user_message,
      before: BEFORE,
      after: withFactorBaseline(0.12),
    });
    expect(outcome.status).toBe('not_honoured');
    if (outcome.status !== 'not_honoured') return;
    expect(outcome.optionId).toBe(OPTION_ID);
    expect(outcome.optionLabel).toBe(OPTION_LABEL);
  });

  it("the product's OWN repair chip message reaches the same verdict", () => {
    const outcome = evaluateConfigureOptionOutcome({
      message: WIRE.j4_t4_chip_message,
      before: BEFORE,
      after: withFactorBaseline(0.12),
    });
    expect(outcome.status).toBe('not_honoured');
  });

  it('the witnessed post-edit graph really moved the baseline and really left the option empty', () => {
    const after = withFactorBaseline(0.12);
    expect(baselineWritesLanded(BEFORE, after)).toEqual([FACTOR_ID]);
    expect(anyInterventionWriteLanded(BEFORE, after)).toBe(false);
  });
});

describe('RED→GREEN — the wrong-entity write is withheld', () => {
  it('the witnessed J4 t5 turn → WITHHOLD, naming the option the user named', () => {
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t5_user_message,
      before: BEFORE,
      after: withFactorBaseline(0.12),
      appliedMutation: true,
    });
    expect(verdict).toEqual({
      verdict: 'withhold',
      optionId: OPTION_ID,
      optionLabel: OPTION_LABEL,
      baselineNodeIds: [FACTOR_ID],
    });
  });

  it("the product's own repair chip, same wrong-target outcome → WITHHOLD", () => {
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t4_chip_message,
      before: BEFORE,
      after: withFactorBaseline(0.12),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('withhold');
  });
});

describe('opposite-direction twins — a withhold that discards real work is a new harm', () => {
  it('HONOURED: the effect value lands on the named option → ALLOW', () => {
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t5_user_message,
      before: BEFORE,
      after: withOptionEffect(OPTION_ID, 0.12),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'outcome_not_unhonoured' });
  });

  it('ANOTHER OPTION got a real effect value → ALLOW (never discard a landed option edit)', () => {
    // `not_honoured` for the named option, but an interventions write DID land
    // somewhere: the turn accomplished a real option edit, so withholding it
    // would be the inverse harm.
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t5_user_message,
      before: BEFORE,
      after: withOptionEffect(OTHER_OPTION_ID, 0.12),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'interventions_write_landed' });
  });

  it('a STRUCTURAL-only write (a rename) → ALLOW: no baseline moved, nothing to discard', () => {
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t5_user_message,
      before: BEFORE,
      after: withRenamedFactor('Subcontractor share of affected-route revenue'),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'no_baseline_write' });
  });

  it('NOTHING APPLIED (the witnessed chip no-op, t4) → ALLOW: there is no write to withhold', () => {
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t4_chip_message,
      before: BEFORE,
      after: null,
      appliedMutation: false,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'no_write' });
  });

  it('an UNPARSEABLE graph → ALLOW: the harm is unestablished, so behaviour is byte-identical', () => {
    const verdict = decideOptionInterventionWrite({
      message: WIRE.j4_t5_user_message,
      before: { nodes: 'not a graph' },
      after: withFactorBaseline(0.12),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'graph_unparseable' });
  });

  it('a message naming NO option (the outcome guard refuses to guess) → ALLOW', () => {
    const verdict = decideOptionInterventionWrite({
      message: 'Set Subcontractor cost as share of affected-route revenue to 0.12.',
      before: BEFORE,
      after: withFactorBaseline(0.12),
      appliedMutation: true,
    });
    expect(verdict).toEqual({ verdict: 'allow', reason: 'outcome_not_unhonoured' });
  });
});

describe('identity binding (trap 19) — the readers name WHAT changed, not "something changed"', () => {
  it('baselineWritesLanded reports the node id, and a NEW node is not a rewrite', () => {
    const after = clone(DRAFT_GRAPH);
    after.nodes.push({
      id: 'brand_new',
      kind: 'factor',
      label: 'Something new',
      observed_state: { value: 0.42, source: 'user_override' },
    });
    expect(baselineWritesLanded(BEFORE, after as unknown as GraphV3T)).toEqual([]);
  });

  it('a CLEARED effect value counts as an intervention write (an option really changed)', () => {
    const before = withOptionEffect(OPTION_ID, 0.12);
    expect(anyInterventionWriteLanded(before, BEFORE)).toBe(true);
  });

  it('an unchanged graph produces neither signal', () => {
    expect(anyInterventionWriteLanded(BEFORE, clone(DRAFT_GRAPH) as unknown as GraphV3T)).toBe(
      false,
    );
    expect(baselineWritesLanded(BEFORE, clone(DRAFT_GRAPH) as unknown as GraphV3T)).toEqual([]);
  });
});
