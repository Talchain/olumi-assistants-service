/**
 * ⭐ HIRING: THE USER'S OWN EFFECTS REACH THE MODEL (served live/runs/2026-10-14T163659Z-hiring-t1h-positive-r2, turn 3).
 *
 * The user wrote: "For this model: hiring a Tech lead would raise productivity by about 8% of today’s, and each
 * additional developer by about 3% of today’s." Nothing was recorded (`propose_link_effect` → `not_the_users_statement`),
 * so both goal links stayed Olumi's placeholders and the Run withheld every chance (`GOAL_FIGURES_PLACEHOLDER_PATH`).
 * Three losses, each at its producer:
 *  1. `distributiveOneAt` did not read "a Tech lead" as one Tech lead (only each/every/per, "one more", "an extra");
 *  2. the distributive path accepted ANY figure in the sentence, so the developer link took the Tech lead's 8%;
 *  3. the unit reader asked "a point rise, or a % of today's level?" on a goal measured AS a change, whose '%' IS a share
 *     of today's level (the sizer's own Batch C gap 1 rule) — a question the user had already answered.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linkEffectTheUserStated } from '../stated-by-user.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { applyLinkEffectEdit } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/hiring-42d10ecf-read-before-effects.json', import.meta.url), 'utf8')) as { graph: Json };
const SAID = 'For this model: hiring a Tech lead would raise productivity by about 8% of today’s, and each additional developer by about 3% of today’s.';
const QUANTITIES = ['Productivity', 'Tech leads', 'Mid-weight developers', 'Code quality', 'Hiring spend', 'Budget pressure'];
const SCOPE = { quantities: QUANTITIES, link_selected: false, target_units: ['%'], target_unitless: false, source_unitless: false } as never;
const TL = { source: 'Tech leads', target: 'Productivity' };
const DEV = { source: 'Mid-weight developers', target: 'Productivity' };
const effect = (amount: number, per_source_change_unit: string) =>
  ({ amount, amount_unit: '%', per_source_change: 1, per_source_change_unit });

describe('the binder reads the served sentence, one figure per link', () => {
  it('⭐ RED→GREEN: "hiring a Tech lead would raise productivity by about 8%" states the Tech lead link at 8', () => {
    expect(linkEffectTheUserStated(SAID, effect(8, 'tech leads'), TL, SCOPE)).toBeNull();
  });
  it('the developer link at 3 (unchanged: "each additional developer")', () => {
    expect(linkEffectTheUserStated(SAID, effect(3, 'developers'), DEV, SCOPE)).toBeNull();
  });
  it('⭐ RED→GREEN: the developer link never takes the Tech lead\'s 8, nor the Tech lead link the developer\'s 3', () => {
    expect(linkEffectTheUserStated(SAID, effect(8, 'developers'), DEV, SCOPE)).not.toBeNull();
    expect(linkEffectTheUserStated(SAID, effect(3, 'tech leads'), TL, SCOPE)).not.toBeNull();
  });
  it('CONTRAST: an article that counts something else is not one Tech lead', () => {
    expect(linkEffectTheUserStated('A Tech lead budget of £5 would raise productivity by 3%.', effect(3, 'tech leads'), TL, SCOPE)).not.toBeNull();
    expect(linkEffectTheUserStated('A round of Tech lead interviews would raise productivity by 3%.', effect(3, 'tech leads'), TL, SCOPE)).not.toBeNull();
  });
  it('CONTRAST: one clause with a non-coordinating aside stays one clause ("Each extra conversation, which costs £20, brings £1,000")', () => {
    const ends = { source: 'Warm conversations', target: 'Revenue' };
    const scope = { quantities: ['Warm conversations', 'Revenue'], link_selected: false, target_units: ['£'], target_unitless: false, source_unitless: false } as never;
    expect(linkEffectTheUserStated('Each extra conversation, which costs £20, brings £1,000 in revenue.',
      { amount: 1000, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'conversations' }, ends, scope)).toBeNull();
  });
});

describe('a goal measured as a change: its % is a share of today\'s, never asked again', () => {
  const productivity = (SERVED.graph.nodes as Json[]).find((n) => n.id === 'productivity')!;
  it('fixture control: the served goal is a change goal in %', () => {
    expect(productivity).toMatchObject({ kind: 'goal', quantity_frame: 'change', goal_threshold_unit: '%' });
  });
  it('⭐ RED→GREEN: "8% of today’s" on the change goal asks nothing', () => {
    const r = prepareLinkEffectUnitReadings(SERVED.graph, 'tech_leads', 'productivity', effect(8, 'tech leads'), SAID);
    expect(r.ask).toBeUndefined();
  });
  it('CONTRAST: the same goal measured as a LEVEL in % still asks points or share', () => {
    const level = structuredClone(SERVED.graph);
    const g = (level.nodes as Json[]).find((n) => n.id === 'productivity')!;
    g.quantity_frame = 'level'; g.goal_threshold_frame = 'level';
    const r = prepareLinkEffectUnitReadings(level, 'tech_leads', 'productivity', effect(8, 'tech leads'), 'Hiring a Tech lead would raise productivity by about 8%.');
    expect(r.ask).toMatch(/point rise in “Productivity”/);
  });
});

describe('⭐ real path: the user\'s two effects, one card, the real writer', () => {
  it('RED→GREEN: propose → approve → both goal links carry the user\'s figures, no longer Olumi\'s placeholders', async () => {
    const graph = structuredClone(SERVED.graph);
    const store = new ProposalStore();
    let sent: CommitOptionLevelsInput | undefined;
    const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      sent = input;
      for (const item of input.link_effects ?? []) {
        const out = applyLinkEffectEdit({ persistedGraph: structuredClone(graph), from: item.from, to: item.to, effect: item.effect, quote: item.quote,
          expected: { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: item.edge_token }, reading_token: item.reading_token,
          ...(item.unit_readings !== undefined ? { unit_readings: item.unit_readings } : {}) });
        if (out.kind !== 'mutated') throw new Error(`writer refused: ${JSON.stringify(out)}`);
        const i = (graph.edges as Json[]).findIndex((e) => e.from === item.from && e.to === item.to);
        graph.edges[i] = (out.mutatedGraph as Json).edges.find((x: Json) => x.from === item.from && x.to === item.to);
      }
      return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null, already_applied: false, committed_levels: [] };
    };
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels });
    const ctx = (user_text: string, extra: Json = {}) => ({ scenario_id: '42d10ecf-34c5-4c0a-ba6b-e2186b47c2c8', authenticated_user_id: null, request_id: 'hiring', user_text, user_turn_text: SAID, ...extra });
    const links = [
      { from_label: 'Tech leads', to_label: 'Productivity', ...effect(8, 'tech leads'), quote: SAID },
      { from_label: 'Mid-weight developers', to_label: 'Productivity', ...effect(3, 'developers'), quote: SAID },
    ];
    const prepared = await caps.proposeLinkEffect!(ctx(SAID), { links }) as Json;
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(prepared.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: prepared as never }))[0]!;
    const applied = await caps.authoriseChange!(ctx(card.message, { typed_approval_of: prepared.proposal_id, typed_approval_words: card.message }),
      { proposal_id: prepared.proposal_id }) as Json;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(sent?.link_effects?.map((l) => [l.from, l.effect.amount])).toEqual([['tech_leads', 8], ['mid_weight_developers', 3]]);
    for (const [from, amount] of [['tech_leads', 8], ['mid_weight_developers', 3]] as const) {
      const edge = (graph.edges as Json[]).find((e) => e.from === from && e.to === 'productivity')!;
      expect(edge.provenance?.magnitude).not.toBe('olumi_placeholder');
      expect(edge.provenance?.natural_effect).toMatchObject({ amount, amount_unit: '%', per_source_change: 1 });
    }
  });

  it('a unit the writer cannot take names the goal\'s own unit, so the Agent can ask in it (never "its own unit")', async () => {
    const graph = structuredClone(SERVED.graph);
    const d: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } });
    const caps = createAgentCapabilities(d, new ProposalStore());
    const r = await caps.proposeLinkEffect!({ scenario_id: '42d10ecf-34c5-4c0a-ba6b-e2186b47c2c8', authenticated_user_id: null, request_id: 'hiring', user_text: SAID, user_turn_text: SAID } as never,
      { from_label: 'Tech leads', to_label: 'Productivity', ...effect(8, 'tech lead'), amount_unit: '% of today’s productivity', quote: SAID } as never) as Json;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_mismatch' });
    expect(r.detail).toContain('"Productivity" is measured in %');
  });
});
