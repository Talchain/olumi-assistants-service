/**
 * A LEVEL LIMIT ON A NODE THE OPTIONS MOVE CARRIES THAT NODE'S CURRENT LEVEL — so the analysis can check it.
 *
 * ⚠ WHY (WIRE, #70 5841905430 / accepted 5841918509): on Paul's pricing brief the churn limit reads "could not be
 * checked". Churn is NON-ROOT (price → churn), and ISL checks a level limit there only as `baseline + (option − status
 * quo)`, refusing without `observed_state.baseline` (`missing_target_baseline`, C50 L2). The node's current level is
 * already on it (`observed_state.value`), so the carrier is that value — never a new number.
 *
 * Every row binds the churn node BY LABEL → id and asserts the baseline by identity with the node's own value.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const faithful = JSON.parse(
  readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/faithful.json', 'utf-8'),
) as CandidateModel;
const CHURN = 'Monthly churn rate';

type Churn = { unit: string; baseline_known: boolean; baseline_value: number; plausible_max?: number };
type Limit = { metric?: string; value: number; unit: string; frame?: 'level' | 'delta' };
/** The served churn shape (F runs): an Olumi ESTIMATE of 7%, framed on 100 → `{value 0.07, raw 7}` + `scale_frame 100`. */
const ESTIMATE: Churn = { unit: '%', baseline_known: false, baseline_value: 7, plausible_max: 100 };

function candidate(churn: Churn, limit: Limit, opts: { churnIsRoot?: boolean } = {}): CandidateModel {
  return {
    ...faithful,
    factors: [
      ...faithful.factors.filter((f) => f.label !== CHURN),
      { label: CHURN, role: 'observable', provenance: 'explicit', ...churn },
    ],
    // The fixture's price → churn link is unsigned (`direction: 'unknown'`), which admission withholds by ruling, so
    // churn would be a ROOT. Paul's served graph has it non-root (PLoT: "calculated from the factors feeding into
    // it"), so the link is signed here: a higher price, higher churn.
    links: opts.churnIsRoot === true
      ? faithful.links.filter((l) => !(l.from === 'Pro plan price' && l.to === CHURN))
      : faithful.links.map((l) => (l.from === 'Pro plan price' && l.to === CHURN ? { ...l, direction: 'positive' } : l)),
    constraints: [{ metric: limit.metric ?? CHURN, operator: '<', value: limit.value, unit: limit.unit, provenance: 'explicit', ...(limit.frame !== undefined ? { frame: limit.frame } : {}) }],
  } as unknown as CandidateModel;
}

function churnNode(churn: Churn, limit: Limit, opts: { churnIsRoot?: boolean } = {}) {
  const m = admitCandidateModel(candidate(churn, limit, opts));
  const node = m.nodes.find((n) => n.label === CHURN);
  expect(node, 'the churn factor is admitted').toBeDefined();
  expect(m.goal_constraints.some((c) => c.node_id === node!.id), 'PRECONDITION: the limit is attached to churn by id').toBe(limit.metric === undefined);
  return node as unknown as { id: string; observed_state?: { value?: number; baseline?: number }; scale_frame?: number };
}

