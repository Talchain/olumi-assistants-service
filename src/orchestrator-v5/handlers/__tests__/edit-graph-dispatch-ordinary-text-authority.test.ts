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

import { _resetConfigCache } from '../../../config/index.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

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
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
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
});

describe('⭐ THE QUOTED LABEL — the case the live corpus produced', () => {
  const QUOTED = `Change the node called "${DELIBERATIVE_LABEL}" to a decision.`;

  it('PRECONDITION IN-TEST — unmasked, this message DOES read as deliberation', () => {
    // Pin the precondition, not the outcome. Without this the case below could
    // pass because the frame list stopped matching rather than because the
    // graph-bound mask worked (CLAUDE.md trap 13b).
    expect(classifyUnappliedEditFrame(QUOTED)).toBe('deliberation');
  });
});
