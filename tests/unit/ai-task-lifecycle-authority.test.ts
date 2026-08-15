import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AI_TASK_LIFECYCLE,
  RUNTIME_AI_TASK_AUTHORITY,
} from '../../src/config/model-routing.js';
import { resolveModelAssignment } from '../../src/config/model-assignment.js';
import { CeeTaskIdSchema } from '../../src/prompts/schema.js';

const SRC = join(process.cwd(), 'src');

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

function literalRouterTasks(): string[] {
  const tasks = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'getAdapter' ||
          node.expression.text === 'getAdapterWithResolution') &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        tasks.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...tasks].sort();
}

const LITERAL_ROUTER_TASKS = literalRouterTasks();

describe('AI task lifecycle authority', () => {
  it('matches every literal production router call site without calling compatibility rows live', () => {
    const calls = LITERAL_ROUTER_TASKS;
    expect(calls).toEqual([
      'clarify_brief',
      'critique_graph',
      'decision_review',
      'draft_graph',
      'edit_graph',
      'explain_diff',
      'm2_graph_review',
      'orchestrator',
      'suggest_options',
      'validate_graph',
    ]);

    for (const task of calls) {
      expect(AI_TASK_LIFECYCLE).toHaveProperty(task);
      expect(AI_TASK_LIFECYCLE[task as keyof typeof AI_TASK_LIFECYCLE].state).not.toBe(
        'display_only',
      );
      expect(AI_TASK_LIFECYCLE[task as keyof typeof AI_TASK_LIFECYCLE].state).not.toBe(
        'inert_compatibility',
      );
    }
  });

  it('pins corrected compatibility names to their actual executable tasks', () => {
    expect(AI_TASK_LIFECYCLE).toMatchObject({
      clarification: {
        executable: false,
        state: 'display_only',
        executableTask: 'clarify_brief',
      },
      explainer: {
        executable: false,
        state: 'display_only',
        executableTask: 'explain_diff',
      },
      routing: {
        executable: false,
        state: 'display_only',
        executableTask: 'orchestrator',
      },
      m2_graph_review: {
        executable: false,
        state: 'feature_gated',
      },
      repair_graph: {
        executable: false,
        state: 'inert_compatibility',
      },
    });
  });

  it('retains repair_graph external PMS readiness without inventing an executable call', () => {
    expect(CeeTaskIdSchema.options).toContain('repair_graph');
    expect(LITERAL_ROUTER_TASKS).not.toContain('repair_graph');
    expect(RUNTIME_AI_TASK_AUTHORITY).not.toHaveProperty('repair_graph');
  });

  it('maps only actual runtime calls plus the separately gated M2 path', () => {
    expect(Object.keys(RUNTIME_AI_TASK_AUTHORITY).sort()).toEqual([
      ...LITERAL_ROUTER_TASKS,
      'extraction',
    ].sort());
  });

  it('pins a structured contract, prompt identity, fallback and promotion posture for every runtime row', () => {
    for (const [task, authority] of Object.entries(RUNTIME_AI_TASK_AUTHORITY)) {
      expect(authority.structuredContract.length, task).toBeGreaterThan(8);
      expect(authority.fallback.length, task).toBeGreaterThan(8);
      expect(authority.promptIdentity, task).toMatch(
        /^(runtime_source_version_hash|provider_specific_runtime_or_code_hash|code_hash|caller_owned)$/,
      );
      if (authority.checkedInModel) {
        expect(() => resolveModelAssignment(authority.checkedInModel!)).not.toThrow();
      }
    }
    expect(RUNTIME_AI_TASK_AUTHORITY.decision_review.promotionGate).toBe(
      'decision_review_hash_bound_eval',
    );
    expect(RUNTIME_AI_TASK_AUTHORITY.suggest_options).toMatchObject({
      promptAuthority: 'provider_specific_pms_or_inline_constant',
      checkedInModel: 'gpt-5.2',
    });
    expect(RUNTIME_AI_TASK_AUTHORITY.clarify_brief.promptAuthority).toBe(
      'provider_specific_pms_or_inline_constant',
    );
    expect(RUNTIME_AI_TASK_AUTHORITY.explain_diff.modelAuthority).toBe(
      'router_global_fallback',
    );
    expect(
      Object.entries(RUNTIME_AI_TASK_AUTHORITY)
        .filter(([, authority]) => authority.promotionGate !== 'none_no_real_pack')
        .map(([task]) => task),
    ).toEqual(['decision_review']);
  });
});
