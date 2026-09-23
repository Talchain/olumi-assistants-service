/** Strict release-only verification for the existing file prompt store. */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { computeContentHash, PromptDefinitionSchema } from './schema.js';

export const ReleasePromptManifestSchema = z.object({
  format: z.literal(1),
  prompts: z.array(z.object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    modelConfig: z.object({
      staging: z.string().optional(),
      production: z.string().optional(),
    }),
  })).min(1),
});

export type ReleasePromptManifest = z.infer<typeof ReleasePromptManifestSchema>;
let frozenTasks = new Set<string>();

export function isFrozenPromptTask(taskId: string): boolean {
  return frozenTasks.has(taskId);
}

function sameModelConfig(
  actual: { staging?: string; production?: string } | undefined,
  expected: { staging?: string; production?: string },
): boolean {
  return actual?.staging === expected.staging && actual?.production === expected.production;
}

export function validateReleaseSnapshot(manifest: ReleasePromptManifest, raw: unknown): Set<string> {
  const store = z.object({ prompts: z.record(z.unknown()) }).parse(raw);
  const ids = new Set<string>();
  const tasks = new Set<string>();

  for (const pin of manifest.prompts) {
    if (ids.has(pin.id) || tasks.has(pin.taskId)) {
      throw new Error(`Duplicate prompt ID or task in release manifest: ${pin.id}`);
    }
    ids.add(pin.id);
    tasks.add(pin.taskId);
    const prompt = PromptDefinitionSchema.parse(store.prompts[pin.id]);
    const version = prompt.versions[0];
    if (prompt.id !== pin.id || prompt.taskId !== pin.taskId || prompt.status === 'archived' ||
        prompt.versions.length !== 1 || version?.version !== pin.version ||
        prompt.activeVersion !== pin.version || prompt.stagingVersion !== pin.version ||
        version.contentHash !== pin.contentHash ||
        computeContentHash(version.content) !== pin.contentHash ||
        !sameModelConfig(prompt.modelConfig, pin.modelConfig)) {
      throw new Error(`Release prompt snapshot mismatch: ${pin.id}`);
    }
  }

  if (Object.keys(store.prompts).length !== ids.size) {
    throw new Error('Release prompt snapshot contains unpinned prompts');
  }
  return tasks;
}

export async function assertReleaseSnapshot(manifestPath: string, storePath: string): Promise<void> {
  // Missing files and malformed JSON are fatal. The regular file store would
  // otherwise create an empty file or silently skip a corrupt prompt.
  const manifest = ReleasePromptManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const snapshot = JSON.parse(await readFile(storePath, 'utf8')) as unknown;
  frozenTasks = validateReleaseSnapshot(manifest, snapshot);
}
