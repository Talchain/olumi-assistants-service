
import {
  describe, it, expect, vi, beforeEach, afterEach, type MockedFunction,
} from 'vitest';

import { _resetConfigCache } from '../../../config/index.js';
import { findSuccessClaimHit } from '../../compose/forbidden-user-facing-phrases.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({ handleEditGraph: vi.fn() }));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapter: vi.fn().mockReturnValue({}) }));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return { ...actual,
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});
import { commitDirectAnswer } from '../../commit.js';
/** The headline the wire actually shipped. */
const WIRE_HEADLINE =
  '2 model parameters updated: Pro Plan Monthly Price, Model is raising the Pro plan price ' +
  'from £49 to £69 per month with the next Pro feature release';

const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  commitMock().mockResolvedValue({
    response: {}, performed: true as const, persisted_row_id: 'row-test', graphPersisted: true,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('the applied-changes headline is withdrawn when nothing persisted', () => {
  it('PRECONDITION — the PHRASE guard genuinely misses this headline', () => {
    // If this ever starts hitting, the test below would pass via the phrase arm
    // and prove nothing about the gate — the exact vacuity that sank a previous
    // attempt at this test.
    expect(findSuccessClaimHit(WIRE_HEADLINE)).toBeNull();
    // Contrast in the same assertion pair: the arm is alive, just not here.
    expect(findSuccessClaimHit('Updated Pro Plan Monthly Price')).not.toBeNull();
  });
});
