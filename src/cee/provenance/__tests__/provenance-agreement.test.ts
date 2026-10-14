/**
 * ⭐⭐ ONE PROVENANCE AUTHORITY — THE AGREEMENT PROOF (Recovery Batch C; DL 12 Oct, items 3 and AMEND; AIE 6121121310).
 *
 * For every source variant of a starting value, an option setting and a link, every reader whose answer reaches what the
 * person or the Agent is told, or a decision that licenses, withholds, refuses or labels a result, must give ONE answer:
 * the census count (`goalChanceEstimateCounts`), the Check-estimates panel (F1 `valueAuthorshipOf` → the panel's
 * `olumiEstimatesFeedingResult` → `sayOlumiEstimates`, as `actions/state.ts` assembles it, its option settings included),
 * the receipt owner (`heldFigureOwner`), the compact-context label (`compactGraph`), the decision-review projection's
 * preserving arm, the conditional-input basis, the readiness ladder, and the wire's node label.
 *
 * Each surface says what it CAN say as a set of classes (a surface that does not distinguish two classes admits both).
 * They agree when one class satisfies every surface; after the fix that class must be `provenanceOf`'s. Written to run on
 * 591cc1a0 too (surfaces that did not exist there are skipped and named), where it is RED on the
 * `cee_inference`-without-`extractionType` mismatch (the census counted Olumi's estimate; the panel said nothing).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { goalChanceEstimateCounts } from '../../../orchestrator-v5/agent-lane/goal-chance-estimate-attribution.js';
import { valueAuthorshipOf } from '../../../orchestrator-v5/agent-lane/turn-context/guidance-signals.js';
import { olumiEstimatesFeedingResult, sayOlumiEstimates } from '../../../orchestrator-v5/agent-lane/olumi-estimates-feeding-result.js';
import { compactGraph } from '../../../orchestrator/context/graph-compact.js';
import { projectRunGraphForDecisionReview } from '../../../orchestrator-v5/coaching/decision-review-graph-projection.js';
import { conditionalInputBasis } from '../../../orchestrator-v5/agent-lane/conditional-input-basis.js';
import { edgeStrengthProvenance, structureProvenance, structureProvenanceOfEffect } from '../../graph-readiness/obligation-provenance.js';
import { nodeProvenanceDisplay } from '../../transforms/provenance-display.js';
import { linkSizing } from '../../magnitude/link-sizing.js';
import * as capabilities from '../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import * as actionState from '../../../orchestrator-v5/agent-lane/actions/state.js';

type Rec = Record<string, any>;
// `human_stamp_only` (DL 12 Oct, LABEL-ONLY): the person's by its stamp alone (a type-less `brief_extraction`). The gates and
// the wording surfaces read it as the person's, as staging does (nothing newly withheld); the chance's census and F1 disclose
// it as unverified. Each surface below names which of those two it gives.
type Klass = 'human' | 'human_unverified' | 'human_stamp_only' | 'ai' | 'ai_accepted' | 'unknown' | 'structural' | 'placeholder';
const ALL: readonly Klass[] = ['human', 'human_unverified', 'human_stamp_only', 'ai', 'ai_accepted', 'unknown', 'structural', 'placeholder'];

// The authority itself, where it exists (absent on 591cc1a0).
const AUTHORITY = fileURLToPath(new URL('../provenance-of.ts', import.meta.url));
const authority: Rec | undefined = existsSync(AUTHORITY) ? await import(/* @vite-ignore */ AUTHORITY) : undefined;
const skipped = new Set<string>();
const has = (name: string, fn: unknown): boolean => {
  if (typeof fn === 'function') return true;
  skipped.add(name);
  return false;
};

function classOf(p: Rec): Klass {
  if (p.structural) return 'structural';
  if (p.placeholder) return 'placeholder';
  if (p.origin === 'ai') return p.accepted ? 'ai_accepted' : 'ai';
  // Origin human, role unverified (DL 12 Oct; AIE 0825 §2): never Olumi's, never the person's verified figure.
  if (p.origin === 'human' && p.role === 'unverified') return 'human_unverified';
  if (p.origin === 'human' && p.stampOnly === true) return 'human_stamp_only';
  return p.origin as Klass;
}

