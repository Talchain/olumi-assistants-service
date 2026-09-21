/**
 * ⭐⭐⭐ THE BLOCKER NO EFFECT VALUE CAN CLEAR.
 *
 * ── VERIFIED AT THE BYTES, NOT INHERITED ─────────────────────────────────
 * `cee/transforms/analysis-ready.ts:680-694` stamps any option carrying a
 * non-`bidirected` edge to a RISK as `needs_user_mapping`, and
 * `cee/transforms/option-status.ts:266` short-circuits every other check on
 * `unresolvedTargetCount > 0`. The code's own comment: *"A causal coefficient
 * is not an intervention level; other numeric effects cannot resolve this
 * missing mapping."*
 *
 * ── AND REPRODUCED ON THE ADMISSION AUTHORITY THIS LAYER ACTUALLY READS ───
 * The two are different modules, so that the gate blocks says nothing about
 * what `resolveRunAdmission` reports. Measured here, with the `bidirected`
 * contrast as the control: one added option→risk edge flips a graph that is
 * otherwise `analysis_ready` to `OPTION_NEEDS_MAPPING`, and the SAME edge
 * marked `bidirected` leaves it ready.
 *
 * The graph is the append-only 21 Sep capture. It carries risk nodes but NO
 * option→risk edge — which is exactly why it is analysable — so the edge is
 * added in memory, from the capture's own edge shape. The file is never written.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildRepairPlan } from '../repair-plan.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import {
  createProposeRepairsTool,
  createResolveBlockedLinkTool,
  RESOLVE_BLOCKED_LINK_TOOL_NAME,
} from '../repair-tools.js';
import { buildReplacementTools } from '../turn-entry.js';
import { EMPTY_CONVERSATION_MEMORY } from '../conversation-memory.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8');

/** From the capture. Neither is invented. */
const SMB = '3f02dabe';
const RISK = '3e7de6bc'; // "Cash Runway Erosion Risk"

/** The capture, plus one option→risk edge copied from its own edge shape. */
function withRiskEdge(edgeType?: 'directed' | 'bidirected') {
  const g = JSON.parse(RAW) as { nodes: any[]; edges: any[] };
  const template = JSON.parse(JSON.stringify(g.edges.find((e) => e.from === SMB)));
  template.from = SMB;
  template.to = RISK;
  if (edgeType !== undefined) template.edge_type = edgeType;
  g.edges.push(template);
  return g;
}
const planFor = (g: unknown) => buildRepairPlan({ admission: resolveRunAdmission(g), graph: g });

describe('one option→risk edge is the whole blocker', () => {
  it('blocks the run, and the bidirected CONTROL does not', () => {
    // The pair is the evidence. Either alone would be consistent with a graph
    // that was already blocked, or with a plan that never blocks anything.
    expect(resolveRunAdmission(JSON.parse(RAW)).willProceed, 'the capture itself is ready').toBe(true);
    const blocked = resolveRunAdmission(withRiskEdge());
    expect(blocked.willProceed).toBe(false);
    expect(blocked.strict.reasonCodes).toContain('OPTION_NEEDS_MAPPING');
    expect(resolveRunAdmission(withRiskEdge('bidirected')).willProceed, 'CONTROL').toBe(true);
  });

  it('the option is NOT missing a value — so no "set this" repair could clear it', () => {
    // The measured shape of the real defect: the option carries its effects.
    const g = withRiskEdge();
    const option = g.nodes.find((n) => n.id === SMB)!;
    expect(Object.keys(option.interventions as Record<string, unknown>).length).toBe(3);
  });

  it('the exclusion route does NOT reach it, and the control shows the route works', () => {
    // `OPTION_NEEDS_MAPPING` is in WAIVABLE_BY_EXCLUSION, but the exclusion gate
    // only ever considers options with EMPTY interventions. Without the control
    // below, "waived is empty" would be equally consistent with an exclusion
    // mechanism that never fires on this graph at all.
    const blocked = resolveRunAdmission(withRiskEdge());
    expect(blocked.waivedOptionIds).toEqual([]);
    expect(blocked.plan.will_scaffold_options).toBe(false);

    const emptied = JSON.parse(RAW) as { nodes: any[] };
    delete emptied.nodes.find((n) => n.id === SMB)!.interventions;
    const control = resolveRunAdmission(emptied);
    expect(control.waivedOptionIds, 'CONTROL — the same machinery does fire').toContain(SMB);
    expect(control.plan.will_scaffold_options).toBe(true);
  });
});

