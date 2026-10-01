/**
 * ⭐ AN UNNAMED-CURRENCY GOAL TAKES THE CURRENCY OF THE USER'S STATED LEVEL (R3 F5 D1, #85 5934208404; owner ruling MG;
 * DL 380e54 constraints (1)–(4)).
 *
 * SERVED (CEE `2166aa0b`, guest 6bc6cae6, R3 capture `output/r3-successor-996ec64d/f5/batch-2462/d1-goal/`): the brief
 * names no currency, so the drafter copied its own schema placeholder and the saved goal "quarterly revenue" held
 * `goal_threshold_unit: "currency/quarter"`. "Our quarterly revenue is £100,000." → `propose_goal_current_level` ×3 →
 * `unit_mismatch`, `unit_mismatch`, `figure_not_in_users_words` → no card, nothing written.
 *
 * THE FIXTURE is that capture's saved graph, byte for byte (`02-cold-brief.json` → `json.graph`, graph_hash
 * 11dc216b62a9902b): `fixtures/f5-d1-6bc6cae6-served-graph-20261001.json`. The same goal unit was served on dcd72dc3
 * (`f5/d1-1149Z/02-cold-brief.json`, goal "Quarterly revenue").
 *
 * THE REAL PATH: `dispatchTool('propose_goal_current_level')` → the stored proposal → `dispatchTool('authorise_change')` →
 * a register store enforcing the route's contract gate and CAS, then the read-back. Every row binds the goal by its id and
 * every unit by its exact string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type AgentCapabilities, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { unitComparisonKey } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

type Rec = Record<string, any>;
type Graph = { nodes: Rec[]; edges: Rec[] } & Rec;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const served = JSON.parse(readFileSync(new URL('./fixtures/f5-d1-6bc6cae6-served-graph-20261001.json', import.meta.url), 'utf8')) as Graph;
const GOAL_ID = 'quarterly_revenue';
const GOAL_LABEL = 'quarterly revenue';
const SERVED_UNIT = 'currency/quarter';
const ADOPTED = '£/quarter';
const SAID = 'Our quarterly revenue is £100,000.';
const TOOL = 'propose_goal_current_level';
const SCENARIO = '6bc6cae6-6d5a-4b66-9494-334ff5e0391d';
const goalIn = (g: Graph): Rec => g.nodes.find((n) => n.id === GOAL_ID)!;

/** A store that behaves like the read and register routes (contract gate, CAS on the analysis hash, a version minted). */
function scenarioStore(initial: Graph) {
  let graph = clone(initial);
  let rev = 0;
  const hash = () => `h${rev}`;
  const registers: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: hash(), graph_identity_hash: { value: `id-${hash()}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b);
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== hash()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: hash(), model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  return { dispatch, registers, graph: () => graph };
}

function setup(initial: Graph, said: string) {
  const store = scenarioStore(initial);
  const proposals = new ProposalStore();
  const caps: AgentCapabilities = createAgentCapabilities(store.dispatch, proposals);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-ucur', user_text: said };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { ...store, proposals, call };
}

/** A refusal leaves nothing behind: no card held, nothing registered, the goal byte for byte as it was. */
async function refusedWithNothingWritten(initial: Graph, said: string, args: Rec): Promise<Rec> {
  const s = setup(initial, said);
  const r = await s.call(TOOL, { goal_label: GOAL_LABEL, user_stated: true, ...args }) as Rec;
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.mutated).toBe(false);
  expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
  expect(s.registers).toEqual([]);
  expect(goalIn(s.graph())).toStrictEqual(goalIn(initial));
  return r;
}

describe('the served goal shape (the fixture is the capture, unchanged)', () => {
  it('CONTRAST: "quarterly revenue" holds the drafter placeholder unit, on the level frame, with no target and no level', () => {
    const goal = goalIn(served);
    expect(goal.kind).toBe('goal');
    expect(goal.label).toBe(GOAL_LABEL);
    expect(goal.goal_threshold_unit).toBe(SERVED_UNIT);
    expect(goal.goal_threshold_frame).toBe('level');
    for (const k of ['goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold', 'observed_state', 'scale_frame']) expect(goal).not.toHaveProperty(k);
  });
});

describe('RED: Paul\'s exact sentence on the served goal → ONE card naming £ → approved → level 100000 and the goal in £/quarter', () => {
  it('RED: carded (nothing written), approved → observed_state and goal_threshold_unit both "£/quarter", read back byte-exact', async () => {
    const s = setup(clone(served), SAID);
    const proposed = await s.call(TOOL, { goal_label: GOAL_LABEL, value: 100000, unit: '£', user_stated: true }) as Rec;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.mutated).toBe(false);
    expect(s.proposals.outstanding(SCENARIO, null)).toHaveLength(1);
    expect(s.registers, 'held: nothing written before the approval').toEqual([]);
    // The card's words name the currency, the figure as the user wrote it, and the unit the goal is then measured in.
    expect(proposed.public_label).toBe(
      'Record today\'s level of "quarterly revenue" as your figure: £100,000, and measure "quarterly revenue" in £/quarter '
      + '(no currency was set for it before)');
    expect(proposed.current_level).toStrictEqual({ value: 100000, unit: ADOPTED });
    expect(proposed.as_stated).toStrictEqual({ value: 100000, unit: '£' });

    const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(s.registers).toHaveLength(1);
    expect(applied.recorded).toStrictEqual({ value: 100000, unit: ADOPTED });
    const goal = goalIn(s.graph());
    // DL (3): the stored string is "£/quarter" (the served tail "/quarter" kept byte-exact) — the same unit as "£ per quarter".
    expect(goal.goal_threshold_unit).toBe(ADOPTED);
    expect(unitComparisonKey(goal.goal_threshold_unit)).toBe(unitComparisonKey('£ per quarter'));
    expect(unitComparisonKey(goal.goal_threshold_unit)).toBe('gbp/quarter');
    const C = 125000; // resolveGoalThresholdCapWithProvenance(undefined, 100000, '£/quarter', undefined): the 25% headroom rule
    expect(goal.observed_state).toStrictEqual({
      value: 100000 / C, baseline: 100000 / C, unit: ADOPTED, source: USER_EDIT_SOURCE, raw_value: 100000, cap: C,
    });
    // No target appears from a level card.
    for (const k of ['goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold']) expect(goal).not.toHaveProperty(k);
  });

  it('RED: the other ways the Agent types the same currency ("GBP", "£ per quarter") card it too, each keeping the served tail', async () => {
    for (const [unit, adopted] of [['GBP', 'GBP/quarter'], ['£ per quarter', '£/quarter']] as const) {
      const s = setup(clone(served), SAID);
      const r = await s.call(TOOL, { goal_label: GOAL_LABEL, value: 100000, unit, user_stated: true }) as Rec;
      expect(r.ok, `${unit}: ${JSON.stringify(r)}`).toBe(true);
      expect(r.current_level).toStrictEqual({ value: 100000, unit: adopted });
      await s.call('authorise_change', { proposal_id: r.proposal_id });
      expect(goalIn(s.graph()).goal_threshold_unit).toBe(adopted);
      expect(goalIn(s.graph()).observed_state.unit).toBe(adopted);
    }
  });
});

describe('CONTROLS: the unit rules stand; nothing is converted, and nothing is written on a refusal', () => {
  it('CONTROL (DL 4): a goal with a REAL currency ("GBP per quarter") + a figure in "$" → refused, the goal\'s currency never overwritten', async () => {
    const g = clone(served); goalIn(g).goal_threshold_unit = 'GBP per quarter';
    const r = await refusedWithNothingWritten(g, 'Our quarterly revenue is $100,000.', { value: 100000, unit: '$' });
    expect(r.refusal).toBe('unit_mismatch');
    expect(r.detail).toContain('is not in the currency of "quarterly revenue"');
  });

  it('CONTROL: "currency/quarter" + "%" → refused (another kind of unit)', async () => {
    const r = await refusedWithNothingWritten(clone(served), 'Our quarterly revenue grew 12% last quarter.', { value: 12, unit: '%' });
    expect(r.refusal).toBe('unit_mismatch');
    expect(r.detail).toContain('a different kind of unit');
  });

  it('CONTROL: "currency/quarter" + "£ per year" → refused (another period; nothing converts)', async () => {
    const r = await refusedWithNothingWritten(clone(served), 'Our revenue is £100,000 per year.', { value: 100000, unit: '£ per year' });
    expect(r.refusal).toBe('unit_mismatch');
    expect(r.detail).toContain('nothing is converted');
  });

  it('CONTROL: "currency/quarter" + no unit → unit_unstated (a figure is never assumed to be in a currency)', async () => {
    const r = await refusedWithNothingWritten(clone(served), SAID, { value: 100000, unit: '' });
    expect(r.refusal).toBe('unit_unstated');
  });

  it('CONTROL (DL 1): a currency the user did NOT write ("$" for their "£100,000") is never adopted — the words rule refuses it', async () => {
    const r = await refusedWithNothingWritten(clone(served), SAID, { value: 100000, unit: '$' });
    expect(r.refusal).toBe('figure_not_in_users_words');
  });

  it('CONTROL (the third served refusal): the goal\'s own placeholder as the unit names no currency → refused, "currency" never recorded', async () => {
    for (const unit of [SERVED_UNIT, 'currency']) {
      const r = await refusedWithNothingWritten(clone(served), SAID, { value: 100000, unit });
      expect(r.refusal, unit).toBe('unit_unrecognised');
    }
  });
});

describe('the predicate reads only OUR stored unit against OUR template (unnamed-currency.ts)', () => {
  it('isUnnamedCurrencyUnit: the placeholder head in any case and with any tail; never a named currency or a longer word', async () => {
    const { isUnnamedCurrencyUnit } = await import('../unnamed-currency.js');
    for (const u of ['currency/quarter', 'Currency per month', 'CURRENCY', '<currency>/<period>', 'currency per deal per quarter']) {
      expect(isUnnamedCurrencyUnit(u), u).toBe(true);
    }
    for (const u of ['GBP per quarter', '£/quarter', '£', 'cryptocurrency/quarter', 'currencies', '', '   ', undefined, null, 12]) {
      expect(isUnnamedCurrencyUnit(u), String(u)).toBe(false);
    }
  });

  it('unitNamingCurrency: the head replaced, the tail byte-exact; null when nothing can be named', async () => {
    const { unitNamingCurrency } = await import('../unnamed-currency.js');
    expect(unitNamingCurrency('currency/quarter', '£')).toBe('£/quarter');
    expect(unitNamingCurrency('Currency per month', 'GBP')).toBe('GBP per month');
    expect(unitNamingCurrency('currency', '$')).toBe('$');
    expect(unitNamingCurrency('GBP per quarter', '£')).toBeNull();
    expect(unitNamingCurrency('<currency>/<period>', '£')).toBeNull();
    expect(unitNamingCurrency('currency/quarter', '')).toBeNull();
    expect(unitNamingCurrency('currency/quarter', '£ per')).toBeNull();
  });
});
