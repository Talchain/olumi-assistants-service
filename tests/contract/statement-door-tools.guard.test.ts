/**
 * ⭐ SYSTEM 1 guard (DL systems re-plan 14 Oct, FREEZE + condition 2): the user-statement write tools may only SHRINK. Each one a
 * migration moves onto the ONE statement door (`propose_statement`) is deleted in the same PR, and its name leaves the list below
 * in that PR. A new `propose_*` tool, or a new user-statement argument on `propose_assumptions`, fails here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_TABLE, rowKey } from '../../src/orchestrator-v5/statement-door/role-table.js';

const TOOLS = readFileSync('src/orchestrator-v5/agent-lane/runtime/agent-tools.ts', 'utf8');
const proposeTools = [...new Set([...TOOLS.matchAll(/name: '(propose_[a-z_]+)'/g)].map((m) => m[1]!))].sort();

/** Bespoke USER-STATEMENT tools still to migrate onto the door. SHRINK ONLY: remove a name in the PR that deletes its tool. */
const USER_STATEMENT_TOOLS = ['propose_goal_current_level', 'propose_hiring_times', 'propose_link_effect', 'propose_team_time'];
/** User-statement ARGUMENTS on `propose_assumptions` still to migrate (a statement confirming or describing a factor's figure: M2). */
const USER_STATEMENT_ARGS = ['statements'];
/** Every other proposing tool: Olumi's proposals and structural changes, not a user's statement. A new name fails here (FREEZE). */
const OTHER_TOOLS = ['propose_assumptions', 'propose_goal_deadline', 'propose_goal_target', 'propose_identity', 'propose_limit_change',
  'propose_link_strength', 'propose_link_strengths', 'propose_model_change', 'propose_new_factor', 'propose_new_limit', 'propose_new_option',
  'propose_new_risk', 'propose_option_interventions', 'propose_option_status', 'propose_removal', 'propose_starting_point'];
/** The door's ONE tool (lands with the first migration, M1). */
const DOOR_TOOL = 'propose_statement';

describe('SYSTEM 1: user-statement tools only shrink onto the ONE statement door', () => {
  it('the scan is real: it finds the known tools (positive control)', () => {
    expect(proposeTools.length).toBeGreaterThan(15);
    expect(proposeTools).toContain('propose_assumptions');
  });

  it('no proposing tool exists outside the lists: a new bespoke tool fails (FREEZE)', () => {
    const known = new Set([...USER_STATEMENT_TOOLS, ...OTHER_TOOLS, DOOR_TOOL]);
    expect(proposeTools.filter((t) => !known.has(t))).toEqual([]);
  });

  it('the user-statement list is exactly the bespoke tools still present: a deleted tool leaves the list in the same PR', () => {
    expect(USER_STATEMENT_TOOLS.filter((t) => !proposeTools.includes(t))).toEqual([]);
    // SHRINK ONLY: 6 on 14 Oct (PR-0); 5 on 15 Oct (M4-cohort retired propose_cohort_forecast). Lower it as each migration deletes its tool; never raise it.
    expect(USER_STATEMENT_TOOLS.length).toBeLessThanOrEqual(4);
  });

  it('the user-statement arguments on propose_assumptions only shrink, and no new one is added there', () => {
    const block = TOOLS.slice(TOOLS.indexOf("name: 'propose_assumptions'"), TOOLS.indexOf("name: 'propose_new_option'"));
    const args = ['holds_now', 'statements', 'occurrence_statement', 'stated_occurrence', 'user_statement']
      .filter((a) => new RegExp(`\\b${a}:`).test(block));
    expect(args).toEqual(USER_STATEMENT_ARGS.filter((a) => args.includes(a)));
    expect(USER_STATEMENT_ARGS.filter((a) => !args.includes(a))).toEqual([]);
    expect(USER_STATEMENT_ARGS.length).toBeLessThanOrEqual(1);
  });

  it('the door table has ONE row per (field, carrier), each signed by an AIE ruling (never a test row)', () => {
    expect(new Set(ROLE_TABLE.map(rowKey)).size).toBe(ROLE_TABLE.length);
    for (const r of ROLE_TABLE) expect(r.signed_by, rowKey(r)).toMatch(/^\d{10}$/);
  });
});
