/**
 * ⭐ A USER'S STATED CHANGE SURVIVES CONSTRUCTION BESIDE OLUMI'S LEVEL (AI Quality ruling (A), #72 5870443419; MG ask
 * 5870385109; Baseline v1 defect 3).
 *
 * Served (Runtime lever-1, medium arm, techlead run 1; `fixtures/served-lever1-techlead-1-medium-draft.json`): "hire two
 * developers". The drafter emitted `{2, additional, explicit}` AND `{7, absolute, ai_proposed}` on "Developer headcount",
 * whose baseline 5 is Olumi's (`baseline_known: false`). `prepareProvisionalCandidate` made the addition an absolute 7
 * stamped `ai_proposed`, admission registered `cee_hypothesis`, and the user's "2" survived nowhere.
 *
 * THE RULE (A): the level stays absolute and Olumi's (the engine reads an option on a non-root as status quo +
 * (level − today)), and the user's figure rides on the SAME level cell as `stated_change` with
 * `stated_change_source: 'brief_extraction'`. Only a user-stated (`explicit`) addition carries it; no finite baseline
 * keeps today's behaviour; wherever the level is said, it is attributed.
 *
 * THE PATH: the REAL `buildModelFromBrief` (prepare → admit → GraphV3 parse) with a 0-LLM `callStructured`, whose
 * `/graph/register` is the REAL register route (Fastify inject over a stateful session-store double, the REAL persistence
 * projection). Every row reads the STORED graph, each node found by its exact label (exactly one) and each cell by the
 * factor's node id.
 */
import { readFileSync } from 'node:fs';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as unknown } }));
vi.mock('../../session/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionStore: () => storeRef.value };
});
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { optionSetLimitAsks } from '../limited-level-ask.js';

type Rec = Record<string, any>;
type Graph = Rec & { nodes: Rec[]; edges: Rec[] };

const SCENARIO = '5c0e7a11-2222-4222-8222-222222222222';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: OWNER, request_id: 'r-stated-change', user_text: '' };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-lever1-techlead-1-medium-draft.json', import.meta.url), 'utf8')) as
  { brief: string; text: string };

const BRIEF = 'Should I hire two developers to increase velocity?';
type Iv = { factor_label: string; value: number; value_kind?: string; unit?: string; provenance: string };
/** One option, "Hire two developers", on "Developers" (today `baseline`, Olumi's), beside a held status quo. */
function candidate(baseline: number | null, iv: Iv | readonly Iv[]) {
  return {
    goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire two developers', provenance: 'explicit', is_status_quo: null, changes: [], interventions: Array.isArray(iv) ? [...iv] : [iv] },
      { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [{ label: 'Developers', role: 'controllable', baseline_known: false, baseline_value: baseline, unit: 'developers', provenance: 'ai_proposed', plausible_max: 20 }],
    risks: [],
    outcomes: [{ label: 'Velocity', provenance: 'inferred' }],
    links: [{ from: 'Developers', to: 'Velocity', direction: 'positive', provenance: 'inferred' }],
    unknowns: [],
  };
}
const PLUS_TWO: Iv = { factor_label: 'Developers', value: 2, value_kind: 'additional', unit: 'developers', provenance: 'explicit' };

/** A session store double the REAL register route writes and reads: one stored row. */
function world() {
  const row = { graph: null as unknown };
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => { row.graph = clone(write.graph); return { id: 'turn-1' }; }),
    loadGraph: vi.fn(async () => (row.graph === null ? null : clone(row.graph))),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  return { stored: (): Graph => row.graph as Graph };
}

