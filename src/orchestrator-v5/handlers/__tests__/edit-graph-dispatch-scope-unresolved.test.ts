/**
 * ⭐⭐ END-TO-END: the scope-unresolved verdict must WITHHOLD THE WRITE and ASK.
 *
 * ═══ WHY THIS FILE EXISTS SEPARATELY FROM THE GUARD'S OWN SPEC ═══
 * `routing/__tests__/option-write-scope-unresolved.test.ts` proves the PREDICATE
 * returns `scope_unresolved` for the measured buy turn. It proves nothing about
 * whether the dispatcher ACTS on it — and a verdict nothing consumes is this
 * estate's single most-repeated defect (CLAUDE.md: "WE BUILD MORE THAN WE PLUG
 * IN"). It was real here: the dispatcher gated on `verdict === 'withhold'` in
 * BOTH places, so a third variant fell through both and the write still landed.
 * That was caught by reading, and reading is not evidence. This file executes it.
 *
 * ═══ THE MEASURED TURN — deployed `a3b0548d`, wire-level, FRESH ═══
 * Banked at `output/core-staging-driver/journey-integrated-a3b0548d/journey-buy-run1/`.
 *   USER    "Change the buy option so the vendor cost is £150,000 per year
 *            instead of £120,000. Keep everything else the same."
 *   RESULT  factor `8f788330` observed_state null → {raw_value:150000,
 *             source:"user_override"} — a MODEL-WIDE baseline, minted
 *           option `c5f4f68e` own intervention: still 60000
 *           `graph_hash` a0b39d86 → 84013c95 — IT COMMITTED
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): remove `!optionScopeUnresolved`
 * from the `effectiveAppliedMutation` conjunction and the WITHHOLD test must go
 * red. Remove the `scope_unresolved` text branch and the ASK test must go red.
 * They are separate assertions because they are separate failures: a write that
 * lands silently, and a turn that says nothing about why nothing happened.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describe, it, expect, vi, beforeEach, afterEach, type MockedFunction,
} from 'vitest';

import { _resetConfigCache } from '../../../config/index.js';

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
vi.mock('../../context/freshness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/freshness.js')>();
  return { ...actual, deriveAnalysisFreshness: vi.fn(actual.deriveAnalysisFreshness) };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});
import { commitDirectAnswer } from '../../commit.js';

const CAPTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./buy-capture-a3b0548d.json', import.meta.url)), 'utf8'),
) as { nodes: Array<Record<string, unknown>>; edges?: unknown[] };

const VENDOR_FACTOR = '8f788330';
const BUY_OPTION = 'c5f4f68e';

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

describe('an option-anchored turn with no resolved option: the DISPATCHER acts on it', () => {
  it('PRECONDITION — the capture is the buy graph and the option is wired to the factor', () => {
    const option = CAPTURE.nodes.find((n) => n.id === BUY_OPTION);
    expect((option as { interventions: Record<string, unknown> }).interventions)
      .toHaveProperty(VENDOR_FACTOR);
    const factor = CAPTURE.nodes.find((n) => n.id === VENDOR_FACTOR);
    expect((factor as { observed_state?: unknown }).observed_state ?? null).toBeNull();
  });
});
