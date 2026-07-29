/**
 * PROMPT ESTATE — DRIFT CHECK
 *
 * The prompt count was a black box because three surfaces answered it
 * differently and none was derived from the others:
 *   23 PMS rows · 5 keys on /admin/prompts/status · 10 artefacts on live calls.
 *
 * `src/prompts/estate.ts` now derives the reported set. This file is the
 * alarm that keeps it derived. Without it, the count rots again — a derived
 * registry with no drift check is just a mirror with better prose.
 *
 * WHAT IS GUARDED, AND HOW IT FAILS:
 *
 *   1. THE DERIVATION IS REAL, not a hand-list that happens to be right today.
 *      Proven by feeding `deriveEstate()` a SYNTHETIC operation map: a prompt
 *      nobody named must appear in `live`. Replace the derivation with the old
 *      five-key allowlist and this goes RED.
 *   2. NO ORPHAN CALL SITES. A static scan of `src/` finds every literal task
 *      id passed to a prompt-resolution function. Each must be a real
 *      `CeeTaskId` AND known to the estate. Plant
 *      `getSystemPrompt('brand_new')` anywhere in src and this goes RED —
 *      which is the "a newly registered prompt appears without a human
 *      remembering" property, enforced.
 *   3. NO STALE EXCEPTIONS. Every GATED/RETIRED entry must still be a
 *      resolvable task; every gate must name an env var the config actually
 *      reads. Delete a task or rename a flag and this goes RED.
 *   4. THE CODE-CONSTANT HALF IS REAL. Each declared constant must load to a
 *      non-empty string from a file that exists. Rename/remove an export and
 *      this goes RED — the half of the estate PMS cannot see stays visible.
 *   5. THE NAMED DEFECT STAYS FIXED. `repair_edit_graph` — PMS-registered,
 *      live-callable, historically invisible — is pinned into the reported set.
 *
 * Mutation-checked: see PHASE0-EVIDENCE-2026-07-28/harness-hygiene.md for the
 * seven mutants that were proven to bite.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CeeTaskIdSchema } from '../../src/prompts/schema.js';
import { OPERATION_TASK_IDS, OPERATION_TO_TASK_ID } from '../../src/prompts/operations.js';
import {
  ALL_RETIREMENTS,
  CODE_CONSTANT_PROMPTS,
  CRITICAL_PMS_TASKS,
  DEFAULT_PROMPT_VERSIONS,
  ESTATE_INPUTS,
  GATED_PMS_TASKS,
  LIVE_PMS_TASKS,
  PMS_TASK_ALIAS,
  REPORTED_PMS_TASKS,
  RESOLVABLE_PMS_TASKS,
  RETIRED_PMS_ROWS,
  RETIRED_PMS_TASKS,
  deriveEstate,
  dispositionOf,
} from '../../src/prompts/estate.js';
import { STATUS_KEYS, TRACKED_KEYS } from '../../src/prompts/tracked.js';

const REPO_ROOT = resolve(__dirname, '../..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/** Every non-test .ts file under src/. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'generated' || entry === 'node_modules') continue;
      collectSourceFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Literal task ids passed to a prompt-resolution function anywhere in src/.
 *
 * Deliberately a STATIC scan, not a runtime one: a call site behind a
 * default-off flag never executes, so no runtime probe can see it — and those
 * are exactly the prompts that go dark. Comment lines are stripped so the many
 * mentions of these functions in prose do not register as sites.
 *
 * It can still false-positive on a call-shaped substring inside a string
 * literal (it did, on this very suite's first run). That is deliberate: the
 * scan is allowed to over-report, never to under-report. NO FILE IS EXEMPTED —
 * a carve-out list here would be the exact defect the scan exists to catch.
 */
function scanPromptResolutionCallSites(): Map<string, string[]> {
  const pattern =
    /\b(?:getSystemPromptAsync|getSystemPrompt|loadPromptSync|loadPrompt)\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
  const found = new Map<string, string[]>();

  for (const file of collectSourceFiles(SRC_ROOT)) {
    const body = readFileSync(file, 'utf8');
    const code = body
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

    for (const m of code.matchAll(pattern)) {
      const id = m[1];
      const rel = file.slice(REPO_ROOT.length + 1);
      const hits = found.get(id) ?? [];
      if (!hits.includes(rel)) hits.push(rel);
      found.set(id, hits);
    }
  }
  return found;
}

