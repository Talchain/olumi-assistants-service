/**
 * GOAL SENSE FROM THE TYPED COMPARATOR (Science ruling 5 Oct; integrator github-26; MC brief-goal-sense).
 *
 * Measured (0 LLM, the 20 stored graphs of the live 4×5 @6df7726a): `resolveGoalDirection(stored, goal)` was undefined
 * in 20/20. The sealed goal held `>=` (a floor, which the reader never honoured), and the held-outs held nothing: the
 * projector stamps `goal_direction` only when the direction words are exactly the operator words ("reach 1,100 …" never
 * is), though the drafter TYPED `direction`.
 *
 * Science (binding): (1) ceiling ⇒ minimise is sound for a goal's direction of preference; (2) MC makes the reader
 * change; (3) a typed FLOOR is also user-stated, written explicitly, so only a truly absent direction falls to the
 * classifier/default, with the assumption line.
 *
 * Every row runs the REAL served constructor (`buildModelFromRecords`, model text stubbed to an authored strict wire),
 * then the register route's store composition (kind normalise → persistence projection → entity refs), then the
 * reader. The assumption line is the headline's own frame (`describeGoalFrame`) over the run envelope in run-analysis
 * order: `withoutDirectionUnattestedOnHeldFloor`, then the headline. ⚠ ONE STEP IS MODELLED, NOT CALLED: PLoT/ISL put
 * GOAL_DIRECTION_UNATTESTED on the run iff CEE sent no `goal_direction` (PLoT contract, openapi.yaml `goal_direction`,
 * staging 685fa207: "When omitted, ISL runs the maximiser UNATTESTED and discloses this via GOAL_DIRECTION_UNATTESTED").
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { strictRecordsWire } from '../../../../../orchestrator-v5/agent-lane/__tests__/records-wire-fixture.js';
import { normaliseGraphNodeKindField } from '../../../../../orchestrator-v5/graph-registration/normalise-node-kind.js';
import { projectGraphForPersistence } from '../../../../../orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../../../../orchestrator-v5/graph/entity-refs.js';
import { heldGoalPointsUp, resolveGoalDirection } from '../../../../../orchestrator-v5/goal-target/goal-direction.js';
import { withGoalSenseReading } from '../../../../../orchestrator-v5/agent-lane/goal-sense-reading.js';
import { buildGoalReadingDisclosure } from '../../../../../orchestrator-v5/coaching/goal-reading-disclosure.js';
import { describeGoalFrame } from '../../../../../orchestrator-v5/coaching/analysis-result-headline.js';
import { withoutDirectionUnattestedOnHeldFloor } from '../../../../../orchestrator-v5/compose/claim-safety-cage.js';
import { computeAnalysisAffectingGraphHash } from '../../../../../orchestrator-v5/context/graph-hash.js';
import { NodeV3 } from '../../../../../schemas/cee-v3.js';
import { BRIEF, sealedRecordsVNext, sealedRecordsVNextLinked } from './sealed-fixture-vnext.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
type Json = Record<string, any>;
/** The sealed ideal's goal stated item ("Goal: reach at least £150,000 monthly recurring revenue within 9 months."). */
const GOAL = 6;

/** The served constructor, offline: the model text is `text`; the register body is captured. */
async function construct(text: string) {
  let body: Json | undefined;
  const result: Json = await buildModelFromRecords(SCENARIO, BRIEF,
    async (path, b) => { if (path.endsWith('/register')) { body = b as Json; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text, status: 'completed' }));
  return { result, body };
}

/** The register route's store composition for a first draft (as tools/mc-replay/replay-records.ts runs it). */
function storedOf(registered: unknown): Json {
  const normalised = normaliseGraphNodeKindField(registered);
  if (!normalised.ok) throw new Error(`kind normalise refused: ${normalised.reason}`);
  const opts = { scenarioId: SCENARIO, turnClass: 'direct_answer' as const, source: 'graph_registration' as const };
  return assignEntityRefs(projectGraphForPersistence(normalised.graph, opts), null).graph as Json;
}

/** The linked sealed strict wire with the goal item's direction and/or literal replaced. */
function goalWire(direction: string, literal?: string): Json {
  const wire = structuredClone(strictRecordsWire(sealedRecordsVNextLinked())) as Json;
  wire.stated_items[GOAL].direction = direction;
  if (literal !== undefined) wire.stated_items[GOAL].direction_literal = literal;
  return wire;
}

async function built(text: string) {
  const { result, body } = await construct(text);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const stored = storedOf(body!.graph);
  const goal = (stored.nodes as Json[]).find(n => n.kind === 'goal')!;
  return { result, body: body!, stored, goal };
}