function agree(surfaces: Record<string, readonly Klass[]>): Klass[] {
  return ALL.filter((k) => Object.values(surfaces).every((set) => set.includes(k)));
}

// ── Starting values ─────────────────────────────────────────────────────────

const VALUE_SOURCES = [undefined, 'brief_extraction', 'cee_inference', 'explicit', 'inferred', 'observed', 'range', 'cee_repair',
  'user', 'user_override', 'user_confirmed', 'user_edited', 'user_calibration', 'user_assumption', 'panel_elicited',
  'user_specified', 'cee_hypothesis', 'domain_knowledge', 'something_else'] as const;
const EXTRACTION_TYPES = [undefined, 'explicit', 'inferred', 'observed', 'range', 'bogus'] as const;

const valueVariants: { name: string; os: Rec }[] = [
  ...VALUE_SOURCES.flatMap((source) => EXTRACTION_TYPES.map((et) => ({
    name: `source=${source ?? '∅'} extractionType=${et ?? '∅'}`,
    os: { value: 0.5, raw_value: 50, unit: '%', ...(source !== undefined ? { source } : {}), ...(et !== undefined ? { extractionType: et } : {}) },
  }))),
  // AIE 0825 §2 / SYS2 §2: a human-written figure whose ROLE is unverified, as the write side stores it today.
  { name: 'human, role unverified (cee_inference + inferred + user_material_unverified)', os: { value: 0.5, raw_value: 50, unit: '%', source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true } },
  { name: 'user_material_unverified (cee_inference)', os: { value: 0.5, raw_value: 50, unit: '%', source: 'cee_inference', user_material_unverified: true } },
  { name: 'user_material_unverified (brief_extraction, explicit)', os: { value: 0.5, raw_value: 50, unit: '%', source: 'brief_extraction', extractionType: 'explicit', user_material_unverified: true } },
  { name: 'accepted Olumi estimate', os: { value: 0.5, raw_value: 50, unit: '%', source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } } },
  { name: 'stated_time team share', os: { value: 0.5, source: 'cee_inference', stated_time: { quantity: 'months_to_finish', value: 6 } } },
  { name: 'event-by-date switch 0', os: { value: 0, source: 'cee_inference', extra_share_by_date: { date: '2027-04-09' } } },
];

function valueGraph(os: Rec): Rec {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Revenue', observed_state: { value: 100, raw_value: 100, unit: '£', source: 'user_edited' } },
      { id: 'f', kind: 'factor', label: 'Price', observed_state: os },
      { id: 'o1', kind: 'option', label: 'Raise price', interventions: {} },
    ],
    edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'user_specified', magnitude: 'user_stated' } }],
  };
}

const fromDisplay = (d: unknown): readonly Klass[] =>
  d === 'user_set' ? ['human'] : d === 'from_brief' ? ['human', 'human_stamp_only'] : d === 'ai_inferred' ? ['ai', 'ai_accepted', 'structural']
    : d === 'unverified_brief' ? ['unknown', 'human_unverified'] : ALL;

