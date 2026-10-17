/**
 * ⛔ T1 HOST P11 (pilot 17 Oct, judges/T1-ATTRIBUTION.codex.md; outbox/LANE-A-T1-HOST-MAP.md row 7; DL-3 14:15Z): links the AI drew
 * with an UNKNOWN direction were withheld (a link cannot hold "unknown": GraphV3 `effect_direction`), and they disappeared: the
 * user's words about them were not recorded (a link record needs its edge) and the user was told only "3 relationship(s) were
 * left out". Now each is NAMED and ASKED, and the user's figure-free words about it stay on the link's source as its relation.
 * SYNTHETIC brief. Real path: `buildModelFromBrief` (scripted drafter) → `/graph/register` → the saved graph and the build result.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { sourceMapOf } from '../construction-source-map.js';
import { pressedRecord } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const AIM = 'We need to bring in at least £600k of new contract value this year.';
const SENTENCES = {
  describes: 'Nobody knows whether more referrals make our sales calls longer or shorter.',
  holds_now: 'Referrals already change how long our sales calls run.',
  point: 'Referrals would change our sales calls by about 5 minutes, but nobody knows which way.',
  range: 'Referrals would change our sales calls by between 4 and 6 minutes, but nobody knows which way.',
} as const;
type Form = keyof typeof SENTENCES;
const BRIEF = `${AIM} ${Object.values(SENTENCES).join(' ')} We could start a referral scheme.`;
const GOAL = 'New contract value';
const REF = 'Referrals';
const CALL = 'Sales call length';
const COUNT = 'Contracts signed';
const MORALE = 'Team morale';
const ABSENT = 'Customer mood';

function draft(opts: { readonly direction: 'unknown' | 'positive'; readonly field: 'relation' | 'effect'; readonly form: Form; readonly sourceKind?: 'factor' | 'outcome' }): Rec {
  const link = (from: string, to: string, direction = 'positive'): Rec => ({ from, to, direction, provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  const figure = opts.form === 'point' ? { value: 5, low: null, high: null, unit: 'minutes' }
    : opts.form === 'range' ? { value: null, low: 4, high: 6, unit: 'minutes' } : { value: null, low: null, high: null, unit: null };
  const source = opts.sourceKind === 'outcome' ? 'Referral volume' : REF;
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 600000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Start a referral scheme', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: REF, value: 20, value_kind: 'absolute', unit: 'referrals', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: REF, role: 'controllable', baseline_known: false, baseline_value: 5, unit: 'referrals', provenance: 'ai_proposed', plausible_max: 50 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: CALL, provenance: 'inferred', unit: 'minutes', plausible_max: 120 }, { label: COUNT, provenance: 'inferred', unit: 'contracts', plausible_max: 30 },
      ...(opts.sourceKind === 'outcome' ? [{ label: 'Referral volume', provenance: 'inferred', unit: 'referrals', plausible_max: 60 }] : [])],
    links: [link(REF, COUNT), link(COUNT, GOAL), link(source, CALL, opts.direction), link(CALL, COUNT, 'negative'),
      ...(opts.sourceKind === 'outcome' ? [link(REF, 'Referral volume')] : [])],
    statements: [
      { quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 600000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      { quote: SENTENCES[opts.form], subject: { kind: 'link', label: source, to_label: CALL, factor_label: null }, field: opts.field, form: opts.form,
        ...figure, qualifier: null, conditions: null },
    ],
  };
}
async function build(model: Rec): Promise<{ graph: Rec; out: Rec }> {
  let graph: Rec | undefined;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('7a7a7a7a-0000-4a7a-8a7a-7a7a7a7a7a7a', BRIEF, d, (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 600)).toBe(true);
  return { graph: graph!, out };
}
const nodeOf = (g: Rec, label: string): Rec => g.nodes.find((n: Rec) => n.label === label);
/** Every record in the saved graph that holds this sentence, as `node key`. */
const holders = (g: Rec, quote: string): string[] => g.nodes.flatMap((n: Rec) => (n.user_statements ?? [])
  .filter((r: Rec) => r.statements.some((s: Rec) => s.quote === quote)).map((r: Rec) => `${n.label} ${r.subject_key}`));

/** The user's words about a link, as the not-represented line carries them. */
const lineFor = (from: string, to: string, quote: string): string => `"${from}" → "${to}" ("${quote}", as the brief puts it)`;

