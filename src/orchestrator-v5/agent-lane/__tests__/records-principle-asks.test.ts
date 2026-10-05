/**
 * #2576 PRINCIPLE MERGE CONDITIONS (DL principle audit, PRINCIPLE-AUDIT.md:150-163): Olumi asks rather than invents.
 *
 * Every row runs the REAL records build (`buildModelFromRecords`) and reads its questions through the SERVED reader
 * (`write-outcome.ts` `openQuestionsForReply`, the wire's `_agent.open_questions`; `narrateWriteOutcome`, the reply's
 * status line). Each port row is RED with its producer call removed (mutants in the commit message).
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNext as sealedRecords, sealedRecordsVNextLinked } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { userQuestionForAskItem } from '../../../cee/draft/records/user-asks.js';
import type { CompletionAskItem } from '../../../cee/draft/records/completion.js';
import { NOT_REPRESENTABLE } from '../../../cee/magnitude/link-effect.js';
import { classifyValueSource } from '../../../cee/graph-readiness/obligation-provenance.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { narrateWriteOutcome, openQuestionsForReply } from '../write-outcome.js';
import { limitedLevelAsks, optionSetLimitAsks } from '../limited-level-ask.js';
import { sayFigure } from '../say-figure.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

type Rec = Record<string, any>;
const SID = '11111111-1111-4111-8111-111111111111';
const OLUMIS = new Set(['ai_drafted', 'system_repaired']);

async function build(records: DraftRecordSet, brief: string): Promise<{ result: ToolResult; graph: Rec }> {
  const writes: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Rec); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords(SID, brief, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  expect(writes).toHaveLength(1);
  return { result, graph: writes[0]!.graph as Rec };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const LIMIT_BRIEF = 'Hire a tech lead to lift Delivery reliability, with monthly churn under 4%.';
/** A limited quantity NO option sets, whose only level is Olumi's (a claim's value): limitedLevelAsks' case. */
function limitedLevelRecords(): DraftRecordSet {
  const records = constructionRecords();
  const churn = records.claims.length;
  records.claims.push({ claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' },
    { claim_kind: 'causal_link', label: 'Churn hurts result', from_claim: churn, to_claim: 1, effect: 'negative' });
  const quote = 'monthly churn under 4%'; const at = LIMIT_BRIEF.indexOf(quote);
  records.stated_items.push({ kind: 'constraint', source_quote: quote, value: 4, unit: '%', direction: 'ceiling',
    direction_span: { start: at + 14, end: at + 19 }, value_span: { start: at + 20, end: at + 21 }, applies_to_claim: churn } as never);
  return records;
}
const OPTION_SET_BRIEF = 'Raise Pro to £59 to lift MRR, with monthly churn under 4%.';
/** The accepted-losses row's fixture: an option SETS the limited quantity at Olumi's figure: optionSetLimitAsks' case. */
function optionSetRecords(): DraftRecordSet {
  const records = constructionRecords('Raise Pro to £59', 'MRR', 'Monthly churn');
  records.claims[0] = { claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' };
  records.stated_items.push({ kind: 'constraint', source_quote: 'monthly churn under 4%', value: 4, unit: '%',
    direction: 'ceiling', direction_span: { start: 14, end: 19 }, value_span: { start: 20, end: 21 }, applies_to_claim: 0 } as never);
  return records;
}
/** PORT 3's clamp fixture: the gross-price stated effect widened past one (both user sizes into MRR stored clamped). */
function clampRecords(): DraftRecordSet {
  const records = sealedRecords();
  records.claims[0] = { ...records.claims[0]!, value: 1000000 };
  return records;
}
/** A distilled 'unresolved'-heavy draft: every required link left open, an unresolvable link, a limit with no subject. */
function unresolvedHeavyRecords(): DraftRecordSet {
  const records = sealedRecordsVNextLinked();
  records.stated_items = records.stated_items.map((item) => (item.kind === 'goal' ? { ...item, unresolved: ['direction', 'unit', 'baseline_ref'] }
    : item.kind === 'figure' ? { ...item, unresolved: ['quantity'] } : item.kind === 'cause' ? { ...item, unresolved: ['relationship'] } : item)) as never;
  records.claims.push({ claim_kind: 'causal_link', label: 'Unresolved endpoint', from_claim: 999, to_stated: 6, effect: 'positive' });
  const quote = 'Goal: reach at least £150,000 monthly recurring revenue within 9 months.';
  records.stated_items.push({ kind: 'constraint', source_quote: quote, value: 150000, unit: '£/month', direction: 'floor' } as never);
  return records;
}

const levelFixtures: ReadonlyArray<[string, () => DraftRecordSet, string]> = [
  ['limitedLevelAsks', limitedLevelRecords, LIMIT_BRIEF],
  ['optionSetLimitAsks', optionSetRecords, OPTION_SET_BRIEF],
];

// ── ITEM 2: the dropped served asks, ported by CALLING their producers ──────────────────────────────────────────────
describe('#2576 item 2: the level asks reach the served reply, by their one producer, on the graph the build registers', () => {
  it('limitedLevelAsks: today\'s level of a limited quantity no option sets, said as Olumi\'s estimate, asked first', async () => {
    const { result, graph } = await build(limitedLevelRecords(), LIMIT_BRIEF);
    // The producer's own output on the REGISTERED bytes, bound by the limited node's identity.
    const asks = limitedLevelAsks({ nodes: graph.nodes, goal_constraints: graph.goal_constraints });
    const churn = (graph.nodes as Rec[]).filter((n) => n.kind === 'factor' && n.label === 'Monthly churn');
    expect(churn).toHaveLength(1);
    expect(asks.map((a) => a.node_id)).toEqual([churn[0]!.id]);
    expect(asks[0]!.question).toContain('"Monthly churn"');
    // The model holds no level of its own for it (the claim's 3% is not carried as a level), so it asks for one.
    expect(churn[0]!.observed_state?.raw_value).toBeUndefined();
    expect(asks[0]!.estimate).toBeNull();
    expect(asks[0]!.question).toContain('cannot be checked until the model has its current level');
    // The wire list and the reply's status line carry it, first (no scope, no deadline on this brief).
    expect(openQuestionsForReply(result)[0]).toBe(asks[0]!.question);
    const { status } = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
    expect(status).toContain(`Questions this model does not answer yet: ${asks[0]!.question}`);
  });

  it('optionSetLimitAsks: a limit on a quantity an option sets at Olumi\'s figure names that figure as Olumi\'s', async () => {
    const { result, graph } = await build(optionSetRecords(), OPTION_SET_BRIEF);
    const asks = optionSetLimitAsks({ nodes: graph.nodes, goal_constraints: graph.goal_constraints });
    const churn = (graph.nodes as Rec[]).filter((n) => n.kind === 'factor' && n.label === 'Monthly churn');
    expect(asks.map((a) => a.node_id)).toEqual([churn[0]!.id]);
    expect(asks[0]!.assumed.map((a) => a.option)).toEqual(['Raise Pro to £59']);
    expect(asks[0]!.question).toContain("Olumi's figures");
    expect(openQuestionsForReply(result)[0]).toBe(asks[0]!.question);
  });

  it('contrast: a build with no limit asks no level question (constructionRecords)', async () => {
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(openQuestionsForReply(result).some((q) => /today\?|Your limit/.test(q))).toBe(false);
  });
});

describe('#2576 item 2: the magnitude contract\'s question for a user\'s size the model cannot hold (sizeLink)', () => {
  it('a clamped user size is asked as "cut short", and every such question names an edge the build stored clamped', async () => {
    const { result, graph } = await build(clampRecords(), BRIEF);
    const questions = openQuestionsForReply(result);
    const cut = questions.filter((q) => q.includes(NOT_REPRESENTABLE) && q.includes('it is cut short in the analysis'));
    expect(cut).toHaveLength(1);
    const label = (id: string) => (graph.nodes as Rec[]).find((n) => n.id === id)?.label;
    const clamped = (graph.edges as Rec[]).filter((e) => e.provenance?.magnitude === 'user_stated' && e.provenance?.clamped_from !== undefined);
    // Truth: the edge the question names is stored clamped (its source and target labels, in the sizer's words).
    expect(clamped.some((e) => cut[0]!.includes(`"${label(e.from)}"`) && cut[0]!.includes(`"${label(e.to)}"`))).toBe(true);
    expect(cut[0]).toContain('You said');
    // Legacy order: deadline, then the magnitude questions, then the compiler's own asks.
    const deadline = questions.findIndex((q) => q.startsWith('Does "Monthly recurring revenue" get there within 9 months?'));
    const magnitude = questions.findIndex((q) => q.includes('It is kept exactly as you said it.'));
    const compiler = questions.findIndex((q) => q.includes('so Olumi left it open rather than guess'));
    expect(deadline).toBe(0);
    expect(magnitude).toBeGreaterThan(deadline);
    expect(compiler).toBeGreaterThan(magnitude);
  });

  it('contrast: the sealed fixture as drafted (0.64, fits) asks no magnitude question', async () => {
    const { result } = await build(sealedRecords(), BRIEF);
    expect(openQuestionsForReply(result).some((q) => q.includes('It is kept exactly as you said it.'))).toBe(false);
  });
});

describe('#2576 item 2 STOP evidence: what the records build holds where legacy\'s producer had an input', () => {
  it('working figure: a stated option level is stored as the USER\'s (brief_extraction), never demoted, so nothing is "a working figure"', async () => {
    const { result, graph } = await build(sealedRecords(), BRIEF);
    const option = (graph.nodes as Rec[]).find((n) => n.kind === 'option' && n.label === 'Raise Prices by 10%')!;
    const lever = (graph.nodes as Rec[]).filter((n) => n.kind === 'factor' && n.label === 'Price rise');
    expect(lever).toHaveLength(1);
    // Legacy's demotion precondition holds: the lever's current level is NOT the user's (Olumi's 0) ...
    expect(OLUMIS.has(classifyValueSource(lever[0]!.observed_state?.source))).toBe(true);
    // ... and the user's stated 10% on it is still stored as theirs, so no "working figure" exists to confirm.
    expect(option.interventions[lever[0]!.id]).toMatchObject({ raw_value: 10, source: 'brief_extraction' });
    expect(openQuestionsForReply(result).some((q) => q.includes('working figure'))).toBe(false);
  });

  it('directionless: a claim link with no effect is KEPT (not withheld), so "left out because nobody has stated" would be false', async () => {
    const records = constructionRecords();
    const { effect: _dropped, ...noEffect } = records.claims[3] as Rec;
    records.claims[3] = noEffect as never;
    const { result, graph } = await build(records, 'Hire a tech lead for Delivery reliability.');
    const id = (label: string) => (graph.nodes as Rec[]).find((n) => n.label === label)?.id;
    const kept = (graph.edges as Rec[]).filter((e) => e.from === id('Team capacity') && e.to === id('Delivery reliability')
      && (graph.nodes as Rec[]).find((n) => n.id === e.to)?.kind !== 'goal');
    expect(kept).toHaveLength(1);
    expect(kept[0]!.effect_direction).toBe('positive');
    expect(openQuestionsForReply(result).some((q) => q.includes('nobody has stated which way'))).toBe(false);
  });
});

// ── ITEM 3: no debugger words in a user question ────────────────────────────────────────────────────────────────────
const CODE_TOKEN = /[a-z]+_[a-z_]+/;
const HEX_ID = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/;

describe('#2576 item 3: every open question the records build emits is in plain words', () => {
  const scanned: ReadonlyArray<[string, () => DraftRecordSet, string]> = [
    ['sealed', sealedRecords, BRIEF],
    ['unresolved-heavy', unresolvedHeavyRecords, BRIEF],
    ['clamp', clampRecords, BRIEF],
    ...levelFixtures,
  ];
  for (const [name, records, brief] of scanned) {
    it(`${name}: no code token, no hex id, in any open question`, async () => {
      const { result } = await build(records(), brief);
      const questions = openQuestionsForReply(result);
      expect(questions.length).toBeGreaterThan(0);
      for (const q of questions) {
        expect(q, q).not.toMatch(CODE_TOKEN);
        expect(q, q).not.toMatch(HEX_ID);
        expect(q, q).not.toMatch(/causal_links|missing_ref|ref_out_of_range|to_stated|to_claim|stated_items|claims\[/);
      }
    });
  }

  it('positive control: the compiler\'s own `detail`s on the unresolved-heavy draft DO carry code tokens the scan catches', async () => {
    const compiled = await replayRecordSet(unresolvedHeavyRecords(), { brief: BRIEF });
    if (!compiled.ok) throw new Error(compiled.detail);
    const kinds = new Set(compiled.ask.items.map((i) => i.kind));
    for (const kind of ['stated_link_unresolved', 'unresolved_reference', 'option_without_chain']) expect(kinds.has(kind as never), kind).toBe(true);
    expect(compiled.ask.items.some((i) => CODE_TOKEN.test(i.detail))).toBe(true);
    // And the user sentence for each names the item by its own words (the quote or label the item was pushed with).
    for (const item of compiled.ask.items) {
      const q = userQuestionForAskItem(item);
      for (const name of item.user?.names ?? []) if (name.trim() !== '' && item.kind !== 'no_chain_reaches_goal' && item.kind !== 'no_outcome_or_risk') expect(q).toContain(`"${name.trim()}"`);
    }
  });

  it('every ask kind has one plain sentence that quotes the item and carries no code token', () => {
    const kinds: Record<CompletionAskItem['kind'], true> = {
      unresolved_reference: true, illegal_shape: true, unconnected_record: true, option_without_chain: true, no_goal: true,
      constraint_target_unbindable: true, stated_link_unresolved: true, no_chain_reaches_goal: true, no_outcome_or_risk: true,
      options_indistinguishable: true,
    };
    for (const kind of Object.keys(kinds) as CompletionAskItem['kind'][]) {
      const names = kind === 'options_indistinguishable' ? ['Hire Two', 'Carry On'] : ['Cap spend at £50k'];
      const q = userQuestionForAskItem({ kind, user: { names, lacks: ['its current level'], missing: 'target' } });
      expect(q, kind).not.toMatch(CODE_TOKEN);
      expect(q, kind).toMatch(/\?$/);
      if (kind !== 'no_goal') expect(q, kind).toContain(`"${names[0]}"`);
      // An item with no words still gets a plain sentence, never an empty one or a `detail`.
      expect(userQuestionForAskItem({ kind }), kind).toMatch(/^[A-Z"].*\?$/);
    }
    expect(userQuestionForAskItem({ kind: 'option_without_chain', user: { names: ['Hire Two'] } }))
      .toBe('"Hire Two" doesn\'t change anything that leads to your goal yet. What would it change?');
    expect(userQuestionForAskItem({ kind: 'constraint_target_unbindable', user: { names: ['Cap spend at £50k'], missing: 'target' } }))
      .toBe('"Cap spend at £50k": Olumi couldn\'t tell what this limit applies to. Which factor or outcome does it limit?');
  });
});

// ── ITEM 4: asks vs invents ─────────────────────────────────────────────────────────────────────────────────────────
describe('#2576 item 4: for every limit on a quantity with no user level the reply ASKS, and every Olumi value is said as Olumi\'s', () => {
  for (const [name, records, brief] of [...levelFixtures, ['sealed', sealedRecords, BRIEF] as const, ['clamp', clampRecords, BRIEF] as const]) {
    it(`${name}`, async () => {
      const { result, graph } = await build(records(), brief);
      const questions = openQuestionsForReply(result);
      const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option');
      let checked = 0;
      for (const row of (graph.goal_constraints ?? []) as Rec[]) {
        const node = (graph.nodes as Rec[]).find((n) => n.id === row.node_id);
        if (node === undefined || node.kind !== 'factor') continue;
        const os = node.observed_state ?? {};
        const usersLevel = typeof os.raw_value === 'number' && !OLUMIS.has(classifyValueSource(os.source));
        const olumiSets = options.flatMap((o) => Object.entries((o.interventions ?? {}) as Rec)
          .filter(([factor, iv]) => factor === node.id && OLUMIS.has(classifyValueSource(iv?.source)) && typeof iv?.raw_value === 'number')
          .map(([, iv]) => iv));
        if (usersLevel && olumiSets.length === 0) continue;
        checked += 1;
        // The reply asks about this quantity, by its own name.
        const asked = questions.filter((q) => q.includes(`"${node.label}"`) && /\?/.test(q));
        expect(asked.length, `no ask for limited "${node.label}"`).toBeGreaterThan(0);
        // Every value Olumi supplied for it is said, and said as Olumi's.
        const unit = typeof os.unit === 'string' ? os.unit : '';
        const olumiValues = [...(!usersLevel && typeof os.raw_value === 'number' ? [{ value: os.raw_value, unit }] : []),
          ...olumiSets.map((iv) => ({ value: iv.raw_value as number, unit: typeof iv.unit === 'string' && iv.unit !== '' ? iv.unit : unit }))];
        for (const v of olumiValues) {
          expect(asked.some((q) => q.includes(sayFigure(v.value, v.unit)) && q.includes("Olumi's")), `${sayFigure(v.value, v.unit)} not said as Olumi's`).toBe(true);
        }
      }
      // The two level fixtures each hold exactly one such limit; the sealed/clamp briefs hold none (vacuity guard).
      expect(checked).toBe(name === 'limitedLevelAsks' || name === 'optionSetLimitAsks' ? 1 : 0);
    });
  }
});