function valueSurfaces(os: Rec): Record<string, readonly Klass[]> {
  const graph = valueGraph(os);
  const out: Record<string, readonly Klass[]> = {};
  // The census.
  const c = goalChanceEstimateCounts(graph, ['o1'], 'g') as Rec;
  out.census = c.values === 1 ? ['ai'] : c.acceptedValues === 1 ? ['ai_accepted'] : c.unverifiedValues === 1 ? ['unknown', 'human_unverified', 'human_stamp_only']
    : c.acceptedValues === undefined ? ['human', 'structural', 'ai_accepted'] : ['human', 'structural'];
  // The Check-estimates panel: its data (F1) and its line.
  const f1 = valueAuthorshipOf(os);
  out.panelData = f1 === 'yours' ? ['human'] : f1 === 'olumi_estimate' ? ['ai'] : f1 === 'olumi_accepted' ? ['ai_accepted']
    : ['unknown', 'structural', 'human_unverified', 'human_stamp_only'];
  const lines = sayOlumiEstimates(olumiEstimatesFeedingResult({
    goalPathFactors: [{ factor_id: 'f', label: 'Price', value_authorship: f1, goal_distance: 1, value_hash: '' }], goalPathLinks: [],
  })).join(' ');
  out.panelLine = /Olumi supplied 1 /.test(lines) ? ['ai'] : /1 you accepted/.test(lines) ? ['ai_accepted']
    : ['human', 'human_unverified', 'human_stamp_only', 'unknown', 'structural'];
  // The receipt owner.
  if (has('receipt (heldFigureOwner)', (capabilities as Rec).heldFigureOwner)) {
    const owner = (capabilities as Rec).heldFigureOwner(graph.nodes[1]);
    out.receipt = owner === 'yours' ? ['human'] : owner === 'brief' ? ['human', 'human_stamp_only'] : owner === 'olumi' ? ['ai', 'structural']
      : owner === 'olumi_accepted' ? ['ai_accepted'] : owner === 'unverified_brief' ? ['unknown', 'human_unverified'] : ALL;
  }
  // The compact-context label.
  const compact = compactGraph(graph as never).nodes.find((n: Rec) => n.id === 'f') as Rec;
  out.compact = fromDisplay(compact.provenance);
  // The decision-review projection's preserving arm (a run graph the strict schema refuses).
  const review = projectRunGraphForDecisionReview({}, { ...graph, edges: [{ from: 'f', to: 'g', strength: 'unreadable' }] }) as Rec;
  const reviewed = (review.graph?.nodes ?? []).find((n: Rec) => n.id === 'f');
  out.decisionReview = fromDisplay(reviewed?.provenance);
  // The conditional-input basis (the factor's value awaits the person; the option leaves it).
  const basis = conditionalInputBasis({ graph, analysedOptionIds: ['o1'],
    admission: { semantic_signals: { material_parameters_awaiting_user_node_ids: ['f'] } } });
  out.conditionalBasis = basis === null ? ['human', 'human_stamp_only', 'structural'] : /Olumi’s estimates for "Price"/.test(basis) ? ['ai', 'ai_accepted']
    : /"Price": Not confirmed from your brief/.test(basis) ? ['human_unverified'] : /"Price": source unrecorded/.test(basis) ? ['unknown'] : ALL;
  // The readiness ladder.
  const ladder = structureProvenance(graph.nodes[1]);
  out.ladder = ladder === 'user_stated' || ladder === 'user_ratified' ? ['human', 'human_stamp_only', 'ai_accepted']
    : ladder === 'ai_drafted' || ladder === 'system_repaired' ? ['ai', 'structural'] : ['unknown', 'human_unverified'];
  // The wire's node label (`transformNodeToV3`'s call).
  out.wireLabel = fromDisplay(nodeProvenanceDisplay(os.extractionType, os));
  return out;
}

describe('ONE PROVENANCE AUTHORITY — every reader of a starting value agrees', () => {
  it.each(valueVariants)('$name', ({ os }) => {
    const surfaces = valueSurfaces(os);
    const agreed = agree(surfaces);
    expect({ surfaces, agreed }).toEqual(expect.objectContaining({ agreed: expect.arrayContaining([expect.any(String)]) }));
    if (authority !== undefined) expect(agreed).toContain(classOf(authority.provenanceOf({ value: os })));
  });

  it('a human-written figure with an unverified role is never Olumi\'s (AIE 0825 §2)', () => {
    if (authority === undefined) { skipped.add('provenanceOf'); return; }
    for (const extra of [{}, { extractionType: 'inferred' }]) {
      const p = authority.provenanceOf({ value: { value: 0.5, source: 'cee_inference', user_material_unverified: true, ...extra } });
      expect({ origin: p.origin, role: p.role }).toEqual({ origin: 'human', role: 'unverified' });
      expect(authority.isUnverifiedProvenance(p)).toBe(true);
    }
  });
});

// ── Option settings ─────────────────────────────────────────────────────────

const SETTING_SOURCES = [undefined, 'brief_extraction', 'user_specified', 'cee_hypothesis', 'domain_knowledge', 'cee_inference',
  'user', 'explicit', 'something_else'] as const;
const settingVariants: { name: string; cell: unknown; marker: boolean }[] = [
  ...SETTING_SOURCES.flatMap((source) => [false, true].map((estimate) => ({
    name: `source=${source ?? '∅'}${estimate ? ' estimate:true' : ''}`,
    cell: { value: 0.7, ...(source !== undefined ? { source } : {}), ...(estimate ? { estimate: true } : {}) }, marker: false,
  }))),
  { name: 'event-by-date switch cell 1', cell: { value: 1 }, marker: true },
  { name: 'event-by-date switch cell 0', cell: { value: 0 }, marker: true },
  { name: 'bare number cell', cell: 0.7, marker: false },
];