const apps: FastifyInstance[] = [];
/** The build's dispatch: `/graph/register` is the REAL route; a read serves the stored row. */
async function dispatcherOver(w: ReturnType<typeof world>): Promise<{ d: InternalDispatch; sent: Graph[] }> {
  const app = Fastify();
  apps.push(app);
  await registerRoute(app);
  await app.ready();
  const sent: Graph[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      sent.push(clone((body as { graph: Graph }).graph));
      const res = await app.inject({ method: 'POST', url: path, payload: clone(body) as Rec });
      return { status: res.statusCode, json: res.json() as Rec };
    }
    if (path.endsWith('/graph')) {
      const g = w.stored();
      return { status: 200, json: { graph: g ?? { nodes: [], edges: [] }, graph_hash: g === null ? 'empty' : 'stored' } };
    }
    return { status: 200, json: { versions: [] } };
  };
  return { d, sent };
}

/** Builds from `payload` (every structured call answers with it) and returns the STORED graph. */
async function build(brief: string, payload: unknown) {
  const w = world();
  const { d, sent } = await dispatcherOver(w);
  const call = (async () => ({ text: typeof payload === 'string' ? payload : JSON.stringify(payload) })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief(SCENARIO, brief, d, call);
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  expect(sent, 'registered once').toHaveLength(1);
  const stored = w.stored();
  expect(stored, 'the register route stored a graph').not.toBeNull();
  return { result, sent: sent[0]!, stored };
}

/** Exactly one node carries this label — never `.find()` over a duplicate. */
function nodeOf(g: Graph, label: string, kind: string): Rec {
  const hits = g.nodes.filter((n) => n.label === label && n.kind === kind);
  expect(hits, `${kind} "${label}"`).toHaveLength(1);
  return hits[0]!;
}
/** The level cell an option sets on a factor, bound by the option's and factor's node ids. */
function cellOf(g: Graph, option: string, factor: string): Rec | undefined {
  const f = nodeOf(g, factor, 'factor');
  return nodeOf(g, option, 'option').interventions?.[f.id];
}
const rawOf = (cell: Rec): number => (typeof cell.raw_value === 'number' ? cell.raw_value : cell.value);
const todayOf = (g: Graph, factor: string): number => {
  const os = nodeOf(g, factor, 'factor').observed_state ?? {};
  return typeof os.raw_value === 'number' ? os.raw_value : os.value;
};

beforeEach(() => {
  resolveUserIdentity.mockReset();
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER });
});
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

describe('R1 — the user\'s +2 is stored beside Olumi\'s level 7, each with its own author', () => {
  it('RED: a single explicit addition on Olumi\'s estimate of 5 → level 7 (cee_hypothesis) AND stated_change 2 (brief_extraction), in the STORED graph', async () => {
    const { sent, stored } = await build(BRIEF, candidate(5, PLUS_TWO));
    for (const g of [sent, stored]) {
      const cell = cellOf(g, 'Hire two developers', 'Developers')!;
      expect(cell, 'the option sets a level on Developers').toBeDefined();
      expect(rawOf(cell)).toBe(7);
      expect(cell.source, 'the 7 stays Olumi\'s').toBe('cee_hypothesis');
      expect(cell.stated_change, 'the user\'s 2').toBe(2);
      expect(cell.stated_change_source, 'the 2 is the user\'s').toBe('brief_extraction');
      expect(todayOf(g, 'Developers')).toBe(5);
    }
  });

  it('RED: SERVED techlead-1 (the addition AND the drafter\'s own absolute 7 on one factor) → the stored 7 still carries the user\'s 2', async () => {
    const { stored } = await build(SERVED.brief, SERVED.text);
    const dev = cellOf(stored, 'Hire two developers', 'Developer headcount')!;
    expect(rawOf(dev)).toBe(7);
    expect(dev.source).toBe('cee_hypothesis');
    expect(dev.stated_change).toBe(2);
    expect(dev.stated_change_source).toBe('brief_extraction');
    // The same shape on "Hire a Tech lead": the user's +1 on Olumi's 0.
    const lead = cellOf(stored, 'Hire a Tech lead', 'Tech lead headcount')!;
    expect(rawOf(lead)).toBe(1);
    expect(lead.source).toBe('cee_hypothesis');
    expect(lead.stated_change).toBe(1);
    expect(lead.stated_change_source).toBe('brief_extraction');
    // CONTRAST (same run): Olumi's own option "Hire one developer" (absolute 6, ai_proposed) carries no stated change.
    const one = cellOf(stored, 'Hire one developer', 'Developer headcount')!;
    expect(rawOf(one)).toBe(6);
    expect('stated_change' in one).toBe(false);
    expect('stated_change_source' in one).toBe(false);
  });
});

