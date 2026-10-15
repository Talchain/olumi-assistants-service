/**
 * ⭐ DL DECISION 15 Oct 06:37Z: ADOPT v2 GEN arm C (G3 + GR1; HIRING's verdict, aie-compare-20261015-v2/gen/VERDICT.json): the
 * AIE's exact packet text (`tests/fixtures/sys2/aie-gen-v2-arm-c-packet.json`, copied byte-identical), each applied once.
 * G3: an option's interventions are the settings its action DIRECTLY changes, separate from the response it may cause.
 * GR1: the repair suffix retains every option, risk hypothesis, complete source statement, range, qualification, attributed
 * disagreement, question, causal direction and path (pinned byte for byte in construction-size-retry-keeps-user-actions).
 * Whether the drafter now follows them is AI behaviour, measured on the served build, never claimed here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const PACKET = JSON.parse(readFileSync('tests/fixtures/sys2/aie-gen-v2-arm-c-packet.json', 'utf8')) as { generation: { changes: { id: string; old: string; replacement: string }[] } };
const change = (id: string) => PACKET.generation.changes.find((c) => c.id === id)!;
const SERVED = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };

describe('v2 GEN arm C (DL 06:37Z): the AIE\'s G3 + GR1 text, byte-exact, once', () => {
  it('the packet holds exactly G3 and GR1 for generation', () => {
    expect(PACKET.generation.changes.map((c) => c.id)).toEqual(['G3', 'GR1']);
  });

  it('RED: the SENT first drafter request carries G3 once and never its old text', async () => {
    let sent: Rec | undefined;
    await buildModelFromBrief('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', SERVED.brief, (async (path: string) => (path.endsWith('/graph/register')
      ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } })) as never,
    (async (req: Rec) => { sent ??= structuredClone(req); return { text: SERVED.raw_text, status: 'completed' }; }) as never);
    const text = String(sent?.instructions);
    expect(text.split(change('G3').replacement)).toHaveLength(2);
    expect(text.includes(change('G3').old)).toBe(false);
    expect(BUILD_INSTRUCTIONS.split(change('G3').replacement)).toHaveLength(2);
  });

  it('GR1 replaced the old repair suffix everywhere in the build: no old text remains', () => {
    const src = readFileSync('src/orchestrator-v5/agent-lane/runtime/build-model.ts', 'utf8');
    expect(src.split(change('GR1').replacement)).toHaveLength(2);
    expect(src.includes(change('GR1').old)).toBe(false);
  });
});
