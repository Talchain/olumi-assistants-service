/**
 * ⭐ THE FIRST DRAFT IS TOLD THE BUDGET THE GATE COUNTS — the truth-safe lever for first-draft size failures.
 *
 * AIQ ruling #70 5858990481 item 5 (MG order item 3, DL 5859393087): state the link budget in the build prompt so the
 * first draft fits; do NOT raise the ceiling. Served: MG sweep on 4bdf7b2, midmarket-2 got no model at birth at
 * 32 links (limit 30); AIC 5856309275, `model_too_large` 4/20.
 *
 * The budget WAS already stated (`Stay within 18 nodes and 30 links in total`), but its counting rule named only
 * "one link from the decision to each option". The gate (`assessConstructionSize`) counts the ADMITTED graph, where
 * admission also writes one structural link from each option to each factor it acts on (`interventions` / `changes`)
 * and connects the held status quo to each factor the other options act on (`admit-model.ts`, `topologyEdges` and
 * `heldStatusQuoEdges`). Measured on the draft below: the stated rule counts 23, the gate counts 33 — a drafter that
 * obeys the prompt's own arithmetic lands ten links over. So the prompt now names every link the gate counts.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BUILD_INSTRUCTIONS, prepareProvisionalCandidate } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { COMPACT_LIMITS, assessConstructionSize } from '../construction-size-gate.js';

const GOAL = 'Delivery velocity';
const factor = (label: string, baseline_value: number, plausible_max: number, unit: string) => ({
  label, role: 'controllable', baseline_known: false, baseline_value, unit, provenance: 'ai_proposed', plausible_max,
});
const est = (factor_label: string, value: number, unit: string) => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' });
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const PLACEHOLDER = Array.from({ length: 5 }, (_, i) => `Placeholder factor ${i}`);

/** A served-shape draft: two user options, Olumi's option, a declared status quo, levels on every lever, placeholder links. */
function draft() {
  return {
    goal: { metric: GOAL, operator: '>=', target_stated: false, value: null, unit: 'points per sprint', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Hiring cost', operator: '<=', value: 250000, unit: 'GBP', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Hire Two Developers', provenance: 'explicit', is_status_quo: null, brief_words: null, changes: [] as string[], interventions: [est('Engineering delivery capacity', 52, 'story points'), est('Hiring cost', 140000, 'GBP')] },
      { label: 'Hire a Tech Lead', provenance: 'explicit', is_status_quo: null, brief_words: null, changes: [] as string[], interventions: [est('Technical leadership capacity', 1.5, 'FTE'), est('Hiring cost', 110000, 'GBP')] },
      { label: 'Hire Both', provenance: 'ai_proposed', is_status_quo: null, brief_words: null, changes: [] as string[], interventions: [est('Engineering delivery capacity', 55, 'story points'), est('Technical leadership capacity', 1.5, 'FTE'), est('Hiring cost', 250000, 'GBP')] },
      { label: 'Continue Current Staffing', provenance: 'ai_proposed', is_status_quo: true, brief_words: null, changes: [] as string[], interventions: [] as ReturnType<typeof est>[] },
    ],
    factors: [
      factor('Engineering delivery capacity', 40, 100, 'story points'),
      factor('Technical leadership capacity', 0.5, 5, 'FTE'),
      factor('Hiring cost', 0, 500000, 'GBP'),
      factor('Team morale', 6, 10, 'score'),
      factor('Onboarding load', 1, 10, 'score'),
      ...PLACEHOLDER.map((l) => factor(l, 5, 10, 'score')),
    ],
    risks: [], outcomes: [],
    links: [
      link('Engineering delivery capacity', GOAL), link('Technical leadership capacity', GOAL), link('Team morale', GOAL), link('Onboarding load', GOAL),
      ...PLACEHOLDER.map((l) => link(l, GOAL)),
      ...PLACEHOLDER.flatMap((l) => [link(l, 'Team morale'), link(l, 'Onboarding load')]),
    ],
    identities: [], unknowns: [],
  };
}

/** The counting rule as the prompt states it. Each clause is quoted in the prompt; the test fails if any one is cut. */
const COUNTING_RULE = 'counting one link from the decision to each option, one from each option to each factor it acts on '
  + '(for the option that keeps things as they are, each factor the other options act on) and each entry in `links`.';

describe('the first draft is told the budget the size gate counts (AIQ 5858990481 item 5)', () => {
  it('the build prompt states the budget, and it equals the gate\'s ceiling constants', () => {
    const stated = /Stay within (\d+) nodes and (\d+) links in total/.exec(BUILD_INSTRUCTIONS);
    expect(stated, 'the budget sentence').not.toBeNull();
    expect({ maxNodes: Number(stated![1]), maxEdges: Number(stated![2]) }).toEqual(COMPACT_LIMITS);
  });

  it('the budget is DERIVED from the gate\'s constants, never a second literal (a literal that happens to equal 30 is RED here)', () => {
    const src = readFileSync(new URL('../runtime/build-model.ts', import.meta.url), 'utf8');
    expect(src).toContain('`Stay within ${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links in total, ');
  });

  it('RED: the prompt names every link the gate counts — the decision\'s, each option\'s to what it acts on (and the status quo\'s), and `links`', () => {
    expect(BUILD_INSTRUCTIONS).toContain(`Stay within ${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links in total, ${COUNTING_RULE}`);
  });

  it('the stated counting rule reproduces the gate\'s count on a served-shape draft; the old rule (decision links + `links`) undercounted by ten', () => {
    const d = draft();
    const admitted = admitCandidateModel(prepareProvisionalCandidate(d as unknown as CandidateModel).candidate, {});
    const gate = assessConstructionSize(admitted).edges;
    const actsOn = (o: (typeof d.options)[number]) => new Set([...o.changes, ...o.interventions.map((i) => i.factor_label)]);
    const levers = d.options.filter((o) => o.is_status_quo !== true);
    const statusQuo = new Set(levers.flatMap((o) => [...actsOn(o)]));
    const stated = d.options.length + levers.reduce((n, o) => n + actsOn(o).size, 0) + statusQuo.size + d.links.length;
    expect(gate).toBe(33);
    expect(stated, 'the prompt\'s own arithmetic is the gate\'s').toBe(gate);
    expect(d.options.length + d.links.length, 'the rule before this change').toBe(23);
    expect(gate).toBeGreaterThan(COMPACT_LIMITS.maxEdges);
  });
});