describe('R2 — invariance (AIQ): Olumi\'s estimate moves, the user\'s change does not', () => {
  it('RED: today 5 → level 7 and today 8 → level 10; stated_change 2 in both, and level − today = stated_change', async () => {
    const at5 = cellOf((await build(BRIEF, candidate(5, PLUS_TWO))).stored, 'Hire two developers', 'Developers')!;
    const g8 = (await build(BRIEF, candidate(8, PLUS_TWO))).stored;
    const at8 = cellOf(g8, 'Hire two developers', 'Developers')!;
    expect(rawOf(at8)).toBe(10);
    expect(todayOf(g8, 'Developers')).toBe(8);
    expect([at5.stated_change, at8.stated_change]).toEqual([2, 2]);
    expect([at5.stated_change_source, at8.stated_change_source]).toEqual(['brief_extraction', 'brief_extraction']);
    expect(rawOf(at8) - todayOf(g8, 'Developers')).toBe(at8.stated_change);
    expect(at8.source).toBe('cee_hypothesis');
  });
});

describe('R3 — wherever the stored level is said, it is attributed', () => {
  async function levelsOf(g: Graph, option: string) {
    const d: InternalDispatch = async () => ({ status: 200, json: { graph: g, graph_hash: 'h' } });
    const r = await createAgentCapabilities(d, new ProposalStore()).getCanonicalState(ctx as never);
    const entity = (r.entities as Rec[]).filter((e) => e.label === option && e.kind === 'option');
    expect(entity).toHaveLength(1);
    return entity[0]!.levels as Rec[];
  }

  it('RED: get_canonical_state says "7 developers: your 2 more on Olumi\'s estimate of 5 today", keeping the 7 as Olumi\'s', async () => {
    const { stored } = await build(BRIEF, candidate(5, PLUS_TWO));
    const devId = nodeOf(stored, 'Developers', 'factor').id;
    const cell = (await levelsOf(stored, 'Hire two developers')).filter((l) => l.factor_id === devId);
    expect(cell).toHaveLength(1);
    expect(cell[0]).toMatchObject({
      factor: 'Developers', set_by: 'cee_hypothesis',
      stated_change: 2, stated_change_by: 'brief_extraction',
      in_words: '7 developers: your 2 more on Olumi\'s estimate of 5 today',
    });
    expect(cell[0]!.level as number).toBeCloseTo(7, 9);
  });

  it('RED: the same at today 8 — "10 developers: your 2 more on Olumi\'s estimate of 8 today"', async () => {
    const { stored } = await build(BRIEF, candidate(8, PLUS_TWO));
    const devId = nodeOf(stored, 'Developers', 'factor').id;
    const cell = (await levelsOf(stored, 'Hire two developers')).find((l) => l.factor_id === devId);
    expect(cell?.in_words).toBe('10 developers: your 2 more on Olumi\'s estimate of 8 today');
  });

  it('RED: a limit on the quantity names the figure with its attribution (the one limit-ask producer)', async () => {
    const { stored } = await build(BRIEF, candidate(5, PLUS_TWO));
    const devId = nodeOf(stored, 'Developers', 'factor').id;
    const g = { ...stored, goal_constraints: [{ constraint_id: 'c-dev', node_id: devId, operator: '<=', value: 8, unit: 'developers' }] };
    const asks = optionSetLimitAsks(g as never);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.question).toContain('7 developers under "Hire two developers" (your 2 more on Olumi\'s estimate of 5 today)');
  });

  it('RED: re-proposing the stored level says it attributed ("already sets …")', async () => {
    const { stored } = await build(BRIEF, candidate(5, PLUS_TWO));
    const d: InternalDispatch = async () => ({ status: 200, json: { graph: stored, graph_hash: 'h' } });
    const r = await createAgentCapabilities(d, new ProposalStore()).proposeOptionInterventions(
      ctx as never, { interventions: [{ option_label: 'Hire two developers', factor_label: 'Developers', value: 7 }] } as never, undefined as never);
    expect(r.refusal).toBe('nothing_to_set');
    expect(r.already_set).toEqual(['Hire two developers already sets Developers to 7 developers: your 2 more on Olumi\'s estimate of 5 today']);
  });

  it('CONTRAST: a stored change that no longer adds up (the level was re-set) is not attributed', async () => {
    const { stored } = await build(BRIEF, candidate(5, PLUS_TWO));
    const g = clone(stored);
    const devId = nodeOf(g, 'Developers', 'factor').id;
    const cell = nodeOf(g, 'Hire two developers', 'option').interventions[devId];
    // A later writer that carried the old fields forward and set a new figure: 9 is not 5 + 2.
    const frame = cell.raw_value === undefined ? 1 : cell.raw_value / cell.value;
    Object.assign(cell, { value: 9 / frame, ...(cell.raw_value === undefined ? {} : { raw_value: 9 }), source: 'user_specified' });
    const level = (await levelsOf(g, 'Hire two developers')).find((l) => l.factor_id === devId)!;
    expect(level.level as number).toBeCloseTo(9, 9);
    expect('in_words' in level).toBe(false);
    expect('stated_change' in level).toBe(false);
  });
});

