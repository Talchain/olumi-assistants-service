/**
 * ⭐ A COUNT OUTCOME'S PLURAL HEAD NOUN IS ITS UNIT (R3 #75 5926215496; DL 5926238562: the step-2 unit wall).
 * Served `train-0643Z` (CEE 581c1873): Paul's "Each extra conversation brings in about £20,000 towards funding" passed
 * the authorship door (#2435) and was then refused `unit_mismatch`: the persisted outcome "Angel investor conversations"
 * keeps NO unit (the drafter's units live only in the construction path's `natural_effect`), so the writer's source unit
 * was '' and "per conversation" could never match. The frame IS stored (40), so the size itself is computable.
 */
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type ApplyLinkEffectEditParams } from '../link-effect-edit.js';

type Rec = Record<string, any>;
const SRC = 'angel_investor_conversations';

/** The served 0643Z shape at the link-size turn: unitless count outcomes with stored frames; the goal's £ is its target unit. */
function served(label = 'Angel investor conversations'): Rec {
  return {
    goal_node_id: 'funding',
    nodes: [
      { id: 'funding', kind: 'goal', label: 'funding', goal_threshold_unit: '£', scale_frame: 20000000 },
      { id: SRC, kind: 'outcome', label, scale_frame: 40 },
      { id: 'o-hold', kind: 'option', label: 'Continue firm outreach' },
    ],
    edges: [
      { from: SRC, to: 'funding', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
        defaulted: true, provenance: { source: 'cee_hypothesis' } },
    ],
  };
}
const EFFECT = { amount: 20000, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'conversations' };

function params(graph: Rec, effect: Rec = EFFECT): ApplyLinkEffectEditParams {
  const p = {
    persistedGraph: graph, from: SRC, to: 'funding', effect,
    expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, SRC, 'funding')! },
    quote: 'Each extra conversation brings in about £20,000 towards funding',
  } as Omit<ApplyLinkEffectEditParams, 'reading_token'>;
  return { ...p, reading_token: linkEffectReadingToken(p) } as ApplyLinkEffectEditParams;
}
const edgeOf = (g: unknown) => (g as Rec).edges.find((e: Rec) => e.from === SRC && e.to === 'funding') as Rec;

