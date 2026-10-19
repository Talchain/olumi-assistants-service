/**
 * ⛔ AN UNATTESTED EVENT IS NEVER SAVED AS THE GOAL (DL ruling 14 Oct, amended per PL #94 05:36Z; served hiring on CEE
 * 34a5cdf6, run 2026-10-14T050406Z-hiring-post3008: "Urgent launch" saved as a %-level goal with no target, all three Runs
 * "Not shown yet: needs a target", while Paul's "increase productivity by at least 10%" sat as a row beside it).
 *
 * First loss: the drafter (raw 9d75b605) chose `event_by_date` "Urgent launch"; the brief reader does not attest the event.
 * That text is PROMPT's, and a draw can repeat it, so construction asks the ONE existing retry to re-choose the goal, with the
 * reason and the brief's own words; a redraft is adopted only when its goal is no longer an unattested event and every
 * user-material guard holds. ⭐ RE-RULED (signed change 6, DL-3 19 Oct; Paul's live test dd904404 13:01Z): otherwise the FIRST
 * draft is saved as a labelled provisional draft (K6 `withOpenAim`) instead of nothing: the event is never the goal, the aim
 * is Olumi's open question with no figure, and every row the user stated is kept whole (`expectOpenAimKeepingTheUser`).
 *
 * Construction replayed for real (`buildModelFromBrief`) from the PERSISTED first answer
 * (`fixtures/hiring-unattested-event-raw-20261014.json`, byte-exact, sha256 checked). Scripted: the provider, and the
 * redraft's answer (hand-written in the shape today's earlier draws of this brief returned: Productivity ≥ +10 %).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, OPEN_AIM_GOAL_LABEL, UNATTESTED_GOAL_RETRY_ISSUE } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import { briefAttestsEventByDate, unattestedEventGoal } from '../../goal-target/event-by-date-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/hiring-unattested-event-raw-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; raw_text: string; raw_sha256: string };
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;
const EVENT_WORDS = 'We have an urgent launch date in the next three months.';
const GOVERNING = 'Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality?';

/**
 * The redraft: the brief's governing goal (productivity ≥ +10 % against today), the launch kept as a condition. It takes the
 * first draft's own target quantity, "Productivity change by launch", as its goal: a user's target survives a re-chosen goal
 * only by its full identity, the same quantity and the same terms (⛔ Codex FAIL 3026 r1).
 */
