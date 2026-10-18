import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { userStatementRecord, userStatementsOn } from '../../statement-door/statements.js';
import { withConstructionStatements } from '../construction-source-map.js';
import { firstConstructInput, CURRENT_MODEL_CONTEXT_LEAD, LATER_MESSAGES_CONTEXT_LEAD } from '../runtime/build-model.js';
import { prepareRequestedRebuild } from '../runtime/draft-replacement.js';
import { levelFrameOf, projectModelContext } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { HistoryStore, answeredEarlierItem, ANSWERED_EARLIER_LABEL } from '../history-store.js';
import { REASONING_CONTEXT_LABEL, MODEL_RECORD_LABEL } from '../turn-context.js';

const cases = [
  { name: 'distribution', factor: 'Dispatch updates', risk: 'Service disruption', retained: 'delayed scans', withdrawn: 'the entire shift has stopped',
    oldGoal: 'Average dispatch delay', aim: 'Understand delivery priorities', question: 'Which shift does the delay concern?', answer: 'The evening shift only.' },
  { name: 'laboratory', factor: 'Sample log', risk: 'Quality concern', retained: 'delayed labels; the morning team is checking the shared register while the evening team disputes the cause. '.repeat(3), withdrawn: 'all batches are contaminated',
    oldGoal: 'Average processing delay', aim: 'Understand laboratory priorities', question: 'Which batch does the delay concern?', answer: 'The second batch only.' },
];
const request = 'Rebuild this model using the saved corrections and answered context.';
const at = '2026-08-01T00:00:00Z';
function fixture(row: typeof cases[number]) {
  const old = `${row.factor} and ${row.risk} report ${row.retained} and ${row.withdrawn}.`;
  const brief = `We need ${row.oldGoal} at most 6 days. Compare exploring process changes with keeping the current process.`;
  const subject = { kind: 'factor' as const, id: 'report', field: 'relation' as const };
  const risk = { kind: 'risk' as const, id: 'risk', field: 'holds_now' as const };
  const record = (s: typeof subject | typeof risk) => userStatementRecord(s, [{ source: old, quote: old, speaker: 'user', reading: 'olumi',
    form: 'describes', subject: { quantity: 'reported_account', node_id: s.id } }], at, { recorded_by: 'construction' });
  const graph: Rec = { goal_node_id: 'old_goal', nodes: [
    { id: 'old_goal', kind: 'goal', label: row.oldGoal, provenance: 'from_brief', goal_threshold_raw: 6, goal_threshold_unit: 'days',
      goal_direction: '<=', goal_threshold_frame: 'level', user_statements: [userStatementRecord({ kind: 'goal', id: 'old_goal', field: 'target' },
        [{ source: brief, quote: brief, speaker: 'user', reading: 'olumi', form: 'upper_bound', high: 6, unit: 'days', subject: { quantity: row.oldGoal, node_id: 'old_goal' } }], at)] },
    { id: 'report', kind: 'factor', label: row.factor, provenance: 'from_brief', user_statements: [record(subject)],
      observed_state: { value: 0.6, raw_value: 60, cap: 100, declared_scale: 'unit_interval', unit: '%', source: 'cee_inference' } },
    { id: 'risk', kind: 'risk', label: row.risk, already_true_quote: old, user_statements: [record(risk)] },
    { id: 'answer', kind: 'factor', label: 'Answer scope', user_statements: [userStatementRecord(
      { kind: 'factor', id: 'answer', field: 'relation' }, [{ speaker: 'user', source: 'Answer scope includes every shift and batch.',
        quote: 'Answer scope includes every shift and batch.', reading: 'olumi', form: 'describes', subject: { quantity: 'scope', node_id: 'answer' } }], at)] },
    { id: 'option', kind: 'option', label: 'Explore process changes', interventions: { report: { value: 0.8, raw_value: 80, unit: '%' } } },
    { id: 'keep', kind: 'option', label: 'Keep current process', interventions: { report: { value: 0.6, raw_value: 60, unit: '%' } } },
    { id: 'dissent', kind: 'outcome', label: 'Team reservation', description: 'The night team disputes the mechanism.', provenance: 'unverified_brief' },
  ], edges: [{ from: 'option', to: 'report', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'keep', to: 'report', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'report', to: 'old_goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' }],
    goal_constraints: [{ constraint_id: 'old_target', node_id: 'old_goal', role: 'goal_target', operator: '<=', value: 6, unit: 'days', value_frame: 'level' }] };
  return { graph, old, brief, subject, risk };
}
async function savedWorld(row: typeof cases[number], options: Parameters<typeof correctionWorld>[2] = {}) {
  const f = fixture(row), w = await correctionWorld(f.graph, '', { brief: f.brief, ...options });
  const save = async (message: string, tool: string, args: Rec) => {
    Object.assign(w.ctx, { user_turn_text: message, user_text: message, verified_user_messages: [message] });
    const offered = await w.offer(tool, args);
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    expect(await w.press(String(offered.proposal_id))).toMatchObject({ ok: true, applied: true });
  };
  // An already-approved answer uses the existing statement correction card, not a raw Q/A graph carrier.
  const answer = `For Answer scope, retract “every shift and batch”; the answer is: ${row.answer}`;
  await save(answer, 'propose_statement', { correction: { quote: answer, edits: [{ subject: { kind: 'factor', id: 'answer', field: 'relation' },
    retirement: { quote: 'every shift and batch', scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: row.answer }] } });
  const correction = `For ${row.factor} and ${row.risk}, retract “${row.withdrawn}”; keep the earlier report.`;
  await save(correction, 'propose_statement', { correction: { quote: correction, edits: [f.subject, f.risk].map(s => ({ subject: s,
    retirement: { quote: row.withdrawn, scope: 'part', disposition: 'retracted' }, retained: [row.retained], reading_words: 'reported delay; universal claim withdrawn',
    ...(s.id === 'risk' ? { legacy: { field: 'already_true_quote', expected: f.old, replacement: null } } : {}) })) } });
  const reframe = `Change ${row.oldGoal} to ${row.aim} before testing process changes.`;
  await save(reframe, 'propose_goal_target', { reframe: { goal_id: 'old_goal', quote: reframe, label: row.aim } });
  Object.assign(w.ctx, { user_turn_text: request, user_text: request, verified_user_messages: [request] });
  return { ...w, f };
}
const project = (g: Rec) => projectModelContext({ nodes: g.nodes, edges: g.edges, raw: g } as never) as Rec;
const jsonAfter = (input: string, label: string) => JSON.parse(input.split(`${label} `)[1]!);
const noRef = ({ ref: _ref, ...n }: Rec) => n;
const constructionCarriers = (input: string): { conversation: Rec[]; items: Rec[] } => {
  const beforeModel = input.split(`\n\n${CURRENT_MODEL_CONTEXT_LEAD}`)[0]!;
  const [beforeShared, shared = '[]'] = beforeModel.split(`\n\n${REASONING_CONTEXT_LABEL}\n`);
  const words = beforeShared!.split(`${LATER_MESSAGES_CONTEXT_LEAD}\n`)[1] ?? '';
  const starts = [...words.matchAll(/^\{"speaker":"(?:user|unknown|olumi)","source":"[^\n]*"\}\n/gm)];
  const conversation = starts.map((match, index) => ({ ...JSON.parse(match[0].trim()),
    text: words.slice(match.index! + match[0].length, index + 1 < starts.length ? starts[index + 1]!.index! - 2 : undefined) }));
  return { conversation, items: JSON.parse(shared) };
};
const pairsIn = (items: Rec[]): Rec[] => items.flatMap(i => i.content.flatMap((p: Rec) =>
  [ANSWERED_EARLIER_LABEL, REASONING_CONTEXT_LABEL].some(label => p.text.startsWith(label))
    ? JSON.parse(p.text.slice(p.text.indexOf('\n') + 1)).answered_pairs : []));

it('W43/W44: the actual canonical getter and rebuild input carry one complete ranged conditional goal record', async () => {
  const f = fixture(cases[0]!), subject = { kind: 'goal' as const, id: 'old_goal', field: 'target' as const };
  const quote = 'Average dispatch delay is not between 2 and 5 days during the trial, provided the evening crew is available.';
  const record = userStatementRecord(subject, [{ source: quote, quote, speaker: 'user', reading: 'olumi', form: 'range', low: 2, high: 5,
    unit: 'days', conditions: 'provided the evening crew is available', period: 'during the trial', reference: 'dispatch to arrival',
    negated: true, subject: { quantity: 'dispatch_delay', node_id: subject.id } }], at, { recorded_by: 'construction' });
  f.graph.nodes[0].user_statements = [record];
  const cold = JSON.parse(JSON.stringify(f.graph)), before = structuredClone(cold);
  const w = await correctionWorld(cold, 'Read the saved model.', { brief: f.brief });
  const state = await w.caps().getCanonicalState(w.ctx) as Rec;
  const input = firstConstructInput(f.brief, { current_model: project(cold) });
  for (const view of [state, jsonAfter(input, CURRENT_MODEL_CONTEXT_LEAD)]) {
    expect(view.recorded_reasoning.find((n: Rec) => n.id === subject.id).user_statements).toEqual([record]);
    expect(view.goal).not.toHaveProperty('user_statements'); // No second flattened alias can discard or relabel source.
  }
  expect(w.graph()).toEqual(before); expect(w.writes).toHaveLength(0);
});


describe.each(cases)('R3 $name class', row => {
  it.each(['recent', 'trimmed'] as const)('real rebuild preserves the %s pair and its recorded origin', async placement => {
    const pair = { olumi: row.question, reply: row.answer, reply_source: 'typed' as const };
    const conversation = placement === 'recent' ? [{ role: 'assistant', content: row.question }, { role: 'user', content: row.answer }]
      : [answeredEarlierItem([pair, { ...pair, reply_source: 'unknown' }])!];
    const calls: Rec[] = [];
    const w = await savedWorld(row, { readTurnHistory: () => conversation, provider: async req => {
      calls.push(structuredClone(req)); return { text: JSON.stringify(structuredDraft(row)), status: 'completed' };
    } });
    await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Review our current priorities.', explicit_rebuild_request: request }), w.ctx, w.caps());
    const { items } = constructionCarriers(calls[0]!.input);
    expect(pairsIn(items)).toEqual(placement === 'recent' ? [{
      olumi: { speaker: 'olumi', source: "Olumi's reply, not a user statement", text: row.question },
      response: { speaker: 'unknown', source: 'stored conversation; typed or chip origin not verified here', text: row.answer },
    }] : [
      { olumi: { speaker: 'olumi', source: "the end of Olumi's reply, not a user statement", text: row.question },
        response: { speaker: 'user', source: 'typed', text: row.answer } },
      { olumi: { speaker: 'olumi', source: "the end of Olumi's reply, not a user statement", text: row.question },
        response: { speaker: 'unknown', source: 'stored, origin not verified', text: row.answer } },
    ]);
  });

  it('Q1 complete records reach construction; stale drafted claims cannot overwrite saved correction or borrow credit', async () => {
    const w = await savedWorld(row), saved = structuredClone(w.graph()), context = project(saved);
    const input = firstConstructInput(w.f.brief, { current_model: context });
    const records = jsonAfter(input, CURRENT_MODEL_CONTEXT_LEAD).recorded_reasoning;
    for (const id of ['report', 'risk', 'answer']) {
      expect(records.find((n: Rec) => n.id === id).user_statements).toEqual(saved.nodes.find((n: Rec) => n.id === id).user_statements);
    }
    const draft = structuredClone(saved);
    draft.nodes.find((n: Rec) => n.id === 'risk').already_true_quote = w.f.old;
    draft.nodes.find((n: Rec) => n.id === 'report').user_statements = saved.nodes.find((n: Rec) => n.id === 'answer').user_statements;
    draft.nodes.find((n: Rec) => n.id === 'dissent').user_statements = saved.nodes.find((n: Rec) => n.id === 'report').user_statements;
    const result = prepareRequestedRebuild(saved, draft, levelFrameOf);
    expect(result.missing).toEqual([]);
    for (const id of ['report', 'risk', 'answer', 'dissent']) expect((result.candidate as Rec).nodes.find((n: Rec) => n.id === id)).toEqual(saved.nodes.find((n: Rec) => n.id === id));
    const state = await w.caps().getCanonicalState(w.ctx) as Rec;
    const explained = await w.caps().getCanonicalState(w.ctx, { section: 'run_explanation' }) as Rec;
    expect(state.recorded_reasoning).toEqual(context.recorded_reasoning);
    expect(explained.recorded_reasoning).toEqual(context.recorded_reasoning);
  });

  it('Q2 whole archived aim and current goal survive; the earlier target stays absent', async () => {
    const w = await savedWorld(row), saved = structuredClone(w.graph()), context = project(saved);
    const input = firstConstructInput(w.f.brief, { current_model: context });
    expect(jsonAfter(input, CURRENT_MODEL_CONTEXT_LEAD).recorded_reasoning).toEqual(context.recorded_reasoning);
    const earlier = context.recorded_reasoning.find((n: Rec) => n.id === 'old_goal');
    for (const n of saved.nodes.filter((n: Rec) => n.kind === 'goal' || n.id === 'old_goal')) {
      expect(context.recorded_reasoning.find((x: Rec) => x.id === n.id).user_statements).toEqual(n.user_statements);
    }
    expect(earlier).toEqual({ id: 'old_goal', kind: 'outcome', label: row.oldGoal, provenance: 'from_brief',
      description: saved.nodes[0].description, analysis_participation: 'retained_excluded', user_statements: saved.nodes[0].user_statements });
    const draft = structuredClone(saved);
    draft.goal_constraints.push(w.f.graph.goal_constraints[0]);
    draft.nodes[0].description = 'Revived operative aim'; delete draft.nodes[0].analysis_participation;
    const result = prepareRequestedRebuild(saved, draft, levelFrameOf);
    expect(result.missing).toEqual([]);
    expect(result.candidate!.goal_constraints).toEqual(saved.goal_constraints);
    for (const n of saved.nodes.filter((n: Rec) => n.kind === 'goal' || n.id === 'old_goal')) expect((result.candidate as Rec).nodes.find((x: Rec) => x.id === n.id)).toEqual(n);
  });
});

function structuredDraft(row: typeof cases[number]): Rec {
  return {
    goal: { kind: null, deliverable: null, metric: row.aim, operator: '>=', target_stated: false, value: null, unit: '', horizon_months: null,
      provenance: 'inferred', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null, quantity_frame: 'level',
      source_quote: null, deadline_words: null, basis: null },
    constraints: [], options: [
      { label: 'Explore process changes', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: false,
        interventions: [{ factor_label: row.factor, value: 80, value_kind: 'absolute', unit: '%', provenance: 'inferred' }] },
      { label: 'Keep current process', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: true, interventions: [] },
    ], factors: [{ label: row.factor, role: 'controllable', baseline_known: true, baseline_value: 60, unit: '%', provenance: 'inferred', plausible_max: 100 }],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [{ from: row.factor, to: row.aim, direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
      effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }], statements: [],
  };
}
it('ONE combined real explicit rebuild → structured stub → restored own card → native register → cold graph', async () => {
  const row = cases[0]!, history = new HistoryStore(), calls: Rec[] = [];
  const pairItem = answeredEarlierItem([{ olumi: row.question, reply: row.answer, reply_source: 'typed' },
    { olumi: row.question, reply: row.answer, reply_source: 'unknown' }])!;
  const w = await savedWorld(row, { readTurnHistory: () => [pairItem, ...history.get('r3')], provider: async req => {
    calls.push(structuredClone(req)); return { text: JSON.stringify(structuredDraft(row)), status: 'completed' };
  } });
  // The late-bound reader sees history populated after capability construction, as the route does after reseeding.
  history.set('r3', [{ role: 'assistant', content: 'Which assumptions remain disputed?' }, { role: 'user', content: 'The night team still disputes the mechanism.' }]);
  const saved = structuredClone(w.graph()), writes = w.writes.length;
  const offered = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Review our current priorities.', explicit_rebuild_request: request }), w.ctx, w.caps());
  expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
  expect(w.writes).toHaveLength(writes); expect(w.graph()).toEqual(saved);
  const input = calls[0]!.input as string;
  const { items } = constructionCarriers(input);
  expect(items.find((i: Rec) => i.content[0].text.startsWith(ANSWERED_EARLIER_LABEL))).toEqual(pairItem);
  expect(pairsIn(items).map(p => [p.olumi.text, p.response.text])).toEqual([
    ['Which assumptions remain disputed?', 'The night team still disputes the mechanism.'],
    [row.question, row.answer], [row.question, row.answer],
  ]);
  expect(jsonAfter(input, CURRENT_MODEL_CONTEXT_LEAD).recorded_reasoning).toEqual(project(saved).recorded_reasoning);
  const pid = String(offered.proposal_id), restored = w.restoreCard(w.proposals.get(pid)!, offered, 'propose_change');
  expect(await w.press(pid, restored, false)).toMatchObject({ ok: false, mutated: false });
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
  expect(w.writes).toHaveLength(writes + 1); expect(w.registers).toHaveLength(writes + 1);
  const cold = await w.cold(); expect(cold.status).toBe(200);
  for (const n of saved.nodes) expect(noRef(cold.body.graph.nodes.find((x: Rec) => x.id === n.id))).toEqual(noRef(n));
  expect(cold.body.graph.goal_constraints).toEqual(saved.goal_constraints);
  expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true });
  expect(w.writes).toHaveLength(writes + 1);
});

