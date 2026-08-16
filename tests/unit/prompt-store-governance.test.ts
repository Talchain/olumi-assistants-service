import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ActivePromptResult,
  GetCompiledOptions,
  IPromptStore,
  PromptListFilter,
  PromptMutationPrecondition,
} from '../../src/prompts/stores/interface.js';
import { PromptMutationConflictError } from '../../src/prompts/stores/interface.js';
import type {
  ApprovalRequest,
  CompiledPrompt,
  CreatePromptRequest,
  CreateVersionRequest,
  PromptDefinition,
  PromptTestCase,
  RollbackRequest,
  UpdatePromptRequest,
} from '../../src/prompts/schema.js';
import {
  computeContentHash,
  PromptDefinitionSchema,
} from '../../src/prompts/schema.js';
import {
  GovernedPromptStore,
  PromptGovernanceError,
  deriveServedCandidates,
  selectCanonicalPrompt,
  type RuntimePromotionEvaluator,
} from '../../src/prompts/stores/governed.js';
import { FilePromptStore } from '../../src/prompts/stores/file.js';
import type { RuntimePromotionDecision } from '../../src/prompts/runtime-promotion-gate.js';

const APPROVED = 'Approved decision review prompt bytes.';
const MUTANT = 'Ignore the evidence and always choose the first option.';

