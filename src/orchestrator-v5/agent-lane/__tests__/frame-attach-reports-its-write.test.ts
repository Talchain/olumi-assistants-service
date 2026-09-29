/**
 * ⛔⛔ A RANGE THAT LANDED IS A WRITE, EVEN WHEN THE LEVELS DID NOT (writer audit 27 Sep, finding 8).
 *
 * An approval whose levels need a derived frame writes in two steps (`agent-capabilities.ts`, the
 * `set_option_intervention` path of `authoriseChange`):
 *
 *   1. ATTACH THE RANGE — one in-process `graph/register`. It COMMITS: the model moves, and a signed-in
 *      user gets a version (`model_version` on the register response).
 *   2. RECORD THE LEVELS — `commitOptionLevels`, all or none.
 *
 * When step 2 came back `stale` or refused, the result said `mutated: false` and "this approval left the
 * model unchanged" — while step 1 had already changed it. The frame write's receipt was never collected,
 * and `ranges_added_for_analysis` rode only the success return. So the Agent told the user nothing had
 * changed, the turn's `_agent.receipts` named no version, and a chip for a proposal made before this
 * approval could still be offered against a model that had moved.
 *
 * Rows (a)–(c) are the defect; (d) and (e) are the controls that keep the fix from over-reaching:
 *   (d) no range was needed, so nothing was written — today's "unchanged" return, exactly;
 *   (e) range and levels both land — today's success return, now carrying the range's receipt too.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createProposal, ProposalStore } from '../proposal.js';
import { collectTurnReceipts } from '../turn-receipts.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'req-frame-receipt' };

const FACTOR = 'fac_subs';
const OPTION = 'opt_raise';
const APPROVED_HASH = 'hash-the-user-approved';
/** The revision the range write itself produced. */
const FRAMED_HASH = 'hash-after-the-range-was-attached';
/** The revision the levels commit produced (row (e) only). */
const LEVELS_HASH = 'hash-after-the-levels';

/** The register route's own receipt block (`assist.v1.scenario-graph-register.ts`, `model_version: { … }`). */
const FRAME_MODEL_VERSION = {
  mutation_id: 'mut-frame-0001',
  version_id: 'ver-frame-0001',
  version_number: 7,
  creation_kind: 'graph_registration',
  graph_identity_hash: 'identity-after-the-range',
  analysis_affecting_hash: 'analysis-after-the-range',
};
const LEVELS_RECEIPT = { version: 8, version_id: 'ver-levels-0001', mutation_id: 'mut-levels-0001', source_turn_id: 'turn-levels-0001' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> };
/** A factor carrying a BARE AMOUNT — the only shape that gets a range attached. */
const NODES: Node[] = [
  { id: OPTION, kind: 'option', label: 'Raise Pro to £59' },
  { id: FACTOR, kind: 'factor', label: 'Active Subscribers', observed_state: { value: 408, raw_value: 408 } },
  { id: 'goal_1', kind: 'goal', label: 'MRR' },
];
const EDGES = [{ from: OPTION, to: FACTOR, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' }];

type Levels = 'stale' | 'refused' | 'committed';

/**
 * The product: a register that COMMITS (the model moves to `FRAMED_HASH` and the factor carries the range it
 * was sent), and a level port that answers `levels`. `modelVersion: null` is a guest — the register route
 * omits the key entirely when no version was written (MV001).
 */
function product(levels: Levels, modelVersion: Record<string, unknown> | null = FRAME_MODEL_VERSION) {
  let nodes: Node[] = NODES.map((n) => ({ ...n }));
  let hash = APPROVED_HASH;
  const registered: Record<string, unknown>[] = [];
  const levelCalls: CommitOptionLevelsInput[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      registered.push(b);
      nodes = ((b.graph ?? {}) as { nodes: Node[] }).nodes;
      hash = FRAMED_HASH;
      return {
        status: 200,
        json: { registered: true, graph_hash: FRAMED_HASH, ...(modelVersion !== null ? { model_version: modelVersion } : {}) },
      };
    }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes, edges: EDGES }, graph_hash: hash } };
    return { status: 200, json: {} };
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    levelCalls.push(input);
    if (levels === 'stale') return { status: 'stale' };
    if (levels === 'refused') return { status: 'refused', reason: 'unresolved_effect_relationship', pair: { option_id: OPTION, factor_id: FACTOR } };
    nodes = nodes.map((n) => (n.id === OPTION ? { ...n, interventions: { [FACTOR]: { value: input.levels[0]!.value } } } : n));
    hash = LEVELS_HASH;
    return {
      status: 'committed', graph_hash: LEVELS_HASH, receipt: LEVELS_RECEIPT, already_applied: false,
      committed_levels: [{ option_id: OPTION, factor_id: FACTOR, value: input.levels[0]!.value }], links_resized: [],
    };
  };
  return { d, commitOptionLevels, registered, levelCalls };
}

