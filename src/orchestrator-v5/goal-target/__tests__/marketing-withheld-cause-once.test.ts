/**
 * ⭐ MARKETING'S WITHHELD EXPLANATIONS (DL 14 Oct; judge codex/JUDGE-marketing-e2e-25d14238-248cd4fb items 2 and 5). Marketing
 * gets coaching today rather than the joint chance, so each reason must be right and said once:
 * (b) the goal's missing current level carried no target binding, so the several-targets licence gave it to EVERY target and
 *     told ‘New customers in first 3 months’ "Conversion rate's current level is missing" beside its own reason;
 * (a) the card listed each note and the reply said them again, joined into one group line no card line equals;
 * (c) the reply's §(g) sentence (GOAL-REACH 3b) said the same cause a third time beside the card (DL: drop it; the next step
 *     stays on the action bar, `set_current_level`).
 *
 * Corpus: the served Run press (turn 08) of that capture, verbatim (`tests/fixtures/marketing-withheld-once/run-08.json`,
 * `_source`), through the real producer (`withholdGoalFiguresForMissingCurrentLevel`), licence (`withGoalChanceLicence`) and
 * reply notes (`goalChanceNotesForAgent`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withholdGoalFiguresForMissingCurrentLevel, wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { withGoalChanceLicence } from '../goal-chance-licence.js';
import { goalChanceNotesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { cardSaysMissingLevel, thresholdReasonLine } from '../../agent-lane/break-even.js';
import { withoutDisclosure } from '../../agent-lane/disclosure.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const MISSING = "Not shown. Conversion rate's current level is missing.";
const CONVERSION = '‘Conversion rate’ being above 15% over the first three months after launch';
const CUSTOMERS = '‘New customers in first 3 months’ being at least 20 customers over the first three months after launch';
const PARTS = 'The contributing quantities have links whose sizes are not yet specified. This calculation needs supported contributions in this quantity’s units, or a supported forecast for the quantity.';
/** The goal's own stated target row, by identity from the saved graph. */
const goalRow = (F.graph.goal_constraints as Rec[]).find((r) => r.role === 'goal_target' && r.node_id === 'conversion_rate')!;

/** The served Run's enrichment before the producer and the licence wrote their warnings; then both, as the Run does. */
function licensed(storedForProducer: unknown): { warning: Rec; licence: Rec; result: Rec } {
  const pre = { ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[])
    .filter((w) => w.code !== 'GOAL_FIGURES_MISSING_CURRENT_LEVEL' && w.code !== 'GOAL_CHANCE_LICENSED') };
  const env = withholdGoalFiguresForMissingCurrentLevel(pre, F.graph, storedForProducer) as Rec;
  const enrichment = withGoalChanceLicence(env, F.graph, 'conversion_rate', () => false, undefined, F.graph, {
    storedConstraints: F.graph.goal_constraints, sentConstraints: wireGoalConstraints(F.graph.goal_constraints),
    perLimit: F.limit_verdicts.per_limit,
  }) as Rec;
  const find = (code: string): Rec => (enrichment.inference_warnings as Rec[]).find((w) => w.code === code)!;
  return { warning: find('GOAL_FIGURES_MISSING_CURRENT_LEVEL'), licence: find('GOAL_CHANCE_LICENSED'), result: { enrichment } };
}
const notesFor = (licence: Rec, clause: string): string[] => (licence.targets.notes as string[]).filter((n) => n.startsWith(`${clause}: `));
const saysMissing = (lines: readonly string[]): number => lines.filter((l) => l.includes(MISSING)).length;

