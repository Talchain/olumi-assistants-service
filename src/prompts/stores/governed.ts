/**
 * Canonical prompt authority and served-byte mutation gate.
 *
 * Storage backends deliberately remain persistence adapters. This boundary is
 * the only production-facing IPromptStore: it elects one immutable authority
 * per task, derives the exact bytes served in staging and production, and
 * checks evaluation evidence before any mutation can change those bytes.
 */

import type {
  ActivePromptResult,
  GetCompiledOptions,
  IPromptStore,
  PromptListFilter,
} from './interface.js';
import type {
  ApprovalRequest,
  CompiledPrompt,
  CreatePromptRequest,
  CreateVersionRequest,
  PromptDefinition,
  PromptTestCase,
  RollbackRequest,
  UpdatePromptRequest,
} from '../schema.js';
import {
  computeContentHash,
  interpolatePrompt,
  PromptDefinitionSchema,
} from '../schema.js';
import {
  evaluateRuntimePromptPromotion,
  type RuntimePromotionDecision,
} from '../runtime-promotion-gate.js';
import { getRegisteredDefaultPrompt } from '../default-registry.js';
import {
  providesPromptObservationCapability,
  PROMPT_OBSERVATION_CAPABILITY,
  type PromptObservation,
  type PromptObservationCapability,
} from './observations.js';

export type PromptGovernanceErrorCode =
  | 'PROMPT_ID_NOT_CANONICAL'
  | 'DUPLICATE_TASK_AUTHORITY'
  | 'PROMPT_PROMOTION_EVIDENCE_REQUIRED'
  | 'SERVED_PROMPT_REMOVAL_BLOCKED';

export interface PromptGovernanceErrorDetails {
  readonly taskId: string;
  readonly promptId?: string;
  readonly canonicalPromptId?: string;
  readonly rivalPromptIds?: readonly string[];
  readonly environments?: readonly ServedEnvironment[];
  readonly promptHash?: string;
  readonly blockKind?: string;
  readonly action: string;
}

export class PromptGovernanceError extends Error {
  readonly name = 'PromptGovernanceError';
  readonly statusCode = 409;

  constructor(
    readonly code: PromptGovernanceErrorCode,
    message: string,
    readonly details: PromptGovernanceErrorDetails,
  ) {
    super(message);
  }
}

export type ServedEnvironment = 'staging' | 'production';

export interface ServedPromptCandidate {
  readonly environment: ServedEnvironment;
  readonly promptId: string;
  readonly version: number;
  readonly content: string;
  readonly contentHash: string;
}

type ServedCandidates = Readonly<
  Record<ServedEnvironment, ServedPromptCandidate | null>
>;

export type RuntimePromotionEvaluator = (
  task: string,
  content: string,
) => RuntimePromotionDecision;

export type PromptFallbackResolver = (taskId: string) => string | undefined;

export function canonicalPromptId(taskId: string): string {
  return `${taskId}_default`;
}

/**
 * Deterministic read election. The canonical id always wins, including when
 * archived (an archived authority means fallback, never "elect a rival"). A
 * single legacy row remains readable for compatibility. Multiple legacy rows
 * are ordered by immutable id so reads/status stay available, while every
 * mutation is rejected until the duplicate authority is reconciled.
 */
export function selectCanonicalPrompt(
  taskId: string,
  prompts: readonly PromptDefinition[],
): PromptDefinition | null {
  const candidates = prompts
    .filter((prompt) => prompt.taskId === taskId)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  return (
    candidates.find((prompt) => prompt.id === canonicalPromptId(taskId)) ??
    candidates[0] ??
    null
  );
}

export function deriveServedCandidates(
  prompt: PromptDefinition | null,
): ServedCandidates {
  if (!prompt || prompt.status === 'archived') {
    return { staging: null, production: null };
  }

  const candidate = (
    environment: ServedEnvironment,
    versionNumber: number,
  ): ServedPromptCandidate => {
    const version = prompt.versions.find(
      (entry) => entry.version === versionNumber,
    );
    if (!version) {
      throw new Error(
        `Version ${versionNumber} not found for prompt '${prompt.id}'`,
      );
    }
    return {
      environment,
      promptId: prompt.id,
      version: versionNumber,
      content: version.content,
      // Recompute from bytes; a stale stored hash is not authority.
      contentHash: computeContentHash(version.content),
    };
  };

  return {
    staging: candidate(
      'staging',
      prompt.stagingVersion ?? prompt.activeVersion,
    ),
    production: candidate('production', prompt.activeVersion),
  };
}