describe('the step-2 unit wall: a unitless count outcome is counted in its plural head noun', () => {
  it('RED (served 0643Z): £20,000 per conversation on "Angel investor conversations" is written as the user\'s size, per conversation', () => {
    const r = applyLinkEffectEdit(params(served()));
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const ne = edgeOf(r.mutatedGraph).provenance.natural_effect;
    expect(ne).toMatchObject({ amount: 20000, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'conversations' });
    expect(edgeOf(r.mutatedGraph).provenance.magnitude).toBe('user_stated');
    // β = 20,000 × 40 / 20,000,000 = 0.04 — the stored frames, nothing guessed.
    expect(edgeOf(r.mutatedGraph).strength.mean).toBeCloseTo(0.04, 12);
  });

  it('the singular ("per conversation") is the same count', () => {
    expect(applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: 'conversation' })).kind).toBe('mutated');
  });

  // CODEX #85 5926859038: the stored unit IS the proposed unit, byte for byte — `applyLinkEffect`'s read-back compares
  // them, so a respelled unit ("conversations" for "conversation") lands the write and then reports it not verified.
  for (const unit of ['conversation', 'conversations', 'Conversation']) {
    it(`read-back identity: proposed "per ${unit}" is stored as exactly "${unit}"`, () => {
      const r = applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: unit }));
      expect(r.kind, JSON.stringify(r)).toBe('mutated');
      if (r.kind === 'mutated') expect(edgeOf(r.mutatedGraph).provenance.natural_effect.per_source_change_unit).toBe(unit);
    });
  }
  // R3 #85 5926783007: Paul's card words — the unit names the count with the source's own words.
  for (const unit of ['investor conversation', 'investor conversations', 'angel investor conversation', 'extra conversation']) {
    it(`R3: "per ${unit}" on "Angel investor conversations" is the same count → written`, () => {
      const r = applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: unit }));
      expect(r.kind, JSON.stringify(r)).toBe('mutated');
      if (r.kind === 'mutated') expect(edgeOf(r.mutatedGraph).provenance.natural_effect.per_source_change_unit).toBe(unit); // stored as proposed (CODEX 5926859038)
    });
  }
  // ⛔ AIQ 5927288860: "Every 100 conversations bring in about £20,000" is £200 per conversation. A number in the unit is
  // never dropped: per 1 "100 conversations" would store the £20,000-per-conversation strength (100× too strong) as theirs.
  // CODEX 5927360189: multipliers, decimals and signed quantities in the unit are refused the same way.
  for (const unit of ['100 conversations', '100 investor conversations', 'a hundred conversations', '2 conversations',
    '1.5 conversations', '-1 conversation', '+2 conversations', 'dozen conversations', '10k conversations']) {
    it(`AIQ hostile: per 1 "${unit}" (a number in the unit) is refused, never read as per conversation`, () => {
      expect(applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change: 1, per_source_change_unit: unit }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    });
  }
  it('AIQ control: per 100 "conversations" (the right reading) is written, 100× weaker than per 1', () => {
    const per100 = applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change: 100, per_source_change_unit: 'conversations' }));
    const per1 = applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change: 1, per_source_change_unit: 'conversations' }));
    expect(per100.kind).toBe('mutated');
    expect(per1.kind).toBe('mutated');
    if (per100.kind === 'mutated' && per1.kind === 'mutated') {
      expect(edgeOf(per100.mutatedGraph).strength.mean * 100).toBeCloseTo(edgeOf(per1.mutatedGraph).strength.mean, 9);
    }
  });
  for (const unit of ['seed conversation', 'investor meeting', 'conversation investor']) {
    it(`R3 hostile: "per ${unit}" names another kind (or no count last) → refused`, () => {
      expect(applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: unit }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    });
  }

  it('per a DIFFERENT count ("per deal") on that source is still a unit mismatch', () => {
    expect(applyLinkEffectEdit(params(served(), { ...EFFECT, per_source_change_unit: 'deals' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a unitless source with no plural head noun ("Fundraising admin time") is never given one', () => {
    expect(applyLinkEffectEdit(params(served('Fundraising admin time'), { ...EFFECT, per_source_change_unit: 'times' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  // R3 5926280368's hostile rows: the HEAD noun, before the first preposition.
  it('R3: unitless "Revenue from renewals" counts revenue, not renewals — "per renewal" is refused', () => {
    expect(applyLinkEffectEdit(params(served('Revenue from renewals'), { ...EFFECT, per_source_change_unit: 'renewal' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it('R3: "Number of signed contracts" counts contracts — "per contract" is written', () => {
    const r = applyLinkEffectEdit(params(served('Number of signed contracts'), { ...EFFECT, per_source_change_unit: 'contract' }));
    expect(r.kind, JSON.stringify(r)).toBe('mutated');
    if (r.kind === 'mutated') expect(edgeOf(r.mutatedGraph).provenance.natural_effect.per_source_change_unit).toBe('contract');
  });
  it('R3: "Investment-firm deals closed" + "per deal" → written, per deals (the participle is dropped)', () => {
    expect(applyLinkEffectEdit(params(served('Investment-firm deals closed'), { ...EFFECT, per_source_change_unit: 'deal' })).kind).toBe('mutated');
  });
  it('a time word is never a count ("Founder minutes" → none)', () => {
    expect(applyLinkEffectEdit(params(served('Founder minutes'), { ...EFFECT, per_source_change_unit: 'minute' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it('a money word is never a count ("Pro plan prices" → none)', () => {
    expect(applyLinkEffectEdit(params(served('Pro plan prices'), { ...EFFECT, per_source_change_unit: 'price' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  // AIQ 5926286558 / R3 5926308694: a RATE label's unit is the head PER PERIOD — never one count. Under-claim.
  for (const label of ['Warm conversations per week', 'Weekly investor conversations', 'Conversations each month', 'Investor conversations a quarter']) {
    it(`AIQ: rate label "${label}" + "per conversation" is refused (one unit of the node is one conversation every period)`, () => {
      expect(applyLinkEffectEdit(params(served(label), { ...EFFECT, per_source_change_unit: 'conversation' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    });
  }

  // R3 5926374414: a MONEY plural is never a count — a unitless £ node sized "per payment" would be a false scale.
  for (const [label, unit] of [['Consulting fees', 'fee'], ['Customer payments', 'payment'], ['Cost savings', 'saving'], ['Operating expenses', 'expense'],
    ['Investor funds', 'fund'], ['Net earnings', 'earning'], ['Gross profits', 'profit'], ['Grant proceeds', 'proceed'], ['Staff salaries', 'salary']] as const) {
    it(`R3: money plural "${label}" + "per ${unit}" is refused`, () => {
      expect(applyLinkEffectEdit(params(served(label), { ...EFFECT, per_source_change_unit: unit }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    });
  }
  it('R3: an AMBIGUOUS head counts only after an event participle — "Angel investments closed" → per investment', () => {
    expect(applyLinkEffectEdit(params(served('Angel investments closed'), { ...EFFECT, per_source_change_unit: 'investment' })).kind).toBe('mutated');
  });
  for (const label of ['Sales', 'Angel investments', 'Bookings']) {
    it(`R3: bare ambiguous "${label}" is no count`, () => {
      expect(applyLinkEffectEdit(params(served(label), { ...EFFECT, per_source_change_unit: label.toLowerCase().split(' ').pop()!.replace(/s$/, '') }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    });
  }

  it('a word that only ENDS in s ("status", "process", "analysis") is not a count', () => {
    expect(applyLinkEffectEdit(params(served('Fundraising process status'), { ...EFFECT, per_source_change_unit: 'status' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });

  it('a participle tail is not the noun: "Investment-firm deals closed" counts deals, never "closed"', () => {
    expect(applyLinkEffectEdit(params(served('Investment-firm deals closed'), { ...EFFECT, per_source_change_unit: 'deals' })).kind).toBe('mutated');
    expect(applyLinkEffectEdit(params(served('Investment-firm deals closed'), { ...EFFECT, per_source_change_unit: 'closed' }))).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
  });
});
