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
  it('answers directly with enough detail, with no fixed word budget (prompt P10/P11, AIE one-pass packet 94ad9c8f…)', () => {
    // ⛔ CHANGED EXPECTATION: the host no longer supplies the explanatory answer, so the per-turn word budgets are retired.
    expect(REPLY_LENGTH_INSTRUCTION.startsWith('Answer the user directly and visibly with the relevant reasoning, uncertainty and next action. The host does not supply a separate explanatory answer.')).toBe(true);
    expect(REPLY_LENGTH_INSTRUCTION).toContain('Keep concise ordinary replies, with enough detail for the actual question and proposed change.');
    expect(REPLY_LENGTH_INSTRUCTION).not.toContain('Olumi adds its own status, disclosure and receipt lines');
  });

  it('the AI asks for a missing target or input itself, once, and never re-asks a known figure (P10/P11)', () => {
    // ⛔ CHANGED EXPECTATION: "Olumi asks for it after your words" is retired. The host's D1 ask still exists on build/Run turns
    // (pinned below); retiring it belongs to the reply block, so a repeated target question there is a reported gap.
    expect(REPLY_LENGTH_INSTRUCTION).toContain('Ask for a necessary missing target or input yourself only when it has not already been supplied; do not re-ask a known figure.');
    expect(REPLY_LENGTH_INSTRUCTION).not.toContain('Olumi asks for it after your words');
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
    // Re-pinned for D3 step 2 (DL 0df0e1 ruling C, 6 Oct): GOAL_CHANCE_RANKING_INSTRUCTION joins the same list.
    // Re-pinned for S-A (lane COPY-SHAPE, 7 Oct; Paul: "the three bullets as a construct"): the ONE reply-shape sentence
    // follows the length sentence, so every chat-writing call (converse, interpret, method, widen) carries it.
    // PROMPT 28: MODEL_RELATIVE_NAMING_INSTRUCTION leaves the join; its P13 words are sent once inside the host contract.
    expect(src).toContain("[MUTATION_INSTRUCTION, HOST_TOOL_CONTRACT, REPLY_LENGTH_INSTRUCTION, REPLY_SHAPE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ')");
    // The slot is filled once; nothing else in the template or the contract mentions the budget.
    expect(SELECTED_COACH_V02_TEMPLATE.split('{{MODE_AND_AUTHORITY}}')).toHaveLength(2);
    expect(HOST_TOOL_CONTRACT).not.toContain(REPLY_LENGTH_INSTRUCTION);
  });

  it('carries no dash a user could see quoted back and no figure', () => {
    expect(REPLY_LENGTH_INSTRUCTION).not.toMatch(/[‒-―]/);
    expect(REPLY_LENGTH_INSTRUCTION.match(/\d+/g)).toBeNull();
  });
});
