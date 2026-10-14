/**
 * Paul's legacy-code brief (14 Oct, scenario c1494f4d): an event-by-date option with no Olumi pace acts through the brief's own
 * capacity chain (`eventCapacityRatios`). Real construction (`buildModelFromBrief`) on the persisted drafter answer; the
 * provider is scripted. L2 (admission): the option gets its own switch. Its size waits for the team's own share (L3), so until
 * then no chance may rest on it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { unresolvedEventOptionIds, withEventShareDate } from '../../goal-target/event-by-date-model.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { withShareByDateChanceGate } from '../../goal-target/goal-chance-range.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/paul-legacy-c1494f4d-raw-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; brief_sha256: string; raw_text: string; raw_sha256: string };
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;

async function construct(answer: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('c1494f4d-13f9-4216-ac62-35871c7ff207', FX.brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  }) as never, (async () => ({ text: JSON.stringify(answer), status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return graph!;
}
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const LEGACY = 'event_option_2', CARRY_ON = 'event_option_1', HIRE = 'event_option_3', LEGACY_SWITCH = 'event_capacity_2';

describe('L2: an event option with no Olumi pace acts through the brief\'s own capacity chain', () => {
  it('PRECONDITION: the persisted answer is byte-exact; the legacy option has no pace and a stated product identity reaches the goal', () => {
    expect(createHash('sha256').update(FX.brief, 'utf8').digest('hex')).toBe(FX.brief_sha256);
    expect(createHash('sha256').update(FX.raw_text, 'utf8').digest('hex')).toBe(FX.raw_sha256);
    expect(draft().options[1]).toMatchObject({ label: 'Legacy-code reduction', added_capacity: null });
    expect(draft().identities[0]).toMatchObject({ outcome: 'Feature development capacity', operation: 'product' });
  });

  it('⭐ RED→GREEN: the legacy option gets its own switch carrying its ratio (510/450); it is no longer a clone of carrying on', async () => {
    const g = await construct(draft());
    const sw = node(g, LEGACY_SWITCH);
    expect(sw.observed_state.extra_share_by_date).toMatchObject({ capacity_ratio: 510 / 450, lead_low: 0, lead_high: 0 });
    expect(node(g, LEGACY).interventions[LEGACY_SWITCH]).toEqual({ value: 1 });
    expect(node(g, CARRY_ON).interventions[LEGACY_SWITCH]).toEqual({ value: 0 });
    expect(node(g, LEGACY).interventions).not.toEqual(node(g, CARRY_ON).interventions);
    expect(unresolvedEventOptionIds(g)).toEqual([]);
    // One mechanism per option (DL ruling): the hire keeps its pace switch and gets no ratio carrier.
    expect(node(g, 'event_capacity_3').observed_state.extra_share_by_date).toMatchObject({ monthly_share: 8 });
    expect(node(g, 'event_capacity_3').observed_state.extra_share_by_date.capacity_ratio).toBeUndefined();
  });

  it('⛔ until L3 sizes it, the ratio link stays defaulted and NO chance rests on it, with the team\'s 7–8 months saved', async () => {
    const dated = withEventShareDate(await construct(draft()), '2027-04-14', '2026-10-14') as Rec;
    expect(dated.edges.find((e: Rec) => e.from === LEGACY_SWITCH).defaulted).toBe(true);
    const saved = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 7, high_months: 8,
      deadline: '2027-04-14', reference_date: '2026-10-14' } as never, computeAnalysisAffectingGraphHash(dated as never)!);
    if (saved.kind !== 'mutated') throw new Error(JSON.stringify(saved));
    const envelope = { option_comparison: [CARRY_ON, LEGACY, HIRE].map((id) => ({ option_id: id, probability_of_goal: 0.3,
      outcome: { p10: 0.6, p50: 0.8, p90: 0.95 } })), inference_warnings: [] as Rec[] };
    const gated = withShareByDateChanceGate(envelope, saved.mutatedGraph, 'event_goal') as Rec;
    const withheld = (gated.inference_warnings as Rec[]).filter((w) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION
      && Array.isArray(w.option_ids) && w.option_ids.includes(LEGACY));
    expect(withheld.length, JSON.stringify(gated.inference_warnings)).toBeGreaterThan(0);
  });

  it('CONTRAST (fail closed): a ratio below 1 gives no switch, with its reason; the option stays unresolved', async () => {
    const d = draft();
    d.options[1].interventions[0].value = 35; // legacy 25% → 35%: feature time 75% → 65%, r < 1
    const g = await construct(d);
    expect(node(g, LEGACY_SWITCH)).toBeUndefined();
    expect(unresolvedEventOptionIds(g)).toEqual([LEGACY]);
  });
});
