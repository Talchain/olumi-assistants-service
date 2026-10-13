import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
const forbidden = ['composeReplyShape(', 'enforceAgentLaneLeaderClaimsAtWire(', 'withScreenLinesOwed(',
  'withBreakEvenAnswer(', 'withA7AfterGate(', 'withoutDriverAbsenceClaimsAtEgress(', 'withLeftOutOptionCorrectionAtEgress('];
const retired = (source: string) => forbidden.every(call => !source.includes(call));
describe('B2/B3/B4: whole AI answer, one final licence boundary', () => {
  it('removes live and replay display authors', () => expect(retired(route)).toBe(true));
  it.each(forbidden)('mutant restoring %s is caught', call => expect(retired(route + call)).toBe(false));
  it('stores only after the final numerical check; no later prose writer', () => {
    const at = route.lastIndexOf('wireBody = withEstimateGoalPointsAtEgress(');
    const saved = route.indexOf('const sentText = String(wireBody.assistant_text ?? text);');
    expect(at).toBeGreaterThan(-1); expect(saved).toBeGreaterThan(at);
    const tail = route.slice(saved);
    expect(tail).not.toMatch(/assistant_text\s*:/);
    for (const call of forbidden) expect(tail).not.toContain(call);
  });
  it('replays stored words without a face and keeps final K1 checks', () => {
    const replay = route.slice(route.indexOf('let replayText = prior.assistant_message'), route.indexOf('return wholeReplay;'));
    expect(replay).toContain('assistant_text: withoutProposalIds(replayText)');
    expect(replay).toContain('enforceLeaderLicenceAtFinalEgress(');
    expect(replay).toContain('withEstimateGoalPointsAtEgress(');
    expect(replay).toContain('explanationId.slice(RUN_EXPLANATION_PREFIX.length)');
    expect(replay).not.toContain('prior.suggested_actions_run_key');
    expect(replay).toContain("replayNarration?.status !== 'stale'");
  });
});

// N13 is retained: answer offers use their existing Run key and validator.
describe('N13 base persistence contract', () => {
  it('persists only eligible offers with the original selected-Run key', () => {
    expect(route).toContain('suggested_actions_run_key: answerOffersRunKey');
    expect(route).not.toContain('suggested_actions_run_key: narrationKey');
    expect(route).toContain('nextStepOffersForTurn(NEXT_STEP_CHIPS,');
    expect(route).toContain('const actionBar = await');
    expect(route).toContain('model_gap: gap');
  });
});