function settingGraph(cell: unknown, marker: boolean): Rec {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Revenue', observed_state: { value: 100, raw_value: 100, unit: '£', source: 'user_edited' } },
      { id: 'f', kind: 'factor', label: 'Price', observed_state: { value: 0.5, source: 'user_edited',
        ...(marker ? { extra_share_by_date: { date: '2027-04-09' } } : {}) } },
      { id: 'o1', kind: 'option', label: 'Raise price', interventions: { f: cell } },
    ],
    edges: [
      { from: 'o1', to: 'f', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'user_specified', magnitude: 'user_stated' } },
    ],
    // A Run that analysed `o1` (the panel's settings read the bound Run's options).
  };
}

function settingSurfaces(cell: unknown, marker: boolean): Record<string, readonly Klass[]> {
  const graph = settingGraph(cell, marker);
  const out: Record<string, readonly Klass[]> = {};
  const c = goalChanceEstimateCounts(graph, ['o1'], 'g') as Rec;
  out.census = (c.settingsByOption.o1 ?? 0) === 1 ? ['ai'] : (c.unverifiedSettingsByOption.o1 ?? 0) === 1 ? ['unknown', 'human_stamp_only'] : ['human', 'structural'];
  const ladder = structureProvenanceOfEffect(graph, 'o1', 'f');
  out.ladder = ladder === 'user_stated' ? ['human', 'human_stamp_only'] : ladder === 'ai_drafted' ? ['ai', 'structural'] : ladder === 'unattributed' ? ['unknown'] : ALL;
  if (has('panel option settings (optionSettingsOf)', (actionState as Rec).optionSettingsOf)) {
    const settings = (actionState as Rec).optionSettingsOf({ scenarioId: 's', graph, analysisResult: { enrichment: { option_comparison: [{ option_id: 'o1' }] } } },
      [{ factor_id: 'f', label: 'Price', value_authorship: 'yours', goal_distance: 1, value_hash: '' }]) as Rec[];
    const mine = settings.find((s) => s.id === 'o1:f');
    // (The legacy panel walk, kept for this spec; the served panel is the chance's census, above.)
    out.panel = mine === undefined ? ['structural', 'unknown'] : mine.authorship === 'olumi_estimate' ? ['ai'] : mine.authorship === 'user' ? ['human', 'human_stamp_only']
      : mine.authorship === 'unknown' ? ['unknown'] : ALL;
    const lines = sayOlumiEstimates(olumiEstimatesFeedingResult({ goalPathFactors: [], goalPathLinks: [], optionSettings: settings as never })).join(' ');
    out.panelLine = /Olumi supplied 1 /.test(lines) ? ['ai'] : ['human', 'human_stamp_only', 'unknown', 'structural'];
  }
  if (has('receipt (optionLevelSourceWords)', (capabilities as Rec).optionLevelSourceWords)) {
    const words = (capabilities as Rec).optionLevelSourceWords(cell, graph.nodes[1]);
    out.receipt = words === "Olumi's suggested estimate" ? ['ai'] : words === 'set by you' ? ['human'] : words === 'from your original brief' ? ['human', 'human_stamp_only']
      : words === 'source not recorded' ? ['unknown', 'structural'] : ALL;
  }
  return out;
}

describe('ONE PROVENANCE AUTHORITY — every reader of an option setting agrees', () => {
  it.each(settingVariants)('$name', ({ cell, marker }) => {
    const surfaces = settingSurfaces(cell, marker);
    const agreed = agree(surfaces);
    expect({ surfaces, agreed }).toEqual(expect.objectContaining({ agreed: expect.arrayContaining([expect.any(String)]) }));
    if (authority !== undefined) expect(agreed).toContain(classOf(authority.provenanceOf({ setting: cell, target: settingGraph(cell, marker).nodes[1] })));
  });
});

// ── Links (AIE 6121121310: an unmarked numerical link is never `ai` wholesale and never dropped) ──────────────────

