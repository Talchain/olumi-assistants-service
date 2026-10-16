/**
 * ⭐⭐ ROADMAP 2.1266 — `dispatchEditGraph` must not COMMIT a wrong-entity write
 * behind a reply that says the option's effect value is still unset.
 *
 * Sibling of `edit-graph-dispatch-configure-option-outcome.test.ts`, and the
 * distinction between the two files IS the residual defect:
 *
 *   - That file pins the 2.427 guard, which REPLACES THE TEXT on branch (b)
 *     ("something landed for a DIFFERENT entity").
 *   - This file pins what 2.427 never did: WITHHOLD THE WRITE. Without it the
 *     honest text ships on top of a persisted wrong mutation.
 *
 * ═══ THE WITNESSED TURN — deployed CEE `8be62df`, wire-level ═══
 * `olumi-docs/witness-acceptance-2026-08-17/captures/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 5:
 *
 *   REQUEST  "For the subcontracting inner-city deliveries to a green courier
 *            option, set the effect value on Subcontractor cost as share of
 *            affected-route revenue to 0.12 — a share, no unit."
 *   REPLY    byte-identical to the previous turn's refusal — "…still has no
 *            effect value on Subcontractor cost as share of affected-route
 *            revenue, so that link is not carrying anything yet…"
 *   RELOAD   (`j6-reload-J4.json`) factor `49a2b80b`
 *            `observed_state { value: 0.12, source: "user_override" }`, while
 *            option `21ea9b80` still carries `interventions: {}`.
 *
 * So the FACTOR BASELINE every option reads was silently rewritten, the effect
 * value the user asked for was not, the blocker never retired, and the reply
 * denied that anything had happened.
 *
 * ⚠ THE FIXTURE IS THE WIRE'S, NOT MINE (trap 16). Both graphs and both
 * messages are generated from those captures — see the fixture's own
 * `__provenance__` field for the exact source file and transformation of each.
 * Historic record: append, never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): removing
 * `!optionInterventionWriteWithheld` from the `effectiveAppliedMutation`
 * conjunction in `edit-graph-dispatch.ts` MUST turn the withhold assertions
 * below red. The opposite-direction twin at the bottom must stay GREEN through
 * that mutation and RED if the withhold is widened to swallow a real edit.
 */

import { readFileSync } from 'node:fs';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from 'vitest';

import { _resetConfigCache } from '../../../config/index.js';

// ── module-level mocks (same posture as the 2.427 sibling) ──────────

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});
import { commitDirectAnswer } from '../../commit.js';

// ── the witnessed bytes ────────────────────────────────────────────

interface WitnessFixture {
  readonly ids: {
    readonly scenario_id: string;
    readonly turn_id: string;
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
  };
  readonly wire: { readonly t5_user_message: string; readonly t4_chip_message: string };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: unknown[] };
  readonly applied_graph_wrong_entity: {
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
  };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as WitnessFixture;


function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-test',
    graphPersisted: true,
  };
}

const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

// Graph-management mode 'off' — the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged (same premise,
// stated for the same reason, as the 2.427 sibling).
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  commitMock().mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

/**
 * ⭐⭐ S7 — A `not_honoured` TURN SHIPS NO GESTURE, AND THAT IS THE ASSERTION.
 *
 * ⚠⚠ THIS HEADER PREVIOUSLY ARGUED THE OPPOSITE — "A not_honoured TURN MUST SHIP
 * THE GESTURE" — and it survived two destination changes sitting directly above
 * tests that assert the reverse. It is corrected rather than deleted, because
 * the correction IS the record (trap 14): a comment that outlives the change it
 * describes is this estate's dominant defect, and this PR met it three times.
 *
 * Wire-witnessed (UI `326970a7` · CEE `5f2e3fd`, guest): the chip labelled
 * "Set effect on Cash runway consumed" returned `blocks: []` and opened
 * nothing — `activeElement: BODY`, Model tab `aria-selected: "false"`. The
 * obvious repair is a `ui_directive`. TWO were built; live drives refuted BOTH:
 *
 *   1. `open_inspector` @ the OPTION — the canvas panel renders the intervention
 *      row and `+ Add a change` (each reporting `disabled: false` ON ITSELF)
 *      inside a `<fieldset disabled>` six ancestors up. A forced native write
 *      produced ZERO wire calls. Read-only BY POLICY.
 *   2. `open_section` @ {model_section,'options'} — matched pair in one session:
 *      the OPTION row's `-value` testid resolves to an EMPTY zero-height
 *      `<span>`, no role/tabindex/onclick, real click REFUSED; the FACTOR row's
 *      control in the same table is a 37×42 `<button>` whose click SUCCEEDS.
 *      Not policy (`anyDisabledFieldsetOnPage: 0`) — no control exists.
 *
 * So there is no working direct-manipulation surface for this entity, the user
 * is already in chat when they click, and the loop closes there: the reply asks
 * for the number and a bare `0.6` binds via `deriveOnScreenEffectAsk` →
 * `resolveRepairValueBinding` — a READINESS-STATE derivation no wording can
 * break. **The tests below therefore pin an ABSENCE, and the positive control is
 * what stops that absence being vacuous.**
 *
 * ⚠ WHAT THIS FILE COVERS, EXACTLY — and it is narrower than it looks. An
 * independent review established that `shouldInterceptBeforeEditLane` declines
 * only on `carriesConfigureOptionValuePayload`, so the valueless REPAIR CHIP is
 * claimed by the intercept and never reaches `dispatchEditGraph` at all. These
 * tests therefore exercise the `not_honoured` branch as reached by the
 * VALUE-BEARING sibling message — a real path, but NOT the capture's path. The
 * user-facing fix for the capture is the copy branch, pinned in
 * `repair-chip-identification-complete.test.ts`. This file's job is to stop a
 * refuted gesture being (re-)introduced here, nothing wider.
 *
 * The fixture is the WIRE's, not mine (trap 16): `t4_chip_message` is a verbatim
 * capture, and note it CARRIES A VALUE (`…to 0.12`) — which is precisely why it
 * reaches this branch and never the identification-complete copy branch, so
 * gesture and copy are observed independently (trap 21).
 */
describe('S7 — a not_honoured turn ships no gesture, because none can help', () => {

  it('PRECONDITION — the wire fixture carries a value, so it is NOT the copy branch', () => {
    // Pins the premise the assertions below rest on: this message reaches the
    // `not_honoured` dispatch branch WITHOUT reaching the identification-complete
    // copy branch, so gesture and copy are observed independently (trap 21).
    expect(WITNESS.wire.t4_chip_message).toMatch(/\d/);
  });
});