const redraft = (): Rec => {
  const d = draft();
  d.goal = { kind: null, deliverable: null, metric: 'Productivity change by launch', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3,
    provenance: 'explicit', frame: 'change_abs', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null,
    quantity_frame: 'change', basis: { reference: 'today', denominator: "today's productivity", period_months: 3, period_kind: 'at_end',
      effect_unit: "% of today's productivity", effects_at_period_end: false,
      also_required: ['maintaining code quality', 'launch completed by the urgent launch date'], open_question: null },
    source_quote: GOVERNING };
  d.constraints = (d.constraints as Rec[]).filter((c) => c.role !== 'target');
  d.factors = (d.factors as Rec[]).filter((f) => f.label !== 'Productivity change by launch');
  d.links = (d.links as Rec[]).filter((l) => l.to !== 'Urgent launch' && l.to !== 'Productivity change by launch' && l.from !== 'Productivity change by launch')
    .concat([
      { from: 'Delivery capacity', to: 'Productivity change by launch', direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Code quality score', to: 'Productivity change by launch', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
      { from: 'Launch delay from onboarding', to: 'Productivity change by launch', direction: 'negative', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
    ]);
  d.unknown_concerns = (d.unknown_concerns as Rec[]).map((u) => ({ ...u, concerns: (u.concerns as string[]).filter((c) => !c.includes('Urgent launch')) }));
  return d;
};

async function construct(answers: readonly string[], brief = FX.brief): Promise<{ graph: Rec | undefined; result: Rec; calls: Rec[]; registeredBrief?: unknown }> {
  let graph: Rec | undefined;
  let registeredBrief: unknown;
  const calls: Rec[] = [];
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); registeredBrief = (body as { brief_text?: unknown }).brief_text; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async (req: Rec) => { calls.push(req); return { text: answers[Math.min(calls.length, answers.length) - 1]!, status: 'completed' }; };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000e2', brief, dispatch as never, drafter as never) as Rec;
  return { graph, result, calls, registeredBrief };
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
/** The user's own "increase productivity by at least 10%", as the first draft's target row registers it. */
const USER_TARGET = { node_id: 'productivity_change_by_launch', operator: '>=', value: 10, unit: '%', value_frame: 'change_abs', provenance: 'explicit', role: 'goal_target' };
/** The open-aim draft: ONE goal, Olumi's open question with no figure; never the event; each of the user's rows kept whole. */
function expectOpenAimKeepingTheUser(graph: Rec | undefined, result: Rec, rows: readonly Rec[] = [USER_TARGET]): void {
  expect(result, JSON.stringify(result).slice(0, 600)).toMatchObject({ ok: true, open_aim: true });
  const goals = (graph!.nodes as Rec[]).filter((n) => n.kind === 'goal');
  expect(goals).toEqual([expect.objectContaining({ label: OPEN_AIM_GOAL_LABEL, provenance: 'ai_inferred' })]);
  expect('goal_threshold_raw' in goals[0]!, 'no figure is invented for the open aim').toBe(false);
  for (const row of rows) expect(graph!.goal_constraints).toContainEqual(expect.objectContaining(row));
}

describe('an unattested event is never saved as the goal; the one existing retry re-chooses it, else the aim is left open', () => {
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
    // The AIE's retry issue (packet 5b8c2f0e), whole, then both retained-wording clauses: each is a complete statement of the brief.
    expect(calls[1]!.input).toContain(JSON.stringify(`${UNATTESTED_GOAL_RETRY_ISSUE} Retained event wording: "${EVENT_WORDS}". Retained intent wording: "${GOVERNING}".`).slice(1, -1));
    expect(JSON.stringify(calls[1]!.schema.properties.goal.properties.metric)).not.toContain('Urgent launch');
    const goal = goalOf(graph!);
    expect(goal).toMatchObject({ label: 'Productivity change by launch', goal_direction: '>=', goal_threshold_raw: 10, goal_threshold_unit: '%', goal_threshold_frame: 'change_abs' });
    expect(goal.goal_target_basis?.also_required).toEqual(['maintaining code quality', 'launch completed by the urgent launch date']);
    // The user's limit is kept; no node or row carries "Urgent launch" as a goal.
    expect((graph!.goal_constraints as Rec[]).map((c) => [c.label, c.operator, c.value])).toEqual([['Hiring cost', '<=', 200000]]);
  });

  it('⭐ RE-RULED: a redraft that still takes the unattested event as the goal → the first draft is saved with the aim open, never the event, the user\'s target kept whole', async () => {
    const { graph, result, calls } = await construct([FX.raw_text, FX.raw_text]);
    expect(calls, 'draft + goal retry; the open-aim pass makes no provider call').toHaveLength(2);
    expectOpenAimKeepingTheUser(graph, result);
    expect((graph!.nodes as Rec[]).map((n) => n.label)).not.toContain('Urgent launch');
  });

  /** ⛔ Codex post-merge 3026, probe 1: the redraft's own target is credited only as admission RETAINED it. */
  it('a redraft whose goal names the user\'s quantity but states no target (`target_stated: false`) is not adopted: the target is never lost', async () => {
    const r = redraft();
    r.goal.target_stated = false;
    const { graph, result, calls } = await construct([FX.raw_text, JSON.stringify(r)]);
    expect(calls).toHaveLength(2);
    // ⭐ RE-RULED: not adopted; the first draft saves with the aim open, and productivity keeps its ≥ 10 % target row.
    expectOpenAimKeepingTheUser(graph, result);
  });

  it('a retained-wording clause is omitted when its words are not a complete statement of the brief (the core text stays whole)', async () => {
    const d = draft();
    d.goal.source_quote = 'an urgent launch date in the next three months';
    expect(FX.brief.includes(d.goal.source_quote), 'PRECONDITION: verbatim, but only part of the statement').toBe(true);
    const { result, calls } = await construct([JSON.stringify(d), JSON.stringify(d)]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.input).toContain(JSON.stringify(`${UNATTESTED_GOAL_RETRY_ISSUE} Retained intent wording: "${GOVERNING}".`).slice(1, -1));
    expect(String(calls[1]!.input)).not.toContain('Retained event wording');
    expect(result).toMatchObject({ ok: true, open_aim: true });
  });

  it('a redraft that loses the user\'s figure (≥ 12 % for their 10 %) is not adopted: the aim is left open and their 10 % is kept, never 12 %', async () => {
    const r = redraft();
    r.goal.value = 12;
    const { graph, result, calls } = await construct([FX.raw_text, JSON.stringify(r)]);
    expect(calls).toHaveLength(2);
    expectOpenAimKeepingTheUser(graph, result);
    expect((graph!.goal_constraints as Rec[]).some((c) => c.value === 12)).toBe(false);
  });

  /**
   * ⛔ Codex FAIL 3026 r1 (independent probes): the exception compared only comparator, figure, unit and frame, so another
   * quantity carrying the same "≥ +10 %" consumed productivity's target and was saved, stamped `from_brief`. The user's
   * target is kept only by its FULL identity: the same quantity and the same terms.
   */
  it.each(['Code quality', 'Revenue', 'Urgent launch'])('a redraft whose goal is another quantity with the user\'s terms (%s, at least +10 per cent) is not adopted: the aim is left open, never that quantity', async (metric) => {
    const r = redraft();
    r.goal.metric = metric;
    r.links = (r.links as Rec[]).map((l) => (l.to === 'Productivity change by launch' ? { ...l, to: metric } : l));
    const { graph, result, calls } = await construct([FX.raw_text, JSON.stringify(r)]);
    expect(calls).toHaveLength(2);
    expectOpenAimKeepingTheUser(graph, result);
  });

  it('a redraft that keeps the unattested event under another kind ("Urgent launch", kind null, every user limit kept) is still unattested: never saved as the goal', async () => {
    const d = draft();
    d.goal = { ...d.goal, kind: null, deliverable: null };
    expect(unattestedEventGoal(d as unknown as CandidateModel, FX.brief, false), 'PRECONDITION: no longer typed as an event').toBeNull();
    const { graph, result, calls } = await construct([FX.raw_text, JSON.stringify(d)]);
    expect(calls).toHaveLength(2);
    expectOpenAimKeepingTheUser(graph, result);
  });

  /**
   * The same rule at adoption, told apart by the call count: real T5 D2 r1 drafts, where rep 7 (smaller, still over the
   * limit) keeps "Feature launch" with `kind: null`. Adopted, it would earn #3019's second size retry (a third call); it is
   * refused at adoption, so the first draft stands and the user is asked after two calls.
   */
  it('a smaller retry still over the limit that keeps the unattested event under another kind is refused at adoption: no second size retry', async () => {
    const D2 = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
    const RETRIES = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-v3-retries.json', 'utf8')) as Rec;
    const unkind = (d: Rec): Rec => ({ ...structuredClone(d), goal: { ...d.goal, kind: null, deliverable: null } });
    expect(RETRIES.retry_rep7.goal).toMatchObject({ kind: 'event_by_date', metric: 'Feature launch' });
    const { graph, result, calls } = await construct([JSON.stringify(D2.draft_call1), JSON.stringify(unkind(RETRIES.retry_rep7)),
      JSON.stringify(unkind(RETRIES.retry_rep6))], D2.brief);
    expect(calls).toHaveLength(2);
    expect(graph).toBeUndefined();
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'construction_needs_redraft' });
  });

  /** Two targets the user stated in one sentence with the same terms: productivity and code quality, each ≥ +10 %. */
  const PAIR_QUESTION = 'Should I hire a Tech lead or two developers to increase productivity by at least 10% and code quality by at least 10%?';
  const withQualityTarget = (d: Rec): Rec => ({ ...d, decision_question: PAIR_QUESTION, constraints: [...(d.constraints as Rec[]),
    { metric: 'Code quality score', operator: '>=', value: 10, unit: '%', provenance: 'explicit', frame: 'change_abs', role: 'target' }] });
  it('two same-terms targets never collapse: a redraft that takes one as its goal and drops the other is not adopted; both rows are kept, the aim left open', async () => {
    const r = { ...redraft(), decision_question: PAIR_QUESTION };
    const { graph, result, calls } = await construct([JSON.stringify(withQualityTarget(draft())), JSON.stringify(r)], FX.brief.replace(GOVERNING, PAIR_QUESTION));
    expect(calls).toHaveLength(2);
    expectOpenAimKeepingTheUser(graph, result, [USER_TARGET, { node_id: 'code_quality_score', operator: '>=', value: 10, unit: '%', provenance: 'explicit' }]);
  });

  it('CONTRAST: the same redraft keeping the other target is adopted, with the goal and both of the user\'s rows', async () => {
    const { graph, result, calls } = await construct([JSON.stringify(withQualityTarget(draft())), JSON.stringify(withQualityTarget(redraft()))],
      FX.brief.replace(GOVERNING, PAIR_QUESTION));
    expect(result.ok, JSON.stringify(result).slice(0, 800)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(goalOf(graph!)).toMatchObject({ label: 'Productivity change by launch', goal_threshold_raw: 10, goal_threshold_frame: 'change_abs' });
    expect((graph!.goal_constraints as Rec[]).map((c) => [c.label, c.operator, c.value, c.provenance])).toEqual(expect.arrayContaining([
      ['Code quality score', '>=', 10, 'explicit'], ['Hiring cost', '<=', 200000, 'inferred']]));
  });

  /**
   * #3019's second size retry edits the ADOPTED model. When the first retry re-chose an unattested goal, the second keeps the
   * goal it chose (pinned to it), never the event. Real T5 D2 r1 drafts (`tests/fixtures/size-retry`): the first pass (over
   * the limit), rep 7 (still over) and rep 6 (within). Scripted: rep 7 and rep 6 answer with the brief's own goal, conversion
   * above 15 %, in place of "Feature launch". The goal takes the user's own target quantity, "Conversion rate"
   * (its factor and target row become the goal; links into either point at it; nothing else changes). Its link out of
   * "Conversion rate" cannot stand once that is the goal, so rep 7 carries one more Olumi-proposed link to stay over the
   * limit as served (31 links) — the second size retry this row pins runs only on a model still over it.
   */
  it('a second size retry after the goal was re-chosen is pinned to the re-chosen goal; its within-limit answer registers with every other target and limit kept', async () => {
    const D2 = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
    const RETRIES = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-v3-retries.json', 'utf8')) as Rec;
    const regoal = (draft: Rec, extraLinks: readonly Rec[] = []): Rec => {
      const d = structuredClone(draft);
      d.goal = { ...d.goal, kind: null, deliverable: null, metric: 'Conversion rate', operator: '>', target_stated: true, value: 15, unit: '%',
        horizon_months: 3, frame: 'level', quantity_frame: 'level', basis: null,
        source_quote: 'Success means a conversion rate of over 15% and at least 20 new customers during the first three months after launch.' };
      d.constraints = (d.constraints as Rec[]).filter((c) => c.metric !== 'Conversion rate');
      d.factors = (d.factors as Rec[]).filter((f) => f.label !== 'Conversion rate');
      d.links = (d.links as Rec[]).map((l) => (l.to === 'Feature launch' ? { ...l, to: 'Conversion rate' } : l)).filter((l) => l.from !== l.to).concat(extraLinks);
      return d;
    };
    expect(unattestedEventGoal(D2.draft_call1 as CandidateModel, D2.brief, false), 'PRECONDITION: the served first pass is unattested').not.toBeNull();
    const { graph, result, calls, registeredBrief } = await construct([JSON.stringify(D2.draft_call1), JSON.stringify(regoal(RETRIES.retry_rep7, [{ from: 'Annual marketing spend', to: 'Unknown conversion lift', direction: 'positive',
      provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }])), JSON.stringify(regoal(RETRIES.retry_rep6))], D2.brief);
    expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
    expect(calls).toHaveLength(3);
    const metricOf = (call: Rec): unknown => call.schema.properties.goal.properties.metric;
    expect(metricOf(calls[1]!), 'the redraft re-chooses the goal: unpinned').not.toHaveProperty('enum');
    expect(metricOf(calls[2]!), 'the second size retry keeps the goal the first chose').toEqual({ type: 'string', enum: ['Conversion rate'] });
    expect(goalOf(graph!)).toMatchObject({ label: 'Conversion rate', goal_direction: '>', goal_threshold_raw: 15 });
    // Compaction after the redraft keeps every other target and limit the user stated, by quantity, comparator and figure.
    const rows = (graph!.goal_constraints as Rec[]).map((c) => [c.label, c.operator, c.value]);
    expect(rows).toEqual(expect.arrayContaining([['New customers in first 3 months', '>=', 20], ['Annual marketing spend', '<=', 100000],
      ['Working time on launch marketing', '<=', 25]]));
    expect(registeredBrief, 'the brief is the source registered').toBe(D2.brief);
  });

  /** ⛔ Codex post-merge 3026, probe 2: the second size retry keeps the ACCEPTED redraft's conditions, not only the first draft's. */
  it('a compaction after a permitted redraft that drops a condition the redraft added is not adopted: nothing registers without it', async () => {
    const D2 = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
    const RETRIES = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-v3-retries.json', 'utf8')) as Rec;
    const regoal = (draft: Rec, alsoRequired: string[], extraLinks: readonly Rec[] = []): Rec => {
      const d = structuredClone(draft);
      d.goal = { ...d.goal, kind: null, deliverable: null, metric: 'Conversion rate', operator: '>', target_stated: true, value: 15, unit: '%',
        horizon_months: 3, frame: 'level', quantity_frame: 'level',
        basis: { reference: 'launch', denominator: null, period_months: 3, period_kind: 'over_period', effect_unit: '%', effects_at_period_end: true,
          also_required: alsoRequired, open_question: null },
        source_quote: 'Success means a conversion rate of over 15% and at least 20 new customers during the first three months after launch.' };
      d.constraints = (d.constraints as Rec[]).filter((c) => c.metric !== 'Conversion rate');
      d.factors = (d.factors as Rec[]).filter((f) => f.label !== 'Conversion rate');
      d.links = (d.links as Rec[]).map((l) => (l.to === 'Feature launch' ? { ...l, to: 'Conversion rate' } : l)).filter((l) => l.from !== l.to).concat(extraLinks);
      return d;
    };
    const stillOver = [{ from: 'Annual marketing spend', to: 'Unknown conversion lift', direction: 'positive', provenance: 'ai_proposed',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }];
    const both = ['maintain customer trust', 'avoid misleading claims'];
    const { graph, result, calls } = await construct([JSON.stringify(D2.draft_call1), JSON.stringify(regoal(RETRIES.retry_rep7, both, stillOver)),
      JSON.stringify(regoal(RETRIES.retry_rep6, ['maintain customer trust', 'maintain customer trust']))], D2.brief);
    expect(calls).toHaveLength(3);
    const registered = graph === undefined ? undefined : goalOf(graph).goal_target_basis?.also_required;
    expect(registered, 'never ["maintain customer trust" ×2] without "avoid misleading claims"').not.toEqual(['maintain customer trust', 'maintain customer trust']);
    if (graph !== undefined) expect(registered).toEqual(both);
    else expect(result.ok).toBe(false);
    // CONTRAST: the same compaction keeping both conditions registers them.
    const kept = await construct([JSON.stringify(D2.draft_call1), JSON.stringify(regoal(RETRIES.retry_rep7, both, stillOver)),
      JSON.stringify(regoal(RETRIES.retry_rep6, both))], D2.brief);
    expect(kept.result.ok, JSON.stringify(kept.result).slice(0, 400)).toBe(true);
    expect(goalOf(kept.graph!).goal_target_basis?.also_required).toEqual(both);
  });

  it('CONTRAST: an event the brief attests is not re-asked: one drafter call, and the event reading stands', async () => {
    const brief = FX.brief.replace(EVENT_WORDS, 'We must launch the app by March 2027 with the current team.');
    const d = draft();
    d.goal = { ...d.goal, metric: 'Launch the app', deliverable: 'the app launch', source_quote: 'We must launch the app by March 2027 with the current team.' };
    // The statement era (AIE 6184383302): the goal's own target statement, which holds its period ("by March 2027").
    (d as unknown as { statements: unknown[] }).statements = [...(((d as unknown as { statements?: unknown[] }).statements) ?? []),
      { quote: 'We must launch the app by March 2027 with the current team.', subject: { kind: 'goal', label: 'Launch the app', to_label: null, factor_label: null },
        field: 'target', form: 'describes', value: null, low: null, high: null, unit: null, qualifier: null, conditions: null }];
    expect(briefAttestsEventByDate(brief, d.goal as never), 'PRECONDITION: attested').toBe(true);
    expect(unattestedEventGoal(d as unknown as CandidateModel, brief, false)).toBeNull();
    const { graph, result, calls } = await construct([JSON.stringify(d)], brief);
    expect(calls.every((c) => !String(c.input).includes(UNATTESTED_GOAL_RETRY_ISSUE))).toBe(true);
    expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(goalOf(graph!)).toMatchObject({ id: 'event_goal', goal_threshold_unit: '% of the app launch', goal_deadline_as_stated: 'by March 2027' });
  });

  it('CONTRAST: a goal that is not an event (marketing\'s two targets) is never re-asked by this rule', async () => {
    const d = draft();
    d.goal = { ...redraft().goal, metric: 'Productivity' };
    d.constraints = [...(d.constraints as Rec[]).filter((c) => c.role !== 'target'),
      { metric: 'Code quality score', operator: '>=', value: 75, unit: 'score out of 100', provenance: 'explicit', frame: 'level', role: 'target' }];
    expect(unattestedEventGoal(d as unknown as CandidateModel, FX.brief, false)).toBeNull();
    const { graph, result, calls } = await construct([JSON.stringify(d)]);
    expect(calls.every((c) => !String(c.input).includes(UNATTESTED_GOAL_RETRY_ISSUE))).toBe(true);
    expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(goalOf(graph!)).toMatchObject({ label: 'Productivity', goal_threshold_raw: 10 });
    expect((graph!.goal_constraints as Rec[]).map((c) => [c.label, c.operator, c.value])).toEqual(expect.arrayContaining([['Code quality score', '>=', 75]]));
  });
});
