/**
 * ⭐ Reply-face P2 (DL-adopted design): each cause is said ONCE on the result card. Served marketing (Paul, CEE 7f5659fd,
 * cold reopen): the card's summary said the retained-limit withhold, and the card's notes said it again once PER retained
 * limit (×3), because the two retained limits were recorded under their different engine codes and so never grouped.
 * Two briefs (TWO-BRIEF RULE): marketing (the failure) and Paul's hiring read (one limit; nothing to merge, nothing lost).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';
import { deriveAnalysisFreshness } from '../../orchestrator-v5/context/freshness.js';
import { goalChanceFactsForAgent } from '../../orchestrator-v5/goal-target/goal-chance-range-agent.js';
import { goalTargetsBlockOf, notesAsShown } from '../../orchestrator-v5/goal-target/goal-targets-joint.js';
import { RETAINED_LIMIT_WITHHELD } from '../../graph/retained-limit.js';

type Json = Record<string, any>;
const read = (p: string): Json => { const j = JSON.parse(readFileSync(p, 'utf8')); return j.body ?? j; };
const MARKETING = read('tests/fixtures/reply-face-p2/marketing-7f5659fd-reopen.json');
const HIRING = read('tests/fixtures/batch-g/served-hiring-read-19-after-reopen-20261013T131858Z.json');

const factOf = (saved: Json) => RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: saved.scenario_id, summary: saved.analysis_result.summary, leading_option_id: saved.analysis_result.leading_option_id ?? null,
    enrichment: saved.analysis_result.enrichment, graph_hash_at_run: saved.current_read.computed_against_hash,
    computed_at: saved.analysis_state.run_state.computed_at, run_id: saved.current_read.run_id, goal_certainty: saved.analysis_goal_certainty } });
async function project(saved: Json): Promise<Json> {
  const { projectCanonicalAnalysisView } = await import('../canonical-analysis-view.js');
  const run = factOf(saved);
  return projectCanonicalAnalysisView({ graph: saved.graph, revision: 1, runFact: run, analysisState: saved.analysis_state,
    analysisReady: saved.current_read.analysis_ready, derivation: deriveAnalysisFreshness([run], run.result.graph_hash_at_run!),
    currentResult: buildAnalysisResultBlock(run) } as never) as unknown as Json;
}
const count = (lines: readonly string[], sentence: string): number => lines.filter((l) => l.includes(sentence)).length;

describe('reply-face P2: the result card says each cause once', () => {
  it('RED (served marketing): the summary says the retained-limit withhold; no note repeats it; the estimate limits are one line', async () => {
    // PRECONDITION: the served card (pre-fix) said it three times: the summary plus one note per retained limit.
    expect(MARKETING.analysis_result.summary).toContain(RETAINED_LIMIT_WITHHELD.slice(0, 60));
    expect(count(MARKETING.canonical_analysis_view.goal_chance.notes, RETAINED_LIMIT_WITHHELD.slice(0, 60))).toBe(2);
    const notes: string[] = (await project(MARKETING)).goal_chance.notes;
    expect(count(notes, RETAINED_LIMIT_WITHHELD.slice(0, 60))).toBe(0);
    expect(new Set(notes).size).toBe(notes.length);
    expect(notes.filter((n) => n.includes('The calculation still rests on Olumi’s estimated quantities'))).toEqual([
      '‘Annual marketing spend’ is at most £100,000 / year and ‘Founder marketing time’ is at most 25%: The calculation still rests on Olumi’s estimated quantities. Review their basis and uncertainty; the limit or target itself is not a forecast.']);
    // Every other cause is still said once (the launch-window target and the unsized links).
    expect(count(notes, 'Conversion rate is measured over the first three months after launch')).toBe(1);
    expect(count(notes, 'The contributing quantities have links whose sizes are not yet specified')).toBe(1);
  });

  it('the producer records both retained limits under ONE cause: one group line naming both (what the reply\'s screen lines say)', () => {
    const g = MARKETING.graph;
    const block = goalTargetsBlockOf({ envelope: MARKETING.analysis_result.enrichment, graph: g, storedConstraints: g.goal_constraints,
      sentConstraints: g.goal_constraints, optionIds: g.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => n.id),
      perLimit: MARKETING.analysis_limit_verdicts?.per_limit ?? MARKETING.analysis_limit_verdicts });
    const retained = (block?.note_groups ?? []).filter((x) => x.line.includes(RETAINED_LIMIT_WITHHELD.slice(0, 60)));
    expect(retained).toHaveLength(1);
    expect(retained[0]!.source_notes).toHaveLength(2);
    expect(retained[0]!.line).toMatch(/^‘Annual campaign marketing spend’ is at most £100,000 \/ year and ‘Your time on the campaign’ is at most 25%: /);
  });

  it('PROPERTY across Paul\'s four served journeys (marketing, pricing, legacy, hiring; cold-reopen reads): no card note is said twice, '
    + 'and none repeats the card\'s own summary', async () => {
    const briefs: [string, Json][] = [['marketing', MARKETING], ['pricing', read('tests/fixtures/reply-face-p2/pricing-e7f95dc6-reopen.json')],
      ['legacy', read('tests/fixtures/reply-face-p2/legacy-7f5659fd-reopen.json')], ['hiring', HIRING]];
    let withNotes = 0;
    for (const [name, saved] of briefs) {
      const view = await project(saved);
      const notes: string[] = view.goal_chance?.notes ?? [];
      if (notes.length > 0) withNotes += 1;
      expect(new Set(notes).size, name).toBe(notes.length);
      const summary = String(saved.analysis_result?.summary ?? '');
      expect(notes.filter((n) => summary !== '' && (n === summary || n.endsWith(`: ${summary}`))), name).toEqual([]);
      // Nothing else on the card is lost: every licence note is said, itself or inside its one group line.
      const facts = goalChanceFactsForAgent(buildAnalysisResultBlock(factOf(saved)), saved.graph, true);
      for (const note of facts.goal_chance_notes ?? []) {
        if (summary !== '' && note.endsWith(`: ${summary}`)) continue;
        const reason = note.slice(note.indexOf(': ') + 2);
        expect(notes.some((n) => n === note || n.endsWith(`: ${reason}`)), `${name}: ${note}`).toBe(true);
      }
    }
    // Only a goal with several targets has card notes today; the property is not vacuous across the four.
    expect(withNotes).toBeGreaterThanOrEqual(1);
  });

  it('notesAsShown: a group is said once in place of its notes; a reason the surface already says is not said again', () => {
    const groups = [{ source_notes: ['A: r.', 'B: r.'], line: 'A and B: r.' }];
    expect(notesAsShown(['A: r.', 'B: r.', 'C: s.'], groups)).toEqual(['A and B: r.', 'C: s.']);
    expect(notesAsShown(['A: r.', 'B: r.', 'C: s.'], groups, ['r.'])).toEqual(['C: s.']);
    expect(notesAsShown(['C: s.'], undefined, ['t.'])).toEqual(['C: s.']);
  });
});
