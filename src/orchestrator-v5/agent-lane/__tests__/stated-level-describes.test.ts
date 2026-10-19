/**
 * ⭐ S2 — WORDS THAT DESCRIBE A FACTOR ARE KEPT AS THEIRS; THE NUMBER IS OLUMI'S (DL 14 Oct; SCIENCE's marketing capture; PL
 * 18:41Z: "never manufacture a numeric level from qualitative words, and never re-ask what was said"). Served marketing e2e
 * 828a36d0 (CEE 5e3d631e): the brief says "I'm not that experienced with marketing"; the drafter made it the FACTOR
 * ‘Founder marketing experience’ with no level, and the Run stayed withheld on "What is … today, before any option changes it?".
 * The step is now Olumi's labelled, press-only starting estimate, with the user's words quoted on its card.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextStepBlockerForAgent, runWithheldBlockerOf } from '../next-step-blocker.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { valueClassOf } from '../../../cee/provenance/provenance-of.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const BODY = (JSON.parse(readFileSync(new URL('./fixtures/marketing-e2e-828a36d0-read08-after-reopen.json', import.meta.url), 'utf8')) as Rec).body as Rec;
const FACTOR = 'founder_marketing_experience';
const SENTENCE = 'I can\'t spend more than 25% of my time on this, and I\'m not that experienced with marketing.';
const read = (body: Rec) => ({ raw: body.graph, analysis_state: body.analysis_state, analysis_ready: body.current_read.analysis_ready,
  analysis_result: body.analysis_result });

function product() {
  let graph: Rec = structuredClone(BODY.graph);
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Rec;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Rec;
      if (ev.kind !== 'factor_value_edit') return { status: 400, json: {} };
      const res = await applyFactorValueEdit({ payload: { kind: 'system_event', turn_id: String(b.turn_id), scenario_id: BODY.scenario_id, stage: 'frame', event: ev } as never,
        event: ev as never, requestId: `w${rev}`, persistedGraph: graph as never, priorFacts: [] });
      if (res.kind !== 'mutated') return { status: 200, json: { assistant_text: 'Not changed.' } };
      graph = (res as unknown as { mutatedGraph: Rec }).mutatedGraph;
      rev += 1;
      const fact = (res as unknown as { handlerFacts: Rec[] }).handlerFacts.find((f) => f.fact_type === 'set_factor_value');
      return { status: 200, json: { assistant_text: 'Saved.', graph_hash: `h${rev}`, blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: String(ev.target_id), after: fact?.result.after }] } };
    }
    return { status: 200, json: { graph, graph_hash: `h${rev}`, brief_text: BODY.brief_text } };
  };
  return { d, node: () => (graph.nodes as Rec[]).find((n) => n.id === FACTOR)!, graph: () => graph };
}
const ctx = (extra: Rec = {}) => ({ scenario_id: BODY.scenario_id, authenticated_user_id: null, request_id: 'r',
  user_text: [BODY.brief_text, 'What do you need from me?'].join('\n'), user_turn_text: 'What do you need from me?', ...extra });
const estimate = (quote: string) => ({ assumptions: [{ factor_label: 'Founder marketing experience', value: 20, unit: '', user_stated: false,
  basis: 'You describe yourself as not very experienced with marketing, so Olumi starts low.', statements: [{ quote, form: 'describes' }] }] });

describe('S2 describes: the user’s words about a factor are kept as theirs; its number is Olumi’s, labelled and press-only', () => {
  it('PRECONDITION + the step: the Run is withheld on the factor, and the ONE next step is Olumi’s proposable starting estimate', () => {
    expect(BODY.brief_text).toContain(SENTENCE);
    expect(BODY.current_read.analysis_ready.blockers).toEqual([expect.objectContaining({ factor_id: FACTOR, blocker_type: 'missing_value' })]);
    // As served, Olumi's provisional objective is asked first (ranked before any input, DL ruling on C1's check 3005).
    expect(nextStepBlockerForAgent(read(BODY))).toMatchObject({ kind: 'missing_input', cause: 'objective_provisional' });
    // The withheld Run's own step (ranked after the purpose and the target, unchanged) names the card that can fill the gap.
    expect(runWithheldBlockerOf(BODY.graph, BODY.current_read.analysis_ready)).toEqual({ kind: 'missing_input',
      ask: BODY.current_read.analysis_ready.blockers[0].message, proposable_by: { tool: 'propose_assumptions', node_id: FACTOR, field: 'starting_value' } });
  });
  it('RED→GREEN: his sentence → ONE card quoting it with Olumi’s labelled figure → the press → a level that is Olumi’s accepted estimate, never his', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const card = await caps.proposeAssumptions(ctx() as never, estimate(SENTENCE) as never) as Rec;
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(String(card.public_label)).toContain(`\nFrom your words: “${BODY.brief_text}” Olumi’s figure from them is its own estimate, not yours.\n`);
    expect(String(card.public_label)).toMatch(/^Adopt 1 starting assumption: Founder marketing experience = /);
    expect(card.assumptions).toEqual([expect.not.objectContaining({ your_figure: true })]);
    expect(p.node().observed_state ?? null, 'nothing before the press').toBeNull();
    expect(await caps.authoriseChange(ctx({ user_text: 'Yes' }) as never, { proposal_id: String(card.proposal_id) })).toMatchObject({ ok: true });
    const os = p.node().observed_state as Rec;
    expect(os.raw_value ?? os.value * 100).toBe(20);
    expect(valueClassOf(os), 'Olumi’s estimate, accepted: never the user’s stated figure').toBe('user_ratified');
    expect(((buildCanonicalAnalysisReadyFromGraph(p.graph()) as Rec).blockers ?? []).filter((b: Rec) => b.factor_id === FACTOR)).toEqual([]);
  });
  // ⭐ GATE → LABEL R5 (real path, Codex amendment 1 "approval never changes who supplied a claim"): a figure the user RELAYS from a named
  // party is a card quoting that party, never "your figure"; its press writes human material whose role stays unverified, never theirs.
  it('R5: a relayed party’s figure → labelled card → the press → kept as unverified human material, never the user’s stated figure', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const relayed = 'My cofounder reckons our marketing experience is a 20.';
    const card = await caps.proposeAssumptions(ctx({ user_text: [BODY.brief_text, relayed].join('\n'), user_turn_text: relayed }) as never, { assumptions: [{
      factor_label: 'Founder marketing experience', value: 20, unit: '', user_stated: true, basis: 'the cofounder’s figure',
      statements: [{ quote: relayed, said_by: 'party', party: 'My cofounder', form: 'point', value: 20 }] }] } as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, assumptions: [{ value: 20, user_material_unverified: true,
      not_the_users_statement: `Reported source: My cofounder, as relayed by you: “${relayed}”` }] });
    expect(card.assumptions).toEqual([expect.not.objectContaining({ your_figure: true })]);
    expect(String(card.public_label)).toMatch(/^Reported source: My cofounder, as relayed by you: “My cofounder reckons our marketing experience is a 20\.”\. The quoted source is retained as shown; approving does not make it your own statement of the figure\. Use 1 figure from the quoted words: /);
    expect(p.node().observed_state ?? null, 'nothing before the press').toBeNull();
    // Its press is the card's own (a card whose figure carries its source binds only the displayed card).
    const pressed = await caps.authoriseChange(ctx({ user_text: 'Yes', typed_approval_of: String(card.proposal_id) }) as never, { proposal_id: String(card.proposal_id) });
    expect(pressed, JSON.stringify(pressed)).toMatchObject({ ok: true });
    const os = p.node().observed_state as Rec;
    expect(os).toMatchObject({ user_material_unverified: true });
    expect(valueClassOf(os), 'never the user’s stated figure').not.toBe('user_stated');
  });

  // ⭐ GATE → LABEL (change 1; Codex amendment 1): words that are not his own are quoted with their source, never as "your words"; the
  // figure stays Olumi's estimate either way, and nothing is written before the press.
  it('never on other words: a partial quote, or retained unverified words, are labelled by their source, never "your words"', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    // Not his literal words ("in marketing"). A literal span of his sentence is his under the confirmed lean-core widening.
    const partial = await caps.proposeAssumptions(ctx() as never, estimate('not that experienced in marketing') as never) as Rec;
    expect(partial).toMatchObject({ ok: true, mutated: false });
    expect(String(partial.public_label)).toContain('Olumi’s proposed reading — source unverified: “not that experienced in marketing”. Olumi’s figure from them is its own estimate, not yours.');
    expect(String(partial.public_label)).not.toContain('From your words');
    const retained = await caps.proposeAssumptions(ctx({ user_text: 'Hi', user_turn_text: 'Hi', unverified_user_text: BODY.brief_text }) as never, estimate(SENTENCE) as never) as Rec;
    expect(retained).toMatchObject({ ok: true, mutated: false });
    expect(String(retained.public_label)).toContain(`Recorded words — speaker/source unknown: “${SENTENCE}”. Olumi’s figure from them is its own estimate, not yours.`);
    expect(p.node().observed_state ?? null).toBeNull();
  });
});
