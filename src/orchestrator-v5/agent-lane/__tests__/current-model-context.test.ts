/**
 * ⭐ A REVISED DRAFT SEES THE CURRENT SAVED MODEL AS CONTEXT, NEVER AS THE USER'S WORDS (current-model caller, DL 14 Oct).
 *
 * `buildModelFromBrief(..., context)` puts the saved model into the drafter's input only. Every quote, attestation and
 * number check still reads the brief alone, so a figure or sentence that exists only in the saved model cannot be saved as
 * the user's. Real construction (`buildModelFromBrief`) on T5 D2's real rep 6 draft (`tests/fixtures/size-retry`); the
 * provider is scripted, and one factor is added to that draft whose only source is the context.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, firstConstructInput, CURRENT_MODEL_CONTEXT_LEAD, type ConstructionContext } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const D2 = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
const R = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-v3-retries.json', 'utf8')) as Rec;
const SENTENCE = 'We already run 7 partner webinars per quarter.';
const CONTEXT: ConstructionContext = { current_model: { factors: [{ label: 'Partner webinars per quarter', value: 7, unit: 'webinars', said: SENTENCE }] } };

/** rep 6 with one more factor, typed as the user's and quoting a sentence that only the saved model holds. */
const withContextOnlyFactor = (): Rec => {
  const d = structuredClone(R.retry_rep6) as Rec;
  d.factors.push({ label: 'Partner webinars per quarter', role: 'observable', baseline_known: true, baseline_evidence: { quote: SENTENCE },
    baseline_value: 7, unit: 'webinars', provenance: 'explicit', plausible_max: 20 });
  d.links.push({ from: 'Partner webinars per quarter', to: 'Qualified launch visitors', direction: 'positive', provenance: 'inferred',
    effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return d;
};

async function construct(brief: string, context?: ConstructionContext): Promise<{ graph: Rec | undefined; result: Rec; inputs: string[] }> {
  let graph: Rec | undefined;
  const inputs: string[] = [];
  const result = await buildModelFromBrief('c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c1', brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'ctx' } };
  }) as never, (async (req: Rec) => { inputs.push(String(req.input)); return { text: JSON.stringify(withContextOnlyFactor()), status: 'completed' }; }) as never,
  undefined, undefined, undefined, undefined, undefined, context) as Rec;
  return { graph, result, inputs };
}
const webinars = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.label === 'Partner webinars per quarter')!;

describe('the current saved model is the drafter\'s context, never the user\'s words', () => {
  it('without a context the first-pass input is today\'s, byte for byte', () => {
    expect(firstConstructInput(D2.brief as string)).toBe(D2.brief);
    expect(firstConstructInput(D2.brief as string, CONTEXT)).toBe(`${D2.brief}\n\n${CURRENT_MODEL_CONTEXT_LEAD} ${JSON.stringify(CONTEXT.current_model)}`);
  });

  it('⭐ the context reaches the drafter, and a figure only the saved model holds is not saved as the user\'s', async () => {
    const { graph, result, inputs } = await construct(D2.brief as string, CONTEXT);
    expect(result.ok, JSON.stringify(result).slice(0, 500)).toBe(true);
    expect(inputs[0]).toContain(`${CURRENT_MODEL_CONTEXT_LEAD} ${JSON.stringify(CONTEXT.current_model)}`);
    const node = webinars(graph!);
    expect(node.observed_state?.source, JSON.stringify(node.observed_state)).not.toBe('brief_extraction');
  });

  it('CONTRAST: the same sentence in the brief itself is saved as the user\'s (the check can see attestation)', async () => {
    const { graph, result } = await construct(`${D2.brief as string} ${SENTENCE}`);
    expect(result.ok, JSON.stringify(result).slice(0, 500)).toBe(true);
    expect(webinars(graph!).observed_state?.source).toBe('brief_extraction');
  });
});
