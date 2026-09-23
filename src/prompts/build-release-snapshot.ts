/** Build a private file-store artifact from the exact approved PMS versions. */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { computeContentHash, PromptDefinitionSchema } from './schema.js';
import {
  ReleasePromptManifestSchema,
  validateReleaseSnapshot,
} from './release-snapshot.js';
import { readFile } from 'node:fs/promises';

interface PromptRow {
  name: string;
  description: string | null;
  task_id: string;
  status: string;
  model_config: { staging?: string; production?: string } | null;
  design_version: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  content: string;
  content_hash: string | null;
  variables: unknown;
  created_by: string | null;
  created_at: string;
  change_note: string | null;
  requires_approval: boolean | null;
  approved_by: string | null;
  approved_at: string | null;
  test_cases: unknown;
}

function parseJsonArray(value: unknown): unknown[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value || '[]') : value ?? [];
  if (!Array.isArray(parsed)) throw new Error('Prompt version metadata is not an array');
  return parsed;
}

async function selectOne<T>(url: string, key: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Prompt store query failed (HTTP ${response.status})`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== 'object' || !rows[0]) {
    return null;
  }
  return rows[0] as T;
}

export async function buildReleaseSnapshot(): Promise<void> {
  const manifestPath = process.env.PROMPTS_RELEASE_MANIFEST;
  if (!manifestPath) return;

  const storePath = process.env.PROMPTS_STORE_PATH;
  const privateDir = resolve('.tmp');
  if (process.env.PROMPTS_STORE_TYPE !== 'file' || !storePath ||
      !resolve(storePath).startsWith(`${privateDir}${sep}`)) {
    throw new Error('Release snapshot requires explicit file store and PROMPTS_STORE_PATH under .tmp/');
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Release snapshot build requires Supabase service credentials');

  const manifest = ReleasePromptManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  const prompts: Record<string, unknown> = {};
  const restUrl = `${url.replace(/\/$/, '')}/rest/v1`;

  for (const pin of manifest.prompts) {
    const promptRow = await selectOne<PromptRow>(
      `${restUrl}/cee_prompts?id=eq.${encodeURIComponent(pin.id)}&select=*`, key,
    );
    const versionRow = await selectOne<VersionRow>(
      `${restUrl}/cee_prompt_versions?prompt_id=eq.${encodeURIComponent(pin.id)}&version=eq.${pin.version}&select=*`, key,
    );
    if (!promptRow || !versionRow) {
      throw new Error(`Approved release prompt unavailable: ${pin.id}@${pin.version}`);
    }
    const modelConfig = promptRow.model_config ?? {};
    if (promptRow.task_id !== pin.taskId || promptRow.status === 'archived' ||
        modelConfig.staging !== pin.modelConfig.staging ||
        modelConfig.production !== pin.modelConfig.production ||
        computeContentHash(versionRow.content) !== pin.contentHash ||
        versionRow.content_hash !== pin.contentHash) {
      throw new Error(`Approved release prompt changed: ${pin.id}@${pin.version}`);
    }

    prompts[pin.id] = PromptDefinitionSchema.parse({
      id: pin.id,
      name: promptRow.name,
      description: promptRow.description ?? undefined,
      taskId: pin.taskId,
      status: 'production',
      versions: [{
        version: pin.version,
        content: versionRow.content,
        variables: parseJsonArray(versionRow.variables),
        createdBy: versionRow.created_by ?? 'release-snapshot',
        createdAt: versionRow.created_at,
        changeNote: versionRow.change_note ?? undefined,
        contentHash: pin.contentHash,
        requiresApproval: versionRow.requires_approval ?? false,
        approvedBy: versionRow.approved_by ?? undefined,
        approvedAt: versionRow.approved_at ?? undefined,
        testCases: parseJsonArray(versionRow.test_cases ?? []),
      }],
      activeVersion: pin.version,
      stagingVersion: pin.version,
      designVersion: promptRow.design_version ?? undefined,
      modelConfig: pin.modelConfig,
      tags: promptRow.tags ?? [],
      createdAt: promptRow.created_at,
      updatedAt: promptRow.updated_at,
    });
  }

  const snapshot = { version: 1, prompts, lastModified: new Date().toISOString() };
  validateReleaseSnapshot(manifest, snapshot);
  await mkdir(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, storePath);
  process.stdout.write(`Verified private release prompt snapshot: ${manifest.prompts.length} prompts\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  buildReleaseSnapshot().catch((error: unknown) => {
    process.stderr.write(`Release prompt snapshot build failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
