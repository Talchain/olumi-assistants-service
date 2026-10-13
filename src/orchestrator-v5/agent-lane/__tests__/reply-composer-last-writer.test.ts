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
    // The saved key is read once, solely to bind current blocks/Explain to this answer's Run.
    // Pin the complete branch: it may set identity/status and controls, never select or rebuild words.
    const identityOnly = "        const savedRunKey = prior.suggested_actions_run_key;\n        if (typeof savedRunKey === 'string' && savedRunKey.length > 0\n          && replayChip?.id === `${RUN_EXPLANATION_PREFIX}${savedRunKey}`) {\n          replayNarration = { status: unavailableExplanation.has(replayText) ? 'unavailable' : 'ready',\n            run_key: savedRunKey };\n          boundControl.push(replayChip);\n        } else {\n          replayNarration = { status: 'stale', run_key: savedRunKey ?? '' };\n        }";
    expect(replay.slice(replay.indexOf('        const savedRunKey ='),
      replay.indexOf('\n      }', replay.indexOf('        const savedRunKey =')))).toBe(identityOnly);
    expect(replay.match(/prior\.suggested_actions_run_key/g)).toEqual(['prior.suggested_actions_run_key']);
    expect(replay.replace(identityOnly, '')).not.toMatch(/\bsavedRunKey\b/);
    expect(replay).toContain("const resultFirstReplay = replayNarration?.status === 'ready' || replayNarration?.status === 'unavailable';");
    expect(replay).toContain('...(resultFirstReplay && state.analysisResult !== undefined ? { blocks: [state.analysisResult] } : {}),');
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
