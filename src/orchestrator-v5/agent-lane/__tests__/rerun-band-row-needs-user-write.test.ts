/**
 * ⛔ S7 SAYS "YOU CHANGED" FOR A BAND MOVE ONLY WHEN THE USER WROTE THAT LINK IN THE PAIR (cut 6; DL 0df0e1 + Science d5
 * 6009444385 / 6009456901, 6 Oct). A band is read on the frames, and Olumi moves frames: #2631's refit widens a node's
 * frame for the user's stated size, and a goal's level re-frames every user-sized link into it. The link's natural size
 * stays put, so the band move is the frame's, never the user's change.
 *
 * FIXTURES (the Integrator's, measured on #2631 @41a5fc53, see each file's `_provenance`): the user states one link's
 * size; the refit moves a SIBLING's band. Served S7 said "You changed how much …" for that sibling.
 * (1) Truth floor, live today: a band row is "You changed" only with a recorded user link-write receipt for that link,
 *     written between the two Runs and moving it between the pair's own means (`userWrittenLinksForRunPair`); otherwise the
 *     row goes unsaid and is counted (never "Nothing else changed").
 * (2) When both Runs recorded the link's natural size (`natural_effect`, written from cut 7) and it is equal, the band
 *     move is no row at all (`diffRunInputs`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { rerunExplanationPlan } from '../rerun-explanation.js';
import { diffRunInputs } from '../../coaching/run-input-changes.js';
import { userWrittenLinksForRunPair } from '../../coaching/build-run-delta.js';

type Rec = Record<string, any>;
type Pair = { edited: string; labels: Record<string, string>; s1: Rec; s2: Rec; natural_effects: Record<string, [Rec | null, Rec | null]> };
const load = (name: string): Pair => JSON.parse(readFileSync(new URL(`./fixtures/s5t-refit-pair-${name}.json`, import.meta.url), 'utf8')) as Pair;
const INVESTOR = load('investor');
const J3RW = load('j3rw');
const SIBLING = {
  investor: 'integration_step_abandonment_rate->quarterly_revenue',
  j3rw: 'customers_lost_to_price_rise->monthly_recurring_revenue',
} as const;

const key = (r: Rec) => `${r.link?.from}->${r.link?.to}`;
const strengthRows = (rows: readonly Rec[]) => rows.filter((r) => r.entity_kind === 'link' && r.field === 'strength').map(key);
const sentenceFor = (p: Pair, k: string) => {
  const [from, to] = k.split('->');
  return `how much ${p.labels[from!]} changes ${p.labels[to!]}`;
};
const planLine = (p: Pair, userWritten: ReadonlySet<string>, rows = diffRunInputs(p.s1 as never, p.s2 as never)) => {
  const plan = rerunExplanationPlan({ input_changes: rows.rows, input_coverage: rows.complete ? 'complete' : 'partial', attribution_case: 'C2_unpaired' },
    (id) => p.labels[id], [], false, [], [], userWritten);
  return plan!.codeLine;
};

describe('PRECONDITION: the refit moves an untouched sibling\'s band; its natural size is byte-equal', () => {
  it.each([['investor', INVESTOR], ['j3rw', J3RW]] as const)('%s', (name, p) => {
    const sib = SIBLING[name];
    expect(sib).not.toBe(p.edited);
    expect(strengthRows(diffRunInputs(p.s1 as never, p.s2 as never).rows)).toContain(sib);
    const [before, after] = p.natural_effects[sib]!;
    expect(before).not.toBeNull();
    expect(after).toStrictEqual(before);
  });
});

describe('(1) the truth floor: no receipt in the pair → never "You changed" for a band move', () => {
  it.each([['investor', INVESTOR], ['j3rw', J3RW]] as const)('⭐ %s: the refit sibling is not narrated as the user\'s change', (name, p) => {
    const line = planLine(p, new Set([p.edited]));
    expect(line).not.toContain(`You changed ${sentenceFor(p, SIBLING[name])}`);
    // Unsaid, and counted: the line never claims nothing else differed.
    expect(line).not.toMatch(/Nothing you entered changed/u);
  });

  it('⭐ CONTRAST (j3rw): the user\'s OWN band edit, with its receipt, still says "You changed"', () => {
    const line = planLine(J3RW, new Set([J3RW.edited]));
    expect(line).toContain('You changed how much Price rise changes Customers lost to price rise: very_strong → strong.');
  });

  it('the same edit WITHOUT its receipt in the pair goes unsaid too (the receipt is what licenses "You")', () => {
    expect(planLine(J3RW, new Set())).not.toContain(`You changed ${sentenceFor(J3RW, J3RW.edited)}`);
  });

  it('investor: the edited link\'s sizing row still says the user\'s own estimate (a sizing move is its own evidence)', () => {
    expect(planLine(INVESTOR, new Set())).toContain('You gave your own estimate for how much Enterprise win rate changes quarterly revenue: strong → very_strong.');
  });
});

describe('the receipt binding (`userWrittenLinksForRunPair`), on the j3rw pair', () => {
  const T1 = '2026-10-06T03:00:00.000Z';
  const T2 = '2026-10-06T03:10:00.000Z';
  const run = (id: string, at: string, snapshot: Rec): HandlerFact => ({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: '11111111-1111-4111-8111-111111111111', leading_option_id: null, summary: 's', run_id: id, computed_at: at, input_snapshot: snapshot },
  } as unknown as HandlerFact);
  const facts = [run('run_1', T1, J3RW.s1), run('run_2', T2, J3RW.s2)];
  const delta = () => {
    const d = diffRunInputs(J3RW.s1 as never, J3RW.s2 as never);
    return { endpoints: { prior: { run_id: 'run_1' }, current: { run_id: 'run_2' } }, input_coverage: d.complete ? 'complete' : 'partial', input_changes: d.rows };
  };
  const meanOf = (s: Rec, k: string) => (s.links as Rec[]).find((l) => `${l.from}->${l.to}` === k)!.mean as number;
  const receipt = (k: string, before: number, after: number) => ({
    fact_type: 'adjust_edge_strength', fact_version: 1, noop: false,
    result: { status: 'applied', target_id: k.replace('->', '→'), before: { strength: { mean: before } }, after: { strength: { mean: after } } },
  } as unknown as HandlerFact);
  const edited = J3RW.edited;
  const own = receipt(edited, meanOf(J3RW.s1, edited), meanOf(J3RW.s2, edited));

  it('⭐ a receipt between the Runs for the pair\'s own means → that link only (never the refit sibling)', () => {
    expect(userWrittenLinksForRunPair(facts, delta(), [{ fact: own, created_at: '2026-10-06T03:05:00.000Z' }])).toEqual([edited]);
  });
  it('the same receipt BEFORE the prior Run → none', () => {
    expect(userWrittenLinksForRunPair(facts, delta(), [{ fact: own, created_at: '2026-10-06T02:59:00.000Z' }])).toEqual([]);
  });
  it('a receipt for other means (another move of the link) → none', () => {
    const other = receipt(edited, 0.1, 0.2);
    expect(userWrittenLinksForRunPair(facts, delta(), [{ fact: other, created_at: '2026-10-06T03:05:00.000Z' }])).toEqual([]);
  });
  it('⭐ two user edits between the Runs that chain prior mean → current mean → that link (buddy r1 P2-1), in any input order', () => {
    const m1 = meanOf(J3RW.s1, edited); const m2 = meanOf(J3RW.s2, edited); const mid = (m1 + m2) / 2;
    const first = { fact: receipt(edited, m1, mid), created_at: '2026-10-06T03:03:00.000Z' };
    const second = { fact: receipt(edited, mid, m2), created_at: '2026-10-06T03:06:00.000Z' };
    expect(userWrittenLinksForRunPair(facts, delta(), [first, second])).toEqual([edited]);
    expect(userWrittenLinksForRunPair(facts, delta(), [second, first])).toEqual([edited]);
  });
  it('a chain with a gap (something else moved the link between two edits) → none', () => {
    const m1 = meanOf(J3RW.s1, edited); const m2 = meanOf(J3RW.s2, edited); const mid = (m1 + m2) / 2;
    const first = { fact: receipt(edited, m1, mid), created_at: '2026-10-06T03:03:00.000Z' };
    const second = { fact: receipt(edited, mid + 0.05, m2), created_at: '2026-10-06T03:06:00.000Z' };
    expect(userWrittenLinksForRunPair(facts, delta(), [first, second])).toEqual([]);
  });
  it('a matching write beside an EARLIER one that does not chain (the link was moved by something else in between) → none', () => {
    const stray = { fact: receipt(edited, 0.3, 0.4), created_at: '2026-10-06T03:02:00.000Z' };
    expect(userWrittenLinksForRunPair(facts, delta(), [stray, { fact: own, created_at: '2026-10-06T03:05:00.000Z' }])).toEqual([]);
  });
  it('⭐ a CLAMPED link (Run 1 restored β 1.2 from clamped_from; persisted 1): the user\'s 1 → after write is theirs (buddy r1 P2-2)', () => {
    const s1 = structuredClone(J3RW.s1);
    (s1.links as Rec[]).find((l) => `${l.from}->${l.to}` === edited)!.mean = 1.2;
    const clampedFacts = [run('run_1', T1, s1), run('run_2', T2, J3RW.s2)];
    const write = { fact: receipt(edited, 1, meanOf(J3RW.s2, edited)), created_at: '2026-10-06T03:05:00.000Z' };
    expect(userWrittenLinksForRunPair(clampedFacts, delta(), [write])).toEqual([edited]);
    // CONTROL: the same receipt against an unclamped Run-1 mean that is not 1 → none.
    const s1b = structuredClone(J3RW.s1);
    (s1b.links as Rec[]).find((l) => `${l.from}->${l.to}` === edited)!.mean = 0.9;
    expect(userWrittenLinksForRunPair([run('run_1', T1, s1b), run('run_2', T2, J3RW.s2)], delta(), [write])).toEqual([]);
  });
  it('a pair whose Runs cannot be read → none (fail closed)', () => {
    expect(userWrittenLinksForRunPair([], delta(), [{ fact: own, created_at: '2026-10-06T03:05:00.000Z' }])).toEqual([]);
  });
});

describe('(2) both Runs recorded an equal natural size → the band move is no row at all', () => {
  /** Each snapshot link carries the natural size its edge held (the 0.78 member the cut-7 writer records). */
  const withNaturalEffects = (p: Pair, side: 0 | 1): Rec => {
    const s = structuredClone(side === 0 ? p.s1 : p.s2);
    for (const l of s.links as Rec[]) {
      const ne = p.natural_effects[`${l.from}->${l.to}`]?.[side];
      if (ne) l.natural_effect = ne;
    }
    return s;
  };

  it.each([['investor', INVESTOR], ['j3rw', J3RW]] as const)('⭐ %s: the sibling has no strength row; the edited link keeps its rows', (name, p) => {
    const d = diffRunInputs(withNaturalEffects(p, 0) as never, withNaturalEffects(p, 1) as never);
    expect(strengthRows(d.rows)).not.toContain(SIBLING[name]);
    expect(d.rows.filter((r: Rec) => key(r) === p.edited).map((r: Rec) => r.field)).toEqual(expect.arrayContaining(['strength', 'effect']));
    // Coverage is unchanged by the drop: the sibling's mean moved with no row stating it.
    expect(d.complete).toBe(false);
  });

  it.each([
    ['unit', { amount_unit: '£/week' }],
    ['source change', { per_source_change: 2 }],
    ['source-change unit', { per_source_change_unit: 'percentage points' }],
  ])('the same amount with a different %s is a different size → the sibling\'s band row stays', (_name, diff) => {
    const after = withNaturalEffects(J3RW, 1);
    const l = (after.links as Rec[]).find((x) => `${x.from}->${x.to}` === SIBLING.j3rw)!;
    l.natural_effect = { ...l.natural_effect, ...diff };
    expect(strengthRows(diffRunInputs(withNaturalEffects(J3RW, 0) as never, after as never).rows)).toContain(SIBLING.j3rw);
  });

  it('CONTROL: the same pair WITHOUT natural sizes keeps the sibling\'s band row (the drop needs both ends)', () => {
    expect(strengthRows(diffRunInputs(J3RW.s1 as never, J3RW.s2 as never).rows)).toContain(SIBLING.j3rw);
  });
});
