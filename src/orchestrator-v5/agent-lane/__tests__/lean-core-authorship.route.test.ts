/**
 * ⭐⭐ LEAN CORE: THE ONE AUTHORSHIP RULE on the REAL path (DL-3 18 Oct 2026; outbox/LEAN-CORE-DESIGN.md (f)). Each row drives an actual
 * writer and reads the SAVED record back by identity: construction through `buildModelFromBrief` (scripted drafter) → `/graph/register`
 * body; chat through `dispatchTool` → card → `authoriseChange` press → the register route's store → read back. Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { userStated } from '../user-statements.js';
import { currentCorrectionOf } from '../../statement-door/read.js';
import { prepareStatementCorrection, userStatementFor } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const AIM = 'We want to grow weekly bookings to at least 300 within 12 months.';
const TODAY = 'Bookings are 180 a week today.';
const BRIEF = [AIM, TODAY, 'We could add evening slots or run a referral offer.'].join('\n');
const GOAL = 'Weekly bookings';

function draft(over: { goal?: Rec; statements?: Rec[] } = {}): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 300, unit: 'bookings a week', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 180, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null, ...over.goal },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add evening slots', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Evening slots', value: 20, value_kind: 'absolute', unit: 'slots a week', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: 'Evening slots', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'slots a week', provenance: 'ai_proposed', plausible_max: 60 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [link('Evening slots', GOAL)],
    statements: over.statements ?? [
      { quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 300,
        low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null },
    ],
  };
}

async function saved(model: Rec, text = BRIEF): Promise<Rec> {
  let body: Rec | undefined;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('7b7b7b7b-0000-4b7b-8b7b-7b7b7b7b7b7b', text, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return body!;
}
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');

describe('W28: the goal\'s target is the user\'s by the door\'s own verdict, never by the drafter\'s flag or a host re-scan', () => {
  it('a verified {goal, target} statement holds the target as the user\'s even when the drafter did not mark the goal explicit', async () => {
    const g = await saved(draft({ goal: { provenance: 'inferred' } }));
    expect(goalOf(g)).toMatchObject({ label: GOAL, threshold_source: 'brief_extraction', goal_direction: '>=' });
  });

  it('CONTRAST: the drafter\'s explicit flag alone, with no verified target statement, never holds the target as the user\'s', async () => {
    const g = await saved(draft({ statements: [{ quote: TODAY, subject: { kind: 'factor', label: GOAL, to_label: null, factor_label: null },
      field: 'level', form: 'point', value: 180, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null }] }));
    expect(goalOf(g).threshold_source).toBeUndefined();
  });

  it('CONTRAST: a target statement whose words the user never wrote is not theirs, whatever the flag says', async () => {
    const g = await saved(draft({ statements: [{ quote: 'We want at least 300 weekly bookings.', subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null },
      field: 'target', form: 'lower_bound', value: 300, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null }] }));
    expect(goalOf(g).threshold_source).toBeUndefined();
  });
});

describe('PL-0048 (2): a span the user\'s correction retired is never re-credited by a later literal match, cold too', () => {
  const levelStatement = { quote: TODAY, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'level', form: 'point',
    value: 180, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null };
  const FIX = 'Ignore the weekly bookings figure of 180 I gave, I have no reliable count.';
  async function corrected(): Promise<{ graph: Rec; subject: Rec }> {
    const g = await saved(draft({ statements: [...(draft().statements as Rec[]), levelStatement] }));
    const subject = { kind: 'goal' as const, id: String(goalOf(g).id), field: 'level' as const };
    expect(userStatementFor(g, subject)?.statements.map((st) => st.quote), 'construction recorded the user\'s level').toEqual([TODAY]);
    const result = prepareStatementCorrection(g, { quote: FIX, edits: [{ subject, retirement: { quote: TODAY, scope: 'whole', disposition: 'retracted' },
      retained: [], reading_words: 'The earlier weekly figure is withdrawn.' }] } as never, { now: FIX }, '2026-10-18T01:00:00Z');
    if ('refused' in result) throw new Error(String(result.refused));
    // The register route's persistence: the saved bytes, read back cold.
    return { graph: JSON.parse(JSON.stringify(result.candidate)) as Rec, subject };
  }
  const chat = (...messages: string[]) => ({ now: messages[messages.length - 1], conversation: messages.join('\n'), messages });

  it('after the correction, the brief\'s "180 a week" quoted again is not the user\'s (unknown), read from the cold saved record', async () => {
    const { graph, subject } = await corrected();
    const current = currentCorrectionOf(graph, subject as never);
    expect(current).toEqual({ correction: FIX, kept: [] });
    expect(userStated({ quote: TODAY, value: 180, unit: 'bookings a week' }, chat(BRIEF, FIX, 'Please set today\'s level.'), { quantity: 'goal_level' },
      { current })).toMatchObject({ origin: 'unknown' });
  });

  it('CONTRAST: with no correction on record the same quote is theirs; a NEW figure typed after the correction is theirs', async () => {
    const { graph, subject } = await corrected();
    expect(userStated({ quote: TODAY, value: 180, unit: 'bookings a week' }, chat(BRIEF, 'Please set today\'s level.'), { quantity: 'goal_level' })
      .origin).toBe('human');
    const fresh = 'Bookings are 210 a week now.';
    expect(userStated({ quote: fresh, value: 210, unit: 'bookings a week' }, chat(BRIEF, FIX, fresh), { quantity: 'goal_level' },
      { current: currentCorrectionOf(graph, subject as never) }).origin).toBe('human');
  });
});