it('construction preserves each answered-pair identity once and distinct typed statements as typed across both briefs', async () => {
  for (const row of cases) {
    const calls: Rec[] = [];
    const recent = 'The night team still disputes the mechanism.';
    const other = 'The day team has not checked the evidence yet.';
    const pairItem = answeredEarlierItem([{ olumi: row.question, reply: row.answer, reply_source: 'typed' }])!;
    const w = await savedWorld(row, { readTurnHistory: () => [pairItem,
      { role: 'assistant', content: 'Which assumptions remain disputed?' }, { role: 'user', content: recent }],
      provider: async req => { calls.push(structuredClone(req)); return { text: JSON.stringify(structuredDraft(row)), status: 'completed' }; } });
    const ctx = { ...w.ctx, verified_user_messages: [recent, request, other] };
    await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Review our current priorities.', explicit_rebuild_request: request }), ctx, w.caps());
    const { conversation, items } = constructionCarriers(calls[0]!.input);
    expect(conversation.slice(1)).toEqual([recent, request, other].map(text => ({ speaker: 'user', source: 'typed', text })));
    expect(items).toHaveLength(3);
    expect(items[2]).toEqual({ role: 'user', content: [{ type: 'input_text',
      text: JSON.stringify({ request, model_origin: MODEL_RECORD_LABEL }) }] });
    expect(items.find((i: Rec) => i.content[0].text.startsWith(ANSWERED_EARLIER_LABEL))).toEqual(pairItem);
    const context = JSON.parse(items.find(i => i.content[0].text.startsWith(REASONING_CONTEXT_LABEL))!.content[0].text.split('\n')[1]);
    expect(context.verified_user_statements).toEqual([recent, request, other].map(text => ({ speaker: 'user', source: 'typed', text })));
    expect(context.current_request_origin).toBe('typed');
    expect(pairsIn(items)).toEqual([
      { olumi: { speaker: 'olumi', source: "Olumi's reply, not a user statement", text: 'Which assumptions remain disputed?' },
        response: { speaker: 'unknown', source: 'stored conversation; typed or chip origin not verified here', text: recent } },
      { olumi: { speaker: 'olumi', source: "the end of Olumi's reply, not a user statement", text: row.question },
        response: { speaker: 'user', source: 'typed', text: row.answer } },
    ]);
  }
});

