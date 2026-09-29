/**
 * coaching-recorded-context — the NONEMPTY context the #1398 comparison must run
 * on, derived from the harness's EXISTING saved fixtures.
 *
 * ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────────
 * Independent review of `d523588a` found the banked contract was assembled from
 * the minimal `makeMessagePayload` with empty `priorTurns`/`priorFacts`: all six
 * packs carried `graph_context: "unavailable"`, zero nodes, edges, options, goals
 * and constraints, and zero `recent_turns`. Q1 kept "£200,000" only because the
 * question text itself says it; Q2 and Q3 had NO budget, NO named options and NO
 * history at all. Paying for those bytes would have measured whether the model
 * can answer a decontextualised question — not whether Olumi reasons usefully
 * from the person's actual model and conversation, which is the whole claim.
 *
 * ── PROVENANCE, AND WHAT IT IS NOT ─────────────────────────────────────────────
 * The graph and brief are the harness's own frozen fixtures, unmodified:
 *   fixtures/frozen-graph.json   — the £200k hire-one-tech-lead vs two-mid-levels
 *                                  model (12 nodes, 18 edges, 3 options)
 *   fixtures/frozen-brief.txt    — "Should we hire one tech lead or two mid-level
 *                                  developers? Budget is £200k ..."
 * The conversation history is a CLEARLY LABELLED synthesis derived from that same
 * brief — it is not a transcript of the 16:47Z native turn, whose text was never
 * recovered. Nothing here is a fresh database read, a provider draft or a new
 * benchmark corpus.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

export interface FrozenGraph {
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly label: string }[];
  readonly edges: readonly unknown[];
  readonly options?: readonly { readonly id: string; readonly label: string }[];
}

export function frozenGraph(): FrozenGraph {
  return JSON.parse(readFileSync(join(FIXTURES, 'frozen-graph.json'), 'utf8')) as FrozenGraph;
}

export function frozenBrief(): string {
  return readFileSync(join(FIXTURES, 'frozen-brief.txt'), 'utf8').trim();
}

/**
 * Two prior turns, SYNTHESISED FROM THE FROZEN BRIEF and labelled as such.
 *
 * They exist so `conversation.recent_turns` is non-zero and so the later
 * questions ("talk me out of it", "what would you ask me next") have something to
 * be a follow-up TO — which is exactly what Q2/Q3 lacked. They deliberately state
 * NO computed result: the comparison runs in the `none` and `stale` states, and a
 * history that quoted figures would hand the model a result the pack says it does
 * not have.
 */
export function recordedPriorTurns(): SessionTurnWithContent[] {
  const rows: readonly { readonly user: string; readonly assistant: string }[] = [
    {
      user: frozenBrief(),
      assistant:
        "I've set this up as a decision between hiring one tech lead and hiring two mid-level " +
        'developers, with delaying the hire as the do-nothing comparison. The goal is shipping the ' +
        'AI features within six months, and the model carries technical architecture quality, team ' +
        'coordination overhead and time to productivity as the things that move it.',
    },
    {
      user: 'The six-month deadline is externally committed — we announced it to customers.',
      assistant:
        'Noted, so the deadline is a hard constraint rather than a target you can trade against. ' +
        'That makes time to productivity matter more than it otherwise would, because a hire who ' +
        'takes three months to become effective only helps in the second half of the window.',
    },
  ];
  return rows.map((r, i) => ({
    id: `recorded_${i}`,
    scenario_id: 'coaching-capability-contract',
    user_id: null,
    turn_id: `t-recorded-${i}`,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `recorded-hash-${i}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 250,
    created_at: `2026-09-08T1${i}:00:00.000Z`,
    user_message: r.user,
    assistant_message: r.assistant,
  })) as unknown as SessionTurnWithContent[];
}

/**
 * The facts the request MUST still carry after assembly. Asserted rather than
 * hoped for: the previous contract looked healthy and was empty.
 */
export const CONTEXT_SURVIVAL_MARKERS: readonly string[] = [
  'Hire One Tech Lead',
  'Hire Two Mid-Level Developers',
  'Ship AI Features Within 6 Months',
  'Team Coordination Overhead',
  'Time to Productivity',
  '£200k',
  'externally committed',
];