/** Did the reply say it ASSUMED the direction? The run envelope as the headline sees it (see the header). */
function saysDirectionAssumed(stored: Json, goalId: string): boolean {
  const sent = resolveGoalDirection(stored, goalId) !== undefined;
  const fromPlot = { inference_warnings: sent ? [] : [{ code: 'GOAL_DIRECTION_UNATTESTED' }] };
  const pointsUp = heldGoalPointsUp(stored, goalId);
  const enrichment = withoutDirectionUnattestedOnHeldFloor(fromPlot, pointsUp);
  const frame = describeGoalFrame({ enrichment, goal_points_up_as_held: pointsUp } as never);
  return frame === 'direction_assumed' || frame === 'direction_assumed_and_attainment_untested';
}

describe('goal sense: the WRITER types the reading from the goal item\'s typed `direction`, never its words', () => {
  it('floor (+ "at least", the sealed ideal) → {maximise, typed_comparator}; the held `>=` is kept as it was', async () => {
    const { goal } = await built(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    expect(goal.goal_sense_reading).toEqual({ sense: 'maximise', basis: 'typed_comparator' });
    expect(goal.goal_direction).toBe('>=');
  });
  it('floor with words that are NOT the operator words ("reach", the held-out class) → {maximise, typed_comparator}; nothing held', async () => {
    const { goal } = await built(JSON.stringify(goalWire('floor', 'reach')));
    expect(goal.goal_sense_reading).toEqual({ sense: 'maximise', basis: 'typed_comparator' });
    expect(goal.goal_direction).toBeUndefined();
  });
  it('ceiling → {minimise, typed_comparator}, from the TYPE: its words ("at least") hold no comparator', async () => {
    const { goal } = await built(JSON.stringify(goalWire('ceiling')));
    expect(goal.goal_sense_reading).toEqual({ sense: 'minimise', basis: 'typed_comparator' });
    expect(goal.goal_direction).toBeUndefined();
  });
  it("'unresolved' → no reading; fix (a)'s typed ask is unchanged (link_unresolved, asked receipt, one question)", async () => {
    const { result, body, goal } = await built(JSON.stringify(goalWire('unresolved')));
    expect(goal).not.toHaveProperty('goal_sense_reading');
    expect(result.not_represented).toContainEqual(expect.objectContaining({ stated_index: GOAL, reason: 'link_unresolved', unresolved_field: 'direction' }));
    expect((body.stated_dispositions as Json[]).find(d => d.stated_index === GOAL)).toMatchObject({ disposition: 'asked', reason: 'link_unresolved' });
    const quote = sealedRecordsVNextLinked().stated_items[GOAL]!.source_quote;
    expect((result.open_questions as string[]).filter(q => q.includes(`"${quote}"`))).toHaveLength(1);
  });
  it('absent (an untyped record set: no direction, no ask) → no reading', async () => {
    const records = sealedRecordsVNext() as unknown as Json;
    delete records.stated_items[GOAL].direction;
    const { goal } = await built(JSON.stringify(records));
    expect(goal).not.toHaveProperty('goal_sense_reading');
    expect(goal.goal_direction).toBeUndefined();
  });
});

describe('goal sense: the READER, on the STORED graph, and whether the reply says the direction was assumed', () => {
  it('floor (held-out class) → maximise / stated_comparator; NO assumption line', async () => {
    const { stored, goal } = await built(JSON.stringify(goalWire('floor', 'reach')));
    expect(resolveGoalDirection(stored, goal.id)).toEqual({ direction: 'maximise', provenance: 'stated_comparator' });
    expect(saysDirectionAssumed(stored, goal.id)).toBe(false);
  });
  it('floor (the sealed ideal, held `>=`) → maximise / stated_comparator; NO assumption line', async () => {
    const { stored, goal } = await built(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    expect(resolveGoalDirection(stored, goal.id)).toEqual({ direction: 'maximise', provenance: 'stated_comparator' });
    expect(saysDirectionAssumed(stored, goal.id)).toBe(false);
  });
  it('ceiling → minimise / stated_comparator; NO assumption line', async () => {
    const { stored, goal } = await built(JSON.stringify(goalWire('ceiling')));
    expect(resolveGoalDirection(stored, goal.id)).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
    expect(saysDirectionAssumed(stored, goal.id)).toBe(false);
  });
  it('absent → the label classifier (nothing sent for this increase label) WITH the assumption line', async () => {
    const records = sealedRecordsVNext() as unknown as Json;
    delete records.stated_items[GOAL].direction;
    const { stored, goal } = await built(JSON.stringify(records));
    expect(resolveGoalDirection(stored, goal.id)).toBeUndefined();
    expect(saysDirectionAssumed(stored, goal.id)).toBe(true);
  });
  it("'unresolved' → the typed ask (above) and the classifier, WITH the assumption line", async () => {
    const { stored, goal } = await built(JSON.stringify(goalWire('unresolved')));
    expect(resolveGoalDirection(stored, goal.id)).toBeUndefined();
    expect(saysDirectionAssumed(stored, goal.id)).toBe(true);
  });
  it('the typed reading says no "Olumi reads" words: the goal-reading disclosure stays empty for it', async () => {
    const { stored, goal } = await built(JSON.stringify(goalWire('ceiling')));
    expect(buildGoalReadingDisclosure(stored, goal.id)).toBe('');
  });
});

describe('goal sense: a later statement by the USER is never overruled by the typed reading', () => {
  it("the user's approved CEILING card (a `<=` row on the goal; the held floor cleared) silences a maximise reading", async () => {
    const { stored, goal } = await built(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    const edited = structuredClone(stored);
    const node = (edited.nodes as Json[]).find(n => n.id === goal.id)!;
    delete node.goal_direction;
    edited.goal_constraints = [...(edited.goal_constraints ?? []), { constraint_id: 'c-card', node_id: goal.id, operator: '<=', value: 1, label: 'card' }];
    expect(resolveGoalDirection(edited, goal.id)).toBeUndefined();
    // CONTRAST: the same graph without the card row reads the typed floor.
    delete edited.goal_constraints;
    expect(resolveGoalDirection(edited, goal.id)).toEqual({ direction: 'maximise', provenance: 'stated_comparator' });
  });
  it('a held FLOOR the user approved since silences a minimise reading', async () => {
    const { stored, goal } = await built(JSON.stringify(goalWire('ceiling')));
    const edited = structuredClone(stored);
    (edited.nodes as Json[]).find(n => n.id === goal.id)!.goal_direction = '>=';
    expect(resolveGoalDirection(edited, goal.id)).toBeUndefined();
  });
});

describe('goal sense: CONTRAST — the legacy typed_change_sign reading is unchanged', () => {
  const legacyGoal = () => ({ id: 'g', kind: 'goal', label: 'Monthly spend', goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2, goal_threshold_unit: '%' });
  it('withGoalSenseReading still writes its own reading and the reader still sends minimise / typed_change_sign from it', () => {
    const [node] = withGoalSenseReading([legacyGoal()], { operator: '<=' });
    expect((node as Json).goal_sense_reading).toMatchObject({ sense: 'minimise', basis: 'typed_change_sign', threshold: -0.2, threshold_frame: 'change_rel' });
    const graph = { nodes: [node], edges: [] };
    expect(resolveGoalDirection(graph, 'g')).toEqual({ direction: 'minimise', provenance: 'typed_change_sign' });
    expect(buildGoalReadingDisclosure(graph, 'g')).toContain('Olumi reads');
  });
  it('NodeV3 keeps both readings and drops a malformed one (absence, never a refused graph)', () => {
    const [legacy] = withGoalSenseReading([legacyGoal()], { operator: '<=' });
    const base = { id: 'g', kind: 'goal', label: 'G' };
    expect(NodeV3.parse({ ...base, goal_sense_reading: (legacy as Json).goal_sense_reading }).goal_sense_reading).toEqual((legacy as Json).goal_sense_reading);
    expect(NodeV3.parse({ ...base, goal_sense_reading: { sense: 'maximise', basis: 'typed_comparator' } }).goal_sense_reading).toEqual({ sense: 'maximise', basis: 'typed_comparator' });
    expect(NodeV3.parse({ ...base, goal_sense_reading: { sense: 'minimise', basis: 'typed_comparator' } }).goal_sense_reading).toEqual({ sense: 'minimise', basis: 'typed_comparator' });
    expect(NodeV3.parse({ ...base, goal_sense_reading: { sense: 'target', basis: 'typed_comparator' } }).goal_sense_reading).toBeUndefined();
    expect(NodeV3.parse({ ...base, goal_sense_reading: { sense: 'maximise', basis: 'typed_change_sign', threshold: -0.2, threshold_frame: 'change_rel', words: 'w' } }).goal_sense_reading).toBeUndefined();
  });
});

describe('goal sense: the sealed ideal\'s analysis hash (Science ruling 5 Oct, brief-goal-sense)', () => {
  it('the STORED graph\'s hash (as the Run and the read compute it) is UNCHANGED: the reading is outside the node projection and the stored graph names no goal_node_id', async () => {
    const { stored, goal } = await built(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    expect(goal.goal_sense_reading).toEqual({ sense: 'maximise', basis: 'typed_comparator' });
    expect(stored).not.toHaveProperty('goal_node_id');
    // Base 6df7726a: a47b8f90834ce325 (measured, RED-first run). Unchanged at this head.
    expect(computeAnalysisAffectingGraphHash(stored as never)).toBe('a47b8f90834ce325');
  });
  it('with goal_node_id named (a GraphStateIngress that carries it), run_semantics moves none → maximise / stated_comparator: pinned', async () => {
    const { stored, goal } = await built(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    const named = { ...stored, goal_node_id: goal.id };
    const withoutReading = structuredClone(named);
    delete (withoutReading.nodes as Json[]).find(n => n.id === goal.id)!.goal_sense_reading;
    // The base semantics (no reading ⇒ the held floor reads as base: nothing sent).
    expect(computeAnalysisAffectingGraphHash(withoutReading as never)).toBe('5cb489d39e84ab88');
    expect(computeAnalysisAffectingGraphHash(named as never)).toBe('12255e69ee5ef7c9');
  });
});
