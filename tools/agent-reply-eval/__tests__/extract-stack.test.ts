/**
 * The stack extractor evaluates the route's own declarations and composition, and refuses
 * anything it would have to guess. Verified out of band against PR #1791's FP3 captures:
 * extracting the route at their source head reproduces all 7 serialised `instructions`
 * byte-for-byte (see Docs/evals/agent-reply/README.md).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractStack } from '../extract-stack.js';

const here = dirname(fileURLToPath(import.meta.url));

const ROUTE = `
const PREVIEW = config.flag === true ? 'read only' : 'can' + ' write';
const AGENT_INSTRUCTIONS = [
  // a comment between elements
  'First \\u2014 line.',
  PREVIEW,
  "Third's line",
].join(' ');
export const INTERPRET_ONLY_CONSTRAINT = 'Explain only, '
  + 'never act.';
export const INTERPRETER_V02_BANKED: string = "v0.2\\n";
async function call() {
  await callModel({ instructions: \`\${AGENT_INSTRUCTIONS}\\n\\n\${INTERPRET_ONLY_CONSTRAINT}\\n\\n\${INTERPRETER_V02_BANKED}\` });
  await callModel({ instructions: AGENT_INSTRUCTIONS });
}
`;

describe('extractStack', () => {
  it('evaluates literals, +, [..].join and a decided conditional, in the route’s own composition', () => {
    const s = extractStack(ROUTE, 'r.ts', { 'config.flag === true': false });
    expect(s.stack).toBe("First — line. can write Third's line\n\nExplain only, never act.\n\nv0.2\n");
    expect(s.parts).toEqual(['AGENT_INSTRUCTIONS', 'INTERPRET_ONLY_CONSTRAINT', 'INTERPRETER_V02_BANKED']);
    expect(s.assumed).toEqual({ 'config.flag === true': false });
  });
  it('the other branch gives a different stack (the assumption is load-bearing)', () => {
    expect(extractStack(ROUTE, 'r.ts', { 'config.flag === true': true }).stack).toContain('read only');
  });
  it('refuses an undecided conditional rather than guessing config', () => {
    expect(() => extractStack(ROUTE, 'r.ts')).toThrow(/config is not guessed/);
  });
  it('refuses when no instructions template includes the v0.2 interpreter', () => {
    expect(() => extractStack(ROUTE.replace(/\\n\\n\$\{INTERPRETER_V02_BANKED\}/, ''), 'r.ts', { 'config.flag === true': false })).toThrow(/exactly one/);
  });
  it('refuses a value it cannot evaluate statically', () => {
    expect(() => extractStack(ROUTE.replace("'Explain only, '", 'buildIt()'), 'r.ts', { 'config.flag === true': false })).toThrow(/cannot evaluate/);
  });
  it('extracts this worktree’s route (non-preview): interpret-only line between the Agent block and v0.2', () => {
    const src = readFileSync(join(here, '..', '..', '..', 'src', 'routes', 'agent-v1-turn.ts'), 'utf8');
    const s = extractStack(src, 'agent-v1-turn.ts', { 'config.proxy.agentLanePreview === true': false });
    expect(s.parts).toEqual(['AGENT_INSTRUCTIONS', 'INTERPRET_ONLY_CONSTRAINT', 'INTERPRETER_V02_BANKED']);
    expect(s.stack.startsWith('You are Olumi')).toBe(true);
    expect(s.stack).toContain('\n\nIN THIS REPLY you are explaining a result only.');
    expect(s.stack.endsWith('Do not force a next step.\n')).toBe(true);
  });
});
