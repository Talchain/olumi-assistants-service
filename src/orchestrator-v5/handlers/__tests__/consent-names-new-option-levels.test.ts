/**
 * ⭐ C2 CONSENT: A NEW OPTION'S LEVELS ARE PART OF WHAT THE USER APPROVES (AI Conversation #70 5859629053).
 *
 * Measured at CEE a2476742 (AIC) and on the served X3 captures: the add-option hold's chip detail — the approval the
 * user reads — named "add option 'X'" and its links, and never the figures the SAME commit writes into the option
 * (`add_node.value.interventions`, `buildAddOptionTransaction`). E07's reply said "Salary is estimated at
 * £250,000/year"; the chip listed only the option and 4 links. A user approved figures they were never shown.
 *
 * The rule under test: the `add_node` of an option names every VALUED level it writes, by its factor's label and the
 * user's own figure (`raw_value` when a range normalised it), marked as Olumi's estimate when stamped so, and a 0/1
 * switch the option turns on as "on" — never "1". Unvalued links stay described by their link items, as today.
 *
 * ⛔ COPY SHAPE (describe-changeset.ts header): the chip message is REPLAYED by the user to confirm, so the clause is
 * "with 'X' at <figure>", never "set/change … to <figure>" — which `isValueUpdatePhrasing` would route as a fresh edit.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { describeChangeset, describeHeldOperationsSubject } from '../describe-changeset.js';
import { buildGmHeldPublicCopy } from '../edit-graph-referee-gate.js';
import { dispatchAddOptionTransaction } from '../add-option-dispatch.js';
import { readGmHeldResume } from '../gm-held-execute.js';
import { buildAddOptionsTransaction } from '../../routing/add-option-transaction.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { isValueUpdatePhrasing } from '../../../orchestrator/routing/value-update-gate.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';

type Json = Record<string, any>;

/** Paul's own persisted graph just before his grandfathering add (the A1 fixture; see new-factor-switch-a1.test.ts). */
const FX = JSON.parse(
  readFileSync(new URL('../../routing/__tests__/fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8'),
) as Json;
const { _provenance: _p, ...RAW } = FX;
const STORED = projectGraphForPersistence(structuredClone(RAW)) as Json;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;

/** Paul's grandfathering add as the Agent sends it (new-factor-switch-a1.test.ts SWITCH_SPEC): £59, and a new switch. */
const GRANDFATHER = {
  parent_decision_id: 'decision_mrr',
  label: '£59 for new Pro customers; grandfather existing customers',
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.295, raw_value: 59, unit: 'GBP per month' },
    { factor_key: 'existing_customers_grandfathered', value: 1, source: 'cee_hypothesis' },
  ],
  new_factors: [{
    key: 'existing_customers_grandfathered',
    label: 'Existing customers grandfathered',
    kind: 'switch',
    affects: [{ node_id: 'monthly_churn', effect_direction: 'negative' }, { node_id: 'mrr', effect_direction: 'negative' }],
  }],
};

const hold = (spec: Json) => dispatchAddOptionTransaction({
  parameters: spec, currentGraph: STORED, currentGraphHash: HASH, freshness: 'none',
  mode: 'live', scenarioId: 'a295e4a1', turnId: 't-propose', requestId: 'r-propose', stage: 'decide',
} as never) as Json;
const heldChip = (held: Json): Json => {
  const actions = (held.response?.suggested_actions ?? []) as Json[];
  const chip = actions.find((a) => typeof a.id === 'string' && a.id.startsWith('gmh_'));
  expect(chip, JSON.stringify(actions)).toBeDefined();
  return chip!;
};

/** E07 / C08 shapes on a small graph: factors with a declared range (`cap`), as the Agent's levels are written. */
const SMALL = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'How to staff the platform' },
    { id: 'goal', kind: 'goal', label: 'Ship the new platform' },
    { id: 'opt_a', kind: 'option', label: 'Hire two senior engineers', interventions: {} },
    { id: 'senior', kind: 'factor', label: 'New senior engineers hired', observed_state: { value: 0, raw_value: 0, cap: 20, unit: 'engineers' } },
    { id: 'junior', kind: 'factor', label: 'New junior engineers hired', observed_state: { value: 0, raw_value: 0, cap: 30, unit: 'engineers' } },
    { id: 'feat', kind: 'factor', label: 'Incremental feature investment', observed_state: { value: 0, raw_value: 0, cap: 30000, unit: 'GBP' } },
    { id: 'ads', kind: 'factor', label: 'Incremental advertising spend', observed_state: { value: 0, raw_value: 0, cap: 30000, unit: 'GBP' } },
  ],
  edges: [
    { from: 'dec', to: 'opt_a' }, { from: 'opt_a', to: 'senior' },
    { from: 'senior', to: 'goal' }, { from: 'junior', to: 'goal' }, { from: 'feat', to: 'goal' }, { from: 'ads', to: 'goal' },
  ],
};
const optionItem = (spec: Json, graph: Json = SMALL, switchFactorIds?: readonly string[]): string => {
  const built = buildAddOptionsTransaction(spec, graph as never) as Json;
  expect(built.matched, JSON.stringify(built)).toBe(true);
  const d = describeChangeset(built.operations, graph, switchFactorIds !== undefined ? { switchFactorIds } : undefined);
  const item = d!.items.find((i) => i.startsWith('add option'));
  expect(item, JSON.stringify(d!.items)).toBeDefined();
  return item!;
};

