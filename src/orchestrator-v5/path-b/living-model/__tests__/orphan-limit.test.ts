import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LivingModel } from '../../../../schemas/living-model.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { RETAINED_LIMIT_QUANTITY_QUESTION, unresolvedRetainedLimits, withholdRetainedLimitFrames } from '../../../../graph/retained-limit.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { mapLivingModel } from '../mapper.js';

type Rec = Record<string, any>;
const hiring = () => LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/hiring-6ecad928-r2-living-model.json', import.meta.url), 'utf8')));
const costRow = (graph: Rec) => graph.goal_constraints.find((c: Rec) => c.node_id === 'cost');

describe('a retained limit without a supported forecast never refuses the rest of the Run', () => {
  it('the actual hiring r2 regression keeps the £200k limit, unscored, and restores readiness without inventing cost links', () => {
    const model = hiring(), before = structuredClone(model);
    const mapped = mapLivingModel(model);
    const saved = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model })) as Rec;
    const row = costRow(saved);
    expect(row).toMatchObject({ constraint_id: 'limit_cost', value: 200000, operator: '<=', value_frame: 'level',
      retained_unresolved_limit: { state: 'unscored', reason: 'retained_limit_quantity_unresolved', role: 'original',
        previous_constraint_id: 'limit_cost', proposed_constraint_ids: [], question: RETAINED_LIMIT_QUANTITY_QUESTION } });
    expect(saved.nodes.find((n: Rec) => n.id === 'cost').observed_state).toMatchObject({ raw_value: 0, source: 'cee_inference' });
    expect(saved.edges.some((e: Rec) => e.from === 'cost' || e.to === 'cost')).toBe(false);
    expect(mapped.withheld).toContainEqual({ id: 'cost', reason: 'limit_not_in_slice' });
    expect(assessCanonicalAnalysisReadiness(saved).status).toBe('ready');
    expect(unresolvedRetainedLimits(saved).map(c => c.constraint_id)).toEqual(['limit_cost']);
    // The stored frame is kept; the existing Run projection removes only the scoring frame, so no budget/joint pass is fabricated.
    const wire = withholdRetainedLimitFrames(saved, saved.goal_constraints);
    expect(costRow({ goal_constraints: wire })).not.toHaveProperty('value_frame');
    expect(costRow(saved).value_frame).toBe('level');
    expect(model).toEqual(before);
  });

  it('a supported connection or a direct option setting keeps the limit evaluable', () => {
    for (const connection of ['link', 'setting']) {
      const model = hiring();
      if (connection === 'link') {
        const link = model.links.find(l => l.id === 'lead_cost')!;
        Object.assign(link.effect, { sign: '+', form: 'normal', value: 10000, sd: 2000 });
      } else {
        model.options[0]!.settings.push({ factor_id: 'cost', value: 50000, low: null, high: null, unit: '£',
          source: 'olumi', estimate_by: null, party: null, quote: null });
      }
      const mapped = mapLivingModel(model);
      expect(costRow(mapped.graph)).not.toHaveProperty('retained_unresolved_limit');
      expect(costRow(mapped.graph).value_frame).toBe('level');
      expect(mapped.withheld).not.toContainEqual({ id: 'cost', reason: 'limit_not_in_slice' });
    }
  });
});
