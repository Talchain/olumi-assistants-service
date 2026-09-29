/**
 * ⭐⭐⭐ END-TO-END THROUGH THE DISPATCHER: an advice turn must not COMMIT.
 *
 * ═══ WHY THIS FILE EXISTS SEPARATELY FROM THE AUTHORITY'S OWN SPEC ═══
 * `routing/__tests__/ordinary-text-authority-write-gate.test.ts` proves the
 * VERDICT. It proves nothing about whether this lane ACTS on it — and a verdict
 * nothing consumes is this estate's single most-repeated defect ("WE BUILD MORE
 * THAN WE PLUG IN"). It was real here in the sharpest possible form: the estate
 * has owned a ratified deliberation classifier for months, `edit-graph.ts` has
 * IMPORTED it for months, and it was consulted ONLY in the no-op branch to WORD
 * a reply. It never touched the write decision. This file executes the decision.
 *
 * ═══ THE DEFECT, MEASURED AT PRISTINE `f19d1a92` THROUGH THIS DISPATCHER ═══
 *   USER    "Should we rename this?"
 *   RESULT  `commitDirectAnswer` received a MUTATED GRAPH and the reply
 *           confirmed the rename.
 *   RED-first signature:
 *     AssertionError: expected { nodes: [ …12 items… ], edges: […] }
 *     to be undefined
 *     at `commitMock().mock.calls[0]![1].graph`
 *
 * `grep -c warrant` over `edit-graph-dispatch.ts` read **0** at that tip
 * (in-file contrast control `scope_unresolved`: 3, so the probe could see), and
 * `orchestrator/route-v2.ts` imports only the two NEGATIVE warrant helpers. The
 * lane had no affirmative authority of any kind.
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (CLAUDE.md trap 19): remove
 * `!ordinaryTextAuthorityWithheld` from the `effectiveAppliedMutation`
 * conjunction and the WITHHOLD case must go red; remove the copy branch and the
 * REPLY case must go red. They are separate assertions because they are separate
 * failures — a write that lands silently, and a turn that confirms a change it
 * did not make.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describe, it, expect, vi, beforeEach, afterEach, type MockedFunction,
} from 'vitest';
import type { FastifyRequest } from 'fastify';

import { _resetConfigCache } from '../../../config/index.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({ handleEditGraph: vi.fn() }));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapter: vi.fn().mockReturnValue({}) }));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return { ...actual, loadPersistedGraphStrict: vi.fn().mockResolvedValue(null) };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../../routing/mutation-consent.js';
import { classifyUnappliedEditFrame } from '../../compose/unapplied-edit-reply.js';

const CAPTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./buy-capture-a3b0548d.json', import.meta.url)), 'utf8'),
) as { nodes: Array<Record<string, unknown>>; edges?: unknown[] };

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

/** The node the edits below target — the capture's own decision node. */
const TARGET_ID = CAPTURE.nodes[0]!.id as string;
const NEW_LABEL = 'Launch in Q3';

/**
 * ⭐ THE LABEL FROM THE LIVE CORPUS. Two of the three deliberative-framed
 * mutating turns were FALSE POSITIVES because a user's graph carried a node
 * whose LABEL is itself a deliberative question. The mask exists for these two.
 */
const DELIBERATIVE_LABEL = 'What should we do?';

function ingressGraph(withDeliberativeLabel: boolean): GraphStateIngress {
  const g = clone(CAPTURE);
  if (withDeliberativeLabel) {
    for (const n of g.nodes) if (n.id === TARGET_ID) n.label = DELIBERATIVE_LABEL;
  }
  return g as unknown as GraphStateIngress;
}

function renamedGraph(from: GraphStateIngress): GraphV3T {
  const g = clone(from) as unknown as { nodes: Array<Record<string, unknown>> };
  for (const n of g.nodes) if (n.id === TARGET_ID) n.label = NEW_LABEL;
  return g as unknown as GraphV3T;
}

function appliedResult(graph: GraphV3T, assistantText: string): EditGraphResult {
  return {
    blocks: [], assistantText, latencyMs: 1000,
    appliedGraph: graph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_node', path: TARGET_ID, value: { label: NEW_LABEL } }],
    appliedChanges: {
      summary: assistantText,
      changes: [{ label: NEW_LABEL, description: 'renamed.', element_ref: TARGET_ID }],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'low', rationale: '' }],
  } as unknown as EditGraphResult;
}

const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
const STUB_REQUEST = {} as FastifyRequest;

interface DispatchOverrides {
  readonly deliberativeLabel?: boolean;
  readonly source?: 'composer' | 'chip_click';
  readonly chipActionType?: string;
}

async function dispatch(message: string, requestId: string, over: DispatchOverrides = {}) {
  const graphState = ingressGraph(over.deliberativeLabel === true);
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
    appliedResult(renamedGraph(graphState), `Renamed to "${NEW_LABEL}".`),
  );
  return dispatchEditGraph({
    payload: {
      kind: 'message' as const,
      scenario_id: 'scen-ordinary-text-authority',
      turn_id: 'turn-ota-1',
      stage: 'frame' as const,
      message,
      turn_class: 'frame' as const,
      source: over.source ?? ('composer' as const),
      ...(over.chipActionType === undefined
        ? {}
        : { chip: { action_type: over.chipActionType } }),
    } as Parameters<typeof dispatchEditGraph>[0]['payload'],
    requestId,
    request: STUB_REQUEST,
    graphState,
    analysisState: null,
  });
}

beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  commitMock().mockResolvedValue({
    response: {}, performed: true as const, persisted_row_id: 'row-test', graphPersisted: true,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('the edit lane asks whether the user AUTHORISED the write', () => {
  it('PRECONDITION — the fixture is what it claims, and the classifier already calls this deliberation', () => {
    // Bind to the ratified classifier by IDENTITY. If the frame list ever
    // stopped matching this sentence, every case below would pass vacuously.
    expect(classifyUnappliedEditFrame('Should we rename this?')).toBe('deliberation');
    expect(classifyUnappliedEditFrame(`Rename it to "${NEW_LABEL}".`)).toBe('instruction');
    expect(CAPTURE.nodes.length).toBeGreaterThan(0);
    expect(renamedGraph(ingressGraph(false)).nodes.find((n) => n.id === TARGET_ID)?.label)
      .toBe(NEW_LABEL);
  });

  it('⭐ ADVICE WITHHOLDS — the model is provably unchanged', async () => {
    // RED at pristine: `graph` was the 12-node mutated graph.
    await dispatch('Should we rename this?', 'req-advice-withhold');
    expect(commitMock()).toHaveBeenCalledTimes(1);
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });

  it('⭐ AND THE REPLY SAYS SO FIRST — no confirmation of a change that did not happen', async () => {
    const out = await dispatch('Should we rename this?', 'req-advice-reply');
    const text = out.response.assistant_text ?? '';
    expect(text.startsWith('Nothing has been changed.')).toBe(true);
    // It OFFERS rather than refusing…
    expect(text).toContain('Say the word and I will make it');
    // …and the edit LLM's own rename receipt does not survive beside it.
    expect(text).not.toContain(`Renamed to "${NEW_LABEL}"`);
  });

  it('the withheld turn surfaces no applied-mutation signal downstream', async () => {
    const out = await dispatch('Should we rename this?', 'req-advice-downstream');
    // `effectiveAppliedMutation` is this dispatcher's SINGLE gate: the returned
    // graph is the same fact as the persisted one.
    expect(out.graph).toBeNull();
  });

  /**
   * ⭐⭐ A TURN THAT APPLIED NOTHING SAID NOTHING FALSE — so this gate has
   * nothing to withdraw and MUST NOT speak over it.
   *
   * A GUARD FOUND THIS, and it is recorded rather than silenced: the first
   * version of the copy branch fired on `ordinaryTextAuthorityWithheld` alone
   * and went RED against
   * `edit-graph-dispatch-early-emit-authoritative.test.ts`'s pre-LLM intercept
   * path. An instrumented run printed `successfulAppliedMutation: false,
   * effectiveAppliedMutation: false` — that turn was ALREADY a no-op at
   * pristine, so the conjunct changed nothing about its write and the only
   * effect was replacing a correct Stage-1 coaching reply with a demotion notice
   * about a change nobody had proposed. The branch now binds by IDENTITY to a
   * write that really happened and is really being withheld.
   */
  it('a turn that APPLIED NOTHING keeps its own reply — the gate does not speak over a no-op', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue({
      blocks: [], assistantText: 'I can carry that forward in one of three ways.',
      latencyMs: 10, appliedGraph: null, wasRejected: false, operations: [],
    } as unknown as EditGraphResult);
    const out = await dispatchEditGraph({
      payload: {
        kind: 'message' as const, scenario_id: 'scen-ordinary-text-authority',
        turn_id: 'turn-ota-noop', stage: 'frame' as const,
        message: 'Should we rename this?', turn_class: 'frame' as const,
        source: 'composer' as const,
      },
      requestId: 'req-noop', request: STUB_REQUEST,
      graphState: ingressGraph(false), analysisState: null,
    });
    expect(out.response.assistant_text).toContain('carry that forward');
    expect(out.response.assistant_text).not.toContain('Nothing has been changed.');
  });

  it('CONTRAST: an EXPLICIT rename still saves in ONE turn', async () => {
    await dispatch(`Rename it to "${NEW_LABEL}".`, 'req-explicit');
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });

  it('CONTRAST: a MIXED message — advice plus an explicit value edit — still saves', async () => {
    const m = 'Do you think churn is too high? Set churn to 5%.';
    expect(classifyUnappliedEditFrame(m)).toBe('deliberation');
    await dispatch(m, 'req-mixed');
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });

  it('CONTRAST: a TYPED MUTATION CHIP is the instruction — text is not re-read', async () => {
    await dispatch('Should we rename this?', 'req-chip', {
      source: 'chip_click',
      chipActionType: [...GRAPH_MUTATING_HANDLER_IDS][0]!,
    });
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });

  it('a PLAIN-message chip is NOT a stronger source — it is judged by its text', async () => {
    // The discrimination for the case above: without this, "chip turns always
    // save" would pass it while meaning something entirely different.
    await dispatch('Should we rename this?', 'req-plain-chip', { source: 'chip_click' });
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });
});

describe('⭐ THE QUOTED LABEL — the case the live corpus produced', () => {
  const QUOTED = `Change the node called "${DELIBERATIVE_LABEL}" to a decision.`;

  it('PRECONDITION IN-TEST — unmasked, this message DOES read as deliberation', () => {
    // Pin the precondition, not the outcome. Without this the case below could
    // pass because the frame list stopped matching rather than because the
    // graph-bound mask worked (CLAUDE.md trap 13b).
    expect(classifyUnappliedEditFrame(QUOTED)).toBe('deliberation');
  });

  it('with the label ON the graph, the write still lands', async () => {
    await dispatch(QUOTED, 'req-quoted-masked', { deliberativeLabel: true });
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });

  it('DISCRIMINATING TWIN — with the label OFF the graph, the same message is withheld', async () => {
    // The mask is bound to THIS graph. One message, two graphs, two verdicts:
    // that pair is what proves the mask is reading the model rather than
    // blanking any quoted span it finds.
    await dispatch(QUOTED, 'req-quoted-unmasked', { deliberativeLabel: false });
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });
});