describe('prompt estate — the reported set is DERIVED', () => {
  it('a prompt nobody named appears in `live` automatically', () => {
    // THE PROPERTY THE OLD HAND-LIST LACKED. Wiring a prompt means adding it
    // to OPERATION_TO_TASK_ID (getSystemPrompt throws otherwise). Nothing else
    // should be required for it to become visible.
    const derived = deriveEstate({
      ...ESTATE_INPUTS,
      operationTaskIds: [...ESTATE_INPUTS.operationTaskIds, 'synthetic_new_prompt'],
    });

    expect(
      derived.live,
      'a newly wired prompt must land in `live` without being listed anywhere',
    ).toContain('synthetic_new_prompt');
    expect(derived.reported).toContain('synthetic_new_prompt');
  });

  it('a synthetic prompt declared retired does NOT appear in `live`', () => {
    const derived = deriveEstate({
      ...ESTATE_INPUTS,
      operationTaskIds: [...ESTATE_INPUTS.operationTaskIds, 'synthetic_new_prompt'],
      retired: [...ESTATE_INPUTS.retired, 'synthetic_new_prompt'],
    });
    expect(derived.live).not.toContain('synthetic_new_prompt');
    expect(derived.reported).not.toContain('synthetic_new_prompt');
  });

  it('a synthetic prompt declared gated is reported but not live', () => {
    const derived = deriveEstate({
      ...ESTATE_INPUTS,
      operationTaskIds: [...ESTATE_INPUTS.operationTaskIds, 'synthetic_new_prompt'],
      gated: { ...ESTATE_INPUTS.gated, synthetic_new_prompt: 'SYNTHETIC_FLAG' },
    });
    expect(derived.live).not.toContain('synthetic_new_prompt');
    expect(
      derived.reported,
      'a gated prompt must stay VISIBLE — a gate flip must never serve an unmonitored prompt',
    ).toContain('synthetic_new_prompt');
  });

  it('the exported sets equal the derivation of the real inputs', () => {
    const derived = deriveEstate(ESTATE_INPUTS);
    expect([...RESOLVABLE_PMS_TASKS]).toEqual([...derived.resolvable]);
    expect([...LIVE_PMS_TASKS]).toEqual([...derived.live]);
    expect([...REPORTED_PMS_TASKS]).toEqual([...derived.reported]);
    expect([...STATUS_KEYS]).toEqual([...derived.reported]);
  });

  it('folds the routing→orchestrator alias into ONE artefact', () => {
    // routing and orchestrator are the same prompt reached two ways. Reporting
    // both would inflate the count by exactly the indirection.
    for (const target of Object.values(PMS_TASK_ALIAS)) {
      expect(
        RESOLVABLE_PMS_TASKS as readonly string[],
        `alias TARGET '${target}' must not be reported separately from its logical key`,
      ).not.toContain(target);
    }
    for (const logical of Object.keys(PMS_TASK_ALIAS)) {
      expect(RESOLVABLE_PMS_TASKS as readonly string[]).toContain(logical);
    }
  });
});