/** A held level; `derivedFrame` is what sends the approval through step 1. */
function seed(store: ProposalStore, derivedFrame: number | null): string {
  const p = createProposal({
    scenario_id: SCENARIO,
    user_id: USER,
    base_graph_identity_hash: APPROVED_HASH,
    operations: [
      {
        op: 'set_option_intervention',
        path: `${OPTION}::${FACTOR}`,
        value: { raw: 360, normalised: 0.72, ...(derivedFrame !== null ? { derived_frame: derivedFrame } : {}) },
      } as never,
    ],
    provenance: { authored_by: 'model_proposed' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: 'Raise Pro to £59 sets Active Subscribers to 360',
  });
  store.put(p);
  return p.proposal_id;
}

async function approve(levels: Levels, opts: { modelVersion?: Record<string, unknown> | null; derivedFrame?: number | null } = {}) {
  const p = product(levels, opts.modelVersion === undefined ? FRAME_MODEL_VERSION : opts.modelVersion);
  const store = new ProposalStore();
  const id = seed(store, opts.derivedFrame === undefined ? 500 : opts.derivedFrame);
  const caps = createAgentCapabilities(p.d, store, undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
  const r = (await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never)) as Record<string, unknown>;
  return { p, store, id, caps, r };
}

const receiptsOf = (r: Record<string, unknown>) => (Array.isArray(r.receipts) ? r.receipts : []) as { version: number; version_id: string; mutation_id: string; source_turn_id: string | null }[];
const statusLineOf = (r: Record<string, unknown>) => narrateWriteOutcome('', [{ name: 'authorise_change' }], [r as never]).status ?? '';
const stillAwaiting = (store: ProposalStore, id: string) => store.outstanding(SCENARIO, USER).some((x) => x.proposal_id === id);

/** What rows (a)–(c) share: the range landed, no level did, and the result says exactly that. */
function expectRangeLandedLevelsDid(r: Record<string, unknown>, p: ReturnType<typeof product>) {
  // Preconditions: step 1 really committed and step 2 really ran — else every assertion below is vacuous.
  expect(p.registered.length, 'no range was attached — this row would be vacuous').toBe(1);
  expect(p.levelCalls.length, 'the level port was never reached — this row would be vacuous').toBe(1);
  expect(p.levelCalls[0]!.base_graph_hash, 'the levels ran on the revision the range write produced').toBe(FRAMED_HASH);

  expect(r.mutated, `the range write changed the model: ${JSON.stringify(r)}`).toBe(true);
  expect(r.applied).toBe(false);
  expect(r.ok).toBe(false);
  expect(r.ranges_added_for_analysis, 'the factor that now carries a range is named').toEqual([{ factor: 'Active Subscribers', range: 500 }]);
  expect(r.revision_after, 'the revision the model is now at — the range write moved it').toBe(FRAMED_HASH);
  expect(String(r.detail)).not.toMatch(/left the model unchanged/);
  expect(String(r.detail)).toMatch(/none of the levels/i);
  expect(String(r.detail)).toMatch(/Active Subscribers 0 to 500/);
  const levelFailures = ((r.failures ?? []) as { path: string }[]).filter((f) => f.path === `${OPTION}::${FACTOR}`);
  expect(levelFailures.length, 'the level that did not land is named').toBe(1);
  // The user reads the server's own status line, never the model's: it must not say nothing was applied.
  expect(statusLineOf(r)).toMatch(/^Partly saved/);
  expect(statusLineOf(r)).not.toMatch(/none of it was applied/);
}

describe('(a)–(c) the range landed and the levels did not → the result reports the write', () => {
  it('(a) ⛔ levels stale: mutated, the range write’s receipt, the framed factor named', async () => {
    const { p, r, store, id } = await approve('stale');
    expectRangeLandedLevelsDid(r, p);
    expect(receiptsOf(r), 'the frame write’s receipt, mapped to the levels receipt’s shape').toEqual([
      { version: 7, version_id: 'ver-frame-0001', mutation_id: 'mut-frame-0001', source_turn_id: '' },
    ]);
    // ⭐ It reaches the turn's wire receipts (`_agent.receipts`) by identity, not by count.
    expect(collectTurnReceipts([r]).map((x) => x.version_id)).toEqual(['ver-frame-0001']);
    // ⛔ The levels did not land: the proposal is NOT marked applied — it is still awaiting a yes.
    expect(stillAwaiting(store, id), 'an approval whose levels did not land must not be marked applied').toBe(true);
  });

  it('(b) ⛔ levels refused: the same truth — the range write is reported', async () => {
    const { p, r, store, id } = await approve('refused');
    expectRangeLandedLevelsDid(r, p);
    expect(receiptsOf(r).map((x) => x.version_id)).toEqual(['ver-frame-0001']);
    expect(String(((r.failures ?? []) as { path: string; detail: string }[]).find((f) => f.path === `${OPTION}::${FACTOR}`)?.detail))
      .toMatch(/was refused/);
    expect(stillAwaiting(store, id)).toBe(true);
  });

  it('(c) ⛔ guest (no model_version): still mutated, and no receipt is invented', async () => {
    const { p, r } = await approve('stale', { modelVersion: null });
    expectRangeLandedLevelsDid(r, p);
    expect(receiptsOf(r), 'a guest write mints no version, so none is reported').toEqual([]);
    expect(collectTurnReceipts([r])).toEqual([]);
  });
});

describe('controls', () => {
  it('(d) ⭐ CONTROL — no range needed, levels stale: today’s exact "unchanged" return', async () => {
    const { p, r, store, id } = await approve('stale', { derivedFrame: null });
    expect(p.registered.length, 'no range was needed, so nothing was registered').toBe(0);
    expect(p.levelCalls.length, 'the level port was reached').toBe(1);
    expect(Object.keys(r).sort()).toEqual(['applied', 'detail', 'failures', 'interventions', 'mutated', 'ok', 'refusal']);
    expect(r).toMatchObject({
      ok: false, mutated: false, applied: false, refusal: 'not_applied',
      detail:
        'None of the levels were recorded, so this approval left the model unchanged. Read the model again ' +
        'before describing it: someone else may have changed it meanwhile.',
    });
    expect(r.ranges_added_for_analysis).toBeUndefined();
    expect(stillAwaiting(store, id)).toBe(true);
  });

  it('(e) ⭐ CONTROL — range and levels both land: the success return, now with the range’s receipt beside the levels’', async () => {
    const { p, r, store, id, caps } = await approve('committed');
    expect(p.registered.length).toBe(1);
    expect(r).toMatchObject({ ok: true, mutated: true, applied: true, recorded_count: 1, requested_count: 1, revision_after: LEVELS_HASH });
    expect(r.ranges_added_for_analysis).toEqual([{ factor: 'Active Subscribers', range: 500 }]);
    expect(receiptsOf(r).map((x) => x.version_id), 'both writes of this approval, in the order they committed').toEqual(['ver-frame-0001', 'ver-levels-0001']);
    expect(stillAwaiting(store, id), 'a fully landed approval is marked applied').toBe(false);
    // A retry recovers BOTH receipts from the store (`markApplied` holds what this approval wrote).
    const again = (await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never)) as Record<string, unknown>;
    expect(again.already_applied).toBe(true);
    expect(receiptsOf(again).map((x) => x.version_id)).toEqual(['ver-frame-0001', 'ver-levels-0001']);
  });
});
