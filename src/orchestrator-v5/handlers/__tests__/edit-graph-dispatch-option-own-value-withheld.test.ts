/**
 * ⭐⭐ `dispatchEditGraph` MUST NOT CONFIRM AN OPTION EDIT IT WROTE TO THE WRONG
 * SEMANTIC CARRIER.
 *
 * Sibling of `edit-graph-dispatch-wrong-entity-write-withheld.test.ts`. That
 * file pins the FACTOR-baseline substitute, reached through a `not_honoured`
 * outcome verdict. This file pins the shape that verdict does not reach: the
 * option's OWN `observed_state`.
 *
 * ═══ THE WITNESSED TURN — deployed CEE `91d39119`, real browser, 30 Aug 2026 ═
 * Owned scenario `0fe8c040-c47a-4010-b68e-9f42ccc275bf`, request `1a0ba66d`,
 * 04:58:13Z, durable version `fb4aafba`.
 *
 *   REQUEST  "Revise Coverage Pilot to staff 30% of support hours, down from
 *            70%. Keep Current Coverage at 40%, and do not change any other
 *            values or causal relationships."  (the auditor then clicked the
 *            product's OWN confirmation)
 *   REPLY    "Confirmed: change 'Coverage Pilot' to 30% and change 'Current
 *            Coverage' to 40%."
 *   READBACK the only graph changes are each OPTION's provenance and its own
 *            `observed_state` (Pilot 30 / unit % / baseline 70; Current 40 /
 *            unit %). The canonical staffing interventions stay 0.7 and 0.4.
 *   RERUN    "Since you changed Coverage Pilot, the picture has stayed the
 *            same … the conclusion held both before and after that change."
 *            Win probabilities unchanged. A robustness claim about an input
 *            that never moved.
 *
 * ⚠ THE GRAPHS ARE THE WIRE'S, NOT MINE (trap 16-inverse). All three are the
 * verbatim `nodes`/`edges` of the auditor's authenticated readbacks, extracted
 * into `../../routing/__tests__/fixtures/option-observed-state-substitution-capture.json`.
 * Historic record: append, never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): removing `!optionOwnValueWithheld`
 * from the `effectiveAppliedMutation` conjunction in `edit-graph-dispatch.ts`
 * MUST turn the withhold assertions below red. The opposite-direction twin —
 * the auditor's explicit positive control — must stay GREEN through that
 * mutation and RED if the withhold widens to swallow a real effect write.
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
import type { FastifyRequest } from 'fastify';

import { _resetConfigCache } from '../../../config/index.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

// ── module-level mocks (same posture as the sibling withhold file) ──

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
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

// ── imports after mocks ────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const CAPTURE = JSON.parse(
  readFileSync(
    new URL(
      '../../routing/__tests__/fixtures/option-observed-state-substitution-capture.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, { nodes: Array<Record<string, unknown>>; edges: unknown[] }>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The auditor's own identities. */
const PILOT_ID = '70180763';
const PILOT_LABEL = 'Coverage Pilot';
const CURRENT_LABEL = 'Current Coverage';
const STAFFED_COVERAGE_ID = '0d2a1d17';
const STAFFED_COVERAGE_LABEL = 'Staffed Coverage';

/** The sentence the auditor typed, verbatim. */
const NATURAL_SENTENCE =
  'Revise Coverage Pilot to staff 30% of support hours, down from 70%. '
  + 'Keep Current Coverage at 40%, and do not change any other values or causal relationships.';

/** The auditor's explicit positive control, verbatim in shape. */
const EXPLICIT_CONTROL_SENTENCE =
  'Set the effect of Coverage Pilot on Staffed Coverage to 0.3 and leave everything else alone.';

/** The product's own false confirmation — the string that must not survive. */
const FALSE_CONFIRMATION =
  "Confirmed: change 'Coverage Pilot' to 30% and change 'Current Coverage' to 40%.";

const INGRESS_BEFORE = clone(CAPTURE.before) as unknown as GraphStateIngress;
const graph = (key: string): GraphV3T => clone(CAPTURE[key]) as unknown as GraphV3T;

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: '0fe8c040-c47a-4010-b68e-9f42ccc275bf',
    turn_id: 'turn-option-own-value',
    stage: 'frame' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function appliedResult(opts: {
  readonly graph: GraphV3T;
  readonly assistantText: string;
  readonly operation: Record<string, unknown>;
  readonly changeLabel: string;
  readonly changeRef: string;
}): EditGraphResult {
  return {
    blocks: [],
    assistantText: opts.assistantText,
    latencyMs: 1000,
    appliedGraph: opts.graph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [opts.operation],
    appliedChanges: {
      summary: opts.assistantText,
      changes: [
        { label: opts.changeLabel, description: 'changed.', element_ref: opts.changeRef },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'low', rationale: '' }],
  } as unknown as EditGraphResult;
}

/** The witnessed applied result: each OPTION's own `observed_state` rewritten. */
const optionOwnValueAppliedResult = (): EditGraphResult =>
  appliedResult({
    graph: graph('after_natural_sentence'),
    assistantText: FALSE_CONFIRMATION,
    operation: {
      op: 'update_node',
      path: PILOT_ID,
      value: { observed_state: { value: 30, unit: '%', source: 'user_override', baseline: 70 } },
    },
    changeLabel: PILOT_LABEL,
    changeRef: PILOT_ID,
  });

