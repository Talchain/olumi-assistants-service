import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildCandidateSchema } from '../runtime/build-model.js';

const NEW_CLAUSES = [
  'with `effect_provenance` "explicit" only when the user stated that size. SIZE EVERY CAUSAL LINK, links into the goal first: where the brief gives no size, give your own estimate with `effect_provenance` "ai_proposed" and a `basis` line saying in plain words why that size is plausible; never cite a source, study or figure the brief does not contain. Leave all three null only for a link you cannot size defensibly, and then name that link’s size as a question in `unknowns`.',
  'EVERY CURRENT FIGURE THE BRIEF STATES IS HELD IN THE MODEL. Each current level, count, capacity or price the brief states (a headcount, a customer count, a price per customer, a capacity per month) becomes a factor with that figure as its baseline_value, baseline_known true and provenance "explicit", in the brief’s own unit. When the goal is made of those quantities (revenue from a count times a price, capacity from people times time), the goal’s identity in `identities` uses those factors as its operands. Never model only the change from today when the brief states today’s operands, and never put a stated figure only in a question.',
  'DRAW THE DECISION THE BRIEF DESCRIBES, IN FULL BUT WITHIN THE SIZE LIMIT.',
  'and every outcome and risk the brief states or clearly implies: the outcomes the factors act through and each downside that could reverse the answer. ',
  'DRAW EVERY RISK THAT COULD REVERSE THE ANSWER, not just one: each downside is part of the decision the user must weigh.',
  'Leave out only what the brief neither states nor implies: no speculative options, and no risk or outcome that could not change the answer. ',
  'Every item must be connected: an oversized first model is refused before it reaches the canvas.',
];

const REMOVED_CLAUSES = [
  'KEEP THE FIRST MODEL DECISION-CRITICAL, NOT COMPREHENSIVE \u2014 BUT NOT THIN.',
  'and up to 4 to 6 outcomes and risks between them, only where they materially change the reasoning (the outcome the factors act through, the risk that could reverse the answer). ',
  'ALWAYS KEEP AT LEAST ONE RISK: the downside that could reverse the answer is part of the decision the user must weigh.',
  'A model below this envelope cannot carry the reasoning; a model above it buries it. Do NOT widen beyond it on this turn: no speculative options, secondary factors, or decorative risks and outcomes. ',
  'Anything you judge material but that does not meet that bar belongs in `unknowns` as a question, NOT as a node \u2014 it can become a proposal later. ',
  'Correct, connected items beat a comprehensive map: an oversized first model is refused before it reaches the canvas.',
];

const PRESERVED_CLAUSES = [
  'EVERY RISK THE USER NAMES IS DRAWN AS A RISK NODE: each downside the user states in their own words (for example that they will run out of money, lose a key customer, or miss a deadline) is its own risk, linked to what it threatens, even when you also draw a risk of your own. ',
  'A RISK THE USER NAMED OUTRANKS THE ENVELOPE: when the risks the user named do not all fit beside your own, leave out your own risks and outcomes first; never leave out or merge a risk the user named, even when that takes the model past 6 outcomes and risks. ',
  'Stay within 18 nodes and 30 links in total, counting one link from the decision to each option, one from each option to each factor it acts on (for the option that keeps things as they are, each factor the other options act on) and each entry in `links`.',
  "THE ONE EXCEPTION IS THE USER'S OWN MATERIAL: when what the user stated (their options, figures, relationships and the risks they named) cannot fit this budget, keep all of it and leave out your own additions; that model is admitted, not refused.",
];

function effectAmountDescription(): string {
  const schema = buildCandidateSchema() as {
    properties: { links: { items: { properties: { effect_amount: { description: string } } } } };
  };
  return schema.properties.links.items.properties.effect_amount.description;
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

  it('removes the OLD link sizing clause and pins the NEW effect_amount description', () => {
    expect(BUILD_INSTRUCTIONS).not.toContain('with `effect_provenance` "explicit" only when the user stated that size, and all three null when you cannot give a defensible size.');
    expect(effectAmountDescription()).toBe('The signed change in the TARGET\u2019s own unit that `effect_per_source_change` of the source causes. For a percentage target, in points: 4% to 3% is -1. null only when no defensible size exists; then ask for it in `unknowns`.');
  });

  it('prints sha256 of the final instruction string and effect_amount description', () => {
    const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    process.stdout.write(`BUILD_INSTRUCTIONS sha256: ${sha256(BUILD_INSTRUCTIONS)}\n`);
    process.stdout.write(`effect_amount.description sha256: ${sha256(effectAmountDescription())}\n`);
  });
});
