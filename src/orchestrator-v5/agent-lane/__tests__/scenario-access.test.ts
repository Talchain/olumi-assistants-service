/**
 * ⛔ `ensureScenarioExists` IS NOT A PERMISSION GRANT — it hands back the owner
 * of an EXISTING row, which may be somebody else. This is the comparison that
 * turns an upsert into an access decision.
 */

import { describe, it, expect } from 'vitest';
import { scenarioAccessDecision } from '../scenario-access.js';

describe('scenarioAccessDecision', () => {
  it('allows a guest scenario for an anonymous caller', () => {
    expect(scenarioAccessDecision(null, null)).toBe('allow');
  });

  it('allows a guest scenario for a signed-in caller', () => {
    expect(scenarioAccessDecision(null, 'user-a')).toBe('allow');
  });

  it('allows the owner', () => {
    expect(scenarioAccessDecision('user-a', 'user-a')).toBe('allow');
  });

  it('REFUSES another user — the case the upsert would otherwise hand over', () => {
    expect(scenarioAccessDecision('user-a', 'user-b')).toBe('refuse_not_found');
  });

  it('REFUSES an anonymous caller on an OWNED scenario', () => {
    // The dangerous direction: never silently upgrade "nobody" to "the owner".
    expect(scenarioAccessDecision('user-a', null)).toBe('refuse_not_found');
  });
});