function changedEnvironments(
  before: ServedCandidates,
  after: ServedCandidates,
): ServedEnvironment[] {
  return (['staging', 'production'] as const).filter(
    (environment) =>
      before[environment]?.contentHash !== after[environment]?.contentHash,
  );
}

function cloneUpdatedPrompt(
  prompt: PromptDefinition,
  request: UpdatePromptRequest,
): PromptDefinition {
  return PromptDefinitionSchema.parse({
    ...prompt,
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.description !== undefined
      ? { description: request.description }
      : {}),
    ...(request.status !== undefined ? { status: request.status } : {}),
    ...(request.activeVersion !== undefined
      ? { activeVersion: request.activeVersion }
      : {}),
    ...(request.stagingVersion !== undefined
      ? request.stagingVersion === null
        ? { stagingVersion: undefined }
        : { stagingVersion: request.stagingVersion }
      : {}),
    ...(request.designVersion !== undefined
      ? { designVersion: request.designVersion }
      : {}),
    ...(request.modelConfig !== undefined
      ? { modelConfig: request.modelConfig }
      : {}),
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
  });
}

/** Minimal keyed mutex: serialises evidence+CAS decisions inside one process. */
class TaskMutationLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(taskId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(taskId) === tail) this.tails.delete(taskId);
    }
  }
}

export class GovernedPromptStore implements IPromptStore {
  private readonly locks = new TaskMutationLock();
  private readonly observations: PromptObservationCapability | null;

  constructor(
    private readonly store: IPromptStore,
    private readonly evaluatePromotion: RuntimePromotionEvaluator =
      evaluateRuntimePromptPromotion,
    private readonly resolveFallback: PromptFallbackResolver =
      getRegisteredDefaultPrompt,
  ) {
    const backendObservations = providesPromptObservationCapability(store)
      ? store[PROMPT_OBSERVATION_CAPABILITY]
      : null;
    this.observations = backendObservations
      ? Object.freeze({
          listObservations: (promptId: string) =>
            backendObservations.listObservations(promptId),
          getObservationVersion: (promptId: string, version: number) =>
            backendObservations.getObservationVersion(promptId, version),
          addObservation: (
            observation: Omit<PromptObservation, 'id' | 'createdAt'>,
          ) =>
            backendObservations.addObservation(observation),
          deleteObservation: (id: string) =>
            backendObservations.deleteObservation(id),
        })
      : null;
  }

  /** Narrow side-channel only; the underlying IPromptStore is never exposed. */
  getObservationCapability(): PromptObservationCapability | null {
    return this.observations;
  }

  initialize(): Promise<void> {
    return this.store.initialize();
  }

  get(id: string): Promise<PromptDefinition | null> {
    return this.store.get(id);
  }

  list(filter?: PromptListFilter): Promise<PromptDefinition[]> {
    return this.store.list(filter);
  }

  private async rowsForTask(taskId: string): Promise<PromptDefinition[]> {
    return this.store.list({ taskId });
  }

  private assertSingleMutableAuthority(
    taskId: string,
    rows: readonly PromptDefinition[],
    promptId: string,
  ): PromptDefinition {
    const authority = selectCanonicalPrompt(taskId, rows);
    if (!authority) {
      throw new Error(`Prompt '${promptId}' not found`);
    }
    if (rows.length !== 1 || authority.id !== promptId) {
      throw new PromptGovernanceError(
        'DUPLICATE_TASK_AUTHORITY',
        `Task '${taskId}' has multiple prompt rows; mutation is blocked because ` +
          'mutable metadata must never elect which row is served.',
        {
          taskId,
          promptId,
          canonicalPromptId: authority.id,
          rivalPromptIds: rows
            .map((row) => row.id)
            .filter((id) => id !== authority.id),
          action:
            'Reconcile the duplicate rows in a controlled migration, then retry.',
        },
      );
    }
    return authority;
  }

