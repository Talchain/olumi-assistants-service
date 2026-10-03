/**
 * ⛔ THE ROOT OF R3 DEFECT 2 (5936673643; MG 5936733302; DL routing 5936794868): a node with NO unit of its own is read in
 * its own LEVEL limit's unit — the unit construction sized its links in.
 *
 * Served `799d1a5d` (R3 F5 b8-2456, CEE b410b1c5): the limit "Sprint initiatives tackled properly ≤ 1" has its unit
 * ("initiatives per sprint") only on the limit row; the node holds none. Both links into it are Olumi's estimates sized
 * in that unit (`natural_effect.amount_unit`, μ = strength_mean). The ONE "is this link sized" reader looked only at the
 * node, read them unsized, withheld the limit as `parts_links_placeholder`, and the Agent repeated the code's word:
 * "Olumi's placeholders". Now the reader takes the limit's unit for such a node, so the honest reason stands: the limit
 * rests on Olumi's estimate (`limit_rests_on_olumi_guess`), and the Agent never asks for a size it already has.
 *
 * Bytes: `fixtures/served-799d1a5d-limit-unit.json` = the stored graph verbatim (R3's `03-cold-s1.json`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { collectLimitLevelOwners, readRatifiedConstraints } from '../constraint-feasibility.js';
import { limitUnitsOf, placeholderMovedOptions, PLACEHOLDER_PARTS_REASON, OLUMI_GUESS_LIMIT_REASON } from '../placeholder-parts.js';
import { linkSizeAsk } from '../../../orchestrator-v5/agent-lane/link-size-ask.js';
import { limitChecksForAgent } from '../../../orchestrator-v5/agent-lane/limit-checks.js';

type Rec = Record<string, any>;
const served = (): Rec =>
  (JSON.parse(readFileSync(new URL('./fixtures/served-799d1a5d-limit-unit.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
const LIMIT_NODE = 'sprint_initiatives_tackled_properly';
const optionsOf = (g: Rec) => (g.nodes as Rec[]).filter((n) => n.kind === 'option');
const limitId = (g: Rec) => (g.goal_constraints as Rec[]).find((c) => c.node_id === LIMIT_NODE)!.constraint_id as string;
/** The run's verdict reader, over the two options that move the limit (it names a reason when EVERY scored option is moved). */
const movers = (g: Rec) => optionsOf(g).filter((o) => o.id !== 'continue_current_priorities');
const reasonFor = (g: Rec) => collectLimitLevelOwners(g, readRatifiedConstraints(g), movers(g)).placeholderPartsReasons.get(limitId(g));
const agentSays = (g: Rec) => limitChecksForAgent(g, { per_limit: [{ constraint_id: limitId(g), state: 'scored' }], joint: { state: 'scored' } } as never)!
  .find((c) => c.constraint_id === limitId(g))!;

describe('R3 DEFECT 2 root: a unit-less node is read in its own limit\'s unit', () => {
  it('PRECONDITION (the served bytes): the limit node has no unit of its own; its links are Olumi\'s, sized in the limit row\'s unit', () => {
    const g = served();
    const node = (g.nodes as Rec[]).find((n) => n.id === LIMIT_NODE)!;
    expect(node.unit ?? null).toBeNull();
    expect(node.observed_state ?? null).toBeNull();
    const row = (g.goal_constraints as Rec[]).find((c) => c.node_id === LIMIT_NODE)!;
    expect(row).toMatchObject({ unit: 'initiatives per sprint', value_frame: 'level' });
    const into = (g.edges as Rec[]).filter((e) => e.to === LIMIT_NODE);
    expect(into).toHaveLength(2);
    for (const e of into) {
      expect(e.provenance).toMatchObject({ magnitude: 'olumi_estimate', natural_effect: { amount_unit: 'initiatives per sprint' } });
      expect(e.strength.mean).toBe(e.provenance.natural_effect.strength_mean);
    }
  });

  it('RED: the limit verdict (`collectLimitLevelOwners`, the run\'s reader) no longer calls Olumi\'s estimates "placeholders"', () => {
    expect(reasonFor(served())).toBe(OLUMI_GUESS_LIMIT_REASON);
  });

  it('RED: the Agent\'s limit sentence (`limitChecksForAgent`) says the link is Olumi\'s ESTIMATE — never that Olumi hasn\'t sized it', () => {
    const check = agentSays(served());
    expect(check.withheld_for).toEqual(['Build AI Reporting Module', 'Fix Trial Signup Flow']);
    expect(check.say).toContain('moves ‘Sprint initiatives tackled properly’, which Olumi estimated.');
    expect(check.say).not.toMatch(/hasn.t sized|placeholder/i);
  });

  it('RED: the Agent does not ask for the size of a link already sized in the limit\'s unit', () => {
    const g = served();
    const ask = linkSizeAsk(g, { message: 'How much does AI reporting module completion change Sprint initiatives tackled properly',
      restingText: 'Here is the model.', awaitingApproval: false });
    expect(ask).toBeNull();
  });

  it('CONTROL: the same bytes WITHOUT the limit\'s unit read the links as unsized — the fallback is what changed the verdict', () => {
    const g = served();
    for (const c of g.goal_constraints as Rec[]) if (c.node_id === LIMIT_NODE) delete c.unit;
    expect(reasonFor(g)).toBe(PLACEHOLDER_PARTS_REASON);
    expect(agentSays(g).say).toMatch(/hasn.t sized/);
  });

  it('CONTROL: a node with a unit OF ITS OWN keeps it — a link sized in the limit\'s different unit stays unsized', () => {
    const g = served();
    (g.nodes as Rec[]).find((n) => n.id === LIMIT_NODE)!.unit = 'hours';
    const moved = placeholderMovedOptions(LIMIT_NODE, g.nodes, g.edges, optionsOf(g), limitUnitsOf(g.goal_constraints));
    expect([...moved.values()]).toContain(PLACEHOLDER_PARTS_REASON);
  });

  it('limitUnitsOf: level rows only; a node whose level limits disagree on the unit gets none (never a guess)', () => {
    expect([...limitUnitsOf([
      { node_id: 'a', unit: 'items', value_frame: 'level' },
      { node_id: 'b', unit: '%', value_frame: 'change_pct' },
      { node_id: 'c', unit: 'hours', value_frame: 'level' },
      { node_id: 'c', unit: 'days', value_frame: 'level' },
      { node_id: 'd', unit: ' ', value_frame: 'level' },
    ])]).toEqual([['a', 'items']]);
    expect(limitUnitsOf(undefined).size).toBe(0);
  });
});