/**
 * The auditor's explicit positive control, replayed: the real intervention
 * moves .7 → .3 and no option's own value moves on this turn.
 */
const explicitControlAppliedResult = (): EditGraphResult =>
  appliedResult({
    graph: graph('after_explicit_control'),
    assistantText: `Set the effect of "${PILOT_LABEL}" on ${STAFFED_COVERAGE_LABEL} to 0.3.`,
    operation: {
      op: 'update_node',
      path: PILOT_ID,
      value: { data: { interventions: { [STAFFED_COVERAGE_ID]: 0.3 } } },
    },
    changeLabel: PILOT_LABEL,
    changeRef: PILOT_ID,
  });

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-test',
    graphPersisted: true,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

async function dispatch(message: string, requestId: string, ingress = INGRESS_BEFORE) {
  return dispatchEditGraph({
    payload: makePayload(message),
    requestId,
    request: STUB_REQUEST,
    graphState: ingress,
    analysisState: null,
  });
}

const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

// Graph-management mode 'off' — the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged (same premise,
// and stated for the same reason, as the sibling withhold file).
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

describe('the option-own-value substitution is withheld (30 Aug wire replay)', () => {
  it('D1 — the witnessed write is NOT committed', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionOwnValueAppliedResult(),
    );
    await dispatch(NATURAL_SENTENCE, 'req-own-value-witness');
    expect(commitMock()).toHaveBeenCalledTimes(1);
    // The whole defect in one assertion: on `91d39119` this was DEFINED, and
    // durable version `fb4aafba` carried option `observed_state` values the
    // analysis reads nothing from.
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });

  it('D2 — the receipt FACT is withheld with the write', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionOwnValueAppliedResult(),
    );
    await dispatch(NATURAL_SENTENCE, 'req-own-value-fact');
    expect(commitMock().mock.calls[0]![1].handler_facts).toEqual([]);
  });

  it('D3 — the FALSE CONFIRMATION does not survive (acceptance 1)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionOwnValueAppliedResult(),
    );
    const out = await dispatch(NATURAL_SENTENCE, 'req-own-value-text');
    expect(out.response.assistant_text).not.toContain(FALSE_CONFIRMATION);
    expect(out.response.assistant_text).not.toMatch(/\bConfirmed\b/);
    // The wire must not ship the mutation the store did not keep — which is
    // also what stops a later turn describing an unmoved input as a change
    // that made no difference (acceptance 3): no version is committed, so
    // there is no "since you changed …" for the next rerun to narrate.
    expect(out.graph ?? null).toBeNull();
  });

  it('D4 — the reply asks for the MISSING BINDING, by identity', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionOwnValueAppliedResult(),
    );
    const out = await dispatch(NATURAL_SENTENCE, 'req-own-value-ask');
    const text = out.response.assistant_text ?? '';
    expect(text).toContain('Nothing from that message was saved');
    // Named by identity — the option's own label and the label of the factor
    // it is actually wired to, both from the persisted BEFORE graph.
    expect(text).toContain(`"${PILOT_LABEL}"`);
    expect(text).toContain(`"${CURRENT_LABEL}"`);
    expect(text).toContain(`"${STAFFED_COVERAGE_LABEL}"`);
    // The user's own quantity, in the user's own units — never the internal
    // 0-1 scale (founder ruling).
    expect(text).toContain('30%');
    expect(text).toContain('40%');
    expect(text).not.toContain('0.7');
    expect(text).not.toContain('0.3');
  });

  it("D5 — the product's OWN configure chip is offered, so the ask has an acceptance path", async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionOwnValueAppliedResult(),
    );
    const out = await dispatch(NATURAL_SENTENCE, 'req-own-value-chip');
    const actions = out.response.suggested_actions ?? [];
    const messages = actions.map((a) => a.message ?? '');
    // The prefix `detectConfigureOptionIntent` matches, built from the single
    // source of that copy — never re-spelled here.
    expect(messages).toContain(`Help me configure ${PILOT_LABEL}.`);
    expect(messages).toContain(`Help me configure ${CURRENT_LABEL}.`);
    // No duplicates: one chip per option.
    expect(new Set(messages).size).toBe(messages.length);
  });
});

/**
 * ⭐⭐ THE OPPOSITE-DIRECTION TWIN (trap 22b). A predicate guarding two opposite
 * harms cannot share one window: withholding a turn that DID move the option's
 * effect value would discard the user's real work — the direction this estate
 * calls unacceptable. This is the auditor's own explicit positive control,
 * replayed at the same seam, and it must stay green through every mutant that
 * makes the block above red.
 */
describe('the explicit positive control is untouched (acceptance 2)', () => {
  it('T1 — the real intervention write IS committed', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      explicitControlAppliedResult(),
    );
    await dispatch(
      EXPLICIT_CONTROL_SENTENCE,
      'req-own-value-control',
      clone(CAPTURE.after_natural_sentence) as unknown as GraphStateIngress,
    );
    expect(commitMock()).toHaveBeenCalledTimes(1);
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });

  it('T2 — its reply carries no withheld-write notice', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      explicitControlAppliedResult(),
    );
    const out = await dispatch(
      EXPLICIT_CONTROL_SENTENCE,
      'req-own-value-control-text',
      clone(CAPTURE.after_natural_sentence) as unknown as GraphStateIngress,
    );
    expect(out.response.assistant_text ?? '').not.toContain('Nothing from that message was saved');
  });
});
