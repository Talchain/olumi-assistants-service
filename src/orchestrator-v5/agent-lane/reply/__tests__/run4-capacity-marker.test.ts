/**
 * Score run 4 U2-1 (DL 12 Oct, R4): "Not shown yet; why is under More detail" pointed at nothing.
 *  - capacity 1 shipped whole (no "More detail" exists), the marker as a paragraph of its own;
 *  - capacity 2 put the marker on the face, and its detail never said why;
 *  - capacity 3 put the marker on the face, and the why sat below it.
 * The withheld option's one reason is typed ('reference_moved', a cause the face has no fixed words for). Rule: for one
 * such reason, the face carries that reason's own words, once; no marker ever ships in a reply with no "More detail".
 * Label, never withhold: the reason is said, never dropped.
 *
 * The corpus is the served replies (`fixtures/run4-capacity-marker.json`: run 4 on CEE a770ce49 = B), sha-pinned, with
 * the served composer's own log line (Render, `agent_lane.reply_shaped`, by request id). Each input is rebuilt the way the
 * route passes it (`agent-v1-turn.ts` composeReplyShape): the reply less the lines the composer adds (H/W/E and the
 * marker; the horizon line it moves to detail), the screen line's typed evidence, the host lines, and the Run's cells.
 * On the composer BEFORE this change each reproduces its served reply byte for byte, so the RED rows below are the served
 * behaviour, not a model of it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fx from './fixtures/run4-capacity-marker.json';
import { composeReplyShape, HORIZON_MARKER, WITHHOLD_FALLBACK_MARKER, type FaceObligation, type ReplyComposition } from '../compose-reply.js';
import { RUN_RESULT_READY_TEXT } from '../../run-explanation.js';

type Rec = Record<string, any>;
const cases = fx.cases as unknown as Record<string, Rec>;
const REASON = 'Not shown: this run’s result for carrying on as now doesn’t match ‘Weekly support capacity’ as it stands today in the model, so it needs checking first.';
const ESTIMATES = "Olumi's estimates: 3, see Check estimates.";
const HORIZON_LINE = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";
const WHAT_CHANGES = 'What would change it: how strongly ‘Additional specialist capacity’ affects ‘Weekly support capacity’.';
const WHY = "Decisions framed with a single alternative ('whether or not') fail more often than ones with real alternatives; generating options before evaluating is a core decision-quality step.";
const CHANCE = '‘Add one specialist’: about 36% chance of meeting your goal, in this model, using Olumi\'s estimates for 3 relationships (see Check estimates).';
const DEPENDS = 'It rests most on Olumi’s own estimate of how strongly ‘Additional specialist capacity’ affects ‘Weekly support capacity’: if that effect is weaker than Olumi assumed, the chance falls. Is that estimate right?';
const PROVISIONAL = 'Provisional: this result uses inputs whose sources have not been verified.';
const SPECIALISTS = '"Additional specialists": Not confirmed from your brief These are factor starting values on the comparison’s paths. Other model assumptions may also affect the result.';
const ADD_TWO = '‘Add two specialists’ is Olumi’s suggestion, so it was left out of this comparison until you add it.';

/** The screen line's typed evidence, as `agent-v1-turn.ts` writes it for the option with a figure. */
const SCREEN: FaceObligation[] = [
  { role: 'evidence', text: `${CHANCE} ${DEPENDS}`, lead: true, subjects: ['add_one_specialist'] },
  { role: 'evidence', text: CHANCE, lead: true, subjects: ['add_one_specialist'] },
  { role: 'evidence', text: DEPENDS, subjects: ['add_one_specialist'], companionOf: 'add_one_specialist' },
];
const paras = (text: string): string[] => text.split('\n\n');
const without = (text: string, lines: string[]): string => paras(text).filter((p) => !lines.includes(p)).join('\n\n');