describe('R3 rebuild admission preserves statement authorship', () => {
  const olumiReply = 'Evening staffing is at 75% today. Shall we use that figure?';
  const quote = 'Evening staffing is at 75% today';
  const draftQuoting = (row: typeof cases[number]): Rec => {
    const d = structuredDraft(row);
    d.factors.push({ label: 'Evening staffing', role: 'external', baseline_known: true, baseline_value: 75, unit: '%', provenance: 'explicit', plausible_max: 100 });
    d.links.push({ ...d.links[0], from: 'Evening staffing' });
    d.statements = [{ quote, subject: { kind: 'factor', label: 'Evening staffing', to_label: null, factor_label: null }, field: 'level', form: 'point',
      value: 75, low: null, high: null, unit: '%', qualifier: null, conditions: null }];
    return d;
  };
  const runRebuild = async (typedExtra: string | null) => {
    const row = cases[0]!, calls: Rec[] = [];
    const w = await savedWorld(row, { readTurnHistory: () => [{ role: 'assistant', content: olumiReply }, { role: 'user', content: 'Noted.' }],
      provider: async req => { calls.push(structuredClone(req)); return { text: JSON.stringify(draftQuoting(row)), status: 'completed' }; } });
    const ctx = { ...w.ctx, verified_user_messages: typedExtra === null ? [request] : [typedExtra, request] };
    const offered = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Review our current priorities.', explicit_rebuild_request: request }), ctx, w.caps()) as Rec;
    const held = offered.proposal_id === undefined ? undefined : w.proposals.get(String(offered.proposal_id));
    const candidate = held === undefined ? offered.construction_report?.prepared_graph : (held.operations[0]!.value as Rec).candidate;
    return { calls, offered, candidate: candidate as Rec | undefined };
  };
  const userQuotesOf = (g: Rec | undefined): string[] => ((g?.nodes ?? []) as Rec[]).flatMap(n => ((n.user_statements ?? []) as Rec[])
    .flatMap(r => (r.statements as Rec[]).filter(s => s.speaker === 'user').map(s => String(s.quote))));
  it('the drafter quoting Olumi\'s forwarded reply never records it as the user\'s statement', async () => {
    const { calls, offered, candidate } = await runRebuild(null);
    expect(String(calls[0]!.input), 'control: Olumi\'s reply reached construction').toContain(olumiReply);
    expect(candidate, JSON.stringify(offered).slice(0, 800)).toBeDefined();
    expect(userQuotesOf(candidate).filter(q => q.includes('75%'))).toEqual([]);
  });
  it('the same words TYPED by the user are recorded as the user\'s', async () => {
    const { offered, candidate } = await runRebuild('Evening staffing is at 75% today.');
    expect(candidate, JSON.stringify(offered).slice(0, 800)).toBeDefined();
    expect(userQuotesOf(candidate).filter(q => q.includes('75%'))).toEqual([quote]);
  });
});


