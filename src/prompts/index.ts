/**
 * Prompt Management Module
 *
 * Provides versioned, manageable prompts with A/B testing support,
 * status lifecycle, and variable interpolation.
 *
 * @example
 * ```typescript
 * import { loadPrompt, registerDefaultPrompt } from './prompts/index.js';
 *
 * // Register a default prompt (during initialization)
 * registerDefaultPrompt('draft_graph', 'You are an expert...');
 *
 * // Load a prompt (checks store first, falls back to default)
 * const { content, source } = await loadPrompt('draft_graph', {
 *   variables: { maxNodes: 20, maxEdges: 50 },
 * });
 * ```
 */

// Schema exports
export {
  // Schemas
  PromptStatusSchema,
  CeeTaskIdSchema,
  PromptVariableSchema,
  PromptTestCaseSchema,
  PromptVersionSchema,
  PromptDefinitionSchema,
  CreatePromptRequestSchema,
  CreateVersionRequestSchema,
  UpdatePromptRequestSchema,
  RollbackRequestSchema,
  ApprovalRequestSchema,
  CompiledPromptSchema,
  // Types
  type PromptStatus,
  type CeeTaskId,
  type PromptVariable,
  type PromptTestCase,
  type PromptVersion,
  type PromptDefinition,
  type CreatePromptRequest,
  type CreateVersionRequest,
  type UpdatePromptRequest,
  type RollbackRequest,
  type ApprovalRequest,
  type CompiledPrompt,
  // Utilities
  computeContentHash,
  extractVariables,
  interpolatePrompt,
} from './schema.js';

// Store exports
export {
  PromptStore,
  getPromptStore,
  resetPromptStore,
  initializePromptStore,
  isPromptStoreInitialized,
  isPromptStoreHealthy,
  getPromptStoreStatus,
  type PromptStoreConfig,
} from './store.js';

// Loader exports
export {
  loadPrompt,
  loadPromptSync,
  registerDefaultPrompt,
  hasManagedPrompt,
  getDefaultPrompts,
  type LoadPromptOptions,
  type LoadedPrompt,
} from './loader.js';

// Braintrust exports
export {
  BraintrustManager,
  getBraintrustManager,
  resetBraintrustManager,
  Scorers,
  runScorers,
  type ExperimentConfig,
  type ExperimentResult,
  type Scorer,
} from './braintrust.js';

// Audit exports
export {
  AuditLogger,
  getAuditLogger,
  resetAuditLogger,
  logPromptCreated,
  logPromptUpdated,
  logVersionCreated,
  logVersionRollback,
  logVersionApproved,
  logStatusChanged,
  logExperimentStarted,
  logExperimentEnded,
  type AuditAction,
  type AuditEntry,
  type AuditConfig,
} from './audit.js';

// Default prompts exports
export {
  registerAllDefaultPrompts,
  PROMPT_TEMPLATES,
} from './defaults.js';
