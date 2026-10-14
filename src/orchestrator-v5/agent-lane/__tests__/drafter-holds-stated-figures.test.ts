/**
 * ⭐ #2923 CLAUSE (b) (DL 14 Oct): the drafter holds every current figure the brief states as the user's own, never as an
 * Olumi estimate or only as a question. At 38d42ff7 a stated non-goal figure was held 30/44; the rest became Olumi's guess.
 *
 * The text is bound by identity (`tests/fixtures/drafter-stated-figures/held-figures.json`). The corpus is not the author's:
 * the served hiring post3007 brief and its recorded drafter answer, through the real `buildModelFromBrief`.
 * Whether the drafter now behaves so is AI behaviour, measured on the served build and never claimed here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const TEXT = JSON.parse(readFileSync('tests/fixtures/drafter-stated-figures/held-figures.json', 'utf8')) as { held_figures: string };
const HIRING_BRIEF = (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string;
const HIRING_DRAFT = JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec;
const GOAL_LEVEL_LINE = 'If the whole-goal equivalence is unsupported, missing or conflicting, keep the baseline unknown; do not borrow a component or assume a zero.';
const sid = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

/** The real build of the hiring brief, the drafter answering `draft`: the first request sent and the registered graph. */
async function build(draft: Rec): Promise<{ sent: Rec; graph: Rec }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, HIRING_BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft), status: 'completed' }; }) as never) as Rec;
  if (result.ok !== true || sent === undefined || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph };
}
const developers = (graph: Rec): Rec => (graph.nodes as Rec[]).find((n) => n.label === 'Mid-weight developers')!;

describe('#2923 (b): every current figure the brief states is held as the user\'s own', () => {
  it('RED: the SENT drafter request carries the rule once, directly after the goal\'s current-level rule', async () => {
    const { sent } = await build(HIRING_DRAFT);
    const sentText = sent.instructions as string;
    expect(sentText.split(TEXT.held_figures)).toHaveLength(2);
    expect(sentText).toContain(`${GOAL_LEVEL_LINE} ${TEXT.held_figures}`);
    expect(BUILD_INSTRUCTIONS.split(TEXT.held_figures)).toHaveLength(2);
    // Contrast in the same request: the evidence rule it points to is still sent.
    expect(sentText).toContain('For a factor whose CURRENT level the brief states, give baseline_evidence.quote as the complete verbatim sentence that states it');
  });

  it('what the rule asks for lands as the user\'s figure: the recorded "six mid-weight developers" factor with its quote', async () => {
    const held = (HIRING_DRAFT.factors as Rec[]).find((f) => f.label === 'Mid-weight developers')!;
    expect(held).toMatchObject({ baseline_value: 6, baseline_known: true, provenance: 'explicit', baseline_evidence: { quote: 'We currently have six mid-weight developers, so we\'re lacking leadership.' } });
    const { graph } = await build(HIRING_DRAFT);
    expect(developers(graph).observed_state).toEqual({ value: 0.3, raw_value: 6, cap: 20, declared_scale: 'unit_interval', unit: 'developers', source: 'brief_extraction', extractionType: 'explicit' });
  });

  it('CONTRAST: the same figure without its quote stays an unverified claim, which is why the rule asks for the quote', async () => {
    const unquoted = { ...HIRING_DRAFT, factors: (HIRING_DRAFT.factors as Rec[]).map((f) => f.label === 'Mid-weight developers' ? { ...f, baseline_evidence: null } : f) };
    const { graph } = await build(unquoted);
    expect(developers(graph).observed_state).toMatchObject({ raw_value: 6, source: 'cee_inference', user_material_unverified: true });
  });
});
