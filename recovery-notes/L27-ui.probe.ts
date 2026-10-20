import { describe, expect, it, vi } from 'vitest';
import { candidateToGraph } from '../src/orchestrator-v5/path-b/tools/candidate-to-graph.js';
import rows from '../src/orchestrator-v5/path-b/tools/__tests__/fixtures/l23-live-drafter-raw-5203fed5.json';
import { GraphV3 } from '../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../src/orchestrator-v5/persisted-graph-projection.js';
import { toOutboundGraph } from '../src/orchestrator-v5/goal-target/outbound-graph.js';
import { resolveGoalTarget } from '/private/tmp/cx-l25/src/canvas/domain/goalTarget';
import { goalTargetSourceMark } from '/private/tmp/cx-l25/src/canvas/nodes/shared/valueSourceMark';
import { servedSwitchReading } from '/private/tmp/cx-l25b/src/canvas/domain/switchFactors';

vi.mock('/private/tmp/cx-l25/src/canvas/store', () => ({ useCanvasStore: vi.fn() }));
vi.mock('/private/tmp/cx-l25/src/canvas/versions/autoCapture', () => ({ captureBeforeIngest: vi.fn() }));
vi.mock('/private/tmp/cx-l25/src/canvas/store/scenarios', () => ({ saveAutosave: vi.fn() }));
// Use the actual projection, but keep imports from starting a browser store.
import { mapDraftNodeToCanvas } from '/private/tmp/cx-l25/src/canvas/utils/applyDraftResult';

type Rec = Record<string, any>;
const raw = JSON.parse(rows[0]!.calls[0]!.raw_text) as Rec;
const words = raw.statements.map((s: Rec) => s.quote).join('\n');
function coldGraph(draft: Rec): Rec {
  const out = candidateToGraph(draft, { words, recorded_at: '2026-10-20T10:02:00.000Z' });
  if ('refused' in out) throw new Error(out.refused);
  return toOutboundGraph(GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(out.graph)))));
}

describe('L27 external readers (read-only trees)', () => {
  it('capacity user target survives the actual DGAI projection and source reader', () => {
    const goal = coldGraph(raw).nodes.find((n: Rec) => n.kind === 'goal');
    const canvas = mapDraftNodeToCanvas(goal);
    expect(canvas.data.threshold_source).toBe('user');
    expect(resolveGoalTarget(canvas.data)).toMatchObject({ raw: 100, source: 'user' });
  });
  it('BLOCKER: an Olumi target must reach the DGAI target source reader as Olumi', () => {
    const draft = structuredClone(raw);
    draft.goal.target_origin = 'olumi';
    const goal = coldGraph(draft).nodes.find((n: Rec) => n.kind === 'goal');
    const canvas = mapDraftNodeToCanvas(goal);
    expect(canvas.data.threshold_source).toBe('cee_inference');
    expect.soft(resolveGoalTarget(canvas.data)?.source).toBe('olumi');
    expect(goalTargetSourceMark(canvas.data).kind).toBe('olumi');
  });
  it('declared state metadata survives actual DGAI projection and reads both endpoints without a baseline', () => {
    const draft = structuredClone(raw);
    draft.factors[1] = { ...draft.factors[1], unit: 'yes/no', baseline_known: false, baseline_value: null, stance: 'hypothetical' };
    const factor = coldGraph(draft).nodes.find((n: Rec) => n.label === draft.factors[1].label);
    const canvas = mapDraftNodeToCanvas(factor);
    expect(canvas.data.factor_type).toBe('boolean');
    expect(canvas.data).not.toHaveProperty('observedState');
    expect(servedSwitchReading(canvas.data, 1)).toBe('In use');
    expect(servedSwitchReading(canvas.data, 0)).toBe('Not in use');
  });
});