describe('CONTRASTS — nothing else gains a stated change', () => {
  it('no finite baseline → today\'s behaviour: no level, the option kept as changing Developers, no stated_change anywhere', async () => {
    const { result, stored } = await build(BRIEF, candidate(null, PLUS_TWO));
    expect(cellOf(stored, 'Hire two developers', 'Developers')).toBeUndefined();
    expect(result.additions_without_total).toEqual([
      expect.objectContaining({ option: 'Hire two developers', factor: 'Developers', value: 2, reason: 'baseline_unknown' }),
    ]);
    expect(JSON.stringify(stored)).not.toContain('stated_change');
  });

  it('an ai_proposed addition (Olumi\'s change, not the user\'s) → level 7, no stated_change', async () => {
    const { stored } = await build(BRIEF, candidate(5, { ...PLUS_TWO, provenance: 'ai_proposed' }));
    const cell = cellOf(stored, 'Hire two developers', 'Developers')!;
    expect(rawOf(cell)).toBe(7);
    expect(cell.source).toBe('cee_hypothesis');
    expect(JSON.stringify(stored)).not.toContain('stated_change');
  });

  it('an explicit ABSOLUTE level → no stated_change (the user gave a level, not a change)', async () => {
    const { stored } = await build(BRIEF, candidate(5, { factor_label: 'Developers', value: 7, value_kind: 'absolute', unit: 'developers', provenance: 'explicit' }));
    const cell = cellOf(stored, 'Hire two developers', 'Developers')!;
    expect(rawOf(cell)).toBe(7);
    expect(JSON.stringify(stored)).not.toContain('stated_change');
  });

  it('an explicit addition whose total disagrees with the drafter\'s own absolute level on the same factor → no stated_change on it', async () => {
    const { stored } = await build(BRIEF, candidate(5, [PLUS_TWO, { factor_label: 'Developers', value: 8, value_kind: 'absolute', unit: 'developers', provenance: 'ai_proposed' }]));
    const cell = cellOf(stored, 'Hire two developers', 'Developers')!;
    // The level is whichever the drafter wrote last, exactly as before; 8 is not 5 + 2, so the 2 is not claimed for it.
    expect(rawOf(cell)).toBe(8);
    expect(JSON.stringify(stored)).not.toContain('stated_change');
  });
});