describe('C2 consent: the approval names the levels a new option writes', () => {
  it('RED (E07, served words): "one senior and two juniors" — each count by its factor, in the user’s units', () => {
    const item = optionItem({
      parent_decision_id: 'dec', label: 'Hire one senior and two juniors',
      interventions: [
        { factor_id: 'senior', value: 1 / 20, raw_value: 1, unit: 'engineers' },
        { factor_id: 'junior', value: 2 / 30, raw_value: 2, unit: 'engineers' },
      ],
    });
    expect(item).toBe("add option 'Hire one senior and two juniors', with 'New senior engineers hired' at 1 engineer and 'New junior engineers hired' at 2 engineers");
  });

  it('RED (C08 shape): Olumi’s estimate is said as Olumi’s, beside the figure it marks', () => {
    const item = optionItem({
      parent_decision_id: 'dec', label: 'Split it 50/50',
      interventions: [
        { factor_id: 'feat', value: 0.5, raw_value: 15000, unit: 'GBP', source: 'cee_hypothesis' },
        { factor_id: 'ads', value: 0.5, raw_value: 15000, unit: 'GBP' },
      ],
    });
    expect(item).toBe("add option 'Split it 50/50', with 'Incremental feature investment' at £15,000 (Olumi’s estimate) and 'Incremental advertising spend' at £15,000");
  });

  it('RED (served A: Paul’s grandfathering, through the REAL dispatch): the chip the user approves names £59 and the new switch as ON', () => {
    const held = hold(GRANDFATHER);
    expect(held.kind, JSON.stringify(held.reason ?? held.governing ?? '')).toBe('held');
    const chip = heldChip(held);
    const text = `${chip.label}\n${chip.message}\n${chip.detail ?? ''}`;
    expect(text).toContain("with 'Pro plan price' at 59 GBP per month and 'Existing customers grandfathered' on");
    expect(text).not.toMatch(/grandfathered' at 1\b/);
    // The receipt says the same, from the hold's own read (turn-executor passes `read.switchFactorIds`).
    const read = readGmHeldResume(held.pendingActions[0]) as Json;
    expect(read.switchFactorIds).toEqual(['fac_existing_customers_grandfathered']);
    expect(describeHeldOperationsSubject(read.operations, STORED, { switchFactorIds: read.switchFactorIds }))
      .toContain("'Existing customers grandfathered' on");
  });

  it('the replayed chip message stays a CONFIRMATION (not a value edit) and carries no forbidden phrase; a real instruction still reads as one', () => {
    const item = optionItem({
      parent_decision_id: 'dec', label: 'Split it 50/50',
      interventions: [{ factor_id: 'feat', value: 0.5, raw_value: 15000, unit: 'GBP' }, { factor_id: 'ads', value: 0.5, raw_value: 15000, unit: 'GBP' }],
    });
    const copy = buildGmHeldPublicCopy(item);
    expect(isValueUpdatePhrasing(copy.message)).toBe(false);
    expect(isValueUpdatePhrasing(copy.label)).toBe(false);
    expect(findForbiddenPhraseHit(copy.message)).toBeNull();
    // CONTRAST: the gate is live, so `false` above is not a dead gate.
    expect(isValueUpdatePhrasing("set 'Incremental feature investment' to £15,000")).toBe(true);
  });

  it('CONTROL: an option with NO valued level is described exactly as before; so is a non-option add', () => {
    const d = describeChangeset([
      { op: 'add_node', path: 'o2', value: { id: 'o2', kind: 'option', label: 'Wait a quarter', interventions: {} } },
      { op: 'add_node', path: 'r1', value: { id: 'r1', kind: 'risk', label: 'Competitor price cut' } },
    ], SMALL);
    expect(d!.items).toEqual(["add option 'Wait a quarter'", "add risk 'Competitor price cut'"]);
  });

  it('CONTROL: a level on a factor no label resolves never prints an id', () => {
    const d = describeChangeset([
      { op: 'add_node', path: 'o3', value: { id: 'o3', kind: 'option', label: 'Mystery', interventions: { fac_unknown_xyz: { value: 3 } } } },
    ], SMALL);
    expect(d!.items[0]).toBe("add option 'Mystery', with a factor not yet named at 3");
    expect(d!.items[0]).not.toContain('fac_unknown_xyz');
  });
});
