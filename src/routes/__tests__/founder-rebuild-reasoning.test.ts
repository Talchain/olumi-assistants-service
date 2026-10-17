/** Actual e625 read04; every candidate below is a declared contrast, not historical AI arguments. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareRequestedRebuild } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement.js';
import { levelFrameOf } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { narrateWriteOutcome } from '../../orchestrator-v5/agent-lane/write-outcome.js';
import { unpressedRebuildOptions } from '../../orchestrator-v5/agent-lane/runtime/rebuild-retirement-evidence.js';
import { createProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { proposalPendingAction } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { subjectKey } from '../../orchestrator-v5/statement-door/subject.js';
import { provenanceOf } from '../../cee/provenance/provenance-of.js';
import { NodeKindV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const capture = JSON.parse(readFileSync(new URL('./fixtures/founder-e625-rebuild-read04.json', import.meta.url), 'utf8')) as Rec;
const graph = () => structuredClone(capture.graph) as Rec;
const prepare = (saved: Rec, draft: Rec, unadopted: string[] = []) => {
  const result = prepareRequestedRebuild(saved, draft, levelFrameOf, unadopted);
  const candidate = result.candidate;
  if (candidate && (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges))) throw new Error('Malformed rebuild candidate');
  return { ...result, candidate: candidate as (Rec & { nodes: Rec[]; edges: Rec[] }) | undefined };
};
const omit = (g: Rec, ids: string[]) => {
  g.nodes = g.nodes.filter((n: Rec) => !ids.includes(n.id));
  g.edges = g.edges.filter((e: Rec) => !ids.includes(e.from) && !ids.includes(e.to));
};

describe('explicit rebuild retains the complete saved reasoning', () => {
  const quantities = ['factor', 'outcome', 'risk'];
  it.each(NodeKindV3.options.flatMap(savedKind =>
    (quantities.includes(savedKind) ? quantities : [savedKind]).map(proposedKind => ({ savedKind, proposedKind }))))(
    'B3 identity class: $savedKind → $proposedKind keeps the existing family or structural-kind boundary', ({ savedKind, proposedKind }) => {
      const saved: Rec = { nodes: [
        { id: 'sweep_goal', kind: 'goal', label: 'Current aim' },
        { id: 'sweep_decision', kind: 'decision', label: 'Current question' },
        { id: 'sweep_option', kind: 'option', label: 'Current option', interventions: {} },
        { id: 'sweep_neighbour', kind: 'factor', label: 'Shared neighbour' },
      ], edges: [
        { from: 'sweep_decision', to: 'sweep_option' },
        { from: 'sweep_option', to: 'sweep_neighbour' },
        { from: 'sweep_neighbour', to: 'sweep_goal' },
      ] };
      const original = ['goal', 'decision', 'option'].includes(savedKind)
        ? saved.nodes.find((n: Rec) => n.kind === savedKind)
        : { id: 'sweep_saved', kind: savedKind, label: 'Saved reading', provenance: 'ai_inferred' };
      if (!saved.nodes.includes(original)) {
        saved.nodes.push(original);
        saved.edges.push({ from: original.id, to: saved.nodes.find((n: Rec) => n.kind === 'goal').id,
          strength: { mean: 0.5, std: 0.1 }, provenance: { source: 'cee_hypothesis' } });
      }
      const savedInput = structuredClone(saved), draft = structuredClone(saved);
      // Options retain their existing collision/omission rules; do not extend quantity relabel inference to them.
      const id = savedKind === 'option' ? original.id : 'sweep_proposed';
      const added = { ...structuredClone(original), id, kind: proposedKind, label: 'Proposed reading' };
      draft.nodes = draft.nodes.map((n: Rec) => n.id === original.id ? added : n);
      draft.edges = draft.edges.map((e: Rec) => ({ ...e,
        from: e.from === original.id ? id : e.from, to: e.to === original.id ? id : e.to }));
      const draftInput = structuredClone(draft), refused = prepare(saved, draft);
      expect(refused.candidate).toBeUndefined(); expect(refused.missing).not.toEqual([]);
      if (savedKind === 'goal') expect(refused.missing).toEqual(['the saved governing outcome; use the existing goal-change card before rebuilding']);
      else if (savedKind === 'option') expect(refused.missing_kind).toBe('saved_option');
      else {
        expect(refused.missing_kind).toBe('recorded_reasoning');
        expect(refused.missing.join(' ')).toContain(original.label);
        expect(refused.missing.join(' ')).toContain(added.label);
      }
      expect(saved).toEqual(savedInput); expect(draft).toEqual(draftInput);
      const unchanged = prepare(saved, structuredClone(saved));
      expect(unchanged.missing).toEqual([]);
      expect(unchanged.candidate!.nodes.find((n: Rec) => n.id === original.id)).toEqual(original);
      const omitted = structuredClone(saved); omit(omitted, [original.id]);
      const carried = prepare(saved, omitted);
      if (savedKind === 'goal') expect(carried.candidate).toBeUndefined();
      else {
        expect(carried.missing).toEqual([]);
        expect(carried.candidate!.nodes.filter((n: Rec) => n.id === original.id)).toEqual([original]);
        expect(carried.candidate!.edges).toEqual(expect.arrayContaining(saved.edges.filter((e: Rec) => e.from === original.id || e.to === original.id)));
      }
    });
  it('host carries an omitted saved baseline; no source or candidate input is mutated', () => {
    const saved = graph(), draft = graph(), baseline = saved.nodes.find((n: Rec) => n.id === 'current_split_reference');
    omit(draft, [baseline.id]); const input = structuredClone(draft);
    const r = prepare(saved, draft); expect(r.missing).toEqual([]);
    expect(r.candidate!.nodes.find((n: Rec) => n.id === baseline.id)).toEqual(baseline);
    expect(draft).toEqual(input); expect(saved).toEqual(capture.graph);
  });

  it('host retains the whole earlier aim: source, qualifications, uncertainty, timing and exclusion', () => {
    const saved = graph(), draft = graph();
    const old = saved.nodes.find((n: Rec) => n.id === 'funding_secured');
    expect(old.analysis_participation).toBe('retained_excluded');
    omit(draft, [old.id]); const r = prepare(saved, draft);
    expect(r.missing).toEqual([]); expect(r.candidate!.nodes.find((n: Rec) => n.id === old.id)).toEqual(old);
    expect(r.candidate!.nodes.find((n: Rec) => n.kind === 'goal')).toEqual(saved.nodes.find((n: Rec) => n.kind === 'goal'));
  });

  it('a whole typed source and a causal relationship survive even when the draft omits their quantity', () => {
    const saved = graph(), draft = graph();
    const n = saved.nodes.find((x: Rec) => x.id === 'larger_fund_secured');
    n.description = 'Priya disputes this assumption. Only if the evidence supports it; the range remains uncertain.';
    n.user_statements = structuredClone(saved.nodes.find((x: Rec) => x.id === 'founder_time_on_poc_testing_and_improvement').user_statements);
    const edge = saved.edges.find((e: Rec) => e.to === n.id)!;
    edge.provenance = { ...edge.provenance, source: 'user_specified' };
    edge.user_statements = structuredClone(n.user_statements);
    omit(draft, [n.id]); const r = prepare(saved, draft);
    expect(r.missing).toEqual([]); expect(r.candidate!.nodes.find((x: Rec) => x.id === n.id)).toEqual(n);
    expect(r.candidate!.edges.find((e: Rec) => e.from === edge.from && e.to === edge.to)).toEqual(edge);
  });

  it('Olumi origin and exclusion without a positive adoption record remain unknown and are carried', () => {
    const saved = graph(), draft = graph();
    const ids = saved.nodes.filter((n: Rec) => n.proposed_by === 'olumi' && n.kind === 'risk' && n.analysis_participation === 'retained_excluded').map((n: Rec) => n.id);
    expect(ids).toHaveLength(3); omit(draft, ids);
    const r = prepare(saved, draft); expect(r.missing).toEqual([]);
    for (const id of ids) expect(r.candidate!.nodes.find((n: Rec) => n.id === id)).toEqual(saved.nodes.find((n: Rec) => n.id === id));
    expect(r.retired).toEqual([]);
    for (const id of ids) expect(r.adoption_unknown.some(x => x.includes(saved.nodes.find((n: Rec) => n.id === id).label))).toBe(true);
  });

  it('an Olumi suggestion with recorded human reasoning is carried, never treated as unadopted', () => {
    const saved = graph(), draft = graph(), id = 'investor_outreach_pipeline_stalls';
    const n = saved.nodes.find((x: Rec) => x.id === id);
    n.user_statements = structuredClone(saved.nodes.find((x: Rec) => x.id === 'founder_time_on_poc_testing_and_improvement').user_statements);
    n.description = 'A colleague disagrees, conditional on the full evidence; retain the uncertainty.';
    omit(draft, [id]); const r = prepare(saved, draft);
    expect(r.missing).toEqual([]); expect(r.candidate!.nodes.find((x: Rec) => x.id === id)).toEqual(n);
    expect(r.retired).not.toContain(n.label);
  });

  it('an absent 15% setting has unknown adoption: carry it unchanged and disclose that uncertainty', () => {
    const saved = graph(), draft = graph(), id = 'founder_time_on_job_specifications';
    omit(draft, [id]);
    for (const n of draft.nodes) if (n.interventions) delete n.interventions[id];
    const r = prepare(saved, draft);
    expect(r.missing).toEqual([]);
    for (const option of saved.nodes.filter((n: Rec) => n.interventions?.[id])) {
      expect(r.candidate!.nodes.find((n: Rec) => n.id === option.id)!.interventions[id]).toEqual(option.interventions[id]);
    }
    for (const edge of saved.edges.filter((e: Rec) => e.from === id || e.to === id)) {
      expect(r.candidate!.edges.find((e: Rec) => e.from === edge.from && e.to === edge.to)).toEqual(edge);
    }
    expect(r.adoption_unknown.some(x => x.includes('Founder time on job specifications'))).toBe(true);
    expect(r.retired).toEqual([]);
  });

  it('a conflicting identity cannot be overwritten by host carry', () => {
    const saved = graph(), draft = graph(), baseline = draft.nodes.find((n: Rec) => n.id === 'current_split_reference');
    baseline.kind = 'factor'; baseline.label = 'Another quantity';
    expect(prepare(saved, draft).candidate).toBeUndefined();
  });

  it('a carried quantity never silently changes the scale used by the drafted relationships', () => {
    const saved = graph(), draft = graph();
    draft.nodes.find((n: Rec) => n.id === 'larger_fund_secured').scale_frame *= 2;
    expect(prepare(saved, draft).candidate).toBeUndefined();
  });

  it('stable identity carry never overwrites a different new part using the saved id', () => {
    const saved = graph(), draft = graph();
    const n = draft.nodes.find((x: Rec) => x.id === 'current_split_reference');
    n.id = 'a_new_draft_id';
    draft.nodes.push({ id: 'current_split_reference', kind: 'factor', label: 'A different new part' });
    expect(prepare(saved, draft).candidate).toBeUndefined();
  });

  it('a link statement stored on its source node keeps the causal belief and its whole source', () => {
    const saved = graph(), draft = graph();
    const from = 'founder_time_on_poc_testing_and_improvement', to = 'poc_quality';
    const edge = saved.edges.find((e: Rec) => e.from === from && e.to === to)!;
    draft.edges = draft.edges.filter((e: Rec) => e.from !== from || e.to !== to);
    const r = prepare(saved, draft); expect(r.missing).toEqual([]);
    expect(r.candidate!.edges.find((e: Rec) => e.from === from && e.to === to)).toEqual(edge);
    expect(r.candidate!.nodes.find((n: Rec) => n.id === from)!.user_statements).toEqual(saved.nodes.find((n: Rec) => n.id === from).user_statements);
  });

  it('the existing refusal reader shows the audience-safe cause once, without raw tool detail', () => {
    const follow_up = 'Your saved model is unchanged. This replacement could not keep the saved source. Olumi needs a candidate that keeps it.';
    const r = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [{ ok: false, mutated: false,
      refusal: 'replacement_work_not_held', detail: 'INTERNAL_CODE: do not ask the user to repeat the retained facts.', follow_up }]);
    expect(r.status).toBe(follow_up); expect(r.status).not.toContain('INTERNAL_CODE');
    expect(r.status).not.toContain('model was not built');
  });

  it('a recorded human zero is never replaced by the draft’s old 15% estimate', () => {
    const saved = graph(), draft = graph(), id = 'founder_time_on_job_specifications';
    const option = saved.nodes.find((n: Rec) => n.id === 'angel_first_split');
    option.interventions[id] = { ...option.interventions[id], value: 0, raw_value: 0, source: 'user_specified',
      range: { low: 0, high: 5, meaning: 'likely_range', source: 'user_specified' } };
    const r = prepare(saved, draft); expect(r.missing).toEqual([]);
    expect(r.candidate!.nodes.find((n: Rec) => n.id === option.id)!.interventions[id]).toEqual(option.interventions[id]);
  });

  it('the user’s figure and an accepted Olumi estimate keep their exact quantities, uncertainty and different authors', () => {
    const saved = graph(), draft = graph(), unit = '% of founder working time';
    const human = saved.nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement');
    const ai = saved.nodes.find((n: Rec) => n.id === 'founder_time_on_angel_outreach');
    human.observed_state = { value: 0.8, raw_value: 80, cap: 100, unit, source: 'user_override' };
    ai.observed_state = { value: 0.2, raw_value: 20, cap: 100, unit, source: 'user_assumption',
      reviewed_by_user: { intent: 'confirm', at: '2026-10-17T00:00:00.000Z' } };
    for (const id of [human.id, ai.id]) draft.nodes.find((n: Rec) => n.id === id).observed_state = { value: 0.1, raw_value: 10, cap: 100, unit, source: 'user_override' };
    const r = prepare(saved, draft); expect(r.missing).toEqual([]);
    const keptHuman = r.candidate!.nodes.find((n: Rec) => n.id === human.id)!, keptAi = r.candidate!.nodes.find((n: Rec) => n.id === ai.id)!;
    expect(keptHuman).toBeDefined(); expect(keptAi).toBeDefined();
    expect(keptHuman.observed_state).toEqual(human.observed_state); expect(keptAi.observed_state).toEqual(ai.observed_state);
    expect(provenanceOf({ value: keptHuman.observed_state }).origin).toBe('human');
    expect(provenanceOf({ value: keptAi.observed_state })).toMatchObject({ origin: 'ai', accepted: true });
  });
});

describe('retirement reads a real unpressed adoption carrier', () => {
  const subject = { scenario_id: 'rebuild-native', user_id: null, graph_hash: 'rebuild-native-base' };
  const setup = () => {
    const saved = graph(), draft = graph();
    const node = { id: 'pending_empty_option', kind: 'option', label: 'Unpressed Olumi option', proposed_by: 'olumi', analysis_participation: 'retained_excluded', interventions: {} };
    saved.nodes.push(node);
    const p = createProposal({ scenario_id: subject.scenario_id, user_id: subject.user_id, base_graph_identity_hash: subject.graph_hash,
      operations: [{ op: 'adopt_olumi_option', path: node.id, value: { label: node.label, expected_interventions: {} } }],
      provenance: { authored_by: 'model_proposed', basis: 'Declared native pending offer' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Include the Olumi option' });
    const carrier = proposalPendingAction(p, { id: 'agent-approve-proposal:' + p.proposal_id, label: 'Include option', message: 'Include this option.' },
      { scenario_id: subject.scenario_id, emitted_at_iso: new Date().toISOString() });
    return { saved, draft, node, carrier };
  };
  it('a matching, unexpired, integrity-checked pending offer permits only its empty unadopted option to be left out', () => {
    const w = setup(), evidence = unpressedRebuildOptions([w.carrier], { ...subject, graph: w.saved });
    expect(evidence.ids).toEqual([w.node.id]);
    const r = prepare(w.saved, w.draft, evidence.ids);
    expect(r.missing).toEqual([]); expect(r.retired).toEqual([w.node.label]);
    expect(r.candidate!.nodes.some((n: Rec) => n.id === w.node.id)).toBe(false);
  });
  it.each(['no record', 'wrong scenario', 'stale base', 'expired', 'tampered', 'already adopted', 'has values', 'human reference', 'legacy carrier', 'description', 'human rename', 'observed value'])(
    '%s cannot turn missing adoption into retirement permission', fault => {
      const w = setup();
      const carrier: Rec = structuredClone(w.carrier);
      if (fault === 'wrong scenario') carrier.scenario_id = 'another-scenario';
      if (fault === 'stale base') carrier.preconditions.graph_hash = 'another-revision';
      if (fault === 'expired') carrier.expires_at_iso = '2000-01-01T00:00:00Z';
      if (fault === 'tampered') carrier.action.inline_patch.agent_proposal.public_label += ' changed';
      if (fault === 'already adopted') w.node.analysis_participation = 'included';
      if (fault === 'has values') (w.node.interventions as Rec).founder_time_on_job_specifications = { value: 0.15, raw_value: 15, unit: '% of founder working time', source: 'cee_hypothesis' };
      if (fault === 'human reference') {
        const holder = w.saved.nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement');
        const record = structuredClone(holder.user_statements[0]);
        record.subject_key = subjectKey({ kind: 'factor', id: holder.id, option_id: w.node.id, field: 'level' });
        holder.user_statements.push(record);
      }
      if (fault === 'legacy carrier') w.saved.options = [structuredClone(w.node)];
      if (fault === 'description') (w.node as Rec).description = 'A colleague disputes this; preserve the conditions and evidence.';
      if (fault === 'human rename') (w.node as Rec).provenance = 'user_set';
      if (fault === 'observed value') (w.node as Rec).observed_state = { value: 0.4, source: 'user_override' };
      expect(unpressedRebuildOptions(fault === 'no record' ? [] : [carrier], { ...subject, graph: w.saved }).ids).toEqual([]);
    });
});