  private assertServedChangeAllowed(
    taskId: string,
    promptId: string,
    beforePrompt: PromptDefinition | null,
    afterPrompt: PromptDefinition | null,
  ): void {
    const before = this.deriveEffectiveServedCandidates(taskId, beforePrompt);
    const after = this.deriveEffectiveServedCandidates(taskId, afterPrompt);
    const changed = changedEnvironments(before, after);
    if (changed.length === 0 || taskId !== 'decision_review') return;

    for (const environment of changed) {
      const candidate = after[environment];
      if (!candidate) {
        throw new PromptGovernanceError(
          'SERVED_PROMPT_REMOVAL_BLOCKED',
          `Cannot remove the governed '${taskId}' prompt from ${environment}: ` +
            'the executable fallback bytes have no hash-bound promotion evidence.',
          {
            taskId,
            promptId,
            environments: changed,
            action:
              'Keep the canonical row served, or first add a governed and evaluated fallback authority.',
          },
        );
      }

      const decision = this.evaluatePromotion(taskId, candidate.content);
      if (decision.decision === 'BLOCK') {
        throw new PromptGovernanceError(
          'PROMPT_PROMOTION_EVIDENCE_REQUIRED',
          `Cannot serve '${taskId}' hash ${candidate.contentHash.slice(0, 16)} ` +
            `in ${environment}: ${decision.reason}`,
          {
            taskId,
            promptId,
            environments: changed,
            promptHash: decision.promptSha16,
            blockKind: decision.blockKind,
            action:
              'Run the real task evaluation pack for these exact bytes, commit current passing evidence, and retry.',
          },
        );
      }
    }
  }

  private deriveEffectiveServedCandidates(
    taskId: string,
    prompt: PromptDefinition | null,
  ): ServedCandidates {
    const stored = deriveServedCandidates(prompt);
    if (stored.staging && stored.production) return stored;

    const fallback = this.resolveFallback(taskId);
    if (!fallback) return stored;

    const fallbackCandidate = (
      environment: ServedEnvironment,
    ): ServedPromptCandidate => ({
      environment,
      promptId: `default:${taskId}`,
      version: 0,
      content: fallback,
      contentHash: computeContentHash(fallback),
    });

    return {
      staging: stored.staging ?? fallbackCandidate('staging'),
      production: stored.production ?? fallbackCandidate('production'),
    };
  }

  async create(request: CreatePromptRequest): Promise<PromptDefinition> {
    return this.locks.run(request.taskId, async () => {
      const expectedId = canonicalPromptId(request.taskId);
      if (request.id !== expectedId) {
        throw new PromptGovernanceError(
          'PROMPT_ID_NOT_CANONICAL',
          `Prompt id '${request.id}' cannot own task '${request.taskId}'; ` +
            `the canonical id is '${expectedId}'.`,
          {
            taskId: request.taskId,
            promptId: request.id,
            canonicalPromptId: expectedId,
            action: `Create the task authority with id '${expectedId}'.`,
          },
        );
      }
      const rows = await this.rowsForTask(request.taskId);
      if (rows.length > 0) {
        const authority = selectCanonicalPrompt(request.taskId, rows);
        throw new PromptGovernanceError(
          'DUPLICATE_TASK_AUTHORITY',
          `Task '${request.taskId}' already has prompt authority ` +
            `'${authority?.id ?? rows[0]?.id}'.`,
          {
            taskId: request.taskId,
            promptId: request.id,
            canonicalPromptId: authority?.id,
            rivalPromptIds: rows.map((row) => row.id),
            action:
              'Create a new version on the existing authority instead of another task row.',
          },
        );
      }

      const now = new Date().toISOString();
      const after = PromptDefinitionSchema.parse({
        id: request.id,
        name: request.name,
        description: request.description,
        taskId: request.taskId,
        status: 'draft',
        versions: [
          {
            version: 1,
            content: request.content,
            variables: request.variables,
            createdBy: request.createdBy,
            createdAt: now,
            changeNote: request.changeNote,
            contentHash: computeContentHash(request.content),
            requiresApproval: false,
            testCases: [],
          },
        ],
        activeVersion: 1,
        designVersion: request.designVersion,
        modelConfig: request.modelConfig,
        tags: request.tags,
        createdAt: now,
        updatedAt: now,
      });
      this.assertServedChangeAllowed(request.taskId, request.id, null, after);
      // The canonical id is also the primary key, so cross-process races fail
      // atomically at the backend even without a task-id uniqueness migration.
      return this.store.create(request);
    });
  }

