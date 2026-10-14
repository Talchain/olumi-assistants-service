/**
 * ⭐ T4i P1 (DL 14 Oct; PL #94 6135017311): A RISK OLUMI ADDED, THAT THE USER HAS NOT ADOPTED AND THAT HAS NO LEVEL, IS AN
 * OPTIONAL PROPOSAL OUTSIDE THE OPERATIVE MODEL. It leaves the Run's sent graph, never disables the Run, and reaches the
 * Agent as a fact to say. An unstamped (unknown-origin) root keeps T4: withhold, and ask. An adopted one needs its level.
 *
 * Served hiring-post3007 turn 01 (CEE 35a66525; `tests/fixtures/t4i/…`, `_source`): the drafter's "Code quality
 * deterioration" (tagged only `ai_inferred`, a display tag) had no level, so the whole Run was withheld with
 * "How likely or how large is …". Each row changes ONE field on that served graph: the positive stamp
 * `proposed_by: 'olumi'` (written by the drafter once PROMPT's stamp lands; until then nothing carries it, so no Run moves),
 * then adoption (`analysis_participation: 'included'`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { readinessViewOf } from '../readiness-view.js';
import { isOptionalOlumiRisk } from '../../../graph/optional-olumi-risk.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/t4i/served-hiring-post3007-turn01-20261014.json', 'utf8')) as { graph: Rec; analysis_ready: Rec };
const RISK = 'code_quality_deterioration';
const LABEL = 'Code quality deterioration';
const ASK = 'How likely or how large is "Code quality deterioration" today? The numerical analysis is withheld until this risk has a '
  + 'supported value. You can also ask Olumi to propose a labelled starting assumption for review.';
const withRisk = (fields: Rec): Rec => ({ ...FX.graph, nodes: (FX.graph.nodes as Rec[]).map((n) => n.id === RISK ? { ...n, ...fields } : n) });
const STAMPED = withRisk({ proposed_by: 'olumi' });
const ADOPTED = withRisk({ proposed_by: 'olumi', analysis_participation: 'included' });
const ready = (graph: Rec): Rec => buildCanonicalAnalysisReadyFromGraph(graph) as Rec;
const levelAsks = (r: Rec): Rec[] => ((r.readiness_issues ?? []) as Rec[]).filter((i) => i.code === 'MISSING_FACTOR_LEVEL');
const guard = (graph: Rec) => guardAnalysisParticipation(graph, { goalNodeId: 'productivity' });

describe('T4i P1: an unadopted, unvalued Olumi risk is an optional proposal, never an operative root or a new obligation', () => {
  it('precondition (served): the drafter\'s risk had no level and no stamp, and the whole Run was withheld with the ask', () => {
    const risk = (FX.graph.nodes as Rec[]).find((n) => n.id === RISK)!;
    expect(risk).toMatchObject({ kind: 'risk', label: LABEL, provenance: 'ai_inferred' });
    expect(risk).not.toHaveProperty('proposed_by');
    expect(risk).not.toHaveProperty('observed_state');
    expect(FX.analysis_ready).toMatchObject({ status: 'needs_user_input', may_run: false });
    expect((FX.analysis_ready.readiness_issues as Rec[]).map((i) => [i.code, i.factor_id, i.message])).toEqual([['MISSING_FACTOR_LEVEL', RISK, ASK]]);
  });

  it('UNSTAMPED (unknown origin, as served): held as today, withhold and ask; nothing leaves the Run', () => {
    const r = ready(FX.graph);
    expect(r.may_run).toBe(false);
    expect(levelAsks(r).map((i) => [i.factor_id, i.message])).toEqual([[RISK, ASK]]);
    expect(r).not.toHaveProperty('excluded_optional_risks');
    expect(readinessViewOf(FX.graph)).not.toHaveProperty('olumi_suggestions_left_out_until_added');
    expect(guard(FX.graph)).toMatchObject({ excludedNodeIds: [], prunedEdgeCount: 0, refusals: [] });
  });

  it('STAMPED Olumi\'s: the Run is available, the risk and its one link leave the sent graph, and the Agent holds the fact', () => {
    expect(isOptionalOlumiRisk((STAMPED.nodes as Rec[]).find((n) => n.id === RISK))).toBe(true);
    const r = ready(STAMPED);
    expect(r.may_run).toBe(true);
    expect(levelAsks(r)).toEqual([]);
    expect(r.excluded_optional_risks).toEqual([{ node_id: RISK, label: LABEL }]);
    const view = readinessViewOf(STAMPED);
    expect(view).toMatchObject({ checked: true, may_run: true, olumi_suggestions_left_out_until_added: [LABEL] });
    expect(JSON.stringify(view.needs_from_user)).not.toContain(LABEL);
    const sent = guard(STAMPED);
    expect(sent).toMatchObject({ excludedNodeIds: [RISK], prunedEdgeCount: 1, refusals: [] });
    expect(JSON.stringify(sent.graph)).not.toContain(RISK);
    // The stored model keeps it, with its words and its link: it is offered, not deleted.
    expect((STAMPED.nodes as Rec[]).some((n) => n.id === RISK)).toBe(true);
  });

  it('ADOPTED: it rejoins the operative model and needs its level (withhold, and ask), never zero', () => {
    const r = ready(ADOPTED);
    expect(r.may_run).toBe(false);
    expect(levelAsks(r).map((i) => [i.factor_id, i.message])).toEqual([[RISK, ASK]]);
    expect(r).not.toHaveProperty('excluded_optional_risks');
    expect(guard(ADOPTED)).toMatchObject({ excludedNodeIds: [], refusals: [] });
  });

  it('CONTRAST: a stamped risk that holds a level stays operative (only an unvalued suggestion is left out)', () => {
    const valued = withRisk({ proposed_by: 'olumi', observed_state: { value: 0.3, source: 'cee_inference' } });
    expect(isOptionalOlumiRisk((valued.nodes as Rec[]).find((n) => n.id === RISK))).toBe(false);
    expect(ready(valued)).not.toHaveProperty('excluded_optional_risks');
    expect(guard(valued)).toMatchObject({ excludedNodeIds: [] });
  });

  it('CONTRAST: a stamped risk the Run NEEDS (a lever\'s target) is kept, never a refusal, and owes its level (T4)', () => {
    const sent = guardAnalysisParticipation(STAMPED, { goalNodeId: 'productivity', optionInterventionTargetIds: [RISK] });
    expect(sent).toMatchObject({ excludedNodeIds: [], refusals: [] });
  });
});