describe('prompt estate — the named defect stays fixed', () => {
  it('reports repair_edit_graph (PMS-registered, live-callable, was invisible)', () => {
    // The concrete bug: /admin/prompts/status tracked a hand-listed five keys
    // and repair_edit_graph — resolved by orchestrator/tools/edit-graph.ts on
    // the attempt-≥2 retry — was not one of them.
    expect(LIVE_PMS_TASKS as readonly string[]).toContain('repair_edit_graph');
    expect(STATUS_KEYS as readonly string[]).toContain('repair_edit_graph');
    expect(dispositionOf('repair_edit_graph')).toBe('live');
  });

  it('every task with a prompt-resolution call site is reported or explicitly retired', () => {
    const callSites = scanPromptResolutionCallSites();
    const known = new Set<string>(RESOLVABLE_PMS_TASKS as readonly string[]);
    const retired = new Set<string>(Object.keys(RETIRED_PMS_TASKS));

    for (const [taskId, files] of callSites) {
      expect(
        CeeTaskIdSchema.safeParse(taskId).success,
        `'${taskId}' is resolved at ${files.join(', ')} but is not a CeeTaskId`,
      ).toBe(true);
      expect(
        known.has(taskId) || retired.has(taskId),
        `'${taskId}' is resolved at ${files.join(', ')} but the estate has never heard of it — ` +
          'add it to src/prompts/operations.ts (it will become `live` automatically), ' +
          'or retire it explicitly in src/prompts/estate.ts.',
      ).toBe(true);
    }
  });

  it('the scan can actually SEE a call site (positive control)', () => {
    // An absence assertion that cannot see a presence proves nothing. These
    // three are real, live, and in three different files.
    const callSites = scanPromptResolutionCallSites();
    expect(callSites.get('draft_graph')).toBeDefined();
    expect(callSites.get('repair_edit_graph')).toBeDefined();
    expect(callSites.get('routing')).toBeDefined();
    expect(callSites.size).toBeGreaterThanOrEqual(8);
  });
});

describe('prompt estate — the exception lists cannot go stale', () => {
  it('no task is both gated and retired', () => {
    for (const key of Object.keys(GATED_PMS_TASKS)) {
      expect(
        Object.keys(RETIRED_PMS_TASKS),
        `'${key}' is declared both gated and retired`,
      ).not.toContain(key);
    }
  });

  it('every gated/retired task is still reachable through an operation', () => {
    const operational = new Set<string>(OPERATION_TASK_IDS as readonly string[]);
    for (const key of [...Object.keys(GATED_PMS_TASKS), ...Object.keys(RETIRED_PMS_TASKS)]) {
      expect(
        operational.has(key),
        `'${key}' is declared in an estate exception list but no LLM operation maps to it — ` +
          'the entry is stale, delete it.',
      ).toBe(true);
    }
  });

  it('every gate names an env var the config actually reads', () => {
    // Kills the "flag renamed, gate description now a lie" mirror.
    const configSrc = readFileSync(join(SRC_ROOT, 'config/index.ts'), 'utf8');
    for (const [task, envVar] of Object.entries(GATED_PMS_TASKS)) {
      expect(
        configSrc.includes(envVar),
        `gate '${envVar}' declared for '${task}' does not appear in src/config/index.ts`,
      ).toBe(true);
    }
  });

  it('every retirement has a unique PMS row id', () => {
    const ids = ALL_RETIREMENTS.map((r) => r.promptId);
    expect(new Set(ids).size, 'two retirements claim the same PMS row').toBe(ids.length);
  });

  it('row-level retirements are for tasks no operation can reach', () => {
    // That is what makes them row-level rather than task-level: enrich_factors
    // has no operation (a code constant serves the live path), and
    // clarify_narrate is not even a CeeTaskId any more.
    const operational = new Set<string>(OPERATION_TASK_IDS as readonly string[]);
    for (const [promptId, rec] of Object.entries(RETIRED_PMS_ROWS)) {
      expect(
        operational.has(rec.taskId),
        `row retirement '${promptId}' names task '${rec.taskId}', which IS reachable through an ` +
          'operation — retire the task in RETIRED_PMS_TASKS instead.',
      ).toBe(false);
    }
  });

  it('every retirement states a reason, and every blocked one states why', () => {
    expect(ALL_RETIREMENTS).toHaveLength(
      Object.keys(RETIRED_PMS_TASKS).length + Object.keys(RETIRED_PMS_ROWS).length,
    );
    for (const rec of ALL_RETIREMENTS) {
      expect(rec.reason.length).toBeGreaterThan(20);
      if (rec.archive === 'blocked') {
        expect(
          rec.blockedReason,
          'a blocked archival must say what blocks it — an unexplained permanent exception is ' +
            'how a red becomes background noise',
        ).toBeTruthy();
      } else {
        expect(rec.blockedReason).toBeUndefined();
      }
    }
  });
});