/** Each served turn's composer input, rebuilt from its captured body. */
function inputOf(name: string): Rec {
  const c = cases[name]!;
  const base = { chanceCells: c.chance_cells, graph: { nodes: c.graph_nodes, edges: [] }, profile: 'coaching', typedControlQuestions: [] };
  if (name === 'capacity_01') {
    // The first-analysis Draft: the composer added E and the marker before the open-questions segment.
    return { ...base, faceContract: 'draft', estimatesLine: ESTIMATES, obligations: SCREEN,
      text: without(c.assistant_text, [ESTIMATES, WITHHOLD_FALLBACK_MARKER]) };
  }
  const s = c.served_shape as Rec;
  const detail = paras(String(s.detail)).filter((p) => ![WHAT_CHANGES, ESTIMATES, HORIZON_LINE, `Why? ${WHY}`].includes(p));
  const run = { ...base, faceContract: 'run', horizonLine: HORIZON_LINE, whatChanges: WHAT_CHANGES, estimatesLine: ESTIMATES };
  if (name === 'capacity_02') {
    // The uninterpreted Run: host lines only (no provider call, so no intervention).
    return { ...run, text: [s.headline, ...detail].join('\n\n'),
      obligations: [...SCREEN, ...[RUN_RESULT_READY_TEXT, SPECIALISTS, PROVISIONAL].map((text): FaceObligation => ({ role: 'host', text }))] };
  }
  // The Explain: the narrator's words, then the owed host lines; the narrator's call carries the RC-WIDEN Why.
  return { ...run, text: [...detail.slice(0, 3), s.headline, ...detail.slice(3)].join('\n\n'),
    obligations: [...SCREEN, ...[REASON, SPECIALISTS, PROVISIONAL, ADD_TWO].map((text): FaceObligation => ({ role: 'host', text }))],
    eligibleIntervention: { policy_id: 'RC-WIDEN', variant_id: 'W2', name: 'Widen the options', why: WHY, trigger: 'served' },
    interventionActionLabel: c.guidance_slot1.primary_action.label };
}
const compose = (name: string): ReplyComposition => composeReplyShape(inputOf(name) as never);
const faceOf = (c: ReplyComposition): string => (c.shape === null ? c.text : [c.shape.headline, ...c.shape.bullets].join('\n'));
const count = (text: string, s: string): number => text.split(s).length - 1;

describe('IDENTITY: run 4 capacity steps 1–3, as served', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name}: sha-pinned; its one withheld reason is typed 'reference_moved', in these words`, () => {
      expect(createHash('sha256').update(String(c.assistant_text)).digest('hex')).toBe(c.text_sha256);
      const withheld = (c.chance_cells as Rec[]).filter((cell) => cell.kind === 'withheld');
      expect(withheld.map((cell) => cell.reasons.map((r: Rec) => [r.code, r.message]))).toEqual([[['reference_moved', REASON]]]);
      expect(String(c.assistant_text)).toContain(WITHHOLD_FALLBACK_MARKER);
    });
  }
  it('capacity_01 shipped whole (served log: kept_whole, obligation_unlocated): there is no "More detail"', () => {
    expect([cases.capacity_01!.served_log.outcome, cases.capacity_01!.served_log.reason, cases.capacity_01!.served_shape]).toEqual(['kept_whole', 'obligation_unlocated', null]);
  });
  it('capacity_02: the marker is on the face, and nothing below says why', () => {
    const s = cases.capacity_02!.served_shape as Rec;
    expect(s.bullets).toContain(WITHHOLD_FALLBACK_MARKER);
    expect(s.detail).not.toContain(REASON);
  });
  it('capacity_03: the marker is on the face; the why sits below it', () => {
    const s = cases.capacity_03!.served_shape as Rec;
    expect(s.bullets).toContain(WITHHOLD_FALLBACK_MARKER);
    expect(s.detail).toContain(REASON);
  });
});

describe('U2-1: one typed reason the face has no fixed words for is said on the face in its own words, once', () => {
  for (const name of ['capacity_01', 'capacity_02', 'capacity_03']) {
    it(`${name}: no marker; the reason's own words on the face, once in the whole reply`, () => {
      const out = compose(name);
      expect(out.text).not.toContain(WITHHOLD_FALLBACK_MARKER);
      expect(faceOf(out)).toContain(REASON);
      expect(count(out.text, REASON), 'said once').toBe(1);
    });
  }
  it('capacity_02/03: the chance stays the headline; the horizon marker stays on the face; the reason sits beside it', () => {
    for (const name of ['capacity_02', 'capacity_03']) {
      const shape = compose(name).shape!;
      expect(shape.headline).toBe(`${CHANCE} ${DEPENDS}`);
      expect(shape.bullets).toEqual([HORIZON_MARKER, REASON]);
    }
  });
  it('capacity_01: shipped whole as before, with the reason where the marker stood (before the questions segment)', () => {
    const out = compose('capacity_01');
    expect(out.shape).toBeNull();
    expect(out.text).toBe(String(cases.capacity_01!.assistant_text).replace(WITHHOLD_FALLBACK_MARKER, REASON));
  });
  it('nothing else moves: every other served line keeps its place (capacity_02/03 detail as served, less the reason)', () => {
    for (const name of ['capacity_02', 'capacity_03']) {
      const served = cases[name]!.served_shape as Rec;
      expect(compose(name).shape!.detail).toBe(paras(String(served.detail)).filter((p) => p !== REASON).join('\n\n'));
    }
  });
});

/** Design (the class, not only the served instance): a second withheld option, in the licence's own line for it. */
const SECOND = '‘Add two specialists’: Olumi can’t yet say its chance of meeting your goal, in this model.';
const withSecond = (name: string): Rec => {
  const input = inputOf(name);
  return { ...input, chanceCells: [...input.chanceCells, { kind: 'withheld', reasons: [{ code: 'option_not_licensed', message: null }],
    face: 'Chance not shown yet', why: SECOND }] };
};
const straight = (text: string): string => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

