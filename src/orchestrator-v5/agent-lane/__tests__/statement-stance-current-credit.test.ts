/**
 * ⭐ STANCE: ONLY A DECLARED CURRENT FIGURE IS CREDITED AS THE USER'S CURRENT LEVEL (DL-3 steer 19 Oct; AIE ask #94 6270168415;
 * approach prompt/STANCE-FIELD/APPROACH-v2.md). Synthetic brief HS3: "Suppose we hired 8 temporary pickers who each packed 25 orders
 * a day." Measured on real drafts + the real admission (hypothetical-n8): the supposed 25 was saved as the factor's current level,
 * credited as the user's, in 4/24 head and 3/24 base drafts. The drafter now DECLARES each figure's stance; the host credits a
 * current level only on `stated_current`, after its existing literal checks. Real buildModelFromBrief + admission; the provider
 * output is the recorded raw (0 calls).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { USER_STATEMENTS_KEY, userStatementRecordOf } from '../../statement-door/statements.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/stance-hs3-raw.json', import.meta.url), 'utf8')) as { brief: string; raw: Rec };
const SID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';

/** What the last build said it left out (a failing row's message). */
let said: string[] = [];
async function admit(raw: Rec, brief = FX.brief): Promise<Rec> {
  let graph: Rec | undefined; let n = 0;
  const result = await buildModelFromBrief(SID, brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'scratch' } };
  }) as never, (async () => { n += 1; return { text: n === 1 ? JSON.stringify(raw) : JSON.stringify({ options: [], risks: [] }) }; }) as never);
  expect((result as Rec).ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  said = ((result as Rec).not_represented ?? []) as string[];
  return graph!;
}
const node = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((x) => x.label === label)!;
/** Credited as the user's CURRENT level: the verified-current stamp on the value (the entity's own provenance is a different claim). */
const credited = (n: Rec): boolean => n.observed_state?.source === 'brief_extraction';