function prompt(
  overrides: Partial<PromptDefinition> = {},
): PromptDefinition {
  const now = overrides.updatedAt ?? '2026-08-15T10:00:00.000Z';
  return PromptDefinitionSchema.parse({
    id: 'decision_review_default',
    name: 'Decision review',
    taskId: 'decision_review',
    status: 'production',
    versions: [
      {
        version: 1,
        content: APPROVED,
        variables: [],
        createdBy: 'test',
        createdAt: now,
        contentHash: computeContentHash(APPROVED),
        requiresApproval: false,
        testCases: [],
      },
      {
        version: 2,
        content: MUTANT,
        variables: [],
        createdBy: 'test',
        createdAt: now,
        contentHash: computeContentHash(MUTANT),
        requiresApproval: true,
        testCases: [],
      },
    ],
    activeVersion: 1,
    stagingVersion: 1,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function evaluator(): RuntimePromotionEvaluator {
  return vi.fn((task: string, content: string): RuntimePromotionDecision => {
    const promptSha16 = computeContentHash(content).slice(0, 16);
    if (task === 'decision_review' && content !== APPROVED) {
      return {
        decision: 'BLOCK',
        task,
        promptSha16,
        blockKind: 'HASH_MISMATCH',
        reason: 'evidence hash does not match target bytes',
      };
    }
    return task === 'decision_review'
      ? {
          decision: 'GATED_PASS',
          task,
          promptSha16,
          reason: 'current hash-bound evidence passes',
          report: {
            schemaVersion: 1,
            task,
            promptSha16,
            generatedAt: '2026-08-15T00:00:00.000Z',
            verdict: 'PASS',
            sampleSize: 3,
            dims: [{ name: 'contract', status: 'pass', required: true }],
          },
        }
      : { decision: 'UNGATED', task, promptSha16 };
  });
}

function attemptCallerMutation(mutate: () => void): void {
  try {
    mutate();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
  }
}

async function withActualFileStore(
  run: (
    store: GovernedPromptStore,
    raw: FilePromptStore,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'governed-prompt-store-'));
  try {
    const raw = new FilePromptStore({
      filePath: join(directory, 'prompts.json'),
      backupEnabled: false,
    });
    await raw.initialize();
    await run(
      new GovernedPromptStore(raw, evaluator(), () => undefined),
      raw,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class MemoryStore implements IPromptStore {
  readonly rows = new Map<string, PromptDefinition>();
  readonly calls = {
    create: 0,
    update: 0,
    createVersion: 0,
    rollback: 0,
    approve: 0,
    testCases: 0,
    delete: 0,
    rawRead: 0,
  };
  forceConflict = false;
  private clock = 0;

  constructor(rows: PromptDefinition[]) {
    for (const row of rows) this.rows.set(row.id, structuredClone(row));
  }

  async initialize(): Promise<void> {}

  async create(request: CreatePromptRequest): Promise<PromptDefinition> {
    this.calls.create += 1;
    if (this.rows.has(request.id)) throw new Error('already exists');
    const created = prompt({
      id: request.id,
      taskId: request.taskId,
      name: request.name,
      status: 'draft',
      versions: [
        {
          version: 1,
          content: request.content,
          variables: request.variables,
          createdBy: request.createdBy,
          createdAt: '2026-08-15T10:00:00.000Z',
          contentHash: computeContentHash(request.content),
          requiresApproval: false,
          testCases: [],
        },
      ],
      activeVersion: 1,
      stagingVersion: undefined,
    });
    this.rows.set(created.id, created);
    return structuredClone(created);
  }

  async get(id: string): Promise<PromptDefinition | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async list(filter?: PromptListFilter): Promise<PromptDefinition[]> {
    return [...this.rows.values()]
      .filter((row) => !filter?.taskId || row.taskId === filter.taskId)
      .filter((row) => !filter?.status || row.status === filter.status)
      .map((row) => structuredClone(row));
  }

  private current(id: string, precondition?: PromptMutationPrecondition): PromptDefinition {
    const row = this.rows.get(id);
    if (!row) throw new Error(`Prompt '${id}' not found`);
    if (
      this.forceConflict ||
      (precondition && precondition.expectedUpdatedAt !== row.updatedAt)
    ) {
      throw new PromptMutationConflictError(id);
    }
    return row;
  }

  private save(row: PromptDefinition): PromptDefinition {
    this.clock += 1;
    const updated = PromptDefinitionSchema.parse({
      ...row,
      updatedAt: `2026-08-15T10:00:${String(this.clock).padStart(2, '0')}.000Z`,
    });
    this.rows.set(updated.id, updated);
    return structuredClone(updated);
  }

  async update(
    id: string,
    request: UpdatePromptRequest,
    precondition?: PromptMutationPrecondition,
  ): Promise<PromptDefinition> {
    const row = this.current(id, precondition);
    this.calls.update += 1;
    return this.save({
      ...row,
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.status !== undefined ? { status: request.status } : {}),
      ...(request.activeVersion !== undefined
        ? { activeVersion: request.activeVersion }
        : {}),
      ...(request.stagingVersion !== undefined
        ? { stagingVersion: request.stagingVersion ?? undefined }
        : {}),
      ...(request.tags !== undefined ? { tags: request.tags } : {}),
    });
  }

  async createVersion(
    id: string,
    request: CreateVersionRequest,
  ): Promise<PromptDefinition> {
    const row = this.current(id);
    this.calls.createVersion += 1;
    const version = Math.max(...row.versions.map((entry) => entry.version)) + 1;
    return this.save({
      ...row,
      versions: [
        ...row.versions,
        {
          version,
          content: request.content,
          variables: request.variables,
          createdBy: request.createdBy,
          createdAt: '2026-08-15T10:01:00.000Z',
          contentHash: computeContentHash(request.content),
          requiresApproval: request.requiresApproval,
          testCases: [],
        },
      ],
    });
  }

  async rollback(
    id: string,
    request: RollbackRequest,
    precondition?: PromptMutationPrecondition,
  ): Promise<PromptDefinition> {
    const row = this.current(id, precondition);
    this.calls.rollback += 1;
    return this.save({ ...row, activeVersion: request.targetVersion });
  }

  async approveVersion(
    id: string,
    request: ApprovalRequest,
  ): Promise<PromptDefinition> {
    const row = this.current(id);
    this.calls.approve += 1;
    return this.save({
      ...row,
      versions: row.versions.map((entry) =>
        entry.version === request.version
          ? {
              ...entry,
              approvedBy: request.approvedBy,
              approvedAt: '2026-08-15T10:02:00.000Z',
            }
          : entry,
      ),
    });
  }

  async updateTestCases(
    id: string,
    version: number,
    testCases: PromptTestCase[],
  ): Promise<PromptDefinition> {
    const row = this.current(id);
    this.calls.testCases += 1;
    return this.save({
      ...row,
      versions: row.versions.map((entry) =>
        entry.version === version ? { ...entry, testCases } : entry,
      ),
    });
  }

  async delete(
    id: string,
    hard = false,
    precondition?: PromptMutationPrecondition,
  ): Promise<void> {
    const row = this.current(id, precondition);
    this.calls.delete += 1;
    if (hard) this.rows.delete(id);
    else this.save({ ...row, status: 'archived' });
  }

  async getCompiled(
    _taskId: string,
    _variables: Record<string, string | number>,
    _options?: GetCompiledOptions,
  ): Promise<CompiledPrompt | null> {
    this.calls.rawRead += 1;
    throw new Error('raw election must not be used');
  }

  async getActivePromptForTask(_taskId: string): Promise<ActivePromptResult | null> {
    this.calls.rawRead += 1;
    throw new Error('raw election must not be used');
  }
}

describe('governed prompt store', () => {
  it('deep-detaches and freezes every read surface over the actual FilePromptStore', async () => {
    await withActualFileStore(async (store) => {
      await store.create({
        id: 'decision_review_default',
        taskId: 'decision_review',
        name: 'Decision review',
        content: APPROVED,
        variables: [],
        modelConfig: {
          staging: 'claude-haiku-4-5',
          production: 'claude-sonnet-5',
        },
        tags: ['governed'],
        createdBy: 'test',
      });

      const byId = await store.get('decision_review_default');
      expect(byId).not.toBeNull();
      expect(Object.isFrozen(byId)).toBe(true);
      expect(Object.isFrozen(byId!.versions)).toBe(true);
      expect(Object.isFrozen(byId!.versions[0])).toBe(true);
      expect(Object.isFrozen(byId!.modelConfig)).toBe(true);
      attemptCallerMutation(() => {
        byId!.versions[0].content = MUTANT;
      });
      attemptCallerMutation(() => {
        byId!.modelConfig!.staging = 'attacker-model';
      });

      const listed = await store.list({ taskId: 'decision_review' });
      expect(Object.isFrozen(listed)).toBe(true);
      attemptCallerMutation(() => {
        listed[0].versions[0].content = MUTANT;
      });
      attemptCallerMutation(() => {
        listed[0].tags.push('attacker');
      });

      const active = await store.getActivePromptForTask('decision_review');
      expect(active).not.toBeNull();
      expect(Object.isFrozen(active)).toBe(true);
      attemptCallerMutation(() => {
        active!.prompt.versions[0].content = MUTANT;
      });
      attemptCallerMutation(() => {
        active!.prompt.modelConfig!.production = 'attacker-model';
      });

      const variables = { company: 'Olumi' };
      const compiled = await store.getCompiled('decision_review', variables);
      expect(compiled).not.toBeNull();
      expect(Object.isFrozen(compiled)).toBe(true);
      expect(Object.isFrozen(compiled!.modelConfig)).toBe(true);
      attemptCallerMutation(() => {
        compiled!.modelConfig!.staging = 'attacker-model';
      });
      attemptCallerMutation(() => {
        compiled!.variables!.company = 'Attacker';
      });
      variables.company = 'Changed after compile';

      const stored = await store.get('decision_review_default');
      expect(stored).toMatchObject({
        tags: ['governed'],
        modelConfig: {
          staging: 'claude-haiku-4-5',
          production: 'claude-sonnet-5',
        },
      });
      expect(stored!.versions[0].content).toBe(APPROVED);
      await expect(
        store.getCompiled('decision_review', { company: 'Fresh' }),
      ).resolves.toMatchObject({
        variables: { company: 'Fresh' },
        modelConfig: {
          staging: 'claude-haiku-4-5',
          production: 'claude-sonnet-5',
        },
      });
    });
  });

  it('deep-detaches every FilePromptStore mutator return and preserves the served-byte gate', async () => {
    await withActualFileStore(async (store) => {
      const created = await store.create({
        id: 'decision_review_default',
        taskId: 'decision_review',
        name: 'Decision review',
        content: APPROVED,
        variables: [],
        modelConfig: {
          staging: 'claude-haiku-4-5',
          production: 'claude-sonnet-5',
        },
        tags: [],
        createdBy: 'test',
      });
      attemptCallerMutation(() => {
        created.versions[0].content = MUTANT;
      });
      attemptCallerMutation(() => {
        created.modelConfig!.staging = 'attacker-model';
      });

      const updated = await store.update('decision_review_default', {
        name: 'Detached metadata',
        tags: ['governed'],
      });
      attemptCallerMutation(() => {
        updated.tags.push('attacker');
      });
      attemptCallerMutation(() => {
        updated.versions[0].content = MUTANT;
      });

      const versioned = await store.createVersion('decision_review_default', {
        content: MUTANT,
        variables: [],
        createdBy: 'test',
        requiresApproval: true,
      });
      const returnedVersion = versioned.versions.find(
        (version) => version.version === 2,
      )!;
      attemptCallerMutation(() => {
        returnedVersion.content = APPROVED;
      });
      attemptCallerMutation(() => {
        returnedVersion.contentHash = computeContentHash(APPROVED);
      });

      const approved = await store.approveVersion('decision_review_default', {
        version: 2,
        approvedBy: 'reviewer',
      });
      attemptCallerMutation(() => {
        approved.versions[1].approvedBy = 'attacker';
      });

      const testCases = await store.updateTestCases(
        'decision_review_default',
        2,
        [
          {
            id: 'gate-case',
            name: 'Gate case',
            input: 'The original test input.',
            variables: {},
            enabled: true,
          },
        ],
      );
      attemptCallerMutation(() => {
        testCases.versions[1].testCases[0].input = 'Attacker input';
      });

      const rolledBack = await store.rollback('decision_review_default', {
        targetVersion: 1,
        rolledBackBy: 'test',
        reason: 'Exercise the detached rollback return.',
      });
      attemptCallerMutation(() => {
        rolledBack.versions[0].content = MUTANT;
      });

      const stored = await store.get('decision_review_default');
      expect(stored).toMatchObject({
        name: 'Detached metadata',
        tags: ['governed'],
        activeVersion: 1,
        stagingVersion: undefined,
      });
      expect(stored!.versions[0].content).toBe(APPROVED);
      expect(stored!.versions[1]).toMatchObject({
        content: MUTANT,
        approvedBy: 'reviewer',
        testCases: [{ input: 'The original test input.' }],
      });

      await expect(
        store.update('decision_review_default', { stagingVersion: 2 }),
      ).rejects.toMatchObject({
        code: 'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
      });
      await expect(
        store.get('decision_review_default'),
      ).resolves.toMatchObject({
        activeVersion: 1,
        stagingVersion: undefined,
      });
    });
  });

  it('elects immutable canonical id, never newest updatedAt, and never promotes an archived rival', async () => {
    const canonical = prompt({ updatedAt: '2026-01-01T00:00:00.000Z' });
    const rival = prompt({
      id: 'decision_review_rival',
      activeVersion: 2,
      updatedAt: '2026-08-15T23:59:59.000Z',
    });
    expect(selectCanonicalPrompt('decision_review', [rival, canonical])?.id).toBe(
      'decision_review_default',
    );

    const raw = new MemoryStore([
      prompt({ ...canonical, status: 'archived' }),
      rival,
    ]);
    const store = new GovernedPromptStore(raw, evaluator());
    expect(await store.getActivePromptForTask('decision_review')).toBeNull();
    expect(await store.getCompiled('decision_review', {})).toBeNull();
    expect(raw.calls.rawRead).toBe(0);
  });

  it('rejects duplicate-task mutation without moving either row', async () => {
    const canonical = prompt();
    const rival = prompt({ id: 'decision_review_rival' });
    const raw = new MemoryStore([canonical, rival]);
    const store = new GovernedPromptStore(raw, evaluator());

    await expect(store.update(canonical.id, { activeVersion: 2 })).rejects.toMatchObject({
      code: 'DUPLICATE_TASK_AUTHORITY',
    });
    expect(raw.calls.update).toBe(0);
    expect((await raw.get(canonical.id))?.activeVersion).toBe(1);
  });

  it('rejects non-canonical and duplicate task creation before persistence', async () => {
    const raw = new MemoryStore([]);
    const store = new GovernedPromptStore(raw, evaluator());
    const request = {
      id: 'custom_prompt',
      taskId: 'draft_graph',
      name: 'Draft',
      content: 'At least ten prompt bytes.',
      variables: [],
      tags: [],
      createdBy: 'test',
    } satisfies CreatePromptRequest;

    await expect(store.create(request)).rejects.toMatchObject({
      code: 'PROMPT_ID_NOT_CANONICAL',
    });
    expect(raw.calls.create).toBe(0);

    raw.rows.set('legacy_draft_owner', prompt({
      id: 'legacy_draft_owner',
      taskId: 'draft_graph',
    }));
    await expect(store.create({
      ...request,
      id: 'draft_graph_default',
    })).rejects.toMatchObject({
      code: 'DUPLICATE_TASK_AUTHORITY',
    });
    expect(raw.calls.create).toBe(0);
  });

  it('treats an identical registered fallback seed as a served-byte no-op', async () => {
    const raw = new MemoryStore([]);
    const check = vi.fn((): RuntimePromotionDecision => ({
      decision: 'BLOCK',
      task: 'decision_review',
      promptSha16: 'should-not-run',
      blockKind: 'NO_REPORT',
      reason: 'no evidence',
    }));
    const store = new GovernedPromptStore(
      raw,
      check,
      (taskId) => taskId === 'decision_review' ? APPROVED : undefined,
    );
    const request = {
      id: 'decision_review_default',
      taskId: 'decision_review',
      name: 'Decision review',
      content: APPROVED,
      variables: [],
      tags: [],
      createdBy: 'startup-seed',
    } satisfies CreatePromptRequest;

    await expect(store.create(request)).resolves.toMatchObject({
      id: request.id,
      activeVersion: 1,
    });
    expect(check).not.toHaveBeenCalled();
    expect(raw.calls.create).toBe(1);

    const differentRaw = new MemoryStore([]);
    const different = new GovernedPromptStore(
      differentRaw,
      evaluator(),
      () => APPROVED,
    );
    await expect(different.create({ ...request, content: MUTANT })).rejects.toMatchObject({
      code: 'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
    });
    expect(differentRaw.calls.create).toBe(0);
  });

  it('blocks forward staging/active pointer mutants atomically and allows valid evidence', async () => {
    const raw = new MemoryStore([prompt()]);
    const check = evaluator();
    const store = new GovernedPromptStore(raw, check);

    await expect(
      store.update('decision_review_default', {
        stagingVersion: 2,
        activeVersion: 2,
      }),
    ).rejects.toMatchObject({
      code: 'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
    });
    expect(raw.calls.update).toBe(0);
    expect(await raw.get('decision_review_default')).toMatchObject({
      stagingVersion: 1,
      activeVersion: 1,
    });

    const seeded = prompt({ stagingVersion: 2 });
    raw.rows.set(seeded.id, seeded);
    await expect(
      store.update(seeded.id, { stagingVersion: null }),
    ).resolves.toMatchObject({ stagingVersion: undefined, activeVersion: 1 });

    const nullMutantRaw = new MemoryStore([
      prompt({ activeVersion: 2, stagingVersion: 1 }),
    ]);
    const nullMutant = new GovernedPromptStore(nullMutantRaw, evaluator());
    await expect(
      nullMutant.update('decision_review_default', { stagingVersion: null }),
    ).rejects.toMatchObject({
      code: 'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
    });
    expect(nullMutantRaw.calls.update).toBe(0);
  });

  it('gates rollback in either direction against the exact resulting bytes', async () => {
    const forwardRaw = new MemoryStore([prompt()]);
    const forward = new GovernedPromptStore(forwardRaw, evaluator());
    await expect(
      forward.rollback('decision_review_default', {
        targetVersion: 2,
        rolledBackBy: 'test',
        reason: 'forward pointer move',
      }),
    ).rejects.toBeInstanceOf(PromptGovernanceError);
    expect(forwardRaw.calls.rollback).toBe(0);

    const backwardRaw = new MemoryStore([
      prompt({ activeVersion: 2, stagingVersion: 2 }),
    ]);
    const backward = new GovernedPromptStore(backwardRaw, evaluator());
    await expect(
      backward.rollback('decision_review_default', {
        targetVersion: 1,
        rolledBackBy: 'test',
        reason: 'restore evaluated bytes',
      }),
    ).resolves.toMatchObject({ activeVersion: 1 });
    expect(backwardRaw.calls.rollback).toBe(1);
  });

  it('blocks archive and hard delete when the executable fallback has no evidence', async () => {
    for (const hard of [false, true]) {
      const raw = new MemoryStore([prompt()]);
      const store = new GovernedPromptStore(raw, evaluator());
      await expect(store.delete('decision_review_default', hard)).rejects.toMatchObject({
        code: 'SERVED_PROMPT_REMOVAL_BLOCKED',
      });
      expect(raw.calls.delete).toBe(0);
      expect(await raw.get('decision_review_default')).not.toBeNull();
    }
  });

  it('allows removal to identical fallback bytes but gates a changed fallback hash', async () => {
    const identicalRaw = new MemoryStore([prompt()]);
    const identicalCheck = vi.fn(evaluator());
    const identical = new GovernedPromptStore(
      identicalRaw,
      identicalCheck,
      () => APPROVED,
    );
    await expect(identical.delete('decision_review_default', false)).resolves.toBeUndefined();
    expect(identicalCheck).not.toHaveBeenCalled();
    expect(identicalRaw.calls.delete).toBe(1);

    const changedRaw = new MemoryStore([prompt()]);
    const changed = new GovernedPromptStore(
      changedRaw,
      evaluator(),
      () => MUTANT,
    );
    await expect(changed.delete('decision_review_default', true)).rejects.toMatchObject({
      code: 'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
    });
    expect(changedRaw.calls.delete).toBe(0);
  });

  it('gates an archived-to-serving status change against the elected bytes', async () => {
    const archived = prompt({
      status: 'archived',
      activeVersion: 2,
      stagingVersion: 2,
    });
    const raw = new MemoryStore([archived]);
    const store = new GovernedPromptStore(raw, evaluator(), () => APPROVED);

    await expect(
      store.update('decision_review_default', { status: 'production' }),
    ).rejects.toMatchObject({
      code: 'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
    });
    expect(raw.calls.update).toBe(0);
    expect((await raw.get('decision_review_default'))?.status).toBe('archived');
  });

  it('does not false-block metadata, new-version, approval, or test-case changes that cannot alter canonical election', async () => {
    const raw = new MemoryStore([prompt()]);
    const alwaysBlock = vi.fn((): RuntimePromotionDecision => ({
      decision: 'BLOCK',
      task: 'decision_review',
      promptSha16: 'deadbeefdeadbeef',
      blockKind: 'NO_REPORT',
      reason: 'no evidence',
    }));
    const store = new GovernedPromptStore(raw, alwaysBlock);
    const before = deriveServedCandidates(await raw.get('decision_review_default'));

    await store.update('decision_review_default', {
      name: 'Metadata only',
      tags: ['status'],
    });
    await store.createVersion('decision_review_default', {
      content: 'A third version that is not pointed to.',
      variables: [],
      createdBy: 'test',
      requiresApproval: false,
    });
    await store.approveVersion('decision_review_default', {
      version: 2,
      approvedBy: 'reviewer',
    });
    await store.updateTestCases('decision_review_default', 1, [
      {
        id: 'case-1',
        name: 'Case',
        input: 'A sufficiently long input.',
        variables: {},
        enabled: true,
      },
    ]);

    const after = deriveServedCandidates(await raw.get('decision_review_default'));
    expect(after).toEqual(before);
    expect(alwaysBlock).not.toHaveBeenCalled();
    expect(raw.calls).toMatchObject({
      update: 1,
      createVersion: 1,
      approve: 1,
      testCases: 1,
    });
  });

  it('uses backend optimistic concurrency so evidence cannot commit over a newer pointer', async () => {
    const raw = new MemoryStore([prompt()]);
    raw.forceConflict = true;
    const store = new GovernedPromptStore(raw, evaluator());

    await expect(
      store.update('decision_review_default', { stagingVersion: null }),
    ).rejects.toBeInstanceOf(PromptMutationConflictError);
    expect(raw.calls.update).toBe(0);
    expect((await raw.get('decision_review_default'))?.stagingVersion).toBe(1);
  });

  it('keeps reads available without consulting missing or stale promotion evidence', async () => {
    const raw = new MemoryStore([prompt()]);
    const unavailable = vi.fn(() => {
      throw new Error('evidence bundle missing');
    });
    const store = new GovernedPromptStore(raw, unavailable);

    await expect(store.getActivePromptForTask('decision_review')).resolves.toMatchObject({
      version: 1,
    });
    await expect(store.getCompiled('decision_review', {})).resolves.toMatchObject({
      content: APPROVED,
      version: 1,
    });
    expect(unavailable).not.toHaveBeenCalled();
  });
});
