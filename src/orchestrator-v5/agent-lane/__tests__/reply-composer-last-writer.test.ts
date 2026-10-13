import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
const forbidden = ['composeReplyShape(', 'enforceAgentLaneLeaderClaimsAtWire(', 'withScreenLinesOwed(',
  'withBreakEvenAnswer(', 'withA7AfterGate(', 'withoutDriverAbsenceClaimsAtEgress(', 'withLeftOutOptionCorrectionAtEgress('];
// R1 legacy receipts retain reconstruction; this exception cannot admit AI-loop or live writers.
const retired = (source: string) => {
  const legacyStart = source.indexOf("      } else if (approvedProposal === undefined && typedRunOf(body) && replayText.includes(RUN_RESULT_READY_TEXT)) {");
  const legacyEnd = source.indexOf('      const rememberedControls', legacyStart);
  const composeStart = source.indexOf('      const composedCandidate = replayObligations === undefined ? null');
  const composeEnd = source.indexOf('      const parityReplayComposed', composeStart);
  if (legacyStart < 0 || legacyEnd < legacyStart || composeStart < legacyEnd || composeEnd < composeStart) return false;
  const active = source.slice(0, legacyStart) + source.slice(legacyEnd, composeStart) + source.slice(composeEnd);
  return forbidden.every(call => !active.includes(call));
};
describe('B2/B3/B4: whole AI answer, one final licence boundary', () => {
  it('removes live and AI-loop replay display authors; only legacy receipts reconstruct', () => expect(retired(route)).toBe(true));
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
    // R1 wins: the older B2 saved-key branch is retired. Original in-process controls
    // identify a warm resend; cold replies cannot borrow a durable offer's key.
    expect(replay).not.toContain('prior.suggested_actions_run_key');
    const identityOnly = "      const rememberedControls = turnId !== undefined ? offeredActions.get(`${scenarioId}:${turnId}`) : undefined;\n      const remembered = rememberedControls?.actions ?? [];\n      // AI-written loop answers need their ORIGINAL bound identity. Legacy host receipts\n      // are regenerated from current state; receipts saying nothing ran are not analysis answers.\n      const replayLoopRun = approvedProposal === undefined && typedRunOf(body)\n        && !legacyRunReceipt\n        && replayText !== RUN_FAILED_TEXT\n        && replayText !== 'The analysis did not run. Press Run to try again.';\n      // Original bound controls only: never borrow today's key to identify yesterday's answer.\n      const replayLoopRunKey = remembered.find(action => isRunExplanationChip(action.id))?.id.slice(RUN_EXPLANATION_PREFIX.length)\n        || rememberedControls?.runControlKey || rememberedControls?.sizingRunKey;\n      const replayLoopRunCurrent = replayLoopRun\n        && typeof replayLoopRunKey === 'string' && replayChip?.id === `${RUN_EXPLANATION_PREFIX}${replayLoopRunKey}`;\n      const historicalLoopReplay = replayLoopRun && !replayLoopRunCurrent;\n      if (replayLoopRunCurrent) {\n        replayNarration = rememberedControls?.narration;\n      }\n      if (historicalLoopReplay) {\n        replayText = prior.assistant_message ?? '';\n        // Empty means unknown original identity, never the current Run's identity.\n        replayNarration = { status: 'stale', run_key: replayLoopRunKey\n          ?? (isRunExplanationChip(explanationId) ? explanationId.slice(RUN_EXPLANATION_PREFIX.length) : '') };\n        boundControl.length = 0;\n        // A warm answer with no original bound analysis controls must not gain a Run\n        // control just from being resent. Cold/moved bound answers keep the historical exit.\n        if (rememberedControls === undefined || replayLoopRunKey !== undefined\n          || remembered.some(action => action.id === RUN_OFFER_CHIP.id)) boundControl.push(RUN_OFFER_CHIP);\n      }\n      const resultFirstReplay = !historicalLoopReplay && (replayNarration !== undefined || replayLoopRunCurrent);\n";
    expect(replay.slice(replay.indexOf('      const rememberedControls'),
      replay.indexOf('      // The durable carrier:'))).toBe(identityOnly);
    expect(replay).not.toMatch(/gatedReplay\.assistant_text\s*=/);
    expect(replay).toContain('const gatedReplay = withEstimateGoalPointsAtEgress(leaderGatedReplay, {');
    expect(replay).toContain('...(resultFirstReplay && state.analysisResult !== undefined ? { blocks: [state.analysisResult] } : {}),');
    expect(replay).toContain("current: (!replayLoopRun || replayLoopRunCurrent) &&");
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