it.each(cases.flatMap(row => [false, true].map(mixed => ({ ...row, mixed }))))(
  '$name mixed=$mixed: compact construction context retains unknown words while the authority reader stays user-only', async row => {
    const f = fixture(row);
    const label = `${row.factor} reported concern`;
    const unknown = `Asha says: '${row.factor} needs a separate review.'`;
    const typed = `${row.factor} remains conditional on evidence from the team.`;
    const brief = row.mixed ? `${unknown}\n${typed}` : unknown;
    const graph = { ...f.graph, nodes: [...f.graph.nodes, { id: 'unknown-reference', kind: 'factor', label, provenance: 'unverified_brief' }] };
    const claim = (quote: string) => ({ quote, subject: { kind: 'factor', label }, field: 'relation', form: 'describes' });
    const saved = withConstructionStatements(graph, [claim(unknown), ...(row.mixed ? [claim(typed)] : [])], brief, at);
    const cold = JSON.parse(JSON.stringify(saved)) as Rec;
    const node = cold.nodes.find((n: Rec) => n.id === 'unknown-reference') as Rec;
    const raw = node.user_statements as Rec[];
    expect(raw, 'the actual producer must first retain the words').toHaveLength(1);
    expect(raw.flatMap(r => r.statements.map((s: Rec) => ({ speaker: s.speaker, quote: s.quote })))).toEqual([
      { speaker: 'unknown', quote: unknown }, ...(row.mixed ? [{ speaker: 'user', quote: typed }] : []),
    ]);
    expect(userStatementsOn(node).flatMap(r => r.statements.map(s => ({ speaker: s.speaker, quote: s.quote })))).toEqual(
      row.mixed ? [{ speaker: 'user', quote: typed }] : []);
    const view = project(cold);
    const held = (view.recorded_reasoning as Rec[]).find(r => r.id === 'unknown-reference');
    expect(held, 'the actual compact-reader frontier must be reached').toBeDefined();
    expect(held!.user_statements).toEqual(raw);
    expect(JSON.stringify(held!.current_retained ?? [])).not.toContain(unknown);
    const input = firstConstructInput(brief, { current_model: view });
    expect(jsonAfter(input, CURRENT_MODEL_CONTEXT_LEAD).recorded_reasoning).toEqual(view.recorded_reasoning);
    expect(node.observed_state).toBeUndefined();
    const calls: Rec[] = [];
    const w = await correctionWorld(cold, request, { brief: f.brief, provider: async req => {
      calls.push(structuredClone(req)); return { text: JSON.stringify(structuredDraft(row)), status: 'completed' };
    } });
    const state = await w.caps().getCanonicalState(w.ctx) as Rec;
    expect(state.recorded_reasoning.find((r: Rec) => r.id === node.id).user_statements).toEqual(raw);
    await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Review our current priorities.', explicit_rebuild_request: request }), w.ctx, w.caps());
    expect(calls.length, 'the real rebuild must reach its provider boundary').toBeGreaterThan(0);
    const sent = jsonAfter(String(calls[0]!.input), CURRENT_MODEL_CONTEXT_LEAD);
    expect(sent.recorded_reasoning.find((r: Rec) => r.id === node.id).user_statements).toEqual(raw);
    expect(w.writes, 'reference context does not approve a replacement').toEqual([]);
  });
