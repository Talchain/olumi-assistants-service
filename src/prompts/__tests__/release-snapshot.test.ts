import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../schema.js';
import {
  ReleasePromptManifestSchema,
  validateReleaseSnapshot,
} from '../release-snapshot.js';

const content = 'Approved prompt text with enough content.';
const hash = computeContentHash(content);
const now = '2026-09-23T00:00:00.000Z';
const manifest = ReleasePromptManifestSchema.parse({
  format: 1,
  prompts: [{
    id: 'draft_graph',
    taskId: 'draft_graph',
    version: 202,
    contentHash: hash,
    modelConfig: { staging: 'gpt-5', production: 'gpt-5' },
  }],
});

function snapshot() {
  return {
    version: 1,
    lastModified: now,
    prompts: {
      draft_graph: {
        id: 'draft_graph', name: 'Draft graph', taskId: 'draft_graph',
        status: 'production', activeVersion: 202, stagingVersion: 202,
        modelConfig: { staging: 'gpt-5', production: 'gpt-5' },
        tags: [], createdAt: now, updatedAt: now,
        versions: [{
          version: 202, content, contentHash: hash, variables: [],
          createdBy: 'test', createdAt: now, requiresApproval: false,
          testCases: [],
        }],
      },
    },
  };
}

describe('release prompt snapshot', () => {
  it('accepts only the selected prompt and version', () => {
    expect([...validateReleaseSnapshot(manifest, snapshot())]).toEqual(['draft_graph']);
  });

  it('rejects changed content even when the stored hash stays pinned', () => {
    const changed = snapshot();
    changed.prompts.draft_graph.versions[0]!.content = 'A different prompt text with enough content.';
    expect(() => validateReleaseSnapshot(manifest, changed)).toThrow('mismatch');
  });

  it('rejects a changed model route or pointer', () => {
    const changed = snapshot();
    changed.prompts.draft_graph.modelConfig.staging = 'claude-sonnet-5';
    expect(() => validateReleaseSnapshot(manifest, changed)).toThrow('mismatch');
    changed.prompts.draft_graph.modelConfig.staging = 'gpt-5';
    changed.prompts.draft_graph.stagingVersion = 195;
    expect(() => validateReleaseSnapshot(manifest, changed)).toThrow('mismatch');
  });

  it('rejects a missing or extra prompt', () => {
    const missing = snapshot();
    expect(() => validateReleaseSnapshot(manifest, { ...missing, prompts: {} })).toThrow();
    expect(() => validateReleaseSnapshot(manifest, {
      ...missing,
      prompts: { ...missing.prompts, other: missing.prompts.draft_graph },
    })).toThrow('unpinned');
  });
});