describe('a level limit on a non-root node carries that node\'s current level', () => {
  // ── RED before this change: no baseline, so ISL refuses `missing_target_baseline` ──
  it('the served shape: a "%" limit on the churn ESTIMATE framed on 100 carries baseline = its own value (0.07)', () => {
    const n = churnNode(ESTIMATE, { value: 10, unit: '%', frame: 'level' });
    expect(n.scale_frame).toBe(100);
    expect(n.observed_state?.value).toBeCloseTo(0.07, 12);
    expect(n.observed_state?.baseline).toBe(n.observed_state?.value);
  });

  it('a "percent per month" limit (canonicalised to "%" on that node) carries it too', () => {
    const n = churnNode({ ...ESTIMATE, unit: 'percent per month' }, { value: 10, unit: 'percent per month', frame: 'level' });
    expect(n.observed_state?.baseline).toBe(n.observed_state?.value);
  });

  it('a KNOWN level on a capped node, limit in the node\'s own spelling (PLoT explicit_cap), carries it', () => {
    const n = churnNode({ unit: 'percent per month', baseline_known: true, baseline_value: 7, plausible_max: 20 }, { value: 10, unit: 'percent per month', frame: 'level' });
    expect(n.observed_state?.value).toBeCloseTo(0.35, 12);
    expect(n.observed_state?.baseline).toBe(n.observed_state?.value);
  });

  // ── CONTROLS: never written where it would be wrong or pointless ──
  it('CONTROL: a "%" limit on a node framed on 20 gets NO baseline (PLoT would read "≤ 10%" on [0,100] against raw/20)', () => {
    const n = churnNode({ ...ESTIMATE, plausible_max: 20 }, { value: 10, unit: '%', frame: 'level' });
    expect(n.scale_frame).toBe(20);
    expect(n.observed_state?.baseline).toBeUndefined();
  });

  it('CONTROL: a ROOT target gets no baseline (ISL reads a root at its own level)', () => {
    expect(churnNode(ESTIMATE, { value: 10, unit: '%', frame: 'level' }, { churnIsRoot: true }).observed_state?.baseline).toBeUndefined();
  });

  it('CONTROL: a DELTA limit gets no baseline', () => {
    expect(churnNode(ESTIMATE, { value: 2, unit: '%', frame: 'delta' }).observed_state?.baseline).toBeUndefined();
  });

  it('CONTROL: an UNFRAMED limit gets no baseline (it keeps failing closed at the frame hop)', () => {
    expect(churnNode(ESTIMATE, { value: 10, unit: '%' }).observed_state?.baseline).toBeUndefined();
  });

  it('CONTROL: a node with no level at all gets none (nothing to carry)', () => {
    const m = admitCandidateModel(candidate({ unit: '%', baseline_known: false, baseline_value: Number.NaN }, { value: 10, unit: '%', frame: 'level' }));
    const n = m.nodes.find((x) => x.label === CHURN) as unknown as { observed_state?: { baseline?: number } };
    expect(n.observed_state?.baseline).toBeUndefined();
  });

  it('CONTROL: a limit on the GOAL writes no baseline through this path (#1840 owns the goal\'s)', () => {
    const m = admitCandidateModel(candidate(ESTIMATE, { metric: 'MRR', value: 20000, unit: '£', frame: 'level' }));
    const churn = m.nodes.find((x) => x.label === CHURN) as unknown as { observed_state?: { baseline?: number } };
    expect(churn.observed_state?.baseline, 'the churn node is not the target here').toBeUndefined();
  });
});

describe('WIRE: the baseline reaches /graph/register', () => {
  it('the registered churn node carries observed_state.baseline = observed_state.value', async () => {
    let registered: { nodes?: Array<Record<string, unknown>> } | null = null;
    const fn = vi.fn(async () => ({ text: JSON.stringify(candidate(ESTIMATE, { value: 10, unit: '%', frame: 'level' })) })) as unknown as CallStructuredModel;
    const dispatch = (async (path: string, body: unknown) => {
      if (path.endsWith('/graph/register')) { registered = (body as { graph: typeof registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
      return { status: 200, json: { versions: [] } };
    }) as unknown as InternalDispatch;
    await buildModelFromBrief('88888888-8888-4888-8888-888888888888', 'Should we raise the Pro price from £49 to £59? Keep monthly churn under 10%.', dispatch, fn);
    const node = (registered as { nodes?: Array<Record<string, unknown>> } | null)?.nodes?.find((n) => n.label === CHURN);
    expect(node, 'the churn node was registered').toBeDefined();
    const os = node!.observed_state as { value?: number; baseline?: number };
    expect(os.baseline).toBe(os.value);
  });
});