describe('a figure is credited as the user\'s current level only when its statement declares it current', () => {
  it('RED: the declared-hypothetical 25 per temporary picker is never credited as a current level; the declared-current 1,150 and 30 stay credited', async () => {
    const g = await admit(structuredClone(FX.raw));
    const rate = node(g, 'Orders packed per temporary picker per day');
    expect(credited(rate), JSON.stringify(rate)).toBe(false);
    // Kept visible and the user's, as THEIR assumption (AIE label decision): the figure is not dropped and never Olumi's estimate.
    expect(rate.observed_state).toMatchObject({ raw_value: 25, source: 'user_assumption' });
    expect(rate.observed_state.reviewed_by_user).toBeUndefined();
    // Positive controls, same sentence family: the brief's own current figures stay the user's.
    expect(credited(node(g, 'Warehouse staff'))).toBe(true);
    expect((g.nodes as Rec[]).find((x) => x.kind === 'goal')!.observed_state?.raw_value ?? null).not.toBe(25);
  }, 120_000);

  it('RED: a statement-backed figure with NO declared stance is not credited as a current level (fail closed)', async () => {
    const raw = structuredClone(FX.raw);
    for (const s of raw.statements as Rec[]) if (s.value === 25) delete s.stance;
    const rate = node(await admit(raw), 'Orders packed per temporary picker per day');
    expect(credited(rate), JSON.stringify(rate)).toBe(false);
    // Not invented as an assumption either: no declaration, the existing unverified path (visible, unknown role).
    expect(rate.observed_state?.source).not.toBe('user_assumption');
  }, 120_000);

  it('CONTROL: the same figure declared stated_current is credited (the gate reads the declaration, not the sentence\'s words)', async () => {
    const raw = structuredClone(FX.raw);
    for (const s of raw.statements as Rec[]) if (s.value === 25) s.stance = 'stated_current';
    const rate = node(await admit(raw), 'Orders packed per temporary picker per day');
    expect(credited(rate), JSON.stringify(rate)).toBe(true);
  }, 120_000);
  it('RED: the goal\'s level declared a supposition is never the user\'s current level of the goal; declared current, it is', async () => {
    const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((x) => x.kind === 'goal')!;
    expect(credited(goalOf(await admit(structuredClone(FX.raw)))), 'control: declared current').toBe(true);
    const raw = structuredClone(FX.raw);
    for (const s of raw.statements as Rec[]) if (s.subject.kind === 'goal' && s.field === 'level') s.stance = 'hypothetical';
    expect(credited(goalOf(await admit(raw)))).toBe(false);
  }, 120_000);

  it('RED: a CHANGE goal measured from a level declared a supposition has no user base; declared current, it does', async () => {
    // Synthetic: today's level written once, the target a change from it. The change path reads that level apart from the level
    // path, so it needs the same declaration; the words "Suppose we…" are the drafter's to classify, never the host's.
    const LEVEL = 'Suppose we ship 1,150 orders a day.';
    const brief = `${LEVEL} We want to grow that by a fifth before peak season.`;
    const asChange = (stance: string): Rec => {
      // The draft's "Current orders a day" would hold the same 1,150 as another quantity; named apart, the level is the goal's alone.
      const raw = JSON.parse(JSON.stringify(FX.raw).split('Current orders a day').join('Base packing output')) as Rec;
      Object.assign(raw.goal, { frame: 'change_rel', value: 20, unit: 'orders a day', source_quote: brief, deadline_words: brief });
      raw.statements = (raw.statements as Rec[]).filter((st) => st.subject.kind === 'goal' && st.field === 'level')
        .map((st) => ({ ...st, quote: LEVEL, stance }));
      return raw;
    };
    const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((x) => x.kind === 'goal')!;
    const current = goalOf(await admit(asChange('stated_current'), brief));
    expect(current.goal_threshold_frame, 'control: the change is admitted').toBe('change_rel');
    expect(credited(current), `control: declared current ${JSON.stringify(said.filter((x) => x.includes('orders a day')))}`).toBe(true);
    const supposed = goalOf(await admit(asChange('hypothetical'), brief));
    expect(supposed.goal_threshold_frame).toBe('change_rel');
    expect(credited(supposed), JSON.stringify(supposed.observed_state)).toBe(false);
  }, 120_000);

  it('each figure by its own declaration: in ONE sentence, the staff declared a supposition is not credited, the orders declared current are', async () => {
    const raw = structuredClone(FX.raw);
    for (const st of raw.statements as Rec[]) if (st.subject.label === 'Warehouse staff') st.stance = 'hypothetical';
    const g = await admit(raw);
    expect(credited(node(g, 'Warehouse staff'))).toBe(false);
    expect(credited((g.nodes as Rec[]).find((x) => x.kind === 'goal')!)).toBe(true);
  }, 120_000);

  it('the user\'s supposition the drafter tagged its own estimate stays the user\'s assumption, never Olumi\'s estimate', async () => {
    const raw = structuredClone(FX.raw);
    for (const f of raw.factors as Rec[]) if (f.baseline_value === 25) Object.assign(f, { provenance: 'ai_proposed', baseline_known: false });
    const rate = node(await admit(raw), 'Orders packed per temporary picker per day');
    expect(rate.observed_state, JSON.stringify(rate)).toMatchObject({ raw_value: 25, source: 'user_assumption' });
  }, 120_000);

  it('RED: the declared stance survives save and readback: the saved claim holds it, and the one stored-claim reader returns it', async () => {
    // The bytes the register call saved, through the stored schema and back, then read by the reader every later turn uses.
    const saved = JSON.parse(JSON.stringify(GraphV3.parse(await admit(structuredClone(FX.raw))))) as Rec;
    const stancesOn = (label: string): unknown[] => ((node(saved, label)[USER_STATEMENTS_KEY] ?? []) as unknown[])
      .flatMap((r) => userStatementRecordOf(r)?.statements ?? []).map((st) => st.stance);
    expect(stancesOn('Orders packed per temporary picker per day')).toEqual(['hypothetical']);
    expect(stancesOn('Warehouse staff')).toEqual(['stated_current']);
  }, 120_000);

  it('CONTROL: an option\'s setting stated inside the supposition stays the user\'s setting (a what-if is what an option is)', async () => {
    const g = await admit(structuredClone(FX.raw));
    const option = (g.nodes as Rec[]).find((x) => x.kind === 'option' && /temporary pickers/i.test(String(x.label)))!;
    const setting = Object.values(option.interventions as Record<string, Rec>)[0]!;
    expect(setting).toMatchObject({ raw_value: 8, source: 'brief_extraction' });
  }, 120_000);
});