type Fate = 'positive' | 'unknown' | 'loop' | 'missing';
/**
 * One case per fate of the link the words are about: kept (a direction), withheld for its UNKNOWN direction, withheld to break a
 * LOOP (its direction stated: a wrong withhold reason for the source fallback), or MISSING (an end the model does not hold: a
 * generic not-found). Returns the draft and the link the words are about.
 */
function scenario(fate: Fate, field: 'relation' | 'effect', form: Form, sourceKind: 'factor' | 'outcome'): { model: Rec; from: string; to: string } {
  const m = draft({ direction: fate === 'unknown' ? 'unknown' : 'positive', field, form, sourceKind });
  const source = sourceKind === 'outcome' ? 'Referral volume' : REF;
  const about = (from: string, to: string, extra: Partial<Rec> = {}): { model: Rec; from: string; to: string } => ({ from, to,
    model: { ...m, ...extra, statements: [m.statements[0], { ...m.statements[1], subject: { kind: 'link', label: from, to_label: to, factor_label: null } }] } });
  if (fate === 'loop') {
    // The admission cuts the link INTO the loop's lever end (probed): Referrals → Team morale (a factor source); Sales call length →
    // Referral volume (an outcome source). Each case asserts that withheld identity before it is read.
    return sourceKind === 'factor'
      ? about(REF, MORALE, { factors: [...m.factors, { label: MORALE, role: 'external', baseline_known: false, baseline_value: 5, unit: 'points',
        provenance: 'ai_proposed', plausible_max: 10 }], links: [...m.links, { ...m.links[0], from: REF, to: MORALE }, { ...m.links[0], from: MORALE, to: REF }] })
      : about(CALL, source, { links: [...m.links, { ...m.links[0], from: CALL, to: source }] });
  }
  return fate === 'missing' ? about(source, ABSENT) : about(source, CALL);
}

