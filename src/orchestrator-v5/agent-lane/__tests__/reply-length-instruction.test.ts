/**
 * ⭐ THE REPLY'S OWN LENGTH (Paul's staging test, 1 Oct 00:1xZ: "the AI replies are much longer again"; DL #75 5922040401;
 * AIQ bound 5922092866; measurement #75 5922398757). The sentence is APPENDED after the host contract, so the v0.2 template
 * and every retained host rule reach the model unchanged, and it never licenses dropping a truth sentence to fit.
 */
import { describe, it, expect } from 'vitest';
import { HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';
import { REPLY_LENGTH_INSTRUCTION } from '../../../routes/agent-v1-turn.js';
import { readFileSync } from 'node:fs';

describe('the reply-length sentence', () => {
  it('budgets the model\'s own words per turn kind, below AIQ\'s whole-reply bound (≤180 / ≤150 / ≤130)', () => {
    expect(REPLY_LENGTH_INSTRUCTION).toContain('Stay under 110 words on the turn that builds the model from a brief, under 100 when you explain an analysis result, and under 90 otherwise: these are limits, not targets.');
  });

  it('K2 (DL 5925649954 item 5): one question at most, last; on a build or Run turn the goal\'s target is the host\'s ask (D1), never the model\'s', () => {
    expect(REPLY_LENGTH_INSTRUCTION).toContain('Ask at most one question, as your last sentence.');
    expect(REPLY_LENGTH_INSTRUCTION).toContain('On a turn that builds the model or runs the analysis, never ask for the goal\'s target or name it as the next step: Olumi asks for it after your words.');
    // The host's ask it defers to exists, on exactly those turns (`decisionInputLines` asks only when built or ran).
    const ask = readFileSync(new URL('../decision-input-ask.ts', import.meta.url), 'utf8');
    expect(ask).toContain('if (!ctx.builtOrRan) return [];');
    expect(ask).toContain("I'll propose it as your target.");
  });

  it('never trades away a truth sentence to fit (AIQ: the bound yields, never the truth)', () => {
    expect(REPLY_LENGTH_INSTRUCTION).toContain('never drop a caveat that changes the meaning, why a result or a leading option is withheld, a limit, or who supplied a figure');
  });

  it('is appended AFTER the host contract in the route source: the template and every host rule are unchanged', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    // The naming rule (WORDING BATCH, 5 Oct) is appended AFTER this sentence; the reply-length sentence still follows the host contract.
    expect(src).toContain("'{{MODE_AND_AUTHORITY}}', [MUTATION_INSTRUCTION, HOST_TOOL_CONTRACT, REPLY_LENGTH_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION].join(' ')");
    // The slot is filled once; nothing else in the template or the contract mentions the budget.
    expect(SELECTED_COACH_V02_TEMPLATE.split('{{MODE_AND_AUTHORITY}}')).toHaveLength(2);
    expect(HOST_TOOL_CONTRACT).not.toContain(REPLY_LENGTH_INSTRUCTION);
  });

  it('carries no dash a user could see quoted back and no figure other than the budgets', () => {
    expect(REPLY_LENGTH_INSTRUCTION).not.toMatch(/[‒-―]/);
    expect(REPLY_LENGTH_INSTRUCTION.match(/\d+/g)).toEqual(['110', '100', '90']);
  });
});
