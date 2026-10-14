/**
 * ⭐ A REVISED DRAFT SEES THE CURRENT SAVED MODEL AS CONTEXT, NEVER AS THE USER'S WORDS (current-model caller, DL 14 Oct;
 * PL #94 07:32Z Q1: "Model JSON and unknown/reseeded rows are never verified human words").
 *
 * `buildModelFromBrief(..., context)` puts the saved model into the drafter's input only. Every quote, attestation and
 * number check still reads the brief alone, so a sentence that exists only in the saved model cannot be saved as the user's.
 * Real construction (`buildModelFromBrief`) on the served capacity answer (`fixtures/capacity-c85817f2-construction.json`),
 * whose "Existing team capacity" level the verifier credits from the brief; the provider is scripted.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, firstConstructInput, CURRENT_MODEL_CONTEXT_LEAD, type ConstructionContext } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };
const SENTENCE = 'Our existing team resolves 80 tickets per week.';
const CONTEXT: ConstructionContext = { current_model: { factors: [{ label: 'Existing team capacity', value: 80, unit: 'tickets per week', said: SENTENCE }] } };
/** The brief without the sentence: the saved model (context) is the only place it is written. */
const BRIEF_WITHOUT = FX.brief.replace(`${SENTENCE} `, '');

async function construct(brief: string, context?: ConstructionContext): Promise<{ graph: Rec | undefined; result: Rec; inputs: string[] }> {
  let graph: Rec | undefined;
  const inputs: string[] = [];
  const result = await buildModelFromBrief('c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c1', brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'ctx' } };
  }) as never, (async (req: Rec) => { inputs.push(String(req.input)); return { text: FX.raw_text, status: 'completed' }; }) as never,
  undefined, undefined, undefined, undefined, context) as Rec;
  return { graph, result, inputs };
}
const existingTeam = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.label === 'Existing team capacity')!;

describe('the current saved model is the drafter\'s context, never the user\'s words', () => {
  it('without a context the first-pass input is today\'s, byte for byte; with one, the context follows it under its lead', () => {
    expect(BRIEF_WITHOUT).not.toContain(SENTENCE);
    expect(firstConstructInput(FX.brief)).toBe(FX.brief);
    expect(firstConstructInput(BRIEF_WITHOUT, CONTEXT)).toBe(`${BRIEF_WITHOUT}\n\n${CURRENT_MODEL_CONTEXT_LEAD} ${JSON.stringify(CONTEXT.current_model)}`);
  });

  it('⭐ the context reaches the drafter, and a level written only in the saved model is not saved as the user\'s', async () => {
    const { graph, result, inputs } = await construct(BRIEF_WITHOUT, CONTEXT);
    expect(result.ok, JSON.stringify(result).slice(0, 500)).toBe(true);
    expect(inputs[0]).toContain(`${CURRENT_MODEL_CONTEXT_LEAD} ${JSON.stringify(CONTEXT.current_model)}`);
    const node = existingTeam(graph!);
    expect(node.observed_state?.source, JSON.stringify(node.observed_state)).not.toBe('brief_extraction');
    expect(node.observed_state?.extractionType).not.toBe('explicit');
  });

  it('CONTRAST: the same answer on the brief that writes the sentence saves that level as the user\'s', async () => {
    const { graph, result } = await construct(FX.brief);
    expect(result.ok, JSON.stringify(result).slice(0, 500)).toBe(true);
    expect(existingTeam(graph!).observed_state).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit', raw_value: 80 });
  });
});