  private async mutateExisting<T>(
    id: string,
    simulate: (before: PromptDefinition) => PromptDefinition | null,
    mutate: (before: PromptDefinition) => Promise<T>,
  ): Promise<T> {
    const initial = await this.store.get(id);
    if (!initial) throw new Error(`Prompt '${id}' not found`);
    return this.locks.run(initial.taskId, async () => {
      const rows = await this.rowsForTask(initial.taskId);
      const before = this.assertSingleMutableAuthority(
        initial.taskId,
        rows,
        id,
      );
      const after = simulate(before);
      this.assertServedChangeAllowed(initial.taskId, id, before, after);
      return mutate(before);
    });
  }

  update(
    id: string,
    request: UpdatePromptRequest,
  ): Promise<PromptDefinition> {
    return this.mutateExisting(
      id,
      (before) => cloneUpdatedPrompt(before, request),
      (before) =>
        this.store.update(id, request, {
          expectedUpdatedAt: before.updatedAt,
        }),
    );
  }

  createVersion(
    id: string,
    request: CreateVersionRequest,
  ): Promise<PromptDefinition> {
    return this.mutateExisting(
      id,
      (before) => {
        const version = Math.max(...before.versions.map((entry) => entry.version)) + 1;
        return PromptDefinitionSchema.parse({
          ...before,
          versions: [
            ...before.versions,
            {
              version,
              content: request.content,
              variables: request.variables,
              createdBy: request.createdBy,
              createdAt: new Date().toISOString(),
              changeNote: request.changeNote,
              contentHash: computeContentHash(request.content),
              requiresApproval: request.requiresApproval,
              testCases: [],
            },
          ],
        });
      },
      () => this.store.createVersion(id, request),
    );
  }

  rollback(id: string, request: RollbackRequest): Promise<PromptDefinition> {
    return this.mutateExisting(
      id,
      (before) =>
        PromptDefinitionSchema.parse({
          ...before,
          activeVersion: request.targetVersion,
        }),
      (before) =>
        this.store.rollback(id, request, {
          expectedUpdatedAt: before.updatedAt,
        }),
    );
  }

  approveVersion(
    id: string,
    request: ApprovalRequest,
  ): Promise<PromptDefinition> {
    return this.mutateExisting(
      id,
      (before) => before,
      () => this.store.approveVersion(id, request),
    );
  }

  updateTestCases(
    id: string,
    version: number,
    testCases: PromptTestCase[],
  ): Promise<PromptDefinition> {
    return this.mutateExisting(
      id,
      (before) => before,
      () => this.store.updateTestCases(id, version, testCases),
    );
  }

  delete(id: string, hard = false): Promise<void> {
    return this.mutateExisting(
      id,
      (before) =>
        hard
          ? null
          : PromptDefinitionSchema.parse({ ...before, status: 'archived' }),
      (before) =>
        this.store.delete(id, hard, {
          expectedUpdatedAt: before.updatedAt,
        }),
    );
  }

  async getCompiled(
    taskId: string,
    variables: Record<string, string | number>,
    options?: GetCompiledOptions,
  ): Promise<CompiledPrompt | null> {
    const prompt = selectCanonicalPrompt(taskId, await this.rowsForTask(taskId));
    if (!prompt || prompt.status === 'archived') return null;
    const versionNumber =
      options?.version ??
      (options?.useStaging ? prompt.stagingVersion : undefined) ??
      prompt.activeVersion;
    const version = prompt.versions.find(
      (entry) => entry.version === versionNumber,
    );
    if (!version) {
      throw new Error(`Version ${versionNumber} not found for prompt '${prompt.id}'`);
    }
    return {
      promptId: prompt.id,
      version: version.version,
      content: interpolatePrompt(version.content, variables, version.variables),
      compiledAt: new Date().toISOString(),
      variables,
      modelConfig: prompt.modelConfig,
    };
  }

  async getActivePromptForTask(
    taskId: string,
  ): Promise<ActivePromptResult | null> {
    const prompt = selectCanonicalPrompt(taskId, await this.rowsForTask(taskId));
    if (!prompt || prompt.status === 'archived') return null;
    return { prompt, version: prompt.activeVersion };
  }
}

export function governPromptStore(store: IPromptStore): IPromptStore {
  return store instanceof GovernedPromptStore
    ? store
    : new GovernedPromptStore(store);
}

/**
 * Route-safe observation lookup. Raw backends are deliberately rejected even
 * if they implement the backend symbol: production access must pass through
 * the governed store boundary.
 */
export function getGovernedPromptObservationCapability(
  store: IPromptStore,
): PromptObservationCapability | null {
  return store instanceof GovernedPromptStore
    ? store.getObservationCapability()
    : null;
}
