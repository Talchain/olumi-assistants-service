import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildCandidateSchema } from '../runtime/build-model.js';

const NEW_CLAUSES = [
  'with `effect_provenance` "explicit" only when the user stated that size. Size each causal link whose magnitude you can defend, links into the goal first: keep the user’s stated sizes; otherwise give an "ai_proposed" estimate whose `basis` says in plain words that it is Olumi’s provisional assumption and why it is plausible, never citing a source, study or figure the brief does not contain. If you cannot defend a size, leave the three size fields null and ask for it in `unknowns`. A link the double-count rule below keeps unsized stays unsized, with no question.',
  'EVERY CURRENT FIGURE THE BRIEF STATES IS HELD IN THE MODEL. Each current level, count, price or throughput the brief states for a quantity other than the goal (a stock level, a unit price, a monthly throughput, staffed hours) becomes a factor holding that figure as its baseline_value, baseline_known true and provenance "explicit", in the brief’s own unit and with the figure’s stated scope and qualification; where that scope is unresolved, ask in `unknowns` rather than marking your own reading explicit. The goal’s own current level goes only in goal.baseline_value, never in a second factor or a link out of the goal. A limit or budget cap is a constraint, never a baseline_value, unless the brief separately states its current level. Use stated figures as identity operands only where the product holds by definition in consistent units, never inferring an output from headcount and time; for a stock at a deadline, the stated figures feed the accumulation and the goal product uses the resulting month-N stock, as the accumulation rule says. Estimate missing factor baselines only, never the goal’s current level. Never model only the change from today when the brief states today’s operands, and never put a stated figure only in a question.',
  'EVERY option the user stated, never dropped or merged — when',
  'the factors that actually move the goal —',
  'and every outcome the brief states or clearly implies, including the outcomes the factors act through. ',
  'Keep everything the user stated. Add only supported mechanisms, alternatives and risks that materially affect the reasoning; no speculative options. ',
  'never leave out or merge a risk the user named; leave out your own additions first, and the user-material exception to the size limit applies. ',
  'How the options compare is what the analysis explores — it is never a reason',
];

const REMOVED_CLAUSES = [
  'with `effect_provenance` "explicit" only when the user stated that size. SIZE EVERY CAUSAL LINK, links into the goal first: where the brief gives no size, give your own estimate with `effect_provenance` "ai_proposed" and a `basis` line saying in plain words why that size is plausible; never cite a source, study or figure the brief does not contain. Leave all three null only for a link you cannot size defensibly, and then name that link’s size as a question in `unknowns`.',
  'EVERY CURRENT FIGURE THE BRIEF STATES IS HELD IN THE MODEL. Each current level, count, capacity or price the brief states (a headcount, a customer count, a price per customer, a capacity per month) becomes a factor with that figure as its baseline_value, baseline_known true and provenance "explicit", in the brief’s own unit. When the goal is made of those quantities (revenue from a count times a price, capacity from people times time), the goal’s identity in `identities` uses those factors as its operands. Never model only the change from today when the brief states today’s operands, and never put a stated figure only in a question.',
  'EVERY option the user stated, never dropped or merged, and normally 3 to 5 options in total — when',
  'roughly 4 to 8 factors that actually move the goal —',
  'and every outcome and risk the brief states or clearly implies: the outcomes the factors act through and each downside that could reverse the answer. ',
  'Leave out only what the brief neither states nor implies: no speculative options, and no risk or outcome that could not change the answer. ',
  'never leave out or merge a risk the user named, even when that takes the model past 6 outcomes and risks. ',
  'WHICH option is better is the question the analysis answers — it is never a reason',
  'normally 3 to 5 options',
  'roughly 4 to 8 factors',
  'past 6 outcomes and risks',
  'WHICH option is better',
  'capacity from people times time',
  'SIZE EVERY CAUSAL LINK',

  'KEEP THE FIRST MODEL DECISION-CRITICAL, NOT COMPREHENSIVE \u2014 BUT NOT THIN.',
  'and up to 4 to 6 outcomes and risks between them, only where they materially change the reasoning (the outcome the factors act through, the risk that could reverse the answer). ',
  'ALWAYS KEEP AT LEAST ONE RISK: the downside that could reverse the answer is part of the decision the user must weigh.',
  'A model below this envelope cannot carry the reasoning; a model above it buries it. Do NOT widen beyond it on this turn: no speculative options, secondary factors, or decorative risks and outcomes. ',
  'Anything you judge material but that does not meet that bar belongs in `unknowns` as a question, NOT as a node \u2014 it can become a proposal later. ',
  'Correct, connected items beat a comprehensive map: an oversized first model is refused before it reaches the canvas.',
];