describe('marketing: each target gets its own withheld reason, said once', () => {
  it('PRECONDITION (fidelity): unbound, as served, the reconstruction gives the served card notes exactly, the customer target two reasons', () => {
    const { warning, licence } = licensed(undefined);
    expect(warning).not.toHaveProperty('constraint_ids');
    expect(licence.targets.notes).toEqual(F.card_notes);
    expect(notesFor(licence, CUSTOMERS)).toEqual([`${CUSTOMERS}: ${PARTS}`, `${CUSTOMERS}: ${MISSING}`]);
  });

  it('RED (b): the missing current level binds to the goal\'s own target; the customer target keeps only its own reason', () => {
    const { warning, licence } = licensed(F.graph.goal_constraints);
    expect(warning.constraint_ids).toEqual([goalRow.constraint_id]);
    expect(notesFor(licence, CONVERSION)).toEqual([`${CONVERSION}: ${MISSING}`]);
    expect(notesFor(licence, CUSTOMERS)).toEqual([`${CUSTOMERS}: ${PARTS}`]);
    // Every other condition's note is the served one, unchanged.
    expect((licence.targets.notes as string[]).filter((n) => !n.startsWith(`${CONVERSION}: `) && !n.startsWith(`${CUSTOMERS}: `)))
      .toEqual((F.card_notes as string[]).filter((n) => !n.startsWith(`${CONVERSION}: `) && !n.startsWith(`${CUSTOMERS}: `)));
  });

  it('RED (a): with the Run\'s card under the reply, the reply says none of the card\'s notes; the card says the cause once', () => {
    const { licence, result } = licensed(F.graph.goal_constraints);
    const card = new Set(licence.targets.notes as string[]);
    const reply = goalChanceNotesForAgent(result, F.graph, true, card);
    expect(saysMissing(reply)).toBe(0);
    expect(saysMissing([...card])).toBe(1);
    expect(reply.filter((l) => card.has(l))).toEqual([]);
    // As served (no card filter before grouping), the group line said the cause again beside the card.
    expect(saysMissing(goalChanceNotesForAgent({ enrichment: F.enrichment }, F.graph, true))).toBe(1);
    expect(F.detail).toContain(MISSING);
  });

  it('CONTRAST (a): with no card (an Explain), the reply keeps every note, the cause said once', () => {
    const { result } = licensed(F.graph.goal_constraints);
    const reply = goalChanceNotesForAgent(result, F.graph, true);
    expect(saysMissing(reply)).toBe(1);
    expect(reply.some((l) => l.startsWith(`${CUSTOMERS}: ${PARTS}`))).toBe(true);
  });

  it('CONTROL: a goal with no stored target row keeps the unbound warning (one target: nothing changes)', () => {
    const { warning } = licensed((F.graph.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target'));
    expect(warning).not.toHaveProperty('constraint_ids');
  });

  it('RED (c): the bound card shows every option withheld for the missing level → the reply\'s §(g) sentence goes, nothing else', () => {
    const result = { enrichment: F.enrichment };
    const line = thresholdReasonLine(F.graph, result)!;
    expect(line).toBe("Olumi can't show each option's chance of reaching your Conversion rate target yet: the model doesn't have Conversion rate's current level to measure from. The rest of this Run's results still stand.");
    expect((F.assistant_text as string).split(line)).toHaveLength(2);
    expect(cardSaysMissingLevel(result, F.card_options)).toBe(true);
    const said = withoutDisclosure(F.assistant_text, line);
    expect(said).not.toContain(line);
    expect(said).toBe((F.assistant_text as string).replace(`\n\n${line}`, ''));
  });

  it('CONTRAST (c): one cell without that reason, another carried reason, or no bound card → the sentence stays', () => {
    const result = { enrichment: F.enrichment };
    const oneWithout = (F.card_options as Rec[]).map((o, i) => i === 0
      ? { ...o, cell: { ...o.cell, reasons: (o.cell.reasons as Rec[]).filter((r) => r.code !== 'GOAL_FIGURES_MISSING_CURRENT_LEVEL') } } : o);
    expect(cardSaysMissingLevel(result, oneWithout)).toBe(false);
    const fault = { enrichment: { ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[]).map((w) => w.code === 'GOAL_THRESHOLD_NOT_CONVERTIBLE'
      ? { ...w, detail: { reason: 'goal_node_missing' } } : w) } };
    expect(cardSaysMissingLevel(fault, F.card_options)).toBe(false);
    expect(cardSaysMissingLevel(result, undefined)).toBe(false);
    expect(withoutDisclosure(`${F.assistant_text}\n\n${thresholdReasonLine(F.graph, result)}`, thresholdReasonLine(F.graph, result)!), 'said twice: never guessed which').toContain(thresholdReasonLine(F.graph, result));
  });
});