const linkVariants: { name: string; edge: Rec; from?: string; expected: Klass }[] = [
  { name: 'user-sized (magnitude user_stated, user_specified)', edge: { provenance: { source: 'user_specified', magnitude: 'user_stated' } }, expected: 'human' },
  { name: 'user_specified, no magnitude', edge: { provenance: { source: 'user_specified' } }, expected: 'human' },
  { name: 'Olumi estimate', edge: { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } }, expected: 'ai' },
  { name: 'Olumi estimate, accepted', edge: { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } } }, expected: 'ai_accepted' },
  { name: 'placeholder', edge: { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, defaulted: true }, expected: 'placeholder' },
  // An AI DRAWING stamp says who drew the link, not who sized it: with no size mark the size is unestablished — unknown,
  // counted and disclosed, never Olumi's wholesale and never dropped (agrees with `link_sizing: 'unmarked'` on the panel).
  { name: 'UNMARKED cee_hypothesis', edge: { provenance: { source: 'cee_hypothesis' } }, expected: 'unknown' },
  { name: 'UNMARKED domain_knowledge', edge: { provenance: { source: 'domain_knowledge' } }, expected: 'unknown' },
  { name: 'UNMARKED no provenance', edge: {}, expected: 'unknown' },
  { name: 'UNMARKED no stamp, size defaulted', edge: { defaulted: true }, expected: 'unknown' },
  { name: 'UNMARKED unrecognised stamp', edge: { provenance: { source: 'imported_csv' } }, expected: 'unknown' },
  // R11's existing source meaning (AIE: "their existing validated/source meaning where it is proven"): drawn by the person or the brief.
  { name: 'UNMARKED legacy user stamp', edge: { provenance: { source: 'user' } }, expected: 'human' },
  { name: 'UNMARKED brief link without its evidence', edge: { provenance: { source: 'brief_extraction' } }, expected: 'human' },
  { name: 'UNMARKED brief link WITH its evidence', edge: { provenance: { source: 'brief_extraction', source_quote: 'price drives revenue' } }, expected: 'human' },
  { name: 'UNMARKED structural (from an option)', edge: { provenance: { source: 'cee_hypothesis' } }, from: 'o2', expected: 'structural' },
];

function linkGraph(edge: Rec, from: string): Rec {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Revenue', observed_state: { value: 100, raw_value: 100, unit: '£', source: 'user_edited' } },
      { id: 'f', kind: 'factor', label: 'Price', observed_state: { value: 0.5, source: 'user_edited' } },
      { id: 'h', kind: 'factor', label: 'Demand', observed_state: { value: 0.5, source: 'user_edited' } },
      { id: 'o1', kind: 'option', label: 'Raise price', interventions: {} },
      { id: 'o2', kind: 'option', label: 'Hold price', interventions: {} },
    ],
    edges: [
      { from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'user_specified', magnitude: 'user_stated' } },
      { from, to: 'f', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', ...edge },
    ],
  };
}

function linkSurfaces(edge: Rec, from: string): Record<string, readonly Klass[]> {
  const graph = linkGraph(edge, from);
  const e = graph.edges[1];
  const out: Record<string, readonly Klass[]> = {};
  const c = goalChanceEstimateCounts(graph, ['o1', 'o2'], 'g') as Rec;
  out.census = c.links === 1 ? ['ai'] : (c.unverifiedLinks ?? 0) === 1 ? ['unknown'] : ['human', 'ai_accepted', 'placeholder', 'structural'];
  const sizing = linkSizing(e);
  const lines = sayOlumiEstimates(olumiEstimatesFeedingResult({ goalPathFactors: [], goalPathLinks: [{ link_id: `${from}->f`, from_label: 'x',
    to_label: 'Price', link_sizing: sizing, option_ids: [], goal_distance: 2, value_hash: '' }] })).join(' ');
  out.panelLine = /Olumi supplied 1 /.test(lines) ? ['ai'] : /1 you accepted/.test(lines) ? ['ai_accepted']
    : /links have no size yet/.test(lines) ? ['placeholder'] : ['human', 'unknown', 'structural'];
  const compact = compactGraph(graph as never).edges.find((x: Rec) => x.from === from && x.to === 'f') as Rec;
  out.compact = compact.sizing === 'user' ? ['human'] : compact.sizing === 'olumi_estimate' ? ['ai'] : compact.sizing === 'olumi_accepted' ? ['ai_accepted']
    : compact.sizing === 'placeholder' ? ['placeholder'] : ['human', 'unknown', 'structural'];

  const ladder = edgeStrengthProvenance(e);
  out.ladder = ladder === 'user_stated' ? ['human'] : ladder === 'ai_drafted' ? ['ai', 'ai_accepted', 'placeholder', 'human', 'structural']
    : ladder === 'unattributed' ? ['unknown', 'structural'] : ALL;
  return out;
}