const PRESERVED_CLAUSES = [
  'DRAW THE DECISION THE BRIEF DESCRIBES, IN FULL BUT WITHIN THE SIZE LIMIT.',
  'DRAW EVERY RISK THAT COULD REVERSE THE ANSWER, not just one: each downside is part of the decision the user must weigh.',
  'Every item must be connected: an oversized first model is refused before it reaches the canvas.',
  'A LIMIT CAN ONLY BE CHECKED THROUGH SIZED LINKS. NO LINK MAY POINT FROM A RISK TO A QUANTITY IN `constraints`: a risk has no unit, so that link cannot be sized and the user’s limit cannot be checked. Instead, link every factor an option changes that moves the limited quantity STRAIGHT to it and give that link its size. That sized link already carries the limited quantity moving the wrong way, so do not size that loss a second time: keep that risk as a node, linked to the goal metric with all three size fields null. Every OTHER risk stays exactly as you would draw it, linked to the goal metric or to the quantity it threatens.',
  'EVERY RISK THE USER NAMES IS DRAWN AS A RISK NODE: each downside the user states in their own words (for example that they will run out of money, lose a key customer, or miss a deadline) is its own risk, linked to what it threatens, even when you also draw a risk of your own. ',
  'A RISK THE USER NAMED OUTRANKS THE ENVELOPE: when the risks the user named do not all fit beside your own, leave out your own risks and outcomes first; never leave out or merge a risk the user named; leave out your own additions first, and the user-material exception to the size limit applies. ',
  'Stay within 18 nodes and 30 links in total, counting one link from the decision to each option, one from each option to each factor it acts on (for the option that keeps things as they are, each factor the other options act on) and each entry in `links`.',
  "THE ONE EXCEPTION IS THE USER'S OWN MATERIAL: when what the user stated (their options, figures, relationships and the risks they named) cannot fit this budget, keep all of it and leave out your own additions; that model is admitted, not refused.",
];

function linkDescription(field: 'effect_amount' | 'basis'): string {
  const schema = buildCandidateSchema() as {
    properties: { links: { items: { properties: Record<'effect_amount' | 'basis', { description: string }> } } };
  };
  return schema.properties.links.items.properties[field].description;
}

describe('S7 2b-b exact drafter instruction bytes', () => {
  it.each(NEW_CLAUSES)('contains the NEW clause verbatim: %s', clause => {
    expect(BUILD_INSTRUCTIONS).toContain(clause);
    expect(BUILD_INSTRUCTIONS.split(clause)).toHaveLength(2);
  });

  it.each(REMOVED_CLAUSES)('contains none of the removed OLD clause: %s', clause => {
    expect(BUILD_INSTRUCTIONS).not.toContain(clause);
  });

  it.each(PRESERVED_CLAUSES)('preserves the protected clause verbatim: %s', clause => {
    expect(BUILD_INSTRUCTIONS).toContain(clause);
  });

  it('holds current figures directly after the current goal level entry', () => {
    const goalBaseline = 'Record the goal metric\u2019s CURRENT level in goal.baseline_value, in the goal unit. When the brief states it: baseline_known true, baseline_provenance "explicit". When it does not, leave baseline_value null with baseline_known false. Do not estimate it: a guessed current level would set the chance of reaching the target on a guess. It is where things stand today, never the target.';
    expect(BUILD_INSTRUCTIONS).toContain(`${goalBaseline} ${NEW_CLAUSES[1]}`);
  });

  it('removes the OLD link sizing clause and pins both NEW schema descriptions verbatim', () => {
    expect(BUILD_INSTRUCTIONS).not.toContain('with `effect_provenance` "explicit" only when the user stated that size, and all three null when you cannot give a defensible size.');
    expect(linkDescription('effect_amount')).toBe('The signed change in the TARGET\u2019s own unit that `effect_per_source_change` of the source causes. For a percentage target, in points: 4% to 3% is -1. null when you cannot defend a size, or when another instruction keeps the link unsized.');
    expect(linkDescription('effect_amount')).not.toContain('null only when no defensible size exists; then ask for it in `unknowns`.');
    expect(linkDescription('basis')).toBe('One short line explaining this size and its direction, saying which part comes from the brief and which is Olumi’s provisional assumption; never invented evidence. null when `effect_amount` is null or the user stated the size.');
    expect(linkDescription('basis')).not.toContain('One short line, from the brief, saying why this size and its direction hold (for example "a higher price pushes more customers to cancel"). null when');
  });

  it('prints sha256 of the final instruction string and both schema descriptions', () => {
    const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    process.stdout.write(`BUILD_INSTRUCTIONS sha256: ${sha256(BUILD_INSTRUCTIONS)}\n`);
    process.stdout.write(`effect_amount.description sha256: ${sha256(linkDescription('effect_amount'))}\n`);
    process.stdout.write(`basis.description sha256: ${sha256(linkDescription('basis'))}\n`);
  });
});