describe('U2-1, the class: the pointer never points at nothing, and never ships in a whole reply', () => {
  it('several reasons, shaped (capacity_02 with a second withheld option): the pointer stays on the face, and each reason is said below it, once', () => {
    const out = composeReplyShape(withSecond('capacity_02') as never);
    expect(out.shape!.bullets).toContain(WITHHOLD_FALLBACK_MARKER);
    for (const why of [REASON, SECOND]) {
      expect(out.shape!.detail, why).toContain(why);
      expect(count(out.text, why), `${why}: said once`).toBe(1);
    }
  });
  it('several reasons, whole (capacity_01 with a second withheld option): no pointer; each reason is in the reply, once', () => {
    const out = composeReplyShape(withSecond('capacity_01') as never);
    expect(out.shape).toBeNull();
    expect(out.text).not.toContain(WITHHOLD_FALLBACK_MARKER);
    for (const why of [REASON, SECOND]) expect(count(out.text, why), `${why}: said once`).toBe(1);
  });
  it('a reason the reply already wrote with straight quotes (capacity_03\'s host line, design glyphs) is that face line, said once', () => {
    const input = inputOf('capacity_03');
    const written = straight(REASON);
    const out = composeReplyShape({ ...input, text: input.text.replace(REASON, written),
      obligations: input.obligations.map((o: FaceObligation) => (o.text === REASON ? { ...o, text: written } : o)) } as never);
    expect(out.shape!.bullets).toEqual([HORIZON_MARKER, written]);
    expect(count(straight(out.text), written), 'said once, whatever its glyphs').toBe(1);
  });
  it('one cell recording TWO reasons under its one line (design: a second code on capacity_02\'s cell) is several reasons: the pointer stays, the line below it, once', () => {
    const input = inputOf('capacity_02');
    const cells = input.chanceCells.map((cell: Rec) => (cell.kind === 'withheld'
      ? { ...cell, reasons: [...cell.reasons, { code: 'option_not_licensed', message: null }] } : cell));
    const out = composeReplyShape({ ...input, chanceCells: cells } as never);
    expect(out.shape!.bullets).toEqual([HORIZON_MARKER, WITHHOLD_FALLBACK_MARKER]);
    expect(out.shape!.detail).toContain(REASON);
    expect(count(out.text, REASON), 'said once').toBe(1);
  });
  it('one reason the reply already says without the view\'s "Not shown:" lead (capacity_03\'s host line, design words) is that face line, said once', () => {
    const input = inputOf('capacity_03');
    const own = 'This run’s result for carrying on as now doesn’t match ‘Weekly support capacity’ as it stands today in the model, so it needs checking first.';
    const out = composeReplyShape({ ...input, text: input.text.replace(REASON, own),
      obligations: input.obligations.map((o: FaceObligation) => (o.text === REASON ? { ...o, text: own } : o)) } as never);
    expect(out.shape!.bullets).toEqual([HORIZON_MARKER, own]);
    expect(count(out.text.toLowerCase(), 'his run’s result for carrying on as now'), 'said once').toBe(1);
  });
  it('several reasons, one the reply already says without the view\'s "Not shown." lead (capacity_03 + a second option): only the unsaid one is added below', () => {
    const input = inputOf('capacity_03');
    const out = composeReplyShape({ ...input, chanceCells: [...input.chanceCells, { kind: 'withheld',
      reasons: [{ code: 'option_not_licensed', message: null }], face: 'Chance not shown yet', why: `Not shown. ${ADD_TWO}` }] } as never);
    expect(out.shape!.bullets).toContain(WITHHOLD_FALLBACK_MARKER);
    expect(count(out.text, ADD_TWO), 'the reply\'s own line, once').toBe(1);
    expect(out.text).not.toContain(`Not shown. ${ADD_TWO}`);
    expect(count(out.text, REASON), 'the other reason, already in the reply, once').toBe(1);
  });
  it('Paul\'s test, no added ask: a cell line that ends on its own question (design: capacity_02\'s, plus one) gives its reason only', () => {
    const input = inputOf('capacity_02');
    const asked = 'Is the capacity arithmetic right?';
    const cells = input.chanceCells.map((cell: Rec) => (cell.kind === 'withheld' ? { ...cell, why: `${REASON} ${asked}` } : cell));
    const out = composeReplyShape({ ...input, chanceCells: cells } as never);
    expect(out.shape!.bullets).toEqual([HORIZON_MARKER, REASON]);
    expect(out.text, 'no question is added').not.toContain(asked);
  });
  it('CONTRAST: a cause the face has fixed words for keeps them (unsized links), as before', () => {
    const input = inputOf('capacity_02');
    const cells = input.chanceCells.map((cell: Rec) => (cell.kind === 'withheld'
      ? { ...cell, reasons: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', message: null }] } : cell));
    expect(composeReplyShape({ ...input, chanceCells: cells } as never).shape!.bullets).toEqual([HORIZON_MARKER, "Not shown: some relationships aren't sized yet"]);
  });
});
