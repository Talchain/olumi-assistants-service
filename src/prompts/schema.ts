/**
 * Prompt Management Schema
 *
 * Defines the structure for versioned, manageable prompts with
 * support for A/B testing, status lifecycle, and variable interpolation.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

/**
 * Prompt lifecycle status
 * - draft: Initial state, not used in production
 * - staging: Being tested/validated
 * - production: Active in production
 * - archived: No longer used, kept for history
 */
export const PromptStatusSchema = z.enum(['draft', 'staging', 'production', 'archived']);
export type PromptStatus = z.infer<typeof PromptStatusSchema>;

/**
 * CEE task identifiers that prompts are associated with
 */
export const CeeTaskIdSchema = z.enum([
  'draft_graph',
  'suggest_options',
  'repair_graph',
  'clarify_brief',
  'critique_graph',
  'bias_check',
  'evidence_helper',
  'sensitivity_coach',
  'explainer',
  'preflight',
]);
export type CeeTaskId = z.infer<typeof CeeTaskIdSchema>;

/**
 * Variable definition for template interpolation
 * Prompts can contain {{variableName}} placeholders
 */
export const PromptVariableSchema = z.object({
  /** Variable name (used in template as {{name}}) */
  name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/i, 'Variable name must be alphanumeric with underscores'),
  /** Human-readable description */
  description: z.string().max(256),
  /** Whether this variable is required */
  required: z.boolean().default(true),
  /** Default value if not provided */
  defaultValue: z.string().optional(),
  /** Example value for documentation */
  example: z.string().optional(),
});
export type PromptVariable = z.infer<typeof PromptVariableSchema>;

/**
 * Immutable version metadata
 * Each prompt change creates a new version (append-only)
 */
export const PromptVersionSchema = z.object({
  /** Semantic version (1, 2, 3...) */
  version: z.number().int().positive(),
  /** The actual prompt content with {{variable}} placeholders */
  content: z.string().min(10).max(100000),
  /** Variables used in this version */
  variables: z.array(PromptVariableSchema).default([]),
  /** Who created this version */
  createdBy: z.string().min(1).max(128),
  /** When this version was created */
  createdAt: z.string().datetime(),
  /** Optional changelog/reason for this version */
  changeNote: z.string().max(1024).optional(),
  /** Hash of content for integrity verification */
  contentHash: z.string().length(64).optional(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

/**
 * Full prompt definition with all versions
 */
export const PromptDefinitionSchema = z.object({
  /** Unique identifier (e.g., "draft_graph_system_v1") */
  id: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_-]*$/i, 'ID must be alphanumeric with underscores/hyphens'),
  /** Human-readable name */
  name: z.string().min(1).max(256),
  /** Detailed description of what this prompt does */
  description: z.string().max(2048).optional(),
  /** Associated CEE task */
  taskId: CeeTaskIdSchema,
  /** Current lifecycle status */
  status: PromptStatusSchema.default('draft'),
  /** All versions (immutable, append-only) */
  versions: z.array(PromptVersionSchema).min(1),
  /** Currently active version number for production */
  activeVersion: z.number().int().positive(),
  /** Version number for staging/testing (optional) */
  stagingVersion: z.number().int().positive().optional(),
  /** Tags for organization/filtering */
  tags: z.array(z.string().max(64)).max(20).default([]),
  /** When the prompt was first created */
  createdAt: z.string().datetime(),
  /** When the prompt was last modified */
  updatedAt: z.string().datetime(),
});
export type PromptDefinition = z.infer<typeof PromptDefinitionSchema>;

/**
 * Request to create a new prompt
 */
export const CreatePromptRequestSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_-]*$/i),
  name: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  taskId: CeeTaskIdSchema,
  content: z.string().min(10).max(100000),
  variables: z.array(PromptVariableSchema).default([]),
  tags: z.array(z.string().max(64)).max(20).default([]),
  createdBy: z.string().min(1).max(128),
  changeNote: z.string().max(1024).optional(),
});
export type CreatePromptRequest = z.infer<typeof CreatePromptRequestSchema>;

/**
 * Request to create a new version of an existing prompt
 */
export const CreateVersionRequestSchema = z.object({
  content: z.string().min(10).max(100000),
  variables: z.array(PromptVariableSchema).default([]),
  createdBy: z.string().min(1).max(128),
  changeNote: z.string().max(1024).optional(),
});
export type CreateVersionRequest = z.infer<typeof CreateVersionRequestSchema>;

/**
 * Request to update prompt metadata (not content)
 */
export const UpdatePromptRequestSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(2048).optional(),
  status: PromptStatusSchema.optional(),
  activeVersion: z.number().int().positive().optional(),
  stagingVersion: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
});
export type UpdatePromptRequest = z.infer<typeof UpdatePromptRequestSchema>;

/**
 * Rollback request
 */
export const RollbackRequestSchema = z.object({
  /** Version to roll back to */
  targetVersion: z.number().int().positive(),
  /** Who is performing the rollback */
  rolledBackBy: z.string().min(1).max(128),
  /** Reason for rollback */
  reason: z.string().min(1).max(1024),
});
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;

/**
 * Compiled prompt ready for use (with variables interpolated)
 */
export const CompiledPromptSchema = z.object({
  promptId: z.string(),
  version: z.number().int().positive(),
  content: z.string(),
  compiledAt: z.string().datetime(),
  variables: z.record(z.union([z.string(), z.number()])).optional(),
});
export type CompiledPrompt = z.infer<typeof CompiledPromptSchema>;

/**
 * Utility to compute content hash for integrity verification
 * Uses SHA-256 for cryptographic integrity
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Extract variable names from prompt content
 */
export function extractVariables(content: string): string[] {
  const regex = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
  const variables = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables);
}

/**
 * Interpolate variables into prompt content
 */
export function interpolatePrompt(
  content: string,
  variables: Record<string, string | number | undefined>,
  definitions?: PromptVariable[]
): string {
  let result = content;
  const definitionMap = new Map(definitions?.map(d => [d.name, d]) ?? []);

  // Replace all {{variable}} placeholders
  result = result.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, varName) => {
    const value = variables[varName];
    const def = definitionMap.get(varName);

    if (value !== undefined) {
      return String(value);
    }

    if (def?.defaultValue !== undefined) {
      return def.defaultValue;
    }

    if (def?.required !== false) {
      throw new Error(`Missing required variable: ${varName}`);
    }

    // Non-required variable with no default - remove placeholder
    return '';
  });

  return result;
}