describe('prompt estate — criticality is a guarded subset of live', () => {
  it('every critical key is live', () => {
    for (const key of CRITICAL_PMS_TASKS) {
      expect(LIVE_PMS_TASKS as readonly string[]).toContain(key);
    }
  });

  it('TRACKED_KEYS (health gating) is a strict subset of STATUS_KEYS (reporting)', () => {
    for (const key of TRACKED_KEYS) {
      expect(STATUS_KEYS as readonly string[]).toContain(key);
    }
    expect(TRACKED_KEYS.length).toBeLessThan(STATUS_KEYS.length);
  });

  it('every critical key has a canonical default version', () => {
    for (const key of CRITICAL_PMS_TASKS) {
      expect(
        DEFAULT_PROMPT_VERSIONS[key as keyof typeof DEFAULT_PROMPT_VERSIONS],
        `critical key '${key}' has no DEFAULT_PROMPT_VERSIONS entry — its bundled-default ` +
          'fallback would report an unknown version',
      ).toBeTruthy();
    }
  });

  it('DEFAULT_PROMPT_VERSIONS keys are all real prompt tasks', () => {
    for (const key of Object.keys(DEFAULT_PROMPT_VERSIONS)) {
      expect(CeeTaskIdSchema.safeParse(key).success, `'${key}' is not a CeeTaskId`).toBe(true);
    }
  });
});

describe('prompt estate — the code-constant half is visible and real', () => {
  it('every declared code constant loads to a non-empty string', async () => {
    for (const p of CODE_CONSTANT_PROMPTS) {
      const content = await p.load();
      expect(typeof content, `${p.id} did not resolve to a string`).toBe('string');
      expect(content.length, `${p.id} resolved to an empty string`).toBeGreaterThan(0);
    }
  });

  it('every declared code constant names a file that exists', () => {
    for (const p of CODE_CONSTANT_PROMPTS) {
      expect(existsSync(join(REPO_ROOT, p.sourceFile)), `${p.sourceFile} does not exist`).toBe(
        true,
      );
    }
  });

  it('the two DRAFT_COMPLIANCE_REMINDER copies stay byte-identical', async () => {
    // The constant is duplicated in both adapters. Duplication is tolerable;
    // SILENT divergence is not — the estate reports one hash for both.
    const [{ DRAFT_COMPLIANCE_REMINDER: a }, { DRAFT_COMPLIANCE_REMINDER: o }] = await Promise.all([
      import('../../src/adapters/llm/anthropic.js'),
      import('../../src/adapters/llm/openai.js'),
    ]);
    expect(o).toBe(a);
  });

  it('code-constant ids are unique', () => {
    const ids = CODE_CONSTANT_PROMPTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('prompt estate — the operation map keeps its contract', () => {
  it('every operation maps to a real CeeTaskId', () => {
    for (const [op, task] of Object.entries(OPERATION_TO_TASK_ID)) {
      expect(CeeTaskIdSchema.safeParse(task).success, `operation '${op}' → invalid task`).toBe(
        true,
      );
    }
  });

  it('OPERATION_TASK_IDS is the de-duplicated value set of the map', () => {
    expect([...OPERATION_TASK_IDS].sort()).toEqual(
      [...new Set(Object.values(OPERATION_TO_TASK_ID))].sort(),
    );
  });

  it('dispositions partition the resolvable universe exactly', () => {
    for (const task of RESOLVABLE_PMS_TASKS) {
      expect(dispositionOf(task), `'${task}' has no disposition`).toBeDefined();
    }
    const live = RESOLVABLE_PMS_TASKS.filter((t) => dispositionOf(t) === 'live').length;
    const gated = RESOLVABLE_PMS_TASKS.filter((t) => dispositionOf(t) === 'gated').length;
    const retired = RESOLVABLE_PMS_TASKS.filter((t) => dispositionOf(t) === 'retired').length;
    expect(live + gated + retired).toBe(RESOLVABLE_PMS_TASKS.length);
    expect(live).toBe(LIVE_PMS_TASKS.length);
  });

  it('reports an unknown id as undefined rather than guessing', () => {
    expect(dispositionOf('definitely_not_a_prompt')).toBeUndefined();
  });
});