describe('the plan names the link, not a factor', () => {
  it('reports the blocked link with both resolutions and withholds the factor question', () => {
    const plan = planFor(withRiskEdge());

    expect(plan.analysable).toBe(false);
    expect(plan.blocked_links).toHaveLength(1);
    const link = plan.blocked_links[0]!;
    expect(link.option_id).toBe(SMB);
    expect(link.risk_id).toBe(RISK);
    expect(link.risk_label).toBe('Cash Runway Erosion Risk');

    // ⭐ THE AUTHORITY'S OWN PROMPT NAMES A FACTOR. Kept on the record, and
    // deliberately NOT relayed as a question.
    expect(link.authority_prompt).toMatch(/Choose which factor/i);
    expect(
      plan.asks.some((a) => a.issue_id === link.issue_id),
      'the wrong question must not also be asked',
    ).toBe(false);

    // Non-destructive first, and both are present.
    expect(link.resolutions.map((r) => r.kind)).toEqual(['keep_out_of_comparison', 'remove_link']);
    expect(link.resolutions[0]!.caveat, 'what bidirected actually records is said out loud').toMatch(
      /unmeasured common cause/i,
    );
    expect(JSON.stringify(link.resolutions[0]!.operations)).toContain('"edge_type":"bidirected"');
    expect(JSON.stringify(link.resolutions[1]!.operations)).toContain('"op":"remove_edge"');
    // Edges are addressed `from::to` on the internal patch path.
    for (const r of link.resolutions) {
      expect(JSON.stringify(r.operations)).toContain(`${SMB}::${RISK}`);
    }
  });

  it('CONTRAST — an unblocked graph produces no link repair at all', () => {
    // Without this, "one blocked link" would be equally satisfied by a deriver
    // that reports every option→risk edge whether or not it blocks anything.
    expect(planFor(withRiskEdge('bidirected')).blocked_links).toHaveLength(0);
    expect(planFor(JSON.parse(RAW)).blocked_links).toHaveLength(0);
  });

  it('the tool leads with the link and forbids asking for a number', () => {
    const tool = createProposeRepairsTool({ getGraph: () => withRiskEdge() });
    const outcome = tool.execute({}) as { type: string; content?: string; parts?: { summary: string }[] };
    expect(outcome.type).toBe('proposed');
    const content = String(outcome.content);
    expect(content).toContain('HELD BACK BY A LINK, NOT BY A MISSING NUMBER');
    expect(content).toContain('Cash Runway Erosion Risk');
    expect(content).toMatch(/Do NOT ask them for a number here/);
    // The link repair is staged FIRST — it is the only one that unblocks a run.
    expect(outcome.parts![0]!.summary).toMatch(/Keep the link/);
    // Positive control for the `toMatch` above: the content is real and long.
    expect(content.length).toBeGreaterThan(400);
  });
});

describe('the amend route lets them keep the link instead of losing it', () => {
  it('only the non-destructive resolution is staged; removal is reached by amending', () => {
    const tool = createProposeRepairsTool({ getGraph: () => withRiskEdge() });
    const outcome = tool.execute({}) as { parts?: { summary: string; operations: unknown[] }[] };
    const staged = JSON.stringify(outcome.parts);
    expect(staged).toContain('"edge_type":"bidirected"');
    // ⛔ A user must not be able to agree to deleting their own modelling by
    // saying "yes" to the set.
    expect(staged, 'removal is never staged by default').not.toContain('remove_edge');
  });

  it('resolve_blocked_link proposes removal as an amendment and never writes', () => {
    const tool = createResolveBlockedLinkTool({ getGraph: () => withRiskEdge() });
    const outcome = tool.execute({
      option_id: SMB,
      risk_id: RISK,
      resolution: 'remove_link',
      amends_proposal_id: 'proposal-turn-1-0',
    }) as { type: string; amends?: string; operations?: unknown[]; content?: string };

    expect(tool.kind, 'a propose tool can never record consent').toBe('propose');
    expect(outcome.type).toBe('proposed');
    expect(outcome.amends).toBe('proposal-turn-1-0');
    expect(JSON.stringify(outcome.operations)).toContain('"op":"remove_edge"');
    expect(String(outcome.content)).toMatch(/DELETES a relationship they put on the model/);
  });

  it('refuses a pair the authority does not report as blocked', () => {
    // Otherwise this tool is a licence to delete any option→risk edge by
    // calling it a repair.
    const tool = createResolveBlockedLinkTool({ getGraph: () => JSON.parse(RAW) });
    const outcome = tool.execute({ option_id: SMB, risk_id: RISK, resolution: 'remove_link' }) as {
      type: string;
      content?: string;
    };
    expect(outcome.type).toBe('refused');
    expect(String(outcome.content)).toMatch(/No option is blocked by a link to a risk/);

    // CONTRAST: on a genuinely blocked graph the SAME call is accepted, so the
    // refusal above is the guard and not a broken tool.
    const live = createResolveBlockedLinkTool({ getGraph: () => withRiskEdge() });
    expect((live.execute({ option_id: SMB, risk_id: RISK, resolution: 'remove_link' }) as { type: string }).type)
      .toBe('proposed');
  });

  it('is offered by buildReplacementTools, by name', () => {
    const names = buildReplacementTools({
      getGraph: () => withRiskEdge() as never,
      getAnalysis: () => null,
      getMemory: () => EMPTY_CONVERSATION_MEMORY,
    }).map((t) => t.definition.name);
    expect(names).toContain(RESOLVE_BLOCKED_LINK_TOOL_NAME);
  });
});