describe('a relationship nobody gave a direction is named, asked, and its words kept on its source', () => {
  it('⭐ RED → GREEN, real path: the link is named in the open question and the line; the user\'s words stay on its source as its relation', async () => {
    const { graph, out } = await build(draft({ direction: 'unknown', field: 'relation', form: 'describes' }));
    expect(graph.edges.some((e: Rec) => e.from === nodeOf(graph, REF).id && e.to === nodeOf(graph, CALL).id), 'the link is still left out').toBe(false);
    expect(out.open_questions).toContain(`Does "${REF}" raise or lower "${CALL}"? Nobody has said which way, so that link is left out of the model for now.`);
    expect(out.not_represented).toContain(`Left out until someone says which way they run: ${lineFor(REF, CALL, SENTENCES.describes)}.`);
    expect(holders(graph, SENTENCES.describes)).toEqual([`${REF} factor|${nodeOf(graph, REF).id}|||relation`]);
    // BUDDY-A 15:23Z AMEND 2: retention only. The record keeps the whole sentence, the full typed line and BOTH ends of the link it is
    // about, as Olumi's reading; it is construction's, never a press, and it puts no link, sign or effect in the model.
    const record = nodeOf(graph, REF).user_statements.find((r: Rec) => r.subject_key === `factor|${nodeOf(graph, REF).id}|||relation`);
    expect(record.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: SENTENCES.describes, source: BRIEF, form: 'describes',
      reading: 'olumi', subject: { quantity: `link|${REF.toLowerCase()}|${CALL.toLowerCase()}||relation` } })]);
    expect(record.attest).toEqual({ recorded_by: 'construction' });
    expect(pressedRecord(record), 'never read as the user\'s press').toBeUndefined();
  });

  it('⭐ SWEEP (DL-3 14:28Z; BUDDY-A 15:23Z AMEND 1–3): link fate × field × form × source kind — words go where the model can hold them, only a link withheld for its UNKNOWN direction falls back to its source, figures never move', async () => {
    const wrong: string[] = [];
    const tally = { link: 0, source: 0, none: 0, loop: 0, missing: 0 };
    for (const fate of ['positive', 'unknown', 'loop', 'missing'] as const) for (const field of ['relation', 'effect'] as const)
      for (const form of Object.keys(SENTENCES) as Form[]) for (const sourceKind of ['factor', 'outcome'] as const) {
        const { model, from: fromLabel, to: toLabel } = scenario(fate, field, form, sourceKind);
        const verifies = (sourceMapOf([model.statements[1]], BRIEF).verified.size) > 0;
        const { graph, out } = await build(model);
        const from = nodeOf(graph, fromLabel).id, to = nodeOf(graph, toLabel)?.id;
        const at = `${fate} ${field} ${form} ${sourceKind}`;
        // Preconditions, by identity: each fate is the one named.
        if (fate === 'loop' && !(out.withheld ?? []).some((w: Rec) => w.from === from && w.to === to && w.reason === 'loop_closing_link')) wrong.push(`${at}: not loop-withheld`);
        if (fate === 'missing' && to !== undefined) wrong.push(`${at}: "${ABSENT}" is in the model`);
        const figureFree = form === 'describes' || form === 'holds_now';
        const sourceIsFactor = nodeOf(graph, fromLabel).kind === 'factor';
        // An outcome has no door subject of its own (NODE_KIND: goal, factor, option, risk): BLOCKED-SCHEMA; its words go to the line.
        const expected = !verifies ? []
          : fate === 'positive' ? [`${fromLabel} link|${from}|${to}||${field}`]
          : fate === 'unknown' && figureFree && sourceIsFactor ? [`${fromLabel} factor|${from}|||relation`] : [];
        tally[expected.length === 0 ? 'none' : fate === 'positive' ? 'link' : 'source'] += 1;
        if (verifies && sourceIsFactor && (fate === 'loop' || fate === 'missing')) tally[fate] += 1;
        const got = holders(graph, SENTENCES[form]);
        if (JSON.stringify(got) !== JSON.stringify(expected)) wrong.push(`${at}: ${JSON.stringify(got)} ≠ ${JSON.stringify(expected)}`);
        // The line carries the user's words about a link withheld for its unknown direction, and only about one.
        const line = (out.not_represented ?? []).find((l: string) => l.startsWith('Left out until someone says which way they run:')) ?? '';
        const carried = line.includes(lineFor(fromLabel, toLabel, SENTENCES[form]));
        if (carried !== (fate === 'unknown' && verifies)) wrong.push(`${at}: line ${JSON.stringify(line)}`);
      }
    expect(wrong).toEqual([]);
    // Not vacuous: every fate is reached, and the wrong-reason contrasts hold figure-free words on a FACTOR source.
    expect(Math.min(tally.link, tally.source, tally.none), JSON.stringify(tally)).toBeGreaterThan(1);
    expect(Math.min(tally.loop, tally.missing), JSON.stringify(tally)).toBeGreaterThan(1);
  }, 60_000);

  it('an outcome source has no door subject (BLOCKED-SCHEMA): its words are kept in the existing not-represented line, and the link is still named and asked', async () => {
    const { graph, out } = await build(draft({ direction: 'unknown', field: 'relation', form: 'describes', sourceKind: 'outcome' }));
    expect(holders(graph, SENTENCES.describes)).toEqual([]);
    expect(out.not_represented).toContain(`Left out until someone says which way they run: ${lineFor('Referral volume', CALL, SENTENCES.describes)}.`);
    expect(out.open_questions).toContain(`Does "Referral volume" raise or lower "${CALL}"? Nobody has said which way, so that link is left out of the model for now.`);
  });

  it('CONTRAST: a link left out only to break a LOOP (its direction stated) is never asked which way it runs', async () => {
    const m = draft({ direction: 'positive', field: 'relation', form: 'describes' });
    const loop = { ...m, links: [...m.links, { ...m.links[0], from: COUNT, to: REF }] };
    const { out } = await build(loop);
    expect(JSON.stringify(out.withheld ?? []), 'a loop link is withheld').toContain('loop_closing_link');
    expect((out.open_questions ?? []).some((q: string) => q.includes('raise or lower'))).toBe(false);
    expect((out.not_represented ?? []).some((l: string) => l.startsWith('Left out until someone says which way they run:'))).toBe(false);
  });

  it('CONTRAST: a link WITH a direction keeps its own record and is not asked about', async () => {
    const { graph, out } = await build(draft({ direction: 'positive', field: 'relation', form: 'describes' }));
    expect(holders(graph, SENTENCES.describes)).toEqual([`${REF} link|${nodeOf(graph, REF).id}|${nodeOf(graph, CALL).id}||relation`]);
    expect((out.open_questions ?? []).some((q: string) => q.includes('raise or lower'))).toBe(false);
  });
});
