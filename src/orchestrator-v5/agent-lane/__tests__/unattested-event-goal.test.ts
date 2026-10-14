/**
 * ⛔ AN UNATTESTED EVENT IS NEVER SAVED AS THE GOAL (DL ruling 14 Oct, amended per PL #94 05:36Z; served hiring on CEE
 * 34a5cdf6, run 2026-10-14T050406Z-hiring-post3008: "Urgent launch" saved as a %-level goal with no target, all three Runs
 * "Not shown yet: needs a target", while Paul's "increase productivity by at least 10%" sat as a row beside it).
 *
 * First loss: the drafter (raw 9d75b605) chose `event_by_date` "Urgent launch"; the brief reader does not attest the event.
 * That text is PROMPT's, and a draw can repeat it, so construction asks the ONE existing retry to re-choose the goal, with the
 * reason and the brief's own words; a redraft is adopted only when its goal is no longer an unattested event and every
 * user-material guard holds; otherwise nothing is saved and the AI asks the user (`construction_needs_redraft`).
 *
 * Construction replayed for real (`buildModelFromBrief`) from the PERSISTED first answer
 * (`fixtures/hiring-unattested-event-raw-20261014.json`, byte-exact, sha256 checked). Scripted: the provider, and the
 * redraft's answer (hand-written in the shape today's earlier draws of this brief returned: Productivity ≥ +10 %).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import { briefAttestsEventByDate, unattestedEventGoal } from '../../goal-target/event-by-date-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/hiring-unattested-event-raw-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; raw_text: string; raw_sha256: string };
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;
const EVENT_WORDS = 'We have an urgent launch date in the next three months.';
const GOVERNING = 'Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality?';

/** The redraft: the brief's governing goal (productivity ≥ +10 % against today), the launch kept as a condition. */
const redraft = (): Rec => {
  const d = draft();
  d.goal = { kind: null, deliverable: null, metric: 'Productivity', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3,
    provenance: 'explicit', frame: 'change_abs', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null,
    quantity_frame: 'change', basis: { reference: 'today', denominator: "today's productivity", period_months: 3, period_kind: 'at_end',
      effect_unit: "% of today's productivity", effects_at_period_end: false,
      also_required: ['maintaining code quality', 'launch completed by the urgent launch date'], open_question: null },
    source_quote: GOVERNING };
  d.constraints = (d.constraints as Rec[]).filter((c) => c.role !== 'target');
  d.factors = (d.factors as Rec[]).filter((f) => f.label !== 'Productivity change by launch');
  d.links = (d.links as Rec[]).filter((l) => l.to !== 'Urgent launch' && l.to !== 'Productivity change by launch' && l.from !== 'Productivity change by launch')
    .concat([
      { from: 'Delivery capacity', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Code quality score', to: 'Productivity', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Launch delay from onboarding', to: 'Productivity', direction: 'negative', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
    ]);
  d.unknown_concerns = (d.unknown_concerns as Rec[]).map((u) => ({ ...u, concerns: (u.concerns as string[]).filter((c) => !c.includes('Urgent launch')) }));
  return d;
};

async function construct(answers: readonly string[], brief = FX.brief): Promise<{ graph: Rec | undefined; result: Rec; calls: Rec[] }> {
  let graph: Rec | undefined;
  const calls: Rec[] = [];
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async (req: Rec) => { calls.push(req); return { text: answers[Math.min(calls.length, answers.length) - 1]!, status: 'completed' }; };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000e2', brief, dispatch as never, drafter as never) as Rec;
  return { graph, result, calls };
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;

describe('an unattested event is never saved as the goal; the one existing retry re-chooses it, else the user is asked', () => {
  it('PRECONDITION: the persisted answer is byte-exact and takes the launch as the goal, which the brief does not attest', () => {
    expect(createHash('sha256').update(FX.raw_text, 'utf8').digest('hex')).toBe(FX.raw_sha256);
    const d = draft();
    expect(d.goal).toMatchObject({ kind: 'event_by_date', metric: 'Urgent launch', unit: '%', value: null, source_quote: EVENT_WORDS });
    expect(d.decision_question).toBe(GOVERNING);
    expect(briefAttestsEventByDate(FX.brief, d.goal as never)).toBe(false);
    expect(unattestedEventGoal(d as unknown as CandidateModel, FX.brief, false)).toEqual({ event: 'Urgent launch', words: EVENT_WORDS, governing: GOVERNING });
  });

  it('⭐ RED→GREEN raw 9d75b605: the one retry is asked with the reason and the brief\'s words, and its goal — productivity ≥ +10 % with its conditions — is saved', async () => {
    const { graph, result, calls } = await construct([FX.raw_text, JSON.stringify(redraft())]);
    expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
    expect(calls).toHaveLength(2);
    // The retry carries the reason and the brief's own words, with the previous model, and its goal is NOT pinned.
    expect(calls[1]!.input).toContain(`The goal \\"Urgent launch\\" is an event the brief does not state as its goal (the brief says: \\"${EVENT_WORDS}\\").`);
    expect(calls[1]!.input).toContain(GOVERNING);
    expect(JSON.stringify(calls[1]!.schema.properties.goal.properties.metric)).not.toContain('Urgent launch');
    const goal = goalOf(graph!);
    expect(goal).toMatchObject({ label: 'Productivity', goal_direction: '>=', goal_threshold_raw: 10, goal_threshold_unit: '%', goal_threshold_frame: 'change_abs' });
    expect(goal.goal_target_basis?.also_required).toEqual(['maintaining code quality', 'launch completed by the urgent launch date']);
    // The user's limit is kept; no node or row carries "Urgent launch" as a goal.
    expect((graph!.goal_constraints as Rec[]).map((c) => [c.label, c.operator, c.value])).toEqual([['Hiring cost', '<=', 200000]]);
  });

  it('a redraft that still takes the unattested event as the goal saves nothing; the AI asks the user, with the reason and the words', async () => {
    const { graph, result, calls } = await construct([FX.raw_text, FX.raw_text]);
    expect(calls).toHaveLength(2);
    expect(graph).toBeUndefined();
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_needs_redraft' });
    expect(result.detail).toBe(`The draft took "Urgent launch" as the goal, but the brief does not state it as the goal ("${EVENT_WORDS}"). `
      + `Its governing statement is: "${GOVERNING}". Nothing was saved. Ask the user which result the model should measure success by, then draft it again with that goal.`);
  });

  it('a redraft that loses the user\'s figure (≥ 12 % for their 10 %) is not adopted: nothing is saved and the user is asked', async () => {
    const r = redraft();
    r.goal.value = 12;
    const { graph, result, calls } = await construct([FX.raw_text, JSON.stringify(r)]);
    expect(calls).toHaveLength(2);
    expect(graph).toBeUndefined();
    expect(result).toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
  });

  it('CONTRAST: an event the brief attests is not re-asked: one drafter call, and the event reading stands', async () => {
    const brief = FX.brief.replace(EVENT_WORDS, 'We must launch the app by March 2027 with the current team.');
    const d = draft();
    d.goal = { ...d.goal, metric: 'Launch the app', deliverable: 'the app launch', source_quote: 'We must launch the app by March 2027 with the current team.' };
    expect(briefAttestsEventByDate(brief, d.goal as never), 'PRECONDITION: attested').toBe(true);
    expect(unattestedEventGoal(d as unknown as CandidateModel, brief, false)).toBeNull();
    const { calls } = await construct([JSON.stringify(d)], brief);
    expect(calls.every((c) => !String(c.input).includes('is an event the brief does not state as its goal'))).toBe(true);
  });

  it('CONTRAST: a goal that is not an event (marketing\'s two targets) is never re-asked by this rule', async () => {
    const d = draft();
    d.goal = { ...redraft().goal };
    d.constraints = [...(d.constraints as Rec[]).filter((c) => c.role !== 'target'),
      { metric: 'Code quality score', operator: '>=', value: 75, unit: 'score out of 100', provenance: 'explicit', frame: 'level', role: 'target' }];
    expect(unattestedEventGoal(d as unknown as CandidateModel, FX.brief, false)).toBeNull();
    const { calls } = await construct([JSON.stringify(d)]);
    expect(calls.every((c) => !String(c.input).includes('is an event the brief does not state as its goal'))).toBe(true);
  });
});