describe('ONE PROVENANCE AUTHORITY — every reader of a link size agrees, and an unmarked link is disclosed', () => {
  it.each(linkVariants)('$name', ({ edge, from, expected }) => {
    const surfaces = linkSurfaces(edge, from ?? 'h');
    expect({ surfaces, agreed: agree(surfaces) }).toEqual(expect.objectContaining({ agreed: expect.arrayContaining([expected]) }));
    if (authority !== undefined) {
      expect(classOf(authority.provenanceOf({ link: linkGraph(edge, from ?? 'h').edges[1], context: { fromKind: from === undefined ? 'factor' : 'option' } }))).toBe(expected);
    }
  });

  it('the narrower link questions the authority answers are never broader than its own `human` (subset)', () => {
    if (authority === undefined) { skipped.add('narrower link predicates'); return; }
    const edges: Rec[] = [
      ...linkVariants.map((v) => ({ from: 'h', to: 'f', strength: { mean: 0.4, std: 0.1 }, ...v.edge })),
      { provenance: { source: 'cee_hypothesis', magnitude: 'user_stated' } },
      { provenance: { source: 'user_specified', magnitude: 'olumi_estimate' } },
      { provenance: { source: 'user_specified', mean_projected: true, magnitude: 'olumi_placeholder' }, defaulted: true },
      { provenance: { source: 'user_specified' }, provenance_display: 'user_set' },
      { provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 1 } }, provenance_display: 'user_set' },
    ];
    for (const e of edges) {
      const human = authority.linkProvenanceOf(e).origin === 'human';
      for (const name of ['isUserStatedStrength', 'isUserSetBand', 'hasUserStatedSize', 'isUserSizedWithoutOlumiMarks']) {
        if (authority[name](e)) expect({ name, e, human }).toEqual({ name, e, human: true });
      }
    }
  });

  it('who DREW a link, as the model is told it, is never `ai_inferred` for a drawer nobody established (compact context)', () => {
    // Asked of the compactor itself (it exists on 591cc1a0 too), so this row is RED there and GREEN after.
    const drawn = (edge: Rec, from = 'h'): Rec => {
      const g = linkGraph(edge, from);
      return compactGraph(g as never).edges.find((x: Rec) => x.from === from && x.to === 'f') as Rec;
    };
    // The four recognised drawing stamps keep their words exactly.
    expect(drawn({ provenance: { source: 'brief_extraction' } }).provenance).toBe('from_brief');
    expect(drawn({ provenance: { source: 'user_specified' } }).provenance).toBe('user_set');
    expect(drawn({ provenance: { source: 'cee_hypothesis' } }).provenance).toBe('ai_inferred');
    expect(drawn({ provenance: { source: 'domain_knowledge' } }).provenance).toBe('ai_inferred');
    // An option's link is the model's structure, as before.
    expect(drawn({}, 'o2').provenance).toBe('ai_inferred');
    // RED on 591cc1a0 (both said `ai_inferred`): no stamp, or an unrecognised one, establishes no drawer.
    expect(drawn({}).provenance).toBe('unverified_brief');
    expect(drawn({ provenance: { source: 'imported_csv' } })).toEqual(expect.objectContaining({ provenance: 'unverified_brief', _raw_provenance: 'imported_csv' }));
    // A recognised class beyond the four keeps its meaning: a repair is Olumi's, a person's literal is theirs.
    expect(drawn({ provenance: { source: 'cee_repair' } }).provenance).toBe('ai_inferred');
    expect(drawn({ provenance: { source: 'user' } }).provenance).toBe('user_set');
  });

  it('names what it could not exercise on this tree', () => {
    // Informational on 591cc1a0 (the authority and the new exports did not exist); empty after the fix.
    if (authority !== undefined) expect([...skipped]).toEqual([]);
  });
});
